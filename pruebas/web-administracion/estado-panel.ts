/** Estado del cliente del panel en las pruebas: falla si la sesión no está activa y devuelve el estado ya acotado. */
import assert from 'node:assert/strict';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';

export function activa(estado: EstadoClientePanel) {
  assert.ok(estado.estado === 'activa');
  return estado;
}
