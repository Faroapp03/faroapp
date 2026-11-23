// Los tipos de la política que la construcción sirve en memoria (herramientas/web/servicio/politica-del-servicio.ts),
// tomados de sus fuentes únicas: no hay copia de la política en src/service-worker/. Las páginas de estado, en
// castellano y en catalán, se generan desde los diccionarios (paginasDelServicio).

export declare const CSP_DE_LAS_PAGINAS: string;
export declare const PAGINAS_DEL_SERVICIO: Readonly<
  Record<'sin-conexion' | 'no-comprobada' | 'retirada' | 'otra-version' | 'acceso-sin-conexion', string>
>;

export { consultarAutoridadSecciones } from '../../web/scripts/secciones-publicas.js';
export { paginaDeLaRuta, seccionDeLaRuta } from '../administracion/secciones-web.js';
export {
  claveDeCopia,
  esDeLaWeb,
  esNavegacionRecorrido,
  rutaEsEntradaRecorrido,
  rutaFueraDeLaCopia,
} from '../plataforma/politica-cache-web.ts';
