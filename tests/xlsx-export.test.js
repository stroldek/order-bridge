const assert = require("node:assert/strict");
const { buildWorkbook } = require("../xlsx-export.js");

const snapshot = {
  summaries: [
    {
      id: "90001", number: "OB-90001", isNew: true,
      createdAt: "2026-11-18T08:00:00.000Z",
      status: "Опрацьовується", paymentStatus: "Очікує оплати",
      paymentType: "Безготівкова", paymentDate: "2026-11-18T08:05:00.000Z",
      deliveryType: "Самовивіз", itemCount: 2, totalQuantity: 3,
      totalPrice: 499.97, totalDiscount: 10, deliveryPrice: 0,
      amountPrepaid: 100, paidAmount: 100, paymentBalance: 399.97,
      detailsParsedAt: "2026-11-18T08:06:00.000Z",
      subOrders: [{ id: "7001", number: "SUB-1", status: "Опрацьовується", productCount: 2 }],
      products: [
        { sku: "CBL-001", externalId: "EXT-001", id: "501", name: "Кабель USB-C 2 м",
          category: "Кабелі", quantity: 2, unitCode: "шт.", price: 204.99,
          discountPrice: 199.99, originalPrice: 204.99, totalPrice: 399.98,
          subOrderId: "7001", isCustomOrder: false, active: true },
        { sku: "CHG-002", externalId: "EXT-002", id: "502", name: "Зарядний пристрій 20W",
          category: "Зарядні пристрої", quantity: 1, unitCode: "шт.", price: 109.99,
          discountPrice: 99.99, originalPrice: 109.99, totalPrice: 99.99,
          subOrderId: "7001", isCustomOrder: false, active: true }
      ]
    },
    { id: "90002", number: "OB-90002", isNew: false,
      createdAt: "2026-11-17T08:00:00.000Z", totalPrice: 0,
      products: [], detailsParsedAt: null }
  ],
  auditOrders: []
};

function zipEntries(bytes) {
  const result = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    assert.equal(method, 0);
    result.set(name, bytes.subarray(start, start + size).toString("utf8"));
    offset = start + size;
  }
  return result;
}

const { bytes, stats } = buildWorkbook(snapshot);
const buffer = Buffer.from(bytes);
assert.equal(buffer.readUInt32LE(0), 0x04034B50);
assert.deepEqual(stats, { orders: 2, products: 2, detailedOrders: 1 });
const entries = zipEntries(buffer);
const workbook = entries.get("xl/workbook.xml");
assert.ok(workbook.includes('name="Картки замовлень"'));
assert.ok(workbook.includes('name="Реєстр"'));
assert.ok(workbook.includes('name="Товарні позиції"'));
const cards = entries.get("xl/worksheets/sheet1.xml");
const register = entries.get("xl/worksheets/sheet2.xml");
const products = entries.get("xl/worksheets/sheet3.xml");
for (const expected of [
  "ЗАМОВЛЕННЯ №OB-90001", "Кабель USB-C 2 м", "Зарядний пристрій 20W",
  "CBL-001", "СУМА ЗАМОВЛЕННЯ", "ІСТОРИЧНЕ ЗАМОВЛЕННЯ",
  "Деталізацію ще не завантажено", "ПІДЗАМОВЛЕННЯ", "Залишок:"
]) assert.ok(cards.includes(expected), "Detail sheet must contain: " + expected);
assert.ok(!cards.includes("[object Object]"), "Date cells must render as readable text.");
assert.ok(register.includes("Номер замовлення"));
assert.ok(register.includes("2026-11-18T08:00:00.000Z"));
assert.ok(products.includes("Зовнішній ID товару"));
assert.ok(products.includes("Кабель USB-C 2 м"));
assert.ok(cards.includes("mergeCells"));
const empty = buildWorkbook({ summaries: [], auditOrders: [] });
assert.deepEqual(empty.stats, { orders: 0, products: 0, detailedOrders: 0 });
assert.ok(zipEntries(Buffer.from(empty.bytes)).get("xl/worksheets/sheet1.xml").includes("ORDER BRIDGE"));
console.log("Detailed XLSX export tests passed.");