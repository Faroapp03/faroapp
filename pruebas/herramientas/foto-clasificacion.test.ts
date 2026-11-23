// Foto de la clasificación de cursos del 18/11 (pruebas/fixtures/foto-clasificacion-20261118.utf8): detecta que un
// cambio de código altera lo que ve la persona. Lo que vale con cualquier catálogo está en
// foto-clasificacion-invariantes.test.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FotoClasificacion, serializarFoto } from '../../herramientas/catalogo-cursos/comparar-fotos.ts';
import {
  catalogoPublicado,
  FIXTURE,
  fotoClasificacion,
  paqueteDelSoc,
} from '../../herramientas/catalogo-cursos/foto-clasificacion.ts';
import { fotoDelPaquete } from '../ayudas/foto-del-paquete.ts';

const HERRAMIENTA = fileURLToPath(new URL('../../herramientas/catalogo-cursos/foto-clasificacion.ts', import.meta.url));

const foto = fotoDelPaquete({
  catalogo: '7bc6f1d393a90aca7dd3f46156c533e32a47a46c8f216041c3e0a5a97bc8a018',
  datos: {
    'formacion.json': '3cb696ed395bca0ea19f479dca076b3e5fa0d6af3440631e6b9935392898c231',
    'enlaces-comprobados.json': 'b9595f8aff2f169c4280f8a49257827c3ffefaa7698c25a0aa505b111bcea598',
  },
  regenerar:
    'compara antes la foto con node herramientas/catalogo-cursos/foto-clasificacion.ts --comparar pruebas/fixtures/foto-clasificacion-20261118.utf8; si cada diferencia la explica el cambio de datos, escríbela con node herramientas/catalogo-cursos/foto-clasificacion.ts',
});

function fotoDeHoy(): string {
  return serializarFoto(fotoClasificacion(catalogoPublicado(), paqueteDelSoc()));
}

foto('la foto de la clasificación coincide con la fixture del catálogo publicado', () => {
  assert.equal(readFileSync(FIXTURE, 'utf8'), fotoDeHoy());
});

foto('la orden de comparación termina con error solo si la foto nueva pierde algo clasificado', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'foto-clasificacion-'));
  t.after(() => rmSync(carpeta, { force: true, recursive: true }));
  const foto = JSON.parse(readFileSync(FIXTURE, 'utf8')) as FotoClasificacion;
  const sinNivel = foto.unidades.soc.find((u) => u.datos.nivel?.estado === 'por-confirmar');
  assert.ok(sinNivel);
  const conNivel = {
    ...sinNivel,
    datos: { ...sinNivel.datos, nivel: { valor: 2, origen: 'prueba', estado: 'fuente' } },
  };
  const anterior = {
    ...foto,
    unidades: { ...foto.unidades, soc: foto.unidades.soc.map((u) => (u === sinNivel ? conNivel : u)) },
  };
  const igual = join(carpeta, 'igual.json');
  const conPerdida = join(carpeta, 'con-perdida.json');
  writeFileSync(igual, JSON.stringify(foto));
  writeFileSync(conPerdida, JSON.stringify(anterior));
  const sinCambios = spawnSync(process.execPath, [HERRAMIENTA, '--comparar', igual], { encoding: 'utf8' });
  assert.equal(sinCambios.status, 0, sinCambios.stderr);
  assert.deepEqual(JSON.parse(sinCambios.stdout), { perdidas: [], cambios: [], ganancias: [] });
  const perdida = spawnSync(process.execPath, [HERRAMIENTA, '--comparar', conPerdida], { encoding: 'utf8' });
  assert.equal(perdida.status, 1, perdida.stderr);
  assert.deepEqual(
    JSON.parse(perdida.stdout).perdidas.map((d: { clave: string; dato: string }) => [d.clave, d.dato]),
    [[sinNivel.clave, 'nivel']],
  );
});
