// Fixtures mínimos de censos, contratación y salarios; no dependen de paquetes externos ni de datos personales.

import type { DatosCenso, DatosOcupados, PerfilCenso } from '../../src/dominio/tipos-contexto.ts';
import type { GrupoContratacion } from '../../src/dominio/tipos-informe.ts';
import type { Datos, DatosCataluna } from '../../src/dominio/tipos-paquete.ts';
import type { DatosObservatori, Provincia } from '../../src/dominio/tipos-provincias.ts';
import { datosMinimos } from './datos-referencias-grupos.ts';

const PERSONAS_PERFIL_INSUFICIENTE = 999;
const PERSONAS_PERFIL_AMPLIO = 2000;
const PERSONAS_PERFIL_CONJUNTO = 10000;

/** Jerarquía con dos grupos de tres cifras en 21 y uno solo en 22. */
export function datosEstadisticos(partes: Partial<Datos> = {}): Datos {
  return datosMinimos({
    clasificaciones: {
      cno11: {
        '2': { titulo: 'Gran grupo', nivel: '1', padre: '' },
        '21': { titulo: 'Grupo amplio', nivel: '2', padre: '2' },
        '211': { titulo: 'Primer grupo', nivel: '3', padre: '21' },
        '212': { titulo: 'Segundo grupo', nivel: '3', padre: '21' },
        '22': { titulo: 'Grupo único', nivel: '2', padre: '2' },
        '221': { titulo: 'Tercer grupo', nivel: '3', padre: '22' },
      },
      isco08_es: {},
      isco08_a_cno11: {},
    },
    ...partes,
  });
}

/** Censo histórico con porcentajes distintos de los publicados por el censo anual. */
export function catalunaDePrueba(): DatosCataluna {
  return {
    fuentes: { censo: 'Censo de prueba', observatori: 'Observatori de prueba' },
    periodo_contratacion: 'Periodo general',
    min_variacion: 100,
    variacion_conjunto_ocupaciones: 0,
    ocupados_cno3: {
      '211': { ocupados: 2000, pct_mujeres: 40, pct_menores_30: 20, pct_55_o_mas: 15 },
      '221': { ocupados: 3000, pct_mujeres: null, pct_menores_30: null, pct_55_o_mas: null },
    },
    ocupados_cno2: { '21': { ocupados: 5000, pct_mujeres: 50, pct_menores_30: 25, pct_55_o_mas: 10 } },
    contratacion_cno4: {},
  };
}

/** Tres años desordenados y dos grupos que se reúnen en una misma comarca. */
export function ocupadosDePrueba(): DatosOcupados {
  return {
    fuentes: { idescat: 'Idescat de prueba' },
    anios: ['2024', '2022', '2023'],
    fecha_de_referencia: '2024-01-01',
    comparable_desde: '2022',
    min_personas: 100,
    cataluna_cno3: {
      total: { '2023': { ocupados: 10000, pct_mujeres: 50 }, '2024': { ocupados: 11000, pct_mujeres: 51 } },
      '211': { '2023': { ocupados: 1000, pct_mujeres: 40 }, '2024': { ocupados: 1101, pct_mujeres: 41 } },
      '221': { '2023': { ocupados: 999, pct_mujeres: null }, '2024': { ocupados: 1200, pct_mujeres: null } },
    },
    cataluna_cno2: {
      '21': { '2023': { ocupados: 5000, pct_mujeres: 48 }, '2024': { ocupados: 5100, pct_mujeres: 49 } },
    },
    territorios: {
      '11': {
        nombre: 'Baix Llobregat',
        tipo: 'comarca',
        comarca: null,
        cno2: {
          '21': { '2024': { ocupados: 200, pct_mujeres: 50 } },
          '22': { '2024': { ocupados: 100, pct_mujeres: null } },
        },
      },
    },
  };
}

/** Perfil del censo con campos de estudios y situación que el informe omite. */
export function perfilDePrueba(personas = 1000): PerfilCenso {
  return {
    personas,
    estudios: {
      hasta_secundaria_obligatoria: 30,
      bachillerato: 20,
      fp_grado_medio: 10,
      postsecundaria_no_superior: 5,
      fp_grado_superior: 20,
      universitarios: 15,
    },
    situacion: { indefinido: 60, temporal: 20, cuenta_propia: 15, otra: 5 },
  };
}

/** Censo de prueba con umbral y un grupo que requiere el nivel de dos cifras. */
export function censoDePrueba(): DatosCenso {
  return {
    fuentes: { censo: 'Censo de prueba' },
    fecha_de_referencia: '2021-01-01',
    min_personas_perfil: 1000,
    perfil_cno3: { '211': perfilDePrueba(), '212': perfilDePrueba(PERSONAS_PERFIL_INSUFICIENTE) },
    perfil_cno2: { '21': perfilDePrueba(PERSONAS_PERFIL_AMPLIO) },
    perfil_cataluna: perfilDePrueba(PERSONAS_PERFIL_CONJUNTO),
    ocupados_cataluna: { ocupados: 10000, pct_mujeres: 50, pct_menores_30: 20, pct_55_o_mas: 10 },
  };
}

/** Contratación completa: las provincias solo consumen código y título. */
export function contratacionDePrueba(cno11 = '2111'): GrupoContratacion {
  return { cno11, grupo: 'Primer grupo', personas: 100, anterior: null, variacion: null, pctIndefinidos: null };
}

/** Observatori con dos rótulos por idioma y un reparto provincial configurable. */
export function observatoriDePrueba(reparto: Record<Provincia, number>): DatosObservatori {
  return {
    fuentes: { observatori: 'Observatori de prueba' },
    periodo: 'Periodo general',
    min_base: 100,
    contrato_indefinido: { contratos_firmados: { periodo: { es: 'Periodo castellano', ca: 'Període català' } } },
    cataluna: {
      total: {
        personas_contratadas: 100,
        contratos: 100,
        contratos_por_persona: 1,
        pct_parcial: null,
        duracion_media_temporales_dias: null,
        demandantes_no_ocupados_12m: null,
        demandantes_no_ocupados_media: null,
        contratadas_por_demandante: null,
        pct_indefinidos: 50,
        variacion_personas_contratadas: null,
      },
      cno4: {},
    },
    provincias: { medida: 'Contratos', cita: 'Tabla de prueba', comarcas_partidas: [], cno4: { '2111': reparto } },
  };
}
