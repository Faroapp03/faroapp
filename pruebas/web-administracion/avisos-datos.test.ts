/** Los avisos del estado de los datos que no son un resultado de consulta se pintan solo cuando vienen con valor. */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVISOS_EDICION, ESTADOS_EDICION_NUEVA } from '../../src/administracion/edicion-nueva-datos.js';
import {
  MOTIVOS_ALMACEN,
  MOTIVOS_SALIDA_PARCIAL,
  type MotivoAlmacenDatos,
  type MotivoSalidaParcialDatos,
} from '../../src/administracion/estado-datos.js';
import { gravedadDeMotivo, MOTIVOS_PREVISTOS_EN_ENLACES } from '../../src/administracion/salud-datos.js';
import { operacionSalud } from '../ayudas/salud-datos.ts';
import { instalar } from '../web-informe-lectura/dom-doble.ts';
import {
  conAlmacen,
  conSalida,
  de,
  estadoDeLaFuente,
  HUELLA,
  leer,
  OBSERVADO_EN,
  pintado,
  TRES,
} from './avisos-datos-ayudas.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { fijarReloj } from './reloj-fijo.ts';

test('el fallo del almacén de cursos se escribe arriba, con su texto en cada idioma, y sin él no sale nada', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  for (const motivo of MOTIVOS_ALMACEN as readonly MotivoAlmacenDatos[]) {
    const datos = conAlmacen(motivo);
    for (const idioma of ['es', 'ca'] as const) {
      const texto = pintado(datos, idioma);
      assert.ok(texto.includes(de(idioma, `panel.datos.almacen.${motivo}`)), `${motivo} en ${idioma}`);
      assert.ok(texto.includes(idioma === 'es' ? 'Necesita atención' : 'Necessita atenció'));
    }
  }
  assert.ok(pintado(conAlmacen('almacen-ausente'), 'es').includes('Falta el almacén del catálogo de cursos'));
  for (const idioma of ['es', 'ca'] as const) {
    const sin = pintado(conAlmacen(undefined), idioma);
    assert.ok(!/almac[eé]n|magatzem/.test(sin), 'sin el campo no hay aviso del almacén');
    assert.ok(!sin.includes('Necesita atención') && !sin.includes('Necessita atenció'));
  }
});

test('la edición nueva se pinta con su año y su día, es información y no cambia la salud de la fuente', (t) => {
  instalar(t);
  fijarReloj(t);
  t.after(() => activarIdiomaPanel());
  const sin = leer();
  const nueva = (estado: string) => ({ estado, anio: '2026', observadoEn: OBSERVADO_EN, huellaCatalogo: HUELLA });
  const esperado = {
    'publicada-sin-microdatos': {
      es: 'Edición 2026 publicada, todavía sin sus microdatos. Observado: hace 25 días, el 20 oct. 2026.',
      ca: 'Edició 2026 publicada, encara sense les microdades. Observat: fa 25 dies, el 20 d’oct. del 2026.',
    },
    'pendiente-de-incorporar': {
      es: 'Edición 2026 publicada con sus microdatos; Faro sigue mostrando la anterior. Observado: hace 25 días, el 20 oct. 2026.',
      ca: 'Edició 2026 publicada amb les microdades; Faro continua mostrant l’anterior. Observat: fa 25 dies, el 20 d’oct. del 2026.',
    },
  } as const;
  for (const estado of ESTADOS_EDICION_NUEVA.filter((e) => e !== 'detenida-por-controles')) {
    const datos = leer({}, { edicionNueva: nueva(estado) });
    assert.equal(estadoDeLaFuente(datos), estadoDeLaFuente(sin), 'la edición nueva no es una incidencia');
    for (const idioma of ['es', 'ca'] as const) {
      assert.ok(pintado(datos, idioma).includes(esperado[estado][idioma]), `${estado} en ${idioma}`);
    }
  }
  for (const idioma of ['es', 'ca'] as const) {
    assert.ok(
      !/Edici(ón|ó) \d{4} publicada|Observado:|Observat:/.test(pintado(sin, idioma)),
      'sin edición nueva no sale nada',
    );
  }
});

test('cada aviso de edición tiene su texto en los dos idiomas y no cambia la salud de la fuente', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const sin = leer();
  for (const aviso of AVISOS_EDICION) {
    const nueva = aviso === 'observacion-anterior-descartada';
    const datos = leer(
      {},
      {
        avisoEdicion: aviso,
        ...(nueva
          ? {
              edicionNueva: {
                estado: 'pendiente-de-incorporar',
                anio: '2026',
                observadoEn: OBSERVADO_EN,
                huellaCatalogo: HUELLA,
              },
            }
          : {}),
      },
    );
    assert.equal(estadoDeLaFuente(datos), estadoDeLaFuente(sin));
    for (const idioma of ['es', 'ca'] as const) {
      assert.ok(
        pintado(datos, idioma).includes(de(idioma, `panel.datos.aviso-edicion.${aviso}`)),
        `${aviso} en ${idioma}`,
      );
    }
  }
});

test('los grupos en su gran grupo se dicen con su singular y, sin el campo ni los avisos, no sale nada', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const sin = leer();
  const uno = leer({}, { gruposEnSuGranGrupo: 1 });
  const varios = leer({}, { gruposEnSuGranGrupo: TRES });
  assert.ok(
    pintado(uno, 'es').includes(
      '1 grupo de ocupación se muestra con la cifra de su gran grupo porque la EPA no confirma cómo se reparten.',
    ),
  );
  assert.ok(
    pintado(varios, 'es').includes(
      '3 grupos de ocupación se muestran con la cifra de su gran grupo porque la EPA no confirma cómo se reparten.',
    ),
  );
  assert.ok(
    pintado(uno, 'ca').includes(
      '1 grup d’ocupació es mostra amb la xifra del seu gran grup perquè l’EPA no confirma com es reparteixen.',
    ),
  );
  assert.ok(
    pintado(varios, 'ca').includes(
      '3 grups d’ocupació es mostren amb la xifra del seu gran grup perquè l’EPA no confirma com es reparteixen.',
    ),
  );
  for (const idioma of ['es', 'ca'] as const) {
    const texto = pintado(sin, idioma);
    assert.ok(!/EPA|Idescat|INE/.test(texto), 'sin los campos no sale ningún aviso de edición');
  }
});

test('la salida parcial dice las cifras con su singular, sin la parte que valga cero, y un texto por motivo', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const marcoEs = 'La última actualización publicada de esta fuente no lo incluye todo:';
  const marcoCa = 'L’última actualització publicada d’aquesta font no ho inclou tot:';
  const casos = [
    [
      { descartadas: 2, aRevisar: TRES },
      `${marcoEs} 2 fichas descartadas.`,
      '3 especialidades de FUNDAE excluidas parecen tratar de IA',
    ],
    [
      { descartadas: 1, aRevisar: 1 },
      `${marcoEs} 1 ficha descartada.`,
      '1 especialidad de FUNDAE excluida parece tratar de IA',
    ],
    [{ descartadas: TRES, aRevisar: 0 }, `${marcoEs} 3 fichas descartadas.`, ''],
    [{ descartadas: 0, aRevisar: 1 }, '', '1 especialidad de FUNDAE excluida parece tratar de IA'],
  ] as const;
  for (const [cifras, frase, revisar] of casos) {
    const es = pintado(conSalida({ motivos: ['fichas-fallidas'], ...cifras }), 'es');
    assert.equal(frase === '' ? !es.includes(marcoEs) : es.includes(frase), true, frase);
    assert.equal(revisar === '' ? !es.includes('especialidad') : es.includes(revisar), true, revisar);
  }
  const ca = pintado(conSalida({ motivos: ['fichas-fallidas'], descartadas: 1, aRevisar: 2 }), 'ca');
  assert.ok(ca.includes(`${marcoCa} 1 fitxa descartada.`));
  assert.ok(ca.includes('2 especialitats de FUNDAE excloses semblen tractar d’IA'));
  const soloMotivos = pintado(conSalida({ motivos: ['indice-caido'], descartadas: 0, aRevisar: 0 }), 'es');
  assert.ok(!soloMotivos.includes('La última actualización publicada'), 'sin cifras no hay frase de cifras');
  assert.ok(soloMotivos.includes(de('es', 'panel.datos.salida-parcial.motivo.indice-caido')));
  for (const motivo of MOTIVOS_SALIDA_PARCIAL as readonly MotivoSalidaParcialDatos[]) {
    const datos = conSalida({ motivos: [motivo], descartadas: 0, aRevisar: 1 });
    for (const idioma of ['es', 'ca'] as const) {
      assert.ok(pintado(datos, idioma).includes(de(idioma, `panel.datos.salida-parcial.motivo.${motivo}`)));
    }
  }
  const dos = pintado(conSalida({ motivos: ['indice-caido', 'portlet-cambiado'], descartadas: 0, aRevisar: 1 }), 'es');
  assert.ok(dos.includes(de('es', 'panel.datos.salida-parcial.motivo.indice-caido')));
  assert.ok(dos.includes(de('es', 'panel.datos.salida-parcial.motivo.portlet-cambiado')));
  for (const idioma of ['es', 'ca'] as const) {
    assert.ok(
      !/última actualización publicada|última actualització publicada/.test(pintado(leer(), idioma)),
      'sin salida parcial no sale nada',
    );
  }
});

test('cada motivo de salida parcial pone la fuente en el estado que le toca', () => {
  assert.equal(estadoDeLaFuente(leer()), 'comprobada');
  for (const motivo of MOTIVOS_SALIDA_PARCIAL as readonly MotivoSalidaParcialDatos[]) {
    const esperado = { informacion: 'comprobada', incidencia: 'incidencia', atencion: 'atencion' } as const;
    const estado = estadoDeLaFuente(conSalida({ motivos: [motivo], descartadas: 0, aRevisar: 0 }));
    assert.equal(estado, esperado[gravedadDeMotivo(motivo, 'empresas')], motivo);
  }
  assert.equal(estadoDeLaFuente(conSalida({ motivos: [], descartadas: 2, aRevisar: 1 })), 'comprobada');
  assert.equal(operacionSalud().resultado, 'comprobada');
});

test('el tope y el plazo son lo previsto en la comprobación de enlaces y una anomalía en las demás fuentes', () => {
  for (const motivo of MOTIVOS_PREVISTOS_EN_ENLACES) {
    assert.equal(gravedadDeMotivo(motivo, 'enlaces'), 'informacion', motivo);
    assert.equal(gravedadDeMotivo(motivo, 'fundae'), 'incidencia', motivo);
  }
});
