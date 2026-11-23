/** Simulación local del procedimiento completo; ninguna credencial ni red de instalación. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepararVigilanteRemoto,
  transporteRemoto,
} from '../../herramientas/mantenimiento/preparar-vigilante-remoto.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { DURACION_MAXIMA_SESION_PANEL_MS, INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { baseVigilante, CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const LONGITUD_TOKEN = 43;
const ORIGEN = 'https://panel.prueba';
const politicas = principalDePrueba(ORIGEN, 'operador-sintetico');
function solicitud(ruta: string, token: string | undefined): Request {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: '{}',
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      ...(token ? { 'x-faro-sesion': token } : {}),
    },
  });
}
test('procedimiento explícito abre sesión, prepara y cierra, sin política recibida ni red', async (t) => {
  const f = await baseVigilante(t);
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen: f.almacen,
    guardiaAdministrativa: async () => politicas,
    vigilante: {
      preparar: (a) => f.almacen.prepararVigilanteDeSesion(a, CONFIG_VIGILANTE),
      comprobar: async () => {
        throw new Error('no se usa');
      },
      historial: async () => {
        throw new Error('no se usa');
      },
    },
  });
  const rutas: string[] = [];
  const pedir = async (
    ruta: 'sesion/abrir' | 'datos/vigilante/preparar' | 'sesion/cerrar',
    token: string | undefined,
  ) => {
    rutas.push(ruta);
    const respuesta = await router(solicitud(ruta, token));
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    return respuesta.json();
  };
  await prepararVigilanteRemoto(pedir);
  assert.deepEqual(rutas, ['sesion/abrir', 'datos/vigilante/preparar', 'sesion/cerrar']);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
    1,
  );
  const antes = f.db.prepare('SELECT * FROM administracion_vigilante').all();
  await prepararVigilanteRemoto(pedir);
  assert.deepEqual(f.db.prepare('SELECT * FROM administracion_vigilante').all(), antes);
});

test('la ruta de destino y cookie se validan sin crear procesos ni consultar red', () => {
  assert.throws(() => transporteRemoto('https://panel.prueba/ruta', 'a.b.c'));
  assert.throws(() => transporteRemoto(ORIGEN, 'cookie\nheader = "otro"'));
});

test('una respuesta perdida no se reintenta y se intenta cerrar la sesión', async () => {
  const ahora = Date.now();
  const sesion = {
    estado: 'activa',
    iniciadaEn: ahora,
    ultimaActividadEn: ahora,
    caducaPorInactividadEn: ahora + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: ahora + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  const rutas: string[] = [];
  await assert.rejects(
    prepararVigilanteRemoto(async (ruta) => {
      rutas.push(ruta);
      if (ruta === 'sesion/abrir') {
        return { token: 'a'.repeat(LONGITUD_TOKEN), sesion };
      }
      if (ruta === 'datos/vigilante/preparar') {
        throw new Error('respuesta perdida');
      }
      return { estado: 'cerrada' };
    }),
  );
  assert.deepEqual(rutas, ['sesion/abrir', 'datos/vigilante/preparar', 'sesion/cerrar']);
});

test('si la preparación se confirma pero falla el cierre se distingue el resultado', async () => {
  const ahora = Date.now();
  const sesion = {
    estado: 'activa',
    iniciadaEn: ahora,
    ultimaActividadEn: ahora,
    caducaPorInactividadEn: ahora + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: ahora + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  await assert.rejects(
    prepararVigilanteRemoto(async (ruta) => {
      if (ruta === 'sesion/abrir') {
        return { token: 'a'.repeat(LONGITUD_TOKEN), sesion };
      }
      if (ruta === 'datos/vigilante/preparar') {
        return { preparado: true, estado: 'activa', sesion };
      }
      throw new Error('cierre perdido');
    }),
    /Preparación confirmada; cierre de sesión no confirmado/,
  );
});

test('la herramienta ejecutable pasa la cookie por stdin de curl y no por sus argumentos', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const carpeta = mkdtempSync(join(tmpdir(), 'vigilante-operacion-'));
  const previo = process.env.PATH;
  t.after(() => {
    process.env.PATH = previo;
    rmSync(carpeta, { recursive: true, force: true });
  });
  const programa = `#!/usr/bin/env node
let texto=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => texto+=x); process.stdin.on('end', () => {
  const args=process.argv.slice(2); const url=args[args.indexOf('--url')+1];
  if (!args.includes('--no-insecure') || args.some(x=>x.includes('a.b.c')) || !texto.includes('Cookie: CF_Authorization=a.b.c') || !url.startsWith('https://panel.prueba/administracion/api/')) process.exit(3);
  const ahora=Date.now(), sesion={estado:'activa',iniciadaEn:ahora,ultimaActividadEn:ahora,caducaPorInactividadEn:ahora+900000,caducaAbsolutaEn:ahora+28800000};
  const salida=url.endsWith('/sesion/abrir') ? {token:'a'.repeat(43),sesion} : url.endsWith('/sesion/cerrar') ? {estado:'cerrada'} : {estado:'activa',preparado:true,sesion};
  process.stdout.write(JSON.stringify(salida)+'\\n200');
});`;
  writeFileSync(join(carpeta, 'curl'), programa, { mode: 0o700 });
  process.env.PATH = `${carpeta}:${previo ?? '/usr/bin:/bin'}`;
  await prepararVigilanteRemoto(transporteRemoto(ORIGEN, 'a.b.c'));
});

test('un rechazo sin causa nunca se convierte en preparación confirmada', async () => {
  const ahora = Date.now();
  const sesion = {
    estado: 'activa',
    iniciadaEn: ahora,
    ultimaActividadEn: ahora,
    caducaPorInactividadEn: ahora + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: ahora + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  await assert.rejects(
    prepararVigilanteRemoto(async (ruta) => {
      if (ruta === 'sesion/abrir') {
        return { token: 'a'.repeat(LONGITUD_TOKEN), sesion };
      }
      if (ruta === 'datos/vigilante/preparar') {
        return Promise.reject(undefined);
      }
      return { estado: 'cerrada' };
    }),
  );
});

test('un rechazo sin causa seguido de cierre fallido no confirma preparación', async () => {
  const ahora = Date.now();
  const sesion = {
    estado: 'activa',
    iniciadaEn: ahora,
    ultimaActividadEn: ahora,
    caducaPorInactividadEn: ahora + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: ahora + DURACION_MAXIMA_SESION_PANEL_MS,
  };
  await assert.rejects(
    prepararVigilanteRemoto(async (ruta) => {
      if (ruta === 'sesion/abrir') {
        return { token: 'a'.repeat(LONGITUD_TOKEN), sesion };
      }
      if (ruta === 'datos/vigilante/preparar') {
        return Promise.reject(undefined);
      }
      throw new Error('cierre perdido');
    }),
    /Resultado y cierre de sesión no confirmados/,
  );
});
