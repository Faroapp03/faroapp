import assert from 'node:assert/strict';
import test from 'node:test';
import { leerParametros, urlConFiltros } from '../../web/scripts/catalogo-cursos/parametros.js';

test('la URL restaura búsqueda y todas las elecciones, incluida la ordenación', () => {
  const original = new URL(
    'https://example.invalid/cursos.html?q=IA+gestión&idioma=ca&nivel=no-indicado&modalidad=presencial&tema=empresa&orden=nombre',
  );
  const filtros = leerParametros(original);
  assert.deepEqual(filtros, {
    texto: 'IA gestión',
    idioma: 'ca',
    nivel: 'no-indicado',
    modalidad: 'presencial',
    tema: 'empresa',
    orden: 'nombre',
  });
  const enlace = urlConFiltros(original, filtros);
  assert.equal(enlace.searchParams.get('idioma-curso'), 'ca');
  assert.deepEqual(leerParametros(enlace), filtros);
  enlace.searchParams.set('idioma', 'es');
  assert.equal(leerParametros(enlace).idioma, 'ca');
});
test('elecciones desconocidas se ignoran sin crear opciones y limpiar conserva parámetros ajenos', () => {
  const original = new URL(
    'https://example.invalid/cursos.html?idioma=zz&nivel=doctorado&modalidad=mixta&tema=otro&orden=precio&lang=ca#contenido',
  );
  const vacios = { texto: '', idioma: '', nivel: '', modalidad: '', tema: '', orden: 'proximos' };
  assert.deepEqual(leerParametros(original), vacios);
  assert.equal(urlConFiltros(original, vacios).href, 'https://example.invalid/cursos.html?lang=ca#contenido');
});
test('el texto de búsqueda con marcado se conserva como dato de la URL', () => {
  const filtros = { texto: '<script>á & x</script>', idioma: '', modalidad: '' };
  const url = urlConFiltros(new URL('https://example.invalid/cursos.html'), filtros);
  assert.equal(leerParametros(url).texto, filtros.texto);
  assert.ok(!url.href.includes('<script>'));
});
