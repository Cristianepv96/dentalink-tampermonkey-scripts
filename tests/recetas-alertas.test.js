const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Encabezado del paciente: cada tarjeta es un título y su contenido.
function header(cards) {
  return Object.entries(cards).map(([label, value]) => {
    const parent = { textContent: `${label}${value}` };
    return { children: [], textContent: label, parentElement: parent };
  });
}

// Filas de antecedentes como las trae window.__STATE en la página de Recetas.
function state(id, rows) {
  return JSON.stringify({
    id,
    antecedentes: rows.map(([seccion, detalle, nombre]) => ({
      tipo_antecedente_nombre: seccion, detalle: detalle || "", nombre: nombre || "", value: nombre ? "1" : ""
    }))
  });
}

function load({ cards = {}, anamnesis = null, __STATE }) {
  const store = anamnesis ? { dlk_anamnesis_context_v1: JSON.stringify({ 7: { fields: anamnesis, capturedAt: Date.now() } }) } : {};
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Botones receta rapida.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.recetasTest = { warningsFor, RECETAS };\n})();");
  const elements = header(cards);
  const context = {
    window: {
      __dlkUtils: { isVisible: () => true, escapeHtml: (t) => t, watchPage() {}, getPatientIdFromUrl: () => "7" },
      __dlkMedicamentos: { textos: {} },
      __STATE
    },
    document: { querySelectorAll: () => elements, getElementById: () => null },
    location: { pathname: "/pacientes/7/ficha/recetas" },
    sessionStorage: { getItem: (k) => store[k] ?? null }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.recetasTest;
}

const receta = (api, label) => api.RECETAS.find((r) => r.label === label);

test("avisa por una alergia escrita en Otras alertas de la anamnesis", () => {
  const api = load({
    cards: { "Alertas médicas": "NO ALERGIA", "Enfermedades": "hipertensión", "Medicamentos": "losartan" },
    anamnesis: { "Alertas médicas": "ASA II, CONTROLADA POR MEDICAMENTOS, ALERGIA A PENICILINA" }
  });
  assert.match(api.warningsFor(receta(api, "Amox")).join(" "), /penicilinas/);
});

test("avisa por un anticoagulante elegido en la lista de medicamentos de la anamnesis", () => {
  const api = load({ cards: {}, anamnesis: { "Medicamentos": "warfarina, losartan" } });
  assert.match(api.warningsFor(receta(api, "Naproxeno")).join(" "), /anticoagulante/);
});

test("sin anamnesis guardada sigue usando el encabezado", () => {
  const api = load({ cards: { "Alertas médicas": "ALERGIA A PENICILINA" } });
  assert.match(api.warningsFor(receta(api, "Amox")).join(" "), /penicilinas/);
  assert.deepEqual([...api.warningsFor(receta(api, "Interproximal"))], []);
});

test("avisa por la alergia escrita en Otras alertas sin haber visitado la anamnesis", () => {
  const api = load({
    cards: { "Alertas médicas": "" },
    __STATE: state("7", [["Alertas médicas", "ALERGICO A LAS PENICILINAS"], ["Medicamentos", "LOSARTAN"]])
  });
  assert.match(api.warningsFor(receta(api, "Amox")).join(" "), /penicilinas/);
});

test("avisa por lo marcado en la lista de medicamentos de la página", () => {
  const api = load({ __STATE: state("7", [["Medicamentos", "", "warfarina"], ["Alertas médicas", "", "NO ALERGIA"]]) });
  assert.match(api.warningsFor(receta(api, "Naproxeno")).join(" "), /anticoagulante/);
});

test("no usa los antecedentes de otro paciente", () => {
  const api = load({ __STATE: state("8", [["Alertas médicas", "ALERGICO A LAS PENICILINAS"]]) });
  assert.deepEqual([...api.warningsFor(receta(api, "Amox"))], []);
});
