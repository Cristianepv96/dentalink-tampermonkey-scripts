// ==UserScript==
// @name         Dentalink - Plan periodontal asistido
// @namespace    https://odontofamily.local/dentalink-plan-periodontal
// @version      1.0.0
// @description  Crea planes periodontales desde los tratamientos pendientes de la valoración.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Plan%20periodontal%20asistido.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Plan%20periodontal%20asistido.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js?v=1.3.0
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const utils = window.__dlkUtils || {};
  const {
    calculatePeriodontalProgress,
    dispatchControlEvents,
    getPatientIdFromUrl,
    getPendingPeriodontalItems,
    identifyPeriodontalTreatment,
    isVisible,
    loadPeriodontalProgressRecord,
    mergePeriodontalProgressEvidence,
    normalizeKey,
    savePeriodontalProgress,
    setNativeValue,
    watchPage
  } = utils;

  const SCRIPT_VERSION = "1.0.0";
  const PROFESSIONAL_NAME = "CRISTIAN EDUARDO PEÑA VILLAMIZAR";
  const PROFESSIONAL_PLAN_NAME = "CRISTIAN PEÑA";
  const JOB_STORAGE_KEY = "dlk_periodontal_plan_assistant_job_v1";
  const SYNC_STORAGE_KEY = "dlk_periodontal_plan_assistant_sync_v1";
  const HISTORY_STORAGE_KEY = "dlk_periodontal_plan_assistant_history_v1";
  const PERIODONTOGRAM_STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const BUTTON_ID = "dlk-periodontal-plan-launch";
  const MODAL_ID = "dlk-periodontal-plan-modal";
  const STATUS_ID = "dlk-periodontal-plan-status";
  const STYLE_ID = "dlk-periodontal-plan-style";
  const EVOLUTIONS_PATH = /^\/pacientes\/(\d+)\/ficha\/evoluciones\b/i;
  const PLANS_PATH = /^\/pacientes\/(\d+)\/tratamientos\b/i;
  const TREATMENT_PATH = /^\/pacientes\/(\d+)\/tratamiento\/(\d+)\b/i;
  const WAIT_TIMEOUT_MS = 15000;
  const NAME_LABELS = {
    closed: "RAR CERRADO",
    open: "RAR ABIERTO",
    drainage: "DRENAJE",
    scaling: "DETARTRAJE",
    occlusal_adjustment: "AJUSTE OCLUSAL",
    crown_lengthening: "ALARGAMIENTO",
    frenectomy: "FRENILLECTOMÍA"
  };
  const TREATMENT_ORDER = Object.keys(NAME_LABELS);

  let automationBusy = false;
  let pendingEvolutionSignature = "";
  let pendingEvolutionSince = 0;

  function normalizeText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalized(value) {
    return typeof normalizeKey === "function"
      ? normalizeKey(value)
      : normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function html(value) {
    return typeof utils.escapeHtml === "function"
      ? utils.escapeHtml(String(value ?? ""))
      : String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
      })[character]);
  }

  function readJson(storage, key, fallback) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStored(storage, key) {
    try { storage.removeItem(key); } catch (_) { /* Sin almacenamiento, la UI sigue disponible. */ }
  }

  function formatLocalDate(date = new Date()) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}-${month}-${date.getFullYear()}`;
  }

  function orderedItems(items) {
    return [...(items || [])].sort((a, b) =>
      TREATMENT_ORDER.indexOf(a.key) - TREATMENT_ORDER.indexOf(b.key));
  }

  function buildPlanName(items, date = new Date()) {
    const labels = orderedItems(items)
      .map((item) => NAME_LABELS[item.key])
      .filter((label, index, values) => label && values.indexOf(label) === index);
    const suffix = labels.length ? labels.join(" / ") : "PERIODONCIA";
    return `${formatLocalDate(date)} ${PROFESSIONAL_PLAN_NAME} - ${suffix}`;
  }

  function itemIdentity(key, tooth, scope = "tooth") {
    return `${key}|${scope === "procedure" ? "procedimiento" : String(tooth || "")}`;
  }

  function expandJobItems(items) {
    return orderedItems(items).flatMap((item) => {
      if (item.scope === "procedure") {
        return [{
          key: item.key,
          cups: item.cups,
          scope: item.scope,
          tooth: "",
          identity: itemIdentity(item.key, "", item.scope)
        }];
      }
      return (item.teeth || []).map((tooth) => ({
        key: item.key,
        cups: item.cups,
        scope: item.scope,
        tooth: String(tooth),
        identity: itemIdentity(item.key, tooth, item.scope)
      }));
    });
  }

  function uniqueJobItems(items) {
    const grouped = new Map();
    orderedItems(items).forEach((item) => {
      if (!item?.key || !item?.cups || !NAME_LABELS[item.key]) return;
      const current = grouped.get(item.key) || {
        key: item.key,
        cups: String(item.cups),
        label: item.label || NAME_LABELS[item.key],
        scope: item.scope === "procedure" ? "procedure" : "tooth",
        teeth: []
      };
      if (current.scope === "tooth") {
        current.teeth = [...new Set([
          ...current.teeth,
          ...(item.teeth || []).map(String).filter((tooth) => /^[1-4][1-8]$/.test(tooth))
        ])].sort((a, b) => Number(a) - Number(b));
      }
      grouped.set(item.key, current);
    });
    return orderedItems([...grouped.values()]).filter((item) =>
      item.scope === "procedure" || item.teeth.length > 0);
  }

  function sourceSignature(text) {
    let hash = 5381;
    for (const character of String(text || "")) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
    return `${String(text || "").length}:${hash >>> 0}`;
  }

  function createOperation({ patientId, originPath, planName, items, sourceRecord }) {
    const normalizedItems = uniqueJobItems(items);
    return {
      schemaVersion: 1,
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      scriptVersion: SCRIPT_VERSION,
      patientId: String(patientId),
      originPath: originPath || location.pathname,
      planName: normalizeText(planName) || buildPlanName(normalizedItems),
      items: normalizedItems,
      completed: [],
      planId: "",
      status: "confirmed",
      message: "Plan confirmado. Preparando Dentalink…",
      sourceUpdatedAt: sourceRecord?.updatedAt || "",
      sourcePath: sourceRecord?.sourcePath || "",
      sourceSignature: sourceRecord?.sourceSignature || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function readJob() {
    const job = readJson(sessionStorage, JOB_STORAGE_KEY, null);
    return job?.schemaVersion === 1 ? job : null;
  }

  function saveJob(job, changes = {}) {
    const next = {
      ...job,
      ...changes,
      updatedAt: new Date().toISOString()
    };
    writeJson(sessionStorage, JOB_STORAGE_KEY, next);
    return next;
  }

  function failJob(job, message) {
    const next = saveJob(job, { status: "error", message: normalizeText(message) });
    if (next.planId && TREATMENT_PATH.test(location.pathname)) {
      recordOperationHistory(next, currentPlanRows());
    }
    ensureStatusPanel(next);
    return next;
  }

  function readPlanHistory() {
    const history = readJson(localStorage, HISTORY_STORAGE_KEY, []);
    return Array.isArray(history) ? history : [];
  }

  function loadedSelection(items, rows) {
    const existing = new Set((rows || []).map((row) => row.identity
      || itemIdentity(row.key, row.tooth, row.scope)));
    return uniqueJobItems((items || []).flatMap((item) => {
      if (item.scope === "procedure") {
        return existing.has(itemIdentity(item.key, "", item.scope)) ? [item] : [];
      }
      const teeth = (item.teeth || []).filter((tooth) =>
        existing.has(itemIdentity(item.key, tooth, item.scope)));
      return teeth.length ? [{ ...item, teeth }] : [];
    }));
  }

  function recordOperationHistory(job, rows = []) {
    const history = readPlanHistory().filter((entry) => entry.id !== job.id);
    history.push({
      id: job.id,
      patientId: job.patientId,
      planId: job.planId,
      planName: job.planName,
      selection: clone(job.items),
      items: loadedSelection(job.items, rows),
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
      completedAt: job.status === "completed" ? new Date().toISOString() : ""
    });
    writeJson(localStorage, HISTORY_STORAGE_KEY, history);
  }

  function plannedItemIndex(patientId) {
    const result = new Map();
    readPlanHistory()
      .filter((entry) => String(entry.patientId) === String(patientId))
      .forEach((entry) => {
        expandJobItems(entry.items).forEach((item) => {
          const plans = result.get(item.identity) || [];
          plans.push(String(entry.planId));
          result.set(item.identity, [...new Set(plans)]);
        });
      });
    return result;
  }

  function onlyProfessionalEntries(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const expected = normalized(PROFESSIONAL_NAME);
    const selected = [];
    let include = false;
    let foundHeader = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const joinedHeader = /^\(#\d+\)$/.test(lines[index + 1] || "")
        ? `${line} ${lines[index + 1]}`
        : line;
      const header = joinedHeader.match(/^(.+?)\s+\(#\d+\)$/);
      const authorHeader = normalized(line).match(/^\(?A TRAVES DE\s+(.+?)(?:\s*,|\s*\))/);
      if (header || authorHeader) {
        foundHeader = true;
        include = normalized(header?.[1] || authorHeader?.[1]) === expected;
      }
      if (include) selected.push(line);
    }

    if (selected.length) return selected.join("\n");
    if (!foundHeader && normalized(text).includes(expected)) return String(text || "");
    return "";
  }

  function getSavedPeriodontogramText(patientId) {
    try {
      const records = JSON.parse(localStorage.getItem(PERIODONTOGRAM_STORAGE_KEY) || "{}");
      return records?.[patientId]?.text || "";
    } catch (_) {
      return "";
    }
  }

  function evolutionHistoryIsStable(text) {
    const professionalText = onlyProfessionalEntries(text);
    if (!professionalText || !/Plan de tratamiento/i.test(professionalText)) return false;
    const signature = sourceSignature(professionalText);
    if (signature !== pendingEvolutionSignature) {
      pendingEvolutionSignature = signature;
      pendingEvolutionSince = Date.now();
      return false;
    }
    return Date.now() - pendingEvolutionSince >= 700;
  }

  function captureEvolutionProgress({ requireFresh = false } = {}) {
    const patientId = getPatientIdFromUrl?.() || "";
    const main = document.querySelector("main");
    if (!patientId || !main || typeof calculatePeriodontalProgress !== "function") return null;

    const mainText = main.innerText || main.textContent || "";
    if (requireFresh && !evolutionHistoryIsStable(mainText)) return null;
    const professionalText = onlyProfessionalEntries(mainText);
    const liveProgress = calculatePeriodontalProgress(professionalText);
    const savedSummary = getSavedPeriodontogramText(patientId);
    const baselineProgress = savedSummary ? calculatePeriodontalProgress(savedSummary) : null;
    const progress = baselineProgress?.total && typeof mergePeriodontalProgressEvidence === "function"
      ? mergePeriodontalProgressEvidence(baselineProgress, liveProgress)
      : liveProgress?.total ? liveProgress : baselineProgress?.total ? baselineProgress : null;
    if (!progress?.total) return null;

    const signature = sourceSignature(professionalText || savedSummary);
    savePeriodontalProgress?.(patientId, progress, {
      sourcePath: location.pathname,
      sourceSignature: signature,
      scriptVersion: SCRIPT_VERSION
    });
    return loadPeriodontalProgressRecord?.(patientId) || {
      progress,
      updatedAt: new Date().toISOString(),
      sourcePath: location.pathname,
      sourceSignature: signature,
      scriptVersion: SCRIPT_VERSION
    };
  }

  function currentProgressRecord() {
    const patientId = getPatientIdFromUrl?.() || "";
    if (EVOLUTIONS_PATH.test(location.pathname)) return captureEvolutionProgress();
    return loadPeriodontalProgressRecord?.(patientId) || null;
  }

  function assistantItems(record) {
    return typeof getPendingPeriodontalItems === "function"
      ? getPendingPeriodontalItems(record?.progress)
      : [];
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} { margin-left: 8px; padding: 7px 12px; border: 1px solid #0f766e; border-radius: 5px; background: #0f766e; color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
      #${BUTTON_ID}:hover { background: #115e59; }
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, .55); }
      #${MODAL_ID} .dlk-card { box-sizing: border-box; width: min(720px, 96vw); max-height: 90vh; overflow: auto; border-radius: 12px; background: #fff; box-shadow: 0 22px 60px rgba(15,23,42,.28); color: #263238; }
      #${MODAL_ID} .dlk-head { padding: 18px 20px 13px; border-bottom: 1px solid #e2e8f0; }
      #${MODAL_ID} h3 { margin: 0 0 5px; font-size: 18px; }
      #${MODAL_ID} .dlk-subtitle { color: #64748b; font-size: 12px; }
      #${MODAL_ID} .dlk-body { padding: 16px 20px; }
      #${MODAL_ID} .dlk-name { box-sizing: border-box; width: 100%; margin: 7px 0 15px; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
      #${MODAL_ID} .dlk-group { margin: 10px 0; padding: 12px; border: 1px solid #dbe4e8; border-left: 4px solid var(--dlk-color, #0f766e); border-radius: 8px; }
      #${MODAL_ID} .dlk-group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      #${MODAL_ID} .dlk-group-head strong { font-size: 13px; }
      #${MODAL_ID} .dlk-toggle { border: 0; background: transparent; color: #0f766e; font-size: 11px; font-weight: 700; cursor: pointer; }
      #${MODAL_ID} .dlk-teeth { display: flex; flex-wrap: wrap; gap: 7px; }
      #${MODAL_ID} .dlk-tooth { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid #d8e1e6; border-radius: 999px; background: #f8fafc; font-size: 12px; cursor: pointer; }
      #${MODAL_ID} .dlk-planned { display: block; margin-top: 4px; color: #9a6700; font-size: 10px; }
      #${MODAL_ID} .dlk-empty { padding: 18px 0; color: #64748b; text-align: center; }
      #${MODAL_ID} .dlk-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 13px 20px 18px; border-top: 1px solid #e2e8f0; }
      #${MODAL_ID} .dlk-actions button { padding: 8px 13px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: inherit; cursor: pointer; }
      #${MODAL_ID} .dlk-actions .dlk-confirm { border-color: #0f766e; background: #0f766e; color: #fff; }
      #${MODAL_ID} .dlk-actions .dlk-confirm:disabled { opacity: .45; cursor: not-allowed; }
      #${STATUS_ID} { position: fixed; right: 18px; bottom: 18px; z-index: 2147482500; box-sizing: border-box; width: min(390px, calc(100vw - 36px)); padding: 14px 16px; border: 1px solid #cbd5e1; border-left: 4px solid #0f766e; border-radius: 9px; background: #fff; box-shadow: 0 10px 30px rgba(15,23,42,.18); color: #263238; font-family: inherit; }
      #${STATUS_ID}[data-status="error"] { border-left-color: #dc2626; }
      #${STATUS_ID}[data-status="completed"] { border-left-color: #16a34a; }
      #${STATUS_ID} strong { display: block; margin-bottom: 5px; }
      #${STATUS_ID} p { margin: 0 0 10px; font-size: 12px; line-height: 1.45; }
      #${STATUS_ID} .dlk-status-actions { display: flex; gap: 7px; }
      #${STATUS_ID} button { padding: 5px 9px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; font: inherit; font-size: 11px; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  function closeAssistant() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function selectedGroupsFromModal(modal, pendingItems) {
    const groups = pendingItems.map((item) => {
      const checked = [...modal.querySelectorAll(`input[data-key="${item.key}"]:checked`)];
      return {
        key: item.key,
        cups: item.cups,
        label: item.label,
        scope: item.scope,
        teeth: item.scope === "procedure" ? [] : checked.map((input) => input.value)
      };
    });
    return groups.filter((item) => item.scope === "procedure"
      ? modal.querySelector(`input[data-key="${item.key}"]:checked`)
      : item.teeth.length > 0);
  }

  function openAssistant(record = currentProgressRecord()) {
    closeAssistant();
    ensureStyles();
    const patientId = getPatientIdFromUrl?.() || "";
    const pendingItems = assistantItems(record);
    const planned = plannedItemIndex(patientId);
    const modal = document.createElement("div");
    modal.id = MODAL_ID;

    const groupsHtml = pendingItems.map((item) => {
      const values = item.scope === "procedure" ? ["procedimiento"] : item.pending;
      const controls = values.map((value) => {
        const identity = itemIdentity(item.key, value, item.scope);
        const plans = planned.get(identity) || [];
        const visibleValue = item.scope === "procedure" ? "Procedimiento" : `Pieza ${value}`;
        return `<label class="dlk-tooth">
          <input type="checkbox" data-key="${html(item.key)}" value="${html(value)}">
          <span>${html(visibleValue)}${plans.length ? `<small class="dlk-planned">Ya cargado en plan #${html(plans.join(", #"))}</small>` : ""}</span>
        </label>`;
      }).join("");
      return `<section class="dlk-group" data-group="${html(item.key)}" style="--dlk-color:${html(item.color)}">
        <div class="dlk-group-head">
          <strong>[${html(item.cups)}] ${html(item.label)}</strong>
          <button class="dlk-toggle" type="button">Seleccionar categoría</button>
        </div>
        <div class="dlk-teeth">${controls}</div>
      </section>`;
    }).join("");

    modal.innerHTML = `<div class="dlk-card" role="dialog" aria-modal="true" aria-label="Preparar plan periodontal">
      <div class="dlk-head">
        <h3>Preparar plan periodontal</h3>
        <div class="dlk-subtitle">Seleccione únicamente lo que se realizará en la cita de hoy. La automatización no evoluciona ni finaliza prestaciones.</div>
      </div>
      <div class="dlk-body">
        ${pendingItems.length ? `<label><strong>Nombre del plan</strong><input class="dlk-name" name="planName" value="${html(buildPlanName([]))}"></label>${groupsHtml}` : `<div class="dlk-empty">No se encontraron tratamientos periodontales pendientes. Actualice primero la ficha de Evoluciones.</div>`}
      </div>
      <div class="dlk-actions">
        <button class="dlk-cancel" type="button">Cancelar</button>
        ${pendingItems.length ? `<button class="dlk-confirm" type="button" disabled>Crear plan y cargar prestaciones</button>` : ""}
      </div>
    </div>`;

    const nameInput = modal.querySelector("[name='planName']");
    const confirm = modal.querySelector(".dlk-confirm");
    const updateSelection = () => {
      const selected = selectedGroupsFromModal(modal, pendingItems);
      if (nameInput && nameInput.dataset.edited !== "true") nameInput.value = buildPlanName(selected);
      if (confirm) confirm.disabled = !selected.length || !normalizeText(nameInput?.value);
    };

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".dlk-cancel")) {
        closeAssistant();
        return;
      }
      const toggle = event.target.closest(".dlk-toggle");
      if (toggle) {
        const group = toggle.closest("[data-group]");
        const checkboxes = [...group.querySelectorAll("input[type='checkbox']")];
        const shouldCheck = checkboxes.some((checkbox) => !checkbox.checked);
        checkboxes.forEach((checkbox) => { checkbox.checked = shouldCheck; });
        toggle.textContent = shouldCheck ? "Quitar categoría" : "Seleccionar categoría";
        updateSelection();
        return;
      }
      if (event.target.closest(".dlk-confirm")) {
        const items = selectedGroupsFromModal(modal, pendingItems);
        if (!items.length) return;
        const operation = createOperation({
          patientId,
          originPath: location.pathname,
          planName: nameInput.value,
          items,
          sourceRecord: record
        });
        if (!writeJson(sessionStorage, JOB_STORAGE_KEY, operation)) {
          window.alert("No fue posible guardar la operación en esta sesión. El plan no se creó.");
          return;
        }
        closeAssistant();
        ensureStatusPanel(operation);
        continueOperation();
      }
    });
    modal.addEventListener("change", updateSelection);
    nameInput?.addEventListener("input", () => {
      nameInput.dataset.edited = "true";
      updateSelection();
    });
    document.body.appendChild(modal);
    nameInput?.focus();
  }

  function findTextButton(label) {
    const expected = normalized(label);
    return [...document.querySelectorAll("button, a")].find((element) =>
      elementIsVisible(element) && normalized(element.textContent) === expected) || null;
  }

  function ensureLaunchButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const onEvolutions = EVOLUTIONS_PATH.test(location.pathname);
    const onPlans = PLANS_PATH.test(location.pathname);
    if (!onEvolutions && !onPlans) return;
    const anchor = onEvolutions
      ? findTextButton("+ Nueva evolución") || findTextButton("Nueva evolución")
      : findTextButton("+ Nuevo plan de tratamiento") || findTextButton("Nuevo plan de tratamiento");
    if (!anchor?.parentElement) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Preparar plan periodontal";
    button.addEventListener("click", () => {
      const patientId = getPatientIdFromUrl?.() || "";
      if (!patientId) return;
      if (onPlans) {
        writeJson(sessionStorage, SYNC_STORAGE_KEY, {
          schemaVersion: 1,
          patientId,
          returnPath: location.pathname,
          phase: "capture",
          requestedAt: Date.now()
        });
        location.assign(`/pacientes/${patientId}/ficha/evoluciones`);
        return;
      }
      const record = captureEvolutionProgress();
      openAssistant(record);
    });
    anchor.insertAdjacentElement("afterend", button);
  }

  function elementIsVisible(element) {
    if (!element) return false;
    if (typeof isVisible === "function") {
      try { return isVisible(element); } catch (_) { /* Usa el fallback. */ }
    }
    const style = window.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function waitFor(predicate, timeoutMs = WAIT_TIMEOUT_MS, intervalMs = 120) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        try {
          const result = predicate();
          if (result) { resolve(result); return; }
        } catch (_) { /* Reintenta mientras Dentalink termina de renderizar. */ }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("Dentalink no mostró el control esperado dentro del tiempo disponible."));
          return;
        }
        window.setTimeout(check, intervalMs);
      };
      check();
    });
  }

  function clickElement(element) {
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element?.click?.();
  }

  function findPlanIdByName(name) {
    const expected = normalized(name);
    const matches = [...document.querySelectorAll("body *")]
      .filter((element) => element.children.length < 8 && normalized(element.textContent).includes(expected))
      .map((element) => normalizeText(element.textContent).match(/#(\d+)\s*:\s*(.+)/))
      .filter((match) => match && normalized(match[2]).includes(expected))
      .map((match) => match[1]);
    const unique = [...new Set(matches)];
    return unique.length === 1 ? unique[0] : "";
  }

  async function createNativePlan(job) {
    const existingPlanId = findPlanIdByName(job.planName);
    if (existingPlanId) {
      job = saveJob(job, {
        planId: existingPlanId,
        status: "awaiting_plan",
        message: `Se encontró el plan #${existingPlanId}. Continuando la carga…`
      });
      location.assign(`/pacientes/${job.patientId}/tratamiento/${existingPlanId}`);
      return;
    }

    const nativeButton = findTextButton("+ Nuevo plan de tratamiento")
      || findTextButton("Nuevo plan de tratamiento");
    if (!nativeButton) throw new Error("No se encontró el botón nativo “Nuevo plan de tratamiento”.");
    job = saveJob(job, { status: "opening_plan", message: "Abriendo el nuevo plan…" });
    ensureStatusPanel(job);
    clickElement(nativeButton);

    const input = await waitFor(() => {
      const candidate = document.querySelector("#nombre, input[placeholder='Nombre para este tratamiento']");
      return elementIsVisible(candidate) ? candidate : null;
    });
    setNativeValue?.(input, job.planName);
    if (!setNativeValue) input.value = job.planName;
    dispatchControlEvents?.(input);
    if (!dispatchControlEvents) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const modalRoot = input.closest("main") || input.parentElement?.parentElement || document;
    const createButton = [...modalRoot.querySelectorAll("button")]
      .find((button) => elementIsVisible(button) && normalized(button.textContent) === "CREAR")
      || findTextButton("Crear");
    if (!createButton) throw new Error("No se encontró el botón Crear del nuevo plan.");

    job = saveJob(job, { status: "submitting_plan", message: "Creando el plan en Dentalink…" });
    ensureStatusPanel(job);
    clickElement(createButton);

    window.setTimeout(() => {
      const current = readJob();
      if (!current || current.id !== job.id || TREATMENT_PATH.test(location.pathname)) return;
      const createdId = findPlanIdByName(current.planName);
      if (createdId) {
        const resumed = saveJob(current, { planId: createdId, status: "awaiting_plan" });
        location.assign(`/pacientes/${resumed.patientId}/tratamiento/${createdId}`);
      } else {
        failJob(current, "No fue posible confirmar la creación del plan. Revise Dentalink y use Reanudar.");
      }
    }, WAIT_TIMEOUT_MS);
  }

  function treatmentRowFromNameCell(nameCell) {
    let current = nameCell;
    while (current && current !== document.body) {
      if (current.querySelector?.(":scope > .row-nombre") && current.querySelector?.(":scope > .row-pieza")) return current;
      current = current.parentElement;
    }
    return nameCell.parentElement;
  }

  function currentPlanRows() {
    return [...document.querySelectorAll(".row-nombre")].flatMap((nameCell) => {
      const row = treatmentRowFromNameCell(nameCell);
      const name = normalizeText(nameCell.textContent);
      const treatment = identifyPeriodontalTreatment?.(name);
      if (!treatment) return [];
      const toothText = normalizeText(row?.querySelector(".row-pieza")?.textContent);
      const match = toothText.match(/\b([1-4])\s*[.]?\s*([1-8])\b/);
      return [{
        key: treatment.key,
        cups: treatment.cups,
        scope: treatment.scope,
        tooth: match ? `${match[1]}${match[2]}` : "",
        identity: itemIdentity(treatment.key, match ? `${match[1]}${match[2]}` : "", treatment.scope)
      }];
    });
  }

  function missingOperationItems(items, rows) {
    const existing = new Set((rows || []).map((row) => row.identity
      || itemIdentity(row.key, row.tooth, row.scope)));
    return expandJobItems(items).filter((item) => !existing.has(item.identity));
  }

  function findAddProcedureButton() {
    return [...document.querySelectorAll("button, a, div")]
      .filter((element) => element.children.length < 5
        && elementIsVisible(element)
        && normalized(element.textContent) === "AGREGAR PRESTACION")
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0] || null;
  }

  function selectOdontogramTeeth(teeth) {
    for (const tooth of teeth) {
      const preferred = document.getElementById(`cara_${tooth}_5`);
      const fallback = document.querySelector(`[id^="cara_${tooth}_"]`);
      const face = preferred || fallback;
      if (!face) throw new Error(`No se encontró la pieza ${tooth} en el odontograma.`);
      clickElement(face);
    }
  }

  function findProcedureSearchInput() {
    return [...document.querySelectorAll("input")]
      .filter((input) => {
        if (!elementIsVisible(input) || input.closest(`#${MODAL_ID}, #${STATUS_ID}`)) return false;
        const placeholder = normalized(input.placeholder);
        if (placeholder.includes("BUSCA PACIENTES") || input.id === "nombre") return false;
        const context = normalized(input.closest("[role='dialog'], .modal, form, main")?.textContent);
        return placeholder.includes("BUSCAR") || context.includes("PRESTACION") || context.includes("PROCEDIMIENTO");
      })
      .at(-1) || null;
  }

  function procedureOptions(cups) {
    const code = String(cups);
    const exactCode = new RegExp(`(?:^|\\D)${code}(?:\\D|$)`);
    const selector = "[role='option'], li, .select2-result-label, .select2-results__option, button, a";
    const candidates = [...document.querySelectorAll(selector)].filter((element) => {
      const text = normalizeText(element.textContent);
      return elementIsVisible(element)
        && exactCode.test(text)
        && text.length < 500
        && !element.closest(`.row-nombre, #${MODAL_ID}, #${STATUS_ID}`);
    });
    return candidates.filter((candidate) => !candidates.some((other) =>
      other !== candidate && candidate.contains(other) && normalizeText(other.textContent).includes(code)));
  }

  async function chooseProcedureByCups(cups) {
    let options = procedureOptions(cups);
    if (!options.length) {
      const input = await waitFor(() => findProcedureSearchInput(), 8000);
      setNativeValue?.(input, String(cups));
      if (!setNativeValue) input.value = String(cups);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
      options = await waitFor(() => {
        const found = procedureOptions(cups);
        return found.length ? found : null;
      }, 10000);
    }

    const distinctLabels = [...new Set(options.map((option) => normalized(option.textContent)))];
    if (distinctLabels.length !== 1) {
      throw new Error(`Dentalink mostró ${distinctLabels.length} resultados diferentes para el CUPS ${cups}.`);
    }
    clickElement(options.sort((a, b) => normalizeText(a.textContent).length - normalizeText(b.textContent).length)[0]);
  }

  async function addTreatmentGroup(job, group) {
    const rowsBefore = currentPlanRows();
    const missingBefore = missingOperationItems([group], rowsBefore);
    if (!missingBefore.length) return job;

    const addButton = await waitFor(() => findAddProcedureButton());
    clickElement(addButton);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (group.scope === "tooth") selectOdontogramTeeth(missingBefore.map((item) => item.tooth));
    await chooseProcedureByCups(group.cups);

    await waitFor(() => missingOperationItems([group], currentPlanRows()).length === 0, WAIT_TIMEOUT_MS);
    const completed = new Set(job.completed || []);
    expandJobItems([group]).forEach((item) => completed.add(item.identity));
    const next = saveJob(job, {
      completed: [...completed],
      message: `[${group.cups}] ${group.label} cargado correctamente.`
    });
    recordOperationHistory(next, currentPlanRows());
    return next;
  }

  async function loadOperationItems(job) {
    const match = location.pathname.match(TREATMENT_PATH);
    if (!match || match[1] !== String(job.patientId)) throw new Error("La ficha abierta no corresponde al paciente de la operación.");
    if (job.planId && match[2] !== String(job.planId)) throw new Error(`La operación pertenece al plan #${job.planId}.`);
    if (!job.planId) job = saveJob(job, { planId: match[2] });

    job = saveJob(job, { status: "loading_items", message: "Cargando prestaciones periodontales…" });
    ensureStatusPanel(job);
    await waitFor(() => document.querySelector("#Odontograma-Adulto, .odontograma_permanente"));
    recordOperationHistory(job, currentPlanRows());

    for (const group of orderedItems(job.items)) {
      const missing = missingOperationItems([group], currentPlanRows());
      if (!missing.length) {
        const completed = new Set(job.completed || []);
        expandJobItems([group]).forEach((item) => completed.add(item.identity));
        job = saveJob(job, { completed: [...completed] });
        continue;
      }
      job = saveJob(job, {
        processingKey: group.key,
        message: `Cargando [${group.cups}] ${group.label}…`
      });
      ensureStatusPanel(job);
      job = await addTreatmentGroup(job, group);
    }

    const remaining = missingOperationItems(job.items, currentPlanRows());
    if (remaining.length) throw new Error(`Quedaron ${remaining.length} prestaciones sin cargar.`);
    job = saveJob(job, {
      status: "completed",
      processingKey: "",
      message: `Plan #${job.planId} creado con ${expandJobItems(job.items).length} prestaciones. Ya puede comenzar a evolucionarlas.`
    });
    recordOperationHistory(job, currentPlanRows());
    ensureStatusPanel(job);
    return job;
  }

  function ensureStatusPanel(job = readJob()) {
    document.getElementById(STATUS_ID)?.remove();
    if (!job || String(job.patientId) !== String(getPatientIdFromUrl?.() || "")) return;
    ensureStyles();
    const panel = document.createElement("aside");
    panel.id = STATUS_ID;
    panel.dataset.status = job.status;
    const total = expandJobItems(job.items).length;
    const completed = new Set(job.completed || []).size;
    const title = job.status === "completed"
      ? "Plan periodontal preparado"
      : job.status === "error" ? "Automatización detenida" : "Preparando plan periodontal";
    panel.innerHTML = `<strong>${title}</strong>
      <p>${html(job.message || "Operación en curso.")}${total ? `<br>${Math.min(completed, total)} de ${total} prestaciones verificadas.` : ""}</p>
      <div class="dlk-status-actions">
        ${job.status === "error" ? `<button type="button" data-action="resume">Reanudar</button>` : ""}
        <button type="button" data-action="cancel">${job.status === "completed" ? "Cerrar" : "Cancelar automatización"}</button>
      </div>`;
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "cancel") {
        removeStored(sessionStorage, JOB_STORAGE_KEY);
        panel.remove();
      }
      if (action === "resume") {
        const current = readJob();
        if (!current) return;
        const status = PLANS_PATH.test(location.pathname) && !current.planId
          ? "confirmed"
          : TREATMENT_PATH.test(location.pathname) ? "loading_items" : "confirmed";
        saveJob(current, { status, message: "Reanudando la automatización…" });
        continueOperation();
      }
    });
    document.body.appendChild(panel);
  }

  async function continueOperation() {
    if (automationBusy) return;
    let job = readJob();
    if (!job || String(job.patientId) !== String(getPatientIdFromUrl?.() || "")) return;
    ensureStatusPanel(job);

    if (EVOLUTIONS_PATH.test(location.pathname) && job.status === "confirmed") {
      location.assign(`/pacientes/${job.patientId}/tratamientos`);
      return;
    }
    if (PLANS_PATH.test(location.pathname) && job.status === "confirmed") {
      automationBusy = true;
      try { await createNativePlan(job); }
      catch (error) { failJob(readJob() || job, error.message); }
      finally { automationBusy = false; }
      return;
    }
    if (TREATMENT_PATH.test(location.pathname)
      && ["opening_plan", "submitting_plan", "awaiting_plan", "loading_items"].includes(job.status)) {
      automationBusy = true;
      try { await loadOperationItems(job); }
      catch (error) { failJob(readJob() || job, error.message); }
      finally { automationBusy = false; }
    }
  }

  function handleSyncNavigation() {
    const sync = readJson(sessionStorage, SYNC_STORAGE_KEY, null);
    const patientId = getPatientIdFromUrl?.() || "";
    if (!sync || String(sync.patientId) !== String(patientId)) return false;

    if (EVOLUTIONS_PATH.test(location.pathname) && sync.phase === "capture") {
      const record = captureEvolutionProgress({ requireFresh: true });
      if (!record) {
        window.setTimeout(syncPage, 850);
        return false;
      }
      writeJson(sessionStorage, SYNC_STORAGE_KEY, { ...sync, phase: "return" });
      location.assign(sync.returnPath || `/pacientes/${patientId}/tratamientos`);
      return true;
    }
    if (PLANS_PATH.test(location.pathname) && sync.phase === "return") {
      removeStored(sessionStorage, SYNC_STORAGE_KEY);
      window.setTimeout(() => openAssistant(loadPeriodontalProgressRecord?.(patientId)), 0);
      return true;
    }
    return false;
  }

  function syncPage() {
    ensureStyles();
    ensureLaunchButton();
    handleSyncNavigation();
    ensureStatusPanel();
    continueOperation();
  }

  const TEST_API = {
    NAME_LABELS,
    assistantItems,
    buildPlanName,
    createOperation,
    expandJobItems,
    formatLocalDate,
    itemIdentity,
    loadedSelection,
    missingOperationItems,
    onlyProfessionalEntries,
    plannedItemIndex,
    selectedGroupsFromModal,
    sourceSignature,
    uniqueJobItems
  };
  if (globalThis.__DLK_PLAN_ASSISTANT_TEST__) {
    globalThis.__dlkPlanAssistantTest = TEST_API;
    return;
  }

  if (![
    calculatePeriodontalProgress,
    getPatientIdFromUrl,
    getPendingPeriodontalItems,
    loadPeriodontalProgressRecord
  ].every((value) => typeof value === "function")) {
    console.warn("Dentalink Plan periodontal: actualice dentalink-utils.js a la versión 1.3.0.");
    return;
  }

  window.addEventListener("pageshow", syncPage);
  window.addEventListener("dlk:urlchange", syncPage);
  document.addEventListener("click", () => window.setTimeout(syncPage, 0), true);
  if (typeof watchPage === "function") {
    watchPage(syncPage, {
      delay: 180,
      isStale: () => (EVOLUTIONS_PATH.test(location.pathname) || PLANS_PATH.test(location.pathname))
        && !document.getElementById(BUTTON_ID)
    });
  } else {
    const observer = new MutationObserver(() => window.setTimeout(syncPage, 80));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.setTimeout(syncPage, 0);
})();
