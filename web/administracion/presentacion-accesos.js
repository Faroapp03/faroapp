import { crear } from '../scripts/dom.js';
import { consultaLegible, textoHumano as humano } from './textos-accesos-humanos.js';

const HTTP = {
  minimoBien: 200,
  maximoBien: 299,
  invalida: 400,
  noAutorizada: 401,
  prohibida: 403,
  noEncontrada: 404,
  limite: 429,
  minimoServidor: 500,
  maximoServidor: 599,
};
/** @param {number} codigo */
export function resultadoPresentado(codigo) {
  if (codigo >= HTTP.minimoBien && codigo <= HTTP.maximoBien) {
    return { nombre: humano('aceptada'), ayuda: humano('aceptadaAyuda'), tono: 'bien' };
  }
  if (codigo === HTTP.limite) {
    return { nombre: humano('limitada'), ayuda: humano('limitadaAyuda'), tono: 'pendiente' };
  }
  if (codigo === HTTP.noAutorizada || codigo === HTTP.prohibida) {
    return { nombre: humano('sinPermiso'), ayuda: humano('sinPermisoAyuda'), tono: 'pendiente' };
  }
  if (codigo >= HTTP.minimoServidor && codigo <= HTTP.maximoServidor) {
    return { nombre: humano('falloServicio'), ayuda: humano('falloServicioAyuda'), tono: 'pendiente' };
  }
  if (codigo === HTTP.invalida) {
    return { nombre: humano('invalida'), ayuda: humano('invalidaAyuda'), tono: 'pendiente' };
  }
  if (codigo === HTTP.noEncontrada) {
    return { nombre: humano('noEncontrada'), ayuda: humano('noEncontradaAyuda'), tono: 'neutro' };
  }
  return { nombre: humano('revisarRespuesta'), ayuda: humano('revisarRespuestaAyuda'), tono: 'neutro' };
}
/** @param {string} nombre */
export function consultaVisible(nombre) {
  return crear('span', { className: 'panel-humano-consulta', textContent: `${consultaLegible(nombre)} (${nombre})` });
}
/** @param {number} codigo */
export function resultadoVisible(codigo) {
  const resultado = resultadoPresentado(codigo);
  const bloque = crear(
    'div',
    { className: 'panel-humano-resultado' },
    crear('span', {
      className: `panel-humano-estado panel-humano-${resultado.tono}`,
      textContent: `${resultado.nombre} (${codigo})`,
    }),
  );
  if (codigo === HTTP.limite) {
    bloque.append(crear('p', { className: 'panel-humano-resultado-ayuda', textContent: resultado.ayuda }));
  }
  return bloque;
}
