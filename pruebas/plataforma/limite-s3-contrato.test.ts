import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as limite from '../../src/plataforma/cloudflare/limite-recorrido.ts';

const secreto = 'clave-sintetica-de-32-bytes-para-limite';
const ventana = 900_000;
const peticion = (ip: string) => new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': ip } });

test('la cuota agrupa representaciones IPv6 de una red /64 y separa redes', async () => {
  const identificar = Reflect.get(limite, 'identificadoresLimiteRecorrido');
  assert.equal(typeof identificar, 'function', 'Falta la cuota continua por red');
  const a = await identificar(peticion('2001:db8:12:34::1'), secreto, ventana);
  const b = await identificar(peticion('2001:0db8:0012:0034::ffff'), secreto, ventana);
  const c = await identificar(peticion('2001:db8:12:35::1'), secreto, ventana);
  const siguiente = await identificar(peticion('2001:0db8:0012:0034::ffff'), secreto, ventana * 2);
  assert.equal(a.clave, b.clave);
  assert.notEqual(a.clave, c.clave);
  // El periodo siguiente rota la huella, pero sigue contando la de este.
  assert.ok(siguiente.recientes.includes(a.clave));
  assert.doesNotMatch(JSON.stringify(a), /2001:db8/);
});

test('IPv4 y su forma IPv6 mapeada comparten cuota, y se rechazan formas ambiguas', async () => {
  const identificar = Reflect.get(limite, 'identificadoresLimiteRecorrido');
  assert.equal(typeof identificar, 'function');
  const ipv4 = await identificar(peticion('192.0.2.1'), secreto, ventana);
  for (const ip of ['::ffff:192.0.2.1', '::FFFF:c000:201']) {
    const mapeada = await identificar(peticion(ip), secreto, ventana);
    assert.equal(mapeada.clave, ipv4.clave);
  }
  for (const ip of ['192.000.2.1', '127.1', '0x7f.0.0.1', '2001:db8::1%eth0', '::ffff:192.000.2.1']) {
    await assert.rejects(identificar(peticion(ip), secreto, ventana), ip);
  }
});
