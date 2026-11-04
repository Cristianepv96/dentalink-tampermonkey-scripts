// ==UserScript==
// @name         Dentalink - Resumen periodontograma
// @namespace    https://odontofamily.local/dentalink-periodontograma-resumen
// @version      1.10.0
// @description  Genera resumen de bolsas periodontales, sangrado, movilidad y furca desde el periodontograma.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Resumen%20periodontograma.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Resumen%20periodontograma.user.js
// @grant        GM_openInTab
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const getPatientIdFromUrl = () =>
    location.pathname.match(/\/pacientes\/(\d+)\b/i)?.[1] || "";
  const watchPage = (callback, options = {}) => {
    const delay = options.delay ?? 150;
    const intervalMs = options.interval ?? 1500;
    let timer = null;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, delay);
    };
    run();
    const target = document.body || document.documentElement;
    if (target) {
      new MutationObserver(run).observe(target, { childList: true, subtree: true });
    }
    if (intervalMs > 0) {
      window.setInterval(() => {
        if (!options.isStale || options.isStale()) run();
      }, intervalMs);
    }
    return run;
  };
  const registerPanel = (panel, options = {}) => {
    if (!panel) return;
    const saved = getPanelPosition();
    panel.style.position = "fixed";
    panel.style.left = `${saved?.left ?? options.margin ?? 8}px`;
    panel.style.right = "auto";
    panel.style.top = `${saved?.top ?? options.top ?? 154}px`;
    panel.style.zIndex = String(options.zIndex || 999990);
    enableDrag(panel);
  };
  const unregisterPanel = () => {};

  const PANEL_ID = "dlk-perio-resumen";
  const STYLE_ID = "dlk-perio-resumen-style";
  const STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const ORDER_DRAFT_STORAGE_KEY = "dlk_periodontal_order_drafts_v1";
  const POSITION_KEY = "dlk_periodontograma_resumen_position_v1";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/periodontograma\b/i;
  const ORDER_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function isTargetPage() {
    return TARGET_PATH.test(location.pathname);
  }

  // ─── Revisión periodontal cada 9 meses y comparación entre versiones ───
  //
  // Dentalink guarda cada periodontograma como una versión nueva. El conteo
  // empieza en la primera versión; los controles de cada 3 meses no lo
  // reinician. Desde los 8 meses (9 ± 1) se muestra el aviso, y el primer
  // periodontograma guardado desde entonces inicia el conteo siguiente.

  const REVIEW_ALERT_FROM_MONTHS = 8;
  const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MEASUREMENT_FIELDS = [
    "margen_1", "margen_2", "margen_3", "surco_1", "surco_2", "surco_3",
    "nic_1", "nic_2", "nic_3", "mucogingival", "furca", "placa", "exudado",
    "sangramiento", "sangramiento_1", "sangramiento_2", "sangramiento_3",
    "movilidad", "indice_gingival", "indice_higiene"
  ];
  // Sección 1 = vestibular y 2 = palatino/lingual; 3 sitios por sección.
  const SITE_SECTIONS = [1, 2];

  function addMonths(date, months) {
    const result = new Date(date.getTime());
    const dayOfMonth = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(dayOfMonth, lastDay));
    return result;
  }

  function dayKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  function formatShortDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function parseStateDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return null;
    const [, y, m, d, h = "0", mi = "0", s = "0"] = match;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi), Number(s));
  }

  function parseVersionLabelDate(label) {
    const normalized = String(label || "").toLowerCase();
    const match = normalized.match(/del\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/);
    if (!match) return null;
    const month = MONTHS_ES.indexOf(match[2].replace("setiembre", "septiembre"));
    if (month < 0) return null;
    return new Date(Number(match[3]), month, Number(match[1]), 0, 0, 0);
  }

  function sortVersions(versions) {
    return [...versions].sort((a, b) => a.date - b.date);
  }

  function versionsFromState(state) {
    const list = Array.isArray(state?.periodontogramas) ? state.periodontogramas : [];
    return sortVersions(list.flatMap((item) => {
      const date = parseStateDate(item?.fecha);
      return date ? [{ id: Number(item.id) || null, date }] : [];
    }));
  }

  // El selector de versiones se actualiza al guardar sin recargar la página;
  // las versiones que solo aparecen ahí son las más recientes.
  function mergeVersions(stateVersions, labels, now = new Date()) {
    const known = sortVersions(stateVersions);
    const labelDates = (labels || []).map(parseVersionLabelDate).filter(Boolean)
      .sort((a, b) => b - a);
    const extra = labelDates.length - known.length;
    if (extra <= 0) return known;
    const additions = labelDates.slice(0, extra).map((date) => ({
      id: null,
      date: dayKey(date) === dayKey(now) ? new Date(now.getTime()) : date
    }));
    return sortVersions([...known, ...additions]);
  }

  function cycleAnchors(versions) {
    const anchors = [];
    sortVersions(versions).forEach((version) => {
      const anchor = anchors[anchors.length - 1];
      if (!anchor || dayKey(version.date) >= dayKey(addMonths(anchor.date, REVIEW_ALERT_FROM_MONTHS))) {
        anchors.push(version);
      }
    });
    return anchors;
  }

  function reviewStatus(versions, now = new Date()) {
    const anchors = cycleAnchors(versions);
    const anchor = anchors[anchors.length - 1] || null;
    if (!anchor) return { anchors, anchor: null, dueFrom: null, due: false };
    const dueFrom = addMonths(anchor.date, REVIEW_ALERT_FROM_MONTHS);
    return {
      anchors,
      anchor,
      isFirstCycle: anchors.length === 1,
      dueFrom,
      due: dayKey(now) >= dayKey(dueFrom)
    };
  }

  function formatReviewAlert(status) {
    if (!status?.due || !status.anchor) return "";
    const origin = status.isFirstCycle
      ? "9 MESES DESDE LA PRIMERA REVISIÓN"
      : "9 MESES DESDE LA ÚLTIMA REVISIÓN COMPLETA";
    return `⚠ ${origin} (${formatShortDate(status.anchor.date)}). CORRESPONDE REALIZAR UN NUEVO PERIODONTOGRAMA.`;
  }

  // La versión base es la que inició el conteo vigente para la versión que se
  // está viendo. La versión más reciente (o una sin guardar) cuenta como la de
  // hoy, así que durante el control se compara contra el inicio del conteo.
  function baselineFor(versions, { displayedId = null, displayedDate = null, now = new Date() } = {}) {
    const sorted = sortVersions(versions);
    if (!sorted.length) return null;
    const latest = sorted[sorted.length - 1];
    let displayed = null;
    if (displayedId != null) displayed = sorted.find((version) => version.id === Number(displayedId)) || null;
    if (!displayed && displayedDate) {
      displayed = [...sorted].reverse().find((version) => dayKey(version.date) === dayKey(displayedDate)) || null;
    }
    const referenceDate = !displayed || displayed === latest || dayKey(displayed.date) === dayKey(latest.date)
      ? now
      : displayed.date;
    const previous = sorted.filter((version) => dayKey(version.date) < dayKey(referenceDate));
    const anchors = cycleAnchors(previous);
    return anchors[anchors.length - 1] || null;
  }

  function measurementNumber(value) {
    const parsed = Number(String(value ?? "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isAbsent(record) {
    const value = record?.ausente;
    return value != null && value !== "" && value !== "0" && value !== 0 && value !== false;
  }

  function summarizeMeasurements(measurements) {
    const teeth = new Map();
    (measurements || []).forEach((record) => {
      const toothId = String(record?.pieza || "").replace(/\D/g, "");
      if (!toothId) return;
      const tooth = teeth.get(toothId) || {
        tooth: toothId, absent: false, sites: [], movilidad: 0, furca: 0, exudado: 0
      };
      if (isAbsent(record)) tooth.absent = true;
      tooth.movilidad = Math.max(tooth.movilidad, measurementNumber(record.movilidad));
      tooth.furca = Math.max(tooth.furca, measurementNumber(record.furca));
      tooth.exudado = Math.max(tooth.exudado, measurementNumber(record.exudado));
      if (SITE_SECTIONS.includes(Number(record.seccion))) {
        [1, 2, 3].forEach((site) => {
          tooth.sites.push({
            depth: measurementNumber(record[`surco_${site}`]),
            bleeding: measurementNumber(record[`sangramiento_${site}`]) > 0
          });
        });
      }
      teeth.set(toothId, tooth);
    });

    const present = [...teeth.values()]
      .filter((tooth) => !tooth.absent)
      .map((tooth) => ({
        ...tooth,
        maxDepth: Math.max(0, ...tooth.sites.map((site) => site.depth))
      }))
      .sort((a, b) => Number(a.tooth) - Number(b.tooth));
    const sites = present.flatMap((tooth) => tooth.sites);
    const bleedingSites = sites.filter((site) => site.bleeding).length;

    return {
      teeth: present,
      totalSites: sites.length,
      bleedingSites,
      bleedingPercent: sites.length ? Math.round((bleedingSites / sites.length) * 100) : 0,
      pocketSites4: sites.filter((site) => site.depth >= 4).length,
      pocketSites6: sites.filter((site) => site.depth >= 6).length
    };
  }

  function compareMeasurements(baseMeasurements, currentMeasurements) {
    const base = summarizeMeasurements(baseMeasurements);
    const current = summarizeMeasurements(currentMeasurements);
    const baseByTooth = new Map(base.teeth.map((tooth) => [tooth.tooth, tooth]));
    const improved = [];
    const worsened = [];
    const mobility = [];
    const furcation = [];
    const exudate = [];

    current.teeth.forEach((tooth) => {
      const previous = baseByTooth.get(tooth.tooth);
      if (!previous) return;
      if (tooth.maxDepth < previous.maxDepth && previous.maxDepth >= 4) {
        improved.push({ tooth: tooth.tooth, from: previous.maxDepth, to: tooth.maxDepth });
      } else if (tooth.maxDepth > previous.maxDepth && tooth.maxDepth >= 4) {
        worsened.push({ tooth: tooth.tooth, from: previous.maxDepth, to: tooth.maxDepth });
      }
      if (tooth.movilidad !== previous.movilidad) {
        mobility.push({ tooth: tooth.tooth, from: previous.movilidad, to: tooth.movilidad });
      }
      if (tooth.furca !== previous.furca) {
        furcation.push({ tooth: tooth.tooth, from: previous.furca, to: tooth.furca });
      }
      if ((tooth.exudado > 0) !== (previous.exudado > 0)) {
        exudate.push({ tooth: tooth.tooth, from: previous.exudado > 0, to: tooth.exudado > 0 });
      }
    });

    return { base, current, improved, worsened, mobility, furcation, exudate };
  }

  function joinSpanish(parts) {
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} Y ${parts[parts.length - 1]}`;
  }

  function trendLabel(from, to) {
    if (to < from) return "MEJORÓ";
    if (to > from) return "EMPEORÓ";
    return "SIN CAMBIOS";
  }

  function monthsBetween(from, to) {
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (to.getDate() < from.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function formatComparison(comparison, { baseDate, currentDate = new Date() } = {}) {
    const { base, current } = comparison;
    const months = baseDate ? monthsBetween(baseDate, currentDate) : null;
    const lines = [
      `COMPARACIÓN CON EL PERIODONTOGRAMA DEL ${baseDate ? formatShortDate(baseDate) : "INICIO"}${months != null ? ` (${months} ${months === 1 ? "MES" : "MESES"})` : ""}:`,
      `- SANGRADO AL SONDAJE: ${base.bleedingPercent} % → ${current.bleedingPercent} % (${trendLabel(base.bleedingPercent, current.bleedingPercent)}).`,
      `- SITIOS CON BOLSA DE 4 MM O MÁS: ${base.pocketSites4} → ${current.pocketSites4} (${trendLabel(base.pocketSites4, current.pocketSites4)}).`,
      `- SITIOS CON BOLSA DE 6 MM O MÁS: ${base.pocketSites6} → ${current.pocketSites6} (${trendLabel(base.pocketSites6, current.pocketSites6)}).`
    ];
    const depthItem = (item) => `${item.tooth} (${item.from} → ${item.to} MM)`;
    if (comparison.improved.length) lines.push(`- MEJORARON: ${joinSpanish(comparison.improved.map(depthItem))}.`);
    if (comparison.worsened.length) lines.push(`- EMPEORARON: ${joinSpanish(comparison.worsened.map(depthItem))}.`);
    if (!comparison.improved.length && !comparison.worsened.length) {
      lines.push("- SIN CAMBIOS EN PROFUNDIDAD DE SONDAJE POR DIENTE.");
    }
    const gradeItem = (item) => `${item.tooth} (GRADO ${item.from} → ${item.to})`;
    if (comparison.mobility.length) lines.push(`- MOVILIDAD: ${joinSpanish(comparison.mobility.map(gradeItem))}.`);
    if (comparison.furcation.length) lines.push(`- FURCA: ${joinSpanish(comparison.furcation.map(gradeItem))}.`);
    const resolved = comparison.exudate.filter((item) => !item.to).map((item) => item.tooth);
    const appeared = comparison.exudate.filter((item) => item.to).map((item) => item.tooth);
    if (resolved.length) lines.push(`- SIN EXUDADO PURULENTO EN ${joinSpanish(resolved)}.`);
    if (appeared.length) lines.push(`- EXUDADO PURULENTO NUEVO EN ${joinSpanish(appeared)}.`);
    return lines.join("\n").toUpperCase();
  }

  function blankMeasurement(record) {
    const blank = { ...record };
    MEASUREMENT_FIELDS.forEach((field) => { blank[field] = "0"; });
    return blank;
  }


  function normalizeTooth(tooth) {
    return String(tooth || "").replace(/\D/g, "");
  }

  function numberValue(value) {
    const parsed = Number(String(value || "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function maxNumber(values) {
    return Math.max(0, ...values.map(numberValue));
  }

  function switchValue(table, selector, prefix) {
    return Math.max(0, ...[...table.querySelectorAll(selector)].map((cell) => {
      const switchEl = cell.querySelector(".switch");
      const match = String(switchEl?.className || "").match(new RegExp(`${prefix}_(\\d+)`));
      return match ? Number(match[1]) : 0;
    }));
  }

  function getToothRecord(table) {
    const tooth = normalizeTooth(table.querySelector("tr:first-child")?.innerText || "");
    if (!tooth) return null;

    const surco = [1, 2, 3].map((index) =>
      numberValue(table.querySelector(`input[name="surco_${index}"]`)?.value)
    );
    const movilidad = numberValue(table.querySelector('input[name="movilidad"]')?.value);
    const sangrado = switchValue(table, ".sangramiento-switch", "sangramiento");
    const exudado = switchValue(table, ".exudado-switch", "exudado");
    const furca = switchValue(table, ".furca-switch", "furca");

    return {
      tooth,
      maxSurco: maxNumber(surco),
      movilidad,
      sangrado,
      exudado,
      furca
    };
  }

  function collectPeriodontalData() {
    const records = new Map();

    document.querySelectorAll("tr.controller table.diente:not(.titles)").forEach((table) => {
      const record = getToothRecord(table);
      if (!record) return;

      const existing = records.get(record.tooth) || {
        tooth: record.tooth,
        maxSurco: 0,
        movilidad: 0,
        sangrado: 0,
        exudado: 0,
        furca: 0
      };

      records.set(record.tooth, {
        tooth: record.tooth,
        maxSurco: Math.max(existing.maxSurco, record.maxSurco),
        movilidad: Math.max(existing.movilidad, record.movilidad),
        sangrado: Math.max(existing.sangrado, record.sangrado),
        exudado: Math.max(existing.exudado, record.exudado),
        furca: Math.max(existing.furca, record.furca)
      });
    });

    return [...records.values()].sort((a, b) => Number(a.tooth) - Number(b.tooth));
  }

  function formatToothList(records) {
    return records.map((record) => record.tooth).join(", ");
  }

  function formatTeethSpan(teeth) {
    if (!teeth || teeth.length === 0) return "";
    if (teeth.length === 1) return `diente ${teeth[0]}`;
    const sorted = [...teeth].sort((a, b) => Number(a) - Number(b));
    const last = sorted.pop();
    return `dientes ${sorted.join(", ")} y ${last}`;
  }

  function buildSummary(includeCounts = false) {
    const records = collectPeriodontalData();
    const pockets = records.filter((record) => record.maxSurco >= 4);
    const exudate = records.filter((record) => record.exudado > 0);
    const closedField = pockets.filter((record) => record.maxSurco >= 4 && record.maxSurco <= 5);
    const openField = pockets.filter((record) => record.maxSurco >= 6);
    const findings = records.filter((record) =>
      record.maxSurco >= 4 ||
      record.sangrado > 0 ||
      record.exudado > 0 ||
      record.movilidad > 0 ||
      record.furca > 0
    );

    let findingsText = "";
    if (findings.length === 0) {
      findingsText = "No registra hallazgos periodontales relevantes.";
    } else {
      const groups = new Map();
      findings.forEach((record) => {
        const parts = [];
        if (record.maxSurco >= 4) {
          parts.push(`bolsas de ${record.maxSurco}mm`);
        }
        if (record.sangrado > 0) {
          parts.push("sangrado al sondaje");
        }
        if (record.exudado > 0) {
          parts.push("exudado purulento");
        }
        if (record.movilidad > 0) {
          parts.push(`movilidad grado ${record.movilidad}`);
        }
        if (record.furca > 0) {
          parts.push(`furca grado ${record.furca}`);
        }

        let desc = "";
        if (parts.length === 1) {
          desc = parts[0];
        } else if (parts.length === 2) {
          desc = `${parts[0]} y ${parts[1]}`;
        } else if (parts.length > 2) {
          desc = `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
        }

        if (!groups.has(desc)) {
          groups.set(desc, []);
        }
        groups.get(desc).push(record.tooth);
      });

      const groupPhrases = [];
      groups.forEach((teeth, desc) => {
        groupPhrases.push(`${formatTeethSpan(teeth)} con ${desc}`);
      });

      if (groupPhrases.length === 1) {
        findingsText = `Se observa ${groupPhrases[0]}.`;
      } else if (groupPhrases.length === 2) {
        findingsText = `Se observan ${groupPhrases[0]} y ${groupPhrases[1]}.`;
      } else {
        findingsText = `Se observan ${groupPhrases.slice(0, -1).join("; ")}; y ${groupPhrases[groupPhrases.length - 1]}.`;
      }
    }

    const closedCount = includeCounts ? ` (${closedField.length})` : "";
    const openCount = includeCounts ? ` (${openField.length})` : "";
    const requestLines = [];

    if (closedField.length) {
      requestLines.push(`- [240301] Raspaje y alisado radicular a campo cerrado en ${formatToothList(closedField)}${closedCount}.`);
    }

    if (openField.length) {
      requestLines.push(`- [242201] Raspaje y alisado radicular a campo abierto en ${formatToothList(openField)}${openCount}.`);
    }

    exudate.forEach((record) => {
      requestLines.push(`- [240401] Drenaje periodontal en ${record.tooth} con el fin de eliminar exudado periodontal, evitar la pérdida ósea activa que se está produciendo en ese momento y mejorar el pronóstico periodontal.`);
    });

    const result = [
      "Hallazgos periodontales:",
      findingsText
    ];

    if (requestLines.length) {
      result.push(
        "",
        "Se solicita autorización para realizar:",
        requestLines.join("\n")
      );
    }

    return result.join("\n");
  }

  function buildFallbackValuationText(summary) {
    const introduction = "Paciente acude a cita de valoración especializada por periodoncia, se observan deficiencias en higiene oral, sangrado al sondaje e inflamación generalizada, requiriendo manejo con periodoncia para evitar exacerbación de la enfermedad periodontal. Al sondaje se observan bolsas periodontales en dientes:";
    const controlNote = "NOTA IMPORTANTE: Se informa al paciente que es fundamental mantener controles periodontales cada 3 meses para evitar reincidencia y exacerbación de la enfermedad periodontal.";
    return `${introduction}

${summary}

${controlNote}

Cita 20 min`;
  }

  function buildOrderItemsFromPeriodontogram() {
    const records = collectPeriodontalData();
    const configurations = [
      {
        key: "closed",
        cups: "240301",
        label: "Alisado radicular a campo cerrado",
        matches: (record) => record.maxSurco >= 4 && record.maxSurco <= 5
      },
      {
        key: "open",
        cups: "242201",
        label: "Alisado radicular a campo abierto",
        matches: (record) => record.maxSurco >= 6
      },
      {
        key: "drainage",
        cups: "240401",
        label: "Drenaje periodontal",
        matches: (record) => record.exudado > 0
      }
    ];

    return configurations.flatMap((configuration) => {
      const teeth = records
        .filter(configuration.matches)
        .map((record) => record.tooth);
      if (!teeth.length) return [];
      return [{
        key: configuration.key,
        cups: configuration.cups,
        teeth,
        quantity: teeth.length,
        indications: `${configuration.label} en ${teeth.join(", ")}.`
      }];
    });
  }

  function createDraftToken() {
    return window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readOrderDrafts() {
    try {
      return JSON.parse(localStorage.getItem(ORDER_DRAFT_STORAGE_KEY) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function purgeExpiredOrderDrafts(records = readOrderDrafts()) {
    const now = Date.now();
    Object.keys(records).forEach((token) => {
      const createdAt = new Date(records[token]?.createdAt).getTime();
      if (!createdAt || now - createdAt > ORDER_DRAFT_MAX_AGE_MS) delete records[token];
    });
    return records;
  }

  function prepareOrderDrafts(summary) {
    const patientId = getPatientIdFromUrl();
    if (!patientId) return [];

    const justification = buildFallbackValuationText(summary);
    const items = buildOrderItemsFromPeriodontogram();

    return items.map((item) => ({
      token: createDraftToken(),
      patientId,
      cups: item.cups,
      quantity: item.quantity,
      teeth: item.teeth,
      indications: item.indications,
      justification,
      createdAt: new Date().toISOString(),
      sourceUrl: location.href
    }));
  }

  function saveAndOpenOrderDrafts(drafts) {
    if (!drafts.length) return 0;

    const records = purgeExpiredOrderDrafts();
    drafts.forEach((draft) => {
      records[draft.token] = draft;
    });
    localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(records));

    const openDraft = (draft) => {
      const url = `${location.origin}/pacientes/${draft.patientId}/ficha/formularios/nuevo/35?dlk-order=${encodeURIComponent(draft.token)}`;
      try {
        if (typeof GM_openInTab === "function") {
          GM_openInTab(url, { active: false, insert: true });
        } else {
          window.open(url, "_blank");
        }
      } catch (_error) {
        window.open(url, "_blank");
      }
    };

    drafts.forEach((draft, index) => {
      // Dentalink puede dejar una de las páginas vacía si recibe dos formularios
      // nuevos al mismo tiempo. Espaciar la navegación evita esa carrera.
      if (index === 0) {
        openDraft(draft);
      } else {
        window.setTimeout(() => openDraft(draft), index * 1800);
      }
    });
    return drafts.length;
  }

  function showGeneratedOrders(button, total, opened) {
    const originalText = "Generar";
    if (!total) {
      button.textContent = "Sin órdenes";
    } else if (opened === total) {
      button.textContent = `${total} ${total === 1 ? "orden" : "órdenes"} ✓`;
      button.classList.add("copied");
    } else {
      button.textContent = `${opened}/${total} pestañas`;
    }
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove("copied");
    }, 2200);
  }

  function saveSummary(text) {
    const patientId = getPatientIdFromUrl();
    if (!patientId || !text) return;

    try {
      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      records[patientId] = {
        text,
        url: location.href,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (_error) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        [patientId]: {
          text,
          url: location.href,
          savedAt: new Date().toISOString()
        }
      }));
    }
  }

  function getPanelPosition() {
    try {
      return JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
    } catch (_error) {
      return null;
    }
  }

  function savePanelPosition(left, top) {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top }));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        width: 220px;
        padding: 8px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 5px 18px rgba(15, 23, 42, 0.12);
        font: 11px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}.is-minimized {
        width: auto;
        min-width: 154px;
      }
      #${PANEL_ID} .title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 6px;
        color: #475569;
        cursor: move;
        font-weight: 800;
        user-select: none;
      }
      #${PANEL_ID}.is-minimized .title {
        margin-bottom: 0;
      }
      #${PANEL_ID} button {
        border: 0;
        border-radius: 5px;
        background: #0284c7;
        color: #fff;
        cursor: pointer;
        font: 800 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 6px 8px;
      }
      #${PANEL_ID} button.secondary {
        background: #64748b;
      }
      #${PANEL_ID} button.copied {
        background: #16a34a;
      }
      #${PANEL_ID} .minimize {
        width: 22px;
        height: 20px;
        padding: 0;
        background: #e2e8f0;
        color: #334155;
        line-height: 1;
      }
      #${PANEL_ID} .actions {
        display: flex;
        gap: 5px;
        margin-bottom: 6px;
      }
      #${PANEL_ID}.is-minimized .body {
        display: none;
      }
      #${PANEL_ID} button.compare {
        background: #7c3aed;
      }
      #${PANEL_ID} button.danger {
        background: #dc2626;
      }
      #${PANEL_ID} button:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      #${PANEL_ID} .review-alert {
        margin: 0 0 6px;
        padding: 6px 7px;
        border: 1px solid #f59e0b;
        border-radius: 5px;
        background: #fef3c7;
        color: #92400e;
        font-weight: 800;
      }
      #${PANEL_ID} .review-alert[hidden] {
        display: none;
      }
      #${PANEL_ID} textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 116px;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        color: #334155;
        font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    unregisterPanel(PANEL_ID);
  }

  // ─── Acceso a la página de Dentalink (fuera del sandbox) ───

  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  let stateCache = { raw: null, versions: [] };
  const measurementsCache = new Map();

  function stateVersions() {
    const raw = pageWindow.__STATE;
    if (typeof raw !== "string" || !raw) return [];
    if (stateCache.raw !== raw) {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_error) { parsed = null; }
      stateCache = { raw, versions: versionsFromState(parsed) };
    }
    return stateCache.versions;
  }

  function versionSelectorButton() {
    return [...document.querySelectorAll("button")]
      .find((button) => /Versi[oó]n del/i.test(button.innerText || button.textContent || "")) || null;
  }

  function versionSelectorLabels() {
    const button = versionSelectorButton();
    const container = button?.parentElement?.parentElement;
    if (!container) return [];
    return [...container.querySelectorAll("li")]
      .map((item) => (item.innerText || item.textContent || "").trim())
      .filter((text) => /Versi[oó]n del/i.test(text));
  }

  function currentVersions(now = new Date()) {
    return mergeVersions(stateVersions(), versionSelectorLabels(), now);
  }

  function displayedVersionDate() {
    const button = versionSelectorButton();
    return button ? parseVersionLabelDate(button.innerText || button.textContent || "") : null;
  }

  function periodontogramCollection() {
    return pageWindow.PGrama?.Instances?.pgrama?.dientesCollection || null;
  }

  function liveMeasurements() {
    const collection = periodontogramCollection();
    if (!collection) return [];
    try {
      return JSON.parse(JSON.stringify(collection.toJSON()));
    } catch (_error) {
      return [];
    }
  }

  async function fetchMeasurements(versionId) {
    const patientId = getPatientIdFromUrl();
    const key = `${patientId}/${versionId}`;
    if (measurementsCache.has(key)) return measurementsCache.get(key);
    const response = await fetch(`/periodontogramas/mediciones/${patientId}/${versionId}`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    measurementsCache.set(key, data);
    return data;
  }

  async function buildComparisonText(now = new Date()) {
    const versions = currentVersions(now);
    const displayedDate = displayedVersionDate();
    const baseline = baselineFor(versions, { displayedDate, now });
    if (!baseline) {
      return "PERIODONTOGRAMA INICIAL DEL CONTEO: NO HAY UNA VERSIÓN ANTERIOR CON LA CUAL COMPARAR.";
    }
    if (baseline.id == null) {
      return "NO SE PUDO IDENTIFICAR EL PERIODONTOGRAMA BASE. RECARGUE LA PÁGINA E INTENTE DE NUEVO.";
    }
    const latest = versions[versions.length - 1];
    const currentDate = displayedDate && latest && displayedDate < new Date(latest.date.getFullYear(), latest.date.getMonth(), latest.date.getDate())
      ? displayedDate
      : now;
    const baseMeasurements = await fetchMeasurements(baseline.id);
    const comparison = compareMeasurements(baseMeasurements, liveMeasurements());
    return formatComparison(comparison, { baseDate: baseline.date, currentDate });
  }

  function blankPeriodontogram() {
    const collection = periodontogramCollection();
    if (!collection?.models?.length) return false;
    const confirmed = window.confirm(
      "¿Poner en blanco todas las medidas del periodontograma?\n\n" +
      "Se conservan los dientes ausentes e implantes. Nada se guarda hasta que pulse «Guardar»; " +
      "la versión anterior seguirá disponible en el selector de versiones."
    );
    if (!confirmed) return false;
    collection.models.forEach((model) => {
      const blank = blankMeasurement(JSON.parse(JSON.stringify(model.toJSON())));
      const changes = {};
      MEASUREMENT_FIELDS.forEach((field) => { changes[field] = blank[field]; });
      model.set(changes);
    });
    collection.trigger("update:render");
    collection.trigger("update:save");
    return true;
  }

  function updateReviewAlert(panel) {
    const alert = panel?.querySelector(".review-alert");
    if (!alert) return;
    const text = formatReviewAlert(reviewStatus(currentVersions()));
    if (alert.textContent !== text) alert.textContent = text;
    alert.hidden = !text;
  }

  function flashButton(button, text, ok = true) {
    const originalText = button.dataset.label || button.textContent;
    button.dataset.label = originalText;
    button.textContent = text;
    button.classList.toggle("copied", ok);
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove("copied");
    }, 1800);
  }

  function ensurePanel() {
    if (!isTargetPage()) {
      removePanel();
      return;
    }

    if (!document.querySelector("tr.controller table.diente:not(.titles)")) {
      removePanel();
      return;
    }

    ensureStyles();
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) {
      registerPanel(existingPanel, {
        side: "left",
        vertical: "top",
        top: 154,
        order: 10,
        persistKey: POSITION_KEY,
        dragHandleSelector: "[data-drag-handle]"
      });
      updateReviewAlert(existingPanel);
      return;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="title" data-drag-handle>
        <span>Resumen periodontograma</span>
        <button type="button" class="minimize" data-action="minimize" title="Minimizar">−</button>
      </div>
      <div class="review-alert" hidden></div>
      <div class="body">
        <div class="actions">
          <button type="button" data-action="generate">Generar</button>
          <button type="button" class="secondary" data-action="copy">Copiar</button>
        </div>
        <div class="actions">
          <button type="button" class="compare" data-action="compare" title="Compara con el periodontograma que inició el conteo de 9 meses">Comparar</button>
          <button type="button" class="danger" data-action="blank" title="Pone en cero todas las medidas; no guarda">En blanco</button>
        </div>
        <textarea readonly placeholder="Click en Generar"></textarea>
      </div>
    `;
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("button[data-action]")?.dataset.action;
      const textarea = panel.querySelector("textarea");
      if (!action) return;

      event.preventDefault();
      if (action === "minimize") {
        const button = event.target.closest("button");
        panel.classList.toggle("is-minimized");
        button.textContent = panel.classList.contains("is-minimized") ? "+" : "−";
        button.title = panel.classList.contains("is-minimized") ? "Expandir" : "Minimizar";
        return;
      }

      if (action === "blank") {
        const button = event.target.closest("button");
        if (blankPeriodontogram()) flashButton(button, "En blanco ✓");
        return;
      }

      if (!textarea) return;

      if (action === "compare") {
        const button = event.target.closest("button");
        button.disabled = true;
        buildComparisonText()
          .then((text) => {
            textarea.value = text;
            return copyText(text).then(() => flashButton(button, "¡Copiado! ✓"));
          })
          .catch(() => {
            textarea.value = "NO SE PUDO LEER EL PERIODONTOGRAMA BASE. RECARGUE LA PÁGINA E INTENTE DE NUEVO.";
            flashButton(button, "Error", false);
          })
          .finally(() => { button.disabled = false; });
        return;
      }

      if (action === "generate") {
        const button = event.target.closest("button");
        const cleanSummary = buildSummary(false);
        textarea.value = buildSummary(true);
        saveSummary(cleanSummary);
        const drafts = prepareOrderDrafts(cleanSummary);
        const opened = saveAndOpenOrderDrafts(drafts);
        showGeneratedOrders(button, drafts.length, opened);
      }
      if (action === "copy") {
        const button = event.target.closest("button");
        if (!textarea.value) textarea.value = buildSummary(true);
        const cleanSummary = buildSummary(false);
        saveSummary(cleanSummary);
        copyText(cleanSummary).then(() => {
          const originalText = button.textContent;
          button.textContent = "¡Copiado! ✓";
          button.classList.add("copied");
          window.setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove("copied");
          }, 1500);
        });
      }
    });

    document.body.appendChild(panel);
    updateReviewAlert(panel);
    registerPanel(panel, {
      side: "left",
      vertical: "top",
      top: 154,
      order: 10,
      persistKey: POSITION_KEY,
      dragHandleSelector: "[data-drag-handle]"
    });
  }

  function enableDrag(panel) {
    const handle = panel.querySelector("[data-drag-handle]");
    if (!handle) return;

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;
      handle.setPointerCapture?.(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + event.clientX - startX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + event.clientY - startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      savePanelPosition(panel.offsetLeft, panel.offsetTop);
    };

    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }


  function schedulePanel() {
    if (schedulePanel.timer) return;
    schedulePanel.timer = window.setTimeout(() => {
      schedulePanel.timer = null;
      ensurePanel();
    }, 150);
  }

  function purgeExpiredRecords() {
    const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

    try {
      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const now = Date.now();
      let changed = false;

      for (const patientId of Object.keys(records)) {
        const savedAt = new Date(records[patientId]?.savedAt).getTime();
        if (!savedAt || now - savedAt > MAX_AGE_MS) {
          delete records[patientId];
          changed = true;
        }
      }

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      }
    } catch (_error) {
      /* silently ignore corrupt data */
    }
  }

  if (globalThis.__DLK_PERIO_RESUMEN_TEST__) {
    globalThis.__dlkPerioResumenTest = {
      addMonths,
      parseVersionLabelDate,
      versionsFromState,
      mergeVersions,
      cycleAnchors,
      reviewStatus,
      formatReviewAlert,
      baselineFor,
      summarizeMeasurements,
      compareMeasurements,
      formatComparison,
      blankMeasurement
    };
    return;
  }

  purgeExpiredRecords();
  watchPage(schedulePanel, {
    delay: 150,
    isStale: () => isTargetPage() &&
      document.querySelector("tr.controller table.diente:not(.titles)") &&
      !document.getElementById(PANEL_ID)
  });
})();
