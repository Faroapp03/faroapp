// Motor de Faro en el dispositivo: responde búsquedas, informes y formación con el paquete local.
// MCP ofrece las consultas de lectura al asistente del navegador (web/scripts/webmcp.js).

import {
  type Atributos,
  CLASIFICADOR_EN_LA_PANTALLA,
  cargarDesdeContenedor,
  clasificadorDesdeContenedor,
  comprobarAtributos,
  prepararBuscador,
  usarClasificador,
  usarVectores,
  VECTORES_EN_LA_PANTALLA,
} from '../../../motores/ocupaciones/src/index.ts';
// La tabla de atributos del motor de preguntas es un dato del motor de ocupaciones que solo carga el dispositivo: no va
// en su entrada pública, que importan también la API y el Worker (motores/ocupaciones/README.md).
import atributosDelPaquete from '../../../motores/ocupaciones/src/recorrido/preguntas/atributos.json' with {
  type: 'json',
};
import { crearPeticionLocal, type PeticionLocal } from '../../api/cuerpo-local.ts';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../../comun/marcas-de-tiempo.ts';
import type { DatosGlobales } from '../../datos-globales/datos.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import type { SecretoDeFirma } from '../../seguridad/firma.ts';
import { ARCHIVOS_EXTRA_DEL_PAQUETE, PARTES, PARTES_DEL_PRIMER_ANALISIS } from '../archivos-del-paquete.ts';
import { motorDeCursos } from '../motor-de-cursos.ts';
import { crearApiLocal } from './api-local.ts';
import { crearEsperaDeLosExtras, ESPERA_MAXIMA_DE_LOS_EXTRAS_MS } from './espera-de-los-extras.ts';
import { formacionAcreditada } from './formacion-acreditada.ts';
import { cargarPaquete, leerExtraDelPaquete } from './paquete.ts';
import { type CrearWorkerDeCursos, crearPuertaDeCursosWeb } from './puerta-de-cursos.ts';
import { RUTA_FORMACION, responderFormacionLocal } from './ruta-formacion.ts';
import { esPeticionDePaso, esPeticionLocal, responderLocal } from './ruta-local.ts';

// Expone el lector del paquete sin crear una API; pruebas/web-motor/compilacion-real.test.ts exige esta entrada.
export { cargarPaquete } from './paquete.ts';

/**
 * El motor local: sus datos, la versión del paquete y la API. Arranca con las partes del primer análisis
 * (PARTES_DEL_PRIMER_ANALISIS) y carga el resto en los mismos datos cuando se le pide (completar), con la copia
 * completa ya guardada; una petición que necesita el resto (necesitaElResto) lo espera.
 */
export interface MotorLocal {
  readonly datos: Datos;
  readonly version: string;
  readonly responder: (peticion: PeticionLocal) => Promise<Response>;
  /** Si responder `url` ahora tendría que cargar antes el resto del paquete: no es del recorrido y aún no está. */
  readonly necesitaElResto: (url: string) => boolean;
  /** Carga el resto del paquete, una sola vez; si falla, la próxima llamada lo vuelve a intentar. */
  readonly completar: () => Promise<void>;
}

/** Las partes que no necesita el primer análisis: se cargan con la copia completa (completar). */
const PARTES_DEL_RESTO = PARTES.filter((parte) => !PARTES_DEL_PRIMER_ANALISIS.includes(parte));

/**
 * Si una petición se responde con las partes del primer análisis: las del recorrido local (ruta-local.ts, que solo lee
 * esas partes: pruebas/paquetes/primer-analisis.test.ts) y la formación, que no lee el paquete. Las demás (la API, el
 * informe, los cursos y MCP) esperan al resto.
 *
 * @param url - La dirección de la petición.
 * @returns Si basta con el primer análisis.
 */
function bastaElPrimerAnalisis(url: string): boolean {
  return esPeticionLocal(url) || new URL(url).pathname === RUTA_FORMACION;
}

/** Lo que el motor local recibe de su dispositivo. */
export interface OpcionesMotorLocal {
  /** Globales precargados por el llamador; no añade descargas al recorrido local. */
  readonly datosGlobales?: DatosGlobales | null;
  /**
   * El secreto con que el motor firma sus estimaciones, guardado en el dispositivo: con uno nuevo en cada arranque, una
   * estimación firmada antes de recargar la página no valdría para el informe. Es una clave HMAC de Web Crypto que no
   * se puede extraer (web/scripts/motor-local/secreto-firma.js).
   */
  readonly secretoFirma?: SecretoDeFirma;
  /**
   * Lo que arranca el Web Worker del motor de cursos (plataforma/navegador/trabajador-de-cursos.ts): lo da
   * web/scripts/motor-local/worker.js, con la política de Trusted Types de la web. Con él, las operaciones de cursos
   * corren en su propio hilo y se cortan si no acaban a tiempo; sin él (pruebas), en este.
   */
  readonly trabajadorDeCursos?: CrearWorkerDeCursos;
}

/**
 * Prepara el motor en el dispositivo con el paquete de `base` y su secreto de firma.
 *
 * @param base - La dirección desde la que se leen los datos.
 * @param opciones - Las opciones del motor; por defecto, ninguna.
 * @returns El motor local.
 */
export async function crearMotorLocal(
  base: URL,
  { secretoFirma, datosGlobales, trabajadorDeCursos }: OpcionesMotorLocal = {},
): Promise<MotorLocal> {
  const { datos, version } = await cargarPaquete(base, { partes: PARTES_DEL_PRIMER_ANALISIS });
  const seleccionFormacion = formacionAcreditada(new URL('../../', base));
  const puertaDeCursos = trabajadorDeCursos === undefined ? motorDeCursos : crearPuertaDeCursosWeb(trabajadorDeCursos);
  // El índice de la búsqueda, que es casi toda la inicialización, solo lee las partes del primer análisis: se prepara
  // ya, y la API, que lo vuelve a pedir, lo encuentra hecho (su caché es por datos).
  prepararElIndice(datos);
  // La API se crea con el paquete entero: lee partes del resto y anota al crearse si los datos de cursos han fallado
  // (puertaConSusDatos).
  const resto = cargaDelResto(base, datos, version, () =>
    crearApiLocal({
      datos,
      ...(datosGlobales === undefined ? {} : { datosGlobales }),
      ...(secretoFirma === undefined ? {} : { secretoFirma }),
      motorDeCursos: puertaDeCursos,
    }),
  );
  // La pantalla del recorrido (web/scripts/recorrido/ocupacion-local.js) pide aquí sus pasos, fuera de la API pública
  // (ruta-local.ts). Los atributos del motor de preguntas se comprueban la primera vez que se usan.
  let atributos: Atributos | null = null;
  const losAtributos = (): Atributos => {
    atributos ??= comprobarAtributos(atributosDelPaquete);
    return atributos;
  };
  // La IA de vectores del recorrido y el clasificador de fragmentos (motores/ocupaciones/src/recorrido/fusion/)
  // se piden al arrancar, con el motor ya respondiendo. Si fallan o el paquete no los trae, el recorrido sigue sin
  // ellos, pero no en silencio: lo dice la consola y cada paso lo lleva en su lectura (`conVectores`,
  // `conClasificador`: ruta-local.ts), que la pantalla enseña.
  // Cada paso del recorrido espera a que terminen de cargar, bien o mal (espera-de-los-extras.ts). Ya cargados, no
  // espera nada; las demás peticiones del recorrido no los usan y no esperan.
  const losExtras = cargarLosExtras(base);
  return {
    datos,
    version,
    necesitaElResto: (url) => !(resto.completo() || bastaElPrimerAnalisis(url)),
    completar: async () => {
      await resto.laApi();
    },
    responder: async (peticion) => {
      if (new URL(peticion.url).pathname === RUTA_FORMACION) {
        return responderFormacionLocal(peticion, seleccionFormacion);
      }
      if (esPeticionLocal(peticion.url)) {
        if (esPeticionDePaso(peticion.url) && !(await extrasMedidos(losExtras))) {
          console.warn(
            'Faro: la IA del recorrido aún no ha cargado; este paso sigue sin ella y lo dice en la pantalla.',
          );
        }
        return responderLocal(datos, losAtributos, peticion);
      }
      const responderApi = await resto.laApi();
      return responderApi(crearPeticionLocal(peticion));
    },
  };
}

/**
 * Pide los archivos extra del recorrido (cargarExtra) y devuelve la espera de un paso a que terminen de cargar.
 *
 * @param base - La carpeta publicada del paquete.
 * @returns La espera (crearEsperaDeLosExtras).
 */
function cargarLosExtras(base: URL): () => Promise<boolean> {
  const vectores = VECTORES_EN_LA_PANTALLA
    ? cargarExtra(base, ARCHIVOS_EXTRA_DEL_PAQUETE.vectoresMovil, cargarDesdeContenedor).then(usarVectores)
    : Promise.resolve();
  const clasificador = CLASIFICADOR_EN_LA_PANTALLA
    ? cargarExtra(base, ARCHIVOS_EXTRA_DEL_PAQUETE.clasificadorMovil, clasificadorDesdeContenedor).then(
        usarClasificador,
      )
    : Promise.resolve();
  return crearEsperaDeLosExtras([vectores, clasificador], ESPERA_MAXIMA_DE_LOS_EXTRAS_MS);
}

/**
 * El índice de la búsqueda de unos datos (prepararBuscador), con su tramo de inicialización en la línea temporal.
 *
 * @param datos - Los datos del motor.
 */
function prepararElIndice(datos: Datos): void {
  const inicio = inicioDelTramo();
  prepararBuscador(datos);
  medirTramo(MEDIDAS.inicializacion, inicio);
}

/** La API local del motor, sobre el paquete entero. */
type ApiLocal = Awaited<ReturnType<typeof crearApiLocal>>;

/**
 * La carga del resto del paquete en los datos con que arrancó el motor y la API que se crea con él: una sola vez, y si
 * falla, la siguiente llamada lo vuelve a intentar.
 *
 * @param base - La carpeta publicada del paquete.
 * @param datos - Los datos del motor, con las partes del primer análisis.
 * @param version - La versión del paquete con que arrancó.
 * @param crearApi - Lo que crea la API con los datos ya completos.
 * @returns La API (laApi) y si el resto ya está cargado (completo).
 */
function cargaDelResto(base: URL, datos: Datos, version: string, crearApi: () => Promise<ApiLocal>) {
  let api: Promise<ApiLocal> | null = null;
  let completo = false;
  const laApi = (): Promise<ApiLocal> => {
    api ??= cargarPaquete(base, { partes: PARTES_DEL_RESTO, en: datos })
      .then(async (cargado) => {
        if (cargado.version !== version) {
          throw new Error('El resto del paquete no es de la versión con que arrancó el motor');
        }
        const inicio = inicioDelTramo();
        const creada = await crearApi();
        medirTramo(MEDIDAS.inicializacion, inicio);
        completo = true;
        return creada;
      })
      .catch((error: unknown) => {
        api = null;
        throw error;
      });
    return api;
  };
  return { laApi, completo: () => completo };
}

/**
 * La espera de un paso a los archivos extra (crearEsperaDeLosExtras), con su tramo en la línea temporal.
 *
 * @param losExtras - La espera.
 * @returns Si los extras han terminado de cargar a tiempo.
 */
async function extrasMedidos(losExtras: () => Promise<boolean>): Promise<boolean> {
  const inicio = inicioDelTramo();
  const terminados = await losExtras();
  medirTramo(MEDIDAS.esperaDeLosExtras, inicio);
  return terminados;
}

/** Lo que pasa sin un archivo extra del recorrido, como lo dice la consola. */
const SIN_EL_EXTRA = 'el recorrido sigue sin él y lo dice en la pantalla';

/**
 * Carga un archivo extra del paquete con `cargar`, o null si el paquete no lo trae o falla; lo uno y lo otro, con un
 * aviso en la consola que dice lo que pasa sin él.
 *
 * @param base - La carpeta publicada del paquete.
 * @param archivo - El nombre del archivo extra.
 * @param cargar - Lo que lo comprueba y lo prepara.
 * @param sinEl - Lo que pasa sin él; por defecto, lo del recorrido.
 * @returns Lo cargado, o null.
 */
async function cargarExtra<T>(
  base: URL,
  archivo: string,
  cargar: (contenedor: unknown) => T | Promise<T>,
  sinEl = SIN_EL_EXTRA,
) {
  try {
    const contenedor = await leerExtraDelPaquete(base, archivo);
    if (contenedor !== null) {
      const inicio = inicioDelTramo();
      const cargado = await cargar(contenedor);
      medirTramo(MEDIDAS.prepararExtra, inicio, { archivo });
      return cargado;
    }
    console.warn(`Faro: el paquete no trae ${archivo}; ${sinEl}.`);
  } catch (error) {
    console.warn(`Faro: no se ha podido cargar ${archivo}; ${sinEl}.`, error);
  }
  return null;
}
