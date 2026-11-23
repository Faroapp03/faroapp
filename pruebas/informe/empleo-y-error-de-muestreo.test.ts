import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const MERCADO = JSON.parse(readFileSync(new URL('../../datos/mercado.json', import.meta.url), 'utf8'));
/** El gran grupo de la ocupación de prueba (4110, empleados de oficina). */
const GRAN_GRUPO = '4';
const VARIACION = -5.6;
const ANTERIOR = 485_300;
/** Una variación al alza, para comprobar que «más» o «menos» sale del dato. */
const AL_ALZA = 3.2;

/** Los datos del paquete con el gran grupo cambiado como se pida. */
function datosCon(cambio: { variacion_pct?: number | null; anterior?: number | null }): Datos {
  const copia: Datos = structuredClone(DATOS);
  const grupo = copia.mercado?.empleo?.grandes_grupos[GRAN_GRUPO];
  assert.ok(grupo);
  Object.assign(grupo, cambio);
  return copia;
}

/** El informe breve de la ocupación de prueba, en el idioma dado, y su HTML. */
function caso(datos: Datos, idioma: 'es' | 'ca') {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha: '2026-10-23',
      sinIa: true,
      tareas: [{ id: 'una', texto: 'Tarea', tiempo: 'mucho', referencia: { tareaOit: '4110-1', relacion: 'propia' } }],
    },
    datos,
    { idioma, formacion: null },
  );
  const breve = construirInformeBreve(informe, datos);
  return { breve, html: renderizarInformeBreve(breve, informe, { incrustado: true }) };
}

/** La tarjeta de empleo del HTML, para no confundirla con las demás. */
function tarjetaDelEmpleo(html: string, titulo: string): string {
  const tarjeta = html.split('<div class="ib-tarjeta"').find((trozo) => trozo.includes(`>${titulo}</h`));
  assert.ok(tarjeta, `falta la tarjeta «${titulo}»`);
  return tarjeta;
}

test('el empleo de la EPA no lleva dirección: da las dos cifras y la variación', () => {
  const { breve } = caso(DATOS, 'es');
  assert.deepEqual(
    [breve.mercado.empleo?.direccion, breve.mercado.empleo?.variacion, breve.mercado.empleo?.anterior],
    [
      'sin-dato',
      MERCADO.empleo.grandes_grupos[GRAN_GRUPO].variacion_pct,
      MERCADO.empleo.grandes_grupos[GRAN_GRUPO].anterior,
    ],
  );
});

test('la tarjeta de empleo distingue el cambio estimado del muestreo en ambos idiomas', () => {
  const datos = datosCon({ variacion_pct: VARIACION, anterior: ANTERIOR });
  const es = tarjetaDelEmpleo(caso(datos, 'es').html, 'Empleo');
  assert.match(es, /^ data-tono="neutro" data-comparacion data-estimacion>/u);
  assert.match(es, /−5,6\s%/u);
  assert.match(
    es,
    /La encuesta estima.*en empleos administrativos en Cataluña.*485\.300.*La diferencia puede deberse al muestreo/u,
  );
  assert.match(es, /Fuente: INE · EPA/u);
  const ca = tarjetaDelEmpleo(caso(datos, 'ca').html, 'Ocupació');
  assert.match(ca, /−5,6\s%/u);
  assert.match(
    ca,
    /L’enquesta estima.*en feines administratives a Catalunya.*485\.300.*La diferència pot deure’s al mostreig/u,
  );
  assert.match(ca, /Font: INE · EPA/u);
});

test('la variación de la estimación conserva su signo', () => {
  const es = tarjetaDelEmpleo(caso(datosCon({ variacion_pct: AL_ALZA, anterior: ANTERIOR }), 'es').html, 'Empleo');
  assert.match(es, /\+3,2\s%/u);
  assert.match(es, /485\.300/u);
});

test('«En pocas palabras» no afirma hacia dónde ha ido el empleo', () => {
  const datos = datosCon({ variacion_pct: VARIACION, anterior: ANTERIOR });
  assert.doesNotMatch(caso(datos, 'es').html, /el empleo administrativo (ha|y)/u);
  assert.doesNotMatch(caso(datos, 'ca').html, /l’ocupació administrativa (ha|i)/u);
});

test('sin la media del año anterior, la tarjeta da solo la cifra y no compara', () => {
  const es = tarjetaDelEmpleo(caso(datosCon({ variacion_pct: null, anterior: null }), 'es').html, 'Empleo');
  assert.match(
    es,
    /<p>Personas en empleos administrativos en Cataluña, de media durante los últimos cuatro trimestres\.<\/p>/u,
  );
  assert.match(es, /Sin comparación/u);
  const ca = tarjetaDelEmpleo(caso(datosCon({ variacion_pct: null, anterior: null }), 'ca').html, 'Ocupació');
  assert.match(
    ca,
    /<p>Persones en feines administratives a Catalunya, de mitjana durant els últims quatre trimestres\.<\/p>/u,
  );
});
