const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

test("el paso de enfermedades muestra las frecuentes como tarjetas", () => {
  const s = api.crearEstado();
  s.enf = true;
  const html = api.PASOS[2].cuerpo(s);
  for (const e of ["Hipertensión", "Diabetes", "Osteoporosis"]) assert.match(html, new RegExp(`data-enf="${e}"`));
});

test("elegir HTA muestra su seguimiento y sus medicamentos", () => {
  const s = api.crearEstado();
  s.enf = true;
  s.enfermedades.add("Hipertensión");
  const html = api.PASOS[2].cuerpo(s);
  assert.match(html, /¿Está controlada\?/);
  assert.match(html, /data-med="Losartán"/);
});

test("los previos se ven como Ya en la ficha", () => {
  const s = api.crearEstado();
  s.med = true;
  s.previos.Medicamentos = ["GOTAS"];
  const html = api.PASOS[3].cuerpo(s);
  assert.match(html, /Ya en la ficha/);
  assert.match(html, /GOTAS/);
});

test("un paso hecho muestra su resumen", () => {
  const s = api.crearEstado();
  s.hechos.add(3);
  s.med = true;
  s.meds.add("Losartán");
  const html = api.htmlPanel(s, 0, false);
  const paso4 = html.slice(html.indexOf('data-i="3"'), html.indexOf('data-i="4"'));
  assert.match(paso4, /Losartán/);
  assert.match(paso4, /✓/);
});

test("plegado solo pinta la pestaña", () => {
  const html = api.htmlPanel(api.crearEstado(), 0, true);
  assert.match(html, /dlk-an-pestana/);
  assert.doesNotMatch(html, /Siguiente/);
});

test("la revisión final lista los cambios pendientes", () => {
  const s = api.crearEstado();
  s.enfermedades.add("Diabetes");
  s.det.Diabetes = { hba1c: "7,8" };
  const html = api.PASOS[7].cuerpo(s);
  assert.match(html, /ASA III/);
  assert.match(html, /DIABETES NO CONTROLADA \(HBA1C 7,8 %\)/);
});
