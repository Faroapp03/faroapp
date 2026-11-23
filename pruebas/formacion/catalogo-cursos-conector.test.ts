import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { artefactosCatalogo, LECTOR_PUBLICADO } from '../../herramientas/web/catalogo-cursos.ts';
import { listasDeLaCopia } from '../../herramientas/web/copia-sin-conexion.ts';
import { cargarCatalogo } from '../../src/catalogo-cursos/carga.ts';
import { consultarCatalogo, proximaRevision } from '../../src/catalogo-cursos/consulta.ts';
import { CatalogoNoValido } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo, ofertasVigentes } from '../../src/catalogo-cursos/lectura.ts';
import { RelojAtrasado } from '../../src/comun/reloj-atrasado.ts';

const bytes = readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url));
const referencia = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8'),
);
const publicacion = { ...referencia, ruta: `datos/catalogo-cursos/${referencia.sha256}.json` };
const catalogo = leerCatalogo(bytes, referencia);
const vacios = { texto: '', idioma: '', modalidad: '' };
const antes = Date.parse('2026-10-22T11:59:59Z');
const semanasDespues = Date.parse('2026-11-20T10:00:00Z');
const CIERRA_EL = '2026-12-15T10:00:00Z';
const MAX_TIMER = 2_147_483_647;

test('carga verifica referencia externa y conserva decisiones/idioma/desconocidos', async () => {
  const leido = await cargarCatalogo(publicacion, new URL('https://example.org/sub/'), async (peticion) => {
    assert.equal(peticion.url, `https://example.org/sub/${publicacion.ruta}`);
    assert.equal(peticion.credentials, 'same-origin');
    assert.equal(peticion.redirect, 'error');
    return new Response(bytes, { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(leido, catalogo);
  assert.equal(Object.isFrozen(leido), true);
});

test('errores de publicación no se convierten en cero ofertas', async () => {
  const base = new URL('https://example.org/');
  for (const responder of [
    () => new Response('ausente', { status: 404 }),
    () => new Response(bytes, { headers: { 'content-type': 'text/html' } }),
    () =>
      new Response(Buffer.concat([bytes, Buffer.from('exceso')]), { headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(
      cargarCatalogo(publicacion, base, async () => responder()),
      CatalogoNoValido,
    );
  }
  await assert.rejects(
    cargarCatalogo(null, base, async () => {
      throw new Error('No consultar');
    }),
    CatalogoNoValido,
  );
});

test('vista también offline conserva la oferta semanas después y solo la retira en su límite publicado', () => {
  const original = JSON.stringify(catalogo);
  // La fixture del lector tiene coste desconocido: no acredita formación gratuita.
  assert.equal(consultarCatalogo(catalogo, vacios, antes).ofertas.length, 0);
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const gratuita = {
    ...catalogo,
    ofertas: [
      {
        ...oferta,
        cierra_el: CIERRA_EL,
        hechos: {
          ...oferta.hechos,
          coste_formacion_tipo: {
            ...oferta.hechos.coste_formacion_tipo,
            motivo: 'conocido' as const,
            valor: 'gratis_formacion',
          },
          coste_formacion: { ...oferta.hechos.coste_formacion, motivo: 'conocido' as const, valor: 0 },
        },
      },
    ],
  };
  assert.equal(consultarCatalogo(gratuita, vacios, antes).ofertas.length, 1);
  const tarde = consultarCatalogo(gratuita, vacios, semanasDespues).ofertas[0];
  assert.equal(tarde?.hechos.coste_formacion_tipo.valor, 'gratis_formacion');
  assert.equal(tarde?.comprobado_el, oferta.comprobado_el);
  assert.equal(consultarCatalogo(gratuita, vacios, Date.parse(CIERRA_EL) - 1).ofertas.length, 1);
  assert.equal(consultarCatalogo(gratuita, vacios, Date.parse(CIERRA_EL)).ofertas.length, 0);
  // Sin límites publicados no hay revisión que programar; con uno lejano, la mayor espera admitida.
  assert.equal(oferta.cierra_el, null);
  assert.equal(proximaRevision(catalogo, antes), null);
  assert.equal(proximaRevision(gratuita, antes), MAX_TIMER);
  assert.equal(proximaRevision(gratuita, Date.parse(CIERRA_EL) - 1), 1);
  assert.equal(proximaRevision(gratuita, Date.parse(CIERRA_EL)), null);
  assert.equal(JSON.stringify(catalogo), original);
  assert.equal(consultarCatalogo(catalogo, { ...vacios, idioma: 'idioma-no-declarado' }, antes).ofertas.length, 0);
});

test('un reloj anterior al corte lanza RelojAtrasado, distinto de un catálogo no válido; con el reloj en el corte devuelve las ofertas', () => {
  for (const consulta of [
    () => ofertasVigentes(catalogo, Date.parse('2020-01-01T00:00:00Z')),
    () => consultarCatalogo(catalogo, vacios, Date.parse('2020-01-01T00:00:00Z')),
    () => proximaRevision(catalogo, Date.parse('2020-01-01T00:00:00Z')),
  ]) {
    assert.throws(consulta, (error) => error instanceof RelojAtrasado && !(error instanceof CatalogoNoValido));
  }
  assert.throws(() => ofertasVigentes(catalogo, Number.NaN), CatalogoNoValido);
  // Reloj y corte son instantes UTC, sin zona horaria: la comparación es exacta, sin margen.
  const corte = Date.parse(catalogo.corte_proyeccion_utc) + 1; // el corte lleva un microsegundo
  assert.throws(() => ofertasVigentes(catalogo, corte - 1), RelojAtrasado);
  assert.equal(ofertasVigentes(catalogo, corte).length, catalogo.ofertas.length);
  assert.equal(ofertasVigentes(catalogo, antes).length, catalogo.ofertas.length);
});

test('bundle corresponde al fuente estricto y solo recursos generados quedan fuera de scripts manuscritos', async () => {
  const artefactos = await artefactosCatalogo();
  const publicados = [...artefactos.entries()];
  const lector = publicados.find(([ruta]) => ruta.pathname.endsWith('/lector.js'))?.[1];
  assert.ok(lector);
  assert.equal(lector, readFileSync(new URL(`../../${LECTOR_PUBLICADO}`, import.meta.url), 'utf8'));
  const informe = JSON.parse(publicados.find(([ruta]) => ruta.pathname.endsWith('/lector.json'))?.[1] ?? 'null');
  assert.equal(informe.sha256, createHash('sha256').update(lector).digest('hex'));
  assert.match(lector, /Generado desde src\/catalogo-cursos\/publico.ts/);
  assert.ok(!lector.includes('node:sqlite') && !lector.includes('motores/cursos'));
  const config = JSON.parse(readFileSync(new URL('../../tsconfig.web.json', import.meta.url), 'utf8'));
  assert.ok(config.include.includes('web/scripts/**/*.js'));
  assert.equal(config.exclude, undefined);
});

test('referencia, asset y lector quedan en la copia comprobada por huella', () => {
  const protegidos = [
    publicacion.ruta,
    'scripts/catalogo-cursos/referencia.js',
    'recursos/catalogo-cursos/lector.js',
    'recursos/catalogo-cursos/lector.json',
  ];
  const listas = listasDeLaCopia(['cursos.html', ...protegidos]);
  assert.deepEqual(listas.comprobados, [...protegidos].sort());
  assert.deepEqual(listas.archivos, ['cursos.html']);
});
