// ==UserScript==
// @name         Dentalink - Utils (base compartida)
// @namespace    https://odontofamily.local/dentalink-utils
// @version      1.2.2
// @description  Utilidades compartidas para los scripts de Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

// Este archivo se carga via @require en cada script de Tampermonkey.
// Solo se inicializa una vez por página gracias al guard window.__dlkUtils.

(function () {
  "use strict";

  const existingUtils = window.__dlkUtils;
  if (existingUtils?.version === "1.2.2"
    && typeof existingUtils.calculatePeriodontalProgress === "function") return;

  // Amplía una instancia antigua en vez de abandonarla. Esto permite que una
  // copia cacheada cargada por otro userscript no bloquee las funciones nuevas.
  const utils = existingUtils || {};
  utils.version = "1.2.2";

  // ─── DOM helpers ───

  utils.isVisible = function (el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  };

  // ─── Text helpers ───

  utils.normalizeSpaces = function (text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  };

  utils.normalizeKey = function (text) {
    return utils.normalizeSpaces(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  };

  utils.escapeHtml = function (text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // ─── Form helpers ───

  utils.setNativeValue = function (control, value) {
    const proto = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor?.set) {
      descriptor.set.call(control, value);
    } else {
      control.value = value;
    }
  };

  utils.dispatchControlEvents = function (control) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  // ─── URL helpers ───

  utils.getPatientIdFromUrl = function () {
    return location.pathname.match(/\/pacientes\/(\d+)\b/i)?.[1] || "";
  };

  // ─── Periodontal treatment progress ───

  const PERIODONTAL_PROGRESS_STORAGE_KEY = "dlk_periodontal_progress_v2";
  const DEFAULT_PERIODONTAL_CONTROL_NOTE = "NOTA IMPORTANTE: Se informa al paciente que es fundamental mantener controles periodontales cada 3 meses para evitar reincidencia y exacerbación de la enfermedad periodontal.";
  const PERIODONTAL_TREATMENTS = [
    {
      key: "closed",
      cups: "240301",
      label: "Alisado radicular a campo cerrado",
      shortLabel: "Campo cerrado",
      scope: "tooth",
      color: "#ef941f",
      patterns: [/CAMPO CERRADO/, /ALISAD.*CERRAD/, /RASP.*CERRAD/, /CURETAJ.*CERRAD/]
    },
    {
      key: "open",
      cups: "242201",
      label: "Alisado radicular a campo abierto",
      shortLabel: "Campo abierto",
      scope: "tooth",
      color: "#d94141",
      patterns: [/CAMPO ABIERTO/, /ALISAD.*ABIERT/, /RASP.*ABIERT/, /CURETAJ.*ABIERT/]
    },
    {
      key: "drainage",
      cups: "240401",
      label: "Drenaje periodontal",
      shortLabel: "Drenaje",
      scope: "tooth",
      color: "#2563eb",
      patterns: [/DRENAJ.*PERIODONTAL/, /DRENAJ.*ABSCESO/]
    },
    {
      key: "scaling",
      cups: "240201",
      label: "Detartraje subgingival",
      shortLabel: "Detartraje",
      scope: "tooth",
      color: "#0891b2",
      patterns: [/DETARTRAJ/, /TARTRECTOM/, /REMOCION.*CALCULO/]
    },
    {
      key: "occlusal_adjustment",
      cups: "248201",
      label: "Ajuste oclusal",
      shortLabel: "Ajuste oclusal",
      scope: "tooth",
      color: "#7c3aed",
      patterns: [/AJUSTE OCLUSAL/, /DESGASTE SELECTIVO/]
    },
    {
      key: "crown_lengthening",
      cups: "242301",
      label: "Alargamiento de corona clínica",
      shortLabel: "Alargamiento de corona",
      scope: "tooth",
      color: "#db2777",
      patterns: [/ALARGAMIENTO.*CORONA/, /CORONA CLINICA/]
    },
    {
      key: "frenectomy",
      cups: "274101",
      label: "Frenillectomía",
      shortLabel: "Frenillectomía",
      scope: "procedure",
      color: "#4f46e5",
      patterns: [/FRENILLECTOM/, /FRENECTOM/]
    }
  ];

  function treatmentByKey(key) {
    return PERIODONTAL_TREATMENTS.find((treatment) => treatment.key === key) || null;
  }

  function emptyTreatmentSets() {
    return Object.fromEntries(PERIODONTAL_TREATMENTS.map((treatment) => [treatment.key, new Set()]));
  }

  function sortedTreatmentItems(values) {
    return [...new Set(values)].sort((a, b) => {
      const aNumber = Number(a);
      const bNumber = Number(b);
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
      return String(a).localeCompare(String(b), "es");
    });
  }

  function addTreatmentItems(target, treatment, teeth) {
    if (!treatment) return;
    if (treatment.scope === "procedure") {
      target[treatment.key].add("procedimiento");
      return;
    }
    teeth.forEach((tooth) => target[treatment.key].add(String(tooth)));
  }

  utils.periodontalTreatments = PERIODONTAL_TREATMENTS.map((treatment) => ({
    key: treatment.key,
    cups: treatment.cups,
    label: treatment.label,
    shortLabel: treatment.shortLabel,
    scope: treatment.scope,
    color: treatment.color
  }));

  utils.periodontalProgressStorageKey = PERIODONTAL_PROGRESS_STORAGE_KEY;

  utils.periodontalTreatmentByKey = treatmentByKey;

  utils.identifyPeriodontalTreatment = function (value) {
    const normalized = utils.normalizeKey(value);
    if (!normalized) return null;
    return PERIODONTAL_TREATMENTS.find((treatment) =>
      new RegExp(`(?:^|\\D)${treatment.cups}(?:\\D|$)`).test(normalized) ||
      treatment.patterns.some((pattern) => pattern.test(normalized))
    ) || null;
  };

  utils.extractTeeth = function (value) {
    return sortedTreatmentItems(
      [...String(value || "").matchAll(/\b([1-4])\s*\.?\s*([1-8])\b/g)]
        .map((match) => `${match[1]}${match[2]}`)
    );
  };

  utils.parseRequestedPeriodontalTreatments = function (text) {
    const requested = emptyTreatmentSets();
    let inAuthorizationBlock = false;

    String(text || "").split("\n").forEach((line) => {
      const normalizedLine = utils.normalizeKey(line);
      if (/^SE SOLICITA AUTORIZACION PARA REALIZAR\s*:?$/.test(normalizedLine)) {
        inAuthorizationBlock = true;
        return;
      }

      const actionLine = /^ACCION REALIZADA\s*:/.test(normalizedLine);
      if (/^(NOTA IMPORTANTE|ATENDIDO POR|FIRMAS)\b/.test(normalizedLine)
        || /^.+?\s+\(#\d+\)$/.test(line.trim())
        || actionLine) {
        inAuthorizationBlock = false;
      }

      const isInlineRequest = /^[-•]?\s*SE SOLICITA\b/.test(normalizedLine);
      if (!inAuthorizationBlock && !isInlineRequest) return;

      const treatment = utils.identifyPeriodontalTreatment(line);
      if (!treatment) return;
      const requestText = line.replace(/\s+\(\d+\)\.?\s*$/, "");
      addTreatmentItems(requested, treatment, utils.extractTeeth(requestText));
    });

    String(text || "").split(/(?=Acci[oó]n realizada:)/i).forEach((segment) => {
      const lines = segment.split("\n");
      const actionLine = lines[0] || "";
      if (!/^Acci[oó]n realizada:/i.test(actionLine.trim())) return;

      const procedureLine = lines.find((line) => /^PROCEDIMIENTO\s*:/i.test(line.trim())) || "";
      const treatment = utils.identifyPeriodontalTreatment(procedureLine)
        || utils.identifyPeriodontalTreatment(actionLine);
      if (!treatment) return;

      const teethLine = lines.find((line) => /^DIENTES?\s*:/i.test(line.trim())) || "";
      const clinicalTeeth = utils.extractTeeth(teethLine);
      const piece = actionLine.match(/Pieza\s+([1-4])\s*\.?\s*([1-8])\b/i);
      const teeth = clinicalTeeth.length
        ? clinicalTeeth
        : piece ? [`${piece[1]}${piece[2]}`] : [];
      addTreatmentItems(requested, treatment, teeth);
    });

    return Object.fromEntries(
      PERIODONTAL_TREATMENTS.map((treatment) => [
        treatment.key,
        sortedTreatmentItems(requested[treatment.key])
      ])
    );
  };

  utils.defaultPeriodontalControlNote = DEFAULT_PERIODONTAL_CONTROL_NOTE;

  utils.buildPeriodontalValuationText = function ({
    summary = "",
    additionalRequests = [],
    controlNote = DEFAULT_PERIODONTAL_CONTROL_NOTE
  } = {}) {
    const requestLines = additionalRequests.filter(Boolean);
    let summaryWithRequests = String(summary || "");

    if (requestLines.length) {
      summaryWithRequests = /Se solicita autorizaci[oó]n para realizar\s*:/i.test(summaryWithRequests)
        ? `${summaryWithRequests}\n${requestLines.join("\n")}`
        : [
          summaryWithRequests,
          "",
          "Se solicita autorización para realizar:",
          requestLines.join("\n")
        ].join("\n");
    }

    const introduction = "Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:";
    if (summaryWithRequests) {
      return `${introduction}

${summaryWithRequests}

${controlNote}

Cita 20 min`;
    }

    return `${introduction}

Se sugiere realizar${" "}

Se solicita autorización para realizar:
${requestLines.length ? `\n${requestLines.join("\n")}` : ""}

${controlNote}

Cita 20 min`;
  };

  utils.buildPeriodontalOrderItems = function (summary) {
    const requested = utils.parseRequestedPeriodontalTreatments(summary);
    const configs = [
      { key: "closed", indications: "Alisado radicular a campo cerrado" },
      { key: "open", indications: "Alisado radicular a campo abierto" },
      { key: "drainage", indications: "Drenaje periodontal" }
    ];

    return configs.flatMap((config) => {
      const teeth = sortedTreatmentItems(requested[config.key] || []);
      const treatment = treatmentByKey(config.key);
      if (!treatment || !teeth.length) return [];
      return [{
        key: config.key,
        cups: treatment.cups,
        teeth,
        quantity: teeth.length,
        indications: `${config.indications} en ${teeth.join(", ")}.`
      }];
    });
  };

  utils.parseCompletedPeriodontalTreatments = function (text) {
    const completed = emptyTreatmentSets();
    const segments = String(text || "").split(/(?=Acci[oó]n realizada:)/i);

    segments.forEach((segment) => {
      const lines = segment.split("\n");
      const actionLine = lines[0] || "";
      if (!/^Acci[oó]n realizada:/i.test(actionLine.trim())) return;

      const actionTreatment = utils.identifyPeriodontalTreatment(actionLine);
      const procedureLine = lines.find((line) => /^PROCEDIMIENTO\s*:/i.test(line.trim())) || "";
      const procedureTreatment = utils.identifyPeriodontalTreatment(procedureLine);
      const treatment = procedureTreatment || actionTreatment;
      if (!treatment) return;

      const normalizedSegment = utils.normalizeKey(segment);
      const hasClinicalEvidence = Boolean(procedureTreatment)
        || (/(?:HORA INICIO|DIAGNOSTICO|ATENDIDO POR)\b/.test(normalizedSegment)
          && !/(?:^|\n)\s*-\s*(?:\n|$)/.test(segment));
      if (!hasClinicalEvidence) return;

      const teethLine = lines.find((line) => /^DIENTES?\s*:/i.test(line.trim())) || "";
      const clinicalTeeth = utils.extractTeeth(teethLine);
      const administrativePiece = actionLine.match(/Pieza\s+([1-4])\s*\.?\s*([1-8])\b/i);
      const teeth = clinicalTeeth.length
        ? clinicalTeeth
        : administrativePiece ? [`${administrativePiece[1]}${administrativePiece[2]}`] : [];
      addTreatmentItems(completed, treatment, teeth);
    });

    return Object.fromEntries(
      PERIODONTAL_TREATMENTS.map((treatment) => [
        treatment.key,
        sortedTreatmentItems(completed[treatment.key])
      ])
    );
  };

  utils.calculatePeriodontalProgress = function (text) {
    const requested = utils.parseRequestedPeriodontalTreatments(text);
    const completedRaw = utils.parseCompletedPeriodontalTreatments(text);
    const treatments = PERIODONTAL_TREATMENTS.map((treatment) => {
      const requestedItems = new Set(requested[treatment.key] || []);
      const completedItems = new Set(completedRaw[treatment.key] || []);

      // Una evolución clínica válida también demuestra que el tratamiento
      // existió, aunque la solicitud antigua no siga el formato actual.
      completedItems.forEach((item) => requestedItems.add(item));

      const requestedList = sortedTreatmentItems(requestedItems);
      const completedList = sortedTreatmentItems(
        [...completedItems].filter((item) => requestedItems.has(item))
      );
      const completedSet = new Set(completedList);
      const pendingList = requestedList.filter((item) => !completedSet.has(item));

      return {
        key: treatment.key,
        cups: treatment.cups,
        label: treatment.label,
        shortLabel: treatment.shortLabel,
        scope: treatment.scope,
        color: treatment.color,
        requested: requestedList,
        completed: completedList,
        pending: pendingList,
        total: requestedList.length,
        completedCount: completedList.length,
        pendingCount: pendingList.length
      };
    }).filter((treatment) => treatment.total > 0);

    const total = treatments.reduce((sum, treatment) => sum + treatment.total, 0);
    const completedCount = treatments.reduce((sum, treatment) => sum + treatment.completedCount, 0);
    const pendingCount = total - completedCount;

    return {
      schemaVersion: 2,
      treatments,
      total,
      completedCount,
      pendingCount,
      percent: total ? Math.round((completedCount / total) * 100) : 0,
      controlled: total > 0 && pendingCount === 0
    };
  };

  utils.applyPeriodontalCompletion = function (progress, treatmentKey, teeth) {
    if (!progress?.total || !treatmentKey) return progress || null;
    const next = JSON.parse(JSON.stringify(progress));
    const treatment = next.treatments.find((item) => item.key === treatmentKey);
    if (!treatment) return next;

    const completionItems = treatment.scope === "procedure"
      ? ["procedimiento"]
      : utils.extractTeeth(Array.isArray(teeth) ? teeth.join(", ") : teeth);
    const completed = new Set(treatment.completed);
    completionItems.forEach((item) => {
      if (treatment.requested.includes(item)) completed.add(item);
    });
    treatment.completed = sortedTreatmentItems(completed);
    treatment.completedCount = treatment.completed.length;
    treatment.pending = treatment.requested.filter((item) => !completed.has(item));
    treatment.pendingCount = treatment.pending.length;

    next.completedCount = next.treatments.reduce((sum, item) => sum + item.completedCount, 0);
    next.pendingCount = next.total - next.completedCount;
    next.percent = next.total ? Math.round((next.completedCount / next.total) * 100) : 0;
    next.controlled = next.total > 0 && next.pendingCount === 0;
    return next;
  };

  utils.formatPeriodontalProgressNote = function (progress) {
    if (!progress?.total) return "";
    if (progress.pendingCount === 0) {
      return [
        "ESTADO DEL TRATAMIENTO PERIODONTAL",
        "Paciente controlado por periodoncia. No presenta tratamientos periodontales pendientes según el plan registrado."
      ].join("\n");
    }

    const lines = progress.treatments
      .filter((treatment) => treatment.pendingCount > 0)
      .map((treatment) => treatment.scope === "procedure"
        ? `- ${treatment.label}: procedimiento pendiente.`
        : `- ${treatment.label}: pendiente en ${treatment.pending.length === 1 ? "pieza" : "piezas"} ${treatment.pending.join(", ")}.`);

    return [
      "TRATAMIENTO PERIODONTAL PENDIENTE",
      ...lines,
      "Paciente continúa en tratamiento por periodoncia."
    ].join("\n");
  };

  utils.savePeriodontalProgress = function (patientId, progress, metadata = {}) {
    if (!patientId || !progress?.total) return;
    try {
      const records = JSON.parse(localStorage.getItem(PERIODONTAL_PROGRESS_STORAGE_KEY) || "{}");
      records[patientId] = {
        progress,
        updatedAt: new Date().toISOString(),
        ...metadata
      };
      localStorage.setItem(PERIODONTAL_PROGRESS_STORAGE_KEY, JSON.stringify(records));
    } catch (_) { /* El resumen visual sigue funcionando sin almacenamiento. */ }
  };

  utils.loadPeriodontalProgress = function (patientId) {
    if (!patientId) return null;
    try {
      const records = JSON.parse(localStorage.getItem(PERIODONTAL_PROGRESS_STORAGE_KEY) || "{}");
      return records?.[patientId]?.progress || null;
    } catch (_) {
      return null;
    }
  };

  // ─── Centralized URL change watching ───
  // Monkey-patches history.pushState/replaceState only once across all scripts.
  // Each script listens for the custom "dlk:urlchange" event instead.

  const notifyUrlChange = function () {
    window.dispatchEvent(new CustomEvent("dlk:urlchange"));
  };

  if (!utils.__urlChangePatched) {
    ["pushState", "replaceState"].forEach(function (method) {
      const original = history[method];
      history[method] = function () {
        const result = original.apply(this, arguments);
        window.setTimeout(notifyUrlChange, 0);
        return result;
      };
    });
    window.addEventListener("popstate", notifyUrlChange);
    utils.__urlChangePatched = true;
  }

  /**
   * Register a callback for URL changes (SPA navigation).
   * @param {Function} callback - Function to invoke after URL change.
   * @param {number} [delay=100] - Milliseconds to wait before invoking.
   */
  utils.onUrlChange = function (callback, delay) {
    window.addEventListener("dlk:urlchange", function () {
      window.setTimeout(callback, delay || 100);
    });
  };

  // ─── Shared SPA/DOM watcher ───

  utils.debounce = function (callback, delay) {
    let timer = null;
    return function () {
      if (timer) return;
      timer = window.setTimeout(function () {
        timer = null;
        callback();
      }, delay || 150);
    };
  };

  /**
   * Standard watcher for Dentalink SPA pages.
   * It handles URL changes, DOM mutations, and a light watchdog for pages that
   * replace content without a history event.
   */
  utils.watchPage = function (callback, options = {}) {
    const delay = options.delay ?? 150;
    const intervalMs = options.interval ?? 1500;
    let lastHref = "";
    const run = utils.debounce(function () {
      lastHref = location.href;
      callback();
    }, delay);

    utils.onUrlChange(run, delay);
    run();

    if (options.initialDelay !== false) {
      window.setTimeout(run, options.initialDelay ?? 1000);
    }

    if (options.observe !== false) {
      const target = options.observeTarget || document.body || document.documentElement;
      if (target) {
        new MutationObserver(run).observe(target, {
          childList: true,
          subtree: true
        });
      }
    }

    if (intervalMs > 0) {
      window.setInterval(function () {
        if (lastHref !== location.href || options.isStale?.()) run();
      }, intervalMs);
    }

    return run;
  };

  // ─── Shared floating-panel positioning ───

  const panelRegistry = new Map();

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* ignore storage errors */ }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function applyPanelPosition(panel, options) {
    const margin = options.margin ?? 8;
    const side = options.side || "right";
    const vertical = options.vertical || "top";
    const zIndex = options.zIndex ?? (999980 + (options.order || 0));

    panel.style.position = "fixed";
    panel.style.zIndex = String(zIndex);

    const persisted = options.persistKey ? readJson(options.persistKey) : null;
    if (persisted && Number.isFinite(persisted.left) && Number.isFinite(persisted.top)) {
      panel.style.left = `${clamp(persisted.left, margin, window.innerWidth - panel.offsetWidth - margin)}px`;
      panel.style.top = `${clamp(persisted.top, margin, window.innerHeight - panel.offsetHeight - margin)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      return;
    }

    panel.style.left = side === "left" ? `${margin}px` : "auto";
    panel.style.right = side === "right" ? `${margin}px` : "auto";
    panel.style.top = vertical === "top" ? `${options.top ?? 150}px` : "auto";
    panel.style.bottom = vertical === "bottom" ? `${options.bottom ?? margin}px` : "auto";
  }

  function panelOptionsFromDataset(panel) {
    return {
      side: panel.dataset.dlkPanelSide || "right",
      vertical: panel.dataset.dlkPanelVertical || "top",
      top: Number(panel.dataset.dlkPanelTop || 150),
      bottom: Number(panel.dataset.dlkPanelBottom || 8),
      order: Number(panel.dataset.dlkPanelOrder || 0),
      gap: Number(panel.dataset.dlkPanelGap || 8),
      margin: Number(panel.dataset.dlkPanelMargin || 8),
      zIndex: Number(panel.dataset.dlkPanelZIndex || 0) || null,
      persistKey: panel.dataset.dlkPanelPersistKey || ""
    };
  }

  function autoStackPanels() {
    const groups = new Map();
    panelRegistry.forEach((options, id) => {
      const panel = document.getElementById(id);
      if (!panel || !utils.isVisible(panel) || options.persistKey && readJson(options.persistKey)) return;
      const key = `${options.side || "right"}:${options.vertical || "top"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ panel, options });
    });

    document.querySelectorAll("[data-dlk-panel='1']").forEach((panel) => {
      const options = panelOptionsFromDataset(panel);
      if (!panel.id || !utils.isVisible(panel) || options.persistKey && readJson(options.persistKey)) return;
      const key = `${options.side}:${options.vertical}`;
      if (!groups.has(key)) groups.set(key, []);
      if (!groups.get(key).some((item) => item.panel === panel)) {
        groups.get(key).push({ panel, options });
      }
    });

    groups.forEach((items) => {
      items.sort((a, b) => (a.options.order || 0) - (b.options.order || 0));
      let offset = null;
      items.forEach(({ panel, options }, index) => {
        const margin = options.margin ?? 8;
        const side = options.side || "right";
        const vertical = options.vertical || "top";
        if (offset === null) offset = vertical === "top" ? (options.top ?? 150) : (options.bottom ?? margin);

        panel.style.left = side === "left" ? `${margin}px` : "auto";
        panel.style.right = side === "right" ? `${margin}px` : "auto";
        panel.style.top = vertical === "top" ? `${offset}px` : "auto";
        panel.style.bottom = vertical === "bottom" ? `${offset}px` : "auto";
        panel.style.zIndex = String(options.zIndex || (999980 + (options.order || index)));
        offset += panel.offsetHeight + (options.gap ?? 8);
      });
    });
  }

  function enablePanelDrag(panel, options) {
    const selector = options.dragHandleSelector;
    if (!selector || panel.dataset.dlkDragEnabled === "1") return;
    const handle = panel.querySelector(selector);
    if (!handle) return;

    panel.dataset.dlkDragEnabled = "1";
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button, input, textarea, select, a")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;
      handle.setPointerCapture?.(event.pointerId);
    });

    handle.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      const margin = options.margin ?? 8;
      const left = clamp(startLeft + event.clientX - startX, margin, window.innerWidth - panel.offsetWidth - margin);
      const top = clamp(startTop + event.clientY - startY, margin, window.innerHeight - panel.offsetHeight - margin);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });

    const stopDrag = function () {
      if (!dragging) return;
      dragging = false;
      if (options.persistKey) writeJson(options.persistKey, { left: panel.offsetLeft, top: panel.offsetTop });
    };

    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }

  /**
   * Register a floating panel so Dentalink modules share predictable positions.
   */
  utils.registerPanel = function (panel, options = {}) {
    if (!panel?.id) return panel;
    panelRegistry.set(panel.id, options);
    const alreadyRegistered = panel.dataset.dlkPanel === "1";
    panel.dataset.dlkPanel = "1";
    panel.dataset.dlkPanelSide = options.side || "right";
    panel.dataset.dlkPanelVertical = options.vertical || "top";
    panel.dataset.dlkPanelTop = String(options.top ?? 150);
    panel.dataset.dlkPanelBottom = String(options.bottom ?? 8);
    panel.dataset.dlkPanelOrder = String(options.order ?? 0);
    panel.dataset.dlkPanelGap = String(options.gap ?? 8);
    panel.dataset.dlkPanelMargin = String(options.margin ?? 8);
    if (options.zIndex) panel.dataset.dlkPanelZIndex = String(options.zIndex);
    if (options.persistKey) panel.dataset.dlkPanelPersistKey = options.persistKey;
    if (!alreadyRegistered) applyPanelPosition(panel, options);
    enablePanelDrag(panel, options);
    window.setTimeout(autoStackPanels, 0);
    return panel;
  };

  utils.unregisterPanel = function (id) {
    panelRegistry.delete(id);
    window.setTimeout(autoStackPanels, 0);
  };

  window.__dlkUtils = utils;
})();
