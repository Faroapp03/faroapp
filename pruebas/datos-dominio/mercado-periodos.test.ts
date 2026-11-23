// Periodo anual desde el paquete hasta el HTML, con datos sintéticos en memoria y los dos idiomas del informe.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Idioma } from '../../src/comun/idioma.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { construirInformeConFormacion } from '../ayudas/informe-con-formacion.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const MERCADO = DATOS.mercado;
assert.ok(MERCADO?.anual && MERCADO.contratacion);
const TESTIGO: { valores: number[] } = JSON.parse(
  readFileSync(new URL('../testigos/mercado-periodos.json', import.meta.url), 'utf8'),
);

function componer(periodo: string, idioma: Idioma) {
  assert.ok(MERCADO?.anual && MERCADO.contratacion);
  const datos: Datos = {
    ...DATOS,
    mercado: {
      ...MERCADO,
      contratacion: { ...MERCADO.contratacion, periodo },
      anual: {
        etiquetas: periodo.includes('diciembre')
          ? ['2021', '2022', '2023', '2024', '2025', '2026']
          : ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'],
        publicado: [false, false, false, false, false, true],
        cno4: { '4309': TESTIGO.valores },
      },
    },
  };
  const informe = construirInformeConFormacion(
    {
      isco08: '4110',
      ocupacionEsco: '4110.1',
      fecha: '2026-10-21',
      sinIa: true,
      tareas: [
        {
          id: 't1',
          texto: 'Archivar documentación',
          tiempo: 'mucho',
          referencia: { tareaOit: '4110-1', relacion: 'propia' },
        },
      ],
    },
    datos,
    { idioma },
  );
  return { informe, breve: construirInformeBreve(informe, datos) };
}

for (const idioma of ['es', 'ca'] as const) {
  const alcance = idioma === 'ca' ? 'Catalunya · Indefinits i temporals' : 'Cataluña · Indefinidos y temporales';
  for (const [mes, es, ca] of [
    ['septiembre', 'octubre a septiembre', 'octubre a setembre'],
    ['diciembre', 'enero a diciembre', 'gener a desembre'],
  ] as const) {
    test(`el corte de ${mes} conserva su serie y rotula los doce meses reales en ${idioma}`, () => {
      const periodo = `12 meses a ${mes} de 2026`;
      const rotulo = idioma === 'ca' ? ca : es;
      const { informe, breve } = componer(periodo, idioma);
      assert.equal(breve.idioma, idioma);
      const anual = breve.mercado.anual;
      assert.ok(anual);
      assert.equal(anual.periodo, periodo);
      assert.deepEqual(anual.valores, TESTIGO.valores);
      assert.deepEqual(anual.publicado, [false, false, false, false, false, true]);
      assert.equal(anual.etiquetas.at(-1), mes === 'diciembre' ? '2026' : '2025-26');
      const html = renderizarInformeBreve(breve, informe, { incrustado: true });
      assert.ok(html.includes(`<small>${alcance}, de ${rotulo}.</small>`));
      assert.ok(html.includes(`${idioma === 'ca' ? 'Contractes per any' : 'Contratos por año'}, de ${rotulo}:`));
      assert.doesNotMatch(html, /de julio a junio/iu);
      assert.doesNotThrow(() => informeAdmitido(html));
    });
  }

  test(`junio conserva la forma anterior y un breve guardado sin periodo sigue leyendo junio en ${idioma}`, () => {
    const { informe, breve } = componer('12 meses a junio de 2026', idioma);
    assert.ok(breve.mercado.anual);
    assert.equal(Object.hasOwn(breve.mercado.anual, 'periodo'), false);
    const html = renderizarInformeBreve(breve, informe, { incrustado: true });
    assert.ok(html.includes(`<small>${alcance}, de ${idioma === 'ca' ? 'juliol a juny' : 'julio a junio'}.</small>`));
    assert.ok(
      html.includes(idioma === 'ca' ? 'Contractes per any, de juliol a juny:' : 'Contratos por año, de julio a junio:'),
    );
  });
}

test('un periodo explícito inválido no se convierte silenciosamente en julio-junio', () => {
  const { informe, breve } = componer('12 meses a septiembre de 2026', 'es');
  assert.ok(breve.mercado.anual);
  for (const periodo of ['', '12 meses a inventado de 2026', 'septiembre de 2026', '12 meses a junio de 26']) {
    const corrupto = { ...breve, mercado: { ...breve.mercado, anual: { ...breve.mercado.anual, periodo } } };
    assert.throws(() => renderizarInformeBreve(corrupto, informe), /periodo anual/iu);
    assert.throws(() => componer(periodo, 'es'), /periodo anual/iu);
  }
});
