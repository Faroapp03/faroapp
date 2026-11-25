import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel as leerServidor } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos as saludServidor } from '../../src/administracion/salud-datos.js';
import { leerEstadoDatosPanel as leerNavegador } from '../../web/administracion/estado-datos.js';
import { resumirSaludDatos as saludNavegador } from '../../web/administracion/salud-datos.js';
import { mostrarEstadoDatos } from '../../web/administracion/vista-datos.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { type Elemento, html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { fijarReloj } from './reloj-fijo.ts';

const VERSION_ESTADO = 6;
const FUENTES = [
  { id: 'barcelonactiva', nombre: 'Barcelona Activa' },
  { id: 'fundae', nombre: 'FUNDAE' },
] as const;
type Fuente = (typeof FUENTES)[number];
type IdFuente = Fuente['id'];

const BARCELONA_ACTIVA = {
  motivo: 'documento-excesivo',
  versionEn: '2026-10-18T10:00:00.500001Z',
  desde: '2026-10-20T22:30:00.200001Z',
} as const;
const FUNDAE = {
  motivo: 'documento-excesivo',
  versionEn: '2026-10-19T12:00:00Z',
  desde: '2026-10-21T11:15:00Z',
} as const;
const UNA = { barcelonactiva: BARCELONA_ACTIVA };
const DOS = { ...UNA, fundae: FUNDAE };
const RECUPERADA = { fundae: FUNDAE };
const LECTORES = [
  { leer: leerServidor, salud: saludServidor },
  { leer: leerNavegador, salud: saludNavegador },
] as const;

function observacion(retenciones: Partial<Record<IdFuente, unknown>>) {
  const base = instantaneaSalud();
  const [fuente] = base.fuentes;
  const [conjunto] = base.comprobaciones.conjuntos;
  const [modulo, paquete] = base.modulos;
  assert.ok(fuente && conjunto && modulo && paquete);
  return {
    ...base,
    version: VERSION_ESTADO,
    retenidos: { cuarentena: { lectura: 'leida', cambios: [] }, censoSoc: { lectura: 'leida', pendiente: null } },
    fuentes: FUENTES.map(({ id }) => ({ ...fuente, id })),
    catalogoFuentes: FUENTES.map((identidad) => ({ ...identidad, tema: 'cursos', modalidad: 'operativa' })),
    modulos: [...FUENTES.map(({ id }) => ({ ...modulo, id })), paquete],
    comprobaciones: {
      ...base.comprobaciones,
      conjuntos: FUENTES.map(({ id }) => ({ ...conjunto, id, fuente: id })),
    },
    seguimientoRemoto: FUENTES.map(({ id }) => ({
      fuente: id,
      ultimoIntento: fuente.ultimaOperacion,
      incidenciasPendientes: [],
      ...(Object.hasOwn(retenciones, id) ? { retencionComposicion: retenciones[id] } : {}),
    })),
  };
}

test('el servidor y el navegador conservan las fechas por fuente y reflejan la recuperación en la salud', () => {
  for (const retenciones of [UNA, DOS, RECUPERADA, {}]) {
    const esperadas = FUENTES.map(({ id }) => {
      const aviso = (retenciones as Partial<typeof DOS>)[id];
      return { id, aviso, estado: aviso ? 'atencion' : 'comprobada', atencionPorAviso: aviso !== undefined };
    });
    for (const { leer, salud } of LECTORES) {
      const datos = leer(observacion(retenciones));
      assert.ok(datos.version === VERSION_ESTADO && datos.seguimientoRemoto);
      assert.deepEqual(
        datos.seguimientoRemoto.map(({ fuente, retencionComposicion }) => ({
          id: fuente,
          aviso: retencionComposicion,
        })),
        esperadas.map(({ id, aviso }) => ({ id, aviso })),
      );
      const resumen = salud(datos);
      assert.equal(resumen.global, Object.keys(retenciones).length ? 'atencion' : 'comprobada');
      assert.deepEqual(
        resumen.operativas.map(({ id, estado, atencionPorAviso, retencionComposicion }) => ({
          id,
          estado,
          atencionPorAviso,
          aviso: retencionComposicion ?? undefined,
        })),
        esperadas,
      );
    }
  }
});

test('las dos lecturas rechazan una fecha imposible, una versión posterior al primer fallo y datos ajenos al aviso', () => {
  const invalidas = [
    { ...BARCELONA_ACTIVA, desde: '2026-02-30T10:00:00Z' },
    { ...BARCELONA_ACTIVA, versionEn: '2026-10-20T22:30:00.200002Z' },
    { ...BARCELONA_ACTIVA, ruta: '/ruta-interna' },
  ];
  for (const { leer } of LECTORES) {
    for (const aviso of invalidas) {
      assert.throws(() => leer(observacion({ ...DOS, barcelonactiva: aviso })));
    }
  }
});

const TEXTOS = {
  es: {
    atencion: 'Necesita atención',
    comprobada: 'Comprobada',
    motivo: 'La nueva versión superó el tamaño máximo de un documento de evidencia del catálogo.',
    barcelonactiva:
      'Se conserva la versión aplicada hace 27 días, el 18 oct. 2026 a las 12:00. ' +
      'La retención empezó hace 24 días, el 21 oct. 2026 a las 0:30.',
    fundae:
      'Se conserva la versión aplicada hace 26 días, el 19 oct. 2026 a las 14:00. ' +
      'La retención empezó hace 24 días, el 21 oct. 2026 a las 13:15.',
  },
  ca: {
    atencion: 'Necessita atenció',
    comprobada: 'Comprovada',
    motivo: 'La versió nova va superar la mida màxima d’un document d’evidència del catàleg.',
    barcelonactiva:
      'Es conserva la versió aplicada fa 27 dies, el 18 d’oct. del 2026 a les 12:00. ' +
      'La retenció va començar fa 24 dies, el 21 d’oct. del 2026 a les 0:30.',
    fundae:
      'Es conserva la versió aplicada fa 26 dies, el 19 d’oct. del 2026 a les 14:00. ' +
      'La retenció va començar fa 24 dies, el 21 d’oct. del 2026 a les 13:15.',
  },
} as const;

function comprobarTarjeta(
  destino: Elemento,
  fuente: Fuente,
  textos: (typeof TEXTOS)[keyof typeof TEXTOS],
  retenida: boolean,
) {
  const tarjeta = destino
    .querySelectorAll('article.salud-fuente')
    .find((n) => n.querySelector('h4')?.textContent === fuente.nombre);
  assert.ok(tarjeta && !tarjeta.hidden, fuente.nombre);
  const indicador = tarjeta.querySelector('.salud-indicador');
  assert.ok(indicador?.textContent.includes(retenida ? textos.atencion : textos.comprobada), fuente.nombre);
  const diagnostico = tarjeta.querySelector('details.salud-fuente-detalle');
  assert.ok(diagnostico);
  const parrafos = diagnostico.querySelectorAll('p').map((p) => p.textContent);
  assert.deepEqual(
    parrafos.filter((p) => p === textos.barcelonactiva || p === textos.fundae || p === textos.motivo),
    retenida ? [textos[fuente.id], textos.motivo] : [],
    fuente.nombre,
  );
}

test('las tarjetas muestran el aviso propio en español y catalán y solo lo retiran de la fuente recuperada', (t) => {
  instalar(t);
  fijarReloj(t);
  t.after(() => activarIdiomaPanel());
  for (const idioma of ['es', 'ca'] as const) {
    activarIdiomaPanel(idioma);
    const destino = nodo('div');
    for (const retenciones of [UNA, DOS, RECUPERADA]) {
      mostrarEstadoDatos(html(destino), leerNavegador(observacion(retenciones)));
      for (const fuente of FUENTES) {
        comprobarTarjeta(destino, fuente, TEXTOS[idioma], Object.hasOwn(retenciones, fuente.id));
      }
    }
  }
});
