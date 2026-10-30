const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "Dentalink - Antecedentes por defecto.user.js");
const source = fs.readFileSync(SCRIPT_PATH, "utf8");

// Elemento falso: las propiedades que el test no define responden como
// funciones vacías, suficiente para que el script dibuje sus botones.
function stub(props = {}) {
  const target = {
    children: [], parentElement: null, textContent: "", dataset: {}, style: {}, classList: { add() {}, remove() {} },
    querySelectorAll() { return []; }, contains() { return false; }, ...props
  };
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj || typeof key === "symbol") return obj[key];
      return () => null;
    }
  });
}

// Nodo mínimo: solo lo que el script recorre para encontrar las secciones.
const node = stub;

// Tarjeta de sección; `list` son los elementos ya elegidos en la lista de Dentalink.
function section(title, { value = "", list = [] } = {}) {
  const heading = node({ textContent: title });
  const header = node({ children: [heading] });
  const textarea = node({ value, offsetParent: {}, dispatchEvent() {} });
  const wrapper = node({ children: [textarea] });
  const chips = list.map((text) => ({ previousElementSibling: { tagName: "SPAN", textContent: text } }));
  const card = node({
    children: [header, wrapper],
    querySelectorAll(selector) { return selector === "i.fa-close" ? chips : []; }
  });
  textarea.parentElement = wrapper;
  wrapper.parentElement = card;
  return textarea;
}

function loadScript(pathname) {
  const timers = [];
  const intervals = [];
  const location = { pathname };
  let textareas = [];

  class HTMLTextAreaElement {}
  class MutationObserver {
    observe() {}
  }

  const context = {
    location,
    HTMLTextAreaElement,
    MutationObserver,
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    document: {
      body: stub(),
      addEventListener() {},
      head: stub(),
      createElement() { return stub(); },
      getElementById() { return null; },
      querySelectorAll(selector) { return selector === "textarea" ? textareas : []; }
    }
  };
  context.window = context;
  context.__DLK_ANAM_TEST__ = true;
  vm.runInNewContext(source, context);

  return {
    location,
    setTextareas(list) { textareas = list; },
    flush() { while (timers.length) timers.shift()(); },
    tick() { intervals.forEach((fn) => fn()); },
    api: () => context.__dlkAnamTest
  };
}

test("se instala en todas las páginas del paciente, no solo en antecedentes", () => {
  const match = source.match(/@match\s+(\S+)/)[1];
  assert.equal(match, "https://*.dentalink.cl/pacientes/*");
});

test("rellena los textos base al volver a antecedentes sin recargar", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  let enfermedad = section("Enfermedad actual");
  page.setTextareas([enfermedad]);
  page.flush();
  assert.match(enfermedad.value, /^PACIENTE ACUDE/);

  // Sale a otra pestaña del paciente sin recargar la página.
  page.location.pathname = "/pacientes/7/ficha/evoluciones";
  page.setTextareas([]);
  page.tick();
  page.flush();

  // Vuelve a antecedentes: Dentalink dibuja campos nuevos y vacíos.
  page.location.pathname = "/pacientes/7/ficha/antecedentes";
  enfermedad = section("Enfermedad actual");
  page.setTextareas([enfermedad]);
  page.tick();
  page.flush();
  assert.match(enfermedad.value, /^PACIENTE ACUDE/);
});

test("no vuelve a rellenar un campo borrado a propósito en la misma página", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const enfermedad = section("Enfermedad actual");
  page.setTextareas([enfermedad]);
  page.flush();
  enfermedad.value = "";
  page.tick();
  page.flush();
  assert.equal(enfermedad.value, "");
});

test("Sin antecedentes no escribe NIEGA donde la lista de Dentalink ya tiene datos", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const medicamentos = section("Medicamentos", { list: ["losartan"] });
  const habitos = section("Hábitos");
  page.setTextareas([medicamentos, habitos]);
  page.flush();
  page.api().sinAntecedentes();
  assert.equal(medicamentos.value, "");
  assert.equal(habitos.value, "NIEGA");
});

test("un medicamento elegido en la lista cuenta como presente y no se duplica", async () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const medicamentos = section("Medicamentos", { list: ["Losartán."] });
  page.setTextareas([medicamentos]);
  page.flush();
  assert.equal(page.api().present(medicamentos, "LOSARTAN"), true);
  await page.api().addToSection("Medicamentos", "LOSARTAN");
  assert.equal(medicamentos.value, "");
});

test("reconoce los nombres alternativos de la lista", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const enfermedades = section("Enfermedades", { list: ["Hipertensión arterial"] });
  page.setTextareas([enfermedades]);
  page.flush();
  assert.equal(page.api().present(enfermedades, "HIPERTENSION"), true);
});

test("no pone comillas en el motivo si ya hay un motivo elegido en la lista", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const motivo = section("Motivo de consulta", { list: ["tengo una muela floja"] });
  const enfermedad = section("Enfermedad actual");
  page.setTextareas([motivo, enfermedad]);
  page.flush();
  assert.equal(motivo.value, "");
  assert.match(enfermedad.value, /^PACIENTE ACUDE/);
});

test("el resumen cuenta como faltantes las secciones vacías o con solo comillas", () => {
  const page = loadScript("/pacientes/7/ficha/antecedentes");
  const motivo = section("Motivo de consulta", { value: '""' });
  const medicamentos = section("Medicamentos", { list: ["losartan"] });
  const habitos = section("Hábitos", { value: "NIEGA" });
  const familiares = section("Antecedentes familiares");
  page.setTextareas([motivo, medicamentos, habitos, familiares]);
  const missing = page.api().missingSections(page.api().getSections());
  assert.deepEqual([...missing], ["Motivo de consulta", "Antecedentes familiares"]);
});
