// ==UserScript==
// @name         Dentalink - Antecedentes por defecto
// @namespace    https://odontofamily.local/dentalink-antecedentes
// @version      3.0.0
// @description  Anamnesis paso a paso: panel lateral que guía la entrevista, avisa riesgos periodontales y escribe la Ficha Anamnesis en las listas de Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

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
      // previos: lo de la ficha que el panel no entiende (solo se muestra);
      // base: lo que el panel leyó y entiende, y por tanto puede reescribir.
      previos: {}, hechos: new Set(), base: {}, tocado: false
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
    const motivosProfilaxis = [...s.profilaxis, ...((det(s, "Cardiopatía").tipo || []).includes("Válvula protésica") ? ["Válvula protésica"] : [])];
    if (motivosProfilaxis.length) {
      out.push({ tipo: "danger", titulo: "Requiere profilaxis antibiótica", texto: "Antes de sondaje, RAR y cirugía.",
        alerta: `REQUIERE PROFILAXIS ANTIBIOTICA (${up(motivosProfilaxis.join(", "))})` });
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
    if (s.tabaco === "Exfumador") out.push(up(`Exfumador${s.dejo ? ` (dejó hace ${s.dejo})` : ""}`));
    if (s.alcohol && s.alcohol !== "No") out.push(up(`Alcohol ${s.alcohol.toLowerCase()}`));
    if (s.bruxismo === "Sí") {
      out.push(up(`Bruxismo${s.bruxTipo.size ? ` ${[...s.bruxTipo].join(" y ").toLowerCase()}` : ""}${s.placa === "Sí" ? " (usa placa)" : s.placa === "No" ? " (sin placa)" : ""}`));
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
    "Diabetes": ["DIABETES MELLITUS", "DM"],
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

  // Separa «Otros …» en elementos. Las comas dentro de paréntesis o entre
  // dígitos («7,6 %») no separan, y «ASA II, CONTROLADA POR MEDICAMENTOS» es uno.
  function partir(texto) {
    const partes = [];
    let actual = "";
    let nivel = 0;
    const t = String(texto || "");
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "(") nivel++;
      if (c === ")") nivel = Math.max(0, nivel - 1);
      if (c === "," && nivel === 0 && !(/\d/.test(t[i - 1] || "") && /\d/.test(t[i + 1] || ""))) {
        partes.push(actual);
        actual = "";
      } else actual += c;
    }
    partes.push(actual);
    return partes.map(spaces).filter((p) => p && p !== "\"\"").reduce((out, p) => {
      if (norm(p) === "CONTROLADA POR MEDICAMENTOS" && /^ASA\b/.test(norm(out.at(-1) || ""))) out[out.length - 1] += `, ${p}`;
      else out.push(p);
      return out;
    }, []);
  }

  const buscar = (catalogo, parte) => catalogo.find((item) => nombres(item).includes(parte));
  const opcion = (opciones, texto) => opciones.find((o) => key(o) === key(texto));
  // Lo que va entre paréntesis al final: «CARDIOPATÍA (STENT, VÁLVULA)» → ["STENT", "VÁLVULA"].
  const entreParentesis = (crudo) => (crudo.match(/\(([^)]*)\)\s*$/)?.[1] || "").split(/\s*,\s*/).filter(Boolean);

  // Enfermedad por su nombre exacto, o con los detalles que el propio panel escribe.
  const DETALLE_ENF = {
    "Hipertensión": /^(CONTROLADA|NO CONTROLADA)$/,
    "Diabetes": /^(MELLITUS( TIPO [12])?)?( ?HBA1C \d+( \d)?)?$/,
    "Cardiopatía": /^[A-Z ]+$/
  };
  function enfermedadDe(p) {
    for (const enf of Object.keys(ENF)) {
      for (const n of nombres(enf)) {
        if (p === n) return enf;
        const resto = p.startsWith(`${n} `) ? p.slice(n.length + 1) : null;
        if (resto && DETALLE_ENF[enf]?.test(resto)) return enf;
      }
    }
    return null;
  }

  // Cada reconocedor recibe la parte normalizada (p), la original (crudo) y el estado;
  // devuelve true si la entendió. Que el estado la reproduzca igual se comprueba después.
  const RECONOCEDORES = {
    "Alertas médicas": (p, crudo, s) => {
      if (/^ASA\b/.test(p)) return true; // se recalcula
      const alergia = p.match(/^ALERGIA A (.+)$/);
      const encontrada = alergia && ALERGIAS.find((a) => norm(a.t) === alergia[1]);
      if (encontrada) { s.alergias.add(encontrada.t); return true; }
      const embarazo = p.match(/^EMBARAZO(?: (\d+) SEMANAS)?$/);
      if (embarazo) { s.embarazo = "Embarazo"; s.semanas = embarazo[1] || ""; return true; }
      if (p === "LACTANCIA") { s.embarazo = "Lactancia"; return true; }
      if (p.startsWith("REQUIERE PROFILAXIS ANTIBIOTICA")) {
        entreParentesis(crudo).forEach((m) => { const o = opcion(PROFILAXIS, m); if (o) s.profilaxis.add(o); });
        return true;
      }
      if (/^RIESGO( ALTO)? DE OSTEONECROSIS\b/.test(p)) {
        const tiempo = opcion(ENF["Osteoporosis"].preguntas[0].op, entreParentesis(crudo)[0] || "");
        if (tiempo) (s.det["Osteoporosis"] ||= {}).tiempo = tiempo;
        return true;
      }
      // Alertas que el panel vuelve a deducir de enfermedades y medicamentos.
      return /^(ANTICOAGULADO|ANTIAGREGADO|DIABETES NO CONTROLADA|HTA NO CONTROLADA|INMUNOSUPRIMIDO|RIESGO DE HIPOGLUCEMIA)\b/.test(p);
    },
    "Enfermedades": (p, crudo, s) => {
      const enf = enfermedadDe(p);
      if (!enf) return false;
      s.enfermedades.add(enf);
      const d = (s.det[enf] ||= {});
      if (enf === "Hipertensión") {
        if (/ NO CONTROLADA$/.test(p)) d.control = "No";
        else if (/ CONTROLADA$/.test(p)) d.control = "Sí";
      }
      if (enf === "Diabetes") {
        const tipo = p.match(/TIPO ([12])/);
        if (tipo) d.tipo = `Tipo ${tipo[1]}`;
        const h = p.match(/HBA1C (\d+)(?: (\d))?/);
        if (h) d.hba1c = h[2] ? `${h[1]},${h[2]}` : h[1];
      }
      if (enf === "Cardiopatía") {
        const tipos = entreParentesis(crudo).map((t) => opcion(ENF["Cardiopatía"].preguntas[0].op, t)).filter(Boolean);
        if (tipos.length) d.tipo = [...new Set([...(d.tipo || []), ...tipos])];
      }
      return true;
    },
    "Medicamentos": (p, crudo, s) => {
      const med = buscar(MEDS_TODOS, p);
      if (med) s.meds.add(med);
      return Boolean(med);
    },
    "Hábitos": (p, crudo, s) => {
      const k = key(crudo);
      if (/^FUMA(DORA?)?\b/.test(p)) {
        s.tabaco = "Fuma";
        if (/CIGARRILLO|^FUMADORA?$/.test(p)) s.fuma.add("Cigarrillo");
        const cantidad = CANTIDAD.find((c) => k.includes(` ${key(c)} AL DIA`));
        if (cantidad) s.cantidad = cantidad;
        const anios = k.match(/ HACE (.+)$/);
        if (anios) s.anios = opcion(ANIOS, anios[1]) || "";
        return true;
      }
      const frecuencia = (m) => FRECUENCIA.find((f) => norm(f) === m) || "";
      const cannabis = p.match(/^CONSUME CANNABIS ?(OCASIONAL|SEMANAL|DIARIO)?$/);
      if (cannabis) { s.tabaco = "Fuma"; s.fuma.add("Cannabis"); s.cannabisFrec = frecuencia(cannabis[1]); return true; }
      const vapeo = p.match(/^USA VAPEADOR ?(OCASIONAL|SEMANAL|DIARIO)?$/);
      if (vapeo) { s.tabaco = "Fuma"; s.fuma.add("Vapeador"); s.vapeoFrec = frecuencia(vapeo[1]); return true; }
      if (/^EX ?FUMADORA?\b/.test(p)) {
        s.tabaco = "Exfumador";
        const dejo = k.match(/DEJO HACE (.+)\)$/);
        if (dejo) s.dejo = opcion(DEJO, dejo[1]) || "";
        return true;
      }
      const alcohol = p.match(/^ALCOHOL (OCASIONAL|SEMANAL|DIARIO)$/);
      if (alcohol) { s.alcohol = frecuencia(alcohol[1]); return true; }
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
    "Antecedentes odontológicos": (p, crudo, s) => {
      const cep = key(crudo).match(/^CEPILLADO (.+) VECES AL DIA$/);
      if (cep) { s.cepillado = cep[1]; return true; }
      if (p === "USA SEDA DENTAL" || p === "NO USA SEDA DENTAL") { s.seda = p.startsWith("NO") ? "No" : "Sí"; return true; }
      if (p === "USA ENJUAGUE" || p === "NO USA ENJUAGUE") { s.enjuague = p.startsWith("NO") ? "No" : "Sí"; return true; }
      const limpieza = key(crudo).match(/^ULTIMA PROFILAXIS: (.+)$/);
      if (limpieza) { s.limpieza = opcion(LIMPIEZA, limpieza[1]) || ""; return Boolean(s.limpieza); }
      const odo = buscar(ODONTO, p);
      if (odo) s.odontologicos.add(odo);
      return Boolean(odo);
    },
    "Antecedentes familiares": (p, crudo, s) => {
      const fam = buscar(FAMILIARES, p);
      if (fam) s.familiares.add(fam);
      return Boolean(fam);
    }
  };

  // Los conjuntos de cada sección con lista y el texto que el panel escribe en ella.
  const LISTAS = {
    "Enfermedades": (s) => s.enfermedades,
    "Medicamentos": (s) => s.meds,
    "Antecedentes odontológicos": (s) => s.odontologicos,
    "Antecedentes familiares": (s) => s.familiares
  };
  function textoDe(titulo, s) {
    switch (titulo) {
      case "Alertas médicas": // el ASA solo si se respondió por las enfermedades
        return [...(s.enf !== null || s.enfermedades.size ? [asaSugerido(s).asa] : []), ...alertasFinales(s)];
      case "Enfermedades": { // solo los detalles que la lista no puede guardar
        const lista = [...s.enfermedades];
        return enfermedadesFinales(s).filter((t, i) => !nombres(lista[i]).includes(norm(t)));
      }
      case "Hábitos": return habitosFinales(s);
      case "Antecedentes odontológicos": return higiene(s) ? higiene(s).split(", ") : [];
      default: return [];
    }
  }

  // Una etiqueta de lista sigue siendo cierta si lo que significa sigue en el estado.
  function vigente(titulo, p, crudo, s) {
    const aparte = crearEstado();
    if (!RECONOCEDORES[titulo]?.(p, crudo, aparte)) return null;
    const vacio = crearEstado();
    return Object.keys(aparte).every((k) => {
      const v = aparte[k];
      if (v instanceof Set) return [...v].every((x) => s[k].has(x));
      if (k === "det") return Object.entries(v).every(([e, d]) => Object.entries(d).every(([c, x]) => JSON.stringify(det(s, e)[c]) === JSON.stringify(x)));
      if (v && typeof v === "object") return true; // previos, base, medDesde: no son respuestas
      return v === vacio[k] || v === s[k];
    });
  }

  // Un texto escrito por el panel es suyo solo si el estado lo vuelve a producir igual.
  function reproduce(titulo, crudo, s, deLista) {
    const k = key(crudo);
    if (titulo === "Alertas médicas" && /^ASA\b/.test(k)) return true;
    if (deLista || LISTAS[titulo]) {
      const fresco = crearEstado();
      if (vigente(titulo, norm(crudo), crudo, s) && RECONOCEDORES[titulo](norm(crudo), crudo, fresco)
        && (deLista || [...(LISTAS[titulo]?.(fresco) || [])].some((x) => nombres(x).includes(norm(crudo))))) return true;
    }
    return textoDe(titulo, s).some((t) => key(t) === k);
  }

  // La ficha como respuestas del panel, para confirmar y corregir.
  function estadoDesdeFicha(secciones) {
    const s = crearEstado();
    const pendientes = [];
    for (const [titulo, seccion] of Object.entries(secciones)) {
      const meta = SECCION_PASO[titulo];
      if (!meta) continue;
      const partes = [
        ...(seccion.lista || []).map((crudo) => ({ crudo: spaces(crudo), deLista: true })),
        ...partir(seccion.texto).map((crudo) => ({ crudo, deLista: false }))
      ].filter((x) => x.crudo);
      if (!partes.length) continue;
      s.hechos.add(meta.paso);
      const base = (s.base[titulo] = new Set());

      const reconocer = RECONOCEDORES[titulo];
      if (!reconocer) { // Motivo y Enfermedad actual: se conservan tal cual
        s.previos[titulo] = [spaces(seccion.texto) || partes.map((x) => x.crudo).join(", ")];
        continue;
      }
      const reales = partes.filter((x) => !NADA.test(norm(x.crudo)));
      partes.filter((x) => NADA.test(norm(x.crudo))).forEach((x) => base.add(key(x.crudo)));
      const niega = !reales.length || (titulo === "Alertas médicas" && reales.every((x) => /^ASA\b/.test(norm(x.crudo))));
      if (meta.clave) s[meta.clave] = !niega;
      if (titulo === "Hábitos" && niega) s.tabaco = "No";

      const vistos = new Set();
      for (const x of reales) {
        if (vistos.has(`${x.deLista}|${key(x.crudo)}`)) continue;
        vistos.add(`${x.deLista}|${key(x.crudo)}`);
        if (reconocer(norm(x.crudo), x.crudo, s)) pendientes.push({ titulo, ...x });
        else (s.previos[titulo] ||= []).push(x.crudo);
      }
    }
    // Con todo leído, se comprueba qué entiende de verdad el panel.
    for (const x of pendientes) {
      if (reproduce(x.titulo, x.crudo, s, x.deLista)) s.base[x.titulo].add(key(x.crudo));
      else (s.previos[x.titulo] ||= []).push(x.crudo);
    }
    if (s.tabaco === "" && s.hechos.has(4)) s.tabaco = "No";
    return s;
  }

  // Paciente nuevo: ninguna sección tiene nada (las comillas del motivo no cuentan).
  const fichaVacia = (secciones) => Object.values(secciones).every((seccion) => !(seccion.lista || []).length && !partir(seccion.texto).length);

  // ═══ 4. Plan de escritura: qué marcar, qué quitar y qué texto dejar ══════
  // Se quita o reescribe solo lo que el panel leyó y entiende (base); lo demás se respeta.
  function planEscritura(s, ficha) {
    const plan = {};
    for (const [titulo, seccion] of Object.entries(ficha)) {
      const lista = seccion.lista || [];
      const base = s.base[titulo] || new Set();
      const actual = partir(seccion.texto);

      if (titulo === "Motivo de consulta" || titulo === "Enfermedad actual") {
        const propio = titulo === "Motivo de consulta" ? motivoFinal(s) : enfermedadActual(s);
        plan[titulo] = { marcar: [], quitar: [], alias: {}, texto: actual.length ? spaces(seccion.texto) : propio };
        continue;
      }

      const elegidos = LISTAS[titulo] ? [...LISTAS[titulo](s)] : [];
      const nuevos = textoDe(titulo, s);
      const quitar = [];
      const quedan = [];
      for (const etiqueta of lista) {
        const p = norm(etiqueta);
        if (NADA.test(p)) continue; // se decide al final
        const propia = base.has(key(etiqueta));
        if (propia && vigente(titulo, p, etiqueta, s) === false) quitar.push(etiqueta);
        else quedan.push(etiqueta);
      }
      const marcar = elegidos.filter((item) => !quedan.some((etiqueta) => nombres(item).includes(norm(etiqueta))));

      // El ASA que no se volvió a calcular (enfermedades sin responder) se conserva.
      const sinAsaNuevo = !nuevos.some((t) => /^ASA\b/.test(norm(t)));
      const partes = [];
      const agregar = (parte) => {
        const repetida = partes.some((x) => key(x) === key(parte)) || quedan.some((x) => norm(x) === norm(parte));
        if (!repetida) partes.push(parte);
      };
      actual.filter((parte) => !NADA.test(norm(parte))).forEach((parte) => {
        const propia = base.has(key(parte));
        const asa = titulo === "Alertas médicas" && /^ASA\b/.test(norm(parte));
        if (!propia || nuevos.some((t) => key(t) === key(parte)) || (asa && sinAsaNuevo)) agregar(parte);
      });
      nuevos.forEach(agregar);

      const hayDatos = quedan.length + marcar.length + partes.length > 0;
      lista.filter((etiqueta) => NADA.test(norm(etiqueta))).forEach((etiqueta) => { if (hayDatos) quitar.push(etiqueta); });
      const niegaAhora = SECCION_PASO[titulo].clave ? s[SECCION_PASO[titulo].clave] === false
        : titulo === "Hábitos" && s.tabaco === "No";
      const yaNiega = lista.some((e) => NADA.test(norm(e))) || actual.some((t) => NADA.test(norm(t)));
      if (!hayDatos && (niegaAhora || yaNiega)) {
        const textoNada = actual.find((t) => NADA.test(norm(t)));
        if (textoNada) partes.push(textoNada);
        else if (!lista.some((e) => NADA.test(norm(e)))) partes.push("NIEGA");
      }

      // Diabetes: buscar en la lista el nombre de su tipo, no el de otro.
      const alias = {};
      if (marcar.includes("Diabetes") && det(s, "Diabetes").tipo) alias.Diabetes = [up(`Diabetes mellitus ${det(s, "Diabetes").tipo}`)];
      plan[titulo] = { marcar, quitar, alias, texto: partes.join(", ") };
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
        const marcado = await pickFromList(card, item, paso.alias?.[item] || [], sigue);
        if (marcado === "cancelado") return resultado;
        if (marcado) resultado.marcados.push(item);
        else { resultado.aTexto.push(item); extra.push(up(item)); }
      }
      if (!sigue()) return resultado;
      const partes = partir(paso.texto);
      extra.forEach((parte) => { if (!partes.some((x) => norm(x) === norm(parte))) partes.push(parte); });
      // Lo que no se encontró en la lista reemplaza un «NIEGA».
      const texto = (extra.length ? partes.filter((p) => norm(p) !== "NIEGA") : partes).join(", ");
      if (textarea.value !== texto) setValue(textarea, texto);
    }
    return resultado;
  }

  // ═══ 6. Panel lateral paso a paso ═══════════════════════════════════════
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const detDe = (s, enf) => (s.det[enf] ||= {});

  // Piezas de interfaz; cada una lleva en data-* lo que cambia al pulsarla.
  const siNo = (s, clave) => `<div class="dlk-an-seg" data-yn="${clave}"><button data-v="no" class="${s[clave] === false ? "dlk-an-on" : ""}">No</button><button data-v="si" class="${s[clave] === true ? "dlk-an-on" : ""}">Sí</button></div>`;
  const chipsDe = (s, clave, items, extra = "") => `<div class="dlk-an-chips">${items.map((i) => `<button class="dlk-an-chip ${extra} ${s[clave].has(i) ? "dlk-an-on" : ""}" data-set="${clave}" data-v="${esc(i)}">${esc(i)}</button>`).join("")}</div>`;
  const segmento = (s, clave, items) => `<div class="dlk-an-seg" data-val="${clave}">${items.map((i) => `<button data-v="${esc(i)}" class="${s[clave] === i ? "dlk-an-on" : ""}">${esc(i)}</button>`).join("")}</div>`;
  const segmentoDet = (s, enf, k, items, multi) => `<div class="dlk-an-seg" data-det="${esc(enf)}" data-k="${k}" ${multi ? "data-multi" : ""}>${items.map((i) => {
    const v = det(s, enf)[k];
    const on = multi ? (v || []).includes(i) : v === i;
    return `<button data-v="${esc(i)}" class="${on ? "dlk-an-on" : ""}">${esc(i)}</button>`;
  }).join("")}</div>`;
  const numero = (atributos, valor, placeholder) => `<input type="text" inputmode="decimal" class="dlk-an-num" maxlength="4" ${atributos} value="${esc(valor)}" placeholder="${placeholder}">`;
  const aviso = (a) => `<div class="dlk-an-alert dlk-an-${a.tipo}"><b>${esc(a.titulo)}</b>${esc(a.texto)}</div>`;
  const q = (texto, nota = "") => `<div class="dlk-an-q">${texto}${nota ? ` <small>${nota}</small>` : ""}</div>`;
  // Lo que la ficha ya tenía y el panel no reconoce: se ve, no se pierde.
  const previosDe = (s, titulo) => (s.previos[titulo]?.length
    ? `${q("Ya en la ficha", "se conserva")}<div class="dlk-an-chips">${s.previos[titulo].map((p) => `<span class="dlk-an-chip dlk-an-previo">${esc(p)}</span>`).join("")}</div>` : "");

  function tarjetaEnfermedad(s, e) {
    const cfg = ENF[e];
    const preguntas = (cfg.preguntas || []).map((p) => q(p.q) + (p.input
      ? `<div class="dlk-an-row">${numero(`data-detinput="${esc(e)}" data-k="${p.k}"`, det(s, e)[p.k], "7,0")}<span class="dlk-an-hint">${p.input}</span></div>`
      : segmentoDet(s, e, p.k, p.op, p.multi))).join("");
    const meds = cfg.meds.length ? q("¿Qué toma para esto?", "se pasa a Medicamentos") +
      `<div class="dlk-an-chips">${cfg.meds.map((m) => `<button class="dlk-an-chip ${s.meds.has(m) ? "dlk-an-on" : ""}" data-med="${esc(m)}" data-from="${esc(e)}">${esc(m)}</button>`).join("")}</div>` : "";
    return `<div class="dlk-an-sub"><h6>${esc(e)}</h6>${preguntas}${meds}</div>`;
  }

  const PASOS = [
    { titulo: "Motivo y enfermedad actual",
      resumen: (s) => [...s.motivos].join(", ") || (s.previos["Motivo de consulta"] || [])[0] || "",
      cuerpo: (s) => `${previosDe(s, "Motivo de consulta")}${previosDe(s, "Enfermedad actual")}
        ${q("¿A qué viene?")}
        <div class="dlk-an-chips">${MOTIVOS.map((m) => `<button class="dlk-an-chip ${s.motivos.has(m.t) ? "dlk-an-on" : ""}" data-motivo="${esc(m.t)}">${esc(m.t)}</button>`).join("")}</div>
        ${q("En sus palabras", "opcional")}
        <input type="text" class="dlk-an-text" data-text="motivoTexto" value="${esc(s.motivoTexto)}" placeholder="me sangran las encías al cepillarme">
        ${q("¿Qué más nota?")}${chipsDe(s, "sintomas", SINTOMAS)}
        ${q("¿Desde hace cuánto?")}${segmento(s, "tiempo", TIEMPOS)}
        <div class="dlk-an-preview">${esc(enfermedadActual(s))}</div>` },

    { titulo: "Alertas: alergias, embarazo, profilaxis",
      resumen: (s) => (s.alertas === false ? "Niega" : [...s.alergias, s.embarazo, s.profilaxis.size ? "profilaxis" : ""].filter(Boolean).join(", ")),
      cuerpo: (s) => `${q("¿Alergias, embarazo o le han dicho que necesita antibiótico antes del odontólogo?")}${siNo(s, "alertas")}
        <div class="dlk-an-more ${s.alertas ? "dlk-an-show" : ""}">
          ${q("Alergias")}${chipsDe(s, "alergias", ALERGIAS.map((a) => a.t))}
          ${ALERGIAS.filter((a) => a.alt && s.alergias.has(a.t)).map((a) => `<div class="dlk-an-alert dlk-an-info"><b>Alergia a ${esc(a.t.toLowerCase())}</b>${esc(a.alt)}.</div>`).join("")}
          ${q("Embarazo o lactancia")}${segmento(s, "embarazo", ["Embarazo", "Lactancia"])}
          ${s.embarazo === "Embarazo" ? `<div class="dlk-an-row">${numero('data-text="semanas" data-int', s.semanas, "20")}<span class="dlk-an-hint">semanas</span></div>` : ""}
          ${q("Profilaxis antibiótica por…")}${chipsDe(s, "profilaxis", PROFILAXIS)}
        </div>${previosDe(s, "Alertas médicas")}` },

    { titulo: "Enfermedades",
      resumen: (s) => (s.enf === false ? "Niega" : [...s.enfermedades].map((e) => ENF[e].corto || e).join(", ")),
      cuerpo: (s) => {
        const comunes = Object.keys(ENF).filter((e) => ENF[e].comun);
        const otras = Object.keys(ENF).filter((e) => !ENF[e].comun);
        return `${q("¿Tiene alguna enfermedad diagnosticada?")}${siNo(s, "enf")}
        <div class="dlk-an-more ${s.enf ? "dlk-an-show" : ""}">
          ${q("Las más frecuentes")}
          <div class="dlk-an-tiles">${comunes.map((e) => `<button class="dlk-an-tile ${s.enfermedades.has(e) ? "dlk-an-on" : ""}" data-enf="${esc(e)}">${esc(e)}<small>${esc(ENF[e].meds.slice(0, 2).join(", "))}</small></button>`).join("")}</div>
          ${q("Otras")}
          <div class="dlk-an-chips">${otras.map((e) => `<button class="dlk-an-chip ${s.enfermedades.has(e) ? "dlk-an-on" : ""}" data-enf="${esc(e)}">${esc(e)}</button>`).join("")}</div>
          ${[...s.enfermedades].map((e) => tarjetaEnfermedad(s, e)).join("")}
          ${avisos(s).filter((a) => /Diabetes|HbA1c|HTA|osteonecrosis/i.test(a.titulo)).map(aviso).join("")}
        </div>${previosDe(s, "Enfermedades")}`;
      } },

    { titulo: "Medicamentos",
      resumen: (s) => (s.med === false ? "Niega" : [...s.meds].join(", ")),
      cuerpo: (s) => {
        const anotados = [...s.meds];
        const sugeridos = [...new Set([...s.enfermedades].flatMap((e) => ENF[e].meds))].filter((m) => !s.meds.has(m));
        const frecuentes = MEDS_FRECUENTES.filter((m) => !s.meds.has(m) && !sugeridos.includes(m));
        return `${q("¿Toma algún medicamento de forma habitual?")}${siNo(s, "med")}
        <div class="dlk-an-more ${s.med ? "dlk-an-show" : ""}">
          ${anotados.length ? q("Ya anotados") + `<div class="dlk-an-chips">${anotados.map((m) => `<button class="dlk-an-chip dlk-an-on" data-med="${esc(m)}">${esc(m)}${s.medDesde[m] ? `<span class="dlk-an-from">· ${esc(ENF[s.medDesde[m]]?.corto || s.medDesde[m])}</span>` : ""}</button>`).join("")}</div>` : ""}
          ${sugeridos.length ? q("Por sus enfermedades") + `<div class="dlk-an-chips">${sugeridos.map((m) => `<button class="dlk-an-chip dlk-an-sug" data-med="${esc(m)}">${esc(m)}</button>`).join("")}</div>` : ""}
          ${q("Frecuentes")}<div class="dlk-an-chips">${frecuentes.map((m) => `<button class="dlk-an-chip" data-med="${esc(m)}">${esc(m)}</button>`).join("")}</div>
          ${q("Buscar otro")}
          <div class="dlk-an-row"><input type="text" class="dlk-an-text" id="dlk-an-med-otro" list="dlk-an-meds" placeholder="Escribe: alen… warf… predn…"><button class="dlk-an-chip" data-an="med-add">Agregar</button></div>
          ${avisos(s).filter((a) => !/Diabetes|HbA1c|HTA|Embarazo|profilaxis/i.test(a.titulo)).map(aviso).join("")}
        </div>${previosDe(s, "Medicamentos")}`;
      } },

    { titulo: "Hábitos",
      resumen: (s) => (s.tabaco === "No" && !habitosFinales(s).length ? "Niega" : habitosFinales(s).join(", ")),
      cuerpo: (s) => `${q("¿Fuma o consume algo?")}${segmento(s, "tabaco", ["No", "Fuma", "Exfumador"])}
        ${s.tabaco === "Fuma" ? `<div class="dlk-an-sub">
          ${q("¿Qué?")}${chipsDe(s, "fuma", FUMA)}
          ${s.fuma.has("Cigarrillo") ? q("Cigarrillos al día") + segmento(s, "cantidad", CANTIDAD) + q("¿Desde hace cuánto?") + segmento(s, "anios", ANIOS) : ""}
          ${s.fuma.has("Cannabis") ? q("Cannabis, ¿con qué frecuencia?") + segmento(s, "cannabisFrec", FRECUENCIA) : ""}
          ${s.fuma.has("Vapeador") ? q("Vapeador, ¿con qué frecuencia?") + segmento(s, "vapeoFrec", FRECUENCIA) : ""}
          ${gradoTabaco(s) ? `<div class="dlk-an-alert dlk-an-warn"><b>Tabaco → grado ${gradoTabaco(s)}</b>Factor modificador de la periodontitis.</div>` : ""}
          ${s.fuma.has("Cannabis") ? `<div class="dlk-an-alert dlk-an-info"><b>Cannabis</b>También se asocia a mayor pérdida de inserción.</div>` : ""}
        </div>` : ""}
        ${s.tabaco === "Exfumador" ? `<div class="dlk-an-sub">${q("¿Hace cuánto dejó?")}${segmento(s, "dejo", DEJO)}</div>` : ""}
        ${q("¿Alcohol?")}${segmento(s, "alcohol", ["No", ...FRECUENCIA])}
        ${q("¿Aprieta o rechina los dientes?")}${segmento(s, "bruxismo", ["No", "Sí"])}
        ${s.bruxismo === "Sí" ? `<div class="dlk-an-sub">${q("¿Cuándo?")}${chipsDe(s, "bruxTipo", ["Nocturno", "Diurno"])}${q("¿Usa placa?")}${segmento(s, "placa", ["Sí", "No"])}</div>` : ""}
        ${q("Otros")}${chipsDe(s, "otrosHab", OTROS_HAB)}${previosDe(s, "Hábitos")}` },

    { titulo: "Antecedentes odontológicos e higiene",
      resumen: (s) => [[...s.odontologicos].join(", "), s.cepillado && `cepillado ${s.cepillado}/día`].filter(Boolean).join(" · "),
      cuerpo: (s) => `${q("Tratamientos anteriores")}${chipsDe(s, "odontologicos", ODONTO)}
        ${s.odontologicos.has("Exodoncias por movilidad") ? `<div class="dlk-an-alert dlk-an-warn"><b>Pérdida dental por periodontitis</b>Dato clave para el estadio.</div>` : ""}
        ${q("Última limpieza")}${segmento(s, "limpieza", LIMPIEZA)}
        ${q("¿Cuántas veces se cepilla al día?")}${segmento(s, "cepillado", ["1", "2", "3", "> 3"])}
        <div class="dlk-an-row">${q("¿Seda?")}${segmento(s, "seda", ["Sí", "No"])}${q("¿Enjuague?")}${segmento(s, "enjuague", ["Sí", "No"])}</div>
        ${previosDe(s, "Antecedentes odontológicos")}` },

    { titulo: "Antecedentes familiares",
      resumen: (s) => (s.fam === false ? "Niega" : [...s.familiares].join(", ")),
      cuerpo: (s) => `${q("¿En la familia hay periodontitis, pérdida temprana de dientes o diabetes?")}${siNo(s, "fam")}
        <div class="dlk-an-more ${s.fam ? "dlk-an-show" : ""}">${q("¿Cuáles?")}${chipsDe(s, "familiares", FAMILIARES)}</div>
        ${previosDe(s, "Antecedentes familiares")}` },

    { titulo: "Revisión final",
      resumen: () => "",
      cuerpo: (s) => {
        const asa = asaSugerido(s);
        const fila = (t, v) => `<dt>${t}</dt><dd>${esc(v)}</dd>`;
        return `<div class="dlk-an-alert dlk-an-ok"><b>${esc(asa.asa)} sugerido</b>${esc(asa.why)}</div>
        ${avisos(s).map(aviso).join("")}
        <dl class="dlk-an-sum">
          ${fila("Motivo", motivoFinal(s) || (s.previos["Motivo de consulta"] || []).join(", ") || "—")}
          ${fila("Enfermedad actual", (s.previos["Enfermedad actual"] || [])[0] || enfermedadActual(s))}
          ${fila("Alertas", [asa.asa, ...alertasFinales(s)].join(" · "))}
          ${fila("Enfermedades", enfermedadesFinales(s).join(", ") || "NIEGA")}
          ${fila("Medicamentos", up([...s.meds].join(", ")) || "NIEGA")}
          ${fila("Hábitos", habitosFinales(s).join(", ") || "NIEGA")}
          ${fila("Odontológicos", [up([...s.odontologicos].join(", ")), higiene(s)].filter(Boolean).join(". ") || "—")}
          ${fila("Familiares", up([...s.familiares].join(", ")) || "NIEGA")}
        </dl>
        <div class="dlk-an-hint">Se escribe en la ficha al pulsar «Pasar a Dentalink». Lo que ya estaba y no se reconoce se conserva.</div>`;
      } }
  ];

  function htmlPanel(s, abierto, plegado) {
    if (plegado) return `<button class="dlk-an-pestana" data-an="abrir">Anamnesis</button>`;
    const ultimo = PASOS.length - 1;
    const pasos = PASOS.map((p, i) => {
      const hecho = s.hechos.has(i);
      return `<div class="dlk-an-step ${i === abierto ? "dlk-an-open" : ""} ${hecho ? "dlk-an-done" : ""}" data-i="${i}">
        <div class="dlk-an-step-h" data-paso="${i}"><div class="dlk-an-num-paso">${hecho ? "✓" : i + 1}</div>
          <div class="dlk-an-step-t"><b>${p.titulo}</b><span>${esc(p.resumen(s) || (hecho ? "" : "Pendiente"))}</span></div></div>
        ${i === abierto ? `<div class="dlk-an-step-b">${p.cuerpo(s)}${i < ultimo ? `<button class="dlk-an-next" data-an="siguiente">Siguiente</button>` : ""}</div>` : ""}
      </div>`;
    }).join("");
    return `<aside class="dlk-an-panel">
      <div class="dlk-an-head"><div><b>Anamnesis paso a paso</b>
        <div class="dlk-an-hint">${abierto === ultimo ? "Revisa y pasa a la ficha" : `Paso ${abierto + 1} de ${PASOS.length}`}</div></div>
        <button class="dlk-an-plegar" data-an="plegar" title="Plegar">→</button></div>
      <div class="dlk-an-progress"><i style="width:${(s.hechos.size / ultimo) * 100}%"></i></div>
      <div class="dlk-an-steps">${pasos}</div>
      <div class="dlk-an-foot"><button class="dlk-an-go" data-an="pasar" ${abierto === ultimo ? "" : "disabled"}>Pasar a Dentalink</button></div>
    </aside>`;
  }

  const PANEL_CSS = `
    #dlk-an-raiz { --an-blue:#2a6fdb; --an-line:#e3e7ec; --an-muted:#8a919c; font:13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; color:#2b2f36; }
    #dlk-an-raiz *, #dlk-an-raiz *::before { box-sizing:border-box; }
    .dlk-an-panel { position:fixed; right:0; top:0; height:100vh; width:460px; z-index:1040; background:#fff; border-left:1px solid var(--an-line);
      box-shadow:-6px 0 16px rgba(0,0,0,.08); display:flex; flex-direction:column; }
    .dlk-an-pestana { position:fixed; right:0; top:40%; z-index:1040; width:32px; padding:14px 0; writing-mode:vertical-rl; transform:rotate(180deg);
      background:var(--an-blue); color:#fff; border:0; border-radius:0 8px 8px 0; font:600 12px/1 inherit; cursor:pointer; box-shadow:-2px 0 8px rgba(0,0,0,.15); }
    .dlk-an-head { display:flex; justify-content:space-between; align-items:flex-start; padding:14px 16px 8px; }
    .dlk-an-head b { font-size:15px; }
    .dlk-an-plegar { border:1px solid #cfd5dd; background:#fff; border-radius:6px; padding:2px 9px; cursor:pointer; font:inherit; }
    .dlk-an-progress { height:4px; background:#eef0f3; margin:0 16px 8px; border-radius:2px; overflow:hidden; }
    .dlk-an-progress i { display:block; height:100%; background:var(--an-blue); transition:width .25s; }
    .dlk-an-steps { flex:1; overflow:auto; border-top:1px solid var(--an-line); }
    .dlk-an-step { border-bottom:1px solid #f0f2f5; }
    .dlk-an-step-h { display:flex; align-items:center; gap:10px; padding:10px 16px; cursor:pointer; }
    .dlk-an-num-paso { width:22px; height:22px; border-radius:50%; background:#cfd5dd; color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; flex:none; }
    .dlk-an-open .dlk-an-num-paso { background:var(--an-blue); }
    .dlk-an-done .dlk-an-num-paso { background:#1e7e34; }
    .dlk-an-step-t { flex:1; min-width:0; }
    .dlk-an-step-t b { display:block; }
    .dlk-an-step-t span { display:block; color:var(--an-muted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .dlk-an-step-b { padding:2px 16px 14px 48px; }
    .dlk-an-q { font-weight:600; margin:12px 0 6px; font-size:12px; }
    .dlk-an-q small { font-weight:400; color:var(--an-muted); }
    .dlk-an-seg { display:inline-flex; flex-wrap:wrap; border:1px solid #cfd5dd; border-radius:6px; overflow:hidden; }
    .dlk-an-seg button { border:0; background:#fff; padding:5px 12px; font:inherit; font-size:12px; cursor:pointer; color:#2b2f36; }
    .dlk-an-seg button + button { border-left:1px solid #cfd5dd; }
    .dlk-an-seg button.dlk-an-on { background:var(--an-blue); color:#fff; }
    .dlk-an-chips { display:flex; flex-wrap:wrap; gap:6px; }
    .dlk-an-chip { border:1px solid #cfd5dd; background:#fff; border-radius:999px; padding:4px 10px; font:inherit; font-size:12px; cursor:pointer; color:#2b2f36; }
    .dlk-an-chip.dlk-an-on { background:var(--an-blue); border-color:var(--an-blue); color:#fff; }
    .dlk-an-chip.dlk-an-sug { border-style:dashed; border-color:#e0a43a; color:#a86400; background:#fff6e5; }
    .dlk-an-chip.dlk-an-previo { background:#eef0f3; border-color:#eef0f3; color:#5f6672; cursor:default; }
    .dlk-an-from { font-size:10px; opacity:.8; margin-left:4px; }
    .dlk-an-tiles { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; }
    .dlk-an-tile { border:1px solid #cfd5dd; border-radius:8px; background:#fff; padding:8px 6px; font:inherit; font-size:12px; font-weight:600; cursor:pointer; color:#2b2f36; }
    .dlk-an-tile small { display:block; font-weight:400; color:var(--an-muted); font-size:10px; }
    .dlk-an-tile.dlk-an-on { border-color:var(--an-blue); background:#eef3fb; color:#1d4fa3; box-shadow:inset 0 0 0 1px var(--an-blue); }
    .dlk-an-sub { border:1px solid var(--an-line); border-left:3px solid var(--an-blue); border-radius:6px; padding:2px 10px 10px; margin-top:8px; background:#fbfcfe; }
    .dlk-an-sub h6 { margin:8px 0 0; font-size:12px; color:#1d4fa3; }
    .dlk-an-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px; }
    .dlk-an-row .dlk-an-q { margin:0; }
    .dlk-an-text, .dlk-an-num { border:1px solid #cfd5dd; border-radius:5px; padding:5px 8px; font:inherit; font-size:12px; }
    .dlk-an-text { width:100%; }
    .dlk-an-row .dlk-an-text { flex:1; width:auto; }
    .dlk-an-num { width:64px; text-align:right; }
    .dlk-an-more { display:none; }
    .dlk-an-more.dlk-an-show { display:block; }
    .dlk-an-hint { color:var(--an-muted); font-size:11px; margin-top:4px; }
    .dlk-an-alert { border-radius:6px; padding:7px 10px; font-size:12px; margin-top:8px; }
    .dlk-an-alert b { display:block; }
    .dlk-an-warn { background:#fff6e5; color:#7a5200; border:1px solid #f1d9a8; }
    .dlk-an-danger { background:#fdecea; color:#b3261e; border:1px solid #f4c7c3; }
    .dlk-an-ok { background:#e6f4ea; color:#1e7e34; border:1px solid #bfe3c8; }
    .dlk-an-info { background:#eef3fb; color:#1d4fa3; border:1px solid #cfe0fb; }
    .dlk-an-preview { background:#f7f8fa; border:1px solid var(--an-line); border-radius:6px; padding:8px 10px; font-size:11px; margin-top:8px; }
    .dlk-an-next { margin-top:12px; background:var(--an-blue); color:#fff; border:0; border-radius:6px; padding:7px 14px; font:inherit; font-weight:600; cursor:pointer; }
    .dlk-an-foot { border-top:1px solid var(--an-line); padding:12px 16px; }
    .dlk-an-go { width:100%; background:var(--an-blue); color:#fff; border:0; border-radius:6px; padding:9px; font:inherit; font-weight:700; cursor:pointer; }
    .dlk-an-go:disabled { background:#b9c7dc; cursor:default; }
    .dlk-an-sum dt { font-weight:600; font-size:11px; color:var(--an-muted); text-transform:uppercase; margin-top:8px; }
    .dlk-an-sum dd { margin:2px 0 0; font-size:12px; }
    #dlk-anam-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1f2937; color:#fff;
      padding:8px 14px; border-radius:8px; font-size:13px; opacity:0; pointer-events:none; transition:opacity .2s; z-index:99999; max-width:560px; }
    #dlk-anam-toast.dlk-show { opacity:1; }
  `;

  // Estado del panel montado en la página.
  const panel = { estado: null, abierto: 0, plegado: true, raiz: null, ocupado: false };

  function pintar() {
    if (!panel.raiz || !panel.estado) return;
    const pasos = panel.raiz.querySelector(".dlk-an-steps");
    const scroll = pasos ? pasos.scrollTop : 0;
    panel.raiz.innerHTML = htmlPanel(panel.estado, panel.abierto, panel.plegado) +
      `<datalist id="dlk-an-meds">${MEDS_TODOS.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>`;
    const nuevos = panel.raiz.querySelector(".dlk-an-steps");
    if (nuevos) nuevos.scrollTop = scroll;
  }

  function montarPanel(s, { plegado }) {
    if (!document.getElementById("dlk-an-css")) {
      const style = document.createElement("style");
      style.id = "dlk-an-css";
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }
    if (!panel.raiz) {
      panel.raiz = document.createElement("div");
      panel.raiz.id = "dlk-an-raiz";
      panel.raiz.addEventListener("click", alPulsar);
      panel.raiz.addEventListener("input", alEscribir);
      panel.raiz.addEventListener("change", (e) => { if (e.target.classList.contains("dlk-an-num")) pintar(); });
      panel.raiz.addEventListener("keydown", alTeclear);
      document.body.appendChild(panel.raiz);
    }
    panel.estado = s;
    panel.plegado = plegado;
    panel.abierto = [...PASOS.keys()].find((i) => !s.hechos.has(i)) ?? PASOS.length - 1;
    pintar();
  }

  function desmontarPanel() {
    panel.raiz?.remove();
    panel.raiz = null;
    panel.estado = null;
  }

  function alternarPanel(abrir) {
    panel.plegado = !abrir;
    pintar();
  }

  function avanzar() {
    panel.estado.hechos.add(panel.abierto);
    panel.abierto = Math.min(panel.abierto + 1, PASOS.length - 1);
  }

  // Responder «No» borra lo elegido en esa sección: el panel no puede decir
  // «Niega» y a la vez escribir datos.
  const AL_NEGAR = {
    alertas: (s) => { s.alergias.clear(); s.profilaxis.clear(); s.embarazo = ""; s.semanas = ""; },
    enf: (s) => { s.enfermedades.clear(); s.det = {}; },
    med: (s) => { s.meds.clear(); s.medDesde = {}; },
    fam: (s) => { s.familiares.clear(); }
  };
  function responder(s, clave, valor) {
    s[clave] = valor;
    if (valor === false) AL_NEGAR[clave]?.(s);
  }

  function alternarMed(s, med, desde) {
    if (s.meds.has(med)) { s.meds.delete(med); delete s.medDesde[med]; return; }
    s.meds.add(med);
    if (desde) s.medDesde[med] = desde;
    s.med = true;
  }

  async function pasarADentalink() {
    if (panel.ocupado) return;
    panel.ocupado = true;
    const boton = panel.raiz.querySelector(".dlk-an-go");
    if (boton) { boton.disabled = true; boton.textContent = "Escribiendo en la ficha…"; }
    try {
      const plan = planEscritura(panel.estado, leerSecciones());
      const r = await aplicarPlan(plan, { ruta: location.pathname });
      if (r.cancelado) return flash("Se salió de la ficha: no se terminó de escribir.");
      const aTexto = r.aTexto.length ? ` No estaban en la lista (van en «Otros»): ${r.aTexto.join(", ")}.` : "";
      flash(`Listo en la ficha.${aTexto} Revisa y pulsa Guardar.`);
    } finally {
      panel.ocupado = false;
      pintar();
    }
  }

  function alPulsar(e) {
    const t = e.target.closest("button, [data-paso]");
    if (!t || !panel.estado) return;
    e.preventDefault();
    const s = panel.estado;
    const accion = t.dataset.an;
    if (!["abrir", "plegar", "siguiente"].includes(accion) && t.dataset.paso === undefined) s.tocado = true;
    if (accion === "abrir") return alternarPanel(true);
    if (accion === "plegar") return alternarPanel(false);
    if (accion === "siguiente") { avanzar(); return pintar(); }
    if (accion === "pasar") return pasarADentalink();
    if (accion === "med-add") {
      const input = panel.raiz.querySelector("#dlk-an-med-otro");
      const v = spaces(input?.value);
      if (v) alternarMed(s, MEDS_TODOS.find((m) => norm(m) === norm(v)) || v[0].toUpperCase() + v.slice(1));
      return pintar();
    }
    if (t.dataset.paso !== undefined) { panel.abierto = Number(t.dataset.paso); return pintar(); }
    const yn = t.closest("[data-yn]");
    if (yn) {
      responder(s, yn.dataset.yn, t.dataset.v === "si");
      if (t.dataset.v === "no") avanzar();
      return pintar();
    }
    if (t.dataset.motivo) {
      const motivo = MOTIVOS.find((m) => m.t === t.dataset.motivo);
      if (s.motivos.has(motivo.t)) s.motivos.delete(motivo.t);
      else { s.motivos.add(motivo.t); motivo.sint.forEach((x) => s.sintomas.add(x)); }
      return pintar();
    }
    if (t.dataset.enf) {
      const enf = t.dataset.enf;
      if (s.enfermedades.has(enf)) s.enfermedades.delete(enf); else s.enfermedades.add(enf);
      return pintar();
    }
    if (t.dataset.med) { alternarMed(s, t.dataset.med, t.dataset.from); return pintar(); }
    if (t.dataset.set) {
      const set = s[t.dataset.set];
      if (set.has(t.dataset.v)) set.delete(t.dataset.v); else set.add(t.dataset.v);
      return pintar();
    }
    const d = t.closest("[data-det]");
    if (d) {
      const o = detDe(s, d.dataset.det);
      const k = d.dataset.k;
      const v = t.dataset.v;
      if (d.hasAttribute("data-multi")) {
        const arr = o[k] || [];
        o[k] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      } else o[k] = o[k] === v ? "" : v;
      return pintar();
    }
    const sv = t.closest("[data-val]");
    if (sv) {
      const k = sv.dataset.val;
      s[k] = s[k] === t.dataset.v ? "" : t.dataset.v;
      return pintar();
    }
  }

  // Mientras escribe solo se limpia el número; los avisos se recalculan al salir del campo.
  function alEscribir(e) {
    const el = e.target;
    const s = panel.estado;
    if (!s) return;
    if (el.classList.contains("dlk-an-num")) {
      let v = el.value.replace(".", ",").replace(el.hasAttribute("data-int") ? /[^0-9]/g : /[^0-9,]/g, "");
      const [entero, ...decimales] = v.split(",");
      if (decimales.length) v = `${entero},${decimales.join("").slice(0, 1)}`;
      if (v !== el.value) el.value = v;
    }
    if (el.dataset.text) s[el.dataset.text] = el.value;
    else if (el.dataset.detinput) detDe(s, el.dataset.detinput)[el.dataset.k] = el.value;
    s.tocado = true;
  }

  function alTeclear(e) {
    if (e.key !== "Enter") return;
    if (e.target.id === "dlk-an-med-otro") { e.preventDefault(); panel.raiz.querySelector('[data-an="med-add"]')?.click(); }
    if (e.target.classList.contains("dlk-an-num")) e.target.blur();
  }

  // ─── Utilidades ─────────────────────────────────────────────────────────
  const TITLES = [
    "Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades",
    "Medicamentos", "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"
  ];

  const spaces = (t) => String(t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const key = (t) => spaces(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  // Para comparar con la lista de Dentalink, que mezcla may\u00fasculas, tildes y puntos.
  const norm = (t) => key(t).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Busca el elemento en el desplegable de Dentalink, marca su casilla y pulsa Aceptar.
  // Solo toca casillas y Aceptar: nunca "Nuevo …" ni la papelera, que cambian el catálogo.
  async function pickFromList(card, item, extra = [], sigue = () => true) {
    const { button, panel } = listParts(card);
    if (!button || !panel) return false;
    if (panel.offsetParent === null) {
      button.click();
      await sleep(300);
    }
    const search = panel.querySelector("input:not([type=checkbox])");
    if (search) setInputValue(search, norm(item).slice(0, 6).toLowerCase());

    const wanted = [...extra.map(norm), ...nombres(item)];
    let box = null;
    for (let waited = 0; waited < 3000 && !box; waited += 150) {
      await sleep(150);
      box = [...panel.querySelectorAll("input[type=checkbox]")]
        .find((input) => wanted.includes(norm(input.parentElement?.textContent)));
    }
    const accept = [...panel.querySelectorAll("footer *")].find((el) => spaces(el.textContent) === "Aceptar");
    if (!sigue()) { // se salió de la ficha mientras buscaba
      document.body.click();
      return "cancelado";
    }
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
    const wanted = nombres(item);
    const icon = [...card.querySelectorAll("i.fa-close")].find((el) => !panel?.contains(el) &&
      el.previousElementSibling?.tagName === "SPAN" && wanted.includes(norm(el.previousElementSibling.textContent)));
    icon?.click();
    return Boolean(icon);
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

  // ═══ 7. Ciclo de página ═════════════════════════════════════════════════
  // Respuestas por paciente mientras la pestaña siga abierta.
  const memoria = new Map();

  function sync() {
    const ficha = location.pathname.match(/\/pacientes\/(\d+)\/ficha\/antecedentes/);
    if (!ficha) {
      if (panel.raiz) desmontarPanel();
      return;
    }
    const paciente = ficha[1];
    const secciones = leerSecciones();
    if (!Object.keys(secciones).length) return; // la ficha aún no carga
    const firma = JSON.stringify(secciones);
    const guardado = memoria.get(paciente);

    if (panel.raiz && panel.paciente === paciente) {
      // Mientras no se haya respondido nada, el panel sigue a la ficha (puede cargar tarde).
      if (panel.estado.tocado || firma === panel.firma) return;
      panel.firma = firma;
      panel.estado = estadoDesdeFicha(secciones);
      memoria.set(paciente, panel.estado);
      return pintar();
    }
    const estado = guardado?.tocado ? guardado : estadoDesdeFicha(secciones);
    memoria.set(paciente, estado);
    panel.paciente = paciente;
    panel.firma = firma;
    montarPanel(estado, { plegado: !fichaVacia(secciones) });
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sync(); }, 300);
  }

  // Ignora los cambios del propio panel y del aviso.
  const propio = (n) => n === panel.raiz || panel.raiz?.contains?.(n) || n?.id === "dlk-anam-toast" || n?.id === "dlk-an-css";
  new MutationObserver((mutations) => {
    if (mutations.some((m) => !propio(m.target) && ![...m.addedNodes, ...m.removedNodes].every(propio))) schedule();
  }).observe(document.body, { childList: true, subtree: true });

  // Dentalink cambia de pestaña sin recargar.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; schedule(); }
  }, 800);

  if (globalThis.__DLK_ANAM_TEST__) {
    globalThis.__dlkAnamTest = {
      crearEstado, fmt, leerNumero, enfermedadActual, motivoFinal, avisos, gradoTabaco, asaSugerido,
      alertasFinales, enfermedadesFinales, habitosFinales, higiene, estadoDesdeFicha, fichaVacia, ALIAS,
      planEscritura, leerSecciones, aplicarPlan, PASOS, htmlPanel, montarPanel, alternarPanel, responder, partir,
      panelEstado: () => ({ montado: Boolean(panel.raiz), plegado: panel.plegado, estado: panel.estado })
    };
  }

  schedule();
})();
