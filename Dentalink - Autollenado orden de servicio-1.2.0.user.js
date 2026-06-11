// ==UserScript==
// @name         Dentalink - Autollenado orden de servicio
// @namespace    https://odontofamily.local/dentalink-orden-servicio
// @version      1.2.0
// @description  Rellena automaticamente campos base de la orden de servicio en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULTS = [
    { label: /^FECHA DE LA ORDEN:?$/, control: "input", value: today },
    { label: /^NRO\.?\s*DE ORDEN:?$/, control: "input", value: getPatientDocument },
    { label: /^ORIGEN DE LA ATENCION:?$/, control: "select", value: "ENFERMEDAD GENERAL" },
    { label: /^PRIORIDAD DE LA ATENCION:?$/, control: "select", value: "Prioritaria" },
    { label: /^TIPO DE SERVICIO SOLICITADO:?$/, control: "select", value: "Remitido" },
    { label: /^UBICACION DEL PACIENTE:?$/, control: "select", value: "CONSULTA EXTERNA" },
    { label: /^CODIGO:?$/, control: "input", value: "K053" },
    { label: /^TIPO DE DIAGNOSTICO:?$/, control: "select", value: "Confirmado" }
  ];
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/formularios\/nuevo\/35\b/i;

  function normalizeSpaces(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeKey(text) {
    return normalizeSpaces(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  }

  function today() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function getPatientIdFromUrl() {
    return location.pathname.match(/\/pacientes\/(\d+)\b/i)?.[1] || "";
  }

  function isTargetPage() {
    return TARGET_PATH.test(location.pathname);
  }

  function getPatientDocument() {
    const patientId = getPatientIdFromUrl();
    const text = normalizeSpaces(document.body.innerText || document.body.textContent || "");
    const afterPatientId = patientId
      ? text.match(new RegExp(`\\bID\\s*${patientId}\\s+(\\d{6,12})\\b`, "i"))
      : null;

    return afterPatientId?.[1] || text.match(/\bID\s*\d+\s+(\d{6,12})\b/i)?.[1] || "";
  }

  function fieldLabel(field) {
    const label = field.querySelector("h3, label, strong, span");
    return normalizeKey((label?.innerText || label?.textContent || "").replace(/\s*[\u270e✎].*$/, ""));
  }

  function findField(labelMatcher) {
    return [...document.querySelectorAll(".field-space.field, .field-space, .field")]
      .find((field) => labelMatcher.test(fieldLabel(field)));
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

  function dispatchControlEvents(control) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setTextControl(control, value) {
    if (!value || control.value === value) return false;
    setNativeValue(control, value);
    dispatchControlEvents(control);
    return true;
  }

  function setSelectControl(select, wantedText) {
    const wantedKey = normalizeKey(wantedText);
    const option = [...select.options].find((item) =>
      normalizeKey(item.textContent) === wantedKey ||
      normalizeKey(item.value) === wantedKey
    );

    if (!option || select.value === option.value) return false;
    select.value = option.value;
    dispatchControlEvents(select);
    return true;
  }

  function fillField(config) {
    const field = findField(config.label);
    const control = field?.querySelector(config.control);
    if (!control) return false;

    const value = typeof config.value === "function" ? config.value() : config.value;
    if (control instanceof HTMLSelectElement) return setSelectControl(control, value);
    return setTextControl(control, value);
  }

  function autofill() {
    if (!isTargetPage()) return;
    DEFAULTS.forEach(fillField);
  }

  function scheduleAutofill() {
    window.clearTimeout(scheduleAutofill.timer);
    scheduleAutofill.timer = window.setTimeout(autofill, 250);
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

  watchUrlChanges(scheduleAutofill);
  scheduleAutofill();
  window.setTimeout(autofill, 1000);

  new MutationObserver(scheduleAutofill).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
