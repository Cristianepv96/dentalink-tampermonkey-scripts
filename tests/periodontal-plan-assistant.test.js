const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const ASSISTANT_PATH = path.join(ROOT, "Dentalink - Plan periodontal asistido.user.js");

function storageFrom(map) {
  return {
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { map.set(key, value); },
    removeItem(key) { map.delete(key); }
  };
}

function loadUtils(localRecords = new Map()) {
  const context = {
    window: {
      addEventListener() {},
      dispatchEvent() {},
      setTimeout() { return 1; },
      setInterval() { return 1; }
    },
    location: {
      pathname: "/pacientes/123/ficha/evoluciones",
      href: "https://demo.dentalink.cl/pacientes/123/ficha/evoluciones"
    },
    history: { pushState() {}, replaceState() {} },
    document: { body: null, documentElement: null },
    localStorage: storageFrom(localRecords),
    CustomEvent: class {},
    MutationObserver: class {},
    HTMLElement: class {},
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    Event: class {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "dentalink-utils.js"), "utf8"), context);
  return context.window.__dlkUtils;
}

function loadAssistant() {
  const localRecords = new Map();
  const sessionRecords = new Map();
  const utils = loadUtils(localRecords);
  const context = {
    __DLK_PLAN_ASSISTANT_TEST__: true,
    window: { __dlkUtils: utils },
    location: {
      pathname: "/pacientes/123/ficha/evoluciones",
      href: "https://demo.dentalink.cl/pacientes/123/ficha/evoluciones"
    },
    localStorage: storageFrom(localRecords),
    sessionStorage: storageFrom(sessionRecords)
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(ASSISTANT_PATH, "utf8"), context);
  return { api: context.__dlkPlanAssistantTest, localRecords, utils };
}

const VALUATION_FIXTURE = [
  "CRISTIAN EDUARDO PEÑA VILLAMIZAR (#22)",
  "Plan de tratamiento #21281:",
  "Se solicita autorización para realizar:",
  "- [240301] Raspaje y alisado radicular a campo cerrado en 16, 17, 18, 26, 27, 28, 36, 46.",
  "- [242201] Raspaje y alisado radicular a campo abierto en 47, 48."
].join("\n");

test("la valoración suministrada ofrece ocho piezas cerradas y dos abiertas", () => {
  const { api, utils } = loadAssistant();
  const record = { progress: utils.calculatePeriodontalProgress(VALUATION_FIXTURE) };
  const items = api.assistantItems(record);

  assert.deepEqual(Array.from(items, (item) => item.key), ["closed", "open"]);
  assert.deepEqual([...items[0].pending], ["16", "17", "18", "26", "27", "28", "36", "46"]);
  assert.deepEqual([...items[1].pending], ["47", "48"]);
});

test("las evoluciones parciales se descuentan sin perder la valoración global", () => {
  const { api, utils } = loadAssistant();
  const baseline = utils.calculatePeriodontalProgress(VALUATION_FIXTURE);
  const evidence = utils.calculatePeriodontalProgress([
    "Acción realizada: [240301] Campo cerrado Pieza 16",
    "PROCEDIMIENTO: Raspado y Alisado Radicular Campo Cerrado",
    "Dientes: 16, 17"
  ].join("\n"));
  const merged = utils.mergePeriodontalProgressEvidence(baseline, evidence);
  const items = api.assistantItems({ progress: merged });

  assert.deepEqual([...items[0].pending], ["18", "26", "27", "28", "36", "46"]);
  assert.deepEqual([...items[1].pending], ["47", "48"]);
});

test("genera nombres locales para una o varias categorías", () => {
  const { api } = loadAssistant();
  const date = new Date(2026, 7, 10);

  assert.equal(
    api.buildPlanName([{ key: "closed" }], date),
    "10-08-2026 CRISTIAN PEÑA - RAR CERRADO"
  );
  assert.equal(
    api.buildPlanName([{ key: "open" }, { key: "closed" }, { key: "drainage" }], date),
    "10-08-2026 CRISTIAN PEÑA - RAR CERRADO / RAR ABIERTO / DRENAJE"
  );
});

test("el selector DOM inicia vacío y conserva únicamente la selección parcial", () => {
  const { api } = loadAssistant();
  const pending = [
    { key: "closed", cups: "240301", label: "Cerrado", scope: "tooth" },
    { key: "open", cups: "242201", label: "Abierto", scope: "tooth" }
  ];
  const checked = new Map();
  const modal = {
    querySelectorAll(selector) { return checked.get(selector) || []; },
    querySelector() { return null; }
  };

  assert.deepEqual(Array.from(api.selectedGroupsFromModal(modal, pending)), []);
  checked.set('input[data-key="closed"]:checked', [{ value: "16" }, { value: "26" }]);
  const selected = api.selectedGroupsFromModal(modal, pending);
  assert.equal(selected.length, 1);
  assert.deepEqual([...selected[0].teeth], ["16", "26"]);
});

test("la operación reanudable normaliza piezas y conserva su fuente", () => {
  const { api } = loadAssistant();
  const job = api.createOperation({
    patientId: "123",
    originPath: "/pacientes/123/ficha/evoluciones",
    planName: "Plan editable",
    sourceRecord: { updatedAt: "2026-08-10T12:00:00.000Z", sourcePath: "/origen", sourceSignature: "10:20" },
    items: [
      { key: "closed", cups: "240301", scope: "tooth", teeth: ["26", "16", "16", "99"] },
      { key: "frenectomy", cups: "274101", scope: "procedure", teeth: [] }
    ]
  });

  assert.equal(job.schemaVersion, 1);
  assert.equal(job.patientId, "123");
  assert.equal(job.status, "confirmed");
  assert.deepEqual([...job.items[0].teeth], ["16", "26"]);
  assert.equal(job.sourceSignature, "10:20");
  assert.equal(api.expandJobItems(job.items).length, 3);
});

test("la reanudación descuenta exactamente las filas ya existentes", () => {
  const { api } = loadAssistant();
  const items = [
    { key: "closed", cups: "240301", scope: "tooth", teeth: ["16", "17"] },
    { key: "open", cups: "242201", scope: "tooth", teeth: ["47"] },
    { key: "frenectomy", cups: "274101", scope: "procedure", teeth: [] }
  ];
  const rows = [
    { key: "closed", tooth: "16", scope: "tooth" },
    { key: "frenectomy", tooth: "", scope: "procedure" }
  ];

  assert.deepEqual(
    Array.from(api.missingOperationItems(items, rows), (item) => item.identity),
    ["closed|17", "open|47"]
  );
  const loaded = api.loadedSelection(items, rows);
  assert.deepEqual(Array.from(loaded, (item) => item.key), ["closed", "frenectomy"]);
  assert.deepEqual([...loaded[0].teeth], ["16"]);
});

test("el registro local avisa solo por combinaciones realmente cargadas", () => {
  const { api, localRecords } = loadAssistant();
  localRecords.set("dlk_periodontal_plan_assistant_history_v1", JSON.stringify([{
    id: "op-1",
    patientId: "123",
    planId: "900",
    items: [{ key: "closed", cups: "240301", scope: "tooth", teeth: ["16"] }],
    createdAt: "2026-08-10T10:00:00.000Z"
  }]));

  const index = api.plannedItemIndex("123");
  assert.deepEqual([...index.get("closed|16")], ["900"]);
  assert.equal(index.has("closed|17"), false);
});

test("filtra las evoluciones de otros profesionales", () => {
  const { api } = loadAssistant();
  const mixed = [
    "OTRO PROFESIONAL (#10)",
    "Plan de tratamiento #1:",
    "- [240301] Campo cerrado en 11.",
    VALUATION_FIXTURE,
    "TERCER PROFESIONAL (#30)",
    "Plan de tratamiento #3:",
    "- [242201] Campo abierto en 21."
  ].join("\n");
  const selected = api.onlyProfessionalEntries(mixed);

  assert.match(selected, /campo cerrado en 16, 17, 18/);
  assert.doesNotMatch(selected, /cerrado en 11/);
  assert.doesNotMatch(selected, /abierto en 21/);
});

test("reconoce el encabezado visual ‘a través de’ usado por Dentalink", () => {
  const { api } = loadAssistant();
  const mixed = [
    "(a través de OTRO PROFESIONAL, SEDE NORTE)",
    "Plan de tratamiento #1:",
    "- [240301] Campo cerrado en 11.",
    "(a través de CRISTIAN EDUARDO PEÑA VILLAMIZAR, MAGISTERIO-BELEN)",
    "Plan de tratamiento #21281:",
    "- [242201] Campo abierto en 47, 48.",
    "(a través de TERCER PROFESIONAL, SEDE SUR)",
    "Plan de tratamiento #3:",
    "- [242201] Campo abierto en 21."
  ].join("\n");
  const selected = api.onlyProfessionalEntries(mixed);

  assert.match(selected, /abierto en 47, 48/);
  assert.doesNotMatch(selected, /cerrado en 11/);
  assert.doesNotMatch(selected, /abierto en 21/);
});

test("el flujo usa controles nativos, valida filas y no evoluciona prestaciones", () => {
  const source = fs.readFileSync(ASSISTANT_PATH, "utf8");

  assert.match(source, /#nombre, input\[placeholder='Nombre para este tratamiento'\]/);
  assert.match(source, /cara_\$\{tooth\}_5/);
  assert.match(source, /querySelectorAll\("\.row-nombre"\)/);
  assert.match(source, /querySelector\("\.row-pieza"\)/);
  assert.match(source, /distinctLabels\.length !== 1/);
  assert.match(source, /Cancelar automatización/);
  assert.doesNotMatch(source, /findTextButton\(["'](?:Evolucionar|Finalizar|Facturar)/);
});
