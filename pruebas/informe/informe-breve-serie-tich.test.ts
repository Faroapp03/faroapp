// La TIC-H con la edición nueva incorporada: el informe da la cifra del año nuevo y dice desde cuándo se mide, en
// castellano y en catalán, sin la nota de la edición publicada y aún sin incorporar.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
/** Una cifra sintética de 2026 para el gran grupo 4, en España y en Cataluña (el informe da antes la de Cataluña). */
const USO_2026 = 48;
const INTERVALO_INFERIOR = 40;
const INTERVALO_SUPERIOR = 55;
const INTERVALO_SINTETICO: [number, number] = [INTERVALO_INFERIOR, INTERVALO_SUPERIOR];

function conLaIncorporada(): Datos {
  const tich = datos.tich;
  assert.ok(tich);
  const { edicion_nueva: _, ...sinObservacion } = tich;
  const cifra = { pct: USO_2026, ic95: INTERVALO_SINTETICO, muestra: tich.min_muestra };
  return {
    ...datos,
    tich: {
      ...sinObservacion,
      anio: '2026',
      anios_medidos: ['2025', '2026'],
      espana_isco1: { ...tich.espana_isco1, '4': cifra },
      cataluna_isco1: { ...tich.cataluna_isco1, '4': cifra },
    },
  };
}

function fila(idioma: 'es' | 'ca', paquete: Datos): string {
  const informe = construirInforme(
    { isco08: '4110', fecha: '2026-11-20', tareas: [{ id: 't1', texto: 'Comprobar documentos', tiempo: 'mucho' }] },
    paquete,
    { idioma, formacion: null },
  );
  const html = renderizarInformeBreve(construirInformeBreve(informe, paquete), informe);
  const inicio = html.indexOf(idioma === 'es' ? 'Personas de tu grupo' : 'Persones del teu grup');
  assert.ok(inicio > 0, 'el informe trae la fila de las personas de tu grupo');
  return html.slice(inicio, html.indexOf('</tr>', inicio));
}

for (const idioma of ['es', 'ca'] as const) {
  const es = idioma === 'es';
  test(`${idioma}: con 2026 incorporada, la cifra es la de 2026 y se mide desde 2025, sin nota de edición`, () => {
    const texto = fila(idioma, conLaIncorporada());
    assert.match(texto, /<b>48<\/b> de cada 100 \(2026\)/u);
    assert.match(texto, es ? /Se mide desde 2025/u : /Es mesura des del 2025/u);
    assert.doesNotMatch(texto, /Primer año que se mide|Primer any que es mesura|INE publicó|INE va publicar/u);
  });
}

const tichCruda = JSON.parse(readFileSync(new URL('../../datos/tich.json', import.meta.url), 'utf8')) as NonNullable<
  Datos['tich']
>;

/** La cifra publicada para un grupo, a partir de las respuestas y claves del dato original. */
function cifraCruda(isco2: string) {
  const gran = isco2[0] ?? '';
  const suficiente = (cifra: { pct: number; muestra: number } | undefined) =>
    cifra && cifra.muestra >= tichCruda.min_muestra ? cifra : undefined;
  const catalana = suficiente(tichCruda.cataluna_isco1?.[gran]);
  if (catalana) {
    return { cifra: catalana, ambito: 'cataluna' as const };
  }
  const bloque = tichCruda.bloque_por_isco2[isco2];
  let principal = tichCruda.espana_isco2[isco2];
  if (bloque) {
    principal = tichCruda.espana_bloques[bloque];
  } else if (tichCruda.grandes_grupos_enteros.includes(gran)) {
    principal = tichCruda.espana_isco1[gran];
  }
  const espanola = suficiente(principal) ?? suficiente(tichCruda.espana_isco1[gran]);
  return espanola ? { cifra: espanola, ambito: 'espana' as const } : null;
}

function comprobarFila(texto: string, idioma: 'es' | 'ca', isco2: string): void {
  const esperado = cifraCruda(isco2);
  if (!esperado) {
    assert.doesNotMatch(texto, idioma === 'es' ? /Personas de tu grupo/u : /Persones del teu grup/u);
    return;
  }
  assert.ok(texto.includes(`<b>${Math.round(esperado.cifra.pct)}</b> de cada 100 (${tichCruda.anio})`), texto);
  if (esperado.ambito === 'espana') {
    assert.ok(texto.includes(idioma === 'es' ? 'en España' : 'a Espanya'), texto);
  }
  comprobarSerie(texto, idioma);
}

function comprobarSerie(texto: string, idioma: 'es' | 'ca'): void {
  const anios = tichCruda.anios_medidos ?? [tichCruda.anio];
  if (anios.length === 1) {
    assert.match(texto, idioma === 'es' ? /Primer año que se mide/u : /Primer any que es mesura/u);
  } else {
    assert.ok(texto.includes(idioma === 'es' ? `Se mide desde ${anios[0]}` : `Es mesura des del ${anios[0]}`), texto);
  }
}

for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: el informe presenta la cifra y la serie del paquete real`, () => {
    const informe = construirInforme(
      { isco08: '4110', fecha: '2026-11-20', tareas: [{ id: 't1', texto: 'Comprobar documentos', tiempo: 'mucho' }] },
      datos,
      { idioma, formacion: null },
    );
    const breve = construirInformeBreve(informe, datos);
    const esperado = cifraCruda('41');
    if (esperado) {
      assert.ok(breve.uso);
      assert.deepEqual(breve.uso.aniosMedidos, tichCruda.anios_medidos ?? [tichCruda.anio]);
      assert.equal(breve.uso.ambito, esperado.ambito);
    } else {
      assert.equal(breve.uso, null);
    }
    const html = renderizarInformeBreve(breve, informe);
    const filaReal =
      html.match(/<tr[^>]*><td>(?:Personas de tu grupo|Persones del teu grup)[\s\S]*?<\/tr>/u)?.[0] ?? '';
    comprobarFila(filaReal, idioma, '41');
  });

  test(`${idioma}: el HTML de ejemplo presenta la cifra y la serie del paquete real`, () => {
    const pagina = readFileSync(new URL('../../web/informe-ejemplo.html', import.meta.url), 'utf8');
    const patron =
      idioma === 'es'
        ? /<tr[^>]*><td>Personas de tu grupo[\s\S]*?<\/tr>/u
        : /<tr[^>]*><td>Persones del teu grup[\s\S]*?<\/tr>/u;
    comprobarFila(pagina.match(patron)?.[0] ?? '', idioma, '42');
  });
}
