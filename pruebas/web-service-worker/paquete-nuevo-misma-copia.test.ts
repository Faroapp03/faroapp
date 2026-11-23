// Un paquete de datos nuevo sin cambios en la web (service-worker.js, guardarCopia): cambian las líneas PAQUETE y
// TAMANOS_DEL_PAQUETE del service worker, así que el navegador instala la versión nueva, pero la VERSION no las cubre
// (herramientas/web/version-copia.ts) y el nombre de la copia de la web es el mismo. La reinstalación no reescribe lo
// que esa copia ya tiene (puede estar sirviendo a la versión activa), solo le añade lo que falte, y la deja entera y
// con los bytes de esta versión; el paquete nuevo va en su propia copia, con otro nombre.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, servicio } from './ayudas.ts';

const ARCHIVOS = ['inicio.html', 'sin-conexion.html', 'estilos/base.css', 'js/pagina-inicio-0123456789abcdef.js'];
const VERSION = '0123456789abcdef';

for (const base of BASES) {
  test(`un paquete nuevo reinstala con la misma copia sin reescribirla y la deja entera: ${base}`, async () => {
    const anterior = servicio(base, { archivos: ARCHIVOS, version: VERSION, paquete: 'aaaaaaaaaaaaaaaa' });
    anterior.conectar();
    await anterior.instalar();
    // Falta un archivo en la copia (se perdió): la reinstalación tiene que añadirlo.
    anterior.guardadas.get(anterior.nombreCopia)?.delete(anterior.urlDe('estilos/base.css'));
    const nueva = servicio(
      base,
      { archivos: ARCHIVOS, version: VERSION, paquete: 'bbbbbbbbbbbbbbbb' },
      anterior.copias,
    );
    assert.equal(nueva.nombreCopia, anterior.nombreCopia, 'la misma VERSION: el mismo nombre de copia');
    assert.notEqual(nueva.evaluar('COPIA_DEL_PAQUETE'), anterior.evaluar('COPIA_DEL_PAQUETE'));
    const reescritas: string[] = [];
    nueva.copias.despuesDeGuardar = (nombre, clave) => {
      if (nombre === nueva.nombreCopia) {
        reescritas.push(clave);
      }
    };
    nueva.conectar();
    await nueva.instalar();
    assert.deepEqual(reescritas, [nueva.urlDe('estilos/base.css')], 'solo se añade lo que faltaba');
    const copia = nueva.guardadas.get(nueva.nombreCopia);
    assert.deepEqual([...(copia?.keys() ?? [])].sort(), ARCHIVOS.map(nueva.urlDe).sort());
    for (const archivo of ARCHIVOS) {
      assert.equal(await copia?.get(nueva.urlDe(archivo))?.clone().text(), new URL(nueva.urlDe(archivo)).pathname);
    }
  });
}
