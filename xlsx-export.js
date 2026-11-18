(() => {
  "use strict";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const encoder = new TextEncoder();
  const cell = (value, kind = "text", style = null) => ({ value, kind, style });
  const S = (value, style = null) => cell(value == null ? "" : String(value), "text", style);
  const N = (value, style = null) => cell(value == null || value === "" ? null : Number(value), "number", style);
  const M = (value, style = null) => cell(value == null || value === "" ? null : Number(value), "money", style);
  const D = value => cell(value, "date", null);
  const blank = style => cell(null, "blank", style);

  function cleanText(value) {
    if (value == null) return "";
    const source = typeof value === "object" ? JSON.stringify(value) : String(value);
    return source.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  function xmlEscape(value) {
    return cleanText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function displayDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return cleanText(value);
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }
  function isoDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? cleanText(value) : date.toISOString();
  }
  function dateSerial(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const localAsUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
      date.getHours(), date.getMinutes(), date.getSeconds());
    return localAsUtc / 86400000 + 25569;
  }
  function columnName(number) {
    let result = "";
    let value = number;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }
  function mergeOrders(snapshot) {
    const merged = new Map();
    for (const item of snapshot?.auditOrders || []) {
      if (item?.id == null) continue;
      merged.set(String(item.id), { ...item });
    }
    for (const item of snapshot?.summaries || []) {
      if (item?.id == null) continue;
      const key = String(item.id);
      const previous = merged.get(key) || {};
      merged.set(key, {
        ...previous, ...item,
        products: Array.isArray(item.products) && item.products.length
          ? item.products : (Array.isArray(previous.products) ? previous.products : []),
        subOrders: Array.isArray(item.subOrders) && item.subOrders.length
          ? item.subOrders : (Array.isArray(previous.subOrders) ? previous.subOrders : [])
      });
    }
    return [...merged.values()].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }
  function productTitle(product) {
    return cleanText(product?.name || "Товар без назви");
  }

  function buildOrderCards(orders, generatedAt) {
    const rows = [];
    const merges = [];
    const addRow = (cells, height = 20) => {
      rows.push({ cells, height });
      return rows.length;
    };
    const addMerged = (cells, start, end, value, style) => {
      cells[start - 1] = value && typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, "kind")
        ? { ...value, style: value.style ?? style }
        : S(value, style);
      for (let col = start + 1; col <= end; col++) cells[col - 1] = blank(style);
      merges.push(columnName(start) + rows.length + ":" + columnName(end) + rows.length);
    };

    let cells = Array(9).fill(null).map(() => blank(1));
    addRow(cells, 34);
    addMerged(cells, 1, 9, "ORDER BRIDGE  |  ДЕТАЛІЗОВАНИЙ ЕКСПОРТ ЗАМОВЛЕНЬ", 1);

    cells = Array(9).fill(null).map(() => blank(2));
    addRow(cells, 24);
    addMerged(cells, 1, 9,
      "Сформовано: " + displayDate(generatedAt) +
      "  ·  У книзі немає телефонів, адрес та коментарів покупців", 2);

    const detailsCount = orders.filter(order => order.detailsParsedAt).length;
    const productsCount = orders.reduce((sum, order) => sum + (order.products?.length || 0), 0);
    cells = Array(9).fill(null).map(() => blank(3));
    addRow(cells, 25);
    addMerged(cells, 1, 2, "ЗАМОВЛЕНЬ: " + orders.length, 3);
    cells[2] = S("З ДЕТАЛЯМИ: " + detailsCount, 3);
    cells[3] = blank(3);
    merges.push("C4:D4");
    cells[4] = S("ТОВАРНИХ ПОЗИЦІЙ: " + productsCount, 3);
    cells[5] = blank(3);
    merges.push("E4:F4");
    cells[6] = S("НОВИХ: " + orders.filter(order => order.isNew === true).length, 3);
    cells[7] = blank(3);
    cells[8] = blank(3);
    merges.push("G4:I4");
    addRow(Array(9).fill(null).map(() => blank(0)), 10);

    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      const subOrders = Array.isArray(order.subOrders) ? order.subOrders : [];
      const number = order.number ?? order.id ?? "—";
      const orderType = order.isNew === true ? "НОВЕ ЗАМОВЛЕННЯ" : "ІСТОРИЧНЕ ЗАМОВЛЕННЯ";

      cells = Array(9).fill(null).map(() => blank(1));
      addRow(cells, 30);
      addMerged(cells, 1, 9, "ЗАМОВЛЕННЯ №" + number + "   ·   " + orderType,
        order.isNew === true ? 15 : 1);

      cells = Array(9).fill(null).map(() => blank(2));
      addRow(cells, 23);
      addMerged(cells, 1, 9, "ID: " + (order.id ?? "—") +
        "   ·   Створено: " + displayDate(order.createdAt) +
        "   ·   Деталізація: " + (order.detailsParsedAt ? "завантажена" : "ще не отримана"), 2);

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 23);
      addMerged(cells, 1, 2, "СТАТУС ЗАМОВЛЕННЯ", 10);
      addMerged(cells, 3, 4, order.status || "—", 13);
      addMerged(cells, 5, 6, "СТАТУС ОПЛАТИ", 10);
      addMerged(cells, 7, 9, order.paymentStatus || "—", 13);

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 23);
      addMerged(cells, 1, 2, "ТИП ОПЛАТИ", 10);
      addMerged(cells, 3, 4, order.paymentType || "—", 13);
      addMerged(cells, 5, 6, "ДАТА ОПЛАТИ", 10);
      addMerged(cells, 7, 9, displayDate(order.paymentDate), 13);

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 23);
      addMerged(cells, 1, 2, "ДОСТАВКА", 10);
      addMerged(cells, 3, 4, order.deliveryType || "—", 13);
      addMerged(cells, 5, 6, "ПІДЗАМОВЛЕНЬ", 10);
      addMerged(cells, 7, 9, String(subOrders.length), 13);

      cells = Array(9).fill(null).map(() => blank(3));
      addRow(cells, 22);
      addMerged(cells, 1, 9, "ТОВАРНІ ПОЗИЦІЇ  ·  " + products.length, 3);
      addRow(["№", "ТОВАР", "КАТЕГОРІЯ", "SKU / ID", "КІЛЬКІСТЬ",
        "ЦІНА", "ЦІНА ЗІ ЗНИЖКОЮ", "ЕКОНОМІЯ / ОД.", "СУМА"].map(value => S(value, 4)), 30);

      if (products.length) {
        products.forEach((product, index) => {
          const discountPrice = product.discountPrice ?? product.originalPrice ?? product.price;
          const saving = Number(product.price || 0) - Number(discountPrice || 0);
          const itemId = [
            product.sku ? "SKU: " + product.sku : "SKU: —",
            product.externalId ? "External ID: " + product.externalId : "ID: " + (product.id ?? "—")
          ].join("\n");
          const rowStyle = index % 2 === 0 ? 5 : 17;
          addRow([
            N(index + 1, 6), S(productTitle(product), rowStyle),
            S(product.category || "—", rowStyle), S(itemId, rowStyle),
            N(product.quantity, 6), M(product.price, 7), M(discountPrice, 7),
            M(saving, 7), M(product.totalPrice, 7)
          ], 34);
        });
      } else {
        cells = Array(9).fill(null).map(() => blank(9));
        addRow(cells, 28);
        addMerged(cells, 1, 9, order.detailsParsedAt
          ? "У відповіді GOST немає товарних позицій для цього замовлення."
          : "Деталізацію ще не завантажено. Після отримання даних товари з’являться в цьому блоці.", 9);
      }

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 24);
      addMerged(cells, 1, 7, "Позицій: " + (order.itemCount ?? products.length) +
        "   ·   Загальна кількість: " +
        (order.totalQuantity ?? products.reduce((sum, p) => sum + Number(p.quantity || 0), 0)), 9);
      cells[7] = S("СУМА ЗАМОВЛЕННЯ", 10);
      cells[8] = M(order.totalPrice, 11);

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 22);
      addMerged(cells, 1, 7, "Знижка: " + (Number(order.totalDiscount) || 0).toLocaleString("uk-UA") +
        " ₴   ·   Доставка: " + (Number(order.deliveryPrice) || 0).toLocaleString("uk-UA") + " ₴", 9);
      cells[7] = S("ПЕРЕДПЛАТА", 10);
      cells[8] = M(order.amountPrepaid, 11);

      cells = Array(9).fill(null).map(() => blank(0));
      addRow(cells, 22);
      addMerged(cells, 1, 7, "Оплата: " + (Number(order.paidAmount) || 0).toLocaleString("uk-UA") +
        " ₴   ·   Залишок: " + (Number(order.paymentBalance) || 0).toLocaleString("uk-UA") + " ₴", 9);
      cells[7] = S("СПЛАЧЕНО", 10);
      cells[8] = M(order.paidAmount, 11);

      if (subOrders.length) {
        cells = Array(9).fill(null).map(() => blank(3));
        addRow(cells, 22);
        addMerged(cells, 1, 9, "ПІДЗАМОВЛЕННЯ", 3);
        addRow([
          S("ID", 4), S("НОМЕР", 4), S("СТАТУС", 4), S("ПОЗИЦІЙ", 4),
          blank(4), blank(4), blank(4), blank(4), blank(4)
        ], 24);
        for (const subOrder of subOrders) {
          addRow([
            S(subOrder.id, 5), S(subOrder.number, 5), S(subOrder.status, 5),
            N(subOrder.productCount, 6), blank(5), blank(5), blank(5), blank(5), blank(5)
          ], 21);
        }
      }
      addRow(Array(9).fill(null).map(() => blank(0)), 14);
    }
    return { rows, merges, widths: [7, 37, 20, 23, 13, 16, 19, 18, 18], freezeRows: 2 };
  }

  function orderRows(orders) {
    const rows = [[
      "Номер замовлення", "ID замовлення", "Дата створення", "Тип", "Статус",
      "Статус оплати", "Тип оплати", "Дата оплати", "Тип доставки",
      "Кількість позицій", "Загальна кількість", "Сума замовлення, грн",
      "Знижка, грн", "Доставка, грн", "Передплата, грн", "Сплачено, грн",
      "Залишок, грн", "Деталі завантажені", "Дата отримання деталей", "Кількість підзамовлень"
    ].map(value => S(value, 4))];
    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      rows.push([
        S(order.number ?? order.id), S(order.id), S(isoDate(order.createdAt)),
        S(order.isNew === true ? "Нове" : "Історія"), S(order.status),
        S(order.paymentStatus), S(order.paymentType), S(isoDate(order.paymentDate)),
        S(order.deliveryType), N(order.itemCount ?? products.length),
        N(order.totalQuantity), M(order.totalPrice), M(order.totalDiscount),
        M(order.deliveryPrice), M(order.amountPrepaid), M(order.paidAmount),
        M(order.paymentBalance), S(order.detailsParsedAt ? "Так" : "Ні"),
        S(isoDate(order.detailsParsedAt)), N(Array.isArray(order.subOrders) ? order.subOrders.length : 0)
      ]);
    }
    return rows;
  }

  function productRows(orders) {
    const rows = [[
      "Номер замовлення", "ID замовлення", "Дата замовлення", "Тип замовлення",
      "Статус замовлення", "SKU", "Зовнішній ID товару", "ID товару GOST",
      "Назва товару", "Категорія", "Кількість", "Одиниця", "Ціна, грн",
      "Ціна зі знижкою, грн", "Початкова ціна, грн", "Сума позиції, грн",
      "ID підзамовлення", "Під замовлення", "Активний товар"
    ].map(value => S(value, 4))];
    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      for (const product of products) {
        rows.push([
          S(order.number ?? order.id), S(order.id), S(isoDate(order.createdAt)),
          S(order.isNew === true ? "Нове" : "Історія"), S(order.status),
          S(product.sku), S(product.externalId), S(product.id), S(product.name),
          S(product.category), N(product.quantity), S(product.unitCode),
          M(product.price), M(product.discountPrice), M(product.originalPrice),
          M(product.totalPrice), S(product.subOrderId),
          S(product.isCustomOrder == null ? "" : (product.isCustomOrder ? "Так" : "Ні")),
          S(product.active == null ? "" : (product.active ? "Так" : "Ні"))
        ]);
      }
    }
    return rows;
  }

  function cellXml(cellValue, reference) {
    const cellData = cellValue || blank(0);
    const styleAttr = cellData.style == null ? "" : ' s="' + cellData.style + '"';
    if (cellData.value == null || cellData.value === "") return '<c r="' + reference + '"' + styleAttr + '/>';
    if (cellData.kind === "date") {
      const serial = dateSerial(cellData.value);
      return serial == null ? '<c r="' + reference + '"' + styleAttr + '/>' :
        '<c r="' + reference + '" s="8"><v>' + serial + '</v></c>';
    }
    if (cellData.kind === "money") {
      const number = Number(cellData.value);
      return Number.isFinite(number) ? '<c r="' + reference + '" s="7"><v>' + number + '</v></c>' :
        '<c r="' + reference + '"' + styleAttr + '/>';
    }
    if (cellData.kind === "number") {
      const number = Number(cellData.value);
      return Number.isFinite(number) ? '<c r="' + reference + '" s="6"><v>' + number + '</v></c>' :
        '<c r="' + reference + '"' + styleAttr + '/>';
    }
    return '<c r="' + reference + '" t="inlineStr"' + styleAttr + '><is><t xml:space="preserve">' +
      xmlEscape(cellData.value) + '</t></is></c>';
  }

  function worksheetXml(sheet) {
    const rows = sheet.rows || [];
    const columnCount = rows.reduce((max, row) => Math.max(max, row.cells?.length || row.length || 0), 0);
    const lastColumn = columnName(columnCount);
    const lastRow = Math.max(1, rows.length);
    const cols = (sheet.widths || []).map((width, index) =>
      '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>'
    ).join("");
    const sheetRows = rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = Array.isArray(row) ? row : row.cells;
      const height = Array.isArray(row) ? 21 : (row.height || 21);
      const rowXml = cells.map((cellValue, cellIndex) =>
        cellXml(cellValue, columnName(cellIndex + 1) + rowNumber)
      ).join("");
      return '<row r="' + rowNumber + '" ht="' + height + '" customHeight="1">' + rowXml + '</row>';
    }).join("");
    const mergeXml = sheet.merges?.length
      ? '<mergeCells count="' + sheet.merges.length + '">' +
        sheet.merges.map(ref => '<mergeCell ref="' + ref + '"/>').join("") + '</mergeCells>'
      : "";
    const filterXml = sheet.autoFilter ? '<autoFilter ref="A1:' + lastColumn + lastRow + '"/>' : "";
    const freezeRows = sheet.freezeRows || 0;
    const viewXml = freezeRows
      ? '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="' + freezeRows +
        '" topLeftCell="A' + (freezeRows + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + lastColumn + lastRow + '"/>' + viewXml +
      '<sheetFormatPr defaultRowHeight="21"/><cols>' + cols + '</cols>' +
      '<sheetData>' + sheetRows + '</sheetData>' + filterXml + mergeXml +
      '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
      '</worksheet>';
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₴&quot;"/>' +
      '<numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.###"/></numFmts>' +
      '<fonts count="5"><font><sz val="10"/><color rgb="FF26352B"/><name val="Aptos"/></font>' +
      '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>' +
      '<font><b/><sz val="9"/><color rgb="FF365643"/><name val="Aptos"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FF264A33"/><name val="Aptos"/></font></fonts>' +
      '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF284735"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1EB"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDCEADF"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7FAF7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE5DE"/></bottom><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFDCE5DE"/></left><right style="thin"><color rgb="FFDCE5DE"/></right>' +
      '<top style="thin"><color rgb="FFDCE5DE"/></top><bottom style="thin"><color rgb="FFDCE5DE"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="18">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"><alignment vertical="center" horizontal="right"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="5" borderId="2" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function write16(target, offset, value) {
    target[offset] = value & 0xFF; target[offset + 1] = (value >>> 8) & 0xFF;
  }
  function write32(target, offset, value) {
    target[offset] = value & 0xFF; target[offset + 1] = (value >>> 8) & 0xFF;
    target[offset + 2] = (value >>> 16) & 0xFF; target[offset + 3] = (value >>> 24) & 0xFF;
  }
  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
  }
  function zipStore(files) {
    const localParts = [], centralParts = [];
    let localOffset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = encoder.encode(file.content), checksum = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      write32(local, 0, 0x04034B50); write16(local, 4, 20); write16(local, 6, 0x0800);
      write16(local, 8, 0); write16(local, 10, 0); write16(local, 12, 33);
      write32(local, 14, checksum); write32(local, 18, data.length); write32(local, 22, data.length);
      write16(local, 26, name.length); write16(local, 28, 0); local.set(name, 30); local.set(data, 30 + name.length);
      localParts.push(local);
      const central = new Uint8Array(46 + name.length);
      write32(central, 0, 0x02014B50); write16(central, 4, 20); write16(central, 6, 20);
      write16(central, 8, 0x0800); write16(central, 10, 0); write16(central, 12, 0); write16(central, 14, 33);
      write32(central, 16, checksum); write32(central, 20, data.length); write32(central, 24, data.length);
      write16(central, 28, name.length); write16(central, 30, 0); write16(central, 32, 0);
      write16(central, 34, 0); write16(central, 36, 0); write32(central, 38, 0);
      write32(central, 42, localOffset); central.set(name, 46); centralParts.push(central);
      localOffset += local.length;
    }
    const centralDirectory = concatBytes(centralParts), end = new Uint8Array(22);
    write32(end, 0, 0x06054B50); write16(end, 4, 0); write16(end, 6, 0);
    write16(end, 8, files.length); write16(end, 10, files.length);
    write32(end, 12, centralDirectory.length); write32(end, 16, localOffset); write16(end, 20, 0);
    return concatBytes([...localParts, centralDirectory, end]);
  }

  function buildWorkbook(snapshot) {
    const orders = mergeOrders(snapshot);
    const productsCount = orders.reduce((sum, order) => sum + (order.products?.length || 0), 0);
    const detailsCount = orders.filter(order => order.detailsParsedAt).length;
    const timestamp = new Date().toISOString();
    const cards = buildOrderCards(orders, timestamp);
    const register = orderRows(orders);
    const products = productRows(orders);
    const files = [
      { name: "[Content_Types].xml", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>' },
      { name: "_rels/.rels", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>' },
      { name: "docProps/app.xml", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Order Bridge</Application><TitlesOfParts><vt:vector size="3" baseType="lpstr">' +
        '<vt:lpstr>Картки замовлень</vt:lpstr><vt:lpstr>Реєстр</vt:lpstr><vt:lpstr>Товарні позиції</vt:lpstr>' +
        '</vt:vector></TitlesOfParts></Properties>' },
      { name: "docProps/core.xml", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:creator>Order Bridge</dc:creator><cp:lastModifiedBy>Order Bridge</cp:lastModifiedBy>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:modified></cp:coreProperties>' },
      { name: "xl/workbook.xml", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
        '<sheets><sheet name="Картки замовлень" sheetId="1" r:id="rId1"/><sheet name="Реєстр" sheetId="2" r:id="rId2"/><sheet name="Товарні позиції" sheetId="3" r:id="rId3"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: "xl/styles.xml", content: stylesXml() },
      { name: "xl/worksheets/sheet1.xml", content: worksheetXml(cards) },
      { name: "xl/worksheets/sheet2.xml", content: worksheetXml({
        rows: register, widths: [17,18,23,12,22,22,18,23,18,15,16,19,16,16,17,16,16,17,24,18],
        autoFilter: true, freezeRows: 1
      }) },
      { name: "xl/worksheets/sheet3.xml", content: worksheetXml({
        rows: products, widths: [17,18,23,12,22,17,21,18,38,22,13,12,16,19,18,18,18,16,16],
        autoFilter: true, freezeRows: 1
      }) }
    ];
    return { bytes: zipStore(files), stats: { orders: orders.length, products: productsCount, detailedOrders: detailsCount } };
  }

  function download(snapshot) {
    const result = buildWorkbook(snapshot);
    const date = new Date(), pad = value => String(value).padStart(2, "0");
    const filename = "OrderBridge_" + date.getFullYear() + "-" +
      pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "_" +
      pad(date.getHours()) + "-" + pad(date.getMinutes()) + ".xlsx";
    const blob = new Blob([result.bytes], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.style.display = "none";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return result.stats;
  }
  const api = { buildWorkbook, download };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.OrderBridgeExcelExport = api;
})();