// ==UserScript==
// @name         Dentalink - Medicamentos (textos compartidos)
// @namespace    https://odontofamily.local/dentalink-medicamentos
// @version      1.0.0
// @description  Textos de prescripción compartidos por Recetas rápidas y Evoluciones periodoncia. Se carga vía @require.
// @author       Cris
// @grant        none
// ==/UserScript==

// Edite aquí la posología: Recetas rápidas y Evoluciones usan estos mismos textos.
(function () {
  "use strict";

  const TEXTOS = {
    naproxeno: "Naproxeno 500mg #9 Tomar 1 tableta cada 8 horas por 3 días.",
    amoxicilina: "Amoxicilina 500mg #21 Tomar 1 cápsula cada 8 horas por 7 días.",
    azitromicina: "Azitromicina 500mg #3 Tomar 1 tableta cada 24 horas por 3 días.",
    interproximal: "Cepillo interproximal para utilizar entre los dientes, de diferentes tamaños",
    perioaid: "Perioaid, usar hasta terminar el envase, no comprar sin receta de periodoncia, cambia sabor de comidas y cambia color de dientes, uso hasta terminar y no volver a comprar. Modo de uso: 1 hora después del cepillado.",
    indicacionesPostquirurgicas: "No escupir, no bebidas con pitillos, no fumar, no agacharse, no ejercicio, no cosas calientes, no alcohol, limpiar la zona con mucho cuidado, retiro de sutura a los 8 días, sin cita."
  };

  const shared = window.__dlkMedicamentos || {};
  shared.version = "1.0.0";
  shared.textos = Object.assign({}, TEXTOS, shared.textos || {});
  window.__dlkMedicamentos = shared;
})();
