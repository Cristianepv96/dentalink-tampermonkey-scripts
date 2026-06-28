# 🦷 Dentalink - Scripts Tampermonkey
Scripts de [Tampermonkey](https://www.tampermonkey.net/) para automatizar tareas clínicas de periodoncia en [Dentalink](https://www.dentalink.cl/).

---

## 📋 Scripts disponibles

| Script | Descripción | Instalar |
|---|---|---|
| **Evoluciones periodoncia** | Botones de textos rápidos para evoluciones de valoración, alisado cerrado/abierto, alargamiento y detartraje. Incluye formularios modales para datos variables (dientes, anestesia, duración). | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Evoluciones%20periodoncia.user.js) |
| **Autollenado orden de servicio** | Rellena automáticamente los campos base de la orden de servicio (fecha, NRO, origen, prioridad, código K053, tipo de diagnóstico). | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Autollenado%20orden%20de%20servicio.user.js) |
| **Antecedentes por defecto** | Rellena textareas de antecedentes (motivo de consulta, enfermedad actual, antecedentes odontológicos) con textos por defecto cuando están vacíos. | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Antecedentes%20por%20defecto.user.js) |
| **Botones receta rápida** | Botones para insertar recetas predefinidas (Naproxeno, Amoxicilina, Azitromicina) en el editor de recetas. | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Botones%20receta%20rapida.user.js) |
| **CUPS rápido** | Panel flotante con códigos CUPS comunes (SAVIA SALUD y FOMAG) para insertar rápidamente en la orden de servicio. | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20CUPS%20rapido%20orden%20de%20servicio.user.js) |
| **Resumen periodontograma** | Genera un resumen clínico de bolsas periodontales, sangrado, movilidad y furca desde el periodontograma de Dentalink. Incluye copiado al portapapeles. | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Resumen%20periodontograma.user.js) |
| **Registro diario a Google Sheets** | Envía o copia desde el plan de tratamiento una fila lista para el registro diario: fecha, sede, paciente, ID plan, título y valor. | [⬇️ Instalar](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/Dentalink%20-%20Registro%20diario%20a%20Google%20Sheets.user.js) |

> **Nota:** También se requiere instalar la dependencia compartida **[dentalink-utils.js](https://raw.githubusercontent.com/Cristianepv96/dentalink-tampermonkey-scripts/main/dentalink-utils.js)**, pero esta se carga automáticamente vía `@require` al instalar cualquier script.

---

## 🚀 Instalación

### Requisitos previos

1. Tener instalado **Google Chrome** (u otro navegador basado en Chromium)
2. Instalar la extensión [Tampermonkey](https://www.tampermonkey.net/)

### Instalar un script

1. Haz clic en el enlace **"⬇️ Instalar"** del script deseado en la tabla de arriba.
2. Tampermonkey abrirá una pestaña mostrando el código del script.
3. Haz clic en el botón **"Instalar"** (o **"Install"**).
4. ¡Listo! El script se ejecutará automáticamente en las páginas de Dentalink.

### Instalar todos los scripts

Repite el proceso para cada script de la tabla.

---

## 🔄 Actualización automática

Los scripts se actualizan automáticamente desde este repositorio. Para configurar el intervalo:

1. Abre **Tampermonkey** → ícono de engranaje → **Configuración**
2. Ve a la pestaña **General**
3. En **"Actualizaciones de scripts"**, selecciona un intervalo:
   - **Cada 12 horas** (recomendado)
   - **Cada hora** (para obtener cambios más rápido)
4. Guarda los cambios

### Forzar actualización manual

Si necesitas obtener la última versión inmediatamente:

1. Abre **Tampermonkey** → **Utilidades**
2. Haz clic en **"Buscar actualizaciones de scripts"**

> **Importante:** Cada vez que se publique una nueva versión en este repositorio, el campo `@version` del script se incrementará y Tampermonkey lo detectará automáticamente.

---

## Registro diario directo a Google Sheets

El script **Registro diario a Google Sheets** puede enviar la fila directamente a una hoja mediante Google Apps Script. El botón **Copiar** queda como respaldo manual.

### Apps Script

1. Abre la hoja de cálculo del registro diario.
2. Ve a **Extensiones → Apps Script**.
3. Pega el contenido de [`apps-script/registro-diario.gs`](apps-script/registro-diario.gs).
4. Despliega como **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario con el enlace**
5. La URL del Web App ya viene incluida en el userscript.

### Tampermonkey

1. Abre el menú de Tampermonkey del script.
2. Ejecuta **Configurar envio a Google Sheets**.
3. Confirma la URL y el token prellenados.
4. En Dentalink, usa **Enviar**. El panel confirmará la fila agregada o avisará si ya existía.

---

## 🛠️ Personalización

### Evoluciones periodoncia

El script de evoluciones tiene un objeto `CONFIG` al inicio del archivo donde puedes personalizar:

```javascript
const CONFIG = {
  doctor: "Dr. Cristian Pena. Periodoncista.",
  diagnostico: "K05.3 - Periodontitis crónica",
  anestesia: { farmaco: "Lidocaina 2% con epinefrina 1:80.000" },
  farmacologia: { naproxeno: "Naproxeno 500mg tabletas #9 ..." },
  sutura: "Seda 3.0 punto simple",
  notaControles: "NOTA IMPORTANTE: Se informa al paciente ..."
};
```

Edita estos valores directamente en Tampermonkey para adaptar los textos a tus necesidades.

---

## 📁 Estructura del repositorio

```
├── dentalink-utils.js                              # Utilidades compartidas (@require)
├── Dentalink - Evoluciones periodoncia.user.js     # Textos rápidos evoluciones
├── Dentalink - Autollenado orden de servicio.user.js
├── Dentalink - Antecedentes por defecto.user.js
├── Dentalink - Botones receta rapida.user.js
├── Dentalink - CUPS rapido orden de servicio.user.js
├── Dentalink - Resumen periodontograma.user.js
├── Dentalink - Registro diario a Google Sheets.user.js
├── apps-script/
│   └── registro-diario.gs
└── README.md
```

---

## 👨‍⚕️ Autor

**Dr. Cristian Peña** — Periodoncista  
Desarrollado para agilizar el flujo de trabajo clínico en Dentalink.
