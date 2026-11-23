// Lo que no lleva la huella de su contenido en el nombre no se guarda en caché sin volver a preguntar. Si una foto,
// un estilo, el service worker o un guion sin huella se publicara con max-age > 0 o immutable, el navegador lo podría
// servir de su caché sin pasar por el service worker (WebKit lo hace con las imágenes) y, tras un cambio de versión,
// mostrar los bytes de la anterior. Se recorre todo lo que se publica (la web construida vigente, con las exclusiones
// de su .assetsignore, también motor/, paquete/ y firmas/) con las cabeceras que le ponen el Worker (conCabecerasWeb,
// sobre la respuesta del alojamiento) y el servidor Node (src/plataforma/node/servidor.ts). Con FARO_ARTEFACTO=<dist>,
// la de esa construcción (artefacto.json). Un nombre solo queda eximido si su huella se comprueba o si el patrón dice
// por qué la lleva.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { leer, listar } from '../../herramientas/web/publicados.ts';
import { ARCHIVO_EXCLUSIONES_WEB, exclusionesDeArchivos } from '../../src/comun/exclusiones-de-archivos.ts';
import { cabecerasParaRuta, conCabecerasWeb } from '../../src/plataforma/cabeceras-web.ts';
import { ACTIVOS_PUBLICOS, rutaDeActivo } from '../../src/plataforma/cloudflare/activos-publicos.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

/** La caché por defecto de los archivos estáticos de Cloudflare: revalidar siempre. */
const DEL_ALOJAMIENTO = 'public, max-age=0, must-revalidate';
/** La del servidor Node antes de las cabeceras de la ruta (CACHE_DE_LA_WEB). */
const DEL_SERVIDOR_NODE = 'no-cache';
const CIFRAS_EN_EL_NOMBRE = 16;

/** Lo que se publica: una carpeta web y cómo leer cada archivo. */
interface Publicado {
  readonly rutas: readonly string[];
  bytes(ruta: string): Buffer;
}

function publicado(): Publicado {
  const artefacto = process.env.FARO_ARTEFACTO;
  if (artefacto) {
    const descriptor = JSON.parse(readFileSync(join(artefacto, 'artefacto.json'), 'utf8')) as {
      archivos: { ruta: string }[];
    };
    const rutas = descriptor.archivos.filter((a) => a.ruta.startsWith('web/')).map((a) => a.ruta.slice('web/'.length));
    return { rutas, bytes: (ruta) => readFileSync(join(artefacto, 'web', ruta)) };
  }
  const web = webConstruida();
  const patrones = exclusionesDeArchivos(leer(ARCHIVO_EXCLUSIONES_WEB, web));
  const rutas = listar('', web).filter((ruta) => !patrones.some((patron) => patron.test(ruta)));
  return { rutas, bytes: (ruta) => readFileSync(join(web, ruta)) };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Los nombres con huella de la construcción real. Cada patrón dice por qué su nombre cambia con su contenido y, si se
 * puede, `comprobar` lo verifica con los bytes: un patrón que exima algo sin huella real hace fallar la prueba.
 */
const CON_HUELLA: readonly {
  readonly patron: RegExp;
  readonly comprobar: (ruta: string, token: string, p: Publicado) => boolean;
}[] = [
  {
    // Las entradas de página de cada zona (empaquetado/construccion.ts): las 16 primeras cifras del SHA-256 de sus
    // bytes.
    patron: /^(?:(?:demo|administracion)\/)?(?:js|panel-js)\/paginas?-[a-z0-9-]+-([0-9a-f]{16})\.js$/u,
    comprobar: (ruta, token, p) => sha256(p.bytes(ruta)).slice(0, CIFRAS_EN_EL_NOMBRE) === token,
  },
  {
    // La barrera (.assetsignore: se publica como scripts/barrera-<sha256>.js): el SHA-256 entero de sus bytes.
    patron: /^scripts\/barrera-([0-9a-f]{64})\.js$/u,
    comprobar: (ruta, token, p) => sha256(p.bytes(ruta)) === token,
  },
  {
    // Los catálogos publicados por su contenido: el SHA-256 entero de sus bytes.
    patron: /^datos\/catalogo-[a-z]+\/([0-9a-f]{64})\.json$/u,
    comprobar: (ruta, token, p) => sha256(p.bytes(ruta)) === token,
  },
  {
    // El paquete de datos: la carpeta es la versión, las 16 primeras cifras del SHA-256 de su manifiesto, que fija la
    // huella de cada archivo de la carpeta.
    patron: /^paquete\/([0-9a-f]{16})\/[a-z0-9-]+\.json$/u,
    comprobar: (ruta, token, p) => {
      const manifiesto = p.bytes(`paquete/${token}/manifiesto.json`);
      if (sha256(manifiesto).slice(0, CIFRAS_EN_EL_NOMBRE) !== token) {
        return false;
      }
      const archivo = ruta.slice(`paquete/${token}/`.length);
      if (archivo === 'manifiesto.json') {
        return true;
      }
      const fijadas = JSON.parse(manifiesto.toString('utf8')) as Record<string, { sha256?: string }>;
      return fijadas[archivo]?.sha256 === sha256(p.bytes(ruta));
    },
  },
  {
    // Los trozos de esbuild (chunkNames `[name]-[hash]` en empaquetado/construccion.ts): el [hash] de 8 letras sale
    // de los bytes del trozo, pero no es un SHA-256 que se pueda rehacer aquí; solo en las carpetas de los trozos.
    patron: /^(?:(?:demo|administracion)\/)?(?:js|panel-js|motor\/trozos)\/[a-z0-9-]+-([A-Z2-7]{8})\.js$/u,
    comprobar: () => true,
  },
];

/** Rutas que no llevan huella y tienen que quedar dentro: si un patrón las exime, es demasiado amplio. */
const SIN_HUELLA_SEGURO = [
  'service-worker.js',
  'inicio.html',
  'estilos/base.css',
  'imagenes/fotografias/faro-penmon.webp',
  'imagenes/fotografias/faro-penmon-800.webp',
  'firmas/manifiesto.json',
  'motor/src/plataforma/navegador/motor.js',
];

/** Por qué una cabecera cache-control guarda sin volver a preguntar, o '' si no lo hace. */
function guardaSinPreguntar(valor: string | null | undefined): string {
  if (!valor) {
    return '';
  }
  const directivas = valor
    .toLowerCase()
    .split(',')
    .map((d) => d.trim());
  if (directivas.includes('immutable')) {
    return 'immutable';
  }
  const maxAge = directivas.map((d) => /^(?:s-)?max-age=(\d+)$/u.exec(d)?.[1]).find((n) => n !== undefined);
  return maxAge !== undefined && Number(maxAge) > 0 ? `max-age=${maxAge}` : '';
}

function clasificar(p: Publicado): { sinHuella: string[]; eximidasSinHuellaReal: string[] } {
  const sinHuella: string[] = [];
  const eximidasSinHuellaReal: string[] = [];
  for (const ruta of p.rutas) {
    const con = CON_HUELLA.map(({ patron, comprobar }) => ({ token: patron.exec(ruta)?.[1], comprobar })).find(
      ({ token }) => token !== undefined,
    );
    if (con?.token === undefined) {
      sinHuella.push(ruta);
    } else if (!con.comprobar(ruta, con.token, p)) {
      eximidasSinHuellaReal.push(ruta);
    }
  }
  return { sinHuella, eximidasSinHuellaReal };
}

test('cada nombre eximido lleva la huella real de su contenido y nada sin huella queda fuera', () => {
  const p = publicado();
  const { sinHuella, eximidasSinHuellaReal } = clasificar(p);
  assert.deepEqual(eximidasSinHuellaReal, [], 'nombres eximidos cuya huella no es la de sus bytes');
  for (const ruta of SIN_HUELLA_SEGURO) {
    assert.ok(p.rutas.includes(ruta), `${ruta} se publica`);
    assert.ok(sinHuella.includes(ruta), `${ruta} no lleva huella y ningún patrón la puede eximir`);
  }
  for (const { patron } of CON_HUELLA) {
    assert.ok(
      p.rutas.some((ruta) => patron.test(ruta)),
      `${patron}: no exime nada de la construcción`,
    );
  }
});

test('ninguna ruta publicada sin huella en el nombre lleva max-age > 0 ni immutable', () => {
  const { sinHuella } = clasificar(publicado());
  const fallos: string[] = [];
  for (const ruta of sinHuella) {
    const publicada = `/${ruta}`;
    const alojamiento = new Response('', { headers: { 'cache-control': DEL_ALOJAMIENTO } });
    const delWorker = guardaSinPreguntar(conCabecerasWeb(alojamiento, publicada).headers.get('cache-control'));
    const delNode = guardaSinPreguntar(
      { 'cache-control': DEL_SERVIDOR_NODE, ...cabecerasParaRuta(publicada) }['cache-control'],
    );
    if (delWorker || delNode) {
      fallos.push(`${ruta}: Worker «${delWorker}», Node «${delNode}»`);
    }
  }
  assert.deepEqual(
    fallos,
    [],
    `rutas sin huella que se guardan sin volver a preguntar (${sinHuella.length} revisadas)`,
  );
});

// Los activos públicos (activos-publicos.ts) son rutas del Worker (/publico/), no archivos: su nombre lleva la huella.
test('cada activo de /publico/ lleva en el nombre la huella de su archivo', () => {
  const p = publicado();
  assert.ok(ACTIVOS_PUBLICOS.length > 0);
  for (const activo of ACTIVOS_PUBLICOS) {
    const huella = sha256(p.bytes(activo.archivo));
    assert.equal(activo.sha256, huella, `${activo.archivo}: la huella declarada es la de sus bytes`);
    const nombre = /^\/publico\/[a-z0-9-]+-([0-9a-f]{16})\.[a-z0-9]+$/u.exec(rutaDeActivo(activo));
    assert.equal(nombre?.[1], huella.slice(0, CIFRAS_EN_EL_NOMBRE), `${rutaDeActivo(activo)}: nombre con su huella`);
    assert.ok(clasificar(p).sinHuella.includes(activo.archivo), `${activo.archivo}: su ruta de archivo, sin huella`);
  }
});
