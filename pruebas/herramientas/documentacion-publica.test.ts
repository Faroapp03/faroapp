import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { panelInstitucional } from '../ayudas/conectividad.ts';

const PLAZO_PETICION_MS = 2000;

async function pedir(url: string, method = 'GET'): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
    signal: AbortSignal.timeout(PLAZO_PETICION_MS),
  });
}

function instruccionesAnunciadas(catalogo: unknown): string[] {
  assert.ok(esObjeto(catalogo) && Array.isArray(catalogo.linkset));
  const contextos: unknown[] = catalogo.linkset;
  const servicios = contextos.filter(
    (contexto) => esObjeto(contexto) && typeof contexto.anchor === 'string' && /\/(?:mcp|a2a)$/.test(contexto.anchor),
  );
  assert.equal(servicios.length, 2);
  return servicios.flatMap((servicio) => {
    assert.ok(esObjeto(servicio));
    const documentos = servicio['service-doc'];
    assert.ok(Array.isArray(documentos));
    return documentos.map((documento: unknown) => {
      assert.ok(esObjeto(documento) && typeof documento.href === 'string');
      return documento.href;
    });
  });
}

async function comprobarDocumento(url: string): Promise<void> {
  const respuesta = await pedir(url);
  assert.equal(respuesta.status, ESTADO_HTTP.correcto, url);
  assert.equal(respuesta.headers.get('content-type'), 'text/plain; charset=utf-8');
  const texto = await respuesta.text();
  assert.match(texto, /^# Faro\n\n> /);
  const cabecera = await pedir(url, 'HEAD');
  assert.equal(cabecera.status, ESTADO_HTTP.correcto);
  assert.equal(cabecera.headers.get('content-type'), respuesta.headers.get('content-type'));
  assert.equal(await cabecera.text(), '');
  const enlaces = [...texto.matchAll(/^- \[[^\]]+\]\(([^)]+)\)/gm)];
  assert.ok(enlaces.length > 0, 'Las instrucciones deben enlazar los contratos disponibles');
  for (const enlace of enlaces) {
    assert.ok(enlace[1]);
    const destino = new URL(enlace[1], url);
    assert.equal(destino.origin, new URL(url).origin);
    if (['/mcp', '/a2a', '/.well-known/agent-card.json'].includes(destino.pathname)) {
      continue;
    }
    const recurso = await pedir(destino.href);
    assert.equal(recurso.status, ESTADO_HTTP.correcto, destino.href);
    await recurso.body?.cancel();
  }
}

test('las instrucciones anunciadas por MCP y A2A se sirven y enlazan documentación disponible', async () => {
  const montaje = await panelInstitucional('Node');
  await montaje.controles.cambiarControles(0, { version: 2, api: 'deshabilitada', mcp: true, a2a: true });
  const carpeta = mkdtempSync(join(tmpdir(), 'autoridad-secciones-prueba-'));
  const servidor = crearServidor({
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    administracion: montaje.panel,
    web: RUTAS.web,
    api: async () => {
      assert.fail('Leer documentación no debe ejecutar una operación de la API');
    },
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  try {
    servidor.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const direccion = servidor.address();
    assert.ok(direccion && typeof direccion === 'object');
    const respuesta = await pedir(`http://127.0.0.1:${direccion.port}/.well-known/api-catalog`);
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    const catalogo: unknown = await respuesta.json();
    for (const url of new Set(instruccionesAnunciadas(catalogo))) {
      await comprobarDocumento(url);
    }
  } finally {
    montaje.cerrar();
    servidor.closeAllConnections();
    await new Promise<void>((resolver, rechazar) => servidor.close((error) => (error ? rechazar(error) : resolver())));
    rmSync(carpeta, { recursive: true, force: true });
  }
});
