// Comprueba la conversión prudente de tareas en castellano y catalán: solo cambia el primer verbo inequívoco.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { empiezaPorInfinitivoEnSuIdioma } from '../../src/ia/frases.ts';
import { clave, enInfinitivo, infinitivosPosibles } from '../../src/ia/infinitivo.ts';
import { NOMBRES } from '../../src/ia/verbos-de-las-tareas.ts';

test('castellano: regulares, con cambio de raíz y de ortografía, y los irregulares de la lista', () => {
  const casos: [string, string][] = [
    ['Planifico el turno de la semana', 'Planificar el turno de la semana'],
    ['Reviso los pedidos', 'Revisar los pedidos'],
    ['atiendo a los clientes', 'atender a los clientes'],
    ['Sirvo las mesas', 'Servir las mesas'],
    ['Hago los pedidos', 'Hacer los pedidos'],
    ['Corrijo exámenes', 'Corregir exámenes'],
    ['Mido las piezas', 'Medir las piezas'],
    ['Recojo la ropa', 'Recoger la ropa'],
    ['Conduzco el autobús de línea', 'Conducir el autobús de línea'],
    ['Envío los pedidos', 'Enviar los pedidos'],
    ['Distribuyo el correo', 'Distribuir el correo'],
    ['Propongo mejoras al equipo', 'Proponer mejoras al equipo'],
    ['Resuelvo incidencias', 'Resolver incidencias'],
    ['Cuido de los niños', 'Cuidar de los niños'],
    ['Doy clases de inglés', 'Dar clases de inglés'],
  ];
  for (const [copiada, esperada] of casos) {
    assert.equal(enInfinitivo(copiada), esperada, copiada);
  }
});

test('catalán: regulares, en -eixo y los irregulares de la lista', () => {
  const casos: [string, string][] = [
    ['Faig les factures', 'Fer les factures'],
    ['Tinc cura dels avis', 'Tenir cura dels avis'],
    ['Atenc les trucades', 'Atendre les trucades'],
    ['Planifico les rutes', 'Planificar les rutes'],
    ['Serveixo els esmorzars', 'Servir els esmorzars'],
    ['Condueixo les entrevistes', 'Conduir les entrevistes'],
    ['Recullo les comandes', 'Recollir les comandes'],
    ['Prenc nota de les comandes', 'Prendre nota de les comandes'],
    ['Mantinc les instal·lacions', 'Mantenir les instal·lacions'],
    ['Col·laboro amb l’equip', 'Col·laborar amb l’equip'],
    ['Assessoro les clientes', 'Assessorar les clientes'],
  ];
  for (const [copiada, esperada] of casos) {
    assert.equal(enInfinitivo(copiada), esperada, copiada);
  }
});

test('la primera persona del plural también («Revisamos», «Descarreguem», «Fem»)', () => {
  const casos: [string, string][] = [
    ['Revisamos los pedidos', 'Revisar los pedidos'],
    ['Atendemos a los clientes', 'Atender a los clientes'],
    ['Servimos los desayunos', 'Servir los desayunos'],
    ['Damos clases de inglés', 'Dar clases de inglés'],
    ['Descarreguem la mercaderia', 'Descarregar la mercaderia'],
    ['Carreguem els camions', 'Carregar els camions'],
    ['Entrenem cada setmana', 'Entrenar cada setmana'],
    ['Triem el peix', 'Triar el peix'],
    ['Fem manteniment dels vehicles', 'Fer manteniment dels vehicles'],
    ['Servim els esmorzars', 'Servir els esmorzars'],
    ['Rebem les comandes', 'Rebre les comandes'],
    ['Prenem nota de les comandes', 'Prendre nota de les comandes'],
  ];
  for (const [copiada, esperada] of casos) {
    assert.equal(enInfinitivo(copiada), esperada, copiada);
  }
});

test('solo la primera palabra, con sus mayúsculas y sus signos', () => {
  assert.equal(enInfinitivo('Limpio y ordeno la sala'), 'Limpiar y ordeno la sala');
  assert.equal(enInfinitivo('  Reviso, ordeno y limpio'), '  Revisar, ordeno y limpio');
  assert.equal(enInfinitivo('reviso'), 'revisar');
  for (const resultado of [enInfinitivo('Planifico el turno'), enInfinitivo('Faig les factures')]) {
    assert.ok(empiezaPorInfinitivoEnSuIdioma(resultado), resultado);
  }
});

test('lo que ya empieza por infinitivo, o no empieza por una palabra', () => {
  for (const texto of ['Revisar los pedidos', 'Atendre les trucades', '', '   ', '24 horas de guardia']) {
    assert.equal(enInfinitivo(texto), texto);
  }
});

test('nombres que acaban como un verbo, y verbos en tercera persona o pasado, no cambian', () => {
  const nombres = [
    'Cálculo de nóminas',
    'Cálculo y pago',
    'Técnico de mantenimiento',
    'Médico de familia',
    'Seguimiento de obras',
    'Dado que llueve',
    'Pedido urgente',
    'Turno de noche',
    'Proceso de selección',
    'Registro de entradas',
    'Reparto de paquetes',
    'Envío de pedidos',
    'Cobro de facturas',
    'Atenció al client',
    'Revisó el informe',
  ];
  for (const texto of nombres) {
    assert.equal(enInfinitivo(texto), texto, texto);
  }
});

test('nombre y verbo a la vez: solo con un artículo, un pronombre o una preposición detrás', () => {
  assert.ok(
    NOMBRES.has('registro') && NOMBRES.has('cambio'),
    'el registro y el cambio salen como nombres en las tareas',
  );
  assert.equal(enInfinitivo('Registro las entradas'), 'Registrar las entradas');
  assert.equal(enInfinitivo('Cambio el aceite'), 'Cambiar el aceite');
  assert.equal(enInfinitivo('Cambio aceite y filtros'), 'Cambio aceite y filtros');
  assert.equal(enInfinitivo('Registro diario'), 'Registro diario');
});

test('presentarse, poder o querer no son tareas: no se convierten', () => {
  const presentaciones = [
    'Soy administrativa',
    'Estoy en el almacén',
    'Trabajo como cartera',
    'Trabajo en una oficina',
    'Sóc cambrera',
    'Treballo de cambrera',
    'Hago de camarero',
    'Faig de cambrera',
    'Puedo revisar los pedidos',
    'Quiero aprender',
    'Vaig fer les comandes',
    'Voy a revisar los pedidos',
  ];
  for (const texto of presentaciones) {
    assert.equal(enInfinitivo(texto), texto, texto);
  }
});

test('en plural: presentarse, poder o querer, y nombres que acaban como un verbo, siguen igual', () => {
  const iguales = [
    'Somos cinco en el turno',
    'Estamos en el almacén',
    'Trabajamos en equipo',
    'Podemos revisar los pedidos',
    'Som cinc al torn',
    'Estem al magatzem',
    'Treballem en equip',
    'Hem fet les comandes',
    'Anem a les obres',
    'Tramos de carretera',
    'Extremos del cable',
    'Primos y tíos',
    'Calem les xarxes',
  ];
  for (const texto of iguales) {
    assert.equal(enInfinitivo(texto), texto, texto);
  }
});

test('verbos fuera de la lista oficial, erratas y otras personas', () => {
  for (const texto of ['Fag fotos', 'Traballo en el puerto', 'Segueix l’escaleta', 'Revisa los pedidos']) {
    assert.equal(enInfinitivo(texto), texto, texto);
  }
});

test('si dos verbos oficiales encajan, conserva la tarea sin elegir uno', () => {
  assert.deepEqual(infinitivosPosibles('atendo'), ['atender', 'atendre']);
  assert.equal(enInfinitivo('Atendo el material'), 'Atendo el material');
});

test('la clave conserva la eñe y compara equivalentes Unicode y punto volado', () => {
  assert.equal(clave('ORDENO'), 'ordeno');
  assert.equal(clave('ORDEÑO'), 'ordeño');
  assert.equal(clave('ORDEÑO'.normalize('NFD')), 'ordeño');
  assert.equal(clave('Col·laborar'), 'collaborar');
  assert.equal(clave('Reconèixer'), 'reconeixer');
});
