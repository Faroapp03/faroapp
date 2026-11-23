import type { TestContext } from 'node:test';

/** Las vistas leen fechas relativas a «ahora»; las pruebas fijan ese instante para no depender del día en que corren. */
export const AHORA_PRUEBAS = '2026-11-14T10:00:00Z';

/** Fija Date (y Date.now) en `instante` mientras dura la prueba; los temporizadores siguen siendo los reales. */
export function fijarReloj(t: TestContext, instante: string = AHORA_PRUEBAS) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(instante) });
}
