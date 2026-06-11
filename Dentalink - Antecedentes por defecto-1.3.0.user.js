// ==UserScript==
// @name         Dentalink - Antecedentes por defecto
// @namespace    https://odontofamily.local/dentalink-antecedentes
// @version      1.3.0
// @description  Rellena por defecto textareas especificos de antecedentes cuando estan vacios.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*/ficha/antecedentes*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto-1.3.0.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto-1.3.0.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULTS = [
    {
      titleRe: /Motivo\s+de\s+consulta/i,
      value: "\"\"",
      marker: "dentalinkMotivoDefault"
    },
    {
      titleRe: /Enfermedad\s+actual/i,
      value: "PACIENTE ACUDE A CITA DE VALORACION POR PERIODONCIA REFIRIENDO",
      marker: "dentalinkEnfermedadActualDefault"
    },
    {
      titleRe: /Antecedentes\s+odontol[oó]gicos/i,
      value: "RESTAURACIONES, EXTRACCIONES",
      marker: "dentalinkAntecedentesOdontologicosDefault"
    }
  ];

  function normalizeSpaces(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function setNativeTextareaValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    textarea.focus();
    if (setter) setter.call(textarea, value);
    else textarea.value = value;

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function nearestSectionText(textarea) {
    let node = textarea.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const text = normalizeSpaces(node.innerText || node.textContent || "");
      if (/\bGenerales\b|\bA(?:ñ|n)adir\b|^Comentarios\b/i.test(text)) return text;
    }

    return "";
  }

  function findSectionTextarea(titleRe) {
    const textareas = [...document.querySelectorAll("textarea#otrasAlertas, textarea")];

    return textareas.find((textarea) => {
      if (!isVisible(textarea)) return false;
      return titleRe.test(nearestSectionText(textarea));
    });
  }

  function applyDefault() {
    let changed = false;

    for (const config of DEFAULTS) {
      const textarea = findSectionTextarea(config.titleRe);
      if (!textarea || normalizeSpaces(textarea.value)) continue;

      setNativeTextareaValue(textarea, config.value);
      textarea.dataset[config.marker] = "1";
      changed = true;
    }

    return changed;
  }

  let scheduled = false;

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      applyDefault();
    }, 250);
  }

  scheduleApply();

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
