/** Lector del compañero acreditado; ningún dato de la persona aporta identidades confiables. */
import type { EntregaCatalogo, OfertaCatalogo, ReferenciaEntregaCatalogo } from '../catalogo-cursos/contrato.ts';
import { esFecha, esSha, esUrl } from '../catalogo-cursos/forma.ts';
import { sha256Hex } from '../comun/huella.ts';
import { esBooleano, esFormaDe, esNuloO, esObjeto, type Guarda } from '../comun/json.ts';
import type { AfirmacionAprendizaje, Aprendizaje, RevisionAprendizaje } from './aprendizaje.ts';
import {
  AprendizajeNoValido,
  type CompaneroAprendizaje,
  CRITERIOS,
  ETAPAS,
  type FichaAprendizaje,
} from './contrato.ts';

export interface ReferenciaCompanero {
  readonly sha256: string;
  readonly bytes: number;
}
const MAX_BYTES = 4_194_304;
const MAX_FILAS = 10_000;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const MAX_TEXTO = 2_048;
const PRIMER_IMPRIMIBLE = 32;
const esTexto = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= MAX_TEXTO &&
  v.isWellFormed() &&
  !Array.from(v).some((c) => c.charCodeAt(0) < PRIMER_IMPRIMIBLE);
function uno<const V extends readonly string[]>(valores: V): Guarda<V[number]> {
  return (v): v is V[number] => typeof v === 'string' && valores.some((x) => x === v);
}
function lista<T>(guarda: Guarda<T>): Guarda<readonly T[]> {
  return (v): v is readonly T[] => Array.isArray(v) && v.length <= MAX_FILAS && v.every(guarda);
}
function forma<C extends Record<string, Guarda<unknown>>>(campos: C) {
  const comprobar = esFormaDe(campos);
  return (v: unknown): v is Parameters<typeof comprobar>[0] & Inferir<typeof comprobar> =>
    comprobar(v) && Object.keys(v).length === Object.keys(campos).length;
}
type Inferir<T> = T extends Guarda<infer V> ? V : never;
const metodo = forma({ nombre: esTexto, version: esTexto });
const registro = forma({ id: esTexto, version: esTexto, sha256: esSha });
const competencia = forma({ marco: esTexto, version: esTexto, codigo: esTexto });
const escala = forma({ id: esTexto, version: esTexto });
const revision: Guarda<RevisionAprendizaje> = forma({
  tipo: uno(['humana', 'automatizada']),
  referencia: esTexto,
  metodo,
  fecha_utc: esFecha,
});
const evidencia = forma({
  url: esUrl,
  capturado_utc: esFecha,
  sha256: esSha,
  localizador: forma({ tipo: uno(['objetivo', 'modulo', 'requisito']), valor: esTexto }),
  fragmento: esTexto,
});
const afirmacion: Guarda<AfirmacionAprendizaje> = forma({
  id: esTexto,
  competencia: esNuloO(competencia),
  dimension: uno(['requisito_entrada', 'resultado_previsto']),
  descripcion: esNuloO(esTexto),
  nivel: forma({ escala: esNuloO(escala), valor: esNuloO(esTexto) }),
  origen: uno(['extraccion_oficial', 'inferencia']),
  estado: uno(['extraida', 'propuesta', 'revisada']),
  metodo,
  revision: esNuloO(revision),
  evidencias: lista(evidencia),
  discrepancias: lista(forma({ descripcion: esTexto, evidencias: lista(evidencia) })),
  revision_requerida: esBooleano,
});
const aprendizaje: Guarda<Aprendizaje> = forma({
  schema_version: (v): v is 1 => v === 1,
  registro,
  contenido_observado: esBooleano,
  afirmaciones: lista(afirmacion),
});
const criterios = [...new Set(Object.values(CRITERIOS).flat())];
const textoRevisado = forma({ es: esTexto, ca: esTexto });
const cobertura = forma({
  criterio: uno(criterios),
  afirmaciones: lista(esTexto),
  justificacion: textoRevisado,
  via: esNuloO(uno(['verificacion_rigurosa', 'automatizacion_supervisada'])),
});
const ficha = forma({
  programa_id: esTexto,
  idioma_ficha: esNuloO(esTexto),
  aprendizaje,
  requisitos: uno(['publicados', 'no_publicados', 'sin_verificar']),
  cobertura: lista(cobertura),
  revision,
});
const camino = forma({
  id: esTexto,
  etapa: uno(ETAPAS),
  programas: lista(esTexto),
  justificacion: textoRevisado,
  revision,
});
const formaCompanero: Guarda<CompaneroAprendizaje> = forma({
  schema_version: (v): v is 1 => v === 1,
  catalogo: forma({
    sha256: esSha,
    bytes: (v): v is number => Number.isSafeInteger(v) && Number(v) > 0,
    revision: esSha,
  }),
  registro,
  registro_json: (v): v is string => typeof v === 'string' && v.length < MAX_BYTES,
  fichas: lista(ficha),
  caminos: lista(camino),
});

function exigir(condicion: boolean, mensaje: string): asserts condicion {
  if (!condicion) {
    throw new AprendizajeNoValido(mensaje);
  }
}
function unicos(ids: readonly string[], lugar: string): void {
  exigir(new Set(ids).size === ids.length, `Identidades repetidas en ${lugar}`);
}
function mismaReferencia(a: ReferenciaEntregaCatalogo, b: ReferenciaEntregaCatalogo): boolean {
  return a.sha256 === b.sha256 && a.bytes === b.bytes && a.revision === b.revision;
}
function validarRegistro(c: CompaneroAprendizaje) {
  exigir(sha256Hex(new TextEncoder().encode(c.registro_json)) === c.registro.sha256, 'Registro con huella distinta');
  const r: unknown = JSON.parse(c.registro_json);
  const esCompetencia = forma({
    marco: esTexto,
    version: esTexto,
    codigo: esTexto,
    denominacion: esTexto,
    fuente: esTexto,
  });
  const esEscala = forma({
    id: esTexto,
    version: esTexto,
    denominacion: esTexto,
    fuente: esTexto,
    valores: lista(esTexto),
  });
  const esRegistro = forma({
    id: esTexto,
    version: esTexto,
    competencias: lista(esCompetencia),
    escalas: lista(esEscala),
  });
  exigir(esRegistro(r) && r.id === c.registro.id && r.version === c.registro.version, 'Registro no reconocido');
  unicos(
    r.competencias.map((x) => JSON.stringify([x.marco, x.version, x.codigo])),
    'competencias',
  );
  unicos(
    r.escalas.map((x) => JSON.stringify([x.id, x.version])),
    'escalas',
  );
  for (const e of r.escalas) {
    exigir(e.valores.length > 0, 'Escala vacía');
    unicos(e.valores, 'valores de escala');
  }
  return r;
}
type RegistroNativo = ReturnType<typeof validarRegistro>;
function validarNivel(x: AfirmacionAprendizaje, r: RegistroNativo): void {
  if (x.competencia !== null) {
    exigir(
      r.competencias.some(
        (comp) =>
          comp.marco === x.competencia?.marco &&
          comp.version === x.competencia.version &&
          comp.codigo === x.competencia.codigo,
      ),
      'Competencia no registrada',
    );
  }
  const escala =
    x.nivel.escala === null
      ? undefined
      : r.escalas.find((e) => e.id === x.nivel.escala?.id && e.version === x.nivel.escala.version);
  exigir(x.nivel.escala === null || escala !== undefined, 'Escala desconocida');
  if (x.nivel.valor === null) {
    return;
  }
  exigir(
    escala?.valores.includes(x.nivel.valor) === true &&
      r.competencias.some(
        (comp) =>
          comp.marco === x.competencia?.marco &&
          comp.version === x.competencia.version &&
          comp.codigo === x.competencia.codigo,
      ),
    'Nivel sin escala y competencia registradas',
  );
  exigir(
    x.dimension !== 'requisito_entrada' ||
      (x.origen === 'extraccion_oficial' && x.evidencias.some((e) => e.localizador.tipo === 'requisito')),
    'Entrada inferida como nivel oficial',
  );
}
function validarEvidencias(x: AfirmacionAprendizaje, ofertas: readonly OfertaCatalogo[]): void {
  for (const d of x.discrepancias) {
    exigir(d.evidencias.length > 0, 'Discrepancia sin evidencia');
  }
  for (const e of [...x.evidencias, ...x.discrepancias.flatMap((d) => d.evidencias)]) {
    exigir(
      ofertas.some((o) =>
        o.referencias.some(
          (ref) => ref.url === e.url && ref.sha256 === e.sha256 && ref.fecha_referencia === e.capturado_utc,
        ),
      ),
      'Evidencia ajena a las capturas de esta entrega',
    );
  }
}
function validarAfirmacion(x: AfirmacionAprendizaje, r: RegistroNativo, ofertas: readonly OfertaCatalogo[]): void {
  const conocida = x.descripcion !== null || x.competencia !== null || x.nivel.valor !== null;
  exigir(!conocida || x.evidencias.length > 0, 'Afirmación sin evidencia');
  exigir(
    (x.origen === 'extraccion_oficial' && x.estado === 'extraida') ||
      (x.origen === 'inferencia' && ['propuesta', 'revisada'].includes(x.estado)),
    'Origen incompatible con estado',
  );
  exigir((x.estado === 'revisada') === (x.revision !== null), 'Revisión incoherente');
  exigir(x.origen !== 'extraccion_oficial' || (x.descripcion !== null && x.evidencias.length > 0), 'Extracción vacía');
  exigir(
    x.dimension !== 'resultado_previsto' || !conocida || x.evidencias.some((e) => e.localizador.tipo !== 'requisito'),
    'Resultado sin objetivo ni módulo',
  );
  validarNivel(x, r);
  validarEvidencias(x, ofertas);
}
function validarCobertura(f: FichaAprendizaje): void {
  const a = f.aprendizaje;
  exigir(
    f.requisitos !== 'no_publicados' || !a.afirmaciones.some((x) => x.dimension === 'requisito_entrada'),
    'Requisitos publicados negados',
  );
  exigir(
    f.requisitos !== 'publicados' || a.afirmaciones.some((x) => x.dimension === 'requisito_entrada'),
    'Requisitos publicados vacíos',
  );
  unicos(
    f.cobertura.map((x) => x.criterio),
    'cobertura',
  );
  for (const cobertura of f.cobertura) {
    exigir(
      cobertura.afirmaciones.length > 0 &&
        cobertura.afirmaciones.every((id) =>
          a.afirmaciones.some((x) => x.id === id && x.dimension === 'resultado_previsto'),
        ),
      'Cobertura sin resultado',
    );
    unicos(cobertura.afirmaciones, 'resultados de cobertura');
    exigir((cobertura.criterio === 'caso_complejo') === (cobertura.via !== null), 'Vía avanzada incoherente');
  }
}
function validarFicha(
  f: FichaAprendizaje,
  c: CompaneroAprendizaje,
  r: RegistroNativo,
  catalogo: EntregaCatalogo,
): void {
  const a = f.aprendizaje;
  exigir(
    a.registro.id === c.registro.id &&
      a.registro.version === c.registro.version &&
      a.registro.sha256 === c.registro.sha256,
    'Afirmaciones de otro registro',
  );
  exigir(a.contenido_observado || a.afirmaciones.length === 0, 'Afirmaciones sin contenido observado');
  unicos(
    a.afirmaciones.map((x) => x.id),
    'afirmaciones',
  );
  const ofertas = catalogo.ofertas.filter((o) => o.unidad.programa_id === f.programa_id);
  exigir(ofertas.length > 0, 'Aprendizaje sin programa en la entrega');
  exigir(
    ofertas.every((o) => o.unidad.tipo === 'recurso' && o.unidad.id === f.programa_id),
    'El aprendizaje de esta versión solo admite recursos sin ediciones',
  );

  for (const x of a.afirmaciones) {
    validarAfirmacion(x, r, ofertas);
  }
  validarCobertura(f);
}
function validarRelaciones(c: CompaneroAprendizaje, catalogo: EntregaCatalogo): void {
  const r = validarRegistro(c);
  unicos(
    c.fichas.map((f) => f.programa_id),
    'fichas',
  );
  unicos(
    c.caminos.map((f) => f.id),
    'caminos',
  );
  for (const f of c.fichas) {
    validarFicha(f, c, r, catalogo);
  }
  for (const camino of c.caminos) {
    exigir(camino.programas.length > 0, 'Camino sin recursos');
    unicos(camino.programas, 'recursos del camino');
  }
}
/** La composición aporta ambas referencias confiables: nunca se aceptan las declaradas por el cuerpo descargado. */
export function leerCompanero(
  bytes: Uint8Array,
  referencia: ReferenciaCompanero,
  referenciaCatalogo: ReferenciaEntregaCatalogo,
  catalogo: EntregaCatalogo,
): CompaneroAprendizaje {
  exigir(
    esSha(referencia.sha256) &&
      Number.isSafeInteger(referencia.bytes) &&
      referencia.bytes > 0 &&
      referencia.bytes <= MAX_BYTES &&
      bytes.byteLength === referencia.bytes &&
      sha256Hex(bytes) === referencia.sha256,
    'El aprendizaje no coincide con la publicación admitida',
  );
  let dato: unknown;
  try {
    dato = JSON.parse(UTF8.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new AprendizajeNoValido('Aprendizaje JSON UTF-8 inválido', { cause: error });
    }
    throw error;
  }
  exigir(
    formaCompanero(dato) &&
      mismaReferencia(dato.catalogo, referenciaCatalogo) &&
      catalogo.revision === referenciaCatalogo.revision,
    'Aprendizaje de otra entrega o contrato no admitido',
  );
  validarRelaciones(dato, catalogo);
  const pendientes: unknown[] = [dato];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (Array.isArray(actual) || esObjeto(actual)) {
      Object.freeze(actual);
      pendientes.push(...Object.values(actual));
    }
  }
  return dato;
}
