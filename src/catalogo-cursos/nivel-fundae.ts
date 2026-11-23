import { normalizar } from '../comun/texto.ts';
import type { NivelClasificado, NivelCurso } from './clasificacion.ts';
import type { OfertaCatalogo } from './contrato.ts';
import sepe from './niveles-especialidades-sepe.json' with { type: 'json' };
import programas from './niveles-programas-fundae.json' with { type: 'json' };

type FichaSepe = readonly [titulo: string, cualificacion: 1 | 2 | 3, version: string];
interface ProgramaRevisado {
  readonly titulo: string;
  readonly valor: NivelCurso;
  readonly url: string;
  readonly sha256: string;
  readonly capturadoEl: string;
  readonly localizador: string;
  readonly es: string;
  readonly ca: string;
}

const ESPECIALIDADES = sepe.especialidades as unknown as Readonly<Record<string, FichaSepe>>;
const PROGRAMAS = programas as Readonly<Record<string, ProgramaRevisado>>;
const NIVELES: Readonly<Record<1 | 2 | 3, NivelCurso>> = { 1: 'inicial', 2: 'intermedio', 3: 'avanzado' };
const ERRATAS: Readonly<Record<string, string>> = {
  IFCT0049: 'chatgpt e inteligencia artifical',
  ADGG21: 'herramientas colaborativas officce 365',
  IFCT118: 'social media redes sociales y comunity management',
};
const PREFIJO = 'fundae:oferta:programa:';
const OBJETIVOS = 'faro-objetivos-fundae-v1';

function nivelPorObjetivos(oferta: OfertaCatalogo): NivelClasificado | null {
  const dato = oferta.nivel_objetivos;
  if (
    !dato ||
    dato.version !== OBJETIVOS ||
    dato.titulo !== oferta.titulo_programa ||
    dato.programa_id !== oferta.unidad.programa_id ||
    dato.unidad_id !== oferta.unidad.id
  ) {
    return null;
  }
  const referencia = oferta.referencias.find((r) => r.url === dato.url && r.sha256 === dato.sha256);
  return referencia
    ? {
        valor: dato.valor,
        origen: 'faro',
        literal: null,
        alcance: 'orientacion',
        escala: 'inicial-intermedio-avanzado',
        evidencia: {
          url: dato.url,
          sha256: dato.sha256,
          capturadoEl: referencia.fecha_referencia,
          localizador: dato.localizador,
        },
        motivo: {
          es: 'Valoración de la complejidad de las tareas que figuran en los objetivos del programa.',
          ca: 'Valoració de la complexitat de les tasques que figuren en els objectius del programa.',
        },
      }
    : null;
}

function codigoAcreditado(oferta: OfertaCatalogo): string | null {
  const { unidad, idioma_programa: idioma } = oferta;
  if (
    oferta.proveedor_id !== 'fundae:publicador:catalogo:3' ||
    unidad.tipo !== 'edicion' ||
    !unidad.programa_id.startsWith(PREFIJO) ||
    !idioma
  ) {
    return null;
  }
  const codigo = unidad.programa_id.slice(PREFIJO.length);
  if (!URL.canParse(idioma.url)) {
    return null;
  }
  const url = new URL(idioma.url);
  return url.origin === 'https://agora.fundae.es' &&
    url.pathname === '/Oferta/RecuperarDifusionesRFO' &&
    url.searchParams.get('codigoTitulacion') === codigo &&
    oferta.referencias.some((r) => r.url === idioma.url && r.sha256 === idioma.sha256)
    ? codigo
    : null;
}

/** Orienta sobre el contenido o la cualificación de la especialidad que imparte la edición. */
export function nivelFundae(oferta: OfertaCatalogo): NivelClasificado | null {
  const codigo = codigoAcreditado(oferta);
  if (!codigo) {
    return null;
  }
  const titulo = normalizar(oferta.titulo_programa);
  const programa = Object.hasOwn(PROGRAMAS, codigo) ? PROGRAMAS[codigo] : undefined;
  if (programa?.titulo === titulo) {
    const { url, sha256, capturadoEl, localizador, es, ca } = programa;
    return {
      valor: programa.valor,
      origen: 'faro',
      literal: null,
      alcance: 'orientacion',
      escala: 'inicial-intermedio-avanzado',
      evidencia: { url, sha256, capturadoEl, localizador },
      motivo: { es, ca },
    };
  }
  const objetivos = nivelPorObjetivos(oferta);
  if (objetivos) {
    return objetivos;
  }
  const especialidad = Object.hasOwn(ESPECIALIDADES, codigo) ? ESPECIALIDADES[codigo] : undefined;
  if (!especialidad || (titulo !== especialidad[0] && titulo !== ERRATAS[codigo])) {
    return null;
  }
  const [, cualificacion, version] = especialidad;
  return {
    valor: NIVELES[cualificacion],
    origen: 'faro',
    literal: null,
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    evidencia: {
      ...sepe.evidencia,
      localizador: `${codigo}, versión ${version}, «Nivel de cualificación»`,
    },
    motivo: {
      es: `Orientación basada en el nivel de cualificación ${cualificacion} de esta especialidad según el SEPE (${sepe.fechaLegible}). Consulta los requisitos del centro.`,
      ca: `Orientació basada en el nivell de qualificació ${cualificacion} d’aquesta especialitat segons el SEPE (${sepe.fechaLegible}). Consulta els requisits del centre.`,
    },
  };
}
