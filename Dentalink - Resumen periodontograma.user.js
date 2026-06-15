// ==UserScript==
// @name         Dentalink - Resumen periodontograma
// @namespace    https://odontofamily.local/dentalink-periodontograma-resumen
// @version      1.6.2
// @description  Genera resumen de bolsas periodontales, sangrado, movilidad y furca desde el periodontograma.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Resumen%20periodontograma.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Resumen%20periodontograma.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { getPatientIdFromUrl, onUrlChange } = window.__dlkUtils;

  const PANEL_ID = "dlk-perio-resumen";
  const STYLE_ID = "dlk-perio-resumen-style";
  const STORAGE_KEY = "dlk_periodontograma_resumen_v1";
  const POSITION_KEY = "dlk_periodontograma_resumen_position_v1";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/periodontograma\b/i;

  function isTargetPage() {
    return TARGET_PATH.test(location.pathname);
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
    const mobility = records.filter((record) => record.movilidad > 0);
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
      requestLines.push(`- Raspaje y alisado radicular a campo cerrado en ${formatToothList(closedField)}${closedCount}.`);
    }

    if (openField.length) {
      requestLines.push(`- Raspaje y alisado radicular a campo abierto en ${formatToothList(openField)}${openCount}.`);
    }

    exudate.forEach((record) => {
      requestLines.push(`- Drenaje periodontal en ${record.tooth} con el fin de eliminar exudado periodontal, evitar la pérdida ósea activa que se está produciendo en ese momento y mejorar el pronóstico periodontal.`);
    });

    if (mobility.length) {
      requestLines.push(`- Ajuste oclusal en ${formatToothList(mobility)} para eliminar contactos prematuros que impiden reducir el riesgo de aumento de la movilidad por trauma oclusal secundario.`);
    }

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
        position: fixed;
        left: 10px;
        top: 154px;
        z-index: 999998;
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
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    const position = getPanelPosition();
    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    }
    panel.innerHTML = `
      <div class="title" data-drag-handle>
        <span>Resumen periodontograma</span>
        <button type="button" class="minimize" data-action="minimize" title="Minimizar">−</button>
      </div>
      <div class="body">
        <div class="actions">
          <button type="button" data-action="generate">Generar</button>
          <button type="button" class="secondary" data-action="copy">Copiar</button>
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

      if (!textarea) return;

      if (action === "generate") {
        textarea.value = buildSummary(true);
        saveSummary(buildSummary(false));
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
    enableDrag(panel);

    document.body.appendChild(panel);
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
        const savedAt = Date.parse(records[patientId]?.savedAt);
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

  purgeExpiredRecords();
  onUrlChange(schedulePanel);
  new MutationObserver(schedulePanel).observe(document.body, {
    childList: true,
    subtree: true
  });
  schedulePanel();
})();
