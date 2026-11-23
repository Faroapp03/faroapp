import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import {
  politicaSeccionesInicial,
  SECCIONES_WEB,
  VERSION_SECCIONES_PUBLICAS,
} from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { webConstruida } from '../ayudas/web-construida.ts';
import { BASES, huellaDe, pedir, servicio } from './ayudas.ts';

const HTML = '<h1>Copia conocida</h1>';
const HUELLA = createHash('sha256').update(HTML).digest('hex');
const REVISION = 7;
const NO_DISPONIBLE = 503;
for (const base of BASES) {
  test(`caché v1 se conserva pero no autoriza secciones sin identidad: ${base}`, async () => {
    const sw = servicio(base, {
      politica: textoPoliticaCache(),
      archivos: ['inicio.html', 'biblioteca.html', 'cursos.html'],
      paginasSecciones: [
        ['biblioteca.html', HUELLA],
        ['cursos.html', HUELLA],
      ],
    });
    const { cursos: _curso, ...legadas } = politicaSeccionesInicial();
    const documento = { version: 1, revision: REVISION, secciones: legadas };
    const contenido = JSON.stringify(documento);
    const ids = SECCIONES_WEB.map(({ id }) => id).filter((id) => id !== 'cursos');
    const clave = `${sw.urlDe('secciones.json')}?revision=${REVISION}&estado=${ids.map((id) => Number(documento.secciones[id])).join('')}`;
    sw.guardadas.set(`faro-secciones:${base}`, new Map([[clave, Response.json(documento)]]));
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe('biblioteca.html'), new Response(HTML)]]));
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, NO_DISPONIBLE);
    assert.equal((await pedir(sw, 'cursos.html')).estado, NO_DISPONIBLE);
    assert.equal(await sw.guardadas.get(`faro-secciones:${base}`)?.get(clave)?.clone().text(), contenido);
  });
}

test('la proyección de la página real de Cursos queda fuera de la copia tras retirar la sección', async () => {
  const base = BASES[0];
  assert.ok(base);
  const cursos = readFileSync(join(webConstruida(), 'cursos.html'), 'utf8');
  const contenido = /<template data-listado-cursos>([A-Za-z0-9_-]+)<\/template>/.exec(cursos)?.[1];
  assert.ok(contenido);
  const archivos = ['inicio.html', 'cursos.html'];
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos,
    paginasSecciones: [['cursos.html', huellaDe(cursos)]],
    cuerpoDe: (ruta) => (ruta === 'cursos.html' ? cursos : 'PORTADA'),
  });
  let activa = true;
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: activa ? 0 : 1,
        secciones: { ...politicaSeccionesInicial(), cursos: activa },
      });
    }
    return new Response(url === sw.urlDe('cursos.html') ? cursos : 'PORTADA', {
      headers: { 'content-type': 'text/html', 'x-faro-portal': 'publico' },
    });
  };
  await sw.instalar();
  sw.red.offline = true;
  assert.equal((await pedir(sw, 'cursos.html')).cuerpo, cursos);
  sw.conectar();
  activa = false;
  assert.equal((await pedir(sw, 'cursos.html')).estado, ESTADO_HTTP.noEncontrado);
  sw.red.offline = true;
  assert.ok(!(await pedir(sw, 'cursos.html')).cuerpo?.includes(contenido));
});

test('el portal privado protege también una copia residual de la página de Cursos sin conexión', async () => {
  const base = BASES[0];
  assert.ok(base);
  const cursos = readFileSync(join(webConstruida(), 'cursos.html'), 'utf8');
  const privada = servicio(base);
  privada.guardadas.set(
    privada.nombreCopia,
    new Map([
      [privada.urlDe('inicio.html'), new Response('PORTADA', { headers: { 'x-faro-portal': 'privado' } })],
      [privada.urlDe('cursos.html'), new Response(cursos)],
    ]),
  );
  const cerrada = await pedir(privada, 'cursos.html');
  assert.equal(cerrada.estado, NO_DISPONIBLE);
  assert.ok(!cerrada.cuerpo?.includes('data-listado-cursos'));
});
