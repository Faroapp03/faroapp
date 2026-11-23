// Acreditación con fichas mínimas propias: prioridades, niveles, fuentes SEPE, fecha de comprobación e idiomas.
// No requiere el catálogo oficial ni archivos fuera del repositorio.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueDeAcreditacion,
  certificadosRelacionados,
  comprobacionAntigua,
  MAX_DIAS_COMPROBACION,
  varianteDe,
} from '../../src/dominio/acreditacion.ts';
import { TEXTOS_ACREDITACION_ES } from '../../src/dominio/textos-acreditacion.ts';
import { TEXTOS_ACREDITACION_CA } from '../../src/dominio/textos-acreditacion-ca.ts';
import type {
  BloqueAcreditacion,
  CertificadoOficial,
  DatosAcreditacion,
} from '../../src/dominio/tipos-acreditacion.ts';

const NIVEL_INTERMEDIO = 2;
const NIVEL_MAXIMO = 3;
const HORAS_CERTIFICADO = 100;
const HORAS_MODULO = 120;
const HORAS_EXPERIENCIA = 1000;
const ANIO_PERFIL = 2024;
const PAGINA_MEMORIA = 42;
const PERSONAS_MEMORIA = 1500;
const PENDIENTES_MEMORIA = 2500;
const PUNTOS_MEMORIA = 300;
const HOY = '2026-10-13';
const OCUPACION = { esco: 'ocupacion', isco08: 'grupo' };

/** Ficha independiente del catálogo, con una unidad reemplazada y cifras incompatibles deliberadas. */
function certificado(nivel: CertificadoOficial['nivel'] = 1): CertificadoOficial {
  return {
    nombre: { es: 'Nombre oficial', ca: 'Nom oficial' },
    nivel,
    horas: HORAS_CERTIFICADO,
    familia: 'FAM',
    real_decreto: '1/2020',
    boe: 'https://example.invalid/boe',
    unidades: [
      {
        codigo: 'UC-ANTIGUA',
        nombre: { es: 'Unidad oficial', ca: 'Unitat oficial' },
        modulo: 'MF',
        horas: HORAS_MODULO,
        actuales: [{ codigo: 'UC-NUEVA', nombre: 'Unidad actual' }],
      },
    ],
    oferta_cataluna: 'si',
  };
}

/** Paquete pequeño para ejercer las reglas sin copiar datos oficiales. */
function acreditacion(): DatosAcreditacion {
  return {
    fuentes: { boe: 'BOE', ine: 'INE', soc: 'SOC' },
    fecha_boe: '2026-10-01',
    comprobado: '2026-10-01',
    horas_nivel_1: HORAS_EXPERIENCIA,
    no_disponibles: ['SAN'],
    oferta_actualizada: '2026-10-01',
    enlaces: {
      tramite: { es: 'https://example.invalid/es/tramite', ca: 'https://example.invalid/ca/tramit' },
      agencia: { ca: 'https://example.invalid/ca/agencia' },
      orientacion: { ca: 'https://example.invalid/ca/orientacio' },
      expedicion: { ca: 'https://example.invalid/ca/expedicio' },
    },
    relaciones: {
      ocupaciones: {
        ocupacion: [
          ['C', 'grupo'],
          ['B', 'ocupacion'],
          ['A', 'ocupacion'],
        ],
      },
      grupos: { grupo: ['B', 'A', 'C'] },
    },
    certificados: {
      A: certificado(),
      B: certificado(NIVEL_INTERMEDIO),
      C: certificado(NIVEL_MAXIMO),
      SAN: certificado(),
    },
  };
}

/** El bloque presente; la ausencia es un fallo de preparación de esta prueba. */
function bloque(paquete: DatosAcreditacion = acreditacion(), idioma: 'es' | 'ca' = 'es'): BloqueAcreditacion {
  const resultado = bloqueDeAcreditacion({ acreditacion: paquete }, OCUPACION, HOY, idioma);
  assert.ok(resultado);
  return resultado;
}

/** Dos fuentes SEPE que solapan entre sí y con los certificados comprobados. */
function fuentesSepe() {
  return {
    perfilesSepe: {
      fuente: 'SEPE',
      cita: 'Perfil',
      perfiles: [['Perfil de prueba', ANIO_PERFIL]] satisfies [string, number][],
      ocupaciones: {
        ocupacion: [
          ['A', 0],
          ['C', 0],
          ['SAN', 0],
          ['INEXISTENTE', 0],
        ] satisfies [string, number][],
      },
    },
    certificadosSepe2016: {
      fuente: 'SEPE',
      cita: 'Informe',
      ocupaciones: {
        ocupacion: [
          ['A', []],
          ['C', []],
          ['B', ['UC-ANTIGUA']],
        ] satisfies [string, string[]][],
      },
    },
  };
}

test('sin acreditación el paquete no produce un bloque', () => {
  assert.equal(bloqueDeAcreditacion({}, OCUPACION, HOY), null);
});

test('el orden prioriza ocupación, después nivel y código sin alterar las relaciones originales', () => {
  const datos = acreditacion();
  datos.certificados.D = certificado();
  datos.relaciones.ocupaciones.ocupacion?.push(['D', 'ocupacion']);
  const antes = structuredClone(datos);
  assert.deepEqual(certificadosRelacionados(datos, OCUPACION), [
    ['A', 'ocupacion'],
    ['D', 'ocupacion'],
    ['B', 'ocupacion'],
    ['C', 'grupo'],
  ]);
  assert.deepEqual(datos, antes);
});

test('un grupo sin ESCO solo consulta sus relaciones y las ordena por nivel', () => {
  assert.deepEqual(certificadosRelacionados(acreditacion(), { esco: null, isco08: 'grupo' }), [
    ['A', 'grupo'],
    ['B', 'grupo'],
    ['C', 'grupo'],
  ]);
  assert.deepEqual(certificadosRelacionados(acreditacion(), { esco: 'desconocida', isco08: 'grupo' }), []);
});

test('las cuatro variantes comprobadas dependen de certificados disponibles', () => {
  const datos = acreditacion();
  assert.equal(
    varianteDe(
      [
        ['A', 'ocupacion'],
        ['C', 'grupo'],
      ],
      datos,
    ),
    'por-ocupacion',
  );
  assert.equal(varianteDe([['C', 'grupo']], datos), 'por-grupo');
  assert.equal(varianteDe([['SAN', 'ocupacion']], datos), 'sanidad');
  assert.equal(varianteDe([], datos), 'sin-relacion');
});

test('sin certificados conserva orientación y omite requisitos, procedimiento y expedición', () => {
  const datos = acreditacion();
  datos.relaciones = { ocupaciones: {}, grupos: {} };
  const resultado = bloque(datos);
  assert.equal(resultado.variante, 'sin-relacion');
  assert.deepEqual(resultado.certificados, []);
  assert.deepEqual(resultado.requisitos, []);
  assert.equal(resultado.comprueba, null);
  assert.equal(resultado.comoFunciona, null);
  assert.equal(resultado.expedicion, null);
  assert.deepEqual(
    resultado.enlaces.map(({ url }) => url),
    [datos.enlaces.orientacion.ca],
  );
});

test('los certificados disponibles separan requisitos de nivel 1 y de niveles 2 y 3', () => {
  const resultado = bloque();
  assert.deepEqual(
    resultado.requisitos.map(({ niveles }) => niveles),
    [[1], [NIVEL_INTERMEDIO, NIVEL_MAXIMO]],
  );
  assert.match(resultado.requisitos[0]?.lista[1] ?? '', /^18 años/);
  assert.match(resultado.requisitos[0]?.lista[2] ?? '', /1\.000 horas/);
  assert.match(resultado.requisitos[1]?.lista[1] ?? '', /^20 años/);
  assert.match(resultado.requisitos[1]?.lista[2] ?? '', /3 años.*2\.000 horas/);
});

test('las cifras contradictorias de horas se omiten sin modificar los módulos oficiales', () => {
  const resultado = bloque().certificados[0];
  assert.ok(resultado);
  assert.equal(resultado.horas, null);
  assert.equal(resultado.unidades[0]?.horas, HORAS_MODULO);
  assert.equal(resultado.unidades[0]?.modulo, 'MF');
});

test('las horas coherentes y ausentes conservan su valor', () => {
  const datos = acreditacion();
  assert.ok(datos.certificados.A);
  datos.certificados.A.horas = HORAS_MODULO;
  assert.equal(bloque(datos).certificados[0]?.horas, HORAS_MODULO);
  datos.certificados.A.horas = null;
  assert.equal(bloque(datos).certificados[0]?.horas, null);
});

test('los nombres oficiales, equivalencias y textos siguen el idioma solicitado', () => {
  const resultado = bloque(acreditacion(), 'ca');
  assert.equal(resultado.titulo, 'Acreditar el que ja saps fer');
  assert.equal(resultado.certificados[0]?.nombre, 'Nom oficial');
  assert.equal(resultado.certificados[0]?.unidades[0]?.nombre, 'Unitat oficial');
  assert.equal(
    resultado.certificados[0]?.unidades[0]?.equivalencia,
    'Avui equival a UC-NUEVA «Unidad actual» (Reial decret 151/2022).',
  );
  assert.match(resultado.certificados[0]?.presentacion ?? '', /Té 1 unitat de competència/);
});

test('sin traducción usa el otro idioma y sin nombres usa código o null', () => {
  const datos = acreditacion();
  assert.ok(datos.certificados.A);
  datos.certificados.A.nombre = { es: 'Nombre único', ca: null };
  assert.equal(bloque(datos, 'ca').certificados[0]?.nombre, 'Nombre único');
  datos.certificados.A.nombre = { es: null, ca: null };
  const unidad = datos.certificados.A.unidades[0];
  assert.ok(unidad);
  unidad.nombre = { es: null, ca: null };
  unidad.actuales = [];
  const resultado = bloque(datos, 'ca').certificados[0];
  assert.equal(resultado?.nombre, 'A');
  assert.equal(resultado?.unidades[0]?.nombre, null);
  assert.equal(resultado?.unidades[0]?.equivalencia, null);
});

test('la oferta solo marca sí cuando está comprobada y la etiqueta distingue grupo', () => {
  const datos = acreditacion();
  assert.ok(datos.certificados.B);
  datos.certificados.B.oferta_cataluna = 'sin-comprobar';
  const resultado = bloque(datos).certificados;
  assert.deepEqual(
    resultado.map(({ sePuedePedirAhora }) => sePuedePedirAhora),
    [true, false, true],
  );
  assert.deepEqual(
    resultado.map(({ etiqueta }) => etiqueta),
    [null, null, TEXTOS_ACREDITACION_ES.etiquetaGrupo],
  );
});

test('lo comprobado manda sobre perfiles y los perfiles sobre el informe sin duplicados', () => {
  const datos = acreditacion();
  datos.relaciones.ocupaciones.ocupacion = [['A', 'ocupacion']];
  const resultado = bloqueDeAcreditacion({ acreditacion: datos, ...fuentesSepe() }, OCUPACION, HOY);
  assert.ok(resultado?.sepe);
  assert.deepEqual(
    resultado.certificados.map(({ codigo }) => codigo),
    ['A'],
  );
  assert.deepEqual(
    resultado.sepe.perfiles.map(({ certificados }) => certificados.map(({ codigo }) => codigo)),
    [['C'], ['B']],
  );
  assert.deepEqual(
    resultado.sepe.perfiles.map(({ anio }) => anio),
    [ANIO_PERFIL, null],
  );
  assert.ok(
    resultado.sepe.perfiles.flatMap(({ certificados }) => certificados).every(({ etiqueta }) => etiqueta === null),
  );
});

test('cada perfil del SEPE ordena por nivel y código sin modificar su lista original', () => {
  const datos = acreditacion();
  datos.relaciones.ocupaciones.ocupacion = [];
  datos.certificados.D = certificado(NIVEL_INTERMEDIO);
  const fuentes = fuentesSepe();
  fuentes.perfilesSepe.ocupaciones.ocupacion = [
    ['C', 0],
    ['D', 0],
    ['B', 0],
  ];
  fuentes.certificadosSepe2016.ocupaciones.ocupacion = [];
  const antes = structuredClone(fuentes);
  const resultado = bloqueDeAcreditacion({ acreditacion: datos, ...fuentes }, OCUPACION, HOY);
  assert.ok(resultado?.sepe);
  assert.deepEqual(
    resultado.sepe.perfiles[0]?.certificados.map(({ codigo }) => codigo),
    ['B', 'D', 'C'],
  );
  assert.deepEqual(fuentes, antes);
});

test('el informe SEPE nombra las unidades relacionadas sin afirmar una relación comprobada', () => {
  const datos = acreditacion();
  datos.relaciones.ocupaciones.ocupacion = [];
  const resultado = bloqueDeAcreditacion({ acreditacion: datos, ...fuentesSepe() }, OCUPACION, HOY, 'ca');
  assert.ok(resultado?.sepe);
  assert.equal(resultado.variante, 'solo-sepe');
  assert.equal(resultado.introduccion, TEXTOS_ACREDITACION_CA.soloSepe);
  const informe = resultado.sepe.perfiles.at(-1);
  assert.ok(informe);
  assert.match(informe.certificados[0]?.presentacion ?? '', /per aquesta unitat: «Unitat oficial»\.$/);
  assert.doesNotMatch(JSON.stringify(resultado.sepe), /2016|inclou la teva ocupació/);
});

test('el aviso sanitario se mantiene aunque el SEPE aporte otros certificados disponibles', () => {
  const datos = acreditacion();
  datos.relaciones.ocupaciones.ocupacion = [['SAN', 'ocupacion']];
  const resultado = bloqueDeAcreditacion({ acreditacion: datos, ...fuentesSepe() }, OCUPACION, HOY);
  assert.ok(resultado);
  assert.equal(resultado.variante, 'sanidad');
  assert.equal(resultado.introduccion, TEXTOS_ACREDITACION_ES.sanidad);
  assert.deepEqual(resultado.certificados, []);
  assert.ok(resultado.requisitos.length > 0);
});

test('el grupo sin ESCO no recibe certificados relacionados por el SEPE', () => {
  const resultado = bloqueDeAcreditacion(
    { acreditacion: acreditacion(), ...fuentesSepe() },
    { esco: null, isco08: 'grupo' },
    HOY,
  );
  assert.equal(resultado?.sepe, null);
});

test('a los 60 días la comprobación pasa a antigua, pero solo informa', () => {
  const LIMITE_DIAS = 60;
  assert.equal(MAX_DIAS_COMPROBACION, LIMITE_DIAS);
  assert.equal(comprobacionAntigua('2026-10-01', '2026-11-30'), false);
  assert.equal(comprobacionAntigua('2026-10-01', '2026-12-01'), true);
  for (const fecha of ['no es fecha', '2026-02-30', '2026-1-1', '']) {
    assert.equal(comprobacionAntigua(fecha, HOY), true);
    assert.equal(comprobacionAntigua('2026-10-01', fecha), true);
  }
});

test('los requisitos se dan siempre con su fecha de comprobación, también pasados 61 y 400 días', () => {
  const reciente = bloque();
  assert.ok(reciente.requisitos.length > 0);
  // HOY menos 61 y menos 400 días.
  for (const [dias, comprobado] of [
    ['61', '2026-08-13'],
    ['400', '2025-09-08'],
  ] as const) {
    const datos = acreditacion();
    datos.comprobado = comprobado;
    for (const idioma of ['es', 'ca'] as const) {
      const resultado = bloque(datos, idioma);
      assert.equal(resultado.comprobacionAntigua, true, `${dias} días`);
      assert.deepEqual(resultado.requisitos, bloque(acreditacion(), idioma).requisitos, `${dias} días`);
      const textos = idioma === 'ca' ? TEXTOS_ACREDITACION_CA : TEXTOS_ACREDITACION_ES;
      assert.equal(resultado.comprueba, textos.comprueba(resultado.fuente.match(/ el (.+)\.$/)?.[1] ?? ''));
      assert.match(resultado.comprueba ?? '', idioma === 'ca' ? /pàgina del tràmit/ : /página del trámite/);
      assert.match(resultado.fuente, /Comprobado el|Comprovat el/);
      assert.equal(resultado.comprobado, comprobado);
    }
  }
});

test('el teléfono y la memoria solo aparecen como datos públicos aportados por el paquete', () => {
  const datos = acreditacion();
  assert.equal('escala' in bloque(datos), false);
  assert.doesNotMatch(bloque(datos).dondeInformarse, /teléfono/);
  datos.punto_de_informacion = { telefono: '93 000 00 00', url: 'https://example.invalid', comprobado: HOY };
  datos.memoria_fpcat = {
    cita: 'Memoria',
    url: 'https://example.invalid',
    pagina: PAGINA_MEMORIA,
    periodo: '2020-2025',
    personas_con_cualificacion_entera: PERSONAS_MEMORIA,
    solicitudes_pendientes: PENDIENTES_MEMORIA,
    puntos_de_orientacion: PUNTOS_MEMORIA,
  };
  const resultado = bloque(datos);
  assert.match(resultado.dondeInformarse, /teléfono 93 000 00 00/);
  assert.match(resultado.escala ?? '', /de 2020 a 2025, 1\.500 personas.*2\.500.*300.*p\. 42/);
});

test('sin horas de nivel 1 los dos idiomas remiten al trámite y conservan las cifras estatales', () => {
  for (const textos of [TEXTOS_ACREDITACION_ES, TEXTOS_ACREDITACION_CA]) {
    assert.match(textos.requisitos.experiencia(true, null), /mínim|mínimo/);
    assert.match(textos.requisitos.experiencia(false, null), /2\.000.*300/);
    assert.match(textos.comoFunciona, /9–11/);
  }
});

test('el bloque no usa datos personales ni cambia las fichas que recibe', () => {
  const datos = acreditacion();
  const antes = structuredClone(datos);
  const persona = { ...OCUPACION, edad: 0, experiencia: 0, nombre: 'Persona' };
  assert.deepEqual(bloqueDeAcreditacion({ acreditacion: datos }, persona, HOY), bloque(datos));
  assert.deepEqual(datos, antes);
});
