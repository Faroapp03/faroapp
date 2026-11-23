// Bordes de la política, prioridades y relatos legítimos; sin API ni proveedor.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BLOQUEAN_SI_ALTA, BLOQUEAN_SIEMPRE, PIDEN_AYUDA } from '../../src/comun/categorias-moderacion.ts';
import { AVISO_AYUDA, AVISO_AYUDA_CA } from '../../src/seguridad/avisos.ts';
import { decidirModeracion, type Moderador, moderarAntesDelModelo } from '../../src/seguridad/moderacion.ts';
import { TEXTOS_RECORRIDO as RECORRIDO_CA } from '../../web/idiomas/ca/recorrido.js';
import { TEXTOS_RECORRIDO as RECORRIDO_ES } from '../../web/idiomas/es/recorrido.js';

/**
 * El umbral publicado en la cabecera de seguridad/moderacion.ts (PUNTUACION_ALTA). No se importa porque no se exporta:
 * se fija por los dos lados del borde, que es lo que de verdad decide, y así una cifra distinta en el módulo falla
 * aquí.
 */
const UMBRAL = 0.8;
/** Separación elegida para comprobar justo por debajo del umbral. */
const PELO = 0.0001;
/** Valores simulados que fijan los dos lados del umbral y las decisiones sin umbral. */
const PUNTUACION = {
  minima: 0.01,
  muyBaja: 0.1,
  baja: 0.3,
  media: 0.5,
  moderada: 0.7,
  bajoUmbral: 0.79,
  sobreUmbral: 0.81,
  alta: 0.9,
  casiMaxima: 0.99,
} as const;
const PUNTUACIONES_BAJAS = [
  0,
  PUNTUACION.minima,
  PUNTUACION.muyBaja,
  PUNTUACION.baja,
  PUNTUACION.media,
  PUNTUACION.moderada,
  PUNTUACION.bajoUmbral,
] as const;
const PUNTUACIONES_ALTAS = [PUNTUACION.sobreUmbral, PUNTUACION.alta, PUNTUACION.casiMaxima, 1] as const;
const PUNTUACIONES_DE_BLOQUEO_SIEMPRE = [0, PUNTUACION.minima, PUNTUACION.media, 1] as const;
const PUNTUACIONES_DE_AYUDA = [PUNTUACION.minima, PUNTUACION.media, 1] as const;

/**
 * Las categorías que, con puntuación alta, detienen el proceso: la especificación fijada aquí, que la prueba
 * «las listas fijadas son las del módulo» compara con BLOQUEAN_SI_ALTA (comun/categorias-moderacion.ts). Así una
 * categoría añadida o quitada en la fuente falla en vez de quedar sin probar.
 */
const FIJADAS_SI_ALTA = Object.freeze(['hate', 'hate/threatening', 'harassment/threatening', 'illicit/violent']);
/** Las que lo detienen siempre, con la puntuación que sea (fijadas frente a BLOQUEAN_SIEMPRE). */
const FIJADAS_SIEMPRE = Object.freeze(['sexual/minors']);
/** Las que paran el proceso para ofrecer el 024 (fijadas frente a PIDEN_AYUDA). */
const FIJADAS_AYUDA = Object.freeze(['self-harm/intent', 'self-harm/instructions']);

describe('Las categorías que paran el proceso', () => {
  test('las listas fijadas son las del módulo, en el mismo orden', () => {
    assert.deepEqual(FIJADAS_SI_ALTA, [...BLOQUEAN_SI_ALTA]);
    assert.deepEqual(FIJADAS_SIEMPRE, [...BLOQUEAN_SIEMPRE]);
    assert.deepEqual(FIJADAS_AYUDA, [...PIDEN_AYUDA]);
  });
});

describe('El umbral de puntuación alta', () => {
  test('en el umbral de puntuación alta se bloquea, y un pelo por debajo no', () => {
    for (const categoria of FIJADAS_SI_ALTA) {
      assert.equal(decidirModeracion([categoria], { [categoria]: UMBRAL }), 'bloquear', `${categoria} en ${UMBRAL}`);
      assert.equal(
        decidirModeracion([categoria], { [categoria]: UMBRAL - PELO }),
        'seguir',
        `${categoria} en ${UMBRAL - PELO}`,
      );
    }
  });

  test('por debajo del umbral no se bloquea, aunque el proveedor marque la categoría', () => {
    for (const categoria of FIJADAS_SI_ALTA) {
      for (const puntuacion of PUNTUACIONES_BAJAS) {
        assert.equal(
          decidirModeracion([categoria], { [categoria]: puntuacion }),
          'seguir',
          `${categoria} ${puntuacion}`,
        );
      }
    }
  });

  test('muy por encima del umbral se bloquea', () => {
    for (const categoria of FIJADAS_SI_ALTA) {
      for (const puntuacion of PUNTUACIONES_ALTAS) {
        assert.equal(
          decidirModeracion([categoria], { [categoria]: puntuacion }),
          'bloquear',
          `${categoria} ${puntuacion}`,
        );
      }
    }
  });

  test('la puntuación que cuenta es la de la categoría marcada, no la de otra', () => {
    // Una categoría marcada con puntuación baja no se bloquea porque otra, no marcada, venga alta.
    assert.equal(decidirModeracion(['hate'], { hate: 0.2, 'illicit/violent': 0.99 }), 'seguir');
    assert.equal(decidirModeracion(['hate'], { hate: 0.99, 'illicit/violent': 0.1 }), 'bloquear');
    // Varias marcadas: basta una alta.
    assert.equal(decidirModeracion(['hate', 'illicit/violent'], { hate: 0.2, 'illicit/violent': 0.95 }), 'bloquear');
    assert.equal(decidirModeracion(['hate', 'illicit/violent'], { hate: 0.2, 'illicit/violent': 0.3 }), 'seguir');
  });

  test('sin puntuaciones, la categoría marcada cuenta como alta (decisión explícita del módulo)', () => {
    for (const categoria of FIJADAS_SI_ALTA) {
      assert.equal(decidirModeracion([categoria]), 'bloquear', categoria);
      assert.equal(decidirModeracion([categoria], {}), 'bloquear', `${categoria} con puntuaciones vacías`);
    }
  });
});

describe('Las categorías que bloquean siempre y las que piden ayuda', () => {
  test('el contenido sexual con menores bloquea con cualquier puntuación, incluso 0', () => {
    for (const categoria of FIJADAS_SIEMPRE) {
      for (const puntuacion of PUNTUACIONES_DE_BLOQUEO_SIEMPRE) {
        assert.equal(
          decidirModeracion([categoria], { [categoria]: puntuacion }),
          'bloquear',
          `${categoria} ${puntuacion}`,
        );
      }
    }
    // También cuando llega junto a categorías que por sí solas no bloquearían.
    assert.equal(
      decidirModeracion(['violence', 'sexual/minors'], { violence: 0.1, 'sexual/minors': 0.02 }),
      'bloquear',
    );
  });

  test('la intención y las instrucciones de autolesión piden ayuda con cualquier puntuación', () => {
    for (const categoria of FIJADAS_AYUDA) {
      for (const puntuacion of PUNTUACIONES_DE_AYUDA) {
        assert.equal(
          decidirModeracion([categoria], { [categoria]: puntuacion }),
          'ayuda',
          `${categoria} ${puntuacion}`,
        );
      }
    }
    // La ayuda va antes que el bloqueo: si llegan las dos cosas, la persona ve el 024.
    assert.equal(decidirModeracion(['self-harm/intent', 'sexual/minors']), 'ayuda');
  });

  test('sin categorías marcadas se sigue siempre', () => {
    assert.equal(decidirModeracion([]), 'seguir');
    assert.equal(decidirModeracion([], { hate: 1, 'sexual/minors': 1 }), 'seguir');
  });
});

describe('Oficios duros: lo que la política promete no rechazar', () => {
  /**
   * Casos simulados de política para relatos legítimos que tratan con violencia, conflicto o salud mental.
   * Las cifras fijan lo que la política tolera; no son una medición del proveedor.
   */
  const OFICIOS_DUROS: { oficio: string; categorias: Record<string, number> }[] = [
    { oficio: 'bombero (rescate en un accidente)', categorias: { violence: 0.72, 'violence/graphic': 0.55 } },
    { oficio: 'enfermera de psiquiatría (intentos de suicidio)', categorias: { 'self-harm': 0.91 } },
    { oficio: 'enfermera de urgencias (heridas por arma blanca)', categorias: { 'violence/graphic': 0.88 } },
    { oficio: 'policía local (detenciones y peleas)', categorias: { violence: 0.64, harassment: 0.31 } },
    { oficio: 'matadero (sacrificio y despiece)', categorias: { violence: 0.83, 'violence/graphic': 0.79 } },
    { oficio: 'chapista (golpes y bollos)', categorias: { violence: 0.44 } },
    { oficio: 'forense (autopsias)', categorias: { 'violence/graphic': 0.95 } },
    {
      oficio: 'trabajadora social (relatos de maltrato y odio recibido)',
      categorias: { hate: 0.42, harassment: 0.38 },
    },
    { oficio: 'vigilante de seguridad (agresiones de clientes)', categorias: { violence: 0.6, harassment: 0.52 } },
    { oficio: 'teléfono de la esperanza (escucha a quien quiere morir)', categorias: { 'self-harm': 0.97 } },
  ];

  test('un relato legítimo de un oficio duro no se rechaza', () => {
    const rechazados = OFICIOS_DUROS.filter(
      ({ categorias }) => decidirModeracion(Object.keys(categorias), categorias) !== 'seguir',
    ).map(({ oficio }) => oficio);
    assert.deepEqual(rechazados, []);
  });

  test('violencia y «self-harm» a secas no bloquean ni con la puntuación máxima', () => {
    for (const categoria of ['violence', 'violence/graphic', 'self-harm', 'harassment', 'sexual', 'illicit']) {
      assert.equal(decidirModeracion([categoria], { [categoria]: 1 }), 'seguir', categoria);
    }
  });
});

describe('La llamada al moderador', () => {
  test('sin moderador configurado se sigue sin categorías ni aviso', async () => {
    assert.deepEqual(await moderarAntesDelModelo({}, 'Soy cajera'), { categorias: [], aviso: null });
  });

  test('envía exactamente el texto una vez y devuelve categorías y aviso en cada idioma', async () => {
    const texto = 'Soy cajera';
    for (const [idioma, aviso] of [
      ['es', AVISO_AYUDA],
      ['ca', AVISO_AYUDA_CA],
    ] as const) {
      const recibidos: string[] = [];
      const moderador: Moderador = {
        async moderar(recibido) {
          recibidos.push(recibido);
          return { categorias: ['self-harm/intent'] };
        },
      };
      assert.deepEqual(await moderarAntesDelModelo(moderador, texto, idioma), {
        categorias: ['self-harm/intent'],
        aviso: { tipo: 'ayuda', texto: aviso },
      });
      assert.deepEqual(recibidos, [texto]);
    }
  });

  test('propaga el mismo error del moderador', async () => {
    const fallo = new Error('la moderación no responde');
    const moderador: Moderador = {
      async moderar() {
        throw fallo;
      },
    };
    await assert.rejects(moderarAntesDelModelo(moderador, 'Soy cajera'), (error) => error === fallo);
  });

  test('cada aviso es una copia y no permite alterar los avisos posteriores', async () => {
    const moderador: Moderador = {
      async moderar() {
        return { categorias: ['self-harm/intent'] };
      },
    };
    const primera = await moderarAntesDelModelo(moderador, 'Soy cajera');
    assert.ok(primera.aviso);
    primera.aviso.texto = 'Texto cambiado en quien consume la respuesta';
    const segunda = await moderarAntesDelModelo(moderador, 'Soy cajera');
    assert.deepEqual(segunda.aviso, { tipo: 'ayuda', texto: AVISO_AYUDA });
  });
});

test('el aviso de fuera de tema habla en singular y es el mismo que dice la pantalla en cada idioma', async () => {
  const moderador: Moderador = { moderar: () => Promise.resolve({ categorias: ['harassment/threatening'] }) };
  for (const [idioma, texto, diccionario] of [
    ['es', 'Solo puedo ayudarte con la descripción de tu trabajo. Cuéntame qué tareas haces.', RECORRIDO_ES],
    ['ca', 'Només et puc ajudar amb la descripció de la teva feina. Explica’m quines tasques fas.', RECORRIDO_CA],
  ] as const) {
    const { aviso } = await moderarAntesDelModelo(moderador, 'texto', idioma);
    assert.deepEqual(aviso, { tipo: 'fuera-de-tema', texto });
    assert.equal(texto, diccionario['recorrido.aviso-del-motor.fuera-de-tema'], idioma);
  }
});
