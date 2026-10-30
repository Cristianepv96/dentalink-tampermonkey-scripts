// ==UserScript==
// @name         Dentalink - Antecedentes por defecto
// @namespace    https://odontofamily.local/dentalink-antecedentes
// @version      2.0.1
// @description  Anamnesis rápida: textos base, botón "Sin antecedentes", botones por enfermedad y medicamentos, y casillas de antecedentes odontológicos.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ─── Configuración (editable) ───────────────────────────────────────────
  // Textos que se ponen solos UNA vez al abrir la ficha, solo si el campo está vacío.
  // Si borras el texto a propósito, no se vuelve a poner.
  const AUTO_DEFAULTS = {
    "Motivo de consulta": "\"\"",
    "Enfermedad actual": "PACIENTE ACUDE A CITA DE VALORACION POR PERIODONCIA REFIRIENDO "
  };

  // Botón "Sin antecedentes": llena solo los campos vacíos.
  const SIN_ANTECEDENTES = {
    "Alertas médicas": "ASA I",
    "Enfermedades": "NIEGA",
    "Medicamentos": "NIEGA",
    "Hábitos": "NIEGA",
    "Antecedentes familiares": "NIEGA"
  };

  // Botones por enfermedad: agregan la enfermedad, ajustan alertas y
  // resaltan sus medicamentos habituales.
  const CONDICIONES = [
    { label: "HTA", enfermedad: "HIPERTENSION", meds: ["LOSARTAN", "AMLODIPINO", "HIDROCLOROTIAZIDA", "METOPROLOL"] },
    { label: "Dislipidemia", enfermedad: "DISLIPIDEMIA", meds: ["ATORVASTATINA", "ROSUVASTATINA"] },
    { label: "Diabetes", enfermedad: "DIABETES", meds: ["METFORMINA", "INSULINA"] },
    { label: "Hipotiroidismo", enfermedad: "HIPOTIROIDISMO", meds: ["LEVOTIROXINA"] }
  ];
  const ALERTA_CONTROLADA = "ASA II, CONTROLADA POR MEDICAMENTOS";

  const MEDICAMENTOS = [
    "LOSARTAN", "AMLODIPINO", "HIDROCLOROTIAZIDA", "METOPROLOL",
    "ATORVASTATINA", "ROSUVASTATINA", "METFORMINA", "INSULINA",
    "LEVOTIROXINA", "ASA", "PREGABALINA", "TAMSULOSINA"
  ];

  const ANTECEDENTES_ODONTO = [
    "ODONTOLOGIA GENERAL", "RESTAURACIONES", "REHABILITACION", "EXODONCIAS",
    "ORTODONCIA", "PERIODONCIA", "ENDODONCIA", "CIRUGIA"
  ];

  // Botones simples por sección (se agregan al texto).
  const CHIPS = {
    "Alertas médicas": ["ASA I", "ASA II", "CONTROLADA POR MEDICAMENTOS"],
    "Enfermedades": ["NIEGA"],
    "Medicamentos": ["NIEGA"],
    "Hábitos": ["NIEGA", "EXFUMADOR", "FUMADOR", "BRUXISMO"],
    "Antecedentes familiares": ["NIEGA"]
  };

  // Valores que significan "nada": se reemplazan al agregar algo.
  const VACIOS = /^(NIEGA|NO REFIERE|NO RELATA|NO|N\/A|NO APLICA)?\.?$/i;

  // ─── Utilidades ─────────────────────────────────────────────────────────
  const STYLE_ID = "dlk-anam-style";
  const TOOLBAR_ATTR = "data-dlk-anam-toolbar";
  const TITLES = [
    "Motivo de consulta", "Enfermedad actual", "Alertas médicas", "Enfermedades",
    "Medicamentos", "Hábitos", "Antecedentes odontológicos", "Antecedentes familiares"
  ];
  const appliedDefaults = new Set(); // "ruta|sección" ya inicializadas en esta visita
  const highlightedMeds = new Set();
  let lastUndo = null;

  const spaces = (t) => String(t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const key = (t) => spaces(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

  function setValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sectionTitle(textarea) {
    let node = textarea.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      for (const child of node.children) {
        const text = spaces(child.children[0]?.textContent);
        if (child.children.length && TITLES.includes(text)) return text;
      }
    }
    return "";
  }

  function getSections() {
    const map = {};
    document.querySelectorAll("textarea").forEach((textarea) => {
      if (textarea.offsetParent === null) return;
      const title = sectionTitle(textarea);
      if (title && !map[title]) map[title] = textarea;
    });
    return map;
  }

  function splitItems(text) {
    return spaces(text).split(/\s*,\s*/).filter(Boolean);
  }

  function hasItem(textarea, item) {
    return splitItems(textarea.value).some((part) => key(part) === key(item));
  }

  function addItem(textarea, item) {
    const current = spaces(textarea.value);
    if (hasItem(textarea, item)) return;
    setValue(textarea, VACIOS.test(current) ? item : `${current}, ${item}`);
  }

  function toggleItem(textarea, item) {
    if (hasItem(textarea, item)) {
      const rest = splitItems(textarea.value).filter((part) => key(part) !== key(item));
      setValue(textarea, rest.join(", "));
    } else {
      addItem(textarea, item);
    }
  }

  function flash(message) {
    let toast = document.getElementById("dlk-anam-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "dlk-anam-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("dlk-show");
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => toast.classList.remove("dlk-show"), 3500);
  }

  // ─── Acciones ───────────────────────────────────────────────────────────
  function applyAutoDefaults(sections) {
    for (const [title, value] of Object.entries(AUTO_DEFAULTS)) {
      const marker = `${location.pathname}|${title}`;
      const textarea = sections[title];
      if (!textarea || appliedDefaults.has(marker)) continue;
      appliedDefaults.add(marker);
      if (!spaces(textarea.value)) setValue(textarea, value);
    }
  }

  function sinAntecedentes() {
    const sections = getSections();
    const changes = [];
    for (const [title, value] of Object.entries(SIN_ANTECEDENTES)) {
      const textarea = sections[title];
      if (!textarea || spaces(textarea.value)) continue;
      setValue(textarea, value);
      changes.push({ title, value });
    }
    if (!changes.length) {
      flash("No había campos vacíos: no se cambió nada.");
      return;
    }
    lastUndo = changes;
    refreshToolbars();
    flash(`Completado: ${changes.map((c) => c.title).join(", ")}. Revisa y pulsa Guardar.`);
  }

  function undoSinAntecedentes() {
    if (!lastUndo) return;
    const sections = getSections();
    lastUndo.forEach(({ title, value }) => {
      const textarea = sections[title];
      // Solo deshace si nadie cambió ese campo después.
      if (textarea && spaces(textarea.value) === value) setValue(textarea, "");
    });
    lastUndo = null;
    refreshToolbars();
    flash("Deshecho.");
  }

  function applyCondition(condition) {
    const sections = getSections();
    const enf = sections["Enfermedades"];
    if (!enf) return;
    addItem(enf, condition.enfermedad);

    const alertas = sections["Alertas médicas"];
    // Reemplaza solo si alertas está vacío o contiene únicamente "ASA I", "NIEGA", "NO REFIERE"...
    const sinAlertasReales = splitItems(alertas?.value).every((item) => /^(ASA I|NIEGA|NO REFIERE|NO RELATA|NO)$/i.test(item));
    if (alertas && sinAlertasReales) {
      setValue(alertas, ALERTA_CONTROLADA);
    }
    condition.meds.forEach((med) => highlightedMeds.add(med));
    refreshToolbars();
  }

  // ─── Interfaz ───────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${TOOLBAR_ATTR}] { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0 6px; align-items:center; }
      [${TOOLBAR_ATTR}] .dlk-lbl { font-size:11px; color:#6c757d; margin-right:2px; }
      [${TOOLBAR_ATTR}] button, #dlk-anam-bar button {
        font:600 11px/1.2 inherit; padding:3px 8px; width:auto; height:auto; min-width:0; min-height:0; margin:0; flex:0 0 auto; display:inline-block; text-transform:none; border-radius:12px; cursor:pointer;
        border:1px solid #2a6fdb; background:#fff; color:#2a6fdb; }
      [${TOOLBAR_ATTR}] button:hover, #dlk-anam-bar button:hover { background:#eaf1fd; }
      [${TOOLBAR_ATTR}] button.dlk-on { background:#2a6fdb; color:#fff; }
      [${TOOLBAR_ATTR}] button.dlk-hint { border-color:#e08a00; color:#a86400; background:#fff6e5; }
      [${TOOLBAR_ATTR}] button.dlk-cond { border-style:dashed; }
      #dlk-anam-bar { clear:both; width:100%; box-sizing:border-box; padding:0 4px; display:flex; gap:6px; align-items:center; margin:6px 0 10px; }
      #dlk-anam-bar .dlk-main { background:#2a6fdb; color:#fff; padding:5px 12px; font-size:12px; }
      #dlk-anam-bar .dlk-main:hover { background:#1f5bbb; }
      #dlk-anam-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#1f2937; color:#fff; padding:8px 14px; border-radius:8px; font-size:13px;
        opacity:0; pointer-events:none; transition:opacity .2s; z-index:99999; }
      #dlk-anam-toast.dlk-show { opacity:1; }
    `;
    document.head.appendChild(style);
  }

  function chip(text, onClick, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener("mousedown", (event) => event.preventDefault()); // no robar el foco
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function buildToolbar(title, textarea) {
    const bar = document.createElement("div");
    bar.setAttribute(TOOLBAR_ATTR, title);

    if (title === "Antecedentes odontológicos") {
      ANTECEDENTES_ODONTO.forEach((item) => {
        bar.appendChild(chip(item, () => { toggleItem(textarea, item); refreshToolbars(); },
          hasItem(textarea, item) ? "dlk-on" : ""));
      });
      return bar;
    }

    if (title === "Enfermedades") {
      CONDICIONES.forEach((condition) => {
        bar.appendChild(chip(`+ ${condition.label}`, () => applyCondition(condition),
          `dlk-cond${hasItem(textarea, condition.enfermedad) ? " dlk-on" : ""}`));
      });
    }

    (CHIPS[title] || []).forEach((item) => {
      bar.appendChild(chip(item, () => { addItem(textarea, item); refreshToolbars(); },
        hasItem(textarea, item) ? "dlk-on" : ""));
    });

    if (title === "Medicamentos") {
      const ordered = [
        ...MEDICAMENTOS.filter((m) => highlightedMeds.has(m)),
        ...MEDICAMENTOS.filter((m) => !highlightedMeds.has(m))
      ];
      ordered.forEach((med) => {
        const cls = hasItem(textarea, med) ? "dlk-on" : highlightedMeds.has(med) ? "dlk-hint" : "";
        bar.appendChild(chip(med, () => { addItem(textarea, med); refreshToolbars(); }, cls));
      });
    }

    return bar.children.length ? bar : null;
  }

  function placeToolbar(title, textarea) {
    const anchor = textarea.parentElement;
    const existing = anchor.parentElement.querySelector(`:scope > [${TOOLBAR_ATTR}="${title}"]`);
    const bar = buildToolbar(title, textarea);
    if (existing) existing.remove();
    if (bar) anchor.insertAdjacentElement("afterend", bar);
  }

  function refreshToolbars() {
    const sections = getSections();
    Object.entries(sections).forEach(([title, textarea]) => placeToolbar(title, textarea));
  }

  function ensureTopBar(sections) {
    if (document.getElementById("dlk-anam-bar")) return;
    const first = sections["Motivo de consulta"] || Object.values(sections)[0];
    if (!first) return;
    // Sube hasta la tarjeta de la primera sección y pone la barra encima de la cuadrícula.
    let card = first;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement;
      if (spaces(card.textContent).startsWith("Motivo de consulta")) break;
    }
    const grid = card.parentElement?.parentElement || card.parentElement;
    if (!grid) return;
    const bar = document.createElement("div");
    bar.id = "dlk-anam-bar";
    bar.appendChild(chip("✓ Sin antecedentes (ASA I / NIEGA)", sinAntecedentes, "dlk-main"));
    bar.appendChild(chip("Deshacer", undoSinAntecedentes));
    grid.insertAdjacentElement("beforebegin", bar);
  }

  // Cursor entre las comillas del motivo al entrar al campo (sin robar el foco).
  document.addEventListener("focusin", (event) => {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.value !== "\"\"") return;
    if (sectionTitle(textarea) !== "Motivo de consulta") return;
    setTimeout(() => textarea.setSelectionRange(1, 1), 0);
  });

  // Mantener los botones al día cuando escribes a mano.
  document.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.isTrusted) return;
    clearTimeout(refreshToolbars.timer);
    refreshToolbars.timer = setTimeout(refreshToolbars, 400);
  });

  // ─── Ciclo ──────────────────────────────────────────────────────────────
  function sync() {
    if (!/\/pacientes\/\d+\/ficha\/antecedentes/.test(location.pathname)) return;
    const sections = getSections();
    if (!Object.keys(sections).length) return;
    injectStyle();
    applyAutoDefaults(sections);
    ensureTopBar(sections);
    Object.entries(sections).forEach(([title, textarea]) => {
      const host = textarea.parentElement.parentElement;
      if (!host.querySelector(`:scope > [${TOOLBAR_ATTR}="${title}"]`)) placeToolbar(title, textarea);
    });
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sync(); }, 300);
  }

  new MutationObserver((mutations) => {
    // Ignorar cambios hechos por este mismo script.
    const external = mutations.some((m) => ![...m.addedNodes, ...m.removedNodes].every((n) =>
      n.nodeType === 1 && (n.hasAttribute?.(TOOLBAR_ATTR) || n.id === "dlk-anam-bar" || n.id === "dlk-anam-toast")));
    if (external) schedule();
  }).observe(document.body, { childList: true, subtree: true });

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; appliedDefaults.clear(); highlightedMeds.clear(); lastUndo = null; schedule(); }
  }, 800);

  schedule();
})();
