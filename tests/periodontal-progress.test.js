const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadUtils(existingUtils = null) {
  const storage = new Map();
  const context = {
    window: {
      addEventListener() {},
      dispatchEvent() {},
      setTimeout() { return 1; },
      setInterval() { return 1; },
      __dlkUtils: existingUtils
    },
    location: {
      pathname: "/pacientes/123/ficha/evoluciones",
      href: "https://demo.dentalink.cl/pacientes/123/ficha/evoluciones"
    },
    history: { pushState() {}, replaceState() {} },
    document: { body: null, documentElement: null },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    CustomEvent: class {},
    MutationObserver: class {},
    HTMLElement: class {},
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    Event: class {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "dentalink-utils.js"), "utf8");
  vm.runInContext(source, context);
  return context.window.__dlkUtils;
}

function loadEvolutionsWithLegacyUtils() {
  const context = {
    window: {
      __dlkUtils: {
        isVisible: () => true,
        escapeHtml: (value) => String(value),
        getPatientIdFromUrl: () => "123",
        watchPage() {}
      },
      addEventListener() {},
      setTimeout() { return 1; }
    },
    document: {
      body: {},
      addEventListener() {},
      querySelectorAll() { return []; },
      getElementById() { return null; }
    },
    location: {
      pathname: "/pacientes/123/ficha/evoluciones",
      href: "https://demo.dentalink.cl/pacientes/123/ficha/evoluciones"
    },
    localStorage: { getItem() { return null; } },
    sessionStorage: { getItem() { return null; } },
    Element: class {},
    MutationObserver: class {}
  };
  vm.createContext(context);
  let source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Evoluciones periodoncia.user.js"),
    "utf8"
  );
  source = source.replace(
    /\n\}\)\(\);\s*$/,
    "\n  globalThis.__compatTest = { getCurrentPeriodontalProgress, treatmentCategory };\n})();"
  );
  vm.runInContext(source, context);
  return context.__compatTest;
}

test("reconoce y contabiliza los siete tratamientos periodontales", () => {
  const utils = loadUtils();
  const text = [
    "Se solicita autorización para realizar:",
    "- [240301] Raspaje y alisado radicular a campo cerrado en 11, 12.",
    "- [242201] Raspaje y alisado radicular a campo abierto en 21.",
    "- [240401] Drenaje periodontal en 16.",
    "- [240201] Detartraje subgingival en 31, 32.",
    "- [248201] Ajuste oclusal en 22.",
    "- [242301] Alargamiento de corona clínica en 26.",
    "- [274101] Frenillectomía labial superior."
  ].join("\n");

  const progress = utils.calculatePeriodontalProgress(text);
  assert.equal(progress.treatments.length, 7);
  assert.equal(progress.total, 9);
  assert.equal(progress.completedCount, 0);
  assert.equal(progress.pendingCount, 9);
});

test("la utilidad nueva amplía una instancia antigua ya cargada", () => {
  const legacyUtils = { legacyMarker: true };
  const utils = loadUtils(legacyUtils);
  assert.equal(utils, legacyUtils);
  assert.equal(utils.version, "1.2.2");
  assert.equal(typeof utils.calculatePeriodontalProgress, "function");
  assert.equal(utils.legacyMarker, true);
});

test("cuenta la misma pieza por separado cuando tiene tratamientos diferentes", () => {
  const utils = loadUtils();
  const text = [
    "Se solicita autorización para realizar:",
    "- [240301] Campo cerrado en 11.",
    "- [242201] Campo abierto en 11.",
    "Acción realizada: [242201] Campo abierto Pieza 11",
    "PROCEDIMIENTO: Raspado y Alisado Radicular Campo Abierto",
    "Dientes: 11"
  ].join("\n");

  const progress = utils.calculatePeriodontalProgress(text);
  assert.equal(progress.total, 2);
  assert.equal(progress.completedCount, 1);
  assert.equal(progress.pendingCount, 1);
  assert.equal(progress.percent, 50);
});

test("no interpreta el conteo entre paréntesis como una pieza dental", () => {
  const utils = loadUtils();
  const progress = utils.calculatePeriodontalProgress([
    "Se solicita autorización para realizar:",
    "- [240301] Campo cerrado en 31, 32 (16)."
  ].join("\n"));

  assert.deepEqual([...progress.treatments[0].requested], ["31", "32"]);
});

test("la evidencia clínica corrige una categoría administrativa diferente", () => {
  const utils = loadUtils();
  const text = [
    "Se solicita autorización para realizar:",
    "- [242201] Campo abierto en 21.",
    "Acción realizada: [240301] Campo cerrado Pieza 11",
    "PROCEDIMIENTO: Raspado y Alisado Radicular (RAR) Campo Abierto.",
    "Dientes: 21",
    "ATENDIDO POR: Dr. Cristian Peña"
  ].join("\n");

  const progress = utils.calculatePeriodontalProgress(text);
  assert.equal(progress.total, 1);
  assert.equal(progress.completedCount, 1);
  assert.equal(progress.treatments[0].key, "open");
  assert.deepEqual([...progress.treatments[0].completed], ["21"]);
});

test("un registro administrativo vacío no se cuenta como realizado", () => {
  const utils = loadUtils();
  const text = [
    "Acción realizada: [240401] Drenaje periodontal Pieza 16",
    "-"
  ].join("\n");

  const progress = utils.calculatePeriodontalProgress(text);
  assert.equal(progress.total, 1);
  assert.equal(progress.completedCount, 0);
  assert.equal(progress.pendingCount, 1);
});

test("simula el procedimiento actual y genera el estado de paciente controlado", () => {
  const utils = loadUtils();
  const progress = utils.calculatePeriodontalProgress([
    "Se solicita autorización para realizar:",
    "- [240301] Campo cerrado en 11."
  ].join("\n"));
  const completed = utils.applyPeriodontalCompletion(progress, "closed", "11");
  const note = utils.formatPeriodontalProgressNote(completed);

  assert.equal(completed.pendingCount, 0);
  assert.equal(completed.controlled, true);
  assert.match(note, /Paciente controlado por periodoncia/);
});

test("construye la misma valoración compartida a partir del resumen", () => {
  const utils = loadUtils();
  const summary = [
    "Hallazgos periodontales:",
    "Se observa diente 16 con bolsas de 6mm.",
    "",
    "Se solicita autorización para realizar:",
    "- [242201] Raspaje y alisado radicular a campo abierto en 16."
  ].join("\n");

  const valuation = utils.buildPeriodontalValuationText({ summary });

  assert.match(valuation, /^Paciente acude a cita de valoración especializada por periodoncia/);
  assert.match(valuation, /Hallazgos periodontales:\nSe observa diente 16/);
  assert.match(valuation, /\[242201\].*campo abierto en 16/);
  assert.match(valuation, /NOTA IMPORTANTE:/);
  assert.match(valuation, /Cita 20 min$/);
});

test("prepara órdenes solo para campo cerrado, campo abierto y drenaje", () => {
  const utils = loadUtils();
  const summary = [
    "Se solicita autorización para realizar:",
    "- [240301] Raspaje y alisado radicular a campo cerrado en 33, 45.",
    "- [242201] Raspaje y alisado radicular a campo abierto en 16, 17, 21.",
    "- [240401] Drenaje periodontal en 26.",
    "- [248201] Ajuste oclusal en 22.",
    "- [240201] Detartraje subgingival en 31.",
    "- [242301] Alargamiento de corona clínica en 11.",
    "- [274101] Frenillectomía labial superior."
  ].join("\n");

  const orders = utils.buildPeriodontalOrderItems(summary);

  assert.deepEqual(
    Array.from(orders, (order) => order.cups),
    ["240301", "242201", "240401"]
  );
  assert.deepEqual([...orders[0].teeth], ["33", "45"]);
  assert.equal(orders[0].quantity, 2);
  assert.equal(orders[0].indications, "Alisado radicular a campo cerrado en 33, 45.");
  assert.equal(orders[1].quantity, 3);
  assert.equal(orders[2].indications, "Drenaje periodontal en 26.");
});

test("el resumen conserva drenajes pero no solicita ajustes por movilidad", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Resumen periodontograma.user.js"),
    "utf8"
  );

  assert.match(source, /requestLines\.push\(`- \[240401\] Drenaje periodontal/);
  assert.doesNotMatch(source, /requestLines\.push\(`- \[248201\] Ajuste oclusal/);
});

test("el resumen abre todas las órdenes mediante Tampermonkey", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Resumen periodontograma.user.js"),
    "utf8"
  );

  assert.match(source, /@grant\s+GM_openInTab/);
  assert.match(source, /GM_openInTab\(url,\s*\{\s*active:\s*false,\s*insert:\s*true\s*\}\)/);
  assert.match(source, /window\.open\(url, "_blank"\)/);
  assert.match(source, /window\.setTimeout\(\(\) => openDraft\(draft\), index \* 1800\)/);
});

test("el resumen crea órdenes sin depender de utilidades compartidas", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Resumen periodontograma.user.js"),
    "utf8"
  );

  assert.match(source, /function buildOrderItemsFromPeriodontogram\(\)/);
  assert.match(source, /const items = buildOrderItemsFromPeriodontogram\(\)/);
  assert.match(source, /const justification = buildFallbackValuationText\(summary\)/);
  assert.doesNotMatch(source, /sharedBuild(?:ValuationText|OrderItems)/);
});

test("el resumen mantiene todas sus utilidades dentro del sandbox de Tampermonkey", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Resumen periodontograma.user.js"),
    "utf8"
  );

  assert.match(source, /@grant\s+GM_openInTab/);
  assert.doesNotMatch(source, /@grant\s+unsafeWindow/);
  assert.doesNotMatch(source, /@require/);
  assert.match(source, /const watchPage = \(callback, options = \{\}\) =>/);
  assert.match(source, /const registerPanel = \(panel, options = \{\}\) =>/);
  assert.match(source, /panel\.style\.position = "fixed"/);
});

test("el panel de evoluciones sigue iniciando con la versión anterior de utilidades", () => {
  const evolutions = loadEvolutionsWithLegacyUtils();
  assert.equal(evolutions.getCurrentPeriodontalProgress(), null);
  assert.equal(evolutions.treatmentCategory("240301", "Campo cerrado"), "closed");
  assert.equal(evolutions.treatmentCategory("240401", "Drenaje periodontal"), "drainage");
});
