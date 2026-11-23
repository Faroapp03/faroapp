// Cadenas enteras de texto libre en el recorrido local, con el motor de verdad
// (motores/ocupaciones/src/recorrido/pantalla/servicio.ts) y el estado de la pantalla
// (web/scripts/recorrido/flujo-local.js): lo que la persona escribe nunca vuelve a pedir lo mismo en bucle. Tras dos
// textos seguidos que no avanzan, o un «Lo cuento con mis palabras» que no cambia nada, se pasa a los botones de las
// familias; lo ya dicho no se pierde y lo repetido no cuenta dos veces. Caso protegido:
// «hola → resultado mal → con tus palabras → hola → resultado mal…».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { comprobarAtributos, pasoDePantalla } from '../../motores/ocupaciones/src/index.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { TEXTOS_RECORRIDO as CA } from '../../web/idiomas/ca/recorrido.js';
import { TEXTOS_RECORRIDO as ES } from '../../web/idiomas/es/recorrido.js';
import * as flujo from '../../web/scripts/recorrido/flujo-local.js';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const A = comprobarAtributos(
  JSON.parse(
    readFileSync(new URL('../../motores/ocupaciones/src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8'),
  ),
);

type Estado = ReturnType<typeof flujo.estadoInicial>;
type Accion =
  | { readonly escribe: string }
  | { readonly aclara: string }
  | { readonly cuenta: string }
  | { readonly no: true }
  | { readonly atras: true };

interface Vuelta {
  readonly destino: string;
  readonly aviso?: string;
  readonly estado: Estado;
  readonly titulo?: string;
}

type Respuesta = ReturnType<typeof pasoDePantalla>;

/** El estado tras una acción de la persona y, si es «Lo cuento», la huella del paso de antes. */
function aplicar(estado: Estado, a: Accion, ultimo: Respuesta | null): { estado: Estado; antes?: string } {
  if ('escribe' in a) {
    return { estado: flujo.empezar(estado, a.escribe) };
  }
  if ('aclara' in a) {
    return { estado: flujo.aclarar(estado, a.aclara) };
  }
  if ('cuenta' in a) {
    return { estado: flujo.anadirTexto(estado, a.cuenta), antes: flujo.huellaDelPaso(ultimo) };
  }
  if ('no' in a) {
    const paso = ultimo?.paso;
    assert.ok(paso?.tipo === 'propuesta', 'un «No» necesita una propuesta delante');
    return { estado: flujo.responder(estado, paso.id, 'no') };
  }
  return { estado: flujo.deshacer(estado) };
}

/** Lo que haría la pantalla (paso-ocupacion.js) con cada acción, sin DOM. */
function cadena(acciones: readonly Accion[]): Vuelta[] {
  let estado = flujo.estadoInicial();
  let ultimo: Respuesta | null = null;
  const vueltas: Vuelta[] = [];
  for (const a of acciones) {
    const hecho = aplicar(estado, a, ultimo);
    const respuesta = pasoDePantalla(datos, A, {
      texto: hecho.estado.texto,
      idioma: 'es',
      respuestas: hecho.estado.respuestas,
      ...(hecho.estado.anadido ? { anadido: hecho.estado.anadido } : {}),
    });
    ultimo = respuesta;
    const sinCambios = hecho.antes !== undefined && flujo.huellaDelPaso(respuesta) === hecho.antes;
    const ir = flujo.destinoDelPaso(hecho.estado, respuesta, { sinCambios });
    estado = ir.estado;
    const p = respuesta.paso;
    vueltas.push({
      destino: ir.destino,
      estado,
      ...(ir.aviso ? { aviso: ir.aviso } : {}),
      ...(p.tipo === 'propuesta' ? { titulo: p.mejor.ocupacion?.titulo.es ?? p.mejor.tituloGrupo.es } : {}),
    });
  }
  return vueltas;
}

const ultima = (v: readonly Vuelta[]): Vuelta => {
  const u = v.at(-1);
  assert.ok(u);
  return u;
};

test('«hola» y otra vez «hola»: la primera, respuesta amable; la segunda, los botones de las familias', () => {
  const [primera, segunda] = cadena([{ escribe: 'hola' }, { escribe: 'hola' }]);
  assert.equal(primera?.destino, 'cortesia');
  assert.equal(segunda?.destino, 'guiado');
  assert.equal(segunda?.aviso, 'recorrido.local.guiado.cortesia');
});

test('«hola» y luego «soy camarero»: el saludo no estorba y sale camarero', () => {
  const [primera, segunda] = cadena([{ escribe: 'hola' }, { escribe: 'soy camarero' }]);
  assert.equal(primera?.destino, 'cortesia');
  assert.equal(segunda?.destino, 'confirmar');
  assert.match(segunda?.titulo ?? '', /camarer/u);
  assert.equal(segunda?.estado.sinAvance, 0, 'lo que avanza pone el contador a cero');
});

test('propuesta → «No» → «Lo cuento» con «hola»: no vuelve a pedir lo mismo, pasa a los botones', () => {
  const v = cadena([{ escribe: 'camarero' }, { no: true }, { cuenta: 'hola' }]);
  assert.equal(v[0]?.destino, 'confirmar');
  const fin = ultima(v);
  assert.equal(fin.destino, 'guiado');
  assert.equal(fin.aviso, 'recorrido.local.guiado.sin-cambios');
  // Nada se pierde: el «No» sigue y se puede volver a la pregunta con todo lo dicho.
  assert.equal(fin.estado.respuestas.length, 1);
  assert.equal(fin.estado.texto, 'camarero. hola');
});

test('propuesta → «Lo cuento» con «hola» dos veces: el segundo no se suma y tampoco hay bucle', () => {
  const v = cadena([{ escribe: 'camarero' }, { cuenta: 'hola' }, { cuenta: 'hola' }]);
  assert.deepEqual(
    v.map((x) => x.destino),
    ['confirmar', 'guiado', 'guiado'],
  );
  assert.equal(ultima(v).estado.texto, 'camarero. hola');
  assert.equal(ultima(v).estado.anadido, 'hola');
});

test('«corto verdura» y luego «en una cocina»: lo contado se acumula y cambia lo que propone', () => {
  const v = cadena([{ escribe: 'corto verdura' }, { cuenta: 'en una cocina' }]);
  const fin = ultima(v);
  assert.equal(fin.estado.texto, 'corto verdura. en una cocina');
  assert.equal(fin.estado.anadido, 'en una cocina');
  assert.notEqual(fin.destino, 'guiado', 'lo añadido sí cambia el paso');
  assert.ok(['pregunta', 'confirmar'].includes(fin.destino));
});

test('lo mismo contado dos veces no cuenta dos veces', () => {
  const v = cadena([
    { escribe: 'trabajo en una oficina' },
    { cuenta: 'hago las nóminas' },
    { cuenta: 'Hago las NÓMINAS.' },
  ]);
  assert.equal(ultima(v).estado.texto, 'trabajo en una oficina. hago las nóminas');
  assert.equal(ultima(v).destino, 'guiado');
});

test('«Atrás» tras «Lo cuento»: quita el «No» y conserva lo contado (la propuesta se rehace con ello)', () => {
  const v = cadena([
    { escribe: 'camarero' },
    { no: true },
    { cuenta: 'preparo cócteles en la barra' },
    { atras: true },
  ]);
  const fin = ultima(v);
  assert.equal(fin.estado.respuestas.length, 0);
  assert.equal(fin.estado.anadido, 'preparo cócteles en la barra');
  assert.equal(fin.destino, 'confirmar');
});

test('algo que no se entiende y una aclaración que tampoco: dos textos y a las familias, sin tercer intento', () => {
  const v = cadena([{ escribe: 'xyzzy plof' }, { aclara: 'hola' }]);
  assert.deepEqual(
    v.map((x) => x.destino),
    ['aclarar', 'familias'],
  );
  assert.equal(ultima(v).aviso, 'recorrido.local.familias.sin-entender');
});

test('un saludo y luego algo que no se entiende: tope de dos textos, a las familias sin pedir aclaración', () => {
  const v = cadena([{ escribe: 'hola' }, { escribe: 'xyzzy plof' }]);
  assert.deepEqual(
    v.map((x) => x.destino),
    ['cortesia', 'familias'],
  );
});

test('los avisos del camino guiado tienen texto en los dos idiomas', () => {
  for (const clave of [
    'recorrido.local.guiado.cortesia',
    'recorrido.local.guiado.sin-cambios',
    'recorrido.local.familias.sin-entender',
    'recorrido.local.familias.tras-rechazos',
  ]) {
    assert.ok(ES[clave]?.trim(), clave);
    assert.ok(CA[clave]?.trim(), clave);
  }
});
