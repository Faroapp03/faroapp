// Textos fijos del informe en catalán, con la misma estructura que los castellanos (textos-informe.ts): catalán
// estándar (IEC, ortografía de 2016), de tú como el castellano y con los términos de la web (web/idiomas/ca.js):
// «ocupació», «tasca», «feina», franjas «alt, mitjà, baix».

import { porcentaje } from '../comun/formato.ts';
import {
  type DatosConfirmacion,
  FUENTE_DE_LA_OCUPACION,
  type GrupoNombrado,
  type TextosInforme,
} from './textos-informe.ts';

/**
 * Un participio catalán según lo que se confirma, a partir de su raíz («confirma»): un grupo, «confirmat»; dos grupos,
 * «confirmats»; una ocupación ESCO, femenino, «confirmada». El femenino no se forma añadiendo al masculino: la t pasa a
 * d («confirmat» → «confirmada»).
 */
function participio(raiz: string, secundario: GrupoNombrado | null, tituloEsco: string | null): string {
  if (secundario) {
    return `${raiz}ts`;
  }
  return tituloEsco ? `${raiz}da` : `${raiz}t`;
}

/**
 * La frase de la confirmación, como la castellana: «Grup 7512 · …, confirmat per tu a partir de «gelater»»; con una
 * ocupación ESCO, «confirmada»; con dos grupos, «confirmats».
 */
function textoConfirmacion({ grupo, secundario, tituloEsco, palabra, propuestoPorIa }: DatosConfirmacion): string {
  const grupos = secundario
    ? `Grups ${grupo.isco08} · ${grupo.tituloIsco} i ${secundario.isco08} · ${secundario.tituloIsco}`
    : `Grup ${grupo.isco08} · ${grupo.tituloIsco}`;
  const origen = palabra ? ` a partir de «${palabra}»` : '';
  if (propuestoPorIa) {
    const esco = tituloEsco ? ` · Ocupació «${tituloEsco}», triada per tu` : '';
    const propuesto = participio('proposa', secundario, null);
    const confirmado = participio('confirma', secundario, null);
    return `${grupos}, ${propuesto} per la IA de Faro i ${confirmado} per tu${origen}${esco}`;
  }
  const sujeto = tituloEsco ? `Ocupació «${tituloEsco}» · ${grupos}` : grupos;
  return `${sujeto}, ${participio('confirma', secundario, tituloEsco)} per tu${origen}`;
}

/** Los textos del informe en catalán. */
/**
 * La palabra con su artículo femenino: «l’» ante vocal o hache muda (l’alta, l’hora) y «la» en los demás casos. Ante i
 * y u átonas no se apostrofa (la universitat, la humitat); como la grafía no marca siempre si son tónicas, solo se
 * apostrofa ante las acentuadas (l’índia). Las palabras que recibe son los nombres de las franjas.
 */
export function ambArticleFemeni(paraula: string): string {
  return /^h?[aeoàèéòóíú]/iu.test(paraula) ? `l’${paraula}` : `la ${paraula}`;
}

export const TEXTOS_INFORME_CA: TextosInforme = {
  nivelGradiente: {
    gradiente_4: 'molt alta (nivell 4 de 4)',
    gradiente_3: 'alta (nivell 3 de 4)',
    gradiente_2: 'mitjana (nivell 2 de 4)',
    gradiente_1: 'baixa però variable (nivell 1 de 4)',
    exposicion_minima: 'mínima',
    no_expuesta: 'sense exposició apreciable',
  },
  sinNotaPublicada: 'sense nota publicada',
  plan: [
    {
      cuando: 'Aquesta setmana',
      paso: 'Mira en quines tasques et podria ajudar la IA',
      detalle: 'Comença per les de canvi alt i pensa què revisaries tu.',
    },
    {
      cuando: 'Aquest mes',
      paso: 'Revisa la formació oficial d’aquest informe',
      detalle: 'Comprova places, dates i requisits a la pàgina oficial de cada curs.',
    },
    {
      cuando: 'D’aquí a 6 mesos',
      paso: 'Torna a consultar Faro',
      detalle: 'Les fonts s’actualitzen i les teves tasques poden canviar.',
    },
  ],
  limites: [
    'No prediu si perdràs la feina ni quan.',
    'No avalua la teva capacitat, el teu rendiment ni el que et falta.',
    'No decideix què has d’aprendre: mostra la formació que les fonts oficials relacionen amb la teva ocupació; els suggeriments de Faro van marcats i tries tu.',
    'No sap com es treballa al teu centre concret ni si ja hi fan servir la IA.',
    'Les notes descriuen exposició potencial a IA generativa en tasques genèriques. No demostren que una eina concreta les executi bé ni que el teu centre l’adopti.',
    'El rang descriptiu no és un interval de confiança individual. Una nota estable entre repeticions pot ser errònia.',
    'Els textos «La IA podria» i «El que és teu» són explicacions orientatives; no són proves de funcionament d’eines.',
  ],
  fuentes: {
    notasPorTarea:
      'Notes per tasca que l’OIT publica amb el seu document de treball núm. 140 (Working Paper 140), al repositori de l’autor principal. Reutilitzables citant l’OIT segons la seva política d’accés obert.',
    esco: '© Unió Europea. ESCO v1.2.1, classificació europea de capacitats, competències, qualificacions i ocupacions. Faro selecciona i adapta aquestes dades.',
    ine: 'INE, CNO-11 i correspondència amb la CIUO-08.',
    cifrasVerificadas: 'Xifres verificades amb el PDF publicat.',
    elaboracionFaro: 'Traduccions, resums, franges i repartiment del temps: elaboració de Faro.',
    citilab: (fecha) =>
      `Citilab (citilab.eu): fitxes de formació consultades el ${fecha}. Faro només mostra fets de cada fitxa, amb el seu enllaç.`,
    nombresIdescat: (fecha) =>
      `Font: elaboració pròpia a partir de dades de l'Idescat. Noms oficials en català dels grups d’ocupació (CIUO-2008 (ca), CCO-2011 (ca) i la seva correspondència amb la CNO-2011), consultats el ${fecha} a www.idescat.cat.`,
    formacionAbierta: (criterio) =>
      `Formació oberta en línia: selecció de Faro amb el seu criteri publicat (${criterio}) i fitxes redactades per Faro amb l’enllaç a cada curs. Faro no rep res per aquests enllaços.`,
  },
  avisos: {
    ejemplo: 'Inclou una estimació d’exemple, que no ha calculat Faro.',
    sinValidar:
      'Inclou estimacions de Faro amb un rang provisional: encara no se n’ha mesurat l’error respecte a l’OIT.',
    textosConIa: 'Alguns textos de les tasques oficials estan traduïts o redactats amb IA.',
    sinCataluna: 'Aquesta versió de Faro no té dades de Catalunya per ocupació.',
    sinFormacion: 'Encara no hi ha dades de formació en aquesta versió de Faro.',
    inciertas:
      'Algunes estimacions de Faro són incertes: en repetir-les, la IA va donar notes molt diferents. Es mostren amb tot el seu rang.',
    insuficientes:
      'Algunes tasques no tenen nota publicada ni estimació: apareixen marcades com a informació insuficient.',
    sinReferencias:
      'L’OIT no publica notes de les tasques del teu grup d’ocupacions i Faro no té tasques de referència per estimar-les: apareixen marcades com a informació insuficient.',
    grupoSinEsco:
      'Vas confirmar el teu grup d’ocupacions a la classificació internacional (CIUO-08), però no una ocupació concreta del catàleg europeu ESCO. Per això les dades de Catalunya i la formació es refereixen a tot el grup.',
    competenciasSinOcupacion:
      'Les competències de les teves tasques venen del catàleg ESCO, però sense una ocupació ESCO no se sap si són essencials o opcionals a la teva feina.',
  },
  traduccion: {
    deFaro: 'Títols de les ocupacions, tasques oficials i frases de la IA traduïts al català amb IA.',
    sinTraducir:
      'Algunes dades oficials encara no tenen traducció al català: es mostren en castellà o en anglès, la llengua en què les tenen les fonts o Faro.',
  },
  confirmacion: textoConfirmacion,
  origen: {
    incierta:
      'Estimació incerta: en repetir-la, la IA va donar notes molt diferents; es mostra la mediana amb tot el seu rang. ',
    ejemplo: 'Valor d’exemple, fix en el cas d’aquesta pàgina: no l’ha calculat Faro',
    margenMedido:
      'el seu rang és la nota més i menys l’error mitjà més gran mesurat respecte a notes publicades de l’OIT',
    margenProvisional: 'rang provisional: encara no s’ha comparat amb l’OIT',
    metodoOit: (margen) =>
      `Estimació de Faro amb el mètode de l’OIT (les tasques oficials més semblants i els extrems de l’escala); ${margen}`,
    subgrupo:
      'Estimació de Faro amb els criteris de puntuació de l’OIT i tasques de referència d’ocupacions properes (mateix subgrup CIUO-08), perquè l’OIT no publica tasques d’aquesta ocupació; rang provisional',
    rubrica: (margen) => `Estimació de Faro amb els criteris de puntuació de l’OIT; ${margen}`,
    oficialEquivalente: ({ cita, isco08, indice }) =>
      `OIT 2025 · tasca oficial equivalent «${cita}», d’una altra ocupació (CIUO-08 ${isco08}, tasca ${indice})`,
    oficialDelGrupo: ({ cita, indice, isco08, titulo }) =>
      `OIT 2025 · tasca oficial «${cita}», tasca ${indice} del grup ${isco08} · ${titulo}`,
    oficialPropia: ({ cita, indice, isco08 }) =>
      `OIT 2025 · tasca oficial «${cita}», tasca ${indice} de la teva ocupació (CIUO-08 ${isco08})`,
    insuficiente: 'Informació insuficient: no hi ha nota publicada de l’OIT ni estimació de Faro per a aquesta tasca',
    estimacionNoDisponible: 'Estimació no disponible',
    sinReferencias:
      'Informació insuficient: l’OIT no publica notes de les tasques del teu grup d’ocupacions i Faro no té tasques de referència per estimar la d’aquesta tasca',
  },
  hallazgos: {
    sinDatos: {
      titulo: 'Faro no té prou dades sobre les teves tasques.',
      texto:
        'No hi ha notes publicades de l’OIT ni estimacions de Faro per a les tasques que has confirmat. Apareixen igualment a l’informe, marcades com a informació insuficient.',
      sinReferencias:
        'L’OIT no publica notes de les tasques del teu grup d’ocupacions i Faro no té tasques de referència per estimar-les. Apareixen igualment a l’informe, marcades com a informació insuficient.',
      detalle: 'Informació insuficient',
    },
    deLasQueTienenDatos: ' de les que tenen dades',
    detalleOit: 'Estimació de l’OIT · amb el seu rang',
    detalleOitYFaro: 'Estimació de l’OIT i de Faro',
    detalleFaro: 'Estimació de Faro amb els criteris de puntuació de l’OIT',
    segunOit: 'Segons l’OIT',
    segunOitYFaro: 'Segons l’OIT i l’estimació de Faro',
    segunFaro: 'Segons l’estimació de Faro',
    ningunaAlta: (deLas) => `Cap de les teves tasques${deLas} no té la nota a la franja alta.`,
    ningunaAltaTexto: 'El seu rang pot arribar a altres franges; consulta cada tasca.',
    franjas: { baja: 'baixa', media: 'mitjana', alta: 'alta' },
    loQueMasCambiaEntreFranjas: (tareas, desde, hasta, varias) =>
      `El que més pot canviar: ${tareas}; ${varias ? 'el marge d’alguna' : 'el seu marge'} va de la franja ${desde} a ${ambArticleFemeni(hasta)}.`,
    loQueMasCambia: (tareas) => `El que més pot canviar: ${tareas}.`,
    loQueMasCambiaTexto: (segunQuien) =>
      `${segunQuien}, les seves notes són a la franja alta d’exposició potencial a la IA generativa. Això no demostra que una eina concreta pugui fer-les correctament.`,
    todasCambian: (deLas) => `Totes les teves tasques${deLas} tenen algun potencial de canvi.`,
    todasCambianTexto: 'Cap no queda a la franja baixa.',
    loQueDependeDeTi: (tareas) => `El que més depèn de tu: ${tareas}.`,
    loQueDependeDeTiTexto: 'Són les tasques amb menys potencial de canvi amb la IA.',
    entreLasMasExpuestas: 'La teva ocupació és entre les més exposades a la IA generativa.',
    entreLasMenosExpuestas: 'La teva ocupació és entre les menys exposades a la IA generativa.',
    zonaIntermedia: 'La teva ocupació és en una zona intermèdia d’exposició a la IA generativa.',
    posicion: (masAltas, total) =>
      `A l’índex de l’OIT, ${masAltas} de ${total} ocupacions tenen una nota mitjana més alta. Descriu l’ocupació, no pas tu. L’OIT conclou que, en conjunt, és més probable que la IA generativa transformi les feines que no pas que les substitueixi.`,
    detallePosicion: 'Dada publicada per l’OIT, 2025',
  },
  caminos: {
    usarLaIa: (tareas) => `Fer servir la IA per a ${tareas}, sense perdre el control`,
    porqueMasCambia: (tareas, varias, dedicaMucho) => {
      const tiempo = dedicaMucho ? ' i hi dediques molt de temps' : '';
      return `${tareas} ${varias ? 'tenen' : 'té'} un potencial de canvi alt${tiempo}.`;
    },
    reforzar: 'Reforçar tasques d’exposició baixa',
    porqueSigueSiendoTuyo: (tareas, varias) =>
      `${tareas} ${varias ? 'estan' : 'està'} a la franja d’exposició baixa a la IA generativa.`,
  },
  objetivos: {
    profesional: (texto) => `Practicar «${texto}» amb un cas simulat i revisar el resultat amb una llista de criteris.`,
    ia: (texto) =>
      `Comparar una resposta d’IA per a «${texto}» amb fonts contrastables i explicar-ne els errors i límits.`,
  },
  contexto: {
    sinDatosCataluna: 'Aquesta versió de Faro no té dades de Catalunya per ocupació.',
    sinDatosOcupacion: 'No hi ha dades oficials de Catalunya per a aquesta ocupació.',
    demasiadosGrupos: (cantidad, codigos) =>
      `La teva ocupació es reparteix en ${cantidad} grups de l’estadística catalana (CNO-11 ${codigos}): són massa perquè una xifra la descrigui bé.`,
    fuenteGenero: (pagina) => `ODEE i Cambra de Comerç de Barcelona, 2026, pàg. ${pagina}`,
    avisoCenso: `Les xifres de persones ocupades surten de registres administratius, no d’una enquesta. Segons l’INE, l’ocupació és el més difícil de saber així. La pren sobretot dels contractes del SEPE (${porcentaje(FUENTE_DE_LA_OCUPACION.contratos)} dels casos); en el ${porcentaje(FUENTE_DE_LA_OCUPACION.imputada)} la calcula a partir d’altres dades. Per això alguns grups surten amb més persones que a l’Enquesta de població activa (EPA) i d’altres, amb menys (INE, metodologia dels Censos de població i habitatges 2021, pàg. 57 i 58).`,
  },
};
