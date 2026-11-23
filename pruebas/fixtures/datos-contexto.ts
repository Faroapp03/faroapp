// Fixtures autónomos de la composición del contexto y sus dos vistas agregadas.

import type { DatosEures } from '../../compartido/contratos/tipos-eures.ts';
import type { GrupoParaComparar } from '../../src/dominio/frente-al-conjunto.ts';
import type { Datos, DatosCataluna } from '../../src/dominio/tipos-paquete.ts';
import {
  catalunaDePrueba,
  censoDePrueba,
  datosEstadisticos,
  observatoriDePrueba,
  ocupadosDePrueba,
} from './datos-estadisticas.ts';

const VARIACION_PUBLICADA = 5;
const VARIACION_SUMA_OCUPACIONES = 4;

function catalunaConContratacion(): DatosCataluna {
  const cataluna = catalunaDePrueba();
  cataluna.variacion_conjunto_ocupaciones = VARIACION_SUMA_OCUPACIONES;
  cataluna.contratacion_cno4 = {
    '2111': {
      personas_contratadas: 1000,
      personas_contratadas_anterior: 900,
      variacion_pct: 0,
      pct_indefinidos: 60,
      pct_mujeres_contratos: 40,
    },
    '2211': {
      personas_contratadas: 1000,
      personas_contratadas_anterior: 900,
      variacion_pct: -10,
      pct_indefinidos: null,
      pct_mujeres_contratos: null,
    },
  };
  return cataluna;
}

/** Paquete mínimo con fuentes de años distintos y dos ocupaciones de contratación. */
export function datosParaContexto(): Datos {
  const cataluna = catalunaConContratacion();
  const observatori = observatoriDePrueba({ Barcelona: 70, Girona: 20, Lleida: 10, Tarragona: 0 });
  observatori.cataluna.total.variacion_personas_contratadas = VARIACION_PUBLICADA;
  observatori.cataluna.cno4['2111'] = {
    ...observatori.cataluna.total,
    demandantes_no_ocupados_12m: 100,
    demandantes_no_ocupados_media: 0,
    contratadas_por_demandante: 0,
    pct_indefinidos: 0,
  };
  const datos = datosEstadisticos({
    cataluna,
    observatori,
    ocupados: ocupadosDePrueba(),
    censo: censoDePrueba(),
    salarios: {
      fuentes: { salarios: 'Encuesta de prueba' },
      anio: 2022,
      grandes_grupos: {
        '2': {
          total: 30000,
          estudios: {
            'Primera etapa de Educación Secundaria y similar': 20000,
            'Educación secundaria segunda etapa': 23000,
          },
          antiguedad: { 'De 4 a 10 años': 25000, 'Menos de 1 año': 0 },
        },
      },
    },
  });
  datos.clasificaciones.cno11['2111'] = { titulo: 'Ocupación primaria', nivel: '4', padre: '211' };
  datos.clasificaciones.cno11['2211'] = { titulo: 'Otra ocupación', nivel: '4', padre: '221' };
  datos.clasificaciones.isco08_a_cno11 = {
    '1111': [{ cno11: '2111', tipo: '1:1' }],
    '2222': [
      { cno11: '2211', tipo: '1:n' },
      { cno11: '2111', tipo: '1:n' },
    ],
  };
  return datos;
}

/** Correspondencias EURES sin especialidades ni cursos: solo intervienen en el desempate del contexto. */
export function euresConCorrespondencias(ocupaciones: DatosEures['ocupaciones']): DatosEures {
  return { fuente: 'EURES', ocupaciones };
}

/** Un grupo con variaciones y datos cero explícitos para probar la selección de filas. */
export function grupoParaComparar(): GrupoParaComparar {
  return {
    ocupados: [
      {
        cno11: '211',
        grupo: 'Primer grupo',
        amplio: false,
        organismo: 'Idescat',
        anio: '2024',
        personas: 1101,
        pctMujeres: 41,
        pctMenores30: 0,
        pct55: null,
        variacion: { desde: '2023', hasta: '2024', pct: -1, conjunto: 0 },
      },
    ],
    contratacion: [
      { cno11: '2111', grupo: 'Ocupación primaria', personas: 1000, anterior: 900, variacion: 0, pctIndefinidos: 0 },
    ],
    perfil: [
      {
        cno11: '211',
        grupo: 'Primer grupo',
        amplio: false,
        estudios: { obligatoria: 30, bachillerato: 20, fpGradoMedio: 10, fpGradoSuperior: 20, universitarios: 15 },
        situacion: { indefinido: 60, temporal: 20, cuentaPropia: 15 },
      },
    ],
    variacionConjunto: 0,
  };
}
