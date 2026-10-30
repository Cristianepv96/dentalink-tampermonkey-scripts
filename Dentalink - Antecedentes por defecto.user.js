// ==UserScript==
// @name         Dentalink - Antecedentes por defecto
// @namespace    https://odontofamily.local/dentalink-antecedentes
// @version      2.1.0
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

  // Nombres con que aparecen en la lista de Dentalink (además del propio texto).
  const LISTA_ALIAS = {
    "HIPERTENSION": ["HIPERTENSION ARTERIAL"],
    "DIABETES": ["DIABETES MELLITUS"],
    "EXODONCIAS": ["EXODONCIA"],
    "RESTAURACIONES": ["RESTAURACION"],
    "EXFUMADOR": ["EXFUMADORA"],
    "FUMADOR": ["FUMADORA"]
  };

  // Secciones cuyos botones marcan primero la lista de Dentalink.
  const SECCIONES_CON_LISTA = ["Enfermedades", "Medicamentos", "Hábitos", "Antecedentes odontológicos"];

  // Valores que significan "nada": se reemplazan al agregar algo.
  const VACIOS = /^(NIEGA|NO REFIERE|NO RELATA|NO|N\/A|NO APLICA)?\.?$/i;
  const SIN_DATO_REAL = /^(ASA I|NIEGA|NO REFIERE|NO RELATA|NO|NO ALERGIA)$/;

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
  // Para comparar con la lista de Dentalink, que mezcla may\u00fasculas, tildes y puntos.
  const norm = (t) => key(t).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const aliases = (item) => [item, ...(LISTA_ALIAS[item] || [])].map(norm);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // La tarjeta de la sección: el primer ancestro con un encabezado conocido.
  function findCard(textarea) {
    let node = textarea.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      for (const child of node.children) {
        const text = spaces(child.children[0]?.textContent);
        if (child.children.length && TITLES.includes(text)) return { card: node, title: text };
      }
    }
    return { card: null, title: "" };
  }

  const sectionTitle = (textarea) => findCard(textarea).title;
  const sectionCard = (textarea) => findCard(textarea).card;

  // Botón "Añadir …" de la tarjeta y el desplegable que abre.
  function listParts(card) {
    const button = [...(card?.querySelectorAll("button") || [])].find((b) => /^Añadir\b/.test(spaces(b.textContent)));
    return { button, panel: button?.parentElement?.nextElementSibling || null };
  }

  // Elementos ya elegidos en la lista de Dentalink (los que tienen una ×).
  function listItems(card) {
    if (!card) return [];
    const { panel } = listParts(card);
    return [...card.querySelectorAll("i.fa-close")]
      .filter((icon) => !panel?.contains(icon) && icon.previousElementSibling?.tagName === "SPAN")
      .map((icon) => spaces(icon.previousElementSibling.textContent))
      .filter(Boolean);
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

  function inList(textarea, item) {
    const wanted = aliases(item);
    return listItems(sectionCard(textarea)).some((part) => wanted.includes(norm(part)));
  }

  // Presente en el texto «Otros…» o en la lista de Dentalink.
  const present = (textarea, item) => hasItem(textarea, item) || inList(textarea, item);

  // Sin nada útil: texto vacío (o solo las comillas del motivo) y lista vacía.
  function isMissing(textarea) {
    const text = spaces(textarea.value);
    return (!text || text === "\"\"") && !listItems(sectionCard(textarea)).length;
  }

  function addItem(textarea, item) {
    const current = spaces(textarea.value);
    if (present(textarea, item)) return;
    setValue(textarea, VACIOS.test(current) ? item : `${current}, ${item}`);
  }

  function removeFromText(textarea, item) {
    const rest = splitItems(textarea.value).filter((part) => key(part) !== key(item));
    setValue(textarea, rest.join(", "));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Busca el elemento en el desplegable de Dentalink, marca su casilla y pulsa Aceptar.
  // Solo toca casillas y Aceptar: nunca "Nuevo …" ni la papelera, que cambian el catálogo.
  async function pickFromList(card, item) {
    const { button, panel } = listParts(card);
    if (!button || !panel) return false;
    if (panel.offsetParent === null) {
      button.click();
      await sleep(300);
    }
    const search = panel.querySelector("input:not([type=checkbox])");
    if (search) setInputValue(search, norm(item).slice(0, 6).toLowerCase());

    const wanted = aliases(item);
    let box = null;
    for (let waited = 0; waited < 3000 && !box; waited += 150) {
      await sleep(150);
      box = [...panel.querySelectorAll("input[type=checkbox]")]
        .find((input) => wanted.includes(norm(input.parentElement?.textContent)));
    }
    const accept = [...panel.querySelectorAll("footer *")].find((el) => spaces(el.textContent) === "Aceptar");
    if (!box || !accept) {
      if (search) setInputValue(search, "");
      document.body.click(); // cierra el desplegable sin cambiar nada
      return false;
    }
    if (!box.checked) box.click();
    await sleep(150);
    accept.click();
    await sleep(300);
    if (search) setInputValue(search, "");
    return true;
  }

  function removeFromList(card, item) {
    const { panel } = listParts(card);
    const wanted = aliases(item);
    const icon = [...card.querySelectorAll("i.fa-close")].find((el) => !panel?.contains(el) &&
      el.previousElementSibling?.tagName === "SPAN" && wanted.includes(norm(el.previousElementSibling.textContent)));
    icon?.click();
    return Boolean(icon);
  }

  // Las acciones que abren desplegables van de una en una.
  let queue = Promise.resolve();
  function enqueue(task) {
    queue = queue.then(task).catch((error) => console.warn("[Anamnesis rápida]", error));
    return queue;
  }

  // Agrega a la lista de Dentalink si existe ahí; si no, al texto «Otros…».
  async function addToSection(title, item) {
    const textarea = getSections()[title];
    if (!textarea || present(textarea, item)) return;
    if (SECCIONES_CON_LISTA.includes(title) && !VACIOS.test(item) && await pickFromList(sectionCard(textarea), item)) {
      // Un "NIEGA" escrito antes ya no es cierto.
      if (spaces(textarea.value) && VACIOS.test(spaces(textarea.value))) setValue(textarea, "");
      return;
    }
    addItem(textarea, item);
    if (SECCIONES_CON_LISTA.includes(title) && !VACIOS.test(item)) {
      flash(`«${item}» no está en la lista de Dentalink: se escribió en Otros.`);
    }
  }

  async function toggleInSection(title, item) {
    const textarea = getSections()[title];
    if (!textarea) return;
    if (inList(textarea, item)) removeFromList(sectionCard(textarea), item);
    else if (hasItem(textarea, item)) removeFromText(textarea, item);
    else await addToSection(title, item);
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
      // Si ya hay algo elegido en la lista de Dentalink, el texto base sobra.
      if (!spaces(textarea.value) && !listItems(sectionCard(textarea)).length) setValue(textarea, value);
    }
  }

  function sinAntecedentes() {
    const sections = getSections();
    const changes = [];
    const skipped = [];
    for (const [title, value] of Object.entries(SIN_ANTECEDENTES)) {
      const textarea = sections[title];
      if (!textarea || spaces(textarea.value)) continue;
      // No escribir NIEGA donde la lista de Dentalink ya tiene datos.
      if (listItems(sectionCard(textarea)).length) {
        skipped.push(title);
        continue;
      }
      setValue(textarea, value);
      changes.push({ title, value });
    }
    const note = skipped.length ? ` Se respetó lo elegido en: ${skipped.join(", ")}.` : "";
    if (!changes.length) {
      flash(`No había campos vacíos: no se cambió nada.${note}`);
      return;
    }
    lastUndo = changes;
    refreshToolbars();
    flash(`Completado: ${changes.map((c) => c.title).join(", ")}.${note} Revisa y pulsa Guardar.`);
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

  async function applyCondition(condition) {
    if (!getSections()["Enfermedades"]) return;
    await addToSection("Enfermedades", condition.enfermedad);

    const alertas = getSections()["Alertas médicas"];
    // Reemplaza solo si alertas (texto y lista) está vacío o contiene únicamente "ASA I", "NIEGA", "NO ALERGIA"...
    const sinAlertasReales = alertas && [...splitItems(alertas.value), ...listItems(sectionCard(alertas))]
      .every((item) => SIN_DATO_REAL.test(norm(item)));
    if (sinAlertasReales) {
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
      #dlk-anam-faltan { margin-left:8px; font-size:12px; font-weight:600; }
      #dlk-anam-faltan.dlk-faltan { color:#a86400; }
      #dlk-anam-faltan.dlk-completo { color:#1e7e34; }
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
        bar.appendChild(chip(item, () => enqueue(async () => { await toggleInSection(title, item); refreshToolbars(); }),
          present(textarea, item) ? "dlk-on" : ""));
      });
      return bar;
    }

    if (title === "Enfermedades") {
      CONDICIONES.forEach((condition) => {
        bar.appendChild(chip(`+ ${condition.label}`, () => enqueue(() => applyCondition(condition)),
          `dlk-cond${present(textarea, condition.enfermedad) ? " dlk-on" : ""}`));
      });
    }

    (CHIPS[title] || []).forEach((item) => {
      bar.appendChild(chip(item, () => enqueue(async () => { await addToSection(title, item); refreshToolbars(); }),
        present(textarea, item) ? "dlk-on" : ""));
    });

    if (title === "Medicamentos") {
      const ordered = [
        ...MEDICAMENTOS.filter((m) => highlightedMeds.has(m)),
        ...MEDICAMENTOS.filter((m) => !highlightedMeds.has(m))
      ];
      ordered.forEach((med) => {
        const cls = present(textarea, med) ? "dlk-on" : highlightedMeds.has(med) ? "dlk-hint" : "";
        bar.appendChild(chip(med, () => enqueue(async () => { await addToSection(title, med); refreshToolbars(); }), cls));
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
    updateSummary(sections);
  }

  // Secciones sin texto ni elementos de la lista, en el orden de la ficha.
  const missingSections = (sections) => TITLES.filter((title) => sections[title] && isMissing(sections[title]));

  function updateSummary(sections) {
    const summary = document.getElementById("dlk-anam-faltan");
    if (!summary) return;
    const missing = missingSections(sections);
    const text = missing.length ? `Faltan: ${missing.join(", ")}` : "✓ Todas las secciones tienen datos";
    // Solo si cambia: así el observador no entra en bucle.
    if (summary.textContent !== text) summary.textContent = text;
    summary.className = missing.length ? "dlk-faltan" : "dlk-completo";
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
    const summary = document.createElement("span");
    summary.id = "dlk-anam-faltan";
    bar.appendChild(summary);
    grid.insertAdjacentElement("beforebegin", bar);
    updateSummary(sections);
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
    // Si cambió lo elegido en las listas de Dentalink, actualizar botones y resumen.
    const signature = JSON.stringify(Object.entries(sections).map(([title, textarea]) =>
      [title, textarea.value, listItems(sectionCard(textarea))]));
    if (signature !== lastSignature) {
      lastSignature = signature;
      refreshToolbars();
    }
  }
  let lastSignature = "";

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

  if (globalThis.__DLK_ANAM_TEST__) {
    globalThis.__dlkAnamTest = { addToSection, applyAutoDefaults, getSections, missingSections, norm, present, sinAntecedentes };
  }

  schedule();
})();
