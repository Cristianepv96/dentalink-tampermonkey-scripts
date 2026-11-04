const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

const vacia = () => Object.fromEntries([
  "Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades", "Medicamentos",
  "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"
].map((t) => [t, { lista: [], texto: "" }]));

function escribir(ficha, plan) {
  const nueva = {};
  for (const [titulo, seccion] of Object.entries(ficha)) {
    const paso = plan[titulo] || { marcar: [], quitar: [], texto: seccion.texto };
    nueva[titulo] = {
      lista: [...seccion.lista.filter((x) => !paso.quitar.includes(x)), ...paso.marcar.map((x) => x.toUpperCase())],
      texto: paso.texto
    };
  }
  return nueva;
}

// ── 1. Motivo de consulta siempre entre comillas ──
test("motivo elegido con botones va entre comillas", () => {
  const s = api.crearEstado();
  s.motivos.add("Sangrado de encías");
  assert.equal(api.motivoFinal(s), "\"SANGRADO DE ENCÍAS\"");
});

test("motivo en palabras del paciente no duplica comillas", () => {
  const s = api.crearEstado();
  s.motivoTexto = "\"me sangran las encías\"";
  assert.equal(api.motivoFinal(s), "\"me sangran las encías\" RELATA EL PACIENTE");
});

test("motivo ya escrito sin comillas se pone entre comillas", () => {
  const ficha = { "Motivo de consulta": { lista: [], texto: "DOLOR" } };
  const s = api.estadoDesdeFicha(ficha);
  assert.equal(api.planEscritura(s, ficha)["Motivo de consulta"].texto, "\"DOLOR\"");
});

test("motivo ya entre comillas no se toca", () => {
  const ficha = { "Motivo de consulta": { lista: [], texto: "\"me duele\" RELATA EL PACIENTE" } };
  const s = api.estadoDesdeFicha(ficha);
  assert.equal(api.planEscritura(s, ficha)["Motivo de consulta"].texto, "\"me duele\" RELATA EL PACIENTE");
});

// ── 2. ASA II sin medicamentos no dice «controlada por medicamentos» ──
test("enfermedad sin medicamentos: ASA II a secas", () => {
  const s = api.crearEstado();
  s.enf = true; s.enfermedades.add("Hipotiroidismo");
  s.med = false;
  assert.equal(api.asaSugerido(s).asa, "ASA II");
});

test("enfermedad con medicamentos: ASA II controlada por medicamentos", () => {
  const s = api.crearEstado();
  s.enf = true; s.enfermedades.add("Hipotiroidismo");
  s.med = true; s.meds.add("Levotiroxina");
  assert.equal(api.asaSugerido(s).asa, "ASA II, CONTROLADA POR MEDICAMENTOS");
});

test("ficha con ASA II controlada pero medicamentos NIEGA se corrige", () => {
  const ficha = vacia();
  ficha["Alertas médicas"].texto = "ASA II, CONTROLADA POR MEDICAMENTOS";
  ficha.Enfermedades.lista = ["HIPOTIROIDISMO"];
  ficha.Medicamentos.texto = "NIEGA";
  const s = api.estadoDesdeFicha(ficha);
  assert.equal(api.planEscritura(s, ficha)["Alertas médicas"].texto, "ASA II");
});

// ── 3. Higiene oral va en Hábitos ──
test("cepillado, seda y enjuague se escriben en Hábitos", () => {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  s.tabaco = "No"; s.cepillado = "3"; s.seda = "No"; s.enjuague = "No"; s.limpieza = "> 1 año";
  const plan = api.planEscritura(s, ficha);
  assert.equal(plan["Hábitos"].texto, "CEPILLADO 3 VECES AL DIA, NO USA SEDA DENTAL, NO USA ENJUAGUE");
  assert.equal(plan["Antecedentes odontológicos"].texto, "ULTIMA PROFILAXIS: > 1 AÑO");
});

test("ficha vieja con higiene en odontológicos la pasa a Hábitos", () => {
  const ficha = vacia();
  ficha["Hábitos"].texto = "NIEGA";
  ficha["Antecedentes odontológicos"].texto = "CEPILLADO 3 VECES AL DIA, NO USA SEDA DENTAL, NO USA ENJUAGUE";
  const s = api.estadoDesdeFicha(ficha);
  const plan = api.planEscritura(s, ficha);
  assert.equal(plan["Hábitos"].texto, "CEPILLADO 3 VECES AL DIA, NO USA SEDA DENTAL, NO USA ENJUAGUE");
  assert.equal(plan["Antecedentes odontológicos"].texto, "");
});

test("ida y vuelta de la higiene en Hábitos no cambia nada", () => {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  s.tabaco = "Fuma"; s.fuma.add("Cigarrillo"); s.cepillado = "2"; s.seda = "Sí";
  const escrita = escribir(ficha, api.planEscritura(s, ficha));
  const releida = api.estadoDesdeFicha(escrita);
  assert.equal(releida.cepillado, "2");
  assert.equal(releida.seda, "Sí");
  const otra = api.planEscritura(releida, escrita);
  for (const [titulo, paso] of Object.entries(otra)) {
    assert.deepEqual([...paso.quitar], [], `${titulo}: no quita nada`);
    assert.equal(paso.texto, escrita[titulo].texto, `${titulo}: mismo texto`);
  }
});

// ── 4. Antecedentes familiares: qué familiar ──
test("familiar con parentesco se escribe con quién lo tiene", () => {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  s.fam = true; s.familiares.add("Periodontitis"); s.familiares.add("Diabetes");
  s.famQuien = { Periodontitis: ["Madre", "Tíos"] };
  const plan = api.planEscritura(s, ficha);
  assert.deepEqual([...plan["Antecedentes familiares"].marcar], ["Periodontitis", "Diabetes"]);
  assert.equal(plan["Antecedentes familiares"].texto, "PERIODONTITIS (MADRE, TÍOS)");
});

test("parentesco se relee y no cambia en la segunda pasada", () => {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  s.fam = true; s.familiares.add("Periodontitis");
  s.famQuien = { Periodontitis: ["Padre"] };
  const escrita = escribir(ficha, api.planEscritura(s, ficha));
  const releida = api.estadoDesdeFicha(escrita);
  assert.deepEqual([...releida.famQuien.Periodontitis], ["Padre"]);
  assert.deepEqual([...(releida.previos["Antecedentes familiares"] || [])], []);
  const otra = api.planEscritura(releida, escrita)["Antecedentes familiares"];
  assert.deepEqual([...otra.quitar], []);
  assert.deepEqual([...otra.marcar], []);
  assert.equal(otra.texto, "PERIODONTITIS (PADRE)");
});

test("cambiar el familiar reemplaza el texto anterior", () => {
  const ficha = vacia();
  ficha["Antecedentes familiares"] = { lista: ["PERIODONTITIS"], texto: "PERIODONTITIS (PADRE)" };
  const s = api.estadoDesdeFicha(ficha);
  s.famQuien.Periodontitis = ["Madre"];
  assert.equal(api.planEscritura(s, ficha)["Antecedentes familiares"].texto, "PERIODONTITIS (MADRE)");
});
