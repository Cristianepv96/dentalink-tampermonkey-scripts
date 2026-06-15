// ==UserScript==
// @name         Dentalink - Registro diario a Google Sheets
// @namespace    https://odontofamily.local/dentalink-registro-diario-sheets
// @version      1.1.2
// @description  Copia una fila del plan de tratamiento de Dentalink para pegarla en el registro diario de Google Sheets.
// @author       Cris
// @match        https://*.dentalink.cl/pacientes/*
// @match        https://docs.google.com/spreadsheets/d/*
// @updateURL    https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Registro%20diario%20a%20Google%20Sheets.user.js
// @downloadURL  https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Registro%20diario%20a%20Google%20Sheets.user.js
// @require      https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const { normalizeSpaces, getPatientIdFromUrl, watchPage, registerPanel, unregisterPanel } = window.__dlkUtils;

  const PANEL_ID = "dlk-registro-sheets-panel";
  const STYLE_ID = "dlk-registro-sheets-style";
  const STORAGE_KEY = "dlk_registro_sheets_payload_v1";
  const TARGET_DENTALINK = /\/pacientes\/\d+\/tratamiento\/\d+\b/i;
  const TARGET_SHEETS = /^https:\/\/docs\.google\.com\/spreadsheets\/d\//i;
  const PLAN_TITLE_RE = /^\d{2}[/-]\d{2}[/-]\d{4}\s+\S.+/;
  const MONTHS = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };

  function isDentalinkPlan() {
    return TARGET_DENTALINK.test(location.pathname);
  }

  function isSheet() {
    return TARGET_SHEETS.test(location.href);
  }

  function lines() {
    return (document.body?.innerText || "")
      .split(/\n+/)
      .map((line) => normalizeSpaces(line))
      .filter(Boolean);
  }

  function planIdFromUrl() {
    return location.pathname.match(/\/tratamiento\/(\d+)\b/i)?.[1] || "";
  }

  function toTitleSede(value) {
    const text = normalizeSpaces(value);
    if (!text) return "";
    if (/^magisterio[-\s]*belen$/i.test(text)) return "Magisterio-Belen";
    if (/eps\s+savia\s+salud[-\s]*belen/i.test(text)) return "Eps Savia Salud- Belen";
    return text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  function parsePlanDate(title) {
    const match = normalizeSpaces(title).match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
    if (!match) return null;
    return {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3]),
      sheet: `${match[1]}/${match[2]}/${match[3]}`,
      iso: `${match[3]}-${match[2]}-${match[1]}`
    };
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function parseSpanishDateTime(value) {
    const match = normalizeSpaces(value).match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})\s+(\d{1,2}):(\d{2})\b/i);
    if (!match) return null;
    const month = MONTHS[match[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
    if (!month) return null;
    return {
      day: Number(match[1]),
      month,
      year: Number(match[3]),
      hour: `${pad2(match[4])}:${match[5]}`,
      sheet: `${pad2(match[1])}/${pad2(month)}/${match[3]}`,
      iso: `${match[3]}-${pad2(month)}-${pad2(match[1])}`
    };
  }

  function sameDate(left, right) {
    return Boolean(left && right && left.day === right.day && left.month === right.month && left.year === right.year);
  }

  function findPatientName(allLines, patientId) {
    const idIndex = allLines.findIndex((line) => line === `ID #${patientId}`);
    if (idIndex >= 0) {
      const candidate = allLines[idIndex + 1] || "";
      if (candidate && !/^\d/.test(candidate)) return candidate.toUpperCase();
    }

    const headerCandidate = allLines.find((line) => /^[A-ZÁÉÍÓÚÑ ]{8,}$/.test(line) && !/DENTALINK|NOVEDADES|MAGISTERIO|CRISTIAN/.test(line));
    return headerCandidate || "";
  }

  function findPlanTitle(allLines) {
    const heading = [...document.querySelectorAll("h1, h2, h3, .title, [class*='title'], [class*='nombre']")]
      .map((element) => normalizeSpaces(element.innerText || element.textContent || ""))
      .find((text) => PLAN_TITLE_RE.test(text));
    if (heading) return heading.replace(/\s*[\uF000-\uF8FF]\s*$/g, "").trim();

    return allLines.find((line) => PLAN_TITLE_RE.test(line)) || "";
  }

  function findSede(allLines) {
    const topSede = allLines.find((line) => /magisterio[-\s]*belen|eps\s+savia\s+salud[-\s]*belen/i.test(line));
    if (topSede) return toTitleSede(topSede);
    const sucursalIndex = allLines.findIndex((line) => /^Sucursal$/i.test(line));
    return toTitleSede(allLines[sucursalIndex + 1] || "");
  }

  function findCurrencyAfter(allLines, label) {
    const index = allLines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    if (index >= 0) {
      for (let i = index + 1; i < Math.min(allLines.length, index + 6); i += 1) {
        const match = allLines[i].match(/\$[\d.]+/);
        if (match) return match[0];
      }
    }
    return "";
  }

  function collectAppointments(allLines) {
    const start = allLines.findIndex((line) => /^Citas del paciente$/i.test(line));
    if (start < 0) return [];

    const appointments = [];
    for (let i = start + 1; i < allLines.length; i += 1) {
      const idMatch = allLines[i].match(/^Cita\s+#(\d+)/i);
      if (!idMatch) {
        if (/^Actualizar los detalles RIPS$/i.test(allLines[i])) break;
        continue;
      }

      const dateTime = parseSpanishDateTime(allLines[i + 1] || "");
      const doctor = allLines[i + 2] || "";
      const sede = allLines[i + 3] || "";
      const status = allLines[i + 4] || "";
      appointments.push({
        id: idMatch[1],
        dateTime,
        doctor,
        sede: toTitleSede(sede),
        status
      });
    }

    return appointments;
  }

  function pickAppointment(appointments, planDate) {
    const sameDay = appointments.filter((appointment) => sameDate(appointment.dateTime, planDate));
    return sameDay.find((appointment) => /atendido/i.test(appointment.status)) ||
      sameDay[0] ||
      appointments.find((appointment) => /atendido/i.test(appointment.status)) ||
      appointments[0] ||
      null;
  }

  function buildNote(payload) {
    const parts = [`Extraido de Dentalink plan ${payload.planId}`];
    if (payload.appointmentId) parts.push(`cita ${payload.appointmentId}`);
    if (payload.patientId) parts.push(`paciente ${payload.patientId}`);
    parts.push(`copiado ${new Date().toLocaleString("es-CO")}`);
    return parts.join("; ");
  }

  function extractPayload() {
    const allLines = lines();
    const patientId = getPatientIdFromUrl();
    const planId = planIdFromUrl();
    const title = findPlanTitle(allLines);
    const planDate = parsePlanDate(title);
    const appointments = collectAppointments(allLines);
    const appointment = pickAppointment(appointments, planDate);
    const date = appointment?.dateTime?.sheet || planDate?.sheet || "";
    const sede = appointment?.sede || findSede(allLines);
    const value = findCurrencyAfter(allLines, "Presupuesto total") || findCurrencyAfter(allLines, "Realizado");

    const payload = {
      fecha: date,
      sede,
      hora: appointment?.dateTime?.hour || "",
      paciente: findPatientName(allLines, patientId),
      planId,
      tituloPlan: title,
      estadoCita: appointment?.status || "",
      valor: value,
      nota: "",
      patientId,
      appointmentId: appointment?.id || "",
      sourceUrl: location.href,
      copiedAt: new Date().toISOString()
    };

    payload.nota = buildNote(payload);
    return payload;
  }

  function payloadToRow(payload) {
    return [
      payload.fecha,
      payload.sede,
      payload.hora,
      payload.paciente,
      payload.planId,
      payload.tituloPlan,
      payload.estadoCita,
      payload.valor,
      payload.nota,
      "",
      "",
      ""
    ].map((value) => String(value || "").replace(/\t/g, " ").replace(/\n/g, " ")).join("\t");
  }

  function savePayload(payload) {
    GM_setValue(STORAGE_KEY, payload);
  }

  function getPayload() {
    try {
      return GM_getValue(STORAGE_KEY, null);
    } catch (_) {
      return null;
    }
  }

  function copyPayload(payload) {
    const row = payloadToRow(payload);
    GM_setClipboard(row, "text");
    return row;
  }

  function currentSheetCell() {
    return document.querySelector("#t-name-box input")?.value ||
      document.querySelector("[aria-label*='Cuadro con nombre' i] input")?.value ||
      document.title.match(/^([A-Z]+\d+(?::[A-Z]+\d+)?)/)?.[1] ||
      "";
  }

  function visibleSheetHasPlan(planId) {
    return Boolean(planId && (document.body?.innerText || "").includes(String(planId)));
  }

  function setStatus(panel, text, tone = "") {
    const status = panel.querySelector(".dlk-registro-status");
    if (!status) return;
    status.textContent = text;
    status.className = `dlk-registro-status ${tone}`.trim();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        width: 118px;
        background: #ffffff;
        color: #172033;
        border: 1px solid #d7dee8;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
        border-radius: 7px;
        padding: 5px;
        font: 9px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0.82;
        transition: opacity 120ms ease, box-shadow 120ms ease;
      }
      #${PANEL_ID}:hover,
      #${PANEL_ID}:focus-within {
        opacity: 1;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16);
      }
      #${PANEL_ID} .dlk-registro-title {
        font-weight: 800;
        margin-bottom: 3px;
        display: flex;
        justify-content: space-between;
        gap: 4px;
      }
      #${PANEL_ID} .dlk-registro-summary {
        color: #475569;
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .dlk-registro-status {
        color: #64748b;
        min-height: 20px;
        margin-top: 4px;
      }
      #${PANEL_ID} .dlk-registro-status.ok { color: #15803d; }
      #${PANEL_ID} .dlk-registro-status.warn { color: #b45309; }
      #${PANEL_ID} .dlk-registro-status.err { color: #b91c1c; }
      #${PANEL_ID} button {
        width: 100%;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 5px;
        padding: 3px 4px;
        font-weight: 700;
        cursor: pointer;
        font-size: 9px;
      }
      #${PANEL_ID} button:hover { background: #dbeafe; }
      #${PANEL_ID} button.secondary {
        margin-top: 3px;
        border-color: #e2e8f0;
        background: #f8fafc;
        color: #334155;
      }
      #${PANEL_ID} code {
        font-size: 10px;
        color: #0f172a;
      }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    unregisterPanel(PANEL_ID);
  }

  function button(label, action, className = "") {
    const control = document.createElement("button");
    control.type = "button";
    control.dataset.action = action;
    control.textContent = label;
    if (className) control.className = className;
    return control;
  }

  function renderPanelShell(panel, className, title, badge, summary) {
    panel.className = className;
    panel.replaceChildren();

    const titleEl = document.createElement("div");
    titleEl.className = "dlk-registro-title";
    const titleText = document.createElement("span");
    titleText.textContent = title;
    const badgeText = document.createElement("span");
    badgeText.textContent = badge;
    titleEl.append(titleText, badgeText);

    const summaryEl = document.createElement("div");
    summaryEl.className = "dlk-registro-summary";
    summaryEl.textContent = summary;

    panel.append(titleEl, summaryEl);
    return { summaryEl };
  }

  function renderDentalinkPanel() {
    if (!isDentalinkPlan()) {
      removePanel();
      return;
    }

    ensureStyle();
    let payload = extractPayload();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "on-dentalink";
      document.body.appendChild(panel);
    }
    registerPanel(panel, { side: "right", vertical: "top", top: 168, order: 30 });

    const { summaryEl } = renderPanelShell(
      panel,
      "on-dentalink",
      "Hoja",
      `#${payload.planId || "-"}`,
      `${payload.fecha || "-"} · ${payload.hora || "--:--"}`
    );
    const copyButton = button("Copiar", "copy");
    const refreshButton = button("Refrescar", "refresh", "secondary");
    const statusEl = document.createElement("div");
    statusEl.className = "dlk-registro-status";
    statusEl.textContent = payload.tituloPlan || "Listo.";
    panel.append(copyButton, refreshButton, statusEl);

    panel.onclick = (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      payload = extractPayload();
      if (action === "refresh") {
        setStatus(panel, `Actualizado: ${payload.fecha || "-"} ${payload.hora || ""}`, "ok");
        summaryEl.textContent = `${payload.fecha || "-"} · ${payload.hora || "--:--"}`;
        return;
      }
      savePayload(payload);
      copyPayload(payload);
      setStatus(panel, "Copiado. Pega en Sheets.", "ok");
    };
  }

  function renderSheetsPanel() {
    if (!isSheet()) {
      removePanel();
      return;
    }

    ensureStyle();
    const payload = getPayload();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "on-sheets";
      document.body.appendChild(panel);
    }
    registerPanel(panel, { side: "right", vertical: "bottom", bottom: 68, order: 70 });

    const duplicate = payload?.planId && visibleSheetHasPlan(payload.planId);
    renderPanelShell(
      panel,
      "on-sheets",
      "Hoja",
      currentSheetCell() || "",
      payload ? `${payload.fecha || "-"} · #${payload.planId || "-"}` : "Sin fila copiada"
    );
    const copyButton = button("Copiar", "copy");
    copyButton.disabled = !payload;
    const statusEl = document.createElement("div");
    statusEl.className = `dlk-registro-status ${duplicate ? "warn" : ""}`.trim();
    statusEl.textContent = duplicate ? "ID visible; revisa duplicado." : "Pulsa Cmd+V.";
    panel.append(copyButton, statusEl);

    panel.onclick = (event) => {
      const action = event.target?.dataset?.action;
      if (action !== "copy") return;
      const latest = getPayload();
      if (!latest) {
        setStatus(panel, "No hay datos de Dentalink guardados.", "err");
        return;
      }
      copyPayload(latest);
      const cell = currentSheetCell();
      const warning = visibleSheetHasPlan(latest.planId) ? " ID plan visible; revisa duplicado." : "";
      setStatus(panel, `Portapapeles listo${cell ? ` (${cell})` : ""}.${warning}`, warning ? "warn" : "ok");
    };
  }

  function render() {
    if (isDentalinkPlan()) {
      renderDentalinkPanel();
    } else if (isSheet()) {
      renderSheetsPanel();
    } else {
      removePanel();
    }
  }

  function scheduleRender() {
    window.setTimeout(render, 500);
  }

  scheduleRender();
  watchPage(scheduleRender, { delay: 150, always: true });
})();
