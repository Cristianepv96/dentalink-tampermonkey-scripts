// ==UserScript==
// @name         Dentalink - Utils (base compartida)
// @namespace    https://odontofamily.local/dentalink-utils
// @version      1.1.1
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

  // ─── Shared SPA/DOM watcher ───

  utils.debounce = function (callback, delay) {
    let timer = null;
    return function () {
      if (timer) return;
      timer = window.setTimeout(function () {
        timer = null;
        callback();
      }, delay || 150);
    };
  };

  /**
   * Standard watcher for Dentalink SPA pages.
   * It handles URL changes, DOM mutations, and a light watchdog for pages that
   * replace content without a history event.
   */
  utils.watchPage = function (callback, options = {}) {
    const delay = options.delay ?? 150;
    const intervalMs = options.interval ?? 1500;
    let lastHref = "";
    const run = utils.debounce(function () {
      lastHref = location.href;
      callback();
    }, delay);

    utils.onUrlChange(run, delay);
    run();

    if (options.initialDelay !== false) {
      window.setTimeout(run, options.initialDelay ?? 1000);
    }

    if (options.observe !== false) {
      const target = options.observeTarget || document.body || document.documentElement;
      if (target) {
        new MutationObserver(run).observe(target, {
          childList: true,
          subtree: true
        });
      }
    }

    if (intervalMs > 0) {
      window.setInterval(function () {
        if (lastHref !== location.href || options.always) run();
      }, intervalMs);
    }

    return run;
  };

  // ─── Shared floating-panel positioning ───

  const panelRegistry = new Map();

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* ignore storage errors */ }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function applyPanelPosition(panel, options) {
    const margin = options.margin ?? 8;
    const side = options.side || "right";
    const vertical = options.vertical || "top";
    const zIndex = options.zIndex ?? (999980 + (options.order || 0));

    panel.style.position = "fixed";
    panel.style.zIndex = String(zIndex);

    const persisted = options.persistKey ? readJson(options.persistKey) : null;
    if (persisted && Number.isFinite(persisted.left) && Number.isFinite(persisted.top)) {
      panel.style.left = `${clamp(persisted.left, margin, window.innerWidth - panel.offsetWidth - margin)}px`;
      panel.style.top = `${clamp(persisted.top, margin, window.innerHeight - panel.offsetHeight - margin)}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      return;
    }

    panel.style.left = side === "left" ? `${margin}px` : "auto";
    panel.style.right = side === "right" ? `${margin}px` : "auto";
    panel.style.top = vertical === "top" ? `${options.top ?? 150}px` : "auto";
    panel.style.bottom = vertical === "bottom" ? `${options.bottom ?? margin}px` : "auto";
  }

  function panelOptionsFromDataset(panel) {
    return {
      side: panel.dataset.dlkPanelSide || "right",
      vertical: panel.dataset.dlkPanelVertical || "top",
      top: Number(panel.dataset.dlkPanelTop || 150),
      bottom: Number(panel.dataset.dlkPanelBottom || 8),
      order: Number(panel.dataset.dlkPanelOrder || 0),
      gap: Number(panel.dataset.dlkPanelGap || 8),
      margin: Number(panel.dataset.dlkPanelMargin || 8),
      zIndex: Number(panel.dataset.dlkPanelZIndex || 0) || null,
      persistKey: panel.dataset.dlkPanelPersistKey || ""
    };
  }

  function autoStackPanels() {
    const groups = new Map();
    panelRegistry.forEach((options, id) => {
      const panel = document.getElementById(id);
      if (!panel || !utils.isVisible(panel) || options.persistKey && readJson(options.persistKey)) return;
      const key = `${options.side || "right"}:${options.vertical || "top"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ panel, options });
    });

    document.querySelectorAll("[data-dlk-panel='1']").forEach((panel) => {
      const options = panelOptionsFromDataset(panel);
      if (!panel.id || !utils.isVisible(panel) || options.persistKey && readJson(options.persistKey)) return;
      const key = `${options.side}:${options.vertical}`;
      if (!groups.has(key)) groups.set(key, []);
      if (!groups.get(key).some((item) => item.panel === panel)) {
        groups.get(key).push({ panel, options });
      }
    });

    groups.forEach((items) => {
      items.sort((a, b) => (a.options.order || 0) - (b.options.order || 0));
      let offset = null;
      items.forEach(({ panel, options }, index) => {
        const margin = options.margin ?? 8;
        const side = options.side || "right";
        const vertical = options.vertical || "top";
        if (offset === null) offset = vertical === "top" ? (options.top ?? 150) : (options.bottom ?? margin);

        panel.style.left = side === "left" ? `${margin}px` : "auto";
        panel.style.right = side === "right" ? `${margin}px` : "auto";
        panel.style.top = vertical === "top" ? `${offset}px` : "auto";
        panel.style.bottom = vertical === "bottom" ? `${offset}px` : "auto";
        panel.style.zIndex = String(options.zIndex || (999980 + (options.order || index)));
        offset += panel.offsetHeight + (options.gap ?? 8);
      });
    });
  }

  function enablePanelDrag(panel, options) {
    const selector = options.dragHandleSelector;
    if (!selector || panel.dataset.dlkDragEnabled === "1") return;
    const handle = panel.querySelector(selector);
    if (!handle) return;

    panel.dataset.dlkDragEnabled = "1";
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button, input, textarea, select, a")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;
      handle.setPointerCapture?.(event.pointerId);
    });

    handle.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      const margin = options.margin ?? 8;
      const left = clamp(startLeft + event.clientX - startX, margin, window.innerWidth - panel.offsetWidth - margin);
      const top = clamp(startTop + event.clientY - startY, margin, window.innerHeight - panel.offsetHeight - margin);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });

    const stopDrag = function () {
      if (!dragging) return;
      dragging = false;
      if (options.persistKey) writeJson(options.persistKey, { left: panel.offsetLeft, top: panel.offsetTop });
    };

    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }

  /**
   * Register a floating panel so Dentalink modules share predictable positions.
   */
  utils.registerPanel = function (panel, options = {}) {
    if (!panel?.id) return panel;
    panelRegistry.set(panel.id, options);
    panel.dataset.dlkPanel = "1";
    panel.dataset.dlkPanelSide = options.side || "right";
    panel.dataset.dlkPanelVertical = options.vertical || "top";
    panel.dataset.dlkPanelTop = String(options.top ?? 150);
    panel.dataset.dlkPanelBottom = String(options.bottom ?? 8);
    panel.dataset.dlkPanelOrder = String(options.order ?? 0);
    panel.dataset.dlkPanelGap = String(options.gap ?? 8);
    panel.dataset.dlkPanelMargin = String(options.margin ?? 8);
    if (options.zIndex) panel.dataset.dlkPanelZIndex = String(options.zIndex);
    if (options.persistKey) panel.dataset.dlkPanelPersistKey = options.persistKey;
    applyPanelPosition(panel, options);
    enablePanelDrag(panel, options);
    window.setTimeout(autoStackPanels, 0);
    return panel;
  };

  utils.unregisterPanel = function (id) {
    panelRegistry.delete(id);
    window.setTimeout(autoStackPanels, 0);
  };

  window.__dlkUtils = utils;
})();
