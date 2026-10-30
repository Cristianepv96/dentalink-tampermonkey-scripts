const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "..", "Dentalink - Antecedentes por defecto.user.js");
const source = () => fs.readFileSync(SCRIPT_PATH, "utf8");

// Elemento falso: las propiedades que el test no define responden como
// funciones vacías, suficiente para que el script dibuje lo suyo.
function stub(props = {}) {
  const target = {
    children: [], parentElement: null, textContent: "", dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }, ...props
  };
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj || typeof key === "symbol") return obj[key];
      return () => null;
    }
  });
}

// Tarjeta de sección; `list` son los elementos ya elegidos en la lista de Dentalink.
function section(title, { value = "", list = [] } = {}) {
  const heading = stub({ textContent: title });
  const header = stub({ children: [heading] });
  const textarea = stub({ value, offsetParent: {}, dispatchEvent() {} });
  const wrapper = stub({ children: [textarea] });
  const chips = list.map((text) => ({ previousElementSibling: { tagName: "SPAN", textContent: text } }));
  const card = stub({
    children: [header, wrapper],
    querySelectorAll(selector) { return selector === "i.fa-close" ? chips : []; }
  });
  textarea.parentElement = wrapper;
  wrapper.parentElement = card;
  return textarea;
}

function loadAnamnesis({ pathname = "/pacientes/7/ficha/antecedentes", textareas = [], extra = {} } = {}) {
  const timers = [];
  const intervals = [];
  const location = { pathname };
  let current = textareas;

  class HTMLTextAreaElement {}
  class HTMLInputElement {}
  class MutationObserver { observe() {} }

  const context = {
    location,
    HTMLTextAreaElement,
    HTMLInputElement,
    MutationObserver,
    console,
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
      querySelectorAll(selector) { return selector === "textarea" ? current : []; }
    },
    ...extra
  };
  context.window = context;
  context.__DLK_ANAM_TEST__ = true;
  vm.runInNewContext(source(), context);

  return {
    api: context.__dlkAnamTest,
    context,
    page: {
      location,
      setTextareas(list) { current = list; },
      flush() { while (timers.length) timers.shift()(); },
      tick() { intervals.forEach((fn) => fn()); }
    }
  };
}

module.exports = { loadAnamnesis, section, stub, source };
