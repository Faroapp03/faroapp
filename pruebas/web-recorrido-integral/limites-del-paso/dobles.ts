// Dobles de los límites del paso 4 y de recorrido.js (red, conversación, DOM de la página). El módulo que se ensaya y
// el filtro HTML de confianza son siempre los reales: lo que aquí se sustituye es solo lo que no se decide en ellos.
import { esCancelacion } from '../../../web/scripts/recorrido/api/errores.js';

export const CURSOS_DE_LA_HOJA = 3;
/** Una respuesta rápida que ofrece Faro: su texto (la clave) y lo que hace al pulsarla. */
export interface Sugerencia {
  texto: string;
  accion?: () => void;
}
/** Lo que cada prueba prepara y lo que observa; `reiniciar` lo deja como al principio. */
export interface EstadoDeLaPrueba {
  respuestas: Promise<string>[];
  pedidos: number;
  efectos: string[];
  confirmadas: boolean[];
  agentes: string[];
  /** Los botones que crea el paso, tal como los devuelve el DOM de la prueba. */
  botones: unknown[];
  sugerencias: Sugerencia[];
  controlador: AbortController;
  borrado: (() => void) | null;
  entradaLista: Promise<void>;
  iniciarImportacion: () => void;
  paso4: string[];
  recibos: Promise<string>[];
  pedidosCodigo: number;
  /** Las opciones con que se pidió cada informe de un código (informeDelCodigo), en orden. */
  opcionesDelCodigo: ({ relojDelDispositivo?: boolean } | undefined)[];
  cancelarAlRecibir: boolean;
  fallosHoja: number;
  tarjetasHoja: [number, boolean][];
  pensamientos: string[][];
  /** Los pensamientos empezados con su trabajo (empezarAPensar): su primer paso, en orden. */
  empezados: string[];
  /** Con qué pensamiento empezado se terminó cada uno de `pensamientos` (null si nació ya hecho). */
  terminados: unknown[];
  frases: number;
  /** Lo que recibe avisarDelFallo, en orden. */
  fallos: unknown[];
  /** Lo que dice Faro (decirFaro), en orden. */
  dichos: unknown[];
  /** Si reunir el resultado del recorrido (resultadoDelRecorrido) falla, como con una tarea oficial sin tiempo. */
  resultadoFalla: boolean;
}
function estadoInicial(): EstadoDeLaPrueba {
  return {
    respuestas: [],
    pedidos: 0,
    efectos: [],
    confirmadas: [],
    agentes: [],
    botones: [],
    sugerencias: [],
    controlador: new AbortController(),
    borrado: null,
    entradaLista: Promise.resolve(),
    iniciarImportacion: () => {},
    paso4: [],
    recibos: [],
    pedidosCodigo: 0,
    opcionesDelCodigo: [],
    cancelarAlRecibir: false,
    fallosHoja: 0,
    tarjetasHoja: [],
    pensamientos: [],
    empezados: [],
    terminados: [],
    frases: 0,
    fallos: [],
    dichos: [],
    resultadoFalla: false,
  };
}
export const prueba = estadoInicial();
export function reiniciar() {
  Object.assign(prueba, estadoInicial());
  estado.tareas = [];
}
export const estado: { tareas: unknown[]; grupos: { principal: null }; ocupacion: null } = {
  tareas: [],
  grupos: { principal: null },
  ocupacion: null,
};
export const ocupacionElegida = () => ({ isco08: '7512', esco: null, titulo: 'Panadería', origen: 'jerarquia' });
export const senalDeCancelacion = () => prueba.controlador.signal;
export function cancelarPeticiones() {
  prueba.controlador.abort();
}
export function escucharBorrado(fn: () => void) {
  prueba.borrado = fn;
}
export let codigoRecibido: string | null = null;
export function fijarCodigo(codigo: string | null) {
  codigoRecibido = codigo;
}
export const tomarCodigoDelFragmento = () => null;
export const porId = (id: string) => document.getElementById(id);
export const crear = (tipo: string, propiedades: Record<string, unknown> = {}) => {
  const elemento = document.createElement(tipo);
  Object.assign(elemento, propiedades);
  if (tipo === 'button') {
    prueba.botones.push(elemento);
  }
  return elemento;
};
export const escribir = <Elemento extends { textContent: string | null }>(elemento: Elemento, texto: string) => {
  elemento.textContent = texto;
  return elemento;
};
export const escribirAtributo = <Elemento extends { setAttribute(nombre: string, valor: string): void }>(
  elemento: Elemento,
  atributo: string,
  texto: string,
) => {
  elemento.setAttribute(atributo, texto);
  return elemento;
};
export const traducible = (clave: string) => clave;
export const conVersiones = (textos: { es: string }) => textos.es;
export const EVENTO_PENSANDO = 'faro-pensando';
export const faroEstaPensando = () => false;
export const idiomaActual = () => 'es';
export const IDIOMAS = ['es', 'ca'];
export const hayDiccionario = () => true;
export const tareasListas = () => true;
export const hechoSinAporteInferido = () => true;
export const idiomaDeLasRespuestas = () => 'es';
export const fechaLocalDeHoy = () => '2026-10-14';
export const formatearNumero = String;
export const ORIGENES = { IA: 'ia' };
export const PASO_INFORME = 4,
  PASO_TAREAS = 3,
  PASO_OCUPACION = 1;
export const CAMPO_FIRMAS_NO_VALIDAS = 'firmasNoValidas',
  CAMPO_TAREAS_NO_ADMITIDAS = 'tareasNoAdmitidas';
export const AVISO_DE_AYUDA = 'ayuda';
export class CodigoNoValido extends Error {}
/** El enlace de un resultado (otro-dispositivo/formato.js). */
export const enlaceConCodigo = (base: string, codigo: string) => `${base}#pasar=${codigo}`;
/** Lo que se ofrece tras un fallo (recorrido/reparar.js): en estos límites, las salidas del paso, sin cambiar. */
export const salidasTrasElFallo = (_error: unknown, salidas: Sugerencia[]) => salidas;
export const avisoYaDicho = () => false;
export const hayPeticionEnCurso = () => false;
export const hayAlgoQuePerder = () => false;
export const hayMensajeDeLaPersona = () => false;
export const textoEnLaBarra = () => '';
export const versionCambiada = () => false;
export const pulsaFuera = () => false;
export const tareasNoAdmitidas = () => [];
export const codificar = () => 'codigo';
export const resultadoDelRecorrido = () => {
  if (prueba.resultadoFalla) {
    throw new TypeError('Una tarea oficial sin tiempo no puede pasar a otro dispositivo.');
  }
  return { idioma: 'es', sinViajar: 0 };
};
export const datoEn = <Valor>(valor: Valor) => valor;
export const datoOficial = <Valor>(valor: Valor) => valor;
export const tituloDoble = <Valor>(valor: Valor) => valor;
export const hojasDelInforme = () => 2;
export const crearPensamiento = (pasos: { texto: string }[], { empezado = null }: { empezado?: unknown } = {}) => {
  prueba.pensamientos.push(pasos.map((paso) => paso.texto));
  prueba.terminados.push(empezado);
  return pasos;
};
export const empezarAPensar = (primerPaso: string) => {
  prueba.empezados.push(primerPaso);
  return { empezado: primerPaso };
};
export const crearFraseDelAgente = () => {
  prueba.frases++;
  return {};
};
export const crearTarjetaDelAgente = () => ({});
export const crearTarjetaDeLaHoja = (cursos: number, lista: boolean) => {
  prueba.tarjetasHoja.push([cursos, lista]);
  return {};
};
export const crearCarpeta = () => {
  prueba.efectos.push('carpeta');
  return {};
};
export const marcarConfirmadas = (valor: boolean) => prueba.confirmadas.push(valor);
export const marcarAgente = (valor: string) => {
  prueba.agentes.push(valor);
};
export const decirPersona = () => prueba.efectos.push('persona');
export const decirFaro = (partes: unknown, opciones?: { tipo?: string }) => {
  prueba.efectos.push(opciones?.tipo === 'error' ? 'error' : 'faro');
  prueba.dichos.push(partes);
  return partes;
};
export const ofrecerSugerencias = (lista: Sugerencia[]) => {
  prueba.sugerencias.push(...lista);
  return null;
};
export const avisarDelFallo = (error: unknown) => {
  prueba.efectos.push('fallo');
  prueba.fallos.push(error);
};
export const informeEnHtml = async () => {
  prueba.pedidos++;
  const respuesta = prueba.respuestas.shift();
  if (!respuesta) {
    throw new Error('Falta respuesta de ensayo');
  }
  return { html: await respuesta, avisos: [] };
};
export const informeDelCodigo = async (_codigo?: string, opciones?: { relojDelDispositivo?: boolean }) => {
  prueba.pedidosCodigo++;
  prueba.opcionesDelCodigo.push(opciones);
  const html = prueba.recibos.shift();
  if (!html) {
    throw new Error('Sin respuesta de ensayo');
  }
  const contenido = await html;
  if (prueba.cancelarAlRecibir) {
    queueMicrotask(() => prueba.controlador.abort());
  }
  return { html: contenido, resultado: { idioma: 'es', sinViajar: 0 } };
};
export const enEspera = async <Resultado>({
  trabajo,
  alFallar = avisarDelFallo,
}: {
  trabajo: () => Promise<Resultado>;
  alFallar?: (error: unknown) => void;
}): Promise<Resultado | undefined> => {
  // El mismo contrato que pagina.js: un fallo lo cuenta alFallar (por defecto, avisarDelFallo), una cancelación no se
  // cuenta, y en ambos casos quien espera recibe undefined. Sin turnos: las pruebas no sueltan esperas.
  try {
    return await trabajo();
  } catch (error) {
    if (!esCancelacion(error)) {
      alFallar(error);
    }
    return undefined;
  }
};
export const cargarDiccionario = async () => {};
export const completarDatosEnIdioma = async () => {};
export const alCambiarIdioma = () => {};
export const prepararInforme = () => {};
export const retirarInforme = () => {};
export const ofrecerPasar = () => {};
export const retirarPasar = () => {};
export const anotarFallo = () => {};
export const olvidarEstimacion = () => {};
export const mostrarCompositor = () => {};
export const olvidarAgentes = () => {};
export const actualizarEspera = () => {};
export const decirAvisos = () => {};
export const llevarALaVista = () => {};
export const mostrarEspera = () => {};
export const quitarEspera = () => {};
export const pintarDocumentoDeLaHoja = () => {
  if (prueba.fallosHoja-- > 0) {
    throw new Error('fallo de hoja');
  }
};
export const mostrarDocumentoDelInforme = () => {};
export const marcarPasoEnLaGuia = () => {};
export const empezarHojaDeRuta = ({ alAcabar }: { alAcabar: (cursos: number) => void }) => alAcabar(CURSOS_DE_LA_HOJA);
export const irA = () => {};
export const enfocar = () => {};
export const pintarTareas = () => {};
export const abrirFueraSinPerderLaConversacion = () => {};
export const seguirAlturaVisible = () => {};
export const llevarLaOpcionEnfocadaALaVista = () => {};
export const iniciarAyudas = () => {};
export const enfocarCompositor = () => {};
export const iniciarCompositor = () => {};
export const vaciarBarra = () => {};
export const vaciarConversacion = () => {};
export const olvidarTraducciones = () => {};
export const reiniciarEstado = () => {};
export const iniciarGuia = () => {};
export const iniciarIdiomaDeLosDatos = () => {};
export const olvidarLlamadas = () => {};
export const mostrarError = () => prueba.efectos.push('error-inicio');
export const soltarEspera = () => {};
export const empezarConversacion = () => {};
export const iniciarPasoOcupacion = () => {};
export const volverEnOcupacion = () => {};
export const iniciarPasoTareas = () => {};
export const volverATareas = () => {};
