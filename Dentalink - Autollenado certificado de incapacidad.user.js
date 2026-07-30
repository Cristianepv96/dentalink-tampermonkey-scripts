// ==UserScript==
// @name         Dentalink - Autollenado certificado de incapacidad
// @namespace    https://odontofamily.local/dentalink-incapacidad
// @version      1.0.1
// @description  Rellena automáticamente el certificado de incapacidad de periodoncia en Dentalink.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Autollenado%20certificado%20de%20incapacidad.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Autollenado%20certificado%20de%20incapacidad.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js?v=1.2.1
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const {
    normalizeKey,
    setNativeValue,
    dispatchControlEvents,
    watchPage
  } = window.__dlkUtils;

  const SCRIPT_VERSION = "1.0.1";
  const TARGET_PATH = /\/pacientes\/\d+\/ficha\/formularios\/nuevo\/29\b/i;
  const PROFESSIONAL_MATCH = /CRISTIAN EDUARDO PENA VILLAMIZAR RM 1093788088.*PERIODONCIA/;
  const RECOMMENDATIONS = [
    "No escupir",
    "no bebidas con pitillos",
    "no fumar",
    "no agacharse",
    "no ejercicio",
    "no cosas calientes",
    "no alcohol",
    "limpiar la zona con mucho cuidado",
    "retiro de sutura a los 8 días",
    "sin cita."
  ].join(", ");

  function isTargetPage() {
    return TARGET_PATH.test(location.pathname);
  }

  function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  }

  function formatDate(date, control = null) {
    const pad = (value) => String(value).padStart(2, "0");
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    return control instanceof HTMLInputElement && control.type === "date"
      ? `${year}-${month}-${day}`
      : `${day}/${month}/${year}`;
  }

  function fieldLabel(field) {
    const label = field.querySelector("h3, label, strong, span");
    return normalizeKey(label?.innerText || label?.textContent || "");
  }

  function findField(labelMatcher) {
    return [...document.querySelectorAll(".field-space.field, .field-space, .field")]
      .find((field) => labelMatcher.test(fieldLabel(field)));
  }

  function markControl(control) {
    control.dataset.dlkIncapacityAutofill = SCRIPT_VERSION;
  }

  function wasFilled(control) {
    return control?.dataset.dlkIncapacityAutofill === SCRIPT_VERSION;
  }

  function setTextControl(control, value) {
    if (!control || wasFilled(control)) return Boolean(control);
    if (control.value !== value) {
      setNativeValue(control, value);
      dispatchControlEvents(control);
    }
    markControl(control);
    return true;
  }

  function setCheckbox(control, checked) {
    if (!control || wasFilled(control)) return Boolean(control);
    if (control.checked !== checked) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked"
      )?.set;
      if (setter) setter.call(control, checked);
      else control.checked = checked;
      dispatchControlEvents(control);
    }
    markControl(control);
    return true;
  }

  function setSelect(control, wantedText) {
    if (!control || wasFilled(control)) return Boolean(control);
    const wantedKey = normalizeKey(wantedText);
    const option = [...control.options].find((item) => {
      const textKey = normalizeKey(item.textContent || "");
      return textKey === wantedKey
        || textKey.includes(wantedKey)
        || normalizeKey(item.value) === wantedKey;
    });
    if (!option) return false;

    if (control.value !== option.value) {
      control.value = option.value;
      dispatchControlEvents(control);
    }
    markControl(control);
    return true;
  }

  function findControl(labelMatcher, selector) {
    return findField(labelMatcher)?.querySelector(selector) || null;
  }

  function findCheckboxBeforeText(textMatcher) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    let textNode;

    while ((textNode = walker.nextNode())) {
      if (!textMatcher.test(normalizeKey(textNode.textContent || ""))) continue;

      const owner = textNode.parentElement;
      const localCheckbox = owner?.matches("label")
        ? owner.querySelector('input[type="checkbox"]')
        : owner?.previousElementSibling?.matches('input[type="checkbox"]')
          ? owner.previousElementSibling
          : null;
      if (localCheckbox) return localCheckbox;

      const preceding = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter((checkbox) =>
          Boolean(checkbox.compareDocumentPosition(textNode) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      return preceding.at(-1) || null;
    }

    return null;
  }

  function autofill(now = new Date()) {
    if (!isTargetPage()) return 0;

    const today = new Date(now);
    const tomorrow = addDays(today, 1);
    let completed = 0;

    const entity = findControl(/^NOMBRE DE ENTIDAD$/, "textarea, input");
    const place = findControl(/^LUGAR$/, "textarea, input");
    const issueDate = findControl(/^FECHA DE EXPEDICION DE CERTIFICADO$/, "textarea, input");
    const transcription = findControl(/^TIPO DE GENERACION$/, 'input[type="checkbox"]');
    const diagnosis = findControl(/^DIAGNOSTICO \(CIE10\)$/, "input, textarea");
    const initialDate = findControl(/^FECHA INICIAL$/, "input, textarea");
    const finalDate = findControl(/^FECHA FINAL$/, "input, textarea");
    const disabilityDays = findControl(/^DIAS DE INCAPACIDAD$/, "input, textarea");
    const disabilityOrigin = findControl(/^ORIGEN DE LA INCAPACIDAD$/, 'input[type="checkbox"]');
    const concept = findControl(/^CONCEPTO DE LA INCAPACIDAD$/, "select");
    const recommendations = findControl(/^RECOMENDACIONES$/, "input, textarea");
    const professionalInformation = findControl(/^INFORMACION DEL PROFESIONAL$/, "input, textarea");
    const professional = findCheckboxBeforeText(PROFESSIONAL_MATCH);

    completed += Number(setTextControl(entity, "IPS SAN JOSE"));
    completed += Number(setTextControl(place, "Medellín"));
    completed += Number(setTextControl(issueDate, formatDate(today, issueDate)));
    completed += Number(setCheckbox(transcription, true));
    completed += Number(setTextControl(diagnosis, "K053"));
    completed += Number(setTextControl(initialDate, formatDate(today, initialDate)));
    completed += Number(setTextControl(finalDate, formatDate(tomorrow, finalDate)));
    completed += Number(setTextControl(disabilityDays, "2"));
    completed += Number(setCheckbox(disabilityOrigin, true));
    completed += Number(setSelect(concept, "Común"));
    completed += Number(setTextControl(recommendations, RECOMMENDATIONS));
    completed += Number(setTextControl(professionalInformation, ""));
    completed += Number(setCheckbox(professional, true));

    return completed;
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
