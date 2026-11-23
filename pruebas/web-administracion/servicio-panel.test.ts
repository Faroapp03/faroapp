import './idiomas.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EstadoTrabajos } from '../../src/administracion/trabajos.ts';
import { abrirPanelYConsultar } from '../../web/administracion/capacidades.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import {
  nombreDeSeccion,
  resumenCambioControles,
  resumenCambioSecciones,
} from '../../web/administracion/confirmacion-cambios.js';
import type { EstadoActivacion } from '../../web/administracion/estado-activacion.js';
import { resumirRevisiones } from '../../web/administracion/revisiones-panel.js';
import { resumirSaludDatos } from '../../web/administracion/salud-datos.js';
import { SECCIONES_DEL_APARTADO } from '../../web/administracion/secciones-del-panel.js';
import { mostrarServicio, resumirServicio } from '../../web/administracion/servicio-panel.js';
import { texto } from '../../web/scripts/textos.js';
import { instantaneaSalud, operacionSalud } from '../ayudas/salud-datos.ts';
import { Elemento, instalar } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const AHORA = Date.parse('2026-10-24T10:00:00Z');
const SOLICITUD = '11111111-1111-4111-8111-111111111111';
const OTRA = '44444444-4444-4444-8444-444444444444';
const SECCIONES_CON_INTERRUPTOR = 7;

function activa(cambios: Partial<Activa> = {}): Activa {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    sesion: { estado: 'activa', iniciadaEn: 1, ultimaActividadEn: 1, caducaPorInactividadEn: 2, caducaAbsolutaEn: 3 },
    controles: { version: 2, revision: 1, api: 'habilitada', mcp: true, a2a: false },
    ...cambios,
  };
}
function trabajos(resultado: 'validado' | 'sin-pendientes' | 'rechazado' | 'retirado' | null): EstadoTrabajos {
  const creadoEn = Date.parse('2026-10-24T04:00:00Z');
  return {
    version: 1,
    revision: 1,
    ultimoTrabajo: {
      solicitudId: SOLICITUD,
      revisionReserva: 1,
      accion: 'actualizar-datos',
      revisionBase: 0,
      creadoEn,
      actualizadoEn: creadoEn,
      estado: resultado ? 'terminado' : 'despachado',
      runId: resultado ? '1' : null,
      runAttempt: '1',
      resultado: resultado
        ? { resultado, veredicto: null, terminadoEn: '2026-10-24T05:10:00Z', huellaPaquete: null, error: null }
        : null,
    },
  } as EstadoTrabajos;
}
function activacion(solicitudId: string, fase: 'confirmada' | 'rechazada' | 'subiendo'): EstadoActivacion {
  const instante = Date.parse('2026-10-24T05:30:00Z');
  return {
    version: 1,
    revision: 1,
    ultimaActivacion: {
      solicitudId,
      revisionReserva: 1,
      fase,
      dosServicios: false,
      motivoAbandono: null,
      reintento: null,
      datosSinPublicarDesde: fase === 'rechazada' ? instante : null,
      cierre: null,
      motivoDetenida: null,
      servidoDetenida: null,
      creadoEn: instante,
      actualizadoEn: instante,
      versionId: null,
      deploymentId: null,
      error: null,
    },
  };
}
const fila = (estado: EstadoClientePanel, titulo: string) =>
  resumirServicio(estado, AHORA).find((f) => f.titulo === titulo);

test('sin lecturas, el servicio dice «sin comprobar» y nunca pinta en verde', () => {
  activarIdiomaPanel('es');
  assert.deepEqual(resumirServicio({ estado: 'cerrada', aviso: null }, AHORA), []);
  const filas = resumirServicio(activa(), AHORA);
  assert.equal(filas.length, 2);
  for (const f of filas) {
    assert.equal(f.indicador.texto, 'Sin comprobar');
    assert.notEqual(f.indicador.tono, 'verde');
    assert.ok(f.indicador.forma.length > 0, 'el estado lleva una forma además del color');
    assert.match(f.accion, /Vuelve a abrir el panel/);
  }
  const publicacion = fila(activa(), 'Datos nuevos y publicación');
  assert.ok(publicacion?.datos.some(([, valor]) => /Sin comprobar: el servidor todavía no ofrece/.test(valor)));
});

test('cada tema muestra último intento, última comprobación válida, causa y acción en hora de Cataluña', () => {
  activarIdiomaPanel('es');
  const mercado = fila(activa({ datos: instantaneaSalud() }), 'Mercado');
  assert.ok(mercado);
  assert.equal(mercado.indicador.texto, 'Comprobada');
  assert.equal(mercado.indicador.forma, '●');
  assert.deepEqual(mercado.datos, [
    ['Último intento', 'hace 2 días, el 22 oct. 2026 a las 12:00 · Consulta correcta'],
    ['Última comprobación válida', 'hace 2 días, el 22 oct. 2026 a las 12:00'],
  ]);
  assert.equal(mercado.accion, 'No hace falta hacer nada.');
  activarIdiomaPanel('ca');
  assert.equal(fila(activa({ datos: instantaneaSalud() }), 'Mercat')?.accion, 'No cal fer res.');
  activarIdiomaPanel('es');
});

test('una consulta fallida pide actualizar y una fuente sin comprobación pide avisar, sin dar nada por bueno', () => {
  activarIdiomaPanel('es');
  const fallo = operacionSalud({ resultado: 'fallo' });
  const datos = instantaneaSalud({
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
  assert.equal(resumirSaludDatos(datos).temas[0]?.estado, 'incidencia');
  const incidencia = fila(activa({ datos }), 'Mercado');
  assert.equal(incidencia?.indicador.texto, 'No se pudo comprobar');
  assert.match(incidencia?.causa ?? '', /La última consulta a Empresas y uso de IA no terminó bien/);
  assert.equal(incidencia?.accion, 'Pulsa Actualizar datos, en Actualizaciones.');
  const base = instantaneaSalud();
  const sinComprobacion = instantaneaSalud({
    seguimientoRemoto: [],
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: null })),
    comprobaciones: { ...base.comprobaciones, conjuntos: [] },
  });
  const ausente = fila(activa({ datos: sinComprobacion }), 'Mercado');
  assert.equal(ausente?.indicador.texto, 'Sin comprobación registrada');
  assert.equal(ausente?.accion, 'Avisa al equipo técnico.');
});

test('datos nuevos: pendientes, publicados o rechazados salen del trabajo y la publicación de la misma solicitud', () => {
  activarIdiomaPanel('es');
  const titulo = 'Datos nuevos y publicación';
  const pendientes = fila(
    activa({ trabajos: trabajos('validado'), activacion: activacion(OTRA, 'confirmada') }),
    titulo,
  );
  assert.equal(pendientes?.indicador.texto, 'Sin publicar todavía');
  assert.equal(pendientes?.causa, 'Datos nuevos preparados hoy a las 7:10, aún no publicados.');
  assert.equal(pendientes?.accion, 'Avisa al equipo técnico.');
  const publicados = fila(
    activa({ trabajos: trabajos('validado'), activacion: activacion(SOLICITUD, 'confirmada') }),
    titulo,
  );
  assert.equal(publicados?.indicador.texto, 'Nada pendiente');
  assert.equal(
    publicados?.causa,
    'Según el registro del servidor, los datos preparados hoy a las 7:10 se publicaron hoy a las 7:30.',
  );
  const rechazados = fila(
    activa({ trabajos: trabajos('validado'), activacion: activacion(SOLICITUD, 'rechazada') }),
    titulo,
  );
  assert.equal(rechazados?.indicador.tono, 'rojo');
  assert.equal(rechazados?.accion, 'Avisa al equipo técnico.');
  const sinLectura = fila(activa({ trabajos: trabajos('validado') }), titulo);
  assert.equal(sinLectura?.indicador.texto, 'Sin comprobar');
  const enMarcha = fila(activa({ trabajos: trabajos(null), activacion: activacion(OTRA, 'subiendo') }), titulo);
  assert.equal(enMarcha?.indicador.texto, 'Sin terminar');
  assert.match(enMarcha?.accion ?? '', /Espera a que termine/);
  for (const f of [pendientes, publicados, rechazados]) {
    assert.ok(
      f?.datos.some(([etiqueta, valor]) => etiqueta === 'Versión que ven las personas' && /Sin comprobar/.test(valor)),
    );
  }
});

/** Cliente de prueba que anota cada lectura y responde con el estado que fije la prueba. */
function clienteQueAnota(llamadas: string[], estado: () => EstadoClientePanel) {
  const anotar = (nombre: string) => async () => {
    llamadas.push(nombre);
    return estado();
  };
  return {
    abrir: async (retomar = false) => {
      llamadas.push(retomar ? 'retomar' : 'abrir');
      return estado();
    },
    consultarSecciones: anotar('secciones'),
    consultarDatos: anotar('datos'),
    consultarTrabajo: anotar('trabajo'),
    consultarActivacion: anotar('activacion'),
  };
}
test('al abrir se leen también datos, trabajo y publicación, en orden y solo con la sesión libre', async () => {
  const llamadas: string[] = [];
  let estado: EstadoClientePanel = activa();
  const cliente = clienteQueAnota(llamadas, () => estado);
  const lecturas = (actualizacion: boolean, retomar = false) => ({ retomar, actualizacion });
  await abrirPanelYConsultar(
    cliente,
    () => false,
    () => estado,
    lecturas(true),
  );
  assert.deepEqual(llamadas, ['abrir', 'secciones', 'datos', 'trabajo', 'activacion']);
  llamadas.length = 0;
  await abrirPanelYConsultar(
    cliente,
    () => false,
    () => estado,
    lecturas(false),
  );
  assert.deepEqual(llamadas, ['abrir', 'secciones', 'datos'], 'sin actualización no se lee el trabajo');
  llamadas.length = 0;
  await abrirPanelYConsultar(
    cliente,
    () => false,
    () => estado,
    lecturas(false, true),
  );
  assert.equal(llamadas[0], 'retomar', 'retomar solo sale de la decisión explícita que llega en las lecturas');
  llamadas.length = 0;
  estado = { estado: 'error', aviso: 'no_disponible' };
  await abrirPanelYConsultar(
    cliente,
    () => false,
    () => estado,
    lecturas(true),
  );
  assert.deepEqual(llamadas, ['abrir'], 'una sesión que no se abre no lanza más lecturas');
});

test('el resumen del cambio dice qué notarán las personas y no aparece si no cambia nada', () => {
  activarIdiomaPanel('es');
  const confirmadas = { recorrido: true, cursos: true };
  assert.equal(resumenCambioSecciones(confirmadas, { ...confirmadas }), null);
  const cierre = resumenCambioSecciones(confirmadas, { recorrido: false, cursos: true }) ?? '';
  assert.match(cierre, /^Vas a guardar estos cambios:/);
  assert.match(cierre, /Cerrar «Empezar: recorrido e informe de ejemplo»: las personas dejarán de ver esta página/);
  assert.match(cierre, /Nadie podrá empezar el recorrido ni ver el informe de ejemplo\./);
  assert.match(cierre, /sin conexión verá el cambio cuando vuelva a conectarse/);
  assert.doesNotMatch(cierre, /Cursos/);
  const controles = activa();
  assert.equal(resumenCambioControles(controles, { version: 2, api: 'habilitada', mcp: true, a2a: false }), null);
  assert.equal(
    resumenCambioControles(
      { estado: 'cerrada', aviso: null },
      { version: 2, api: 'deshabilitada', mcp: true, a2a: false },
    ),
    null,
  );
  const apagado = resumenCambioControles(controles, { version: 2, api: 'deshabilitada', mcp: true, a2a: true }) ?? '';
  assert.match(apagado, /Apagar la API para aplicaciones: las instituciones dejarán de poder consultar Faro/);
  assert.match(apagado, /Encender la conexión para agentes de IA/);
  assert.match(apagado, /La web sigue funcionando igual para las personas\.\n¿Quieres guardarlos\?$/);
  activarIdiomaPanel('ca');
  assert.match(
    resumenCambioSecciones(confirmadas, { recorrido: false, cursos: true }) ?? '',
    /^Desaràs aquests canvis:.*Vols desar-los\?$/su,
  );
  activarIdiomaPanel('es');
});

test('guardar secciones o controles pide confirmación y, si se rechaza, no envía el cambio', async (t) => {
  const { prepararPanel } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar(activa());
  p.alConfirmar(() => false);
  p.campo('api').checked = false;
  p.campo('api').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  assert.match(p.confirmaciones.at(-1) ?? '', /Apagar la API para aplicaciones/);
  assert.equal(p.llamadas.includes('cambiar'), false);
  p.alConfirmar(() => true);
  p.campo('guardar').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.includes('cambiar'), true);
});

test('«Revisiones que tocan» enseña el plazo de las fichas y las partes de revisión manual que trae el servidor', () => {
  activarIdiomaPanel('es');
  const base = instantaneaSalud();
  const [conjunto] = base.comprobaciones.conjuntos;
  assert.ok(conjunto);
  const datos = instantaneaSalud({
    formacionAbiertaRevisionPendiente: '2026-09-30',
    fuentes: [...base.fuentes, { ...base.fuentes[0], id: 'abierta' } as (typeof base.fuentes)[number]],
    comprobaciones: {
      ...base.comprobaciones,
      conjuntos: [
        ...base.comprobaciones.conjuntos,
        { ...conjunto, id: 'manual', fuente: 'empresas', operacion: 'revision', revisionNecesaria: true },
      ],
    },
    catalogoFuentes: [
      ...base.catalogoFuentes,
      { id: 'abierta', nombre: 'Formación abierta', tema: 'cursos', modalidad: 'operativa' },
    ],
  });
  const revisiones = resumirRevisiones(datos, AHORA);
  assert.deepEqual(
    revisiones.map((r) => [r.fuente, r.estado]),
    [
      ['Formación abierta', 'vencida'],
      ['Empresas y uso de IA', 'manual'],
    ],
  );
  assert.equal(
    revisiones[0]?.texto,
    'La revisión de las fichas está pendiente: venció hace 24 días, el 30 sept. 2026.',
  );
  assert.equal(revisiones[1]?.texto, 'Última comprobación registrada hace 2 días, el 22 oct. 2026 a las 12:00.');
  assert.deepEqual(resumirRevisiones(instantaneaSalud(), AHORA), []);
});

test('las siete secciones con interruptor se nombran como en su etiqueta, nunca con una clave', () => {
  const fuente = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  const conInterruptor = SECCIONES_DEL_APARTADO.map(({ id }) => id);
  assert.equal(conInterruptor.length, SECCIONES_CON_INTERRUPTOR);
  for (const idioma of ['es', 'ca'] as const) {
    activarIdiomaPanel(idioma);
    const confirmadas = Object.fromEntries(conInterruptor.map((id) => [id, true]));
    const cierre =
      resumenCambioSecciones(confirmadas, Object.fromEntries(conInterruptor.map((id) => [id, false]))) ?? '';
    for (const linea of cierre.split('\n')) {
      assert.doesNotMatch(linea, /panel\./u, linea);
    }
    for (const id of conInterruptor) {
      const etiqueta = new RegExp(`for="seccion-${id}"\\s*><span data-texto="([^"]+)"`, 'u').exec(fuente)?.[1];
      assert.ok(etiqueta, id);
      assert.equal(nombreDeSeccion(id), texto(etiqueta));
      assert.ok(cierre.includes(`«${texto(etiqueta)}»`), id);
    }
  }
  activarIdiomaPanel('es');
});

test('guardar secciones sin confirmar no envía nada; al confirmar se envía el cambio', async (t) => {
  const { prepararPanel } = await import('./panel-dom.ts');
  const { politicaSeccionesInicial } = await import('../../src/administracion/secciones-web.js');
  const p = await prepararPanel(t);
  p.publicar({ ...activa(), secciones: { version: 3, revision: 0, secciones: politicaSeccionesInicial() } });
  p.alConfirmar(() => false);
  p.campo('seccion-entender-ia').checked = false;
  p.campo('seccion-entender-ia').dispatchEvent(new Event('change'));
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.match(p.confirmaciones.at(-1) ?? '', /Cerrar «Qué es IA»/u);
  assert.equal(p.llamadas.includes('guardar-secciones'), false);
  assert.equal(p.campo('seccion-entender-ia').checked, true, 'el interruptor vuelve a lo confirmado');
  p.alConfirmar(() => true);
  p.campo('seccion-entender-ia').checked = false;
  p.campo('seccion-entender-ia').dispatchEvent(new Event('change'));
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.includes('guardar-secciones'), true);
});

test('si la última actualización no preparó datos, la fila no dice «nada pendiente» porque no ve las anteriores', () => {
  activarIdiomaPanel('es');
  const titulo = 'Datos nuevos y publicación';
  for (const resultado of ['sin-pendientes', 'rechazado'] as const) {
    const f = fila(activa({ trabajos: trabajos(resultado), activacion: activacion(OTRA, 'confirmada') }), titulo);
    assert.notEqual(f?.indicador.texto, 'Nada pendiente');
    assert.notEqual(f?.indicador.tono, 'verde');
    assert.match(f?.causa ?? '', /Solo se conoce la última actualización\./u);
  }
  const sinPendientes = fila(activa({ trabajos: trabajos('sin-pendientes') }), titulo);
  assert.equal(sinPendientes?.indicador.texto, 'Sin comprobar del todo');
  assert.match(sinPendientes?.accion ?? '', /consulta «Publicación de los datos»/u);
});

test('cada tema lleva a su detalle por fuente y, sin conexión, el apartado dice «Sin comprobar»', (t) => {
  activarIdiomaPanel('es');
  const mercado = fila(activa({ datos: instantaneaSalud() }), 'Mercado');
  assert.deepEqual(mercado?.enlace, { href: '#panel-fuentes', texto: 'Ver el detalle de cada fuente de Mercado' });
  const destino = new Elemento('div');
  instalar(t, {
    document: {
      createElement: (tag: string) => new Elemento(tag),
      getElementById: (id: string) => (id === 'servicio-temas' ? destino : null),
    },
  });
  mostrarServicio(activa({ datos: instantaneaSalud() }), true);
  assert.match(destino.textContent ?? '', /Sin comprobar.*Sin conexión no se puede leer el estado de los datos\./su);
  assert.doesNotMatch(destino.textContent ?? '', /Comprobada|Mercado/u);
});

test('una actualización retirada por la persona tiene su propia frase y no se pinta como fallo', () => {
  activarIdiomaPanel('es');
  const f = fila(activa({ trabajos: trabajos('retirado') }), 'Datos nuevos y publicación');
  assert.equal(f?.indicador.tono, 'neutro');
  assert.match(f?.causa ?? '', /^La actualización se retiró hoy a las 7:10 y no preparó datos nuevos\./u);
  assert.doesNotMatch(f?.causa ?? '', /fallo/u);
  activarIdiomaPanel('ca');
  assert.match(
    fila(activa({ trabajos: trabajos('retirado') }), 'Dades noves i publicació')?.causa ?? '',
    /^L’actualització es va retirar avui/u,
  );
  activarIdiomaPanel('es');
});
