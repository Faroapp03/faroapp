import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formaComun, fraseSinGenero, palabrasDe } from '../src/busqueda/palabras.ts';
import {
  type ConsultaParaPuntuar,
  type OcupacionParaPuntuar,
  PUNTOS_FRASE_EXACTA,
  puntuarFormas,
} from '../src/busqueda/puntuacion.ts';

const NOMBRE_EXACTO = 100;
const EXACTO_Y_DESCRIPCION = 110;
const EXACTO_Y_MEDIA_DESCRIPCION = 105;
const CONTIENE_Y_EXPLICA_MEDIO = 60;
const PALABRAS_CUBIERTAS_Y_EXPLICADAS = 70;
const PALABRAS_CON_MEDIA_COBERTURA = 35;
const PREFIJO_CONTENIDO = 30;
const PREFIJO_SIN_CONTENCION = 26.25;
const PREFIJO_CONTENIDO_Y_DESCRIPCION = 40;
const CONTIENE_Y_EXPLICA_UN_CUARTO = 50;
const PESO_MAQUINARIA = 3;
const PESO_NOMBRE = 4;

function consulta(texto: string, nombres = new Set<string>()): ConsultaParaPuntuar {
  const palabras = [...new Set(palabrasDe(texto).map(formaComun))];
  return { palabras, frase: fraseSinGenero(texto), peso: () => 1, pesoTotal: palabras.length, nombres };
}

function ocupacion(titulos: string[], descripcion: string[] = []): OcupacionParaPuntuar {
  const nombres = titulos.map((titulo) => palabrasDe(titulo).map(formaComun));
  return {
    nombres,
    frases: titulos.map(fraseSinGenero),
    descripcion: [...new Set(descripcion)].sort(),
    pesoNombres: nombres.map((nombre) => nombre.length),
  };
}

test('nombre exacto vale cien y la descripción puede llegar a ciento diez', () => {
  assert.equal(PUNTOS_FRASE_EXACTA, NOMBRE_EXACTO);
  const forma = consulta('analista financiera');
  assert.equal(puntuarFormas(ocupacion(['analista financiero']), [forma]), NOMBRE_EXACTO);
  assert.equal(puntuarFormas(ocupacion(['analista financiero'], forma.palabras), [forma]), EXACTO_Y_DESCRIPCION);
  assert.equal(puntuarFormas(ocupacion(['analista financiero'], ['analist']), [forma]), EXACTO_Y_MEDIA_DESCRIPCION);
});

test('pesa cobertura y explicación antes de añadir la descripción', () => {
  assert.equal(puntuarFormas(ocupacion(['operador de maquinaria']), [consulta('operador')]), CONTIENE_Y_EXPLICA_MEDIO);
  assert.equal(
    puntuarFormas(ocupacion(['operador de maquinaria']), [consulta('operador maquinaria')]),
    PALABRAS_CUBIERTAS_Y_EXPLICADAS,
  );
  assert.equal(puntuarFormas(ocupacion(['operador']), [consulta('operador maquinaria')]), PALABRAS_CON_MEDIA_COBERTURA);
});

test('la contención vigente es de subcadena y el prefijo conserva medio respaldo en ambos sentidos', () => {
  assert.equal(puntuarFormas(ocupacion(['limpiador']), [consulta('limpio')]), PREFIJO_CONTENIDO);
  assert.equal(puntuarFormas(ocupacion(['limpio']), [consulta('limpiador')]), PREFIJO_SIN_CONTENCION);
});

test('la descripción solo suma con un nombre que encaja y exige palabras exactas', () => {
  const forma = consulta('limpio');
  assert.equal(puntuarFormas(ocupacion(['limpiador'], ['limpiador']), [forma]), PREFIJO_CONTENIDO);
  assert.equal(puntuarFormas(ocupacion(['limpiador'], ['limpi']), [forma]), PREFIJO_CONTENIDO_Y_DESCRIPCION);
  assert.equal(puntuarFormas(ocupacion(['cocinero'], ['limpi']), [forma]), 0);
});

test('toma el mejor nombre y la mejor forma sin sumarlos y admite colecciones vacías', () => {
  const empleo = ocupacion(['operador de maquinaria', 'analista financiero', '']);
  assert.equal(puntuarFormas(empleo, [consulta('operador'), consulta('analista financiera')]), NOMBRE_EXACTO);
  assert.equal(puntuarFormas(empleo, []), 0);
  assert.equal(puntuarFormas(ocupacion([]), [consulta('operador')]), 0);
  assert.equal(puntuarFormas(ocupacion(['']), [consulta('operador')]), 0);
});

test('los nombres probables restringen el respaldo de prefijos sin cambiar derivaciones', () => {
  assert.equal(puntuarFormas(ocupacion(['marinero']), [consulta('mari')]), PREFIJO_CONTENIDO);
  assert.equal(puntuarFormas(ocupacion(['marinero']), [consulta('mari', new Set(['mari']))]), 0);
  assert.equal(puntuarFormas(ocupacion(['limpiador']), [consulta('limpio', new Set(['limpi']))]), PREFIJO_CONTENIDO);
});

test('los pesos de rareza se conservan y no muta la consulta ni la ocupación', () => {
  const empleo = ocupacion(['operador de maquinaria']);
  const forma = consulta('operador');
  forma.peso = (palabra) => (palabra === 'maquinari' ? PESO_MAQUINARIA : 1);
  const ponderado = { ...empleo, pesoNombres: [PESO_NOMBRE] };
  const antes = JSON.stringify([ponderado, { ...forma, nombres: [...forma.nombres] }]);
  assert.equal(puntuarFormas(ponderado, [forma]), CONTIENE_Y_EXPLICA_UN_CUARTO);
  assert.equal(JSON.stringify([ponderado, { ...forma, nombres: [...forma.nombres] }]), antes);
});
