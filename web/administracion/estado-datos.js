// Generado desde src/administracion/estado-datos.js; no editar esta copia.
/**
 * @typedef {'diaria' | 'mensual' | 'edición' | 'fija' | 'manual' | 'redactada'} PoliticaFuenteDatos
 * @typedef {'verde' | 'ámbar' | 'rojo'} VeredictoModuloDatos
 * @typedef {Readonly<{id:string,politica:PoliticaFuenteDatos,fecha:string|null,plazoDias:number|null}>} FuenteEstadoDatos
 * @typedef {Readonly<{fecha:string,huella:string}>} VersionBuenaDatos
 * @typedef {'almacen-ausente'|'almacen-ilegible'|'almacen-vacio'} MotivoAlmacenDatos
 * @typedef {Readonly<{id:string,ultimoIntento:string|null,veredicto:VeredictoModuloDatos|null,ultimaVersionBuena:VersionBuenaDatos|null,fallos:number,proximoReintento:string|null,motivoAlmacen?:MotivoAlmacenDatos}>} ModuloEstadoDatos
 * @typedef {'en-curso'|'interrumpido'|'comprobada'|'completa'|'parcial'|'fallo'|'local'} ResultadoOperacionDatos
 * @typedef {Readonly<{ciclo:string,inicioEn:string,finEn:string|null,resultado:ResultadoOperacionDatos,remoto:boolean,ultimoIntentoRemotoEn:string|null,huellaEvidencia:string|null}>} OperacionFuenteDatos
 * @typedef {import('./edicion-nueva-datos.js').EdicionNuevaDatos} EdicionNuevaDatos
 * @typedef {import('./edicion-nueva-datos.js').AvisoEdicionDatos} AvisoEdicionDatos
 * @typedef {Readonly<FuenteEstadoDatos & {ultimaOperacion:OperacionFuenteDatos|null,edicionNueva?:EdicionNuevaDatos,avisoEdicion?:AvisoEdicionDatos,gruposEnSuGranGrupo?:number,gruposSinClase?:number}>} FuenteEstadoDatosV2
 * @typedef {'copia-local'|'edicion-conocida'|'catalogo-actual'|'serie-abierta'|'descubre-edicion'|'contenido-actual-acotado'|'recurso-actual-sin-edicion'|'entradas-admitidas'|'productor-externo'} AlcanceComprobacionDatos
 * @typedef {'revision'|'descargar'|'integridad'|'recomponer'} OperacionComprobacionDatos
 * @typedef {Readonly<{fecha:string,ciclo:string,huellaEvidencia:string}>} UltimaComprobacionDatos
 * @typedef {Readonly<{id:string,fuente:string|null,alcance:AlcanceComprobacionDatos,operacion:OperacionComprobacionDatos,intervaloDias:number|null,revisionNecesaria:boolean,ultimaComprobacion:UltimaComprobacionDatos|null}>} ConjuntoComprobacionDatos
 * @typedef {Readonly<{registradoEn:string|null,reconstruccionPendiente:boolean,conjuntos:readonly ConjuntoComprobacionDatos[]}>} ComprobacionesDatos
 * @typedef {Readonly<{observadoEn:string,modulos:readonly ModuloEstadoDatos[],formacionAbiertaCaduca:string|null}>} EstadoDatosComun
 * @typedef {Readonly<EstadoDatosComun & {version:1,fuentes:readonly FuenteEstadoDatos[]}>} EstadoDatosPanelV1
 * @typedef {Readonly<EstadoDatosComun & {version:2,fuentes:readonly FuenteEstadoDatosV2[],comprobaciones:ComprobacionesDatos}>} EstadoDatosPanelV2
 * @typedef {Readonly<{conjunto:string,operacion:OperacionFuenteDatos}>} IncidenciaRemotaDatos
 * @typedef {Readonly<{unidadesFallidas:number,unidadesEsperadas:number}>} ConsultaParcialDatos
 * @typedef {'indice-caido'|'fichas-fallidas'|'tope-de-consultas'|'plazo-de-la-descarga'|'censo-digitalizate-sin-lista'|'censo-digitalizate-fichas-fallidas'|'censo-digitalizate-recuento-descuadrado'|'censo-digitalizate-forma-inesperada'|'censo-digitalizate-tope-de-proveedores'|'censo-digitalizate-contradice-al-indice'|'censo-digitalizate-sin-lista-de-baja'|'fundae-conjunto-sin-aplicar'|'censo-ia-parcial'|'censo-del-canal-sin-admitir-completo'|'pagina-de-ambitos-caida'|'portlet-no-encontrado'|'ambito-ia-sin-nombre'|'ambito-ia-cambiado'|'portlet-cambiado'|'codigo-de-inscripcion-desconocido'|'texto-de-plazas-desconocido'|'dominio-con-limite'|'indice-de-hp-life-sin-completar'|'ficha-integra-fuera-del-listado'|'ausente-del-listado-sin-confirmar'|'gratuidad-de-hp-life-sin-comprobar'|'curso-fuera-del-catalogo-con-su-pagina'|'curso-fuera-del-catalogo-sin-confirmar'|'estado-desconocido-en-el-catalogo'} MotivoSalidaParcialDatos
 * @typedef {Readonly<{motivos:readonly MotivoSalidaParcialDatos[],descartadas:number,aRevisar:number}>} SalidaParcialDatos
 * @typedef {'censo-con-copias-fijadas'|'indices-sin-censo'} MotivoCoberturaLimitadaDatos
 * @typedef {Readonly<{comprobados:number,ocultos:number,sinComprobar:number}>} EnlacesDatos
 * @typedef {Readonly<{fuente:string,ultimoIntento:OperacionFuenteDatos|null,incidenciasPendientes:readonly IncidenciaRemotaDatos[],fallosSeguidos?:number,proximaConsultaEn?:string|null,consultaParcial?:ConsultaParcialDatos|null,coberturaLimitada?:MotivoCoberturaLimitadaDatos|null,salidaParcial?:SalidaParcialDatos,enlaces?:EnlacesDatos,retirada?:import('./retirada-datos.js').RetiradaDatos,retiradaAmplia?:import('./retirada-datos.js').RetiradaAmpliaDatos}>} SeguimientoRemotoDatos
 * @typedef {Readonly<EstadoDatosComun & {version:3,fuentes:readonly FuenteEstadoDatosV2[],comprobaciones:ComprobacionesDatos,seguimientoRemoto:readonly SeguimientoRemotoDatos[]}>} EstadoDatosPanelV3
 * @typedef {'cursos'|'ocupaciones'|'ia_y_trabajo'|'mercado'|'derechos'|'biblioteca'|'comun'|'derivados'} TemaFuenteDatos
 * @typedef {'operativa'|'candidata'|'lectura-candidata'|'productor-externo'|'productor-local'} ModalidadFuenteDatos
 * @typedef {Readonly<{id:string,nombre:string,tema:TemaFuenteDatos,modalidad:ModalidadFuenteDatos}>} IdentidadFuenteDatos
 * @typedef {Readonly<EstadoDatosComun & {version:4,fuentes:readonly FuenteEstadoDatosV2[],comprobaciones:ComprobacionesDatos,seguimientoRemoto:readonly SeguimientoRemotoDatos[]|null,catalogoFuentes:readonly IdentidadFuenteDatos[]}>} EstadoDatosPanelV4
 * @typedef {Readonly<Omit<EstadoDatosPanelV4,'version'|'formacionAbiertaCaduca'> & {version:5,formacionAbiertaRevisionPendiente:string|null}>} EstadoDatosPanelV5
 * @typedef {import('./retenidos-datos.js').RetenidosDatos} RetenidosDatos
 * @typedef {Readonly<Omit<EstadoDatosPanelV5,'version'> & {version:6,retenidos:RetenidosDatos}>} EstadoDatosPanelV6
 * @typedef {EstadoDatosPanelV1|EstadoDatosPanelV2|EstadoDatosPanelV3|EstadoDatosPanelV4|EstadoDatosPanelV5|EstadoDatosPanelV6} EstadoDatosPanel
 * @typedef {(senal:AbortSignal)=>Promise<EstadoDatosPanel>} LectorEstadoDatosPanel
 */
import { clavesDeFuenteV2, conEdicionNueva, observadaAntesDe, sinEdicion } from './edicion-nueva-datos.js';

/** Proyección de mantenimiento para el panel: datos cerrados, sin rutas, motivos ni registros técnicos. */

import {
  claveInstante,
  entero,
  exigir,
  FIN_FECHA_ISO,
  fecha,
  huella,
  id,
  instante,
  instantePreciso,
  lista,
  objeto,
  opcional,
  unoDe,
} from './lectura-estricta.js';
import { leerRetenidos } from './retenidos-datos.js';
import { leerRetirada, leerRetiradaAmplia } from './retirada-datos.js';

/** @type {readonly PoliticaFuenteDatos[]} */
const POLITICAS = ['diaria', 'mensual', 'edición', 'fija', 'manual', 'redactada'];
/** @type {readonly VeredictoModuloDatos[]} */
const VEREDICTOS = ['verde', 'ámbar', 'rojo'];
/** @type {readonly ResultadoOperacionDatos[]} */
const RESULTADOS_OPERACION = ['en-curso', 'interrumpido', 'comprobada', 'completa', 'parcial', 'fallo', 'local'];
/** @type {readonly MotivoCoberturaLimitadaDatos[]} */
const MOTIVOS_COBERTURA_LIMITADA = ['censo-con-copias-fijadas', 'indices-sin-censo'];
/** @type {readonly MotivoSalidaParcialDatos[]} */
export const MOTIVOS_SALIDA_PARCIAL = [
  'indice-caido',
  'fichas-fallidas',
  'tope-de-consultas',
  'plazo-de-la-descarga',
  'censo-digitalizate-sin-lista',
  'censo-digitalizate-fichas-fallidas',
  'censo-digitalizate-recuento-descuadrado',
  'censo-digitalizate-forma-inesperada',
  'censo-digitalizate-tope-de-proveedores',
  'censo-digitalizate-contradice-al-indice',
  'censo-digitalizate-sin-lista-de-baja',
  'fundae-conjunto-sin-aplicar',
  'censo-ia-parcial',
  'censo-del-canal-sin-admitir-completo',
  'pagina-de-ambitos-caida',
  'portlet-no-encontrado',
  'ambito-ia-sin-nombre',
  'ambito-ia-cambiado',
  'portlet-cambiado',
  'codigo-de-inscripcion-desconocido',
  'texto-de-plazas-desconocido',
  'dominio-con-limite',
  'indice-de-hp-life-sin-completar',
  'ficha-integra-fuera-del-listado',
  'ausente-del-listado-sin-confirmar',
  'gratuidad-de-hp-life-sin-comprobar',
  'curso-fuera-del-catalogo-con-su-pagina',
  'curso-fuera-del-catalogo-sin-confirmar',
  'estado-desconocido-en-el-catalogo',
];
/** @type {readonly MotivoAlmacenDatos[]} */
export const MOTIVOS_ALMACEN = ['almacen-ausente', 'almacen-ilegible', 'almacen-vacio'];
/** @type {readonly AlcanceComprobacionDatos[]} */
const ALCANCES = [
  'copia-local',
  'edicion-conocida',
  'catalogo-actual',
  'serie-abierta',
  'descubre-edicion',
  'contenido-actual-acotado',
  'recurso-actual-sin-edicion',
  'entradas-admitidas',
  'productor-externo',
];
/** @type {readonly OperacionComprobacionDatos[]} */
const OPERACIONES = ['revision', 'descargar', 'integridad', 'recomponer'];
const ALCANCES_CON_REVISION = new Set(['edicion-conocida', 'contenido-actual-acotado', 'recurso-actual-sin-edicion']);
const VERSION_SEGUIMIENTO = 3;
const VERSION_CATALOGO = 4;
// La v5 solo renombra `formacionAbiertaCaduca` (un aviso, nunca una caducidad); cada versión se lee con su nombre.
const VERSION_REVISION_PENDIENTE = 5;
// La v6 añade los cambios retenidos que esperan a una persona; los lee retenidos-datos.js.
const VERSION_RETENIDOS = 6;
const VERSIONES = [1, 2, VERSION_SEGUIMIENTO, VERSION_CATALOGO, VERSION_REVISION_PENDIENTE, VERSION_RETENIDOS];
/** @type {readonly TemaFuenteDatos[]} */
const TEMAS = ['cursos', 'ocupaciones', 'ia_y_trabajo', 'mercado', 'derechos', 'biblioteca', 'comun', 'derivados'];
/** @type {readonly ModalidadFuenteDatos[]} */
const MODALIDADES = ['operativa', 'candidata', 'lectura-candidata', 'productor-externo', 'productor-local'];
const MAX_NOMBRE_FUENTE = 240;
const PRIMER_CARACTER_VISIBLE = 32;
const BORRADO_ASCII = 127;
/** @param {unknown} entrada @returns {FuenteEstadoDatos} */
function fuente(entrada) {
  const valor = objeto(entrada, ['id', 'politica', 'fecha', 'plazoDias']);
  exigir(valor.id !== 'paquete');
  return Object.freeze({
    id: id(valor.id),
    politica: unoDe(valor.politica, POLITICAS),
    fecha: opcional(valor.fecha, fecha),
    plazoDias: opcional(valor.plazoDias, entero),
  });
}
/** @param {unknown} entrada @returns {VersionBuenaDatos} */
function versionBuena(entrada) {
  const valor = objeto(entrada, ['fecha', 'huella']);
  exigir(typeof valor.huella === 'string' && /^[0-9a-f]{64}$/.test(valor.huella));
  return Object.freeze({ fecha: instante(valor.fecha), huella: valor.huella });
}
const CAMPOS_MODULO = ['id', 'ultimoIntento', 'veredicto', 'ultimaVersionBuena', 'fallos', 'proximoReintento'];
/** Un paquete en ámbar o rojo puede traer el código cerrado del fallo de su almacén de Cursos; si no, forma anterior.
 * @param {unknown} entrada @returns {ModuloEstadoDatos} */
function modulo(entrada) {
  const conAlmacen = entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, 'motivoAlmacen');
  const valor = objeto(entrada, conAlmacen ? [...CAMPOS_MODULO, 'motivoAlmacen'] : CAMPOS_MODULO);
  const fila = {
    id: id(valor.id),
    ultimoIntento: opcional(valor.ultimoIntento, instante),
    veredicto: opcional(valor.veredicto, (dato) => unoDe(dato, VEREDICTOS)),
    ultimaVersionBuena: opcional(valor.ultimaVersionBuena, versionBuena),
    fallos: entero(valor.fallos),
    proximoReintento: opcional(valor.proximoReintento, instante),
  };
  exigir(!conAlmacen || (fila.id === 'paquete' && (fila.veredicto === 'ámbar' || fila.veredicto === 'rojo')));
  const motivoAlmacen = conAlmacen ? unoDe(valor.motivoAlmacen, MOTIVOS_ALMACEN) : null;
  return Object.freeze(motivoAlmacen === null ? fila : { ...fila, motivoAlmacen });
}
/** @param {ModuloEstadoDatos} fila @param {string} observadoEn */
function comprobarModulo(fila, observadoEn) {
  if (fila.veredicto === null) {
    exigir(
      fila.ultimoIntento === null &&
        fila.ultimaVersionBuena === null &&
        fila.proximoReintento === null &&
        fila.fallos === 0,
    );
    return;
  }
  exigir(fila.ultimoIntento !== null && claveInstante(fila.ultimoIntento) <= claveInstante(observadoEn));
  if (fila.ultimaVersionBuena !== null) {
    exigir(claveInstante(fila.ultimaVersionBuena.fecha) <= claveInstante(fila.ultimoIntento));
  }
  if (fila.veredicto === 'verde') {
    exigir(fila.fallos === 0 && fila.proximoReintento === null);
  } else {
    exigir(
      fila.fallos > 0 &&
        fila.proximoReintento !== null &&
        claveInstante(fila.proximoReintento) > claveInstante(fila.ultimoIntento),
    );
  }
}

/** @param {unknown} entrada @returns {string} */
function ciclo(entrada) {
  exigir(
    typeof entrada === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entrada),
  );
  return entrada;
}
/** @param {unknown} entrada @returns {boolean} */
function booleano(entrada) {
  exigir(typeof entrada === 'boolean');
  return entrada;
}
/** @param {unknown} entrada @returns {OperacionFuenteDatos} */
function operacionFuente(entrada) {
  const valor = objeto(entrada, [
    'ciclo',
    'inicioEn',
    'finEn',
    'resultado',
    'remoto',
    'ultimoIntentoRemotoEn',
    'huellaEvidencia',
  ]);
  const fila = Object.freeze({
    ciclo: ciclo(valor.ciclo),
    inicioEn: instantePreciso(valor.inicioEn),
    finEn: opcional(valor.finEn, instantePreciso),
    resultado: unoDe(valor.resultado, RESULTADOS_OPERACION),
    remoto: booleano(valor.remoto),
    ultimoIntentoRemotoEn: opcional(valor.ultimoIntentoRemotoEn, instantePreciso),
    huellaEvidencia: opcional(valor.huellaEvidencia, huella),
  });
  exigir(
    fila.ultimoIntentoRemotoEn === null || claveInstante(fila.ultimoIntentoRemotoEn) <= claveInstante(fila.inicioEn),
  );
  exigir(
    !fila.remoto ||
      (fila.ultimoIntentoRemotoEn !== null &&
        claveInstante(fila.ultimoIntentoRemotoEn) === claveInstante(fila.inicioEn)),
  );
  // Una consulta completa siempre es remota y conserva su evidencia, aunque no acredite conjuntos.
  exigir(fila.resultado !== 'completa' || (fila.remoto && fila.huellaEvidencia !== null));
  if (fila.resultado === 'en-curso') {
    exigir(fila.finEn === null && fila.huellaEvidencia === null);
  } else {
    exigir(fila.finEn !== null && claveInstante(fila.inicioEn) <= claveInstante(fila.finEn));
  }
  return fila;
}
/** Una fuente por ediciones trae la edición nueva observada o su aviso solo si los hay; si no, su forma anterior.
 * @param {unknown} entrada @returns {FuenteEstadoDatosV2} */
function fuenteV2(entrada) {
  const { ultimaOperacion, ...resto } = objeto(entrada, clavesDeFuenteV2(entrada));
  const fila = conEdicionNueva(fuente(sinEdicion(resto)), resto);
  return Object.freeze({ ...fila, ultimaOperacion: opcional(ultimaOperacion, operacionFuente) });
}
/** @param {unknown} entrada @returns {UltimaComprobacionDatos} */
function ultimaComprobacion(entrada) {
  const valor = objeto(entrada, ['fecha', 'ciclo', 'huellaEvidencia']);
  return Object.freeze({
    fecha: instantePreciso(valor.fecha),
    ciclo: ciclo(valor.ciclo),
    huellaEvidencia: huella(valor.huellaEvidencia),
  });
}
/** @param {unknown} entrada @returns {ConjuntoComprobacionDatos} */
function conjunto(entrada) {
  const valor = objeto(entrada, [
    'id',
    'fuente',
    'alcance',
    'operacion',
    'intervaloDias',
    'revisionNecesaria',
    'ultimaComprobacion',
  ]);
  exigir(typeof valor.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(valor.id));
  const fila = Object.freeze({
    id: valor.id,
    fuente: opcional(valor.fuente, id),
    alcance: unoDe(valor.alcance, ALCANCES),
    operacion: unoDe(valor.operacion, OPERACIONES),
    intervaloDias: opcional(valor.intervaloDias, entero),
    revisionNecesaria: booleano(valor.revisionNecesaria),
    ultimaComprobacion: opcional(valor.ultimaComprobacion, ultimaComprobacion),
  });
  exigir(
    fila.operacion === 'descargar'
      ? fila.intervaloDias !== null && fila.intervaloDias > 0
      : fila.intervaloDias === null,
  );
  exigir(
    fila.revisionNecesaria ===
      (fila.operacion === 'revision' || (fila.operacion === 'descargar' && ALCANCES_CON_REVISION.has(fila.alcance))),
  );
  exigir(
    fila.fuente !== null ||
      (fila.operacion === 'revision' && fila.alcance === 'productor-externo' && fila.ultimaComprobacion === null),
  );
  exigir(fila.fuente === null || fila.alcance !== 'productor-externo');
  exigir(fila.ultimaComprobacion === null || fila.operacion === 'descargar');
  return fila;
}
/** @param {unknown} entrada @returns {ComprobacionesDatos} */
function comprobaciones(entrada) {
  const valor = objeto(entrada, ['registradoEn', 'reconstruccionPendiente', 'conjuntos']);
  const conjuntos = lista(valor.conjuntos).map(conjunto);
  exigir(new Set(conjuntos.map((fila) => fila.id)).size === conjuntos.length);
  return Object.freeze({
    registradoEn: opcional(valor.registradoEn, instantePreciso),
    reconstruccionPendiente: booleano(valor.reconstruccionPendiente),
    conjuntos: Object.freeze(conjuntos),
  });
}
/** @param {UltimaComprobacionDatos} ultima @param {OperacionFuenteDatos|null} operacion @param {string|null} registrado @returns {boolean} */
function comprobarVinculo(ultima, operacion, registrado) {
  exigir(registrado !== null && operacion !== null && claveInstante(ultima.fecha) <= claveInstante(registrado));
  if (ultima.ciclo !== operacion.ciclo) {
    exigir(claveInstante(ultima.fecha) <= claveInstante(operacion.inicioEn));
    return false;
  }
  exigir(operacion.remoto && (operacion.resultado === 'comprobada' || operacion.resultado === 'parcial'));
  exigir(
    operacion.finEn !== null &&
      claveInstante(ultima.fecha) === claveInstante(operacion.finEn) &&
      ultima.huellaEvidencia === operacion.huellaEvidencia,
  );
  return true;
}
/** @param {FuenteEstadoDatosV2} fila @param {string|null} registrado @param {ReadonlySet<string>} vinculadas */
function comprobarOperacionRegistrada(fila, registrado, vinculadas) {
  const operacion = fila.ultimaOperacion;
  if (operacion === null) {
    return;
  }
  exigir(registrado !== null && claveInstante(operacion.inicioEn) <= claveInstante(registrado));
  exigir(operacion.finEn === null || claveInstante(operacion.finEn) <= claveInstante(registrado));
  if (operacion.resultado === 'comprobada') {
    exigir(operacion.remoto && operacion.huellaEvidencia !== null && vinculadas.has(fila.id));
  }
}
/** La evidencia se correlaciona por fuente/ciclo/fecha/huella; la reconstrucción del módulo no la concede. */
/** @param {readonly FuenteEstadoDatosV2[]} fuentes @param {ComprobacionesDatos} registro @param {string} observadoEn */
function comprobarEvidencia(fuentes, registro, observadoEn) {
  const porFuente = new Map(fuentes.map((fila) => [fila.id, fila]));
  const representadas = new Set();
  const vinculadas = new Set();
  const registrado = registro.registradoEn;
  exigir(registrado === null || claveInstante(registrado) <= claveInstante(observadoEn));
  if (registrado === null) {
    exigir(!registro.reconstruccionPendiente && fuentes.every((fila) => fila.ultimaOperacion === null));
  }
  for (const fila of registro.conjuntos) {
    if (fila.fuente === null) {
      continue;
    }
    const fuente = porFuente.get(fila.fuente);
    exigir(fuente !== undefined);
    representadas.add(fila.fuente);
    if (
      fila.ultimaComprobacion !== null &&
      comprobarVinculo(fila.ultimaComprobacion, fuente.ultimaOperacion, registrado)
    ) {
      vinculadas.add(fila.fuente);
    }
  }
  exigir(fuentes.every((fila) => representadas.has(fila.id)));
  for (const fila of fuentes) {
    comprobarOperacionRegistrada(fila, registrado, vinculadas);
  }
}
/** @param {readonly FuenteEstadoDatos[]} fuentes @param {readonly ModuloEstadoDatos[]} modulos @param {string} observadoEn */
function comprobarCorrespondencia(fuentes, modulos, observadoEn) {
  for (const fila of modulos) {
    comprobarModulo(fila, observadoEn);
  }
  const idsFuentes = new Set(fuentes.map((fila) => fila.id));
  const idsModulos = new Set(modulos.map((fila) => fila.id));
  exigir(idsFuentes.size === fuentes.length && idsModulos.size === modulos.length);
  exigir(
    idsModulos.size === idsFuentes.size + 1 &&
      idsModulos.has('paquete') &&
      fuentes.every((fila) => idsModulos.has(fila.id) && observadaAntesDe(fila, observadoEn)),
  );
}

/** @param {unknown} entrada @returns {IncidenciaRemotaDatos} */
function incidenciaRemota(entrada) {
  const valor = objeto(entrada, ['conjunto', 'operacion']);
  exigir(typeof valor.conjunto === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(valor.conjunto));
  const operacion = operacionFuente(valor.operacion);
  exigir(operacion.remoto && ['fallo', 'parcial', 'interrumpido'].includes(operacion.resultado));
  return Object.freeze({ conjunto: valor.conjunto, operacion });
}
const CAMPOS_SEGUIMIENTO_ANTERIOR = Object.freeze(['fuente', 'ultimoIntento', 'incidenciasPendientes']);
const CAMPOS_SEGUIMIENTO_AVISOS = Object.freeze([
  ...CAMPOS_SEGUIMIENTO_ANTERIOR,
  'fallosSeguidos',
  'proximaConsultaEn',
  'consultaParcial',
]);
const CAMPOS_SEGUIMIENTO = Object.freeze([...CAMPOS_SEGUIMIENTO_AVISOS, 'coberturaLimitada']);
/** @param {unknown} entrada @returns {ConsultaParcialDatos} */
function consultaParcial(entrada) {
  const valor = objeto(entrada, ['unidadesFallidas', 'unidadesEsperadas']);
  const fallidas = entero(valor.unidadesFallidas);
  const esperadas = entero(valor.unidadesEsperadas);
  exigir(fallidas > 0 && fallidas <= esperadas);
  return Object.freeze({ unidadesFallidas: fallidas, unidadesEsperadas: esperadas });
}
/** Avisos de consulta: cuadran con el último intento y una consulta parcial nunca figura como completa.
 * @param {Record<string,unknown>} valor @param {OperacionFuenteDatos|null} ultimo
 */
function avisosDeConsulta(valor, ultimo) {
  const fallos = entero(valor.fallosSeguidos);
  const proxima = opcional(valor.proximaConsultaEn, fecha);
  const parcial = opcional(valor.consultaParcial, consultaParcial);
  const resultado = ultimo?.resultado ?? null;
  exigir(![null, 'comprobada', 'completa', 'parcial'].includes(resultado) || fallos === 0);
  exigir(!(resultado === 'fallo' || resultado === 'interrumpido') || fallos >= 1);
  exigir(ultimo !== null || proxima === null);
  exigir(proxima === null || (ultimo !== null && proxima > ultimo.inicioEn.slice(0, FIN_FECHA_ISO)));
  exigir(parcial === null || (resultado !== 'comprobada' && resultado !== 'completa'));
  return { fallosSeguidos: fallos, proximaConsultaEn: proxima, consultaParcial: parcial };
}
/** La cobertura limitada es una propiedad de la fuente: solo así queda «completa» y nunca «comprobada».
 * @param {Record<string,unknown>} valor @param {OperacionFuenteDatos|null} ultimo
 */
function coberturaDeLaFuente(valor, ultimo) {
  const motivo = opcional(valor.coberturaLimitada, (m) => unoDe(m, MOTIVOS_COBERTURA_LIMITADA));
  exigir(ultimo?.resultado !== 'completa' || motivo !== null);
  exigir(ultimo?.resultado !== 'comprobada' || motivo === null);
  return { coberturaLimitada: motivo };
}
/** Lo que la salida publicada no recoge: solo viaja con valor, como `motivoAlmacen`.
 * @param {unknown} entrada @returns {SalidaParcialDatos}
 */
function salidaParcial(entrada) {
  const valor = objeto(entrada, ['motivos', 'descartadas', 'aRevisar']);
  const motivos = lista(valor.motivos, true).map((m) => unoDe(m, MOTIVOS_SALIDA_PARCIAL));
  exigir(new Set(motivos).size === motivos.length);
  const descartadas = entero(valor.descartadas);
  const aRevisar = entero(valor.aRevisar);
  exigir(motivos.length > 0 || descartadas > 0 || aRevisar > 0);
  return Object.freeze({ motivos: Object.freeze(motivos), descartadas, aRevisar });
}
/** Los enlaces de la formación que la comprobación dice haber comprobado, ocultado y dejado sin comprobar: solo viaja con valor.
 * @param {unknown} entrada @returns {EnlacesDatos}
 */
function enlaces(entrada) {
  const valor = objeto(entrada, ['comprobados', 'ocultos', 'sinComprobar']);
  const comprobados = entero(valor.comprobados);
  const ocultos = entero(valor.ocultos);
  const sinComprobar = entero(valor.sinComprobar);
  exigir(ocultos <= comprobados + sinComprobar);
  return Object.freeze({ comprobados, ocultos, sinComprobar });
}
/** Las claves del seguimiento que solo viajan con valor, como `motivoAlmacen`, y cómo se lee cada una.
 * @type {readonly (readonly [string, (dato: unknown) => object])[]} */
const OPCIONALES_SEGUIMIENTO = Object.freeze([
  ['salidaParcial', salidaParcial],
  ['enlaces', enlaces],
  ['retirada', leerRetirada],
  ['retiradaAmplia', leerRetiradaAmplia],
]);
/** Las observaciones guardadas antes de los avisos o de la cobertura conservan su forma cerrada anterior.
 * @param {unknown} entrada @returns {SeguimientoRemotoDatos}
 */
function seguimientoRemoto(entrada) {
  const presente = (/** @type {string} */ campo) =>
    entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, campo);
  const conAvisos = presente('fallosSeguidos');
  const conCobertura = presente('coberturaLimitada');
  let campos = conAvisos ? CAMPOS_SEGUIMIENTO_AVISOS : CAMPOS_SEGUIMIENTO_ANTERIOR;
  if (conCobertura) {
    campos = CAMPOS_SEGUIMIENTO;
  }
  const opcionales = OPCIONALES_SEGUIMIENTO.filter(([campo]) => presente(campo));
  const valor = objeto(entrada, [...campos, ...opcionales.map(([campo]) => campo)]);
  const ultimo = opcional(valor.ultimoIntento, operacionFuente);
  exigir(ultimo === null || ultimo.remoto);
  exigir(conCobertura || ultimo?.resultado !== 'completa');
  const pendientes = lista(valor.incidenciasPendientes, true).map(incidenciaRemota);
  exigir(new Set(pendientes.map((p) => p.conjunto)).size === pendientes.length);
  // Una consulta completa ya resolvió las incidencias anteriores de su fuente.
  exigir(ultimo?.resultado !== 'completa' || pendientes.length === 0);
  return Object.freeze({
    fuente: id(valor.fuente),
    ultimoIntento: ultimo,
    incidenciasPendientes: Object.freeze(pendientes),
    ...(conAvisos ? avisosDeConsulta(valor, ultimo) : {}),
    ...(conCobertura ? coberturaDeLaFuente(valor, ultimo) : {}),
    ...Object.fromEntries(opcionales.map(([campo, leer]) => [campo, leer(valor[campo])])),
  });
}
/** @param {SeguimientoRemotoDatos} fila @param {ComprobacionesDatos} registro */
function comprobarPendientesRemotos(fila, registro) {
  const ultimo = fila.ultimoIntento;
  for (const pendiente of fila.incidenciasPendientes) {
    const declarado = registro.conjuntos.find((c) => c.id === pendiente.conjunto);
    exigir(declarado !== undefined && declarado.fuente === fila.fuente && declarado.operacion === 'descargar');
    const op = pendiente.operacion;
    exigir(ultimo !== null && op.finEn !== null);
    exigir(claveInstante(op.finEn) <= claveInstante(ultimo.finEn ?? ultimo.inicioEn));
    const positiva = declarado.ultimaComprobacion;
    exigir(
      positiva === null || (positiva.ciclo !== op.ciclo && claveInstante(positiva.fecha) <= claveInstante(op.finEn)),
    );
  }
}
/** Contrasta cronología e identidad del último intento remoto frente a la operación actual. */
/** @param {OperacionFuenteDatos|null} ultimo @param {OperacionFuenteDatos|null} actual @param {string|null} registrado */
function comprobarUltimoRemoto(ultimo, actual, registrado) {
  if (actual?.remoto) {
    exigir(JSON.stringify(actual) === JSON.stringify(ultimo));
  }
  if (ultimo !== null) {
    exigir(actual !== null && actual.ultimoIntentoRemotoEn === ultimo.inicioEn);
    if (!actual.remoto) {
      exigir(ultimo.finEn !== null && claveInstante(ultimo.finEn) <= claveInstante(actual.inicioEn));
    }
    exigir(registrado !== null && claveInstante(ultimo.inicioEn) <= claveInstante(registrado));
    exigir(ultimo.finEn === null || claveInstante(ultimo.finEn) <= claveInstante(registrado));
  }
}
/** @param {readonly SeguimientoRemotoDatos[]} filas @param {readonly FuenteEstadoDatosV2[]} fuentes @param {ComprobacionesDatos} registro */
function comprobarSeguimientoRemoto(filas, fuentes, registro) {
  exigir(filas.length === fuentes.length && new Set(filas.map((f) => f.fuente)).size === filas.length);
  for (const fila of filas) {
    const fuente = fuentes.find((f) => f.id === fila.fuente);
    exigir(fuente !== undefined);
    comprobarUltimoRemoto(fila.ultimoIntento, fuente.ultimaOperacion, registro.registradoEn);
    comprobarPendientesRemotos(fila, registro);
  }
}

/** Lee el discriminante sin invocar getters y exige campos cerrados según su versión. */
/** @param {unknown} entrada @returns {{version:number,valor:Record<string,unknown>,revisionPendiente:unknown}} */
function entradaVersionada(entrada) {
  // El discriminante también se lee mediante descriptor: un getter nunca decide el contrato admitido.
  exigir(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'version');
  exigir(descriptor !== undefined && 'value' in descriptor && VERSIONES.includes(descriptor.value));
  const version = descriptor.value;
  const revision =
    version >= VERSION_REVISION_PENDIENTE ? 'formacionAbiertaRevisionPendiente' : 'formacionAbiertaCaduca';
  const claves = ['version', 'observadoEn', 'fuentes', 'modulos', revision];
  if (version !== 1) {
    claves.push('comprobaciones');
  }
  if (version >= VERSION_SEGUIMIENTO) {
    claves.push('seguimientoRemoto');
  }
  if (version >= VERSION_CATALOGO) {
    claves.push('catalogoFuentes');
  }
  if (version >= VERSION_RETENIDOS) {
    claves.push('retenidos');
  }
  const valor = objeto(entrada, claves);
  return { version, valor, revisionPendiente: valor[revision] };
}

/** @param {unknown} entrada @returns {IdentidadFuenteDatos} */
function identidadFuente(entrada) {
  const valor = objeto(entrada, ['id', 'nombre', 'tema', 'modalidad']);
  exigir(typeof valor.nombre === 'string' && valor.nombre.length > 0 && [...valor.nombre].length <= MAX_NOMBRE_FUENTE);
  exigir(
    valor.nombre === valor.nombre.trim() &&
      [...valor.nombre].every((c) => c.charCodeAt(0) >= PRIMER_CARACTER_VISIBLE && c.charCodeAt(0) !== BORRADO_ASCII),
  );
  return Object.freeze({
    id: id(valor.id),
    nombre: valor.nombre,
    tema: unoDe(valor.tema, TEMAS),
    modalidad: unoDe(valor.modalidad, MODALIDADES),
  });
}
/** @param {unknown} entrada @param {readonly FuenteEstadoDatosV2[]} fuentes @returns {readonly IdentidadFuenteDatos[]} */
function catalogoFuentes(entrada, fuentes) {
  const filas = lista(entrada).map(identidadFuente);
  exigir(new Set(filas.map((f) => f.id)).size === filas.length);
  const activas = filas.filter((f) => f.modalidad === 'operativa');
  exigir(activas.length === fuentes.length && fuentes.every((f) => activas.some((a) => a.id === f.id)));
  return Object.freeze(filas);
}

/** @param {Record<string,unknown>} valor @param {EstadoDatosComun} comun @param {readonly FuenteEstadoDatosV2[]} fuentesV2 @param {ComprobacionesDatos} registro @returns {EstadoDatosPanelV4|EstadoDatosPanelV5|EstadoDatosPanelV6} */
function estadoConCatalogo(valor, comun, fuentesV2, registro) {
  const seguimiento =
    valor.seguimientoRemoto === null ? null : Object.freeze(lista(valor.seguimientoRemoto).map(seguimientoRemoto));
  if (seguimiento !== null) {
    comprobarSeguimientoRemoto(seguimiento, fuentesV2, registro);
  }
  const cola = {
    fuentes: fuentesV2,
    comprobaciones: registro,
    seguimientoRemoto: seguimiento,
    catalogoFuentes: catalogoFuentes(valor.catalogoFuentes, fuentesV2),
  };
  if (valor.version === VERSION_CATALOGO) {
    return Object.freeze({ version: 4, ...comun, ...cola });
  }
  const { formacionAbiertaCaduca, ...resto } = comun;
  const conRevision = { ...resto, formacionAbiertaRevisionPendiente: formacionAbiertaCaduca, ...cola };
  if (valor.version === VERSION_REVISION_PENDIENTE) {
    return Object.freeze({ version: 5, ...conRevision });
  }
  return Object.freeze({ version: 6, ...conRevision, retenidos: leerRetenidos(valor.retenidos) });
}

/** Devuelve una copia completa e inmutable; no corrige fechas, listas incompletas ni propiedades desconocidas. */
/** @param {unknown} entrada @returns {EstadoDatosPanel} */
export function leerEstadoDatosPanel(entrada) {
  const { version, valor, revisionPendiente } = entradaVersionada(entrada);
  const conComprobaciones = version !== 1;
  const observadoEn = version === 1 ? instante(valor.observadoEn) : instantePreciso(valor.observadoEn);
  const fuentesV2 = conComprobaciones ? Object.freeze(lista(valor.fuentes).map(fuenteV2)) : null;
  const fuentes = fuentesV2 ?? Object.freeze(lista(valor.fuentes).map(fuente));
  const modulos = lista(valor.modulos).map(modulo);
  comprobarCorrespondencia(fuentes, modulos, observadoEn);
  const comun = {
    observadoEn,
    modulos: Object.freeze(modulos),
    formacionAbiertaCaduca: opcional(revisionPendiente, fecha),
  };
  if (version === 1) {
    return Object.freeze({
      version: 1,
      observadoEn,
      fuentes: Object.freeze(fuentes),
      modulos: comun.modulos,
      formacionAbiertaCaduca: comun.formacionAbiertaCaduca,
    });
  }
  exigir(fuentesV2 !== null);
  const registro = comprobaciones(valor.comprobaciones);
  comprobarEvidencia(fuentesV2, registro, observadoEn);
  if (version >= VERSION_CATALOGO) {
    return estadoConCatalogo(valor, comun, fuentesV2, registro);
  }
  if (version === VERSION_SEGUIMIENTO) {
    const seguimiento = Object.freeze(lista(valor.seguimientoRemoto).map(seguimientoRemoto));
    comprobarSeguimientoRemoto(seguimiento, fuentesV2, registro);
    return Object.freeze({
      version: 3,
      ...comun,
      fuentes: fuentesV2,
      comprobaciones: registro,
      seguimientoRemoto: seguimiento,
    });
  }
  return Object.freeze({
    version: 2,
    observadoEn,
    fuentes: fuentesV2,
    modulos: comun.modulos,
    formacionAbiertaCaduca: comun.formacionAbiertaCaduca,
    comprobaciones: registro,
  });
}
