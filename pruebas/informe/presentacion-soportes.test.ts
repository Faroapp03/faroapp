// Soportes compartidos del informe vigente: escape y lengua de datos oficiales sin traducir.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contextoCataluna } from '../../src/dominio/contexto.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import type { Informe } from '../../src/dominio/tipos-informe.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { escapar } from '../../src/presentacion/html.ts';
import { conIdioma, lenguaDe } from '../../src/presentacion/lengua-html.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos', import.meta.url)));
const informe = construirInforme(
  { ocupacionEsco: '4110.1', fecha: '2026-10-07', tareas: [{ id: 'una', texto: 'Una tarea', tiempo: 'mucho' }] },
  datos,
);
const ESCALONES_COMPARADOS = 2;
const MUESTRAS = [
  ['4110.1', '4110'],
  ['5322.1', '5322'],
  ['9313.1', '9313'],
] as const;

test('el escape HTML conserva Unicode y protege texto y atributos entre comillas dobles', () => {
  assert.equal(escapar('&<"> 😀 café'), '&amp;&lt;&quot;&gt; 😀 café');
  assert.equal(conIdioma('Nom', '"><b>'), '<span lang="&quot;&gt;&lt;b&gt;">Nom</span>');
});

test('la lengua HTML marca literales sin traducir, prioriza el más largo y cachea por informe', () => {
  const traducido: Informe = {
    ...informe,
    idioma: 'ca',
    sinTraducir: [
      { texto: '<A&>', idioma: 'es' },
      { texto: 'A', idioma: 'en' },
    ],
  };
  const lengua = lenguaDe(traducido);
  assert.equal(lenguaDe(traducido), lengua);
  assert.equal(lengua.texto('x <A&> y A'), 'x <span lang="es">&lt;A&amp;&gt;</span> y <span lang="en">A</span>');
  assert.equal(lengua.dato('<A&>', 'a&'), '<span lang="es">a&amp;</span>');
  assert.equal(lengua.idiomaDe('<A&>'), 'es');
  assert.equal(lengua.idiomaDe('traducido'), 'ca');
  assert.equal(lenguaDe(informe).idioma, 'es');
});

test('el dominio sigue entregando los dos escalones salariales publicados en ambas lenguas', () => {
  let salarios = 0;
  for (const idioma of ['es', 'ca'] as const) {
    const lengua = crearLengua(datos, idioma);
    for (const [esco, isco] of MUESTRAS) {
      const salario = contextoCataluna(datos, esco, isco, lengua).salario;
      if (!salario) {
        continue;
      }
      salarios += 1;
      assert.equal(salario.escalones.length, ESCALONES_COMPARADOS);
    }
  }
  assert.ok(salarios > 0, 'la muestra real debe ejercitar salario, no solo su ausencia');
});
