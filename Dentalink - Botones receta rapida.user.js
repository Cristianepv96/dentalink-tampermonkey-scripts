// ==UserScript==
// @name         Dentalink - Botones receta rapida
// @namespace    https://odontofamily.local/dentalink-recetas
// @version      1.4.1
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

  const { isVisible, escapeHtml, watchPage } = window.__dlkUtils;

  const PANEL_ID = "dlk-recetas-rapidas";
  const STYLE_ID = "dlk-recetas-rapidas-style";
  const UNDO_ID = "dlk-recetas-rapidas-undo";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/recetas\b/i;

  const RECETA_NAP_AMOX = [
    "Amoxicilina 500mg #21 Tomar 1 cápsula cada 8 horas por 7 días.",
    "Naproxeno 500mg #9 Tomar 1 tableta cada 8 horas por 3 días.",
    "No escupir, no bebidas con pitillos, no fumar, no agacharse, no ejercicio, no cosas calientes, no alcohol, limpiar la zona con mucho cuidado, retiro de sutura a los 8 días, sin cita."
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

  const RECETA_INTERPROXIMAL = [
    "Cepillo interproximal para utilizar entre los dientes, de diferentes tamaños"
  ];

  const RECETA_PERIOAID = [
    "Perioaid, usar hasta terminar el envase, no comprar sin receta de periodoncia, cambia sabor de comidas y cambia color de dientes, uso hasta terminar y no volver a comprar. Modo de uso: 1 hora después del cepillado."
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

  function setRecipe(lines) {
    const editor = getEditor();
    if (!editor) {
      alert("No se encontró el editor de recetas de Dentalink.");
      return;
    }

    const html = linesToHtml(lines);
    const previousHtml = editor.innerHTML;
    const hasContent = Boolean((editor.innerText || editor.textContent || "").trim());
    const nextHtml = hasContent ? `${previousHtml}<p><br></p>${html}` : html;
    editor.focus();
    editor.innerHTML = nextHtml;
    dispatchEditorEvents(editor, lines.join("\n"));
    syncHiddenTextarea(editor, nextHtml);
    showUndoButton(editor, previousHtml);
  }

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
      panel.appendChild(createButton("Interproximal", RECETA_INTERPROXIMAL));
      panel.appendChild(createButton("Perioaid", RECETA_PERIOAID));
    }

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
