/**
 * Lo que Faro debe escribir, a mano y en los dos idiomas, para los doce meses, los siete días de la semana, los dos
 * cambios de hora, la medianoche y el fin de año. Lo comparten la prueba en Node (fechas.test.ts) y la de los tres
 * navegadores (pruebas/navegadores/fechas.test.mjs): el texto esperado es el mismo en todas partes.
 */

type EnDosIdiomas<T> = Readonly<{ es: T; ca: T }>;

/** Por mes, un día civil y su fecha corta, su mes con año y su fecha completa. */
export const MESES: readonly (readonly [string, EnDosIdiomas<readonly [string, string, string]>])[] = [
  [
    '2026-01-01',
    {
      es: ['1 ene. 2026', 'enero de 2026', 'jueves, 1 de enero de 2026'],
      ca: ['1 de gen. del 2026', 'gener del 2026', 'dijous, 1 de gener del 2026'],
    },
  ],
  [
    '2026-02-01',
    {
      es: ['1 feb. 2026', 'febrero de 2026', 'domingo, 1 de febrero de 2026'],
      ca: ['1 de febr. del 2026', 'febrer del 2026', 'diumenge, 1 de febrer del 2026'],
    },
  ],
  [
    '2026-03-01',
    {
      es: ['1 mar. 2026', 'marzo de 2026', 'domingo, 1 de marzo de 2026'],
      ca: ['1 de març del 2026', 'març del 2026', 'diumenge, 1 de març del 2026'],
    },
  ],
  [
    '2026-04-01',
    {
      es: ['1 abr. 2026', 'abril de 2026', 'miércoles, 1 de abril de 2026'],
      ca: ['1 d’abr. del 2026', 'abril del 2026', 'dimecres, 1 d’abril del 2026'],
    },
  ],
  [
    '2026-05-01',
    {
      es: ['1 may. 2026', 'mayo de 2026', 'viernes, 1 de mayo de 2026'],
      ca: ['1 de maig del 2026', 'maig del 2026', 'divendres, 1 de maig del 2026'],
    },
  ],
  [
    '2026-06-01',
    {
      es: ['1 jun. 2026', 'junio de 2026', 'lunes, 1 de junio de 2026'],
      ca: ['1 de juny del 2026', 'juny del 2026', 'dilluns, 1 de juny del 2026'],
    },
  ],
  [
    '2026-07-01',
    {
      es: ['1 jul. 2026', 'julio de 2026', 'miércoles, 1 de julio de 2026'],
      ca: ['1 de jul. del 2026', 'juliol del 2026', 'dimecres, 1 de juliol del 2026'],
    },
  ],
  [
    '2026-08-01',
    {
      es: ['1 ago. 2026', 'agosto de 2026', 'sábado, 1 de agosto de 2026'],
      ca: ['1 d’ag. del 2026', 'agost del 2026', 'dissabte, 1 d’agost del 2026'],
    },
  ],
  [
    '2026-09-01',
    {
      es: ['1 sept. 2026', 'septiembre de 2026', 'martes, 1 de septiembre de 2026'],
      ca: ['1 de set. del 2026', 'setembre del 2026', 'dimarts, 1 de setembre del 2026'],
    },
  ],
  [
    '2026-10-01',
    {
      es: ['1 oct. 2026', 'octubre de 2026', 'jueves, 1 de octubre de 2026'],
      ca: ['1 d’oct. del 2026', 'octubre del 2026', 'dijous, 1 d’octubre del 2026'],
    },
  ],
  [
    '2026-11-01',
    {
      es: ['1 nov. 2026', 'noviembre de 2026', 'domingo, 1 de noviembre de 2026'],
      ca: ['1 de nov. del 2026', 'novembre del 2026', 'diumenge, 1 de novembre del 2026'],
    },
  ],
  [
    '2026-12-01',
    {
      es: ['1 dic. 2026', 'diciembre de 2026', 'martes, 1 de diciembre de 2026'],
      ca: ['1 de des. del 2026', 'desembre del 2026', 'dimarts, 1 de desembre del 2026'],
    },
  ],
];

/** Por día de la semana, su fila de agenda y su fecha completa. */
export const DIAS: readonly (readonly [string, EnDosIdiomas<readonly [string, string]>])[] = [
  [
    '2026-11-16',
    {
      es: ['lun., 16 nov.', 'lunes, 16 de noviembre de 2026'],
      ca: ['dl., 16 de nov.', 'dilluns, 16 de novembre del 2026'],
    },
  ],
  [
    '2026-11-17',
    {
      es: ['mar., 17 nov.', 'martes, 17 de noviembre de 2026'],
      ca: ['dt., 17 de nov.', 'dimarts, 17 de novembre del 2026'],
    },
  ],
  [
    '2026-11-18',
    {
      es: ['mié., 18 nov.', 'miércoles, 18 de noviembre de 2026'],
      ca: ['dc., 18 de nov.', 'dimecres, 18 de novembre del 2026'],
    },
  ],
  [
    '2026-11-19',
    {
      es: ['jue., 19 nov.', 'jueves, 19 de noviembre de 2026'],
      ca: ['dj., 19 de nov.', 'dijous, 19 de novembre del 2026'],
    },
  ],
  [
    '2026-11-20',
    {
      es: ['vie., 20 nov.', 'viernes, 20 de noviembre de 2026'],
      ca: ['dv., 20 de nov.', 'divendres, 20 de novembre del 2026'],
    },
  ],
  [
    '2026-11-21',
    {
      es: ['sáb., 21 nov.', 'sábado, 21 de noviembre de 2026'],
      ca: ['ds., 21 de nov.', 'dissabte, 21 de novembre del 2026'],
    },
  ],
  [
    '2026-11-22',
    {
      es: ['dom., 22 nov.', 'domingo, 22 de noviembre de 2026'],
      ca: ['dg., 22 de nov.', 'diumenge, 22 de novembre del 2026'],
    },
  ],
];

/** Instantes UTC leídos en hora de Barcelona: su día, sus cifras y su fecha corta y larga con hora. */
export const INSTANTES: readonly (readonly [
  string,
  Readonly<{ dia: string; numerica: string } & EnDosIdiomas<readonly [string, string]>>,
])[] = [
  // La última hora de invierno antes del cambio de marzo, y la primera de verano.
  [
    '2026-03-29T00:59:00Z',
    {
      dia: '2026-03-29',
      numerica: '29/03/2026, 01:59',
      es: ['29 mar. 2026, 01:59', '29 de marzo de 2026 a la 1:59'],
      ca: ['29 de març del 2026, 01:59', '29 de març del 2026, a la 1:59'],
    },
  ],
  [
    '2026-03-29T01:00:00Z',
    {
      dia: '2026-03-29',
      numerica: '29/03/2026, 03:00',
      es: ['29 mar. 2026, 03:00', '29 de marzo de 2026 a las 3:00'],
      ca: ['29 de març del 2026, 03:00', '29 de març del 2026, a les 3:00'],
    },
  ],
  // En octubre, las 02:30 se viven dos veces: una en verano y otra en invierno.
  [
    '2026-10-25T00:30:00Z',
    {
      dia: '2026-10-25',
      numerica: '25/10/2026, 02:30',
      es: ['25 oct. 2026, 02:30', '25 de octubre de 2026 a las 2:30'],
      ca: ['25 d’oct. del 2026, 02:30', '25 d’octubre del 2026, a les 2:30'],
    },
  ],
  [
    '2026-10-25T01:30:00Z',
    {
      dia: '2026-10-25',
      numerica: '25/10/2026, 02:30',
      es: ['25 oct. 2026, 02:30', '25 de octubre de 2026 a las 2:30'],
      ca: ['25 d’oct. del 2026, 02:30', '25 d’octubre del 2026, a les 2:30'],
    },
  ],
  // Medianoche en Barcelona, que en UTC aún es el día anterior.
  [
    '2026-06-30T22:00:00Z',
    {
      dia: '2026-07-01',
      numerica: '01/07/2026, 00:00',
      es: ['1 jul. 2026, 00:00', '1 de julio de 2026 a las 0:00'],
      ca: ['1 de jul. del 2026, 00:00', '1 de juliol del 2026, a les 0:00'],
    },
  ],
  // El último minuto del año y el primero del siguiente.
  [
    '2026-12-31T22:59:00Z',
    {
      dia: '2026-12-31',
      numerica: '31/12/2026, 23:59',
      es: ['31 dic. 2026, 23:59', '31 de diciembre de 2026 a las 23:59'],
      ca: ['31 de des. del 2026, 23:59', '31 de desembre del 2026, a les 23:59'],
    },
  ],
  [
    '2026-12-31T23:00:00Z',
    {
      dia: '2027-01-01',
      numerica: '01/01/2027, 00:00',
      es: ['1 ene. 2027, 00:00', '1 de enero de 2027 a las 0:00'],
      ca: ['1 de gen. del 2027, 00:00', '1 de gener del 2027, a les 0:00'],
    },
  ],
];

/** Las cifras de la web (recorrido/formato.js), escritas como en el código: punto de miles siempre y coma decimal. */
export const NUMEROS: readonly (readonly [string, string])[] = [
  ['7', '7'],
  ['4000', '4.000'],
  ['1234567', '1.234.567'],
  ['12345678', '12.345.678'],
];
/** Las notas de la OIT, siempre con dos decimales. */
export const NOTAS: readonly (readonly [string, string])[] = [
  ['0.5', '0,50'],
  ['0.74', '0,74'],
  ['0.745', '0,75'],
  ['12', '12,00'],
];

/**
 * Las cifras con decimales variables (cifras.js, cifraHasta): horas y precios de la ficha y del catálogo, horas de
 * los horarios y margen del informe. Punto de miles desde las cuatro cifras, en los dos idiomas.
 */
export const CIFRAS_HASTA: readonly (readonly [string, string, string])[] = [
  ['1500', '3', '1.500'],
  ['40000', '3', '40.000'],
  ['1234567.891', '20', '1.234.567,891'],
  ['2.25', '1', '2,3'],
  ['1.5', '3', '1,5'],
  ['0.59', '2', '0,59'],
  ['-1500.5', '1', '-1.500,5'],
];

/**
 * Los nombres de idiomas de la tabla propia (fechas.js), en minúscula; un código que no está, en mayúsculas; un texto
 * del proveedor que no es un código, como viene.
 */
export const IDIOMAS: readonly (readonly [string, 'es' | 'ca', string])[] = [
  ['es', 'es', 'castellano'],
  ['es', 'ca', 'castellà'],
  ['en-GB', 'es', 'inglés'],
  ['fr', 'ca', 'francès'],
  ['eu', 'es', 'euskera'],
  ['xx', 'ca', 'XX'],
  ['Multilingüe', 'es', 'Multilingüe'],
  ['Francés', 'ca', 'Francés'],
];

/** Las listas de territorios de los datos globales (datos-globales/comparacion.js), con Intl.ListFormat. */
export const LISTAS: readonly (readonly ['es' | 'ca', readonly string[], string])[] = [
  ['es', ['Francia', 'Italia'], 'Francia e Italia'],
  ['es', ['Alemania', 'Francia', 'Hungría'], 'Alemania, Francia y Hungría'],
  ['ca', ['França', 'Itàlia'], 'França i Itàlia'],
  ['ca', ['Alemanya', 'França', 'Hongria'], 'Alemanya, França i Hongria'],
];

/** El comienzo de un intervalo de días (diaYMesEnFrase): el día y el mes completos, sin el año. */
export const COMIENZOS: readonly (readonly [string, 'es' | 'ca', string])[] = [
  ['2026-01-01', 'es', '1 de enero'],
  ['2026-01-01', 'ca', '1 de gener'],
  ['2026-04-12', 'ca', '12 d’abril'],
  ['2026-08-03', 'ca', '3 d’agost'],
  ['2026-10-25', 'es', '25 de octubre'],
  ['2026-10-25', 'ca', '25 d’octubre'],
];

/** Las fechas del documento del plan, con las funciones que lo escriben (textos-documento.js). */
export const DOCUMENTO: readonly (readonly [
  'fechaDelPlan' | 'fechaEnBarcelona' | 'fechaOficial',
  string,
  'es' | 'ca',
  string,
])[] = [
  ['fechaDelPlan', '2026-10-25', 'ca', '25 d’oct. del 2026'],
  ['fechaDelPlan', '2026-10-25', 'es', '25 oct. 2026'],
  ['fechaEnBarcelona', '2026-12-31T22:59:00Z', 'ca', '31 de des. del 2026, 23:59'],
  ['fechaEnBarcelona', '2026-12-31T22:59:00Z', 'es', '31 dic. 2026, 23:59'],
  ['fechaOficial', '2026-11-10T09:00:00-00:00', 'ca', '10 de nov. del 2026, 09:00 (fus horari per confirmar)'],
  ['fechaOficial', '2026-04-10T09:00:00Z', 'ca', '10 d’abr. del 2026, 11:00'],
];

/** Lo esperado, con la forma que devuelve escribirCasos. */
export const ESPERADO = { MESES, DIAS, INSTANTES, NUMEROS, NOTAS, CIFRAS_HASTA, IDIOMAS, LISTAS, COMIENZOS, DOCUMENTO };

/**
 * Escribe todos los casos con los módulos dados. No usa nada de fuera de sus argumentos: la prueba de navegador envía
 * su código a la página y lo ejecuta allí con los módulos de la web.
 */
export function escribirCasos(
  // biome-ignore lint/suspicious/noExplicitAny: los módulos llegan sin tipos cuando se ejecuta en la página.
  { fechas, formato, documento, cifras }: Record<'fechas' | 'formato' | 'documento' | 'cifras', any>,
  casos: typeof ESPERADO,
): typeof ESPERADO {
  const idiomas = (escribir: (idioma: 'es' | 'ca') => unknown) => ({ es: escribir('es'), ca: escribir('ca') });
  return {
    MESES: casos.MESES.map(([dia]) => {
      const p = fechas.partesDelDia(dia);
      return [dia, idiomas((i) => [fechas.fechaCorta(p, i), fechas.mesYAnio(p, i), fechas.fechaCompleta(p, i)])];
    }),
    DIAS: casos.DIAS.map(([dia]) => {
      const p = fechas.partesDelDia(dia);
      return [dia, idiomas((i) => [fechas.diaDeAgenda(p, i), fechas.fechaCompleta(p, i)])];
    }),
    INSTANTES: casos.INSTANTES.map(([instante]) => {
      const p = fechas.partesEnZona(instante, fechas.ZONA_BARCELONA);
      const escrito = idiomas((i) => [fechas.fechaCortaConHora(p, i), fechas.fechaLargaConHora(p, i)]);
      return [instante, { dia: fechas.fechaIso(p), numerica: fechas.fechaNumericaConHora(p), ...escrito }];
    }),
    NUMEROS: casos.NUMEROS.map(([valor]) => [valor, formato.formatearNumero(Number(valor))]),
    NOTAS: casos.NOTAS.map(([valor]) => [valor, formato.formatearNota(Number(valor))]),
    IDIOMAS: casos.IDIOMAS.map(([codigo, idioma]) => [codigo, idioma, fechas.nombreDelIdioma(codigo, idioma)]),
    COMIENZOS: casos.COMIENZOS.map(([dia, idioma]) => [
      dia,
      idioma,
      fechas.diaYMesEnFrase(fechas.partesDelDia(dia), idioma),
    ]),
    LISTAS: casos.LISTAS.map(([lengua, nombres]) => [
      lengua,
      nombres,
      new Intl.ListFormat(lengua, { type: 'conjunction' }).format(nombres),
    ]),
    CIFRAS_HASTA: casos.CIFRAS_HASTA.map(([valor, maximo]) => [
      valor,
      maximo,
      cifras.cifraHasta(Number(valor), Number(maximo)),
    ]),
    DOCUMENTO: casos.DOCUMENTO.map(([funcion, fecha, idioma]) => [
      funcion,
      fecha,
      idioma,
      documento[funcion](fecha, idioma, { conHora: true }),
    ]),
  } as typeof ESPERADO;
}
