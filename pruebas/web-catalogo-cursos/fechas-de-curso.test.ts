// Las fechas de Cursos se leen como las diría una persona, sin huso ni segundos, en la hora de Barcelona y en los dos
// idiomas, sea cual sea la zona del dispositivo.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conMayuscula,
  diaDeCurso,
  diaDeCursoEnFrase,
  fechaDeCurso,
  fechaDeCursoEnFrase,
  leerFechaPublicada,
  periodoDeCurso,
} from '../../web/scripts/catalogo-cursos/fechas-de-curso.js';

/** Cada forma de periodo que publica el catálogo, con lo que se lee en castellano y en catalán. */
const PERIODOS = [
  // Ventana del aula, la forma de 96 ofertas: medianoches que solo delimitan los días.
  [
    '2026-01-01T00:00:00+01:00',
    '2026-12-31T23:59:00+01:00',
    'del 1 de enero al 31 de diciembre de 2026',
    'de l’1 de gener al 31 de desembre del 2026',
  ],
  // Ventana que abre en horario de verano (+02:00) y cierra en el de invierno.
  [
    '2026-04-14T00:00:00+02:00',
    '2026-12-31T23:59:00+01:00',
    'del 14 de abril al 31 de diciembre de 2026',
    'del 14 d’abril al 31 de desembre del 2026',
  ],
  // Sesión de un día con horas reales.
  [
    '2026-11-19T16:00:00+01:00',
    '2026-11-19T19:00:00+01:00',
    '19 de noviembre de 2026, de 16:00 a 19:00',
    '19 de novembre del 2026, de 16:00 a 19:00',
  ],
  // Preinscripción: días civiles del mismo mes.
  ['2026-11-01', '2026-11-30', 'del 1 al 30 de noviembre de 2026', 'de l’1 al 30 de novembre del 2026'],
  // Días civiles de años distintos.
  [
    '2025-12-01',
    '2026-01-31',
    'del 1 de diciembre de 2025 al 31 de enero de 2026',
    'de l’1 de desembre del 2025 al 31 de gener del 2026',
  ],
  // Un solo día.
  ['2026-01-12', '2026-01-12', '12 de enero de 2026', '12 de gener del 2026'],
  // Hora sin huso: se enseña tal como se publicó.
  [
    '2026-10-25T10:00',
    '2026-10-25T12:00',
    '25 de octubre de 2026, de 10:00 a 12:00 (huso horario por confirmar)',
    '25 d’octubre del 2026, de 10:00 a 12:00 (fus horari per confirmar)',
  ],
  // En catalán, la hora que se lee con vocal apostrofa la preposición.
  [
    '2026-11-11T11:00:00Z',
    '2026-11-11T12:30:00Z',
    '11 de noviembre de 2026, de 12:00 a 13:30',
    '11 de novembre del 2026, de 12:00 a 13:30',
  ],
  [
    '2026-11-11T10:00:00Z',
    '2026-11-11T12:00:00Z',
    '11 de noviembre de 2026, de 11:00 a 13:00',
    '11 de novembre del 2026, d’11:00 a 13:00',
  ],
  // Varios días con horas reales: cada hora junto a su día.
  [
    '2026-02-03T09:30:00+01:00',
    '2026-02-04T13:00:00+01:00',
    'del 3 de febrero de 2026 a las 9:30 al 4 de febrero de 2026 a las 13:00',
    'del 3 de febrer del 2026, a les 9:30 al 4 de febrer del 2026, a les 13:00',
  ],
  // Mismo día con solo la hora de cierre.
  [
    '2026-05-08',
    '2026-05-08T13:00:00+02:00',
    '8 de mayo de 2026, hasta las 13:00',
    '8 de maig del 2026, fins a les 13:00',
  ],
] as const;

test('cada periodo publicado se lee sin huso ni segundos, en castellano y en catalán', () => {
  for (const [inicio, fin, es, ca] of PERIODOS) {
    assert.equal(periodoDeCurso(inicio, fin, 'es'), es, `${inicio} → ${fin}`);
    assert.equal(periodoDeCurso(inicio, fin, 'ca'), ca, `${inicio} → ${fin}`);
    for (const escrito of [es, ca]) {
      assert.doesNotMatch(escrito, /[+-]\d{2}:\d{2}|\bZ\b|UTC|\d{2}:\d{2}:\d{2}/u);
    }
  }
});

test('una fecha sola dice el día y, si la hora es real, la hora de Barcelona', () => {
  assert.equal(fechaDeCurso('2026-01-05', 'es'), '5 de enero de 2026');
  assert.equal(fechaDeCurso('2026-01-05', 'ca'), '5 de gener del 2026');
  assert.equal(fechaDeCurso('2026-12-31T23:59:00+01:00', 'es'), '31 de diciembre de 2026');
  assert.equal(fechaDeCurso('2026-10-26T09:00:00Z', 'es'), '26 de octubre de 2026 a las 10:00');
  assert.equal(fechaDeCurso('2026-10-26T09:00:00Z', 'ca'), '26 d’octubre del 2026, a les 10:00');
  assert.equal(
    fechaDeCurso('2026-10-26T12:05:00-00:00', 'es'),
    '26 de octubre de 2026 a las 12:05 (huso horario por confirmar)',
  );
  assert.equal(
    fechaDeCurso('2026-10-26T12:05:00-00:00', 'ca'),
    '26 d’octubre del 2026, a les 12:05 (fus horari per confirmar)',
  );
});

test('dentro de una frase, la fecha lleva su artículo y el 23:59 que cierra el día no se escribe', () => {
  assert.equal(fechaDeCursoEnFrase('2026-12-31T22:59:00Z', 'es', 'hasta'), 'hasta el 31 de diciembre de 2026');
  assert.equal(fechaDeCursoEnFrase('2026-12-31T22:59:00Z', 'ca', 'hasta'), 'fins al 31 de desembre del 2026');
  assert.equal(
    fechaDeCursoEnFrase('2026-11-30T23:30:00Z', 'ca', 'hasta'),
    'fins a l’1 de desembre del 2026, a les 0:30',
  );
  assert.equal(
    fechaDeCursoEnFrase('2026-12-15T10:00:00Z', 'es', 'hasta'),
    'hasta el 15 de diciembre de 2026 a las 11:00',
  );
  assert.equal(diaDeCursoEnFrase('2026-10-01T00:00:00Z', 'es', 'el'), 'el 1 de octubre de 2026');
  assert.equal(diaDeCursoEnFrase('2026-10-01T00:00:00Z', 'ca', 'el'), 'l’1 d’octubre del 2026');
});

test('el cambio de hora de marzo y de octubre lleva cada instante a su día y su hora de Barcelona', () => {
  // 29/03/2026: a las 01:00 UTC los relojes pasan de las 2:00 a las 3:00.
  assert.equal(fechaDeCurso('2026-03-29T00:30:00Z', 'es'), '29 de marzo de 2026 a la 1:30');
  assert.equal(fechaDeCurso('2026-03-29T01:30:00Z', 'es'), '29 de marzo de 2026 a las 3:30');
  // La medianoche de Barcelona en UTC: 23:00 del día anterior en invierno y 22:00 en verano.
  assert.equal(
    periodoDeCurso('2026-03-28T23:00:00Z', '2026-04-30T21:59:00Z', 'es'),
    'del 29 de marzo al 30 de abril de 2026',
  );
  // 25/10/2026: a las 01:00 UTC los relojes vuelven de las 3:00 a las 2:00.
  assert.equal(fechaDeCurso('2026-10-25T00:30:00Z', 'es'), '25 de octubre de 2026 a las 2:30');
  assert.equal(fechaDeCurso('2026-10-25T01:30:00Z', 'ca'), '25 d’octubre del 2026, a les 2:30');
  assert.equal(periodoDeCurso('2026-10-24T22:00:00Z', '2026-10-31T22:59:00Z', 'ca'), 'del 25 al 31 d’octubre del 2026');
});

test('el día de «Comprobado» y «Actualizado» es el de Barcelona, no el universal', () => {
  assert.equal(diaDeCurso('2026-11-18T18:14:35.464604Z', 'es'), '18 de noviembre de 2026');
  assert.equal(diaDeCurso('2026-10-22T22:30:00.000001Z', 'es'), '23 de octubre de 2026');
  assert.equal(diaDeCurso('2026-10-22T22:30:00.000001Z', 'ca'), '23 d’octubre del 2026');
});

test('la lectura no depende de la zona horaria del dispositivo', (t) => {
  const zona = process.env.TZ;
  t.after(() => {
    if (zona === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = zona;
    }
  });
  const leer = () =>
    PERIODOS.map(([inicio, fin]) => periodoDeCurso(inicio, fin, 'es')).concat(
      diaDeCurso('2026-10-22T22:30:00Z', 'es'),
      fechaDeCurso('2026-10-25T01:30:00Z', 'es'),
    );
  process.env.TZ = 'Europe/Madrid';
  const enBarcelona = leer();
  for (const otra of ['America/New_York', 'Pacific/Auckland', 'UTC']) {
    process.env.TZ = otra;
    // La zona del proceso ha cambiado de verdad: sin esto, la comparación no probaría nada.
    assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, otra);
    assert.deepEqual(leer(), enBarcelona, otra);
  }
});

test('el dato no cambia y una fecha mal formada no se escribe', () => {
  const leida = leerFechaPublicada('2026-01-01T00:00:00+01:00');
  assert.equal(leida.conHora, false);
  assert.equal(leida.partes.dia, 1);
  assert.throws(() => leerFechaPublicada('01/01/2026'), TypeError);
  assert.throws(() => leerFechaPublicada('2026-02-30'), TypeError);
  assert.equal(conMayuscula('del 1 al 30 de noviembre de 2026'), 'Del 1 al 30 de noviembre de 2026');
  assert.equal(conMayuscula('de l’1 al 30 de novembre del 2026'), 'De l’1 al 30 de novembre del 2026');
});
