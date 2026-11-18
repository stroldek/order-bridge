(() => {
  "use strict";

  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const encoder = new TextEncoder();

  const S = value => ({ value: value == null ? "" : String(value), kind: "text" });
  const N = value => ({ value: value == null || value === "" ? null : Number(value), kind: "number" });
  const M = value => ({ value: value == null || value === "" ? null : Number(value), kind: "money" });
  const D = value => ({ value, kind: "date" });
  const B = value => ({ value: Boolean(value), kind: "boolean" });

  function cleanText(value) {
    if (value == null) return "";
    const source = typeof value === "object" ? JSON.stringify(value) : String(value);
    return source.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  function xmlEscape(value) {
    return cleanText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function dateSerial(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const localAsUtc = Date.UTC(
      date.getFullYear(), date.getMonth(), date.getDate(),
      date.getHours(), date.getMinutes(), date.getSeconds()
    );
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
        ...previous,
        ...item,
        products: Array.isArray(item.products) && item.products.length
          ? item.products
          : (Array.isArray(previous.products) ? previous.products : [])
      });
    }
    return [...merged.values()].sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }

  function orderRows(orders) {
    const header = [
      "Номер замовлення", "ID замовлення", "Дата створення", "Тип",
      "Статус", "Статус оплати", "Тип оплати", "Дата оплати",
      "Тип доставки", "Кількість позицій", "Загальна кількість",
      "Сума замовлення, грн", "Знижка, грн", "Доставка, грн",
      "Передплата, грн", "Сплачено, грн", "Залишок, грн",
      "Деталі завантажені", "Дата отримання деталей", "Кількість підзамовлень"
    ].map(S);

    const rows = [header];
    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      const detailsLoaded = Boolean(order.detailsParsedAt);
      rows.push([
        S(order.number ?? order.id),
        S(order.id),
        D(order.createdAt),
        S(order.isNew === true ? "Нове" : "Історія"),
        S(order.status),
        S(order.paymentStatus),
        S(order.paymentType),
        D(order.paymentDate),
        S(order.deliveryType),
        N(order.itemCount ?? products.length),
        N(order.totalQuantity),
        M(order.totalPrice),
        M(order.totalDiscount),
        M(order.deliveryPrice),
        M(order.amountPrepaid),
        M(order.paidAmount),
        M(order.paymentBalance),
        S(detailsLoaded ? "Так" : "Ні"),
        D(order.detailsParsedAt),
        N(Array.isArray(order.subOrders) ? order.subOrders.length : 0)
      ]);
    }
    return rows;
  }

  function productRows(orders) {
    const rows = [[
      "Номер замовлення", "ID замовлення", "Дата замовлення", "Тип замовлення",
      "Статус замовлення", "SKU", "Зовнішній ID товару", "ID товару GOST",
      "Назва товару", "Категорія", "Кількість", "Одиниця",
      "Ціна, грн", "Ціна зі знижкою, грн", "Початкова ціна, грн",
      "Сума позиції, грн", "ID підзамовлення", "Під замовлення",
      "Активний товар"
    ].map(S)];

    for (const order of orders) {
      const products = Array.isArray(order.products) ? order.products : [];
      for (const product of products) {
        rows.push([
          S(order.number ?? order.id),
          S(order.id),
          D(order.createdAt),
          S(order.isNew === true ? "Нове" : "Історія"),
          S(order.status),
          S(product.sku),
          S(product.externalId),
          S(product.id),
          S(product.name),
          S(product.category),
          N(product.quantity),
          S(product.unitCode),
          M(product.price),
          M(product.discountPrice),
          M(product.originalPrice),
          M(product.totalPrice),
          S(product.subOrderId),
          S(product.isCustomOrder == null ? "" : (product.isCustomOrder ? "Так" : "Ні")),
          S(product.active == null ? "" : (product.active ? "Так" : "Ні"))
        ]);
      }
    }
    return rows;
  }

  function cellXml(cell, reference) {
    if (!cell || cell.value == null || cell.value === "") return '<c r="' + reference + '"/>';
    if (cell.kind === "date") {
      const serial = dateSerial(cell.value);
      return serial == null ? '<c r="' + reference + '"/>' :
        '<c r="' + reference + '" s="2"><v>' + serial + '</v></c>';
    }
    if (cell.kind === "money") {
      const number = Number(cell.value);
      return Number.isFinite(number) ? '<c r="' + reference + '" s="3"><v>' + number + '</v></c>' :
        '<c r="' + reference + '"/>';
    }
    if (cell.kind === "number") {
      const number = Number(cell.value);
      return Number.isFinite(number) ? '<c r="' + reference + '" s="4"><v>' + number + '</v></c>' :
        '<c r="' + reference + '"/>';
    }
    if (cell.kind === "boolean") {
      return '<c r="' + reference + '" t="b"><v>' + (cell.value ? "1" : "0") + '</v></c>';
    }
    return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEscape(cell.value) + '</t></is></c>';
  }

  function worksheetXml(rows, widths) {
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const lastColumn = columnName(columnCount);
    const lastRow = Math.max(1, rows.length);
    const cols = widths.map((width, index) =>
      '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>'
    ).join("");

    const sheetRows = rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map((cell, cellIndex) =>
        cellXml(cell, columnName(cellIndex + 1) + rowNumber)
      ).join("");
      return '<row r="' + rowNumber + '">' +
        (rowIndex === 0 ? row.map((cell, cellIndex) =>
          '<c r="' + columnName(cellIndex + 1) + '1" s="1" t="inlineStr"><is><t>' +
          xmlEscape(cell.value) + '</t></is></c>'
        ).join("") : cells) +
        '</row>';
    }).join("");

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + lastColumn + lastRow + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + cols + '</cols><sheetData>' + sheetRows + '</sheetData>' +
      '<autoFilter ref="A1:' + lastColumn + lastRow + '"/>' +
      '</worksheet>';
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3">' +
      '<numFmt numFmtId="164" formatCode="#,##0.00 &quot;₴&quot;"/>' +
      '<numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/>' +
      '<numFmt numFmtId="166" formatCode="0.###"/>' +
      '</numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF355A43"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE0E7E1"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
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
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function write16(target, offset, value) {
    target[offset] = value & 0xFF;
    target[offset + 1] = (value >>> 8) & 0xFF;
  }
  function write32(target, offset, value) {
    target[offset] = value & 0xFF;
    target[offset + 1] = (value >>> 8) & 0xFF;
    target[offset + 2] = (value >>> 16) & 0xFF;
    target[offset + 3] = (value >>> 24) & 0xFF;
  }
  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function zipStore(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const checksum = crc32(data);

      const local = new Uint8Array(30 + name.length + data.length);
      write32(local, 0, 0x04034B50);
      write16(local, 4, 20);
      write16(local, 6, 0);
      write16(local, 8, 0);
      write16(local, 10, 0);
      write16(local, 12, 33);
      write32(local, 14, checksum);
      write32(local, 18, data.length);
      write32(local, 22, data.length);
      write16(local, 26, name.length);
      write16(local, 28, 0);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      localParts.push(local);

      const central = new Uint8Array(46 + name.length);
      write32(central, 0, 0x02014B50);
      write16(central, 4, 20);
      write16(central, 6, 20);
      write16(central, 8, 0);
      write16(central, 10, 0);
      write16(central, 12, 0);
      write16(central, 14, 33);
      write32(central, 16, checksum);
      write32(central, 20, data.length);
      write32(central, 24, data.length);
      write16(central, 28, name.length);
      write16(central, 30, 0);
      write16(central, 32, 0);
      write16(central, 34, 0);
      write16(central, 36, 0);
      write32(central, 38, 0);
      write32(central, 42, localOffset);
      central.set(name, 46);
      centralParts.push(central);

      localOffset += local.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = new Uint8Array(22);
    write32(end, 0, 0x06054B50);
    write16(end, 4, 0);
    write16(end, 6, 0);
    write16(end, 8, files.length);
    write16(end, 10, files.length);
    write32(end, 12, centralDirectory.length);
    write32(end, 16, localOffset);
    write16(end, 20, 0);
    return concatBytes([...localParts, centralDirectory, end]);
  }

  function buildWorkbook(snapshot) {
    const orders = mergeOrders(snapshot);
    const productsCount = orders.reduce((sum, order) =>
      sum + (Array.isArray(order.products) ? order.products.length : 0), 0);
    const detailsCount = orders.filter(order => order.detailsParsedAt).length;

    const ordersSheet = orderRows(orders);
    const productsSheet = productRows(orders);
    const timestamp = new Date().toISOString();

    const files = [
      {
        name: "[Content_Types].xml",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>'
      },
      {
        name: "_rels/.rels",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          '</Relationships>'
      },
      {
        name: "docProps/app.xml",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
          '<Application>Order Bridge</Application><TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Замовлення</vt:lpstr><vt:lpstr>Товари</vt:lpstr></vt:vector></TitlesOfParts>' +
          '</Properties>'
      },
      {
        name: "docProps/core.xml",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:creator>Order Bridge</dc:creator><cp:lastModifiedBy>Order Bridge</cp:lastModifiedBy>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:created>' +
          '<dcterms:modified xsi:type="dcterms:W3CDTF">' + timestamp + '</dcterms:modified>' +
          '</cp:coreProperties>'
      },
      {
        name: "xl/workbook.xml",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
          '<sheets><sheet name="Замовлення" sheetId="1" r:id="rId1"/><sheet name="Товари" sheetId="2" r:id="rId2"/></sheets></workbook>'
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      },
      { name: "xl/styles.xml", content: stylesXml() },
      {
        name: "xl/worksheets/sheet1.xml",
        content: worksheetXml(ordersSheet, [16, 18, 20, 12, 20, 20, 18, 20, 18, 14, 16, 18, 16, 17, 17, 16, 16, 17, 22, 18])
      },
      {
        name: "xl/worksheets/sheet2.xml",
        content: worksheetXml(productsSheet, [16, 18, 20, 12, 20, 16, 20, 18, 38, 24, 12, 12, 16, 20, 18, 18, 18, 16, 16])
      }
    ];

    return {
      bytes: zipStore(files),
      stats: {
        orders: orders.length,
        products: productsCount,
        detailedOrders: detailsCount
      }
    };
  }

  function download(snapshot) {
    const result = buildWorkbook(snapshot);
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    const filename = "OrderBridge_" + date.getFullYear() + "-" +
      pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "_" +
      pad(date.getHours()) + "-" + pad(date.getMinutes()) + ".xlsx";
    const blob = new Blob([result.bytes], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return result.stats;
  }

  const api = { buildWorkbook, download };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.OrderBridgeExcelExport = api;
})();