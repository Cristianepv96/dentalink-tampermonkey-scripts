// ==UserScript==
// @name         Dentalink - Utils (base compartida)
// @namespace    https://odontofamily.local/dentalink-utils
// @version      1.0.0
// @description  Utilidades compartidas para los scripts de Dentalink. No activar manualmente.
// @author       Cris
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// ==/UserScript==

// Este archivo se carga via @require en cada script de Tampermonkey.
// Solo se inicializa una vez por página gracias al guard window.__dlkUtils.

(function () {
  "use strict";

  if (window.__dlkUtils) return;

  const utils = {};

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

  // ─── Centralized URL change watching ───
  // Monkey-patches history.pushState/replaceState only once across all scripts.
  // Each script listens for the custom "dlk:urlchange" event instead.

  const notifyUrlChange = function () {
    window.dispatchEvent(new CustomEvent("dlk:urlchange"));
  };

  ["pushState", "replaceState"].forEach(function (method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.setTimeout(notifyUrlChange, 0);
      return result;
    };
  });
  window.addEventListener("popstate", notifyUrlChange);

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

  window.__dlkUtils = utils;
})();
