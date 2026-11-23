/**
 * Clasificación cerrada de pruebas mjs. Las nuevas del producto deben asignarse explícitamente a una suite, o ser un
 * ensayo con orden propia; las de una extensión se clasifican por su carpeta de pruebas del registro.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRUEBAS_NAVEGADOR = new Set([
  'pruebas/navegadores/acceso-web-vista.test.mjs',
  'pruebas/navegadores/bandera-catalana.test.mjs',
  'pruebas/navegadores/fechas.test.mjs',
  'pruebas/navegadores/informe-impreso.test.mjs',
  'pruebas/navegadores/instalacion-cuota.test.mjs',
  'pruebas/navegadores/invitacion-portal.test.mjs',
  'pruebas/navegadores/panel.test.mjs',
  'pruebas/navegadores/paso-a-privada.test.mjs',
  'pruebas/navegadores/pensamiento-tarjeta.test.mjs',
  'pruebas/navegadores/portada-cuenta.test.mjs',
  'pruebas/navegadores/portada-publica.test.mjs',
  'pruebas/navegadores/portal-preferencias.test.mjs',
  'pruebas/navegadores/presupuesto-cache.test.mjs',
  'pruebas/navegadores/recorrido-en-la-copia.test.mjs',
  'pruebas/navegadores/recorrido-fragmento.test.mjs',
  'pruebas/navegadores/textos-entrada.test.mjs',
  'pruebas/navegadores/trabajador-de-cursos.test.mjs',
]);
const PRUEBAS_MJS_UNIDAD = new Set([
  'pruebas/navegadores/descargas-js-autenticacion.test.mjs',
  'pruebas/navegadores/portal-remoto-utilidades.test.mjs',
  'pruebas/navegadores/presupuesto-cifras.test.mjs',
  'pruebas/navegadores/presupuesto-descargas.test.mjs',
  'pruebas/navegadores/presupuesto-limpieza.test.mjs',
  'pruebas/navegadores/presupuesto-plazo.test.mjs',
  'pruebas/navegadores/presupuesto-proceso.test.mjs',
  'pruebas/navegadores/presupuesto-servidor-cortes.test.mjs',
  'pruebas/navegadores/presupuesto-worker-oficial.test.mjs',
  'pruebas/navegadores/remoto-ayudas.test.mjs',
  'pruebas/navegadores/remoto-unificado.test.mjs',
]);

/**
 * Pruebas de navegador que no caben en la batería de `npm run verificar` (su plazo total es de 600 s) y se ejecutan con
 * su propia orden de package.json, como los demás ensayos `probar:*`. Cada una, con su orden. No es una omisión: el
 * descubrimiento de `verificar.ts` exige que la orden exista y ejecute el archivo (ordenDelEnsayo).
 * - arranque-bloqueado: espera de verdad el plazo de la clave (15 s) y el del Worker (120 s) en cada motor; unos 140 s
 *   por motor.
 */
const ENSAYOS_CON_ORDEN: ReadonlyMap<string, string> = new Map([
  ['pruebas/navegadores/arranque-bloqueado.test.mjs', 'probar:arranque-bloqueado'],
]);

/**
 * La orden de package.json (en `raiz`) que ejecuta el ensayo `ruta`, o null si no está declarado como ensayo, si
 * package.json no tiene su orden o si esa orden no lo ejecuta (ordenQueEjecuta).
 *
 * @param raiz - La raíz del proyecto, con su package.json.
 * @param ruta - El ensayo, relativo a la raíz y con «/».
 */
export function ordenDelEnsayo(raiz: string, ruta: string): string | null {
  const orden = ENSAYOS_CON_ORDEN.get(ruta);
  if (!orden) {
    return null;
  }
  let paquete: { scripts?: Record<string, unknown> };
  try {
    paquete = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
  } catch {
    return null;
  }
  const comando = paquete.scripts?.[orden];
  return typeof comando === 'string' && ordenQueEjecuta(comando, ruta) ? orden : null;
}

/** Un argumento del ensayo tras su ruta: sin espacios ni signos que el intérprete de órdenes interprete. */
const ARGUMENTO_DEL_ENSAYO = /^[\w.,:=@/+-]+$/u;

/**
 * Si `comando` ejecuta el archivo `ruta` con node: exactamente `node <ruta>`, seguido, si acaso, de argumentos del
 * propio ensayo (como `--motor chromium`). No admite opciones de node antes de la ruta: la orden real no necesita
 * ninguna, y algunas (`--check`, `--eval`, `--print`) harían que node no ejecutara el ensayo. Tampoco admite
 * órdenes encadenadas ni redirecciones, que podrían ocultar su resultado (`|| true`, `; exit 0`).
 */
function ordenQueEjecuta(comando: string, ruta: string): boolean {
  const [programa, archivo, ...argumentos] = comando.trim().split(/\s+/u);
  return (
    programa === 'node' && archivo === ruta && argumentos.every((argumento) => ARGUMENTO_DEL_ENSAYO.test(argumento))
  );
}

/**
 * La suite de una prueba mjs. Las del producto se declaran en las listas de arriba: de navegador, de unidad o ensayo
 * con orden propia (`ensayo`, fuera de las baterías de verificar). Las de la carpeta de pruebas de una extensión
 * instalada (su `carpetaDePruebas` del registro, que se recibe aquí) son de navegador: así entran y salen con la
 * extensión, y sus pruebas de unidad se escriben en TypeScript o JavaScript.
 *
 * @param ruta - La prueba, relativa a la raíz y con «/».
 * @param carpetasDeExtensiones - Las carpetas de pruebas de las extensiones instaladas, relativas a la raíz.
 */
export function tipoPruebaMjs(
  ruta: string,
  carpetasDeExtensiones: readonly string[] = [],
): 'navegador' | 'unidad' | 'ensayo' | undefined {
  if (ENSAYOS_CON_ORDEN.has(ruta)) {
    return 'ensayo';
  }
  if (PRUEBAS_NAVEGADOR.has(ruta) || carpetasDeExtensiones.some((carpeta) => ruta.startsWith(`${carpeta}/`))) {
    return 'navegador';
  }
  if (PRUEBAS_MJS_UNIDAD.has(ruta)) {
    return 'unidad';
  }
  return undefined;
}

/**
 * Las entradas de la clasificación que no son un archivo dentro de `raiz`. El descubrimiento de `verificar.ts` solo
 * consulta la lista para las pruebas que encuentra, así que una entrada sin archivo no fallaría nunca por sí sola.
 */
export function pruebasMjsAusentes(raiz: string): string[] {
  return [...PRUEBAS_NAVEGADOR, ...PRUEBAS_MJS_UNIDAD, ...ENSAYOS_CON_ORDEN.keys()].filter(
    (ruta) => !statSync(join(raiz, ruta), { throwIfNoEntry: false })?.isFile(),
  );
}

// La lista describe las pruebas de este producto: se contrasta con su raíz al cargarla, antes de clasificar nada.
const ausentes = pruebasMjsAusentes(fileURLToPath(new URL('../', import.meta.url)));
if (ausentes.length) {
  throw new Error(`Prueba mjs clasificada que no existe: ${ausentes.join(', ')}`);
}
