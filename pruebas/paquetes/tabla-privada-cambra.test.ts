// La igualdad de la parte pública de la Cambra encuentra la tabla privada donde vive: datos/cambra.json en una
// instalación autorizada y, en el ciclo de actualización, que ya no la tiene en datos/, su conjunto validado. Sin tabla
// en ningún sitio falla con el motivo, en vez de omitirse. Instalaciones sintéticas: ninguna cifra es del estudio.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { compararConLaTablaCompleta, rutaDeLaTablaPrivada } from './tabla-privada-cambra.ts';

const COPIA = 'datos/cambra.json';
const VALIDADO = 'var/actualizacion/validados/cambra/cambra.json';

/** Los cortes entre los cinco niveles de la escala sintética, de menor a mayor. */
const CORTES = Object.values({ del1al2: 0.2, del2al3: 0.3, del3al4: 0.4, del4al5: 0.5 });
const COMPLETA = {
  fuente: 'Sintética',
  escala: { cortes: CORTES, nota: 'Solo en la tabla' },
  ocupados_cno3: { 998: 10, 999: 20 },
  ocupaciones_cno3: { 998: { nivel: 2, puntuacion: 0.25 }, 999: { nivel: 4, puntuacion: 0.45 } },
  genero: {
    mujeres_exposicion_media_o_alta: 0.6,
    hombres_exposicion_media_o_alta: 0.4,
    pagina_impresa: 7,
    pagina_pdf: 9,
  },
};
const PUBLICA = {
  fuente: COMPLETA.fuente,
  escala: { cortes: COMPLETA.escala.cortes },
  ocupaciones_cno3: { 998: { nivel: 2 }, 999: { nivel: 4 } },
  genero: { mujeres_exposicion_media_o_alta: 0.6, hombres_exposicion_media_o_alta: 0.4, pagina_impresa: 7 },
};
const TABLA = JSON.stringify(COMPLETA);

/** Una instalación con el manifiesto que fija la tabla, la parte pública y la tabla en los sitios indicados. */
function instalacion(t: { after: (fn: () => void) => void }, tablas: Record<string, string>, publica = PUBLICA) {
  const raiz = mkdtempSync(join(tmpdir(), 'tabla-privada-cambra-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
  const escribir = (ruta: string, contenido: string) => {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
    writeFileSync(join(raiz, ruta), contenido);
  };
  escribir(
    'datos/manifiesto.json',
    JSON.stringify({
      'exposicion-cambra.json': { origenes: { [VALIDADO]: huella(TABLA) }, sha256: huella(JSON.stringify(publica)) },
    }),
  );
  escribir('datos/exposicion-cambra.json', JSON.stringify(publica));
  for (const [ruta, contenido] of Object.entries(tablas)) {
    escribir(ruta, contenido);
  }
  return raiz;
}

test('en el ciclo, con la tabla solo en su conjunto validado, la igualdad corre y pasa', (t) => {
  const raiz = instalacion(t, { [VALIDADO]: TABLA });
  assert.equal(rutaDeLaTablaPrivada(raiz), join(raiz, VALIDADO));
  assert.equal(compararConLaTablaCompleta(raiz), 2);
});

test('en una instalación autorizada, con la tabla en datos/, sigue igual', (t) => {
  const raiz = instalacion(t, { [COPIA]: TABLA });
  assert.equal(rutaDeLaTablaPrivada(raiz), join(raiz, COPIA));
  assert.equal(compararConLaTablaCompleta(raiz), 2);
});

test('sin la tabla en ningún sitio, falla diciendo dónde se busca y cómo obtenerla', (t) => {
  const raiz = instalacion(t, {});
  assert.throws(
    () => compararConLaTablaCompleta(raiz),
    (error: Error) => {
      assert.match(error.message, /^La igualdad de la parte pública de la Cambra necesita la tabla completa\. Falta /);
      assert.ok(error.message.includes(COPIA), error.message);
      assert.ok(error.message.includes(VALIDADO), error.message);
      assert.ok(error.message.includes('tabla_privada recuperar'), error.message);
      return true;
    },
  );
});

test('una tabla con otra huella no vale, esté donde esté, y el fallo no muestra su contenido', (t) => {
  const distinta = `${TABLA} `;
  for (const ruta of [COPIA, VALIDADO]) {
    const raiz = instalacion(t, { [ruta]: distinta });
    assert.throws(
      () => rutaDeLaTablaPrivada(raiz),
      (error: Error) => {
        assert.ok(error.message.includes(`${ruta} no es la tabla que fija datos/manifiesto.json`), error.message);
        assert.ok(!error.message.includes('Sintética'), error.message);
        return true;
      },
    );
  }
});

test('la igualdad detecta una parte pública que no da lo mismo que la tabla', (t) => {
  const raiz = instalacion(
    t,
    { [VALIDADO]: TABLA },
    { ...PUBLICA, ocupaciones_cno3: { 998: { nivel: 2 }, 999: { nivel: 3 } } },
  );
  assert.throws(() => compararConLaTablaCompleta(raiz), assert.AssertionError);
});
