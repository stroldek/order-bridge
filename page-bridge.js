(() => {
  "use strict";
  if (window.__ORDER_BRIDGE_PAGE_BRIDGE__) return;
  window.__ORDER_BRIDGE_PAGE_BRIDGE__ = true;

  const CHANNEL = "ORDER_BRIDGE_PAGE_CHANNEL";
  const nativeFetch = window.fetch.bind(window);
  let armed = false;
  let bearerAuthorization = null;
  let buildId = window.__NEXT_DATA__?.buildId || null;
  let locale = document.documentElement.lang || "uk";
  let polling = false;

  const emit = (type, payload = {}) => {
    window.postMessage({ channel: CHANNEL, direction: "PAGE_TO_EXTENSION", type, payload }, "*");
  };

  const isOrdersApi = value => {
    try {
      const url = new URL(value, location.href);
      return url.hostname === "api.gost.ua" && url.pathname === "/api/v1/profile/orders";
    } catch { return false; }
  };

  const isNextOrderData = value => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || !url.pathname.includes("/_next/data/")) return false;
      if (!url.pathname.includes("/partner-orders/")) return false;
      const match = url.pathname.match(/\/_next\/data\/([^/]+)\//);
      if (match) buildId = match[1];
      return true;
    } catch { return false; }
  };

  function rememberAuthorization(headers, requestUrl) {
    if (!armed || !isOrdersApi(requestUrl)) return;
    try {
      const normalized = new Headers(headers || {});
      const value = normalized.get("authorization");
      if (value && /^Bearer\s+\S+/i.test(value)) {
        bearerAuthorization = value;
        emit("AUTH_AVAILABLE", { available: true });
      }
    } catch {}
  }

  function parseJson(text) {
    if (!text) return null;
    if (typeof text === "object") return text;
    try { return JSON.parse(text); } catch { return null; }
  }

  function summarizeRows(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map(item => ({
      id: String(item?.id ?? ""),
      number: item?.number ?? null,
      totalPrice: Number(item?.total_price ?? 0) || 0,
      paymentDate: item?.payment_date ?? null,
      createdAt: item?.created_at ?? null,
      status: item?.status ?? null,
      paymentStatus: item?.payment_status ?? null,
      paymentType: item?.payment_type ?? null
    })).filter(item => item.id);
  }

  function readNextOrder(payload, expectedId) {
    const order = payload?.pageProps?.initialState?.orders?.order ??
      payload?.props?.pageProps?.initialState?.orders?.order ?? null;
    if (!order || String(order.id) !== String(expectedId)) return null;
    return order;
  }

  async function cloneAndCapture(response, requestUrl) {
    if (!armed || !response?.ok) return;
    if (isOrdersApi(requestUrl)) {
      try {
        const payload = await response.clone().json();
        const rows = summarizeRows(payload);
        if (rows.length) {
          emit("ORDERS_CAPTURED", {
            rows,
            currentPage: payload?.meta?.current_page ?? 1,
            lastPage: payload?.meta?.last_page ?? 1,
            total: payload?.meta?.orders_total ?? payload?.meta?.total ?? rows.length,
            source: "page"
          });
        }
      } catch {}
      return;
    }
    if (isNextOrderData(requestUrl)) {
      try {
        const payload = await response.clone().json();
        const match = String(requestUrl).match(/partner-orders\/([^/?]+)\.json/);
        const id = match?.[1];
        const order = id ? readNextOrder(payload, id) : null;
        if (order) emit("ORDER_DETAIL", { order });
      } catch {}
    }
  }

  // The Bearer value stays inside this page-context closure.
  window.fetch = async function(input, init) {
    const requestUrl = typeof input === "string" ? input : input?.url || "";
    let headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      try {
        const overrides = new Headers(init.headers);
        overrides.forEach((value, name) => headers.set(name, value));
      } catch {}
    }
    rememberAuthorization(headers, requestUrl);
    const response = await nativeFetch(input, init);
    if (armed) void cloneAndCapture(response, requestUrl);
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__obRequestUrl = new URL(url, location.href).href;
    this.__obRequestHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__obRequestHeaders) this.__obRequestHeaders[String(name).toLowerCase()] = String(value);
    return originalSetRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const requestUrl = this.__obRequestUrl || "";
    if (armed && isOrdersApi(requestUrl)) {
      rememberAuthorization(this.__obRequestHeaders || {}, requestUrl);
      this.addEventListener("loadend", () => {
        if (this.status < 200 || this.status >= 300) return;
        const payload = this.responseType === "json" ? this.response : parseJson(this.responseText);
        if (!payload) return;
        const rows = summarizeRows(payload);
        if (rows.length) emit("ORDERS_CAPTURED", {
          rows,
          currentPage: payload?.meta?.current_page ?? 1,
          lastPage: payload?.meta?.last_page ?? 1,
          total: payload?.meta?.orders_total ?? payload?.meta?.total ?? rows.length,
          source: "xhr"
        });
      }, { once: true });
    } else if (armed && isNextOrderData(requestUrl)) {
      this.addEventListener("loadend", () => {
        if (this.status < 200 || this.status >= 300) return;
        const payload = this.responseType === "json" ? this.response : parseJson(this.responseText);
        const match = requestUrl.match(/partner-orders\/([^/?]+)\.json/);
        const order = match ? readNextOrder(payload, match[1]) : null;
        if (order) emit("ORDER_DETAIL", { order });
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  async function requestJson(url, options = {}, treatAuthFailure = true) {
    const response = await nativeFetch(url, options);
    if (treatAuthFailure && (response.status === 401 || response.status === 403)) {
      const error = new Error("GOST відхилив авторизований запит.");
      error.auth = true;
      throw error;
    }
    if (!response.ok) throw new Error("HTTP " + response.status + " для " + new URL(url).pathname);
    return response.json();
  }

  function apiUrl(page) {
    return "https://api.gost.ua/api/v1/profile/orders?page=" + page +
      "&lang=" + encodeURIComponent(locale || "uk");
  }

  async function fetchOrdersPage(page) {
    if (!bearerAuthorization) {
      const error = new Error("Не знайдено авторизований Bearer-заголовок. Оновіть сторінку замовлень GOST.");
      error.authMissing = true;
      throw error;
    }
    return requestJson(apiUrl(page), {
      method: "GET",
      credentials: "omit",
      headers: { "Authorization": bearerAuthorization, "Accept": "application/json" }
    });
  }

  function setBuildIdFromWindow() {
    if (!buildId && window.__NEXT_DATA__?.buildId) buildId = window.__NEXT_DATA__.buildId;
    if (window.__NEXT_DATA__?.locale) locale = window.__NEXT_DATA__.locale;
  }

  async function fetchOrderDetail(id) {
    setBuildIdFromWindow();
    if (!buildId) throw new Error("Не вдалося визначити Next.js build ID. Перезавантажте кабінет GOST.");
    const path = "/_next/data/" + encodeURIComponent(buildId) + "/" +
      encodeURIComponent(locale || "uk") + "/partner-orders/" +
      encodeURIComponent(id) + ".json?id=" + encodeURIComponent(id);
    // The Next.js detail route is requested on gost.ua itself. Do not forward
    // the API Bearer token to this different host; use the page's same-origin session.
    const headers = { "Accept": "application/json" };
    const payload = await requestJson(new URL(path, location.origin).href, {
      method: "GET", credentials: "same-origin", headers
    }, false);
    const order = readNextOrder(payload, id);
    if (!order) throw new Error("У відповіді Next.js не знайдено деталізацію замовлення " + id + ".");
    return order;
  }

  async function scanOrders({ knownIds = [], pendingIds = [], fullScan = false, baseline = false } = {}) {
    if (polling) {
      emit("BRIDGE_ERROR", { message: "Попередня перевірка ще виконується." });
      return;
    }
    polling = true;
    try {
      setBuildIdFromWindow();
      const known = new Set(knownIds.map(String));
      const pending = new Set(pendingIds.map(String));
      const allRows = [];
      let page = 1;
      let lastPage = 1;
      const maxPages = baseline || fullScan ? 200 : 25;
      do {
        const payload = await fetchOrdersPage(page);
        const rows = summarizeRows(payload);
        allRows.push(...rows);
        lastPage = Math.max(1, Number(payload?.meta?.last_page || 1));
        emit("SCAN_PROGRESS", { page, lastPage, loaded: allRows.length });
        if (!baseline && !fullScan && rows.some(row => known.has(row.id))) break;
        page += 1;
      } while (page <= lastPage && page <= maxPages);

      if (baseline) {
        emit("BASELINE_COMPLETE", {
          rows: allRows,
          pagesScanned: Math.min(page - 1, maxPages),
          lastPage,
          truncated: lastPage > maxPages
        });
        return;
      }

      const ids = new Set(allRows.filter(row => !known.has(row.id)).map(row => row.id));
      for (const id of pending) ids.add(id);
      emit("POLL_RESULT", {
        rows: allRows,
        newIds: [...ids],
        pagesScanned: Math.min(page - 1, maxPages),
        lastPage
      });

      let authFailure = false;
      for (const id of ids) {
        try {
          const order = await fetchOrderDetail(id);
          emit("ORDER_DETAIL", { order });
        } catch (error) {
          const isAuthFailure = Boolean(error?.auth || error?.authMissing);
          if (isAuthFailure) {
            authFailure = true;
            break;
          }
          emit("ORDER_DETAIL_FAILED", {
            id,
            message: String(error?.message || error),
            auth: false
          });
        }
      }
      if (authFailure) {
        emit("BRIDGE_ERROR", { message: "Сесія GOST більше не дозволяє отримувати деталізацію замовлень.", auth: true });
      } else {
        emit("POLL_COMPLETE", { checkedAt: new Date().toISOString() });
      }
    } catch (error) {
      emit("BRIDGE_ERROR", {
        message: String(error?.message || error),
        auth: Boolean(error?.auth || error?.authMissing),
        authMissing: Boolean(error?.authMissing)
      });
    } finally {
      polling = false;
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.channel !== CHANNEL ||
        event.data?.direction !== "EXTENSION_TO_PAGE") return;
    const { type, payload = {} } = event.data;
    if (type === "ARM") {
      armed = true;
      setBuildIdFromWindow();
      emit("BRIDGE_ARMED", { buildIdAvailable: Boolean(buildId) });
    } else if (type === "DISARM") {
      armed = false;
      bearerAuthorization = null;
      emit("BRIDGE_DISARMED");
    } else if (type === "FETCH_BASELINE") {
      void scanOrders({ baseline: true });
    } else if (type === "POLL_NOW") {
      void scanOrders(payload);
    } else if (type === "FETCH_DETAILS") {
      (async () => {
        for (const id of payload.ids || []) {
          try {
            const order = await fetchOrderDetail(id);
            emit("ORDER_DETAIL", { order });
          } catch (error) {
            emit("ORDER_DETAIL_FAILED", { id, message: String(error?.message || error) });
          }
        }
      })();
    }
  });

  emit("BRIDGE_READY", { buildIdAvailable: Boolean(buildId) });
})();