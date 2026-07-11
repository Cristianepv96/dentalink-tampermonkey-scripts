const CONFIG = {
  TOKEN: "13487561",
  HEADER_ROW: 5,
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
  target.setValues([row]);
  target.getCell(1, 6).setNumberFormat("[$$]#,##0");
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
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`No existe la hoja "${sheetName}". Créala y vuelve a enviar.`);
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  const range = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, CONFIG.COLUMNS.length);
  const current = range.getValues()[0];
  const hasAnyHeader = current.some((value) => String(value || "").trim());
  if (!hasAnyHeader) {
    range.setValues([CONFIG.COLUMNS]);
  }
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

  return clean;
}

function recordToRow_(record) {
  return [
    record.fecha,
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
  const match = text_(value).match(/\b\d{1,2}\/(\d{1,2})\/\d{4}\b/);
  if (!match) return "";
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
  return names[Number(match[1])] || "";
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
