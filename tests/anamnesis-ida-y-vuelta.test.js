const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAnamnesis } = require("./helpers/load-anamnesis");

const { api } = loadAnamnesis();

// Lo que Dentalink tendría tras aplicar el plan (las etiquetas nuevas se ven tal cual).
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

const vacia = () => Object.fromEntries([
  "Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades", "Medicamentos",
  "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"
].map((t) => [t, { lista: [], texto: "" }]));

// Escribe, vuelve a leer y vuelve a planear: la segunda vez no debe cambiar nada.
function idaYVuelta(preparar) {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  preparar(s);
  const escrita = escribir(ficha, api.planEscritura(s, ficha));
  const releida = api.estadoDesdeFicha(escrita);
  const otra = api.planEscritura(releida, escrita);
  for (const [titulo, paso] of Object.entries(otra)) {
    assert.deepEqual([...paso.quitar], [], `${titulo}: no quita nada`);
    assert.deepEqual([...paso.marcar], [], `${titulo}: no marca nada`);
    assert.equal(paso.texto, escrita[titulo].texto, `${titulo}: mismo texto`);
  }
  return { escrita, releida };
}

test("ida y vuelta: diabetes no controlada conserva HbA1c y ASA III", () => {
  const { escrita, releida } = idaYVuelta((s) => {
    s.enf = true; s.enfermedades.add("Diabetes"); s.det.Diabetes = { tipo: "Tipo 2", hba1c: "7,6" };
  });
  assert.equal(api.asaSugerido(releida).asa, "ASA III");
  assert.match(escrita["Alertas médicas"].texto, /DIABETES NO CONTROLADA \(HBA1C 7,6 %\)/);
  assert.deepEqual([...releida.previos["Alertas médicas"] || []], []);
});

test("ida y vuelta: cardiopatía con stent y válvula conserva ASA III y profilaxis", () => {
  const { releida } = idaYVuelta((s) => {
    s.enf = true; s.enfermedades.add("Cardiopatía"); s.det["Cardiopatía"] = { tipo: ["Stent", "Válvula protésica"] };
  });
  assert.equal(api.asaSugerido(releida).asa, "ASA III");
  assert.ok(api.alertasFinales(releida).some((a) => /PROFILAXIS/.test(a)));
});

test("ida y vuelta: ASA II no se duplica", () => {
  const { escrita } = idaYVuelta((s) => { s.enf = true; s.enfermedades.add("Hipotiroidismo"); });
  assert.equal(escrita["Alertas médicas"].texto, "ASA II, CONTROLADA POR MEDICAMENTOS");
});

test("ida y vuelta: hábitos con detalles", () => {
  const { releida } = idaYVuelta((s) => {
    s.tabaco = "Fuma"; s.fuma.add("Cigarrillo"); s.fuma.add("Cannabis"); s.cantidad = "> 20"; s.anios = "5–10 años"; s.cannabisFrec = "Diario";
    s.bruxismo = "Sí"; s.bruxTipo.add("Nocturno"); s.placa = "Sí";
  });
  assert.equal(releida.cantidad, "> 20");
  assert.equal(releida.anios, "5–10 años");
  assert.equal(releida.cannabisFrec, "Diario");
  assert.equal(releida.placa, "Sí");
});

test("ida y vuelta: exfumador y cepillado > 3", () => {
  const { releida } = idaYVuelta((s) => { s.tabaco = "Exfumador"; s.dejo = "1–5 años"; s.cepillado = "> 3"; });
  assert.equal(releida.dejo, "1–5 años");
  assert.equal(releida.cepillado, "> 3");
});

test("ida y vuelta: profilaxis y osteonecrosis de alto riesgo", () => {
  const { releida } = idaYVuelta((s) => {
    s.alertas = true; s.profilaxis.add("Endocarditis previa");
    s.enf = true; s.enfermedades.add("Osteoporosis"); s.det.Osteoporosis = { tiempo: "≥ 4 años" };
    s.med = true; s.meds.add("Alendronato");
  });
  assert.ok(releida.profilaxis.has("Endocarditis previa"));
  assert.equal(releida.det.Osteoporosis.tiempo, "≥ 4 años");
});

test("una alerta que no se puede rehacer se conserva", () => {
  const ficha = vacia();
  ficha["Alertas médicas"].texto = "ASA I, ANTICOAGULADO: WARFARINA, REQUIERE PROFILAXIS ANTIBIOTICA";
  ficha.Medicamentos.texto = "WARFARINA 5MG";
  const s = api.estadoDesdeFicha(ficha);
  const texto = api.planEscritura(s, ficha)["Alertas médicas"].texto;
  assert.match(texto, /ANTICOAGULADO: WARFARINA/);
  assert.match(texto, /REQUIERE PROFILAXIS ANTIBIOTICA/);
});

test("lo que llegó a la ficha después de leerla no se borra", () => {
  const s = api.estadoDesdeFicha(vacia());
  const ficha = vacia();
  ficha.Medicamentos = { lista: ["metformina"], texto: "WARFARINA, GOTAS" };
  ficha.Enfermedades = { lista: ["Hipertensión arterial"], texto: "" };
  const plan = api.planEscritura(s, ficha);
  assert.deepEqual([...plan.Medicamentos.quitar], []);
  assert.deepEqual([...plan.Enfermedades.quitar], []);
  assert.match(plan.Medicamentos.texto, /WARFARINA/);
  assert.doesNotMatch(plan.Enfermedades.texto, /NIEGA/);
});

test("una sección sin responder no se escribe como NIEGA ni ASA", () => {
  const ficha = vacia();
  const plan = api.planEscritura(api.estadoDesdeFicha(ficha), ficha);
  for (const titulo of ["Medicamentos", "Enfermedades", "Hábitos", "Antecedentes familiares", "Alertas médicas"]) {
    assert.equal(plan[titulo].texto, "", titulo);
  }
});

test("la etiqueta NIEGA de la lista se quita cuando hay datos", () => {
  const ficha = vacia();
  ficha["Hábitos"].lista = ["NIEGA"];
  ficha["Alertas médicas"].lista = ["NIEGA"];
  const s = api.estadoDesdeFicha(ficha);
  s.tabaco = "Fuma"; s.fuma.add("Cigarrillo");
  s.alertas = true; s.alergias.add("Penicilina");
  const plan = api.planEscritura(s, ficha);
  assert.deepEqual([...plan["Hábitos"].quitar], ["NIEGA"]);
  assert.deepEqual([...plan["Alertas médicas"].quitar], ["NIEGA"]);
});

test("una etiqueta de hábito que ya no aplica se quita y la vigente no se duplica", () => {
  const ficha = vacia();
  ficha["Hábitos"].lista = ["FUMADOR", "Bruxismo"];
  const s = api.estadoDesdeFicha(ficha);
  s.tabaco = "Exfumador";
  s.fuma.clear();
  const plan = api.planEscritura(s, ficha);
  assert.deepEqual([...plan["Hábitos"].quitar], ["FUMADOR"]);
  assert.equal(plan["Hábitos"].texto, "EXFUMADOR");
});

test("una etiqueta desconocida de la lista no se copia al texto", () => {
  const ficha = vacia();
  ficha.Medicamentos.lista = ["LOSARTAN 50 MG"];
  const s = api.estadoDesdeFicha(ficha);
  assert.equal(api.planEscritura(s, ficha).Medicamentos.texto, "");
});

test("responder No borra lo elegido en esa sección", () => {
  const s = api.crearEstado();
  s.meds.add("Losartán");
  s.med = true;
  api.responder(s, "med", false);
  assert.equal(s.meds.size, 0);
  assert.equal(s.med, false);
});

test("enfermedades parecidas no se confunden", () => {
  const ficha = vacia();
  ficha.Enfermedades.lista = ["HIPERTENSION PULMONAR", "DIABETES INSIPIDA"];
  const s = api.estadoDesdeFicha(ficha);
  assert.equal(s.enfermedades.size, 0);
  assert.deepEqual([...api.planEscritura(s, ficha).Enfermedades.marcar], []);
});

test("diabetes tipo 1 busca su propio nombre en la lista", () => {
  const ficha = vacia();
  const s = api.estadoDesdeFicha(ficha);
  s.enf = true; s.enfermedades.add("Diabetes"); s.det.Diabetes = { tipo: "Tipo 1" };
  const plan = api.planEscritura(s, ficha);
  assert.ok(plan.Enfermedades.alias.Diabetes.includes("DIABETES MELLITUS TIPO 1"));
  assert.ok(!plan.Enfermedades.alias.Diabetes.includes("DIABETES MELLITUS TIPO 2"));
});
