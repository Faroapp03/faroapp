/**
 * Ejecuta el motor empaquetado (pruebas/web-recorrido-integral/motor-empaquetado.test.ts) sobre una construcción, con
 * las precargas y el reportero de la batería, y exige sus 12 casos aprobados, sin fallos ni omisiones: las tres
 * mediciones del banco y la muestra en navegador (50 casos en Chromium, Firefox y WebKit, con cada una de sus tres
 * variantes propias). La batería global
 * no tiene construcción y los omite (OMISIONES_DE_LA_GLOBAL); esta orden los ejecuta sobre el artefacto final.
 *
 * Uso: npm run probar:motor-empaquetado -- <construcción, con web/>
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIABLES_EXCLUIDAS } from './entorno-firefox.ts';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';
import { aprobadasPorArchivo, exigirPruebasEjecutadas } from './resumen-pruebas.ts';
import { ejecutarPaso, type Paso, pasoPruebasPropias, terminarConCodigo } from './verificar.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const PRUEBA = fileURLToPath(new URL('../pruebas/web-recorrido-integral/motor-empaquetado.test.ts', import.meta.url));
const CASOS = 12;
const CODIGO_USO_INVALIDO = 2;
/**
 * La suma de los plazos de los casos (tres mediciones de 10 minutos y nueve muestras de 3 minutos: 57 minutos) y 3
 * minutos de margen de arranque. Medido el 03/11/2026: las mediciones, de 144 a 269 s; cada muestra, de 3 a 6 s; la
 * orden entera, 11 min 13 s.
 */
const PLAZO_MS = 3_600_000;

/**
 * La orden del motor empaquetado sobre `construccion`.
 *
 * @param construccion - La construcción, con web/.
 * @returns El paso, con su entorno.
 */
export function pasoMotorEmpaquetado(construccion: string): Paso {
  const paso = pasoPruebasPropias([PRUEBA]);
  return {
    ...paso,
    nombre: 'Motor empaquetado',
    entorno: { ...paso.entorno, FARO_CONSTRUCCION: resolve(construccion) },
    // Como la batería de navegador, sin VARIABLES_EXCLUIDAS (la muestra arranca los tres navegadores); y siempre las
    // tres variantes y los tres navegadores: una FARO_VARIANTES o FARO_NAVEGADORES heredada no reduce los casos
    // exigidos.
    excluir: [...VARIABLES_EXCLUIDAS, 'FARO_VARIANTES', 'FARO_NAVEGADORES'],
  };
}

async function principal(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const [construccion] = argumentos;
  if (argumentos.length !== 1 || !construccion) {
    throw new FalloDeComprobacion('Uso: npm run probar:motor-empaquetado -- <construcción>', {
      codigo: CODIGO_USO_INVALIDO,
    });
  }
  const salida = await ejecutarPaso(pasoMotorEmpaquetado(construccion), RAIZ, PLAZO_MS);
  console.log(salida.trim());
  exigirPruebasEjecutadas(salida, { raiz: RAIZ, archivos: [PRUEBA], admitidas: {} });
  const aprobadas = aprobadasPorArchivo(salida).get(PRUEBA) ?? 0;
  if (aprobadas !== CASOS) {
    throw new FalloDeComprobacion(`El motor empaquetado tiene que aprobar ${CASOS} de ${CASOS}: aprobó ${aprobadas}`);
  }
  console.log(`Motor empaquetado: ${CASOS} de ${CASOS} aprobadas, sin fallos ni omisiones`);
}

if (import.meta.main) {
  await terminarConCodigo(principal);
}
