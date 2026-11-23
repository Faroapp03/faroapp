import { jsonCanonico } from '../comun/jcs.ts';
import type { NivelClasificado, NivelCurso } from './clasificacion.ts';
import type { OfertaCatalogo } from './contrato.ts';
import type { IdiomaEnriquecido } from './idioma-nivel.ts';
import fichas from './niveles-fichas-cibernarium.json' with { type: 'json' };

interface FichaRevisada {
  readonly titulo: string;
  readonly contenido: string;
  readonly valor: NivelCurso;
  readonly es: string;
  readonly ca: string;
  readonly url: string;
  readonly sha256: string;
  readonly capturadoEl: string;
  readonly localizador: string;
  readonly idioma?: {
    readonly edicion: string;
    readonly valor: string;
    readonly sesiones: readonly { readonly inicio: string; readonly fin: string }[];
    readonly localizador: string;
  };
}
const FICHAS = fichas as Readonly<Record<string, FichaRevisada>>;

function fichaDe(oferta: OfertaCatalogo): FichaRevisada | null {
  const { unidad, evidencia_materia: materia } = oferta;
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    unidad.tipo !== 'edicion' ||
    materia?.programa_id !== unidad.programa_id ||
    materia.edicion_id !== unidad.id ||
    !materia.contenido
  ) {
    return null;
  }
  const id = unidad.programa_id.replace(/^cibernarium:/u, '');
  const ficha = Object.hasOwn(FICHAS, id) ? FICHAS[id] : undefined;
  return ficha?.titulo === oferta.titulo_programa && ficha.contenido === materia.contenido.sha256 ? ficha : null;
}

export function nivelCibernariumPorFicha(oferta: OfertaCatalogo): NivelClasificado | null {
  const ficha = fichaDe(oferta);
  if (!ficha) {
    return null;
  }
  const { url, sha256, capturadoEl, localizador, es, ca } = ficha;
  return {
    valor: ficha.valor,
    origen: 'faro',
    literal: null,
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    evidencia: { url, sha256, capturadoEl, localizador },
    motivo: { es, ca },
  };
}

export function idiomaCibernariumPorFicha(oferta: OfertaCatalogo): IdiomaEnriquecido | null {
  const ficha = fichaDe(oferta);
  const idioma = ficha?.idioma;
  const calendario = oferta.hechos.calendario_formacion;
  if (
    !ficha ||
    !idioma ||
    idioma.edicion !== oferta.unidad.id ||
    calendario.motivo !== 'conocido' ||
    jsonCanonico(calendario.valor) !== jsonCanonico({ tipo: 'sesiones', sesiones: idioma.sesiones })
  ) {
    return null;
  }
  return {
    valores: [idioma.valor],
    origen: 'fuente',
    alcance: 'programa',
    evidencias: [
      { url: ficha.url, sha256: ficha.sha256, capturadoEl: ficha.capturadoEl, localizador: idioma.localizador },
    ],
    motivo: {
      es: 'Lengua indicada en la ficha del programa para la sesión presencial que muestra.',
      ca: 'Llengua indicada a la fitxa del programa per a la sessió presencial que mostra.',
    },
  };
}
