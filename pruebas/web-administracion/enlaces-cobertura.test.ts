/** De punta a punta: un día de la comprobación de enlaces con el lector, el seguimiento, el registro y el estado reales
 * de Python → lector del panel → salud → texto es/ca. Un día normal sale sano; uno en que la comprobación falla, no. */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { CONSULTA_SALUD, instantaneaSalud } from '../ayudas/salud-datos.ts';
import { instalar } from '../web-informe-lectura/dom-doble.ts';
import { de, leer, pintado } from './avisos-datos-ayudas.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const PLAZO_MS = 60_000;
const MAX_SALIDA = 4_194_304;
const IDIOMAS = ['es', 'ca'] as const;
type Escenario =
  | 'tope'
  | 'dominio'
  | 'plazo'
  | 'sin-validar'
  | 'sin-respuesta'
  | 'sin-fecha'
  | 'plazo-sin-duracion'
  | 'todo-503'
  | 'todo-429'
  | 'plazo-con-un-503';
type Salida = { registro: string; instantanea: Record<string, unknown> };

function dia(t: import('node:test').TestContext, escenario: Escenario): Salida {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'Enlaces de un día Año-'));
  t.after(() => rmSync(raiz, { recursive: true }));
  const bytes = execFileSync(
    join(RAIZ, '.venv/bin/python'),
    ['-B', '-m', 'plataforma_datos.orquestacion.pruebas.dia_de_enlaces', raiz, escenario],
    { cwd: RAIZ, timeout: PLAZO_MS, maxBuffer: MAX_SALIDA },
  );
  return JSON.parse(bytes.toString('utf8'));
}
/** El texto de una cifra de la línea de enlaces, con su concordancia en singular o plural. */
const cifras = (idioma: 'es' | 'ca', parte: string, n: number) =>
  de(idioma, `panel.datos.enlaces.${parte}.${n === 1 ? 'uno' : 'otros'}`).replace('{v0}', String(n));
const salud = (salida: Salida) =>
  resumirSaludDatos(leerEstadoDatosPanel(salida.instantanea)).operativas.find((f) => f.id === 'enlaces');

for (const [escenario, motivo] of [
  ['tope', 'tope-de-consultas'],
  ['dominio', 'dominio-con-limite'],
  ['plazo', 'plazo-de-la-descarga'],
] as const) {
  test(`un día de enlaces con «${motivo}» sale sano, con sus cifras y su motivo informativo`, (t) => {
    instalar(t);
    t.after(() => activarIdiomaPanel());
    const salida = dia(t, escenario);
    assert.equal(salida.registro, 'comprobada');
    const fila = salud(salida);
    // Como las demás fuentes de alcance acotado, conserva su marca de revisión: sale neutra, nunca en incidencia.
    assert.equal(fila?.estado, 'revision');
    assert.equal(fila?.resultadoConsulta, 'comprobada');
    assert.equal(fila?.atencionPorAviso, false);
    assert.deepEqual(fila?.salidaParcial?.motivos, [motivo]);
    assert.ok((fila?.enlaces?.sinComprobar ?? 0) > 0);
    const datos = leerEstadoDatosPanel(salida.instantanea);
    for (const idioma of IDIOMAS) {
      const texto = pintado(datos, idioma);
      assert.ok(texto.includes(de(idioma, `panel.datos.salida-parcial.motivo.${motivo}`)), `${idioma}: motivo`);
      for (const [parte, cifra] of [
        ['comprobados', fila?.enlaces?.comprobados],
        ['sin-comprobar', fila?.enlaces?.sinComprobar],
      ] as const) {
        assert.ok(texto.includes(cifras(idioma, parte, cifra ?? 0)), `${idioma}: ${parte}`);
      }
    }
  });
}

for (const escenario of [
  'sin-validar',
  'sin-respuesta',
  'sin-fecha',
  'plazo-sin-duracion',
  'todo-503',
  'todo-429',
  'plazo-con-un-503',
] as const) {
  test(`un día de enlaces «${escenario}» sigue siendo una incidencia`, (t) => {
    const salida = dia(t, escenario);
    assert.equal(salida.registro, 'parcial');
    const fila = salud(salida);
    assert.equal(fila?.estado, 'incidencia');
    assert.equal(fila?.resultadoConsulta, 'parcial');
  });
}

test('«Necesita atención» por un aviso lo dice con su texto y por la operación local conserva el suyo', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const base = instantaneaSalud();
  const aviso = { motivos: ['portlet-no-encontrado'], descartadas: 0, aRevisar: 0 };
  const ultimoIntento = base.seguimientoRemoto?.[0]?.ultimoIntento;
  const porAviso = leer({
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento, incidenciasPendientes: [], salidaParcial: aviso }],
  });
  const [fuente] = resumirSaludDatos(porAviso).operativas;
  assert.equal(fuente?.estado, 'atencion');
  assert.equal(fuente?.atencionPorAviso, true);
  assert.equal(fuente?.mensaje, 'Esta fuente necesita que una persona la revise: el aviso de abajo dice qué hacer.');
  for (const idioma of IDIOMAS) {
    const texto = pintado(porAviso, idioma);
    assert.ok(texto.includes(de(idioma, 'panel.datos.atencion-por-aviso')), idioma);
    assert.ok(!texto.includes(de(idioma, 'panel.salud.mensaje.atencion')), idioma);
  }
  const rojo = leer({
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento, incidenciasPendientes: [], salidaParcial: aviso }],
    modulos: base.modulos.map((m) =>
      m.id === 'empresas'
        ? {
            ...m,
            ultimoIntento: CONSULTA_SALUD,
            veredicto: 'rojo',
            fallos: 1,
            proximoReintento: '2026-10-23T10:00:00Z',
          }
        : m,
    ),
  });
  const [operacion] = resumirSaludDatos(rojo).operativas;
  assert.equal(operacion?.estado, 'atencion');
  assert.equal(operacion?.atencionPorAviso, false);
  for (const idioma of IDIOMAS) {
    const texto = pintado(rojo, idioma);
    assert.ok(texto.includes(de(idioma, 'panel.salud.mensaje.atencion')), idioma);
    assert.ok(!texto.includes(de(idioma, 'panel.datos.atencion-por-aviso')), idioma);
  }
});
