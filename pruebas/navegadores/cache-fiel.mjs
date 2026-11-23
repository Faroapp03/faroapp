// La caché HTTP del navegador como contra el dominio real, para los ensayos que cuentan lo que se pide o miden una
// segunda visita (presupuesto-condiciones.mjs, presupuesto-medida.mjs y descargas-js.mjs). Tres piezas, una por motor
// que la perdería:
// - Chromium no guarda en su caché HTTP nada que llegue con error de certificado (net/http/http_cache_transaction.cc):
//   el certificado sintético del servidor del ensayo se da por válido solo en su perfil, por su huella SPKI;
// - en Chromium, `httpCredentials` de Playwright detiene cada petición (Fetch.enable con todas las direcciones) y
//   desactiva la caché (Network.setCacheDisabled) en la página, sus Workers y el service worker: el Basic lo responde
//   autenticarEnChromium(), solo en los documentos;
// - el contexto efímero que Playwright da a WebKit (newContext) no tiene caché HTTP, solo la de memoria de la página:
//   en WebKit cada contexto es un perfil persistente, nuevo y vacío.
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entornoDelNavegador, MOTORES, PLAZO_DE_ARRANQUE_MS } from './paquete-comun.mjs';
import { CREDENCIALES_SINTETICAS } from './privado.ts';
import { abrirNavegador, arrancarConPlazo } from './recursos-del-caso.mjs';

/**
 * La huella SPKI del certificado sintético del servidor del ensayo (SHA-256 de su clave pública, en base64: RFC 7469,
 * 2.4), la que Chromium admite en `--ignore-certificate-errors-spki-list`.
 */
const SPKI_DEL_ENSAYO = createHash('sha256')
  .update(
    new X509Certificate(readFileSync(new URL('./tls-sintetico.pem', import.meta.url))).publicKey.export({
      type: 'spki',
      format: 'der',
    }),
  )
  .digest('base64');

/** El argumento de Chromium que da por válido, solo en su perfil, el certificado sintético del ensayo. */
export const CERTIFICADO_DEL_ENSAYO_EN_CHROMIUM = `--ignore-certificate-errors-spki-list=${SPKI_DEL_ENSAYO}`;

/**
 * Las credenciales del contexto para la construcción privada servida en `origen` (su Basic sintético): en WebKit y
 * Firefox, `httpCredentials`, que no tocan la caché; en Chromium ninguna, porque las da autenticarEnChromium().
 */
export const credencialesDelContexto = (motor, origen) =>
  motor === 'chromium' ? {} : { httpCredentials: { ...CREDENCIALES_SINTETICAS, origin: origen } };

/**
 * Un contexto con perfil limpio y la caché HTTP del navegador, con las `opciones` de contexto dadas, en la `sesion` de
 * `arrancar` (paquete-comun.mjs). En Chromium y Firefox, un contexto nuevo del navegador arrancado. En WebKit, un
 * perfil persistente en una carpeta nueva y vacía dentro de la carpeta temporal de la sesión, que se retira al
 * cerrarla: el primer uso es el de un perfil limpio y la recarga sale de su caché HTTP, como en Safari. Cerrar el
 * contexto cierra ese WebKit. Si la sesión lleva los recursos de su caso (`arrancar` con `recursos`), ese WebKit es un
 * recurso más del caso, que su after cierra aunque el caso venza, y solo se toman por suyos los procesos que había al
 * vencer, no los del caso siguiente (abrirNavegador y arrancarConPlazo con los recursos del caso).
 */
export function contextoConCache(sesion, motor, opciones) {
  if (motor !== 'webkit') {
    return sesion.navegador.newContext(opciones);
  }
  const { recursos } = sesion;
  const lanzar = () =>
    arrancarConPlazo(
      () =>
        MOTORES.webkit.launchPersistentContext(mkdtempSync(join(sesion.temporal, 'perfil-')), {
          headless: true,
          timeout: PLAZO_DE_ARRANQUE_MS,
          ...opciones,
          env: entornoDelNavegador(sesion.temporal),
        }),
      'el navegador webkit no llegó a arrancar con un perfil nuevo (contextoConCache)',
      PLAZO_DE_ARRANQUE_MS,
      { recursos },
    );
  return recursos ? abrirNavegador(recursos, 'el navegador webkit con un perfil nuevo', lanzar) : lanzar();
}

/** Los documentos: lo único que autenticarEnChromium() detiene, para recibir sus desafíos Basic. */
const SOLO_DOCUMENTOS = [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }];

/**
 * En Chromium, el Basic de la construcción privada en `pagina`, como lo resuelve el navegador de una persona que ha
 * escrito su clave: responde la credencial sintética al desafío Basic del servidor de `origen` (cualquier otro se
 * cancela) y el navegador la guarda para ese ámbito, de donde la toman los demás recursos, los Workers y el service
 * worker. Solo detiene los documentos, que siguen sin cambios. En WebKit y Firefox no hace nada: allí el Basic lo da
 * `httpCredentials` (credencialesDelContexto).
 */
export async function autenticarEnChromium(contexto, pagina, { motor, origen }) {
  if (motor !== 'chromium') {
    return;
  }
  const sesion = await contexto.newCDPSession(pagina);
  const responder = (orden, parametros) => sesion.send(orden, parametros).catch(() => undefined);
  sesion.on('Fetch.requestPaused', ({ requestId }) => responder('Fetch.continueRequest', { requestId }));
  sesion.on('Fetch.authRequired', ({ requestId, request, authChallenge }) => {
    const propio =
      authChallenge.source === 'Server' &&
      authChallenge.scheme.toLowerCase() === 'basic' &&
      new URL(request.url).origin === origen;
    const authChallengeResponse = propio
      ? { response: 'ProvideCredentials', ...CREDENCIALES_SINTETICAS }
      : { response: 'CancelAuth' };
    return responder('Fetch.continueWithAuth', { requestId, authChallengeResponse });
  });
  await sesion.send('Fetch.enable', { patterns: SOLO_DOCUMENTOS, handleAuthRequests: true });
}
