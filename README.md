# Order Bridge

Stage 1 — UI Foundation (v0.1.0)

A no-dependency Chrome Extension UI prototype and browser preview for the Order Bridge product.

## Preview
Open `START_HERE.html` and click **Open workspace preview**, or open `index.html` directly.

The preview is intentionally a demo: the Connect animation, sample dashboard metrics, and settings UI do not yet contact GOST or send orders to external systems.

## Load as a Chrome extension
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this repository folder (or the extracted ZIP folder).
5. Open the extension and choose **Open workspace**.

## Stage 1 scope
- Unified ghost mascot with three expressions/states.
- Light/dark themes.
- Workspace and parser settings tabs.
- Collapsible secondary dashboard metrics and recent operations.
- Destination connector configuration prototypes.
- Field mapping editor prototype.
- Polling interval default recorded as 120 seconds.

## Important
- GOST API integration is not active in this stage.
- No Bearer token, cookies, passwords, or customer data are stored.
- Do not use the demo numbers as business data.
- Real GOST monitoring, order details parsing, deduplication, queueing, retries, and delivery will be implemented in later stages.
