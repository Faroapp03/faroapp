// La fila de las personas de «Qué vigilar» dice lo que se sabe de la encuesta TIC-H: la edición nueva que el INE ya
// publicó y el dato aún no incorpora, con la fecha en que se observó; ninguna fecha prevista ya pasada como próxima; y
// cómo ha ido la cifra según los años que trae el dato.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROXIMA_TICH, TICH_PUBLICADA_SEGUN_CALENDARIO } from '../../src/dominio/hechos-del-informe-breve.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { EdicionNuevaDeLaTich } from '../../src/dominio/tipos-contexto.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { prepararParte } from '../../src/plataforma/archivos-del-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const OBSERVADA = '2026-11-12T03:00:00+00:00';
const DESPUES_DE_LA_PREVISTA = '2026-11-14';
/** Una huella sintética del catálogo observado. */
const HUELLA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function conTich(cambios: Partial<NonNullable<Datos['tich']>>): Datos {
  assert.ok(datos.tich, 'el paquete trae la TIC-H');
  const { edicion_nueva: _edicion, ...tich } = datos.tich;
  return {
    ...datos,
    tich: { ...tich, fuentes: { tich: 'Encuesta sintética' }, anio: '2025', anios_medidos: ['2025'], ...cambios },
  };
}

function edicion(estado: EdicionNuevaDeLaTich['estado']): EdicionNuevaDeLaTich {
  return { estado, anio: '2026', observado_utc: OBSERVADA, sha256_catalogo: HUELLA };
}

/** El HTML de la fila de las personas de su grupo, con el paquete y la fecha del informe dados. */
function filaDeLasPersonas(idioma: 'es' | 'ca', paquete: Datos, fecha: string, sinCalendario = false): string {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha,
      tareas: [
        {
          id: 't1',
          texto: 'Comprobar documentos',
          tiempo: 'mucho',
          referencia: { tareaOit: '4110-1', relacion: 'propia' },
        },
      ],
    },
    paquete,
    { idioma, formacion: null },
  );
  const construido = construirInformeBreve(informe, paquete);
  // Sin la publicación del calendario: la señal de un registro cuyo evento aún no trae los valores publicados.
  const senales = construido.senales.map(({ publicadaSegunCalendario: _calendario, ...senal }) =>
    sinCalendario ? senal : { ...senal, ...(_calendario ? { publicadaSegunCalendario: _calendario } : {}) },
  );
  const breve = { ...construido, senales };
  const html = renderizarInformeBreve(breve, informe, { incrustado: true });
  const fila = html.match(/<tr[^>]*><td>(?:Personas de tu grupo|Persones del teu grup)[\s\S]*?<\/tr>/u)?.[0] ?? '';
  assert.ok(fila, 'la fila de las personas está en el informe');
  return fila;
}

const TEXTOS = {
  es: {
    sinDetalle:
      'El INE publicó la edición de 2026; Faro lo comprobó el 12 nov. 2026. La incorporará cuando el INE publique los datos detallados de la encuesta.',
    pendiente:
      'El INE publicó la edición de 2026; Faro lo comprobó el 12 nov. 2026. La incorporará cuando haya comprobado que se puede comparar con la anterior.',
    deMadrugada: 'Faro lo comprobó el 13 nov. 2026.',
    porConfirmar: 'Fecha por confirmar',
    publicadaLa: 'Publicada la de 2026',
    elMismoDia: 'Fecha prevista: 11 nov. 2026',
    prevista: '11 nov. 2026',
    primero: 'Primer año que se mide',
    desde: 'Se mide desde 2024',
  },
  ca: {
    sinDetalle:
      'L’INE va publicar l’edició del 2026; Faro ho va comprovar el 12 de nov. del 2026. La incorporarà quan l’INE en publiqui les dades detallades.',
    pendiente:
      'L’INE va publicar l’edició del 2026; Faro ho va comprovar el 12 de nov. del 2026. La incorporarà quan hagi comprovat que es pot comparar amb l’anterior.',
    deMadrugada: 'Faro ho va comprovar el 13 de nov. del 2026.',
    porConfirmar: 'Data per confirmar',
    publicadaLa: 'Publicada la del 2026',
    elMismoDia: 'Data prevista: 11 de nov. del 2026',
    prevista: '11 de nov. del 2026',
    primero: 'Primer any que es mesura',
    desde: 'Es mesura des del 2024',
  },
} as const;

assert.equal(PROXIMA_TICH, '2026-11-11', 'las pruebas parten de la previsión registrada');

for (const idioma of ['es', 'ca'] as const) {
  const textos = TEXTOS[idioma];

  test(`${idioma}: una edición publicada sin datos detallados se dice con la fecha observada, no como prevista`, () => {
    const fila = filaDeLasPersonas(
      idioma,
      conTich({ edicion_nueva: edicion('publicada-sin-microdatos') }),
      DESPUES_DE_LA_PREVISTA,
    );
    assert.ok(fila.includes(`<small>${textos.sinDetalle}</small></td>`), fila);
    assert.ok(fila.endsWith(`<td>${textos.publicadaLa}</td></tr>`), fila);
    assert.ok(!fila.includes(textos.prevista), fila);
    assert.ok(!/microdat/u.test(fila), fila);
  });

  test(`${idioma}: una edición publicada con datos detallados queda pendiente de comprobar, con la fecha observada`, () => {
    const fila = filaDeLasPersonas(
      idioma,
      conTich({ edicion_nueva: edicion('pendiente-de-incorporar') }),
      DESPUES_DE_LA_PREVISTA,
    );
    assert.ok(fila.includes(textos.pendiente), fila);
  });

  test(`${idioma}: el informe no cita una comprobación posterior a su propia fecha`, () => {
    const fila = filaDeLasPersonas(
      idioma,
      conTich({ edicion_nueva: edicion('publicada-sin-microdatos') }),
      '2026-10-23',
    );
    assert.ok(!fila.includes('2026;'), fila);
    assert.ok(fila.includes(textos.prevista), fila);
  });

  test(`${idioma}: la fecha observada es el día de Barcelona, no el de UTC`, () => {
    const nueva = { ...edicion('publicada-sin-microdatos'), observado_utc: '2026-11-12T23:30:00+00:00' };
    const fila = filaDeLasPersonas(idioma, conTich({ edicion_nueva: nueva }), DESPUES_DE_LA_PREVISTA);
    assert.ok(fila.includes(textos.deMadrugada), fila);
  });

  test(`${idioma}: sin observación ni calendario publicado, la fecha prevista vale hasta su día y después no`, () => {
    const sinObservacion = conTich({});
    assert.equal(sinObservacion.tich?.edicion_nueva, undefined);
    assert.ok(filaDeLasPersonas(idioma, sinObservacion, '2026-10-23', true).includes(textos.prevista));
    assert.ok(filaDeLasPersonas(idioma, sinObservacion, PROXIMA_TICH, true).includes(textos.elMismoDia));
    const pasada = filaDeLasPersonas(idioma, sinObservacion, DESPUES_DE_LA_PREVISTA, true);
    assert.ok(pasada.includes(textos.porConfirmar), pasada);
    assert.ok(!pasada.includes(textos.prevista), pasada);
  });

  test(`${idioma}: con el evento del calendario ya publicado, pasada su fecha la columna dice que está publicada`, () => {
    assert.equal(TICH_PUBLICADA_SEGUN_CALENDARIO, '2026');
    const sinObservacion = conTich({});
    assert.ok(filaDeLasPersonas(idioma, sinObservacion, '2026-10-23').includes(textos.prevista));
    for (const fecha of [PROXIMA_TICH, DESPUES_DE_LA_PREVISTA]) {
      const fila = filaDeLasPersonas(idioma, sinObservacion, fecha);
      assert.ok(fila.endsWith(`<td>${textos.publicadaLa}</td></tr>`), fila);
      assert.ok(!fila.includes(textos.porConfirmar), fila);
    }
  });

  test(`${idioma}: si el dato ya trae la edición del calendario, la columna no la da como novedad`, () => {
    const delMismoAnio = conTich({ anio: '2026', anios_medidos: ['2025', '2026'] });
    const fila = filaDeLasPersonas(idioma, delMismoAnio, DESPUES_DE_LA_PREVISTA);
    assert.ok(fila.includes(textos.porConfirmar), fila);
    assert.ok(!fila.includes(textos.publicadaLa), fila);
  });

  test(`${idioma}: cómo ha ido la cifra sale de los años que trae el dato`, () => {
    const una = filaDeLasPersonas(idioma, conTich({ anios_medidos: ['2025'] }), '2026-10-23');
    assert.ok(una.includes(textos.primero), una);
    for (const anios of [
      ['2024', '2026'],
      ['2024', '2025', '2026'],
    ]) {
      const serie = filaDeLasPersonas(idioma, conTich({ anio: '2026', anios_medidos: anios }), '2026-10-23');
      assert.ok(serie.includes(textos.desde), serie);
      assert.ok(!serie.includes(textos.primero), serie);
    }
  });
}

test('un dato con años medidos o una edición nueva mal formados se rechaza, sin pintar nada', () => {
  for (const anios of [[], ['2026', '2025'], ['2025', '2025'], ['2024'], ['25']]) {
    assert.throws(() => filaDeLasPersonas('es', conTich({ anios_medidos: anios }), '2026-10-23'), /TIC-H: los años/u);
  }
  const buena = edicion('publicada-sin-microdatos');
  for (const mala of [
    { ...buena, anio: '999' },
    { ...buena, anio: '2026x' },
    { ...buena, anio: '2025' },
    { ...buena, observado_utc: 'ayer' },
    { ...buena, observado_utc: '2026-11-12' },
    { ...buena, sha256_catalogo: 'y'.repeat(HUELLA.length) },
    { ...buena, estado: 'fallo' as EdicionNuevaDeLaTich['estado'] },
  ]) {
    assert.throws(
      () => filaDeLasPersonas('es', conTich({ edicion_nueva: mala }), DESPUES_DE_LA_PREVISTA),
      /TIC-H: la edición nueva/u,
    );
  }
});

test('un dato de la TIC-H mal formado no se carga en el paquete; uno bien formado pasa tal cual', () => {
  assert.ok(datos.tich);
  assert.equal(prepararParte('tich', datos.tich), datos.tich);
  const tich = conTich({}).tich;
  assert.ok(tich);
  const nueva = edicion('publicada-sin-microdatos');
  assert.ok(prepararParte('tich', { ...tich, edicion_nueva: nueva }));
  for (const malo of [
    { ...tich, anios_medidos: [] },
    { ...tich, anios_medidos: ['2026', '2025'] },
    { ...tich, edicion_nueva: { ...nueva, anio: '2026x' } },
    { ...tich, edicion_nueva: { ...nueva, observado_utc: 'ayer' } },
  ]) {
    assert.throws(() => prepararParte('tich', malo), /TIC-H:/u);
  }
});

test('cargarDatos en Node rechaza un paquete con la TIC-H mal formada aunque su huella cuadre', () => {
  const origen = fileURLToPath(new URL('../../datos/', import.meta.url));
  const carpeta = mkdtempSync(join(tmpdir(), 'paquete-tich-'));
  try {
    for (const archivo of readdirSync(origen)) {
      if (archivo !== 'tich.json' && archivo !== 'manifiesto.json') {
        symlinkSync(join(origen, archivo), join(carpeta, archivo));
      }
    }
    assert.ok(datos.tich);
    const malo = Buffer.from(JSON.stringify({ ...datos.tich, anios_medidos: ['2026', '2025'] }));
    writeFileSync(join(carpeta, 'tich.json'), malo);
    const manifiesto = JSON.parse(readFileSync(join(origen, 'manifiesto.json'), 'utf8'));
    manifiesto['tich.json'] = { ...manifiesto['tich.json'], sha256: createHash('sha256').update(malo).digest('hex') };
    writeFileSync(join(carpeta, 'manifiesto.json'), JSON.stringify(manifiesto));
    assert.throws(() => cargarDatos(carpeta), /TIC-H: los años medidos/u);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
