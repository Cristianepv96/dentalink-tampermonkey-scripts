const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis, section, source } = require("./helpers/load-anamnesis");

const FICHA = "/pacientes/7/ficha/antecedentes";

test("se instala en todas las páginas del paciente", () => {
  const texto = source();
  assert.equal(texto.match(/@match\s+(\S+)/)[1], "https://*.dentalink.cl/pacientes/*");
  assert.equal(texto.match(/@version\s+(\S+)/)[1], "3.0.1");
});

test("ficha vacía abre el panel; con datos queda plegado", () => {
  const vacia = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos"), section("Hábitos")] });
  vacia.page.flush();
  assert.equal(vacia.api.panelEstado().montado, true);
  assert.equal(vacia.api.panelEstado().plegado, false);

  const conDatos = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos", { list: ["losartan"] }), section("Hábitos")] });
  conDatos.page.flush();
  assert.equal(conDatos.api.panelEstado().montado, true);
  assert.equal(conDatos.api.panelEstado().plegado, true);
  assert.ok(conDatos.api.panelEstado().estado.meds.has("Losartán"));
});

test("fuera de la ficha no se monta", () => {
  const { api, page } = loadAnamnesis({ pathname: "/pacientes/7/ficha/evoluciones", textareas: [section("Medicamentos")] });
  page.flush();
  assert.equal(api.panelEstado().montado, false);
});

test("al volver a la ficha sin recargar, el panel reaparece con lo respondido", () => {
  const { api, page } = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos")] });
  page.flush();
  api.panelEstado().estado.meds.add("Metformina");
  api.panelEstado().estado.tocado = true; // como al responder en el panel

  page.location.pathname = "/pacientes/7/ficha/evoluciones";
  page.tick();
  page.flush();
  assert.equal(api.panelEstado().montado, false);

  page.location.pathname = FICHA;
  page.setTextareas([section("Medicamentos")]);
  page.tick();
  page.flush();
  assert.equal(api.panelEstado().montado, true);
  assert.ok(api.panelEstado().estado.meds.has("Metformina"));
});

test("otro paciente empieza con su propia ficha", () => {
  const { api, page } = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos")] });
  page.flush();
  api.panelEstado().estado.meds.add("Metformina");

  page.location.pathname = "/pacientes/8/ficha/antecedentes";
  page.setTextareas([section("Medicamentos")]);
  page.tick();
  page.flush();
  assert.equal(api.panelEstado().estado.meds.has("Metformina"), false);
});

test("si la ficha termina de cargar después, el panel se actualiza mientras no se haya tocado", () => {
  const { api, page } = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos")] });
  page.flush();
  page.setTextareas([section("Medicamentos", { list: ["losartan"] })]);
  page.mutar();
  page.flush();
  assert.ok(api.panelEstado().estado.meds.has("Losartán"));
});

test("si ya se respondió algo, lo que cambie en la ficha no lo pisa", () => {
  const { api, page } = loadAnamnesis({ pathname: FICHA, textareas: [section("Medicamentos")] });
  page.flush();
  const estado = api.panelEstado().estado;
  estado.meds.add("Metformina");
  estado.tocado = true;
  page.setTextareas([section("Medicamentos", { list: ["losartan"] })]);
  page.mutar();
  page.flush();
  assert.equal(api.panelEstado().estado, estado);
  assert.ok(estado.meds.has("Metformina"));
});
