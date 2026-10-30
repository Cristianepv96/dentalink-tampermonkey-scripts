const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

test("losartan en la lista y LOSARTAN en Otros cuentan una sola vez", () => {
  const s = api.estadoDesdeFicha({ Medicamentos: { lista: ["losartan"], texto: "LOSARTAN" } });
  assert.deepEqual([...s.meds], ["Losartán"]);
  assert.equal(s.med, true);
  assert.ok(s.hechos.has(3));
});

test("Hipertensión arterial del catálogo se reconoce como Hipertensión", () => {
  const s = api.estadoDesdeFicha({ Enfermedades: { lista: ["Hipertensión arterial"], texto: "" } });
  assert.deepEqual([...s.enfermedades], ["Hipertensión"]);
  assert.equal(s.enf, true);
});

test("NIEGA responde No y marca el paso", () => {
  const s = api.estadoDesdeFicha({ "Hábitos": { lista: [], texto: "NIEGA" } });
  assert.equal(s.tabaco, "No");
  assert.ok(s.hechos.has(4));
});

test("lo desconocido queda en previos sin perderse", () => {
  const s = api.estadoDesdeFicha({ Medicamentos: { lista: [], texto: "LOSARTAN, GOTAS PARA LOS OJOS" } });
  assert.deepEqual([...s.previos.Medicamentos], ["GOTAS PARA LOS OJOS"]);
  assert.deepEqual([...s.meds], ["Losartán"]);
});

test("ALERGIA A PENICILINA se reconoce; ASA I se ignora", () => {
  const s = api.estadoDesdeFicha({ "Alertas médicas": { lista: [], texto: "ASA I, ALERGIA A PENICILINA" } });
  assert.deepEqual([...s.alergias], ["Penicilina"]);
  assert.equal(s.previos["Alertas médicas"], undefined);
  assert.equal(s.alertas, true);
});

test("fichaVacia distingue paciente nuevo", () => {
  assert.equal(api.fichaVacia({ "Motivo de consulta": { lista: [], texto: '""' }, "Hábitos": { lista: [], texto: "" } }), true);
  assert.equal(api.fichaVacia({ Medicamentos: { lista: ["losartan"], texto: "" } }), false);
});
