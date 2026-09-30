const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function backend() {
  const grid = new Map();
  const events = [];
  let locked = false;
  const col = text => [...text].reduce((value, c) => value * 26 + c.charCodeAt(0) - 64, 0);
  const key = (r, c) => `${r}:${c}`;
  const get = (r, c) => grid.get(key(r, c)) ?? "";
  const display = value => value instanceof Date
    ? `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}` : String(value);
  class Range {
    constructor(r, c, h = 1, w = 1) { Object.assign(this, { r, c, h, w }); }
    getValues() { return Array.from({ length: this.h }, (_, i) => Array.from({ length: this.w }, (_, j) => get(this.r + i, this.c + j))); }
    getDisplayValues() { return this.getValues().map(row => row.map(display)); }
    getFormulas() { return this.getValues().map(row => row.map(value => typeof value === "string" && value.startsWith("=") ? value : "")); }
    getValue() { return get(this.r, this.c); }
    getFormula() { return this.getFormulas()[0][0]; }
    getCell(r, c) { return new Range(this.r + r - 1, this.c + c - 1); }
    setValues(values) {
      assert.equal(locked, true, "Writes must hold the backend lock");
      values.forEach((row, i) => row.forEach((value, j) => grid.set(key(this.r + i, this.c + j), value)));
      events.push(`values:${this.r}:${this.c}`);
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    setFormula(value) { return this.setValue(value); }
    setFormulas(values) { return this.setValues(values); }
    createFilter() { return this; }
    breakApart() { events.push(`unmerge:${this.c}`); return this; }
  }
  for (const method of ["setFontFamily", "setFontSize", "setFontColor", "setFontWeight", "setBackground", "setVerticalAlignment", "setWrapStrategy", "setWrap", "setNumberFormat", "setNote"]) Range.prototype[method] = function () { return this; };
  const sheet = {
    getName: () => "Septiembre", getMaxRows: () => 20,
    getLastRow: () => Math.max(5, ...[...grid.keys()].map(k => Number(k.split(":")[0]))),
    getBandings: () => [], getFilter: () => null,
    setFrozenRows() {}, setColumnWidth() {}, setRowHeight() {},
    insertRowsAfter() {},
    getRange(r, c, h, w) {
      if (typeof r === "string") {
        const m = r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        return new Range(+m[2], col(m[1]), m[4] ? +m[4] - m[2] + 1 : 1, m[3] ? col(m[3]) - col(m[1]) + 1 : 1);
      }
      return new Range(r, c, h, w);
    }
  };
  ["Fecha", "Sede", "Paciente", "ID plan", "Titulo plan", "Valor"].forEach((v, i) => grid.set(key(5, i + 1), v));
  const spreadsheet = { getSheetByName: () => sheet, getSpreadsheetLocale: () => "es_ES" };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => events.push("flush"), WrapStrategy: { CLIP: "CLIP" } },
    LockService: { getScriptLock: () => ({ waitLock: () => { locked = true; events.push("lock"); }, releaseLock: () => { locked = false; events.push("release"); } }) },
    Utilities: { parseDate: value => { const [d, m, y] = value.split("/").map(Number); return new Date(Date.UTC(y, m - 1, d)); } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Date
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "apps-script/registro-diario.gs"), "utf8").replace(/TOKEN:\s*"[^"]*"/, 'TOKEN: "test-only"');
  vm.runInContext(source, context);
  const record = { fecha: "29/09/2026", sede: "Sede de prueba", paciente: "PACIENTE DE PRUEBA", planId: "1", tituloPlan: "Plan de prueba", valor: 1000 };
  return { api: context, sheet, grid, events, record, spreadsheet, locked: value => { locked = value; } };
}

test("envíos repetidos no duplican datos y mantienen el bloqueo hasta verificar", () => {
  const f = backend();
  const a = f.api.saveRecord_({ token: "test-only", record: f.record });
  const b = f.api.saveRecord_({ token: "test-only", record: f.record });
  assert.equal(a.row, 6); assert.equal(a.duplicate, false); assert.equal(b.duplicate, true);
  assert.equal(f.events.filter(e => e === "values:6:1").length, 1);
  assert.deepEqual(f.events.filter(e => ["lock", "flush", "release"].includes(e)), ["lock", "flush", "release", "lock", "release"]);
});

test("una estructura incompatible se rechaza y libera el bloqueo sin escribir", () => {
  const f = backend(); f.grid.set("5:3", "Otro encabezado");
  assert.throws(() => f.api.saveRecord_({ token: "test-only", record: f.record }), /estructura diferente/);
  assert.equal(f.events.at(-1), "release");
  assert.equal(f.events.some(e => e.startsWith("values:")), false);
});

test("las fechas inválidas se rechazan y el siguiente año no reutiliza la pestaña anterior", () => {
  const f = backend();
  assert.throws(() => f.api.normalizeRecord_({ ...f.record, fecha: "31/02/2026" }), /válido/);
  assert.equal(f.api.sheetNameFromDate_("01/01/2027"), "Enero 2027");
  assert.equal(f.api.sheetNameFromDate_("29/09/2026"), "Septiembre");
});

test("el rediseño conserva A:F y la previsión de jornadas en sucesivas aplicaciones", () => {
  const f = backend(); f.locked(true);
  f.sheet.getRange(6, 1, 1, 6).setValues([["29/09/2026", "Sede de prueba", "PACIENTE DE PRUEBA", 1, "Plan de prueba", 1000]]);
  f.sheet.getRange("I5").setValue("=MAX(0;20-I4)");
  const before = JSON.stringify(f.sheet.getRange(6, 1, 1, 6).getValues());
  f.api.formatMonthlySheet_(f.sheet);
  f.api.formatMonthlySheet_(f.sheet);
  assert.equal(JSON.stringify(f.sheet.getRange(6, 1, 1, 6).getValues()), before);
  assert.equal(f.sheet.getRange("I7").getFormula(), "=MAX(0;20-I4)");
  assert.equal(f.events.filter(e => e.startsWith("unmerge:")).every(e => e === "unmerge:7"), true);
});

test("el formateo respeta totales diarios introducidos manualmente, incluso cero", () => {
  const f = backend(); f.locked(true);
  f.sheet.getRange(6, 7).setValue(0);
  f.api.ensureDailyTotal_(f.sheet, 6);
  assert.equal(f.sheet.getRange(6, 7).getValue(), 0);
});

function frontend() {
  const requests = [];
  const context = {
    window: { __dlkUtils: { watchPage() {}, normalizeSpaces: value => String(value || "").trim() }, setTimeout() {} },
    GM_registerMenuCommand() {},
    GM_getValue: () => ({ webAppUrl: "https://script.google.com/macros/s/test/exec", token: "test-only" }),
    GM_xmlhttpRequest: options => { requests.push(options); options.onload({ status: 200, responseText: '{"ok":true}' }); }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Registro diario a Google Sheets.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.api = { payloadToRow, postToSheets };\n})();");
  vm.runInContext(source, context);
  return { api: context.api, requests };
}

test("Copiar limita el pegado a las seis columnas de datos y conserva los cálculos vecinos", () => {
  const f = frontend();
  assert.equal(f.api.payloadToRow({ fecha: "29/09/2026", sede: "Prueba", paciente: "Prueba", planId: "1", tituloPlan: "Prueba", valor: "1000" }).split("\t").length, 6);
});

test("el envío usa POST sin datos de paciente ni token en la URL", async () => {
  const f = frontend();
  await f.api.postToSheets({ fecha: "29/09/2026", sede: "Prueba", paciente: "PACIENTE DE PRUEBA", planId: "1", tituloPlan: "Prueba", valor: "1000" });
  assert.equal(f.requests[0].method, "POST");
  assert.equal(f.requests[0].url, "https://script.google.com/macros/s/test/exec");
  assert.equal(JSON.parse(f.requests[0].data).record.paciente, "PACIENTE DE PRUEBA");
});
