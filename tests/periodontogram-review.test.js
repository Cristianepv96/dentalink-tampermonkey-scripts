const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "Dentalink - Resumen periodontograma.user.js");

function loadReview() {
  const context = {
    __DLK_PERIO_RESUMEN_TEST__: true,
    window: {},
    location: { pathname: "/pacientes/8946/ficha/periodontograma", href: "" },
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context);
  return context.__dlkPerioResumenTest;
}

const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);

// Versiones reales de la paciente 8946.
const VERSIONS_8946 = [
  { id: 369, date: day(2026, 7, 15, 15) },
  { id: 500, date: day(2026, 11, 4, 16) }
];

test("lee las versiones del estado de Dentalink en orden cronológico", () => {
  const api = loadReview();
  const versions = api.versionsFromState({
    periodontogramas: [
      { id: 500, fecha: "2026-11-04 16:58:15" },
      { id: 369, fecha: "2026-07-15 15:00:43" }
    ]
  });
  assert.deepEqual([...versions.map((v) => v.id)], [369, 500]);
  assert.equal(versions[0].date.getFullYear(), 2026);
  assert.equal(versions[0].date.getMonth(), 6);
  assert.equal(versions[0].date.getDate(), 15);
});

test("lee la fecha del selector de versiones en español", () => {
  const api = loadReview();
  const date = api.parseVersionLabelDate("Versión del 4 de noviembre de 2026 por Dr.(a) CRISTIAN EDUARDO");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 4);
  assert.equal(api.parseVersionLabelDate("Seleccionar versión"), null);
});

test("agrega las versiones guardadas en esta sesión que solo están en el selector", () => {
  const api = loadReview();
  const now = day(2027, 4, 20, 10);
  const merged = api.mergeVersions(VERSIONS_8946, [
    "Versión del 20 de abril de 2027 por Dr.(a) X",
    "Versión del 4 de noviembre de 2026 por Dr.(a) X",
    "Versión del 15 de julio de 2026 por Dr.(a) X"
  ], now);
  assert.equal(merged.length, 3);
  assert.equal(merged[2].id, null);
  assert.equal(merged[2].date.getTime(), now.getTime());
});

test("8946: el control de los 3 meses no reinicia el conteo ni muestra aviso", () => {
  const api = loadReview();
  const status = api.reviewStatus(VERSIONS_8946, day(2026, 11, 4, 18));
  assert.equal(status.anchor.id, 369);
  assert.equal(status.due, false);
  assert.equal(status.dueFrom.getFullYear(), 2027);
  assert.equal(status.dueFrom.getMonth(), 2);
  assert.equal(status.dueFrom.getDate(), 15);
});

test("8946: en el control de febrero (≈7 meses) todavía no hay aviso", () => {
  const api = loadReview();
  const versions = [...VERSIONS_8946];
  assert.equal(api.reviewStatus(versions, day(2027, 2, 4)).due, false);
});

test("8946: desde los 8 meses (15 de marzo de 2027) aparece el aviso y se mantiene", () => {
  const api = loadReview();
  const versions = [...VERSIONS_8946, { id: 600, date: day(2027, 2, 4) }];
  assert.equal(api.reviewStatus(versions, day(2027, 3, 14)).due, false);
  const status = api.reviewStatus(versions, day(2027, 3, 15, 13));
  assert.equal(status.due, true);
  assert.equal(status.anchor.id, 369);
  assert.equal(api.reviewStatus(versions, day(2027, 6, 1)).due, true);
  assert.match(api.formatReviewAlert(status), /9 MESES DESDE LA PRIMERA REVISIÓN/);
  assert.match(api.formatReviewAlert(status), /15\/07\/2026/);
});

test("al guardar después de los 8 meses desaparece el aviso y empieza otro conteo", () => {
  const api = loadReview();
  const versions = [
    ...VERSIONS_8946,
    { id: 600, date: day(2027, 2, 4) },
    { id: 700, date: day(2027, 4, 20) }
  ];
  const status = api.reviewStatus(versions, day(2027, 4, 20, 18));
  assert.equal(status.due, false);
  assert.equal(status.anchor.id, 700);
  assert.deepEqual([...status.anchors.map((v) => v.id)], [369, 700]);
  assert.equal(api.reviewStatus(versions, day(2027, 12, 20)).due, true);
});

test("la comparación usa el periodontograma que inició el conteo", () => {
  const api = loadReview();
  const versions = [
    ...VERSIONS_8946,
    { id: 600, date: day(2027, 2, 4) },
    { id: 700, date: day(2027, 4, 20) },
    { id: 800, date: day(2027, 7, 22) }
  ];
  // Control de hoy en 8946 (editando o ya guardado): contra el 15 de julio.
  assert.equal(api.baselineFor(VERSIONS_8946, { displayedId: 500, now: day(2026, 11, 4, 18) }).id, 369);
  assert.equal(api.baselineFor(VERSIONS_8946, { displayedId: 369, now: day(2026, 11, 4, 18) }), null);
  // El de los 9 meses se compara contra el primero; el siguiente, contra el de los 9 meses.
  assert.equal(api.baselineFor(versions, { displayedId: 600, now: day(2027, 4, 20, 9) }).id, 369);
  assert.equal(api.baselineFor(versions, { displayedId: 700, now: day(2027, 4, 20, 18) }).id, 369);
  assert.equal(api.baselineFor(versions, { displayedId: 800, now: day(2027, 7, 22, 18) }).id, 700);
  // Un periodontograma recién guardado que aún no tiene número también es el actual.
  const withUnsaved = [...versions.slice(0, 4), { id: null, date: day(2027, 4, 20, 18) }];
  assert.equal(api.baselineFor(withUnsaved, { displayedId: null, now: day(2027, 4, 20, 18) }).id, 369);
  // También se reconoce la versión mostrada por la fecha del selector.
  assert.equal(api.baselineFor(versions, { displayedDate: day(2027, 7, 22, 0), now: day(2027, 7, 22, 18) }).id, 700);
  assert.equal(api.baselineFor(versions, { displayedDate: day(2026, 7, 15, 0), now: day(2027, 7, 22, 18) }), null);
});

function tooth(pieza, vestibular = [0, 0, 0], palatino = [0, 0, 0], extra = {}) {
  const site = (values, bleeding = []) => ({
    surco_1: String(values[0]), surco_2: String(values[1]), surco_3: String(values[2]),
    sangramiento_1: String(bleeding[0] || 0), sangramiento_2: String(bleeding[1] || 0), sangramiento_3: String(bleeding[2] || 0)
  });
  return [
    { pieza: String(pieza), seccion: 1, ...site(vestibular, extra.bleedingV), movilidad: String(extra.movilidad || 0), furca: String(extra.furca || 0), exudado: "0", ausente: extra.ausente ?? null },
    { pieza: String(pieza), seccion: 2, ...site(palatino, extra.bleedingP), movilidad: "0", furca: "0", exudado: "0", ausente: extra.ausente ?? null },
    { pieza: String(pieza), seccion: 3, ...site([0, 0, 0]), movilidad: "0", furca: "0", exudado: "0", ausente: extra.ausente ?? null },
    { pieza: String(pieza), seccion: 4, ...site([0, 0, 0]), movilidad: "0", furca: "0", exudado: "0", ausente: extra.ausente ?? null }
  ];
}

test("resume y compara las mediciones contra el periodontograma base", () => {
  const api = loadReview();
  const base = [
    ...tooth(16, [3, 3, 6], [3, 3, 5], { bleedingV: [0, 0, 1], bleedingP: [0, 0, 1] }),
    ...tooth(26, [4, 3, 3], [3, 3, 3], { bleedingV: [1, 0, 0] }),
    ...tooth(36, [3, 3, 3], [3, 3, 3]),
    ...tooth(41, [2, 2, 2], [2, 2, 2], { movilidad: 2 })
  ].flat();
  const current = [
    ...tooth(16, [3, 3, 4], [3, 3, 3]),
    ...tooth(26, [3, 3, 3], [3, 3, 3]),
    ...tooth(36, [3, 3, 5], [3, 3, 3], { bleedingV: [0, 0, 1] }),
    ...tooth(41, [2, 2, 2], [2, 2, 2], { movilidad: 1 })
  ].flat();

  const baseSummary = api.summarizeMeasurements(base);
  assert.equal(baseSummary.totalSites, 24);
  assert.equal(baseSummary.bleedingSites, 3);
  assert.equal(baseSummary.pocketSites4, 3);
  assert.equal(baseSummary.pocketSites6, 1);

  const comparison = api.compareMeasurements(base, current);
  assert.deepEqual([...comparison.improved.map((item) => item.tooth)], ["16", "26"]);
  assert.deepEqual([...comparison.worsened.map((item) => item.tooth)], ["36"]);
  assert.deepEqual([...comparison.mobility.map((item) => `${item.tooth}:${item.from}>${item.to}`)], ["41:2>1"]);

  const text = api.formatComparison(comparison, { baseDate: day(2026, 7, 15), currentDate: day(2026, 11, 4) });
  assert.match(text, /COMPARACIÓN CON EL PERIODONTOGRAMA DEL 15\/07\/2026/);
  assert.match(text, /SANGRADO AL SONDAJE: 13 % → 4 % \(MEJORÓ\)/);
  assert.match(text, /SITIOS CON BOLSA DE 4 MM O MÁS: 3 → 2 \(MEJORÓ\)/);
  assert.match(text, /MEJORARON: 16 \(6 → 4 MM\) Y 26 \(4 → 3 MM\)/);
  assert.match(text, /EMPEORARON: 36 \(3 → 5 MM\)/);
  assert.match(text, /MOVILIDAD: 41 \(GRADO 2 → 1\)/);
  assert.equal(text, text.toUpperCase());
});

test("sin cambios lo dice de forma explícita", () => {
  const api = loadReview();
  const data = tooth(16, [3, 3, 3], [3, 3, 3]);
  const text = api.formatComparison(api.compareMeasurements(data, data), { baseDate: day(2026, 7, 15), currentDate: day(2026, 11, 4) });
  assert.match(text, /SIN CAMBIOS EN PROFUNDIDAD DE SONDAJE/);
});

test("los dientes ausentes no cuentan en el porcentaje de sangrado", () => {
  const api = loadReview();
  const data = [...tooth(16, [3, 3, 3], [3, 3, 3], { bleedingV: [1, 1, 1] }), ...tooth(17, [0, 0, 0], [0, 0, 0], { ausente: "1" })];
  const summary = api.summarizeMeasurements(data);
  assert.equal(summary.totalSites, 6);
  assert.equal(summary.bleedingSites, 3);
});

test("poner en blanco borra las medidas y conserva diente, sección, ausente e implante", () => {
  const api = loadReview();
  const blank = api.blankMeasurement({
    pieza: "16", seccion: 1, id: "128129", id_periodontograma: "500", arcada: 0,
    ausente: "1", implante: null, surco_1: "6", margen_2: "-2", nic_3: "4",
    sangramiento: "1", sangramiento_2: "1", movilidad: "2", furca: "1", exudado: "1",
    placa: "1", mucogingival: "3", indice_gingival: "2", indice_higiene: "1"
  });
  assert.equal(blank.pieza, "16");
  assert.equal(blank.seccion, 1);
  assert.equal(blank.id, "128129");
  assert.equal(blank.ausente, "1");
  assert.equal(blank.implante, null);
  ["surco_1", "margen_2", "nic_3", "sangramiento", "sangramiento_2", "movilidad", "furca", "exudado", "placa", "mucogingival", "indice_gingival", "indice_higiene"]
    .forEach((key) => assert.equal(blank[key], "0", key));
});
