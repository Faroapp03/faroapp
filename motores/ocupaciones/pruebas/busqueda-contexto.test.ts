// Las mejoras léxicas del buscador: el lugar de trabajo separado del oficio y sus pistas de
// sector, los títulos del SEPE como nombres de búsqueda, los títulos partidos por «/» completos, el peso rebajado de
// las palabras genéricas y la petición de precisión, la búsqueda en catalán junto al castellano y la tolerancia a
// faltas. Los textos de estas pruebas no salen del banco de evaluación del recorrido: son casos propios.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearPeticionLocal } from '../../../src/api/cuerpo-local.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../../src/comun/protocolo-web.ts';
import { motorDeCursos } from '../../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { buscarConContexto } from '../src/busqueda/analisis.ts';
import { partirOficioYLugar, pistasDeSector } from '../src/busqueda/contexto.ts';
import { corregir, distancia } from '../src/busqueda/correccion.ts';
import { delSepe, formasCompletas, nombreDelSepe } from '../src/busqueda/denominaciones.ts';
import { esGenerica, precisionQueFalta } from '../src/busqueda/genericas.ts';
import { indiceDe } from '../src/busqueda/indice.ts';
import { buscarOcupaciones, textoComoEnEsco } from '../src/busqueda/ocupaciones.ts';
import { formaComun } from '../src/busqueda/palabras.ts';

/** Candidatas que se piden por búsqueda (las mismas que /api/clasificar). */
const CANDIDATAS = 8;
/** Ocupaciones ESCO con algún título del SEPE: hay más de mil en el paquete. */
const MINIMO_CON_SEPE = 1000;
/** Puntos de un nombre idéntico a la búsqueda. */
const NOMBRE_IDENTICO = 100;
/** Tope de distancia en las pruebas de la distancia, y lo que cuestan una falta corriente, una letra y tres. */
const TOPE = 2;
const MEDIA = 0.5;
const TRES = 3;
const CORRECTO = 200;

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const sectores = (texto: string) => pistasDeSector(partirOficioYLugar(texto)).map((pista) => pista.sector);
const primerGrupo = (texto: string, idioma: 'es' | 'ca' = 'es') =>
  buscarOcupaciones(datos, texto, CANDIDATAS, { idioma })[0]?.isco08;

describe('El lugar de trabajo no es el oficio', () => {
  it('separa el lugar que sigue al oficio, en castellano y en catalán', () => {
    assert.deepEqual(partirOficioYLugar('Soy fontanera en una empresa de reformas'), {
      oficio: 'soy fontanera',
      lugar: 'en una empresa de reformas',
    });
    assert.deepEqual(partirOficioYLugar("Sóc conserge de l'ajuntament"), {
      oficio: 'soc conserge',
      lugar: 'de l ajuntament',
    });
    assert.deepEqual(partirOficioYLugar('cocinero en un hospital, hago menús'), {
      oficio: 'cocinero hago menus',
      lugar: 'en un hospital',
    });
  });

  it('no toma por lugar el oficio que va tras «trabajo en» ni los complementos sin determinante', () => {
    assert.equal(partirOficioYLugar('trabajo en la cocina de un restaurante').oficio, 'trabajo en la cocina');
    assert.equal(partirOficioYLugar('mestre d’institut').lugar, '');
    assert.equal(partirOficioYLugar('limpiador de oficinas').lugar, '');
    assert.equal(partirOficioYLugar('auxiliar de ayuda a domicilio').lugar, '');
  });

  it('el lugar no arrastra a los oficios que solo lo nombran', () => {
    assert.equal(primerGrupo('cocinero en un hospital'), '5120');
    assert.equal(primerGrupo('Soy conserje en el ayuntamiento'), '5153');
    assert.equal(primerGrupo('Soy fontanera en una empresa de reformas'), '7126');
  });

  it('devuelve las pistas de sector aparte, también las de un lugar ambiguo solo dentro del lugar', () => {
    assert.deepEqual(sectores('Soy conserje en el ayuntamiento'), ['publico']);
    assert.deepEqual(sectores('cocinero en un hospital'), ['sanitario']);
    assert.deepEqual(sectores('pediatra en un CAP'), ['sanitario']);
    assert.deepEqual(sectores('cap de cuina'), []);
    assert.deepEqual(sectores('Treballo de cuiner en un restaurant'), ['hosteleria']);
    assert.deepEqual(sectores('Soy fontanera'), []);
  });
});

describe('Títulos del SEPE y títulos partidos', () => {
  it('prepara los títulos del SEPE en singular, sin aclaraciones ni excepciones', () => {
    assert.equal(nombreDelSepe('CAMARERAS DE PISOS'), 'camarera de piso');
    assert.equal(nombreDelSepe('CONDUCTORES-OPERADORES DE GRÚA FIJA, EN GENERAL'), 'conductor operador de grúa fija');
    assert.equal(nombreDelSepe('ENCARGADOS O CAPATACES AGRÍCOLAS, EXCEPTO EN HUERTAS'), 'encargado o capataz agrícola');
    assert.equal(nombreDelSepe('MONITORES Y/O ANIMADORES DEPORTIVOS'), 'monitor y animador deportivo');
  });

  it('solo usa los enlaces exactos y estrechos, con el grupo CNO-11 de su código', () => {
    const sepe = delSepe(datos);
    assert.ok(sepe.size > MINIMO_CON_SEPE);
    for (const [esco, { cno11 }] of sepe) {
      assert.ok(datos.esco.ocupaciones[esco], esco);
      assert.ok(
        cno11.every((codigo) => /^\d{4}$/.test(codigo)),
        esco,
      );
    }
  });

  it('encuentra ocupaciones por su denominación del SEPE', () => {
    // «limpiadores en instituciones sanitarias» solo está en el SEPE (enlace con 9112.2).
    assert.equal(primerGrupo('limpiadora en instituciones sanitarias'), '9112');
    assert.equal(primerGrupo('médico especialista en medicina familiar'), '2211');
  });

  it('completa las formas cortas de un título partido por «/»', () => {
    assert.deepEqual(formasCompletas('técnico/técnica de alimentación'), [
      'técnico de alimentación',
      'técnica de alimentación',
    ]);
    assert.deepEqual(formasCompletas('redactor/a de revista'), ['redactor de revista']);
    assert.deepEqual(formasCompletas('cajero/cajera'), ['cajero', 'cajera']);
    const tecnico = buscarOcupaciones(datos, 'técnico');
    assert.ok(
      tecnico.every((candidata) => candidata.puntos < NOMBRE_IDENTICO),
      'ningún nombre es «técnico» a secas',
    );
  });
});

describe('Palabras genéricas y petición de precisión', () => {
  it('reconoce las palabras de rango en castellano y en catalán', () => {
    for (const palabra of ['tecnica', 'tecnic', 'auxiliar', 'ajudant', 'responsables', 'operaria']) {
      assert.ok(esGenerica(formaComun(palabra)), palabra);
    }
    assert.ok(!esGenerica(formaComun('fontanero')));
  });

  it('pide precisión solo cuando la búsqueda es una sola palabra genérica', () => {
    assert.equal(precisionQueFalta('soy tecnica'), 'tecnico');
    assert.equal(precisionQueFalta('auxiliar'), 'auxiliar');
    assert.equal(precisionQueFalta('auxiliar de enfermeria'), undefined);
    assert.equal(buscarConContexto(datos, 'Sóc tècnica', { idioma: 'ca' }).necesitaPrecision, 'tecnico');
    assert.equal(buscarConContexto(datos, 'técnico en la Generalitat').necesitaPrecision, 'tecnico');
    assert.equal(buscarConContexto(datos, 'técnico de sonido').necesitaPrecision, undefined);
  });

  it('la palabra del oficio decide sobre la genérica', () => {
    assert.equal(primerGrupo('técnico de sonido'), '3435');
    assert.equal(primerGrupo('auxiliar de enfermería'), '5321');
  });
});

describe('Plurales de palabras cortas', () => {
  it('busca el plural corto como su singular si el índice no tiene su raíz', () => {
    assert.equal(buscarOcupaciones(datos, 'mozos de almacén')[0]?.isco08, '9333');
    assert.equal(buscarOcupaciones(datos, 'mozas de cuadra')[0]?.esco, '9212.3');
  });
});

describe('Siglas escritas con puntos', () => {
  it('se leen sin los puntos: «A.T.S.» es «ATS»; «p. ej.», «EE. UU.» o «col.legi» no cambian', () => {
    assert.equal(textoComoEnEsco('Soy A.T.S. en el hospital.'), 'Soy ATS en el hospital.');
    assert.equal(textoComoEnEsco('v.s'), 'vs');
    assert.equal(textoComoEnEsco('R.R.H.H.'), 'recursos humanos');
    for (const igual of ['p. ej. camarero', 'EE. UU.', 'col.legi', 'www.x.com', '1.5 horas']) {
      assert.equal(textoComoEnEsco(igual), igual);
    }
  });

  it('las siglas que solo lo son en mayúsculas se buscan por su marca; en minúscula o en un texto en mayúsculas, no', () => {
    assert.equal(textoComoEnEsco('sóc PAS de la UB'), 'sóc siglapas de la UB');
    assert.equal(textoComoEnEsco('PAS'), 'siglapas');
    assert.equal(textoComoEnEsco('P.A.S. de la universitat'), 'siglapas de la universitat');
    for (const igual of ['pas a pas', 'NO ÉS PAS FÀCIL', 'me dedico a limpiar', 'voy al almacén']) {
      assert.equal(textoComoEnEsco(igual), igual);
    }
  });

  it('el buscador encuentra lo mismo con puntos que sin ellos', () => {
    for (const [conPuntos, sinPuntos] of [
      ['A.T.S.', 'ATS'],
      ['soy D.U.E.', 'soy DUE'],
      ['V.S.', 'VS'],
      ['T.C.A.E.', 'TCAE'],
    ] as const) {
      assert.equal(primerGrupo(conPuntos), primerGrupo(sinPuntos), conPuntos);
    }
  });
});

describe('Catalán junto al castellano', () => {
  it('con la página en catalán busca en los dos índices', () => {
    assert.deepEqual(buscarConContexto(datos, 'Sóc fontanera', { idioma: 'ca' }).idiomasBuscados, ['es', 'ca']);
    assert.deepEqual(buscarConContexto(datos, 'Soy fontanera').idiomasBuscados, ['es']);
    assert.equal(primerGrupo('Sóc fontanera', 'ca'), '7126');
    assert.equal(primerGrupo('Treballo de cuiner en un restaurant', 'ca'), '5120');
    assert.equal(primerGrupo("Sóc conserge de l'ajuntament", 'ca'), '5153');
  });
});

describe('Tolerancia a faltas', () => {
  it('las faltas corrientes cuestan media letra', () => {
    assert.equal(distancia('fontanerr', 'fontaner', TOPE), MEDIA);
    assert.equal(distancia('conserg', 'conserj', TOPE), MEDIA);
    assert.equal(distancia('conserg', 'conserv', TOPE), 1);
    assert.equal(distancia('kitten', 'sitting', TOPE), TRES);
  });

  it('busca la palabra parecida del vocabulario y anota la corrección', () => {
    const fontanero = buscarConContexto(datos, 'fontanerro');
    assert.equal(fontanero.candidatas[0]?.isco08, '7126');
    assert.deepEqual(fontanero.correcciones, [{ de: 'fontanerr', a: 'fontaner' }]);
    assert.equal(primerGrupo('carnizero'), '7511');
    assert.equal(primerGrupo('Soy cosinera'), '5120');
  });

  it('no corrige palabras cortas, nombres propios ni palabras corrientes lejanas', () => {
    const indice = indiceDe(datos);
    for (const palabra of ['petita', 'sueldo', 'estic', 'mucho', 'barrio', 'semana']) {
      assert.equal(corregir(indice, formaComun(palabra)), null, palabra);
    }
    assert.equal(buscarConContexto(datos, 'Soy Rosalba, cajera').correcciones, undefined);
  });
});

describe('Contrato de la salida', () => {
  it('cada candidata lleva sus grupos CNO-11 y los grupos se agrupan en orden', () => {
    const resultado = buscarConContexto(datos, 'camarera de pisos en un hotel');
    assert.ok(resultado.candidatas.length > 0);
    assert.ok(resultado.candidatas.every((candidata) => Array.isArray(candidata.cno11)));
    assert.equal(resultado.grupos[0]?.isco08, resultado.candidatas[0]?.isco08);
    assert.deepEqual(
      resultado.pistasDeSector.map((pista) => pista.sector),
      ['hosteleria'],
    );
    assert.equal(resultado.lugar, 'en un hotel');
  });
});

describe('POST /api/clasificar en IA OFF', () => {
  /** La respuesta de /api/clasificar con el motor del dispositivo (las mismas opciones que crearMotorLocal). */
  async function clasificar(texto: string, idioma: 'es' | 'ca' = 'es'): Promise<Record<string, unknown>> {
    const api = await crearApiLocal({ datos, motorDeCursos });
    const respuesta = await api(
      crearPeticionLocal({
        url: 'http://localhost/api/clasificar',
        method: 'POST',
        headers: [
          ['content-type', 'application/json'],
          [CABECERA_CONTRATO, String(CONTRATO_API)],
        ],
        body: JSON.stringify({ texto, idioma }),
      }),
    );
    assert.equal(respuesta.status, CORRECTO);
    return (await respuesta.json()) as Record<string, unknown>;
  }

  it('publica las pistas de sector y la precisión que falta solo cuando las hay', async () => {
    const tecnico = await clasificar('Sóc tècnica a la Generalitat', 'ca');
    assert.deepEqual(tecnico.busqueda, {
      pistasDeSector: [{ sector: 'publico', palabra: 'generalitat', grupos: ['1112', '242', '335', '3343', '4110'] }],
      necesitaPrecision: 'tecnico',
    });
    const fontanera = await clasificar('Soy fontanera');
    assert.equal(fontanera.busqueda, undefined);
    assert.deepEqual(Object.keys(fontanera).sort(), ['avisos', 'candidatas', 'decision', 'grupos', 'marcaIa']);
  });

  it('las candidatas conservan su forma', async () => {
    const { candidatas } = (await clasificar('cocinero en un hospital')) as { candidatas: Record<string, unknown>[] };
    assert.ok(candidatas.length > 0);
    assert.equal(candidatas[0]?.isco08, '5120');
    assert.ok(candidatas.every((candidata) => !('cno11' in candidata)));
  });
});
