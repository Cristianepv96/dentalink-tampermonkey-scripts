// ==UserScript==
// @name         Dentalink - Autollenado orden de servicio
// @namespace    https://odontofamily.local/dentalink-orden-servicio
// @version      1.5.0
// @description  Rellena automaticamente campos base de la orden de servicio en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Autollenado%20orden%20de%20servicio.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Autollenado%20orden%20de%20servicio.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js?v=1.2.2
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { normalizeSpaces, normalizeKey, setNativeValue, dispatchControlEvents, getPatientIdFromUrl, watchPage } = window.__dlkUtils;

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
  const ORDER_DRAFT_STORAGE_KEY = "dlk_periodontal_order_drafts_v1";
  const ORDER_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/formularios\/nuevo\/35\b/i;
  let appliedDraftToken = "";

  function today() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
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

  function setTextControl(control, value) {
    const nextValue = control instanceof HTMLInputElement
      ? String(value || "").replace(/\s*[\r\n]+\s*/g, " ")
      : value;
    if (!nextValue || control.value === nextValue) return false;
    setNativeValue(control, nextValue);
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

  function orderDraftToken() {
    return new URLSearchParams(location.search).get("dlk-order") || "";
  }

  function getOrderDraft() {
    const token = orderDraftToken();
    if (!token) return null;

    try {
      const records = JSON.parse(localStorage.getItem(ORDER_DRAFT_STORAGE_KEY) || "{}");
      const draft = records[token];
      const createdAt = new Date(draft?.createdAt).getTime();
      const patientId = getPatientIdFromUrl();
      if (!draft || draft.patientId !== patientId || !createdAt
        || Date.now() - createdAt > ORDER_DRAFT_MAX_AGE_MS) {
        if (draft) {
          delete records[token];
          localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(records));
        }
        return null;
      }
      return { token, draft };
    } catch (_error) {
      return null;
    }
  }

  function fillOrderDraft() {
    const record = getOrderDraft();
    if (!record || appliedDraftToken === record.token) return;

    const fields = [
      { label: /^CODIGO CUPS:?$/, value: record.draft.cups },
      { label: /^CANTIDAD:?$/, value: String(record.draft.quantity || "") },
      { label: /^INDICACIONES\/?ESPECIFICACIONES:?$/, value: record.draft.indications },
      { label: /^JUSTIFICACION CLINICA:?$/, value: record.draft.justification }
    ];
    let allControlsReady = true;

    fields.forEach((config) => {
      const field = findField(config.label);
      const control = field?.querySelector("input, textarea");
      if (!control) {
        allControlsReady = false;
        return;
      }
      setTextControl(control, config.value);
    });

    if (allControlsReady) appliedDraftToken = record.token;
  }

  function autofill() {
    if (!isTargetPage()) return;
    DEFAULTS.forEach(fillField);
    fillOrderDraft();
  }

  function scheduleAutofill() {
    if (scheduleAutofill.timer) return;
    scheduleAutofill.timer = window.setTimeout(() => {
      scheduleAutofill.timer = null;
      autofill();
    }, 250);
  }

  watchPage(scheduleAutofill, { delay: 250, interval: 0 });
})();
