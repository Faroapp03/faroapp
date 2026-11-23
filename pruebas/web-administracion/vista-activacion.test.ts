import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import {
  type EstadoActivacion,
  FASES_ACTIVACION,
  FASES_CURSOS,
  MOTIVOS_ABANDONO,
  MOTIVOS_DETENIDA,
} from '../../web/administracion/estado-activacion.js';
import { mostrarEstadoActivacion } from '../../web/administracion/vista-activacion.js';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';
import { fijarReloj } from './reloj-fijo.ts';

const INICIO = Date.parse('2026-10-17T12:00:00Z');
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
function registro(
  fase: NonNullable<EstadoActivacion['ultimaActivacion']>['fase'],
  dosServicios = FASES_CURSOS.includes(fase),
): EstadoActivacion {
  return {
    version: 1,
    revision: 1,
    ultimaActivacion: {
      solicitudId: '00000000-0000-4000-8000-000000000001',
      revisionReserva: 1,
      fase,
      dosServicios,
      motivoAbandono: fase === 'abandonada' ? 'a-mano' : null,
      reintento: null,
      datosSinPublicarDesde: fase === 'abandonada' || fase === 'rechazada' ? INICIO : null,
      cierre: null,
      motivoDetenida: null,
      servidoDetenida: null,
      creadoEn: INICIO,
      actualizadoEn: INICIO,
      versionId: fase === 'confirmada' ? 'version-registrada' : null,
      deploymentId: fase === 'confirmada' ? 'despliegue-registrado' : null,
      error: fase === 'rechazada' ? 'despliegue_no_admitido' : null,
    },
  };
}
function activa(activacion: EstadoActivacion | null = null, ocupado = false): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion,
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    controles: {
      version: 2,
      revision: 0,
      api: 'deshabilitada',
      mcp: false,
      a2a: false,
    },
  };
}

test('activación solo se consulta con el control explícito; ocupación y sesión retirada bloquean la lectura', async (t) => {
  const p = await prepararPanel(t);
  assert.equal(p.campo('activacion').hidden, true);
  p.publicar(activa());
  assert.equal(p.campo('consultar-activacion').disabled, false);
  assert.match(p.campo('estado-activacion').textContent, /Consulta la última publicación/);
  p.tick();
  p.tick();
  assert.equal(p.llamadas.includes('activacion'), false);
  p.campo('consultar-activacion').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.at(-1), 'activacion');
  const total = p.llamadas.length;
  p.publicar(activa(registro('confirmada'), true));
  assert.equal(p.campo('consultar-activacion').disabled, true);
  p.campo('consultar-activacion').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.length, total);
  assert.match(p.campo('estado-activacion').textContent, /Publicación terminada según el registro/);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('activacion').hidden, true);
  assert.equal(p.campo('estado-activacion').textContent, '');
  p.campo('consultar-activacion').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.length, total);
});

test('registro vacío y lectura fallida se distinguen sin conservar una activación como actual', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa({ version: 1, revision: 0, ultimaActivacion: null }));
  assert.match(p.campo('estado-activacion').textContent, /Todavía no consta ninguna publicación/);
  p.publicar(activa(registro('confirmada')));
  assert.match(p.campo('estado-activacion').textContent, /Versión registrada: version-registrada/);
  p.publicar({ ...activa(), aviso: 'activacion_no_disponible' });
  assert.match(p.campo('estado').textContent, /No se ha podido consultar la última publicación/);
  assert.doesNotMatch(p.campo('estado-activacion').textContent, /version-registrada|confirmada/);
  p.ventana.dispatchEvent(new Event('offline'));
  assert.equal(p.campo('estado-activacion').textContent, '');
});

/** Lo propio de cada fase: terminada, rechazada, abandonada, formación no disponible o todavía sin terminar. */
function comprobarTextoDeLaFase(fase: string, texto: string): void {
  const propios: Record<string, RegExp[]> = {
    confirmada: [/Publicación terminada según el registro/, /Despliegue registrado: despliegue-registrado/],
    rechazada: [/no se ha completado.*alojamiento de la web no ha aceptado/],
    abandonada: [/cerrado sin terminar.*versión anterior.*Se ha cerrado a mano/],
    'cursos-confirmado': [/figura como no disponible/],
    'promoviendo-cursos': [/puede figurar como no disponible/],
  };
  for (const patron of propios[fase] ?? [/todavía no consta como terminada/]) {
    assert.match(texto, patron, fase);
  }
  if (fase === 'abandonada') {
    assert.doesNotMatch(texto, /Versión registrada/);
  }
}
test('cada fase refleja evidencia registrada y mantiene explícito el límite de la consulta', (t) => {
  fijarReloj(t);
  instalar(t);
  const destino = nodo('div');
  for (const fase of [
    'reservada',
    'preparada',
    'subiendo-cursos',
    'cursos-subida',
    'promoviendo-cursos',
    'cursos-confirmado',
    'subiendo',
    'subida',
    'promoviendo',
    'confirmada',
    'rechazada',
    'abandonada',
  ] as const) {
    mostrarEstadoActivacion(html(destino), registro(fase));
    const detalle = destino.querySelector('details');
    assert.ok(detalle);
    assert.match(detalle.textContent, new RegExp(`fase${fase}`));
    assert.match(detalle.textContent, /creadoEn1792238400000/);
    assert.match(destino.textContent, /Solicitud: 00000000-0000-4000-8000-000000000001/);
    assert.match(
      destino.textContent,
      /Último cambio hace 28 días, el 17 oct. 2026 a las 14:00 \(registro en UTC: 2026-10-17T12:00:00.000Z\)/,
    );
    assert.match(destino.textContent, /no comprueba qué versión ven ahora las personas ni que todas las fuentes/);
    assert.doesNotMatch(destino.textContent, /Todo actualizado|Versión activa:/);
    comprobarTextoDeLaFase(fase, destino.textContent);
  }
});

test('fechas no representables y texto de versión se presentan sin ejecutar HTML', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = registro('confirmada');
  assert.ok(base.ultimaActivacion);
  mostrarEstadoActivacion(html(destino), {
    ...base,
    ultimaActivacion: {
      ...base.ultimaActivacion,
      actualizadoEn: Number.MAX_SAFE_INTEGER,
      versionId: '<img src=x onerror=alert(1)>',
    },
  });
  assert.match(destino.textContent, /Fecha no representable/);
  assert.match(destino.textContent, /<img src=x/);
  assert.equal(destino.querySelector('img'), null);
});

const FASES_DE_CURSOS = {
  'subiendo-cursos': {
    es: 'Se está subiendo la formación; la publicación todavía no consta como terminada.',
    ca: 'S’està pujant la formació; la publicació encara no consta com a acabada.',
  },
  'cursos-subida': {
    es: 'Formación subida; la publicación todavía no consta como terminada.',
    ca: 'Formació pujada; la publicació encara no consta com a acabada.',
  },
  'promoviendo-cursos': {
    es: 'Se está publicando la formación nueva; mientras tanto, la formación puede figurar como no disponible.',
    ca: 'S’està publicant la formació nova; mentrestant, la formació pot figurar com a no disponible.',
  },
  'cursos-confirmado': {
    es: 'La formación nueva ya está publicada, pero no se mostrará hasta terminar de publicar el resto de la web; mientras tanto figura como no disponible.',
    ca: 'La formació nova ja està publicada, però no es mostrarà fins que s’acabi de publicar la resta del web; mentrestant figura com a no disponible.',
  },
} as const;
test('las fases de Cursos se pintan con su texto en castellano y en catalán', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  for (const [fase, textos] of Object.entries(FASES_DE_CURSOS)) {
    for (const idioma of ['es', 'ca'] as const) {
      activarIdiomaPanel(idioma);
      mostrarEstadoActivacion(html(destino), registro(fase as keyof typeof FASES_DE_CURSOS));
      assert.equal(destino.querySelector('p')?.textContent, textos[idioma], `${fase} (${idioma})`);
    }
  }
});
const FASES_DE_DOS_SERVICIOS = {
  subiendo: {
    es: 'Se está subiendo el resto de la web; hasta terminar, la formación figura como no disponible.',
    ca: 'S’està pujant la resta del web; fins que s’acabi, la formació figura com a no disponible.',
  },
  subida: {
    es: 'El resto de la web ya está subido, pero todavía no se ha publicado; hasta terminar, la formación figura como no disponible.',
    ca: 'La resta del web ja està pujada, però encara no s’ha publicat; fins que s’acabi, la formació figura com a no disponible.',
  },
  promoviendo: {
    es: 'Se está publicando el resto de la web; hasta terminar, la formación figura como no disponible.',
    ca: 'S’està publicant la resta del web; fins que s’acabi, la formació figura com a no disponible.',
  },
} as const;
test('con dos servicios, las fases del principal dicen que la formación figura como no disponible', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  for (const [fase, textos] of Object.entries(FASES_DE_DOS_SERVICIOS)) {
    for (const idioma of ['es', 'ca'] as const) {
      activarIdiomaPanel(idioma);
      mostrarEstadoActivacion(html(destino), registro(fase as keyof typeof FASES_DE_DOS_SERVICIOS, true));
      assert.equal(destino.querySelector('p')?.textContent, textos[idioma], `${fase} (${idioma})`);
      mostrarEstadoActivacion(html(destino), registro(fase as keyof typeof FASES_DE_DOS_SERVICIOS, false));
      assert.doesNotMatch(destino.querySelector('p')?.textContent ?? '', /formaci/, `${fase} (${idioma}) un servicio`);
    }
  }
});
test('ninguna fase de la activación se queda sin texto en ningún idioma del panel', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  for (const [idioma, diccionario] of [
    ['es', es],
    ['ca', ca],
  ] as const) {
    // El texto de cada fase y de cada motivo está en el diccionario de cada idioma, sin caer en el de partida.
    const claves = [
      ...FASES_ACTIVACION.map((fase) => `panel.activacion.fase.${fase}`),
      ...MOTIVOS_ABANDONO.map((motivo) => `panel.activacion.abandono.${motivo}`),
      ...MOTIVOS_DETENIDA.map((motivo) => `panel.activacion.detenida.${motivo}`),
      'panel.activacion.detenida.cambiado',
      'panel.activacion.detenida.sin-formacion',
      ...Object.keys(FASES_DE_DOS_SERVICIOS).map((fase) => `panel.activacion.fase-dos-servicios.${fase}`),
    ];
    for (const clave of claves) {
      assert.ok(Object.hasOwn(diccionario, clave), `${clave} sin texto en ${idioma}`);
    }
    activarIdiomaPanel(idioma);
    // Las dos formas: la de un servicio no tiene fases de Cursos; la de dos servicios las tiene todas.
    for (const [dos, fases] of [
      [false, FASES_ACTIVACION.filter((fase) => !FASES_CURSOS.includes(fase))],
      [true, FASES_ACTIVACION],
    ] as const) {
      const vistos = new Set<string>();
      for (const fase of fases) {
        mostrarEstadoActivacion(html(destino), registro(fase, dos));
        const texto = destino.querySelector('p')?.textContent ?? '';
        // Una clave sin traducir se pinta tal cual: «panel.activacion.fase.<fase>».
        assert.ok(texto.length > 0 && !texto.startsWith('panel.'), `${fase} (${idioma}, ${dos}) sin texto`);
        vistos.add(texto);
      }
      assert.equal(vistos.size, fases.length, `dos fases comparten texto en ${idioma} (${dos})`);
    }
  }
});

const MANO_ES =
  'Faro no volverá a intentarlo solo: para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.';
const MANO_CA =
  'Faro no ho tornarà a intentar sol: per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.';
const PREVIO_ES =
  'Se ha cerrado sola porque algo cambió en el alojamiento de la web antes de publicar, y la web no se llegó a modificar.';
const PREVIO_CA =
  'S’ha tancat sola perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i el web no es va arribar a modificar.';
/** Cada motivo con su reintento observado: solo un rechazo previo que no es ya un reintento se vuelve a intentar solo. */
const ABANDONOS = {
  'a-mano': {
    reintento: null,
    es: `Se ha cerrado a mano y se sigue sirviendo la versión anterior. ${MANO_ES}`,
    ca: `S’ha tancat a mà i se segueix servint la versió anterior. ${MANO_CA}`,
  },
  'rechazo-previo': {
    reintento: 'previsto',
    es: `${PREVIO_ES} Faro volverá a intentarlo solo en la próxima actualización.`,
    ca: `${PREVIO_CA} Faro ho tornarà a intentar sol en la propera actualització.`,
  },
  'rechazo-previo sin reintento': {
    reintento: null,
    es: `${PREVIO_ES} ${MANO_ES}`,
    ca: `${PREVIO_CA} ${MANO_CA}`,
  },
  'rechazo-previo de un reintento': {
    reintento: 'es-reintento',
    es: `El segundo intento también se ha cerrado porque algo cambió en el alojamiento de la web antes de publicar, y la web no se llegó a modificar. ${MANO_ES}`,
    ca: `El segon intent també s’ha tancat perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i el web no es va arribar a modificar. ${MANO_CA}`,
  },
  'rechazo-previo sin artefacto': {
    reintento: 'sin-artefacto',
    es: 'Faro no ha podido volver a intentarlo porque el paquete ya no se conserva. Para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
    ca: 'Faro no ho ha pogut tornar a intentar perquè el paquet ja no es conserva. Per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
  },
  'rechazo-proveedor': {
    reintento: null,
    es: `Se ha cerrado sola porque el alojamiento de la web rechazó la publicación, y la web no se llegó a modificar. ${MANO_ES}`,
    ca: `S’ha tancat sola perquè l’allotjament del web va rebutjar la publicació, i el web no es va arribar a modificar. ${MANO_CA}`,
  },
} as const;
const SIN_PUBLICAR = {
  es: 'Hay datos validados sin publicar desde',
  ca: 'Hi ha dades validades sense publicar des de',
} as const;
test('una publicación abandonada dice qué se sirve y por qué se cerró, en castellano y en catalán', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  const fase = {
    es: 'La publicación se ha cerrado sin terminar y se sigue sirviendo la versión anterior de la web.',
    ca: 'La publicació s’ha tancat sense acabar i se segueix servint la versió anterior del web.',
  };
  for (const [motivo, textos] of Object.entries(ABANDONOS)) {
    for (const idioma of ['es', 'ca'] as const) {
      activarIdiomaPanel(idioma);
      const base = registro('abandonada', true);
      assert.ok(base.ultimaActivacion);
      mostrarEstadoActivacion(html(destino), {
        ...base,
        ultimaActivacion: {
          ...base.ultimaActivacion,
          motivoAbandono: motivo.startsWith('rechazo-previo')
            ? 'rechazo-previo'
            : (motivo as 'a-mano' | 'rechazo-proveedor'),
          reintento: textos.reintento,
        },
      });
      const parrafos = [...destino.querySelectorAll('p')].map((p) => p.textContent);
      assert.equal(parrafos[0], fase[idioma]);
      assert.ok(parrafos.includes(textos[idioma]), `${motivo} (${idioma})`);
      assert.ok(
        parrafos.some((p) => p?.startsWith(SIN_PUBLICAR[idioma])),
        `sin publicar (${idioma})`,
      );
    }
  }
});

const DETENIDAS = {
  es: {
    'rechazo-proveedor':
      'La publicación se ha detenido porque el alojamiento de la web rechazó ese paso, y no se llegó a hacer.',
    'rechazo-previo':
      'La publicación se ha detenido porque algo cambió en el alojamiento de la web antes de publicar, y no se llegó a hacer ese paso.',
    sinFormacion:
      'La formación nueva ya está publicada y figura como no disponible hasta terminar; el resto de la web sigue en la versión anterior. Para terminarla o volver atrás, sigue la guía de actualización remota.',
    cambiado:
      'Lo que sirve la web ha cambiado fuera de esta publicación. Comprueba qué versión sirve cada parte siguiendo la guía de actualización remota antes de terminarla o cerrarla.',
    desconocido:
      'No se ha podido comprobar qué sirve la web. Compruébalo siguiendo la guía de actualización remota antes de terminarla o cerrarla.',
  },
  ca: {
    'rechazo-proveedor':
      'La publicació s’ha aturat perquè l’allotjament del web va rebutjar aquest pas, i no es va arribar a fer.',
    'rechazo-previo':
      'La publicació s’ha aturat perquè alguna cosa va canviar a l’allotjament del web abans de publicar, i no es va arribar a fer aquest pas.',
    sinFormacion:
      'La formació nova ja està publicada i figura com a no disponible fins que s’acabi; la resta del web continua en la versió anterior. Per acabar-la o tornar enrere, segueix la guia d’actualització remota.',
    cambiado:
      'El que serveix el web ha canviat fora d’aquesta publicació. Comprova quina versió serveix cada part seguint la guia d’actualització remota abans d’acabar-la o tancar-la.',
    desconocido:
      'No s’ha pogut comprovar què serveix el web. Comprova-ho seguint la guia d’actualització remota abans d’acabar-la o tancar-la.',
  },
} as const;
test('una publicación detenida dice qué la paró, qué se sirve y qué hacer, en los dos idiomas', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  for (const idioma of ['es', 'ca'] as const) {
    activarIdiomaPanel(idioma);
    const textos = DETENIDAS[idioma];
    // Tras `cursos-confirmado`, con el principal rechazado: la formación figura como no disponible.
    const base = registro('subiendo', true);
    assert.ok(base.ultimaActivacion);
    mostrarEstadoActivacion(html(destino), {
      ...base,
      ultimaActivacion: {
        ...base.ultimaActivacion,
        motivoDetenida: 'rechazo-proveedor',
        servidoDetenida: 'cursos-nuevo',
      },
    });
    assert.equal(destino.querySelector('p')?.textContent, `${textos['rechazo-proveedor']} ${textos.sinFormacion}`);
    // Otro despliegue de Cursos hecho entre medias (`deployment-distinto`): lo servido ha cambiado fuera.
    const cursos = registro('promoviendo-cursos', true);
    assert.ok(cursos.ultimaActivacion);
    mostrarEstadoActivacion(html(destino), {
      ...cursos,
      ultimaActivacion: { ...cursos.ultimaActivacion, motivoDetenida: 'rechazo-previo', servidoDetenida: 'cambiado' },
    });
    assert.equal(destino.querySelector('p')?.textContent, `${textos['rechazo-previo']} ${textos.cambiado}`);
    // Un despliegue repartido o la pareja rota: no se pudo comprobar qué se sirve.
    mostrarEstadoActivacion(html(destino), {
      ...cursos,
      ultimaActivacion: {
        ...cursos.ultimaActivacion,
        motivoDetenida: 'rechazo-previo',
        servidoDetenida: 'desconocido',
      },
    });
    assert.equal(destino.querySelector('p')?.textContent, `${textos['rechazo-previo']} ${textos.desconocido}`);
  }
});

test('durante un reintento y tras un rechazo por la web cambiada, el panel dice lo que es verdad en los dos idiomas', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  const textos = {
    es: {
      curso: 'Hay datos validados sin publicar desde',
      cursoFin: 'Faro está volviendo a intentar publicarlos.',
      cambiada:
        'No se ha vuelto a intentar porque la web ha cambiado desde que se cerró la publicación, y así no se deshace lo que se haya publicado entre medias. Para publicar estos datos, hazlo a mano siguiendo la guía de actualización remota.',
      anteriores: 'la web sigue mostrando los anteriores',
    },
    ca: {
      curso: 'Hi ha dades validades sense publicar des de',
      cursoFin: 'Faro està tornant a intentar publicar-les.',
      cambiada:
        'No s’ha tornat a intentar perquè el web ha canviat des que es va tancar la publicació, i així no es desfà el que s’hagi publicat entremig. Per publicar aquestes dades, fes-ho a mà seguint la guia d’actualització remota.',
      anteriores: 'el web continua mostrant les anteriors',
    },
  } as const;
  for (const idioma of ['es', 'ca'] as const) {
    activarIdiomaPanel(idioma);
    const base = registro('subiendo', true);
    assert.ok(base.ultimaActivacion);
    const enCurso = { ...base.ultimaActivacion, reintento: 'es-reintento', datosSinPublicarDesde: INICIO } as const;
    mostrarEstadoActivacion(html(destino), { ...base, ultimaActivacion: enCurso });
    const parrafos = [...destino.querySelectorAll('p')].map((p) => p.textContent ?? '');
    const sinPublicar = parrafos.find((p) => p.startsWith(textos[idioma].curso));
    assert.ok(sinPublicar?.endsWith(textos[idioma].cursoFin), idioma);
    assert.ok(
      parrafos.every((p) => !p.includes(textos[idioma].anteriores)),
      idioma,
    );
    const rechazada = registro('rechazada', true);
    assert.ok(rechazada.ultimaActivacion);
    mostrarEstadoActivacion(html(destino), {
      ...rechazada,
      ultimaActivacion: { ...rechazada.ultimaActivacion, error: 'servido_distinto', reintento: 'es-reintento' },
    });
    const vistos = [...destino.querySelectorAll('p')].map((p) => p.textContent);
    assert.ok(vistos.includes(textos[idioma].cambiada), idioma);
  }
});

const CIERRE = {
  es: {
    boton: 'Cerrar esta publicación',
    'en-curso':
      'Has pedido cerrar esta publicación. Faro lo hará cuando termine la actualización que acaba de poner en marcha; verás aquí el resultado.',
    'sin-constancia':
      'La actualización que tenía que cerrar esta publicación ha terminado, pero el cierre todavía no consta. Si dentro de unos minutos sigue igual, vuelve a pedirlo.',
    'no-cumplido': 'El cierre que pediste no se ha llegado a hacer. Puedes volver a pedirlo.',
    'web-cambiada':
      'No se ha cerrado porque la web ya no sirve la versión anterior. Comprueba qué versión sirve cada parte siguiendo la guía de actualización remota y vuelve a pedirlo.',
    'ejecucion-en-curso':
      'Todavía no se puede cerrar porque la publicación sigue en marcha. Espera a que termine y vuelve a intentarlo.',
  },
  ca: {
    boton: 'Tanca aquesta publicació',
    'en-curso':
      'Has demanat tancar aquesta publicació. Faro ho farà quan acabi l’actualització que acaba de posar en marxa; en veuràs aquí el resultat.',
    'sin-constancia':
      'L’actualització que havia de tancar aquesta publicació ha acabat, però el tancament encara no consta. Si d’aquí a uns minuts continua igual, torna-ho a demanar.',
    'no-cumplido': 'El tancament que vas demanar no s’ha arribat a fer. Pots tornar-ho a demanar.',
    'web-cambiada':
      'No s’ha tancat perquè el web ja no serveix la versió anterior. Comprova quina versió serveix cada part seguint la guia d’actualització remota i torna-ho a demanar.',
    'ejecucion-en-curso':
      'Encara no es pot tancar perquè la publicació continua en marxa. Espera que acabi i torna-ho a intentar.',
  },
} as const;
test('cerrar una publicación detenida: botón, petición en curso, no cumplida, web cambiada y ejecución en marcha, en los dos idiomas', (t) => {
  fijarReloj(t);
  instalar(t);
  t.after(() => activarIdiomaPanel('es'));
  const destino = nodo('div');
  const cerrar = () => undefined;
  for (const idioma of ['es', 'ca'] as const) {
    activarIdiomaPanel(idioma);
    const textos = CIERRE[idioma];
    const base = registro('subiendo', true);
    const ultima = base.ultimaActivacion;
    assert.ok(ultima);
    const con = (cierre: NonNullable<EstadoActivacion['ultimaActivacion']>['cierre']) => ({
      ...base,
      ultimaActivacion: { ...ultima, cierre },
    });
    const pintar = (estado: EstadoActivacion, resultadoCierre: 'ejecucion-en-curso' | null = null) => {
      mostrarEstadoActivacion(html(destino), estado, { cerrar, resultadoCierre, ahora: INICIO });
      return {
        parrafos: [...destino.querySelectorAll('p')].map((p) => p.textContent),
        botones: [...destino.querySelectorAll('button')].map((b) => b.textContent),
      };
    };
    assert.deepEqual(pintar(con(null)).botones, [textos.boton]);
    const enCurso = pintar(con({ estado: 'en-curso', caducaEn: INICIO + 1 }));
    assert.ok(enCurso.parrafos.includes(textos['en-curso']) && enCurso.botones.length === 0, idioma);
    // Caducado, o sin la ejecución que podía cumplirlo (despacho fallido, ejecución terminada o relevo): no se cumplió.
    for (const cierre of [
      { estado: 'en-curso', caducaEn: INICIO },
      { estado: 'no-cumplido', caducaEn: INICIO + 1 },
    ] as const) {
      const visto = pintar(con(cierre));
      assert.ok(visto.parrafos.includes(textos['no-cumplido']) && visto.botones.length === 1, idioma);
      assert.ok(!visto.parrafos.includes(textos['en-curso']), idioma);
    }
    // La actualización despachada terminó y el cierre aún no consta: se dice así, con el botón visible.
    // Pasada su caducidad, tampoco «sin constancia»: el servidor ya no puede cumplirlo.
    const vencida = pintar(con({ estado: 'sin-constancia', caducaEn: INICIO }));
    assert.ok(vencida.parrafos.includes(textos['no-cumplido']) && vencida.botones.length === 1, idioma);
    assert.ok(!vencida.parrafos.includes(textos['sin-constancia']), idioma);
    const sinConstancia = pintar(con({ estado: 'sin-constancia', caducaEn: INICIO + 1 }));
    assert.ok(sinConstancia.parrafos.includes(textos['sin-constancia']) && sinConstancia.botones.length === 1, idioma);
    assert.ok(!sinConstancia.parrafos.includes(textos['no-cumplido']), idioma);
    const cambiada = pintar(con({ estado: 'web-cambiada', caducaEn: INICIO + 1 }));
    assert.ok(cambiada.parrafos.includes(textos['web-cambiada']) && cambiada.botones.length === 1, idioma);
    assert.ok(pintar(con(null), 'ejecucion-en-curso').parrafos.includes(textos['ejecucion-en-curso']), idioma);
    // Una publicación terminada no se cierra: ni botón ni estado del cierre.
    assert.deepEqual(pintar(registro('abandonada', true)).botones, []);
  }
});
