const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

function conDiabetes(hba1c) {
  const s = api.crearEstado();
  s.enfermedades.add("Diabetes");
  s.det.Diabetes = { hba1c };
  return s;
}

test("HbA1c 7,5 es diabetes no controlada y ASA III", () => {
  const s = conDiabetes("7,5");
  assert.ok(api.alertasFinales(s).includes("DIABETES NO CONTROLADA (HBA1C 7,5 %)"));
  assert.equal(api.asaSugerido(s).asa, "ASA III");
});

test("HbA1c 7,4 solo avisa grado C, sin alerta", () => {
  const s = conDiabetes("7.4");
  const aviso = api.avisos(s).find((x) => /HbA1c/.test(x.titulo));
  assert.equal(aviso.tipo, "warn");
  assert.equal(aviso.alerta, undefined);
  assert.equal(api.asaSugerido(s).asa, "ASA II, CONTROLADA POR MEDICAMENTOS");
});

test("HbA1c vacía no genera aviso", () => {
  const s = conDiabetes("");
  assert.equal(api.avisos(s).filter((x) => /HbA1c|Diabetes/.test(x.titulo)).length, 0);
});

test("leerNumero acepta coma, punto y vacío", () => {
  assert.equal(api.leerNumero("7,55"), 7.55);
  assert.equal(api.leerNumero("7.5"), 7.5);
  assert.ok(Number.isNaN(api.leerNumero("")));
});

test("fmt usa coma decimal", () => {
  assert.equal(api.fmt(7.55), "7,6");
});

test("sin enfermedades es ASA I", () => {
  assert.equal(api.asaSugerido(api.crearEstado()).asa, "ASA I");
});

test("alendronato ≥ 4 años es riesgo alto de osteonecrosis", () => {
  const s = api.crearEstado();
  s.meds.add("Alendronato");
  s.enfermedades.add("Osteoporosis");
  s.det.Osteoporosis = { tiempo: "≥ 4 años" };
  assert.ok(api.alertasFinales(s).includes("RIESGO ALTO DE OSTEONECROSIS: ALENDRONATO (≥ 4 AÑOS)"));
});

test("alendronato < 4 años es riesgo bajo; denosumab siempre alto", () => {
  const s = api.crearEstado();
  s.meds.add("Alendronato");
  s.enfermedades.add("Osteoporosis");
  s.det.Osteoporosis = { tiempo: "< 4 años" };
  assert.ok(api.alertasFinales(s).includes("RIESGO DE OSTEONECROSIS: ALENDRONATO (< 4 AÑOS)"));

  const d = api.crearEstado();
  d.meds.add("Denosumab");
  assert.ok(api.alertasFinales(d).includes("RIESGO ALTO DE OSTEONECROSIS: DENOSUMAB"));
});

test("warfarina genera ANTICOAGULADO y nota de INR", () => {
  const s = api.crearEstado();
  s.meds.add("Warfarina");
  assert.ok(api.alertasFinales(s).includes("ANTICOAGULADO: WARFARINA"));
  assert.match(api.avisos(s).find((a) => /Anticoagulado/.test(a.titulo)).texto, /INR/);
});

test("amlodipino avisa agrandamiento sin alerta", () => {
  const s = api.crearEstado();
  s.meds.add("Amlodipino");
  const aviso = api.avisos(s).find((a) => /Agrandamiento/.test(a.titulo));
  assert.equal(aviso.tipo, "info");
  assert.equal(aviso.alerta, undefined);
});

test("cigarrillo 10–20 es grado C; 6–9 es grado B; cannabis solo no da grado", () => {
  const s = api.crearEstado();
  s.tabaco = "Fuma";
  s.fuma.add("Cigarrillo");
  s.cantidad = "10–20";
  assert.equal(api.gradoTabaco(s), "C (≥ 10 cigarrillos/día)");
  s.cantidad = "6–9";
  assert.equal(api.gradoTabaco(s), "B (< 10 cigarrillos/día)");

  const c = api.crearEstado();
  c.tabaco = "Fuma";
  c.fuma.add("Cannabis");
  assert.equal(api.gradoTabaco(c), null);
});

test("redacción de enfermedad actual y hábitos", () => {
  const s = api.crearEstado();
  s.sintomas.add("Sangrado al cepillado");
  s.sintomas.add("Movilidad dental");
  s.tiempo = "6 meses";
  assert.equal(api.enfermedadActual(s), "PACIENTE ACUDE A CITA DE VALORACIÓN POR PERIODONCIA REFIRIENDO SANGRADO AL CEPILLADO Y MOVILIDAD DENTAL DESDE HACE 6 MESES");
  s.tabaco = "Fuma";
  s.fuma.add("Cigarrillo");
  s.cantidad = "10–20";
  assert.deepEqual([...api.habitosFinales(s)], ["FUMA CIGARRILLO 10–20 AL DÍA"]);
});

test("HTA controlada se redacta completa", () => {
  const s = api.crearEstado();
  s.enfermedades.add("Hipertensión");
  s.det["Hipertensión"] = { control: "Sí" };
  assert.deepEqual([...api.enfermedadesFinales(s)], ["HIPERTENSION ARTERIAL CONTROLADA"]);
});
