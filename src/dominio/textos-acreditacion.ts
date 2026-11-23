// Textos del bloque «Acreditar lo que ya sabes hacer» (acreditacion.ts): la estructura (TextosAcreditacion) y los
// textos en castellano; textos-acreditacion-ca.ts tiene los mismos en catalán. Separados de la regla para revisarlos
// sin leer código. Faro orienta y no decide sobre la persona (criterio de diseño del proyecto): dice que el
// procedimiento existe para su ocupación y le da la lista de requisitos para que la compruebe ella, igual para todas
// las personas con la misma ocupación. No pide ni usa su edad ni su experiencia, no dice si cumple y no promete un
// resultado: los efectos se dicen del procedimiento («por cada unidad demostrada se expide…»), nunca de la persona
// («obtendrás», «podrás»). Las cifras de los requisitos son las de la normativa estatal (Real Decreto 659/2023, art.
// 177), comprobadas literales por plataforma_datos/cursos/fuentes/acreditacion/lector.py; las horas de experiencia del
// nivel 1 en Cataluña son las de la guía de la Agència FP.CAT y llegan con el paquete (`horas_nivel_1`); si faltaran,
// el texto remite a la página del trámite. El plazo real es el de la Sindicatura de Comptes (informe 15/2026).

import { lista, numero } from '../comun/formato.ts';
import type { RelacionAcreditacion } from './tipos-acreditacion.ts';

/** Edad mínima para inscribirse en el nivel 1. */
export const EDAD_MINIMA_NIVEL_1 = 18;
/** Edad mínima para inscribirse en los niveles 2 y 3. */
export const EDAD_MINIMA_NIVELES_2_Y_3 = 20;

/** Lo que dice un certificado en su presentación. */
export interface DatosCertificado {
  nombre: string;
  codigo: string;
  nivel: number;
  unidades: number;
  relacion: RelacionAcreditacion;
}

/** Todos los textos del bloque, en un idioma. Cada idioma tiene los mismos. */
export interface TextosAcreditacion {
  titulo: string;
  /** La primera frase del bloque según cómo se relaciona la ocupación con sus certificados. */
  existe: Record<RelacionAcreditacion, string>;
  /** Solo hay certificados de cualificaciones sanitarias que la Agència FP.CAT no acredita (profesiones reguladas). */
  sanidad: string;
  /**
   * Sin nada comprobado, pero con certificados que relaciona el SEPE: lo dice sin afirmar que la acreditación existe
   * para la ocupación, y remite a los puntos de orientación.
   */
  soloSepe: string;
  /** La línea neutra cuando Faro no tiene una relación oficial: remite a los puntos de orientación. */
  sinRelacion: string;
  /** La presentación de un certificado y de sus unidades. */
  certificado: (datos: DatosCertificado) => string;
  /** La etiqueta de un certificado relacionado solo por el grupo de ocupación. */
  etiquetaGrupo: string;
  /**
   * Los certificados que relaciona el SEPE en sus perfiles de la oferta de empleo, aparte de los comprobados: el título
   * del apartado, la nota de cada perfil (de dónde sale y que Faro no lo ha comprobado) y la presentación de cada uno,
   * que no dice que su real decreto nombre la ocupación.
   */
  sepe: {
    titulo: string;
    nota: (perfil: string, anio: number) => string;
    certificado: (datos: DatosCertificado) => string;
    /** La nota de los que relacionó en su informe de necesidades formativas: sin año (va en los créditos). */
    notaInforme: string;
    /** Un certificado del informe; si el SEPE lo relaciona solo por algunas unidades, las nombra. */
    certificadoDelInforme: (datos: DatosCertificado, unidadesNombradas: string[]) => string;
  };
  /** Una unidad suprimida y las que hoy la sustituyen (códigos y nombres ya unidos). */
  equivalencia: (actuales: string) => string;
  /** Antes de los requisitos: quién los revisa, cuándo los comprobó Faro y dónde confirmarlos. */
  comprueba: (fecha: string) => string;
  /** El título de la lista de requisitos de unos niveles. */
  requisitosTitulo: (niveles: number[]) => string;
  requisitos: {
    documentacion: string;
    edad: (nivel1: boolean) => string;
    /** La experiencia o la formación; `horasNivel1` es null si el paquete no trae la cifra de Cataluña. */
    experiencia: (nivel1: boolean, horasNivel1: number | null) => string;
    justificar: string;
    identificacion: string;
  };
  comoFunciona: string;
  /**
   * Dónde informarse en Cornellà, sin enlace: el Servei Local d'Ocupació es punto de información y orientación. El
   * teléfono es el de la página del Ajuntament que registra el paquete; sin él, la frase no da ninguno.
   */
  cornella: (telefono: string | null) => string;
  /** La escala del servicio en Cataluña (Memòria del Sistema FPCAT): cifras ya escritas, su periodo y su página. */
  escala: (cifras: {
    personas: string;
    pendientes: string;
    puntos: string;
    desde: string;
    hasta: string;
    pagina: number;
  }) => string;
  expedicion: string;
  /** Formación por módulos del mismo certificado (para cuando se enseñen sus cursos). */
  modulos: (codigo: string) => string;
  enlaces: { tramite: string; agencia: string; orientacion: string; expedicion: string };
  fuente: (fecha: string) => string;
}

/** «en el nivel 1», «en los niveles 2 y 3»: los niveles de una lista de requisitos. */
function enNiveles(niveles: number[]): string {
  return `en ${niveles.length === 1 ? 'el nivel' : 'los niveles'} ${lista(niveles.map(String))}`;
}

/** «Tiene 1 unidad de competencia, que se acredita…» o «Tiene 4 unidades…; cada una se acredita…». */
function unidadesEs(cuantas: number): string {
  return cuantas === 1
    ? 'Tiene 1 unidad de competencia, que se acredita por sí sola.'
    : `Tiene ${cuantas} unidades de competencia; cada una se acredita por separado.`;
}

/** Los textos del bloque de acreditación en castellano. */
export const TEXTOS_ACREDITACION_ES: TextosAcreditacion = {
  titulo: 'Acreditar lo que ya sabes hacer',
  existe: {
    ocupacion:
      'La acreditación de competencias existe para tu ocupación. Es un trámite público de la Generalitat que reconoce de forma oficial lo que se aprende trabajando, sin necesidad de tener un título.',
    grupo:
      'La acreditación de competencias existe para tu grupo de ocupaciones. Es un trámite público de la Generalitat que reconoce de forma oficial lo que se aprende trabajando, sin necesidad de tener un título.',
  },
  sanidad:
    'Las competencias de tu ocupación están ligadas a una profesión sanitaria regulada: la Agència FP.CAT no las acredita por esta vía, porque el organismo que regula la profesión no lo prevé (Real Decreto 659/2023, art. 175.2). En un punto de información y orientación te explican qué opciones hay.',
  soloSepe:
    'El SEPE relaciona algunos certificados profesionales con tu ocupación, pero Faro no ha comprobado esa relación en el real decreto de cada certificado. En un punto de información y orientación te explican el procedimiento de acreditación de competencias.',
  sinRelacion:
    'Faro no tiene una relación oficial entre tu ocupación y un certificado profesional. En un punto de información y orientación te explican el procedimiento de acreditación de competencias.',
  certificado: ({ nombre, codigo, nivel, unidades, relacion }) =>
    `El certificado profesional ${nombre} (${codigo}, nivel ${nivel}) ` +
    (relacion === 'ocupacion'
      ? 'incluye tu ocupación entre sus ocupaciones relacionadas. '
      : 'incluye ocupaciones de tu grupo entre sus ocupaciones relacionadas. ') +
    unidadesEs(unidades),
  etiquetaGrupo: 'Relacionada con tu grupo de ocupaciones',
  sepe: {
    titulo: 'Otros certificados que el SEPE relaciona con tu ocupación',
    nota: (perfil, anio) =>
      `Lo dice el Servicio Público de Empleo Estatal (SEPE) en su perfil profesional de «${perfil}» (${anio}). ` +
      'Faro no ha comprobado estas relaciones una a una.',
    certificado: ({ nombre, codigo, nivel, unidades }) =>
      `El certificado profesional ${nombre} (${codigo}, nivel ${nivel}). ${unidadesEs(unidades)}`,
    notaInforme:
      'El Servicio Público de Empleo Estatal (SEPE) relaciona estos certificados con la formación que necesita tu ocupación. Faro no ha comprobado estas relaciones una a una.',
    certificadoDelInforme: ({ nombre, codigo, nivel, unidades }, nombradas) =>
      `El certificado profesional ${nombre} (${codigo}, nivel ${nivel}). ` +
      (nombradas.length === 0
        ? unidadesEs(unidades)
        : `El SEPE lo relaciona con tu ocupación por ${nombradas.length === 1 ? 'esta unidad' : 'estas unidades'}: ` +
          `${lista(nombradas.map((unidad) => `«${unidad}»`))}.`),
  },
  equivalencia: (actuales) => `Hoy equivale a ${actuales} (Real Decreto 151/2022).`,
  comprueba: (fecha) =>
    'Comprueba si cumples los requisitos. Faro no los comprueba ni te pide estos datos: lo revisa la Agència FP.CAT al inscribirte. ' +
    `Estos requisitos se comprobaron en las páginas oficiales el ${fecha}; confírmalos en la página del trámite antes de inscribirte.`,
  requisitosTitulo: (niveles) =>
    `Requisitos para inscribirse ${enNiveles(niveles)} (normativa estatal; confirma las cifras en la página del ` +
    'trámite)',
  requisitos: {
    documentacion:
      'Nacionalidad española, certificado de registro de ciudadanía de la UE, tarjeta de familiar de ciudadano de la UE, autorización de residencia (o de residencia y trabajo) en vigor, o solicitud de protección internacional.',
    edad: (nivel1) => `${nivel1 ? EDAD_MINIMA_NIVEL_1 : EDAD_MINIMA_NIVELES_2_Y_3} años cumplidos al inscribirte.`,
    experiencia: (nivel1, horasNivel1) => {
      if (!nivel1) {
        return 'En los últimos 15 años, al menos 3 años de experiencia laboral, beca o voluntariado relacionados, con un mínimo de 2.000 horas; o, en los últimos 10 años, al menos 300 horas de formación relacionada.';
      }
      const horas =
        horasNivel1 === null
          ? 'con el mínimo de horas que indica la página del trámite'
          : `con un mínimo de ${numero(horasNivel1)} horas`;
      return (
        `En los últimos 15 años, al menos 2 años de experiencia laboral, beca o voluntariado relacionados, ${horas}; ` +
        'o, en los últimos 10 años, al menos 200 horas de formación relacionada.'
      );
    },
    justificar:
      'Poder justificarlo: informe de vida laboral y contrato o certificado de empresa; si trabajas por cuenta propia, vida laboral y descripción de la actividad. Con más de 25 años y sin papeles que lo prueben, existe una inscripción provisional.',
    identificacion: 'DNI o NIE e identificación digital (idCAT Mòbil, Cl@ve u otra) para hacer el trámite en línea.',
  },
  comoFunciona:
    'La inscripción está abierta todo el año y es gratuita; se hace una por cada cualificación profesional. Una persona asesora revisa tu historial y otra evaluadora comprueba la competencia, normalmente con una entrevista sobre tu trabajo. Por cada unidad demostrada se expide una acreditación oficial que cuenta para el certificado profesional y para convalidar módulos de un título de FP. La normativa fija 6 meses para resolver; en la práctica, de media, unos 9–11 meses (Sindicatura de Comptes, informe 15/2026).',
  cornella: (telefono) =>
    "En Cornellà te informa el Servei Local d'Ocupació, que es punto de información y orientación de la " +
    `acreditación: en Can Mercader, con cita previa${telefono ? ` (teléfono ${telefono})` : ''}. La inscripción está ` +
    'abierta todo el año.',
  escala: ({ personas, pendientes, puntos, desde, hasta, pagina }) =>
    `En toda Cataluña, de ${desde} a ${hasta}, ${personas} personas acreditaron una cualificación profesional entera; ` +
    `quedaban ${pendientes} solicitudes pendientes, y hay ${puntos} puntos de información y orientación (Agència ` +
    `FP.CAT, Memòria del Sistema FPCAT 2025, p. ${pagina}).`,
  expedicion:
    'Con todas las unidades del certificado, por acreditación o por formación, el certificado profesional se pide al SOC; el trámite no tiene tasas.',
  modulos: (codigo) =>
    'Formación por módulos del mismo certificado: cada unidad de competencia tiene su módulo formativo. Estos ' +
    `cursos imparten módulos de ${codigo}:`,
  enlaces: {
    tramite: 'Inscripción y requisitos: Acreditació de competències professionals (Tràmits gencat)',
    agencia: 'Información de la Agència FP.CAT: Em vull acreditar',
    orientacion: 'Puntos de información y orientación: te acompañan en la inscripción',
    expedicion: 'Pedir el certificado profesional al SOC',
  },
  fuente: (fecha) =>
    'Fuentes: reales decretos de cada certificado, Real Decreto 659/2023 y Ley Orgánica 3/2022 (basado en datos de la Agencia Estatal Boletín Oficial del Estado; textos consolidados de carácter informativo), INE, SOC, ' +
    `Agència FP.CAT y Sindicatura de Comptes. Comprobado el ${fecha}.`,
};
