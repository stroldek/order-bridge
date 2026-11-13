(() => {
  "use strict";
  const isExtension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let snapshot = null;

  function formatMoney(value) {
    return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Number(value) || 0) + " ₴";
  }
  function formatTime(value) {
    if (!value) return "Ще не виконувалась";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  async function loadTheme() {
    let theme = "dark";
    try {
      if (isExtension) {
        const saved = await chrome.storage.local.get("ob_theme");
        theme = saved.ob_theme || "dark";
      } else theme = localStorage.getItem("ob-theme") || "dark";
    } catch {}
    document.body.classList.toggle("light", theme === "light");
    $("#themeIcon").textContent = theme === "light" ? "☾" : "☼";
  }
  async function setTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
    $("#themeIcon").textContent = theme === "light" ? "☾" : "☼";
    try {
      if (isExtension) await chrome.storage.local.set({ ob_theme: theme });
      else localStorage.setItem("ob-theme", theme);
    } catch {}
  }

  function renderStatus(state) {
    const mode = state?.connectionState || "disconnected";
    $("#ghost").className = "ghost " + (
      mode === "connected" ? "happy" :
      ["error", "auth_expired", "page_unavailable"].includes(mode) ? "worried" :
      ["scanning_history", "awaiting_source"].includes(mode) ? "busy" : "confused"
    );
    const labels = {
      disconnected: ["Поки не підключено", "Відкрийте GOST, увійдіть у кабінет і натисніть «Підключити»."],
      awaiting_source: ["Очікуємо API GOST", "Перейдіть до розділу «Замовлення» та оновіть сторінку."],
      scanning_history: ["Зчитуємо історію", "Фіксуємо наявні ID. Старі замовлення не передаватимуться."],
      connected: ["GOST підключено", "Нові замовлення перевіряються кожні " + ((snapshot?.config?.pollIntervalSeconds || 120) / 60) + " хв."],
      auth_expired: ["Потрібен вхід у GOST", "Сесія більше не підтверджує запити. Увійдіть у GOST та оновіть сторінку."],
      page_unavailable: ["Немає вкладки GOST", "Відкрийте кабінет GOST та оновіть сторінку."],
      error: ["Проблема синхронізації", state?.lastError || "Перевірте вкладку GOST."]
    };
    const label = labels[mode] || labels.disconnected;
    $("#statusTitle").textContent = label[0];
    $("#statusText").textContent = state?.lastError && ["error", "auth_expired", "page_unavailable"].includes(mode)
      ? state.lastError : label[1];
    $("#connectBtn").textContent = mode === "connected" ? "Підключено" :
      ["awaiting_source", "scanning_history"].includes(mode) ? "Очікуємо…" :
      mode === "auth_expired" ? "Перепідключити" : "Підключити";
    $("#connectBtn").disabled = ["connected", "awaiting_source", "scanning_history"].includes(mode);
    $("#disconnectBtn").hidden = mode === "disconnected";
  }

  function renderOrders(summaries) {
    const items = (summaries || []).filter(item => item.detailsParsedAt).slice(0, 6);
    const container = $("#ordersList");
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">Нових замовлень поки немає. Історичні замовлення не імпортуються автоматично.</div>';
      return;
    }
    container.innerHTML = items.map(order => {
      const products = (order.products || []).slice(0, 3).map(product =>
        '<div class="product-line"><span>' + escapeHtml(product.name || "Товар") + '</span><span>× ' + (Number(product.quantity) || 0) + '</span></div>'
      ).join("");
      const extra = (order.products || []).length > 3 ? '<div class="product-more">Ще ' + (order.products.length - 3) + ' позицій</div>' : "";
      return '<article class="order-card">' +
        '<div class="order-card-top"><strong>Замовлення №' + escapeHtml(order.number ?? "—") + '</strong><span class="order-state">Отримано</span></div>' +
        '<div class="product-lines">' + products + extra + '</div>' +
        '<div class="order-card-bottom"><span>' + (Number(order.totalQuantity) || 0) + ' шт. · ' + (Number(order.itemCount) || 0) + ' позицій</span><strong>' + formatMoney(order.totalPrice) + '</strong></div>' +
        '</article>';
    }).join("");
  }

  function renderActivity(items) {
    const container = $("#activityList");
    if (!items?.length) {
      container.innerHTML = '<div class="empty-state">Операцій ще немає.</div>';
      return;
    }
    container.innerHTML = items.slice(0, 5).map(item =>
      '<div class="log-item"><span class="log-icon ' + escapeHtml(item.level || "info") + '">•</span><div><strong>' +
      escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.detail) + '</p></div><time>' +
      formatTime(item.at) + '</time></div>'
    ).join("");
  }

  function render(data) {
    snapshot = data;
    const state = data?.state || {};
    const config = data?.config || {};
    const summaries = data?.summaries || [];
    const pending = data?.pendingIds || [];
    renderStatus(state);
    $("#ordersMetric").textContent = Number(state.sentCount || 0).toLocaleString("uk-UA");
    const revenue = isExtension && window.OrderBridgeNormalizer
      ? OrderBridgeNormalizer.todayRevenue(summaries) : 0;
    $("#moneyMetric").textContent = formatMoney(revenue);
    $("#receivedMetric").textContent = Number(state.receivedCount || 0).toLocaleString("uk-UA");
    $("#historicalMetric").textContent = Number(state.historicalCount || 0).toLocaleString("uk-UA");
    $("#pendingMetric").textContent = pending.length.toLocaleString("uk-UA");
    $("#errorsMetric").textContent = Number(state.errorCount || 0).toLocaleString("uk-UA");
    $("#intervalMetric").textContent = Number(config.pollIntervalSeconds || 120).toLocaleString("uk-UA") + " секунд";
    $("#lastCheck").textContent = formatTime(state.lastCheckAt);
    $("#pollInterval").value = String(config.pollIntervalSeconds || 120);
    $("#historyMode").value = config.historyMode || "baseline_only";
    renderOrders(summaries);
    renderActivity(data?.activity || []);
  }

  async function refresh() {
    if (!isExtension) {
      render({
        state: { connectionState: "disconnected" },
        config: { pollIntervalSeconds: 120 },
        summaries: [], pendingIds: [], activity: []
      });
      return;
    }
    const data = await chrome.runtime.sendMessage({ type: "OB_GET_SNAPSHOT" });
    if (data?.state) render(data);
  }

  async function sendAction(type, extra = {}) {
    if (!isExtension) {
      $("#saveNotice").textContent = "У browser preview доступний лише перегляд. Для роботи відкрийте розширення Chrome.";
      return;
    }
    return chrome.runtime.sendMessage({ type, ...extra });
  }

  $$(".tab").forEach(button => button.addEventListener("click", () => {
    $$(".tab").forEach(item => item.classList.toggle("active", item === button));
    $$(".view").forEach(view => view.classList.toggle("active", view.id === button.dataset.tab));
  }));
  $("#themeToggle").addEventListener("click", () =>
    void setTheme(document.body.classList.contains("light") ? "dark" : "light"));
  $("#connectBtn").addEventListener("click", async () => {
    const result = await sendAction("OB_CONNECT_GOST");
    if (result?.message) $("#statusText").textContent = result.message;
    await refresh();
  });
  $("#disconnectBtn").addEventListener("click", async () => {
    await sendAction("OB_DISCONNECT_GOST");
    await refresh();
  });
  $("#checkNowBtn").addEventListener("click", async () => {
    const result = await sendAction("OB_CHECK_NOW");
    if (result?.message) $("#statusText").textContent = result.message;
    await refresh();
  });
  $("#toggleDetails").addEventListener("click", () => {
    const details = $("#details");
    details.hidden = !details.hidden;
    $("#toggleDetails").textContent = details.hidden ? "Показати" : "Приховати";
  });
  $("#saveSettings").addEventListener("click", async () => {
    const pollIntervalSeconds = Math.max(120, Number($("#pollInterval").value) || 120);
    const result = await sendAction("OB_SAVE_CONFIG", {
      config: { pollIntervalSeconds, historyMode: $("#historyMode").value }
    });
    $("#saveNotice").textContent = result?.ok ? "Налаштування збережено." : (result?.message || "Не вдалося зберегти.");
    await refresh();
  });

  void loadTheme();
  void refresh();
  if (isExtension) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && Object.keys(changes).some(key => key.startsWith("ob_"))) void refresh();
    });
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "OB_REFRESH_UI") void refresh();
    });
  }
})();