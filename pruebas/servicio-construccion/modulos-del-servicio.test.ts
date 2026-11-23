import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  construirServicio,
  declaracionesDeNivelSuperior,
  type Generado,
} from '../../herramientas/web/servicio/construir-servicio.ts';

const MODULOS = fileURLToPath(new URL('../../src/service-worker/', import.meta.url));
const PLANTILLA = `${MODULOS}generado.js`;
const HUELLA = 'e18bcb42b86ffc36dfa9f91045d5effe6dbdde8a69bb043e912ee4ecca48b8ae';
const GENERADO: Generado = {
  plantilla: PLANTILLA,
  valores: {
    VERSION: 'bbb1b6f6ed1bb7ca',
    FIRMAS: [],
    PAQUETE: 'b1a5ce9ca7a9077c',
    TAMANOS_DEL_PAQUETE: '{"esco.json":5652419}',
    CATALOGO: [
      ['inicio.html', HUELLA, 'instalar'],
      ['estilos/base.css', HUELLA, 'instalar'],
      ['imagenes/fotografias/trabajo-800.webp', HUELLA, 'adorno'],
      ['imagenes/fotografias/trabajo.webp', HUELLA, 'demanda'],
      ['cursos.html', HUELLA, 'seccion'],
      ['motor/motor.js', HUELLA, 'comprobado'],
    ],
  },
};
const construir = () => construirServicio(`${MODULOS}servicio.js`, GENERADO);
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

describe('Los módulos del service worker', () => {
  it('se construyen en un solo guion que pasa las guardias, siempre con los mismos bytes', async () => {
    const plantilla = sha256(readFileSync(PLANTILLA, 'utf8'));
    const [primera, segunda] = [await construir(), await construir()];
    assert.equal(sha256(primera), sha256(segunda));
    assert.equal(sha256(readFileSync(PLANTILLA, 'utf8')), plantilla);
  });

  it('conservan el orden de evaluación del service worker de una pieza', async () => {
    const nombres = declaracionesDeNivelSuperior(await construir(), 'script').map(({ nombre }) => nombre);
    const generados = Object.keys(GENERADO.valores);
    assert.deepEqual(nombres.slice(0, generados.length), generados);
    const orden = ['EXTENSIONES', 'ESTADOS_SIN_SESION', 'BASE', 'COPIA_SECCIONES', 'CARPETAS_CON_HUELLA'].concat(
      ['buscarEnLaCopia', 'responderEntradaDelRecorrido', 'PREFIJO_DEL_PAQUETE', 'CARPETAS_COMPROBADAS'],
      ['ACTUALIZACION_PERIODICA', 'COPIA_DEL_ESTADO', 'REPARAR_COPIA'],
    );
    const posiciones = orden.map((nombre) => nombres.indexOf(nombre));
    assert.ok(!posiciones.includes(-1), `faltan ${orden.filter((_, i) => posiciones[i] === -1)}`);
    assert.deepEqual(
      posiciones,
      [...posiciones].sort((a, b) => a - b),
    );
  });

  it('registran sus oyentes al ejecutarse como guion clásico', async () => {
    const oyentes: string[] = [];
    const self = {
      location: { href: 'https://faro.example/' },
      addEventListener: (tipo: string) => oyentes.push(tipo),
    };
    runInNewContext(await construir(), { self, URL, Map, Set, Object, Request: class {} });
    assert.deepEqual(oyentes, ['install', 'activate', 'message', 'periodicsync', 'fetch']);
  });
});
