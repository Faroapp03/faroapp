import { leerPaginaCatalogoPrivado } from './catalogo-privado.js';
import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';

/** @typedef {ReturnType<typeof leerLecturaOcultas>} LecturaOcultas */
/** @param {unknown} valor @returns {string|null} */
function fecha(valor) {
  if (valor === null) {
    return null;
  }
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(valor) || !Number.isFinite(Date.parse(valor))) {
    return respuestaAdministrativaInvalida();
  }
  return valor;
}
/** @param {unknown} entrada */
export function leerLecturaOcultas(entrada) {
  const o = objetoAdministrativo(entrada, [
    'estado',
    'sesion',
    'ofertasOcultas',
    'reciboTerminadoEn',
    'intentosFuentes',
  ]);
  if (o.estado !== 'activa' || !Array.isArray(o.intentosFuentes)) {
    return respuestaAdministrativaInvalida();
  }
  const ofertasOcultas = leerPaginaCatalogoPrivado(o.ofertasOcultas);
  const reciboTerminadoEn = fecha(o.reciboTerminadoEn);
  if (ofertasOcultas.catalogo !== null && reciboTerminadoEn === null) {
    return respuestaAdministrativaInvalida();
  }
  const fuentes = Object.freeze(
    o.intentosFuentes.map((v) => {
      const f = objetoAdministrativo(v, ['id', 'ultimoIntento', 'veredicto']);
      if (
        typeof f.id !== 'string' ||
        !/^[a-z0-9_-]{1,80}$/.test(f.id) ||
        ![null, 'verde', 'ámbar', 'rojo'].includes(/** @type {string|null} */ (f.veredicto))
      ) {
        return respuestaAdministrativaInvalida();
      }
      return Object.freeze({
        id: f.id,
        ultimoIntento: fecha(f.ultimoIntento),
        veredicto: /** @type {string|null} */ (f.veredicto),
      });
    }),
  );
  return Object.freeze({
    sesion: leerSesionActiva(o.sesion),
    ofertasOcultas,
    reciboTerminadoEn,
    intentosFuentes: fuentes,
  });
}
