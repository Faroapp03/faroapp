import type { Idioma } from '../comun/idioma.ts';
import type {
  ContratosMensualesBreve,
  GrupoOdeeBreve,
  InformeBreve,
  TiposDeContratoBreve,
} from './tipos-informe-breve.ts';
import type { Datos } from './tipos-paquete.ts';
import type { DatosObservatori } from './tipos-provincias.ts';

const CIFRAS_CNO_DEL_ESTUDIO = 3;
const POR_CIEN = 100;
const MESES_DEL_ANIO = 12;

export function exposicionDelGrupo(cnos: readonly string[], datos: Datos, idioma: Idioma): GrupoOdeeBreve | undefined {
  const gruposCno = [...new Set(cnos.map((codigo) => codigo.slice(0, CIFRAS_CNO_DEL_ESTUDIO)))];
  const [cno] = gruposCno;
  const grupos = datos.cambra.ocupaciones_cno3;
  const cortes = datos.cambra.escala?.cortes;
  if (!cno || gruposCno.length !== 1 || !grupos || !cortes) {
    return undefined;
  }
  const grupo = grupos[cno];
  const niveles = cortes.length + 1;
  if (!grupo || !Number.isInteger(grupo.nivel) || grupo.nivel < 1 || grupo.nivel > niveles) {
    return undefined;
  }
  const nivelesPublicados = Object.values(grupos).map((dato) => dato.nivel);
  const nombre = idioma === 'ca' ? datos.catalan?.grupos_cno11[cno] : undefined;
  const corte = cortes[grupo.nivel - 2];
  return {
    cno,
    nombre: nombre ?? datos.clasificaciones.cno11[cno]?.titulo ?? null,
    nivel: grupo.nivel,
    niveles,
    gruposEnElNivel: nivelesPublicados.filter((nivel) => nivel === grupo.nivel).length,
    gruposEstudiados: nivelesPublicados.length,
    desde: typeof corte === 'number' && Number.isFinite(corte) ? Math.round(POR_CIEN * corte) : null,
  };
}

function esRecuento(valor: number | null): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}

function contratosMensuales(
  cnos: readonly string[],
  observatori: DatosObservatori | undefined,
): ContratosMensualesBreve | undefined {
  const mensual = observatori?.mensual;
  const meses = mensual?.meses.slice(-MESES_DEL_ANIO);
  if (!mensual || !meses || meses.length !== MESES_DEL_ANIO || cnos.length === 0) {
    return undefined;
  }
  const series = cnos.map((codigo) => {
    const contratos = mensual.cno4[codigo]?.contratos;
    return contratos?.length === mensual.meses.length ? contratos.slice(-MESES_DEL_ANIO) : undefined;
  });
  if (!series.every((serie): serie is number[] => serie?.length === MESES_DEL_ANIO && serie.every(esRecuento))) {
    return undefined;
  }
  const valores = meses.map((_, i) => series.reduce((total, serie) => total + (serie[i] ?? 0), 0));
  return valores.some((valor) => valor > 0) ? { meses, valores } : undefined;
}

function tiposDeContrato(
  cnos: readonly string[],
  observatori: DatosObservatori | undefined,
): TiposDeContratoBreve | undefined {
  const [codigo] = cnos;
  if (!codigo || cnos.length !== 1 || !observatori) {
    return undefined;
  }
  const grupo = observatori.cataluna.cno4[codigo];
  const indefinidos = grupo?.pct_indefinidos;
  if (
    !grupo ||
    typeof indefinidos !== 'number' ||
    !Number.isFinite(indefinidos) ||
    indefinidos < 0 ||
    indefinidos > POR_CIEN
  ) {
    return undefined;
  }
  return {
    indefinidos,
    diasTemporales: grupo.duracion_media_temporales_dias,
    periodo: observatori.periodo,
  };
}

export function detalleDeContratos(
  cnos: readonly string[],
  observatori: DatosObservatori | undefined,
): Pick<InformeBreve['mercado'], 'mensual' | 'tiposDeContrato'> {
  const mensual = contratosMensuales(cnos, observatori);
  const tipos = tiposDeContrato(cnos, observatori);
  return { ...(mensual ? { mensual } : {}), ...(tipos ? { tiposDeContrato: tipos } : {}) };
}
