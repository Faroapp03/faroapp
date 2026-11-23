/** El Inicio avisa en «Requiere atención» cuando la regla de retirada de una fuente cambia de modo o retira de golpe
 * más del umbral, en los dos idiomas. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { areasDelServicio, requiereAtencion } from '../../web/administracion/inicio-datos.js';
import { instantaneaSalud, operacionSalud } from '../ayudas/salud-datos.ts';
import { activarIdiomaPanel } from './idiomas.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = Date.parse('2026-11-23T09:00:00Z');
const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;

function conRetirada(cambio: 'activada' | 'vuelta-a-sombra' | null, amplia: object = {}): Activa {
  const retirada = cambio === null ? {} : { retirada: { cambio, decisiones: 1250, en: '2026-11-22T05:00:00Z' } };
  const datos = instantaneaSalud({
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: operacionSalud(), incidenciasPendientes: [], ...retirada, ...amplia },
    ],
  } as never);
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos,
    trabajos: null,
    activacion: null,
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + QUINCE_MINUTOS,
      caducaAbsolutaEn: INICIO + OCHO_HORAS,
    },
    controles: { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false },
  } as never;
}
const contexto = { idSesion: null, avisos: null, recibido: () => INICIO };
const fuentes = (estado: Activa) => areasDelServicio(estado, contexto).find((a) => a.id === 'fuentes');

test('la activación pide atención con la frase de Faro y su cifra con punto de miles', () => {
  activarIdiomaPanel('es');
  const estado = conRetirada('activada');
  assert.equal(
    fuentes(estado)?.detalle,
    '1 de 1 bien · La regla de retirada de Empresas y uso de IA se ha activado: 1.250 decisiones comprobadas sin ningún error.',
  );
  assert.equal(fuentes(estado)?.tono, 'atencion');
  assert.deepEqual(
    requiereAtencion(areasDelServicio(estado, contexto)).map((a) => a.id),
    ['fuentes'],
  );
  activarIdiomaPanel('ca');
  assert.match(
    fuentes(estado)?.detalle ?? '',
    /La regla de retirada de Empresas y uso de IA s’ha activat: 1\.250 decisions comprovades sense cap error\.$/,
  );
  activarIdiomaPanel('es');
});

test('la vuelta a modo de prueba dice qué pasó, en castellano y en catalán', () => {
  activarIdiomaPanel('es');
  const estado = conRetirada('vuelta-a-sombra');
  assert.match(
    fuentes(estado)?.detalle ?? '',
    /La regla de retirada de Empresas y uso de IA ha vuelto a modo de prueba: retiró un curso que seguía publicado\.$/,
  );
  activarIdiomaPanel('ca');
  assert.match(
    fuentes(estado)?.detalle ?? '',
    /La regla de retirada de Empresas y uso de IA ha tornat al mode de prova: va retirar un curs que encara estava publicat\.$/,
  );
  activarIdiomaPanel('es');
});

test('sin cambio de modo el Inicio no dice nada nuevo y no pide atención', () => {
  activarIdiomaPanel('es');
  const estado = conRetirada(null);
  assert.equal(fuentes(estado)?.detalle, '1 de 1 bien');
  assert.equal(fuentes(estado)?.tono, 'bien');
});

const AMPLIA = { retiradaAmplia: { retiradas: 1500, cursos: 5000, en: '2026-11-22T05:00:00Z' } };

test('la retirada amplia pide atención con su cifra, en castellano y en catalán', () => {
  activarIdiomaPanel('es');
  const estado = conRetirada(null, AMPLIA);
  assert.equal(
    fuentes(estado)?.detalle,
    '1 de 1 bien · En la última actualización, la regla de retirada de Empresas y uso de IA ha quitado 1.500 de sus ' +
      '5.000 cursos (30 %). Cada retirada tiene su evidencia comprobada; revisa que la fuente siga publicando con ' +
      'normalidad.',
  );
  assert.equal(fuentes(estado)?.tono, 'atencion');
  activarIdiomaPanel('ca');
  assert.match(
    fuentes(estado)?.detalle ?? '',
    /En l’última actualització, la regla de retirada de Empresas y uso de IA ha tret 1\.500 dels seus 5\.000 cursos \(30 %\)\. Cada retirada té la seva evidència comprovada; revisa que la font continuï publicant amb normalitat\.$/,
  );
  activarIdiomaPanel('es');
});

test('la primera activación con retirada amplia dice las dos cosas, una tras otra', () => {
  activarIdiomaPanel('es');
  const detalle = fuentes(conRetirada('activada', AMPLIA))?.detalle ?? '';
  assert.match(
    detalle,
    /se ha activado: 1\.250 decisiones comprobadas sin ningún error\. · En la última actualización/,
  );
});
