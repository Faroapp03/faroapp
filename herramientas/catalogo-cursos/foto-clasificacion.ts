/** Foto de referencia de la clasificación de cursos que ve la persona, y su comparación con otra foto. Solo lee. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';
import { ejecutar, orden } from '../comun/opciones.ts';
import { compararFotos, type FotoClasificacion, serializarFoto } from './comparar-fotos.ts';
import { fotoDeCursos } from './foto-cursos.ts';
import { fotoDelSoc, type PaqueteDelSoc } from './foto-soc.ts';

export const FIXTURE = new URL('../../pruebas/fixtures/foto-clasificacion-20261118.utf8', import.meta.url);
const WEB = new URL('../../web/', import.meta.url);
const DATOS = new URL('../../datos/', import.meta.url);

/** El catálogo publicado, comprobado contra su referencia con el mismo lector que la web. */
export function catalogoPublicado(): EntregaCatalogo {
  return leerCatalogo(readFileSync(new URL(REFERENCIA.ruta, WEB)), REFERENCIA);
}

export function paqueteDelSoc(): PaqueteDelSoc {
  const leer = (archivo: string) => JSON.parse(readFileSync(new URL(archivo, DATOS), 'utf8'));
  return { formacion: leer('formacion.json'), enlaces: leer('enlaces-comprobados.json') };
}

export function fotoClasificacion(catalogo: EntregaCatalogo, paquete: PaqueteDelSoc): FotoClasificacion {
  return {
    catalogo: { sha256: REFERENCIA.sha256, corte_proyeccion_utc: catalogo.corte_proyeccion_utc },
    soc: { fecha_cursos: paquete.formacion.fecha_cursos },
    unidades: { cursos: fotoDeCursos(catalogo), soc: fotoDelSoc(paquete) },
  };
}

function comparar(ruta: string, actual: FotoClasificacion): void {
  const anterior = JSON.parse(readFileSync(ruta, 'utf8')) as FotoClasificacion;
  const comparacion = compararFotos(anterior, actual);
  console.log(JSON.stringify(comparacion, null, 2));
  console.error(
    `Pérdidas: ${comparacion.perdidas.length} · cambios: ${comparacion.cambios.length} · ganancias: ${comparacion.ganancias.length}`,
  );
  if (comparacion.perdidas.length > 0) {
    process.exitCode = 1;
  }
}

function principal(): void {
  const { values } = orden(
    'node herramientas/catalogo-cursos/foto-clasificacion.ts [--comprobar | --comparar <foto anterior>]',
  ).leer({ options: { comprobar: { type: 'boolean' }, comparar: { type: 'string' } } });
  const actual = fotoClasificacion(catalogoPublicado(), paqueteDelSoc());
  if (values.comparar) {
    comparar(values.comparar, actual);
    return;
  }
  const bytes = serializarFoto(actual);
  if (!values.comprobar) {
    writeFileSync(FIXTURE, bytes);
    return;
  }
  if (readFileSync(FIXTURE, 'utf8') !== bytes) {
    throw new Error('La foto de la clasificación no coincide con la fixture; compárala con --comparar');
  }
}
if (import.meta.main) {
  await ejecutar(principal, 'Foto de la clasificación de cursos');
}
