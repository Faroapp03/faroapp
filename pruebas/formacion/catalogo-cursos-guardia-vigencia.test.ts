// Guardia de la regla de vigencia: ningún consumidor retira ofertas ni anula hechos por la antigüedad de la comprobación.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { PUBLICACIONES_COMUNES } from '../../herramientas/web/comunes.ts';
import { MOTIVOS_HECHO } from '../../src/catalogo-cursos/contrato.ts';
import { ofertasVigentes } from '../../src/catalogo-cursos/lectura.ts';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';

const RAIZ = new URL('../../', import.meta.url);
// Las copias publicadas no se editan a mano: en su lugar se revisa su fuente única, que es donde podría entrar un
// campo de vigencia. La correspondencia sale de la misma lista que usa el generador, así que no puede desfasarse.
const FUENTE_DE_COPIA = new Map<string, string>(
  Object.entries(PUBLICACIONES_COMUNES).map(([fuente, copia]) => [copia, fuente]),
);
// La referencia del catálogo solo contiene datos de una exportación admitida; no tiene código fuente que revisar.
const REFERENCIA_GENERADA = 'web/scripts/catalogo-cursos/referencia.js';
const CONSUMIDORES = [
  'src/catalogo-cursos',
  'src/seleccion-formacion',
  'web/scripts/catalogo-cursos',
  'web/scripts/recorrido',
  'web/administracion',
  'motores/cursos/src',
];
const COMPROBACION_VENCIDA = /comprobacion_vencida\b/u;
// Única excepción: el vigilante nombra el diagnóstico «comprobación vencida» para validarlo y mostrarlo en el panel;
// no retira ofertas ni decide su caducidad. El resto de prohibiciones también rige para estos dos archivos.
const DIAGNOSTICO_DEL_VIGILANTE = new Set([
  'src/administracion/vigilante-panel.js',
  'web/administracion/vista-vigilante.js',
]);
const PROHIBIDOS = [
  /\bvence_el\b/u,
  /\bvenceEl\b/u,
  COMPROBACION_VENCIDA,
  /hechosSiguenVigentes/u,
  /MAX_DIAS_FICHA_ABIERTA/u,
];
function archivos(ruta: string): string[] {
  const url = new URL(ruta, RAIZ);
  if (statSync(url).isFile()) {
    return [ruta];
  }
  return readdirSync(url, { recursive: true, encoding: 'utf8' })
    .map((nombre) => `${ruta}/${nombre}`)
    .filter((nombre) => /\.(?:ts|js)$/u.test(nombre) && nombre !== REFERENCIA_GENERADA)
    .map((nombre) => FUENTE_DE_COPIA.get(nombre) ?? nombre);
}

test('ningún consumidor del catálogo vuelve a usar vence_el ni un plazo propio de caducidad', () => {
  const revisados = [...new Set(CONSUMIDORES.flatMap(archivos))];
  assert.ok(revisados.includes('src/administracion/vigilante-panel.js'));
  for (const ruta of revisados) {
    const texto = readFileSync(new URL(ruta, RAIZ), 'utf8');
    for (const patron of PROHIBIDOS) {
      if (patron === COMPROBACION_VENCIDA && DIAGNOSTICO_DEL_VIGILANTE.has(ruta)) {
        continue;
      }
      assert.doesNotMatch(texto, patron, `${ruta} usa ${patron}`);
    }
  }
  assert.ok(!MOTIVOS_HECHO.some((m) => m === ('comprobacion_vencida' as string)));
});

test('el reloj no anula hechos: años después la vista conserva los mismos objetos del asset', () => {
  const { catalogo } = casoDeFormacion();
  const limpio = { ...catalogo, ofertas: catalogo.ofertas.map((o) => ({ ...o, cierra_el: null })) };
  const [oferta] = ofertasVigentes(limpio, Date.parse('2031-01-01T00:00:00Z'));
  assert.equal(oferta, limpio.ofertas[0]);
});
