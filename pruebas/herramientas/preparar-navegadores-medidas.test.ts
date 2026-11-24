// Los números de la preparación de los navegadores salen de registros reales de GitHub Actions, con el margen del
// proyecto: el plazo del paso, la reserva del job para él y la espera y los reintentos de APT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseDocument } from 'yaml';

/**
 * La preparación con éxito más lenta de las 39 medidas entre el 18/11/2026 y el 23/11/2026 en Faroapp03/faro y
 * Faroapp03/faroapp (calidad y ciclo, los tres motores): run 44686779200, calidad, 20/11/2026 a las 06:19 UTC.
 * La mediana fue de 66 segundos. Instalar solo Chromium es una parte de ese trabajo, así que el mismo plazo le basta.
 */
const PREPARACION_MAS_LENTA_S = 643;
/**
 * En el ciclo que agotó el paso (run 45325245279, 24/11/2026), cada conexión atascada esperó 30 segundos hasta que APT
 * la dio por perdida (30,04 a 30,29 s, cuatro veces). Tras cada corte, la siguiente descarga empezó en 2,6 segundos
 * como mucho (seis casos: 2,60; 1,49; 0,28; 2,21; 0,30 y 1,15).
 */
const ATASCO_MEDIDO_S = 30;
const ARRANQUE_TRAS_UN_CORTE_S = 2.6;
/** En ese ciclo fallaron 14 de las 65 descargas pedidas al espejo para los 187 paquetes de los tres motores. */
const DESCARGAS_FALLIDAS = 14;
const DESCARGAS_PEDIDAS = 65;
const PAQUETES_DE_LOS_TRES_MOTORES = 187;
/** Regla: que algún paquete agote todos sus intentos debe tener menos de un 1 % de probabilidad. */
const PROBABILIDAD_ADMITIDA = 0.01;
const SEGUNDOS_POR_MINUTO = 60;
const POR_CIENTO = 100;
const GUION = 'herramientas/mantenimiento/preparar-navegadores.sh';

function leer(ruta: string): string {
  return readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
}
function entero(fuente: string, patron: RegExp, nombre: string): number {
  const valor = patron.exec(fuente)?.[1];
  assert.ok(valor, nombre);
  return Number(valor);
}
function margen(): number {
  const fuente = leer('plataforma_datos/orquestacion/medidas_del_ciclo.py');
  return (POR_CIENTO + entero(fuente, /^MARGEN_POR_CIENTO = (\d+)$/m, 'MARGEN_POR_CIENTO')) / POR_CIENTO;
}
function pasosDe(workflow: string, job: string): Array<Record<string, unknown>> {
  const documento = parseDocument(leer(`.github/workflows/${workflow}.yml`), { uniqueKeys: true });
  assert.deepEqual(documento.errors, []);
  const pasos = (documento.toJS() as { jobs: Record<string, { steps: Array<Record<string, unknown>> }> }).jobs[job]
    ?.steps;
  assert.ok(Array.isArray(pasos));
  return pasos;
}
function pasoDelGuion(workflow: string, job: string): Record<string, unknown> {
  const pasos = pasosDe(workflow, job).filter((p) => String(p.run ?? '').startsWith(`bash ${GUION} `));
  assert.equal(pasos.length, 1);
  return pasos[0] as Record<string, unknown>;
}

test('el plazo de la preparación es la más lenta medida con el margen del proyecto, en calidad y en el ciclo', () => {
  const plazo = Math.ceil((PREPARACION_MAS_LENTA_S * margen()) / SEGUNDOS_POR_MINUTO);
  assert.equal(pasoDelGuion('calidad', 'calidad')['timeout-minutes'], plazo);
  assert.equal(pasoDelGuion('actualizar', 'candidato')['timeout-minutes'], plazo);
});

test('el job del ciclo reserva para Chromium exactamente el plazo de su paso', () => {
  const herramientas = pasosDe('actualizar', 'candidato').find((p) => p.id === 'herramientas');
  assert.ok(herramientas);
  const reservados = entero(String(herramientas.run), /then navegadores=(\d+); fi$/m, 'navegadores');
  assert.equal(reservados, pasoDelGuion('actualizar', 'candidato')['timeout-minutes']);
});

test('APT corta una conexión sin datos poco después del arranque más lento medido, mucho antes que el atasco', () => {
  const espera = entero(leer(GUION), /^espera_apt_s=(\d+)$/m, 'espera_apt_s');
  assert.equal(espera, Math.ceil(ARRANQUE_TRAS_UN_CORTE_S * margen()));
  assert.ok(espera < ATASCO_MEDIDO_S);
});

test('APT reintenta lo bastante para que ningún paquete agote sus intentos con la tasa de fallos medida', () => {
  const reintentos = entero(leer(GUION), /^reintentos_apt=(\d+)$/m, 'reintentos_apt');
  const fallo = DESCARGAS_FALLIDAS / DESCARGAS_PEDIDAS;
  const agotar = (intentos: number) => PAQUETES_DE_LOS_TRES_MOTORES * fallo ** intentos;
  // Cada paquete tiene el intento inicial y sus reintentos; con uno menos ya no se cumple la regla.
  assert.ok(agotar(reintentos + 1) < PROBABILIDAD_ADMITIDA);
  assert.ok(agotar(reintentos) >= PROBABILIDAD_ADMITIDA);
});
