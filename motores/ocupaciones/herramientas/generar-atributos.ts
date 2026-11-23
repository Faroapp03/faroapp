// Genera la tabla de atributos del motor de preguntas del recorrido
// (motores/ocupaciones/src/recorrido/preguntas/atributos.json) a partir de datos oficiales: los del paquete (datos/)
// y una copia local validada de ESCO que no está en el repositorio (var/, ver abajo):
//   - jerarquía CIUO-08 y correspondencia con la CNO-11 (INE, datos/clasificaciones.json);
//   - tareas de la OIT por grupo (WP140, datos/oit.json) con su texto corto en castellano (datos/textos.json) y en
//     catalán (datos/catalan.json), los dos traducidos por Faro;
//   - ocupados por CNO de 3 cifras en Cataluña (Censo 2021, datos/cataluna.json), para el punto de partida;
//   - perfil de estudios y de situación profesional por CNO (Censo 2021, datos/censo.json);
//   - competencias esenciales de cada ocupación ESCO v1.2.1 con su grupo del pilar de competencias (S1-S8) y su campo
//     de conocimiento ISCED-F (copia local validada: var/actualizacion/validados/esco/biblioteca-esco.sqlite).
// No inventa valores: un atributo sin datos suficientes se queda fuera (el motor lo trata como «desconocido»).
// Uso: node motores/ocupaciones/herramientas/generar-atributos.ts [--comprobar]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { formatearTextoConBiome } from '../../../herramientas/comun/archivos.ts';
import { formaComun, palabrasDe } from '../src/busqueda/palabras.ts';
import { compararCadenas, contarPilar, priorYCenso, type Tablas } from './fuentes.ts';
import { type TareaTexto, tareasRepresentativas, vecinosDeTarea } from './similitud.ts';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const SALIDA = join(RAIZ, 'motores/ocupaciones/src/recorrido/preguntas/atributos.json');
const SQLITE = join(RAIZ, 'var/actualizacion/validados/esco/biblioteca-esco.sqlite');
const VERSION = 1;
/** Cifras de un subgrupo de la CIUO-08 (las etiquetas de nivel 3 son los títulos oficiales). */
const CIFRAS_SUBGRUPO = 3;

function leer<T>(archivo: string): T {
  return JSON.parse(readFileSync(join(RAIZ, 'datos', archivo), 'utf8')) as T;
}

function cargarTablas(): Tablas {
  return {
    oit: leer('oit.json'),
    textos: leer('textos.json'),
    catalan: leer('catalan.json'),
    clasificaciones: leer('clasificaciones.json'),
    cataluna: leer('cataluna.json'),
    censo: leer('censo.json'),
  };
}

/** Las tareas de cada grupo con sus palabras en forma común (del texto largo en castellano). */
function tareasPorGrupo(t: Tablas): Map<string, TareaTexto[]> {
  const porGrupo = new Map<string, TareaTexto[]>();
  for (const [id, tarea] of Object.entries(t.oit.tareas)) {
    const texto = t.textos.tareas[id];
    const ca = t.catalan.tareas[id];
    if (!(texto && ca)) {
      continue;
    }
    const palabras = palabrasDe(texto.texto_es).map(formaComun);
    const lista = porGrupo.get(tarea.isco08) ?? [];
    lista.push({ id, indice: tarea.indice, palabras, es: texto.corto, ca: ca.corto });
    porGrupo.set(tarea.isco08, lista);
  }
  return porGrupo;
}

const FUENTES = {
  jerarquia: 'OIT, CIUO-08; INE, CNO-11 y su correspondencia con la CIUO-08 (datos/clasificaciones.json)',
  tareas:
    'OIT, ILO Working Paper 140 (2025), tareas por grupo de la CIUO-08; texto corto traducido por Faro con IA (datos/textos.json y datos/catalan.json)',
  prior: 'INE, Censo de Población 2021, ocupados por CNO de 3 cifras en Cataluña (datos/cataluna.json)',
  censo: 'INE, Censos de Población y Viviendas 2021, perfil por CNO de 3 cifras o, si falta, de 2 (datos/censo.json)',
  esco: 'Comisión Europea, ESCO v1.2.1: competencias esenciales de cada ocupación, su grupo del pilar (S1-S8) y su campo ISCED-F (var/actualizacion/validados/esco/biblioteca-esco.sqlite)',
};

function generar(): string {
  const t = cargarTablas();
  const grupos = Object.keys(t.oit.ocupaciones).sort(compararCadenas);
  const base = new DatabaseSync(SQLITE, { readOnly: true });
  const pilar = contarPilar(base);
  base.close();
  const censo = priorYCenso(t, grupos);
  const tareas = tareasPorGrupo(t);
  const representativas = tareasRepresentativas(tareas);
  const salidaGrupos: Record<string, unknown> = {};
  const salidaTareas: Record<string, unknown> = {};
  for (const g of grupos) {
    const elegidas = representativas.get(g) ?? [];
    salidaGrupos[g] = {
      ...censo.get(g),
      ...pilar.get(g),
      ta: elegidas.map((x) => x.id),
    };
    for (const tarea of elegidas) {
      salidaTareas[tarea.id] = { es: tarea.es, ca: tarea.ca, ve: vecinosDeTarea(tarea, g, tareas) };
    }
  }
  const etiquetas3: Record<string, { es: string; ca: string }> = {};
  const etiquetas4: Record<string, { es: string; ca: string }> = {};
  for (const [codigo, titulo] of Object.entries(t.clasificaciones.isco08_es)) {
    const etiqueta = { es: titulo, ca: t.catalan.grupos[codigo] ?? titulo };
    if (codigo.length === CIFRAS_SUBGRUPO) {
      etiquetas3[codigo] = etiqueta;
    } else if (codigo.length === CIFRAS_SUBGRUPO + 1 && grupos.includes(codigo)) {
      etiquetas4[codigo] = etiqueta;
    }
  }
  const datos = {
    version: VERSION,
    fuentes: FUENTES,
    grupos: salidaGrupos,
    tareas: salidaTareas,
    etiquetas3,
    etiquetas4,
  };
  return formatearTextoConBiome(JSON.stringify(datos), SALIDA);
}

// Solo al ejecutarlo: importarlo (desde una prueba, por ejemplo) no escribe ni comprueba nada.
if (import.meta.main) {
  const texto = generar();
  if (process.argv.includes('--comprobar')) {
    if (readFileSync(SALIDA, 'utf8') !== texto) {
      console.error('atributos.json no está al día: node motores/ocupaciones/herramientas/generar-atributos.ts');
      process.exit(1);
    }
  } else {
    writeFileSync(SALIDA, texto);
    console.log(`Escrito ${SALIDA} (${Buffer.byteLength(texto)} bytes)`);
  }
}
