/** El Inicio dice por qué no terminó la última actualización, en palabras, como una línea más de «Requiere atención». */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerEstadoTrabajos } from '../../web/administracion/estado-trabajos.js';
import { areasDelServicio, requiereAtencion } from '../../web/administracion/inicio-datos.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { activarIdiomaPanel } from './idiomas.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = Date.parse('2026-11-23T09:00:00Z');
const MINUTO = 60_000;
const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;
const contexto = { idSesion: null, avisos: null, recibido: () => INICIO };

function conTrabajo(resultado: Record<string, unknown>, datos: Activa['datos'] = null): Activa {
  const trabajos = leerEstadoTrabajos({
    version: 1,
    revision: 3,
    ultimoTrabajo: {
      solicitudId: '11111111-1111-4111-8111-111111111111',
      revisionReserva: 1,
      revisionBase: 0,
      accion: 'comprobar-programada',
      creadoEn: INICIO,
      actualizadoEn: INICIO + MINUTO,
      estado: 'terminado',
      runId: '789',
      runAttempt: '1',
      origen: 'programada',
      iniciado: true,
      resultado: {
        veredicto: null,
        terminadoEn: '2026-11-23T09:01:00Z',
        huellaPaquete: null,
        error: null,
        ...resultado,
      },
    },
  });
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos,
    trabajos,
    activacion: null,
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + QUINCE_MINUTOS,
      caducaAbsolutaEn: INICIO + OCHO_HORAS,
    },
    controles: { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false },
  };
}
const sinRecibo = (causa: string, paso: string | null) => ({
  resultado: 'ejecucion-sin-recibo',
  ultimoFallo: { causa, paso },
});
function actualizacion(estado: Activa) {
  const areas = areasDelServicio(estado, contexto);
  const area = areas.find((a) => a.id === 'actualizacion');
  assert.equal(area?.tono, 'fallo');
  assert.ok(
    requiereAtencion(areas).some((a) => a.id === 'actualizacion'),
    'es una línea de «Requiere atención»',
  );
  return area?.detalle;
}

test('causa y paso en palabras, en castellano y en catalán', (t) => {
  t.after(() => activarIdiomaPanel());
  const estado = conTrabajo({
    resultado: 'rechazado',
    veredicto: 'rojo',
    error: 'actualizacion_no_completada',
    ultimoFallo: { causa: 'plazo-insuficiente', paso: 'paquete' },
  });
  activarIdiomaPanel('es');
  assert.equal(
    actualizacion(estado),
    'La última actualización no terminó: no quedaba tiempo para terminar, en la preparación de los datos para la web. La web sigue con los datos publicados.',
  );
  activarIdiomaPanel('ca');
  assert.equal(
    actualizacion(estado),
    'L’última actualització no va acabar: no quedava temps per acabar, a la preparació de les dades per al web. El web continua amb les dades publicades.',
  );
});

test('cada causa tiene su frase; un paso desconocido o ausente no se muestra', (t) => {
  t.after(() => activarIdiomaPanel());
  const esperadas = {
    'plazo-agotado': ['se agotó el tiempo previsto', 'es va esgotar el temps previst'],
    'motor-terminado-por-senal': ['se interrumpió', 'es va interrompre'],
    'motor-sin-recibo': ['terminó sin dejar resultado', 'va acabar sense deixar cap resultat'],
    'sin-resultado': ['se detuvo sin enviar su resultado', 'es va aturar sense enviar el resultat'],
  };
  for (const [causa, [es, ca]] of Object.entries(esperadas)) {
    const estado = conTrabajo(sinRecibo(causa, causa === 'sin-resultado' ? null : 'motor'));
    activarIdiomaPanel('es');
    assert.equal(
      actualizacion(estado),
      `La última actualización no terminó: ${es}. La web sigue con los datos publicados.`,
    );
    activarIdiomaPanel('ca');
    assert.equal(
      actualizacion(estado),
      `L’última actualització no va acabar: ${ca}. El web continua amb les dades publicades.`,
    );
  }
});

test('el paso de una fuente se nombra por la fuente; sin porqué, la frase de siempre', (t) => {
  t.after(() => activarIdiomaPanel());
  const base = instantaneaSalud();
  const fuente = base.catalogoFuentes[0];
  assert.ok(fuente);
  activarIdiomaPanel('es');
  assert.equal(
    actualizacion(conTrabajo(sinRecibo('plazo-agotado', fuente.id), base)),
    `La última actualización no terminó: se agotó el tiempo previsto, en la lectura de ${fuente.nombre}. La web sigue con los datos publicados.`,
  );
  activarIdiomaPanel('ca');
  assert.equal(
    actualizacion(conTrabajo(sinRecibo('plazo-agotado', fuente.id), base)),
    `L’última actualització no va acabar: es va esgotar el temps previst, a la lectura de ${fuente.nombre}. El web continua amb les dades publicades.`,
  );
  activarIdiomaPanel('es');
  assert.equal(
    actualizacion(conTrabajo({ resultado: 'rechazado', veredicto: 'rojo', error: 'actualizacion_no_admitida' })),
    'La última actualización no terminó bien. Revisa su resultado en Actualizaciones.',
  );
});
