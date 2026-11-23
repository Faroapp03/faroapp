// Vectores sintéticos autosuficientes: cuantización, redondeos Float32, búsqueda, errores y ciclo del base64.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cargarIndice,
  cuantizar,
  masParecidas,
  normalizarVector,
  similitudCon,
  sinTextoEnBase64,
  soltarTextoEnBase64,
  type VectoresGuardados,
  vectorDe,
} from '../../src/comun/vectores.ts';

/** Catetos e hipotenusa para comprobar la dirección del triángulo 3-4-5. */
const CATETO_A = 3;
const CATETO_B = 4;
const HIPOTENUSA = 5;
/** Extremos del formato int8 y bytes interiores para comprobar ambos signos. */
const MAXIMO_INT8 = 127;
const MAGNITUD_MINIMO_INT8 = 128;
const BYTE_INTERIOR_POSITIVO = 57;
const MAGNITUD_BYTE_INTERIOR_NEGATIVO = 63;
/** Escalas no exactas en binario para que los dos redondeos Float32 sean relevantes. */
const ESCALA_PEQUENA = 0.00317;
const MAGNITUD_ESCALA_NEGATIVA = 0.0193;
/** Vectores de prueba de pequeña magnitud y consulta inclinada entre dos ejes. */
const COMPONENTE_PEQUENA = 0.1;
const INCLINACION_CONSULTA = 0.8;
/** Una dimensión no entera para comprobar el error de carga. */
const DIMENSION_FRACCIONARIA = 0.5;
/** Componentes cuyos cuadrados son subnormales positivos y pierden precisión relativa. */
const COMPONENTE_SUBNORMAL_A = 2e-162;
const COMPONENTE_SUBNORMAL_B = -1e-162;
/** Tolerancia de norma para la conversión final a Float32. */
const ERROR_FLOAT32 = 1e-6;

/** Tolerancia para la dirección y norma tras cuantización int8. */
const ERROR_DE_CUANTIZAR = 0.01;
/** Dimensiones que exceden el límite de argumentos de Math.max del entorno soportado. */
const MUCHAS_DIMENSIONES = 200_000;
/** Bytes para recorrer más de un trozo de codificación base64. */
const BYTES_EN_VARIOS_TROZOS = 70_001;

/** Construye el formato guardado a partir de vectores sintéticos densos. */
function guardados(vectores: Record<string, number[]>): VectoresGuardados {
  const valores = Object.values(vectores);
  const primero = valores[0];
  assert.ok(primero);
  const { escalas, bytes } = cuantizar(valores);
  return {
    modelo: 'prueba',
    dimensiones: primero.length,
    ids: Object.keys(vectores),
    escalas,
    datos: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  };
}

/** Comprueba aproximaciones geométricas; los cotejos de redondeos usan igualdad exacta. */
function cerca(valor: number, esperado: number): void {
  assert.ok(Math.abs(valor - esperado) <= ERROR_DE_CUANTIZAR, `${valor} frente a ${esperado}`);
}

/** Descompresión independiente en dos pasos, usando la asignación Float32 para cada redondeo. */
function descomprimido(almacenado: VectoresGuardados): Float32Array {
  const binario = Buffer.from(almacenado.datos, 'base64');
  const bytes = new Int8Array(binario.buffer, binario.byteOffset, binario.byteLength);
  const resultado = new Float32Array(bytes.length);
  for (const [posicion, escala] of almacenado.escalas.entries()) {
    let cuadrados = 0;
    for (let j = 0; j < almacenado.dimensiones; j++) {
      const offset = posicion * almacenado.dimensiones + j;
      const byte = bytes[offset];
      assert.notEqual(byte, undefined);
      const valor = (byte as number) * escala;
      resultado[offset] = valor;
      cuadrados += valor * valor;
    }
    const longitud = Math.sqrt(cuadrados) || 1;
    for (let j = 0; j < almacenado.dimensiones; j++) {
      const offset = posicion * almacenado.dimensiones + j;
      // offset está dentro del resultado, que tiene tantos bytes como todas las componentes.
      resultado[offset] = (resultado[offset] as number) / longitud;
    }
  }
  return resultado;
}

test('cuantizar conserva dirección, norma aproximada y signo con vectores sintéticos', () => {
  const almacenado = guardados({
    recto: [CATETO_A, CATETO_B, 0, 0],
    torcido: [-1, 2, -2, CATETO_B],
    pequeno: [COMPONENTE_PEQUENA, COMPONENTE_PEQUENA, COMPONENTE_PEQUENA, COMPONENTE_PEQUENA],
  });
  const indice = cargarIndice(almacenado);
  for (const [posicion, id] of indice.ids.entries()) {
    const vector = vectorDe(indice, id);
    assert.ok(vector);
    cerca(Math.hypot(...vector), 1);
    cerca(similitudCon(indice, posicion, vector), 1);
  }
  const recto = vectorDe(indice, 'recto');
  assert.ok(recto);
  cerca(recto[0] as number, CATETO_A / HIPOTENUSA);
  cerca(recto[1] as number, CATETO_B / HIPOTENUSA);
  assert.equal(vectorDe(indice, 'no-existe'), null);
});

test('cuantizar escribe bytes y escalas exactos para ejes, signo y cero', () => {
  const { bytes, escalas } = cuantizar([
    [1, 0],
    [-1, 0],
    [0, 0],
    [0, -0],
  ]);
  assert.deepEqual([...bytes], [MAXIMO_INT8, 0, -MAXIMO_INT8, 0, 0, 0, 0, 0]);
  assert.deepEqual(escalas, [1 / MAXIMO_INT8, 1 / MAXIMO_INT8, 1 / MAXIMO_INT8, 1 / MAXIMO_INT8]);
});

test('el índice reproduce los dos redondeos Float32 de una descompresión completa', () => {
  const almacenado: VectoresGuardados = {
    modelo: 'sintetico',
    dimensiones: CATETO_B,
    ids: ['a', 'b', 'c'],
    escalas: [ESCALA_PEQUENA, -MAGNITUD_ESCALA_NEGATIVA, 0],
    datos: Buffer.from(
      new Int8Array([
        MAXIMO_INT8,
        -MAGNITUD_MINIMO_INT8,
        1,
        -CATETO_A,
        BYTE_INTERIOR_POSITIVO,
        -MAGNITUD_BYTE_INTERIOR_NEGATIVO,
        0,
        CATETO_B,
        0,
        0,
        0,
        0,
      ]),
    ).toString('base64'),
  };
  const indice = cargarIndice(almacenado);
  const referencia = descomprimido(almacenado);
  const consultas = [normalizarVector([CATETO_A, -CATETO_B, COMPONENTE_PEQUENA, 2]), normalizarVector([-1, 0, 0, 0])];
  for (const [posicion, id] of indice.ids.entries()) {
    const vector = vectorDe(indice, id);
    assert.ok(vector);
    const esperado = referencia.subarray(posicion * indice.dimensiones, (posicion + 1) * indice.dimensiones);
    assert.deepEqual(
      Buffer.from(vector.buffer),
      Buffer.from(esperado.buffer, esperado.byteOffset, esperado.byteLength),
    );
    for (const consulta of consultas) {
      let similitud = 0;
      for (const [j, valor] of esperado.entries()) {
        similitud += valor * (consulta[j] as number);
      }
      assert.equal(similitudCon(indice, posicion, consulta), similitud);
    }
  }
});

test('la similitud cuenta la primera dimensión y conserva cero y negativos', () => {
  const indice = cargarIndice(
    guardados({ positivo: [1, 0, 0], negativo: [-1, 0, 0], ortogonal: [0, 2, 0], nulo: [0, 0, 0] }),
  );
  const consulta = normalizarVector([HIPOTENUSA, 0, 0]);
  assert.deepEqual(
    indice.ids.map((_id, posicion) => similitudCon(indice, posicion, consulta)),
    [1, -1, 0, 0],
  );
  assert.deepEqual(
    masParecidas(indice, consulta, indice.ids.length).map(({ id }) => id),
    ['positivo', 'nulo', 'ortogonal', 'negativo'],
  );
});

test('las más parecidas conservan orden descendente, descarte, límite y desempate UTF-16', () => {
  const indice = cargarIndice(
    guardados({ ancho: [1, 0, 0], alto: [0, 2, 0], fondo: [0, 0, CATETO_A], diagonal: [1, 1, 0] }),
  );
  const consulta = normalizarVector([1, INCLINACION_CONSULTA, 0]);
  assert.deepEqual(
    masParecidas(indice, consulta, indice.ids.length).map(({ id }) => id),
    ['diagonal', 'ancho', 'alto', 'fondo'],
  );
  assert.deepEqual(
    masParecidas(indice, consulta, 2, (id) => id === 'diagonal').map(({ id }) => id),
    ['ancho', 'alto'],
  );
  assert.deepEqual(masParecidas(indice, consulta, 0), []);
  assert.deepEqual(
    masParecidas(indice, consulta, indice.ids.length, () => true),
    [],
  );
  const empatados = cargarIndice(guardados({ ñ: [0, 1], a: [0, 1], Z: [0, 1] }));
  assert.deepEqual(
    masParecidas(empatados, normalizarVector([0, 1]), empatados.ids.length).map(({ id }) => id),
    ['Z', 'a', 'ñ'],
  );
});

test('normalizar copia sin mutar y conserva el vector nulo y los ceros con signo', () => {
  const original = [CATETO_A, CATETO_B, -0];
  const normalizado = normalizarVector(original);
  assert.deepEqual([...normalizado], [Math.fround(CATETO_A / HIPOTENUSA), Math.fround(CATETO_B / HIPOTENUSA), -0]);
  assert.deepEqual(original, [CATETO_A, CATETO_B, -0]);
  assert.deepEqual([...normalizarVector([0, 0, 0])], [0, 0, 0]);
  assert.deepEqual([...normalizarVector([])], []);
});

test('los errores de cuantización y consulta dicen las dimensiones que no cuadran', () => {
  assert.throws(() => cuantizar([]), /No hay vectores que cuantizar/);
  assert.throws(
    () =>
      cuantizar([
        [1, 0],
        [1, 0, 0],
      ]),
    /El vector 1 tiene 3 dimensiones y el primero 2/,
  );
  assert.throws(() => cuantizar([[1, 0], [1]]), /El vector 1 tiene 1 dimensiones y el primero 2/);
  const indice = cargarIndice(guardados({ eje: [1, 0, 0] }));
  assert.throws(() => masParecidas(indice, normalizarVector([1, 0]), 1), /2 dimensiones y el índice 3/);
});

test('cargar rechaza base64 y tamaños incoherentes con el modelo como contexto', () => {
  const base = guardados({ eje: [1, 0] });
  for (const dimensiones of [0, -1, DIMENSION_FRACCIONARIA, NaN, Infinity]) {
    assert.throws(
      () => cargarIndice({ ...base, dimensiones }),
      /Vectores de prueba: .* no es un número de dimensiones/,
    );
  }
  assert.throws(() => cargarIndice({ ...base, escalas: [] }), /0 escalas para 1 identificadores/);
  assert.throws(() => cargarIndice({ ...base, datos: 'AA==' }), /1 bytes para 1 × 2/);
  assert.throws(() => cargarIndice({ ...base, datos: '¿no?' }), /Vectores de prueba: los datos no son base64/);
});

test('la caché comparte por identidad y una carga fallida puede corregirse antes de cachear', () => {
  const base = guardados({ eje: [1, 0] });
  const indice = cargarIndice(base);
  assert.equal(cargarIndice(base), indice);
  assert.notEqual(cargarIndice({ ...base }), indice);
  const invalido = { ...base, datos: '¿no?' };
  assert.throws(() => cargarIndice(invalido), /no son base64/);
  invalido.datos = base.datos;
  assert.deepEqual(cargarIndice(invalido).componentes, indice.componentes);
  const vector = vectorDe(indice, 'eje');
  assert.ok(vector);
  vector.fill(0);
  const copiaNueva = vectorDe(indice, 'eje');
  assert.ok(copiaNueva);
  assert.deepEqual([...copiaNueva], [1, 0]);
});

test('un índice vacío es coherente y un identificador repetido conserva su primera posición', () => {
  const vacio = cargarIndice({ modelo: 'vacio', dimensiones: 1, ids: [], escalas: [], datos: '' });
  assert.deepEqual(masParecidas(vacio, normalizarVector([1]), 1), []);
  assert.equal(vectorDe(vacio, 'ausente'), null);
  const base = guardados({ uno: [1, 0], dos: [-1, 0] });
  const repetido = cargarIndice({ ...base, ids: ['igual', 'igual'] });
  const primero = vectorDe(repetido, 'igual');
  assert.ok(primero);
  assert.deepEqual([...primero], [1, 0]);
});

test('copiar y soltar el base64 conservan bytes, JSON, descriptores y caché sin retener el texto original', () => {
  const base = guardados({ a: [1, -1], b: [0, 0] });
  const indice = cargarIndice(base);
  const json = JSON.stringify(base);
  const compacto = sinTextoEnBase64(base);
  assert.notEqual(compacto, base);
  assert.equal(compacto.ids, base.ids);
  assert.equal(compacto.escalas, base.escalas);
  assert.equal(cargarIndice(compacto), indice);
  assert.equal(JSON.stringify(compacto), json);
  assert.equal(Object.getOwnPropertyDescriptor(base, 'datos')?.get, undefined);
  soltarTextoEnBase64(base);
  soltarTextoEnBase64(base);
  assert.equal(cargarIndice(base), indice);
  assert.equal(JSON.stringify(base), json);
  const descriptor = Object.getOwnPropertyDescriptor(base, 'datos');
  assert.equal(typeof descriptor?.get, 'function');
  assert.equal(descriptor?.enumerable, true);
  assert.equal(descriptor?.configurable, true);
  assert.equal(descriptor?.set, undefined);
});

test('la reconstrucción canónica preserva todos los bytes y atraviesa varios trozos', () => {
  const bytes = new Int8Array(BYTES_EN_VARIOS_TROZOS);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = i;
  }
  const datos = Buffer.from(bytes.buffer).toString('base64');
  const base = { modelo: 'trozos', dimensiones: bytes.length, ids: ['uno'], escalas: [1], datos: ` ${datos}\n` };
  const compactos = sinTextoEnBase64(base);
  assert.equal(compactos.datos, datos);
  assert.deepEqual(Buffer.from(compactos.datos, 'base64'), Buffer.from(bytes.buffer));
  assert.equal(base.datos, ` ${datos}\n`);
});

test('cuantizar un vector grande evita el límite de argumentos sin cambiar sus operaciones', () => {
  const { escalas, bytes } = cuantizar([Array<number>(MUCHAS_DIMENSIONES).fill(1)]);
  const longitud = Math.sqrt(MUCHAS_DIMENSIONES);
  assert.deepEqual(escalas, [1 / longitud / MAXIMO_INT8]);
  assert.equal(bytes.length, MUCHAS_DIMENSIONES);
  assert.ok(bytes.every((valor) => valor === MAXIMO_INT8));
});

test('los extremos finitos se normalizan sin perder dirección ni ceros con signo y se cuantizan con escala positiva', () => {
  const casos = [
    [
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [1, 1],
    ],
    [
      [Number.MIN_VALUE, 0],
      [1, 0],
    ],
    [
      [COMPONENTE_SUBNORMAL_A, COMPONENTE_SUBNORMAL_B],
      [2, -1],
    ],
    [
      [Number.MAX_VALUE, -0],
      [1, -0],
    ],
    [
      [Number.MIN_VALUE, -0],
      [1, -0],
    ],
  ] as const;
  for (const [vector, referencia] of casos) {
    const normalizado = normalizarVector(vector);
    assert.deepEqual(normalizado, normalizarVector(referencia));
    assert.ok(Math.abs(Math.hypot(...normalizado) - 1) < ERROR_FLOAT32);
    const cuantizado = cuantizar([vector]);
    assert.deepEqual(cuantizado, cuantizar([referencia]));
    const escala = cuantizado.escalas[0];
    assert.ok(escala !== undefined && escala > 0);
    const indice = cargarIndice({
      modelo: 'extremos',
      dimensiones: vector.length,
      ids: ['uno'],
      escalas: cuantizado.escalas,
      datos: Buffer.from(cuantizado.bytes).toString('base64'),
    });
    const descomprimido = vectorDe(indice, 'uno');
    assert.ok(descomprimido);
    assert.ok(Math.abs(Math.hypot(...descomprimido) - 1) < ERROR_FLOAT32);
  }
});
