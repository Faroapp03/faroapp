// Ensayo sin navegador del límite total del presupuesto de rendimiento (presupuesto-plazo.mjs, presupuesto-medida.mjs
// y presupuesto-ejecucion.mjs), con plazos de pocos segundos: medir() con el servidor del ensayo real, con la bajada
// limitada, sirviendo una respuesta que tarda diez veces el límite, y una página simulada que no completa ningún hito. Comprueba que
// la medida termina dentro del límite más el margen de cierre aunque la página y su contexto se queden colgados, sin
// dejar ningún servidor escuchando; que conserva lo medido hasta el límite con el estado «no completada dentro del
// plazo» y lo anota antes de que venza; y que, si la medida no vale, se anotan la medida y el fallo. También, que el
// límite de la ejecución completa cubre el cierre de cada escenario y que matarArbol() termina los descendientes de un
// huérfano conocido y no deja escapar a los hijos que lanza el árbol mientras lo recorre (procesos reales sin
// navegador).
//
//   node --test pruebas/navegadores/presupuesto-plazo.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:http2';
import { after, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { CONDICIONES, identidadDe } from './presupuesto-condiciones.mjs';
import { escenarioMedido } from './presupuesto-ejecucion.mjs';
import { medir } from './presupuesto-medida.mjs';
import {
  ARRANQUE_MS,
  CIERRE_DEL_ESCENARIO_MS,
  CIERRE_DEL_NAVEGADOR_MS,
  crearPlazoTotal,
  descendientesConOrden,
  ESTADO,
  limiteDeEjecucion,
  matarArbol,
  PREPARACION_MS,
} from './presupuesto-plazo.mjs';
import { construccionPrivadaSintetica } from './presupuesto-privado-sintetico.mjs';
import { ahora } from './presupuesto-servidor.mjs';

/** Los plazos de la simulación: límite total, lo que las esperas terminan antes y el margen de cierre. */
const LIMITE_MS = 1500;
const ANTICIPACION_MS = 300;
const MARGEN_MS = 500;
/** Lo que se admite de retraso de los temporizadores y del cierre de los servidores sobre límite + margen. */
const HOLGURA_MS = 400;
/** Un cuerpo que no se comprime y que, a 100 kB/s, tarda unos 10 s: sigue en curso al vencer el límite. */
const BYTES_DEL_CUERPO = 1_000_000;
const CUERPO = randomBytes(BYTES_DEL_CUERPO);
const BAJADA_BPS = 800_000;
const BITS_POR_BYTE = 8;
/** Cuándo, desde la navegación, la página simulada da su service worker por activado. */
const ACTIVADO_MS = 100;
/** Los avisos de progreso del paquete que la página simulada dice haber recibido. */
const AVISOS_DE_PROGRESO = 3;
const RUTA = '/lento';
const CONDICION = {
  movil: false,
  bajada: BAJADA_BPS,
  latenciaMs: 0,
  cpu: null,
  plazoMs: 60_000,
  nombre: 'simulada',
  bytesPorSegundo: BAJADA_BPS / BITS_POR_BYTE,
};
const PRIVADA = await construccionPrivadaSintetica();
after(PRIVADA.retirar);
const ESCENARIO = {
  nombre: 'simulado',
  ruta: RUTA,
  serviceWorker: true,
  interfaz: (pagina, plazo) => pagina.waitForFunction(() => false, undefined, { timeout: plazo }),
};
const plazoCorto = () => crearPlazoTotal(LIMITE_MS, { anticipacionMs: ANTICIPACION_MS, margenDeCierreMs: MARGEN_MS });

/** El servidor de arriba: responde 200 con el cuerpo entero; lo lento es la bajada del servidor del ensayo. */
async function arribaLento() {
  const servidor = createServer((_req, res) => {
    res.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'application/octet-stream' });
    res.end(CUERPO);
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    origen: `http://127.0.0.1:${servidor.address().port}`,
    peticiones: [],
    errores: [],
    escuchando: () => servidor.listening,
    cerrar: () => {
      servidor.closeAllConnections();
      return new Promise((ok) => servidor.close(() => ok()));
    },
  };
}

/** Lo esperado de una espera de Playwright: rechaza con TimeoutError al cumplirse su plazo. */
const agotar = (ms) =>
  new Promise((_ok, mal) => setTimeout(() => mal(new Error(`TimeoutError: ${ms}ms exceeded.`)), ms));
const colgada = () => new Promise(() => undefined);

/**
 * Un contexto simulado con una página que navega de verdad por el servidor del ensayo (HTTP/2, con la identidad de la
 * condición) y no completa ningún hito: sus esperas se agotan en su plazo. Con `colgar`, la lectura de las marcas y el
 * cierre del contexto no terminan nunca, como una página bloqueada.
 */
function contextoSimulado({ colgar }) {
  const clientes = new Set();
  let t0 = 0;
  const pagina = {
    goto(url, { timeout }) {
      t0 = ahora();
      const destino = new URL(url);
      const cliente = connect(destino.origin, { rejectUnauthorized: false });
      cliente.on('error', () => undefined);
      clientes.add(cliente);
      const peticion = cliente.request({
        ':path': destino.pathname,
        'user-agent': identidadDe(CONDICION)['User-Agent'],
      });
      peticion.on('error', () => undefined);
      peticion.on('data', () => undefined);
      const respuesta = new Promise((ok) =>
        peticion.once('response', (cabeceras) => ok({ status: () => cabeceras[':status'] })),
      );
      const limite = agotar(timeout);
      limite.catch(() => undefined);
      return Promise.race([respuesta, limite]);
    },
    waitForFunction: (_fn, _arg, { timeout }) => agotar(timeout),
    waitForTimeout: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    evaluate: () =>
      colgar
        ? colgada()
        : Promise.resolve({ activado: t0 + ACTIVADO_MS, paquete: null, progresos: AVISOS_DE_PROGRESO }),
  };
  const contexto = {
    newPage: async () => pagina,
    close: () => {
      if (colgar) {
        return colgada();
      }
      for (const cliente of clientes) {
        cliente.destroy();
      }
      return Promise.resolve();
    },
    soltar: () => {
      for (const cliente of clientes) {
        cliente.destroy();
      }
    },
  };
  return contexto;
}

const servidoresEscuchando = () => process.getActiveResourcesInfo().filter((r) => r === 'TCPServerWrap').length;

test('con la página y su contexto colgados, la medida termina dentro del límite más el margen de cierre', async () => {
  const antes = servidoresEscuchando();
  const contexto = contextoSimulado({ colgar: true });
  let arriba;
  let conPeticiones = false;
  const anotadas = [];
  const plazoTotal = plazoCorto();
  try {
    const medida = await medir(
      {
        sesion: null,
        motor: 'simulado',
        escenario: ESCENARIO,
        condicion: CONDICION,
        plazoTotal,
        arriba: async () => {
          arriba = await arribaLento();
          return arriba;
        },
        alAvanzar: (parcial) => {
          conPeticiones ||= Boolean(parcial.peticiones?.length);
          anotadas.push({ en: ahora(), parcial });
        },
      },
      { contextoDelEnsayo: async () => contexto },
    );
    const duracion = ahora() - plazoTotal.inicio;
    assert.ok(duracion <= LIMITE_MS + MARGEN_MS + HOLGURA_MS, `Termina en ${Math.round(duracion)} ms`);
    assert.ok(duracion >= LIMITE_MS, 'No termina antes del límite: la página seguía sin responder');
    assert.equal(medida.estado, ESTADO.fueraDePlazo);
    assert.deepEqual(medida.cierre.sinCerrar, ['contexto'], 'Solo queda sin cerrar el contexto colgado, y se dice');
    assert.equal(arriba.escuchando(), false, 'El servidor de arriba está cerrado');
    assert.equal(servidoresEscuchando(), antes, 'Ningún servidor del ensayo sigue escuchando');
    assert.equal(medida.plazo.limiteTotalMs, LIMITE_MS);
    assert.equal(medida.plazo.margenDeCierreDelEscenarioMs, MARGEN_MS);
    assert.equal(medida.servidor.get.peticiones, 1, 'Conserva la petición de la navegación');
    assert.equal(medida.hitos.interfaz.alcanzado, false);
    const alVencer = anotadas.at(-1);
    assert.equal(alVencer.parcial.estado, ESTADO.fueraDePlazo, 'Al vencer, lo medido se anota con su estado');
    assert.ok(alVencer.en <= plazoTotal.fin + HOLGURA_MS, 'y se anota en el límite, antes de cerrar');
    assert.ok(conPeticiones, 'Mientras se mide, lo anotado ya trae las peticiones');
  } finally {
    contexto.soltar();
    await arriba?.cerrar();
  }
});

test('lo que no se completa dentro del límite consta como no completado, con los hitos y cifras de hasta entonces', async () => {
  const contexto = contextoSimulado({ colgar: false });
  let arriba;
  const anotadas = [];
  const plazoTotal = plazoCorto();
  const medida = await medir(
    {
      sesion: null,
      motor: 'simulado',
      escenario: ESCENARIO,
      condicion: CONDICION,
      plazoTotal,
      arriba: async () => {
        arriba = await arribaLento();
        return arriba;
      },
      alAvanzar: (parcial) => anotadas.push(parcial),
    },
    { contextoDelEnsayo: async () => contexto },
  );
  assert.ok(ahora() < plazoTotal.fin + MARGEN_MS, 'Termina sin agotar el margen de cierre');
  assert.equal(medida.estado, ESTADO.fueraDePlazo, 'El estado lo dice, legible por máquina');
  assert.deepEqual(medida.cierre.sinCerrar, []);
  assert.equal(medida.hitos.interfaz.alcanzado, false);
  assert.match(medida.hitos.interfaz.error, /TimeoutError/u, 'La espera de la interfaz se cortó en el límite');
  assert.ok(medida.hitos.interfaz.ms < LIMITE_MS, 'y terminó antes de que venciera');
  assert.equal(medida.copia.terminada, false);
  assert.ok(Math.abs(medida.copia.webMs - ACTIVADO_MS) < 1, 'Conserva la copia web, que sí llegó');
  assert.equal(medida.hitos.copiaWeb.alcanzado, true);
  assert.equal(medida.hitos.copiaCompleta.alcanzado, false);
  assert.equal(medida.copia.avisosDeProgreso, AVISOS_DE_PROGRESO);
  assert.equal(medida.servidor.get.peticiones, 1, 'Conserva la petición de la navegación');
  assert.ok(medida.peticiones[0].servidos > 0, 'y lo servido de la respuesta que seguía en curso');
  assert.ok(medida.plazo.usadoMs < LIMITE_MS);
  assert.ok(
    anotadas.some((m) => m.estado === ESTADO.enCurso && m.estadoNavegacion === ESTADO_HTTP.correcto),
    'Lo medido se anota mientras se mide',
  );
  assert.equal(arriba.escuchando(), false);
});

test('si la medida no vale, se anotan la medida y el fallo', async () => {
  const anotadas = [];
  const medida = {
    estado: ESTADO.completa,
    estadoNavegacion: 200,
    errores: ['el servidor de arriba respondió 502'],
    servidor: { sinIdentidadEsperada: 0, get: { peticiones: 287, bytesServidos: 25_090_000 } },
    hitos: { interfaz: { alcanzado: true, ms: 900 }, analisis: null },
  };
  await assert.rejects(
    escenarioMedido(
      { sesion: null, motor: 'simulado', servible: PRIVADA, nombreCondicion: 'movil-4g-lenta' },
      ESCENARIO,
      (m) => anotadas.push(m),
      { medirCon: async () => medida, plazoTotal: plazoCorto() },
    ),
    /El servidor del ensayo y el de arriba no han fallado/u,
  );
  const ultima = anotadas.at(-1);
  assert.equal(ultima.estado, ESTADO.fallo);
  assert.equal(ultima.estadoAlMedir, ESTADO.completa);
  assert.match(ultima.fallo, /no han fallado/u);
  assert.deepEqual(ultima.servidor, medida.servidor, 'La medición se conserva');
  assert.deepEqual(ultima.hitos, medida.hitos);
});

test('si el ensayo falla a mitad, se anota lo último medido con el fallo', async () => {
  const anotadas = [];
  const parcial = {
    estado: ESTADO.enCurso,
    servidor: { get: { peticiones: 12 } },
    hitos: { interfaz: { alcanzado: true } },
  };
  await assert.rejects(
    escenarioMedido(
      { sesion: null, motor: 'simulado', servible: PRIVADA, nombreCondicion: 'movil-3g' },
      ESCENARIO,
      (m) => anotadas.push(m),
      {
        medirCon: async ({ alAvanzar }) => {
          alAvanzar(parcial);
          throw new Error('Target page, context or browser has been closed');
        },
        plazoTotal: plazoCorto(),
      },
    ),
    /has been closed/u,
  );
  const ultima = anotadas.at(-1);
  assert.equal(ultima.estado, ESTADO.fallo);
  assert.equal(ultima.estadoAlMedir, ESTADO.enCurso);
  assert.deepEqual(ultima.servidor, parcial.servidor);
});

/** Lo que da hoy limiteDeEjecucion() con un escenario por proceso (la matriz), en segundos, por condición. */
const LIMITE_DE_LA_MATRIZ_S = { escritorio: 330, 'segunda-visita': 450, 'movil-4g-lenta': 810, 'movil-3g': 2610 };
const MS_POR_S = 1000;
/** Escenarios, motores y construcciones de los casos con más de uno. */
const TRES = 3;
const DOS = 2;

test('el límite de la ejecución cubre el cierre de cada escenario y, una vez por sesión, el del navegador', () => {
  const limite = 120_000;
  const porSesion = (escenarios) =>
    ARRANQUE_MS + escenarios * (limite + CIERRE_DEL_ESCENARIO_MS) + CIERRE_DEL_NAVEGADOR_MS;
  assert.equal(
    limiteDeEjecucion({ construcciones: 1, motores: 1, limitesDeCondicion: [limite], escenarios: TRES }),
    PREPARACION_MS + porSesion(TRES),
    'Con tres escenarios, cada uno con su límite y su cierre',
  );
  assert.equal(
    limiteDeEjecucion({ construcciones: DOS, motores: TRES, limitesDeCondicion: [limite, limite], escenarios: DOS }),
    DOS * (PREPARACION_MS + TRES * DOS * porSesion(DOS)),
    'Por construcción, su preparación y, por navegador y condición, su sesión',
  );
  const segundos = Object.fromEntries(
    Object.entries(CONDICIONES).map(([nombre, { limiteTotalMs }]) => [
      nombre,
      limiteDeEjecucion({ construcciones: 1, motores: 1, limitesDeCondicion: [limiteTotalMs], escenarios: 1 }) /
        MS_POR_S,
    ]),
  );
  assert.deepEqual(segundos, LIMITE_DE_LA_MATRIZ_S, 'Con un escenario por proceso (la matriz), el mismo límite');
});

/**
 * Un proceso que lanza otro desprendido, que a su vez lanza un hijo; dice `HUERFANO <pid> NIETO <pid>` y sale: el
 * desprendido queda huérfano (cuelga de launchd) con su hijo debajo, los dos esperando sin fin.
 */
const ESPERA_SIN_FIN = 'setInterval(() => undefined, 1000);';
const DESPRENDIDO = `
const { spawn } = require('node:child_process');
const nieto = spawn(process.execPath, ['-e', ${JSON.stringify(ESPERA_SIN_FIN)}], { stdio: 'ignore' });
process.stdout.write('NIETO ' + nieto.pid + '\\n');
${ESPERA_SIN_FIN}
`;
const INTERMEDIO = `
const { spawn } = require('node:child_process');
const huerfano = spawn(process.execPath, ['-e', ${JSON.stringify(DESPRENDIDO)}], {
  detached: true,
  stdio: ['ignore', 'pipe', 'ignore'],
});
huerfano.stdout.once('data', (linea) => {
  process.stdout.write('HUERFANO ' + huerfano.pid + ' ' + linea);
  process.exit(0);
});
`;

/** Si el proceso `pid` sigue vivo. */
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Cada cuánto se vuelve a mirar una condición, y hasta cuándo. */
const SONDEO_MS = 50;
const ESPERA_MS = 2000;
/** Espera hasta `ms` a que `condicion()` se cumpla; devuelve si se cumplió. */
async function hastaQue(condicion, ms) {
  const fin = ahora() + ms;
  while (!condicion() && ahora() < fin) {
    await new Promise((ok) => setTimeout(ok, SONDEO_MS));
  }
  return condicion();
}

test('matarArbol termina un huérfano conocido y también sus descendientes', async () => {
  const raiz = spawn(process.execPath, ['-e', ESPERA_SIN_FIN], { stdio: 'ignore' });
  const intermedio = spawn(process.execPath, ['-e', INTERMEDIO], { stdio: ['ignore', 'pipe', 'ignore'] });
  let texto = '';
  intermedio.stdout.on('data', (trozo) => {
    texto += trozo;
  });
  await new Promise((ok) => intermedio.once('exit', ok));
  const [, huerfano, nieto] = (/HUERFANO (\d+) NIETO (\d+)/u.exec(texto) ?? []).map(Number);
  try {
    assert.ok(huerfano && nieto, `El intermedio dice los dos PID: ${texto}`);
    const padreDe = (pid) => descendientesConOrden(1).find(([p]) => p === pid);
    assert.ok(await hastaQue(() => padreDe(huerfano), ESPERA_MS), 'El desprendido sigue vivo tras salir el intermedio');
    const conocidos = new Map([padreDe(huerfano)]);
    // La raíz es un proceso propio y vivo sin hijos: lo único que alcanza es el huérfano conocido.
    const terminados = matarArbol(raiz.pid, conocidos);
    assert.ok(terminados.includes(huerfano), 'Termina el huérfano conocido');
    assert.ok(
      await hastaQue(() => !vivo(huerfano) && !vivo(nieto), ESPERA_MS),
      'Ni el huérfano ni su hijo siguen vivos',
    );
    assert.ok(terminados.includes(nieto), 'El hijo del huérfano consta entre los terminados');
  } finally {
    for (const pid of [nieto, huerfano].filter((p) => p && vivo(p))) {
      process.kill(pid, 'SIGKILL');
    }
    raiz.kill('SIGKILL');
  }
});

/**
 * Un proceso que no deja de lanzar hijos (`sleep`), dice el PID de cada uno y termina él mismo el más antiguo cuando
 * pasan de `VIVOS_DEL_LANZADOR`: los hijos que lance después de una toma de `ps` no constan en ella.
 */
const VIVOS_DEL_LANZADOR = 20;
const LANZADOR = `
const { spawn } = require('node:child_process');
const { writeSync } = require('node:fs');
const vivos = [];
function lanzar() {
  const hijo = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
  writeSync(1, hijo.pid + '\\n');
  vivos.push(hijo);
  if (vivos.length > ${VIVOS_DEL_LANZADOR}) {
    vivos.shift().kill('SIGKILL');
  }
  setImmediate(lanzar);
}
lanzar();
`;
/** La raíz viva del árbol: lanza el lanzador, que escribe en su misma salida, y espera sin fin. */
const RAIZ_DEL_LANZADOR = `
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(LANZADOR)}], { stdio: ['ignore', 'inherit', 'ignore'] });
${ESPERA_SIN_FIN}
`;
/** Los hijos que el lanzador ha dicho antes de llamar a matarArbol(). */
const LANZADOS_ANTES = 50;

test('matarArbol no deja escapar a los hijos que lanza un proceso del árbol mientras lo recorre', async () => {
  const raiz = spawn(process.execPath, ['-e', RAIZ_DEL_LANZADOR], { stdio: ['ignore', 'pipe', 'ignore'] });
  let texto = '';
  raiz.stdout.on('data', (trozo) => {
    texto += trozo;
  });
  const cerrada = new Promise((ok) => raiz.stdout.once('end', ok));
  const lanzados = () => texto.split('\n').filter(Boolean).map(Number);
  try {
    assert.ok(await hastaQue(() => lanzados().length >= LANZADOS_ANTES, ESPERA_MS), 'El lanzador ya lanza hijos');
    matarArbol(raiz.pid);
    // Sin la raíz ni el lanzador, la salida se cierra: ya consta cada PID que el lanzador llegó a escribir.
    raiz.kill('SIGKILL');
    await cerrada;
    assert.ok(await hastaQue(() => !lanzados().some(vivo), ESPERA_MS), 'Ningún hijo del lanzador sigue vivo');
  } finally {
    for (const pid of lanzados().filter(vivo)) {
      process.kill(pid, 'SIGKILL');
    }
    raiz.kill('SIGKILL');
  }
});
