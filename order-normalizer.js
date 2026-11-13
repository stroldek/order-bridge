(() => {
  "use strict";
  function number(value) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function listSummary(item) {
    return {
      id: String(item?.id ?? ""),
      number: item?.number ?? null,
      totalPrice: number(item?.total_price ?? item?.totalPrice),
      paymentDate: item?.payment_date ?? item?.paymentDate ?? null,
      createdAt: item?.created_at ?? item?.createdAt ?? null,
      status: item?.status ?? null,
      paymentStatus: item?.payment_status ?? item?.paymentStatus ?? null,
      paymentType: item?.payment_type ?? item?.paymentType ?? null
    };
  }
  function normalizeOrder(order) {
    if (!order || typeof order !== "object" || !order.id) {
      throw new Error("Некоректна структура замовлення: відсутній ID.");
    }
    const subOrders = Array.isArray(order.sub_orders) ? order.sub_orders : [];
    const products = [];
    for (const subOrder of subOrders) {
      const lines = Array.isArray(subOrder?.products) ? subOrder.products : [];
      for (const product of lines) {
        products.push({
          id: product?.id ?? null,
          externalId: product?.external_id ?? null,
          sku: product?.sku ?? null,
          name: product?.name ?? "Без назви",
          slug: product?.slug ?? null,
          category: product?.category ?? null,
          categoryId: product?.category_id ?? null,
          quantity: number(product?.quantity),
          unitCode: product?.unit_code ?? product?.unit_code_snapshot ?? null,
          packageQuantity: number(product?.package_quantity_snapshot),
          price: number(product?.price),
          discountPrice: product?.discount_price === null ? null : number(product?.discount_price),
          originalPrice: number(product?.original_price),
          totalPrice: number(product?.total_price),
          discount: number(product?.discount),
          isCustomOrder: Boolean(product?.is_custom_order),
          media: product?.media ?? null,
          active: product?.active !== false
        });
      }
    }
    const totalQuantity = products.reduce((sum, product) => sum + product.quantity, 0);
    const delivery = order.delivery ?? {};
    const payments = order.payments_info ?? {};
    return {
      id: String(order.id),
      number: order.number ?? null,
      status: order.status ?? null,
      paymentStatus: order.payment_status ?? null,
      paymentType: order.payment_type ?? null,
      paymentDate: order.payment_date ?? null,
      createdAt: order.created_at ?? null,
      updatedAt: order.updated_at ?? null,
      totalPrice: number(order.total_price),
      totalDiscount: number(order.total_discount),
      deliveryPrice: number(order.delivery_price),
      amountPrepaid: number(order.amount_prepaid),
      paidAmount: number(payments.paidAmount),
      paymentBalance: number(payments.paymentBalance),
      delivery: {
        type: delivery.delivery ?? null,
        settlement: delivery.settlement ?? null,
        settlementLabel: delivery.settlement_label ?? null,
        address: delivery.address ?? null,
        department: delivery.delivery_department ?? null,
        comment: delivery.comment ?? null
      },
      subOrderCount: subOrders.length,
      products,
      productLineCount: products.length,
      totalQuantity
    };
  }
  function todayRevenue(summaries, now = new Date()) {
    const zone = "Europe/Kyiv";
    const dateKey = value => {
      if (!value) return null;
      const raw = value instanceof Date ? "" : String(value).trim();
      // Date-only values are already calendar dates; do not reinterpret them as UTC.
      const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (dateOnly) return dateOnly[1];
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return values.year + "-" + values.month + "-" + values.day;
    };
    const today = dateKey(now);
    const uniqueOrders = new Map();
    let anonymousIndex = 0;
    for (const item of summaries || []) {
      if (!item) continue;
      const key = item.id === null || item.id === undefined || item.id === ""
        ? "anonymous-" + (++anonymousIndex)
        : String(item.id);
      uniqueOrders.set(key, item);
    }
    let total = 0;
    for (const item of uniqueOrders.values()) {
      if (item.paymentDate && dateKey(item.paymentDate) === today) {
        total += number(item.totalPrice ?? item.total_price);
      }
    }
    return total;
  }
  self.OrderBridgeNormalizer = { number, listSummary, normalizeOrder, todayRevenue };
})();