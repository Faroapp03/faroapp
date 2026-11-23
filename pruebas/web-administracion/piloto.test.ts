import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREGUNTAS, resumenDe, type TipoDeCodigo } from '../../src/encuesta/cuestionario.ts';
import {
  csvDeResultados,
  enlacesCompletos,
  nombreDeArchivo,
  textoDelCorreo,
} from '../../web/administracion/archivos-piloto.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { crearOperacionesEncuesta, leerResultadosEncuesta } from '../../web/administracion/cliente-encuesta.js';
import { activarIdiomaPanel } from './idiomas.ts';
import { enRonda } from './ronda-encuesta.ts';

// Sesión con los plazos del servidor: 15 minutos de inactividad y 8 horas en total.
const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
const GRUPOS_FIJOS = 6;
const SESION = {
  estado: 'activa',
  iniciadaEn: INICIO,
  ultimaActividadEn: INICIO,
  caducaPorInactividadEn: INICIO + INACTIVIDAD,
  caducaAbsolutaEn: INICIO + ABSOLUTA,
};
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AHORA = Date.parse('2026-11-20T09:00:00Z');
const codigo = (tipo: 'PART' | 'PROF', i: number) =>
  `${tipo}${'-0000'.repeat(GRUPOS_FIJOS)}-000${'0123456789ABCDEF'[i]}`;
const lote = (cambios: Record<string, unknown> = {}) => ({
  id: ID,
  numero: 1,
  tipo: 'participante',
  nombre: 'Fundació Àgora',
  emitidos: 3,
  consumidos: 0,
  sinUsar: 3,
  ...cambios,
});
/**
 * Los recuentos de un tipo tal como los envía el servidor: cada pregunta con sus celdas y con la escala y la meta que
 * calcula el propio código del servidor (src/encuesta/cuestionario.ts), sin dobles.
 */
function recuentosDe(tipo: TipoDeCodigo, respuestas: number, cuentas: Record<string, Record<string, number>>) {
  const preguntas = Object.fromEntries(
    Object.entries(PREGUNTAS[tipo]).map(([pregunta, admitidos]) => {
      const valores = Object.fromEntries(admitidos.map((v) => [v, cuentas[pregunta]?.[v] ?? 0]));
      const denominador = Object.values(valores).reduce((a, b) => a + b, 0);
      return [pregunta, { denominador, valores, ...resumenDe(tipo, pregunta, valores) }];
    }),
  );
  return { respuestas, preguntas };
}
const PROFESIONALES = 3;
/** Dos personas (una no pudo ver su informe) y tres profesionales. */
function cerrada() {
  return enRonda({
    cuestionario: 'faro-piloto-2',
    abierta: false,
    lotes: [lote({ consumidos: 2, sinUsar: 0 })],
    totales: {
      participante: { emitidos: 3, consumidos: 2, sinUsar: 0 },
      profesional: { emitidos: 3, consumidos: 3, sinUsar: 0 },
    },
    recuentos: {
      participante: recuentosDe('participante', 2, {
        informe: { visto: 1, sin_ver: 1 },
        ocupacion: { si: 1 },
        comprension: { 4: 1 },
        formacion: { sin_ver: 1 },
        dificultad: { nada: 1 },
      }),
      profesional: recuentosDe('profesional', PROFESIONALES, {
        ayudaOrientacion: { 4: 2, 5: 1 },
        explicarCambio: { 3: 3 },
        encajeFormacion: { 4: 3 },
        fiabilidad: { 5: 3 },
        mejora: { accesibilidad: 3 },
      }),
    },
  });
}
const abierta = () => {
  const { version: _version, ronda: _ronda, rondas: _rondas, ...resto } = cerrada();
  return enRonda({ ...resto, abierta: true, recuentos: null });
};

/** Operaciones con un transporte de prueba que responde con el contrato acordado con el servidor. */
function operaciones(respuesta: { estado: number; cuerpo: unknown }) {
  const pedidos: { ruta: string; cuerpo: object }[] = [];
  const activaciones: unknown[] = [];
  const privado = {
    estado: {
      estado: 'activa',
      controles: { version: 2, revision: 1 },
      conflicto: false,
    } as unknown as EstadoClientePanel,
    token: 'token',
    trabajo: null,
    sesion: SESION,
  };
  const ops = crearOperacionesEncuesta(privado as never, {
    ejecutar: async (_p, _o, accion) => {
      await accion({ mutacion: false } as never);
      return privado.estado;
    },
    enviar: async (_p, _t, pedido) => {
      pedidos.push({ ruta: pedido.ruta, cuerpo: pedido.cuerpo });
      return respuesta;
    },
    vigente: () => true,
    rechazar: (r) => {
      throw new Error(`rechazada ${r.estado}`);
    },
    activar: (_p, datos) => {
      activaciones.push(datos.sesion);
    },
  });
  return { ops, pedidos, activaciones };
}

test('crear un lote envía nombre, tipo y cantidad y devuelve los enlaces del contrato, solo a quien los pidió', async () => {
  const codigos = [0, 1, 2].map((i) => {
    const c = codigo('PART', i);
    return { codigo: c, enlaceRelativo: `/inicio.html#invitacion=${c}` };
  });
  const { ops, pedidos } = operaciones({
    estado: 200,
    cuerpo: { estado: 'activa', sesion: SESION, lote: lote(), codigos },
  });
  const creado = await ops.crearLoteEncuesta({ tipo: 'participante', cantidad: 3, nombre: 'Fundació Àgora' });
  assert.deepEqual(pedidos, [
    { ruta: 'encuesta/crear-lote', cuerpo: { tipo: 'participante', cantidad: 3, nombre: 'Fundació Àgora' } },
  ]);
  assert.ok(creado && 'codigos' in creado);
  assert.equal(
    enlacesCompletos(creado.codigos, 'https://faro.example'),
    codigos.map((c) => `https://faro.example${c.enlaceRelativo}`).join('\n'),
  );
  // Un enlace que no sigue el contrato (otra página o un código de otro tipo) invalida la respuesta entera.
  for (const malo of [`/encuesta.html#codigo=${codigos[0]?.codigo}`, `/inicio.html#invitacion=${codigo('PROF', 0)}`]) {
    const otro = operaciones({
      estado: 200,
      cuerpo: {
        estado: 'activa',
        sesion: SESION,
        lote: lote(),
        codigos: [{ codigo: codigos[0]?.codigo, enlaceRelativo: malo }, ...codigos.slice(1)],
      },
    });
    await assert.rejects(otro.ops.crearLoteEncuesta({ tipo: 'participante', cantidad: 3, nombre: 'Fundació Àgora' }));
  }
});

test('lote pequeño, encuesta cerrada, límite de lotes y cuestionario anterior vuelven como error propio', async () => {
  const casos = [
    [{ estado: 400, cuerpo: { error: 'lote_demasiado_pequeno', minimo: 3 } }, 'lote_demasiado_pequeno'],
    [{ estado: 409, cuerpo: { error: 'encuesta_cerrada' } }, 'encuesta_cerrada'],
    [{ estado: 409, cuerpo: { error: 'limite_lotes' } }, 'limite_lotes'],
    [{ estado: 409, cuerpo: { error: 'cuestionario_anterior' } }, 'cuestionario_anterior'],
  ] as const;
  for (const [respuesta, error] of casos) {
    const { ops, activaciones } = operaciones(respuesta);
    assert.deepEqual(await ops.crearLoteEncuesta({ tipo: 'profesional', cantidad: 3, nombre: 'Entidad' }), { error });
    assert.deepEqual(activaciones, [SESION], 'el panel queda libre con la sesión confirmada');
  }
  // Un 400 genérico no se confunde con el de lote pequeño: pasa al lector común de errores.
  const generico = operaciones({ estado: 400, cuerpo: { error: 'solicitud_invalida' } });
  await assert.rejects(generico.ops.crearLoteEncuesta({ tipo: 'profesional', cantidad: 3, nombre: 'Entidad' }), /400/);
  // Consultar o cerrar una instalación con respuestas de un cuestionario anterior también trae su motivo.
  for (const operacion of ['consultarEncuesta', 'cerrarEncuesta'] as const) {
    const { ops } = operaciones({ estado: 409, cuerpo: { error: 'cuestionario_anterior' } });
    assert.deepEqual(await ops[operacion](), { error: 'cuestionario_anterior' }, operacion);
  }
});

test('el lector de resultados es cerrado: con la encuesta abierta no admite recuentos', () => {
  assert.equal(leerResultadosEncuesta(abierta()).recuentos, null);
  assert.equal(leerResultadosEncuesta(cerrada()).recuentos?.participante.respuestas, 2);
  assert.throws(() => leerResultadosEncuesta({ ...abierta(), recuentos: cerrada().recuentos }));
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), recuentos: null }));
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), extra: 1 }));
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), lotes: [lote({ nombre: 'dos\nlíneas' })] }));
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), lotes: [lote({ consumidos: 3, sinUsar: 1 })] }));
  // Los resultados de otro cuestionario o de otra versión del contrato no se leen.
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), cuestionario: 'faro-piloto-1' }));
  assert.throws(() => leerResultadosEncuesta({ ...cerrada(), version: 1 }));
  // Una meta que no cuadra con su pregunta tampoco: favorables por encima de la base, o una base que no suma.
  const metaImposible = cerrada();
  const ocupacion = metaImposible.recuentos.participante.preguntas.ocupacion as { meta: { favorables: number } };
  ocupacion.meta.favorables = 2;
  assert.throws(() => leerResultadosEncuesta(metaImposible));
  const leidos = leerResultadosEncuesta(cerrada());
  assert.equal(leidos.cuestionario, 'faro-piloto-2');
  assert.deepEqual(leidos.recuentos?.participante.preguntas.formacion?.meta, {
    criterio: 'proporcion',
    favorables: 0,
    base: 0,
    fueraDeLaBase: 1,
    objetivo: 90,
  });
});

test('archivo de enlaces y texto del correo, generados en el navegador, en los dos idiomas', () => {
  activarIdiomaPanel('es');
  assert.equal(
    nombreDeArchivo('Fundació Àgora / BCN', 'faro-invitaciones'),
    'faro-invitaciones-fundacio-agora-bcn.txt',
  );
  assert.equal(nombreDeArchivo('···', 'faro-invitaciones'), 'faro-invitaciones-entidad.txt');
  const correo = textoDelCorreo({ nombre: 'Fundació Àgora', tipo: 'participante', cantidad: 25 });
  assert.match(correo, /^Hola, equipo de Fundació Àgora:/u);
  assert.match(correo, /25 enlaces de invitación/u);
  assert.match(correo, /Cada enlace es para una sola persona/u);
  assert.match(correo, /anónima/u);
  assert.match(correo, /responder una sola vez/u);
  assert.match(correo, /contraseña general del sitio/u);
  activarIdiomaPanel('ca');
  const catala = textoDelCorreo({ nombre: 'Fundació Àgora', tipo: 'profesional', cantidad: 4 });
  assert.match(catala, /4 enllaços d’invitació per a professionals d’orientació de la prova pilot/u);
  assert.match(catala, /contrasenya general del lloc/u);
  activarIdiomaPanel('es');
});

test('el CSV lleva las mismas cifras que la pantalla, con su denominador, las invitaciones por lote y la fecha', () => {
  activarIdiomaPanel('es');
  const base = cerrada();
  // La ronda también la nombra quien administra: un nombre que parece una fórmula se guarda como texto.
  const ronda = { ...base.ronda, nombre: '+Ronda' };
  const resultados = leerResultadosEncuesta({
    ...base,
    ronda,
    rondas: [ronda],
    lotes: [lote({ nombre: '=HIPERVINCULO("x")', consumidos: 2, sinUsar: 0 })],
  });
  const csv = csvDeResultados(resultados, AHORA);
  const lineas = csv.replace('﻿', '').split('\r\n');
  // Punto y coma, como lo abre una hoja de cálculo con configuración española; la fecha, absoluta y en hora de Cataluña.
  assert.equal(lineas[0], 'apartado;tipo;lote;entidad;pregunta;valor;texto;recuento;denominador;porcentaje;media');
  // El cuestionario que recogió las respuestas va en el archivo.
  assert.equal(lineas[1], 'cuestionario;;;;;faro-piloto-2;Cuestionario de la encuesta;;;;');
  // Cada archivo es de una ronda, con su número y su nombre.
  assert.equal(lineas[2], "ronda;;;;;1;'+Ronda;;;;");
  assert.equal(lineas[3], 'descarga;;;;;2026-11-20T09:00:00.000Z;Descargado: 20/11/2026 10:00, hora de Cataluña;;;;');
  assert.doesNotMatch(csv, /\bhoy\b/u);
  // Un nombre que una hoja de cálculo tomaría por fórmula se guarda como texto.
  assert.equal(
    lineas[4],
    `lote;participante;1;"'=HIPERVINCULO(""x"")";invitaciones_emitidas;;Invitaciones emitidas;3;;;`,
  );
  assert.equal(lineas[5], `lote;participante;1;"'=HIPERVINCULO(""x"")";invitaciones_usadas;;Invitaciones usadas;2;3;;`);
  // Cada porcentaje va junto a su numerador y su denominador, con un decimal.
  const esperadas = [
    'respuestas;participante;;;informe;sin_ver;¿Has podido ver tu informe de Faro? · No he podido llegar a verlo;1;2;50,0;',
    'respuestas;participante;;;ocupacion;si;¿La ocupación que aparece en tu informe se corresponde con tu trabajo? · Sí;1;1;100,0;',
    'indicador;participante;;;ocupacion;meta_favorables;¿La ocupación que aparece en tu informe se corresponde con tu trabajo? · Meta del piloto: al menos el 90 % de respuestas favorables;1;1;100,0;',
    'indicador;participante;;;formacion;meta_favorables;¿Cuánto te ha ayudado Faro a decidir qué formación buscar? · Meta del piloto: al menos el 90 % de respuestas favorables;0;0;;',
    'indicador;participante;;;formacion;fuera_de_la_base;¿Cuánto te ha ayudado Faro a decidir qué formación buscar? · Fuera de la base: no llegaron a ver la propuesta de formación;1;1;;',
    'respuestas;profesional;;;respuestas;;Respuestas recibidas;3;;;',
    'respuestas;profesional;;;ayudaOrientacion;4;¿Cuánto te ha ayudado Faro en tu trabajo de orientación con las personas que has atendido? · 4, Bastante;2;3;66,7;',
    'indicador;profesional;;;ayudaOrientacion;media;¿Cuánto te ha ayudado Faro en tu trabajo de orientación con las personas que has atendido? · Media sobre 5 (suma de puntos y respuestas);13;3;;4,3',
    'indicador;profesional;;;ayudaOrientacion;meta_media;¿Cuánto te ha ayudado Faro en tu trabajo de orientación con las personas que has atendido? · Meta del piloto: media de al menos 4 sobre 5;;;;4',
    'respuestas;profesional;;;mejora;accesibilidad;¿Qué mejorarías primero para usar Faro en tus sesiones? · La accesibilidad;3;3;100,0;',
  ];
  for (const linea of esperadas) {
    assert.ok(lineas.includes(linea), linea);
  }
  // Un nombre con punto y coma va entre comillas para no partir la columna.
  const conSeparador = csvDeResultados(
    leerResultadosEncuesta({ ...cerrada(), lotes: [lote({ nombre: 'Uno; dos', consumidos: 2, sinUsar: 0 })] }),
    AHORA,
  );
  assert.match(conSeparador, /^lote;participante;1;"Uno; dos";invitaciones_emitidas;/mu);
});

const turno = () => new Promise((resolver) => setImmediate(resolver));
function activaDePrueba(): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    sesion: SESION as never,
    controles: { version: 2, revision: 1, api: 'habilitada', mcp: false, a2a: false },
  };
}

test('pantalla Piloto: consultar, crear un lote, ver sus enlaces y olvidarlos al salir del apartado', async (t) => {
  const { prepararPanel, respuestasEncuesta } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar(activaDePrueba());
  assert.equal(p.campo('encuesta').hidden, false);
  assert.equal(p.campo('encuesta-campos').disabled, true, 'sin lectura no se crean lotes');
  respuestasEncuesta.consultar = { encuesta: leerResultadosEncuesta(abierta()) };
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  assert.ok(p.llamadas.includes('encuesta'));
  assert.match(p.campo('encuesta-lotes').textContent, /Fundació Àgora/u);
  assert.match(p.campo('encuesta-resultados').textContent, /comparar dos lecturas seguidas/u);
  assert.equal(p.campo('encuesta-campos').disabled, false);
  // Un nombre vacío no llega al servidor y dice qué hacer.
  p.campo('encuesta-cantidad').value = '3';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.equal(p.llamadas.includes('crear-lote'), false);
  assert.match(p.campo('encuesta-estado').textContent, /Escribe el nombre de la entidad/u);
  const codigos = [0, 1, 2].map((i) => ({
    codigo: codigo('PART', i),
    enlaceRelativo: `/inicio.html#invitacion=${codigo('PART', i)}`,
  }));
  respuestasEncuesta.crearLote = {
    lote: { ...lote(), numero: 2, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    codigos,
  };
  p.campo('encuesta-nombre').value = 'Fundació Àgora';
  p.campo('encuesta-tipo-participante').checked = true;
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.deepEqual(p.registros.at(-1), { nombre: 'Fundació Àgora', cantidad: 3, tipo: 'participante' });
  assert.equal(p.campo('encuesta-enlaces').hidden, false);
  assert.equal(
    p.campo('encuesta-lista').value,
    codigos.map((c) => `https://faro.prueba${c.enlaceRelativo}`).join('\n'),
  );
  assert.match(p.campo('encuesta-correo').value, /contraseña general del sitio/u);
  assert.match(p.campo('encuesta-enlaces-para').textContent, /Fundació Àgora \(3\)/u);
  // Salir del apartado los retira de la pantalla: no se pueden volver a ver.
  (globalThis as unknown as { location: { hash: string } }).location.hash = '#panel-fuentes';
  p.ventana.dispatchEvent(new Event('hashchange'));
  assert.equal(p.campo('encuesta-enlaces').hidden, true);
  assert.equal(p.campo('encuesta-lista').value, '');
  assert.equal(p.campo('encuesta-correo').value, '');
});

test('pantalla Piloto: cerrar pide confirmación definitiva y muestra los recuentos con su denominador', async (t) => {
  const { prepararPanel, respuestasEncuesta } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar(activaDePrueba());
  respuestasEncuesta.consultar = { encuesta: leerResultadosEncuesta(abierta()) };
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  p.alConfirmar(() => false);
  p.campo('encuesta-cerrar').dispatchEvent(new Event('click'));
  await turno();
  assert.match(p.confirmaciones.at(-1) ?? '', /Es definitivo.*los enlaces que no se hayan usado dejarán de valer/u);
  assert.equal(p.llamadas.includes('cerrar-encuesta'), false);
  p.alConfirmar(() => true);
  respuestasEncuesta.cerrar = { encuesta: leerResultadosEncuesta(cerrada()) };
  p.campo('encuesta-cerrar').dispatchEvent(new Event('click'));
  await turno();
  const texto = p.campo('encuesta-resultados').textContent;
  assert.match(texto, /Cuestionario: faro-piloto-2\./u);
  assert.match(texto, /No he podido llegar a verlo: 1 de 2 \(50,0 %\)/u);
  assert.match(texto, /Sí: 1 de 1 \(100,0 %\)/u);
  assert.match(texto, /Meta del piloto: al menos el 90 %\. Resultado: 1 de 1 \(100,0 %\)\./u);
  assert.match(texto, /Quedan fuera de la base porque no llegaron a ver la propuesta de formación: 1 de 1\./u);
  assert.match(texto, /4, Bastante: 2 de 3 \(66,7 %\)/u);
  assert.match(texto, /Media: 4,3 sobre 5, con 3 respuestas\./u);
  assert.match(texto, /Meta del piloto: una media de al menos 4 sobre 5\./u);
  assert.match(texto, /Solo hay 2 respuestas de este grupo/u);
  assert.match(texto, /no se puede generalizar/u);
  assert.equal(p.campo('encuesta-csv').hidden, false);
  assert.equal(p.campo('encuesta-campos').disabled, true, 'cerrada no admite lotes nuevos');
});

test('si otra sesión ya la cerró, crear un lote vuelve a leer la encuesta y la muestra cerrada', async (t) => {
  const { prepararPanel, respuestasEncuesta } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar(activaDePrueba());
  respuestasEncuesta.consultar = { encuesta: leerResultadosEncuesta(abierta()) };
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  respuestasEncuesta.crearLote = { error: 'encuesta_cerrada' };
  respuestasEncuesta.consultar = { encuesta: leerResultadosEncuesta(cerrada()) };
  p.campo('encuesta-nombre').value = 'Entidad';
  p.campo('encuesta-cantidad').value = '5';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  await turno();
  assert.equal(p.llamadas.filter((l) => l === 'encuesta').length, 2, 'se vuelve a consultar');
  assert.match(
    p.campo('encuesta-estado').textContent,
    /No hay ninguna ronda abierta, así que no se pueden crear lotes nuevos/u,
  );
  assert.equal(p.campo('encuesta-campos').disabled, true);
  assert.equal(p.campo('encuesta-cerrar').disabled, true);
  assert.equal(p.campo('encuesta-csv').hidden, false);
});

test('si la instalación guarda respuestas de un cuestionario anterior, el panel dice qué ha pasado y qué hacer', async (t) => {
  const { prepararPanel, respuestasEncuesta } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar(activaDePrueba());
  respuestasEncuesta.consultar = { error: 'cuestionario_anterior' };
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  const aviso = p.campo('encuesta-estado').textContent;
  assert.match(aviso, /^Esta instalación guarda respuestas de un cuestionario anterior/u);
  assert.match(aviso, /cierra allí la ronda abierta y descarga sus resultados/u);
  // Sin resultados no hay lotes nuevos ni cierre: nada puede mezclar ni tocar esas respuestas.
  assert.equal(p.campo('encuesta-campos').disabled, true);
  assert.equal(p.campo('encuesta-cerrar').disabled, true);
  assert.equal(p.campo('encuesta-csv').hidden, true);
  activarIdiomaPanel('ca');
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  assert.match(
    p.campo('encuesta-estado').textContent,
    /^Aquesta instal·lació guarda respostes d’un qüestionari anterior/u,
  );
  activarIdiomaPanel('es');
});
