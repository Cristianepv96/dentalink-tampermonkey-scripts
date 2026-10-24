// ==UserScript==
// @name         Dentalink - Botones receta rapida
// @namespace    https://odontofamily.local/dentalink-recetas
// @version      1.5.0
// @description  Agrega botones para insertar recetas predefinidas en Dentalink, sin duplicar medicamentos y con avisos según las alertas del paciente.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Botones%20receta%20rapida.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Botones%20receta%20rapida.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-medicamentos.js?v=1.0.0
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { isVisible, escapeHtml, watchPage } = window.__dlkUtils;
  const TEXTOS = window.__dlkMedicamentos?.textos || {};

  const PANEL_ID = "dlk-recetas-rapidas";
  const STYLE_ID = "dlk-recetas-rapidas-style";
  const UNDO_ID = "dlk-recetas-rapidas-undo";
  const NOTICE_ID = "dlk-recetas-rapidas-notice";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/recetas\b/i;
  const CONFIRM_MS = 6000;

  // Cada ítem: el texto viene de dentalink-medicamentos.js; `detect` reconoce si ya está en la receta.
  const ITEMS = {
    naproxeno: { name: "Naproxeno", detect: /NAPROXENO/ },
    amoxicilina: { name: "Amoxicilina", detect: /AMOXICILINA/ },
    azitromicina: { name: "Azitromicina", detect: /AZITROMICINA/ },
    interproximal: { name: "Cepillo interproximal", detect: /CEPILLO INTERPROXIMAL/ },
    perioaid: { name: "Perioaid", detect: /PERIOAID/ },
    indicacionesPostquirurgicas: { name: "Indicaciones postquirúrgicas", detect: /NO ESCUPIR/ }
  };

  const RECETAS = [
    { label: "Nap + Amox", items: ["amoxicilina", "naproxeno", "indicacionesPostquirurgicas"] },
    { label: "Naproxeno", items: ["naproxeno"] },
    { label: "Amox", items: ["amoxicilina"] },
    { label: "Azitromicina", items: ["azitromicina"] },
    { label: "Interproximal", items: ["interproximal"] },
    { label: "Perioaid", items: ["perioaid"] }
  ];

  // Avisos según las tarjetas del encabezado del paciente (Alertas médicas, Enfermedades, Medicamentos).
  // `fields`: en qué tarjetas buscar. `items`: a qué medicamentos aplica.
  const RULES = [
    {
      reason: "posible alergia a penicilinas",
      fields: ["Alertas médicas", "Enfermedades"],
      pattern: /PENICILIN|AMOXICILIN|AMPICILIN|BETALACTAM/,
      items: ["amoxicilina"]
    },
    {
      reason: "posible alergia a AINES",
      fields: ["Alertas médicas", "Enfermedades"],
      pattern: /\bAINES?\b|NAPROX|IBUPROF|DICLOFEN|ANTIINFLAMATORIO|ACETILSALICILICO|ASPIRINA/,
      items: ["naproxeno"]
    },
    {
      reason: "posible alergia a macrólidos",
      fields: ["Alertas médicas", "Enfermedades"],
      pattern: /AZITROMICIN|CLARITROMICIN|ERITROMICIN|MACROLID/,
      items: ["azitromicina"]
    },
    {
      reason: "anticoagulante o antiagregante: riesgo de sangrado con AINES",
      fields: ["Alertas médicas", "Enfermedades", "Medicamentos"],
      pattern: /WARFARIN|RIVAROXAB|APIXAB|DABIGATRAN|EDOXAB|ENOXAPARIN|HEPARIN|CLOPIDOGREL|ANTICOAGUL|ACETILSALICILICO|ASPIRINA/,
      items: ["naproxeno"]
    },
    {
      // "ASA" como medicamento (aspirina), no la clasificación ASA I / ASA II.
      reason: "toma ASA (aspirina): riesgo de sangrado con AINES",
      fields: ["Medicamentos"],
      pattern: /\bASA\b(?!\s*(I|II|III|IV|V)\b)/,
      items: ["naproxeno"]
    },
    {
      reason: "enfermedad renal: precaución con AINES",
      fields: ["Alertas médicas", "Enfermedades"],
      pattern: /RENAL|NEFROPAT/,
      items: ["naproxeno"]
    },
    {
      reason: "embarazo: precaución con AINES",
      fields: ["Alertas médicas", "Enfermedades"],
      pattern: /EMBARAZ|GESTANTE/,
      items: ["naproxeno"]
    }
  ];

  const armed = new Map(); // etiqueta de receta -> momento en que se pidió confirmación

  const normalize = (text) => String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  function isRecetasPage() {
    return TARGET_PATH.test(location.pathname);
  }

  function linesToHtml(lines) {
    return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }

  function getEditor() {
    return [...document.querySelectorAll('.trumbowyg-editor[contenteditable="true"], [contenteditable="true"]')]
      .find((el) => isVisible(el) && el.closest(".trumbowyg-box"));
  }

  function syncHiddenTextarea(editor, html) {
    const box = editor.closest(".trumbowyg-box");
    const textarea = box?.querySelector("textarea.trumbowyg-textarea");
    if (!textarea) return;

    textarea.value = html;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
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

  // ─── Encabezado del paciente ───

  function readHeaderField(label) {
    const labelEl = [...document.querySelectorAll("span, div, strong, h4, h5, p")]
      .find((el) => el.children.length === 0 && el.textContent.trim() === label);
    if (!labelEl) return "";
    const container = labelEl.parentElement;
    const text = container ? container.textContent : "";
    return normalize(text.replace(label, ""));
  }

  function warningsFor(recipe) {
    const header = {};
    const reasons = [];
    RULES.forEach((rule) => {
      if (!rule.items.some((item) => recipe.items.includes(item))) return;
      const matched = rule.fields.find((field) => {
        header[field] = header[field] ?? readHeaderField(field);
        return rule.pattern.test(header[field]);
      });
      if (matched) reasons.push(`${rule.reason} (${matched.toLowerCase()})`);
    });
    return [...new Set(reasons)];
  }

  // ─── Avisos en el panel ───

  function showNotice(message, tone = "info") {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    let notice = document.getElementById(NOTICE_ID);
    if (!notice) {
      notice = document.createElement("div");
      notice.id = NOTICE_ID;
      panel.appendChild(notice);
    }
    notice.dataset.tone = tone;
    notice.textContent = message;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => notice.remove(), tone === "warn" ? CONFIRM_MS : 4000);
  }

  // ─── Deshacer (sin cambios respecto a 1.4) ───

  function removeUndo() {
    document.getElementById(UNDO_ID)?.remove();
    window.clearTimeout(removeUndo.timer);
  }

  function showUndoButton(editor, previousHtml) {
    removeUndo();
    const button = document.createElement("button");
    button.id = UNDO_ID;
    button.type = "button";
    button.textContent = "↩ Deshacer inserción";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      editor.focus();
      editor.innerHTML = previousHtml;
      dispatchEditorEvents(editor, "");
      syncHiddenTextarea(editor, previousHtml);
      removeUndo();
    });

    document.getElementById(PANEL_ID)?.appendChild(button);
    removeUndo.timer = window.setTimeout(removeUndo, 10000);
  }

  // ─── Inserción ───

  function insertRecipe(recipe) {
    const editor = getEditor();
    if (!editor) {
      showNotice("No se encontró el editor de recetas de Dentalink.", "warn");
      return;
    }

    const currentText = normalize(editor.innerText || editor.textContent || "");
    const missingText = recipe.items.filter((item) => !TEXTOS[item]);
    if (missingText.length) {
      showNotice("No se cargaron los textos de medicamentos. Actualice los scripts en Tampermonkey.", "warn");
      return;
    }

    const skipped = recipe.items.filter((item) => ITEMS[item].detect.test(currentText));
    const toInsert = recipe.items.filter((item) => !skipped.includes(item));

    if (!toInsert.length) {
      showNotice(`Ya está en la receta: ${skipped.map((item) => ITEMS[item].name).join(", ")}. No se agregó nada.`);
      return;
    }

    const lines = toInsert.map((item) => TEXTOS[item]);
    const html = linesToHtml(lines);
    const previousHtml = editor.innerHTML;
    const nextHtml = currentText ? `${previousHtml}<p><br></p>${html}` : html;
    editor.focus();
    editor.innerHTML = nextHtml;
    dispatchEditorEvents(editor, lines.join("\n"));
    syncHiddenTextarea(editor, nextHtml);
    showUndoButton(editor, previousHtml);

    if (skipped.length) {
      showNotice(`No se repitió: ${skipped.map((item) => ITEMS[item].name).join(", ")} (ya estaba en la receta).`);
    }
  }

  function onRecipeClick(recipe) {
    const reasons = warningsFor(recipe);
    if (reasons.length) {
      const armedAt = armed.get(recipe.label) || 0;
      if (Date.now() - armedAt > CONFIRM_MS) {
        armed.set(recipe.label, Date.now());
        showNotice(`⚠ ${recipe.label}: ${reasons.join("; ")}. Pulse de nuevo para insertar igual.`, "warn");
        return;
      }
      armed.delete(recipe.label);
    }
    insertRecipe(recipe);
  }

  // ─── Panel ───

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin: 8px 0 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      #${PANEL_ID} .dlk-recetas-title {
        color: #1f7f83;
        font-size: 13px;
        font-weight: 700;
      }
      #${PANEL_ID} button {
        border: 1px solid #1f8f96;
        background: #ffffff;
        color: #16777d;
        border-radius: 6px;
        padding: 7px 10px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      #${PANEL_ID} button:hover {
        background: #e8f7f8;
      }
      #${PANEL_ID} button:active {
        transform: translateY(1px);
      }
      #${PANEL_ID} button.dlk-recetas-warn {
        border-color: #dc2626;
        color: #b91c1c;
        background: #fef2f2;
      }
      #${PANEL_ID} button.dlk-recetas-warn:hover {
        background: #fee2e2;
      }
      #${NOTICE_ID} {
        flex-basis: 100%;
        font-size: 12px;
        line-height: 1.35;
        padding: 6px 8px;
        border-radius: 6px;
        background: #f1f5f9;
        color: #334155;
      }
      #${NOTICE_ID}[data-tone="warn"] {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
      }
      #${UNDO_ID} {
        border-color: #f97316;
        background: #fff7ed;
        color: #c2410c;
        animation: dlk-recetas-undo-fade 10s ease-in forwards;
      }
      #${UNDO_ID}:hover {
        background: #fed7aa;
      }
      @keyframes dlk-recetas-undo-fade {
        0%, 70% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function findInsertAnchor() {
    const editor = getEditor();
    return editor?.closest(".trumbowyg-box") || document.querySelector(".trumbowyg-box");
  }

  function createButton(recipe) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.recipe = recipe.label;
    button.textContent = recipe.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRecipeClick(recipe);
    });
    return button;
  }

  // Marca en rojo los botones con avisos. El encabezado puede cargar después del panel.
  function refreshWarnings(panel) {
    panel.querySelectorAll("button[data-recipe]").forEach((button) => {
      const recipe = RECETAS.find((item) => item.label === button.dataset.recipe);
      const reasons = recipe ? warningsFor(recipe) : [];
      const warn = reasons.length > 0;
      if (button.classList.contains("dlk-recetas-warn") !== warn) {
        button.classList.toggle("dlk-recetas-warn", warn);
        button.textContent = warn ? `⚠ ${recipe.label}` : recipe.label;
      }
      button.title = warn ? `Atención: ${reasons.join("; ")}` : "";
    });
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function ensurePanel() {
    if (!isRecetasPage()) {
      removePanel();
      return;
    }

    const anchor = findInsertAnchor();
    if (!anchor) {
      removePanel();
      return;
    }

    ensureStyles();

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;

      const title = document.createElement("span");
      title.className = "dlk-recetas-title";
      title.textContent = "Recetas rápidas:";

      panel.appendChild(title);
      RECETAS.forEach((recipe) => panel.appendChild(createButton(recipe)));
    }

    refreshWarnings(panel);

    if (panel.nextElementSibling !== anchor) {
      anchor.parentElement?.insertBefore(panel, anchor);
    }
  }

  function schedulePanel() {
    if (schedulePanel.timer) return;
    schedulePanel.timer = window.setTimeout(() => {
      schedulePanel.timer = null;
      ensurePanel();
    }, 150);
  }

  watchPage(schedulePanel, {
    delay: 150,
    isStale: () => isRecetasPage() && findInsertAnchor() && !document.getElementById(PANEL_ID)
  });
})();
