/** Solo transporte al Worker del dispositivo; no envía preferencias a un servidor. */
import { esObjeto } from '../../json.js';
import { pedirAlMotorLocal } from '../../motor-local/cliente.js';
import { ERRORES_DEL_MOTOR, errorDeLaRespuesta, problemaDe } from '../api/errores.js';
import { antesDeQueNoCoincida } from '../instalacion-que-no-coincide.js';

// Las direcciones fijas pertenecen al motor compilado; los tipos proceden de sus fuentes.
const CALENDARIOS = new URL('../../../motor/src/catalogo-cursos/calendarios.js', import.meta.url).href;
const FORMA = new URL('../../../motor/src/catalogo-cursos/forma.js', import.meta.url).href;
const { esCalendario } = /** @type {typeof import('../../../../src/catalogo-cursos/calendarios.ts')} */ (
  await import(CALENDARIOS)
);
const { esFecha } = /** @type {typeof import('../../../../src/catalogo-cursos/forma.ts')} */ (await import(FORMA));

/** @import { PreferenciasSeleccion, SeleccionFormacion } from '../../../../src/seleccion-formacion/contrato.ts' */
const ETAPAS = new Set(['inicial', 'intermedio', 'avanzado']);
const CRITERIOS = new Set([
  'tarea_sencilla',
  'privacidad',
  'contraste',
  'tarea_real',
  'mejorar_instrucciones',
  'criterios_explicitos',
  'procedimiento_verificable',
  'fuentes_y_limites',
  'caso_complejo',
]);
const CAMPOS_HECHO_CON_VIGENCIA = 6;
const MAX_FILAS = 10_000;
const MAX_TEXTO = 2_048;
/** @param {unknown} v @returns {v is string} */
const cadena = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXTO;
/** @param {unknown} v @param {(x: unknown) => boolean} admite */
const lista = (v, admite) => Array.isArray(v) && v.length <= MAX_FILAS && v.every(admite);
/** @param {unknown} v */
const textoRevisado = (v) => esObjeto(v) && cadena(v.es) && cadena(v.ca);
/** @param {unknown} v */
const criterios = (v) => lista(v, (x) => cadena(x) && CRITERIOS.has(x));
const ORIGENES_IDIOMA = new Set(['edicion', 'programa', 'norma-general', 'faro', 'historial-cibernarium']);
/** El idioma de la opción, con su origen: la hoja lo pinta tal cual llega del motor.
 * @param {unknown} v */
const idiomaConOrigen = (v) =>
  esObjeto(v) && lista(v.idiomas, cadena) && (v.origen === null || ORIGENES_IDIOMA.has(String(v.origen)));
const DATOS_POR_CONFIRMAR = new Set(['registro_previo', 'idioma', 'modalidad']);
/** Lo que no consta de la opción: la hoja lo dice con frases, sin repetir ningún dato.
 * @param {unknown} v */
const porConfirmar = (v) =>
  lista(v, (x) => typeof x === 'string' && DATOS_POR_CONFIRMAR.has(x)) &&
  new Set(/** @type {unknown[]} */ (v)).size === /** @type {unknown[]} */ (v).length;
/** @param {unknown} v */
function urlSegura(v) {
  if (!cadena(v)) {
    return false;
  }
  try {
    const u = new URL(v);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
/** @param {unknown} v */
function cobertura(v) {
  return (
    esObjeto(v) &&
    cadena(v.criterio) &&
    CRITERIOS.has(v.criterio) &&
    textoRevisado(v.justificacion) &&
    lista(v.afirmaciones, cadena)
  );
}
/** @param {unknown} v */
function afirmacion(v) {
  return (
    esObjeto(v) &&
    cadena(v.id) &&
    (v.descripcion === null || cadena(v.descripcion)) &&
    lista(v.evidencias, (e) => esObjeto(e) && urlSegura(e.url) && cadena(e.capturado_utc) && cadena(e.fragmento))
  );
}
/** Solo los calendarios admitidos para cada hecho pueden contener objetos.
 * @param {string} campo @param {Record<string, unknown>} hecho @param {unknown} tipoUnidad */
function calendarioDelHecho(campo, hecho, tipoUnidad) {
  const { valor, vigencia } = hecho;
  if (
    !esCalendario(valor) ||
    tipoUnidad !== 'edicion' ||
    hecho.motivo !== 'conocido' ||
    hecho.unidad !== null ||
    hecho.moneda !== null ||
    hecho.alcance !== 'edicion' ||
    Object.keys(hecho).length !== CAMPOS_HECHO_CON_VIGENCIA ||
    !esObjeto(vigencia) ||
    Object.keys(vigencia).length !== 1 ||
    !esFecha(vigencia.comprobado_el)
  ) {
    return false;
  }
  return (
    (campo === 'calendario_matricula' && valor.tipo === 'matricula') ||
    (campo === 'calendario_formacion' && ['periodo-formativo', 'sesiones'].includes(valor.tipo)) ||
    (campo === 'calendario_aula' && valor.tipo === 'ventana-acceso')
  );
}
/** @param {unknown} o */
function ofertaValida(o) {
  if (!esObjeto(o) || !esObjeto(o.unidad)) {
    return false;
  }
  const unidad = o.unidad;
  return (
    cadena(o.titulo_programa) &&
    urlSegura(o.url) &&
    (o.cierra_el === null || (cadena(o.cierra_el) && Number.isFinite(Date.parse(o.cierra_el)))) &&
    (o.incidencia_enlace_el === null ||
      (cadena(o.incidencia_enlace_el) && Number.isFinite(Date.parse(o.incidencia_enlace_el)))) &&
    cadena(o.comprobado_el) &&
    Number.isFinite(Date.parse(o.comprobado_el)) &&
    cadena(unidad.id) &&
    cadena(unidad.programa_id) &&
    esObjeto(o.hechos) &&
    ['requiere_registro_previo', 'coste_formacion_tipo', 'coste_formacion'].every(
      (k) => esObjeto(o.hechos) && esObjeto(o.hechos[k]),
    ) &&
    Object.entries(o.hechos).every(
      ([campo, h]) =>
        esObjeto(h) &&
        (h.valor === null ||
          ['string', 'number', 'boolean'].includes(typeof h.valor) ||
          lista(h.valor, cadena) ||
          calendarioDelHecho(campo, h, unidad.tipo)) &&
        cadena(h.motivo),
    )
  );
}
/** @param {unknown} f */
function fichaValida(f) {
  return (
    esObjeto(f) &&
    cadena(f.programa_id) &&
    (f.idioma_ficha === null || cadena(f.idioma_ficha)) &&
    ['no_publicados', 'publicados', 'sin_verificar'].includes(String(f.requisitos)) &&
    esObjeto(f.aprendizaje) &&
    lista(f.aprendizaje.afirmaciones, afirmacion)
  );
}
const CASOS_REQUISITO = new Set(['condicion', 'informativa', 'sin_revisar']);
/** Solo una condición revisada trae resumen: sin él, la vista enseñaría el texto publicado como si fuera el revisado.
 * @param {unknown} r */
function requisitoRevisado(r) {
  return (
    esObjeto(r) &&
    cadena(r.id) &&
    cadena(r.programa_id) &&
    typeof r.caso === 'string' &&
    CASOS_REQUISITO.has(r.caso) &&
    cadena(r.descripcion) &&
    (r.idioma === null || cadena(r.idioma)) &&
    (r.caso === 'condicion' ? textoRevisado(r.resumen) : r.resumen === null)
  );
}
/** @param {unknown} v */
function recurso(v) {
  return esObjeto(v) && ofertaValida(v.oferta) && fichaValida(v.ficha) && lista(v.cobertura, cobertura);
}
/** @param {unknown} v @param {'ia'|'digital'} bloque */
function opcion(v, bloque) {
  return (
    esObjeto(v) &&
    v.bloque === bloque &&
    ofertaValida(v.oferta) &&
    (v.aprendizaje === null || fichaValida(v.aprendizaje)) &&
    lista(v.requisitos, requisitoRevisado) &&
    cadena(v.proveedor) &&
    textoRevisado(v.motivo) &&
    idiomaConOrigen(v.idioma) &&
    porConfirmar(v.porConfirmar)
  );
}
/** @param {unknown} v */
function camino(v) {
  return (
    esObjeto(v) &&
    cadena(v.id) &&
    textoRevisado(v.justificacion) &&
    lista(v.recursos, recurso) &&
    criterios(v.huecos) &&
    lista(v.programasPendientes, cadena) &&
    typeof v.completo === 'boolean'
  );
}
/** Valida el discriminante y todo lo que la vista interpreta; una versión ajena no se sustituye por una hoja vacía.
 * @param {unknown} v @returns {SeleccionFormacion} */
export function leerSeleccion(v) {
  if (
    !(
      esObjeto(v) &&
      v.schema_version === 2 &&
      esObjeto(v.opciones) &&
      lista(v.opciones.ia, (o) => opcion(o, 'ia')) &&
      lista(v.opciones.digital, (o) => opcion(o, 'digital')) &&
      cadena(v.calculado_el) &&
      Number.isFinite(Date.parse(v.calculado_el)) &&
      cadena(v.etapa) &&
      ETAPAS.has(v.etapa) &&
      typeof v.estado === 'string' &&
      ['completa', 'parcial', 'sin_oferta'].includes(v.estado) &&
      (v.camino === null || camino(v.camino)) &&
      lista(v.complementarios, recurso) &&
      criterios(v.huecos) &&
      lista(v.requisitosPendientes, (r) => requisitoRevisado(r) && esObjeto(r) && r.caso !== 'informativa') &&
      lista(v.descartes, (d) => esObjeto(d) && cadena(d.programa_id) && cadena(d.motivo))
    )
  ) {
    throw new Error('Respuesta de formación incompatible');
  }
  return /** @type {SeleccionFormacion} */ (/** @type {unknown} */ (v));
}
/** El fallo de una respuesta de la formación local: con el reloj atrasado, el de Faro con su explicación; con otra, solo
 * su código, que cuenta quien llama.
 * @param {Response} respuesta @returns {Promise<Error>} */
async function falloDeLaRespuesta(respuesta) {
  const cuerpo = await respuesta.json().catch(() => null);
  if (esObjeto(cuerpo) && problemaDe(cuerpo) === ERRORES_DEL_MOTOR.RELOJ_ATRASADO) {
    return errorDeLaRespuesta(respuesta.status, cuerpo);
  }
  return new Error(`La formación local ha respondido ${respuesta.status}`);
}
/** Dirección virtual del Worker, independiente de la carpeta física o URL de la web. Si la instalación del service
 * worker no coincide, no espera al motor: falla con su explicación (instalacion-que-no-coincide.js).
 * @param {PreferenciasSeleccion} preferencias @param {AbortSignal} signal @returns {Promise<SeleccionFormacion>} */
export async function seleccionarEnElDispositivo(preferencias, signal) {
  const peticion = pedirAlMotorLocal(new URL('/local/formacion/seleccionar', document.baseURI).href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(preferencias),
    signal,
  });
  const respuesta = await antesDeQueNoCoincida(peticion);
  if (!respuesta.ok) {
    throw await falloDeLaRespuesta(respuesta);
  }
  return leerSeleccion(await respuesta.json());
}
