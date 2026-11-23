/**
 * El peor caso real cabe en los topes del enlace privado del objeto durable: 20 rondas y, en la última, 50 lotes de 200
 * invitaciones, todos con el nombre más largo admitido en bytes (60 caracteres de cuatro bytes), y después «resultados»
 * y «cerrar».
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MAX_CODIGOS_POR_LOTE, MAX_LOTES, MAX_NOMBRE_LOTE, MAX_RONDAS } from '../../src/encuesta/contrato.ts';
import { MAX_RESPUESTA_ENCUESTA } from '../../src/encuesta/protocolo-durable.ts';
import { limitesMensajes } from '../../src/plataforma/acceso-publico/durable-limites.ts';
import { montarEncuesta } from './montaje.ts';

/** Un carácter visible de cuatro bytes en UTF-8 (U+1D504, una letra matemática), el más caro que admite el nombre. */
const CUATRO_BYTES = '\u{1D504}';
const BYTES_DEL_CARACTER = 4;

test('20 rondas y 50 lotes de 200 con el nombre más largo en bytes caben en los mensajes del objeto durable', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const montaje = await montarEncuesta(db);
    const nombre = CUATRO_BYTES.repeat(MAX_NOMBRE_LOTE);
    assert.equal(new TextEncoder().encode(nombre).length, MAX_NOMBRE_LOTE * BYTES_DEL_CARACTER);
    // La primera ronda ya está abierta: se cierra y se abre otra hasta tener todas las que caben.
    for (let i = 1; i < MAX_RONDAS; i += 1) {
      assert.equal((await montaje.panel('encuesta/cerrar', montaje.token)).status, ESTADO_HTTP.correcto);
      const abierta = await montaje.panel('encuesta/abrir-ronda', montaje.token, { nombre });
      assert.equal(abierta.status, ESTADO_HTTP.correcto, `ronda ${i + 1}`);
    }
    for (let i = 0; i < MAX_LOTES; i += 1) {
      const tipo = i % 2 === 0 ? 'participante' : 'profesional';
      const creado = await montaje.panel('encuesta/crear-lote', montaje.token, {
        tipo,
        cantidad: MAX_CODIGOS_POR_LOTE,
        nombre,
      });
      assert.equal(creado.status, ESTADO_HTTP.correcto, `lote ${i + 1}`);
    }
    const leidos = await montaje.panel('encuesta/resultados', montaje.token);
    assert.equal(leidos.status, ESTADO_HTTP.correcto);
    const cerrada = await montaje.panel('encuesta/cerrar', montaje.token);
    assert.equal(cerrada.status, ESTADO_HTTP.correcto);
    const { encuesta } = (await cerrada.json()) as { encuesta: { lotes: { nombre: string }[]; rondas: unknown[] } };
    assert.equal(encuesta.lotes.length, MAX_LOTES);
    assert.equal(encuesta.rondas.length, MAX_RONDAS);
    assert.ok(encuesta.lotes.every((lote) => lote.nombre === nombre));
    // Cada mensaje, en los dos sentidos, por debajo de su tope y con margen.
    const mayor = (ruta: string, lista: readonly { ruta: string; bytes: number }[]) =>
      Math.max(...lista.filter((m) => m.ruta === ruta).map((m) => m.bytes));
    const entradas = montaje.mensajes.map((m) => ({ ruta: m.ruta, bytes: new TextEncoder().encode(m.cuerpo).length }));
    for (const ruta of ['/encuesta/abrir-ronda', '/encuesta/crear-lote', '/encuesta/resultados', '/encuesta/cerrar']) {
      const topes = limitesMensajes(ruta);
      const salida = mayor(ruta, montaje.respuestas);
      const entrada = mayor(ruta, entradas);
      assert.ok(entrada < topes.entrada, `${ruta} entrada ${entrada}`);
      assert.ok(salida < topes.salida, `${ruta} salida ${salida}`);
    }
    assert.equal(limitesMensajes('/encuesta/resultados').salida, MAX_RESPUESTA_ENCUESTA);
  } finally {
    db.close();
  }
});
