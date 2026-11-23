// Precarga de la medición (node scripts/verificar-datos.ts --medir): anota qué archivo de pruebas abre algo de lo que
// produce la cadena de datos. Envuelve las lecturas de node:fs y node:fs/promises y la carga de módulos (JSON
// incluidos), y escribe una línea «prueba<TAB>ruta» en FARO_TRAZA_DATOS. Sin esa variable no hace nada.
// La prueba de un proceso es el único *.test.* de sus argumentos; sus hijos la heredan por FARO_TRAZA_PRUEBA.

import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESTINO = process.env.FARO_TRAZA_DATOS;
const RAIZ = fileURLToPath(new URL('../', import.meta.url));
/** Lo que produce la cadena de datos, relativo a la raíz, como en scripts/verificar-datos.ts y la web local. */
export const CARPETAS_TRAZADAS = [
  'datos/',
  'web/datos/',
  'web/recursos/',
  // De la web local, solo lo que sale del paquete: su código es el de la revisión, ya probado.
  '.web-local/web/datos/',
  '.web-local/web/paquete/',
  '.web-local/web/recursos/',
  'var/actualizacion/validados/',
];
const ORIGINALES = { appendFileSync: fs.appendFileSync, realpathSync: fs.realpathSync.native };

/** La ruta desde la raíz si cae en una carpeta trazada, o null. */
export function rutaTrazada(raiz: string, ruta: string): string | null {
  const relativa = relative(raiz, ruta).split(sep).join('/');
  // El lector de web/recursos/ es código generado desde src/ (web:comprobar lo coteja), no algo del paquete.
  if (/^(?:\.web-local\/)?web\/recursos\/.*\.js$/.test(relativa)) {
    return null;
  }
  return CARPETAS_TRAZADAS.some((carpeta) => `${relativa}/`.startsWith(carpeta)) ? relativa : null;
}

function pruebaDelProceso(): string | undefined {
  if (process.env.FARO_TRAZA_PRUEBA) {
    return process.env.FARO_TRAZA_PRUEBA;
  }
  const pruebas = process.argv.filter((argumento) => /\.test\.(?:ts|js|mjs)$/.test(argumento));
  if (pruebas.length !== 1 || pruebas[0] === undefined) {
    return undefined;
  }
  const prueba = relative(RAIZ, resolve(pruebas[0])).split(sep).join('/');
  process.env.FARO_TRAZA_PRUEBA = prueba;
  return prueba;
}

const vistas = new Set<string>();

function anotar(objetivo: unknown): void {
  const prueba = pruebaDelProceso();
  if (DESTINO === undefined || prueba === undefined) {
    return;
  }
  let ruta: string;
  if (typeof objetivo === 'string') {
    ruta = objetivo.startsWith('file:') ? fileURLToPath(objetivo) : resolve(objetivo);
  } else if (objetivo instanceof URL && objetivo.protocol === 'file:') {
    ruta = fileURLToPath(objetivo);
  } else {
    return;
  }
  // Un enlace simbólico de una copia temporal al paquete real también lo lee.
  let real = ruta;
  try {
    real = ORIGINALES.realpathSync(ruta);
  } catch {
    // Lo que no existe se anota por su nombre: también es una lectura del paquete que la prueba esperaba.
  }
  const trazada = rutaTrazada(RAIZ, real) ?? rutaTrazada(RAIZ, ruta);
  if (trazada !== null && !vistas.has(trazada)) {
    vistas.add(trazada);
    ORIGINALES.appendFileSync(DESTINO, `${prueba}\t${trazada}\n`);
  }
}

/** Sustituye cada función por otra que anota su primer argumento y después la llama tal cual. */
function envolver(objeto: Record<string, unknown>, nombres: readonly string[]): void {
  for (const nombre of nombres) {
    const original = objeto[nombre];
    if (typeof original === 'function') {
      objeto[nombre] = function (this: unknown, ...argumentos: unknown[]) {
        anotar(argumentos[0]);
        return Reflect.apply(original, this, argumentos);
      };
    }
  }
}

if (DESTINO !== undefined) {
  const lecturas = ['readFile', 'open', 'readdir', 'opendir', 'copyFile', 'cp', 'stat', 'access'];
  envolver(fs as unknown as Record<string, unknown>, [
    ...lecturas,
    ...lecturas.map((nombre) => `${nombre}Sync`),
    'existsSync',
    'createReadStream',
  ]);
  envolver(fs.promises as unknown as Record<string, unknown>, lecturas);
  syncBuiltinESMExports();
  registerHooks({
    load(url, contexto, siguiente) {
      anotar(url);
      return siguiente(url, contexto);
    },
  });
}
