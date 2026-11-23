// El permiso del ODEE y la Cambra cubre mostrar el nivel de exposición agregado, no repartir su tabla. Guardia: lo
// que se empaqueta y se publica de la Cambra es solo su parte pública, con un contrato cerrado. Igualdad: para todas
// las ocupaciones, el informe da con ella lo mismo que con la tabla completa, si la instalación la tiene.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { esObjeto } from '../../src/comun/json.ts';
import { exposicionDelGrupo } from '../../src/dominio/informe-breve-contexto.ts';
import type { DatosCambra } from '../../src/dominio/tipos-paquete.ts';
import {
  ARCHIVO_DE_CADA_PARTE,
  ARCHIVOS_DEL_PRIMER_ANALISIS,
  MANIFIESTO,
} from '../../src/plataforma/archivos-del-paquete.ts';
import { ARCHIVOS_DEL_PRIMER_ANALISIS as DEL_SERVICE_WORKER } from '../../src/service-worker/primer-analisis.js';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

const CARPETA = new URL('../../datos/', import.meta.url);
const PUBLICA = 'exposicion-cambra.json';
const TABLA_PRIVADA = 'cambra.json';

/** La lista cerrada de la parte pública, campo a campo (plataforma_datos/ia_y_trabajo/fuentes/cambra/exportacion.py). */
const CONTRATO = {
  fuente: null,
  escala: ['cortes'],
  ocupaciones_cno3: ['nivel'],
  genero: ['mujeres_exposicion_media_o_alta', 'hombres_exposicion_media_o_alta', 'pagina_impresa'],
} as const satisfies Record<string, readonly string[] | null>;

function leer(archivo: string): unknown {
  return JSON.parse(readFileSync(new URL(archivo, CARPETA), 'utf8'));
}

/** Las claves de `objeto` que no están en `admitidos`, precedidas de su ruta. */
function sobrantesDe(objeto: unknown, admitidos: readonly string[], prefijo: string): string[] {
  const claves = esObjeto(objeto) ? Object.keys(objeto) : [];
  return claves.filter((clave) => !admitidos.includes(clave)).map((clave) => `${prefijo}${clave}`);
}

/** Los campos de `publica` que el contrato no admite, con su ruta («genero.pagina_pdf»). */
function camposFueraDelContrato(publica: Record<string, unknown>): string[] {
  const sobrantes = Object.keys(publica).filter((campo) => !Object.hasOwn(CONTRATO, campo));
  for (const [campo, admitidos] of Object.entries(CONTRATO)) {
    const valor = publica[campo];
    if (admitidos === null || !esObjeto(valor)) {
      continue;
    }
    // Las ocupaciones son un objeto por código; la escala y el reparto por sexo, un objeto cada uno.
    const objetos = campo === 'ocupaciones_cno3' ? Object.entries(valor) : [['', valor] as const];
    for (const [codigo, objeto] of objetos) {
      sobrantes.push(...sobrantesDe(objeto, admitidos, codigo ? `${campo}.${codigo}.` : `${campo}.`));
    }
  }
  return sobrantes;
}

test('la parte de la Cambra que se empaqueta y se guarda en el dispositivo es la pública, no la tabla', () => {
  assert.equal(ARCHIVO_DE_CADA_PARTE.cambra, PUBLICA);
  for (const lista of [ARCHIVOS_DEL_PRIMER_ANALISIS, DEL_SERVICE_WORKER]) {
    assert.ok(lista.includes(PUBLICA));
    assert.ok(!lista.includes(TABLA_PRIVADA));
  }
  const delWorker = readFileSync(new URL('../../src/plataforma/cloudflare/paquete.ts', import.meta.url), 'utf8');
  assert.ok(!delWorker.includes(`datos/${TABLA_PRIVADA}`));
  // Se publica y se descarga lo que nombra el manifiesto (src/plataforma/node/paquete-publicado.ts).
  const manifiesto = leer(MANIFIESTO);
  assert.ok(esObjeto(manifiesto));
  assert.ok(Object.hasOwn(manifiesto, PUBLICA));
  assert.ok(!Object.hasOwn(manifiesto, TABLA_PRIVADA));
});

test('la parte pública solo lleva campos de su lista cerrada', () => {
  const publica = leer(PUBLICA);
  assert.ok(esObjeto(publica));
  assert.deepEqual(camposFueraDelContrato(publica), []);
  // La guardia reconoce cada campo de la tabla que no es público, en cualquier nivel.
  assert.deepEqual(
    camposFueraDelContrato({
      fuente: 'Sintética',
      ocupados_cno3: {},
      escala: { cortes: [], nota: '' },
      ocupaciones_cno3: { 999: { nivel: 1, puntuacion: 0, mujeres: 0 } },
      genero: { pagina_impresa: 1, pagina_pdf: 1 },
    }),
    [
      'ocupados_cno3',
      'escala.nota',
      'ocupaciones_cno3.999.puntuacion',
      'ocupaciones_cno3.999.mujeres',
      'genero.pagina_pdf',
    ],
  );
});

test('con la parte pública, el informe da lo mismo que con la tabla completa en todas las ocupaciones', (t) => {
  if (!existsSync(new URL(TABLA_PRIVADA, CARPETA))) {
    // En una copia pública no hay tabla con que comparar: la integración continua la recupera y la compara.
    t.skip('no está la tabla privada (datos/README.md, «exposicion-cambra.json»)');
    return;
  }
  const completa = leer(TABLA_PRIVADA) as DatosCambra;
  const publica = leer(PUBLICA) as DatosCambra;
  const codigos = Object.keys(completa.ocupaciones_cno3 ?? {});
  assert.ok(codigos.length > 0);
  assert.deepEqual(Object.keys(publica.ocupaciones_cno3 ?? {}), codigos);
  for (const idioma of ['es', 'ca'] as const) {
    for (const cno of codigos) {
      const conLaTabla = exposicionDelGrupo([`${cno}0`], datosMinimos({ cambra: completa }), idioma);
      const conLaPublica = exposicionDelGrupo([`${cno}0`], datosMinimos({ cambra: publica }), idioma);
      assert.ok(conLaTabla, cno);
      assert.deepEqual(conLaPublica, conLaTabla, cno);
    }
  }
  assert.equal(publica.fuente, completa.fuente);
  assert.deepEqual(publica.genero, {
    mujeres_exposicion_media_o_alta: completa.genero.mujeres_exposicion_media_o_alta,
    hombres_exposicion_media_o_alta: completa.genero.hombres_exposicion_media_o_alta,
    pagina_impresa: completa.genero.pagina_impresa,
  });
});
