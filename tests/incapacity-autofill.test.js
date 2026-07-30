const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadScript() {
  class HTMLInputElement {
    constructor(type = "text") {
      this.type = type;
    }
  }

  const context = {
    window: {
      __dlkUtils: {
        normalizeKey(value) {
          return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
        },
        setNativeValue() {},
        dispatchControlEvents() {},
        watchPage() {}
      },
      setTimeout() { return 1; }
    },
    location: {
      pathname: "/pacientes/123/ficha/formularios/nuevo/29"
    },
    document: {
      body: {},
      querySelectorAll() { return []; },
      createTreeWalker() {
        return { nextNode() { return null; } };
      }
    },
    HTMLInputElement,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    NodeFilter: { SHOW_TEXT: 4 }
  };

  vm.createContext(context);
  let source = fs.readFileSync(
    path.join(__dirname, "..", "Dentalink - Autollenado certificado de incapacidad.user.js"),
    "utf8"
  );
  source = source.replace(
    /\n\}\)\(\);\s*$/,
    [
      "",
      "  globalThis.__incapacityTest = {",
      "    addDays,",
      "    formatDate,",
      "    isTargetPage,",
      "    RECOMMENDATIONS,",
      "    PROFESSIONAL_MATCH",
      "  };",
      "})();"
    ].join("\n")
  );
  vm.runInContext(source, context);
  return { helpers: context.__incapacityTest, HTMLInputElement, context };
}

test("calcula hoy y el día siguiente sin errores al cambiar de mes", () => {
  const { helpers } = loadScript();
  const initial = new Date(2026, 6, 31, 12, 0, 0);
  const final = helpers.addDays(initial, 1);

  assert.equal(helpers.formatDate(initial), "31/07/2026");
  assert.equal(helpers.formatDate(final), "01/08/2026");
});

test("usa el formato ISO para controles date", () => {
  const { helpers, HTMLInputElement } = loadScript();
  const dateInput = new HTMLInputElement("date");

  assert.equal(helpers.formatDate(new Date(2026, 11, 5), dateInput), "2026-12-05");
});

test("solo se activa en el certificado de incapacidad 29", () => {
  const { helpers, context } = loadScript();
  assert.equal(helpers.isTargetPage(), true);

  context.location.pathname = "/pacientes/123/ficha/formularios/nuevo/35";
  assert.equal(helpers.isTargetPage(), false);
});

test("conserva las recomendaciones y el profesional solicitados", () => {
  const { helpers } = loadScript();

  assert.match(helpers.RECOMMENDATIONS, /retiro de sutura a los 8 días, sin cita\.$/);
  assert.match(
    "Dr. CRISTIAN EDUARDO PEÑA VILLAMIZAR RM 1093788088 Especialista en Periodoncia"
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
    helpers.PROFESSIONAL_MATCH
  );
});
