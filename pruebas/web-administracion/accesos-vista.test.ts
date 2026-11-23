import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaginaAccesos } from '../../src/administracion/accesos.ts';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';

const INICIO = 1_000_000,
  INACTIVIDAD = 900_000,
  ABSOLUTA = 28_800_000,
  POR_PAGINA = 50,
  TOTAL = 51;
function pagina(numero = 1): PaginaAccesos {
  return {
    version: 1,
    pagina: numero,
    total: TOTAL,
    porPagina: POR_PAGINA,
    api: [],
    mcp:
      numero === 1
        ? Array.from({ length: POR_PAGINA }, (_, i) => ({
            dia: '2026-10-23',
            herramienta: 'ficha_grupo',
            clienteDeclarado: `cliente-${i}`,
            categoriaCliente: 'declarado' as const,
            consultas: 2,
          }))
        : [],
    a2a: numero === 1 ? [] : [{ dia: '2026-10-22', habilidad: 'ficha_grupo', consultas: 2 }],
  };
}
function activa(
  accesos: PaginaAccesos | null = null,
  cambios: Partial<Extract<EstadoClientePanel, { estado: 'activa' }>> = {},
): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    accesos,
    controles: { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    ...cambios,
  };
}

test('Accesos no se consulta por sondeo; cada gesto pide una página global y el idioma conserva sus cifras', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  p.publicar(activa());
  assert.match(p.campo('accesos-resumen').textContent, /Consulta los accesos/);
  assert.equal(p.campo('accesos-lista').textContent, '');
  p.tick();
  assert.equal(p.llamadas.includes('accesos'), false);
  p.campo('consultar-accesos').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ pagina: 1 }]);
  const primera = pagina();
  const antes = JSON.stringify(primera);
  p.publicar(activa(primera));
  assert.equal(p.campo('accesos-anterior').disabled, true);
  assert.equal(p.campo('accesos-siguiente').disabled, false);
  assert.match(p.campo('accesos-resumen').textContent, /página: 50.*total: 51/);
  p.campo('accesos-siguiente').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ pagina: 1 }, { pagina: 2 }]);
  p.publicar(activa(pagina(2)));
  assert.equal(p.campo('accesos-siguiente').disabled, true);
  assert.equal(p.campo('accesos-anterior').disabled, false);
  assert.match(p.campo('accesos-lista').textContent, /Sin registros de este canal en esta página/);
  p.cambiarIdioma('ca');
  assert.match(p.campo('accesos-resumen').textContent, /Pàgina 2.*pàgina: 1.*total: 51/);
  assert.match(p.campo('accesos-lista').textContent, /Sense registres d’aquest canal en aquesta pàgina/);
  assert.equal(JSON.stringify(primera), antes);
});

test('fallo, ocupación y expulsión retiran o bloquean accesos sin inventar cero registros', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(pagina(), { ocupado: true }));
  p.campo('accesos-siguiente').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, []);
  p.publicar(activa(null, { avisoAccesos: 'accesos_no_disponibles' }));
  assert.equal(p.campo('accesos-lista').textContent, '');
  assert.match(p.campo('accesos-estado').textContent, /No se puede deducir que el registro esté vacío/);
  assert.equal(p.campo('controles').hidden, false);
  assert.equal(p.campo('consultar-accesos').disabled, false);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('accesos').hidden, true);
  assert.equal(p.campo('accesos-lista').textContent, '');
  p.campo('consultar-accesos').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.includes('accesos'), false);
});

test('categorías MCP sin nombre se traducen sin inventar identidad; los nombres de API se insertan como texto', async (t) => {
  const p = await prepararPanel(t);
  const id = 'inst-11111111-1111-4111-8111-111111111111';
  const datos: PaginaAccesos = {
    version: 1,
    pagina: 1,
    total: 4,
    porPagina: POR_PAGINA,
    api: [
      {
        fecha: '2026-10-23T17:00:00.000Z',
        institucionId: id,
        institucion: '<img src=x onerror=alert(1)>',
        consulta: 'ficha_grupo',
        estadoHttp: 200,
      },
    ],
    mcp: (['no_declarado', 'omitido', 'otros'] as const).map((categoriaCliente) => ({
      dia: '2026-10-23',
      herramienta: 'ficha_grupo',
      clienteDeclarado: null,
      categoriaCliente,
      consultas: 2,
    })),
    a2a: [],
  };
  p.publicar(activa(datos));
  const lista = p.campo('accesos-lista');
  assert.match(lista.textContent, /Nombre no declarado/);
  assert.match(lista.textContent, /Nombre no conservado/);
  assert.match(lista.textContent, /Otros clientes agrupados/);
  assert.match(lista.textContent, /<img src=x/);
  assert.match(lista.textContent, /Consultar tareas y exposición a la IA \(ficha_grupo\)/u);
  assert.match(lista.textContent, /Atendida \(200\)/u);
  assert.equal(lista.querySelector('img'), null);
  const instante = lista.querySelector('time');
  assert.ok(instante);
  assert.equal(Reflect.get(instante, 'title'), '2026-10-23T17:00:00.000Z');
});
