/** El Inicio del Panel de Control: áreas, indicadores, lo que requiere atención y la actividad, con datos y sin ellos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import type { FilaRegistroPanel } from '../../src/administracion/sesion-unica.ts';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { marcaEstado } from '../../web/administracion/estado-visual.js';
import { areasDelServicio, requiereAtencion } from '../../web/administracion/inicio-datos.js';
import { crearVistaInicio } from '../../web/administracion/vista-inicio.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = Date.parse('2026-11-23T09:00:00Z');
const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;
const MINUTO = 60_000;
const AREAS = 9;
const IDS = [
  'inicio-indicadores',
  'inicio-estado',
  'inicio-atencion',
  'inicio-atencion-cuenta',
  'inicio-actividad',
  'inicio-comprobado',
  'inicio-exportar',
];

function sinLecturas(): Activa {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
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
  };
}
/** Dos fuentes en uso: una comprobada y Citilab con incidencia (su módulo terminó en ámbar). */
function conFuentes(): Activa {
  const base = instantaneaSalud();
  const datos = instantaneaSalud({
    catalogoFuentes: [
      ...base.catalogoFuentes,
      { id: 'citilab', nombre: 'Citilab', tema: 'cursos', modalidad: 'operativa' },
    ],
    modulos: [
      ...base.modulos,
      {
        id: 'citilab',
        ultimoIntento: null,
        veredicto: 'ámbar',
        ultimaVersionBuena: null,
        fallos: 1,
        proximoReintento: null,
      },
    ],
  } as never);
  return { ...sinLecturas(), datos };
}
const contexto = (avisos: Parameters<typeof areasDelServicio>[1]['avisos'] = null) => ({
  idSesion: 'S-4H8RZT1C',
  avisos,
  recibido: () => INICIO,
});
function dom(t: TestContext) {
  const elementos = new Map(IDS.map((id) => [id, new Elemento('div')]));
  navegador(t, {
    document: {
      createElement: (etiqueta: string) => new Elemento(etiqueta),
      createElementNS: (_espacio: string, etiqueta: string) => new Elemento(etiqueta),
      getElementById: (id: string) => elementos.get(id) ?? null,
    },
  });
  t.after(() => activarIdiomaPanel());
  return (id: string) => elementos.get(id) as Elemento;
}
const fila = (instante: number, tipo: FilaRegistroPanel['tipo'], idSesion: string | null): FilaRegistroPanel => ({
  instante,
  tipo,
  correo: 'ana@faro.invalid',
  idEntrada: 'E-7K2M9QXA',
  idSesion,
  motivo: null,
  titular: null,
});

test('fuentes: dice cuántas están bien y cuáles tienen incidencia, por su nombre, y eso va primero', () => {
  activarIdiomaPanel('es');
  const areas = areasDelServicio(conFuentes(), contexto());
  const fuentes = areas.find((a) => a.id === 'fuentes');
  assert.equal(fuentes?.estado, 'Incidencia');
  assert.equal(fuentes?.detalle, '1 de 2 bien · Citilab');
  assert.equal(fuentes?.tono, 'atencion');
  assert.deepEqual(
    requiereAtencion(areas).map((a) => a.id),
    ['fuentes'],
  );
  assert.equal(areas.length, AREAS);
});

test('sin lecturas cada área dice «Sin dato» y no se inventa ningún estado ni cifra', (t) => {
  const campo = dom(t);
  activarIdiomaPanel('es');
  const vista = crearVistaInicio();
  vista.mostrar(sinLecturas(), contexto());
  const filas = campo('inicio-estado').querySelectorAll('tr');
  assert.equal(filas.length, AREAS);
  const estados = campo('inicio-estado')
    .querySelectorAll('.panel-estado-palabra')
    .map((e) => e.textContent);
  assert.deepEqual(estados, [
    'Sin dato',
    'Sin dato',
    'Sin dato',
    'Sin dato',
    'Sin dato',
    'Abierto',
    'Sin dato',
    'Sin dato',
    'Sin activar',
  ]);
  const indicadores = campo('inicio-indicadores')
    .querySelectorAll('.panel-kpi-cifra')
    .map((e) => e.textContent);
  // Sin nada comprobado no se afirma que todo esté bien: se dice cuántas áreas no tienen dato.
  // Ni «Sin problemas» ni «Todo bien»: faltan datos para afirmarlo.
  assert.deepEqual(indicadores, ['Sin datos suficientes', 'Sin dato', 'Sin dato', 'Sin dato']);
  assert.match(campo('inicio-indicadores').textContent, /1 de 9 áreas bien · 7 sin dato/);
  assert.doesNotMatch(campo('inicio-indicadores').textContent, /Todo bien/);
  assert.equal(campo('inicio-atencion').textContent, 'Nada requiere atención en lo que se ha comprobado.');
  assert.equal(campo('inicio-actividad').textContent, 'No se ha podido consultar el registro del panel.');
  activarIdiomaPanel('ca');
  vista.mostrar(sinLecturas(), contexto());
  assert.match(campo('inicio-estado').textContent, /Font.*Sense dada/);
  assert.equal(campo('inicio-atencion').textContent, 'Res no requereix atenció en el que s’ha comprovat.');
});

test('con datos: indicadores de las fuentes con su incidencia, lo grave primero y la actividad más nueva arriba', (t) => {
  const campo = dom(t);
  activarIdiomaPanel('es');
  const vista = crearVistaInicio();
  vista.recibirRegistro([
    fila(INICIO, 'entrada', null),
    fila(INICIO + 2 * MINUTO, 'sesion-abierta', 'S-4H8RZT1C'),
    fila(INICIO + MINUTO, 'sesion-cerrada', 'S-2PLNQ8RA'),
  ]);
  vista.mostrar(conFuentes(), contexto());
  const cifras = campo('inicio-indicadores')
    .querySelectorAll('.panel-kpi-cifra')
    .map((e) => e.textContent);
  assert.deepEqual(cifras, ['1 por revisar', 'Sin dato', '1 / 2', 'Sin dato']);
  assert.match(campo('inicio-indicadores').textContent, /Con incidencia: Citilab/);
  assert.match(campo('inicio-atencion').textContent, /^Fuentes · Incidencia1 de 2 bien · CitilabIr a Fuentes$/);
  const horas = campo('inicio-actividad')
    .querySelectorAll('.panel-actividad-hora')
    .map((e) => e.textContent);
  assert.deepEqual(horas, ['10:02', '10:01', '10:00']);
  assert.match(
    campo('inicio-actividad').textContent,
    /ana@faro\.invalid · Abierta · Abrió la sesión única S-4H8RZT1C\./,
  );
  assert.equal(campo('inicio-actividad').querySelectorAll('.panel-actividad--atenuada').length, 1);
  // El identificador va en su propia pieza, que no se parte entre líneas.
  assert.equal(campo('inicio-actividad').querySelector('.sesion-unica-id')?.textContent, 'S-4H8RZT1C');
  const enlace = campo('inicio-estado').querySelector('a');
  assert.equal(enlace?.getAttribute('href'), '#apartado-fuentes');
  activarIdiomaPanel('ca');
  vista.mostrar(conFuentes(), contexto());
  assert.match(campo('inicio-indicadores').textContent, /Amb incidència: Citilab/);
});

test('«Sin datos suficientes» lleva la cifra de frase larga en los dos idiomas; las cifras con números, no', (t) => {
  const campo = dom(t);
  const clases = () =>
    campo('inicio-indicadores')
      .querySelectorAll('.panel-kpi-cifra')
      .map((e) => [e.textContent, e.className]);
  const vista = crearVistaInicio();
  activarIdiomaPanel('es');
  vista.mostrar(sinLecturas(), contexto());
  assert.deepEqual(clases()[0], ['Sin datos suficientes', 'panel-kpi-cifra panel-kpi-cifra--texto']);
  assert.deepEqual(clases()[1], ['Sin dato', 'panel-kpi-cifra']);
  activarIdiomaPanel('ca');
  vista.mostrar(sinLecturas(), contexto());
  assert.deepEqual(clases()[0], ['Sense dades suficients', 'panel-kpi-cifra panel-kpi-cifra--texto']);
  activarIdiomaPanel('es');
  vista.mostrar(conFuentes(), contexto());
  for (const [, clase] of clases()) {
    assert.equal(clase, 'panel-kpi-cifra');
  }
});

test('avisos sin canal de correo: «Sin activar» y qué falta, nunca «comprueba la conexión»', () => {
  activarIdiomaPanel('es');
  const sinCanal = { sinLeer: false, disponible: true, verificacion: 'sin_destino', canalCorreo: 'no-configurado' };
  const avisos = areasDelServicio(sinLecturas(), contexto(sinCanal)).find((a) => a.id === 'avisos');
  assert.equal(avisos?.estado, 'Sin activar');
  assert.match(
    avisos?.detalle ?? '',
    /aún no están activados: falta que quien mantiene el servicio configure el envío/,
  );
  assert.doesNotMatch(avisos?.detalle ?? '', /conexión/);
  const sinLeer = { sinLeer: true, disponible: true, verificacion: null, canalCorreo: null };
  assert.equal(areasDelServicio(sinLecturas(), contexto(sinLeer)).find((a) => a.id === 'avisos')?.estado, 'Sin dato');
});

/** El símbolo que dibuja un icono: el destino de su <use>. */
const simbolo = (svg: Elemento | undefined) => svg?.querySelector('use')?.getAttribute('href');

test('cada estado lleva su icono de la maqueta, decorativo, y siempre su palabra al lado', (t) => {
  dom(t);
  const html = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  for (const tono of ['bien', 'curso', 'atencion', 'fallo', 'nada'] as const) {
    const marca = marcaEstado(tono, `Palabra ${tono}`) as unknown as Elemento;
    const [svg] = marca.querySelectorAll('svg');
    assert.equal(simbolo(svg), `#panel-i-estado-${tono}`);
    assert.equal(svg?.getAttribute('aria-hidden'), 'true');
    assert.equal(marca.querySelector('.panel-estado-palabra')?.textContent, `Palabra ${tono}`);
    assert.ok(marca.classList.contains(`panel-estado--${tono}`));
    assert.match(html, new RegExp(`<symbol id="panel-i-estado-${tono}" viewBox="0 0 16 16"`));
  }
});

test('la tabla lleva el icono de cada área, la línea de atención y un chevrón con nombre para abrir', (t) => {
  const campo = dom(t);
  activarIdiomaPanel('es');
  crearVistaInicio().mostrar(conFuentes(), contexto());
  const filas = campo('inicio-estado').querySelectorAll('tr');
  assert.deepEqual(
    filas.map((f) => simbolo(f.querySelector('th svg') ?? undefined)),
    [
      '#panel-i-datos',
      '#panel-i-actualizar',
      '#panel-i-datos',
      '#panel-i-web',
      '#panel-i-accesos',
      '#panel-i-registro',
      '#panel-i-encuesta',
      '#panel-i-avisos',
      '#panel-i-web',
    ],
  );
  assert.ok(filas[0]?.classList.contains('panel-tabla-fila--atencion'), 'Fuentes con incidencia lleva la línea ámbar');
  for (const fila of filas) {
    const enlace = fila.querySelector('.panel-tabla-ir');
    assert.equal(simbolo(enlace?.querySelector('svg') ?? undefined), '#panel-i-chevron');
    assert.equal(enlace?.textContent, '', 'sin la palabra «Abrir» a la vista');
    assert.match(enlace?.getAttribute('aria-label') ?? '', /^Abrir /);
  }
});

test('lo que requiere atención: contador, indicador con icono y fila con su botón; el informe sale de la tabla', (t) => {
  const campo = dom(t);
  activarIdiomaPanel('es');
  const vista = crearVistaInicio();
  assert.equal(vista.informe(), null, 'antes de pintar no hay nada que exportar');
  campo('inicio-exportar').setAttribute('disabled', '');
  vista.mostrar(conFuentes(), contexto());
  assert.equal(campo('inicio-exportar').hasAttribute('disabled'), false);
  assert.equal(campo('inicio-atencion-cuenta').textContent, '1');
  const general = campo('inicio-indicadores').querySelector('.panel-kpi');
  assert.ok(general?.classList.contains('panel-kpi--atencion'));
  assert.equal(simbolo(general?.querySelector('.panel-kpi-rotulo svg') ?? undefined), '#panel-i-estado-atencion');
  const fila = campo('inicio-atencion').querySelector('li');
  assert.equal(simbolo(fila?.querySelector('svg') ?? undefined), '#panel-i-estado-atencion');
  assert.equal(fila?.querySelector('.panel-boton--principal')?.getAttribute('href'), '#apartado-fuentes');
  const informe = vista.informe() ?? '';
  assert.ok(informe.startsWith('\uFEFFÁrea;Estado;Detalle;Comprobado\r\n'));
  assert.match(informe, /\r\nFuentes;Incidencia;1 de 2 bien · Citilab;14:00\r\n/);
  assert.equal(informe.trim().split('\r\n').length, AREAS + 1);
  vista.mostrar(sinLecturas(), contexto());
  assert.equal(campo('inicio-atencion-cuenta').textContent, '');
});
