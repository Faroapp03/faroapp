// Casos de cifras/escala del origen, sin repetir la validación del lector admitido.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { direccionDeLaBandera } from '../../web/scripts/datos-globales/banderas.js';
import {
  CAPITULOS,
  INDICADORES,
  numeroDelCapitulo,
  variantesDelTitular,
} from '../../web/scripts/datos-globales/capitulos.js';
import {
  distanciaEscrita,
  porcentajeEscrito,
  redondear,
  vecesEscritas,
} from '../../web/scripts/datos-globales/cifras.js';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';

const DATOS = leerDatosGlobales(
  JSON.parse(readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8')),
);

test('la mitad decimal se redondea lejos del cero, sin romper cifra y porcentaje', () => {
  for (const { valor, resultado } of [
    { valor: 19.95, resultado: 20 },
    { valor: 32.25, resultado: 32.3 },
    { valor: 0.05, resultado: 0.1 },
    { valor: -0.05, resultado: -0.1 },
  ]) {
    assert.equal(redondear(valor), resultado);
  }
  const porcentajes = { conMitad: 19.95, sinDecimales: 24.04 };
  assert.equal(porcentajeEscrito(porcentajes.conMitad), '20,0\u00a0%');
  assert.equal(porcentajeEscrito(porcentajes.sinDecimales, 0), '24\u00a0%');
});

test('diferencias decimales, signo tipográfico y cociente sin referencia positiva', () => {
  for (const { a, b, resultado } of [
    { a: 24.04, b: 19.95, resultado: '4,1' },
    { a: 16.2, b: 15.8, resultado: '0,4' },
    { a: 20, b: 21.2, resultado: '−1,2' },
    { a: 20, b: 20.04, resultado: '0,0' },
  ]) {
    assert.equal(distanciaEscrita(a, b), resultado);
  }
  const diferencia = { mayor: 49, menor: 42.9 };
  assert.equal(distanciaEscrita(diferencia.mayor, diferencia.menor), '6,1');
  assert.equal(distanciaEscrita(diferencia.menor, diferencia.mayor), '−6,1');
  for (const { a, b, escrito } of [
    { a: 44.2, b: 8, escrito: '×5,5' },
    { a: 24.04, b: 10.7, escrito: '×2,2' },
  ]) {
    assert.equal(vecesEscritas(a, b), escrito);
  }
  assert.equal(vecesEscritas(1, 0), null);
});

test('capítulos mantienen el orden; un id ajeno no inventa número', () => {
  assert.deepEqual(CAPITULOS.map(numeroDelCapitulo), ['01', '02', '03', '04', '05', '06', '07', '08']);
  assert.throws(() => numeroDelCapitulo('metodo'), RangeError, 'Método no es un capítulo');
  assert.throws(() => numeroDelCapitulo('ue'), RangeError);
  const idsPublicados = new Set(DATOS.indicadores.map(({ id }) => id));
  assert.deepEqual(
    Object.values(INDICADORES).filter((id) => !idsPublicados.has(id)),
    [],
  );
});

test('un primer puesto exige un punto de ventaja: la formación de Cataluña (16,2) no supera a España (15,8) por un punto', () => {
  assert.equal(variantesDelTitular(DATOS).formacion, 'cifra');
  assert.equal(variantesDelTitular(DATOS).empresas, 'cuarto-doble', 'más del doble desde 2023, sin contar 2021');
  const FORMACION_MUY_BAJA = 5;
  const conVentaja = {
    ...DATOS,
    territorios: DATOS.territorios.map((territorio) =>
      territorio.codigo === 'ES51'
        ? territorio
        : {
            ...territorio,
            valores: territorio.valores.map((valor) =>
              valor.indicador === INDICADORES.formacion ? { ...valor, valor: FORMACION_MUY_BAJA } : valor,
            ),
          },
    ),
  };
  assert.equal(variantesDelTitular(conVentaja).formacion, 'primera');
  const FORMACION_QUE_SUPERA = 30;
  const cambiados = {
    ...DATOS,
    territorios: DATOS.territorios.map((territorio) =>
      territorio.codigo !== 'ESP'
        ? territorio
        : {
            ...territorio,
            valores: territorio.valores.map((valor) =>
              valor.indicador === INDICADORES.formacion ? { ...valor, valor: FORMACION_QUE_SUPERA } : valor,
            ),
          },
    ),
  };
  assert.equal(variantesDelTitular(cambiados).formacion, 'cifra');
});

test('banderas propias tienen prioridad; el juego exige opt-in y no inventa códigos', () => {
  assert.equal(direccionDeLaBandera('ESP'), 'imagenes/identidad/bandera-espana.svg');
  assert.equal(direccionDeLaBandera('AUT'), null);
  assert.equal(direccionDeLaBandera('AUT', { delJuego: true }), 'imagenes/banderas/aut.svg');
  assert.equal(direccionDeLaBandera('ESP', { delJuego: true }), 'imagenes/identidad/bandera-espana.svg');
  assert.equal(direccionDeLaBandera(null, { delJuego: true }), null);
  assert.equal(direccionDeLaBandera('../ESP', { delJuego: true }), null);
});
