/**
 * La única pieza que decide qué afirmación de requisito es una condición. Aplica la revisión editorial mientras la
 * frase publicada sea exactamente la revisada, para el mismo programa y la misma afirmación. Si la frase cambia, la
 * decisión deja de aplicarse y la afirmación vuelve a pedir confirmación; nunca se interrumpe el plan por ello.
 */
import type { AfirmacionAprendizaje } from './aprendizaje.ts';
import type { CasoRequisito, FichaAprendizaje, RequisitoRevisado } from './contrato.ts';
import { type DecisionRequisito, REVISION_REQUISITOS } from './requisitos-revisados.ts';

export type Revision = Readonly<Record<string, DecisionRequisito>>;

/** La clave con la que se guarda la confirmación: el mismo ID local no confirma el requisito de otro programa. */
function idDeRequisito(programa: string, afirmacion: string): string {
  return JSON.stringify([programa, afirmacion]);
}
/** La decisión que corresponde a la afirmación, o null si no la hay o su frase ya no es la publicada. */
function decisionVigente(id: string, afirmacion: AfirmacionAprendizaje, revision: Revision): DecisionRequisito | null {
  const decision = Object.hasOwn(revision, id) ? revision[id] : undefined;
  return decision && decision.literal === afirmacion.descripcion ? decision : null;
}
/** Una decisión aplicada que se revisó sobre otra captura de la página: es un dato informativo, no bloquea. */
function revisadaSobreOtraCaptura(id: string, afirmacion: AfirmacionAprendizaje, revision: Revision): boolean {
  const decision = decisionVigente(id, afirmacion, revision);
  return decision !== null && !afirmacion.evidencias.some((e) => e.sha256 === decision.revisadaSobre);
}
function caso(decision: DecisionRequisito | null): CasoRequisito {
  if (!decision) {
    return 'sin_revisar';
  }
  return decision.tipo === 'condicion' ? 'condicion' : 'informativa';
}
/** Las afirmaciones de requisito con texto publicado de una ficha, cada una con su caso. */
export function requisitosDeFicha(
  ficha: FichaAprendizaje,
  revision: Revision = REVISION_REQUISITOS,
): RequisitoRevisado[] {
  return ficha.aprendizaje.afirmaciones.flatMap((a) => {
    if (a.dimension !== 'requisito_entrada' || a.descripcion === null) {
      return [];
    }
    const id = idDeRequisito(ficha.programa_id, a.id);
    const decision = decisionVigente(id, a, revision);
    return [
      {
        id,
        programa_id: ficha.programa_id,
        caso: caso(decision),
        descripcion: a.descripcion,
        idioma: ficha.idioma_ficha,
        resumen: decision?.tipo === 'condicion' ? decision.resumen : null,
      },
    ];
  });
}
/** Lo informativo se lee sin casilla; una condición revisada o una afirmación sin revisar se confirma. */
export function pideConfirmacion(requisito: RequisitoRevisado): boolean {
  return requisito.caso !== 'informativa';
}
export interface MedidaRequisitos {
  readonly condicion: number;
  readonly informativa: number;
  readonly sin_revisar: number;
  /** Afirmaciones con decisión cuyo texto literal ya no coincide: forman parte de sin_revisar. */
  readonly decisiones_literal_distinto: number;
  /** Decisiones cuyo identificador no corresponde a ninguna afirmación publicada. */
  readonly decisiones_sin_afirmacion: number;
  /** De las decisiones aplicadas, cuántas se revisaron sobre una captura distinta de la publicada. */
  readonly aplicadas_sobre_otra_captura: number;
}
/** Cuenta, para unas fichas, cuántas afirmaciones de requisito caen en cada caso y cuántas decisiones no se aplican. */
export function medirRequisitos(
  fichas: readonly FichaAprendizaje[],
  revision: Revision = REVISION_REQUISITOS,
): MedidaRequisitos {
  const requisitos = fichas.flatMap((f) => requisitosDeFicha(f, revision));
  const afirmaciones = fichas.flatMap((f) =>
    f.aprendizaje.afirmaciones
      .filter((a) => a.dimension === 'requisito_entrada')
      .map((a) => ({ id: idDeRequisito(f.programa_id, a.id), afirmacion: a })),
  );
  const publicadas = new Set(afirmaciones.map((a) => a.id));
  const contar = (c: CasoRequisito) => requisitos.filter((r) => r.caso === c).length;
  return {
    condicion: contar('condicion'),
    informativa: contar('informativa'),
    sin_revisar: contar('sin_revisar'),
    decisiones_literal_distinto: requisitos.filter((r) => r.caso === 'sin_revisar' && Object.hasOwn(revision, r.id))
      .length,
    decisiones_sin_afirmacion: Object.keys(revision).filter((id) => !publicadas.has(id)).length,
    aplicadas_sobre_otra_captura: afirmaciones.filter((a) => revisadaSobreOtraCaptura(a.id, a.afirmacion, revision))
      .length,
  };
}
