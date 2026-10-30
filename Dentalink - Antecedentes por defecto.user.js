// ==UserScript==
// @name         Dentalink - Antecedentes por defecto
// @namespace    https://odontofamily.local/dentalink-antecedentes
// @version      2.1.0
// @description  Anamnesis rápida: textos base, botón "Sin antecedentes", botones por enfermedad y medicamentos, y casillas de antecedentes odontológicos.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ─── Configuración (editable) ───────────────────────────────────────────
  // Textos que se ponen solos UNA vez al abrir la ficha, solo si el campo está vacío.
  // Si borras el texto a propósito, no se vuelve a poner.
  const AUTO_DEFAULTS = {
    "Motivo de consulta": "\"\"",
    "Enfermedad actual": "PACIENTE ACUDE A CITA DE VALORACION POR PERIODONCIA REFIRIENDO "
  };

  // Botón "Sin antecedentes": llena solo los campos vacíos.
  const SIN_ANTECEDENTES = {
    "Alertas médicas": "ASA I",
    "Enfermedades": "NIEGA",
    "Medicamentos": "NIEGA",
    "Hábitos": "NIEGA",
    "Antecedentes familiares": "NIEGA"
  };

  // Botones por enfermedad: agregan la enfermedad, ajustan alertas y
  // resaltan sus medicamentos habituales.
  const CONDICIONES = [
    { label: "HTA", enfermedad: "HIPERTENSION", meds: ["LOSARTAN", "AMLODIPINO", "HIDROCLOROTIAZIDA", "METOPROLOL"] },
    { label: "Dislipidemia", enfermedad: "DISLIPIDEMIA", meds: ["ATORVASTATINA", "ROSUVASTATINA"] },
    { label: "Diabetes", enfermedad: "DIABETES", meds: ["METFORMINA", "INSULINA"] },
    { label: "Hipotiroidismo", enfermedad: "HIPOTIROIDISMO", meds: ["LEVOTIROXINA"] }
  ];
  const ALERTA_CONTROLADA = "ASA II, CONTROLADA POR MEDICAMENTOS";

  const MEDICAMENTOS = [
    "LOSARTAN", "AMLODIPINO", "HIDROCLOROTIAZIDA", "METOPROLOL",
    "ATORVASTATINA", "ROSUVASTATINA", "METFORMINA", "INSULINA",
    "LEVOTIROXINA", "ASA", "PREGABALINA", "TAMSULOSINA"
  ];

  const ANTECEDENTES_ODONTO = [
    "ODONTOLOGIA GENERAL", "RESTAURACIONES", "REHABILITACION", "EXODONCIAS",
    "ORTODONCIA", "PERIODONCIA", "ENDODONCIA", "CIRUGIA"
  ];

  // Botones simples por sección (se agregan al texto).
  const CHIPS = {
    "Alertas médicas": ["ASA I", "ASA II", "CONTROLADA POR MEDICAMENTOS"],
    "Enfermedades": ["NIEGA"],
    "Medicamentos": ["NIEGA"],
    "Hábitos": ["NIEGA", "EXFUMADOR", "FUMADOR", "BRUXISMO"],
    "Antecedentes familiares": ["NIEGA"]
  };

  // Nombres con que aparecen en la lista de Dentalink (además del propio texto).
  const LISTA_ALIAS = {
    "HIPERTENSION": ["HIPERTENSION ARTERIAL"],
    "DIABETES": ["DIABETES MELLITUS"],
    "EXODONCIAS": ["EXODONCIA"],
    "RESTAURACIONES": ["RESTAURACION"],
    "EXFUMADOR": ["EXFUMADORA"],
    "FUMADOR": ["FUMADORA"]
  };

  // Secciones cuyos botones marcan primero la lista de Dentalink.
  const SECCIONES_CON_LISTA = ["Enfermedades", "Medicamentos", "Hábitos", "Antecedentes odontológicos"];

  // Valores que significan "nada": se reemplazan al agregar algo.
  const VACIOS = /^(NIEGA|NO REFIERE|NO RELATA|NO|N\/A|NO APLICA)?\.?$/i;
  const SIN_DATO_REAL = /^(ASA I|NIEGA|NO REFIERE|NO RELATA|NO|NO ALERGIA)$/;

  // ═══ 1. Contenido clínico (validado por el periodoncista) ════════════════
  const MOTIVOS = [
    { t: "Sangrado de encías", sint: ["Sangrado al cepillado"] },
    { t: "Dientes flojos", sint: ["Movilidad dental"] },
    { t: "Remitido por odontología general", sint: [] },
    { t: "Control periodontal", sint: [] },
    { t: "Encías retraídas", sint: ["Retracción de encías"] },
    { t: "Mal aliento", sint: ["Mal aliento"] },
    { t: "Valoración para implantes", sint: [] },
    { t: "Valoración antes de ortodoncia", sint: [] }
  ];
  const SINTOMAS = ["Sangrado al cepillado", "Encías inflamadas", "Movilidad dental", "Mal aliento", "Sensibilidad dental",
    "Retracción de encías", "Dolor de encías", "Separación de dientes", "Pus en encías"];
  const TIEMPOS = ["Semanas", "1 mes", "3 meses", "6 meses", "1 año", "Más de 1 año"];

  // Enfermedades: `comun` sale como tarjeta grande; `meds` alimenta Medicamentos;
  // `preguntas` es el seguimiento que aparece al elegirla.
  const ENF = {
    "Hipertensión": { comun: true, corto: "HTA",
      meds: ["Losartán", "Amlodipino", "Enalapril", "Hidroclorotiazida", "Valsartán", "Metoprolol"],
      preguntas: [{ k: "control", q: "¿Está controlada?", op: ["Sí", "No", "No sabe"] }] },
    "Diabetes": { comun: true, corto: "DM",
      meds: ["Metformina", "Insulina", "Glibenclamida", "Sitagliptina", "Empagliflozina"],
      preguntas: [{ k: "tipo", q: "Tipo", op: ["Tipo 2", "Tipo 1"] }, { k: "hba1c", q: "Última hemoglobina glicada", input: "%" }] },
    "Hipotiroidismo": { comun: true, meds: ["Levotiroxina"] },
    "Dislipidemia": { comun: true, meds: ["Atorvastatina", "Rosuvastatina", "Lovastatina"] },
    "Osteoporosis": { comun: true,
      meds: ["Alendronato", "Ibandronato", "Ácido zoledrónico", "Denosumab", "Calcio + vitamina D"],
      preguntas: [{ k: "tiempo", q: "¿Desde hace cuánto recibe el antirresortivo?", op: ["< 4 años", "≥ 4 años", "Ya lo suspendió"] }] },
    "Cardiopatía": { comun: true,
      meds: ["ASA", "Clopidogrel", "Warfarina", "Apixabán", "Rivaroxabán", "Atorvastatina"],
      preguntas: [{ k: "tipo", q: "¿Qué tiene?", op: ["Arritmia", "Infarto previo", "Stent", "Válvula protésica", "Falla cardíaca"], multi: true }] },
    "Gastritis": { meds: ["Omeprazol", "Esomeprazol"] },
    "Ansiedad / depresión": { meds: ["Sertralina", "Fluoxetina", "Escitalopram", "Clonazepam", "Amitriptilina"] },
    "Asma": { meds: ["Salbutamol", "Beclometasona"] },
    "Artritis reumatoide": { meds: ["Metotrexato", "Prednisolona"] },
    "Epilepsia": { meds: ["Fenitoína", "Carbamazepina", "Ácido valproico"] },
    "Enfermedad renal": { meds: [] },
    "Trastorno de coagulación": { meds: [] },
    "VIH": { meds: ["Antirretrovirales"] },
    "Hepatitis": { meds: [] },
    "Cáncer en tratamiento": { meds: [] }
  };

  // Lo que cada medicamento implica en periodoncia.
  const MED_INFO = {
    "Warfarina": { grupo: "anticoag", nota: "Pedir INR reciente antes de RAR o cirugía." },
    "Apixabán": { grupo: "anticoag", nota: "Anticoagulante directo: coordinar horario de la dosis." },
    "Rivaroxabán": { grupo: "anticoag", nota: "Anticoagulante directo: coordinar horario de la dosis." },
    "Clopidogrel": { grupo: "antiagreg" },
    "ASA": { grupo: "antiagreg" },
    "Alendronato": { grupo: "antirresortivo", via: "oral" },
    "Ibandronato": { grupo: "antirresortivo", via: "oral" },
    "Risedronato": { grupo: "antirresortivo", via: "oral" },
    "Ácido zoledrónico": { grupo: "antirresortivo", via: "IV" },
    "Denosumab": { grupo: "antirresortivo", via: "subcutáneo" },
    "Amlodipino": { grupo: "agrandamiento" }, "Nifedipino": { grupo: "agrandamiento" },
    "Ciclosporina": { grupo: "agrandamiento" }, "Fenitoína": { grupo: "agrandamiento" },
    "Prednisolona": { grupo: "inmuno" }, "Metotrexato": { grupo: "inmuno" },
    "Sertralina": { grupo: "xerostomia" }, "Fluoxetina": { grupo: "xerostomia" }, "Escitalopram": { grupo: "xerostomia" },
    "Clonazepam": { grupo: "xerostomia" }, "Amitriptilina": { grupo: "xerostomia" },
    "Insulina": { grupo: "hipoglucemia" }, "Glibenclamida": { grupo: "hipoglucemia" }
  };
  const MEDS_FRECUENTES = ["ASA", "Acetaminofén", "Omeprazol", "Losartán", "Metformina", "Levotiroxina", "Atorvastatina"];
  const MEDS_TODOS = [...new Set([...Object.values(ENF).flatMap((e) => e.meds), ...Object.keys(MED_INFO), ...MEDS_FRECUENTES,
    "Ibuprofeno", "Naproxeno", "Loratadina", "Cetirizina", "Anticonceptivos orales", "Tamsulosina", "Pregabalina",
    "Gabapentina", "Furosemida", "Espironolactona", "Carvedilol", "Propranolol"])].sort();

  const ALERGIAS = [
    { t: "Penicilina", alt: "Usar clindamicina o azitromicina" },
    { t: "AINEs", alt: "Analgesia con acetaminofén" },
    { t: "Anestésicos locales" }, { t: "Látex" }, { t: "Clorhexidina" }, { t: "Sulfas" }
  ];
  const PROFILAXIS = ["Válvula cardíaca protésica", "Endocarditis previa", "Cardiopatía congénita", "Prótesis articular < 2 años"];

  const FUMA = ["Cigarrillo", "Cannabis", "Vapeador", "Tabaco / pipa", "Otro"];
  const CANTIDAD = ["1–5", "6–9", "10–20", "> 20"];
  const ANIOS = ["< 1 año", "1–5 años", "5–10 años", "> 10 años"];
  const DEJO = ["< 1 año", "1–5 años", "> 5 años"];
  const FRECUENCIA = ["Ocasional", "Semanal", "Diario"];
  const OTROS_HAB = ["Respiración oral", "Onicofagia", "Morder objetos", "Piercing oral", "Estrés"];

  const ODONTO = ["Periodoncia previa", "Exodoncias", "Exodoncias por movilidad", "Restauraciones", "Endodoncia",
    "Ortodoncia", "Implantes", "Prótesis", "Cirugía oral"];
  const LIMPIEZA = ["< 6 meses", "6–12 meses", "> 1 año", "Nunca"];
  const FAMILIARES = ["Periodontitis", "Pérdida dental temprana", "Diabetes", "Hipertensión", "Cardiopatía", "Cáncer"];

  const HBA1C_NO_CONTROLADA = 7.5;

  // ═══ 2. Derivaciones: lo que se deduce de las respuestas ═════════════════
  function crearEstado() {
    return {
      motivos: new Set(), motivoTexto: "", sintomas: new Set(), tiempo: "",
      alertas: null, alergias: new Set(), embarazo: "", semanas: "", profilaxis: new Set(),
      enf: null, enfermedades: new Set(), det: {},
      med: null, meds: new Set(), medDesde: {},
      tabaco: "", fuma: new Set(), cantidad: "", anios: "", cannabisFrec: "", vapeoFrec: "", dejo: "",
      alcohol: "", bruxismo: "", bruxTipo: new Set(), placa: "", otrosHab: new Set(),
      odontologicos: new Set(), limpieza: "", cepillado: "", seda: "", enjuague: "",
      fam: null, familiares: new Set(),
      previos: {}, hechos: new Set()
    };
  }

  const up = (t) => String(t).toUpperCase();
  const det = (s, enf) => s.det[enf] || {};
  // Números a la colombiana: coma decimal y un solo decimal.
  const fmt = (n) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
  const leerNumero = (t) => (String(t ?? "").trim() ? Number(String(t).replace(",", ".")) : NaN);
  const hba1c = (s) => leerNumero(det(s, "Diabetes").hba1c);

  function enfermedadActual(s) {
    const sint = [...s.sintomas];
    if (!sint.length) return "PACIENTE ACUDE A CITA DE VALORACIÓN POR PERIODONCIA";
    const txt = sint.length > 1 ? `${sint.slice(0, -1).join(", ")} y ${sint.at(-1)}` : sint[0];
    return up(`Paciente acude a cita de valoración por periodoncia refiriendo ${txt}${s.tiempo ? ` desde hace ${s.tiempo}` : ""}`);
  }

  function motivoFinal(s) {
    if (s.motivoTexto) return `"${s.motivoTexto}" RELATA EL PACIENTE`;
    return up([...s.motivos].join(", "));
  }

  // Avisos con su gravedad y, si corresponde, el texto que va a Alertas médicas.
  function avisos(s) {
    const out = [];
    const meds = [...s.meds];
    const grupo = (g) => meds.filter((m) => MED_INFO[m]?.grupo === g);

    const anticoag = grupo("anticoag");
    if (anticoag.length) out.push({ tipo: "danger", titulo: `Anticoagulado (${anticoag.join(", ")})`,
      texto: anticoag.map((m) => MED_INFO[m].nota).join(" "), alerta: `ANTICOAGULADO: ${up(anticoag.join(", "))}` });
    const antiagreg = grupo("antiagreg");
    if (antiagreg.length) out.push({ tipo: "warn", titulo: `Antiagregante (${antiagreg.join(", ")})`,
      texto: "Mayor sangrado en RAR y cirugía; no suspender sin indicación médica.", alerta: `ANTIAGREGADO: ${up(antiagreg.join(", "))}` });

    const anti = grupo("antirresortivo");
    if (anti.length) {
      const tiempo = det(s, "Osteoporosis").tiempo;
      const alto = anti.some((m) => MED_INFO[m].via !== "oral") || tiempo === "≥ 4 años";
      out.push({ tipo: alto ? "danger" : "warn",
        titulo: `${alto ? "Riesgo ALTO" : "Riesgo"} de osteonecrosis (${anti.join(", ")})`,
        texto: alto ? "Vía IV/subcutánea o ≥ 4 años: evitar exodoncias y cirugía ósea; interconsulta."
          : "Oral < 4 años: riesgo bajo; consentimiento informado antes de cirugía.",
        alerta: `${alto ? "RIESGO ALTO" : "RIESGO"} DE OSTEONECROSIS: ${up(anti.join(", "))}${tiempo ? ` (${up(tiempo)})` : ""}` });
    }
    const agr = grupo("agrandamiento");
    if (agr.length) out.push({ tipo: "info", titulo: `Agrandamiento gingival posible (${agr.join(", ")})`, texto: "Considerar el medicamento en el diagnóstico." });
    const inm = grupo("inmuno");
    if (inm.length) out.push({ tipo: "warn", titulo: `Inmunosupresión (${inm.join(", ")})`, texto: "Peor cicatrización y mayor riesgo de infección.", alerta: "INMUNOSUPRIMIDO" });
    const xer = grupo("xerostomia");
    if (xer.length) out.push({ tipo: "info", titulo: `Boca seca posible (${xer.join(", ")})`, texto: "Más placa y caries radicular." });
    if (grupo("hipoglucemia").length) out.push({ tipo: "warn", titulo: "Riesgo de hipoglucemia", texto: "Citas en la mañana y después de comer.", alerta: "RIESGO DE HIPOGLUCEMIA" });

    if (s.enfermedades.has("Diabetes")) {
      const h = hba1c(s);
      if (h >= HBA1C_NO_CONTROLADA) out.push({ tipo: "danger", titulo: `Diabetes no controlada (HbA1c ${fmt(h)} %)`,
        texto: "Grado C. Interconsulta con medicina interna.", alerta: `DIABETES NO CONTROLADA (HBA1C ${fmt(h)} %)` });
      else if (h >= 7) out.push({ tipo: "warn", titulo: `HbA1c ${fmt(h)} %`, texto: "≥ 7 %: grado C en la clasificación 2017." });
    }
    if (s.enfermedades.has("Hipertensión") && det(s, "Hipertensión").control === "No") {
      out.push({ tipo: "warn", titulo: "HTA no controlada", texto: "Tomar la presión antes de cada procedimiento.", alerta: "HTA NO CONTROLADA" });
    }
    if (s.profilaxis.size || (det(s, "Cardiopatía").tipo || []).includes("Válvula protésica")) {
      out.push({ tipo: "danger", titulo: "Requiere profilaxis antibiótica", texto: "Antes de sondaje, RAR y cirugía.", alerta: "REQUIERE PROFILAXIS ANTIBIOTICA" });
    }
    if (s.embarazo === "Embarazo") {
      out.push({ tipo: "warn", titulo: `Embarazo${s.semanas ? ` (${s.semanas} semanas)` : ""}`,
        texto: "Segundo trimestre es el momento más seguro para tratamiento.", alerta: `EMBARAZO${s.semanas ? ` ${s.semanas} SEMANAS` : ""}` });
    }
    return out;
  }

  function gradoTabaco(s) {
    if (s.tabaco !== "Fuma" || !s.fuma.has("Cigarrillo") || !s.cantidad) return null;
    return s.cantidad === "1–5" || s.cantidad === "6–9" ? "B (< 10 cigarrillos/día)" : "C (≥ 10 cigarrillos/día)";
  }

  function asaSugerido(s) {
    if (!s.enfermedades.size) return { asa: "ASA I", why: "Sin enfermedades sistémicas" };
    const cardio = det(s, "Cardiopatía").tipo || [];
    const razones = [];
    if (hba1c(s) >= HBA1C_NO_CONTROLADA) razones.push("diabetes no controlada");
    if (det(s, "Hipertensión").control === "No") razones.push("HTA no controlada");
    if (cardio.some((t) => ["Infarto previo", "Stent", "Falla cardíaca"].includes(t))) razones.push("cardiopatía importante");
    if (s.enfermedades.has("Enfermedad renal")) razones.push("enfermedad renal");
    if (razones.length) return { asa: "ASA III", why: razones.join(", ") };
    return { asa: "ASA II, CONTROLADA POR MEDICAMENTOS", why: "Enfermedad sistémica controlada" };
  }

  function alertasFinales(s) {
    const out = [...s.alergias].map((a) => `ALERGIA A ${up(a)}`);
    avisos(s).forEach((a) => a.alerta && out.push(a.alerta));
    return [...new Set(out)];
  }

  function enfermedadesFinales(s) {
    return [...s.enfermedades].map((e) => {
      const d = det(s, e);
      if (e === "Diabetes") {
        const h = hba1c(s);
        return up(`Diabetes${d.tipo ? ` mellitus ${d.tipo.toLowerCase()}` : ""}${h ? ` (HbA1c ${fmt(h)} %)` : ""}`);
      }
      if (e === "Hipertensión") {
        return d.control === "Sí" ? "HIPERTENSION ARTERIAL CONTROLADA" : d.control === "No" ? "HIPERTENSION ARTERIAL NO CONTROLADA" : "HIPERTENSION ARTERIAL";
      }
      if (e === "Cardiopatía" && d.tipo?.length) return up(`Cardiopatía (${d.tipo.join(", ")})`);
      return up(e);
    });
  }

  function habitosFinales(s) {
    const out = [];
    if (s.tabaco === "Fuma") {
      s.fuma.forEach((f) => {
        if (f === "Cigarrillo") out.push(up(`Fuma cigarrillo${s.cantidad ? ` ${s.cantidad} al día` : ""}${s.anios ? ` hace ${s.anios}` : ""}`));
        else if (f === "Cannabis") out.push(up(`Consume cannabis${s.cannabisFrec ? ` ${s.cannabisFrec.toLowerCase()}` : ""}`));
        else if (f === "Vapeador") out.push(up(`Usa vapeador${s.vapeoFrec ? ` ${s.vapeoFrec.toLowerCase()}` : ""}`));
        else out.push(up(f));
      });
    }
    if (s.tabaco === "Exfumador") out.push(up(`Exfumador${s.dejo ? `, dejó hace ${s.dejo}` : ""}`));
    if (s.alcohol && s.alcohol !== "No") out.push(up(`Alcohol ${s.alcohol.toLowerCase()}`));
    if (s.bruxismo === "Sí") {
      out.push(up(`Bruxismo${s.bruxTipo.size ? ` ${[...s.bruxTipo].join(" y ").toLowerCase()}` : ""}${s.placa === "Sí" ? ", usa placa" : s.placa === "No" ? ", sin placa" : ""}`));
    }
    s.otrosHab.forEach((h) => out.push(up(h)));
    return out;
  }

  function higiene(s) {
    const partes = [];
    if (s.cepillado) partes.push(`CEPILLADO ${s.cepillado} VECES AL DIA`);
    if (s.seda) partes.push(s.seda === "Sí" ? "USA SEDA DENTAL" : "NO USA SEDA DENTAL");
    if (s.enjuague) partes.push(s.enjuague === "Sí" ? "USA ENJUAGUE" : "NO USA ENJUAGUE");
    if (s.limpieza) partes.push(`ULTIMA PROFILAXIS: ${up(s.limpieza)}`);
    return partes.join(", ");
  }

  // ═══ 3. Lectura de la ficha: lo que ya tiene, como respuestas ═══════════
  // Nombre canónico → otros nombres con que aparece en el catálogo de la clínica.
  const ALIAS = {
    "Hipertensión": ["HIPERTENSION ARTERIAL", "HTA"],
    "Diabetes": ["DIABETES MELLITUS", "DIABETES MELLITUS TIPO 2", "DM"],
    "Exodoncias": ["EXODONCIA"],
    "Restauraciones": ["RESTAURACION"],
    "Prótesis": ["PROTESIS DENTAL"]
  };
  const nombres = (item) => [item, ...(ALIAS[item] || [])].map((n) => norm(n));
  const NADA = /^(NIEGA|NO REFIERE|NO RELATA|NO|N A|NO APLICA|NO ALERGIA|NO HABITO|NINGUNO|NINGUNA)$/;
  // Paso del panel y pregunta Sí/No de cada sección.
  const SECCION_PASO = {
    "Motivo de consulta": { paso: 0 }, "Enfermedad actual": { paso: 0 },
    "Alertas médicas": { paso: 1, clave: "alertas" }, "Enfermedades": { paso: 2, clave: "enf" },
    "Medicamentos": { paso: 3, clave: "med" }, "Hábitos": { paso: 4 },
    "Antecedentes odontológicos": { paso: 5 }, "Antecedentes familiares": { paso: 6, clave: "fam" }
  };

  const buscar = (catalogo, parte) => catalogo.find((item) => nombres(item).includes(parte));
  const empiezaCon = (catalogo, parte) => catalogo.find((item) => nombres(item).some((n) => parte === n || parte.startsWith(`${n} `)));

  // Cada reconocedor recibe la parte normalizada y la original; devuelve true si la entendió.
  const RECONOCEDORES = {
    "Alertas médicas": (p, s) => {
      if (/^ASA\b/.test(p)) return true; // se recalcula
      const alergia = p.match(/^ALERGIA A (.+)$/);
      const encontrada = alergia && ALERGIAS.find((a) => norm(a.t) === alergia[1]);
      if (encontrada) { s.alergias.add(encontrada.t); return true; }
      const embarazo = p.match(/^EMBARAZO(?: (\d+) SEMANAS)?$/);
      if (embarazo) { s.embarazo = "Embarazo"; s.semanas = embarazo[1] || ""; return true; }
      if (p === "LACTANCIA") { s.embarazo = "Lactancia"; return true; }
      if (p.startsWith("REQUIERE PROFILAXIS")) return true;
      // Alertas que el panel vuelve a deducir de enfermedades y medicamentos.
      return /^(ANTICOAGULADO|ANTIAGREGADO|RIESGO( ALTO)? DE OSTEONECROSIS|DIABETES NO CONTROLADA|HTA NO CONTROLADA|INMUNOSUPRIMIDO|RIESGO DE HIPOGLUCEMIA)\b/.test(p);
    },
    "Enfermedades": (p, s) => {
      const enf = empiezaCon(Object.keys(ENF), p);
      if (!enf) return false;
      s.enfermedades.add(enf);
      const d = (s.det[enf] ||= {});
      if (enf === "Hipertensión") {
        if (/NO CONTROLADA$/.test(p)) d.control = "No";
        else if (/CONTROLADA$/.test(p)) d.control = "Sí";
      }
      if (enf === "Diabetes") {
        const tipo = p.match(/TIPO ([12])/);
        if (tipo) d.tipo = `Tipo ${tipo[1]}`;
        const h = p.match(/HBA1C (\d+)(?: (\d))?/);
        if (h) d.hba1c = h[2] ? `${h[1]},${h[2]}` : h[1];
      }
      return true;
    },
    "Medicamentos": (p, s) => {
      const med = buscar(MEDS_TODOS, p);
      if (med) s.meds.add(med);
      return Boolean(med);
    },
    "Hábitos": (p, s) => {
      if (/^FUMA(DORA?)?\b/.test(p)) {
        s.tabaco = "Fuma";
        if (/CIGARRILLO|^FUMADORA?$/.test(p)) s.fuma.add("Cigarrillo");
        const cantidad = ["10–20", "1–5", "6–9", "> 20"].find((c) => p.includes(` ${norm(c)} `));
        if (cantidad) s.cantidad = cantidad;
        return true;
      }
      if (/^CONSUME CANNABIS/.test(p)) { s.tabaco = "Fuma"; s.fuma.add("Cannabis"); return true; }
      if (/^USA VAPEADOR/.test(p)) { s.tabaco = "Fuma"; s.fuma.add("Vapeador"); return true; }
      if (/^EX ?FUMADORA?\b/.test(p)) { s.tabaco = "Exfumador"; return true; }
      const alcohol = p.match(/^ALCOHOL (OCASIONAL|SEMANAL|DIARIO)$/);
      if (alcohol) { s.alcohol = FRECUENCIA.find((f) => norm(f) === alcohol[1]); return true; }
      if (/^BRUXISMO\b/.test(p)) {
        s.bruxismo = "Sí";
        if (/NOCTURNO/.test(p)) s.bruxTipo.add("Nocturno");
        if (/DIURNO/.test(p)) s.bruxTipo.add("Diurno");
        if (/USA PLACA/.test(p)) s.placa = "Sí";
        if (/SIN PLACA/.test(p)) s.placa = "No";
        return true;
      }
      const otro = buscar(OTROS_HAB, p);
      if (otro) s.otrosHab.add(otro);
      return Boolean(otro);
    },
    "Antecedentes odontológicos": (p, s) => {
      const cep = p.match(/^CEPILLADO (\d|MAS DE 3|3) VECES AL DIA$/);
      if (cep) { s.cepillado = cep[1]; return true; }
      if (p === "USA SEDA DENTAL" || p === "NO USA SEDA DENTAL") { s.seda = p.startsWith("NO") ? "No" : "Sí"; return true; }
      if (p === "USA ENJUAGUE" || p === "NO USA ENJUAGUE") { s.enjuague = p.startsWith("NO") ? "No" : "Sí"; return true; }
      const limpieza = p.match(/^ULTIMA PROFILAXIS (.+)$/);
      const valor = limpieza && LIMPIEZA.find((l) => norm(l) === limpieza[1]);
      if (valor) { s.limpieza = valor; return true; }
      const odo = buscar(ODONTO, p);
      if (odo) s.odontologicos.add(odo);
      return Boolean(odo);
    },
    "Antecedentes familiares": (p, s) => {
      const fam = buscar(FAMILIARES, p);
      if (fam) s.familiares.add(fam);
      return Boolean(fam);
    }
  };

  const partesDe = (seccion) => [...(seccion?.lista || []), ...String(seccion?.texto || "").split(/\s*,\s*/)]
    .map((t) => spaces(t)).filter((t) => t && t !== "\"\"");

  // La ficha como respuestas del panel, para confirmar y corregir.
  function estadoDesdeFicha(secciones) {
    const s = crearEstado();
    for (const [titulo, seccion] of Object.entries(secciones)) {
      const meta = SECCION_PASO[titulo];
      if (!meta) continue;
      const partes = partesDe(seccion);
      if (!partes.length) continue;
      s.hechos.add(meta.paso);

      const reconocer = RECONOCEDORES[titulo];
      if (!reconocer) { // Motivo y Enfermedad actual: se conservan tal cual
        s.previos[titulo] = [spaces(seccion.texto) || partes.join(", ")];
        continue;
      }
      const reales = partes.filter((p) => !NADA.test(norm(p)));
      const soloAsa = reales.length && reales.every((p) => /^ASA\b/.test(norm(p)));
      const niega = !reales.length || (titulo === "Alertas médicas" && soloAsa);
      if (meta.clave) s[meta.clave] = !niega;
      if (titulo === "Hábitos" && niega) s.tabaco = "No";
      if (niega) continue;

      const vistos = new Set();
      for (const parte of reales) {
        const p = norm(parte);
        if (vistos.has(p)) continue;
        vistos.add(p);
        if (!reconocer(p, s)) (s.previos[titulo] ||= []).push(parte);
      }
    }
    if (s.tabaco === "" && s.hechos.has(4)) s.tabaco = "No";
    return s;
  }

  // Paciente nuevo: ninguna sección tiene nada (las comillas del motivo no cuentan).
  const fichaVacia = (secciones) => Object.values(secciones).every((seccion) => !partesDe(seccion).length);

  // ═══ 4. Plan de escritura: qué marcar, qué quitar y qué texto dejar ══════
  // Lista de cada sección: catálogo donde buscar y conjunto del estado.
  const LISTAS = {
    "Enfermedades": { catalogo: () => Object.keys(ENF), estado: (s) => s.enfermedades, reconocer: (p) => empiezaCon(Object.keys(ENF), p) },
    "Medicamentos": { catalogo: () => MEDS_TODOS, estado: (s) => s.meds },
    "Antecedentes odontológicos": { catalogo: () => ODONTO, estado: (s) => s.odontologicos },
    "Antecedentes familiares": { catalogo: () => FAMILIARES, estado: (s) => s.familiares }
  };

  // El texto «Otros …» se reconstruye: lo no reconocido de antes + lo que dice el panel.
  function textoDe(titulo, s) {
    switch (titulo) {
      case "Alertas médicas": return [asaSugerido(s).asa, ...alertasFinales(s)];
      case "Enfermedades": // solo los detalles que la lista no puede guardar
        return enfermedadesFinales(s).filter((t, i) => !nombres([...s.enfermedades][i]).includes(norm(t)));
      case "Hábitos": return habitosFinales(s);
      case "Antecedentes odontológicos": return higiene(s) ? [higiene(s)] : [];
      default: return [];
    }
  }

  function planEscritura(s, ficha) {
    const plan = {};
    for (const [titulo, seccion] of Object.entries(ficha)) {
      const lista = seccion.lista || [];
      const previos = s.previos[titulo] || [];

      if (titulo === "Motivo de consulta" || titulo === "Enfermedad actual") {
        const propio = titulo === "Motivo de consulta" ? motivoFinal(s) : enfermedadActual(s);
        plan[titulo] = { marcar: [], quitar: [], texto: previos.length ? previos.join(", ") : propio };
        continue;
      }

      const cfg = LISTAS[titulo];
      const elegidos = cfg ? [...cfg.estado(s)] : [];
      const reconocer = cfg?.reconocer || ((p) => cfg && buscar(cfg.catalogo(), p));
      const quitar = [];
      const quedan = [];
      for (const etiqueta of lista) {
        const p = norm(etiqueta);
        const item = cfg && reconocer(p);
        const desmarcado = item && !elegidos.includes(item);
        const vacia = NADA.test(p) && elegidos.length;
        if (desmarcado || vacia) quitar.push(etiqueta);
        else quedan.push(etiqueta);
      }
      const marcar = elegidos.filter((item) => !quedan.some((etiqueta) => nombres(item).includes(norm(etiqueta))));

      // Se respeta el orden del texto que ya había; lo nuevo va al final.
      const nuevos = textoDe(titulo, s);
      const validos = new Set([...previos, ...nuevos].map(norm));
      const partes = [];
      const agregar = (parte) => { if (!partes.some((x) => norm(x) === norm(parte))) partes.push(parte); };
      String(seccion.texto || "").split(/\s*,\s*/).map(spaces).filter((p) => validos.has(norm(p))).forEach(agregar);
      [...previos, ...nuevos].forEach(agregar);
      const listaFinal = quedan.length + marcar.length;
      if (!partes.length && !listaFinal && SECCION_PASO[titulo]?.paso !== 5) partes.push("NIEGA");
      plan[titulo] = { marcar, quitar, texto: partes.join(", ") };
    }
    return plan;
  }

  // ═══ 5. Adaptador de Dentalink: leer y escribir la ficha real ════════════
  // Cada sección visible: etiquetas elegidas en su lista y texto «Otros …».
  function leerSecciones() {
    const secciones = {};
    for (const [titulo, textarea] of Object.entries(getSections())) {
      secciones[titulo] = { lista: listItems(sectionCard(textarea)), texto: textarea.value || "" };
    }
    return secciones;
  }

  // Aplica el plan sección por sección. Si se sale de la ficha, se detiene.
  async function aplicarPlan(plan, { ruta }) {
    const resultado = { marcados: [], aTexto: [], cancelado: false };
    const sigue = () => {
      if (location.pathname !== ruta) resultado.cancelado = true;
      return !resultado.cancelado;
    };
    for (const titulo of TITLES) {
      const paso = plan[titulo];
      const textarea = getSections()[titulo];
      if (!paso || !textarea) continue;
      const card = sectionCard(textarea);
      const extra = [];
      for (const etiqueta of paso.quitar) {
        if (!sigue()) return resultado;
        removeFromList(card, etiqueta);
      }
      for (const item of paso.marcar) {
        if (!sigue()) return resultado;
        if (await pickFromList(card, item)) resultado.marcados.push(item);
        else { resultado.aTexto.push(item); extra.push(up(item)); }
      }
      if (!sigue()) return resultado;
      const partes = paso.texto ? paso.texto.split(/\s*,\s*/) : [];
      extra.forEach((parte) => { if (!partes.some((x) => norm(x) === norm(parte))) partes.push(parte); });
      // Lo que no se encontró en la lista reemplaza un «NIEGA».
      const texto = (extra.length ? partes.filter((p) => norm(p) !== "NIEGA") : partes).join(", ");
      if (textarea.value !== texto) setValue(textarea, texto);
    }
    return resultado;
  }

  // ─── Utilidades ─────────────────────────────────────────────────────────
  const STYLE_ID = "dlk-anam-style";
  const TOOLBAR_ATTR = "data-dlk-anam-toolbar";
  const TITLES = [
    "Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades",
    "Medicamentos", "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"
  ];
  const appliedDefaults = new Set(); // "ruta|sección" ya inicializadas en esta visita
  const highlightedMeds = new Set();
  let lastUndo = null;

  const spaces = (t) => String(t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const key = (t) => spaces(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  // Para comparar con la lista de Dentalink, que mezcla may\u00fasculas, tildes y puntos.
  const norm = (t) => key(t).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const aliases = (item) => [item, ...(LISTA_ALIAS[item] || [])].map(norm);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // La tarjeta de la sección: el primer ancestro con un encabezado conocido.
  function findCard(textarea) {
    let node = textarea.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      for (const child of node.children) {
        const text = spaces(child.children[0]?.textContent);
        if (child.children.length && TITLES.includes(text)) return { card: node, title: text };
      }
    }
    return { card: null, title: "" };
  }

  const sectionTitle = (textarea) => findCard(textarea).title;
  const sectionCard = (textarea) => findCard(textarea).card;

  // Botón "Añadir …" de la tarjeta y el desplegable que abre.
  function listParts(card) {
    const button = [...(card?.querySelectorAll("button") || [])].find((b) => /^Añadir\b/.test(spaces(b.textContent)));
    return { button, panel: button?.parentElement?.nextElementSibling || null };
  }

  // Elementos ya elegidos en la lista de Dentalink (los que tienen una ×).
  function listItems(card) {
    if (!card) return [];
    const { panel } = listParts(card);
    return [...card.querySelectorAll("i.fa-close")]
      .filter((icon) => !panel?.contains(icon) && icon.previousElementSibling?.tagName === "SPAN")
      .map((icon) => spaces(icon.previousElementSibling.textContent))
      .filter(Boolean);
  }

  function getSections() {
    const map = {};
    document.querySelectorAll("textarea").forEach((textarea) => {
      if (textarea.offsetParent === null) return;
      const title = sectionTitle(textarea);
      if (title && !map[title]) map[title] = textarea;
    });
    return map;
  }

  function splitItems(text) {
    return spaces(text).split(/\s*,\s*/).filter(Boolean);
  }

  function hasItem(textarea, item) {
    return splitItems(textarea.value).some((part) => key(part) === key(item));
  }

  function inList(textarea, item) {
    const wanted = aliases(item);
    return listItems(sectionCard(textarea)).some((part) => wanted.includes(norm(part)));
  }

  // Presente en el texto «Otros…» o en la lista de Dentalink.
  const present = (textarea, item) => hasItem(textarea, item) || inList(textarea, item);

  // Sin nada útil: texto vacío (o solo las comillas del motivo) y lista vacía.
  function isMissing(textarea) {
    const text = spaces(textarea.value);
    return (!text || text === "\"\"") && !listItems(sectionCard(textarea)).length;
  }

  function addItem(textarea, item) {
    const current = spaces(textarea.value);
    if (present(textarea, item)) return;
    setValue(textarea, VACIOS.test(current) ? item : `${current}, ${item}`);
  }

  function removeFromText(textarea, item) {
    const rest = splitItems(textarea.value).filter((part) => key(part) !== key(item));
    setValue(textarea, rest.join(", "));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Busca el elemento en el desplegable de Dentalink, marca su casilla y pulsa Aceptar.
  // Solo toca casillas y Aceptar: nunca "Nuevo …" ni la papelera, que cambian el catálogo.
  async function pickFromList(card, item) {
    const { button, panel } = listParts(card);
    if (!button || !panel) return false;
    if (panel.offsetParent === null) {
      button.click();
      await sleep(300);
    }
    const search = panel.querySelector("input:not([type=checkbox])");
    if (search) setInputValue(search, norm(item).slice(0, 6).toLowerCase());

    const wanted = [...aliases(item), ...nombres(item)];
    let box = null;
    for (let waited = 0; waited < 3000 && !box; waited += 150) {
      await sleep(150);
      box = [...panel.querySelectorAll("input[type=checkbox]")]
        .find((input) => wanted.includes(norm(input.parentElement?.textContent)));
    }
    const accept = [...panel.querySelectorAll("footer *")].find((el) => spaces(el.textContent) === "Aceptar");
    if (!box || !accept) {
      if (search) setInputValue(search, "");
      document.body.click(); // cierra el desplegable sin cambiar nada
      return false;
    }
    if (!box.checked) box.click();
    await sleep(150);
    accept.click();
    await sleep(300);
    if (search) setInputValue(search, "");
    return true;
  }

  function removeFromList(card, item) {
    const { panel } = listParts(card);
    const wanted = [...aliases(item), ...nombres(item)];
    const icon = [...card.querySelectorAll("i.fa-close")].find((el) => !panel?.contains(el) &&
      el.previousElementSibling?.tagName === "SPAN" && wanted.includes(norm(el.previousElementSibling.textContent)));
    icon?.click();
    return Boolean(icon);
  }

  // Las acciones que abren desplegables van de una en una.
  let queue = Promise.resolve();
  function enqueue(task) {
    queue = queue.then(task).catch((error) => console.warn("[Anamnesis rápida]", error));
    return queue;
  }

  // Agrega a la lista de Dentalink si existe ahí; si no, al texto «Otros…».
  async function addToSection(title, item) {
    const textarea = getSections()[title];
    if (!textarea || present(textarea, item)) return;
    if (SECCIONES_CON_LISTA.includes(title) && !VACIOS.test(item) && await pickFromList(sectionCard(textarea), item)) {
      // Un "NIEGA" escrito antes ya no es cierto.
      if (spaces(textarea.value) && VACIOS.test(spaces(textarea.value))) setValue(textarea, "");
      return;
    }
    addItem(textarea, item);
    if (SECCIONES_CON_LISTA.includes(title) && !VACIOS.test(item)) {
      flash(`«${item}» no está en la lista de Dentalink: se escribió en Otros.`);
    }
  }

  async function toggleInSection(title, item) {
    const textarea = getSections()[title];
    if (!textarea) return;
    if (inList(textarea, item)) removeFromList(sectionCard(textarea), item);
    else if (hasItem(textarea, item)) removeFromText(textarea, item);
    else await addToSection(title, item);
  }

  function flash(message) {
    let toast = document.getElementById("dlk-anam-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "dlk-anam-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("dlk-show");
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => toast.classList.remove("dlk-show"), 3500);
  }

  // ─── Acciones ───────────────────────────────────────────────────────────
  function applyAutoDefaults(sections) {
    for (const [title, value] of Object.entries(AUTO_DEFAULTS)) {
      const marker = `${location.pathname}|${title}`;
      const textarea = sections[title];
      if (!textarea || appliedDefaults.has(marker)) continue;
      appliedDefaults.add(marker);
      // Si ya hay algo elegido en la lista de Dentalink, el texto base sobra.
      if (!spaces(textarea.value) && !listItems(sectionCard(textarea)).length) setValue(textarea, value);
    }
  }

  function sinAntecedentes() {
    const sections = getSections();
    const changes = [];
    const skipped = [];
    for (const [title, value] of Object.entries(SIN_ANTECEDENTES)) {
      const textarea = sections[title];
      if (!textarea || spaces(textarea.value)) continue;
      // No escribir NIEGA donde la lista de Dentalink ya tiene datos.
      if (listItems(sectionCard(textarea)).length) {
        skipped.push(title);
        continue;
      }
      setValue(textarea, value);
      changes.push({ title, value });
    }
    const note = skipped.length ? ` Se respetó lo elegido en: ${skipped.join(", ")}.` : "";
    if (!changes.length) {
      flash(`No había campos vacíos: no se cambió nada.${note}`);
      return;
    }
    lastUndo = changes;
    refreshToolbars();
    flash(`Completado: ${changes.map((c) => c.title).join(", ")}.${note} Revisa y pulsa Guardar.`);
  }

  function undoSinAntecedentes() {
    if (!lastUndo) return;
    const sections = getSections();
    lastUndo.forEach(({ title, value }) => {
      const textarea = sections[title];
      // Solo deshace si nadie cambió ese campo después.
      if (textarea && spaces(textarea.value) === value) setValue(textarea, "");
    });
    lastUndo = null;
    refreshToolbars();
    flash("Deshecho.");
  }

  async function applyCondition(condition) {
    if (!getSections()["Enfermedades"]) return;
    await addToSection("Enfermedades", condition.enfermedad);

    const alertas = getSections()["Alertas médicas"];
    // Reemplaza solo si alertas (texto y lista) está vacío o contiene únicamente "ASA I", "NIEGA", "NO ALERGIA"...
    const sinAlertasReales = alertas && [...splitItems(alertas.value), ...listItems(sectionCard(alertas))]
      .every((item) => SIN_DATO_REAL.test(norm(item)));
    if (sinAlertasReales) {
      setValue(alertas, ALERTA_CONTROLADA);
    }
    condition.meds.forEach((med) => highlightedMeds.add(med));
    refreshToolbars();
  }

  // ─── Interfaz ───────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${TOOLBAR_ATTR}] { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0 6px; align-items:center; }
      [${TOOLBAR_ATTR}] .dlk-lbl { font-size:11px; color:#6c757d; margin-right:2px; }
      [${TOOLBAR_ATTR}] button, #dlk-anam-bar button {
        font:600 11px/1.2 inherit; padding:3px 8px; width:auto; height:auto; min-width:0; min-height:0; margin:0; flex:0 0 auto; display:inline-block; text-transform:none; border-radius:12px; cursor:pointer;
        border:1px solid #2a6fdb; background:#fff; color:#2a6fdb; }
      [${TOOLBAR_ATTR}] button:hover, #dlk-anam-bar button:hover { background:#eaf1fd; }
      [${TOOLBAR_ATTR}] button.dlk-on { background:#2a6fdb; color:#fff; }
      [${TOOLBAR_ATTR}] button.dlk-hint { border-color:#e08a00; color:#a86400; background:#fff6e5; }
      [${TOOLBAR_ATTR}] button.dlk-cond { border-style:dashed; }
      #dlk-anam-bar { clear:both; width:100%; box-sizing:border-box; padding:0 4px; display:flex; gap:6px; align-items:center; margin:6px 0 10px; }
      #dlk-anam-bar .dlk-main { background:#2a6fdb; color:#fff; padding:5px 12px; font-size:12px; }
      #dlk-anam-bar .dlk-main:hover { background:#1f5bbb; }
      #dlk-anam-faltan { margin-left:8px; font-size:12px; font-weight:600; }
      #dlk-anam-faltan.dlk-faltan { color:#a86400; }
      #dlk-anam-faltan.dlk-completo { color:#1e7e34; }
      #dlk-anam-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#1f2937; color:#fff; padding:8px 14px; border-radius:8px; font-size:13px;
        opacity:0; pointer-events:none; transition:opacity .2s; z-index:99999; }
      #dlk-anam-toast.dlk-show { opacity:1; }
    `;
    document.head.appendChild(style);
  }

  function chip(text, onClick, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener("mousedown", (event) => event.preventDefault()); // no robar el foco
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function buildToolbar(title, textarea) {
    const bar = document.createElement("div");
    bar.setAttribute(TOOLBAR_ATTR, title);

    if (title === "Antecedentes odontológicos") {
      ANTECEDENTES_ODONTO.forEach((item) => {
        bar.appendChild(chip(item, () => enqueue(async () => { await toggleInSection(title, item); refreshToolbars(); }),
          present(textarea, item) ? "dlk-on" : ""));
      });
      return bar;
    }

    if (title === "Enfermedades") {
      CONDICIONES.forEach((condition) => {
        bar.appendChild(chip(`+ ${condition.label}`, () => enqueue(() => applyCondition(condition)),
          `dlk-cond${present(textarea, condition.enfermedad) ? " dlk-on" : ""}`));
      });
    }

    (CHIPS[title] || []).forEach((item) => {
      bar.appendChild(chip(item, () => enqueue(async () => { await addToSection(title, item); refreshToolbars(); }),
        present(textarea, item) ? "dlk-on" : ""));
    });

    if (title === "Medicamentos") {
      const ordered = [
        ...MEDICAMENTOS.filter((m) => highlightedMeds.has(m)),
        ...MEDICAMENTOS.filter((m) => !highlightedMeds.has(m))
      ];
      ordered.forEach((med) => {
        const cls = present(textarea, med) ? "dlk-on" : highlightedMeds.has(med) ? "dlk-hint" : "";
        bar.appendChild(chip(med, () => enqueue(async () => { await addToSection(title, med); refreshToolbars(); }), cls));
      });
    }

    return bar.children.length ? bar : null;
  }

  function placeToolbar(title, textarea) {
    const anchor = textarea.parentElement;
    const existing = anchor.parentElement.querySelector(`:scope > [${TOOLBAR_ATTR}="${title}"]`);
    const bar = buildToolbar(title, textarea);
    if (existing) existing.remove();
    if (bar) anchor.insertAdjacentElement("afterend", bar);
  }

  function refreshToolbars() {
    const sections = getSections();
    Object.entries(sections).forEach(([title, textarea]) => placeToolbar(title, textarea));
    updateSummary(sections);
  }

  // Secciones sin texto ni elementos de la lista, en el orden de la ficha.
  const missingSections = (sections) => TITLES.filter((title) => sections[title] && isMissing(sections[title]));

  function updateSummary(sections) {
    const summary = document.getElementById("dlk-anam-faltan");
    if (!summary) return;
    const missing = missingSections(sections);
    const text = missing.length ? `Faltan: ${missing.join(", ")}` : "✓ Todas las secciones tienen datos";
    // Solo si cambia: así el observador no entra en bucle.
    if (summary.textContent !== text) summary.textContent = text;
    summary.className = missing.length ? "dlk-faltan" : "dlk-completo";
  }

  function ensureTopBar(sections) {
    if (document.getElementById("dlk-anam-bar")) return;
    const first = sections["Motivo de consulta"] || Object.values(sections)[0];
    if (!first) return;
    // Sube hasta la tarjeta de la primera sección y pone la barra encima de la cuadrícula.
    let card = first;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement;
      if (spaces(card.textContent).startsWith("Motivo de consulta")) break;
    }
    const grid = card.parentElement?.parentElement || card.parentElement;
    if (!grid) return;
    const bar = document.createElement("div");
    bar.id = "dlk-anam-bar";
    bar.appendChild(chip("✓ Sin antecedentes (ASA I / NIEGA)", sinAntecedentes, "dlk-main"));
    bar.appendChild(chip("Deshacer", undoSinAntecedentes));
    const summary = document.createElement("span");
    summary.id = "dlk-anam-faltan";
    bar.appendChild(summary);
    grid.insertAdjacentElement("beforebegin", bar);
    updateSummary(sections);
  }

  // Cursor entre las comillas del motivo al entrar al campo (sin robar el foco).
  document.addEventListener("focusin", (event) => {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.value !== "\"\"") return;
    if (sectionTitle(textarea) !== "Motivo de consulta") return;
    setTimeout(() => textarea.setSelectionRange(1, 1), 0);
  });

  // Mantener los botones al día cuando escribes a mano.
  document.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.isTrusted) return;
    clearTimeout(refreshToolbars.timer);
    refreshToolbars.timer = setTimeout(refreshToolbars, 400);
  });

  // ─── Ciclo ──────────────────────────────────────────────────────────────
  function sync() {
    if (!/\/pacientes\/\d+\/ficha\/antecedentes/.test(location.pathname)) return;
    const sections = getSections();
    if (!Object.keys(sections).length) return;
    injectStyle();
    applyAutoDefaults(sections);
    ensureTopBar(sections);
    Object.entries(sections).forEach(([title, textarea]) => {
      const host = textarea.parentElement.parentElement;
      if (!host.querySelector(`:scope > [${TOOLBAR_ATTR}="${title}"]`)) placeToolbar(title, textarea);
    });
    // Si cambió lo elegido en las listas de Dentalink, actualizar botones y resumen.
    const signature = JSON.stringify(Object.entries(sections).map(([title, textarea]) =>
      [title, textarea.value, listItems(sectionCard(textarea))]));
    if (signature !== lastSignature) {
      lastSignature = signature;
      refreshToolbars();
    }
  }
  let lastSignature = "";

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sync(); }, 300);
  }

  new MutationObserver((mutations) => {
    // Ignorar cambios hechos por este mismo script.
    const external = mutations.some((m) => ![...m.addedNodes, ...m.removedNodes].every((n) =>
      n.nodeType === 1 && (n.hasAttribute?.(TOOLBAR_ATTR) || n.id === "dlk-anam-bar" || n.id === "dlk-anam-toast")));
    if (external) schedule();
  }).observe(document.body, { childList: true, subtree: true });

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; appliedDefaults.clear(); highlightedMeds.clear(); lastUndo = null; schedule(); }
  }, 800);

  if (globalThis.__DLK_ANAM_TEST__) {
    globalThis.__dlkAnamTest = {
      addToSection, applyAutoDefaults, getSections, missingSections, norm, present, sinAntecedentes,
      crearEstado, fmt, leerNumero, enfermedadActual, motivoFinal, avisos, gradoTabaco, asaSugerido,
      alertasFinales, enfermedadesFinales, habitosFinales, higiene, estadoDesdeFicha, fichaVacia, ALIAS, planEscritura, leerSecciones, aplicarPlan
    };
  }

  schedule();
})();
