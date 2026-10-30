const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

test("no escribe NIEGA si la lista ya tiene medicamentos", () => {
  const ficha = { Medicamentos: { lista: ["losartan"], texto: "" } };
  const s = api.estadoDesdeFicha(ficha);
  s.med = false;
  const plan = api.planEscritura(s, ficha);
  assert.equal(plan.Medicamentos.texto, "");
  assert.deepEqual([...plan.Medicamentos.quitar], []);
});

test("escribe NIEGA cuando la sección queda vacía", () => {
  const ficha = { Medicamentos: { lista: [], texto: "" } };
  const s = api.estadoDesdeFicha(ficha);
  s.med = false;
  assert.equal(api.planEscritura(s, ficha).Medicamentos.texto, "NIEGA");
});

test("solo quita lo desmarcado explícitamente", () => {
  const ficha = { Medicamentos: { lista: ["losartan", "metformina"], texto: "" } };
  const s = api.estadoDesdeFicha(ficha);
  s.meds.delete("Metformina");
  const plan = api.planEscritura(s, ficha);
  assert.deepEqual([...plan.Medicamentos.quitar], ["metformina"]);
  assert.deepEqual([...plan.Medicamentos.marcar], []);
});

test("marca solo lo que la lista aún no tiene", () => {
  const ficha = { Enfermedades: { lista: ["Hipertensión arterial"], texto: "" } };
  const s = api.estadoDesdeFicha(ficha);
  s.enfermedades.add("Diabetes");
  assert.deepEqual([...api.planEscritura(s, ficha).Enfermedades.marcar], ["Diabetes"]);
});

test("agrega al texto existente sin duplicar y conserva lo desconocido", () => {
  const ficha = { "Hábitos": { lista: [], texto: "GOTAS, BRUXISMO NOCTURNO" } };
  const s = api.estadoDesdeFicha(ficha);
  s.alcohol = "Semanal";
  assert.equal(api.planEscritura(s, ficha)["Hábitos"].texto, "GOTAS, BRUXISMO NOCTURNO, ALCOHOL SEMANAL");
});

test("Alertas lleva el ASA y las alertas derivadas", () => {
  const ficha = { "Alertas médicas": { lista: [], texto: "ASA I" } };
  const s = api.estadoDesdeFicha(ficha);
  s.enfermedades.add("Diabetes");
  s.det.Diabetes = { hba1c: "8" };
  const texto = api.planEscritura(s, ficha)["Alertas médicas"].texto;
  assert.equal(texto, "ASA III, DIABETES NO CONTROLADA (HBA1C 8 %)");
});

test("no pisa un motivo ya escrito", () => {
  const ficha = { "Motivo de consulta": { lista: [], texto: "DOLOR" } };
  const s = api.estadoDesdeFicha(ficha);
  s.motivos.add("Dientes flojos");
  assert.equal(api.planEscritura(s, ficha)["Motivo de consulta"].texto, "DOLOR");
});
