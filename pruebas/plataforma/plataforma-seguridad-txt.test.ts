// security.txt publica solo el contacto configurado, en Node y Worker, sin inventar una identidad.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

import {
  CADUCA_POR_DEFECTO,
  datosDeSeguridad,
  RUTA_SECURITY_TXT,
  respuestaDeSecurityTxt,
  textoDeSecurityTxt,
} from '../../src/plataforma/seguridad-txt.ts';

// Reloj fijo: la caducidad se compara con el momento actual y las pruebas no dependen del día en que se ejecutan.
const HOY = Date.parse('2026-10-29T00:00:00.000Z');
mock.timers.enable({ apis: ['Date'], now: HOY });

const ORIGEN = 'https://sitio.example';
const CONTACTO = 'mailto:seguridad@example.test';
const HTTP_CORRECTO = 200;
const HTTP_AUSENTE = 404;
const PLAZO_MS = 5000;

test('sin contacto configurado no hay documento ni identidad suplente', async () => {
  for (const contacto of [undefined, '', '   ', 'http://entidad.example', 'mailto:sin-direccion']) {
    const datos = datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: contacto });
    assert.equal(datos, null);
    const respuesta = respuestaDeSecurityTxt(datos, ORIGEN);
    assert.equal(respuesta.status, HTTP_AUSENTE);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.equal(await respuesta.text(), '');
  }
});

test('el texto conserva contacto, caducidad, idiomas y dirección canónica con salto final', () => {
  const datos = datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO });
  assert.ok(datos);
  assert.equal(
    textoDeSecurityTxt(datos, ORIGEN),
    [
      `Contact: ${CONTACTO}`,
      `Expires: ${CADUCA_POR_DEFECTO}`,
      'Preferred-Languages: es, ca, en',
      `Canonical: ${ORIGEN}/.well-known/security.txt`,
      '',
    ].join('\n'),
  );
});

test('el contacto propio y la política HTTPS se publican con su fecha exacta', () => {
  const propio = datosDeSeguridad({
    FARO_SEGURIDAD_CONTACTO: CONTACTO,
    FARO_SEGURIDAD_POLITICA: 'https://entidad.example/politica',
    FARO_SEGURIDAD_CADUCA: '2028-02-29',
  });
  assert.deepEqual(propio, {
    contacto: CONTACTO,
    politica: 'https://entidad.example/politica',
    caduca: '2028-02-29T00:00:00.000Z',
  });
  assert.deepEqual(
    datosDeSeguridad({
      FARO_SEGURIDAD_CONTACTO: 'https://entidad.example/contacto',
      FARO_SEGURIDAD_POLITICA: 'mailto:seguridad@example.test',
      FARO_SEGURIDAD_CADUCA: 'mañana',
    }),
    null,
  );
});

test('los días imposibles y las horas sin zona no se normalizan silenciosamente', () => {
  for (const caduca of [
    '2027-02-30',
    '2027-02-30T23:30:00-11:00',
    '2027-02-29',
    '2026-04-31',
    '2028-02-30',
    '2027-13-01',
    '2027-01-00',
    '2028-03-05T10:00',
  ]) {
    assert.equal(datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_CADUCA: caduca }), null, caduca);
  }
});

test('configuración opcional vacía es ausencia; valores explícitos inválidos cierran la publicación', () => {
  for (const vacio of [undefined, '', '   ']) {
    assert.deepEqual(
      datosDeSeguridad({
        FARO_SEGURIDAD_CONTACTO: CONTACTO,
        FARO_SEGURIDAD_POLITICA: vacio,
        FARO_SEGURIDAD_CADUCA: vacio,
      }),
      { contacto: CONTACTO, politica: null, caduca: CADUCA_POR_DEFECTO },
    );
  }
  for (const politica of ['http://entidad.example/politica', 'mailto:seguridad@example.test', 'no es URL']) {
    assert.equal(datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_POLITICA: politica }), null);
  }
  for (const caduca of ['mañana', '2027-02-30', '2028-03-05T10:00']) {
    assert.equal(datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_CADUCA: caduca }), null);
  }
});

test('fechas válidas conservan día bisiesto y conversión exacta de zona', () => {
  for (const [caduca, esperada] of [
    ['2028-02-29', '2028-02-29T00:00:00.000Z'],
    ['2028-02-29T01:30:00+02:00', '2028-02-28T23:30:00.000Z'],
    ['2027-12-31T23:30:00-02:00', '2028-01-01T01:30:00.000Z'],
  ]) {
    assert.equal(
      datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_CADUCA: caduca })?.caduca,
      esperada,
    );
  }
});

test('la respuesta válida publica el texto exacto en UTF-8 con caché de un día', async () => {
  const datos = datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO });
  assert.ok(datos);
  const respuesta = respuestaDeSecurityTxt(datos, ORIGEN);
  assert.equal(respuesta.status, HTTP_CORRECTO);
  assert.equal(await respuesta.text(), textoDeSecurityTxt(datos, ORIGEN));
  assert.equal(respuesta.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(respuesta.headers.get('cache-control'), 'public, max-age=86400');
});

for (const contacto of ['', 'http://entidad.example', CONTACTO]) {
  test(`Node y Worker publican solo el contacto válido: ${contacto || 'ausente'}`, { timeout: PLAZO_MS }, async (t) => {
    const variables = { FARO_SEGURIDAD_CONTACTO: contacto };
    const esperado = contacto === CONTACTO ? HTTP_CORRECTO : HTTP_AUSENTE;
    const carpeta = mkdtempSync(join(tmpdir(), 'seguridad-publicacion-'));
    const web = join(carpeta, 'web');
    mkdirSync(web);
    const servidor = crearServidor({
      web,
      archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
      api: async () => assert.fail('security.txt no llama a la API'),
      puerto: 0,
      anfitrion: '127.0.0.1',
      seguridad: datosDeSeguridad(variables),
    });
    servidor.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    t.after(async () => {
      try {
        servidor.closeAllConnections();
        await new Promise<void>((resolver, rechazar) =>
          servidor.close((error) => (error ? rechazar(error) : resolver())),
        );
      } finally {
        rmSync(carpeta, { recursive: true, force: true });
      }
    });
    const direccion = servidor.address();
    assert.ok(direccion && typeof direccion === 'object');
    const local = await fetch(`http://127.0.0.1:${direccion.port}${RUTA_SECURITY_TXT}`, {
      headers: IDENTIDAD_WEB,
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    const remoto = await worker.fetch(new Request(`${ORIGEN}${RUTA_SECURITY_TXT}`), {
      ...variables,
      ASSETS: { fetch: async () => assert.fail('security.txt no consulta archivos ajenos') },
    });
    for (const respuesta of [local, remoto]) {
      assert.equal(respuesta.status, esperado);
      const cuerpo = await respuesta.text();
      if (esperado === HTTP_CORRECTO) {
        assert.ok(cuerpo.startsWith(`Contact: ${CONTACTO}\n`));
      } else {
        assert.equal(respuesta.headers.get('cache-control'), 'no-store');
        assert.equal(cuerpo, '');
      }
    }
  });
}

test('una caducidad ya vencida no se publica: el archivo dejaría de valer', () => {
  assert.equal(datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_CADUCA: '2026-10-28' }), null);
  assert.equal(
    datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO }, Date.parse(CADUCA_POR_DEFECTO)),
    null,
    'Al llegar la caducidad por defecto, deja de publicarse hasta renovarla',
  );
  assert.ok(datosDeSeguridad({ FARO_SEGURIDAD_CONTACTO: CONTACTO, FARO_SEGURIDAD_CADUCA: '2026-10-30' }));
});
