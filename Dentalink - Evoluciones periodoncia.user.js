// ==UserScript==
// @name         Dentalink - Evoluciones periodoncia
// @namespace    https://odontofamily.local/dentalink-evoluciones-periodoncia
// @version      1.6.0
// @description  Agrega botones de textos rápidos para evoluciones de periodoncia en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { isVisible, escapeHtml, getPatientIdFromUrl, onUrlChange } = window.__dlkUtils;

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN CLÍNICA (editar aquí los textos frecuentes)
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
    notaControles: "NOTA IMPORTANTE: Se informa al paciente que es fundamental mantener controles periodontales cada 3 meses para evitar reincidencia y exacerbación de la enfermedad periodontal."
  };

  // ═══════════════════════════════════════════════════════════════════════

  const PANEL_ID = "dlk-evo-periodoncia-panel";
  const MODAL_ID = "dlk-evo-periodoncia-modal";
  const STYLE_ID = "dlk-evo-periodoncia-style";
  const UNDO_ID = "dlk-evo-periodoncia-undo";
  const PERIO_STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const TARGET_PATHS = [
    /\/pacientes\/\d+\/tratamiento\/\d+\b/i,
    /\/pacientes\/\d+\/ficha\/evoluciones\b/i
  ];
  const BUTTONS = [
    "Valoración",
    "Alisado cerrado",
    "Alisado abierto",
    "Alargamiento",
    "Detartraje"
  ];

  function isTargetPage() {
    return TARGET_PATHS.some((path) => path.test(location.pathname));
  }

  function getSavedPeriodontalSummary() {
    const patientId = getPatientIdFromUrl();
    if (!patientId) return "";

    try {
      const records = JSON.parse(localStorage.getItem(PERIO_STORAGE_KEY) || "{}");
      return records?.[patientId]?.text || "";
    } catch (_error) {
      return "";
    }
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
    return {
      start: formatHour(start),
      end: formatHour(end)
    };
  }

  function dispatchEditorEvents(editor, text) {
    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_error) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  function insertHtmlInEditor(editor, html) {
    editor.focus();
    // Append via innerHTML — ProseMirror detects the DOM mutation
    // and re-parses the content, preserving paragraph structure.
    editor.innerHTML += html;
  }

  function removeUndo() {
    document.getElementById(UNDO_ID)?.remove();
    window.clearTimeout(removeUndo.timer);
  }

  function showUndoButton(editor, previousHtml) {
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

  function insertText(text) {
    const editor = getEditor();
    if (!editor) {
      alert("No se encontró el editor de evolución.");
      return;
    }

    const previousHtml = editor.innerHTML;
    const html = linesToHtml(text);

    insertHtmlInEditor(editor, html);
    dispatchEditorEvents(editor, text);
    showUndoButton(editor, previousHtml);
  }

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

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      #${PANEL_ID} button {
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        background: #fff;
        color: #334155;
        cursor: pointer;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        padding: 6px 8px;
      }
      #${PANEL_ID} button:hover {
        border-color: #0284c7;
        color: #0369a1;
      }
      #${UNDO_ID} {
        border: 1px solid #f97316;
        border-radius: 5px;
        background: #fff7ed;
        color: #c2410c;
        cursor: pointer;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        padding: 6px 8px;
        animation: dlk-undo-fade 10s ease-in forwards;
      }
      #${UNDO_ID}:hover {
        background: #fed7aa;
      }
      @keyframes dlk-undo-fade {
        0%, 70% { opacity: 1; }
        100% { opacity: 0; }
      }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.38);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      #${MODAL_ID} .box {
        width: min(420px, calc(100vw - 32px));
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
        padding: 16px;
      }
      #${MODAL_ID} h3 {
        margin: 0 0 12px;
        color: #0f172a;
        font-size: 16px;
      }
      #${MODAL_ID} label {
        display: block;
        margin: 8px 0 4px;
        color: #475569;
        font-size: 12px;
        font-weight: 700;
      }
      #${MODAL_ID} input {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        padding: 8px;
        font-size: 13px;
      }
      #${MODAL_ID} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
      }
      #${MODAL_ID} button {
        border: 0;
        border-radius: 5px;
        cursor: pointer;
        font-weight: 700;
        padding: 8px 10px;
      }
      #${MODAL_ID} .cancel {
        background: #e2e8f0;
        color: #334155;
      }
      #${MODAL_ID} .insert {
        background: #0284c7;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function closePrompt() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function openFormPrompt(title, fields, onSubmit) {
    ensureStyles();
    closePrompt();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <form class="box">
        <h3>${escapeHtml(title)}</h3>
        ${fields.map((field) => `
          <label for="dlk-evo-${field.name}">${escapeHtml(field.label)}</label>
          <input id="dlk-evo-${field.name}" name="${field.name}" autocomplete="off" value="${escapeHtml(field.value || "")}">
        `).join("")}
        <div class="actions">
          <button class="cancel" type="button">Cancelar</button>
          <button class="insert" type="submit">Insertar</button>
        </div>
      </form>
    `;

    const handleEsc = (event) => {
      if (event.key === "Escape") {
        closePrompt();
      }
    };

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".cancel")) {
        closePrompt();
      }
    });

    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(fields.map((field) => [
        field.name,
        form.elements[field.name].value.trim()
      ]));
      onSubmit(values);
      closePrompt();
    });

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === modal) {
            document.removeEventListener("keydown", handleEsc);
            observer.disconnect();
          }
        });
      });
    });
    observer.observe(document.body, { childList: true });

    document.addEventListener("keydown", handleEsc);
    document.body.appendChild(modal);
    modal.querySelector("input")?.focus();
  }

  function openAlisadoPrompt(title, builder, defaultCarpules, defaultTecnica, defaultDuration) {
    openFormPrompt(title, [
      { name: "dientes", label: "Dientes", value: "" },
      { name: "carpules", label: "Carpules en total", value: String(defaultCarpules) },
      { name: "tecnica", label: "Técnica anestésica", value: defaultTecnica },
      { name: "duracion", label: "Duración de la cita (minutos)", value: String(defaultDuration) }
    ], (values) => insertText(builder(values)));
  }

  function openAlargamientoPrompt() {
    openFormPrompt("Alargamiento", [
      { name: "diente", label: "Diente", value: "" },
      { name: "restauracion", label: "Restauración", value: "" },
      { name: "tecnica", label: "Técnica anestésica", value: "Infiltrativa" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "60" }
    ], (values) => insertText(buildAlargamientoText(values)));
  }

  function openDetartrajePrompt() {
    openFormPrompt("Detartraje", [
      { name: "dientes", label: "Dientes", value: "" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "30" }
    ], (values) => insertText(buildDetartrajeText(values)));
  }

  function handleButton(label) {
    if (label === "Valoración") {
      insertText(buildValoracionText());
      return;
    }

    if (label === "Alisado cerrado") {
      openAlisadoPrompt("Alisado cerrado", buildAlisadoCerradoText, 1, "Infiltrativa", 45);
      return;
    }

    if (label === "Alisado abierto") {
      openAlisadoPrompt("Alisado abierto", buildAlisadoAbiertoText, 2, "Infiltrativa", 60);
      return;
    }

    if (label === "Alargamiento") {
      openAlargamientoPrompt();
      return;
    }

    if (label === "Detartraje") {
      openDetartrajePrompt();
      return;
    }

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
    if (!isTargetPage()) {
      removePanel();
      return;
    }

    const editor = getEditor();
    if (!editor) {
      removePanel();
      return;
    }

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
    schedulePanel.timer = window.setTimeout(ensurePanel, 150);
  }

  onUrlChange(schedulePanel);
  new MutationObserver(schedulePanel).observe(document.body, {
    childList: true,
    subtree: true
  });
  schedulePanel();
})();
