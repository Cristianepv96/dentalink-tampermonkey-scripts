import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/mac/Documents/JS/outputs/dentalink_saldos_2026-05-30";
const outputPath = path.join(outputDir, "saldos_dentalink_2026-05-30.xlsx");

const rows = [
  ["2026-05-30", "Magisterio-Belen", "08:00-08:30", "ELCY PAOLA GIRALDO HOYOS", 3271, 17934, "Atendido", "Consulta de Control Especialista", "Deudas", "$-1.799.925", -1799925, "", "https://sanjoseipsodontologica.dentalink.cl/pacientes/3271/tratamiento/17934"],
  ["2026-05-30", "Magisterio-Belen", "08:30-09:00", "ROSA JULIA BEATRIZ AMPARO SALAZAR SOTO", 3730, 17692, "Atendido", "Consulta Primera Vez Especialista", "Deudas", "$-48.375", -48375, "", "https://sanjoseipsodontologica.dentalink.cl/pacientes/3730/tratamiento/17692"],
  ["2026-05-30", "Magisterio-Belen", "09:00-09:30", "LIZA MARIA VELEZ ESPINOSA", 6931, 17670, "No asiste", "Consulta de Control Especialista", "Diagnostico", "$0", 0, "No hay abonos $0", "https://sanjoseipsodontologica.dentalink.cl/pacientes/6931/tratamiento/17670"],
  ["2026-05-30", "Magisterio-Belen", "09:30-10:00", "MARIA CARLINA ZAPATA FLOREZ", 7164, 17669, "Atendido", "Consulta de Control Especialista", "Deudas", "$-488.700", -488700, "", "https://sanjoseipsodontologica.dentalink.cl/pacientes/7164/tratamiento/17669"],
  ["2026-05-30", "Magisterio-Belen", "10:00-10:30", "YEFERSON MOSQUERA MOSQUERA", 7417, 17631, "Atendido", "Consulta Primera Vez Especialista", "Deudas", "$-48.375", -48375, "", "https://sanjoseipsodontologica.dentalink.cl/pacientes/7417/tratamiento/17631"],
  ["2026-05-30", "Eps Savia Salud- Belen", "10:30-11:00", "CLAUDIA PATRICIA PINEDA AGUIRRE", 7611, 17665, "No asiste", "Consulta Primera Vez Especialista", "Diagnostico", "$0", 0, "No hay abonos $0", "https://sanjoseipsodontologica.dentalink.cl/pacientes/7611/tratamiento/17665"],
  ["2026-05-30", "Eps Savia Salud- Belen", "11:00-11:30", "DEIMAR DANIEL GRAJALES DUQUE", 7200, 17290, "No asiste", "Consulta Primera Vez Especialista", "Diagnostico", "$0", 0, "No hay abonos $0", "https://sanjoseipsodontologica.dentalink.cl/pacientes/7200/tratamiento/17290"],
  ["2026-05-30", "Eps Savia Salud- Belen", "11:30-12:00", "LEIDY ALEIDA RIOS CARDONA", 7191, 17605, "Atendido", "Consulta Primera Vez Especialista", "Deudas", "$-51.920", -51920, "", "https://sanjoseipsodontologica.dentalink.cl/pacientes/7191/tratamiento/17605"],
];

const headers = [
  "Fecha",
  "Sede",
  "Hora cita",
  "Paciente",
  "ID paciente",
  "Plan tratamiento",
  "Estado cita",
  "Tipo cita",
  "Situacion agenda",
  "Valor encontrado",
  "Valor numerico",
  "Observacion",
  "URL",
];

const workbook = Workbook.create();
const detalle = workbook.worksheets.add("Detalle");
const resumen = workbook.worksheets.add("Resumen");

detalle.showGridLines = false;
detalle.getRange("A1:M1").values = [headers];
detalle.getRange(`A2:M${rows.length + 1}`).values = rows;
detalle.freezePanes.freezeRows(1);
const table = detalle.tables.add(`A1:M${rows.length + 1}`, true, "DetalleSaldos");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
detalle.getRange("A:A").format.columnWidthPx = 95;
detalle.getRange("B:B").format.columnWidthPx = 190;
detalle.getRange("C:C").format.columnWidthPx = 105;
detalle.getRange("D:D").format.columnWidthPx = 270;
detalle.getRange("E:F").format.columnWidthPx = 105;
detalle.getRange("G:G").format.columnWidthPx = 100;
detalle.getRange("H:H").format.columnWidthPx = 205;
detalle.getRange("I:I").format.columnWidthPx = 120;
detalle.getRange("J:K").format.columnWidthPx = 130;
detalle.getRange("L:L").format.columnWidthPx = 170;
detalle.getRange("M:M").format.columnWidthPx = 430;
detalle.getRange("A1:M1").format.font = { bold: true, color: "#FFFFFF" };
detalle.getRange("A1:M1").format.fill = { color: "#0F6CBD" };
detalle.getRange("K2:K9").format.numberFormat = "$#,##0;-$#,##0;$0";
detalle.getRange("A2:A9").setNumberFormat("yyyy-mm-dd");
detalle.getRange("A1:M9").format.wrapText = true;
detalle.getRange("A1:M9").format.verticalAlignment = "top";

resumen.showGridLines = false;
resumen.getRange("A1").values = [["Resumen de saldos Dentalink - 2026-05-30"]];
resumen.getRange("A1:D1").merge();
resumen.getRange("A1:D1").format.font = { bold: true, size: 15, color: "#FFFFFF" };
resumen.getRange("A1:D1").format.fill = { color: "#0F6CBD" };
resumen.getRange("A3:D3").values = [["Sede", "Citas", "Pacientes con deuda", "Total valor numerico"]];
resumen.getRange("A4:D5").values = [
  ["Magisterio-Belen", "", "", ""],
  ["Eps Savia Salud- Belen", "", "", ""],
];
resumen.getRange("B4:B5").formulas = [["=COUNTIF(Detalle!B$2:B$9,A4)"], ["=COUNTIF(Detalle!B$2:B$9,A5)"]];
resumen.getRange("C4:C5").formulas = [["=COUNTIFS(Detalle!B$2:B$9,A4,Detalle!K$2:K$9,\"<0\")"], ["=COUNTIFS(Detalle!B$2:B$9,A5,Detalle!K$2:K$9,\"<0\")"]];
resumen.getRange("D4:D5").formulas = [["=SUMIF(Detalle!B$2:B$9,A4,Detalle!K$2:K$9)"], ["=SUMIF(Detalle!B$2:B$9,A5,Detalle!K$2:K$9)"]];
resumen.getRange("A7:D7").values = [["Total", "=SUM(B4:B5)", "=SUM(C4:C5)", "=SUM(D4:D5)"]];
resumen.getRange("A3:D7").format.wrapText = true;
resumen.getRange("A3:D3").format.font = { bold: true, color: "#FFFFFF" };
resumen.getRange("A3:D3").format.fill = { color: "#243B53" };
resumen.getRange("A7:D7").format.font = { bold: true };
resumen.getRange("A7:D7").format.fill = { color: "#E8F2FF" };
resumen.getRange("A:A").format.columnWidthPx = 210;
resumen.getRange("B:C").format.columnWidthPx = 150;
resumen.getRange("D:D").format.columnWidthPx = 170;
resumen.getRange("D4:D7").format.numberFormat = "$#,##0;-$#,##0;$0";

const detailInspect = await workbook.inspect({
  kind: "table",
  range: "Detalle!A1:M9",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 14,
});
console.log(detailInspect.ndjson);

const summaryInspect = await workbook.inspect({
  kind: "table",
  range: "Resumen!A1:D7",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 6,
});
console.log(summaryInspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({ sheetName: "Detalle", range: "A1:M9", autoCrop: "all", scale: 1, format: "png" });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "preview_detalle.png"), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
