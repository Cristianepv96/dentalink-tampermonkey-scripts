# Anamnesis paso a paso — diseño

Fecha: 2026-10-29 · Script: `Dentalink - Antecedentes por defecto.user.js` (pasa a 3.0.0)
Boceto aprobado: `.superpowers/brainstorm/33412-1793332136/content/prototipo-flujo-v3.html`

## Por qué

La versión actual (2.x) agrega filas de botones debajo de cada tarjeta de la
Ficha Anamnesis. El periodoncista la encuentra desordenada y de aspecto poco
profesional, y no acompaña su forma real de trabajar: entrevista al paciente
sección por sección, y 9 de cada 10 pacientes **sí** tienen antecedentes
(sobre todo HTA, diabetes y antirresortivos). Quiere además que el asistente le
recuerde las preguntas que importan en periodoncia para hacer una anamnesis más
completa.

## Objetivos

- Un panel lateral que guía la entrevista en 8 pasos, en el orden en que se
  pregunta, y escribe el resultado en la Ficha Anamnesis de Dentalink.
- Lo común se resuelve con un toque: enfermedades frecuentes como tarjetas,
  sus medicamentos habituales listos para marcar, motivos frecuentes.
- Avisos clínicos automáticos a partir de lo respondido (ver «Contenido
  clínico») y sugerencia de ASA y de grado por tabaco/glicada.
- Lo que se escribe en la ficha queda redactado de forma uniforme y precisa.

## No objetivos

- No guarda la ficha: el periodoncista revisa y pulsa **Guardar**.
- No diagnostica ni estadifica la periodontitis completa; solo aporta los
  modificadores que salen de la anamnesis (glicada, tabaco, pérdida por
  movilidad).
- No toca otras páginas de Dentalink ni otros scripts.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que la ficha quede con datos contradictorios (p. ej. «NIEGA» junto a un
  medicamento elegido).
- Que modifique el catálogo de la clínica: nunca pulsar «Nuevo …» ni la
  papelera de los desplegables de Dentalink.
- Que se vea como algo pegado encima de Dentalink: debe sentirse parte de la
  página.
- Que sea más lento que escribir a mano para un paciente típico.

## Restricciones

- Tampermonkey, `@grant none`, `@match https://*.dentalink.cl/pacientes/*`
  (Dentalink cambia de pestaña sin recargar; el script actúa solo en
  `/pacientes/<id>/ficha/antecedentes`).
- Dentalink es una app React. Cada sección tiene un desplegable «Añadir …»
  (buscador + casillas + **Aceptar**) y un texto libre «Otros …». Lo elegido se
  ve como etiquetas con ×. Comprobado en vivo: escribir en el buscador con el
  setter nativo + evento `input`, hacer clic en la casilla y en **Aceptar**
  funciona; `document.body.click()` cierra el desplegable sin cambios. La lista
  es infinita: siempre buscar, nunca recorrer.
- El catálogo de la clínica está desordenado (mayúsculas, tildes, puntos,
  duplicados como «METFORMINA» y «Metformina.»). Emparejar normalizando y con
  alias.
- Se trabaja con fichas de pacientes reales: las pruebas en Dentalink se hacen
  sin guardar.
- Tests con `node --test` y `vm`, como el resto del repositorio.

## Enfoques considerados

- **A · Barra única arriba** con botón de paciente sano y estado por sección.
  Descartado: pensado para pacientes sin antecedentes, que son la minoría.
- **B · Cuestionario lateral encadenado** (elegido). Sigue el orden de la
  entrevista, deja las tarjetas de Dentalink limpias y concentra en un lugar
  lo que falta y los avisos. Coste: más código propio de interfaz.
- **C · Mejoras dentro de las tarjetas de Dentalink** (sugeridos arriba en
  cada desplegable). Menos cambio visual, pero depende de las entrañas del
  desplegable de Dentalink y se rompe con más facilidad.

## Lo que se decidió

### Interfaz

- Panel fijo a la derecha (~460 px) que no tapa la ficha; la ficha se ve a la
  izquierda llenándose en vivo con estilo «pendiente» (borde punteado) hasta
  confirmar.
- 8 pasos en acordeón: uno abierto a la vez; cada paso cerrado muestra un
  resumen de una línea. Barra de progreso y «Paso n de 8».
- Pasos con pregunta Sí/No: «No» completa el paso y abre el siguiente; «Sí»
  despliega las opciones.
- Botón final **Pasar a Dentalink**, activo en la revisión final.
- Estética de Dentalink: azul `#2a6fdb`, tarjetas blancas, píldoras
  redondeadas; nada de colores o tipografías ajenos.
- Números a la colombiana: coma decimal, un decimal, campos de texto que solo
  aceptan dígitos y coma (no `type=number`); los avisos se recalculan al salir
  del campo o pulsar Enter.

### Pasos y contenido

1. **Motivo y enfermedad actual.** Motivos frecuentes (Sangrado de encías,
   Dientes flojos, Remitido por odontología general, Control periodontal,
   Encías retraídas, Mal aliento, Valoración para implantes, Valoración antes de
   ortodoncia) que marcan los síntomas asociados; texto opcional «en sus
   palabras»; síntomas; tiempo. Redacta: `PACIENTE ACUDE A CITA DE VALORACION
   POR PERIODONCIA REFIRIENDO <síntomas> DESDE HACE <tiempo>`.
2. **Alertas.** Alergias (penicilina → sugiere clindamicina/azitromicina; AINEs →
   acetaminofén; anestésicos, látex, clorhexidina, sulfas), embarazo (semanas) o
   lactancia, profilaxis antibiótica (válvula, endocarditis, cardiopatía
   congénita, prótesis articular < 2 años).
3. **Enfermedades.** Tarjetas para las frecuentes (Hipertensión, Diabetes,
   Hipotiroidismo, Dislipidemia, Osteoporosis, Cardiopatía); el resto como
   botones. Cada una elegida abre su seguimiento y sus medicamentos:
   - HTA: ¿controlada? (Sí / No / No sabe).
   - Diabetes: tipo 1 o 2; última HbA1c.
   - Osteoporosis: antirresortivo y tiempo (< 4 años / ≥ 4 años / suspendido).
   - Cardiopatía: arritmia, infarto previo, stent, válvula, falla cardíaca.
4. **Medicamentos.** Ya anotados (con su origen), sugeridos por enfermedad,
   frecuentes y buscador con autocompletado.
5. **Hábitos.** Tabaco: No / Fuma / Exfumador. Si fuma: qué (cigarrillo,
   cannabis, vapeador, tabaco/pipa, otro), cigarrillos al día (1–5, 6–9,
   10–20, > 20), años, frecuencia de cannabis o vapeo. Exfumador: hace cuánto
   dejó. Alcohol (No / Ocasional / Semanal / Diario). Bruxismo (nocturno/diurno,
   placa). Otros: respiración oral, onicofagia, morder objetos, piercing, estrés.
6. **Antecedentes odontológicos e higiene.** Tratamientos previos (incluye
   «Exodoncias por movilidad»), última limpieza, cepillado al día, seda,
   enjuague.
7. **Familiares.** Periodontitis, pérdida dental temprana, diabetes, HTA,
   cardiopatía, cáncer.
8. **Revisión final.** ASA sugerido con su motivo, todos los avisos y el texto
   de cada sección.

### Contenido clínico (validado por el periodoncista en el boceto)

- HbA1c ≥ 7,5 % → «DIABETES NO CONTROLADA (HBA1C x,x %)», aviso rojo, ASA III.
  HbA1c 7,0–7,4 → aviso informativo de grado C.
- Tabaco: cigarrillo ≥ 10/día → grado C; < 10 → grado B. Cannabis: aviso
  informativo.
- Anticoagulantes (warfarina: pedir INR; apixabán/rivaroxabán: coordinar la
  dosis) → alerta «ANTICOAGULADO: …». Antiagregantes (ASA, clopidogrel) →
  «ANTIAGREGADO: …».
- Antirresortivos: riesgo **alto** de osteonecrosis si vía IV (ácido
  zoledrónico), denosumab o ≥ 4 años; si no, riesgo bajo. Alerta con fármaco y
  tiempo.
- Amlodipino, nifedipino, ciclosporina, fenitoína → aviso de agrandamiento
  gingival (sin alerta).
- Corticoides, metotrexato → «INMUNOSUPRIMIDO». Insulina, glibenclamida →
  «RIESGO DE HIPOGLUCEMIA». Antidepresivos/benzodiacepinas → aviso de boca seca.
- HTA no controlada → «HTA NO CONTROLADA». Profilaxis (o válvula) →
  «REQUIERE PROFILAXIS ANTIBIOTICA». Embarazo → alerta con semanas.
- ASA: sin enfermedades → ASA I; enfermedad controlada → «ASA II, CONTROLADA POR
  MEDICAMENTOS»; HbA1c ≥ 7,5, HTA no controlada, infarto/stent/falla cardíaca o
  enfermedad renal → ASA III.

### Apertura y pacientes que vuelven (decidido por el periodoncista)

- Ficha vacía (paciente nuevo): el panel se abre solo al entrar a la Ficha
  Anamnesis.
- Ficha con datos: el panel queda como una pestaña plegada en el borde derecho
  («Anamnesis») que se abre con un clic.
- Al abrirse con datos previos, el panel parte de lo que ya tiene la ficha para
  **confirmar y corregir**, no para empezar de cero:
  - Elementos de las listas y del texto «Otros …» que coinciden con lo conocido
    (enfermedades, medicamentos, hábitos, alergias…, con normalización y alias)
    aparecen ya marcados en su paso.
  - Lo que no se reconoce se muestra en su paso como «Ya en la ficha», sin
    poder perderse ni duplicarse.
  - Una sección con solo «NIEGA» aparece respondida con «No».
  - Los pasos que llegan con datos se ven como hechos (✓) con su resumen; el
    periodoncista los abre solo si hay que corregir.
  - Desmarcar en el panel algo que ya estaba en la ficha lo quita de la ficha al
    pulsar **Pasar a Dentalink** (excepción a «nunca quita»: solo cuando se
    desmarca explícitamente).

### Escritura en Dentalink

- Todo se escribe al pulsar **Pasar a Dentalink**, de una vez y en orden.
- Por cada elemento: buscar en el desplegable de la sección y marcarlo si existe
  (emparejando normalizado y con alias); si no existe, va al texto «Otros …» de
  esa sección. Nunca crear elementos en el catálogo.
- Las secciones respondidas con «No» quedan como «NIEGA» en su texto «Otros …»
  (Alertas: el ASA sugerido), salvo que la lista ya tenga elementos.
- Al terminar, aviso con lo que se marcó en listas y lo que fue a texto.

### Decisiones tomadas por Claude (revisar)

- Las filas de botones de 2.x desaparecen; el panel las reemplaza. La rama de
  prueba 2.1.0 no se fusiona: 3.0.0 reutiliza su código de listas
  (`listItems`, `pickFromList`, normalización y alias).
- «Pasar a Dentalink» se puede pulsar otra vez tras corregir algo: agrega lo
  que falta y solo quita lo que se desmarcó explícitamente en el panel.
- Si «Otros …» ya tiene texto, se agrega después con coma, sin duplicar.
- Motivo y Enfermedad actual se escriben en su texto libre, no en sus listas.
- Las respuestas se conservan mientras la pestaña siga abierta (por paciente),
  por si se sale de la ficha a mitad de la entrevista.

## Lo que queda a criterio del constructor

- Estructura interna del código, módulos y nombres.
- Cómo esperar los resultados del buscador (sondeo con tiempo máximo, como en
  2.1.0).
- Tabla exacta de alias del catálogo, ampliable.
- Animaciones y detalles visuales menores dentro del estilo descrito.
