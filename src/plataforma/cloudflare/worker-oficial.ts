/** Entrada oficial de portada y acceso general que envuelve la aplicación unificada. */
import type { EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../acceso-publico/recorrido-cliente-durable.ts';
import { SesionesPortalDurable } from '../acceso-publico/sesion-portal-cliente.ts';
import { responderAccesoPortal } from './acceso-portal.ts';
import type { EntornoPrivado } from './acceso-privado.ts';
import { paginaAcceso } from './acceso-web-pagina.ts';
import { activoDeRuta, responderActivoPublico } from './activos-publicos.ts';
import { protegerRespuestaPortal } from './cabeceras-portal.ts';
import { esCanalDeMaquina } from './canales-portal.ts';
import { redireccionAlDominioPrincipal } from './dominio-canonico.ts';
import { CSP_PORTADA, CSP_SCRIPT_CABECERA, PORTADA_PUBLICA } from './portada-publica.ts';
import worker from './worker.ts';
import { responderUnificado } from './worker-unificado.ts';

export { AccesoPublicoDurable } from './worker-unificado.ts';

function cabecerasPagina(estilo: string): Headers {
  return new Headers({
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src '${CSP_SCRIPT_CABECERA}'; style-src '${estilo}'; img-src data: 'self'; font-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  });
}
function autoridad(espacio: EspacioAccesoPublicoDurable | undefined): SesionesPortalDurable {
  if (!espacio) {
    throw new Error('Falta la autoridad durable');
  }
  return new SesionesPortalDurable(espacio);
}
export default {
  async scheduled(evento: Parameters<typeof worker.scheduled>[0], variables: EntornoPrivado): Promise<void> {
    const {
      FARO_CLAVE_GENERAL: _clave,
      FARO_SESION_PORTAL: _firma,
      FARO_LIMITE_PORTAL: _limite,
      FARO_PRUEBAS_CLAVE: _pruebas,
      FARO_PRUEBAS_LIMITE: _limitePruebas,
      FARO_PRUEBAS_ADMINISTRACION: _adminPruebas,
      FARO_RECORRIDO_CLAVE: _claveRecorrido,
      FARO_RECORRIDO_FIRMA: _firmaRecorrido,
      FARO_RECORRIDO_LIMITE: _limiteRecorrido,
      ...entorno
    } = variables;
    await worker.scheduled(evento, entorno);
  },
  async fetch(peticion: Request, variables: EntornoPrivado): Promise<Response> {
    return protegerRespuestaPortal(peticion, await responderOficial(peticion, variables));
  },
};

async function responderOficial(peticion: Request, variables: EntornoPrivado): Promise<Response> {
  const url = new URL(peticion.url);
  // Antes que nada público: si www llegara al Worker sin la regla de la zona, no habría dos copias del sitio.
  const principal = redireccionAlDominioPrincipal(url);
  if (principal) {
    return principal;
  }
  const lectura = peticion.method === 'GET' || peticion.method === 'HEAD';
  if (url.protocol === 'http:' && lectura) {
    url.protocol = 'https:';
    return new Response(null, { status: 308, headers: { location: url.href, 'cache-control': 'no-store' } });
  }
  if (url.protocol !== 'https:') {
    return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  const publica = lectura ? respuestaPublica(peticion, url, variables) : null;
  if (publica) {
    return publica;
  }
  const {
    FARO_CLAVE_GENERAL: clave,
    FARO_SESION_PORTAL: firma,
    FARO_LIMITE_PORTAL: claveLimite,
    FARO_PRUEBAS_CLAVE: _pruebas,
    FARO_PRUEBAS_LIMITE: _limitePruebas,
    FARO_PRUEBAS_ADMINISTRACION: _adminPruebas,
    ...entorno
  } = variables;
  if (esCanalDeMaquina(peticion)) {
    return responderUnificado(peticion, entorno);
  }
  const espacio = entorno.REGISTRO_SOCIOS as EspacioAccesoPublicoDurable | undefined;
  return responderAccesoPortal(peticion, {
    clave,
    firma,
    claveLimite,
    paginaAcceso,
    registrarSesion: (huella, caduca) => autoridad(espacio).registrarSesion(huella, caduca),
    sesionActiva: (huella) => autoridad(espacio).sesionActiva(huella),
    revocarSesion: (huella) => autoridad(espacio).revocarSesion(huella),
    sesionesDisponibles: () => autoridad(espacio).sesionesDisponibles(),
    consumirIntento: (huella) => {
      if (!espacio) {
        throw new Error('Falta la autoridad durable');
      }
      return new AlmacenRecorridoDurable(espacio).consumirIntentoRecorrido(huella);
    },
    delegar: (autenticada) => responderUnificado(autenticada, entorno),
  });
}

/**
 * Lo que una lectura obtiene sin sesión: robots.txt, la portada y lo que comparten la portada y el acceso; null si la
 * ruta no es ninguna de ellas.
 */
function respuestaPublica(peticion: Request, url: URL, variables: EntornoPrivado): Response | Promise<Response> | null {
  if (url.pathname === '/') {
    return new Response(peticion.method === 'HEAD' ? null : PORTADA_PUBLICA, {
      headers: cabecerasPagina(CSP_PORTADA),
    });
  }
  const activo = activoDeRuta(url.pathname);
  if (activo) {
    return responderActivoPublico(peticion, activo, variables.ASSETS);
  }
  return respuestaRobots(peticion, url);
}

function respuestaRobots(peticion: Request, url: URL): Response | null {
  if (url.pathname !== '/robots.txt') {
    return null;
  }
  return new Response(peticion.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
