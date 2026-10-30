# Anamnesis paso a paso — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar las filas de botones de `Dentalink - Antecedentes por defecto.user.js` por un panel lateral de 8 pasos que guía la anamnesis, parte de lo que ya tiene la ficha y escribe el resultado en las listas y textos de Dentalink.

**Architecture:** Un solo userscript (patrón del repo: archivos grandes con API de pruebas), dividido en capas puras y probables — contenido clínico y derivaciones, lectura de la ficha a estado, plan de escritura — más un adaptador DOM de Dentalink y la interfaz del panel. La interfaz genera HTML como texto (igual que el boceto v3) para poder probar cada paso sin navegador.

**Tech Stack:** JavaScript de navegador sin dependencias, Tampermonkey `@grant none`, `node --test` + `vm` para pruebas.

**Spec:** `docs/superpowers/specs/2026-10-29-anamnesis-paso-a-paso-design.md` · Boceto de referencia visual y de textos: `.superpowers/brainstorm/33412-1793332136/content/prototipo-flujo-v3.html`

## Global Constraints

- `@version 3.0.0`; `@match https://*.dentalink.cl/pacientes/*`; `@grant none`; actuar solo si `location.pathname` coincide con `/\/pacientes\/\d+\/ficha\/antecedentes/`.
- Nunca pulsar «Nuevo …», la papelera (`i.fa-trash`) ni **Guardar**. En los desplegables solo se tocan casillas `input[type=checkbox]` y el «Aceptar» del `footer`.
- Textos que van a la ficha en MAYÚSCULAS, como en el boceto (p. ej. `HIPERTENSION ARTERIAL CONTROLADA`, `FUMA CIGARRILLO 10–20 AL DÍA`).
- Números: coma decimal, un decimal (`toLocaleString("es-CO", { maximumFractionDigits: 1 })`); campos numéricos son `type=text` que solo aceptan dígitos y una coma.
- HbA1c ≥ 7,5 → diabetes no controlada (aviso rojo, alerta, ASA III); 7,0–7,4 → aviso informativo de grado C.
- Estilo de Dentalink: azul `#2a6fdb`; todo el CSS propio bajo el prefijo `dlk-an-`.
- Secciones (títulos exactos de Dentalink): `Motivo de consulta`, `Enfermedad actual`, `Alertas médicas`, `Enfermedades`, `Medicamentos`, `Hábitos`, `Antecedentes odontológicos`, `Antecedentes familiares`.
- Se trabaja con pacientes reales: ninguna prueba en Dentalink guarda la ficha.

## Review Focus

1. El buscador de Dentalink no devuelve nada o tarda: tras 3 s se cierra el desplegable sin cambios y el elemento va a «Otros …»; nunca se queda colgado (Task 4).
2. Se sale de la ficha a mitad de «Pasar a Dentalink»: la cola se detiene al cambiar la ruta y no escribe en otra página (Task 4).
3. El mismo dato en la lista y en el texto («losartan» en la lista y «LOSARTAN» en Otros): aparece una sola vez en el panel y no se duplica al escribir (Tasks 2 y 3).
4. HbA1c escrita como «7,5», «7.5», «7,55» o vacía: 7,5 cuenta como no controlada; vacía no genera aviso (Task 1).
5. Texto «Otros …» con elementos mezclados y desconocidos («LOSARTAN, GOTAS PARA LOS OJOS»): lo desconocido se conserva como «Ya en la ficha» y sigue en la ficha tras escribir (Tasks 2 y 3).

---

## Estructura

- Modify: `Dentalink - Antecedentes por defecto.user.js` — se reescribe por secciones:
  1. Contenido clínico (constantes del boceto v3: `MOTIVOS`, `SINTOMAS`, `TIEMPOS`, `ENF`, `MED_INFO`, `MEDS_FRECUENTES`, `MEDS_TODOS`, `ALERGIAS`, `PROFILAXIS`, `FUMA`, `CANTIDAD`, `ANIOS`, `DEJO`, `FRECUENCIA`, `OTROS_HAB`, `ODONTO`, `LIMPIEZA`, `FAMILIARES`, `HBA1C_NO_CONTROLADA = 7.5`).
  2. Derivaciones puras (Task 1).
  3. Lectura de la ficha (Task 2).
  4. Plan de escritura (Task 3).
  5. Adaptador Dentalink (Task 4).
  6. Panel (Task 5).
  7. Ciclo de página (Task 6).
  Expone `globalThis.__dlkAnamTest` cuando `globalThis.__DLK_ANAM_TEST__` es verdadero (sin `return`, para que el ciclo también se pruebe).
- Create: `tests/helpers/load-anamnesis.js` — carga el script en `vm` con un DOM falso mínimo; lo usan todos los tests.
- Create: `tests/anamnesis-clinica.test.js`, `tests/anamnesis-lectura.test.js`, `tests/anamnesis-escritura.test.js`, `tests/anamnesis-dentalink.test.js`, `tests/anamnesis-panel.test.js`.
- Modify: `tests/antecedentes-navigation.test.js` — se adapta al panel (Task 6).
- Modify: `README.md` — fila y sección del script (Task 6).

### Forma del estado (compartida por todas las tareas)

```js
/** @typedef {{
 *  motivos:Set<string>, motivoTexto:string, sintomas:Set<string>, tiempo:string,
 *  alertas:boolean|null, alergias:Set<string>, embarazo:""|"Embarazo"|"Lactancia", semanas:string, profilaxis:Set<string>,
 *  enf:boolean|null, enfermedades:Set<string>, det:Object<string,{control?:string,tipo?:string|string[],hba1c?:string,tiempo?:string}>,
 *  med:boolean|null, meds:Set<string>, medDesde:Object<string,string>,
 *  tabaco:""|"No"|"Fuma"|"Exfumador", fuma:Set<string>, cantidad:string, anios:string, cannabisFrec:string, vapeoFrec:string, dejo:string,
 *  alcohol:string, bruxismo:string, bruxTipo:Set<string>, placa:string, otrosHab:Set<string>,
 *  odontologicos:Set<string>, limpieza:string, cepillado:string, seda:string, enjuague:string,
 *  fam:boolean|null, familiares:Set<string>,
 *  previos:Object<string,string[]>,   // título de sección → elementos de la ficha no reconocidos
 *  hechos:Set<number>                 // índices 0–7 de pasos completados
 * }} Estado */
```

`Seccion = { lista: string[], texto: string }` — lo que la ficha tiene en una sección (etiquetas elegidas y texto «Otros …»).

---

### Task 1: Contenido clínico y derivaciones puras

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (secciones 1 y 2)
- Create: `tests/helpers/load-anamnesis.js`, `tests/anamnesis-clinica.test.js`

**Interfaces:**
- Produces: `crearEstado(): Estado`; `norm(t): string` (sin tildes, MAYÚSCULAS, sin puntuación); `fmt(n: number): string`; `leerNumero(t: string): number` (acepta coma o punto, `NaN` si vacío); `enfermedadActual(s): string`; `motivoFinal(s): string`; `avisos(s): Array<{tipo:"danger"|"warn"|"info", titulo:string, texto:string, alerta?:string}>`; `gradoTabaco(s): string|null`; `asaSugerido(s): {asa:string, why:string}`; `alertasFinales(s): string[]`; `enfermedadesFinales(s): string[]`; `habitosFinales(s): string[]`; `higiene(s): string`.
- Produces: `loadAnamnesis({ pathname?, textareas? }) → { api, page }` en `tests/helpers/load-anamnesis.js`, con `page.setTextareas`, `page.flush()` (ejecuta temporizadores), `page.tick()` (ejecuta intervalos) y `page.location` — reutiliza el `stub`/`section` de `tests/antecedentes-navigation.test.js`, movidos aquí.

- [ ] **Step 1: Escribir los tests que fallan** en `tests/anamnesis-clinica.test.js`:

```js
test("HbA1c 7,5 es diabetes no controlada y ASA III", () => {
  const s = api.crearEstado(); s.enfermedades.add("Diabetes"); s.det.Diabetes = { hba1c: "7,5" };
  assert.ok(api.alertasFinales(s).includes("DIABETES NO CONTROLADA (HBA1C 7,5 %)"));
  assert.equal(api.asaSugerido(s).asa, "ASA III");
});
test("HbA1c 7,4 solo avisa grado C, sin alerta", () => {
  const s = api.crearEstado(); s.enfermedades.add("Diabetes"); s.det.Diabetes = { hba1c: "7.4" };
  const a = api.avisos(s).find((x) => /HbA1c/.test(x.titulo));
  assert.equal(a.tipo, "warn"); assert.equal(a.alerta, undefined);
  assert.equal(api.asaSugerido(s).asa, "ASA II, CONTROLADA POR MEDICAMENTOS");
});
test("HbA1c vacía no genera aviso", () => { /* s.det.Diabetes = { hba1c: "" } → ningún aviso con /HbA1c|Diabetes/ */ });
test("leerNumero acepta coma, punto y vacío", () => {
  assert.equal(api.leerNumero("7,55"), 7.55); assert.equal(api.leerNumero("7.5"), 7.5); assert.ok(Number.isNaN(api.leerNumero("")));
});
test("fmt usa coma decimal", () => assert.equal(api.fmt(7.55), "7,6"));
test("sin enfermedades es ASA I", () => assert.equal(api.asaSugerido(api.crearEstado()).asa, "ASA I"));
test("alendronato ≥ 4 años es riesgo alto de osteonecrosis", () => {
  const s = api.crearEstado(); s.meds.add("Alendronato"); s.enfermedades.add("Osteoporosis"); s.det.Osteoporosis = { tiempo: "≥ 4 años" };
  assert.ok(api.alertasFinales(s).includes("RIESGO ALTO DE OSTEONECROSIS: ALENDRONATO (≥ 4 AÑOS)"));
});
test("alendronato < 4 años es riesgo bajo; denosumab siempre alto", () => { /* "RIESGO DE OSTEONECROSIS: ALENDRONATO (< 4 AÑOS)" y "RIESGO ALTO DE OSTEONECROSIS: DENOSUMAB" */ });
test("warfarina genera ANTICOAGULADO y nota de INR", () => { /* alerta "ANTICOAGULADO: WARFARINA"; texto incluye "INR" */ });
test("amlodipino avisa agrandamiento sin alerta", () => { /* tipo "info", alerta undefined */ });
test("cigarrillo 10–20 es grado C; 6–9 es grado B; cannabis solo no da grado", () => {
  /* gradoTabaco → "C (≥ 10 cigarrillos/día)", "B (< 10 cigarrillos/día)", null */
});
test("redacción de enfermedad actual y hábitos", () => {
  const s = api.crearEstado(); s.sintomas.add("Sangrado al cepillado"); s.sintomas.add("Movilidad dental"); s.tiempo = "6 meses";
  assert.equal(api.enfermedadActual(s), "PACIENTE ACUDE A CITA DE VALORACIÓN POR PERIODONCIA REFIRIENDO SANGRADO AL CEPILLADO Y MOVILIDAD DENTAL DESDE HACE 6 MESES");
  s.tabaco = "Fuma"; s.fuma.add("Cigarrillo"); s.cantidad = "10–20";
  assert.deepEqual(api.habitosFinales(s), ["FUMA CIGARRILLO 10–20 AL DÍA"]);
});
test("HTA controlada se redacta completa", () => { /* det.Hipertensión.control "Sí" → "HIPERTENSION ARTERIAL CONTROLADA" */ });
```

- [ ] **Step 2: Ejecutar y ver que fallan** — `node --test tests/anamnesis-clinica.test.js` → FAIL (`api.crearEstado is not a function`).
- [ ] **Step 3: Implementar** las constantes y funciones de la sección 2 trasladando la lógica del boceto v3 a funciones que reciben `s` en vez de usar el `S` global; `hba1c` pasa a `leerNumero(s.det.Diabetes?.hba1c ?? "")`; textos de aviso iguales a los del boceto. Antirresortivo de riesgo bajo: alerta `RIESGO DE OSTEONECROSIS: <FÁRMACOS> (<TIEMPO>)`.
- [ ] **Step 4: Ejecutar** `node --test tests/` → PASS (todos).
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis: contenido clínico y derivaciones"`.

### Task 2: Leer la ficha y convertirla en estado

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (sección 3)
- Create: `tests/anamnesis-lectura.test.js`

**Interfaces:**
- Consumes: `crearEstado`, `norm`, constantes de Task 1.
- Produces: `estadoDesdeFicha(secciones: Object<string, Seccion>): Estado`; `fichaVacia(secciones): boolean` (todas sin lista y con texto vacío o `""`); `ALIAS: Object<string,string[]>` (nombre canónico → nombres del catálogo: `Hipertensión → ["HIPERTENSION ARTERIAL","HTA"]`, `Diabetes → ["DIABETES MELLITUS","DIABETES MELLITUS TIPO 2"]`, `Exodoncias → ["EXODONCIA"]`, `Restauraciones → ["RESTAURACION"]`, más los medicamentos sin tilde, p. ej. `Losartán → ["LOSARTAN"]` sale solo de `norm`).

Reglas: cada elemento de `lista` y cada parte de `texto` separada por comas se busca, normalizada, en el catálogo de su sección (Enfermedades → `ENF`, Medicamentos → `MEDS_TODOS`, Hábitos → cigarrillo/exfumador/alcohol/bruxismo/`OTROS_HAB`, Alertas → `ALERGIAS` con prefijo «ALERGIA A», Odontológicos → `ODONTO`, Familiares → `FAMILIARES`). Reconocido → se marca en el estado; no reconocido → `previos[título]`. Sección con solo `NIEGA` → su pregunta Sí/No en `false` y paso en `hechos`. Sección con datos → su Sí/No en `true` y paso en `hechos`. `ASA …` en Alertas se ignora (se recalcula). Motivo y Enfermedad actual: el texto completo va a `previos`.

- [ ] **Step 1: Tests que fallan**:

```js
test("losartan en la lista y LOSARTAN en Otros cuentan una sola vez", () => {
  const s = api.estadoDesdeFicha({ Medicamentos: { lista: ["losartan"], texto: "LOSARTAN" } });
  assert.deepEqual([...s.meds], ["Losartán"]); assert.equal(s.med, true); assert.ok(s.hechos.has(3));
});
test("Hipertensión arterial del catálogo se reconoce como Hipertensión", () => { /* enfermedades contiene "Hipertensión" */ });
test("NIEGA responde No y marca el paso", () => { /* Hábitos texto "NIEGA" → tabaco "No", hechos.has(4) */ });
test("lo desconocido queda en previos sin perderse", () => {
  const s = api.estadoDesdeFicha({ Medicamentos: { lista: [], texto: "LOSARTAN, GOTAS PARA LOS OJOS" } });
  assert.deepEqual(s.previos.Medicamentos, ["GOTAS PARA LOS OJOS"]);
});
test("ALERGIA A PENICILINA se reconoce; ASA I se ignora", () => { /* alergias Set ["Penicilina"], previos.Alertas undefined */ });
test("fichaVacia distingue paciente nuevo", () => {
  assert.equal(api.fichaVacia({ "Motivo de consulta": { lista: [], texto: '""' }, Hábitos: { lista: [], texto: "" } }), true);
  assert.equal(api.fichaVacia({ Medicamentos: { lista: ["losartan"], texto: "" } }), false);
});
```

- [ ] **Step 2:** `node --test tests/anamnesis-lectura.test.js` → FAIL.
- [ ] **Step 3: Implementar** `estadoDesdeFicha` y `fichaVacia` con una tabla `reconocedores` por sección (función `(parteNormalizada, s) → boolean`).
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis: leer la ficha para confirmar y corregir"`.

### Task 3: Plan de escritura

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (sección 4)
- Create: `tests/anamnesis-escritura.test.js`

**Interfaces:**
- Consumes: derivaciones de Task 1; `Estado` y `Seccion`.
- Produces: `planEscritura(s: Estado, ficha: Object<string, Seccion>): Object<string, { marcar: string[], quitar: string[], texto: string }>` — por sección: elementos a buscar y marcar en la lista, etiquetas de la lista a quitar (solo las que estaban y se desmarcaron), y el texto final de «Otros …». `marcar` usa los nombres del estado (la búsqueda en el catálogo es de Task 4); lo que Task 4 no encuentre se añade al texto allí.

Reglas: texto final = texto actual + elementos nuevos que no van a lista (alertas, hábitos redactados, higiene, «NIEGA», ASA), separados por «, », sin repetir partes ya presentes (comparando con `norm`); `previos` se conservan siempre. Sección con No → «NIEGA» solo si su lista queda vacía. Alertas: ASA sugerido + `alertasFinales`. Motivo → `motivoFinal(s)` si el texto está vacío o es `""`; Enfermedad actual → `enfermedadActual(s)` si está vacío. Enfermedades y Medicamentos → `marcar`; Hábitos, Odontológicos y Familiares → `marcar` para lo de catálogo y texto para lo redactado (tabaco con cantidad, alcohol, bruxismo, higiene).

- [ ] **Step 1: Tests que fallan**:

```js
test("no escribe NIEGA si la lista ya tiene medicamentos", () => {
  const s = api.crearEstado(); s.med = false;
  const p = api.planEscritura(s, { Medicamentos: { lista: ["losartan"], texto: "" } });
  assert.equal(p.Medicamentos.texto, "");
});
test("solo quita lo desmarcado explícitamente", () => {
  const ficha = { Medicamentos: { lista: ["losartan", "metformina"], texto: "" } };
  const s = api.estadoDesdeFicha(ficha); s.meds.delete("Metformina");
  assert.deepEqual(api.planEscritura(s, ficha).Medicamentos.quitar, ["metformina"]);
});
test("agrega al texto existente sin duplicar y conserva lo desconocido", () => {
  const ficha = { Hábitos: { lista: [], texto: "GOTAS, BRUXISMO NOCTURNO" } };
  const s = api.estadoDesdeFicha(ficha); s.alcohol = "Semanal";
  assert.equal(api.planEscritura(s, ficha).Hábitos.texto, "GOTAS, BRUXISMO NOCTURNO, ALCOHOL SEMANAL");
});
test("Alertas lleva el ASA y las alertas derivadas", () => { /* HbA1c 8 → texto contiene "ASA III" y "DIABETES NO CONTROLADA (HBA1C 8 %)" */ });
test("no pisa un motivo ya escrito", () => { /* ficha Motivo texto "DOLOR" → plan Motivo texto "DOLOR" */ });
```

- [ ] **Step 2:** `node --test tests/anamnesis-escritura.test.js` → FAIL.
- [ ] **Step 3: Implementar** `planEscritura`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis: plan de escritura sin contradicciones"`.

### Task 4: Adaptador de Dentalink

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (sección 5; reutiliza `findCard`, `listParts`, `listItems`, `setInputValue`, `pickFromList`, `removeFromList` y `enqueue` de 2.1.0)
- Create: `tests/anamnesis-dentalink.test.js`

**Interfaces:**
- Consumes: `planEscritura` (Task 3), `norm`, `ALIAS` (Task 2).
- Produces: `leerSecciones(): Object<string, Seccion>`; `aplicarPlan(plan, { ruta: string }): Promise<{ marcados: string[], aTexto: string[], cancelado: boolean }>` — aplica sección por sección en el orden de los títulos: quitar, marcar (cada uno con `pickFromList`; si devuelve `false`, el elemento se añade al texto), y por último escribe el texto con `setValue`. Antes de cada acción comprueba `location.pathname === ruta`; si cambió, devuelve `cancelado: true` sin tocar nada más.
- `pickFromList(card, item): Promise<boolean>` mantiene el límite de 3000 ms y cierra con `document.body.click()` si no encuentra.

- [ ] **Step 1: Tests que fallan** con un desplegable falso (`panel` con `input` de búsqueda que filtra un catálogo, casillas y `footer` con «Aceptar»; registra cada clic):

```js
test("marca en la lista lo que existe y manda a texto lo que no", async () => {
  /* catálogo ["METFORMINA","Metformina.","hipertensión"]; plan Medicamentos marcar ["Metformina","Pregabalina"]
     → resultado.marcados ["Metformina"], aTexto ["Pregabalina"], texto de Otros "PREGABALINA" */
});
test("nunca pulsa Nuevo ni la papelera", async () => { /* el registro de clics no contiene "nuevo" ni "trash" */ });
test("si el buscador no responde, a los 3 s cierra y sigue", async () => { /* catálogo que nunca devuelve; aTexto contiene el elemento */ });
test("si la ruta cambia a mitad, se cancela", async () => { /* cambiar location.pathname tras el primer marcado → cancelado true, sin más clics */ });
test("leerSecciones junta etiquetas y texto por sección", () => { /* tarjeta Medicamentos con chip "losartan" y textarea "ASA" */ });
```

- [ ] **Step 2:** `node --test tests/anamnesis-dentalink.test.js` → FAIL.
- [ ] **Step 3: Implementar** `leerSecciones` y `aplicarPlan`; ajustar `pickFromList` para aceptar alias (`[item, ...ALIAS[item]]`).
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis: escribir el plan en las listas de Dentalink"`.

### Task 5: Panel lateral

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (sección 6)
- Create: `tests/anamnesis-panel.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `PASOS: Array<{ titulo: string, resumen(s): string, cuerpo(s): string }>` (8 pasos, títulos y textos del boceto v3); `htmlPanel(s, abierto: number, plegado: boolean): string`; `montarPanel(s): void` (inserta `#dlk-an-panel` y la pestaña `#dlk-an-pestana`, delega eventos con `data-*` como el boceto); `alternarPanel(abrir: boolean): void`.
- Diferencias con el boceto: no hay ficha falsa — el «pendiente» se muestra como una lista de cambios en la revisión final; las etiquetas `previos` se pintan en su paso como chips grises «Ya en la ficha»; el botón final llama a `aplicarPlan(planEscritura(s, leerSecciones()), { ruta })` y muestra un aviso con `marcados` y `aTexto`.
- Campos numéricos como en el boceto v3: `class="dlk-an-num"`, `inputmode="decimal"`, limpieza a dígitos y una coma en `input`, avisos recalculados en `change`/Enter.
- CSS del boceto v3 con prefijo `dlk-an-`; panel `position:fixed; right:0; top:0; height:100vh; width:460px; z-index:1040`; plegado = pestaña vertical de 32 px con el texto «Anamnesis».

- [ ] **Step 1: Tests que fallan** (sobre el HTML generado):

```js
test("el paso de enfermedades muestra las frecuentes como tarjetas", () => {
  const s = api.crearEstado(); s.enf = true;
  const html = api.PASOS[2].cuerpo(s);
  for (const e of ["Hipertensión", "Diabetes", "Osteoporosis"]) assert.match(html, new RegExp(`data-enf="${e}"`));
});
test("elegir HTA muestra su seguimiento y sus medicamentos", () => { /* enfermedades {Hipertensión} → html contiene "¿Está controlada?" y data-med="Losartán" */ });
test("los previos se ven como Ya en la ficha", () => { /* previos.Medicamentos ["GOTAS"] → PASOS[3].cuerpo contiene "Ya en la ficha" y "GOTAS" */ });
test("un paso hecho muestra su resumen", () => { /* hechos {3}, meds {Losartán} → htmlPanel(...) contiene "Losartán" en el encabezado del paso 4 */ });
test("plegado solo pinta la pestaña", () => { /* htmlPanel(s, 0, true) contiene "dlk-an-pestana" y no "Siguiente" */ });
```

- [ ] **Step 2:** `node --test tests/anamnesis-panel.test.js` → FAIL.
- [ ] **Step 3: Implementar** trasladando `STEPS`, `chips`, `segv`, `segDet`, `enfCard` y los manejadores del boceto v3, con estado `s` pasado como parámetro y prefijo `dlk-an-`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis: panel lateral paso a paso"`.

### Task 6: Ciclo de página, apertura y versión

**Files:**
- Modify: `Dentalink - Antecedentes por defecto.user.js` (sección 7, cabecera `@version 3.0.0` y `@description`), `README.md`, `tests/antecedentes-navigation.test.js`

**Interfaces:**
- Consumes: `leerSecciones`, `fichaVacia`, `estadoDesdeFicha`, `montarPanel`, `alternarPanel`.
- Produces: `sync()` — en la ficha: si no hay panel, lee la ficha, recupera el estado guardado para el paciente (`Map` en memoria indexado por id de paciente) o crea uno con `estadoDesdeFicha`, monta el panel abierto si `fichaVacia` y plegado si no. Al salir de la ficha, desmonta el panel y conserva el estado del paciente. Se eliminan `AUTO_DEFAULTS`, `SIN_ANTECEDENTES`, las barras de botones y el resumen «Faltan».

- [ ] **Step 1: Reescribir los tests de navegación**:

```js
test("ficha vacía abre el panel; con datos queda plegado", () => { /* textareas vacías → #dlk-an-panel sin clase plegado; con chip → plegado */ });
test("al volver a la ficha sin recargar, el panel reaparece con lo respondido", () => { /* responder meds, cambiar ruta a evoluciones y volver → s.meds conserva Losartán */ });
test("otro paciente empieza con su propia ficha", () => { /* /pacientes/8/... → estado nuevo */ });
test("se instala en todas las páginas del paciente", () => { /* @match "https://*.dentalink.cl/pacientes/*" y @version 3.0.0 */ });
```

- [ ] **Step 2:** `node --test tests/antecedentes-navigation.test.js` → FAIL.
- [ ] **Step 3: Implementar** `sync` y la memoria por paciente; quitar el código de 2.x que ya no se usa; actualizar la fila del README («Anamnesis paso a paso: panel lateral de 8 pasos…») y su sección de uso.
- [ ] **Step 4:** `node --test tests/` → PASS (toda la suite).
- [ ] **Step 5: Commit** — `git commit -m "Anamnesis 3.0.0: panel paso a paso en la ficha"`.

### Task 7: Verificación en Dentalink (sin guardar)

- [ ] **Step 1:** Subir la rama y abrir en Chrome el enlace raw de la rama para que el periodoncista confirme la instalación en Tampermonkey.
- [ ] **Step 2:** En un paciente con datos: entrar por Evoluciones y pasar a Ficha Anamnesis sin recargar → aparece la pestaña plegada; al abrirla, lo que había en la ficha está marcado y lo desconocido sale como «Ya en la ficha».
- [ ] **Step 3:** Marcar HTA controlada + Amlodipino, pulsar **Pasar a Dentalink** → Amlodipino aparece como etiqueta en Medicamentos y «ASA II, CONTROLADA POR MEDICAMENTOS» en Alertas; ningún elemento duplicado.
- [ ] **Step 4:** Deshacer a mano lo marcado (×) y salir sin guardar.
- [ ] **Step 5:** Informar al periodoncista con capturas; no fusionar en `main` sin su aprobación.
