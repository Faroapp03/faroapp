// Conclusiones del informe: tareas con datos, orden de caminos y alcance de la encuesta, en castellano y catalán.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caminos } from '../../src/dominio/caminos.ts';
import { hallazgos } from '../../src/dominio/hallazgos.ts';
import { textosDelInforme } from '../../src/dominio/lengua.ts';
import { ambArticleFemeni } from '../../src/dominio/textos-informe-ca.ts';
import type { DatosTich, UsoEnLaEncuesta } from '../../src/dominio/tipos-contexto.ts';
import type { Competencia, TareaInforme } from '../../src/dominio/tipos-informe.ts';
import { usoDeclaradoDeLaIa } from '../../src/dominio/uso-declarado-de-la-ia.ts';

const NOTAS = { baja: 0, bajaMayor: 0.3, media: 0.5, alta: 0.6, altaMayor: 1 } as const;
const MIN_MUESTRA = 30;
const PORCENTAJES = { grupo: 21.2, granGrupo: 31.4, bloque: 41.6, motivo: 0 } as const;
const EXTREMOS = { inferior: 17.1, superior: 25.3 } as const;
const INTERVALO: [number, number] = [EXTREMOS.inferior, EXTREMOS.superior];
const POSICIONES = { mas: 15, despuesDeMas: 16, antesDeMenos: 59, menos: 60, total: 100 } as const;
const COMPETENCIA: Competencia = { uri: 'esco:1', titulo: 'Competencia', relacion: 'esencial' };

function tarea(id: string, cambios: Partial<TareaInforme> = {}): TareaInforme {
  return {
    id,
    nombre: id,
    texto: id,
    tiempo: 'mucho',
    peso: 3,
    valor: NOTAS.alta,
    margen: [0, 1],
    franja: 'alta',
    evidencia: 'estimacion-oit',
    incierta: false,
    origenValor: 'OIT',
    referencia: null,
    iaPodria: null,
    loTuyo: null,
    textosIa: false,
    competencias: [COMPETENCIA],
    ...cambios,
  };
}

function sinNota(id = 'sin nota'): TareaInforme {
  return tarea(id, {
    valor: null,
    margen: null,
    franja: null,
    evidencia: 'insuficiente',
    motivoSinNota: 'estimacion-no-disponible',
    competencias: [],
  });
}

function encuesta(pct: number, muestra = MIN_MUESTRA): UsoEnLaEncuesta {
  return { pct, muestra, ic95: [...INTERVALO] };
}

function tich(): DatosTich {
  return {
    fuentes: { tich: 'INE, encuesta TIC-H' },
    anio: '2025',
    min_muestra: MIN_MUESTRA,
    espana_isco2: { '25': encuesta(PORCENTAJES.grupo), '35': encuesta(PORCENTAJES.grupo) },
    espana_isco1: { '2': encuesta(PORCENTAJES.granGrupo), '4': encuesta(PORCENTAJES.granGrupo) },
    espana_bloques: { '25+35': encuesta(PORCENTAJES.bloque) },
    bloque_por_isco2: {},
    grandes_grupos_enteros: [],
    motivos_no_uso: {
      fuente: 'Idescat',
      tabla: '3.4.2',
      url: 'https://www.idescat.cat/',
      sha256: '',
      consultado: '2026-10-13',
      anio: '2024',
      base: 'Quienes no usaron la IA',
      no_sabia_como_utilizarlas: { manual: PORCENTAJES.motivo, no_manual: PORCENTAJES.motivo },
    },
    clase_por_isco2: { '25': 'no_manual', '35': 'no_manual', '61': 'manual' },
  };
}

for (const idioma of ['es', 'ca'] as const) {
  const textos = textosDelInforme(idioma);
  const escritura = { textos: textos.hallazgos, idioma, sinReferencias: false };
  const escrituraCaminos = { textos: textos.caminos, idioma };

  test(`${idioma}: sin datos produce un hallazgo insuficiente y conserva la posición al final`, () => {
    const posicion = { masAltas: 0, total: 1 };
    const salida = hallazgos([sinNota()], posicion, escritura);
    assert.deepEqual(salida[0], {
      titulo: textos.hallazgos.sinDatos.titulo,
      texto: textos.hallazgos.sinDatos.texto,
      evidencia: 'insuficiente',
      detalle: textos.hallazgos.sinDatos.detalle,
    });
    assert.equal(salida[1]?.titulo, textos.hallazgos.entreLasMasExpuestas);
    assert.equal(salida[1]?.evidencia, 'dato-publicado');
    assert.equal(
      hallazgos([], null, { ...escritura, sinReferencias: true })[0]?.texto,
      textos.hallazgos.sinDatos.sinReferencias,
    );
  });

  test(`${idioma}: una nota cero tiene datos y una nota null no entra en altas ni bajas`, () => {
    const cero = tarea('Cuidar', { valor: NOTAS.baja, franja: 'baja' });
    const salida = hallazgos([sinNota(), cero], null, escritura);
    assert.equal(salida.length, 2);
    assert.equal(salida[0]?.titulo, textos.hallazgos.ningunaAlta(textos.hallazgos.deLasQueTienenDatos));
    assert.equal(salida[1]?.titulo, textos.hallazgos.loQueDependeDeTi('cuidar'));
    assert.ok(salida.every(({ evidencia }) => evidencia === 'estimacion-oit'));
    assert.deepEqual(caminos([sinNota()], escrituraCaminos), []);
    assert.deepEqual(caminos([sinNota(), cero], escrituraCaminos)[0]?.tareas, ['Cuidar']);
  });

  test(`${idioma}: cada hallazgo toma la evidencia de sus tareas y conserva minúsculas y orden`, () => {
    const alta = tarea('Usar ERP', { evidencia: 'estimacion-faro' });
    const baja = tarea('Cuidar SAP', { valor: NOTAS.baja, franja: 'baja' });
    const salida = hallazgos([alta, baja], null, escritura);
    assert.equal(salida[0]?.titulo, textos.hallazgos.loQueMasCambia('usar erp'));
    assert.equal(salida[0]?.evidencia, 'estimacion-faro');
    assert.equal(salida[0]?.detalle, textos.hallazgos.detalleFaro);
    assert.equal(salida[0]?.texto, textos.hallazgos.loQueMasCambiaTexto(textos.hallazgos.segunFaro));
    assert.equal(salida[1]?.titulo, textos.hallazgos.loQueDependeDeTi('cuidar sap'));
    assert.equal(salida[1]?.evidencia, 'estimacion-oit');
  });

  test(`${idioma}: si el margen de una tarea alta cruza de franja, el título nombra las franjas posibles`, () => {
    const cruza = tarea('Usar ERP', { franjasPosibles: ['media', 'alta'] });
    const entera = tarea('Archivar', { franjasPosibles: ['alta'] });
    const salida = hallazgos([cruza, entera], null, escritura);
    assert.equal(
      salida[0]?.titulo,
      textos.hallazgos.loQueMasCambiaEntreFranjas(
        `usar erp ${idioma === 'es' ? 'y' : 'i'} archivar`,
        textos.hallazgos.franjas.media,
        textos.hallazgos.franjas.alta,
        true,
      ),
    );
    // Con varias tareas, el margen que cruza puede ser el de una sola; con una, es el suyo.
    assert.match(
      salida[0]?.titulo ?? '',
      idioma === 'es'
        ? /; el margen de alguna va de la franja media a la alta\.$/u
        : /; el marge d’alguna va de la franja mitjana a l’alta\.$/u,
    );
    assert.match(
      hallazgos([cruza], null, escritura)[0]?.titulo ?? '',
      idioma === 'es'
        ? /: usar erp; su margen va de la franja media a la alta\.$/u
        : /: usar erp; el seu marge va de la franja mitjana a l’alta\.$/u,
    );
    assert.equal(hallazgos([entera], null, escritura)[0]?.titulo, textos.hallazgos.loQueMasCambia('archivar'));
  });

  if (idioma === 'ca') {
    test('ca: el artículo femenino se apostrofa ante vocal y hache muda, no ante consonante ni i o u átonas', () => {
      assert.deepEqual(
        ['alta', 'hora', 'època', 'índia', 'mitjana', 'baixa', 'universitat', 'humitat'].map(ambArticleFemeni),
        ['l’alta', 'l’hora', 'l’època', 'l’índia', 'la mitjana', 'la baixa', 'la universitat', 'la humitat'],
      );
    });
  }

  test(`${idioma}: «según quién» y el detalle dicen de quién son las notas: solo OIT, OIT y Faro, o solo Faro`, () => {
    const oit = tarea('Usar ERP');
    const faro = tarea('Archivar', { evidencia: 'estimacion-faro' });
    const de = (tareas: TareaInforme[]) => hallazgos(tareas, null, escritura)[0];
    const h = textos.hallazgos;
    assert.deepEqual(
      [de([oit]), de([oit, faro]), de([faro, tarea('Otra', { evidencia: 'estimacion-faro' })])].map((hallazgo) => [
        hallazgo?.texto,
        hallazgo?.detalle,
      ]),
      [
        [h.loQueMasCambiaTexto(h.segunOit), h.detalleOit],
        [h.loQueMasCambiaTexto(h.segunOitYFaro), h.detalleOitYFaro],
        [h.loQueMasCambiaTexto(h.segunFaro), h.detalleFaro],
      ],
    );
    // Con todo OIT, el texto es el de siempre.
    assert.equal(h.segunOit, idioma === 'es' ? 'Según la OIT' : 'Segons l’OIT');
    assert.doesNotMatch(`${h.segunFaro} ${de([faro])?.texto}`, /Según la OIT|Segons l’OIT/u);
  });

  test(`${idioma}: sin tareas bajas usa el texto de todas las tareas con datos`, () => {
    const salida = hallazgos([tarea('Media', { franja: 'media', valor: NOTAS.media })], null, escritura);
    assert.equal(salida[1]?.titulo, textos.hallazgos.todasCambian(''));
    assert.equal(salida[1]?.texto, textos.hallazgos.todasCambianTexto);
  });

  test(`${idioma}: los límites de posición incluyen el 15 % y el 60 %`, () => {
    const posiciones = [
      [POSICIONES.mas, textos.hallazgos.entreLasMasExpuestas],
      [POSICIONES.despuesDeMas, textos.hallazgos.zonaIntermedia],
      [POSICIONES.antesDeMenos, textos.hallazgos.zonaIntermedia],
      [POSICIONES.menos, textos.hallazgos.entreLasMenosExpuestas],
    ] as const;
    for (const [masAltas, titulo] of posiciones) {
      const salida = hallazgos([], { masAltas, total: POSICIONES.total }, escritura);
      assert.equal(salida[1]?.titulo, titulo);
      assert.equal(salida[1]?.texto, textos.hallazgos.posicion(masAltas, POSICIONES.total));
    }
  });

  test(`${idioma}: los caminos ordenan por peso, nota y entrada estable, sin mutar`, () => {
    const tareas = Object.freeze([
      tarea('alta-poco', { peso: 1, tiempo: 'poco', valor: NOTAS.altaMayor }),
      tarea('alta-primera'),
      tarea('alta-mayor', { valor: NOTAS.altaMayor }),
      tarea('alta-igual'),
      tarea('baja-mayor', { franja: 'baja', valor: NOTAS.bajaMayor }),
      tarea('baja-primera', { franja: 'baja', valor: NOTAS.baja }),
      tarea('baja-igual', { franja: 'baja', valor: NOTAS.baja }),
      sinNota(),
    ]);
    const antes = structuredClone(tareas);
    const salida = caminos(tareas, escrituraCaminos);
    assert.deepEqual(
      salida.map(({ tipo }) => tipo),
      ['mas-cambia', 'sigue-siendo-tuyo'],
    );
    assert.deepEqual(
      salida.map(({ tareas: ids }) => ids),
      [
        ['alta-mayor', 'alta-primera'],
        ['baja-primera', 'baja-igual'],
      ],
    );
    assert.deepEqual(tareas, antes);
    assert.deepEqual(Object.keys(salida[0] ?? {}), ['tipo', 'titulo', 'porque', 'tareas', 'competencias']);
  });

  test(`${idioma}: deduplicar competencias conserva primera posición y última relación y alcance`, () => {
    const ultima: Competencia = { ...COMPETENCIA, relacion: 'sin-ocupacion', alcance: 'grupo' };
    const otra: Competencia = { uri: 'esco:2', titulo: 'Otra', relacion: 'opcional' };
    const salida = caminos(
      [tarea('primera', { competencias: [COMPETENCIA, otra] }), tarea('segunda', { competencias: [ultima] })],
      escrituraCaminos,
    );
    assert.deepEqual(salida[0]?.competencias, [ultima, otra]);
    assert.equal(salida[0]?.competencias[0], ultima);
    assert.deepEqual(caminos([tarea('sin competencias', { competencias: [] })], escrituraCaminos), []);
  });
}

const TITULOS: Readonly<Record<string, string>> = {
  '25': 'Profesionales de TIC',
  '35': 'Técnicos de TIC',
  '2': 'Profesionales',
  '4': 'Personal administrativo',
};

for (const idioma of ['es', 'ca'] as const) {
  const lengua = { idioma, tituloIsco: (codigo: string) => TITULOS[codigo] ?? codigo };

  test(`${idioma}: sin encuesta o sin muestra suficiente devuelve null`, () => {
    assert.equal(usoDeclaradoDeLaIa({}, '2511', lengua), null);
    const datos = tich();
    datos.espana_isco2['25'] = encuesta(PORCENTAJES.grupo, MIN_MUESTRA - 1);
    datos.espana_isco1['2'] = encuesta(PORCENTAJES.granGrupo, MIN_MUESTRA - 1);
    assert.equal(usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua), null);
  });

  test(`${idioma}: el grupo con muestra mínima manda y copia el intervalo con un motivo de cero`, () => {
    const datos = tich();
    const antes = structuredClone(datos);
    const salida = usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua);
    assert.deepEqual(salida, {
      anio: '2025',
      codigo: '25',
      grupo: TITULOS['25'],
      alcance: 'grupo',
      pct: PORCENTAJES.grupo,
      intervalo: INTERVALO,
      noSabianComo: { clase: 'no_manual', pct: 0, anio: '2024' },
    });
    assert.notEqual(salida?.intervalo, datos.espana_isco2['25']?.ic95);
    assert.deepEqual(datos, antes);
  });

  test(`${idioma}: sin muestra del grupo usa su gran grupo y sin clase omite el motivo`, () => {
    const datos = tich();
    datos.espana_isco2['25'] = encuesta(PORCENTAJES.grupo, MIN_MUESTRA - 1);
    delete datos.clase_por_isco2['25'];
    const salida = usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua);
    assert.equal(salida?.codigo, '2');
    assert.equal(salida?.grupo, TITULOS['2']);
    assert.equal(salida?.alcance, 'gran-grupo');
    assert.equal(salida?.pct, PORCENTAJES.granGrupo);
    assert.equal(salida?.noSabianComo, null);
  });

  test(`${idioma}: el bloque manda sobre grupo y gran grupo, con títulos y conjunción en su orden`, () => {
    const datos = tich();
    datos.bloque_por_isco2 = { '35': '25+35', '25': '25+35' };
    datos.grandes_grupos_enteros = ['2'];
    const salida = usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua);
    assert.equal(salida?.codigo, '25+35');
    assert.equal(salida?.alcance, 'conjunto');
    assert.equal(salida?.pct, PORCENTAJES.bloque);
    assert.equal(salida?.grupo, `Profesionales de TIC ${idioma === 'es' ? 'y' : 'i'} técnicos de TIC`);
  });

  test(`${idioma}: un bloque sin respuestas suficientes recurre a su gran grupo, y sin él no hay cifra`, () => {
    const datos = tich();
    datos.bloque_por_isco2 = { '35': '25+35', '25': '25+35' };
    datos.espana_bloques['25+35'] = encuesta(PORCENTAJES.bloque, MIN_MUESTRA - 1);
    const salida = usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua);
    assert.equal(salida?.codigo, '2');
    assert.equal(salida?.alcance, 'gran-grupo');
    assert.equal(salida?.grupo, TITULOS['2']);
    assert.equal(salida?.pct, PORCENTAJES.granGrupo);
    delete datos.espana_bloques['25+35'];
    assert.equal(usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua)?.alcance, 'gran-grupo');
    datos.espana_isco1['2'] = encuesta(PORCENTAJES.granGrupo, MIN_MUESTRA - 1);
    assert.equal(usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua), null);
  });

  test(`${idioma}: el gran grupo entero manda sobre la cifra propia y no inventa una sustitución`, () => {
    const datos = tich();
    datos.grandes_grupos_enteros = ['2'];
    const salida = usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua);
    assert.equal(salida?.codigo, '2');
    assert.equal(salida?.alcance, 'conjunto');
    assert.equal(salida?.pct, PORCENTAJES.granGrupo);
    delete datos.espana_isco1['2'];
    assert.equal(usoDeclaradoDeLaIa({ tich: datos }, '2511', lengua), null);
  });
}
