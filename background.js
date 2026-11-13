importScripts("order-normalizer.js");

const KEYS = {
  state: "ob_state",
  config: "ob_config",
  knownIds: "ob_known_ids",
  pendingIds: "ob_pending_ids",
  summaries: "ob_order_summaries",
  activity: "ob_activity"
};
const ALARM_NAME = "order-bridge-poll";
const DEFAULT_STATE = {
  connectionState: "disconnected",
  monitorTabId: null,
  baselineCompleted: false,
  historicalCount: 0,
  receivedCount: 0,
  sentCount: 0,
  errorCount: 0,
  lastCheckAt: null,
  lastSuccessAt: null,
  lastError: null,
  pollCounter: 0
};
const DEFAULT_CONFIG = { pollIntervalSeconds: 120, source: "gost", historyMode: "baseline_only" };

async function readAll() {
  const values = await chrome.storage.local.get(Object.values(KEYS));
  return {
    state: { ...DEFAULT_STATE, ...(values[KEYS.state] || {}) },
    config: { ...DEFAULT_CONFIG, ...(values[KEYS.config] || {}) },
    knownIds: values[KEYS.knownIds] || [],
    pendingIds: values[KEYS.pendingIds] || [],
    summaries: values[KEYS.summaries] || [],
    activity: values[KEYS.activity] || []
  };
}

async function patchState(patch) {
  const { state } = await readAll();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ [KEYS.state]: next });
  return next;
}

async function logActivity(title, detail = "", level = "info") {
  const { activity } = await readAll();
  const item = { id: crypto.randomUUID(), title, detail, level, at: new Date().toISOString() };
  await chrome.storage.local.set({ [KEYS.activity]: [item, ...activity].slice(0, 50) });
}

async function createPollingAlarm() {
  const { config, state } = await readAll();
  if (state.connectionState !== "connected" || !state.baselineCompleted) return;
  const seconds = Math.max(120, Number(config.pollIntervalSeconds) || 120);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: seconds / 60 });
}

async function removePollingAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
}

async function getGostTab() {
  const { state } = await readAll();
  if (state.monitorTabId) {
    try {
      const tab = await chrome.tabs.get(state.monitorTabId);
      if (tab?.url?.startsWith("https://gost.ua/")) return tab;
    } catch {}
  }
  const tabs = await chrome.tabs.query({ url: ["https://gost.ua/*"] });
  return tabs.find(tab => tab.active) || tabs[0] || null;
}

async function sendPageCommand(tabId, command, payload = {}) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "OB_PAGE_COMMAND", command, payload });
    return true;
  } catch {
    return false;
  }
}

async function connectGost() {
  let tab = await getGostTab();
  if (!tab) tab = await chrome.tabs.create({ url: "https://gost.ua/" });
  await patchState({
    connectionState: "awaiting_source",
    monitorTabId: tab.id,
    lastError: null
  });
  const delivered = await sendPageCommand(tab.id, "ARM");
  await logActivity(
    "Очікуємо підключення GOST",
    delivered
      ? "Відкрийте розділ «Замовлення» та оновіть сторінку."
      : "Вкладку відкрито. Після входу в кабінет перейдіть до «Замовлення» та оновіть сторінку."
  );
  return {
    ok: true,
    message: delivered
      ? "Відкрийте розділ «Замовлення» в GOST та оновіть сторінку."
      : "Відкрийте GOST, увійдіть у кабінет, перейдіть до «Замовлення» та оновіть сторінку."
  };
}

async function disconnectGost() {
  const { state } = await readAll();
  if (state.monitorTabId) await sendPageCommand(state.monitorTabId, "DISARM");
  await removePollingAlarm();
  await patchState({ connectionState: "disconnected", monitorTabId: null, lastError: null });
  await logActivity("Моніторинг зупинено", "Підключення до джерела GOST вимкнено.");
  return { ok: true };
}

async function handleContentReady(tabId) {
  const { state } = await readAll();
  if (["awaiting_source", "scanning_history"].includes(state.connectionState)) {
    await patchState({ monitorTabId: tabId });
    await sendPageCommand(tabId, "ARM");
  } else if (state.connectionState === "connected") {
    await patchState({ monitorTabId: tabId });
    await sendPageCommand(tabId, "ARM");
  }
}

async function handleBaseline(payload, tabId) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const ids = [...new Set(rows.map(row => String(row.id)).filter(Boolean))];
  const summaries = rows.map(row => OrderBridgeNormalizer.listSummary(row));
  await chrome.storage.local.set({
    [KEYS.knownIds]: ids,
    [KEYS.pendingIds]: [],
    [KEYS.summaries]: summaries
  });
  await patchState({
    connectionState: "connected",
    monitorTabId: tabId,
    baselineCompleted: true,
    historicalCount: ids.length,
    lastCheckAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastError: null
  });
  await logActivity(
    "Початкову історію зафіксовано",
    ids.length + " наявних замовлень позначено як історичні. Вони не передаватимуться автоматично."
  );
  if (payload.truncated) {
    await logActivity(
      "Історію завантажено частково",
      "GOST повернув понад ліміт сторінок. Решта історії буде дозчитана наступними перевірками.",
      "warning"
    );
  }
  await createPollingAlarm();
}

async function mergeListRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const { summaries } = await readAll();
  const map = new Map(summaries.map(item => [String(item.id), item]));
  for (const row of rows) {
    if (!row?.id) continue;
    const clean = OrderBridgeNormalizer.listSummary(row);
    map.set(clean.id, { ...(map.get(clean.id) || {}), ...clean });
  }
  const merged = [...map.values()]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5000);
  await chrome.storage.local.set({ [KEYS.summaries]: merged });
}

async function addPendingIds(ids) {
  const { pendingIds, knownIds } = await readAll();
  const known = new Set(knownIds.map(String));
  const pending = new Set(pendingIds.map(String));
  for (const id of ids || []) {
    const value = String(id);
    if (value && !known.has(value)) pending.add(value);
  }
  await chrome.storage.local.set({ [KEYS.pendingIds]: [...pending] });
}

async function handleOrderDetail(order) {
  const normalized = OrderBridgeNormalizer.normalizeOrder(order);
  const { knownIds, pendingIds, summaries, state } = await readAll();
  const known = new Set(knownIds.map(String));
  const pending = new Set(pendingIds.map(String));
  const isNew = !known.has(normalized.id);
  known.add(normalized.id);
  pending.delete(normalized.id);

  // Persist only integration-relevant product fields and operational metadata.
  // Buyer PII, addresses, comments and the raw Next.js payload are not persisted.
  const summary = {
    id: normalized.id,
    number: normalized.number,
    status: normalized.status,
    paymentStatus: normalized.paymentStatus,
    paymentType: normalized.paymentType,
    paymentDate: normalized.paymentDate,
    createdAt: normalized.createdAt,
    totalPrice: normalized.totalPrice,
    totalDiscount: normalized.totalDiscount,
    deliveryPrice: normalized.deliveryPrice,
    deliveryType: normalized.delivery.type,
    itemCount: normalized.productLineCount,
    totalQuantity: normalized.totalQuantity,
    products: normalized.products.map(product => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      externalId: product.externalId,
      quantity: product.quantity,
      unitCode: product.unitCode,
      price: product.price,
      discountPrice: product.discountPrice,
      totalPrice: product.totalPrice,
      category: product.category
    })),
    detailsParsedAt: new Date().toISOString()
  };

  const map = new Map(summaries.map(item => [String(item.id), item]));
  map.set(summary.id, { ...(map.get(summary.id) || {}), ...summary });
  const nextSummaries = [...map.values()]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5000);

  await chrome.storage.local.set({
    [KEYS.knownIds]: [...known],
    [KEYS.pendingIds]: [...pending],
    [KEYS.summaries]: nextSummaries
  });

  if (isNew) {
    await patchState({
      receivedCount: (state.receivedCount || 0) + 1,
      lastSuccessAt: new Date().toISOString()
    });
    await logActivity(
      "Нове замовлення отримано",
      "№" + (normalized.number ?? normalized.id) + " · " +
        normalized.productLineCount + " товарних позицій · " +
        normalized.totalQuantity + " шт. · " +
        normalized.totalPrice.toLocaleString("uk-UA") + " ₴",
      "success"
    );
  }
}

async function handlePageEvent(eventType, payload, tabId) {
  const { state, knownIds } = await readAll();

  if (eventType === "BRIDGE_READY") {
    if (["awaiting_source", "scanning_history", "connected"].includes(state.connectionState)) {
      await patchState({ monitorTabId: tabId });
      await sendPageCommand(tabId, "ARM");
    }
    return;
  }

  if (eventType === "BRIDGE_ARMED") {
    await patchState({ monitorTabId: tabId });
    return;
  }

  if (eventType === "AUTH_AVAILABLE") {
    if (state.connectionState === "auth_expired" || state.connectionState === "page_unavailable") {
      await patchState({ connectionState: state.baselineCompleted ? "connected" : "awaiting_source", lastError: null });
      await createPollingAlarm();
      await logActivity("Авторизацію GOST відновлено", "Виявлено новий авторизований запит.");
    } else if (state.connectionState === "awaiting_source") {
      await logActivity("Авторизований запит GOST виявлено", "Bearer-заголовок визначено; значення не зберігається.");
    }
    return;
  }

  if (eventType === "ORDERS_CAPTURED") {
    await patchState({ monitorTabId: tabId });
    if (!state.baselineCompleted) {
      await patchState({ connectionState: "scanning_history" });
      await logActivity("API замовлень виявлено", "Зчитуємо наявну історію без її передачі.");
      await sendPageCommand(tabId, "FETCH_BASELINE");
    } else {
      await mergeListRows(payload.rows || []);
      const known = new Set(knownIds.map(String));
      const newIds = (payload.rows || []).map(row => String(row.id)).filter(id => id && !known.has(id));
      if (newIds.length) {
        await addPendingIds(newIds);
        await sendPageCommand(tabId, "FETCH_DETAILS", { ids: newIds });
      }
    }
    return;
  }

  if (eventType === "BASELINE_COMPLETE") {
    await handleBaseline(payload, tabId);
    return;
  }

  if (eventType === "POLL_RESULT") {
    await mergeListRows(payload.rows || []);
    await addPendingIds(payload.newIds || []);
    return;
  }

  if (eventType === "ORDER_DETAIL") {
    // Do not misclassify a historical order opened by the user during onboarding.
    if (!state.baselineCompleted) return;
    await handleOrderDetail(payload.order);
    return;
  }

  if (eventType === "ORDER_DETAIL_FAILED") {
    await addPendingIds([payload.id]);
    await patchState({
      errorCount: state.errorCount + 1,
      lastError: payload.message || "Не вдалося отримати деталізацію замовлення."
    });
    await logActivity("Не вдалося отримати деталізацію", "ID " + payload.id + ": " +
      (payload.message || "невідома помилка"), "warning");
    if (payload.auth) {
      await patchState({ connectionState: "auth_expired" });
      await removePollingAlarm();
    }
    return;
  }

  if (eventType === "POLL_COMPLETE") {
    await patchState({
      connectionState: "connected",
      monitorTabId: tabId,
      lastCheckAt: payload.checkedAt || new Date().toISOString(),
      lastError: null
    });
    return;
  }

  if (eventType === "BRIDGE_ERROR") {
    const auth = Boolean(payload.auth || payload.authMissing);
    await patchState({
      connectionState: auth ? "auth_expired" : "error",
      lastCheckAt: new Date().toISOString(),
      lastError: payload.message || "Помилка під час перевірки GOST.",
      errorCount: state.errorCount + 1
    });
    await logActivity(auth ? "Потрібна авторизація GOST" : "Помилка синхронізації",
      payload.message || "Невідома помилка", "warning");
    if (auth) await removePollingAlarm();
  }
}

async function pollNow(manual = false) {
  const { state, config, knownIds, pendingIds } = await readAll();
  if (state.connectionState !== "connected" || !state.baselineCompleted) {
    return { ok: false, message: "Спочатку підключіть GOST та завершіть початкове сканування." };
  }
  const tab = await getGostTab();
  if (!tab) {
    await patchState({
      connectionState: "page_unavailable",
      lastError: "Не знайдено відкриту вкладку GOST. Відкрийте кабінет та оновіть сторінку."
    });
    return { ok: false, message: "Відкрийте вкладку GOST." };
  }
  const pollCounter = (state.pollCounter || 0) + 1;
  const fullScan = pollCounter % 5 === 0;
  await patchState({ monitorTabId: tab.id, pollCounter });
  const delivered = await sendPageCommand(tab.id, "POLL_NOW", { knownIds, pendingIds, fullScan });
  if (!delivered) {
    await patchState({
      connectionState: "page_unavailable",
      lastError: "Не вдалося зв'язатися зі сторінкою GOST. Оновіть її."
    });
    return { ok: false, message: "Оновіть вкладку GOST." };
  }
  if (manual) await logActivity("Перевірку запущено вручну", "Очікуємо відповідь GOST.");
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(async details => {
  const values = await chrome.storage.local.get(KEYS.state);
  if (!values[KEYS.state]) {
    await chrome.storage.local.set({
      [KEYS.state]: DEFAULT_STATE,
      [KEYS.config]: DEFAULT_CONFIG,
      [KEYS.knownIds]: [],
      [KEYS.pendingIds]: [],
      [KEYS.summaries]: [],
      [KEYS.activity]: []
    });
  }
  if (details.reason === "install") {
    await logActivity("Order Bridge встановлено", "Версія 0.2.0 · Stage 2.");
  }
  await createPollingAlarm();
});

chrome.runtime.onStartup.addListener(() => { void createPollingAlarm(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) void pollNow(false);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OB_CONTENT_READY") {
    if (sender.tab?.id && sender.tab.url?.startsWith("https://gost.ua/")) {
      void handleContentReady(sender.tab.id).then(() => sendResponse({ ok: true }));
      return true;
    }
  }
  if (message?.type === "OB_PAGE_EVENT") {
    const tab = sender.tab;
    if (!tab?.id || !tab.url?.startsWith("https://gost.ua/")) {
      sendResponse({ ok: false });
      return false;
    }
    void handlePageEvent(message.eventType, message.payload || {}, tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "OB_CONNECT_GOST") {
    void connectGost().then(sendResponse).catch(error => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  if (message?.type === "OB_DISCONNECT_GOST") {
    void disconnectGost().then(sendResponse).catch(error => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  if (message?.type === "OB_CHECK_NOW") {
    void pollNow(true).then(sendResponse).catch(error => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  if (message?.type === "OB_SAVE_CONFIG") {
    void (async () => {
      const { config } = await readAll();
      const interval = Math.max(120, Number(message.config?.pollIntervalSeconds) || 120);
      const nextConfig = { ...config, pollIntervalSeconds: interval };
      await chrome.storage.local.set({ [KEYS.config]: nextConfig });
      await createPollingAlarm();
      await logActivity("Налаштування збережено", "Інтервал перевірки: " + interval + " секунд.");
      return { ok: true };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  if (message?.type === "OB_GET_SNAPSHOT") {
    void readAll().then(sendResponse).catch(error => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  return false;
});
