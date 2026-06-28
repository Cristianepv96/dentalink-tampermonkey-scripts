const CONFIG = {
  SHEET_NAME: "Registro diario",
  TOKEN: "13487561",
  HEADER_ROW: 1,
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
    assertAuthorized_(body);
    const record = normalizeRecord_(body.record || body);
    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const key = buildKey_(record);
    const duplicateRow = findRowByKey_(sheet, key);
    if (duplicateRow) {
      return json_({
        ok: true,
        duplicate: true,
        row: duplicateRow,
        key,
        record: rowToRecord_(sheet.getRange(duplicateRow, 1, 1, CONFIG.COLUMNS.length).getDisplayValues()[0])
      });
    }

    const row = recordToRow_(record);
    sheet.appendRow(row);
    const insertedRow = sheet.getLastRow();
    const saved = sheet.getRange(insertedRow, 1, 1, CONFIG.COLUMNS.length).getDisplayValues()[0];
    return json_({
      ok: true,
      duplicate: false,
      row: insertedRow,
      key,
      record: rowToRecord_(saved)
    });
  } catch (error) {
    return json_({
      ok: false,
      error: error.message || String(error)
    });
  }
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

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error(`No existe la hoja ${CONFIG.SHEET_NAME}.`);
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
    valor: digits_(record.valor),
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

function text_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digits_(value) {
  return text_(value).replace(/\D/g, "");
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
