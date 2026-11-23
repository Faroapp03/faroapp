/** Registro de errores, CSP y peticiones reales. Conserva también consola cruda; nunca filtra fallos del motor. */
import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { type EntornoObservacion, type EventoCsp, esAvisoSelectWebKit } from './csp-panel.ts';
import type { Fixture } from './fixture.ts';

export function observar(
  contexto: BrowserContext,
  fixture: Pick<Fixture, 'origen'>,
  opciones: Omit<EntornoObservacion, 'origen'>,
) {
  const registro = {
    entorno: { ...opciones, origen: fixture.origen },
    erroresPagina: [] as string[],
    eventosDom: [] as unknown[],
    consola: [] as unknown[],
    csp: [] as unknown[],
    cspReconocidos: [] as EventoCsp[],
    externas: [] as string[],
    apiPost: [] as string[],
  };
  contexto.on('page', (pagina) => {
    pagina.on('pageerror', (error) => registro.erroresPagina.push(String(error)));
    pagina.on('console', (mensaje) => registro.consola.push({ tipo: mensaje.type(), texto: mensaje.text() }));
    pagina.on('dialog', (dialogo) => {
      void dialogo.accept();
    });
  });
  contexto.on('request', (peticion) => {
    const url = new URL(peticion.url());
    if (url.origin !== fixture.origen && ['http:', 'https:'].includes(url.protocol)) {
      registro.externas.push(url.href);
    }
    if (url.pathname.startsWith('/api/') && peticion.method() === 'POST') {
      registro.apiPost.push(url.pathname);
    }
  });
  return registro;
}

export type Observacion = ReturnType<typeof observar>;

export async function prepararContexto(
  contexto: BrowserContext,
  fixture: Pick<Fixture, 'origen'>,
  registro: Observacion,
): Promise<void> {
  await contexto.route(/^https?:/, (ruta) =>
    new URL(ruta.request().url()).origin === fixture.origen ? ruta.continue() : ruta.abort('blockedbyclient'),
  );
  await contexto.exposeBinding('__faroEvento', (_fuente, evento: unknown) => {
    registro.eventosDom.push(evento);
  });
  await contexto.exposeBinding('__faroCsp', (_fuente, evento: unknown) => {
    registro.csp.push(evento);
    if (esAvisoSelectWebKit(evento, registro.entorno)) {
      registro.cspReconocidos.push(evento);
    }
  });
  await contexto.addInitScript(() => {
    const enlaces = globalThis as typeof globalThis & {
      __faroEvento: (evento: unknown) => Promise<void>;
      __faroCsp: (evento: unknown) => Promise<void>;
    };
    addEventListener('error', (evento) => {
      void enlaces.__faroEvento({
        tipo: 'error',
        mensaje: evento.message,
        archivo: evento.filename,
        linea: evento.lineno,
      });
    });
    addEventListener('unhandledrejection', (evento) => {
      void enlaces.__faroEvento({ tipo: 'unhandledrejection', mensaje: String(evento.reason) });
    });
    addEventListener('securitypolicyviolation', (evento) => {
      if (evento.disposition === 'enforce') {
        const elemento = evento.target instanceof Element ? evento.target : null;
        void enlaces.__faroCsp({
          directiva: evento.effectiveDirective,
          recurso: evento.blockedURI,
          muestra: evento.sample,
          documento: evento.documentURI,
          elemento: elemento?.tagName ?? null,
          estilo: elemento?.getAttribute('style') ?? null,
          fuente: evento.sourceFile,
          linea: evento.lineNumber,
          columna: evento.columnNumber,
          confiable: evento.isTrusted,
        });
      }
    });
  });
}

/**
 * Una violación de CSP que una prueba provoca a propósito, por su firma: la directiva, lo bloqueado, la muestra (el
 * tipo de sumidero y el guion) y el documento. Solo se acepta si aparece exactamente una vez.
 */
export interface ViolacionEsperada {
  readonly directiva: string;
  readonly recurso: string;
  readonly muestra: string;
  readonly documento: string;
}

function esLaEsperada(evento: unknown, esperada: ViolacionEsperada): boolean {
  const visto = evento as Partial<Record<keyof ViolacionEsperada, unknown>> | null;
  return (
    visto?.directiva === esperada.directiva &&
    visto.recurso === esperada.recurso &&
    visto.muestra === esperada.muestra &&
    visto.documento === esperada.documento
  );
}

export function comprobarObservacion(
  registro: Observacion,
  fixture: Pick<Fixture, 'errores' | 'peticiones'>,
  esperadas: readonly ViolacionEsperada[] = [],
): void {
  assert.deepEqual(fixture.errores, [], 'El transporte no debe ocultar errores del Worker ni del panel');
  assert(fixture.peticiones.length > 0, 'Deben existir peticiones HTTP reales');
  assert(fixture.peticiones.every((peticion) => peticion.ua === IDENTIDAD_WEB['User-Agent']));
  assert.deepEqual(registro.externas, [], 'La aplicación pidió recursos externos');
  assert.deepEqual(registro.apiPost, [], 'El recorrido local no debe enviar sus textos al servidor');
  assert.deepEqual(registro.eventosDom, [], 'Excepción DOM o promesa sin manejar');
  const vistos = registro.csp.filter((evento) => !esAvisoSelectWebKit(evento, registro.entorno));
  for (const esperada of esperadas) {
    const coinciden = vistos.filter((evento) => esLaEsperada(evento, esperada)).length;
    assert.equal(coinciden, 1, `La violación provocada aparece una sola vez: ${esperada.muestra}`);
  }
  const bloqueos = vistos.filter((evento) => !esperadas.some((esperada) => esLaEsperada(evento, esperada)));
  assert.deepEqual(bloqueos, [], 'La CSP bloqueó un recurso');
  assert.deepEqual(registro.erroresPagina, [], 'El motor registró errores de página; conservar el diagnóstico crudo');
}

export async function estabilizar(pagina: Page): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.evaluate(
    () =>
      new Promise<void>((ok) => {
        requestAnimationFrame(() => requestAnimationFrame(() => ok()));
      }),
  );
}
