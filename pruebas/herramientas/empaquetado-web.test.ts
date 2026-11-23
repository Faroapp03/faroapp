// Las guardias del paquete del navegador, en rojo y en verde, sobre raíces y metafiles sintéticos pequeños: una entrada
// por página, salida minificada y sin mapas, ningún módulo privado en el grafo salvo el contrato del dispositivo, la
// lista cerrada de importaciones calculadas y los presupuestos de lo alcanzable y del motor.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type Metafile, transformSync } from 'esbuild';
import {
  codigoDeServidor,
  comprobarGrafoEmitido,
  type PaqueteNavegador,
  sinMinificar,
} from '../../herramientas/web/empaquetado/grafo.ts';
import {
  argumentosCalculados,
  problemasDeCalculadas,
} from '../../herramientas/web/empaquetado/importaciones-calculadas.ts';
import type { ImportacionCalculada } from '../../src/plataforma/extension.ts';

const FUENTE = '// Suma dos números.\nexport function sumar(primero, segundo) {\n  return primero + segundo;\n}\n';
const MINIFICADO = transformSync(FUENTE, { minify: true, format: 'esm', loader: 'js' }).code;
const bytes = (texto: string) => new TextEncoder().encode(texto);
const PAGINA = (n: number) => `<html>${'<script type="module" src="js/a.js"></script>'.repeat(n)}</html>`;

/** Una web sintética con sus archivos y el paquete que la sustituye. */
function web(
  archivos: Record<string, string>,
  paquete: Record<string, string>,
  motor: Record<string, string> = { 'motor/m.js': MINIFICADO },
) {
  const raiz = mkdtempSync(join(tmpdir(), 'empaquetado-web-'));
  try {
    writeFileSync(join(raiz, '.assetsignore'), '');
    for (const [ruta, contenido] of Object.entries({ ...archivos, ...paquete })) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    const mapa = (registro: Record<string, string>) => new Map(Object.entries(registro).map(([r, c]) => [r, bytes(c)]));
    const resumen = { paginas: {}, privados: [], servidorPorRuta: [] } as unknown as PaqueteNavegador['resumen'];
    return comprobarGrafoEmitido(raiz, { archivos: mapa(paquete), motor: mapa(motor), resumen });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}
const verde = () => web({ 'inicio.html': PAGINA(1) }, { 'js/a.js': MINIFICADO });

test('el grafo correcto no tiene incumplimientos', () => {
  assert.deepEqual(verde(), []);
});

test('una página con dos módulos de entrada sale en rojo', () => {
  assert.deepEqual(web({ 'inicio.html': PAGINA(2) }, { 'js/a.js': MINIFICADO }), ['inicio.html: 2 módulos de entrada']);
});

test('el JavaScript sin minificar sale en rojo y el minificado en verde', () => {
  assert.equal(sinMinificar(bytes(FUENTE)), true);
  assert.equal(sinMinificar(bytes(MINIFICADO)), false);
  assert.deepEqual(web({ 'inicio.html': PAGINA(1) }, { 'js/a.js': FUENTE }), ['js/a.js: JavaScript sin minificar']);
});

test('una referencia a un mapa de código sale en rojo, también en el motor', () => {
  const conMapa = `${MINIFICADO}//# sourceMappingURL=a.js.map\n`;
  assert.deepEqual(web({ 'inicio.html': PAGINA(1) }, { 'js/a.js': conMapa }), [
    'js/a.js: referencia a un mapa de código',
    // El comentario del mapa también es algo que la minificación habría quitado.
    'js/a.js: JavaScript sin minificar',
  ]);
  assert.deepEqual(web({ 'inicio.html': PAGINA(1) }, { 'js/a.js': MINIFICADO }, { 'motor/m.js': conMapa }), [
    'motor/m.js: referencia a un mapa de código',
  ]);
});

test('el JavaScript publicado al que no llega nada y el paquete sin motor salen en rojo', () => {
  assert.deepEqual(web({ 'inicio.html': PAGINA(1), 'scripts/suelto.js': MINIFICADO }, { 'js/a.js': MINIFICADO }), [
    'scripts/suelto.js: JavaScript publicado al que no llega ninguna página',
  ]);
  assert.deepEqual(web({ 'inicio.html': PAGINA(1) }, { 'js/a.js': MINIFICADO }, {}), ['El paquete no tiene motor']);
});

test('los módulos privados por su ruta salen en rojo; el contrato del dispositivo no es servidor', () => {
  const entradas = [
    'src/api/socios/alta.ts',
    'src/api/a2a/agente.ts',
    'src/administracion/panel.ts',
    'src/api/controles-administrativos.ts',
    'src/api/rutas/ocupaciones.ts',
    'src/api/otra.ts',
    'src/plataforma/navegador/motor.ts',
  ];
  const aportados = (bytesInOutput: number) =>
    Object.fromEntries(entradas.map((entrada) => [entrada, { bytesInOutput }]));
  const metafile = (bytesInOutput: number) =>
    ({ inputs: {}, outputs: { 'motor/m.js': { inputs: aportados(bytesInOutput) } } }) as unknown as Metafile;
  const { servidor, privados, contrato } = codigoDeServidor(metafile(1));
  assert.deepEqual(privados, [
    'src/administracion/panel.ts',
    'src/api/a2a/agente.ts',
    'src/api/controles-administrativos.ts',
    'src/api/socios/alta.ts',
  ]);
  assert.deepEqual(contrato, ['src/api/rutas/ocupaciones.ts']);
  assert.ok(servidor.includes('src/api/otra.ts') && !servidor.includes('src/api/rutas/ocupaciones.ts'));
  assert.deepEqual(codigoDeServidor(metafile(0)), { servidor: [], privados: [], contrato: [] });
});

test('la lista cerrada de importaciones calculadas: no declarada, desaparecida o sin archivo salen en rojo', () => {
  const codigo = `import('./fijo.js'); const RUTA = './x.js'; import(RUTA); import(\`./\${RUTA}\`);`;
  assert.deepEqual(argumentosCalculados(codigo), ['RUTA', `\`./\${RUTA}\``]);
  const lista: ImportacionCalculada[] = [
    { archivo: 'a.js', argumento: 'RUTA', tratamiento: 'motor', objetivo: 'motor/x.js', motivo: 'Prueba.' },
  ];
  const existe = (archivo: string) => archivo === 'a.js';
  assert.deepEqual(problemasDeCalculadas([{ archivo: 'a.js', argumento: 'RUTA' }], existe, lista), []);
  assert.deepEqual(problemasDeCalculadas([{ archivo: 'a.js', argumento: 'OTRA' }], existe, lista), [
    'a.js: importación calculada no declarada: import(OTRA)',
    'a.js: la importación calculada import(RUTA) ya no existe',
  ]);
  assert.deepEqual(
    problemasDeCalculadas([], () => false, lista),
    ['a.js: declara import(RUTA), pero el archivo ya no existe'],
  );
});
