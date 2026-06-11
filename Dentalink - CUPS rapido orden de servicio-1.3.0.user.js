// ==UserScript==
// @name         Dentalink - CUPS rapido orden de servicio
// @namespace    https://odontofamily.local/dentalink-cups-quick-pick
// @version      1.3.0
// @description  Muestra una lista discreta de códigos CUPS comunes e inserta el código en la orden de servicio.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "dlk-cups-quick-pick";
  const STYLE_ID = "dlk-cups-quick-pick-style";
  const PANEL_VERSION = "1.3.0";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/formularios\/nuevo\/35\b/i;
  const CUPS_GROUPS = [
    {
      title: "CUPS SAVIA SALUD",
      items: [
        ["890221", "CONSULTA PRIMERA VEZ PERIODONCIA"],
        ["890321", "CONTROL PERIODONCIA"],
        ["242201", "CURETAJE ABIERTO"],
        ["240301", "ALISADO RADICULAR"],
        ["240401", "DRENAJE PERIODONTAL"],
        ["248201", "AJUSTE OCLUSAL"],
        ["242301", "AUMENTO CORONA CLINICA"]
      ]
    },
    {
      title: "CUPS FOMAG",
      items: [
        ["890321", "CONSULTA DE CONTROL POR ESPECIALISTA EN PERIODONCIA"],
        ["890221", "CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN PERIODONCIA"],
        ["36100", "CONSULTA ESPECIALIZADA EN PERIODONCIA"],
        ["242201", "CURETAJE Y/O ALISADO RADICULAR CAMPO ABIERTO"],
        ["240201", "DETARTRAJE SUBGINGIVAL"],
        ["893109", "EXAMEN DE MUCOSA ORAL Y PERIODONTAL"]
      ]
    }
  ];

  function normalizeSpaces(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeKey(text) {
    return normalizeSpaces(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  }

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

  function setNativeValue(control, value) {
    const proto = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor?.set) {
      descriptor.set.call(control, value);
    } else {
      control.value = value;
    }
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
        position: fixed;
        left: 10px;
        top: 152px;
        z-index: 999998;
        width: 180px;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        font: 10px/1.15 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} .title {
        margin: 8px 0 4px;
        color: #64748b;
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
      }
      #${PANEL_ID} .title:first-child {
        margin-top: 0;
      }
      #${PANEL_ID} button {
        display: block;
        width: 180px;
        margin: 0 0 2px;
        padding: 2px 0;
        border: 0;
        background: transparent;
        color: #0369a1;
        cursor: pointer;
        text-align: left;
        font: 10px/1.15 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} button:hover {
        background: transparent;
        color: #0f172a;
        text-decoration: underline;
      }
      #${PANEL_ID} .code {
        color: inherit;
        font-weight: 800;
      }
      #${PANEL_ID} .label {
        display: inline-block;
        max-width: 120px;
        margin-left: 4px;
        overflow: hidden;
        color: #64748b;
        font-size: 9px;
        text-overflow: ellipsis;
        vertical-align: bottom;
        white-space: nowrap;
      }
      @media (max-width: 1100px) {
        #${PANEL_ID} {
          top: auto;
          bottom: 88px;
          width: 138px;
          opacity: 0.85;
        }
        #${PANEL_ID} button {
          width: 138px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if (!isTargetPage()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    if (!findCupsInput()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    ensureStyles();

    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel?.dataset.version === PANEL_VERSION) return;
    existingPanel?.remove();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.dataset.version = PANEL_VERSION;
    panel.innerHTML = `
      ${CUPS_GROUPS.map((group) => `
        <div class="title">${group.title}</div>
        ${group.items.map(([code, label]) => `
          <button type="button" data-code="${code}" title="${code} - ${label}">
            <span class="code">${code}</span>
            <span class="label">${label}</span>
          </button>
        `).join("")}
      `).join("")}
    `;
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-code]");
      if (!button) return;
      event.preventDefault();
      insertCode(button.dataset.code);
    });

    document.body.appendChild(panel);
  }

  function watchUrlChanges(callback) {
    const notify = () => window.setTimeout(callback, 100);
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    });
    window.addEventListener("popstate", notify);
  }

  function schedulePanel() {
    window.clearTimeout(schedulePanel.timer);
    schedulePanel.timer = window.setTimeout(ensurePanel, 150);
  }

  watchUrlChanges(schedulePanel);
  new MutationObserver(schedulePanel).observe(document.body, {
    childList: true,
    subtree: true
  });
  schedulePanel();
})();
