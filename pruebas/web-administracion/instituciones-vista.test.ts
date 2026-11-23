import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { correoDeInvitacion } from '../../web/administracion/vista-instituciones.js';
import { navegador } from '../web-controles/ayudas.js';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
const LONGITUD_SECRETO = 43;
const ENLACE = {
  enlaceRelativo: `/activar-acceso.html#invitacion=${UUID}.${'A'.repeat(LONGITUD_SECRETO)}`,
  caducaEn: '2026-10-30T17:00:00.000Z',
};
const INICIO = 1_000_000,
  INACTIVIDAD = 900_000,
  ABSOLUTA = 28_800_000;
const institucion = {
  id: `inst-${UUID}`,
  nombre: 'Institución <de prueba>',
  correo: 'equipo+api@example.test',
  estado: 'invitada' as const,
  ultimaConexion: null,
  consultas: 0,
  invitacion: { caducaEn: ENLACE.caducaEn },
  claves: [],
};
function activa(cambios: Partial<Extract<EstadoClientePanel, { estado: 'activa' }>> = {}): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    controles: { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    registroInstituciones: { version: 1, revision: 0, instituciones: [] },
    ...cambios,
  };
}

test('invitar exige lectura y muestra/copía solo el enlace devuelto, sin convertirlo en href persistente', async (t) => {
  const p = await prepararPanel(t);
  const copias: string[] = [];
  navegador(t, {
    location: { origin: 'https://example.test' },
    navigator: {
      onLine: true,
      clipboard: {
        writeText: async (valor: string) => {
          copias.push(valor);
        },
      },
    },
  });
  p.publicar(activa({ registroInstituciones: null }));
  assert.equal(p.campo('instituciones-campos').disabled, true);
  p.publicar(activa());
  p.campo('institucion-nombre').value = institucion.nombre;
  p.campo('institucion-correo').value = institucion.correo;
  p.campo('instituciones-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.deepEqual(p.registros, [{ nombre: institucion.nombre, correo: institucion.correo }]);
  p.publicar(
    activa({ registroInstituciones: { version: 1, revision: 1, instituciones: [institucion] }, invitacion: ENLACE }),
  );
  assert.equal(p.campo('institucion-enlace').value, `https://example.test${ENLACE.enlaceRelativo}`);
  assert.equal(p.campo('institucion-nombre').value, '');
  p.campo('institucion-copiar').dispatchEvent(new Event('click'));
  await turno();
  assert.deepEqual(copias, [`https://example.test${ENLACE.enlaceRelativo}`]);
  assert.equal(p.campo('institucion-enlace').getAttribute('value'), null);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('institucion-enlace').value, '');
  assert.equal(p.campo('instituciones-lista').textContent, '');
  assert.equal(p.campo('instituciones').hidden, true);
});

test('resultado incierto y conflicto retiran el enlace y bloquean cambios sin presentar lista vacía como confirmada', async (t) => {
  const p = await prepararPanel(t);
  navegador(t, { location: { origin: 'https://example.test' } });
  for (const avisoInstituciones of ['instituciones_inciertas', 'revision_instituciones_conflictiva'] as const) {
    p.publicar(activa({ registroInstituciones: null, institucionesPendientes: true, avisoInstituciones }));
    assert.equal(p.campo('instituciones-campos').disabled, true);
    assert.equal(p.campo('instituciones-lista').textContent, '');
    assert.equal(p.campo('institucion-enlace').value, '');
    assert.equal(p.campo('consultar-instituciones').disabled, false);
    p.campo('consultar-instituciones').dispatchEvent(new Event('click'));
  }
  assert.deepEqual(p.llamadas, ['instituciones', 'instituciones']);
});

test('una confirmación sobre una revisión sustituida no retira con una nueva revisión no vista', async (t) => {
  const p = await prepararPanel(t);
  navegador(t, { location: { origin: 'https://example.test' } });
  p.publicar(activa({ registroInstituciones: { version: 1, revision: 1, instituciones: [institucion] } }));
  const botones = p.campo('instituciones-lista').querySelectorAll('button');
  const retirar = botones.find((b) => b.textContent === 'Retirar acceso');
  assert.ok(retirar);
  p.alConfirmar(() => {
    p.publicar(activa({ registroInstituciones: { version: 1, revision: 2, instituciones: [institucion] } }));
    return true;
  });
  retirar.dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, []);
});

test('el correo es manual, codifica el cuerpo y mantiene el secreto solo en el fragmento del enlace entregado', () => {
  activarIdiomaPanel();
  const enlace = correoDeInvitacion(ENLACE, 'https://example.test', 'equipo+api@example.test');
  assert.ok(enlace);
  assert.ok(enlace.startsWith('mailto:equipo%2Bapi%40example.test?subject=Invitaci%C3%B3n%20'));
  const correo = new URL(enlace);
  assert.ok(correo.searchParams.get('body')?.includes(`https://example.test${ENLACE.enlaceRelativo}`));
  const vacio = correoDeInvitacion(ENLACE, 'https://example.test', null);
  assert.ok(vacio?.startsWith('mailto:?subject='));
  assert.throws(() =>
    correoDeInvitacion(
      { ...ENLACE, enlaceRelativo: `https://other.example.test${ENLACE.enlaceRelativo}` },
      'https://example.test',
      null,
    ),
  );
});
