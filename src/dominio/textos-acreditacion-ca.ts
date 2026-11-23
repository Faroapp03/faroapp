// Los textos del bloque «Acreditar lo que ya sabes hacer» en catalán: los mismos que textos-acreditacion.ts, con la
// misma estructura y los mismos criterios (Faro orienta y no decide sobre la persona).

import { lista, numero } from '../comun/formato.ts';
import { EDAD_MINIMA_NIVEL_1, EDAD_MINIMA_NIVELES_2_Y_3, type TextosAcreditacion } from './textos-acreditacion.ts';

/** «al nivell 1», «als nivells 2 i 3»: los niveles de una lista de requisitos. */
function enLosNiveles(niveles: number[]): string {
  return `${niveles.length === 1 ? 'al nivell' : 'als nivells'} ${lista(niveles.map(String), 'ca')}`;
}

/** «Té 1 unitat de competència, que s’acredita…» o «Té 4 unitats…; cadascuna s’acredita…». */
function unidadesCa(cuantas: number): string {
  return cuantas === 1
    ? 'Té 1 unitat de competència, que s’acredita per si sola.'
    : `Té ${cuantas} unitats de competència; cadascuna s’acredita per separat.`;
}

/** Los textos del bloque de acreditación en catalán. */
export const TEXTOS_ACREDITACION_CA: TextosAcreditacion = {
  titulo: 'Acreditar el que ja saps fer',
  existe: {
    ocupacion:
      'L’acreditació de competències existeix per a la teva ocupació. És un tràmit públic de la Generalitat que ' +
      'reconeix de manera oficial el que s’aprèn treballant, sense necessitat de tenir cap títol.',
    grupo:
      'L’acreditació de competències existeix per al teu grup d’ocupacions. És un tràmit públic de la Generalitat que ' +
      'reconeix de manera oficial el que s’aprèn treballant, sense necessitat de tenir cap títol.',
  },
  sanidad:
    'Les competències de la teva ocupació estan lligades a una professió sanitària regulada: l’Agència FP.CAT no ' +
    'les acredita per aquesta via, perquè l’organisme que regula la professió no ho preveu (Reial decret 659/2023, ' +
    'art. 175.2). En un punt d’informació i orientació t’expliquen quines opcions hi ha.',
  soloSepe:
    'El SEPE relaciona alguns certificats professionals amb la teva ocupació, però Faro no ha comprovat aquesta relació ' +
    'en el reial decret de cada certificat. En un punt d’informació i orientació t’expliquen el procediment ' +
    'd’acreditació de competències.',
  sinRelacion:
    'Faro no té una relació oficial entre la teva ocupació i un certificat professional. En un punt ' +
    'd’informació i orientació t’expliquen el procediment d’acreditació de competències.',
  certificado: ({ nombre, codigo, nivel, unidades, relacion }) =>
    `El certificat professional ${nombre} (${codigo}, nivell ${nivel}) ` +
    (relacion === 'ocupacion'
      ? 'inclou la teva ocupació entre les seves ocupacions relacionades. '
      : 'inclou ocupacions del teu grup entre les seves ocupacions relacionades. ') +
    unidadesCa(unidades),
  etiquetaGrupo: 'Relacionada amb el teu grup d’ocupacions',
  sepe: {
    titulo: 'Altres certificats que el SEPE relaciona amb la teva ocupació',
    nota: (perfil, anio) =>
      `Ho diu el Servei Públic d’Ocupació Estatal (SEPE) en el seu perfil professional de «${perfil}» (${anio}). ` +
      'Faro no ha comprovat aquestes relacions una per una.',
    certificado: ({ nombre, codigo, nivel, unidades }) =>
      `El certificat professional ${nombre} (${codigo}, nivell ${nivel}). ${unidadesCa(unidades)}`,
    notaInforme:
      'El Servei Públic d’Ocupació Estatal (SEPE) relaciona aquests certificats amb la formació que necessita la ' +
      'teva ocupació. Faro no ha comprovat aquestes relacions una per una.',
    certificadoDelInforme: ({ nombre, codigo, nivel, unidades }, nombradas) =>
      `El certificat professional ${nombre} (${codigo}, nivell ${nivel}). ` +
      (nombradas.length === 0
        ? unidadesCa(unidades)
        : `El SEPE el relaciona amb la teva ocupació per ${nombradas.length === 1 ? 'aquesta unitat' : 'aquestes unitats'}: ` +
          `${lista(
            nombradas.map((unidad) => `«${unidad}»`),
            'ca',
          )}.`),
  },
  equivalencia: (actuales) => `Avui equival a ${actuales} (Reial decret 151/2022).`,
  comprueba: (fecha) =>
    'Comprova si compleixes els requisits. Faro no els comprova ni et demana aquestes dades: ho revisa l’Agència ' +
    `FP.CAT quan t’hi inscrius. Aquests requisits es van comprovar a les pàgines oficials el ${fecha}; confirma’ls ` +
    'a la pàgina del tràmit abans d’inscriure-t’hi.',
  requisitosTitulo: (niveles) =>
    `Requisits per inscriure-s’hi ${enLosNiveles(niveles)} (normativa estatal; confirma les xifres a la pàgina del ` +
    'tràmit)',
  requisitos: {
    documentacion:
      'Nacionalitat espanyola, certificat de registre de ciutadania de la UE, targeta de familiar de ciutadà de la UE, autorització de residència (o de residència i treball) vigent, o sol·licitud de protecció internacional.',
    edad: (nivel1) =>
      `Tenir ${nivel1 ? EDAD_MINIMA_NIVEL_1 : EDAD_MINIMA_NIVELES_2_Y_3} anys en el moment d’inscriure’t.`,
    experiencia: (nivel1, horasNivel1) => {
      if (!nivel1) {
        return (
          'En els últims 15 anys, almenys 3 anys d’experiència laboral, beca o voluntariat relacionats, amb un mínim ' +
          'de 2.000 hores; o, en els últims 10 anys, almenys 300 hores de formació relacionada.'
        );
      }
      const horas =
        horasNivel1 === null
          ? 'amb el mínim d’hores que indica la pàgina del tràmit'
          : `amb un mínim de ${numero(horasNivel1)} hores`;
      return (
        `En els últims 15 anys, almenys 2 anys d’experiència laboral, beca o voluntariat relacionats, ${horas}; ` +
        'o, en els últims 10 anys, almenys 200 hores de formació relacionada.'
      );
    },
    justificar:
      'Poder-ho justificar: informe de vida laboral i contracte o certificat d’empresa; si treballes per compte ' +
      'propi, vida laboral i descripció de l’activitat. Amb més de 25 anys i sense documents que ho provin, hi ha una ' +
      'inscripció provisional.',
    identificacion: 'DNI o NIE i identificació digital (idCAT Mòbil, Cl@ve o una altra) per fer el tràmit en línia.',
  },
  comoFunciona:
    'La inscripció és oberta tot l’any i és gratuïta; se’n fa una per cada qualificació professional. Una persona ' +
    'assessora revisa el teu historial i una d’avaluadora comprova la competència, normalment amb una entrevista ' +
    'sobre la teva feina. Per cada unitat demostrada s’expedeix una acreditació oficial que compta per al ' +
    'certificat professional i per convalidar mòduls d’un títol d’FP. La normativa fixa 6 mesos per resoldre; a la ' +
    'pràctica, de mitjana, uns 9–11 mesos (Sindicatura de Comptes, informe 15/2026).',
  cornella: (telefono) =>
    "A Cornellà t’informa el Servei Local d'Ocupació, que és punt d’informació i orientació de l’acreditació: a Can " +
    `Mercader, amb cita prèvia${telefono ? ` (telèfon ${telefono})` : ''}. La inscripció està oberta tot l’any.`,
  escala: ({ personas, pendientes, puntos, desde, hasta, pagina }) =>
    `A tot Catalunya, del ${desde} al ${hasta}, ${personas} persones van acreditar una qualificació professional ` +
    `sencera; quedaven ${pendientes} sol·licituds pendents, i hi ha ${puntos} punts d’informació i orientació ` +
    `(Agència FP.CAT, Memòria del Sistema FPCAT 2025, p. ${pagina}).`,
  expedicion:
    'Amb totes les unitats del certificat, per acreditació o per formació, el certificat professional es demana al SOC; el tràmit no té taxes.',
  modulos: (codigo) =>
    'Formació per mòduls del mateix certificat: cada unitat de competència té el seu mòdul formatiu. Aquests cursos ' +
    `imparteixen mòduls de ${codigo}:`,
  enlaces: {
    tramite: 'Inscripció i requisits: Acreditació de competències professionals (Tràmits gencat)',
    agencia: 'Informació de l’Agència FP.CAT: Em vull acreditar',
    orientacion: 'Punts d’informació i orientació: t’acompanyen en la inscripció',
    expedicion: 'Demanar el certificat professional al SOC',
  },
  fuente: (fecha) =>
    'Fonts: reials decrets de cada certificat, Reial decret 659/2023 i Llei orgànica 3/2022 (basat en dades de ' +
    "l'Agencia Estatal Boletín Oficial del Estado; textos consolidats de caràcter informatiu), INE, SOC, Agència " +
    `FP.CAT i Sindicatura de Comptes. Comprovat el ${fecha}.`,
};
