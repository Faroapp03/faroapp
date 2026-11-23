/** La proyección comprobada viaja dentro de cursos.html, bajo la misma política de sesión y sección que la página. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import type { prepararDiagnosticoClasificacion } from './diagnostico-clasificacion.ts';

const MARCA = '<template data-listado-cursos></template>';
export function prepararListadoCursos(web: string, datos: ReturnType<typeof prepararDiagnosticoClasificacion>) {
  const modulo = join(web, 'scripts/catalogo-cursos/carga-pagina.js');
  if (!datos) {
    writeFileSync(
      modulo,
      "export function cargarListado() { throw new Error('Falta la publicación acreditada de Cursos'); }\n",
    );
    return;
  }
  const pagina = join(web, 'cursos.html');
  const html = readFileSync(pagina, 'utf8');
  if (!html.includes(MARCA)) {
    throw new Error('Falta el contenedor del listado de Cursos');
  }
  const listado = proyectarListado(datos.catalogo, datos.evaluador);
  const bytes = gzipSync(JSON.stringify(listado), { level: 9 });
  const base64 = bytes.toString('base64url');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(pagina, html.replace(MARCA, `<template data-listado-cursos>${base64}</template>`));
  // Solo viajan la longitud y la huella en el módulo con SRI. Disponer del JS no concede acceso a ninguna ficha.
  writeFileSync(
    modulo,
    `import { leerListadoDePagina } from './leer-listado.js';\nexport function cargarListado() { return leerListadoDePagina(document.querySelector('template[data-listado-cursos]')?.content?.textContent, ${base64.length}, '${sha256}'); }\n`,
  );
}
