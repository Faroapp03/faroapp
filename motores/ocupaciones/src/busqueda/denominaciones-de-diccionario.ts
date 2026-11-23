// Nombres de oficio de uso general que los títulos oficiales de ESCO no recogen, ligados a la ocupación GENERAL que
// nombran y con su fuente en el diccionario normativo. No son equivalencias de palabra (consulta.ts): son nombres de
// una ocupación, así que no cambian otros usos de la palabra («cuido a personas dependientes» sigue siendo cuidados).
//
// Criterio de denominación: «empezar de lo más genérico a lo más específico, salvo que haya alguna especificación».
// ESCO no tiene «dependiente» como nombre del vendedor general (5223.4), solo como alternativo de especialidades, y
// «dependienta» llevaba a «vendedora especializada en mascotas y comida para mascotas».

import americanismosYAnglicismos from './americanismos-anglicismos.json' with { type: 'json' };
import siglas from './siglas.json' with { type: 'json' };
import vocabulario from './vocabulario-calle.json' with { type: 'json' };

/** Los nombres de una ocupación en castellano y en catalán, con la fuente que los respalda. */
interface DenominacionDeDiccionario {
  readonly es: readonly string[];
  readonly ca: readonly string[];
  readonly fuente: string;
}

/**
 * Una sigla ambigua solo en minúscula («pas», «al», «me» son palabras corrientes): escrita en mayúsculas es la sigla
 * («sóc PAS de la UB», «soy AL en un cole»). Lo marca siglas.json con `solo_en_mayusculas`.
 */
function soloEnMayusculas(s: (typeof siglas.siglas)[number]): boolean {
  return 'solo_en_mayusculas' in s && s.solo_en_mayusculas === true;
}

/**
 * La marca con que se busca una sigla que solo lo es en mayúsculas: «PAS» → «siglapas». No es ninguna palabra, así que
 * no la encuentra «pas» en minúscula; textoComoEnEsco (ocupaciones.ts) la pone en lugar de la sigla escrita en
 * mayúsculas.
 */
export function marcaDeSigla(forma: string): string {
  return `sigla${forma.toLowerCase()}`;
}

/** Las formas de las siglas que solo lo son en mayúsculas («PAS», «AL», «ME»…), tal como se escriben. */
export const SIGLAS_SOLO_EN_MAYUSCULAS: readonly string[] = [
  ...new Set(siglas.siglas.filter(soloEnMayusculas).flatMap((s) => [...s.formas.es, ...s.formas.ca])),
];

/** Unos nombres que se suman a unas ocupaciones: sus grafías en cada idioma y su fuente. */
interface NombresSumados {
  readonly esco: readonly string[];
  readonly es: readonly string[];
  readonly ca: readonly string[];
  readonly fuente: string;
}

/**
 * Lo que se suma al diccionario: las siglas de oficio (siglas.json: «DUE», «TCAI», «VS», «PDI»…; las ambiguas, como
 * «AL», «PAS» o «CAP», no entran solas), los nombres de la calle (vocabulario-calle.json: «paleta», «segurata»,
 * «manyà»…; fuera los ofensivos y los ambiguos) y los americanismos y anglicismos de oficio
 * (americanismos-anglicismos.json: «plomero», «mesero», «flight attendant»…; mismos criterios, redactados de las
 * fuentes sin mirar los bancos de prueba).
 */
const SUMADOS: readonly NombresSumados[] = [
  ...siglas.siglas
    .filter((s) => !('ambigua' in s && s.ambigua) || soloEnMayusculas(s))
    .map((s) => {
      const formas = (lista: readonly string[]) => (soloEnMayusculas(s) ? lista.map(marcaDeSigla) : lista);
      return {
        esco: s.esco,
        es: formas(s.formas.es),
        ca: formas(s.formas.ca),
        fuente: `Sigla «${s.sigla}»: ${s.fuente}`,
      };
    }),
  ...[...vocabulario.nombres, ...americanismosYAnglicismos.nombres].map((n) => ({
    esco: n.esco,
    es: n.idioma === 'es' ? [n.nombre] : [],
    ca: n.idioma === 'ca' ? [n.nombre] : [],
    fuente: `«${n.nombre}»: ${n.fuente}`,
  })),
];

/** El diccionario con los nombres sumados: si la ocupación ya tenía nombres, se juntan. */
function conNombresSumados(
  base: ReadonlyMap<string, DenominacionDeDiccionario>,
): ReadonlyMap<string, DenominacionDeDiccionario> {
  const mapa = new Map(base);
  for (const s of SUMADOS) {
    for (const esco of s.esco) {
      const antes = mapa.get(esco);
      mapa.set(esco, {
        es: [...new Set([...(antes?.es ?? []), ...s.es])],
        ca: [...new Set([...(antes?.ca ?? []), ...s.ca])],
        fuente: antes ? `${antes.fuente} ${s.fuente}` : s.fuente,
      });
    }
  }
  return mapa;
}

/**
 * Nombres alternativos de ESCO que en el uso común nombran OTRA ocupación: se retiran de la ocupación de ESCO para que
 * no compitan con la del diccionario. «portero/portera» es en ESCO-es un alternativo de
 * «mozo de equipaje» (9621.2), pero para el DLE es quien guarda la puerta y el portal de un edificio (5153.1); el
 * portero
 * de hotel tiene su propia ocupación (9621.1).
 */
const ALTERNATIVOS_RETIRADOS: ReadonlyMap<string, { readonly es: readonly string[]; readonly ca: readonly string[] }> =
  new Map([['9621.2', { es: ['portero', 'portera'], ca: ['porter', 'portera'] }]]);

/** Si un nombre de una ocupación de ESCO está retirado (ALTERNATIVOS_RETIRADOS), sin mayúsculas ni tildes. */
export function nombreRetirado(esco: string, nombre: string, idioma: 'es' | 'ca'): boolean {
  const llano = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  return (ALTERNATIVOS_RETIRADOS.get(esco)?.[idioma] ?? []).some((r) => llano(r) === llano(nombre));
}

export const DENOMINACIONES_DE_DICCIONARIO: ReadonlyMap<string, DenominacionDeDiccionario> = conNombresSumados(
  new Map([
    [
      '5223.4',
      {
        es: ['dependiente', 'dependienta', 'tendero', 'tendera'],
        ca: ['dependent', 'dependenta'],
        fuente:
          'DLE (RAE), «dependiente, ta»: persona que tiene por oficio atender a los clientes en las tiendas; DIEC (IEC), ' +
          '«dependent, -a»: persona empleada que atén la clientela en una botiga.',
      },
    ],
    [
      // «vendo autos», «vendo coches»: ESCO lo llama «vendedor especializado en vehículos de
      // motor», como casi nadie lo escribe.
      '5223.7.25',
      {
        es: [
          'vendedor de coches',
          'vendedora de coches',
          'vendedor de autos',
          'vendedora de autos',
          'vendedor de automóviles',
          'vendedora de automóviles',
        ],
        ca: ['venedor de cotxes', 'venedora de cotxes', "venedor d'automòbils", "venedora d'automòbils"],
        fuente:
          'DLE (RAE), «coche»: automóvil; «auto²»: automóvil. DIEC (IEC), «cotxe»: automòbil. ESCO nombra el oficio ' +
          '«vendedor especializado en vehículos de motor» (5223).',
      },
    ],
    [
      '5221.1',
      {
        es: ['tendero', 'tendera', 'comerciante', 'estanquero', 'estanquera'],
        ca: ['fruiter', 'fruitera', 'estanquer'],
        fuente:
          '«tendero»: DLE: tendero, dueño o dependiente de una tienda; «tendera»: DLE: tendero, ra (femenino); «comerciante»: uso común; «estanquero»: DLE: estanquero, persona que tiene a su cargo un estanco; «estanquera»: DLE: estanquero, ra (femenino); «fruiter»: DIEC: fruiter; «fruitera»: femení; «estanquer»: DIEC: estanquer',
      },
    ],
    [
      '5211.1',
      {
        es: ['kiosquero', 'quiosquero', 'vendedor de cupones'],
        ca: ['fruiter', 'fruitera', 'quiosquer'],
        fuente:
          '«kiosquero»: DLE: quiosquero (grafía con k usual); «quiosquero»: DLE: quiosquero; «vendedor de cupones»: uso común (ONCE); «fruiter»: DIEC: fruiter; «fruitera»: femení; «quiosquer»: DIEC: quiosquer',
      },
    ],
    [
      // «dependienta / vendedora / empleada de estanco»: con la especificación, la ocupación
      // concreta y no la vendedora general; quien lleva el estanco es «gerente de estanco» (1420.4.42, ya en ESCO).
      '5223.7.36',
      {
        es: [
          'estanquero',
          'estanquera',
          'dependiente de estanco',
          'dependienta de estanco',
          'vendedor de estanco',
          'vendedora de estanco',
          'empleado de estanco',
          'empleada de estanco',
        ],
        ca: ['estanquer', 'dependent d’estanc', 'dependenta d’estanc', 'venedor d’estanc', 'venedora d’estanc'],
        fuente:
          '«estanquero»: DLE: estanquero, persona que tiene a su cargo un estanco; «estanquera»: DLE: estanquero, ra (femenino); «estanquer»: DIEC: estanquer; «dependiente / vendedor / empleado de estanco»: DLE, «estanco»: establecimiento donde se venden, con autorización oficial, sellos, tabaco y otros efectos',
      },
    ],
    ['5230.2', { es: ['vendedor de cupones'], ca: [], fuente: '«vendedor de cupones»: uso común (ONCE)' }],
    ['1420.4', { es: ['store manager'], ca: [], fuente: '«store manager»: uso común en cadenas de tiendas' }],
    [
      '5222.1',
      {
        es: ['store manager', 'jefe de sección'],
        ca: ['cap de secció'],
        fuente:
          '«store manager»: uso común en cadenas de tiendas; «jefe de sección»: uso común en grandes superficies; «cap de secció»: ús comú',
      },
    ],
    [
      '1420.2',
      {
        es: ['jefe de sección'],
        ca: ['cap de secció'],
        fuente: '«jefe de sección»: uso común en grandes superficies; «cap de secció»: ús comú',
      },
    ],
    ['3321.1', { es: ['vendedor de seguros'], ca: [], fuente: '«vendedor de seguros»: uso común' }],
    ['3321.3.1', { es: ['vendedor de seguros'], ca: [], fuente: '«vendedor de seguros»: uso común' }],
    [
      '5242.1',
      {
        es: ['promotora', 'azafata de promociones'],
        ca: [],
        fuente: '«promotora»: uso común (promociones en tienda); «azafata de promociones»: uso común',
      },
    ],
    [
      '9520.1',
      {
        es: ['mantero'],
        ca: ['manter'],
        fuente: '«mantero»: DLE: mantero, persona que vende en la calle sobre una manta; «manter»: ús comú a Barcelona',
      },
    ],
    [
      '9112.4',
      {
        es: ['kelly'],
        ca: ['cambrera de pis'],
        fuente: '«kelly»: uso común (las kellys, camareras de piso); «cambrera de pis»: ús comú als hotels',
      },
    ],
    [
      '9111.1',
      {
        es: ['asistenta', 'interna'],
        ca: ['dona de fer feines', 'minyona'],
        fuente:
          '«asistenta»: DLE: asistenta, mujer que hace las tareas domésticas por horas; «interna»: uso común (trabajar de interna en una casa); «dona de fer feines»: DIEC: dona de fer feines; «minyona»: DIEC: minyona, criada (ús antic)',
      },
    ],
    [
      '5152.2',
      {
        es: ['interna'],
        ca: ['minyona'],
        fuente: '«interna»: uso común (trabajar de interna en una casa); «minyona»: DIEC: minyona, criada (ús antic)',
      },
    ],
    [
      '5322.1',
      {
        es: ['interna', 'cuidadora', 'cuidador', 'trabajadora familiar', 'auxiliar SAD'],
        ca: ['cuidadora de gent gran', 'cuidador de gent gran', 'treballadora familiar'],
        fuente:
          "«interna»: uso común (trabajar de interna en una casa); «cuidadora»: uso común (ambiguo: mayores o niños); «cuidador»: uso común; «trabajadora familiar»: uso común en el servicio de atención domiciliaria; «auxiliar SAD»: servicio de atención domiciliaria; «cuidadora de gent gran»: ús comú; «cuidador de gent gran»: ús comú; «treballadora familiar»: ús comú al servei d'atenció domiciliària",
      },
    ],
    ['9123.1', { es: ['limpiacristales'], ca: [], fuente: '«limpiacristales»: uso común' }],
    [
      '9613.1',
      {
        es: ['operario de limpieza viaria'],
        ca: ['operari de neteja viària'],
        fuente:
          '«operario de limpieza viaria»: uso común en ayuntamientos; «operari de neteja viària»: ús comú als ajuntaments',
      },
    ],
    [
      '9611.1',
      { es: ['chatarrero'], ca: [], fuente: '«chatarrero»: DLE: chatarrero, persona que recoge o vende chatarra' },
    ],
    [
      '9612.1',
      { es: ['chatarrero'], ca: [], fuente: '«chatarrero»: DLE: chatarrero, persona que recoge o vende chatarra' },
    ],
    [
      // «portero» y «conserje»: en ESCO-es «portero» solo era alternativo de «mozo de
      // equipaje» (9621.2, retirado en ALTERNATIVOS_RETIRADOS) y el conserje de edificio no tenía ningún alternativo.
      '5153.1',
      {
        es: ['portero', 'portera', 'conserje'],
        ca: ['porter de finca', 'portera', 'conserge', "conserge d'escola", 'bidell'],
        fuente:
          "«portero», «portera»: DLE: portero, ra, persona que tiene a su cargo el guardar, cerrar y abrir las puertas y el aseo de los portales; «conserje»: DLE: conserje, persona que tiene a su cargo la custodia, limpieza y llaves de un edificio; «porter de finca»: ús comú; «portera»: femení; «conserge»: DIEC: conserge; «conserge d'escola»: ús comú; «bidell»: DIEC: bidell",
      },
    ],
    [
      '9622.1',
      {
        es: ['operario de mantenimiento', 'manitas'],
        ca: ['operari de manteniment', 'manetes'],
        fuente:
          '«operario de mantenimiento»: uso común; «manitas»: DLE: manitas, persona habilidosa; «operari de manteniment»: ús comú; «manetes»: DIEC: manetes, persona hàbil en feines manuals',
      },
    ],
    [
      '7233.7',
      {
        es: ['operario de mantenimiento'],
        ca: ['operari de manteniment'],
        fuente: '«operario de mantenimiento»: uso común; «operari de manteniment»: ús comú',
      },
    ],
    ['5321.1.1', { es: ['TCAE'], ca: [], fuente: '«TCAE»: técnico en cuidados auxiliares de enfermería' }],
    ['5329.3', { es: ['TCAE'], ca: [], fuente: '«TCAE»: técnico en cuidados auxiliares de enfermería' }],
    [
      '5321.1',
      {
        es: ['auxiliar de geriatría', 'cuidadora', 'cuidador'],
        ca: ['cuidadora de gent gran', 'cuidador de gent gran', 'auxiliar de geriatria'],
        fuente:
          '«auxiliar de geriatría»: uso común; «cuidadora»: uso común (ambiguo: mayores o niños); «cuidador»: uso común; «cuidadora de gent gran»: ús comú; «cuidador de gent gran»: ús comú; «auxiliar de geriatria»: ús comú',
      },
    ],
    [
      '5311.1',
      {
        es: ['cuidadora', 'cuidador', 'monitora de comedor', 'monitor de comedor', 'educadora de guardería', 'TEI'],
        ca: ['cuidadora de nens', 'monitora de menjador', 'monitor de menjador', "educadora de llar d'infants"],
        fuente:
          "«cuidadora»: uso común (ambiguo: mayores o niños); «cuidador»: uso común; «monitora de comedor»: uso común en escuelas; «monitor de comedor»: uso común en escuelas; «educadora de guardería»: uso común; «TEI»: técnico en educación infantil; «cuidadora de nens»: ús comú; «monitora de menjador»: ús comú a les escoles; «monitor de menjador»: ús comú a les escoles; «educadora de llar d'infants»: ús comú",
      },
    ],
    [
      '5311.1.2',
      {
        es: ['canguro'],
        ca: ['cangur'],
        fuente:
          '«canguro»: DLE: canguro, persona que cuida niños a domicilio; «cangur»: ús comú: persona que té cura de criatures per hores',
      },
    ],
    [
      '5311.1.4',
      {
        es: ['canguro'],
        ca: ['cangur'],
        fuente:
          '«canguro»: DLE: canguro, persona que cuida niños a domicilio; «cangur»: ús comú: persona que té cura de criatures per hores',
      },
    ],
    [
      '5312.2',
      {
        es: ['monitora de comedor', 'monitor de comedor'],
        ca: ['monitora de menjador', 'monitor de menjador'],
        fuente:
          '«monitora de comedor»: uso común en escuelas; «monitor de comedor»: uso común en escuelas; «monitora de menjador»: ús comú a les escoles; «monitor de menjador»: ús comú a les escoles',
      },
    ],
    [
      '2342.1',
      {
        es: ['educadora de guardería'],
        ca: ["educadora de llar d'infants", 'mestra', 'mestre', 'senyo'],
        fuente:
          "«educadora de guardería»: uso común; «educadora de llar d'infants»: ús comú; «mestra»: DIEC: mestre, -a (femení); «mestre»: DIEC: mestre; «senyo»: ús comú a l'escola (la senyo)",
      },
    ],
    ['5312.1', { es: ['TEI'], ca: [], fuente: '«TEI»: técnico en educación infantil' }],
    ['2330.1', { es: ['profesor de ESO'], ca: [], fuente: '«profesor de ESO»: educación secundaria obligatoria' }],
    [
      '2359.14',
      {
        es: ['profesor de repaso'],
        ca: ['professor de repàs'],
        fuente: '«profesor de repaso»: uso común (clases de repaso); «professor de repàs»: ús comú',
      },
    ],
    ['3423.2.2', { es: ['personal trainer'], ca: [], fuente: '«personal trainer»: uso común' }],
    ['3422.3.1', { es: ['míster'], ca: [], fuente: '«míster»: DLE: míster, entrenador de fútbol' }],
    ['1345.1', { es: ['director de colegio'], ca: [], fuente: '«director de colegio»: uso común' }],
    ['1345.1.6', { es: ['director de colegio'], ca: [], fuente: '«director de colegio»: uso común' }],
    [
      '1345.1.2',
      {
        es: ['jefe de estudios'],
        ca: ["cap d'estudis"],
        fuente: "«jefe de estudios»: uso común en centros educativos; «cap d'estudis»: ús comú",
      },
    ],
    ['2635.1', { es: ['mediador intercultural'], ca: [], fuente: '«mediador intercultural»: uso común en Cataluña' }],
    ['3412.4', { es: ['mediador intercultural'], ca: [], fuente: '«mediador intercultural»: uso común en Cataluña' }],
    [
      '2359.8',
      {
        es: ['psicopedagoga', 'psicopedagogo'],
        ca: [],
        fuente: '«psicopedagoga»: uso común; «psicopedagogo»: uso común',
      },
    ],
    [
      '2351.2',
      {
        es: ['psicopedagoga', 'psicopedagogo'],
        ca: [],
        fuente: '«psicopedagoga»: uso común; «psicopedagogo»: uso común',
      },
    ],
    [
      '2212.1',
      {
        // «doctor» y «doctora» solos son el médico general (2211.1): los bancos lo esperan así («doctora», «trabajo de
        // doctora»); quien es especialista dice su especialidad.
        es: [
          'psiquiatra',
          'médico',
          'MIR',
          'pediatra',
          'ginecólogo',
          'ginecóloga',
          'anestesista',
          'oculista',
          'dermatólogo',
          'cardiólogo',
          'radiólogo',
        ],
        ca: ['pediatre', 'ginecòleg'],
        fuente:
          '«psiquiatra»: DLE: psiquiatra; «médico»: DLE: médico; «MIR»: médico interno residente; «pediatra»: DLE: pediatra; «ginecólogo»: DLE: ginecólogo; «ginecóloga»: femenino; «anestesista»: DLE: anestesista, médico especialista en anestesia; «oculista»: DLE: oculista, médico de los ojos; «dermatólogo»: DLE: dermatólogo; «cardiólogo»: DLE: cardiólogo; «radiólogo»: DLE: radiólogo, médico especialista en radiología; «pediatre»: DIEC: pediatre; «ginecòleg»: DIEC: ginecòleg',
      },
    ],
    [
      '2211.1',
      {
        es: ['médico', 'doctor', 'doctora', 'MIR'],
        ca: [],
        fuente:
          '«médico»: DLE: médico; «doctor»: DLE: doctor, coloq. médico; «doctora»: DLE: doctor, ra (femenino), coloq. médica; «MIR»: médico interno residente',
      },
    ],
    [
      '2221.2',
      {
        es: ['DUE', 'ATS'],
        ca: [],
        fuente: '«DUE»: diplomado universitario en enfermería; «ATS»: ayudante técnico sanitario (nombre antiguo)',
      },
    ],
    ['3258.1', { es: ['TES'], ca: [], fuente: '«TES»: técnico en emergencias sanitarias' }],
    [
      '3255.1',
      {
        es: ['quiromasajista'],
        ca: ['quiromassatgista'],
        fuente: '«quiromasajista»: uso común; «quiromassatgista»: ús comú',
      },
    ],
    [
      '5142.7',
      {
        es: ['quiromasajista'],
        ca: ['quiromassatgista'],
        fuente: '«quiromasajista»: uso común; «quiromassatgista»: ús comú',
      },
    ],
    [
      '5412.1',
      {
        es: ['mosso'],
        ca: ["mosso d'esquadra", "mossa d'esquadra"],
        fuente:
          "«mosso»: uso común en Cataluña (Mossos d'Esquadra); «mosso d'esquadra»: ús comú; «mossa d'esquadra»: femení",
      },
    ],
    ['5419.8', { es: ['urbano'], ca: [], fuente: '«urbano»: uso común en Barcelona (Guardia Urbana)' }],
    ['5419.2', { es: ['urbano'], ca: [], fuente: '«urbano»: uso común en Barcelona (Guardia Urbana)' }],
    ['5414.1', { es: ['segurata'], ca: [], fuente: '«segurata»: DLE: segurata, coloq. vigilante de seguridad' }],
    [
      '5414.1.5',
      {
        es: ['controlador de acceso'],
        ca: [],
        fuente: '«controlador de acceso»: uso común (figura legal en ocio nocturno)',
      },
    ],
    ['5413.2', { es: ['carcelero'], ca: [], fuente: '«carcelero»: DLE: carcelero' }],
    ['5132.1', { es: ['bartender'], ca: [], fuente: '«bartender»: uso común' }],
    ['5131.2', { es: ['runner'], ca: [], fuente: '«runner»: uso común en restaurantes' }],
    ['7512.1', { es: ['churrero'], ca: [], fuente: '«churrero»: DLE: churrero' }],
    [
      '5212.1',
      { es: ['churrero', 'heladero'], ca: [], fuente: '«churrero»: DLE: churrero; «heladero»: DLE: heladero' },
    ],
    ['1412.1', { es: ['dueño de bar'], ca: [], fuente: '«dueño de bar»: uso común' }],
    ['5111.2.1', { es: ['TCP'], ca: [], fuente: '«TCP»: tripulante de cabina de pasajeros' }],
    [
      '9331.1',
      {
        es: ['rider', 'glover'],
        ca: ['repartidor de menjar'],
        fuente:
          '«rider»: uso común (reparto en plataformas); «glover»: uso común en Barcelona (de la plataforma de reparto); «repartidor de menjar»: ús comú',
      },
    ],
    [
      '8321.1',
      {
        es: ['rider', 'glover'],
        ca: ['repartidor de menjar'],
        fuente:
          '«rider»: uso común (reparto en plataformas); «glover»: uso común en Barcelona (de la plataforma de reparto); «repartidor de menjar»: ús comú',
      },
    ],
    [
      // «repartidor», «repartidora» solos: en ESCO solo hay repartidores con apellido
      // (de correspondencia, de folletos, de cartas de casino) y la primera pantalla preguntaba por familias generales.
      '8322.2',
      {
        es: ['butanero', 'repartidor', 'repartidora'],
        ca: ['repartidor', 'repartidora'],
        fuente:
          '«butanero»: DLE: butanero, repartidor de bombonas de butano; «repartidor»: DLE: repartidor, ra, persona que tiene por oficio repartir géneros a domicilio; DIEC: repartidor, -a',
      },
    ],
    [
      '8311.1',
      {
        es: ['conductor de metro', 'maquinista'],
        ca: [],
        fuente: '«conductor de metro»: uso común; «maquinista»: DLE: maquinista',
      },
    ],
    [
      '8344.1',
      {
        es: ['conductor de toro'],
        ca: ['carretoner'],
        fuente:
          '«conductor de toro»: uso común (toro, carretilla elevadora); «carretoner»: ús comú a les ofertes de feina (carretó elevador)',
      },
    ],
    ['9333.4', { es: ['mozo'], ca: [], fuente: '«mozo»: uso común (mozo de almacén)' }],
    [
      '9333.3',
      {
        es: ['preparador de pedidos', 'picker'],
        ca: ['preparador de comandes'],
        fuente:
          '«preparador de pedidos»: uso común; «picker»: uso común en logística; «preparador de comandes»: ús comú',
      },
    ],
    [
      '9333.8.1',
      {
        es: ['preparador de pedidos'],
        ca: ['preparador de comandes'],
        fuente: '«preparador de pedidos»: uso común; «preparador de comandes»: ús comú',
      },
    ],
    [
      '9329.1',
      {
        es: ['operario de producción', 'operaria de producción', 'peón', 'obrero'],
        ca: ['peó', 'operari de producció'],
        fuente:
          '«operario de producción»: uso común en ofertas de empleo; «operaria de producción»: femenino; «peón»: DLE: peón; «obrero»: DLE: obrero; «peó»: DIEC: peó; «operari de producció»: ús comú',
      },
    ],
    [
      '9313.1',
      {
        es: ['peón', 'peón de obra', 'obrero'],
        ca: ['manobre', 'peó', "peó d'obra"],
        fuente:
          "«peón»: DLE: peón; «peón de obra»: uso común; «obrero»: DLE: obrero; «manobre»: DIEC: manobre, peó que serveix el paleta; «peó»: DIEC: peó; «peó d'obra»: ús comú",
      },
    ],
    [
      '9211.1',
      {
        es: ['peón', 'peón agrícola', 'temporero', 'temporera'],
        ca: ['peó', 'temporer'],
        fuente:
          '«peón»: DLE: peón; «peón agrícola»: uso común; «temporero»: DLE: temporero; «temporera»: femenino; «peó»: DIEC: peó; «temporer»: ús comú (campanya de la fruita)',
      },
    ],
    ['9213.1', { es: ['peón agrícola'], ca: [], fuente: '«peón agrícola»: uso común' }],
    [
      '9211.2',
      {
        es: ['temporero', 'temporera'],
        ca: ['temporer', 'veremador'],
        fuente:
          '«temporero»: DLE: temporero; «temporera»: femenino; «temporer»: ús comú (campanya de la fruita); «veremador»: DIEC: veremador',
      },
    ],
    [
      '6130.2',
      {
        es: ['payés', 'payesa', 'campesino'],
        ca: ['pagès', 'pagesa'],
        fuente:
          '«payés»: DLE: payés, campesino de Cataluña; «payesa»: DLE: payés, sa (femenino); «campesino»: DLE: campesino; «pagès»: DIEC: pagès; «pagesa»: femení',
      },
    ],
    [
      '6114.1',
      {
        es: ['payés', 'payesa', 'campesino'],
        ca: ['pagès', 'pagesa'],
        fuente:
          '«payés»: DLE: payés, campesino de Cataluña; «payesa»: DLE: payés, sa (femenino); «campesino»: DLE: campesino; «pagès»: DIEC: pagès; «pagesa»: femení',
      },
    ],
    ['6112.2.1', { es: ['viticultor'], ca: [], fuente: '«viticultor»: DLE: viticultor' }],
    ['6112.6', { es: ['viticultor'], ca: [], fuente: '«viticultor»: DLE: viticultor' }],
    ['6113.2', { es: ['hortelano'], ca: [], fuente: '«hortelano»: DLE: hortelano' }],
    [
      '6210.1',
      {
        es: ['guardabosques'],
        ca: ['llenyataire'],
        fuente: '«guardabosques»: DLE: guardabosque; «llenyataire»: DIEC: llenyataire',
      },
    ],
    ['7112.1', { es: ['paleta'], ca: [], fuente: '«paleta»: DLE: paleta, albañil; muy usado en Cataluña' }],
    [
      '7123.2',
      {
        es: ['yesero', 'pladurista', 'instalador de pladur'],
        ca: [],
        fuente:
          '«yesero»: DLE: yesero; «pladurista»: uso común en obra (de la marca de placas de yeso); «instalador de pladur»: uso común',
      },
    ],
    [
      '7127.1',
      {
        es: ['frigorista', 'técnico de aire acondicionado'],
        ca: [],
        fuente: '«frigorista»: uso común; «técnico de aire acondicionado»: uso común',
      },
    ],
    [
      '7412.7',
      { es: ['ascensorista'], ca: [], fuente: '«ascensorista»: DLE: ascensorista, persona que arregla ascensores' },
    ],
    [
      '8153.1',
      { es: ['maquinista de confección'], ca: [], fuente: '«maquinista de confección»: uso común en el textil' },
    ],
    ['8157.1', { es: ['tintorero'], ca: [], fuente: '«tintorero»: DLE: tintorero' }],
    [
      '7511.4',
      {
        es: ['cortador de jamón', 'deshuesador'],
        ca: ['desossador'],
        fuente:
          '«cortador de jamón»: uso común; «deshuesador»: uso común en la industria cárnica; «desossador»: ús comú a la indústria càrnia',
      },
    ],
    ['2423.3', { es: ['técnico de RRHH'], ca: [], fuente: '«técnico de RRHH»: recursos humanos' }],
    ['2423.6', { es: ['headhunter', 'recruiter'], ca: [], fuente: '«headhunter»: uso común; «recruiter»: uso común' }],
    [
      '2512.4',
      {
        es: ['developer', 'backend developer'],
        ca: ['informàtic'],
        fuente: '«developer»: uso común; «backend developer»: uso común; «informàtic»: DIEC: informàtic',
      },
    ],
    ['2514.2', { es: ['developer'], ca: [], fuente: '«developer»: uso común' }],
    [
      '2513.5',
      {
        es: ['developer', 'frontend developer'],
        ca: [],
        fuente: '«developer»: uso común; «frontend developer»: uso común',
      },
    ],
    ['3512.1', { es: ['helpdesk'], ca: [], fuente: '«helpdesk»: uso común' }],
    [
      '2522.1',
      {
        es: ['técnico de sistemas', 'sysadmin'],
        ca: [],
        fuente: '«técnico de sistemas»: uso común; «sysadmin»: uso común',
      },
    ],
    ['3513.2', { es: ['técnico de sistemas'], ca: [], fuente: '«técnico de sistemas»: uso común' }],
    ['2511.4', { es: ['data scientist'], ca: [], fuente: '«data scientist»: uso común' }],
    ['2519.5', { es: ['QA'], ca: [], fuente: '«QA»: quality assurance' }],
    ['2519.7', { es: ['QA'], ca: [], fuente: '«QA»: quality assurance' }],
    ['2513.3', { es: ['diseñador UX'], ca: [], fuente: '«diseñador UX»: uso común' }],
    ['2511.19', { es: ['diseñador UX'], ca: [], fuente: '«diseñador UX»: uso común' }],
    ['2431.1', { es: ['publicista'], ca: [], fuente: '«publicista»: DLE: publicista' }],
    [
      '1120.3',
      {
        es: ['CEO', 'director general'],
        ca: [],
        fuente: '«CEO»: chief executive officer; «director general»: uso común',
      },
    ],
    [
      '3122.4',
      {
        es: ['jefe de producción', 'jefe de turno'],
        ca: ['cap de producció', 'cap de torn'],
        fuente:
          '«jefe de producción»: uso común; «jefe de turno»: uso común; «cap de producció»: ús comú; «cap de torn»: ús comú',
      },
    ],
    [
      '1321.2.1',
      {
        es: ['jefe de producción'],
        ca: ['cap de producció'],
        fuente: '«jefe de producción»: uso común; «cap de producció»: ús comú',
      },
    ],
    ['2263.3', { es: ['técnico de PRL'], ca: [], fuente: '«técnico de PRL»: prevención de riesgos laborales' }],
    ['3257.5', { es: ['técnico de PRL'], ca: [], fuente: '«técnico de PRL»: prevención de riesgos laborales' }],
    ['2412.4', { es: ['asesor financiero'], ca: [], fuente: '«asesor financiero»: uso común' }],
    ['2412.6', { es: ['asesor financiero'], ca: [], fuente: '«asesor financiero»: uso común' }],
    ['3334.3', { es: ['API'], ca: [], fuente: '«API»: agente de la propiedad inmobiliaria, uso en Cataluña' }],
    ['2611.1', { es: ['letrado'], ca: [], fuente: '«letrado»: DLE: letrado, abogado' }],
    [
      '2619.7',
      {
        es: ['graduado social'],
        ca: ['graduat social'],
        fuente: '«graduado social»: uso común (profesión colegiada); «graduat social»: ús comú',
      },
    ],
    [
      '2423.4',
      {
        es: ['graduado social'],
        ca: ['graduat social'],
        fuente: '«graduado social»: uso común (profesión colegiada); «graduat social»: ús comú',
      },
    ],
    ['5142.6', { es: ['técnica de uñas'], ca: [], fuente: '«técnica de uñas»: uso común' }],
    ['2652.6', { es: ['DJ'], ca: [], fuente: '«DJ»: uso común (disc jockey)' }],
    ['3521.1.11', { es: ['editor de vídeo'], ca: [], fuente: '«editor de vídeo»: uso común' }],
    ['5161.2', { es: ['tarotista'], ca: [], fuente: '«tarotista»: uso común' }],
    ['4412.2', { es: ['empleado de Correos'], ca: [], fuente: '«empleado de Correos»: uso común' }],
    ['4211.2', { es: ['empleado de Correos'], ca: [], fuente: '«empleado de Correos»: uso común' }],
    [
      '2222.1',
      {
        es: [],
        ca: ['llevadora', 'comare'],
        fuente: '«llevadora»: DIEC: llevadora; «comare»: DIEC: comare, llevadora',
      },
    ],
    ['2269.8', { es: [], ca: ['tècnic de rajos'], fuente: '«tècnic de rajos»: ús comú' }],
    [
      '2341.1',
      {
        es: [],
        ca: ['mestra', 'mestre', 'senyo'],
        fuente: "«mestra»: DIEC: mestre, -a (femení); «mestre»: DIEC: mestre; «senyo»: ús comú a l'escola (la senyo)",
      },
    ],
    [
      '5312.4',
      {
        es: [],
        ca: ['vetlladora'],
        fuente: "«vetlladora»: ús comú a les escoles (suport a l'alumnat amb necessitats)",
      },
    ],
    ['5165.1', { es: [], ca: ["professor d'autoescola"], fuente: "«professor d'autoescola»: ús comú" }],
    ['5223.7.19', { es: [], ca: ['fruiter', 'fruitera'], fuente: '«fruiter»: DIEC: fruiter; «fruitera»: femení' }],
    ['5223.7.23', { es: [], ca: ['xarcuter', 'xarcutera'], fuente: '«xarcuter»: DIEC: xarcuter; «xarcutera»: femení' }],
    ['7511.1', { es: [], ca: ['xarcuter', 'xarcutera'], fuente: '«xarcuter»: DIEC: xarcuter; «xarcutera»: femení' }],
    ['4211.1', { es: [], ca: ['caixer de banc'], fuente: '«caixer de banc»: ús comú' }],
    ['9412.2', { es: [], ca: ['rentaplats'], fuente: '«rentaplats»: ús comú (persona que renta plats)' }],
    ['9112.2', { es: [], ca: ["netejadora d'oficines"], fuente: "«netejadora d'oficines»: ús comú" }],
    ['9122.1', { es: [], ca: ['rentacotxes'], fuente: '«rentacotxes»: ús comú' }],
    ['9215.1', { es: [], ca: ['llenyataire'], fuente: '«llenyataire»: DIEC: llenyataire' }],
    ['3512.4', { es: [], ca: ['informàtic'], fuente: '«informàtic»: DIEC: informàtic' }],
    ['2636.2', { es: [], ca: ['mossèn'], fuente: '«mossèn»: DIEC: mossèn, tractament dels capellans' }],
  ]),
);
