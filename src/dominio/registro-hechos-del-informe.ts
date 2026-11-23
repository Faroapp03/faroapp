// Contrato editorial de afirmaciones generales: medida, previsión y aplicación normativa no son intercambiables.
import { esFormaDe, esNuloO, type Guarda } from '../comun/json.ts';

type FormaDeGuarda<G> = G extends Guarda<infer Forma> ? Forma : never;
/** El registro se compila como dato público: no admite campos ajenos ni metadatos privados accidentales. */
function cerrada<Campos extends Record<string, Guarda<unknown>>>(campos: Campos) {
  const forma = esFormaDe(campos);
  return (valor: unknown): valor is FormaDeGuarda<typeof forma> =>
    forma(valor) && Object.keys(valor).every((campo) => Object.hasOwn(campos, campo));
}

const POR_CIENTO = 100;
function literal<T extends string | number>(esperado: T): Guarda<T> {
  return (valor): valor is T => valor === esperado;
}
const texto: Guarda<string> = (v): v is string => typeof v === 'string' && v.trim().length > 0;
const positivo: Guarda<number> = (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const entero: Guarda<number> = (v): v is number => positivo(v) && Number.isSafeInteger(v);
const porcentaje: Guarda<number> = (v): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= POR_CIENTO;
const fecha: Guarda<string> = (v): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(v)) {
    return false;
  }
  const instante = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(instante) && new Date(instante).toISOString().slice(0, '0000-00-00'.length) === v;
};
const url: Guarda<string> = (v): v is string => {
  if (!texto(v)) {
    return false;
  }
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.length > 0 && !u.username && !u.password;
  } catch {
    return false;
  }
};
const huella: Guarda<string> = (v): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const fuente = cerrada({
  nombre: texto,
  url,
  version: esNuloO(texto),
  revisado_captura: fecha,
  capturado: esNuloO(fecha),
  publicado: esNuloO(fecha),
  captura_sha256: huella,
  localizador: texto,
  cita_corta: texto,
});
const revision = cerrada({ fecha, plazo_dias: entero, alcance: texto });
const capacidad = cerrada({
  tipo: literal('resultado-de-ensayo'),
  porcentaje,
  horas_persona: positivo,
  anio: entero,
  poblacion: texto,
  denominador: texto,
  flujos_del_benchmark: entero,
  medida: texto,
  presupuesto_pasos: entero,
  territorio: esNuloO(texto),
  periodo: texto,
  fuente,
});
const ofertas = cerrada({
  tipo: literal('proporcion-de-anuncios'),
  de_cada_100: porcentaje,
  anio: entero,
  poblacion: texto,
  denominador: texto,
  medida: texto,
  territorio: texto,
  periodo: texto,
  fecha_corte: esNuloO(fecha),
  fuente,
});
const calendario = cerrada({
  tipo: literal('prevision-de-publicacion'),
  fecha,
  edicion: texto,
  // «prevista-no-confirmada»: el calendario solo anuncia la fecha. «publicada-segun-calendario»: el evento capturado,
  // ya pasado, trae los valores publicados; no dice nada de los datos detallados ni de la edición siguiente. Es un
  // estado editorial: el validador comprueba su cronología (captura posterior al día de la fecha), no el contenido
  // del evento, que acredita quien revisa la captura.
  estado: (v): v is 'prevista-no-confirmada' | 'publicada-segun-calendario' =>
    v === 'prevista-no-confirmada' || v === 'publicada-segun-calendario',
  poblacion: texto,
  territorio: texto,
  periodo: texto,
  fuente,
});
const norma = cerrada({
  tipo: literal('aplicacion-normativa'),
  fecha,
  fecha_anterior: fecha,
  poblacion: texto,
  territorio: texto,
  periodo: texto,
  alcance: texto,
  fuente,
});
const forma = cerrada({
  version: literal(1),
  revision,
  afirmaciones: cerrada({ capacidad, ofertas_ia: ofertas, proxima_tich: calendario, normas: norma }),
});
export type RegistroHechosDelInforme = ReturnType<typeof leerHechosDelInforme>;

/** El periodo de la TIC-H del calendario y la cronología de su estado editorial. */
function comprobarCalendarioTich(calendarioTich: FormaDeGuarda<typeof calendario>): void {
  if (!/^Año \d{4}$/u.test(calendarioTich.periodo)) {
    throw new Error('Registro de hechos del informe: el periodo de la TIC-H es «Año AAAA»');
  }
  // El evento se publica a una hora del día de su fecha: una captura de ese mismo día puede ser anterior.
  if (
    calendarioTich.estado === 'publicada-segun-calendario' &&
    (calendarioTich.fuente.capturado === null || calendarioTich.fuente.capturado <= calendarioTich.fecha)
  ) {
    throw new Error(
      'Registro de hechos del informe: una publicación según el calendario exige una captura de un día posterior',
    );
  }
}

/** Lee sin sustituir valores, fechas o procedencias. No acredita una nueva revisión editorial ni consulta remota. */
export function leerHechosDelInforme(valor: unknown) {
  if (!forma(valor)) {
    throw new Error('Registro de hechos del informe: contrato editorial no válido');
  }
  for (const hecho of Object.values(valor.afirmaciones)) {
    if (
      hecho.fuente.revisado_captura > valor.revision.fecha ||
      (hecho.fuente.capturado !== null && hecho.fuente.capturado > hecho.fuente.revisado_captura) ||
      (hecho.fuente.publicado !== null &&
        hecho.fuente.capturado !== null &&
        hecho.fuente.publicado > hecho.fuente.capturado) ||
      (hecho.fuente.publicado !== null && hecho.fuente.publicado > hecho.fuente.revisado_captura)
    ) {
      throw new Error('Registro de hechos del informe: cronología de procedencia no válida');
    }
  }
  comprobarCalendarioTich(valor.afirmaciones.proxima_tich);
  if (valor.afirmaciones.normas.fecha <= valor.afirmaciones.normas.fecha_anterior) {
    throw new Error('Registro de hechos del informe: aplazamiento no válido');
  }
  return valor;
}
