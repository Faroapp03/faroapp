// Publica el caso ficticio de informe-ejemplo.json con el cálculo local del recorrido, sin consultas de red.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Idioma } from '../../src/comun/idioma.ts';
import { esFormaDe, esRegistroDe, esTexto } from '../../src/comun/json.ts';
import { esEntrada } from '../../src/dominio/esquema-entrada.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { ejecutar, orden } from '../comun/opciones.ts';

const PAGINA = new URL('../../web/informe-ejemplo.html', import.meta.url);
const CASO = new URL('./informe-ejemplo.json', import.meta.url);
const DATOS = fileURLToPath(new URL('../../datos/', import.meta.url));
const INICIO = '<main id="contenido"';
const FIN = '</main>';
const INICIO_CATALAN = '<template id="informe-ejemplo-ca">';
const FIN_CATALAN = '</template>';
const AVISO_CATALAN = '<!-- biome-ignore format: misma salida del motor que la versión castellana -->';
const PLANTILLA_CATALANA =
  /^\s*(?:<!-- biome-ignore format:[\s\S]*?-->\s*)?<template\s+id="informe-ejemplo-ca"(?=[\s>])/u;
const esCaso = esFormaDe({
  entrada: esEntrada,
  catalan: esFormaDe({ tareas: esRegistroDe(esTexto), frases: esRegistroDe(esTexto) }),
});

/** Sustituye únicamente el cuerpo generado; conserva íntegra la envoltura de la página. */
export function colocarInforme(pagina: string, informe: string, catalan: string): string {
  const inicio = pagina.indexOf(INICIO);
  const cierre = pagina.indexOf(FIN, inicio);
  if (inicio < 0 || cierre < 0) {
    throw new Error('La página de ejemplo no contiene el main completo del informe');
  }
  let resto = pagina.slice(cierre + FIN.length);
  // La versión alternativa es inerte: ni encabezados ni controles duplicados en la página activa o el PDF.
  if (PLANTILLA_CATALANA.test(resto)) {
    const fin = /<\/template\s*>/u.exec(resto);
    if (!fin) {
      throw new Error('La versión catalana del ejemplo no contiene su template completo');
    }
    resto = resto.slice(fin.index + fin[0].length);
  }
  return `${pagina.slice(0, inicio)}${informe}\n    ${AVISO_CATALAN}\n    ${INICIO_CATALAN}${catalan}${FIN_CATALAN}${resto}`;
}

/** La entrada ficticia se valida como cualquier entrada del motor. No admite estimaciones fuera de escala. */
export function informeDelEjemplo(idioma: Idioma = 'es'): string {
  const caso: unknown = JSON.parse(readFileSync(CASO, 'utf8'));
  if (!esCaso(caso)) {
    throw new Error('El caso ficticio del informe no tiene una entrada válida');
  }
  const entrada = {
    ...caso.entrada,
    tareas: caso.entrada.tareas.map((tarea) => {
      const traducida = caso.catalan.tareas[tarea.id];
      if (!traducida?.trim()) {
        throw new Error(`Falta el texto catalán de la tarea de ejemplo ${tarea.id}`);
      }
      return idioma === 'ca' ? { ...tarea, texto: traducida } : tarea;
    }),
  };
  const datos = cargarDatos(DATOS);
  const informe = construirInforme(entrada, datos, {
    idioma,
    formacion: null,
    frasesTraducidas: idioma === 'ca' ? new Map(Object.entries(caso.catalan.frases)) : new Map(),
  });
  return renderizarInformeBreve(construirInformeBreve(informe, datos), informe, { ejemplo: true });
}

/** Compone antes de escribir; --comprobar detecta una página atrasada sin modificarla. */
function principal(): void {
  const { values } = orden('node herramientas/web/informe-ejemplo.ts [--comprobar]').leer({
    options: { comprobar: { type: 'boolean' } },
  });
  const anterior = readFileSync(PAGINA, 'utf8');
  const siguiente = colocarInforme(anterior, informeDelEjemplo('es'), informeDelEjemplo('ca'));
  if (values.comprobar) {
    if (anterior !== siguiente) {
      throw new Error('Informe de ejemplo desactualizado: ejecutar npm run informe:ejemplo');
    }
  } else {
    writeFileSync(PAGINA, siguiente);
  }
  console.log(
    values.comprobar ? 'Informe de ejemplo comprobado' : 'Informe de ejemplo preparado; ejecutar npm run web:preparar',
  );
}

if (import.meta.main) {
  await ejecutar(principal, 'Informe de ejemplo');
}
