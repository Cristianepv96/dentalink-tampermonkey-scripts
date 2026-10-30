const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const LABELS = ["Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades", "Medicamentos",
  "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"];

// Tarjeta de la Ficha Anamnesis: etiquetas elegidas (con ×), desplegable con su
// propio buscador y casillas, y el texto «Otros …».
function card(label, { chips = [], texto = "", enDesplegable = [] } = {}) {
  const textarea = { value: texto, id: "" };
  const icon = (text) => ({ previousElementSibling: { tagName: "SPAN", textContent: text } });
  const panelIcons = enDesplegable.map(icon);
  const panel = { contains: (n) => panelIcons.includes(n) };
  const button = { textContent: `Añadir ${label.toLowerCase()}`, parentElement: { nextElementSibling: panel } };
  const icons = [...chips.map(icon), ...panelIcons];
  const node = {
    textContent: `${label} Generales Añadir ${chips.join(" ")} ${texto}`,
    querySelector: (sel) => (sel.startsWith("input[placeholder") ? {} : null),
    querySelectorAll: (sel) => sel === "textarea" ? [textarea] : sel === "button" ? [button] : sel === "i.fa-close" ? icons : [],
    parentElement: null
  };
  textarea.parentElement = node;
  return textarea;
}

function load(textareas) {
  const store = {};
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Evoluciones periodoncia.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.anamnesisTest = { captureAnamnesisContext, getSavedAnamnesisContext, formatAnamnesisContext };\n})();");
  const context = {
    window: { __dlkUtils: { isVisible: () => true, watchPage() {}, getPatientIdFromUrl: () => "7" }, setTimeout() {} },
    document: { body: {}, addEventListener() {}, querySelectorAll: (sel) => (sel === "main textarea" ? textareas : []) },
    location: { href: "https://demo.dentalink.cl/pacientes/7/ficha/antecedentes", pathname: "/pacientes/7/ficha/antecedentes" },
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.anamnesisTest;
}

test("el contexto de anamnesis incluye lo elegido en las listas, no solo el texto", () => {
  const textareas = LABELS.map((label) => card(label));
  textareas[4] = card("Medicamentos", { chips: ["losartan", "amlodipino"], enDesplegable: ["warfarina"] });
  textareas[3] = card("Enfermedades", { chips: ["hipertensión"], texto: "HIPERTENSION ARTERIAL CONTROLADA" });
  textareas[2] = card("Alertas médicas", { chips: ["NO ALERGIA"], texto: "ASA II, CONTROLADA POR MEDICAMENTOS" });
  const comentarios = { value: "", id: "comentarios", parentElement: null };
  const api = load([...textareas, comentarios]);

  api.captureAnamnesisContext();
  const fields = api.getSavedAnamnesisContext().fields;
  assert.equal(fields.Medicamentos, "losartan, amlodipino");
  assert.equal(fields.Enfermedades, "hipertensión, HIPERTENSION ARTERIAL CONTROLADA");
  assert.equal(fields["Alertas médicas"], "NO ALERGIA, ASA II, CONTROLADA POR MEDICAMENTOS");
  assert.match(api.formatAnamnesisContext(api.getSavedAnamnesisContext()), /Medicamentos: losartan, amlodipino/);
});
