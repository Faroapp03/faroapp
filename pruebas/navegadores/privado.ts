/** Credencial sintética para loopback y control explícito de la puerta privada y el panel cerrado. */
import assert from 'node:assert/strict';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

export const USUARIO_SINTETICO = 'Faro';
export const CLAVE_SINTETICA = 'clave-sintetica-exclusiva-del-ensayo';
export const CREDENCIALES_SINTETICAS = { username: USUARIO_SINTETICO, password: CLAVE_SINTETICA };

export async function comprobarPuertaPrivada(origen: string, pedir: typeof fetch = fetch) {
  const autorizacion = `Basic ${Buffer.from(`${USUARIO_SINTETICO}:${CLAVE_SINTETICA}`).toString('base64')}`;
  async function solicitar(ruta: string, autorizada: boolean) {
    const respuesta = await pedir(`${origen}${ruta}`, {
      headers: { ...IDENTIDAD_WEB, ...(autorizada ? { authorization: autorizacion } : {}) },
      redirect: 'manual',
    });
    return respuesta;
  }
  for (const ruta of ['/recorrido.html', '/administracion', '/administracion/panel.js']) {
    const anonima = await solicitar(ruta, false);
    assert.equal(anonima.status, ESTADO_HTTP.noAutenticado, `${ruta}: la puerta exige Basic`);
    assert.match(anonima.headers.get('www-authenticate') ?? '', /^Basic\b/);
  }
  const invalida = await pedir(`${origen}/recorrido.html`, {
    headers: {
      ...IDENTIDAD_WEB,
      authorization: `Basic ${Buffer.from(`${USUARIO_SINTETICO}:incorrecta`).toString('base64')}`,
    },
    redirect: 'manual',
  });
  assert.equal(invalida.status, ESTADO_HTTP.noAutenticado, 'La clave incorrecta no abre la aplicación');
  for (const ruta of [
    '/administracion',
    '/administracion/',
    '/administracion/panel.js',
    '/administracion/api/controles/leer',
  ]) {
    const respuesta = await solicitar(ruta, true);
    assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, `${ruta}: el panel permanece cerrado tras Basic`);
  }
  assert.equal(
    (await solicitar('/recorrido.html', true)).status,
    ESTADO_HTTP.correcto,
    'La app abre con la clave sintética',
  );
  return { sinBasic: 401, claveIncorrecta: 401, panelConBasic: 404, aplicacionConBasic: 200 };
}
