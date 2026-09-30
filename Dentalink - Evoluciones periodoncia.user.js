// ==UserScript==
// @name         Dentalink - Evoluciones periodoncia
// @namespace    https://odontofamily.local/dentalink-evoluciones-periodoncia
// @version      3.2.1
// @description  Agrega botones de textos rápidos para evoluciones de periodoncia en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js?v=1.2.2
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const sharedUtils = window.__dlkUtils || {};
  const FALLBACK_TREATMENTS = [
    { key: "closed", cups: "240301", scope: "tooth", patterns: ["CAMPO CERRADO"] },
    { key: "open", cups: "242201", scope: "tooth", patterns: ["CAMPO ABIERTO"] },
    { key: "drainage", cups: "240401", scope: "tooth", patterns: ["DRENAJE PERIODONTAL"] },
    { key: "scaling", cups: "240201", scope: "tooth", patterns: ["DETARTRAJE"] },
    { key: "occlusal_adjustment", cups: "248201", scope: "tooth", patterns: ["AJUSTE OCLUSAL"] },
    { key: "crown_lengthening", cups: "242301", scope: "tooth", patterns: ["ALARGAMIENTO DE CORONA"] },
    { key: "frenectomy", cups: "274101", scope: "procedure", patterns: ["FRENILLECTOMIA", "FRENILLECTOMÍA"] }
  ];
  const fallbackIdentifyTreatment = (value) => {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .toUpperCase();
    return FALLBACK_TREATMENTS.find((treatment) =>
      normalized.includes(treatment.cups)
      || treatment.patterns.some((pattern) => normalized.includes(
        pattern.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      ))
    ) || null;
  };
  const HAS_PERIODONTAL_PROGRESS_API = [
    "calculatePeriodontalProgress",
    "applyPeriodontalCompletion",
    "formatPeriodontalProgressNote",
    "loadPeriodontalProgress"
  ].every((name) => typeof sharedUtils[name] === "function");
  const {
    isVisible,
    escapeHtml,
    getPatientIdFromUrl,
    watchPage,
  } = sharedUtils;
  const identifyPeriodontalTreatment = sharedUtils.identifyPeriodontalTreatment
    || fallbackIdentifyTreatment;
  const periodontalTreatmentByKey = sharedUtils.periodontalTreatmentByKey
    || ((key) => FALLBACK_TREATMENTS.find((treatment) => treatment.key === key) || null);
  const calculatePeriodontalProgress = sharedUtils.calculatePeriodontalProgress
    || (() => null);
  const applyPeriodontalCompletion = sharedUtils.applyPeriodontalCompletion
    || ((progress) => progress || null);
  const formatPeriodontalProgressNote = sharedUtils.formatPeriodontalProgressNote
    || (() => "");
  const loadPeriodontalProgress = sharedUtils.loadPeriodontalProgress
    || (() => null);
  const buildSharedValuationText = sharedUtils.buildPeriodontalValuationText
    || null;

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
    notaControles: sharedUtils.defaultPeriodontalControlNote
      || "NOTA IMPORTANTE: Se informa al paciente que es fundamental mantener controles periodontales cada 3 meses para evitar reincidencia y exacerbación de la enfermedad periodontal."
  };

  // ═══════════════════════════════════════════════════════════════════════

  const PANEL_ID = "dlk-evo-periodoncia-panel";
  const MODAL_ID = "dlk-evo-periodoncia-modal";
  const STYLE_ID = "dlk-evo-periodoncia-style";
  const UNDO_ID = "dlk-evo-periodoncia-undo";
  const ANAMNESIS_BADGE_ID = "dlk-evo-anamnesis-status";
  const PROGRESS_BADGE_ID = "dlk-evo-periodontal-progress";
  const PERIO_STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const ANAMNESIS_STORAGE_KEY = "dlk_anamnesis_context_v1";
  const GROUPED_TREATMENT_STORAGE_KEY = "dlk_grouped_periodontal_treatments_v1";
  const ANAMNESIS_PATH = /\/pacientes\/\d+\/ficha\/antecedentes\b/i;
  const ANAMNESIS_FIELD_LABELS = [
    "Motivo de consulta",
    "Enfermedad actual",
    "Alertas médicas",
    "Enfermedades",
    "Medicamentos",
    "Hábitos",
    "Antecedentes odontológicos",
    "Antecedentes familiares",
    "Comentarios"
  ];
  const AUTO_PROMPT_CONTEXT_TTL_MS = 90 * 1000;
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
  let pendingTreatmentSelection = null;
  let lastAnamnesisSignature = "";
  const memoryGroupedTreatmentRecords = {};
  const PREVIEW_ID = "dlk-evo-circle-preview";
  const PREVIEW_CLASS = "dlk-evo-circle-candidate";
  let previewHref = "";
  let previewGroup = "";
  let previewPrincipal = "";
  let completionJob = null;
  const COMPLETION_STATUS_ID = "dlk-evo-completion-status";

  function completionRows() {
    return [...new Set([...document.querySelectorAll(".row-nombre")]
      .map(treatmentRowFromElement).filter(Boolean))];
  }

  function readCompletionItem(key) {
    const rows = completionRows().filter((row) => previewRowKey(treatmentItemFromRow(row)) === key);
    if (rows.length !== 1) return null;
    const row = rows[0];
    const container = row.closest("[porcentaje_completacion]");
    const percent = container?.getAttribute("porcentaje_completacion");
    const circles = [...row.querySelectorAll(".no-realizada")].filter(isVisible);
    return { row, circle: circles.length === 1 ? circles[0] : null,
      state: percent === "100" ? "completed" : percent === "0" && circles.length === 1 ? "pending" : "unknown" };
  }

  function nativeEvolution() {
    const modal = document.getElementById("modalEvolution");
    if (!modal || !isVisible(modal)) return null;
    const editors = [...modal.querySelectorAll(".tiptap.ProseMirror[contenteditable='true']")].filter(isVisible);
    const button = modal.querySelector("#button-evolucionar-100");
    if (editors.length !== 1 || !button || !isVisible(button)
      || normalizePlanText(button.textContent) !== "Evolucionar (100%)") return null;
    return { modal, editor: editors[0], button };
  }

  function editorIsEmpty(native) {
    return !normalizePlanText(native.editor.textContent).replace(/[\u200B-\u200D\uFEFF]/g, "")
      && !native.editor.querySelector("img,svg,video,audio,iframe,table,hr,[data-type],[contenteditable='false']")
      && !native.modal.querySelector("a[href],img,video,audio,iframe")
      && ![...native.modal.querySelectorAll("input,textarea")].some((input) =>
        input.type === "file" ? input.files?.length : !input.disabled && normalizePlanText(input.value));
  }

  function showCompletionStatus(message, job = completionJob) {
    let panel = document.getElementById(COMPLETION_STATUS_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = COMPLETION_STATUS_ID;
      panel.style.cssText = "position:fixed;bottom:18px;left:18px;z-index:2147483647;max-width:440px;padding:12px 16px;border:1px solid #8ebbc5;border-radius:8px;background:#f5fafb;color:#25434b;box-shadow:0 3px 14px #0002;font:13px/1.5 sans-serif";
      const text = document.createElement("div");
      text.setAttribute("role", "status");
      const stop = document.createElement("button");
      stop.type = "button";
      stop.textContent = "Detener automatización";
      stop.addEventListener("click", () => cancelCompletion("Detenido por el usuario."));
      panel.append(text, stop);
      document.body.appendChild(panel);
    }
    const text = panel.querySelector("[role='status']");
    if (text.textContent !== message) text.textContent = message;
    panel.querySelector("button").hidden = !job || job.cancelled || job.phase === "done" || job.phase === "stopped";
  }

  function cancelCompletion(reason) {
    if (!completionJob || ["done", "stopped"].includes(completionJob.phase)) return;
    completionJob.cancelled = true;
    completionJob.phase = "stopped";
    pendingTreatmentSelection = null;
    showCompletionStatus(`${reason} No se iniciarán más guardados. Si había uno en curso, revise su estado en Dentalink.`);
  }

  function armCompletion(circle) {
    if (completionJob?.phase === "running") return;
    if (completionJob) completionJob.cancelled = true;
    completionJob = null;
    document.getElementById(COMPLETION_STATUS_ID)?.remove();
    if (!currentTreatmentPlanId() || nativeEvolution()) return;
    const row = treatmentRowFromElement(circle);
    const item = treatmentItemFromRow(row);
    const groupKey = previewGroupKey(item);
    const group = collectPreviewGroups().get(groupKey);
    if (!group || group.ambiguous || !group.entries.some((entry) => entry.circle === circle)) return;
    const allKeys = completionRows().filter((candidate) => previewGroupKey(treatmentItemFromRow(candidate)) === groupKey)
      .map((candidate) => previewRowKey(treatmentItemFromRow(candidate))).sort();
    if (new Set(allKeys).size !== allKeys.length) {
      showCompletionStatus("Automatización no iniciada: hay prestaciones duplicadas que no se distinguen de forma única.", null);
      return;
    }
    const principal = previewRowKey(item);
    const keys = group.entries.map((entry) => previewRowKey(entry.item));
    if (keys.some((key) => readCompletionItem(key)?.state !== "pending")) return;
    completionJob = { scope: location.href, groupKey, allKeys, principal,
      remaining: keys.filter((key) => key !== principal), completed: [], cancelled: false,
      phase: "opening-principal", armedAt: Date.now(), native: null };
    showCompletionStatus(`Al guardar la nota principal con «Evolucionar (100%)», se guardarán ${completionJob.remaining.length} prestaciones restantes sin texto. Puede detener la automatización aquí.`);
  }

  function groupIsUnchanged(job) {
    const keys = completionRows().filter((row) => previewGroupKey(treatmentItemFromRow(row)) === job.groupKey)
      .map((row) => previewRowKey(treatmentItemFromRow(row))).sort();
    return JSON.stringify(keys) === JSON.stringify(job.allKeys);
  }

  function completionGuard(job) {
    if (job.cancelled || location.href !== job.scope || !groupIsUnchanged(job)) {
      throw new Error("Cambió el contexto o las prestaciones del grupo, o se canceló la ejecución.");
    }
  }

  async function waitForCompletionCondition(check, guard, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      guard();
      const result = check();
      if (result) return result;
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    guard();
    throw new Error(message);
  }

  async function waitForSavedRow(job, key, guard) {
    // Se exige cierre del modal y 100% estable; la desaparición del modal sola
    // también ocurre al cancelar y nunca constituye evidencia de guardado.
    let stableSince = 0;
    return waitForCompletionCondition(() => {
      if (nativeEvolution() || document.getElementById("modalEvolution") || readCompletionItem(key)?.state !== "completed") {
        stableSince = 0;
        return false;
      }
      if (!stableSince) stableSince = Date.now();
      return Date.now() - stableSince >= 600;
    }, guard, "Dentalink no confirmó el cierre del editor y la prestación al 100%. No se repetirá el guardado.");
  }

  function completionDriver(job) {
    return {
      scope: () => { completionGuard(job); return location.href; },
      read: readCompletionItem,
      progress: (count, total, key) => showCompletionStatus(`Guardando ${count + 1} de ${total} restantes · ${JSON.parse(key)[1] || "procedimiento"}.`),
      open: (key) => {
        completionGuard(job);
        if (document.getElementById("modalEvolution") || document.getElementById(MODAL_ID)) throw new Error("Hay otro editor o formulario abierto.");
        const item = readCompletionItem(key);
        if (!item?.circle || item.state !== "pending") throw new Error("La prestación ya no está pendiente.");
        job.current = key;
        pendingTreatmentSelection = null;
        item.circle.click();
      },
      awaitEditor: (key, guard) => waitForCompletionCondition(() => nativeEvolution(), () => { guard(); completionGuard(job); }, "No se abrió el editor de la prestación."),
      empty: editorIsEmpty,
      matches: (native, key) => nativeEvolution()?.editor === native.editor && job.current === key,
      save: (native, key) => {
        completionGuard(job);
        if (job.current !== key || nativeEvolution()?.editor !== native.editor || !editorIsEmpty(native)
          || native.button.disabled || native.button.getAttribute("aria-disabled") === "true") throw new Error("El editor cambió, contiene datos o no permite evolucionar.");
        native.button.click();
      },
      awaitSaved: (key, guard) => waitForSavedRow(job, key, () => { guard(); completionGuard(job); }),
      done: (count) => { job.phase = "done"; showCompletionStatus(`Finalizado: ${count} prestaciones restantes confirmadas al 100% en Dentalink, sin texto.`); },
      stopped: (message, count, total) => {
        job.phase = "stopped";
        job.cancelled = true;
        if (completionJob === job) showCompletionStatus(`Detenido: ${message} Confirmadas: ${count} de ${total}. Revise la última prestación antes de continuar manualmente.`);
      }
    };
  }

  function observePrincipalEditor() {
    const job = completionJob;
    if (!job || job.cancelled || ["running", "done", "stopped", "waiting-save"].includes(job.phase)) return;
    try { completionGuard(job); } catch (error) { cancelCompletion(error.message); return; }
    const native = nativeEvolution();
    if (job.phase === "opening-principal") {
      if (native) { job.native = native; job.phase = "principal-ready"; }
      else if (Date.now() - job.armedAt > 15000) cancelCompletion("No se abrió la evolución principal.");
    } else if (!native || native.editor !== job.native.editor) {
      cancelCompletion("Se cerró o cambió la evolución principal sin iniciar su guardado.");
    }
  }

  function handleCompletionClick(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const circle = event.target.closest(".no-realizada");
    if (circle) {
      if (completionJob?.phase === "running") { cancelCompletion("Se seleccionó otra prestación."); return; }
      armCompletion(circle);
      return;
    }
    const job = completionJob;
    if (!job || job.cancelled || job.phase === "running") return;
    if (event.target.closest("#button-Cerrar")) { cancelCompletion("Se cerró la evolución principal."); return; }
    if (!event.target.closest("#button-evolucionar-100")) return;
    observePrincipalEditor();
    const native = nativeEvolution();
    if (job.phase !== "principal-ready" || native?.editor !== job.native.editor
      || native.button.disabled || native.button.getAttribute("aria-disabled") === "true"
      || !normalizePlanText(native.editor.textContent)) {
      cancelCompletion("La nota principal no está lista o está vacía.");
      return;
    }
    job.phase = "waiting-save";
    showCompletionStatus("Esperando que Dentalink confirme el guardado de la nota principal…");
    waitForSavedRow(job, job.principal, () => completionGuard(job)).then(() => {
      completionGuard(job);
      job.phase = "running";
      return completeEmptyTreatmentGroup(job, completionDriver(job));
    }).catch((error) => {
      job.cancelled = true;
      job.phase = "stopped";
      if (completionJob === job) showCompletionStatus(`Detenido: ${error.message} No se guardaron automáticamente las restantes.`);
    });
  }

  // El controlador DOM aporta la evidencia de apertura y guardado. El motor
  // vuelve a validar el contexto después de cada espera y antes de cada efecto.
  async function completeEmptyTreatmentGroup(job, driver) {
    const guard = () => {
      if (job.cancelled || driver.scope() !== job.scope) {
        throw new Error("Proceso detenido: cambió el paciente o plan, o se canceló.");
      }
    };
    const requirePending = (key) => {
      guard();
      const item = driver.read(key);
      if (!item || item.state !== "pending") {
        throw new Error("Proceso detenido: una prestación cambió o no se identifica de forma única.");
      }
      return item;
    };
    try {
      guard();
      if (driver.read(job.principal)?.state !== "completed") {
        throw new Error("No se confirmó el guardado de la evolución principal.");
      }
      for (const key of job.remaining) {
        requirePending(key);
        driver.progress(job.completed.length, job.remaining.length, key);
        driver.open(key);
        const editor = await driver.awaitEditor(key, guard);
        requirePending(key);
        if (!driver.empty(editor)) throw new Error("Proceso detenido: el editor contiene texto o contenido existente.");
        if (!driver.matches(editor, key)) throw new Error("Proceso detenido: el editor no corresponde a la prestación seleccionada.");
        // No insertar, limpiar ni sustituir contenido del editor.
        guard();
        driver.save(editor, key);
        await driver.awaitSaved(key, guard);
        guard();
        if (driver.read(key)?.state !== "completed") throw new Error("No se confirmó el guardado de la prestación.");
        job.completed.push(key);
      }
      driver.done(job.completed.length);
    } catch (error) {
      driver.stopped(error.message, job.completed.length, job.remaining.length);
    }
  }

  // El resaltado no abre editores; el motor solo actúa tras el guardado principal.
  function previewGroupKey(item) {
    return JSON.stringify([item.category, item.cups, normalizePlanText(item.procedure).toUpperCase()]);
  }

  function previewRowKey(item) {
    return JSON.stringify([previewGroupKey(item), item.tooth]);
  }

  function collectPreviewGroups() {
    const groups = new Map();
    const rows = new Set([...document.querySelectorAll(".row-nombre")]
      .map((cell) => treatmentRowFromElement(cell)).filter(Boolean));
    for (const row of rows) {
      if (!isVisible(row)) continue;
      const item = treatmentItemFromRow(row);
      const treatment = periodontalTreatmentByKey(item.category);
      if (!treatment || (treatment.scope === "tooth" && !item.tooth)) continue;
      const key = previewGroupKey(item);
      if (!groups.has(key)) groups.set(key, { ...item, entries: [], ambiguous: 0 });
      const group = groups.get(key);
      const circles = [...row.querySelectorAll(".no-realizada")]
        .filter((circle) => isVisible(circle));
      // No adivinar qué control corresponde cuando una fila tiene varios.
      if (circles.length > 1) { group.ambiguous += 1; continue; }
      if (circles.length === 1) group.entries.push({ item, circle: circles[0] });
    }
    return groups;
  }

  function clearPreviewHighlights() {
    document.querySelectorAll(`.${PREVIEW_CLASS}`).forEach((circle) =>
      circle.classList.remove(PREVIEW_CLASS));
  }

  function previewTreatmentBeforeOpening(event) {
    if (completionJob && !completionJob.cancelled && !["done", "stopped"].includes(completionJob.phase)) return;
    if (!currentTreatmentPlanId()) return;
    const circle = event.target instanceof Element
      ? event.target.closest(".no-realizada")
      : null;
    if (!circle || (event.relatedTarget instanceof Element && circle.contains(event.relatedTarget))) return;
    const row = treatmentRowFromElement(circle);
    if (!row || !isVisible(row)) return;
    const item = treatmentItemFromRow(row);
    const group = collectPreviewGroups().get(previewGroupKey(item));
    // Solo previsualizar controles que el reconocimiento pudo asociar sin ambigüedad.
    if (!group?.entries.some((entry) => entry.circle === circle)) return;
    if (previewHref === location.href && previewPrincipal === previewRowKey(item)) return;
    previewHref = location.href;
    previewGroup = previewGroupKey(item);
    previewPrincipal = "";
    ensureCirclePreview();
  }

  function ensureCirclePreview() {
    if (previewHref !== location.href) {
      previewHref = location.href;
      previewGroup = "";
      previewPrincipal = "";
    }
    const groups = currentTreatmentPlanId() ? collectPreviewGroups() : new Map();
    if (!groups.size) {
      clearPreviewHighlights();
      document.getElementById(PREVIEW_ID)?.remove();
      return;
    }
    if (!document.getElementById(`${PREVIEW_ID}-style`)) {
      const style = document.createElement("style");
      style.id = `${PREVIEW_ID}-style`;
      style.textContent = `
        .${PREVIEW_CLASS} { outline: 2px solid rgba(38, 145, 173, .55) !important;
          outline-offset: 3px; box-shadow: 0 0 0 6px rgba(38, 145, 173, .12) !important; }
      `;
      document.head.appendChild(style);
    }
    document.getElementById(PREVIEW_ID)?.remove();
    if (!groups.has(previewGroup)) { previewGroup = ""; previewPrincipal = ""; }
    const group = groups.get(previewGroup);
    const candidates = (group?.entries || []).filter(({ item }) =>
      previewRowKey(item) !== previewPrincipal);
    const wanted = new Set(candidates.map(({ circle }) => circle));
    document.querySelectorAll(`.${PREVIEW_CLASS}`).forEach((circle) => {
      if (!wanted.has(circle)) circle.classList.remove(PREVIEW_CLASS);
    });
    wanted.forEach((circle) => {
      if (!circle.classList.contains(PREVIEW_CLASS)) circle.classList.add(PREVIEW_CLASS);
    });

  }

  // ─── Helpers ───

  function isTargetPage() {
    return TARGET_PATHS.some((path) => path.test(location.pathname));
  }

  function normalizePlanText(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function treatmentCategory(cups, procedure) {
    return identifyPeriodontalTreatment(`${cups} ${procedure}`)?.key || "";
  }

  function treatmentRowFromElement(element) {
    let current = element;
    while (current && current !== document.body) {
      if (
        current.querySelector?.(":scope > .row-nombre") &&
        current.querySelector?.(":scope > .row-pieza")
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function treatmentItemFromRow(row) {
    const nameCell = row?.querySelector(":scope > .row-nombre") || row?.querySelector(".row-nombre");
    const rawName = normalizePlanText(nameCell?.textContent);
    const nameMatch = rawName.match(/^\[(\d+)\]\s*(.+)$/);
    const cups = nameMatch?.[1] || "";
    const procedure = normalizePlanText(nameMatch?.[2] || rawName);
    return {
      cups,
      procedure,
      tooth: toothFromTreatmentRow(row),
      category: treatmentCategory(cups, procedure)
    };
  }

  function currentTreatmentPlanId() {
    return location.pathname.match(/\/tratamiento\/(\d+)\b/i)?.[1] || "";
  }

  function groupedTreatmentKey(context) {
    if (!context?.patientId || !context?.planId || !context?.category) return "";
    return `${context.patientId}|${context.planId}|${context.category}`;
  }

  function readGroupedTreatmentRecords() {
    try {
      const records = JSON.parse(sessionStorage.getItem(GROUPED_TREATMENT_STORAGE_KEY) || "{}");
      const savedRecords = records && typeof records === "object" && !Array.isArray(records)
        ? records
        : {};
      return { ...savedRecords, ...memoryGroupedTreatmentRecords };
    } catch (_) {
      return { ...memoryGroupedTreatmentRecords };
    }
  }

  function isGroupedTreatmentCompleted(context) {
    const key = groupedTreatmentKey(context);
    return Boolean(key && readGroupedTreatmentRecords()[key]);
  }

  function shouldOpenGroupedTreatmentPrompt(selection) {
    return Boolean(selection?.context && !isGroupedTreatmentCompleted(selection.context));
  }

  function markGroupedTreatmentCompleted(context) {
    const key = groupedTreatmentKey(context);
    if (!key) return;
    try {
      const record = {
        patientId: context.patientId,
        planId: context.planId,
        category: context.category,
        teeth: [...new Set(context.teeth || [])].sort((a, b) => Number(a) - Number(b)),
        completedAt: new Date().toISOString()
      };
      memoryGroupedTreatmentRecords[key] = record;
      const records = readGroupedTreatmentRecords();
      records[key] = record;
      sessionStorage.setItem(GROUPED_TREATMENT_STORAGE_KEY, JSON.stringify(records));
    } catch (_) {
      memoryGroupedTreatmentRecords[key] = {
        patientId: context.patientId,
        planId: context.planId,
        category: context.category,
        teeth: [...new Set(context.teeth || [])].sort((a, b) => Number(a) - Number(b)),
        completedAt: new Date().toISOString()
      };
    }
  }

  function unmarkGroupedTreatmentCompleted(context) {
    const key = groupedTreatmentKey(context);
    if (!key) return;
    delete memoryGroupedTreatmentRecords[key];
    try {
      const records = readGroupedTreatmentRecords();
      delete records[key];
      sessionStorage.setItem(GROUPED_TREATMENT_STORAGE_KEY, JSON.stringify(records));
    } catch (_) { /* No impide deshacer el texto del editor. */ }
  }

  function rememberTreatmentSelection(event) {
    const target = event.target instanceof Element
      ? event.target.closest(".no-realizada")
      : null;
    if (!target) return;

    const row = treatmentRowFromElement(target);
    const item = treatmentItemFromRow(row);
    if (item.category) {
      previewHref = location.href;
      previewGroup = previewGroupKey(item);
      previewPrincipal = previewRowKey(item);
    } else {
      previewGroup = "";
      previewPrincipal = "";
    }
    ensureCirclePreview();
    if (!item.category) return;
    const context = getOpenTreatmentContext(item.category);

    pendingTreatmentSelection = {
      ...item,
      context,
      href: location.href,
      capturedAt: Date.now()
    };
  }

  function consumeTreatmentSelection() {
    const selection = pendingTreatmentSelection;
    if (!selection) return null;

    pendingTreatmentSelection = null;
    const isExpired = Date.now() - selection.capturedAt > AUTO_PROMPT_CONTEXT_TTL_MS;
    if (isExpired || selection.href !== location.href) return null;
    return selection;
  }

  function toothFromTreatmentRow(row) {
    const text = normalizePlanText(row?.querySelector(".row-pieza")?.textContent);
    const match = text.match(/\b([1-4])\s*[.]?\s*([1-8])\b/);
    return match ? `${match[1]}${match[2]}` : "";
  }

  function getOpenTreatmentContext(category) {
    const patientId = getPatientIdFromUrl();
    const planId = currentTreatmentPlanId();
    if (!planId || !category) return null;
    const treatment = periodontalTreatmentByKey(category);

    const rows = [...document.querySelectorAll(".row-nombre")]
      .map((nameCell) => nameCell.parentElement);
    const items = rows
      .map((row) => treatmentItemFromRow(row))
      .filter((item) => item.category === category
        && (treatment?.scope === "procedure" || item.tooth));

    if (!items.length) return null;

    const teeth = [...new Set(items.map((item) => item.tooth).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    const firstItem = items[0];
    const planTitle = [...document.querySelectorAll("h2")]
      .map((heading) => normalizePlanText(heading.textContent).replace(/[\uE000-\uF8FF]+$/g, "").trim())
      .find((text) => /^\d{4}[/-]\d{2}[/-]\d{2}\b/.test(text)) || "";

    return {
      patientId,
      planId,
      category,
      planTitle,
      cups: firstItem.cups,
      procedure: firstItem.procedure,
      teeth
    };
  }

  function treatmentContextText(context) {
    if (!context) return "";
    const parts = [
      `Plan #${context.planId}${context.planTitle ? ` — ${context.planTitle}` : ""}`,
      context.cups ? `[${context.cups}] ${context.procedure}` : context.procedure,
      `Dientes: ${context.teeth.join(", ")}`
    ];
    return parts.filter(Boolean).join(" · ");
  }

  function getSavedPeriodontalSummary() {
    const patientId = getPatientIdFromUrl();
    if (!patientId) return "";
    try {
      const records = JSON.parse(localStorage.getItem(PERIO_STORAGE_KEY) || "{}");
      return records?.[patientId]?.text || "";
    } catch (_) { return ""; }
  }

  function getCurrentPeriodontalProgress() {
    const patientId = getPatientIdFromUrl();
    const storedProgress = loadPeriodontalProgress(patientId);
    const savedValuation = getSavedPeriodontalSummary();
    const valuationProgress = savedValuation
      ? calculatePeriodontalProgress(savedValuation)
      : null;
    const planRows = [...document.querySelectorAll(".row-nombre")]
      .map((nameCell) => nameCell.parentElement)
      .map((row) => treatmentItemFromRow(row))
      .filter((item) => item.category);
    const planText = planRows.length
      ? [
        "Se solicita autorización para realizar:",
        ...planRows.map((item) =>
          `- [${item.cups}] ${item.procedure}${item.tooth ? ` en ${item.tooth}` : ""}.`)
      ].join("\n")
      : "";
    const planProgress = planText ? calculatePeriodontalProgress(planText) : null;
    const globalProgress = valuationProgress?.total
      ? valuationProgress
      : storedProgress?.total ? storedProgress : null;
    let progress = globalProgress || planProgress;

    // El resumen del periodontograma define el universo global. El avance
    // condensado aporta evidencia de procedimientos ya realizados, pero nunca
    // debe reemplazar ese universo por las pocas filas del plan de hoy.
    if (valuationProgress?.total && storedProgress?.total) {
      progress = applyProgressCompletionEvidence(progress, storedProgress);
    }

    // Dentalink agrupa en este plan todo lo que se realizará en la sesión. Al
    // redactar cualquiera de sus evoluciones, se proyectan todas esas filas
    // para no informar como pendiente otro procedimiento que se evolucionará
    // inmediatamente dentro del mismo plan.
    progress = applyPlanTreatmentCompletions(progress, planRows);
    progress = applyGroupedTreatmentCompletions(
      progress,
      patientId,
      currentTreatmentPlanId()
    );
    if (progress) progress.hasGlobalBaseline = Boolean(globalProgress);
    return progress;
  }

  function applyProgressCompletionEvidence(progress, evidence) {
    let nextProgress = progress;
    if (!nextProgress || !evidence?.treatments) return nextProgress;

    evidence.treatments.forEach((treatment) => {
      if (!treatment?.completed?.length) return;
      nextProgress = applyPeriodontalCompletion(
        nextProgress,
        treatment.key,
        treatment.completed
      );
    });
    return nextProgress;
  }

  function applyPlanTreatmentCompletions(progress, planItems) {
    let nextProgress = progress;
    if (!nextProgress || !planItems?.length) return nextProgress;

    const completions = new Map();
    planItems.forEach((item) => {
      if (!item?.category) return;
      const items = completions.get(item.category) || [];
      if (item.tooth) items.push(item.tooth);
      completions.set(item.category, items);
    });
    completions.forEach((teeth, category) => {
      nextProgress = applyPeriodontalCompletion(nextProgress, category, teeth);
    });
    return nextProgress;
  }

  function applyGroupedTreatmentCompletions(progress, patientId, planId) {
    let nextProgress = progress;
    if (!nextProgress || !patientId || !planId) return nextProgress;

    Object.values(readGroupedTreatmentRecords())
      .filter((record) => record?.patientId === patientId && record?.planId === planId)
      .forEach((record) => {
        nextProgress = applyPeriodontalCompletion(
          nextProgress,
          record.category,
          record.teeth
        );
      });
    return nextProgress;
  }

  function appendPeriodontalProgressNote(text, progress) {
    const note = progress?.hasGlobalBaseline === false && progress.pendingCount === 0
      ? [
        "ESTADO DEL TRATAMIENTO PERIODONTAL",
        "Plan de la sesión completado. El avance periodontal global no está sincronizado; no se determina todavía que el paciente esté controlado."
      ].join("\n")
      : formatPeriodontalProgressNote(progress);
    if (!note || text.includes("ESTADO DEL TRATAMIENTO PERIODONTAL")
      || text.includes("TRATAMIENTO PERIODONTAL PENDIENTE")) return text;

    const providerMarker = "\n\nATENDIDO POR:";
    const providerIndex = text.lastIndexOf(providerMarker);
    if (providerIndex === -1) return `${text}\n\n${note}`;
    return `${text.slice(0, providerIndex)}\n\n${note}${text.slice(providerIndex)}`;
  }

  function insertTreatmentText(text, treatmentKey = "", teeth = "", groupedContext = null) {
    const currentProgress = getCurrentPeriodontalProgress();
    const completionTeeth = groupedContext?.teeth?.length ? groupedContext.teeth : teeth;
    const resultingProgress = treatmentKey
      ? applyPeriodontalCompletion(currentProgress, treatmentKey, completionTeeth)
      : currentProgress;
    const inserted = insertText(
      appendPeriodontalProgressNote(text, resultingProgress),
      groupedContext ? () => {
        unmarkGroupedTreatmentCompleted(groupedContext);
        schedulePanel();
      } : null
    );
    if (inserted && groupedContext) {
      markGroupedTreatmentCompleted(groupedContext);
      window.setTimeout(schedulePanel, 0);
    }
    return inserted;
  }

  function isAnamnesisPage() {
    return ANAMNESIS_PATH.test(location.pathname);
  }

  function getAnamnesisSectionLabel(textarea) {
    if (textarea.id === "comentarios") return "Comentarios";

    let current = textarea.parentElement;
    while (current && current !== document.body) {
      const text = normalizePlanText(current.textContent);
      const label = ANAMNESIS_FIELD_LABELS.find((candidate) => text.startsWith(candidate));
      const hasSearch = current.querySelector?.("input[placeholder^='Buscar']");
      const hasSingleTextarea = current.querySelectorAll?.("textarea").length === 1;
      if (label && hasSearch && hasSingleTextarea) return label;
      current = current.parentElement;
    }
    return "";
  }

  function readAnamnesisRecords() {
    try {
      const records = JSON.parse(sessionStorage.getItem(ANAMNESIS_STORAGE_KEY) || "{}");
      return records && typeof records === "object" && !Array.isArray(records) ? records : {};
    } catch (_) {
      return {};
    }
  }

  function getSavedAnamnesisContext() {
    const patientId = getPatientIdFromUrl();
    if (!patientId) return null;
    return readAnamnesisRecords()?.[patientId] || null;
  }

  function captureAnamnesisContext() {
    if (!isAnamnesisPage()) return;
    const patientId = getPatientIdFromUrl();
    if (!patientId) return;

    const fields = {};
    document.querySelectorAll("main textarea").forEach((textarea) => {
      const label = getAnamnesisSectionLabel(textarea);
      if (!label) return;
      fields[label] = normalizePlanText(textarea.value);
    });

    // Evita reemplazar un registro completo mientras Dentalink todavía está
    // cargando parcialmente la ficha.
    if (Object.keys(fields).length < 8) return;

    const signature = `${patientId}:${JSON.stringify(fields)}`;
    if (signature === lastAnamnesisSignature) return;

    try {
      const records = readAnamnesisRecords();
      records[patientId] = {
        fields,
        capturedAt: Date.now()
      };
      sessionStorage.setItem(ANAMNESIS_STORAGE_KEY, JSON.stringify(records));
      lastAnamnesisSignature = signature;
    } catch (_) { /* La evolución funciona también si el almacenamiento está bloqueado. */ }
  }

  function formatAnamnesisContext(record) {
    const lines = ANAMNESIS_FIELD_LABELS
      .map((label) => {
        const value = normalizePlanText(record?.fields?.[label]);
        return value ? `${label}: ${value}` : "";
      })
      .filter(Boolean);

    if (!lines.length) return "";
    return `CONTEXTO REGISTRADO EN FICHA ANAMNESIS
${lines.join("\n")}`;
  }

  function enrichWithAnamnesis(text) {
    const context = formatAnamnesisContext(getSavedAnamnesisContext());
    if (!context || text.includes("CONTEXTO REGISTRADO EN FICHA ANAMNESIS")) return text;

    const firstSectionBreak = text.indexOf("\n\n");
    if (firstSectionBreak === -1) return `${context}\n\n${text}`;
    return `${text.slice(0, firstSectionBreak)}\n\n${context}\n\n${text.slice(firstSectionBreak + 2)}`;
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

  function parseTeeth(text) {
    return [...new Set(
      (String(text || "").match(/\b[1-4][1-8]\b/g) || []).map(Number)
    )];
  }

  function formatAnesthesiaTechniques(techniques) {
    const orderedTechniques = [
      "Alveolar anterior",
      "Alveolar medio",
      "Alveolar posterior",
      "Alveolar inferior",
      "Nasopalatino",
      "Palatino mayor",
      "Lingual",
      "Dentario"
    ].filter((technique) => techniques.has(technique));

    const displayParts = orderedTechniques.map((technique, index) => {
      if (index > 0 && technique.startsWith("Alveolar ")) {
        return technique.replace(/^Alveolar\s+/, "").toLowerCase();
      }
      return index > 0 ? technique.toLowerCase() : technique;
    });

    if (displayParts.length <= 1) return displayParts[0] || "";
    return `${displayParts.slice(0, -1).join(", ")} y ${displayParts[displayParts.length - 1]}`;
  }

  function suggestAnesthesiaTechnique(teethText) {
    const techniques = new Set();

    parseTeeth(teethText).forEach((tooth) => {
      const quadrant = Math.trunc(tooth / 10);
      const position = tooth % 10;

      if (quadrant === 1 || quadrant === 2) {
        if (position <= 3) {
          techniques.add("Alveolar anterior");
          techniques.add("Nasopalatino");
        } else if (position <= 5) {
          techniques.add("Alveolar medio");
          techniques.add("Palatino mayor");
        } else {
          techniques.add("Alveolar posterior");
          techniques.add("Palatino mayor");
        }
        return;
      }

      techniques.add("Alveolar inferior");
      techniques.add("Lingual");
      if (position >= 6) techniques.add("Dentario");
    });

    return formatAnesthesiaTechniques(techniques);
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

  // ─── Insert helpers ───

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
    const enrichedText = enrichWithAnamnesis(text);
    const previousHtml = editor.innerHTML;
    insertHtmlInEditor(editor, linesToHtml(enrichedText));
    dispatchEditorEvents(editor, enrichedText);
    showUndoButton(editor, previousHtml, onUndo);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TEXTOS DE EVOLUCIÓN
  // ═══════════════════════════════════════════════════════════════════════

  function buildAlisadoCerradoText(values) {
    const duration = Number(values.duracion) || 45;
    const range = currentTimeRange(duration);
    const anestesia = values.usarAnestesia === "sin"
      ? "ANESTESIA\nProcedimiento realizado sin anestesia local."
      : `ANESTESIA
Farmaco: ${CONFIG.anestesia.farmaco} (${values.carpules} carpules en total).
Técnica: ${values.tecnica}`;
    return `DIAGNÓSTICO: ${CONFIG.diagnostico}
PROCEDIMIENTO: Raspado y Alisado Radicular (RAR) Campo Cerrado
Dientes: ${values.dientes}
HORA INICIO: ${range.start} | HORA FINAL: ${range.end}

VALORACION Y PREPARACION
Hallazgos clínicos: Se observa presencia de cálculos supra y subgingivales, inflamación gingival generalizada y sangrado al sondaje.
Asepsia: Enjuague previo con clorhexidina al 0.12% para disminuir la carga bacteriana salival.

${anestesia}

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

  function buildAdditionalValuationRequests(values = {}) {
    const requestLines = [];
    const addToothRequest = (value, cups, label) => {
      const teeth = normalizePlanText(value);
      if (teeth) requestLines.push(`- [${cups}] ${label} en ${teeth}.`);
    };

    addToothRequest(values.detartraje, "240201", "Detartraje subgingival");
    addToothRequest(values.alargamiento, "242301", "Alargamiento de corona clínica");
    if (values.frenillo && values.frenillo !== "no") {
      requestLines.push(`- [274101] Frenillectomía ${values.frenillo}.`);
    }
    return requestLines;
  }

  function appendAdditionalRequests(summary, requestLines) {
    if (!requestLines.length) return summary;
    if (/Se solicita autorizaci[oó]n para realizar\s*:/i.test(summary)) {
      return `${summary}\n${requestLines.join("\n")}`;
    }
    return [
      summary,
      "",
      "Se solicita autorización para realizar:",
      requestLines.join("\n")
    ].join("\n");
  }

  function buildValoracionText(values = {}) {
    const periodontalSummary = getSavedPeriodontalSummary();
    const additionalRequests = buildAdditionalValuationRequests(values);
    if (buildSharedValuationText) {
      return buildSharedValuationText({
        summary: periodontalSummary,
        additionalRequests,
        controlNote: CONFIG.notaControles
      });
    }
    if (periodontalSummary) {
      return `Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:

${appendAdditionalRequests(periodontalSummary, additionalRequests)}

${CONFIG.notaControles}

Cita 20 min`;
    }
    return `Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:

Se sugiere realizar 

Se solicita autorización para realizar:
${additionalRequests.length ? `\n${additionalRequests.join("\n")}` : ""}

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
      #${ANAMNESIS_BADGE_ID}, #${PROGRESS_BADGE_ID} {
        box-sizing: border-box; flex: 0 0 100%; border-radius: 5px; padding: 6px 8px;
        font-size: 11px; font-weight: 700; line-height: 1.25;
      }
      #${ANAMNESIS_BADGE_ID}.available { background: #ecfdf5; color: #047857; }
      #${ANAMNESIS_BADGE_ID}.empty { background: #f8fafc; color: #64748b; }
      #${ANAMNESIS_BADGE_ID}.missing { background: #fff7ed; color: #c2410c; }
      #${PROGRESS_BADGE_ID}.controlled { background: #ecfdf5; color: #047857; }
      #${PROGRESS_BADGE_ID}.pending { background: #fff7ed; color: #c2410c; }
      #${PROGRESS_BADGE_ID}.missing { background: #f8fafc; color: #64748b; }
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
        max-height: calc(100vh - 32px); overflow-y: auto;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25); padding: 16px;
      }
      #${MODAL_ID} h3 { margin: 0 0 12px; color: #0f172a; font-size: 16px; }
      #${MODAL_ID} .treatment-context {
        margin: -4px 0 12px; border-radius: 5px; background: #f0f9ff; color: #075985;
        font-size: 12px; line-height: 1.35; padding: 8px;
      }
      #${MODAL_ID} label { display: block; margin: 8px 0 4px; color: #475569; font-size: 12px; font-weight: 700; }
      #${MODAL_ID} input, #${MODAL_ID} select {
        box-sizing: border-box; width: 100%; border: 1px solid #cbd5e1; border-radius: 5px; padding: 8px; font-size: 13px;
      }
      #${MODAL_ID} .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      #${MODAL_ID} button { border: 0; border-radius: 5px; cursor: pointer; font-weight: 700; padding: 8px 10px; }
      #${MODAL_ID} .cancel { background: #e2e8f0; color: #334155; }
      #${MODAL_ID} .insert { background: #0284c7; color: #fff; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODALS & PROMPTS
  // ═══════════════════════════════════════════════════════════════════════

  function closePrompt() { document.getElementById(MODAL_ID)?.remove(); }

  function openFormPrompt(title, fields, onSubmit, contextText = "") {
    ensureStyles();
    closePrompt();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <form class="box">
        <h3>${escapeHtml(title)}</h3>
        ${contextText ? `<div class="treatment-context">${escapeHtml(contextText)}</div>` : ""}
        ${fields.map((f) => `
          <div class="field"${f.dependsOn ? ` data-depends-on="${escapeHtml(f.dependsOn.name)}" data-depends-value="${escapeHtml(f.dependsOn.value)}"` : ""}>
            <label for="dlk-evo-${f.name}">${escapeHtml(f.label)}</label>
            ${f.type === "select"
              ? `<select id="dlk-evo-${f.name}" name="${f.name}">${f.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === f.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`
              : `<input id="dlk-evo-${f.name}" name="${f.name}" autocomplete="off" value="${escapeHtml(f.value || "")}"${f.readOnly ? " readonly" : ""}${f.autoAnesthesiaFrom ? ` data-auto-anesthesia-from="${escapeHtml(f.autoAnesthesiaFrom)}" data-auto-anesthesia-default="${escapeHtml(f.value || "")}"` : ""}>`}
          </div>
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

    const updateDependentFields = () => {
      modal.querySelectorAll("[data-depends-on]").forEach((field) => {
        const controller = modal.querySelector(`[name="${field.dataset.dependsOn}"]`);
        field.hidden = controller?.value !== field.dataset.dependsValue;
      });
    };
    modal.addEventListener("change", updateDependentFields);

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
    updateDependentFields();

    modal.querySelectorAll("[data-auto-anesthesia-from]").forEach((techniqueInput) => {
      const teethInput = modal.querySelector(`[name="${techniqueInput.dataset.autoAnesthesiaFrom}"]`);
      if (!teethInput) return;
      const updateAnesthesiaSuggestion = () => {
        const suggestion = suggestAnesthesiaTechnique(teethInput.value);
        techniqueInput.value = suggestion || techniqueInput.dataset.autoAnesthesiaDefault || "";
      };
      teethInput.addEventListener("input", updateAnesthesiaSuggestion);
      updateAnesthesiaSuggestion();
    });

    modal.querySelector("input, select")?.focus();
  }

  // ─── Prompt openers ───

  function openValoracionPrompt() {
    openFormPrompt("Valoración periodontal", [
      { name: "detartraje", label: "Detartraje subgingival · dientes (opcional)", value: "" },
      { name: "alargamiento", label: "Alargamiento de corona · dientes (opcional)", value: "" },
      {
        name: "frenillo",
        label: "Frenillectomía (opcional)",
        type: "select",
        value: "no",
        options: [
          { value: "no", label: "No solicitar" },
          { value: "labial superior", label: "Labial superior" },
          { value: "labial inferior", label: "Labial inferior" },
          { value: "lingual", label: "Lingual" }
        ]
      }
    ], (values) => insertText(buildValoracionText(values)),
    "Campo cerrado, campo abierto y drenaje se incluyen automáticamente desde el periodontograma.");
  }

  function openAlisadoPrompt(title, builder, defaultCarpules, defaultTecnica, defaultDuration, allowNoAnesthesia = false, category = "", contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext(category);
    const fields = [
      { name: "dientes", label: "Dientes", value: treatmentContext?.teeth.join(", ") || "", readOnly: Boolean(groupedContext) },
      { name: "carpules", label: "Carpules en total", value: String(defaultCarpules), dependsOn: allowNoAnesthesia ? { name: "usarAnestesia", value: "con" } : null },
      { name: "tecnica", label: "Técnica anestésica", value: defaultTecnica, autoAnesthesiaFrom: "dientes", dependsOn: allowNoAnesthesia ? { name: "usarAnestesia", value: "con" } : null },
      { name: "duracion", label: "Duración de la cita (minutos)", value: String(defaultDuration) }
    ];
    if (allowNoAnesthesia) {
      fields.splice(1, 0, {
        name: "usarAnestesia",
        label: "Anestesia",
        type: "select",
        value: "con",
        options: [
          { value: "con", label: "Con anestesia" },
          { value: "sin", label: "Sin anestesia" }
        ]
      });
    }
    openFormPrompt(
      title,
      fields,
      (values) => insertTreatmentText(builder(values), category, values.dientes, groupedContext),
      treatmentContextText(treatmentContext)
    );
  }

  function openAlargamientoPrompt(contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext("crown_lengthening");
    openFormPrompt("Alargamiento", [
      { name: "diente", label: "Diente(s)", value: treatmentContext?.teeth.join(", ") || "", readOnly: Boolean(groupedContext) },
      { name: "restauracion", label: "Restauración", value: "" },
      { name: "tecnica", label: "Técnica anestésica", value: "Infiltrativa" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "60" }
    ], (values) => insertTreatmentText(
      buildAlargamientoText(values),
      "crown_lengthening",
      values.diente,
      groupedContext
    ), treatmentContextText(treatmentContext));
  }

  function openDetartrajePrompt(contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext("scaling");
    openFormPrompt("Detartraje", [
      { name: "dientes", label: "Dientes", value: treatmentContext?.teeth.join(", ") || "", readOnly: Boolean(groupedContext) },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "30" }
    ], (values) => insertTreatmentText(
      buildDetartrajeText(values),
      "scaling",
      values.dientes,
      groupedContext
    ), treatmentContextText(treatmentContext));
  }

  function openAjusteOclusalPrompt(contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext("occlusal_adjustment");
    openFormPrompt("Ajuste oclusal", [
      { name: "dientes", label: "Dientes", value: treatmentContext?.teeth.join(", ") || "", readOnly: Boolean(groupedContext) }
    ], (values) => insertTreatmentText(
      buildAjusteOclusalText(values),
      "occlusal_adjustment",
      values.dientes,
      groupedContext
    ), treatmentContextText(treatmentContext));
  }

  function openDrenajePrompt(contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext("drainage");
    openFormPrompt("Drenaje periodontal", [
      { name: "dientes", label: "Dientes", value: treatmentContext?.teeth.join(", ") || "", readOnly: Boolean(groupedContext) }
    ], (values) => insertTreatmentText(
      buildDrenajeText(values),
      "drainage",
      values.dientes,
      groupedContext
    ), treatmentContextText(treatmentContext));
  }

  function openFrenillectomiaPrompt(contextOverride = null, groupedContext = null) {
    const treatmentContext = contextOverride || getOpenTreatmentContext("frenectomy");
    openFormPrompt("Frenillectomía", [
      { name: "frenillo", label: "Tipo de frenillo (labial superior, labial inferior, lingual)", value: "labial superior" },
      { name: "carpules", label: "Carpules en total", value: "1" },
      { name: "tecnica", label: "Técnica anestésica", value: "Infiltrativa" },
      { name: "duracion", label: "Duración de la cita (minutos)", value: "30" }
    ], (values) => insertTreatmentText(
      buildFrenillectomiaText(values),
      "frenectomy",
      "",
      groupedContext
    ), treatmentContextText(treatmentContext));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUTTON HANDLERS & PANEL
  // ═══════════════════════════════════════════════════════════════════════

  function openPromptForRememberedTreatment() {
    if (completionJob?.phase === "running") { pendingTreatmentSelection = null; return; }
    if (document.getElementById(MODAL_ID)) return;
    const selection = consumeTreatmentSelection();
    if (!shouldOpenGroupedTreatmentPrompt(selection)) return;
    const groupedContext = selection.context;

    if (selection.category === "closed") {
      openAlisadoPrompt("Alisado cerrado", buildAlisadoCerradoText, 1, "Infiltrativa", 45, true, "closed", groupedContext, groupedContext);
      return;
    }
    if (selection.category === "open") {
      openAlisadoPrompt("Alisado abierto", buildAlisadoAbiertoText, 2, "Infiltrativa", 60, false, "open", groupedContext, groupedContext);
      return;
    }
    if (selection.category === "crown_lengthening") { openAlargamientoPrompt(groupedContext, groupedContext); return; }
    if (selection.category === "scaling") { openDetartrajePrompt(groupedContext, groupedContext); return; }
    if (selection.category === "occlusal_adjustment") { openAjusteOclusalPrompt(groupedContext, groupedContext); return; }
    if (selection.category === "drainage") { openDrenajePrompt(groupedContext, groupedContext); return; }
    if (selection.category === "frenectomy") openFrenillectomiaPrompt(groupedContext, groupedContext);
  }

  function handleButton(label) {
    if (label === "Valoración") {
      openValoracionPrompt();
      return;
    }
    if (label === "Alisado cerrado") { openAlisadoPrompt("Alisado cerrado", buildAlisadoCerradoText, 1, "Infiltrativa", 45, true, "closed"); return; }
    if (label === "Alisado abierto") { openAlisadoPrompt("Alisado abierto", buildAlisadoAbiertoText, 2, "Infiltrativa", 60, false, "open"); return; }
    if (label === "Alargamiento") { openAlargamientoPrompt(); return; }
    if (label === "Detartraje") { openDetartrajePrompt(); return; }
    if (label === "Ajuste oclusal") { openAjusteOclusalPrompt(); return; }
    if (label === "Drenaje") { openDrenajePrompt(); return; }
    if (label === "Control") { insertTreatmentText(buildControlText()); return; }
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
  }

  function updateAnamnesisBadge(panel) {
    const badge = panel.querySelector(`#${ANAMNESIS_BADGE_ID}`);
    if (!badge) return;

    const record = getSavedAnamnesisContext();
    const fieldCount = ANAMNESIS_FIELD_LABELS
      .filter((label) => normalizePlanText(record?.fields?.[label])).length;

    if (!record) {
      badge.className = "missing";
      badge.textContent = "Anamnesis no incluida · abra Ficha Anamnesis";
      badge.title = "La información se conserva solo durante esta sesión del navegador.";
      return;
    }

    if (!fieldCount) {
      badge.className = "empty";
      badge.textContent = "Anamnesis revisada · sin datos para incluir";
      return;
    }

    badge.className = "available";
    badge.textContent = `✓ Anamnesis incluida (${fieldCount} campos)`;
    badge.title = record.capturedAt
      ? `Capturada ${new Date(record.capturedAt).toLocaleString()}`
      : "";
  }

  function updateProgressBadge(panel) {
    const badge = panel.querySelector(`#${PROGRESS_BADGE_ID}`);
    if (!badge) return;
    if (!HAS_PERIODONTAL_PROGRESS_API) {
      badge.className = "missing";
      badge.textContent = "Avance no disponible · actualice dentalink-utils.js";
      return;
    }
    const progress = getCurrentPeriodontalProgress();

    if (!progress?.total) {
      badge.className = "missing";
      badge.textContent = "Avance periodontal no sincronizado · revise Evoluciones";
      return;
    }

    if (progress.pendingCount === 0 && progress.hasGlobalBaseline !== false) {
      badge.className = "controlled";
      badge.textContent = "✓ Paciente controlado por periodoncia";
      return;
    }

    if (progress.pendingCount === 0) {
      badge.className = "missing";
      badge.textContent = "Plan de hoy completo · avance global no sincronizado";
      return;
    }

    badge.className = "pending";
    badge.textContent = `${progress.pendingCount} ${progress.pendingCount === 1 ? "tratamiento pendiente" : "tratamientos pendientes"} · ${progress.percent} % completado`;
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
      const badge = document.createElement("span");
      badge.id = ANAMNESIS_BADGE_ID;
      panel.appendChild(badge);
      const progressBadge = document.createElement("span");
      progressBadge.id = PROGRESS_BADGE_ID;
      panel.appendChild(progressBadge);
      BUTTONS.forEach((label) => panel.appendChild(createButton(label)));
    }
    updateAnamnesisBadge(panel);
    updateProgressBadge(panel);
    const anchor = editor.closest(".sc-fa-dssr") || editor.closest("form") || editor.parentElement || editor;
    if (panel.nextElementSibling !== anchor) {
      anchor.parentElement?.insertBefore(panel, anchor);
    }
    openPromptForRememberedTreatment();
  }

  function schedulePanel() {
    if (document.getElementById(MODAL_ID)) return; // No interferir con modales abiertos
    if (schedulePanel.timer) return;
    schedulePanel.timer = window.setTimeout(() => {
      schedulePanel.timer = null;
      ensurePanel();
    }, 150);
  }

  function scheduleAnamnesisCapture() {
    if (!isAnamnesisPage() || scheduleAnamnesisCapture.timer) return;
    scheduleAnamnesisCapture.timer = window.setTimeout(() => {
      scheduleAnamnesisCapture.timer = null;
      captureAnamnesisContext();
    }, 180);
  }

  function syncPage() {
    observePrincipalEditor();
    ensureCirclePreview();
    scheduleAnamnesisCapture();
    schedulePanel();
  }

  // INIT
  // ═══════════════════════════════════════════════════════════════════════

  document.addEventListener("pointerdown", rememberTreatmentSelection, true);
  document.addEventListener("click", handleCompletionClick, true);
  ["pointerdown", "keydown", "input", "change", "paste"].forEach((type) => {
    document.addEventListener(type, (event) => {
      if (event.isTrusted && ["running", "waiting-save"].includes(completionJob?.phase)) {
        cancelCompletion("Hubo una interacción manual durante la ejecución.");
      }
    }, true);
  });
  document.addEventListener("pointerover", previewTreatmentBeforeOpening, true);
  document.addEventListener("focusin", previewTreatmentBeforeOpening, true);
  document.addEventListener("input", scheduleAnamnesisCapture, true);
  document.addEventListener("change", scheduleAnamnesisCapture, true);
  watchPage(syncPage, {
    delay: 150,
    isStale: () => (completionJob && !["done", "stopped", "running", "waiting-save"].includes(completionJob.phase))
      || (isTargetPage() && getEditor() && !document.getElementById(PANEL_ID))
  });
})();
