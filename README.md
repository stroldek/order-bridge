# Order Bridge

Stage 2 — GOST source connector + Excel export (v0.3.3)

## What changed
- The Excel export opens on a human-readable “Картки замовлень” sheet. Every order has a visual block with status, payment/delivery metadata, all available product lines, unit prices, discounted prices, line totals, overall amount, discount, delivery, prepayment, paid amount, balance, and sub-orders.
- The workbook also contains a filterable “Реєстр” and normalized “Товарні позиції” sheet for future integrations. Orders whose product details are not loaded are visibly marked.
- The workbook is created locally. Buyer contact details, delivery addresses, and comments are not included.
- Adds a local Excel export (.xlsx) with a human-readable order-card sheet, a filterable order register, and normalized product-line data. Exports all locally stored orders, not only the eight shown in the dashboard. The workbook marks new vs. historical orders and shows whether details have been loaded.
- The workbook is generated in the browser; no order data is uploaded to a third-party service during export. Customer contact details and delivery addresses are not included.
- Persistent floating panel anchored bottom-right on GOST. It stays open when focus moves elsewhere and returns after reload; collapse it explicitly with the minus control.
- Injected only on `https://gost.ua/*`; never shown on other sites. Toolbar icon toggles it on GOST.
- Scrollbar tracks hidden while mouse-wheel and two-finger touchpad scrolling remain available.\n- The collapsed launcher can be dragged anywhere on screen; its position is saved across page reloads. Re-expanding always restores the full panel to the bottom-right corner.
- Moves complete order details directly into each card in “Останні замовлення”. Historical orders keep the neutral style; orders first detected after baseline receive a subtle green outline and a “НОВЕ” marker.
- Keeps up to 500 detailed parsed orders locally for display inside “Останні замовлення”. Stored data excludes buyer names, phone numbers, email, delivery addresses, and comments.
- Keeps the supplied transparent logo transparent in the popup; no theme-colored or black rectangular backing is drawn behind it.

- Uses the supplied Order Bridge logo in the popup header; the brand wordmark is no longer recreated with text.
- Removes fixed-source and historical-order mode controls from settings. The source remains GOST and the initial ID baseline always protects existing orders.
- The operations log and latest-orders list have independent collapsible panels.
- Light theme uses a muted green-gray surface palette with stronger card and control separation.
- The extension UI is now a real Chrome toolbar popup (popup.html), not a tab opened by the extension.
- Uses one familiar ghost emoji (👻) in every state, with state-specific motion/marks.
- Watches GOST's authenticated order-list requests in the page's MAIN world.
- Keeps the observed Bearer value inside the GOST page context only; it is not sent to the extension, persisted, logged, or uploaded. Disconnect pauses monitoring but retains that value only in the same page's memory so reconnect can resume without a reload.
- Captures the GOST order list, marks existing IDs as historical on first connection, then checks for new orders every 120 seconds.
- Fetches order detail JSON from the Next.js data endpoint for each new order.
- Normalizes nested sub-orders and product arrays.
- Stores order IDs, operational metadata, compact product summaries, and a separate capped audit history of parsed order/product fields. Buyer name, phone, email, address, comments, and the raw full payload are not persisted.
- Performs a full list refresh periodically to reconcile payment/status updates.
- Calculates today's `total_price` against the fixed `Europe/Kyiv` calendar date and de-duplicates orders by ID to avoid double-counting overlapping pages.

## Automated build\n\nEvery push to main validates the manifest and JavaScript, runs the normalizer tests, and uploads an installable ZIP artifact named order-bridge-v0.3.3 to the GitHub Actions run (30-day retention).\n\n## Install
1. Download the repository ZIP from GitHub and extract it.
2. Open chrome://extensions.
3. Enable Developer mode.
4. Click Load unpacked and select the extracted repository folder.
5. Sign in to GOST in a normal browser tab.
6. On GOST, the panel appears automatically at bottom-right. Use minus to collapse; use its launcher or the toolbar icon to restore. Click Підключити.
7. Open the GOST Замовлення page and refresh it.

## Stage 2 limitations
- The Excel export is a local file export. Automatic delivery to an external system is not connected yet.
- The GOST tab must remain open for page-context authenticated requests. If the page is closed or the GOST session expires, the popup reports that state and polling pauses.
- Chrome alarms target a 120-second interval but may be delayed by browser scheduling.
- Order details are fetched through the observed Next.js data route. If GOST changes that route/build structure, the bridge reports a parsing error rather than silently inventing data.
- Initial historical orders are registered by ID and are not queued for transmission.

## Security notes
- No Cookie, password, or Bearer value is read into extension storage.
- No credential is committed to this repository.
- Do not publish raw customer order payloads or DevTools HAR files.
