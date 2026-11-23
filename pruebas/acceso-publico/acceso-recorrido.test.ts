import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VENTANA_MS } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { responderAccesoRecorrido } from '../../src/plataforma/cloudflare/acceso-recorrido.ts';
import { CABECERA_LIMITE, LIMITE_SATURADO, TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';

/** La primera extensión del registro hace de variante inactiva; sin extensiones no hay otra variante que proteger. */
const [EXTENSION] = EXTENSIONES;
const SIN_EXTENSIONES = EXTENSION === undefined && 'Sin extensiones instaladas no hay otra variante que proteger.';
const VARIANTE: VarianteRecorrido = EXTENSION?.id ?? 'real';
const ENTRADA = `/${EXTENSION?.entrada ?? 'recorrido.html'}`;

const NO_DISPONIBLE = 503;
const REDIRECCION = 303;
const PROHIBIDO = 403;
const DEMASIADOS = 429;
const VIDA_MS = 900_000;
const CLAVE = 'clave-sintetica-para-el-recorrido';
const FIRMA = 'firma-sintetica-independiente-de-32-caracteres';
const ORIGEN = 'https://ejemplo.invalid';
const BASE = {
  variante: VARIANTE,
  clave: CLAVE,
  firma: FIRMA,
  leerModo: async () => ({ version: 1 as const, revision: 3, modo: 'real' as const }),
  consumirIntento: async () => true,
  delegar: async () => new Response('contenido privado'),
};
const pedir = (ruta: string, opciones?: RequestInit) => new Request(`${ORIGEN}${ruta}`, opciones);
const enviar = (clave: string, opciones: RequestInit = {}) =>
  pedir(ENTRADA, {
    method: 'POST',
    headers: { origin: ORIGEN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ clave }),
    ...opciones,
  });

test('entrada inactiva exige sesión; activa delega; lectura rota falla cerrada', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const cerrada = await responderAccesoRecorrido(pedir(ENTRADA), BASE);
  assert.equal(cerrada.status, PROHIBIDO);
  assert.equal(cerrada.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await cerrada.text(), /contenido privado|clave-sintetica/);
  const activa = await responderAccesoRecorrido(pedir('/recorrido.html'), { ...BASE, variante: 'real' });
  assert.equal(await activa.text(), 'contenido privado');
  const fallo = await responderAccesoRecorrido(pedir(ENTRADA), {
    ...BASE,
    leerModo: async () => {
      throw new Error('no disponible');
    },
  });
  assert.equal(fallo.status, NO_DISPONIBLE);
});

test('contraseña válida crea cookie segura y solo habilita variante y revisión que firmó', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const autorizacion = await responderAccesoRecorrido(enviar(CLAVE), BASE);
  assert.equal(autorizacion.status, REDIRECCION);
  const cookie = autorizacion.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=900/);
  assert.doesNotMatch(cookie, /clave-sintetica|firma-sintetica/);
  const sesion = cookie.split(';')[0] ?? '';
  const concedida = await responderAccesoRecorrido(pedir(ENTRADA, { headers: { cookie: sesion } }), BASE);
  assert.equal(await concedida.text(), 'contenido privado');
  const otraRevision = await responderAccesoRecorrido(pedir(ENTRADA, { headers: { cookie: sesion } }), {
    ...BASE,
    leerModo: async () => ({ version: 1 as const, revision: 4, modo: 'real' as const }),
  });
  assert.equal(otraRevision.status, PROHIBIDO);
});

test('deniega POST ajeno, intentos agotados y configuración ausente', { skip: SIN_EXTENSIONES }, async () => {
  const ajena = await responderAccesoRecorrido(
    enviar(CLAVE, { headers: { origin: 'https://otro.invalid', 'content-type': 'application/x-www-form-urlencoded' } }),
    BASE,
  );
  assert.equal(ajena.status, PROHIBIDO);
  const agotada = await responderAccesoRecorrido(enviar(CLAVE), { ...BASE, consumirIntento: async () => false });
  assert.equal(agotada.status, DEMASIADOS);
  const incorrecta = await responderAccesoRecorrido(enviar('incorrecta'), BASE);
  assert.equal(incorrecta.status, PROHIBIDO);
  const sinFirma = await responderAccesoRecorrido(enviar(CLAVE), { ...BASE, firma: '' });
  assert.equal(sinFirma.status, NO_DISPONIBLE);
});

test('la cookie caduca, se invalida al alterar su firma y no es transferible entre variantes', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const instante = 1_800_000_000_000;
  const creada = await responderAccesoRecorrido(enviar(CLAVE), { ...BASE, ahora: () => instante });
  const cookie = (creada.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const vencida = await responderAccesoRecorrido(pedir(ENTRADA, { headers: { cookie } }), {
    ...BASE,
    ahora: () => instante + VIDA_MS,
  });
  assert.equal(vencida.status, PROHIBIDO);
  const posicionMac = cookie.lastIndexOf('.') + 1;
  const alterada = `${cookie.slice(0, posicionMac)}${cookie[posicionMac] === 'A' ? 'B' : 'A'}${cookie.slice(posicionMac + 1)}`;
  assert.equal(
    (
      await responderAccesoRecorrido(pedir(ENTRADA, { headers: { cookie: alterada } }), {
        ...BASE,
        ahora: () => instante,
      })
    ).status,
    PROHIBIDO,
  );
  const realInactivo = {
    ...BASE,
    variante: 'real' as const,
    ahora: () => instante,
    leerModo: async () => ({ version: 1 as const, revision: 3, modo: VARIANTE }),
  };
  assert.equal(
    (await responderAccesoRecorrido(pedir('/recorrido.html', { headers: { cookie } }), realInactivo)).status,
    PROHIBIDO,
  );
});

test('cierra ante autoridad de intentos fallida, cuerpo duplicado y HTTP', { skip: SIN_EXTENSIONES }, async () => {
  const fallo = await responderAccesoRecorrido(enviar(CLAVE), {
    ...BASE,
    consumirIntento: async () => {
      throw new Error('no disponible');
    },
  });
  assert.equal(fallo.status, NO_DISPONIBLE);
  const duplicado = await responderAccesoRecorrido(
    enviar(CLAVE, {
      body: new URLSearchParams([
        ['clave', CLAVE],
        ['clave', CLAVE],
      ]),
    }),
    BASE,
  );
  assert.equal(duplicado.status, PROHIBIDO);
  const http = await responderAccesoRecorrido(new Request('http://ejemplo.invalid/recorrido.html'), {
    ...BASE,
    variante: 'real',
  });
  assert.equal(http.status, PROHIBIDO);
});

test('HEAD sin sesión no revela contenido ni cuerpo', { skip: SIN_EXTENSIONES }, async () => {
  const respuesta = await responderAccesoRecorrido(pedir(ENTRADA, { method: 'HEAD' }), BASE);
  assert.equal(respuesta.status, PROHIBIDO);
  assert.equal(await respuesta.text(), '');
});

test('no acepta cookies duplicadas ni una autoridad de modo mal formada', { skip: SIN_EXTENSIONES }, async () => {
  const autorizacion = await responderAccesoRecorrido(enviar(CLAVE), BASE);
  const cookie = (autorizacion.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const duplicada = await responderAccesoRecorrido(
    pedir(ENTRADA, { headers: { cookie: `${cookie}; ${cookie}` } }),
    BASE,
  );
  assert.equal(duplicada.status, PROHIBIDO);
  const mal = await responderAccesoRecorrido(pedir(ENTRADA), {
    ...BASE,
    leerModo: async () => ({ version: 1 as const, revision: -1, modo: 'real' as const }),
  });
  assert.equal(mal.status, NO_DISPONIBLE);
});

test('el formulario muestra catalán cuando el navegador lo prefiere', { skip: SIN_EXTENSIONES }, async () => {
  const respuesta = await responderAccesoRecorrido(
    pedir(ENTRADA, {
      headers: { 'accept-language': 'ca-ES,es;q=0.8', 'sec-fetch-dest': 'document', accept: 'text/html' },
    }),
    BASE,
  );
  const html = await respuesta.text();
  assert.match(html, /lang="ca"/);
  assert.match(html, /Contrasenya/);
});

const MS_POR_SEGUNDO = 1000;
const IDIOMAS = [
  ['es', 'es-ES,es;q=0.9'],
  ['ca', 'ca-ES,es;q=0.8'],
] as const;
const fallaLaAutoridad = async () => {
  throw new Error('no disponible');
};
/** El envío nativo del formulario: una navegación del propio origen con el idioma del navegador. */
const enviarDesdeElFormulario = (preferencia: string, clave = CLAVE) =>
  pedir(ENTRADA, {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'accept-language': preferencia,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ clave }),
  });

/** Una página propia, no una página en blanco: con su idioma, su aviso y las cabeceras de seguridad, sin guardarse. */
async function comprobarPagina(respuesta: Response, idioma: 'es' | 'ca', aviso: string, caso: string) {
  assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8', caso);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store', caso);
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff', caso);
  assert.equal(respuesta.headers.get('referrer-policy'), 'same-origin', caso);
  assert.match(
    respuesta.headers.get('content-security-policy') ?? '',
    /default-src 'none'.*frame-ancestors 'none'/,
    caso,
  );
  assert.equal(respuesta.headers.get('set-cookie'), null, caso);
  const html = await respuesta.text();
  assert.match(html, new RegExp(`<html lang="${idioma}"`), caso);
  assert.ok(html.includes(`>${aviso}</p>`), `${caso}: falta el aviso visible`);
  assert.doesNotMatch(html, /clave-sintetica|firma-sintetica/, caso);
}

test('con los intentos agotados, el envío del formulario muestra el aviso en su idioma y la espera', {
  skip: SIN_EXTENSIONES,
}, async () => {
  for (const [idioma, preferencia] of IDIOMAS) {
    const respuesta = await responderAccesoRecorrido(enviarDesdeElFormulario(preferencia), {
      ...BASE,
      consumirIntento: async () => false,
    });
    assert.equal(respuesta.status, DEMASIADOS, idioma);
    assert.equal(respuesta.headers.get('retry-after'), String(VENTANA_MS / MS_POR_SEGUNDO), idioma);
    await comprobarPagina(respuesta, idioma, TEXTOS_ACCESO[idioma]['error-intentos'], `429 ${idioma}`);
  }
});

test('con el límite saturado, el envío del formulario dice que llegan demasiadas peticiones, en su idioma', {
  skip: SIN_EXTENSIONES,
}, async () => {
  for (const [idioma, preferencia] of IDIOMAS) {
    const respuesta = await responderAccesoRecorrido(enviarDesdeElFormulario(preferencia), {
      ...BASE,
      consumirIntento: async () => 'saturado' as const,
    });
    assert.equal(respuesta.status, DEMASIADOS, idioma);
    assert.equal(respuesta.headers.get(CABECERA_LIMITE), LIMITE_SATURADO, idioma);
    await comprobarPagina(respuesta, idioma, TEXTOS_ACCESO[idioma]['error-saturacion'], `429 saturado ${idioma}`);
  }
});

test('sin autoridad de intentos o de modo, el envío y la navegación muestran el aviso de servicio en su idioma', {
  skip: SIN_EXTENSIONES,
}, async () => {
  for (const [idioma, preferencia] of IDIOMAS) {
    const casos = [
      ['intentos', enviarDesdeElFormulario(preferencia), { ...BASE, consumirIntento: fallaLaAutoridad }],
      ['modo al enviar', enviarDesdeElFormulario(preferencia), { ...BASE, leerModo: fallaLaAutoridad }],
      [
        'modo al navegar',
        pedir(ENTRADA, { headers: { 'sec-fetch-mode': 'navigate', 'accept-language': preferencia } }),
        { ...BASE, leerModo: fallaLaAutoridad },
      ],
      ['sin firma al enviar', enviarDesdeElFormulario(preferencia), { ...BASE, firma: '' }],
    ] as const;
    for (const [caso, peticion, opciones] of casos) {
      const respuesta = await responderAccesoRecorrido(peticion, opciones);
      assert.equal(respuesta.status, NO_DISPONIBLE, `${caso} ${idioma}`);
      assert.equal(respuesta.headers.get('retry-after'), null, `${caso} ${idioma}`);
      await comprobarPagina(respuesta, idioma, TEXTOS_ACCESO[idioma]['error-servicio'], `503 ${caso} ${idioma}`);
    }
  }
  const modulo = await responderAccesoRecorrido(pedir(ENTRADA), { ...BASE, leerModo: fallaLaAutoridad });
  assert.equal(modulo.status, NO_DISPONIBLE);
  assert.equal(await modulo.text(), '', 'a lo que no es una navegación no se le entrega una página');
});

test('la contraseña incorrecta y el cuerpo mal formado dan la misma página 403, sin 401', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const sinNonce = (html: string) => html.replace(/nonce="[^"]+"/, 'nonce=""');
  const incorrecta = await responderAccesoRecorrido(enviarDesdeElFormulario('es-ES', 'incorrecta'), BASE);
  const malFormada = await responderAccesoRecorrido(
    pedir(ENTRADA, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'accept-language': 'es-ES',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'clave=a&otra=b',
    }),
    BASE,
  );
  assert.equal(incorrecta.status, PROHIBIDO);
  assert.equal(malFormada.status, PROHIBIDO);
  assert.equal(sinNonce(await incorrecta.text()), sinNonce(await malFormada.text()));
  const estados = new Set<number>();
  for (const opciones of [BASE, { ...BASE, consumirIntento: async () => false }, { ...BASE, firma: '' }]) {
    for (const clave of [CLAVE, 'incorrecta']) {
      estados.add((await responderAccesoRecorrido(enviarDesdeElFormulario('ca-ES', clave), opciones)).status);
    }
  }
  assert.deepEqual([...estados].sort(), [REDIRECCION, PROHIBIDO, DEMASIADOS, NO_DISPONIBLE].sort());
});

test('la página del acceso lleva el icono vacío en línea y su CSP solo admite esa imagen', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const fallida = enviar('clave-incorrecta-de-prueba', {
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  for (const peticion of [
    pedir(ENTRADA, { headers: { 'sec-fetch-dest': 'document', accept: 'text/html' } }),
    fallida,
  ]) {
    const respuesta = await responderAccesoRecorrido(peticion, BASE);
    const html = await respuesta.text();
    assert.equal(html.match(/<link/gi)?.length, 1, 'un solo <link>: el icono vacío');
    assert.ok(html.includes('<link rel="icon" href="data:,">'), 'sin él, el navegador pediría /favicon.ico');
    const csp = respuesta.headers.get('content-security-policy') ?? '';
    assert.deepEqual(
      csp.split('; ').filter((directiva) => directiva.startsWith('img-src')),
      ['img-src data:'],
    );
    assert.ok(csp.startsWith("default-src 'none';"));
  }
});
