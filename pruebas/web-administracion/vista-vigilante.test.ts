import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoAviso } from '../../web/administracion/avisos-panel.js';
import { leerFilaVigilantePanel } from '../../web/administracion/vigilante-panel.js';
import { crearVistaVigilante, pintarVigilante } from '../../web/administracion/vista-vigilante.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { avanzar, Elemento, instalar, pulsar } from '../web-informe-lectura/dom-doble.ts';
import { fijarReloj } from './reloj-fijo.ts';

/** La tarjeta «Avisos» va con el vigilante: sus elementos y un cliente que no responde. */
const IDS_AVISOS = [
  'avisos',
  'avisos-resumen',
  'avisos-estado',
  'avisos-correo',
  'avisos-guardar',
  'avisos-probar',
  'avisos-quitar',
  'avisos-reintentar',
];
const SIN_AVISOS = {
  leerAvisos: async () => null,
  cambiarAvisos: async () => null,
  quitarAvisos: async () => null,
  probarAvisos: async () => null,
};

test('el vigilante distingue observación y evaluación sin prometer entrega activa en ES y CA', (t) => {
  instalar(t);
  const nodo = document.createElement('div');
  const vigilante = {
    areas: [{ clave: 'fuente:uno', estado: 'incidencia', motivo: 'comprobacion_vencida', observadoEn: 1000 }],
    version: 1,
    origenDatos: 'recibo',
    evaluadoEn: 2000,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 1,
    incidencias: [
      {
        id: 1,
        clave: 'fuente:uno',
        estado: 'incidencia',
        motivo: 'comprobacion_vencida',
        observadoEn: 1000,
        evaluadoEn: 2000,
        origen: 'recibo',
      },
    ],
    fechaDatos: [],
    ultimoTrabajo: null,
    eventosProgramados: [],
  } as const;
  fijarIdioma('es');
  pintarVigilante(nodo, vigilante, null, null);
  assert.match(nodo.textContent ?? '', /Evaluado/);
  assert.match(nodo.textContent ?? '', /Observado/);
  assert.match(nodo.textContent ?? '', /entrega activa/);
  assert.match(nodo.textContent ?? '', /comprobar/i);
  fijarIdioma('ca');
  pintarVigilante(nodo, vigilante, null, null);
  assert.match(nodo.textContent ?? '', /Avaluat/);
  assert.match(nodo.textContent ?? '', /Observat/);
  assert.match(nodo.textContent ?? '', /lliurament actiu/);
});

test('la ausencia de observación no se muestra como fecha de 1970', (t) => {
  instalar(t);
  fijarIdioma('es');
  const nodo = document.createElement('div');
  const fila = {
    id: 1,
    clave: 'fuente:uno',
    estado: 'incidencia',
    motivo: 'sin_observacion_correlacionada',
    observadoEn: 0,
    evaluadoEn: 1_700_000_000_000,
    origen: 'no-registrado',
  } as const;
  pintarVigilante(nodo, null, { version: 1, revision: 2, decisiones: [fila], siguiente: null }, null);
  assert.match(nodo.textContent ?? '', /Decisión: No consta/u);
  assert.doesNotMatch(nodo.textContent ?? '', /1970/u);
});

test('el resumen del último trabajo muestra estado y resultado sin detalles privados', (t) => {
  instalar(t);
  fijarIdioma('es');
  const nodo = document.createElement('div');
  const trabajo = {
    estado: 'terminado',
    accion: 'actualizar-datos',
    creadoEn: 1_700_000_000_000,
    actualizadoEn: 1_700_000_001_000,
    resultado: 'validado',
  } as const;
  pintarVigilante(
    nodo,
    {
      version: 1,
      areas: [],
      origenDatos: 'recibo',
      evaluadoEn: 1_700_000_002_000,
      pulsoContinuo: 'no-instrumentado',
      entregaActiva: 'sin-observacion-actual',
      revision: 1,
      incidencias: [],
      fechaDatos: [],
      ultimoTrabajo: trabajo,
      eventosProgramados: [],
    },
    null,
    null,
  );
  assert.match(nodo.textContent ?? '', /Actualizar datos/u);
  assert.match(nodo.textContent ?? '', /Datos nuevos preparados, aún no publicados/u);
  assert.match(nodo.textContent ?? '', /Última actualización del trabajo/u);
});

test('el historial pasa cursor y revisión, y perder sesión descarta una respuesta tardía', async (t) => {
  const ids = Object.fromEntries(
    [
      'vigilante',
      'estado-vigilante',
      'comprobar-vigilante',
      'historial-vigilante',
      'siguiente-vigilante',
      ...IDS_AVISOS,
    ].map((id) => [id, new Elemento('button')]),
  );
  instalar(t, {
    document: { getElementById: (id: string) => ids[id], createElement: (tag: string) => new Elemento(tag) },
  });
  const SIGUIENTE = 23;
  const campo = (id: string) => {
    const nodo = ids[id];
    assert.ok(nodo);
    return nodo;
  };
  const paginas: unknown[] = [];
  let resolver: ((valor: null) => void) | undefined;
  const vista = crearVistaVigilante({
    comprobarVigilante: () =>
      new Promise((resolve) => {
        resolver = resolve;
      }),
    historialVigilante: async (pagina) => {
      paginas.push(pagina);
      return { version: 1, revision: 4, decisiones: [], siguiente: pagina ? null : SIGUIENTE };
    },
    ...SIN_AVISOS,
  });
  vista.mostrar(true, false);
  pulsar(campo('historial-vigilante'));
  await avanzar();
  pulsar(campo('siguiente-vigilante'));
  await avanzar();
  assert.deepEqual(paginas, [null, { despuesDe: SIGUIENTE, revisionEsperada: 4 }]);
  pulsar(campo('comprobar-vigilante'));
  vista.retirar();
  resolver?.(null);
  await avanzar();
  assert.equal(campo('vigilante').hidden, true);
  assert.doesNotMatch(campo('estado-vigilante').textContent, /No se ha podido confirmar/u);
});

test('la configuración inválida dice qué revisar en ambos idiomas', () => {
  fijarIdioma('es');
  assert.match(
    textoAviso('vigilante_configuracion_invalida'),
    /La configuración del vigilante no es válida\. Corrígela en la configuración del servicio y vuelve a comprobar/u,
  );
  fijarIdioma('ca');
  assert.match(
    textoAviso('vigilante_configuracion_invalida'),
    /La configuració del vigilant no és vàlida\. Corregeix-la a la configuració del servei i torna a comprovar/u,
  );
  fijarIdioma('es');
});

test('una decisión de área y las incidencias activas registradas se nombran por separado', (t) => {
  instalar(t);
  const nodo = document.createElement('div');
  const vigilante = {
    version: 1,
    areas: [
      { clave: 'fuente:uno', estado: 'incidencia', motivo: 'comprobacion_vencida', observadoEn: 1_700_000_000_000 },
    ],
    origenDatos: 'recibo',
    evaluadoEn: 1_700_000_001_000,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 1,
    incidencias: [],
    fechaDatos: [],
    ultimoTrabajo: null,
    eventosProgramados: [],
  } as const;
  fijarIdioma('es');
  pintarVigilante(nodo, vigilante, null, null);
  assert.match(nodo.textContent ?? '', /La comprobación está vencida/u);
  assert.match(nodo.textContent ?? '', /No hay incidencias activas registradas/u);
  assert.doesNotMatch(nodo.textContent ?? '', /No hay incidencias en esta evaluación/u);
  fijarIdioma('ca');
  pintarVigilante(nodo, vigilante, null, null);
  assert.match(nodo.textContent ?? '', /La comprovació està vençuda/u);
  assert.match(nodo.textContent ?? '', /No hi ha incidències actives registrades/u);
  fijarIdioma('es');
});

test('sin recibo ni decisión de programación no atribuye evidencia que falta, ES y CA', (t) => {
  instalar(t);
  const nodo = document.createElement('div');
  const vigilante = {
    version: 1,
    areas: [
      {
        clave: 'lectura-datos',
        estado: 'incidencia',
        motivo: 'sin_observacion_correlacionada',
        observadoEn: 1_700_000_000_000,
      },
    ],
    origenDatos: 'recibo',
    evaluadoEn: 1_700_000_000_000,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 1,
    incidencias: [],
    fechaDatos: [],
    ultimoTrabajo: null,
    eventosProgramados: [],
  } as const;
  fijarIdioma('es');
  pintarVigilante(nodo, vigilante, null, null);
  assert.doesNotMatch(nodo.textContent ?? '', /La evaluación usa un recibo/u);
  assert.match(nodo.textContent ?? '', /No se ha evaluado la programación/u);
  fijarIdioma('ca');
  pintarVigilante(nodo, vigilante, null, null);
  assert.doesNotMatch(nodo.textContent ?? '', /L’avaluació fa servir un rebut/u);
  assert.match(nodo.textContent ?? '', /No s’ha avaluat la programació/u);
  fijarIdioma('es');
});

test('las acciones distinguen programación de mantenimiento del recibo', (t) => {
  instalar(t);
  fijarIdioma('es');
  const nodo = document.createElement('div');
  const comun = {
    estado: 'incidencia',
    observadoEn: 1_700_000_000_000,
    evaluadoEn: 1_700_000_000_000,
    origen: 'recibo',
  } as const;
  const decisiones = [
    { ...comun, id: 1, clave: 'programador', motivo: 'evento_esperado_sin_registro' },
    { ...comun, id: 2, clave: 'lectura-datos', motivo: 'observacion_de_mantenimiento_antigua' },
  ];
  pintarVigilante(nodo, null, { version: 1, revision: 2, decisiones, siguiente: null }, null);
  assert.match(nodo.textContent ?? '', /Revisa la programación/u);
  assert.match(nodo.textContent ?? '', /Revisa el mantenimiento y su recibo/u);
  assert.doesNotMatch(nodo.textContent ?? '', /lectura local/u);
});

test('un inicio rechazado dice qué ha pasado y qué hacer, en ES y CA', (t) => {
  instalar(t);
  const nodo = document.createElement('div');
  const fila = leerFilaVigilantePanel({
    id: 1,
    clave: 'ejecutor',
    estado: 'incidencia',
    motivo: 'inicio_rechazado',
    observadoEn: 1_700_000_000_000,
    evaluadoEn: 1_700_000_000_000,
    origen: 'recibo',
  });
  const historial = { version: 1, revision: 1, decisiones: [fila], siguiente: null } as const;
  fijarIdioma('es');
  pintarVigilante(nodo, null, historial, null);
  assert.match(
    nodo.textContent ?? '',
    /GitHub ha ejecutado una revisión del código que este servidor todavía no tiene autorizada, así que la actualización no ha empezado\. Publica esa revisión o vuelve a ejecutar la autorizada\./u,
  );
  fijarIdioma('ca');
  pintarVigilante(nodo, null, historial, null);
  assert.match(
    nodo.textContent ?? '',
    /GitHub ha executat una revisió del codi que aquest servidor encara no té autoritzada, així que l’actualització no ha començat\. Publica aquesta revisió o torna a executar l’autoritzada\./u,
  );
  fijarIdioma('es');
});

test('cada fila del historial conserva su procedencia y fecha de dato tiene etiqueta propia', (t) => {
  instalar(t);
  fijarIdioma('es');
  const nodo = document.createElement('div');
  const comun = {
    estado: 'incidencia',
    motivo: 'comprobacion_vencida',
    observadoEn: 1_700_000_000_000,
    evaluadoEn: 1_700_000_000_000,
  } as const;
  const historial = {
    version: 1,
    revision: 2,
    decisiones: [
      { ...comun, id: 1, clave: 'uno', origen: 'recibo' },
      { ...comun, id: 2, clave: 'dos', origen: 'lectura-local' },
      { ...comun, id: 3, clave: 'tres', origen: 'no-registrado' },
    ],
    siguiente: null,
  } as const;
  const vigilante = {
    version: 1,
    areas: [],
    origenDatos: 'recibo',
    evaluadoEn: 1_700_000_000_000,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 2,
    incidencias: [],
    fechaDatos: [{ fuente: 'uno', fecha: '2026-01-01' }],
    ultimoTrabajo: null,
    eventosProgramados: [],
  } as const;
  pintarVigilante(nodo, vigilante, historial, null);
  assert.match(nodo.textContent ?? '', /Origen: recibo de mantenimiento/u);
  assert.match(nodo.textContent ?? '', /Origen: lectura local/u);
  assert.match(nodo.textContent ?? '', /Origen no registrado/u);
  assert.match(nodo.textContent ?? '', /Fecha de los datos de uno: 2026-01-01/u);
});

test('las comprobaciones programadas se leen por día, con su resultado y su motivo en lenguaje llano', (t) => {
  fijarReloj(t, '2026-11-14T10:00:00Z');
  instalar(t);
  const nodo = document.createElement('div');
  const base = {
    areas: [],
    version: 1,
    origenDatos: 'recibo',
    evaluadoEn: Date.parse('2026-11-14T09:00:00Z'),
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
    revision: 1,
    incidencias: [],
    fechaDatos: [],
    ultimoTrabajo: null,
  } as const;
  fijarIdioma('es');
  pintarVigilante(nodo, { ...base, eventosProgramados: [] }, null, null);
  assert.match(nodo.textContent ?? '', /No consta ninguna comprobación programada/u);
  const eventos = [
    {
      eventoEn: Date.parse('2026-11-14T05:00:00Z'),
      resultado: 'nueva',
      motivo: 'sin-trabajo-pendiente',
    },
    {
      eventoEn: Date.parse('2026-11-13T05:00:00Z'),
      resultado: 'omitida-ocupado',
      motivo: 'trabajo-en-plazo',
    },
  ];
  pintarVigilante(nodo, { ...base, eventosProgramados: eventos }, null, null);
  const filas = [...nodo.querySelectorAll('li')].map((li) => li.textContent);
  assert.deepEqual(filas, [
    'hoy a las 6:00: Se lanzó una comprobación de datos. No había ninguna otra actualización abierta.',
    'ayer a las 6:00: No se lanzó porque ya había una actualización en marcha. La actualización en marcha sigue dentro de su plazo.',
  ]);
  fijarIdioma('ca');
  pintarVigilante(nodo, { ...base, eventosProgramados: eventos }, null, null);
  assert.match(nodo.textContent ?? '', /avui a les 6:00: Es va llançar una comprovació de dades\./u);
  fijarIdioma('es');
});

/** Una evaluación con un evento fallido en la reserva y otro reservado sin lanzamiento confirmado. */
const CON_FALLOS = {
  areas: [],
  version: 1,
  origenDatos: 'recibo',
  evaluadoEn: Date.parse('2026-11-14T09:00:00Z'),
  pulsoContinuo: 'no-instrumentado',
  entregaActiva: 'sin-observacion-actual',
  revision: 1,
  incidencias: [],
  fechaDatos: [],
  ultimoTrabajo: null,
  eventosProgramados: [
    {
      eventoEn: Date.parse('2026-11-14T05:00:00Z'),
      resultado: 'fallida',
      motivo: 'evento-sin-consumir',
      fase: 'reserva',
      motivoFallo: 'plazo-agotado',
    },
    {
      eventoEn: Date.parse('2026-11-13T05:00:00Z'),
      resultado: 'nueva',
      motivo: 'sin-trabajo-pendiente',
      fase: 'despacho',
      motivoFallo: 'error',
    },
  ],
} as const;
const FALLIDO = { en: Date.parse('2026-11-14T05:00:00Z'), resultado: 'fallido', motivo: 'sin-respuesta' } as const;
type Avisos = NonNullable<Parameters<typeof pintarVigilante>[1]>['avisos'];
/** @returns El texto pintado con el estado de avisos indicado; sin él, la respuesta no trae `avisos`. */
function pintadoCon(nodo: HTMLElement, avisos?: Avisos) {
  pintarVigilante(nodo, avisos ? { ...CON_FALLOS, avisos } : CON_FALLOS, null, null);
  return nodo.textContent ?? '';
}

test('un evento fallido dice en qué fase y por qué y qué hará Faro, en ES y CA', (t) => {
  fijarReloj(t, '2026-11-14T10:00:00Z');
  instalar(t);
  const nodo = document.createElement('div');
  fijarIdioma('es');
  pintadoCon(nodo);
  assert.deepEqual(
    [...nodo.querySelectorAll('li')].map((li) => li.textContent),
    [
      'hoy a las 6:00: No se pudo hacer la comprobación diaria: falló la reserva de la actualización. Tardó demasiado. Se volverá a intentar mañana; si se repite, revisa la configuración.',
      'ayer a las 6:00: No había ninguna otra actualización abierta. Se reservó la comprobación, pero no se pudo confirmar su lanzamiento. No terminó correctamente. Faro lo comprobará en la próxima comprobación diaria.',
    ],
  );
  fijarIdioma('ca');
  pintadoCon(nodo);
  // Filas en passat perifràstic, como las que ya existían; la del despacho acaba con lo que hará Faro.
  const catala = [...nodo.querySelectorAll('li')].map((li) => li.textContent).join('\n');
  assert.match(
    catala,
    /No es va poder fer la comprovació diària: va fallar la reserva de l’actualització\. Va trigar massa\./u,
  );
  assert.match(
    catala,
    /Es va reservar la comprovació, però no se’n va poder confirmar l’inici\. No va acabar correctament\. Faro ho comprovarà a la propera comprovació diària\.$/mu,
  );
  assert.doesNotMatch(catala, /panel\.vigilante|s’ha |ha fallat|ha trigat|ha acabat/u);
  fijarIdioma('es');
});

test('el panel muestra el estado de cada canal de avisos y su último intento, sin nombres internos, en ES y CA', (t) => {
  fijarReloj(t, '2026-11-14T10:00:00Z');
  instalar(t);
  const nodo = document.createElement('div');
  const url = { canal: 'url', estado: 'configurados', ultimoIntento: FALLIDO } as const;
  const correo = {
    canal: 'correo',
    estado: 'verificado',
    ultimoIntento: { ...FALLIDO, motivo: 'destinatario-no-permitido' },
  } as const;
  const dos = { canales: [correo, url] } as const;
  fijarIdioma('es');
  assert.match(pintadoCon(nodo), /Los avisos no están configurados: .*guarda una dirección de correo en «Avisos»\./u);
  const texto = pintadoCon(nodo, dos);
  assert.match(texto, /Los avisos llegan por correo a la dirección confirmada en «Avisos»\./u);
  assert.match(
    texto,
    /El último aviso por correo no se pudo entregar hoy a las 6:00\. El servicio de correo todavía no admite esta dirección\./u,
  );
  assert.match(texto, /Los avisos también llegan a la dirección web configurada en el servicio\./u);
  assert.match(texto, /El último aviso a la dirección web no se pudo entregar hoy a las 6:00: .*no respondió\./u);
  const pendiente = { canales: [{ canal: 'correo', estado: 'pendiente', ultimoIntento: null }] } as const;
  assert.match(pintadoCon(nodo, pendiente), /pendiente de confirmar: envía un aviso de prueba/u);
  const enviado = { canales: [{ ...url, ultimoIntento: { ...FALLIDO, resultado: 'enviado', motivo: null } }] } as const;
  assert.match(pintadoCon(nodo, enviado), /El último aviso a la dirección web se envió hoy a las 6:00\./u);
  for (const avisos of [undefined, dos, pendiente, enviado]) {
    assert.doesNotMatch(pintadoCon(nodo, avisos), /panel\.(vigilante|avisos)|FARO_/u);
  }
  fijarIdioma('ca');
  assert.match(pintadoCon(nodo), /Els avisos no estan configurats: .*desa una adreça de correu a «Avisos»\./u);
  assert.match(
    pintadoCon(nodo, dos),
    /L’últim avís per correu no s’ha pogut lliurar avui a les 6:00\. El servei de correu/u,
  );
  for (const avisos of [undefined, dos, pendiente, enviado]) {
    assert.doesNotMatch(pintadoCon(nodo, avisos), /panel\.(vigilante|avisos)|FARO_/u);
  }
  fijarIdioma('es');
});

test('la programación apagada sin pausa pide encenderla o declarar la pausa; con pausa vigente, dice hasta cuándo', (t) => {
  fijarReloj(t, '2026-11-14T10:00:00Z');
  instalar(t);
  const nodo = document.createElement('div');
  const apagada = {
    ...CON_FALLOS,
    eventosProgramados: [],
    areas: [{ clave: 'programador', estado: 'incidencia', motivo: 'programacion_apagada', observadoEn: 1000 }],
  } as const;
  const enPausa = {
    ...CON_FALLOS,
    eventosProgramados: [],
    areas: [{ clave: 'programador', estado: 'conforme', motivo: 'programacion_en_pausa', observadoEn: 1000 }],
    pausaProgramadaHasta: '2026-11-20',
  } as const;
  const pintado = (vigilante: Parameters<typeof pintarVigilante>[1]) => {
    pintarVigilante(nodo, vigilante, null, null);
    return nodo.textContent ?? '';
  };
  fijarIdioma('es');
  assert.match(
    pintado(apagada),
    /La programación está apagada y no hay ninguna pausa declarada: los datos no se actualizan solos\./u,
  );
  assert.match(pintado(apagada), /indica hasta qué día dura la pausa en la configuración del servicio\./u);
  assert.match(pintado(enPausa), /La programación está apagada a propósito\. Último día de la pausa: 20\/11\/2026\./u);
  fijarIdioma('ca');
  assert.match(
    pintado(apagada),
    /La programació està aturada i no hi ha cap pausa declarada: les dades no s’actualitzen soles\./u,
  );
  assert.match(pintado(apagada), /indica fins a quin dia dura la pausa a la configuració del servei\./u);
  assert.match(pintado(enPausa), /La programació està aturada expressament\. Últim dia de la pausa: 20\/11\/2026\./u);
  assert.doesNotMatch(pintado(apagada) + pintado(enPausa), /panel\.vigilante/u);
  fijarIdioma('es');
});
