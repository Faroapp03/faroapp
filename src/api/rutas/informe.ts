// POST /api/informe[?formato=html|breve]: construye el informe con lo que ha confirmado la persona. Las reglas del
// informe no usan IA. Con `breve`, el HTML es el del informe breve «La IA y tu trabajo» (dos hojas, sin formación:
// presentacion/informe-breve.ts) y el JSON lleva también sus cifras (`breve`). Solo se
// aceptan estimaciones firmadas por Faro para esa tarea y esa ocupación (o ese grupo).
// Lo que escribió la persona (cada tarea y la palabra con que nombró su trabajo) llega al informe sin datos personales
// reconocidos por el filtro compartido (api/textos-de-la-persona.ts). Si con la política de la API Faro no tiene referencias para estimar las
// tareas del grupo, el informe da ese motivo a las que no tienen nota.
// Con `idioma: 'ca'`, se utilizan los textos y datos traducidos incluidos en Faro. Los textos sin traducción
// conservan su idioma y su marca de procedencia; no se envían al exterior para traducirlos.
// El informe y su presentación se cargan de forma estática y no importan nada del motor de cursos: solo la formación
// se pide al motor, por su puerta (plataforma/motor-de-cursos.ts, la del contexto). Sin el motor (ausente, averiado o
// bloqueado), el informe sale entero salvo la formación, con un aviso en su lugar (formacionNoDisponible). El breve no
// lleva formación ni pasa por la puerta: sale igual con el motor sano, ausente, averiado o bloqueado (su informe va
// sin formación calculada, formacionNoDisponible). La hoja de ruta usa la selección acreditada local y su documento propio.

import type { FormacionDelInforme } from '../../../motores/cursos/src/index.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { IDIOMA_POR_DEFECTO, type Idioma } from '../../comun/idioma.ts';
import { CAMPO_FIRMAS_NO_VALIDAS } from '../../comun/protocolo-web.ts';
import { RelojAtrasado } from '../../comun/reloj-atrasado.ts';
import { esDiaReal } from '../../comun/tiempo.ts';
import { primerDiaPosibleDelDispositivo } from '../../dominio/fecha-de-los-datos.ts';
import {
  comprobarEntradaInforme,
  construirInforme,
  type OpcionesInforme,
  peticionDeFormacion,
} from '../../dominio/informe.ts';
import { construirInformeBreve } from '../../dominio/informe-breve.ts';
import { resolverOcupacion } from '../../dominio/ocupacion-confirmada.ts';
import { comprobarReferenciaOit, prepararEstimacionesParaInforme } from '../../dominio/tareas.ts';
import type { Entrada } from '../../dominio/tipos-entrada.ts';
import type { Informe } from '../../dominio/tipos-informe.ts';
import type { InformeBreve } from '../../dominio/tipos-informe-breve.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import type { PuertaDelMotor } from '../../plataforma/motor-de-cursos.ts';
import { renderizarInformeBreve } from '../../presentacion/informe-breve.ts';
import { type ContextoApi, type ManejadorRuta, responder, responderUnProblema } from '../contexto-api.ts';
import { ESQUEMA_INFORME } from '../esquemas.ts';
import { ambitoDe, contenidoFirmado } from '../estimacion-firmada.ts';
import { leerCuerpoJson, problema, SolicitudInvalida } from '../http.ts';
import { type LoQueSeCita, loQueSeCita } from '../textos-de-la-persona.ts';

/** Lo que se responde cuando una estimación no lleva una firma válida de Faro para su tarea y su ocupación. */
const FIRMA_NO_VALIDA = 'una estimación no la ha emitido Faro para esta tarea, o ha caducado: vuelve a pedirla';

/**
 * Rechaza una fecha anterior al primer día que puede marcar un reloj bien puesto (primerDiaPosibleDelDispositivo): el
 * informe decide con ella qué cursos han terminado y un reloj atrasado daría por abiertos cursos ya cerrados. Un día
 * por detrás del de los datos es posible en otra zona horaria y no se rechaza, igual que una fecha posterior: los datos
 * no pueden acreditar que sea errónea (docs/api/README.md).
 */
function exigirFechaNoAnteriorALosDatos(fecha: string, datos: Datos): void {
  const primerDia = primerDiaPosibleDelDispositivo(datos);
  if (primerDia !== null && fecha < primerDia) {
    throw new RelojAtrasado('La fecha del informe es anterior a la de los datos');
  }
}

/**
 * Las tareas de la entrada cuya estimación no lleva una firma válida de Faro para esa tarea y su ocupación principal
 * (la ocupación ESCO o, sin ella, el grupo). El segundo grupo no abre la firma: si no, bastaría declarar cualquier
 * grupo como segundo para colar en el informe una estimación hecha para otra ocupación.
 */
async function tareasConFirmaNoValida(contexto: ContextoApi, entrada: Entrada): Promise<string[]> {
  const ambito = ambitoDe(resolverOcupacion(contexto.datos, entrada));
  // Las firmas son independientes y su número está acotado (MAX_TAREAS_INFORME): se comprueban a la vez.
  const conEstimacion = entrada.tareas.filter((tarea) => tarea.estimacion);
  const validas = await Promise.all(
    conEstimacion.map((tarea) =>
      tarea.estimacion
        ? contexto.firmador.comprobar(contenidoFirmado(ambito, tarea.texto, tarea.estimacion), tarea.estimacion.firma)
        : true,
    ),
  );
  return conEstimacion.filter((_, posicion) => !validas[posicion]).map((tarea) => tarea.id);
}

/** Comprueba referencias antes de minimizar lo que se cita de la persona. */
async function citarEntrada(
  contexto: ContextoApi,
  { entrada, idioma }: { entrada: Entrada; idioma: Idioma },
): Promise<LoQueSeCita> {
  const ocupacion = comprobarEntradaInforme(entrada, contexto.datos);
  for (const tarea of entrada.tareas) {
    if (tarea.referencia) {
      comprobarReferenciaOit({ datos: contexto.datos, ocupacion }, tarea, tarea.referencia);
    }
  }
  return loQueSeCita(entrada, idioma);
}

/**
 * Lo que acompaña al informe según el formato pedido: con `html`, las dos hojas laborales y la marca del informe;
 * con `breve`, además sus cifras. El JSON completo conserva su formación; sin formato no se añade HTML.
 */
function enSuFormato(
  resultado: Informe,
  datos: Datos,
  formato: string | null,
): { breve?: InformeBreve; html?: string } {
  if (formato === 'html' || formato === 'breve') {
    const breve = construirInformeBreve(resultado, datos);
    const html = renderizarInformeBreve(breve, resultado, { incrustado: true, conMarca: formato === 'html' });
    return formato === 'breve' ? { breve, html } : { html };
  }
  return {};
}

/** Lo que se apunta en el registro cuando el informe sale sin formación porque el motor de cursos no está. */
function avisarSinMotor(motivo: string): void {
  console.warn(`Faro: el informe sale sin formación; el motor de cursos no está disponible (${motivo}).`);
}

/**
 * La formación del informe, calculada por el motor de cursos en una sola llamada por su puerta; null si el motor no
 * está (ausente, averiado o bloqueado), y el informe sale sin ella.
 */
async function formacionPorLaPuerta(
  puerta: PuertaDelMotor,
  datos: Datos,
  peticion: ReturnType<typeof peticionDeFormacion>,
): Promise<FormacionDelInforme | null> {
  const resultado = await puerta.operar('formacionDelInforme', [peticion], { datos });
  if (!resultado.disponible) {
    avisarSinMotor(resultado.motivo);
    return null;
  }
  return resultado.valor;
}

/** El informe con la formación que da el motor por la puerta; sin ella, el informe sale sin formación y lo dice. */
async function informeConSuFormacion(
  puerta: PuertaDelMotor,
  datos: Datos,
  entrada: Entrada,
  opciones: OpcionesInforme,
): Promise<Informe> {
  const formacion = await formacionPorLaPuerta(puerta, datos, peticionDeFormacion(entrada, datos, opciones));
  return construirInforme(entrada, datos, { ...opciones, formacion });
}

/** El informe, con la formación que da el motor de cursos por la puerta (o sin ella, si no está). */
async function informeConLaPuerta(
  puerta: PuertaDelMotor,
  contexto: ContextoApi,
  peticion: Request,
  { formato, comprobarReloj }: { formato: string | null; comprobarReloj: boolean },
): Promise<Response> {
  const { idioma = IDIOMA_POR_DEFECTO, ...leida } = await leerCuerpoJson(
    peticion,
    ESQUEMA_INFORME,
    'los datos del informe no tienen el formato esperado',
  );
  // Solo en línea (FARO_CAMINO_A_MANO=no), no hay informe hecho a mano: la marca no se atiende.
  const entrada = contexto.caminoAMano ? leida : { ...leida, sinIa: undefined };
  if (!esDiaReal(entrada.fecha)) {
    throw new SolicitudInvalida('la fecha no es válida');
  }
  if (comprobarReloj) {
    exigirFechaNoAnteriorALosDatos(entrada.fecha, contexto.datos);
  }
  const sinFirmaValida = await tareasConFirmaNoValida(contexto, entrada);
  if (sinFirmaValida.length) {
    return responderUnProblema(
      contexto,
      peticion,
      problema(ESTADO_HTTP.solicitudIncorrecta, 'firma_no_valida', FIRMA_NO_VALIDA, {
        error: FIRMA_NO_VALIDA,
        [CAMPO_FIRMAS_NO_VALIDAS]: sinFirmaValida,
      }),
    );
  }
  const { entrada: citada, avisos } = await citarEntrada(contexto, { entrada, idioma });
  const { entrada: preparada, tareasSinEstimacion } = prepararEstimacionesParaInforme(citada);
  const { politica, oferta } = contexto;
  const opciones: OpcionesInforme = { idioma, politica, oferta, tareasSinEstimacion };
  // El breve no lleva formación: no se pide al motor de cursos.
  const resultado =
    formato === 'breve'
      ? construirInforme(preparada, contexto.datos, { ...opciones, formacion: null })
      : await informeConSuFormacion(puerta, contexto.datos, preparada, opciones);
  return responder(contexto, peticion, ESTADO_HTTP.correcto, {
    informe: resultado,
    ...enSuFormato(resultado, contexto.datos, formato),
    avisos,
  });
}

/**
 * POST /api/informe. Responde el informe en JSON y, con `?formato=html`, también el HTML laboral de dos hojas para incrustarlo, en el
 * idioma pedido (por defecto, IDIOMA_POR_DEFECTO), con los avisos de lo que se ha hecho con lo que escribió la persona.
 * Otro formato es una petición mal hecha (400), no un informe sin HTML en silencio. La formación la pide al motor de
 * cursos por la puerta del contexto; sin motor, el informe sale igual, sin formación y con su aviso.
 *
 * @param contexto - El contexto de la petición.
 * @param peticion - La petición.
 * @param url - Su URL, con las consultas `formato` y `reloj`.
 * @returns El informe; o el 400 de una firma que no vale, o el 400 de una entrada inválida.
 * @throws {SolicitudInvalida} Si el formato o la fecha no valen, o el cuerpo no tiene la forma esperada.
 * @throws {RelojAtrasado} Si la fecha se contrasta con los datos (primerDiaPosibleDelDispositivo) y es anterior a él.
 */
export const informe: ManejadorRuta = async (contexto, peticion, url) => {
  const formato = url.searchParams.get('formato');
  if (formato !== null && formato !== 'html' && formato !== 'breve') {
    throw new SolicitudInvalida('formato solo admite los valores html y breve');
  }
  const reloj = url.searchParams.get('reloj');
  if (reloj !== null && reloj !== 'dispositivo') {
    throw new SolicitudInvalida('reloj solo admite el valor dispositivo');
  }
  // La fecha se contrasta con los datos si decide qué cursos han terminado (todo formato salvo el breve, que no lleva
  // formación) o si es la del reloj del dispositivo (`reloj=dispositivo`). La de un resultado pasado desde otro
  // dispositivo es la del día en que se hizo y puede ser anterior a los datos con el reloj bien puesto.
  const comprobarReloj = formato !== 'breve' || reloj === 'dispositivo';
  return informeConLaPuerta(contexto.motorDeCursos, contexto, peticion, { formato, comprobarReloj });
};
