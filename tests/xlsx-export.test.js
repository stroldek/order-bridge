const assert = require("node:assert/strict");
const { buildWorkbook } = require("../xlsx-export.js");

const snapshot = {
  summaries: [{
    id: "90001",
    number: "OB-90001",
    isNew: true,
    createdAt: "2026-11-18T08:00:00.000Z",
    status: "Опрацьовується",
    paymentStatus: "Очікує оплати",
    paymentType: "Безготівкова",
    paymentDate: "2026-11-18T08:05:00.000Z",
    deliveryType: "Самовивіз",
    itemCount: 1,
    totalQuantity: 2,
    totalPrice: 399.98,
    totalDiscount: 10,
    deliveryPrice: 0,
    amountPrepaid: 100,
    paidAmount: 100,
    paymentBalance: 299.98,
    detailsParsedAt: "2026-11-18T08:06:00.000Z",
    subOrders: [],
    products: [{
      sku: "CBL-001",
      externalId: "EXT-001",
      id: "501",
      name: "Кабель USB-C 2 м",
      category: "Кабелі",
      quantity: 2,
      unitCode: "шт.",
      price: 204.99,
      discountPrice: 199.99,
      originalPrice: 204.99,
      totalPrice: 399.98,
      subOrderId: "7001",
      isCustomOrder: false,
      active: true
    }]
  }],
  auditOrders: []
};

const { bytes, stats } = buildWorkbook(snapshot);
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4B);
assert.equal(bytes[2], 0x03);
assert.equal(bytes[3], 0x04);
assert.deepEqual(stats, { orders: 1, products: 1, detailedOrders: 1 });

const zipContents = Buffer.from(bytes).toString("utf8");
for (const expected of [
  "Замовлення", "Товари", "Номер замовлення",
  "Кабель USB-C 2 м", "CBL-001", "399.98"
]) {
  assert.ok(zipContents.includes(expected), "Workbook must contain: " + expected);
}

const empty = buildWorkbook({ summaries: [], auditOrders: [] });
assert.deepEqual(empty.stats, { orders: 0, products: 0, detailedOrders: 0 });
console.log("XLSX export tests passed.");
