// La medición del motor empaquetado con el medidor del producto, sin tocarlo: una raíz de producto (--producto) cuyos
// módulos del motor son las piezas del paquete (paquete.ts) y cuyos datos son los publicados en la construcción. Los
// bancos, la configuración, las semillas y las claves de ruido son los del producto.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const MEDIDOR = join(RAIZ, 'motores/ocupaciones/herramientas/medir-casos.ts');
const ADAPTADOR = pathToFileURL(fileURLToPath(new URL('./paquete.ts', import.meta.url))).href;

/** Las tres variantes de la referencia (motores/ocupaciones/banco/README.md) y sus opciones. */
export const VARIANTES: Readonly<Record<string, readonly string[]>> = {
  normal: [],
  ruido: ['--ruido', 'personas'],
  'sin-vectores': ['--sin-vectores'],
};

/**
 * Las variantes pedidas (FARO_VARIANTES, separadas por comas): vacía o ausente, las tres, en su orden. Un nombre que no
 * es una de ellas es un error: no se descarta en silencio.
 */
export function variantesPedidas(pedidas: string | undefined): string[] {
  const todas = Object.keys(VARIANTES);
  if (pedidas === undefined || pedidas.trim() === '') {
    return todas;
  }
  const nombres = pedidas.split(',').map((nombre) => nombre.trim());
  const desconocidas = nombres.filter((nombre) => !todas.includes(nombre));
  if (desconocidas.length) {
    throw new Error(`FARO_VARIANTES: «${desconocidas.join(', ')}» no es ${todas.join(', ')}`);
  }
  return todas.filter((variante) => nombres.includes(variante));
}

/** Los módulos que el medidor carga del producto y lo que cada uno toma del paquete. */
const MODULOS: Readonly<Record<string, readonly string[]>> = {
  'src/plataforma/node/datos.ts': ['cargarDatos'],
  'motores/ocupaciones/src/recorrido/preguntas/atributos.ts': ['comprobarAtributos'],
  'motores/ocupaciones/src/recorrido/pantalla/servicio.ts': ['pasoDePantalla', 'buscar', 'textoDeBusqueda'],
  'motores/ocupaciones/src/recorrido/pantalla/previa-fusion.ts': [
    'usarVectores',
    'previaCalibrada',
    'textoParaVectores',
    'usarClasificador',
    'CLASIFICADOR_EN_LA_PANTALLA',
  ],
  'motores/ocupaciones/src/recorrido/fusion/vectores-movil.ts': ['cargarDesdeContenedor'],
  'motores/ocupaciones/src/recorrido/fusion/clasificador-movil.ts': ['cargarClasificador'],
  'motores/ocupaciones/src/busqueda/ocupaciones.ts': ['textoComoEnEsco'],
};
/**
 * Lo que el medidor lee como archivo del producto: la tabla de atributos, con la que mide (paquete.ts exige antes que
 * sea la que lleva el paquete), y, solo para su procedencia, el sello y los modelos.
 */
const DEL_PRODUCTO = ['src/recorrido/preguntas/atributos.json', 'sello.json', 'modelos/modelo-lexico.json'].concat(
  'modelos/modelo-estatico.json',
);

/**
 * Prepara en `destino` la raíz de producto del motor empaquetado de la construcción `web`.
 *
 * @param web - La carpeta web/ de la construcción.
 * @param destino - Una carpeta vacía.
 */
export function prepararRaiz(web: string, destino: string): void {
  for (const [ruta, nombres] of Object.entries(MODULOS)) {
    mkdirSync(dirname(join(destino, ruta)), { recursive: true });
    writeFileSync(join(destino, ruta), `export { ${nombres.join(', ')} } from ${JSON.stringify(ADAPTADOR)};\n`);
  }
  for (const ruta of DEL_PRODUCTO) {
    mkdirSync(dirname(join(destino, 'motores/ocupaciones', ruta)), { recursive: true });
    symlinkSync(join(RAIZ, 'motores/ocupaciones', ruta), join(destino, 'motores/ocupaciones', ruta));
  }
  const version = readdirSync(join(web, 'paquete'))[0] ?? '';
  symlinkSync(join(web, 'paquete', version), join(destino, 'datos'));
}

/** La huella SHA-256 de `resultados` de una medición, como la da la referencia. */
export function huellaDeResultados(archivo: string): string {
  const { resultados } = JSON.parse(readFileSync(archivo, 'utf8')) as { resultados: unknown };
  return createHash('sha256').update(JSON.stringify(resultados)).digest('hex');
}

/** Las huellas de referencia de `resultados` de cada variante, de la tabla del README de los bancos. */
export function huellasDeReferencia(): Record<string, string> {
  const readme = readFileSync(join(RAIZ, 'motores/ocupaciones/banco/README.md'), 'utf8');
  const de = (fila: string): string => new RegExp(`\\| ${fila} \\| \`([0-9a-f]{64})\``).exec(readme)?.[1] ?? '';
  return { normal: de('sin ruido'), ruido: de('con ruido'), 'sin-vectores': de('sin vectores') };
}

/**
 * Mide con el medidor del producto (con --traza) una variante del producto `producto`.
 *
 * @returns La salida del medidor y su código.
 */
export function medir(producto: string, variante: string, salida: string, web = ''): { codigo: number; texto: string } {
  const argumentos = [MEDIDOR, '--traza', ...(VARIANTES[variante] ?? []), '--producto', producto, '--salida', salida];
  const hecho = spawnSync(process.execPath, argumentos, {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, FARO_PAQUETE_WEB: web },
    maxBuffer: 1 << 24,
  });
  return { codigo: hecho.status ?? 1, texto: `${hecho.stdout}${hecho.stderr}` };
}
