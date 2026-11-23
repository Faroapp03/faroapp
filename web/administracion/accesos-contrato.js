// Registro cerrado de operaciones y recuentos: no acepta argumentos, correo ni credenciales.
import { respuestaAdministrativaInvalida as invalido, objetoAdministrativo as objeto } from './contrato-comun.js';
import { leerSesionActiva } from './contratos.js';

/** @typedef {import('../../src/administracion/accesos.ts').PaginaAccesos} PaginaAccesos */
/** @typedef {import('../../src/administracion/accesos.ts').AccesoApi} AccesoApi */
/** @typedef {import('../../src/administracion/accesos.ts').AccesoMcp} AccesoMcp */
/** @typedef {import('../../src/administracion/accesos.ts').AccesoA2a} AccesoA2a */
const POR_PAGINA = 50,
  MAX_REGISTROS = 10_000,
  MAX_NOMBRE = 120,
  MAX_CLIENTE = 64;
const HTTP_MIN = 100,
  HTTP_MAX = 599;
const ID = /^inst-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** @param {unknown} dato @param {number} [minimo] @returns {number} */
function contador(dato, minimo = 0) {
  if (typeof dato !== 'number' || !Number.isSafeInteger(dato) || dato < minimo) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {number} */
export function leerNumeroPagina(dato) {
  const pagina = contador(dato, 1);
  if (pagina > MAX_REGISTROS) {
    return invalido();
  }
  return pagina;
}
/** @param {unknown} dato @returns {string} */
function fecha(dato) {
  if (
    typeof dato !== 'string' ||
    !Number.isFinite(Date.parse(dato)) ||
    Date.parse(dato) < 0 ||
    new Date(dato).toISOString() !== dato
  ) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {string} */
function dia(dato) {
  if (typeof dato !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(dato)) {
    return invalido();
  }
  fecha(`${dato}T00:00:00.000Z`);
  return dato;
}
/** El identificador técnico es texto, no se interpreta ni se usa para ejecutar una operación.
 * @param {unknown} dato @returns {string} */
function operacion(dato) {
  if (typeof dato !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(dato)) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {string} */
function nombre(dato) {
  if (typeof dato !== 'string' || !dato || dato.length > MAX_NOMBRE || dato.trim() !== dato || /[\p{C}]/u.test(dato)) {
    return invalido();
  }
  return dato;
}
/** @param {unknown} dato @returns {AccesoApi} */
function api(dato) {
  const o = objeto(dato, ['fecha', 'institucionId', 'institucion', 'consulta', 'estadoHttp']);
  if (
    typeof o.institucionId !== 'string' ||
    !ID.test(o.institucionId) ||
    typeof o.estadoHttp !== 'number' ||
    !Number.isInteger(o.estadoHttp) ||
    o.estadoHttp < HTTP_MIN ||
    o.estadoHttp > HTTP_MAX
  ) {
    return invalido();
  }
  return {
    fecha: fecha(o.fecha),
    institucionId: o.institucionId,
    institucion: nombre(o.institucion),
    consulta: operacion(o.consulta),
    estadoHttp: o.estadoHttp,
  };
}
/** @param {Record<string,unknown>} o @returns {{clienteDeclarado:string|null,categoriaCliente:AccesoMcp['categoriaCliente']}} */
function cliente(o) {
  if (o.categoriaCliente !== 'declarado') {
    if (
      (o.categoriaCliente !== 'no_declarado' && o.categoriaCliente !== 'omitido' && o.categoriaCliente !== 'otros') ||
      o.clienteDeclarado !== null
    ) {
      return invalido();
    }
    return {
      clienteDeclarado: null,
      categoriaCliente: o.categoriaCliente,
    };
  }
  const dato = o.clienteDeclarado;
  if (
    typeof dato !== 'string' ||
    !dato ||
    dato.length > MAX_CLIENTE ||
    dato.trim() !== dato ||
    !/^[\p{L}\p{N} ._()+-]+$/u.test(dato) ||
    /[A-Za-z0-9_-]{24,}|\d{6,}/u.test(dato)
  ) {
    return invalido();
  }
  return { clienteDeclarado: dato, categoriaCliente: 'declarado' };
}
/** @param {unknown} dato @returns {AccesoMcp} */
function mcp(dato) {
  const o = objeto(dato, ['dia', 'herramienta', 'clienteDeclarado', 'categoriaCliente', 'consultas']);
  return { dia: dia(o.dia), herramienta: operacion(o.herramienta), ...cliente(o), consultas: contador(o.consultas, 1) };
}
/** @param {unknown} dato @returns {AccesoA2a} */
function a2a(dato) {
  const o = objeto(dato, ['dia', 'habilidad', 'consultas']);
  return { dia: dia(o.dia), habilidad: operacion(o.habilidad), consultas: contador(o.consultas, 1) };
}
/** @param {unknown} dato @returns {PaginaAccesos} */
export function leerPaginaAccesos(dato) {
  const o = objeto(dato, ['version', 'pagina', 'total', 'porPagina', 'api', 'mcp', 'a2a']);
  if (
    o.version !== 1 ||
    o.porPagina !== POR_PAGINA ||
    !Array.isArray(o.api) ||
    !Array.isArray(o.mcp) ||
    !Array.isArray(o.a2a)
  ) {
    return invalido();
  }
  const pagina = leerNumeroPagina(o.pagina),
    total = contador(o.total);
  if (total > MAX_REGISTROS) {
    return invalido();
  }
  const esperada = Math.min(POR_PAGINA, Math.max(0, total - (pagina - 1) * POR_PAGINA));
  if (o.api.length + o.mcp.length + o.a2a.length !== esperada) {
    return invalido();
  }
  return {
    version: 1,
    pagina,
    total,
    porPagina: POR_PAGINA,
    api: o.api.map(api),
    mcp: o.mcp.map(mcp),
    a2a: o.a2a.map(a2a),
  };
}
/** @param {unknown} dato */
export function leerLecturaAccesos(dato) {
  const o = objeto(dato, ['estado', 'sesion', 'accesos']);
  if (o.estado !== 'activa') {
    return invalido();
  }
  return { sesion: leerSesionActiva(o.sesion), accesos: leerPaginaAccesos(o.accesos) };
}
