const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Tarjeta de Dentalink con su desplegable «Añadir …»: buscador, casillas, Aceptar,
// y también «Nuevo …» y papeleras, que el script nunca debe tocar.
function tarjeta(titulo, { catalogo = [], elegidos = [], texto = "", responde = true, clics, alAceptar, alAbrir } = {}) {
  const el = (props = {}) => ({ children: [], textContent: "", parentElement: null, ...props });
  const chips = [];
  const card = el();
  const agregarChip = (label) => {
    const icon = el({ previousElementSibling: { tagName: "SPAN", textContent: label } });
    icon.click = () => { clics.push(`quitar:${label}`); chips.splice(chips.indexOf(icon), 1); };
    chips.push(icon);
  };
  elegidos.forEach(agregarChip);

  let filas = [];
  const buscador = el({ value: "", dispatchEvent() {
    filas = responde ? catalogo.filter((c) => norm(c).includes(norm(buscador.value))).map((c) => {
      const box = el({ checked: elegidos.includes(c) });
      box.parentElement = el({ textContent: c });
      box.click = () => { clics.push(`casilla:${c}`); box.checked = !box.checked; };
      return box;
    }) : [];
  } });
  const nuevo = el({ textContent: "Nuevo medicamento", click: () => clics.push("nuevo") });
  const papelera = el({ click: () => clics.push("papelera") });
  const aceptar = el({ textContent: "Aceptar", click: () => {
    clics.push("aceptar");
    filas.filter((f) => f.checked && !chips.some((c) => c.previousElementSibling.textContent === f.parentElement.textContent))
      .forEach((f) => agregarChip(f.parentElement.textContent));
    panel.offsetParent = null;
    alAceptar?.();
  } });
  const panel = el({
    offsetParent: null,
    contains: (n) => n === nuevo || n === papelera || filas.includes(n),
    querySelector: (sel) => (sel.startsWith("input:not") ? buscador : null),
    querySelectorAll: (sel) => sel === "input[type=checkbox]" ? filas : sel === "footer *" ? [aceptar] : sel === "i.fa-trash" ? [papelera] : []
  });
  const boton = el({ textContent: `Añadir ${titulo.toLowerCase()}`, click: () => { clics.push("abrir"); panel.offsetParent = {}; alAbrir?.(); } });
  boton.parentElement = el();
  boton.parentElement.nextElementSibling = panel;

  const heading = el({ textContent: titulo });
  const header = el({ children: [heading] });
  const textarea = el({ value: texto, offsetParent: {}, dispatchEvent() {} });
  const wrapper = el({ children: [textarea] });
  textarea.parentElement = wrapper;
  wrapper.parentElement = card;
  Object.assign(card, {
    children: [header, wrapper],
    querySelectorAll: (sel) => sel === "button" ? [boton] : sel === "i.fa-close" ? [...chips] : [],
    querySelector: () => null
  });
  return { textarea, chips: () => chips.map((c) => c.previousElementSibling.textContent) };
}

function cargar(tarjetas, pathname = "/pacientes/7/ficha/antecedentes") {
  return loadAnamnesis({
    pathname,
    textareas: tarjetas.map((t) => t.textarea),
    extra: { setTimeout, clearTimeout, setInterval() { return 0; } }
  });
}

test("marca en la lista lo que existe y manda a texto lo que no", async () => {
  const clics = [];
  const meds = tarjeta("Medicamentos", { catalogo: ["METFORMINA", "Metformina.", "hipertensión"], clics });
  const { api } = cargar([meds]);
  const r = await api.aplicarPlan({ Medicamentos: { marcar: ["Metformina", "Pregabalina"], quitar: [], texto: "" } }, { ruta: "/pacientes/7/ficha/antecedentes" });
  assert.deepEqual([...r.marcados], ["Metformina"]);
  assert.deepEqual([...r.aTexto], ["Pregabalina"]);
  assert.deepEqual(meds.chips(), ["METFORMINA"]);
  assert.equal(meds.textarea.value, "PREGABALINA");
});

test("nunca pulsa Nuevo ni la papelera", async () => {
  const clics = [];
  const meds = tarjeta("Medicamentos", { catalogo: ["METFORMINA"], elegidos: ["losartan"], clics });
  const { api } = cargar([meds]);
  await api.aplicarPlan({ Medicamentos: { marcar: ["Metformina"], quitar: ["losartan"], texto: "" } }, { ruta: "/pacientes/7/ficha/antecedentes" });
  assert.ok(!clics.includes("nuevo"));
  assert.ok(!clics.includes("papelera"));
  assert.deepEqual(meds.chips(), ["METFORMINA"]);
});

test("si el buscador no responde, a los 3 s cierra y sigue", async () => {
  const clics = [];
  const meds = tarjeta("Medicamentos", { catalogo: ["METFORMINA"], responde: false, clics });
  const { api } = cargar([meds]);
  const r = await api.aplicarPlan({ Medicamentos: { marcar: ["Metformina"], quitar: [], texto: "" } }, { ruta: "/pacientes/7/ficha/antecedentes" });
  assert.deepEqual([...r.aTexto], ["Metformina"]);
  assert.equal(meds.textarea.value, "METFORMINA");
});

test("si la ruta cambia a mitad, se cancela", async () => {
  const clics = [];
  let page;
  const meds = tarjeta("Medicamentos", { catalogo: ["METFORMINA", "ATORVASTATINA"], clics,
    alAceptar: () => { page.location.pathname = "/pacientes/7/ficha/evoluciones"; } });
  const loaded = cargar([meds]);
  page = loaded.page;
  const r = await loaded.api.aplicarPlan({ Medicamentos: { marcar: ["Metformina", "Atorvastatina"], quitar: [], texto: "OTRO" } }, { ruta: "/pacientes/7/ficha/antecedentes" });
  assert.equal(r.cancelado, true);
  assert.ok(!clics.includes("casilla:ATORVASTATINA"));
  assert.equal(meds.textarea.value, "");
});

test("leerSecciones junta etiquetas y texto por sección", () => {
  const meds = tarjeta("Medicamentos", { elegidos: ["losartan"], texto: "ASA", clics: [] });
  const { api } = cargar([meds]);
  const secciones = api.leerSecciones();
  assert.deepEqual([...secciones.Medicamentos.lista], ["losartan"]);
  assert.equal(secciones.Medicamentos.texto, "ASA");
});

test("si la ruta cambia mientras busca, no marca nada", async () => {
  const clics = [];
  let page;
  const meds = tarjeta("Medicamentos", { catalogo: ["METFORMINA"], clics,
    alAbrir: () => { page.location.pathname = "/pacientes/8/ficha/antecedentes"; } });
  const loaded = cargar([meds]);
  page = loaded.page;
  const r = await loaded.api.aplicarPlan({ Medicamentos: { marcar: ["Metformina"], quitar: [], alias: {}, texto: "" } }, { ruta: "/pacientes/7/ficha/antecedentes" });
  assert.equal(r.cancelado, true);
  assert.ok(!clics.includes("casilla:METFORMINA"));
  assert.ok(!clics.includes("aceptar"));
});
