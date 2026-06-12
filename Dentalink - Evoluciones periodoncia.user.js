// ==UserScript==
// @name         Dentalink - Evoluciones periodoncia
// @namespace    https://odontofamily.local/dentalink-evoluciones-periodoncia
// @version      2.3.0
// @description  Agrega botones de textos rápidos para evoluciones de periodoncia en Dentalink con contador de producción.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { isVisible, escapeHtml, getPatientIdFromUrl, onUrlChange } = window.__dlkUtils;

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN CLÍNICA (editar aquí los textos y precios frecuentes)
  // ═══════════════════════════════════════════════════════════════════════

  const CONFIG = {
    doctor: "Dr. Cristian Pena. Periodoncista.",
    diagnostico: "K05.3 - Periodontitis crónica",
    anestesia: {
      farmaco: "Lidocaina 2% con epinefrina 1:80.000"
    },
    farmacologia: {
      naproxeno: "Naproxeno 500mg tabletas #9 Tomar 1 tab cada 8 horas por 3 días. En caso de dolor no tolerable o indicación en posología."
    },
    sutura: "Seda 3.0 punto simple",
    metaDiaria: 3000000,
    notaControles: "NOTA IMPORTANTE: Se informa al paciente que es fundamental mantener controles periodontales cada 3 meses para evitar reincidencia y exacerbación de la enfermedad periodontal.",

    // Precios por defecto (pesos colombianos). Se pueden editar desde el panel.
    precios: {
      "Valoración": 48375,
      "Alisado cerrado": 122175,
      "Alisado abierto": 145950,
      "Ajuste oclusal": 264675,
      "Drenaje": 165000,
      "Alargamiento": 105000,
      "Detartraje": 0,
      "Control": 0,
      "Frenillectomía": 0
    },

    // porDiente: true → precio × nro dientes | false → precio × 1
    procedimientos: {
      "Valoración": { porDiente: false },
      "Alisado cerrado": { porDiente: true },
      "Alisado abierto": { porDiente: true },
      "Ajuste oclusal": { porDiente: true },
      "Drenaje": { porDiente: true },
      "Alargamiento": { porDiente: true },
      "Detartraje": { porDiente: true },
      "Control": { porDiente: false },
      "Frenillectomía": { porDiente: false }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════

  const PANEL_ID = "dlk-evo-periodoncia-panel";
  const MODAL_ID = "dlk-evo-periodoncia-modal";
  const STYLE_ID = "dlk-evo-periodoncia-style";
  const UNDO_ID = "dlk-evo-periodoncia-undo";
  const PROD_PANEL_ID = "dlk-produccion-panel";
  const PERIO_STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const PRODUCCION_KEY = "dlk_produccion_v1";
  const PRECIOS_KEY = "dlk_precios_v1";
  const GIST_TOKEN_KEY = "dlk_gist_token";
  const GIST_ID_KEY = "dlk_gist_id";
  const GIST_FILENAME = "dentalink-produccion.json";
  const TARGET_PATHS = [
    /\/pacientes\/\d+\/tratamiento\/\d+\b/i,
    /\/pacientes\/\d+\/ficha\/evoluciones\b/i
  ];
  const BUTTONS = [
    "Valoración",
    "Alisado cerrado",
    "Alisado abierto",
    "Alargamiento",
    "Detartraje",
    "Ajuste oclusal",
    "Drenaje",
    "Control",
    "Frenillectomía"
  ];

  // ─── Helpers ───

  function isTargetPage() {
    return TARGET_PATHS.some((path) => path.test(location.pathname));
  }

  function getSavedPeriodontalSummary() {
    const patientId = getPatientIdFromUrl();
    if (!patientId) return "";
    try {
      const records = JSON.parse(localStorage.getItem(PERIO_STORAGE_KEY) || "{}");
      return records?.[patientId]?.text || "";
    } catch (_) { return ""; }
  }

  function getEditor() {
    return [...document.querySelectorAll(".tiptap.ProseMirror[contenteditable='true'], .ProseMirror[contenteditable='true'], [contenteditable='true']")]
      .find(isVisible) || null;
  }

  function linesToHtml(text) {
    return text.split("\n").map((line) => {
      if (!line.trim()) return "<p></p>";
      return `<p>${escapeHtml(line)}</p>`;
    }).join("");
  }

  function formatHour(date) {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${suffix}`;
  }

  function currentTimeRange(durationMinutes = 30) {
    const end = new Date();
    const start = new Date(end.getTime() - durationMinutes * 60 * 1000);
    return { start: formatHour(start), end: formatHour(end) };
  }

  function dispatchEditorEvents(editor, text) {
    try {
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } catch (_) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  function insertHtmlInEditor(editor, html) {
    editor.focus();
    editor.innerHTML += html;
  }

  // ─── Tooth counting ───

  function countTeeth(dientesStr) {
    if (!dientesStr || !dientesStr.trim()) return 0;
    let count = 0;
    const parts = dientesStr.replace(/\./g, "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes("-")) {
        const nums = part.split("-").map((s) => parseInt(s.trim(), 10));
        if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
          count += Math.abs(nums[1] - nums[0]) + 1;
        }
      } else {
        if (!isNaN(parseInt(part, 10))) count += 1;
      }
    }
    return count;
  }

  function formatCurrency(amount) {
    return "$" + String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function toSlug(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase();
  }

  // ─── Price storage ───

  function getPrecios() {
    try {
      const custom = JSON.parse(localStorage.getItem(PRECIOS_KEY) || "{}");
      return { ...CONFIG.precios, ...custom };
    } catch (_) { return { ...CONFIG.precios }; }
  }

  function savePrecio(tipo, precio) {
    try {
      const all = getPrecios();
      all[tipo] = precio;
      localStorage.setItem(PRECIOS_KEY, JSON.stringify(all));
    } catch (_) { /* ignore */ }
  }

  // ─── Production log ───

  function getProduccionLog() {
    try { return JSON.parse(localStorage.getItem(PRODUCCION_KEY) || "[]"); }
    catch (_) { return []; }
  }

  function saveProduccionLog(log) {
    try { localStorage.setItem(PRODUCCION_KEY, JSON.stringify(log)); }
    catch (_) { /* ignore */ }
  }

  function logProduction(tipo, cantidad, precioUnitario) {
    const log = getProduccionLog();
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    log.push({
      id, tipo, cantidad, precioUnitario,
      valorTotal: cantidad * precioUnitario,
      fecha: new Date().toISOString().slice(0, 10),
      timestamp: new Date().toISOString()
    });
    saveProduccionLog(log);
    syncToGist();
    return id;
  }

  function removeProduccionEntry(id) {
    saveProduccionLog(getProduccionLog().filter((e) => e.id !== id));
    syncToGist();
  }

  function purgeOldProduction() {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const log = getProduccionLog().filter((e) => e.fecha >= cutoffStr);
    saveProduccionLog(log);
  }

  function buildProductionSummary() {
    const log = getProduccionLog();
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);

    const todayEntries = log.filter((e) => e.fecha === today);
    const monthEntries = log.filter((e) => e.fecha.startsWith(month));

    const todayTotal = todayEntries.reduce((s, e) => s + e.valorTotal, 0);
    const monthTotal = monthEntries.reduce((s, e) => s + e.valorTotal, 0);

    const todayGroups = {};
    todayEntries.forEach((e) => {
      if (!todayGroups[e.tipo]) todayGroups[e.tipo] = { cantidad: 0, total: 0 };
      todayGroups[e.tipo].cantidad += e.cantidad;
      todayGroups[e.tipo].total += e.valorTotal;
    });

    return { todayGroups, todayTotal, monthTotal };
  }

  // ─── Insert with production tracking ───

  function removeUndo() {
    document.getElementById(UNDO_ID)?.remove();
    window.clearTimeout(removeUndo.timer);
  }

  function showUndoButton(editor, previousHtml, onUndo) {
    removeUndo();
    const btn = document.createElement("button");
    btn.id = UNDO_ID;
    btn.type = "button";
    btn.textContent = "↩ Deshacer inserción";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      editor.innerHTML = previousHtml;
      dispatchEditorEvents(editor, "");
      if (typeof onUndo === "function") onUndo();
      removeUndo();
    });

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.appendChild(btn);
    } else {
      const anchor = editor.closest(".sc-fa-dssr") || editor.closest("form") || editor.parentElement || editor;
      anchor.parentElement?.insertBefore(btn, anchor);
    }
    removeUndo.timer = window.setTimeout(removeUndo, 10000);
  }

  function insertText(text, onUndo) {
    const editor = getEditor();
    if (!editor) {
      alert("No se encontró el editor de evolución.");
      return false;
    }
    const previousHtml = editor.innerHTML;
    insertHtmlInEditor(editor, linesToHtml(text));
    dispatchEditorEvents(editor, text);
    showUndoButton(editor, previousHtml, onUndo);
    return true;
  }

  function handleInsertWithTracking(tipo, text, dientesStr) {
    const precios = getPrecios();
    let precio = precios[tipo];

    if (precio === undefined || precio === 0) {
      const perDiente = CONFIG.procedimientos[tipo]?.porDiente !== false;
      const label = perDiente ? "por diente" : "por consulta";
      const input = prompt(`¿Cuál es el valor de "${tipo}" ${label}?\n(Ingrese el valor en pesos sin puntos ni comas)`);
      if (input === null) { insertText(text); return; }
      precio = parseInt(input.replace(/\D/g, ""), 10);
      if (isNaN(precio) || precio < 0) { insertText(text); return; }
      savePrecio(tipo, precio);
    }

    const porDiente = CONFIG.procedimientos[tipo]?.porDiente !== false;
    const cantidad = porDiente ? countTeeth(dientesStr) : 1;

    if (cantidad === 0 && porDiente) {
      insertText(text);
      return;
    }

    const entry = { id: null };
    const success = insertText(text, function () {
      if (entry.id) {
        removeProduccionEntry(entry.id);
        updateProductionPanel();
      }
    });

    if (success) {
      entry.id = logProduction(tipo, cantidad, precio);
      updateProductionPanel();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TEXTOS DE EVOLUCIÓN
  // ═══════════════════════════════════════════════════════════════════════

  function buildAlisadoCerradoText(values) {
    const duration = Number(values.duracion) || 45;
    const range = currentTimeRange(duration);
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Raspado y Alisado Radicular (RAR) Campo Cerrado
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se observa presencia de cálculos supra y subgingivales, inflamación gingival generalizada y sangrado al sondaje.
Asepsia: Enjuague previo con clorhexidina al 0.12% para disminuir la carga bacteriana salival.

ANESTESIA
Farmaco: ${CONFIG.anestesia.farmaco} (${values.carpules} carpules en total).
Técnica: ${values.tecnica}

FASE DE DESBRIDAMIENTO (ULTRASONIDO)
Se realiza remoción de depósitos calcificados (K036 - Sarro/Cálculo) supragingivales y tinciones extrínsecas mediante el uso de scaler ultrasónico, bajo irrigación constante para control de temperatura y remoción de detritos.

RASPADO Y ALISADO RADICULAR (RAR)
Exploración: Se utiliza sonda periodontal para localización táctil de cálculos subgingivales y evaluación de la profundidad de las bolsas periodontales.

Instrumentación: Uso de curetas Gracey específicas para cada zona. Se inserta la hoja de forma suave y paralela al eje dental hasta sobrepasar el cálculo (posición apical).

Acción: Con un punto de apoyo firme, se realizan movimientos de tracción controlada para eliminar el cálculo y alisar la superficie radicular, dejando una superficie biocompatible y libre de endotoxinas.

FINALIZACION Y PROFILAXIS
Se realiza profilaxis dental con copa de caucho/cepillo y pasta profilactica para eliminar placa blanda residual y pulir superficies coronales.

Se verifica la ausencia de depósitos remanentes mediante exploración táctil.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento en buenas condiciones generales, consciente, orientado y con hemostasia controlada.
Farmacología:
${CONFIG.farmacologia.naproxeno}

Recomendaciones:
Instrucción en técnica de cepillado y uso de seda dental.
Posible sensibilidad dental transitoria al frío/calor (se recomienda crema desensibilizante si es necesario).
Uso de enjuague bucal con clorhexidina si se indicó.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  function buildAlisadoAbiertoText(values) {
    const duration = Number(values.duracion) || 60;
    const range = currentTimeRange(duration);
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Raspado y Alisado Radicular (RAR) Campo Abierto.
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se observa inflamación persistente, cálculos subgingivales profundos de difícil acceso y bolsas periodontales de difícil acceso.

Asepsia: Enjuague previo con Gluconato de Clorhexidina al 0.12% y asepsia perioral.

ANESTESIA
Farmaco: ${CONFIG.anestesia.farmaco} (${values.carpules} carpules en total).
Técnica: ${values.tecnica} para permitir una instrumentación profunda y cómoda para el paciente.

FASE QUIRURGICA Y ACCESO (ALISADO ABIERTO)
Incisión y Colgajo: Se realiza incisión intrasurcular y se eleva colgajo de espesor total (mucoperiostio) utilizando mango de bisturí con hoja #15 y periostótomo, con el fin de obtener visibilidad directa de la superficie radicular y defectos óseos.

Separación: Se utiliza separador Minnesota para mantener el campo quirúrgico expuesto y facilitar la instrumentación cerca de la cresta ósea.

RASPADO Y ALISADO RADICULAR (RAR)
Desbridamiento: Remoción de cálculos con instrumental ultrasónico bajo irrigación.

Instrumentación Mecánica: Uso de curetas Gracey bajo visión directa. Se realiza raspado minucioso de las superficies radiculares y desbridamiento de los defectos óseos hasta lograr una superficie lisa.

Acción: Eliminación de cemento radicular contaminado y tejido de granulación para favorecer la reinserción de los tejidos.

CIERRE Y FINALIZACION
Lavado: Irrigación profusa con solución salina para eliminar detritos óseos y restos de cálculo.

Sutura: Reposición del colgajo y cierre con ${CONFIG.sutura}.

Profilaxis: Se complementa con limpieza de las superficies coronales para disminuir la carga bacteriana supragingival.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento consciente, orientado, con hemostasia controlada y tolera el tratamiento satisfactoriamente.

Plan de Seguimiento: Se advierte al paciente sobre la importancia del mantenimiento periodontal estricto en 3 meses para confirmar el pronóstico de las piezas tratadas.

Recomendaciones:
No cepillar la zona de la sutura (usar gel de clorhexidina).
Dieta blanda, evitar esfuerzos físicos y exposición al sol.
Cita para retiro de sutura en 8 días.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  function buildAlargamientoText(values) {
    const duration = Number(values.duracion) || 60;
    const range = currentTimeRange(duration);
    return `DIAGNÓSTICO: Hiperplasia gingival
PROCEDIMIENTO: Alargamiento de Corona Clínica.
DIENTE: ${values.diente}
RESTAURACIÓN: ${values.restauracion}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Paciente requiere restauración tipo ${values.restauracion} en diente ${values.diente}. Se evidencia margen de la lesión/preparación subgingival que compromete el espacio biológico.

Sondaje preoperatorio: Se realiza sondaje transgingival bajo anestesia para localizar la cresta alveolar y determinar la magnitud de la ostectomía necesaria.

Consentimiento: El paciente firma y acepta el consentimiento informado, comprendiendo los riesgos de pérdida ósea marginal, posible pérdida de papilas y sensibilidad postoperatoria.

Asepsia: Asepsia oral y perioral con Gluconato de Clorhexidina y colocación de campo estéril.

ANESTESIA
Farmaco: ${CONFIG.anestesia.farmaco} (2 carpules).
Técnica: ${values.tecnica}

FASE QUIRURGICA (INCISION Y ABORDAJE)
Incisión: Se realiza incisión intrasurcular festoneada en diente ${values.diente}, incluyendo incisión crestal según la planificación estética.

Colgajo: Elevación de colgajo mucoperiostio de espesor total por vestibular y lingual mediante periostótomo, exponiendo la cresta ósea alveolar.

OSTECTOMIA Y OSTEOPLASTIA
Remodelado óseo: Se realiza osteotomía (remoción de hueso de soporte) para establecer una distancia mínima de 3 mm entre el margen de la futura restauración y la cresta ósea (espacio biológico).

Osteoplastia: Remodelado de la arquitectura ósea para devolver una anatomía funcional y armoniosa.

Tratamiento Radicular: Raspado y alisado radicular con curetas Gracey para eliminar fibras periodontales remanentes y dejar la superficie radicular apta para el nuevo nivel de inserción. Irrigación constante con Clorhexidina.

SUTURA Y POSICIONAMIENTO
Técnica: Reposicionamiento del colgajo de manera apical a la unión amelocementaria para ganar altura de corona clínica.
Material: Sutura con ${CONFIG.sutura}

PLAN DE MANEJO Y RECOMENDACIONES
Egreso: Paciente estable, con hemostasia controlada.

Recomendaciones: Reposo moderado (48h), dieta fría/blanda, no escupir, no fumar (15 días), higiene delicada en la zona sin cepillado traumático de la sutura. Cita para retiro de sutura en 8 días.

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  function buildValoracionText() {
    const periodontalSummary = getSavedPeriodontalSummary();
    if (periodontalSummary) {
      return `Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:

${periodontalSummary}

${CONFIG.notaControles}

Cita 20 min`;
    }
    return `Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:

Se sugiere realizar 

Se solicita autorización para realizar:

${CONFIG.notaControles}

Cita 20 min`;
  }

  function buildDetartrajeText(values) {
    const duration = Number(values.duracion) || 30;
    const range = currentTimeRange(duration);
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Detartraje supragingival y subgingival.
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se observa presencia de cálculos supra y subgingivales, inflamación gingival generalizada y sangrado al sondaje.
Asepsia: Enjuague previo con clorhexidina al 0.12% para disminuir la carga bacteriana salival.

FASE DE DESBRIDAMIENTO (ULTRASONIDO)
Se realiza remoción de depósitos calcificados (K036 - Sarro/Cálculo) supragingivales y subgingivales mediante el uso de scaler ultrasónico, bajo irrigación constante para control de temperatura y remoción de detritos.

DETARTRAJE Y PROFILAXIS
Se realiza instrumentación cuidadosa para eliminar cálculo dental y placa bacteriana adherida, sin uso de anestesia local.

Se complementa con profilaxis dental con copa de caucho/cepillo y pasta profilactica para eliminar placa blanda residual y pulir superficies coronales.

Se verifica la ausencia de depósitos remanentes mediante exploración táctil.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento en buenas condiciones generales, consciente, orientado y con hemostasia controlada.

Recomendaciones:
Instrucción en técnica de cepillado y uso de seda dental.
Posible sensibilidad dental transitoria al frío/calor.
Mantener controles periodontales según evolución clínica.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  function buildAjusteOclusalText(values) {
    const range = currentTimeRange(20);
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Ajuste oclusal selectivo.
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se identifican contactos prematuros e interferencias oclusales que contribuyen al trauma oclusal secundario y comprometen el pronóstico periodontal de las piezas involucradas.

PROCEDIMIENTO
Marcaje: Se utiliza papel articular de diferente grosor para identificar y marcar los contactos prematuros en oclusión céntrica y movimientos excursivos (lateralidad y protrusión).

Desgaste selectivo: Se realiza ajuste oclusal controlado con fresas de diamante de grano fino y piedras de Arkansas, eliminando selectivamente las interferencias marcadas.

Verificación: Se comprueba repetidamente con papel articular hasta obtener contactos simultáneos, equilibrados y bilaterales en céntrica, sin interferencias en movimientos excursivos.

Pulido: Se realiza pulido de las superficies ajustadas para eliminar irregularidades residuales.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento en buenas condiciones generales, con oclusión equilibrada y sin molestias.

Recomendaciones:
Posible sensibilidad transitoria en las zonas ajustadas.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  function buildDrenajeText(values) {
    const range = currentTimeRange(30);
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Drenaje periodontal.
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se evidencia presencia de exudado purulento/supuración activa en los tejidos periodontales, con inflamación aguda y dolor localizado, consistente con absceso periodontal.

PROCEDIMIENTO
Drenaje: Se procede a drenar el absceso periodontal mediante acceso por el surco gingival, permitiendo la salida del contenido purulento y reducción de la presión tisular.

Desbridamiento: Se realiza curetaje subgingival e irrigación profusa con clorhexidina al 0.12% para eliminar detritos necróticos, cálculos y biofilm subgingival que perpetúan la infección.

Irrigación: Lavado abundante de la zona con solución salina para garantizar la eliminación completa del material purulento.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento con disminución del dolor, control de la infección aguda y hemostasia controlada.

Recomendaciones:
Enjuague con clorhexidina al 0.12% cada 12 horas por 7 días.
Evitar cepillado traumático en la zona afectada.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }



  function buildControlText() {
    const periodontalSummary = getSavedPeriodontalSummary();
    const range = currentTimeRange(20);
    const base = `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Control periodontal de mantenimiento.
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

EVALUACIÓN CLÍNICA
Higiene oral: Se evalúa el índice de placa bacteriana y se verifica el cumplimiento de las instrucciones de higiene oral previamente indicadas.

Evaluación periodontal: Se realiza sondaje periodontal de control y comparación con registros previos para determinar la estabilidad del tratamiento periodontal realizado.

Sangrado al sondaje: Se registran los sitios con sangrado al sondaje como indicador de inflamación activa.

Evaluación de tejidos blandos: Se valora color, textura, contorno y consistencia de la encía, verificando la resolución de la inflamación.

PROCEDIMIENTO
Se realiza profilaxis de mantenimiento con copa de caucho y pasta profiláctica para remoción de placa blanda residual.

Se realiza detartraje ultrasónico de las zonas con depósitos calcificados identificados.

Se refuerzan instrucciones de higiene oral: técnica de cepillado de Bass modificada, uso de seda dental y enjuague bucal según indicación.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza la cita de control en buenas condiciones generales.

Plan: Próximo control periodontal en 3 meses.`;

    if (periodontalSummary) {
      return base + `

SONDAJE DE REFERENCIA:
${periodontalSummary}

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
    }
    return base + `

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }


  function buildFrenillectomiaText(values) {
    const duration = Number(values.duracion) || 30;
    const range = currentTimeRange(duration);
    return `DIAGNÓSTICO: Frenillo ${values.frenillo} corto / hipertrófico
PROCEDIMIENTO: Frenillectomía.
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se evidencia inserción baja/corta del frenillo ${values.frenillo} que compromete la dinámica de los tejidos periodontales, generando tracción sobre el margen gingival y/o limitación funcional.

Consentimiento: El paciente firma y acepta el consentimiento informado, comprendiendo los riesgos de sangrado, inflamación postoperatoria y posible recidiva.

Asepsia: Asepsia oral y perioral con Gluconato de Clorhexidina al 0.12%.

ANESTESIA
Farmaco: ${CONFIG.anestesia.farmaco} (${values.carpules} carpules en total).
Técnica: ${values.tecnica}

FASE QUIRURGICA
Técnica: Se realiza frenillectomía mediante incisión en forma romboidal del frenillo ${values.frenillo}, abarcando desde la inserción mucosa hasta la inserción gingival.

Disección: Se diseca el tejido conectivo del frenillo, liberando las fibras de inserción hasta lograr movilidad adecuada sin tracción sobre el margen gingival.

Hemostasia: Control de hemostasia mediante compresión directa.

SUTURA Y CIERRE
Técnica: Cierre primario con ${CONFIG.sutura}.
Se verifica la correcta movilidad de los tejidos post-sutura sin tensión residual.

INDICACIONES Y EGRESO
Egreso: Paciente finaliza el procedimiento en buenas condiciones generales, con hemostasia controlada.

Farmacología:
${CONFIG.farmacologia.naproxeno}

Recomendaciones:
Dieta blanda por 48 horas.
No cepillar la zona de la sutura (usar gel de clorhexidina).
Evitar esfuerzos físicos y exposición al sol.
Cita para retiro de sutura en 8 días.

${CONFIG.notaControles}

ATENDIDO POR: ${CONFIG.doctor}`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ESTILOS
  // ═══════════════════════════════════════════════════════════════════════

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      #${PANEL_ID} button {
        border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; color: #334155;
        cursor: pointer; font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; padding: 6px 8px;
      }
      #${PANEL_ID} button:hover { border-color: #0284c7; color: #0369a1; }
      #${UNDO_ID} {
        border: 1px solid #f97316; border-radius: 5px; background: #fff7ed; color: #c2410c;
        cursor: pointer; font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        padding: 6px 8px; animation: dlk-undo-fade 10s ease-in forwards;
      }
      #${UNDO_ID}:hover { background: #fed7aa; }
      @keyframes dlk-undo-fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
      #${MODAL_ID} {
        position: fixed; inset: 0; z-index: 1000000; display: flex; align-items: center; justify-content: center;
        background: rgba(15, 23, 42, 0.38); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      #${MODAL_ID} .box {
        width: min(420px, calc(100vw - 32px)); border-radius: 8px; background: #fff;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25); padding: 16px;
      }
      #${MODAL_ID} h3 { margin: 0 0 12px; color: #0f172a; font-size: 16px; }
      #${MODAL_ID} label { display: block; margin: 8px 0 4px; color: #475569; font-size: 12px; font-weight: 700; }
      #${MODAL_ID} input {
        box-sizing: border-box; width: 100%; border: 1px solid #cbd5e1; border-radius: 5px; padding: 8px; font-size: 13px;
      }
      #${MODAL_ID} .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      #${MODAL_ID} button { border: 0; border-radius: 5px; cursor: pointer; font-weight: 700; padding: 8px 10px; }
      #${MODAL_ID} .cancel { background: #e2e8f0; color: #334155; }
      #${MODAL_ID} .insert { background: #0284c7; color: #fff; }
      #${PROD_PANEL_ID} {
        position: fixed; right: 10px; bottom: 10px; z-index: 999998; width: 230px; padding: 10px;
        border: 1px solid rgba(15, 23, 42, 0.12); border-radius: 8px;
        background: rgba(255, 255, 255, 0.97); box-shadow: 0 4px 16px rgba(15, 23, 42, 0.10);
        font: 11px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PROD_PANEL_ID}.is-minimized .prod-body { display: none; }
      #${PROD_PANEL_ID} .prod-title {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 8px; font-weight: 800; color: #334155; font-size: 12px; cursor: default;
      }
      #${PROD_PANEL_ID}.is-minimized .prod-title { margin-bottom: 0; }
      #${PROD_PANEL_ID} .prod-minimize {
        width: 22px; height: 20px; padding: 0; border: 0; border-radius: 4px;
        background: #e2e8f0; color: #334155; cursor: pointer; font-weight: 800; line-height: 1;
      }
      #${PROD_PANEL_ID} .prod-item {
        display: flex; align-items: center; padding: 3px 0; color: #334155;
      }
      #${PROD_PANEL_ID} .prod-item-name { font-size: 11px; flex: 1; }
      #${PROD_PANEL_ID} .prod-item-value { font-weight: 700; color: #0f766e; font-size: 11px; margin-right: 4px; }
      #${PROD_PANEL_ID} .prod-item-del {
        width: 18px; height: 18px; padding: 0; border: 0; border-radius: 3px;
        background: transparent; color: #94a3b8; cursor: pointer; font: 700 13px/1 sans-serif;
        flex-shrink: 0; transition: all 0.15s;
      }
      #${PROD_PANEL_ID} .prod-item-del:hover { background: #fee2e2; color: #dc2626; }
      #${PROD_PANEL_ID} .prod-empty { color: #94a3b8; font-style: italic; padding: 4px 0; }
      #${PROD_PANEL_ID} .prod-totals {
        margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0;
      }
      #${PROD_PANEL_ID} .prod-total-row {
        display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px;
      }
      #${PROD_PANEL_ID} .prod-total-row strong { color: #0f766e; }
      #${PROD_PANEL_ID} .prod-actions {
        display: flex; gap: 4px; margin-top: 8px;
      }
      #${PROD_PANEL_ID} .prod-btn {
        flex: 1; padding: 5px; border: 1px dashed #cbd5e1; border-radius: 4px;
        background: transparent; color: #64748b; cursor: pointer; font-size: 10px; text-align: center;
      }
      #${PROD_PANEL_ID} .prod-btn:hover { background: #f1f5f9; color: #334155; }
      #${PROD_PANEL_ID} .prod-sync-ok { border-color: #86efac; color: #16a34a; }
      #${PROD_PANEL_ID} .prod-sync-err { border-color: #fca5a5; color: #dc2626; }
      #${PROD_PANEL_ID} .prod-goal {
        margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0;
      }
      #${PROD_PANEL_ID} .prod-goal-label {
        display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 4px;
      }
      #${PROD_PANEL_ID} .prod-goal-pct { font-weight: 800; color: #334155; }
      #${PROD_PANEL_ID} .prod-goal-bar {
        width: 100%; height: 8px; border-radius: 4px; background: #e2e8f0; overflow: hidden;
      }
      #${PROD_PANEL_ID} .prod-goal-fill {
        height: 100%; border-radius: 4px; transition: width 0.4s ease, background 0.4s ease;
        background: linear-gradient(90deg, #f97316, #eab308);
      }
      #${PROD_PANEL_ID} .prod-goal-fill.goal-hit {
        background: linear-gradient(90deg, #22c55e, #10b981);
      }
      #${PROD_PANEL_ID} .prod-goal-amounts {
        display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; margin-top: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION PANEL UI
  // ═══════════════════════════════════════════════════════════════════════

  function removeLastEntryOfType(tipo) {
    const log = getProduccionLog();
    const today = new Date().toISOString().slice(0, 10);
    // Find last entry of this type for today
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].tipo === tipo && log[i].fecha === today) {
        log.splice(i, 1);
        saveProduccionLog(log);
        syncToGist();
        return;
      }
    }
  }

  function updateProductionPanel() {
    const panel = document.getElementById(PROD_PANEL_ID);
    if (!panel) return;

    const { todayGroups, todayTotal, monthTotal } = buildProductionSummary();
    const itemsEl = panel.querySelector(".prod-items");
    const totalsEl = panel.querySelector(".prod-totals");
    if (!itemsEl || !totalsEl) return;

    // Build items with delete buttons
    itemsEl.innerHTML = "";
    const tipos = Object.keys(todayGroups);
    if (tipos.length === 0) {
      itemsEl.innerHTML = '<div class="prod-empty">Sin registros hoy</div>';
    } else {
      tipos.forEach((tipo) => {
        const data = todayGroups[tipo];
        const row = document.createElement("div");
        row.className = "prod-item";

        const nameSpan = document.createElement("span");
        nameSpan.className = "prod-item-name";
        nameSpan.textContent = `${tipo} ×${data.cantidad}`;

        const valueSpan = document.createElement("span");
        valueSpan.className = "prod-item-value";
        valueSpan.textContent = formatCurrency(data.total);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "prod-item-del";
        delBtn.textContent = "−";
        delBtn.title = `Quitar 1 ${tipo}`;
        delBtn.addEventListener("click", () => {
          removeLastEntryOfType(tipo);
          updateProductionPanel();
        });

        row.appendChild(nameSpan);
        row.appendChild(valueSpan);
        row.appendChild(delBtn);
        itemsEl.appendChild(row);
      });
    }

    const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    totalsEl.innerHTML = `
      <div class="prod-total-row"><span>Hoy:</span><strong>${formatCurrency(todayTotal)}</strong></div>
      <div class="prod-total-row"><span>${meses[new Date().getMonth()]}:</span><strong>${formatCurrency(monthTotal)}</strong></div>
    `;

    // Update goal progress bar
    const goalEl = panel.querySelector(".prod-goal");
    if (goalEl) {
      const pct = Math.min(100, Math.round((todayTotal / CONFIG.metaDiaria) * 100));
      const fill = goalEl.querySelector(".prod-goal-fill");
      const pctLabel = goalEl.querySelector(".prod-goal-pct");
      const amounts = goalEl.querySelector(".prod-goal-amounts");
      if (fill) {
        fill.style.width = pct + "%";
        fill.classList.toggle("goal-hit", pct >= 100);
      }
      if (pctLabel) pctLabel.textContent = pct + "%";
      if (amounts) amounts.innerHTML = `<span>${formatCurrency(todayTotal)}</span><span>${formatCurrency(CONFIG.metaDiaria)}</span>`;
    }
  }

  function ensureProductionPanel() {
    ensureStyles();
    let panel = document.getElementById(PROD_PANEL_ID);
    if (panel) { updateProductionPanel(); return; }

    panel = document.createElement("div");
    panel.id = PROD_PANEL_ID;
    panel.innerHTML = `
      <div class="prod-title">
        <span>📊 Producción</span>
        <button type="button" class="prod-minimize" data-action="prod-minimize" title="Minimizar">−</button>
      </div>
      <div class="prod-body">
        <div class="prod-items"></div>
        <div class="prod-totals"></div>
        <div class="prod-goal">
          <div class="prod-goal-label"><span>Meta diaria</span><span class="prod-goal-pct">0%</span></div>
          <div class="prod-goal-bar"><div class="prod-goal-fill" style="width:0%"></div></div>
          <div class="prod-goal-amounts"><span>$0</span><span>$3.000.000</span></div>
        </div>
        <div class="prod-actions">
          <button type="button" class="prod-btn" data-action="edit-prices">⚙ Precios</button>
          <button type="button" class="prod-btn" data-action="sync-now">☁ Sincronizar</button>
        </div>
      </div>
    `;

    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "prod-minimize") {
        panel.classList.toggle("is-minimized");
        const btn = event.target.closest("button");
        btn.textContent = panel.classList.contains("is-minimized") ? "+" : "−";
        btn.title = panel.classList.contains("is-minimized") ? "Expandir" : "Minimizar";
      }
      if (action === "edit-prices") openPriceEditor();
      if (action === "sync-now") handleSyncButton(event.target.closest("button"));
    });

    document.body.appendChild(panel);
    syncFromGist().then(() => updateProductionPanel());
    updateProductionPanel();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODALS & PROMPTS
  // ═══════════════════════════════════════════════════════════════════════

  function closePrompt() { document.getElementById(MODAL_ID)?.remove(); }

  function openFormPrompt(title, fields, onSubmit) {
    ensureStyles();
    closePrompt();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <form class="box">
        <h3>${escapeHtml(title)}</h3>
        ${fields.map((f) => `
          <label for="dlk-evo-${f.name}">${escapeHtml(f.label)}</label>
          <input id="dlk-evo-${f.name}" name="${f.name}" autocomplete="off" value="${escapeHtml(f.value || "")}">
        `).join("")}
        <div class="actions">
          <button class="cancel" type="button">Cancelar</button>
          <button class="insert" type="submit">Insertar</button>
        </div>
      </form>
    `;

    const handleEsc = (e) => { if (e.key === "Escape") closePrompt(); };

    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest(".cancel")) closePrompt();
    });

    modal.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const values = Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()]));
      onSubmit(values);
      closePrompt();
    });

    const obs = new MutationObserver((muts) => {
      muts.forEach((m) => m.removedNodes.forEach((n) => {
        if (n === modal) { document.removeEventListener("keydown", handleEsc); obs.disconnect(); }
      }));
    });
    obs.observe(document.body, { childList: true });

    document.addEventListener("keydown", handleEsc);
    document.body.appendChild(modal);
    modal.querySelector("input")?.focus();
  }

  function openPriceEditor() {
    const precios = getPrecios();
    const tipos = Object.keys(CONFIG.procedimientos);
    const fields = tipos.map((tipo) => ({
      name: toSlug(tipo),
      label: `${tipo}${CONFIG.procedimientos[tipo].porDiente ? " (por diente)" : " (por consulta)"}`,
      value: String(precios[tipo] || 0)
    }));

    openFormPrompt("Editar precios (COP)", fields, (values) => {
      tipos.forEach((tipo) => {
        const raw = values[toSlug(tipo)] || "0";
        const precio = parseInt(raw.replace(/\D/g, ""), 10);
        if (!isNaN(precio)) savePrecio(tipo, precio);
      });
      updateProductionPanel();
    });
  }

  // ─── Prompt openers ───

  function openAlisadoPrompt(title, builder, defaultCarpules, defaultTecnica, defaultDuration) {
    openFormPrompt(title, [
      { name: "dientes", label: "Dientes", value: "" },
      { name: "carpules", label: "Carpules en total", value: String(defaultCarpules) },
      { name: "tecnica", label: "Técnica anestésica", value: defaultTecnica },
      { name: "duracion", label: "Duración de la cita (minutos)", value: String(defaultDuration) }
    ], (values) => handleInsertWithTracking(title, builder(values), values.dientes));
  }

  function openAlargamientoPrompt() {
    openFormPrompt("Alargamiento", [
      { name: "diente", label: "Diente", value: "" },
      { name: "restauracion", label: "Restauración", value: "" },
      { name: "tecnica", label: "Técnica anestésica", value: "Infiltrativa" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "60" }
    ], (values) => handleInsertWithTracking("Alargamiento", buildAlargamientoText(values), values.diente));
  }

  function openDetartrajePrompt() {
    openFormPrompt("Detartraje", [
      { name: "dientes", label: "Dientes", value: "" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "30" }
    ], (values) => handleInsertWithTracking("Detartraje", buildDetartrajeText(values), values.dientes));
  }

  function openAjusteOclusalPrompt() {
    openFormPrompt("Ajuste oclusal", [
      { name: "dientes", label: "Dientes", value: "" }
    ], (values) => handleInsertWithTracking("Ajuste oclusal", buildAjusteOclusalText(values), values.dientes));
  }

  function openDrenajePrompt() {
    openFormPrompt("Drenaje periodontal", [
      { name: "dientes", label: "Dientes", value: "" }
    ], (values) => handleInsertWithTracking("Drenaje", buildDrenajeText(values), values.dientes));
  }

  function openFrenillectomiaPrompt() {
    openFormPrompt("Frenillectomía", [
      { name: "frenillo", label: "Tipo de frenillo (labial superior, labial inferior, lingual)", value: "labial superior" },
      { name: "carpules", label: "Carpules en total", value: "1" },
      { name: "tecnica", label: "Técnica anestésica", value: "Infiltrativa" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "30" }
    ], (values) => handleInsertWithTracking("Frenillectomía", buildFrenillectomiaText(values), ""));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUTTON HANDLERS & PANEL
  // ═══════════════════════════════════════════════════════════════════════

  function handleButton(label) {
    if (label === "Valoración") {
      handleInsertWithTracking("Valoración", buildValoracionText(), "");
      return;
    }
    if (label === "Alisado cerrado") { openAlisadoPrompt("Alisado cerrado", buildAlisadoCerradoText, 1, "Infiltrativa", 45); return; }
    if (label === "Alisado abierto") { openAlisadoPrompt("Alisado abierto", buildAlisadoAbiertoText, 2, "Infiltrativa", 60); return; }
    if (label === "Alargamiento") { openAlargamientoPrompt(); return; }
    if (label === "Detartraje") { openDetartrajePrompt(); return; }
    if (label === "Ajuste oclusal") { openAjusteOclusalPrompt(); return; }
    if (label === "Drenaje") { openDrenajePrompt(); return; }
    if (label === "Control") { handleInsertWithTracking("Control", buildControlText(), ""); return; }
    if (label === "Frenillectomía") { openFrenillectomiaPrompt(); return; }
    alert(`Boton "${label}" creado. Falta definir su texto.`);
  }

  function createButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleButton(label);
    });
    return button;
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    closePrompt();
  }

  function ensurePanel() {
    if (!isTargetPage()) { removePanel(); return; }
    const editor = getEditor();
    if (!editor) { removePanel(); return; }

    ensureStyles();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      BUTTONS.forEach((label) => panel.appendChild(createButton(label)));
    }
    const anchor = editor.closest(".sc-fa-dssr") || editor.closest("form") || editor.parentElement || editor;
    if (panel.nextElementSibling !== anchor) {
      anchor.parentElement?.insertBefore(panel, anchor);
    }
  }

  function schedulePanel() {
    window.clearTimeout(schedulePanel.timer);
    schedulePanel.timer = window.setTimeout(() => {
      ensurePanel();
      ensureProductionPanel();
    }, 150);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GITHUB GIST SYNC (memoria compartida entre equipos)
  // ═══════════════════════════════════════════════════════════════════════

  function getGistToken() {
    try { return GM_getValue(GIST_TOKEN_KEY, ""); } catch (_) { return localStorage.getItem(GIST_TOKEN_KEY) || ""; }
  }
  function setGistToken(token) {
    try { GM_setValue(GIST_TOKEN_KEY, token); } catch (_) { localStorage.setItem(GIST_TOKEN_KEY, token); }
  }
  function getGistId() {
    try { return GM_getValue(GIST_ID_KEY, ""); } catch (_) { return localStorage.getItem(GIST_ID_KEY) || ""; }
  }
  function setGistId(id) {
    try { GM_setValue(GIST_ID_KEY, id); } catch (_) { localStorage.setItem(GIST_ID_KEY, id); }
  }

  function buildGistPayload() {
    return {
      produccion: getProduccionLog(),
      precios: getPrecios()
    };
  }

  function mergeProduccion(local, remote) {
    const seen = new Set(local.map((e) => e.id));
    const merged = [...local];
    remote.forEach((e) => { if (!seen.has(e.id)) merged.push(e); });
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return merged;
  }

  async function syncToGist() {
    const token = getGistToken();
    if (!token) return;
    let gistId = await ensureGistId(token);
    const payload = JSON.stringify(buildGistPayload(), null, 2);

    try {
      if (gistId) {
        await fetch(`https://api.github.com/gists/${gistId}`, {
          method: "PATCH",
          headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ files: { [GIST_FILENAME]: { content: payload } } })
        });
      } else {
        const res = await fetch("https://api.github.com/gists", {
          method: "POST",
          headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "Dentalink - Datos de producción (auto-sync)",
            public: false,
            files: { [GIST_FILENAME]: { content: payload } }
          })
        });
        const data = await res.json();
        if (data.id) setGistId(data.id);
      }
    } catch (_) { /* silent fail */ }
  }

  // Auto-descubrimiento: busca el gist por nombre de archivo
  async function findGistByFilename(token) {
    try {
      const res = await fetch("https://api.github.com/gists?per_page=100", {
        headers: { Authorization: `token ${token}` }
      });
      const gists = await res.json();
      if (!Array.isArray(gists)) return null;
      const found = gists.find((g) => g.files && g.files[GIST_FILENAME]);
      return found ? found.id : null;
    } catch (_) { return null; }
  }

  async function ensureGistId(token) {
    let gistId = getGistId();
    if (gistId) return gistId;
    gistId = await findGistByFilename(token);
    if (gistId) { setGistId(gistId); return gistId; }
    return null;
  }

  async function syncFromGist() {
    const token = getGistToken();
    if (!token) return;
    let gistId = await ensureGistId(token);
    if (!gistId) return;

    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `token ${token}` }
      });
      const data = await res.json();
      const content = data.files?.[GIST_FILENAME]?.content;
      if (!content) return;

      const remote = JSON.parse(content);
      if (Array.isArray(remote.produccion)) {
        saveProduccionLog(mergeProduccion(getProduccionLog(), remote.produccion));
      }
      if (remote.precios && typeof remote.precios === "object") {
        localStorage.setItem(PRECIOS_KEY, JSON.stringify({ ...remote.precios, ...getPrecios() }));
      }
    } catch (_) { /* silent fail */ }
  }

  async function handleSyncButton(btn) {
    const token = getGistToken();
    if (!token) {
      const newToken = prompt(
        "Para sincronizar entre equipos necesitas un GitHub Personal Access Token (PAT).\n\n" +
        "Créalo en: github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)\n" +
        "Permisos requeridos: solo \"gist\"\n\n" +
        "Pega tu token aquí:"
      );
      if (!newToken || !newToken.trim()) return;
      setGistToken(newToken.trim());
    }

    btn.textContent = "⏳ Sincronizando...";
    btn.disabled = true;
    try {
      await syncFromGist();
      await syncToGist();
      updateProductionPanel();
      btn.textContent = "✅ Sincronizado";
      btn.classList.add("prod-sync-ok");
    } catch (_) {
      btn.textContent = "❌ Error";
      btn.classList.add("prod-sync-err");
    }
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = "☁ Sincronizar";
      btn.classList.remove("prod-sync-ok", "prod-sync-err");
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════

  purgeOldProduction();
  onUrlChange(schedulePanel);
  new MutationObserver(schedulePanel).observe(document.body, { childList: true, subtree: true });
  schedulePanel();
})();
