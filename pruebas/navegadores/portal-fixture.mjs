// Workerd local y proxy HTTPS en loopback, con certificados y datos sintéticos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirWorkerConstruido } from './worker-miniflare.ts';

export const PORTAL = { usuario: 'Faro', clave: 'portal-sintetico-exclusivo-para-este-ensayo' };
export const CLAVE_RECORRIDO = 'recorrido-sintetico-exclusivo-para-este-ensayo';
const ERROR_INTERNO = 500;

function cabeceras(req) {
  const headers = new Headers();
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor !== undefined) {
      headers.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor);
    }
  }
  headers.set('cf-connecting-ip', '127.0.0.1');
  // dispatchFetch pasa por undici, que reescribe Sec-Fetch-Mode con el modo de su propia petición (cors);
  // Miniflare restituye al worker el valor del navegador si llega en MF-Sec-Fetch-Mode.
  const modo = req.headers['sec-fetch-mode'];
  if (typeof modo === 'string') {
    headers.set('mf-sec-fetch-mode', modo);
  } else {
    headers.delete('mf-sec-fetch-mode');
  }
  return headers;
}

function crearMiniflare(directorio) {
  return abrirWorkerConstruido(directorio, {
    bindings: {
      FARO_CLAVE_GENERAL: PORTAL.clave,
      FARO_SESION_PORTAL: 'firma-portal-sintetica-independiente-para-pruebas',
      FARO_LIMITE_PORTAL: 'limite-portal-sintetico-independiente-para-pruebas',
      FARO_RECORRIDO_CLAVE: CLAVE_RECORRIDO,
      FARO_RECORRIDO_FIRMA: 'firma-recorrido-sintetica-independiente-para-pruebas',
      FARO_RECORRIDO_LIMITE: 'limite-recorrido-sintetico-independiente-para-pruebas',
      FARO_SECRETO_FIRMA: 'firma-administrativa-sintetica-independiente',
    },
  });
}

function certificados(carpeta) {
  const clave = join(carpeta, 'clave.pem');
  const certificado = join(carpeta, 'certificado.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      clave,
      '-out',
      certificado,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(clave), cert: readFileSync(certificado) };
}

function crearServidor(tls, miniflare, obtenerOrigen) {
  return createServer(tls, (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', obtenerOrigen());
      const partes = [];
      for await (const parte of req) {
        partes.push(parte);
      }
      const cuerpo = Buffer.concat(partes);
      const respuesta = await miniflare.dispatchFetch(url.href, {
        method: req.method,
        headers: cabeceras(req),
        ...(cuerpo.length ? { body: cuerpo } : {}),
        redirect: 'manual',
      });
      res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
      res.end(Buffer.from(await respuesta.arrayBuffer()));
    })().catch((error) => {
      const causa = error instanceof Error ? error.cause : undefined;
      console.error('Fallo del proxy local', {
        nombre: error?.name,
        codigo: error?.code,
        causa: causa?.name,
        codigoCausa: causa?.code,
      });
      res.writeHead(ERROR_INTERNO);
      res.end();
    });
  });
}

export async function crearPortalLocal(directorio) {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-portal-tls-'));
  let miniflare;
  let servidor;
  let origen = '';
  try {
    const tls = certificados(carpeta);
    miniflare = crearMiniflare(directorio);
    servidor = crearServidor(tls, miniflare, () => origen);
    await new Promise((ok, fallo) => {
      servidor.once('error', fallo);
      servidor.listen(0, '127.0.0.1', ok);
    });
    const direccion = servidor.address();
    assert.ok(direccion && typeof direccion !== 'string');
    origen = `https://127.0.0.1:${direccion.port}`;
    return {
      origen,
      async cerrar() {
        servidor.closeAllConnections();
        await new Promise((ok, fallo) => servidor.close((error) => (error ? fallo(error) : ok())));
        await miniflare.dispose();
        rmSync(carpeta, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await miniflare?.dispose();
    rmSync(carpeta, { recursive: true, force: true });
    throw error;
  }
}
