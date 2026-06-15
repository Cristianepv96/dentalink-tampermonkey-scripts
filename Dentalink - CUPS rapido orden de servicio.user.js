// ==UserScript==
// @name         Dentalink - CUPS rapido orden de servicio
// @namespace    https://odontofamily.local/dentalink-cups-quick-pick
// @version      1.6.1
// @description  Muestra una lista discreta de códigos CUPS comunes e inserta el código en la orden de servicio.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20CUPS%20rapido%20orden%20de%20servicio.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20CUPS%20rapido%20orden%20de%20servicio.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { normalizeKey, setNativeValue, watchPage, registerPanel, unregisterPanel } = window.__dlkUtils;

  const PANEL_ID = "dlk-cups-quick-pick";
  const STYLE_ID = "dlk-cups-quick-pick-style";
  const PANEL_VERSION = "1.6.0";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/formularios\/nuevo\/35\b/i;

  const CUPS_GROUPS = [
    {
      title: "PERIODONCIA",
      color: "#0f766e",
      bg: "#f0fdfa",
      items: [
        ["890221", "Consulta primera vez perio"],
        ["890321", "Consulta control perio"],
        ["242201", "Campo abierto"],
        ["240301", "Campo cerrado"],
        ["240401", "Drenaje"],
        ["240201", "Detartraje sub."],
        ["248201", "Ajuste oclusal"],
        ["242301", "Alargamiento de corona"],
        ["274101", "Frenillectomía"]
      ]
    },
    {
      title: "INTERCONSULTAS",
      color: "#b45309",
      bg: "#fffbeb",
      items: [
        ["890219", "Consulta estoma-ciru"],
        ["890236", "Consulta maxilo"],
        ["890218", "Consulta endo"],
        ["890224", "Consulta rehabi"]
      ]
    }
  ];

  function findCupsInput() {
    const fields = [...document.querySelectorAll(".field-space.field, .field-space, .field")];
    const field = fields.find((item) => {
      const label = item.querySelector("h3, label, strong, span");
      return normalizeKey(label?.innerText || label?.textContent || "") === "CODIGO CUPS";
    });

    return field?.querySelector("input, textarea") || null;
  }

  function isTargetPage() {
    return TARGET_PATH.test(location.pathname);
  }

  function insertCode(code) {
    const input = findCupsInput();
    if (!input) return;

    setNativeValue(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  }

  function ensureStyles() {
    document.getElementById(STYLE_ID)?.remove();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        width: 210px;
        padding: 8px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.10);
        font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} .group {
        margin: 0 0 6px;
        padding: 5px 6px 4px;
        border-radius: 5px;
      }
      #${PANEL_ID} .group:last-child {
        margin-bottom: 0;
      }
      #${PANEL_ID} .title {
        margin: 0 0 4px;
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      #${PANEL_ID} button {
        display: block;
        width: 100%;
        margin: 0 0 2px;
        padding: 4px 5px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        text-align: left;
        font: 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1e293b;
        transition: background 0.15s;
      }
      #${PANEL_ID} button:hover {
        background: rgba(15, 23, 42, 0.08);
      }
      #${PANEL_ID} .code {
        font-weight: 800;
      }
      #${PANEL_ID} .label {
        display: inline-block;
        max-width: 130px;
        margin-left: 4px;
        overflow: hidden;
        color: #334155;
        font-size: 10.5px;
        text-overflow: ellipsis;
        vertical-align: bottom;
        white-space: nowrap;
      }
      @media (max-width: 1100px) {
        #${PANEL_ID} {
          width: 180px;
          opacity: 0.92;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if (!isTargetPage()) {
      document.getElementById(PANEL_ID)?.remove();
      unregisterPanel(PANEL_ID);
      return;
    }

    if (!findCupsInput()) {
      document.getElementById(PANEL_ID)?.remove();
      unregisterPanel(PANEL_ID);
      return;
    }

    ensureStyles();

    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel?.dataset.version === PANEL_VERSION) {
      registerPanel(existingPanel, { side: "left", vertical: "top", top: 152, order: 20 });
      return;
    }
    existingPanel?.remove();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.dataset.version = PANEL_VERSION;

    CUPS_GROUPS.forEach((group) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "group";
      groupDiv.style.background = group.bg;

      const titleEl = document.createElement("div");
      titleEl.className = "title";
      titleEl.style.color = group.color;
      titleEl.textContent = group.title;
      groupDiv.appendChild(titleEl);

      group.items.forEach(([code, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.code = code;
        btn.title = `${code} - ${label}`;

        const codeSpan = document.createElement("span");
        codeSpan.className = "code";
        codeSpan.style.color = group.color;
        codeSpan.textContent = code;

        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        labelSpan.textContent = label;

        btn.appendChild(codeSpan);
        btn.appendChild(labelSpan);
        groupDiv.appendChild(btn);
      });

      panel.appendChild(groupDiv);
    });

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-code]");
      if (!button) return;
      event.preventDefault();
      insertCode(button.dataset.code);
    });

    document.body.appendChild(panel);
    registerPanel(panel, { side: "left", vertical: "top", top: 152, order: 20 });
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
    isStale: () => isTargetPage() && findCupsInput() && !document.getElementById(PANEL_ID)
  });
})();
