const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Evoluciones periodoncia.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.runGroup = completeEmptyTreatmentGroup;\n})();");
  const context = { window: { __dlkUtils: { watchPage() {} } }, document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(source, context);
  const events = [];
  const states = { principal: "completed", a: "pending", b: "pending" };
  const job = { scope: "patient|plan", principal: "principal", remaining: ["a", "b"], completed: [], cancelled: false };
  const driver = {
    scope: () => "patient|plan",
    read: key => states[key] ? { state: states[key] } : null,
    progress() {},
    open: key => events.push(`open:${key}`),
    awaitEditor: async key => ({ key }),
    empty: () => true,
    matches: (editor, key) => editor.key === key,
    save: (editor, key) => events.push(`save:${key}`),
    awaitSaved: async key => { states[key] = "completed"; events.push(`confirmed:${key}`); },
    done: count => events.push(`done:${count}`),
    stopped: (message, count) => events.push(`stopped:${count}:${message}`),
    ...overrides
  };
  return { job, driver, events, states, run: () => context.runGroup(job, driver) };
}

test("guarda secuencialmente solo después de confirmar la principal y cada restante", async () => {
  const f = setup();
  await f.run();
  assert.deepEqual(f.events, ["open:a", "save:a", "confirmed:a", "open:b", "save:b", "confirmed:b", "done:2"]);
});

test("sin guardado principal confirmado no abre ni guarda ninguna restante", async () => {
  const f = setup();
  f.states.principal = "pending";
  await f.run();
  assert.equal(f.events.length, 1);
  assert.match(f.events[0], /stopped:0:.*principal/);
});

for (const [name, override] of [
  ["contenido existente", { empty: () => false }],
  ["editor de otra prestación", { matches: () => false }],
  ["timeout de apertura", { awaitEditor: async () => { throw new Error("Tiempo agotado"); } }]
]) {
  test(`se detiene sin guardar ante ${name}`, async () => {
    const f = setup(override);
    await f.run();
    assert.equal(f.events.filter(e => e.startsWith("save:")).length, 0);
    assert.equal(f.events.filter(e => e.startsWith("open:")).length, 1);
    assert.match(f.events.at(-1), /^stopped:0:/);
  });
}

for (const kind of ["cancelación", "cambio de paciente", "prestación eliminada"]) {
  test(`revalida ${kind} después de esperar la apertura`, async () => {
    const f = setup();
    f.driver.awaitEditor = async key => {
      if (kind === "cancelación") f.job.cancelled = true;
      if (kind === "cambio de paciente") f.driver.scope = () => "otro|plan";
      if (kind === "prestación eliminada") delete f.states[key];
      return { key };
    };
    await f.run();
    assert.equal(f.events.filter(e => e.startsWith("save:")).length, 0);
    assert.match(f.events.at(-1), /^stopped:0:/);
  });
}

test("un guardado no confirmado no se repite ni permite avanzar al siguiente", async () => {
  const f = setup({ awaitSaved: async () => { throw new Error("Guardado no confirmado"); } });
  await f.run();
  assert.deepEqual(f.events.slice(0, 2), ["open:a", "save:a"]);
  assert.equal(f.events.length, 3);
  assert.match(f.events[2], /^stopped:0:/);
});

test("cancelar durante un guardado impide abrir la siguiente prestación", async () => {
  const f = setup();
  f.driver.awaitSaved = async key => { f.states[key] = "completed"; f.job.cancelled = true; };
  await f.run();
  assert.deepEqual(f.events.slice(0, 2), ["open:a", "save:a"]);
  assert.equal(f.events.length, 3);
});

function domFixture({ percent = "0", modalOpen = false, text = "", media = false, field = "" } = {}) {
  let clock = 0;
  const notices = [];
  const started = [];
  const cell = { textContent: "[242201] CURETAJE A CAMPO ABIERTO( CADA DIENTE)" };
  const circle = {};
  const row = {
    parentElement: {},
    querySelector: selector => selector.includes("row-nombre") ? cell : { textContent: "1.7" },
    querySelectorAll: () => percent === "0" ? [circle] : [],
    closest: () => ({ getAttribute: () => percent })
  };
  cell.parentElement = row;
  const editor = { textContent: text, querySelector: () => media ? {} : null };
  const button = { textContent: "Evolucionar (100%)", getAttribute: () => null };
  const modal = {
    querySelector: selector => selector === "#button-evolucionar-100" ? button : null,
    querySelectorAll: selector => selector.includes("ProseMirror") ? [editor] : [{ type: "text", disabled: false, value: field }]
  };
  const document = {
    body: row.parentElement, addEventListener() {},
    querySelectorAll: () => [cell],
    getElementById: id => id === "modalEvolution" && modalOpen ? modal : null
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Evoluciones periodoncia.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n showCompletionStatus = message => notices.push(message); completeEmptyTreatmentGroup = async job => started.push(job); globalThis.domTest = { readCompletionItem, nativeEvolution, editorIsEmpty, waitForSavedRow, previewRowKey, handleCompletionClick, observePrincipalEditor, setJob: job => completionJob = job };\n})();");
  class Element {
    constructor(selector) { this.selector = selector; }
    closest(selector) { return selector === this.selector ? this : null; }
  }
  const context = {
    Date: { now: () => clock }, document, notices, started, Element,
    location: { href: "https://demo.dentalink.cl/pacientes/1/tratamiento/2" },
    window: { __dlkUtils: { watchPage() {}, isVisible: () => true }, setTimeout: callback => { clock += 120; callback(); } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const api = context.domTest;
  const key = api.previewRowKey({ category: "open", cups: "242201", procedure: cell.textContent.replace(/^\[\d+\] /, ""), tooth: "17" });
  return { api, key, native: { modal, editor, button }, notices, started,
    event: (selector, isTrusted = true) => ({ target: new Element(selector), isTrusted }),
    makeJob: () => ({ scope: context.location.href, groupKey: JSON.parse(key)[0], allKeys: [key],
      principal: key, remaining: ["remaining"], completed: [], cancelled: false,
      phase: "opening-principal", armedAt: clock, native: null }),
    saved: () => { percent = "100"; modalOpen = false; }
  };
}

test("cerrar el modal sin pasar al 100% no confirma ningún guardado", async () => {
  const f = domFixture({ percent: "0", modalOpen: false });
  assert.equal(f.api.readCompletionItem(f.key).state, "pending");
  await assert.rejects(f.api.waitForSavedRow({}, f.key, () => {}), /no confirmó/);
});

test("requiere 100% estable y cierre del editor simultáneamente", async () => {
  const open = domFixture({ percent: "100", modalOpen: true });
  await assert.rejects(open.api.waitForSavedRow({}, open.key, () => {}), /no confirmó/);
  const closed = domFixture({ percent: "100", modalOpen: false });
  assert.equal(await closed.api.waitForSavedRow({}, closed.key, () => {}), true);
});

test("un porcentaje parcial no es pendiente elegible ni guardado completado", () => {
  const f = domFixture({ percent: "75" });
  assert.equal(f.api.readCompletionItem(f.key).state, "unknown");
});

test("el editor vacío excluye texto, contenido no textual y campos adicionales", () => {
  const empty = domFixture();
  assert.equal(empty.api.editorIsEmpty(empty.native), true);
  for (const options of [{ text: "Nota existente" }, { media: true }, { field: "Dato existente" }]) {
    const f = domFixture(options);
    assert.equal(f.api.editorIsEmpty(f.native), false);
  }
});

test("Insertar o un clic sintético no dispara el procesamiento del grupo", () => {
  const f = domFixture({ modalOpen: true, text: "Nota principal" });
  const job = f.makeJob();
  f.api.setJob(job);
  f.api.observePrincipalEditor();
  f.api.handleCompletionClick(f.event(".confirm"));
  f.api.handleCompletionClick(f.event("#button-evolucionar-100", false));
  assert.equal(job.phase, "principal-ready");
  assert.equal(f.started.length, 0);
});

test("solo el guardado nativo de la principal inicia el grupo tras el 100% y cierre", async () => {
  const f = domFixture({ modalOpen: true, text: "Nota principal" });
  const job = f.makeJob();
  f.api.setJob(job);
  f.api.handleCompletionClick(f.event("#button-evolucionar-100"));
  assert.equal(job.phase, "waiting-save");
  assert.equal(f.started.length, 0);
  f.saved();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(f.started.length, 1);
  assert.equal(f.started[0], job);
});

test("Cerrar o guardar una principal vacía no inicia el grupo", () => {
  for (const selector of ["#button-Cerrar", "#button-evolucionar-100"]) {
    const f = domFixture({ modalOpen: true });
    const job = f.makeJob();
    f.api.setJob(job);
    f.api.handleCompletionClick(f.event(selector));
    assert.equal(job.cancelled, true);
    assert.equal(f.started.length, 0);
  }
});
