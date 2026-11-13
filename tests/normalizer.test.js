"use strict";

const assert = require("node:assert/strict");
global.self = globalThis;
require("../order-normalizer.js");

const normalize = global.OrderBridgeNormalizer.normalizeOrder;
const todayRevenue = global.OrderBridgeNormalizer.todayRevenue;

const parsed = normalize({
  id: "test-order-01",
  number: 19314,
  total_price: "701.00",
  total_discount: 100,
  payment_status: "awaiting_payment",
  created_at: "2026-11-12T15:10:30.000000Z",
  sub_orders: [
    {
      id: "sub-1",
      products: [
        { id: "p-1", name: "Дверна ручка", sku: "111", quantity: 1, price: 302, total_price: 302 },
        { id: "p-2", name: "Дверна петля", sku: "222", quantity: 1, price: 399, total_price: 399 }
      ]
    },
    {
      id: "sub-2",
      products: [
        { id: "p-3", name: "Третій товар", sku: "333", quantity: 2, price: 50, total_price: 100 }
      ]
    }
  ]
});

assert.equal(parsed.id, "test-order-01");
assert.equal(parsed.subOrderCount, 2);
assert.equal(parsed.productLineCount, 3);
assert.equal(parsed.totalQuantity, 4);
assert.equal(parsed.products.reduce((sum, item) => sum + item.totalPrice, 0), 801);
assert.equal(parsed.totalPrice, 701, "Order total must not be silently replaced by sum of product lines.");
assert.equal(parsed.totalDiscount, 100);

process.env.TZ = "America/Los_Angeles";
const revenue = todayRevenue([
  { id: "paid-today", paymentDate: "2026-11-13T10:19:47.000000Z", totalPrice: "5216.00" },
  { id: "paid-today", paymentDate: "2026-11-13T10:19:47.000000Z", totalPrice: "5216.00" },
  { id: "paid-yesterday", paymentDate: "2026-11-12T20:00:00.000000Z", totalPrice: 1000 },
  { id: "kyiv-today-utc-yesterday", paymentDate: "2026-11-12T22:30:00.000Z", totalPrice: 75 },
  { id: "unpaid", paymentDate: null, totalPrice: 500 }
], new Date("2026-11-13T12:00:00+02:00"));
assert.equal(revenue, 5291, "Revenue must use Europe/Kyiv and count each order ID once.");

console.log("Order Bridge normalizer tests passed.");
