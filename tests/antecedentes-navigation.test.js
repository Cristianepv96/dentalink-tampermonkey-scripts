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
  const target = { children: [], parentElement: null, textContent: "", dataset: {}, style: {}, ...props };
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj || typeof key === "symbol") return obj[key];
      return () => null;
    }
  });
}

// Nodo mínimo: solo lo que el script recorre para encontrar las secciones.
const node = stub;

function section(title) {
  const heading = node({ textContent: title });
  const header = node({ children: [heading] });
  const textarea = node({ value: "", offsetParent: {}, dispatchEvent() {} });
  const wrapper = node({ children: [textarea] });
  const card = node({ children: [header, wrapper] });
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
      body: {},
      addEventListener() {},
      head: stub(),
      createElement() { return stub(); },
      getElementById() { return null; },
      querySelectorAll(selector) { return selector === "textarea" ? textareas : []; }
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);

  return {
    location,
    setTextareas(list) { textareas = list; },
    flush() { while (timers.length) timers.shift()(); },
    tick() { intervals.forEach((fn) => fn()); }
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
