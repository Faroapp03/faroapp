// Exclusivo de instaladores: conserva destinos, TLS, opciones y funciones de retorno.
const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const { identidad } = require('../../config/identidad-web.json');

for (const transporte of [http, https]) {
  const original = transporte.request;
  /** @param {unknown[]} argumentos */
  transporte.request = function request(...argumentos) {
    const solicitud = Reflect.apply(original, this, argumentos);
    for (const [nombre, valor] of Object.entries(identidad)) {
      solicitud.setHeader(nombre, valor);
    }
    return solicitud;
  };
  /** @param {unknown[]} argumentos */
  transporte.get = function get(...argumentos) {
    const solicitud = Reflect.apply(transporte.request, this, argumentos);
    solicitud.end();
    return solicitud;
  };
}
syncBuiltinESMExports();
