const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function fixture(items) {
  const body = {};
  const rows = items.map(({ name, tooth = "16", pending = 1, visible = true }) => {
    const nameCell = { textContent: name };
    const toothCell = { textContent: tooth };
    const circles = Array.from({ length: pending }, () => ({ visible: true,
      click() { throw new Error("La vista previa no debe abrir ni guardar prestaciones"); } }));
    const row = { parentElement: body, visible,
      querySelector(selector) {
        if (selector.includes("row-nombre")) return nameCell;
        if (selector.includes("row-pieza")) return toothCell;
        return null;
      },
      querySelectorAll(selector) { return selector === ".no-realizada" ? circles : []; }
    };
    nameCell.parentElement = row;
    return { row, nameCell, circles };
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "Dentalink - Evoluciones periodoncia.user.js"), "utf8")
    .replace(/\n\}\)\(\);\s*$/, "\n globalThis.previewTest = { collectPreviewGroups, previewGroupKey, previewRowKey };\n})();");
  const context = {
    window: { __dlkUtils: { isVisible: (element) => element.visible !== false, watchPage() {} } },
    document: { body, addEventListener() {}, querySelectorAll: () => rows.map(({ nameCell }) => nameCell) },
    location: { href: "https://demo.dentalink.cl/pacientes/1/tratamiento/2", pathname: "/pacientes/1/tratamiento/2" }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.previewTest, rows };
}

test("resalta candidatos pendientes por procedimiento exacto, sin confundir otros tratamientos", () => {
  const { api, rows } = fixture([
    { name: "[240301] Alisado a campo cerrado", tooth: "16" },
    { name: "[240301] Alisado a campo cerrado", tooth: "15" },
    { name: "[240301] Alisado a campo cerrado", tooth: "14", pending: 0 },
    { name: "[240301] Otro alisado a campo cerrado", tooth: "13" },
    { name: "[242201] Alisado a campo abierto", tooth: "12" }
  ]);
  const groups = [...api.collectPreviewGroups().values()];
  assert.equal(groups.length, 3);
  assert.deepEqual(Array.from(groups[0].entries, ({ item }) => item.tooth), ["16", "15"]);
  assert.equal(groups[0].entries[0].circle, rows[0].circles[0]);
  const principal = api.previewRowKey(groups[0].entries[0].item);
  assert.deepEqual(Array.from(groups[0].entries.filter(({ item }) => api.previewRowKey(item) !== principal), ({ item }) => item.tooth), ["15"]);
});

test("omite filas ambiguas, ocultas, sin pieza válida y tratamientos desconocidos", () => {
  const { api } = fixture([
    { name: "[240301] Alisado a campo cerrado", pending: 2 },
    { name: "[240301] Alisado a campo cerrado", tooth: "15", visible: false },
    { name: "[240301] Alisado a campo cerrado", tooth: "" },
    { name: "[999999] Desconocido" },
    { name: "[274101] Frenillectomía", tooth: "" }
  ]);
  const groups = [...api.collectPreviewGroups().values()];
  assert.equal(groups.length, 2);
  assert.equal(groups[0].ambiguous, 1);
  assert.equal(groups[0].entries.length, 0);
  assert.equal(groups[1].entries.length, 1);
});
