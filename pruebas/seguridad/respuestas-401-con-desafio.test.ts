import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ContextoApi } from '../../src/api/contexto-api.ts';
import { atenderConsulta } from '../../src/api/socios/consultas-de-socios.ts';
import { RUTA_CONSULTAS, RUTA_TOKEN } from '../../src/api/socios/metadatos.ts';
import { atenderToken } from '../../src/api/socios/oauth.ts';
import type { ServidorDeSocios } from '../../src/api/socios/servidor-socios.ts';
import {
  crearLectorConstruccionServida,
  RUTA_CONSTRUCCION_SERVIDA,
} from '../../src/plataforma/cloudflare/construccion-servida.ts';
import { asegurarDesafioSi401 } from '../ayudas/desafio.ts';

// RFC 9110 (15.5.2): toda respuesta 401 lleva WWW-Authenticate con un desafío que el servidor acepte. Los accesos sin
// esquema HTTP (formulario y cookie, cabecera propia del panel) responden 303 o 403.
//
// Manda la conducta: `asegurarDesafioSi401` (pruebas/ayudas/desafio.ts) mira las respuestas de cada puerta pedida sin
// identificarse. Las de mantenimiento, en las pruebas de pruebas/administracion; la entrega privada de ensayo, en
// pruebas/acceso-publico y en la construida de pruebas/cloudflare; las puertas de socios y la lectura de la
// construcción, aquí abajo.
//
// Lo textual es una red de seguridad para el código que todavía no tiene prueba de conducta: no ve un estado que
// llegue de fuera en una variable ni uno calculado (`400 + 1`). Recorre src y avisa de cualquier mención del 401 fuera
// de los archivos que lo responden con su desafío, de un desafío escrito a mano fuera de su sitio y de un 401
// construido sin la ayuda en los archivos que la usan. Cada extensión revisa lo suyo en su carpeta de pruebas.
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETAS = ['src'].map((carpeta) => join(RAIZ, carpeta));
const ORIGEN = 'https://faro.invalid';
const NO_AUTENTICADO = 401;

/** La ayuda que pone el desafío en las respuestas 401. */
const AYUDA = 'src/seguridad/desafio-http.ts';
/** Los archivos que responden 401 con el desafío de la ayuda. */
const CON_LA_AYUDA: ReadonlySet<string> = new Set([
  'src/administracion/activacion-http.ts',
  'src/administracion/inicio-actualizacion.ts',
  'src/administracion/reserva-a-demanda.ts',
  'src/administracion/resultado-actualizacion.ts',
  'src/api/socios/oauth.ts',
  'src/plataforma/cloudflare/construccion-servida.ts',
]);
/** Los archivos que construyen su propio desafío porque la ayuda no les sirve, con su esquema. */
const CON_DESAFIO_PROPIO: Readonly<Record<string, RegExp>> = {
  // Lo lleva también en el 403 y con el error del token (RFC 6750, 3).
  'src/api/socios/consultas-de-socios.ts': /'www-authenticate': desafioDe\(/,
  // Siempre responde 401 cuando lo pide.
  'src/plataforma/cloudflare/acceso-privado.ts': /'www-authenticate': 'Basic realm=/,
};
/** Los archivos que nombran el 401 sin responderlo. */
const SIN_RESPUESTA: ReadonlySet<string> = new Set([
  // La tabla de códigos con nombre.
  'src/comun/estados-http.ts',
  // Clasifica lo que responde GitHub; no construye respuestas.
  'src/administracion/ejecutor-github.ts',
  // El service worker clasifica la respuesta de la red (401 o 403: sin sesión) para redirigir al acceso; no la construye.
  'src/service-worker/modo.js',
]);
/** El 401 por su nombre, también entre corchetes, o como número en cualquier base o con separador. */
const USO_DEL_401 = /\bnoAutenticado\b|\bNO_AUTENTICADO\b|\b(?:401|4_01|0x191|0o621|0b110010001)n?\b/i;
/** Un 401 puesto directamente como estado de una respuesta. */
const ESTADO_401 =
  /\bstatus:\s*(?:ESTADO_HTTP\s*(?:\.\s*noAutenticado|\[\s*['"`]noAutenticado['"`]\s*\])|NO_AUTENTICADO|401)\b/;
/** Un estado de respuesta tomado de una variable: `status: estado`. */
const ESTADO_EN_VARIABLE = /\bstatus:\s*(?!ESTADO_HTTP\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
/** Un problema de socios cuyo estado viaja en una variable: `respuestaDeUnProblema(cuerpo, …)`. */
const PROBLEMA_EN_VARIABLE = /\brespuestaDeUnProblema\(\s*[A-Za-z_$][\w$]*\s*[,)]/;
const USO_DE_LA_AYUDA = /\bcabecerasDeDesafio\(/;

function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      return fuentes(ruta);
    }
    return /\.(?:ts|js|mjs|html)$/.test(entrada.name) ? [ruta] : [];
  });
}
/** Las líneas de código, sin las de comentario: un comentario puede explicar por qué no se usa el 401. */
function codigo(texto: string): string[] {
  return texto.split('\n').filter((linea) => !/^\s*(?:\/\/|\/\*|\*)/.test(linea));
}

/** Las fuentes recorridas, con su ruta relativa a la raíz y sus líneas de código. */
function codigoDeLasFuentes(): { ruta: string; lineas: string[] }[] {
  return CARPETAS.flatMap(fuentes).map((ruta) => ({
    ruta: relative(RAIZ, ruta).split('\\').join('/'),
    lineas: codigo(readFileSync(ruta, 'utf8')),
  }));
}

test('solo nombran el 401 los archivos que lo responden con su desafío WWW-Authenticate', () => {
  const usos = codigoDeLasFuentes().filter(({ lineas }) => lineas.some((linea) => USO_DEL_401.test(linea)));
  const permitidos = new Set([AYUDA, ...CON_LA_AYUDA, ...Object.keys(CON_DESAFIO_PROPIO), ...SIN_RESPUESTA]);
  const ajenos = usos.map(({ ruta }) => ruta).filter((ruta) => !permitidos.has(ruta));
  assert.deepEqual(ajenos, [], 'Responden 401 sin desafío; un acceso sin esquema HTTP responde 303 o 403');
  for (const ruta of [...CON_LA_AYUDA, ...Object.keys(CON_DESAFIO_PROPIO), ...SIN_RESPUESTA]) {
    assert.ok(
      usos.some((uso) => uso.ruta === ruta),
      `${ruta} no nombra el 401: retírelo de la lista`,
    );
  }
  for (const [ruta, desafio] of Object.entries(CON_DESAFIO_PROPIO)) {
    const uso = usos.find((u) => u.ruta === ruta);
    assert.ok(
      uso?.lineas.some((linea) => desafio.test(linea)),
      `${ruta} responde 401 sin su desafío`,
    );
  }
});

test('en los archivos de la ayuda, todo estado de respuesta que pueda ser 401 pasa por cabecerasDeDesafio', () => {
  const fallos = codigoDeLasFuentes()
    .filter(({ ruta }) => CON_LA_AYUDA.has(ruta))
    .flatMap(({ ruta, lineas }) => {
      const texto = lineas.join('\n');
      const directos = lineas.filter((linea) => ESTADO_401.test(linea)).map((linea) => `${ruta}: ${linea.trim()}`);
      const variables = [...texto.matchAll(ESTADO_EN_VARIABLE)]
        .map(([, variable]) => variable)
        .filter((variable) => !texto.includes(`cabecerasDeDesafio(${variable}`))
        .map((variable) => `${ruta}: status: ${variable} sin cabecerasDeDesafio(${variable})`);
      const problemas = lineas
        .filter((linea) => PROBLEMA_EN_VARIABLE.test(linea) && !USO_DE_LA_AYUDA.test(linea))
        .map((linea) => `${ruta}: ${linea.trim()}`);
      return [...directos, ...variables, ...problemas];
    });
  assert.deepEqual(fallos, [], 'Construyen un 401 posible sin el desafío de la ayuda');
});

test('el desafío solo se escribe a mano en la ayuda y donde la ayuda no sirve', () => {
  const aMano = codigoDeLasFuentes()
    .filter(({ lineas }) => lineas.some((linea) => /['"`]www-authenticate['"`]/i.test(linea)))
    .map(({ ruta }) => ruta)
    .filter((ruta) => ruta !== AYUDA && !(ruta in CON_DESAFIO_PROPIO));
  assert.deepEqual(aMano, [], 'Construyen el desafío a mano; úsese cabecerasDeDesafio');
});

test('la consulta de socios sin token pide Bearer', async () => {
  // Sin token, la consulta se rechaza antes de mirar el servidor, el contexto o el registro.
  const respuesta = await atenderConsulta(
    {} as ContextoApi,
    {} as ServidorDeSocios,
    new Request(`${ORIGEN}${RUTA_CONSULTAS}/buscar`),
    'buscar',
  );
  assert.equal(asegurarDesafioSi401(respuesta, 'Bearer').status, NO_AUTENTICADO);
});

test('la emisión de tokens de socios sin credenciales pide Basic', async () => {
  // Sin credenciales Basic el socio no se busca: el servidor solo necesita el límite por red.
  const servidor = { limites: { credencialesPorRed: () => true } } as unknown as ServidorDeSocios;
  const respuesta = await atenderToken(
    { ipDeCloudflare: false } as ContextoApi,
    servidor,
    new Request(`${ORIGEN}${RUTA_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  );
  assert.equal(asegurarDesafioSi401(respuesta, 'Basic').status, NO_AUTENTICADO);
});

test('la lectura de la construcción servida sin token pide Bearer', async () => {
  // Sin token se rechaza antes de leer la configuración de actualización o de pedir nada.
  const leer = crearLectorConstruccionServida({ pedir: async () => assert.fail('no debe pedir nada') });
  const variables = {
    FARO_ADMINISTRACION: 'si',
    FARO_ADMIN_ORIGEN: ORIGEN,
    FARO_SECRETO_FIRMA: 'secreto-sintetico-de-firma-con-mas-de-32-caracteres',
  };
  const respuesta = await leer(new Request(`${ORIGEN}${RUTA_CONSTRUCCION_SERVIDA}`), variables, {});
  assert.equal(asegurarDesafioSi401(respuesta, 'Bearer').status, NO_AUTENTICADO);
});
