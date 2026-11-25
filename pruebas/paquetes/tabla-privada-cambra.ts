// La tabla completa del ODEE y la Cambra es privada y no está en Git (datos/README.md, «cambra.json»). Las pruebas de
// Node la encuentran con la única regla que hay, la de plataforma_datos/ia_y_trabajo/fuentes/cambra/tabla_privada.py:
// datos/cambra.json o, donde el ciclo de actualización acaba de admitirla y ya no está en el paquete, su conjunto
// validado (var/actualizacion/validados/cambra/cambra.json), siempre que tenga la huella que fija el manifiesto. Si no
// está en ninguno de los dos sitios, o no es la fijada, la comprobación falla con el motivo: no se omite.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exposicionDelGrupo } from '../../src/dominio/informe-breve-contexto.ts';
import type { DatosCambra } from '../../src/dominio/tipos-paquete.ts';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

/** El repositorio: su entorno de Python es el que comprueba la tabla, sea cual sea la instalación que se mira. */
const REPOSITORIO = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = join(REPOSITORIO, '.venv', 'bin', 'python');
const MODULO = 'plataforma_datos.ia_y_trabajo.fuentes.cambra.tabla_privada';
/** Arrancar el módulo y calcular una huella de unas decenas de kilobytes tarda menos de un segundo. */
const PLAZO_MS = 60_000;
const CABECERA = 'La igualdad de la parte pública de la Cambra necesita la tabla completa';

/** Lo que escribió el proceso en su salida de errores, si llegó a arrancar. */
function erroresDe(fallo: unknown): string {
  const errores = (fallo as { stderr?: unknown } | null)?.stderr;
  return typeof errores === 'string' ? errores.trim() : '';
}

/**
 * La ruta de la tabla privada comprobada en una instalación, con la regla y la huella de `tabla_privada`.
 *
 * @param instalacion - La raíz de la instalación; por omisión, este repositorio.
 * @returns La ruta absoluta de la tabla que fija el manifiesto.
 * @throws {Error} Si no está ni en datos/ ni en el conjunto validado, o la que hay no es la fijada.
 */
export function rutaDeLaTablaPrivada(instalacion: string = REPOSITORIO): string {
  let salida: string;
  try {
    salida = execFileSync(PYTHON, ['-B', '-m', MODULO, 'ruta', '--raiz', instalacion], {
      cwd: REPOSITORIO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PLAZO_MS,
    });
  } catch (fallo) {
    const motivo = erroresDe(fallo) || `No se pudo ejecutar ${MODULO} con .venv/bin/python: prepara el entorno.`;
    throw new Error(`${CABECERA}. ${motivo}`, { cause: fallo });
  }
  const ruta = salida.trim();
  assert.ok(ruta && !ruta.includes('\n'), `${MODULO} ruta no dio una ruta`);
  return join(instalacion, ruta);
}

function leerJson(ruta: string): DatosCambra {
  return JSON.parse(readFileSync(ruta, 'utf8')) as DatosCambra;
}

/**
 * Comprueba que, con la parte pública del paquete, el informe da lo mismo que con la tabla completa en todas las
 * ocupaciones del estudio, y que el reparto por sexo publicado es el de la tabla.
 *
 * @param instalacion - La raíz de la instalación; por omisión, este repositorio.
 * @returns Cuántas ocupaciones se compararon.
 * @throws {Error} Si falta la tabla, no es la fijada o la parte pública no da lo mismo.
 */
export function compararConLaTablaCompleta(instalacion: string = REPOSITORIO): number {
  const completa = leerJson(rutaDeLaTablaPrivada(instalacion));
  const publica = leerJson(join(instalacion, 'datos', 'exposicion-cambra.json'));
  const codigos = Object.keys(completa.ocupaciones_cno3 ?? {});
  assert.ok(codigos.length > 0, 'la tabla completa no tiene ocupaciones');
  assert.deepEqual(Object.keys(publica.ocupaciones_cno3 ?? {}), codigos);
  for (const idioma of ['es', 'ca'] as const) {
    for (const cno of codigos) {
      const conLaTabla = exposicionDelGrupo([`${cno}0`], datosMinimos({ cambra: completa }), idioma);
      const conLaPublica = exposicionDelGrupo([`${cno}0`], datosMinimos({ cambra: publica }), idioma);
      assert.ok(conLaTabla, cno);
      assert.deepEqual(conLaPublica, conLaTabla, cno);
    }
  }
  assert.equal(publica.fuente, completa.fuente);
  assert.deepEqual(publica.genero, {
    mujeres_exposicion_media_o_alta: completa.genero.mujeres_exposicion_media_o_alta,
    hombres_exposicion_media_o_alta: completa.genero.hombres_exposicion_media_o_alta,
    pagina_impresa: completa.genero.pagina_impresa,
  });
  return codigos.length;
}
