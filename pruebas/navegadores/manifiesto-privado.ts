/** El servidor del ensayo conserva cada estado del Worker, también para los manifiestos de instalación. */
import type { Route } from 'playwright-core';
import type { PeticionObservada } from './fixture.ts';
import type { ModoDelEnsayo } from './modo-del-ensayo.ts';

const MANIFIESTOS = ['/manifest.webmanifest', '/manifest-ca.webmanifest'];

export interface BasicDeManifiesto {
  ruta: string;
  estado: number;
}

/**
 * WebKitGTK puede cargar el manifiesto con credenciales pero sin resolver desafíos HTTP Basic. El contexto privado
 * ya ha recibido su clave sintética. Se entrega solo al Worker en loopback, para este GET nativo y con un enlace
 * que solicita credenciales. route.fetch no sigue ni una redirección; el navegador recibe la respuesta original.
 * El portal oficial usa una cookie y no pasa por este adaptador.
 */
export async function atenderManifiestoPrivado(
  ruta: Route,
  origen: string,
  credenciales: ModoDelEnsayo['credenciales'],
  asistidas: BasicDeManifiesto[],
): Promise<void> {
  const peticion = ruta.request();
  const url = new URL(peticion.url());
  if (
    url.hostname !== '127.0.0.1' ||
    url.origin !== origen ||
    !MANIFIESTOS.includes(url.pathname) ||
    url.href !== origen + url.pathname ||
    peticion.method() !== 'GET'
  ) {
    return ruta.fallback();
  }
  const headers = await peticion.allHeaders();
  if (
    headers['sec-fetch-dest'] !== 'manifest' ||
    headers.authorization ||
    new URL(peticion.frame().url()).origin !== origen
  ) {
    return ruta.fallback();
  }
  const conCredenciales = await peticion
    .frame()
    .evaluate(
      () => document.querySelector<HTMLLinkElement>('link[rel~="manifest"]')?.crossOrigin === 'use-credentials',
    );
  if (!conCredenciales) {
    return ruta.fallback();
  }
  const authorization = `Basic ${Buffer.from(`${credenciales.username}:${credenciales.password}`).toString('base64')}`;
  const respuesta = await ruta.fetch({ headers: { ...headers, authorization }, maxRedirects: 0 });
  try {
    asistidas.push({ ruta: url.pathname, estado: respuesta.status() });
    await ruta.fulfill({ response: respuesta });
  } finally {
    await respuesta.dispose();
  }
}

/** Sec-Fetch-Dest distingue el manifiesto nativo de un fetch del service worker. Un destino ausente es desconocido. */
export function peticionesDeManifiesto(peticiones: readonly PeticionObservada[]) {
  return peticiones
    .filter(({ ruta }) => MANIFIESTOS.includes(ruta))
    .map(({ ruta, destino, estado }) => ({ ruta, destino: destino ?? null, estado: estado ?? null }));
}
