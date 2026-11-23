// Forma del bloque `clasificacion` de una oferta: las mismas reglas que el contrato del productor
// (plataforma_datos/cursos/clasificacion/contrato.py). Solo admite códigos de vocabularios cerrados.
import { esNuloO, esObjeto, type Guarda } from '../comun/json.ts';
import {
  ALCANCES_CLASIFICACION,
  type ApoyoClasificacionCatalogo,
  CERTEZAS_CLASIFICACION,
  type ClasificacionCatalogo,
  ESTADOS_CLASIFICACION,
  type EvidenciaClasificacionCatalogo,
  IDIOMAS_CLASIFICACION,
  type MateriaClasificacion,
  MOTIVOS_POR_CONFIRMAR,
  NIVELES_CLASIFICACION,
} from './contrato.ts';
import { compararTextos, esFecha, esSha, esTexto, esUrlDeDominioPublico, forma, lista, unaDe } from './guardas.ts';
import { TEMAS_CURSOS } from './temario.ts';

export const MATERIAS_CLASIFICACION = TEMAS_CURSOS.filter(
  (tema): tema is MateriaClasificacion => tema !== 'no-indicado',
);
const MAX_EVIDENCIAS = 50;
const MAX_IDENTIFICADOR_REGLA = 80;
const CAMPOS_EVIDENCIA = ['url', 'sha256', 'capturado_utc', 'localizador'] as const;
/** Cada motivo se apoya en lo que dice: no hay captura, la captura no publica el dato o hay varias que chocan. */
const EVIDENCIAS_DEL_MOTIVO = {
  sin_captura: { minimo: 0, maximo: 0 },
  fuente_no_publica: { minimo: 1, maximo: MAX_EVIDENCIAS },
  conflicto_evidencias: { minimo: 2, maximo: MAX_EVIDENCIAS },
} as const;

const evidencia = forma({ url: esUrlDeDominioPublico, sha256: esSha, capturado_utc: esFecha, localizador: esTexto });
const regla = forma({
  id: (v: unknown): v is string =>
    typeof v === 'string' && v.length <= MAX_IDENTIFICADOR_REGLA && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(v),
  version: (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1,
  sha256: esSha,
});

function compararEvidencias(a: EvidenciaClasificacionCatalogo, b: EvidenciaClasificacionCatalogo): number {
  for (const campo of CAMPOS_EVIDENCIA) {
    const orden = compararTextos(a[campo], b[campo]);
    if (orden !== 0) {
      return orden;
    }
  }
  return 0;
}

/** Orden canónico estricto, como `sorted(set(...))` en Python: sin repetidos y por puntos Unicode. */
function enOrdenEstricto<T>(filas: readonly T[], comparar: (a: T, b: T) => number): boolean {
  return filas.every((fila, indice) => indice === 0 || comparar(filas[indice - 1] as T, fila) < 0);
}

const evidencias = (valor: unknown): valor is readonly EvidenciaClasificacionCatalogo[] =>
  lista(evidencia, MAX_EVIDENCIAS)(valor) && enOrdenEstricto(valor, compararEvidencias);

function valores<const V extends readonly string[]>(vocabulario: V): Guarda<readonly V[number][]> {
  const codigo = unaDe(vocabulario);
  return (valor): valor is readonly V[number][] =>
    Array.isArray(valor) && valor.length > 0 && valor.every(codigo) && enOrdenEstricto(valor, compararTextos);
}

const camposApoyo = {
  estado: unaDe(ESTADOS_CLASIFICACION),
  alcance: esNuloO(unaDe(ALCANCES_CLASIFICACION)),
  certeza: esNuloO(unaDe(CERTEZAS_CLASIFICACION)),
  regla: esNuloO(regla),
  evidencias,
  motivo_por_confirmar: esNuloO(unaDe(MOTIVOS_POR_CONFIRMAR)),
};

/** No hay valor sin evidencia ni regla; un dato por confirmar no lleva valor y sí su motivo. */
function apoyoCoherente(dato: ApoyoClasificacionCatalogo, valor: unknown): boolean {
  const { estado, motivo_por_confirmar: motivo, evidencias: apoyos } = dato;
  if (estado === 'por-confirmar') {
    const admitidas = motivo === null ? null : EVIDENCIAS_DEL_MOTIVO[motivo];
    return (
      valor === null &&
      dato.alcance === null &&
      dato.certeza === null &&
      dato.regla === null &&
      admitidas !== null &&
      apoyos.length >= admitidas.minimo &&
      apoyos.length <= admitidas.maximo
    );
  }
  const apoyado = estado === 'fuente' ? apoyos.length > 0 && dato.regla === null : dato.regla !== null;
  return motivo === null && valor !== null && dato.alcance !== null && dato.certeza !== null && apoyado;
}

const idioma = forma({ ...camposApoyo, valores: esNuloO(valores(IDIOMAS_CLASIFICACION)) });
const nivel = forma({ ...camposApoyo, valor: esNuloO(unaDe(NIVELES_CLASIFICACION)) });
const materia = forma({ ...camposApoyo, valores: esNuloO(valores(MATERIAS_CLASIFICACION)) });
const DATOS = {
  idioma: (v: unknown) => idioma(v) && apoyoCoherente(v, v.valores),
  nivel: (v: unknown) => nivel(v) && apoyoCoherente(v, v.valor),
  materia: (v: unknown) => materia(v) && apoyoCoherente(v, v.valores),
} as const;
const esNombreDeDato = (nombre: string): nombre is keyof typeof DATOS => Object.hasOwn(DATOS, nombre);

/** El bloque lleva al menos uno de sus tres datos, y cada uno cumple su forma y la coherencia de su estado. */
export function esClasificacion(valor: unknown): valor is ClasificacionCatalogo {
  if (!esObjeto(valor)) {
    return false;
  }
  const nombres = Object.keys(valor);
  return nombres.length > 0 && nombres.every((nombre) => esNombreDeDato(nombre) && DATOS[nombre](valor[nombre]));
}

/** Las evidencias de todos los datos, para comprobar que ninguna es posterior al corte de la entrega. */
export function evidenciasDeClasificacion(
  clasificacion: ClasificacionCatalogo,
): readonly EvidenciaClasificacionCatalogo[] {
  return [clasificacion.idioma, clasificacion.nivel, clasificacion.materia].flatMap((dato) => dato?.evidencias ?? []);
}
