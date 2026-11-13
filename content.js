(() => {
  "use strict";
  const CHANNEL = "ORDER_BRIDGE_PAGE_CHANNEL";
  function sendToPage(type, payload = {}) {
    window.postMessage({ channel: CHANNEL, direction: "EXTENSION_TO_PAGE", type, payload }, "*");
  }
  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== "PAGE_TO_EXTENSION") return;
    chrome.runtime.sendMessage({
      type: "OB_PAGE_EVENT",
      eventType: data.type,
      payload: data.payload || {}
    }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "OB_PAGE_COMMAND") {
      sendToPage(message.command, message.payload || {});
      sendResponse?.({ ok: true });
    }
    return false;
  });
  chrome.runtime.sendMessage({ type: "OB_CONTENT_READY", pageUrl: location.href }).catch(() => {});
})();