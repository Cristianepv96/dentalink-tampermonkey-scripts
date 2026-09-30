const CONFIG = {
  TOKEN: "13487561",
  HEADER_ROW: 5,
  LEGACY_YEAR: 2026,
  COLUMNS: [
    "Fecha",
    "Sede",
    "Paciente",
    "ID plan",
    "Titulo plan",
    "Valor"
  ]
};

function doPost(event) {
  try {
    const body = parseJson_(event);
    return saveRecord_(body);
  } catch (error) {
    return error_(error);
  }
}

function doGet(event) {
  try {
    const params = event?.parameter || {};
    if (!params.record) {
      return json_({
        ok: true,
        service: "registro-diario",
        columns: CONFIG.COLUMNS
      });
    }
    return saveRecord_({
      token: params.token,
      record: JSON.parse(params.record)
    });
  } catch (error) {
    return error_(error);
  }
}

function saveRecord_(body) {
  assertAuthorized_(body);
  const record = normalizeRecord_(body.record || body);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_(record);
    ensureHeaders_(sheet);

    const key = buildKey_(record);
    const duplicateRow = findRowByKey_(sheet, key);
    if (duplicateRow) {
      return json_({
        ok: true,
        duplicate: true,
        sheet: sheet.getName(),
        row: duplicateRow,
        key,
        record: rowToRecord_(sheet.getRange(duplicateRow, 1, 1, CONFIG.COLUMNS.length).getDisplayValues()[0])
      });
    }

    const row = recordToRow_(record);
    const insertedRow = findFirstEmptyRow_(sheet);
    if (insertedRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), insertedRow - sheet.getMaxRows());
    }
    const target = sheet.getRange(insertedRow, 1, 1, CONFIG.COLUMNS.length);
    formatRecordRow_(target);
    target.setValues([row]);
    ensureDailyTotal_(sheet, insertedRow);
    SpreadsheetApp.flush();
    const saved = target.getDisplayValues()[0];
    return json_({
      ok: true,
      duplicate: false,
      sheet: sheet.getName(),
      row: insertedRow,
      key,
      record: rowToRecord_(saved)
    });
  } finally {
    lock.releaseLock();
  }
}

function error_(error) {
  return json_({
    ok: false,
    error: error.message || String(error)
  });
}

function assertAuthorized_(body) {
  const sent = String(body?.token || "");
  if (sent !== CONFIG.TOKEN) {
    throw new Error("Token no autorizado.");
  }
}

function parseJson_(event) {
  const raw = event?.postData?.contents || "{}";
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error("JSON invalido.");
  }
}

function getSheet_(record) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = sheetNameFromDate_(record?.fecha);
  if (!sheetName) {
    throw new Error("No se pudo determinar el mes a partir de la fecha del registro.");
  }
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    ensureHeaders_(sheet);
    formatMonthlySheet_(sheet);
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  const range = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, CONFIG.COLUMNS.length);
  const current = range.getValues()[0];
  const hasAnyHeader = current.some((value) => String(value || "").trim());
  if (!hasAnyHeader) {
    range.setValues([CONFIG.COLUMNS]);
  } else if (current.some((value, index) => text_(value).toLowerCase() !== CONFIG.COLUMNS[index].toLowerCase())) {
    throw new Error("La hoja tiene una estructura diferente al registro diario. No se escribieron datos.");
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Registro diario")
    .addItem("Uniformar diseño mensual", "uniformarRegistroMensual")
    .addItem("Preparar mes actual", "prepararMesActual")
    .addToUi();
}

function uniformarRegistroMensual() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const skipped = [];
    spreadsheet.getSheets().forEach((sheet) => {
      if (!/^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)( \d{4})?$/.test(sheet.getName())) return;
      const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, CONFIG.COLUMNS.length).getDisplayValues()[0];
      if (!headers.every((value, index) => text_(value).toLowerCase() === CONFIG.COLUMNS[index].toLowerCase())) {
        skipped.push(sheet.getName());
        return;
      }
      formatMonthlySheet_(sheet);
    });
    spreadsheet.toast(skipped.length
      ? `Diseño actualizado. Estructura histórica conservada: ${skipped.join(", ")}.`
      : "Diseño actualizado; los registros existentes se conservaron.", "Registro diario", 8);
  } finally {
    lock.releaseLock();
  }
}

function prepararMesActual() {
  const date = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_({ fecha: date });
    ensureHeaders_(sheet);
    formatMonthlySheet_(sheet);
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } finally {
    lock.releaseLock();
  }
}

function formatRecordRow_(range) {
  range.setFontFamily("Arial").setFontSize(10).setFontColor("#202124")
    .setFontWeight("normal").setBackground("#ffffff").setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  range.getCell(1, 1).setNumberFormat("dd/MM/yyyy");
  range.getCell(1, 4).setNumberFormat("0");
  range.getCell(1, 6).setNumberFormat("[$$]#,##0");
  range.getCell(1, 3).setWrap(true);
  range.getCell(1, 5).setWrap(true);
}

function monthlySummary_(sheet) {
  const sep = /^(es|de|fr|it|pt|nl|pl|ru)/i.test(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale()) ? ";" : ",";
  const formula = (value) => value.replace(/,/g, sep);
  const a = "A6:A", b = "B6:B", c = "C6:C", d = "D6:D", f = "F6:F";
  const key = `${a}&${b}&${c}&${d}`;
  const alreadyNew = String(sheet.getRange("H1").getValue()).startsWith("Resumen ·");
  const previousInput = sheet.getRange(alreadyNew ? "I7" : "I5");
  const remaining = previousInput.getFormula() || previousInput.getValue() || 0;
  return [
    [`Resumen · ${sheet.getName()}`, ""],
    ["Valor registrado (único)", formula(`=IFERROR(SUMPRODUCT((${a}<>"")*${f}*(MATCH(${key},${key},0)=ROW(${a})-ROW(A6)+1)),0)`)],
    ["Registros", formula(`=COUNTA(${d})`)],
    ["Días con registros", formula(`=IFERROR(COUNTUNIQUE(FILTER(${a},${a}<>"")),0)`)],
    ["Promedio por día", formula("=IFERROR(I2/I4,0)")],
    ["Registros repetidos", formula(`=IFERROR(COUNTA(${d})-COUNTUNIQUE(FILTER(${key},${d}<>"")),0)`)],
    ["Jornadas restantes", remaining],
    ["Proyección orientativa", "=I2+I5*I7"]
  ];
}

function dailyTotalFormula_(row, bottom, locale) {
  const sep = /^(es|de|fr|it|pt|nl|pl|ru)/i.test(locale) ? ";" : ",";
  const a = "$A$6:$A", b = "$B$6:$B", c = "$C$6:$C", d = "$D$6:$D", f = "$F$6:$F";
  const key = `${a}&${b}&${c}&${d}`;
  return `=IF($A${row}="","",IF(COUNTIF($A$6:$A${row},$A${row})=1,SUMPRODUCT((${a}=$A${row})*${f}*(MATCH(${key},${key},0)=ROW(${a})-ROW($A$6)+1)),""))`.replace(/,/g, sep);
}

function ensureDailyTotal_(sheet, row) {
  const target = sheet.getRange(row, 7);
  if ((target.getValue() === "" && !target.getFormula()) || isManagedDailyFormula_(target.getFormula())) {
    target.setFormula(dailyTotalFormula_(row, sheet.getMaxRows(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale()));
  }
  target.setNumberFormat("[$$]#,##0");
}

function isManagedDailyFormula_(value) {
  return /^=IF\(\$A\d+=""/i.test(value || "") && /SUMPRODUCT\(/i.test(value) && /MATCH\(/i.test(value);
}

function ensureDailyTotals_(sheet) {
  const last = sheet.getLastRow();
  if (last < 6) return;
  const range = sheet.getRange(6, 7, last - 5, 1);
  const values = range.getValues();
  const formulas = range.getFormulas();
  if (formulas.some((row) => /ARRAYFORMULA|\bMAP\s*\(/i.test(row[0]))) return;
  const locale = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale();
  let start = -1;
  for (let index = 0; index <= values.length; index += 1) {
    const empty = index < values.length && ((values[index][0] === "" && !formulas[index][0]) || isManagedDailyFormula_(formulas[index][0]));
    if (empty && start < 0) start = index;
    if (!empty && start >= 0) {
      const fill = Array.from({ length: index - start }, (_, offset) => [dailyTotalFormula_(start + offset + 6, sheet.getMaxRows(), locale)]);
      sheet.getRange(start + 6, 7, fill.length, 1).setFormulas(fill);
      start = -1;
    }
  }
}

function formatMonthlySheet_(sheet) {
  ensureHeaders_(sheet);
  const bottom = sheet.getMaxRows();
  const managed = sheet.getRange(1, 1, bottom, 9);
  managed.setFontFamily("Arial").setFontSize(10).setFontColor("#202124")
    .setFontWeight("normal").setBackground("#ffffff").setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(5, 1, 1, 7).setValues([[...CONFIG.COLUMNS, "Total del día"]])
    .setBackground("#f1f3f4").setFontWeight("bold").setWrap(true);
  sheet.getRange(6, 1, bottom - 5, 1).setNumberFormat("dd/MM/yyyy");
  sheet.getRange(6, 4, bottom - 5, 1).setNumberFormat("0");
  sheet.getRange(6, 6, bottom - 5, 2).setNumberFormat("[$$]#,##0");
  sheet.getRange(6, 3, bottom - 5, 1).setWrap(true);
  sheet.getRange(6, 5, bottom - 5, 1).setWrap(true);
  // Descombinar solo los totales derivados: A:F permanece intacto.
  sheet.getRange(6, 7, bottom - 5, 1).breakApart();
  sheet.getBandings().forEach((banding) => {
    const range = banding.getRange();
    if (range.getColumn() >= 1 && range.getLastColumn() <= 9) banding.remove();
  });
  sheet.setFrozenRows(5);
  const widths = [100, 160, 205, 80, 235, 120, 125, 205, 125];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setRowHeight(5, 34);
  sheet.getRange("H1:I8").setValues(monthlySummary_(sheet));
  sheet.getRange("H1:I1").setBackground("#f1f3f4").setFontWeight("bold");
  sheet.getRange("H2:H8").setFontWeight("bold").setWrap(true);
  sheet.getRange("I2").setNumberFormat("[$$]#,##0");
  sheet.getRange("I5").setNumberFormat("[$$]#,##0");
  sheet.getRange("I8").setNumberFormat("[$$]#,##0");
  ["I3", "I4", "I6", "I7"].forEach((cell) => sheet.getRange(cell).setNumberFormat("0"));
  sheet.getRange("I7").setNote("Jornadas restantes para la proyección. Conserve su previsión o escriba un número; 0 no presupone jornadas futuras.");
  sheet.getRange("H9").setValue("Valor del plan; no acredita pagos recibidos.").setWrap(true).setFontColor("#5f6368");
  if (!sheet.getFilter()) sheet.getRange(5, 1, bottom - 4, 7).createFilter();
  ensureDailyTotals_(sheet);
}

function normalizeRecord_(record) {
  const clean = {
    fecha: text_(record.fecha),
    sede: text_(record.sede),
    paciente: text_(record.paciente),
    planId: text_(record.planId),
    tituloPlan: text_(record.tituloPlan),
    valor: number_(record.valor),
    patientId: text_(record.patientId),
    appointmentId: text_(record.appointmentId),
    sourceUrl: text_(record.sourceUrl),
    copiedAt: text_(record.copiedAt)
  };

  const missing = [
    ["fecha", "fecha"],
    ["sede", "sede"],
    ["paciente", "paciente"],
    ["planId", "ID plan"],
    ["tituloPlan", "titulo"],
    ["valor", "valor"]
  ].filter(([key]) => !clean[key]).map(([, label]) => label);

  if (missing.length) {
    throw new Error(`Faltan campos requeridos: ${missing.join(", ")}.`);
  }

  const parts = parseRegistroDate_(clean.fecha);
  clean.fecha = `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;

  return clean;
}

function recordToRow_(record) {
  return [
    Utilities.parseDate(record.fecha, "America/Bogota", "dd/MM/yyyy"),
    record.sede,
    record.paciente,
    record.planId,
    record.tituloPlan,
    record.valor
  ];
}

function rowToRecord_(row) {
  return CONFIG.COLUMNS.reduce((result, column, index) => {
    result[column] = row[index];
    return result;
  }, {});
}

function buildKey_(record) {
  return [record.fecha, record.sede, record.paciente, record.planId]
    .map((value) => text_(value).toLowerCase())
    .join("|");
}

function findRowByKey_(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return 0;

  const values = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, lastRow - CONFIG.HEADER_ROW, CONFIG.COLUMNS.length).getDisplayValues();
  for (let index = 0; index < values.length; index += 1) {
    const record = {
      fecha: values[index][0],
      sede: values[index][1],
      paciente: values[index][2],
      planId: values[index][3]
    };
    if (buildKey_(record) === key) {
      return CONFIG.HEADER_ROW + 1 + index;
    }
  }
  return 0;
}

function findFirstEmptyRow_(sheet) {
  const firstDataRow = CONFIG.HEADER_ROW + 1;
  const lastUsedRow = Math.max(sheet.getLastRow(), firstDataRow);
  const values = sheet.getRange(
    firstDataRow,
    1,
    lastUsedRow - firstDataRow + 1,
    CONFIG.COLUMNS.length
  ).getDisplayValues();
  const emptyIndex = values.findIndex((row) => row.every((value) => !text_(value)));
  return emptyIndex >= 0 ? firstDataRow + emptyIndex : lastUsedRow + 1;
}

function text_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digits_(value) {
  return text_(value).replace(/\D/g, "");
}

function number_(value) {
  const digits = digits_(value);
  return digits ? Number(digits) : "";
}

function sheetNameFromDate_(value) {
  let parts;
  try { parts = parseRegistroDate_(value); } catch (_) { return ""; }
  const names = [
    "",
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
  ];
  const name = names[parts.month];
  return parts.year === CONFIG.LEGACY_YEAR ? name : `${name} ${parts.year}`;
}

function parseRegistroDate_(value) {
  const match = text_(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error("Fecha inválida; use dd/MM/yyyy.");
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("La fecha no corresponde a un día válido.");
  }
  return { day, month, year };
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
