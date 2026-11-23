import assert from 'node:assert/strict';
import test from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

const LONGITUD_HUELLA = 64;
const HUELLA = 'a'.repeat(LONGITUD_HUELLA);

function leerCon(campos: object) {
  const base = instantaneaSaludV4();
  const [fila] = base.fuentes;
  assert.ok(fila);
  return leerEstadoDatosPanel({ ...base, fuentes: [{ ...fila, politica: 'edición', ...campos }] }).fuentes[0];
}

function edicionDetenida(extra: object) {
  const base = instantaneaSaludV4();
  return {
    estado: 'detenida-por-controles',
    anio: '2026',
    observadoEn: base.observadoEn,
    huellaCatalogo: HUELLA,
    ...extra,
  };
}

test('la edición nueva detenida llega al panel con su motivo y, si el enunciado cambió, sus partes en orden', () => {
  for (const extra of [
    { motivo: 'tablas' },
    { motivo: 'controles' },
    { motivo: 'enunciado-distinto', partes: ['pregunta', 'codigos'] },
  ]) {
    const fila = leerCon({ edicionNueva: edicionDetenida(extra) });
    assert.deepEqual(fila && 'edicionNueva' in fila ? fila.edicionNueva : null, edicionDetenida(extra));
  }
});

test('una detención mal formada o un motivo fuera de la lista detienen la lectura del panel', () => {
  const base = instantaneaSaludV4();
  const pendiente = { estado: 'pendiente-de-incorporar', anio: '2026', observadoEn: base.observadoEn };
  for (const mala of [
    edicionDetenida({}),
    edicionDetenida({ motivo: 'otro' }),
    edicionDetenida({ motivo: 'enunciado-distinto' }),
    edicionDetenida({ motivo: 'controles', partes: ['periodo'] }),
    edicionDetenida({ motivo: 'enunciado-distinto', partes: ['codigos', 'pregunta'] }),
    edicionDetenida({ motivo: 'enunciado-distinto', partes: [] }),
    edicionDetenida({ motivo: 'enunciado-distinto', partes: ['otra'] }),
    { ...pendiente, huellaCatalogo: HUELLA, motivo: 'tablas' },
  ]) {
    assert.throws(() => leerCon({ edicionNueva: mala }));
  }
});

test('el aviso de que el año admitido no es el del conjunto validado viaja solo', () => {
  const fila = leerCon({ avisoEdicion: 'edicion-no-coincide' });
  assert.equal(fila && 'avisoEdicion' in fila ? fila.avisoEdicion : null, 'edicion-no-coincide');
  assert.throws(() =>
    leerCon({ avisoEdicion: 'edicion-no-coincide', edicionNueva: edicionDetenida({ motivo: 'tablas' }) }),
  );
});

test('el número de grupos sin clase viaja solo con valor y como entero positivo', () => {
  const fila = leerCon({ gruposSinClase: 2 });
  assert.equal(fila && 'gruposSinClase' in fila ? fila.gruposSinClase : null, 2);
  for (const mala of [0, -1, Number.EPSILON, '2', null]) {
    assert.throws(() => leerCon({ gruposSinClase: mala }));
  }
});
