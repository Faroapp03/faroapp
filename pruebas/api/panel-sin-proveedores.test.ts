/** El panel no gestiona proveedores y conserva sus autoridades y controles de acceso. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AlmacenAdministradores } from '../../src/administracion/administradores.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import type { AlmacenSesionPanel } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../../src/administracion/sesion-unica.ts';
import { crearClientePanel } from '../../web/administracion/cliente.js';

const NO_ENCONTRADO = 404;

test('las seis rutas de selección y gestión de proveedores no existen aunque se inyecten capacidades', async () => {
  const router = crearRouterAdministrativo({
    origen: 'https://panel.example',
    almacen: {} as AlmacenSesionPanel & AlmacenSesionUnica & AlmacenAdministradores,
    guardiaAdministrativa: async () => assert.fail('Una ruta inexistente no debe acceder a la autoridad'),
    ...{
      conexionesIa: {
        leer: async () => assert.fail('No leer proveedor'),
        seleccionar: async () => assert.fail('No seleccionar proveedor'),
      },
    },
  });
  for (const operacion of ['leer', 'seleccionar', 'gestion', 'registrar', 'rotar', 'recibo']) {
    const respuesta = await router(
      new Request(`https://panel.example/administracion/api/ia/conexiones/${operacion}`, {
        method: 'POST',
        headers: { origin: 'https://panel.example', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    assert.equal(respuesta.status, NO_ENCONTRADO, operacion);
  }
});

test('el cliente del panel no ofrece selección, registro ni rotación de proveedores', () => {
  const cliente = crearClientePanel({ pedir: async () => assert.fail('No se permite red'), alCambiar: () => {} });
  for (const metodo of [
    'consultarConexiones',
    'seleccionarConexion',
    'consultarGestionIa',
    'registrarConexionIa',
    'rotarConexionIa',
    'consultarReciboIa',
    'resolverIncertidumbreIa',
  ]) {
    assert.equal(Object.hasOwn(cliente, metodo), false, metodo);
  }
  assert.equal(typeof cliente.consultarDatos, 'function');
  assert.equal(typeof cliente.consultarTrabajo, 'function');
  assert.equal(typeof cliente.cambiarSecciones, 'function');
  cliente.destruir();
});

test('el formulario conserva datos y conectividad factual sin controles de proveedor ni de permisos generativos', () => {
  const html = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  for (const id of ['conexion-ia', 'gestion-ia', 'ia-recorrido', 'ia-api', 'ia-mcp', 'ia-a2a']) {
    assert.equal(html.includes(`id="${id}"`), false, id);
  }
  for (const id of ['consultar-datos', 'consultar-trabajo', 'mcp', 'a2a', 'api']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  // Abrir y cerrar el panel a mano se retiraron con la sesión única.
  for (const id of ['abrir', 'cerrar']) {
    assert.equal(html.includes(`id="${id}"`), false, id);
  }
});
