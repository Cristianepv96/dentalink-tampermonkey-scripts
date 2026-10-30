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

function load({ cards = {}, anamnesis = null }) {
  const store = anamnesis ? { dlk_anamnesis_context_v1: JSON.stringify({ 7: { fields: anamnesis, capturedAt: Date.now() } }) } : {};
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Botones receta rapida.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.recetasTest = { warningsFor, RECETAS };\n})();");
  const elements = header(cards);
  const context = {
    window: {
      __dlkUtils: { isVisible: () => true, escapeHtml: (t) => t, watchPage() {}, getPatientIdFromUrl: () => "7" },
      __dlkMedicamentos: { textos: {} }
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
