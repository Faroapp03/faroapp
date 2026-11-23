import type { CapacidadesPanel } from '../administracion.ts';
import { type EntornoPrivado, responderAccesoPrivado } from './acceso-privado.ts';
import { responderUnificado } from './worker-unificado.ts';

export { AccesoPublicoDurable } from './worker-unificado.ts';

async function responderPrivado(solicitud: Request, entorno: EntornoPrivado): Promise<Response> {
  if (new URL(solicitud.url).pathname === '/capacidades-panel.json') {
    return Response.json(
      {
        version: 1,
        ...({ controles: false, actualizacion: false, vigilante: false, recorrido: false } satisfies CapacidadesPanel),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  // Estos canales y su conmutación permanecen cerrados durante esta instalación.
  const ruta = new URL(solicitud.url).pathname;
  let normalizada: string;
  try {
    normalizada = decodeURIComponent(ruta).replaceAll('\\', '/').toLowerCase();
    if (normalizada.includes('%')) {
      throw new Error('ruta ambigua');
    }
  } catch {
    return new Response(null, { status: 404 });
  }
  const segmentos: string[] = [];
  for (const parte of normalizada.split('/')) {
    if (parte === '..') {
      segmentos.pop();
    } else if (parte && parte !== '.') {
      segmentos.push(parte);
    }
  }
  normalizada = `/${segmentos.join('/')}`;
  if (
    [
      '/mcp',
      '/a2a',
      '/.well-known/agent-card.json',
      '/api/socios/v1',
      '/.well-known/oauth-authorization-server/api/socios/v1',
      '/administracion/api/controles/cambiar',
      '/administracion/api/datos/actualizar',
      '/administracion/api/datos/vigilante/preparar',
      '/administracion/api/datos/retirar',
      '/administracion/api/datos/reconciliar',
      '/mantenimiento',
    ].some((base) => normalizada === base || normalizada.startsWith(`${base}/`))
  ) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return responderUnificado(solicitud, entorno);
}

export default {
  fetch(peticion: Request, entorno: EntornoPrivado): Promise<Response> {
    return responderAccesoPrivado(peticion, entorno, responderPrivado);
  },
};
