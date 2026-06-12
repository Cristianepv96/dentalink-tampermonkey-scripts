// ==UserScript==
// @name         Dentalink - Botones receta rapida
// @namespace    https://odontofamily.local/dentalink-recetas
// @version      1.2.1
// @description  Agrega botones para insertar recetas predefinidas en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Botones%20receta%20rapida.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Botones%20receta%20rapida.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { isVisible, escapeHtml, onUrlChange } = window.__dlkUtils;

  const PANEL_ID = "dlk-recetas-rapidas";
  const STYLE_ID = "dlk-recetas-rapidas-style";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/recetas\b/i;

  const RECETA_NAP_AMOX = [
    "Amoxicilina 500mg #21 Tomar 1 cápsula cada 8 horas por 7 días.",
    "Naproxeno 500mg #9 Tomar 1 tableta cada 8 horas por 3 días."
  ];

  const RECETA_NAPROXENO = [
    "Naproxeno 500mg #9 Tomar 1 tableta cada 8 horas por 3 días."
  ];

  const RECETA_AMOX = [
    "Amoxicilina 500mg #21 Tomar 1 cápsula cada 8 horas por 7 días."
  ];

  const RECETA_AZITROMICINA = [
    "Azitromicina 500mg #3 Tomar 1 tableta cada 24 horas por 3 días."
  ];

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

  function setRecipe(lines) {
    const editor = getEditor();
    if (!editor) {
      alert("No se encontró el editor de recetas de Dentalink.");
      return;
    }

    const html = linesToHtml(lines);
    editor.focus();
    editor.innerHTML = html;
    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: lines.join("\n")
      }));
    } catch (_error) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    syncHiddenTextarea(editor, html);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        display: flex;
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
    `;
    document.head.appendChild(style);
  }

  function findInsertAnchor() {
    const editor = getEditor();
    return editor?.closest(".trumbowyg-box") || document.querySelector(".trumbowyg-box");
  }

  function createButton(label, lines) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setRecipe(lines);
    });
    return button;
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
      panel.appendChild(createButton("Nap + Amox", RECETA_NAP_AMOX));
      panel.appendChild(createButton("Naproxeno", RECETA_NAPROXENO));
      panel.appendChild(createButton("Amox", RECETA_AMOX));
      panel.appendChild(createButton("Azitromicina", RECETA_AZITROMICINA));
    }

    if (panel.nextElementSibling !== anchor) {
      anchor.parentElement?.insertBefore(panel, anchor);
    }
  }

  function schedulePanel() {
    window.clearTimeout(schedulePanel.timer);
    schedulePanel.timer = window.setTimeout(ensurePanel, 150);
  }

  onUrlChange(schedulePanel);
  schedulePanel();

  const observer = new MutationObserver(schedulePanel);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
