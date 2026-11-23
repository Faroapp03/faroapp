import { ESTADOS_SIN_SESION, modoDeLaInstalacion, pasaAPrivada, revisarSiVuelveAPublica } from './modo.js';
import { HTTP_SECCIONES, paginaDeEstado } from './secciones.js';

/** Control de navegación: en instalaciones privadas la autoridad se comprueba siempre por red. */
Object.assign(globalThis, {
  /**
   * @param {FetchEvent} evento
   * @param {{clave: string, seccion: string | undefined, url: URL, copia: Promise<Cache>,
   * seccionada: (clave: string, seccion: any, navegacion: boolean) => Promise<Response>,
   * publica: (evento: FetchEvent, clave: string, navegacion: boolean) => Promise<Response>}} opciones
   * @returns {Promise<Response>}
   */
  async navegarSegunPortal(evento, opciones) {
    const { clave, seccion, url, seccionada, publica } = opciones;
    const copia = await opciones.copia;
    // Una instalación pública consulta antes la sonda (modo.js): si ya es privada, no se sirve la copia.
    if ((await modoDeLaInstalacion(copia)) !== 'publica' || (await pasaAPrivada(evento, copia))) {
      try {
        const respuesta = await fetch(evento.request);
        revisarSiVuelveAPublica(evento, copia, respuesta);
        return respuesta;
      } catch {
        return paginaDeEstado(HTTP_SECCIONES.noDisponible, 'acceso-sin-conexion');
      }
    }
    if (seccion) {
      return seccionada(clave, seccion, true);
    }
    if (url.searchParams.has('acceso')) {
      try {
        const respuesta = await fetch(evento.request);
        if (respuesta.type === 'opaqueredirect' || ESTADOS_SIN_SESION.includes(respuesta.status)) {
          return respuesta;
        }
      } catch {
        // La instalación pública conserva su copia sin conexión.
      }
    }
    return publica(evento, clave, true);
  },
});
