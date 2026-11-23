# Presupuesto de rendimiento

Este documento explica cómo se mide el rendimiento de la web y qué umbrales hacen fallar una prueba. Las órdenes y el
detalle de cada ensayo están en las [comprobaciones de navegador](../pruebas/navegadores/README.md).

## Qué se mide

El ensayo `pruebas/navegadores/presupuesto-rendimiento.mjs` (`npm run probar:presupuesto`) mide cada escenario
(portada, acceso, inicio, recorrido real e informe) en una primera visita con perfil limpio, por navegador y por
condición. Las condiciones están en `pruebas/navegadores/presupuesto-condiciones.mjs`: escritorio sin limitar, segunda
visita en escritorio, móvil con 4G lenta y móvil con 3G.

De cada escenario se anotan los tiempos de cuatro hitos: la interfaz usable, el primer análisis completo en el
recorrido real, la copia web lista y la copia completa lista en el dispositivo. También se anotan los megabytes servidos
por el servidor del ensayo, con su compresión.

## JavaScript por escenario

`pruebas/navegadores/descargas-js.mjs` cuenta en el servidor los JavaScript que descarga cada escenario en una primera
visita con perfil limpio, en direcciones distintas y en peticiones totales. La prueba falla si alguna de las dos
cifras supera el presupuesto de su escenario, que está en `pruebas/navegadores/presupuesto-descargas.mjs` y es el
máximo medido en Chromium, Firefox y WebKit:

| Escenario | Direcciones | Peticiones |
| --- | ---: | ---: |
| Portada | 0 | 0 |
| Acceso | 0 | 0 |
| Inicio | 70 | 82 |
| Recorrido real | 70 | 99 |
| Informe | 70 | 82 |

Un escenario sin presupuesto hace fallar la prueba.

## Tiempos y tráfico

Los tiempos y el tráfico no tienen un umbral que haga fallar una prueba, porque dependen del equipo que mide. Con
varias construcciones, el ensayo toma la primera como referencia y el resumen añade la tabla de diferencias de las
demás; con una sola, anota sus cifras sin compararlas.
