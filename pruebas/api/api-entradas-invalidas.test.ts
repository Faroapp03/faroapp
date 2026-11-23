// Errores de entrada en las fronteras REST y JSON-RPC, y en el informe del dispositivo, sin proveedores ni red.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { UsoConectividad } from '../../src/administracion/accesos.ts';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { crearApi, type OpcionesApi } from '../../src/api/api.ts';
import { leerCuerpoJson } from '../../src/api/cuerpo.ts';
import { SolicitudInvalida } from '../../src/api/errores.ts';
import { contenidoFirmado } from '../../src/api/estimacion-firmada.ts';
import { CODIGO } from '../../src/api/mcp/protocolo.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RUTA_ACTIVAR_INVITACION } from '../../src/api/socios/metadatos.ts';
import { esObjeto } from '../../src/comun/json.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const ORIGEN = 'https://publico.test';
const SECRETO = 'secreto-sintetico-de-prueba-de-mas-de-treinta-y-dos-caracteres';
const HTTP = { correcto: 200, aceptada: 202, incorrecta: 400, agotada: 410, demasiadas: 429 } as const;
const LONGITUD_SECRETO = 43;
const BYTE_INVALIDO = 0xff;
const MARCADOR_ASCII = 64;
const VALOR_ESTIMACION = 0.5;
const MARGEN_INFERIOR = 0.4;
const MARGEN_SUPERIOR = 0.6;
const MARGEN_ESTIMACION: [number, number] = [MARGEN_INFERIOR, MARGEN_SUPERIOR];
const ENTRADA: Entrada = {
  isco08: '7512',
  fecha: FECHA_DEL_INFORME,
  tareas: [{ id: 'uno', texto: 'Preparar masas para el pan', tiempo: 'algo' }],
};
let datos: ReturnType<typeof cargarDatos>;

before(() => {
  mock.method(globalThis, 'fetch', () => assert.fail('La prueba no permite llamadas de red'));
  datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
});
after(() => mock.restoreAll());

function crear(opciones: Partial<OpcionesApi> & { cerebro?: unknown; ia?: unknown } = {}) {
  const usos: UsoConectividad[] = [];
  return crearApi({
    datos,
    origenesPermitidos: [],
    seguridad: { secretoFirma: SECRETO },
    agentes: { mcp: { limitador: () => true }, a2a: { limitador: () => true } },
    administracion: {
      leerControles: async () => ({ version: 2, revision: 0, api: 'deshabilitada', mcp: true, a2a: true }),
      registrarAcceso: async (uso) => {
        usos.push(uso);
      },
    },
    ...opciones,
  });
}

/** La API del motor del dispositivo, la única que atiende el informe, con el mismo secreto de firma. */
function crearLocal() {
  return crearApiLocal({ datos, secretoFirma: SECRETO, motorDeCursos });
}

function post(ruta: string, body: NonNullable<RequestInit['body']>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGEN}${ruta}`, {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'content-type': 'application/json',
      [CABECERA_CONTRATO]: String(CONTRATO_API),
      ...headers,
    },
    body,
    duplex: 'half',
  });
}

function utf8Invalido(cuerpo: unknown): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(JSON.stringify(cuerpo));
  const posicion = bytes.indexOf(MARCADOR_ASCII);
  assert.notEqual(posicion, -1);
  bytes[posicion] = BYTE_INVALIDO;
  return bytes;
}

test('el lector JSON rechaza UTF-8 inválido como solicitud y acepta el carácter de reemplazo explícito', async () => {
  await assert.rejects(
    leerCuerpoJson(post('/api/informe', utf8Invalido('@')), { type: 'string' }, 'no es texto'),
    SolicitudInvalida,
  );
  assert.equal(
    await leerCuerpoJson(post('/api/informe', JSON.stringify('ñ�🚌')), { type: 'string' }, 'no es texto'),
    'ñ�🚌',
  );
});

test('una invitación vigente con el tope global agotado recibe 429 sin consumirse', async () => {
  const almacen = new SociosDePrueba();
  const opciones = almacen.opciones();
  let activaciones = 0;
  const api = await crear({
    administracion: {
      leerControles: async () => ({ version: 2, revision: 0, api: 'habilitada', mcp: true, a2a: true }),
      registrarAcceso: async (uso) => {
        almacen.usos.push(uso);
      },
      socios: {
        ...opciones,
        instituciones: {
          ...opciones.instituciones,
          consultarInvitacion: async () => ({
            version: 1,
            institucion: { id: 'inst-11111111-1111-4111-8111-111111111111', nombre: 'Institución sintética' },
            caducaEn: '2026-11-21T00:00:00.000Z',
          }),
          activarInvitacion: async () => {
            activaciones++;
            return { estado: 'no_disponible' };
          },
        },
      },
    },
  });
  almacen.cuentas.set('credenciales:global', LIMITES_CONECTIVIDAD.credencialesGlobalesHora);
  const valida = `11111111-1111-4111-8111-111111111111.${'A'.repeat(LONGITUD_SECRETO)}`;
  assert.equal(
    (await api(post(RUTA_ACTIVAR_INVITACION, JSON.stringify({ invitacion: valida })))).status,
    HTTP.demasiadas,
  );
  assert.equal(activaciones, 0);
  assert.equal(almacen.cuentas.get('credenciales:global'), LIMITES_CONECTIVIDAD.credencialesGlobalesHora);
});

test('el informe del dispositivo devuelve 400 por UTF-8 inválido dentro de un JSON que sería admisible con sustitución', async () => {
  const api = await crearLocal();
  const entrada = { ...ENTRADA, ocupacionPersona: 'Panadero @' };
  const respuesta = await api(post('/api/informe', utf8Invalido(entrada)));
  assert.equal(respuesta.status, HTTP.incorrecta);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo));
  assert.match(String(cuerpo.type), /solicitud_invalida$/);
});

test('activar una invitación rechaza UTF-8 inválido sin consumirla ni crear clave ni gastar el tope global', async () => {
  const almacen = new SociosDePrueba();
  const opciones = almacen.opciones();
  let activaciones = 0;
  const api = await crear({
    administracion: {
      leerControles: async () => ({ version: 2, revision: 0, api: 'habilitada', mcp: true, a2a: true }),
      registrarAcceso: async (uso) => {
        almacen.usos.push(uso);
      },
      socios: {
        ...opciones,
        instituciones: {
          ...opciones.instituciones,
          activarInvitacion: async () => {
            activaciones++;
            return { estado: 'no_disponible' };
          },
        },
      },
    },
  });
  const respuesta = await api(post(RUTA_ACTIVAR_INVITACION, utf8Invalido({ invitacion: '@' })));
  assert.equal(respuesta.status, HTTP.incorrecta);
  assert.equal(activaciones, 0);
  assert.equal(almacen.socios.size, 0);
  assert.deepEqual([...almacen.cuentas.values()], []);
  const valida = `11111111-1111-4111-8111-111111111111.${'A'.repeat(LONGITUD_SECRETO)}`;
  assert.equal((await api(post(RUTA_ACTIVAR_INVITACION, JSON.stringify({ invitacion: valida })))).status, HTTP.agotada);
  assert.equal(activaciones, 1);
  assert.deepEqual([...almacen.cuentas.values()], []);
});

for (const ruta of ['/mcp', '/a2a']) {
  test(`${ruta}: exceso real sin content-length o con cabecera menor da -32600 y cancela el flujo`, async (t) => {
    const api = await crear();
    for (const headers of [{}, { 'content-length': '1' }]) {
      await t.test(JSON.stringify(headers), async () => {
        let cancelaciones = 0;
        const cuerpo = new ReadableStream<Uint8Array>({
          start: (controlador) => controlador.enqueue(new Uint8Array(MAX_CUERPO_BYTES + 1)),
          cancel: () => {
            cancelaciones++;
          },
        });
        const respuesta = await api(post(ruta, cuerpo, headers));
        assert.equal(respuesta.status, HTTP.incorrecta);
        const contenido: unknown = await respuesta.json();
        assert.ok(esObjeto(contenido) && esObjeto(contenido.error));
        assert.equal(contenido.id, null);
        assert.equal(contenido.error.code, CODIGO.peticion);
        assert.equal(cancelaciones, 1);
      });
    }
  });

  test(`${ruta}: el lector compartido rechaza UTF-8 inválido como error de petición`, async () => {
    const api = await crear();
    const respuesta = await api(post(ruta, utf8Invalido({ jsonrpc: '2.0', id: '@', method: 'ping' })));
    assert.equal(respuesta.status, HTTP.incorrecta);
    const contenido: unknown = await respuesta.json();
    assert.ok(esObjeto(contenido) && esObjeto(contenido.error));
    assert.equal(contenido.id, null);
    assert.equal(contenido.error.code, CODIGO.peticion);
  });

  test(`${ruta}: el límite exacto sigue admitido y JSON mal formado conserva -32700`, async () => {
    const api = await crear();
    const mensaje = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
    const exacto = mensaje.padEnd(MAX_CUERPO_BYTES, ' ');
    const respuesta = await api(post(ruta, exacto));
    assert.equal(respuesta.status, HTTP.aceptada);
    assert.equal(await respuesta.text(), '');
    const malformada = await api(post(ruta, '{'));
    assert.equal(malformada.status, HTTP.incorrecta);
    const contenido: unknown = await malformada.json();
    assert.ok(esObjeto(contenido) && esObjeto(contenido.error));
    assert.equal(contenido.error.code, CODIGO.json);
  });
}

function proveedor() {
  const llamadas: string[] = [];
  const cerebro = {
    proveedor: 'doble-local',
    modelo: 'modelo-sintetico',
    generarJson: async () => {
      llamadas.push('generarJson');
      assert.fail('No se permite inferencia externa');
    },
    vectores: async () => {
      llamadas.push('vectores');
      assert.fail('El informe no necesita vectores');
    },
    moderar: async (texto: string) => {
      llamadas.push(texto);
      return { categorias: [] };
    },
  };
  return { cerebro, llamadas };
}

test('informe rechaza ids repetidos y referencias OIT inválidas en ES y CA', async (t) => {
  const tarea = ENTRADA.tareas[0];
  assert.ok(tarea);
  const ajena = Object.entries(datos.oit.tareas).find(([, dato]) => dato.nota !== null && dato.isco08 !== '7512');
  assert.ok(ajena);
  const casos = [
    { tareas: [tarea, { ...tarea, texto: 'Hornear el pan' }] },
    { tareas: [{ ...tarea, referencia: { tareaOit: '9999-99', relacion: 'propia' as const } }] },
    { tareas: [{ ...tarea, referencia: { tareaOit: ajena[0], relacion: 'propia' as const } }] },
  ];
  for (const idioma of ['es', 'ca']) {
    for (const caso of casos) {
      await t.test(`${idioma}: ${JSON.stringify(caso)}`, async () => {
        const api = await crearLocal();
        const respuesta = await api(post('/api/informe', JSON.stringify({ ...ENTRADA, ...caso, idioma })));
        assert.equal(respuesta.status, HTTP.incorrecta);
      });
    }
  }
});

test('un informe local válido elimina datos personales antes de citar', async () => {
  const api = await crearLocal();
  const tarea = { ...ENTRADA.tareas[0], texto: 'Preparar masas, contacto prueba@example.org' };
  const respuesta = await api(post('/api/informe', JSON.stringify({ ...ENTRADA, tareas: [tarea] })));
  assert.equal(respuesta.status, HTTP.correcto);
  assert.doesNotMatch(await respuesta.text(), /example/);
});

test('ids repetidos con estimaciones firmadas se rechazan antes de traducir las frases al catalán', async () => {
  const tarea = ENTRADA.tareas[0];
  assert.ok(tarea);
  const firmador = await crearFirmador(SECRETO, undefined, undefined, { uso: 'estimaciones' });
  const estimacion = {
    valor: VALOR_ESTIMACION,
    margen: MARGEN_ESTIMACION,
    origen: 'faro' as const,
    iaPodria: 'Preparar una propuesta.',
  };
  const firma = await firmador.firmar(
    contenidoFirmado({ ocupacionEsco: null, grupoIsco08: '7512' }, tarea.texto, estimacion),
  );
  const firmada = { ...tarea, estimacion: { ...estimacion, firma } };
  const api = await crearLocal();
  const respuesta = await api(
    post('/api/informe', JSON.stringify({ ...ENTRADA, idioma: 'ca', tareas: [firmada, firmada] })),
  );
  assert.equal(respuesta.status, HTTP.incorrecta);
});

test('un moderador externo inyectado no puede condicionar ni procesar el informe local', async () => {
  const doble = proveedor();
  doble.cerebro.moderar = async () => assert.fail('No se permite moderación externa');
  await assert.rejects(crear({ cerebro: doble.cerebro }), { name: 'TypeError', message: 'Opciones de API no válidas' });
  assert.deepEqual(doble.llamadas, []);
});
