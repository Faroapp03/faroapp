// La geometría con que herramientas/web/traer-globo.ts prepara las fronteras del globo: la unión de provincias que
// comparten bordes deja solo el contorno exterior, la simplificación conserva lo que se aparta más que su tolerancia,
// la codificación en diferencias vuelve a los mismos enteros y quita lo que el redondeo repite, y un GeoJSON que no es
// un polígono se rechaza.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Anillo,
  anillosDeGeometria,
  centroDeLaCaja,
  codificar,
  contornoDeLaUnion,
  GeometriaInvalida,
  simplificar,
} from '../../herramientas/web/geometria-del-globo.ts';

/** Vértices del contorno de dos cuadrados vecinos: las cuatro esquinas y los dos extremos del borde común. */
const VERTICES_DEL_CONTORNO = 6;
/** Lado del territorio con hueco, en grados. */
const LADO = 3;
/** Esquina suroeste de un cuadrado lejano que no toca a ningún otro, en grados. */
const LEJOS = 5;
/** Desvío mínimo de un vértice casi alineado, en grados: menor que la tolerancia. */
const DESVIO_MINIMO = 0.001;
/** Altura de un vértice que sí se aparta de la recta, en grados. */
const ALTURA_DEL_PICO = 1.5;
/** Tolerancia de simplificación, en grados. */
const TOLERANCIA = 0.01;
/** Tolerancia mayor que el anillo entero, en grados. */
const TOLERANCIA_ENORME = 100;
/** Enteros por grado de la codificación. */
const ENTEROS_POR_GRADO = 100;
/** Longitud fuera de rango (máximo 180), en grados. */
const LONGITUD_FUERA_DE_RANGO = 181;
/** Longitud del primer punto que se codifica, en grados. */
const X_INICIAL = 1.234;
/** Latitud del primer punto que se codifica, en grados. */
const Y_INICIAL = 2.001;
/** Diferencia que el redondeo a centésimas de grado borra, en grados. */
const REDONDEO = 0.0001;
/** Longitud de los puntos tercero y cuarto, en grados. */
const X_FINAL = 3.5;
/** Latitud del cuarto punto, en grados. */
const Y_FINAL = 4;
/** Primer punto ya redondeado, en enteros: (123, 200). */
const X_REDONDEADO = 123;
/** Latitud del primer punto ya redondeado, en enteros. */
const Y_REDONDEADA = 200;
/** Oeste del segundo cuadrado, en grados: su centro cae en el centro de la caja redondeado a centésimas. */
const OESTE_DEL_SEGUNDO = 2.005;
/** Salto en x del tercer punto codificado, en enteros: (350 - 123). */
const SALTO_X = 227;
/** Salto en y del cuarto punto codificado, en enteros: (400 - 200). */
const SALTO_Y = 200;

/** Un cuadrado de lado 1 con su esquina suroeste en (oeste, sur), en el sentido contrario a las agujas del reloj. */
function cuadrado(oeste: number, sur: number): Anillo {
  return [
    [oeste, sur],
    [oeste + 1, sur],
    [oeste + 1, sur + 1],
    [oeste, sur + 1],
  ];
}

/** Un cuadrado de lado 1 como `cuadrado`, pero en el sentido de las agujas del reloj. */
function cuadradoHorario(oeste: number, sur: number): Anillo {
  return [...cuadrado(oeste, sur)].reverse();
}

/** Un polígono de GeoJSON con un solo anillo, tal cual se da. */
function poligonoCon(anillo: number[][]) {
  return { type: 'Polygon', coordinates: [anillo] };
}

test('la unión de dos cuadrados vecinos deja solo su contorno exterior, sin el borde común', () => {
  const contornos = contornoDeLaUnion([cuadrado(0, 0), cuadrado(1, 0)]);
  assert.equal(contornos.length, 1);
  const contorno = contornos[0];
  assert.ok(contorno, 'hay un contorno');
  // Seis vértices: las cuatro esquinas del rectángulo y los dos extremos del borde común, que siguen siendo vértices
  // de las esquinas (no hay ningún punto nuevo en medio del borde).
  assert.deepEqual(
    ordenados(contorno),
    ordenados([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [0, 1],
    ]),
  );
});

/** Los puntos de un anillo en un orden fijo, para compararlos sin depender de por dónde empieza ni hacia dónde gira. */
function ordenados(anillo: Anillo): Anillo {
  return [...anillo].sort(([x1, y1], [x2, y2]) => x1 - x2 || y1 - y2);
}

test('la unión funciona igual con anillos en el sentido de las agujas del reloj', () => {
  const [contorno, ...otros] = contornoDeLaUnion([cuadradoHorario(0, 0), cuadradoHorario(1, 0)]);
  assert.deepEqual(otros, []);
  assert.equal(contorno?.length, VERTICES_DEL_CONTORNO);
});

test('anillos con orientaciones distintas, o que solo se tocan en un vértice, no forman un contorno y se rechazan', () => {
  assert.throws(() => contornoDeLaUnion([cuadrado(0, 0), cuadradoHorario(1, 0)]), GeometriaInvalida);
  assert.throws(() => contornoDeLaUnion([cuadrado(0, 0), cuadrado(1, 1)]), GeometriaInvalida);
});

test('un territorio con hueco conserva el anillo exterior y el interior, sin unirlos', () => {
  const exterior: Anillo = [
    [0, 0],
    [LADO, 0],
    [LADO, LADO],
    [0, LADO],
  ];
  const hueco: Anillo = [
    [1, 1],
    [1, 2],
    [2, 2],
    [2, 1],
  ];
  assert.deepEqual(contornoDeLaUnion([exterior, hueco]), [exterior, hueco]);
});

test('dos territorios sin bordes comunes siguen siendo dos anillos', () => {
  assert.equal(contornoDeLaUnion([cuadrado(0, 0), cuadrado(LEJOS, LEJOS)]).length, 2);
});

test('simplificar quita lo que se aparta menos que la tolerancia y conserva lo demás', () => {
  const casiRecto: Anillo = [
    [0, 0],
    [1, DESVIO_MINIMO],
    [2, 0],
    [2, 1],
    [1, ALTURA_DEL_PICO],
    [0, 1],
  ];
  assert.deepEqual(simplificar(casiRecto, TOLERANCIA), [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, ALTURA_DEL_PICO],
    [0, 1],
  ]);
});

test('simplificar con tolerancia cero, negativa o mayor que el anillo entero deja el anillo como está', () => {
  const anillo: Anillo = [
    [0, 0],
    [1, DESVIO_MINIMO],
    [2, 0],
    [2, 1],
    [1, ALTURA_DEL_PICO],
    [0, 1],
  ];
  for (const tolerancia of [0, -1, TOLERANCIA_ENORME]) {
    assert.deepEqual(simplificar(anillo, tolerancia), anillo, `tolerancia ${tolerancia}`);
  }
});

test('la codificación son diferencias con el punto anterior, sin los puntos que el redondeo repite', () => {
  const anillo: Anillo = [
    [X_INICIAL, Y_INICIAL],
    [X_INICIAL + REDONDEO, Y_INICIAL + REDONDEO],
    [X_FINAL, 2],
    [X_FINAL, Y_FINAL],
  ];
  // Con 100 enteros por grado: el primer punto es (round(123,4), round(200,1)) = (123, 200). El segundo se redondea al
  // mismo punto y se quita. El tercero (350, 200) es (+227, 0) respecto al primero y el cuarto (350, 400) es (0, +200).
  assert.deepEqual(codificar(anillo, ENTEROS_POR_GRADO), [X_REDONDEADO, Y_REDONDEADA, SALTO_X, 0, 0, SALTO_Y]);
  assert.equal(
    codificar(
      [
        [0, 0],
        [DESVIO_MINIMO, 0],
        [0, DESVIO_MINIMO],
      ],
      ENTEROS_POR_GRADO,
    ),
    null,
    'un anillo que el redondeo deja sin superficie',
  );
});

test('los anillos de un GeoJSON pierden su último punto, que repite el primero', () => {
  const poligono = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  };
  assert.deepEqual(anillosDeGeometria(poligono), [
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ]);
  const multiple = { type: 'MultiPolygon', coordinates: [poligono.coordinates, poligono.coordinates] };
  assert.equal(anillosDeGeometria(multiple).length, 2);
});

test('lo que no es un polígono de GeoJSON se rechaza', () => {
  assert.throws(() => anillosDeGeometria({ type: 'LineString', coordinates: [] }), GeometriaInvalida);
  assert.throws(() => anillosDeGeometria(null), GeometriaInvalida);
});

test('un anillo con menos de cuatro posiciones, sin cerrar o fuera de rango se rechaza', () => {
  const corto = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const abierto = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const fueraDeRango = [
    [0, 0],
    [LONGITUD_FUERA_DE_RANGO, 0],
    [1, 1],
    [0, 0],
  ];
  for (const anillo of [corto, abierto, fueraDeRango]) {
    assert.throws(() => anillosDeGeometria(poligonoCon(anillo)), GeometriaInvalida, JSON.stringify(anillo));
  }
});

test('el centro de la caja de unos anillos, en centésimas de grado', () => {
  assert.deepEqual(centroDeLaCaja([cuadrado(0, 0), cuadrado(OESTE_DEL_SEGUNDO, LADO)]), [ALTURA_DEL_PICO, 2]);
});
