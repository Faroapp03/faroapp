import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarTich } from '../../src/dominio/forma-del-dato-tich.ts';
import type { DatosTich } from '../../src/dominio/tipos-contexto.ts';
import { usoDeclaradoDeLaIa } from '../../src/dominio/uso-declarado-de-la-ia.ts';

const MIN_MUESTRA = 30;
const PCT = { grupo: 21.2, motivo: 12.5, inferior: 17.1, superior: 25.3 } as const;
const INTERVALO: [number, number] = [PCT.inferior, PCT.superior];

/** Una TIC-H de 2026 en la que el 52 tiene personas manuales y no manuales: no tiene clase. */
function tich(): DatosTich {
  const cifra = { pct: PCT.grupo, muestra: MIN_MUESTRA, ic95: INTERVALO };
  return {
    fuentes: { tich: 'INE, encuesta TIC-H' },
    anio: '2026',
    anios_medidos: ['2025', '2026'],
    min_muestra: MIN_MUESTRA,
    espana_isco2: { '52': cifra, '24': cifra },
    espana_isco1: {},
    espana_bloques: {},
    bloque_por_isco2: {},
    grandes_grupos_enteros: [],
    motivos_no_uso: {
      fuente: 'Idescat',
      tabla: '3.4.2',
      url: 'https://www.idescat.cat/',
      sha256: '',
      consultado: '2026-10-13',
      anio: '2025',
      base: 'Quienes no usaron la IA',
      no_sabia_como_utilizarlas: { manual: PCT.motivo, no_manual: PCT.motivo },
    },
    clase_por_isco2: { '24': 'no_manual' },
    grupos_sin_clase: ['52'],
  };
}

for (const idioma of ['es', 'ca'] as const) {
  const lengua = { idioma, tituloIsco: (codigo: string) => codigo };

  test(`${idioma}: un grupo sin clase en la edición da su cifra y omite el motivo, sin texto sustituto`, () => {
    const sinClase = usoDeclaradoDeLaIa({ tich: tich() }, '52', lengua);
    const conClase = usoDeclaradoDeLaIa({ tich: tich() }, '24', lengua);
    assert.equal(sinClase?.pct, PCT.grupo);
    assert.equal(sinClase?.noSabianComo, null);
    assert.deepEqual(conClase?.noSabianComo, { clase: 'no_manual', pct: PCT.motivo, anio: '2025' });
    assert.deepEqual({ ...sinClase, codigo: '24', grupo: '24' }, { ...conClase, noSabianComo: null });
  });
}

test('el dato exige que los grupos sin clase sean grupos de 2 cifras, en orden y sin clase', () => {
  assert.equal(comprobarTich(tich()).grupos_sin_clase?.[0], '52');
  const { grupos_sin_clase: _, ...sinLista } = tich();
  assert.doesNotThrow(() => comprobarTich(sinLista));
  for (const grupos of [['5'], ['52', '51'], ['52', '52'], ['24']]) {
    assert.throws(() => comprobarTich({ ...tich(), grupos_sin_clase: grupos }), /grupos sin clase/u);
  }
});
