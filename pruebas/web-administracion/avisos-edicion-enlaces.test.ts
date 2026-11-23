/** La edición detenida, los grupos sin clase, las cifras de enlaces, el almacén en el estado global y el día observado. */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOTIVOS_DETENCION, PARTES_ENUNCIADO } from '../../src/administracion/edicion-nueva-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { instalar } from '../web-informe-lectura/dom-doble.ts';
import {
  conAlmacen,
  conSeguimiento,
  de,
  estadoDeLaFuente,
  HUELLA,
  type Idioma,
  leer,
  OBSERVADO_EN,
  pintado,
  TRES,
} from './avisos-datos-ayudas.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { fijarReloj } from './reloj-fijo.ts';

const IDIOMAS: readonly Idioma[] = ['es', 'ca'];
const CIEN = 100;

function detenida(extra: Record<string, unknown>, observadoEn = OBSERVADO_EN) {
  return leer(
    {},
    { edicionNueva: { estado: 'detenida-por-controles', anio: '2026', observadoEn, huellaCatalogo: HUELLA, ...extra } },
  );
}

test('una edición detenida pinta su estado, su motivo y sus partes en su orden, y pone la fuente en necesita atención', (t) => {
  instalar(t);
  fijarReloj(t);
  t.after(() => activarIdiomaPanel());
  const sin = leer();
  assert.equal(estadoDeLaFuente(sin), 'comprobada');
  for (const motivo of MOTIVOS_DETENCION) {
    const datos = detenida(motivo === 'enunciado-distinto' ? { motivo, partes: ['pregunta', 'opciones'] } : { motivo });
    assert.equal(estadoDeLaFuente(datos), 'atencion', motivo);
    for (const idioma of IDIOMAS) {
      const texto = pintado(datos, idioma);
      assert.ok(texto.includes(de(idioma, `panel.datos.edicion-nueva.motivo.${motivo}`)), `${motivo} en ${idioma}`);
      assert.ok(
        texto.includes(de(idioma, 'panel.datos.edicion-nueva.parte.pregunta')) === (motivo === 'enunciado-distinto'),
      );
    }
  }
  const todas = pintado(detenida({ motivo: 'enunciado-distinto', partes: [...PARTES_ENUNCIADO] }), 'es');
  const posiciones = PARTES_ENUNCIADO.map((parte) =>
    todas.indexOf(de('es', `panel.datos.edicion-nueva.parte.${parte}`)),
  );
  assert.ok(
    posiciones.every((p, i) => p >= 0 && (i === 0 || p > (posiciones[i - 1] ?? 0))),
    'las partes salen en su orden',
  );
  assert.ok(
    pintado(detenida({ motivo: 'tablas' }), 'es').includes(
      'Edición 2026 detenida: no ha pasado todas sus comprobaciones y se sigue publicando la anterior. Observado: hace 25 días, el 20 oct. 2026.',
    ),
  );
  assert.ok(
    pintado(detenida({ motivo: 'tablas' }), 'ca').includes(
      'Edició 2026 aturada: no ha superat totes les comprovacions i es continua publicant l’anterior. Observat: fa 25 dies, el 20 d’oct. del 2026.',
    ),
  );
  for (const idioma of IDIOMAS) {
    assert.ok(
      !/detenida|aturada|Cambia la pregunta|Canvia la pregunta/.test(pintado(sin, idioma)),
      'sin edición no sale nada',
    );
  }
});

test('los grupos sin clase se dicen con su singular y sin el campo no sale nada', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const uno = leer({}, { gruposSinClase: 1 });
  const varios = leer({}, { gruposSinClase: TRES });
  assert.ok(pintado(uno, 'es').includes('1 grupo de ocupación no tiene clase manual ni no manual en esta edición;'));
  assert.ok(
    pintado(varios, 'es').includes('3 grupos de ocupación no tienen clase manual ni no manual en esta edición;'),
  );
  assert.ok(pintado(uno, 'ca').includes('1 grup d’ocupació no té classe manual ni no manual en aquesta edició;'));
  assert.ok(
    pintado(varios, 'ca').includes('3 grups d’ocupació no tenen classe manual ni no manual en aquesta edició;'),
  );
  assert.equal(estadoDeLaFuente(varios), estadoDeLaFuente(leer()), 'es información');
  for (const idioma of IDIOMAS) {
    assert.ok(!/clase manual|classe manual/.test(pintado(leer(), idioma)));
  }
});

test('las cifras de la comprobación de enlaces se pintan con su singular, sin cambiar la salud, y sin ellas no sale nada', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const datos = conSeguimiento({ enlaces: { comprobados: CIEN, ocultos: 2, sinComprobar: 1 } });
  assert.ok(
    pintado(datos, 'es').includes(
      'Enlaces de los cursos: 100 enlaces comprobados; 2 enlaces ocultos porque su página ya no existe; 1 enlace sin comprobar todavía.',
    ),
  );
  assert.ok(
    pintado(datos, 'ca').includes(
      'Enllaços dels cursos: 100 enllaços comprovats; 2 enllaços amagats perquè la seva pàgina ja no existeix; 1 enllaç encara sense comprovar.',
    ),
  );
  const uno = conSeguimiento({ enlaces: { comprobados: 1, ocultos: 1, sinComprobar: 0 } });
  assert.ok(
    pintado(uno, 'es').includes(
      '1 enlace comprobado; 1 enlace oculto porque su página ya no existe; 0 enlaces sin comprobar todavía.',
    ),
  );
  assert.equal(estadoDeLaFuente(datos), estadoDeLaFuente(conSeguimiento({})));
  for (const idioma of IDIOMAS) {
    assert.ok(!/Enlaces de los cursos|Enllaços dels cursos/.test(pintado(conSeguimiento({}), idioma)));
  }
});

test('con el almacén de cursos ausente, ilegible o vacío el estado global necesita atención', () => {
  assert.equal(resumirSaludDatos(leer()).global, 'comprobada');
  for (const motivo of ['almacen-ausente', 'almacen-ilegible', 'almacen-vacio']) {
    const salud = resumirSaludDatos(conAlmacen(motivo));
    assert.equal(salud.global, 'atencion', motivo);
    assert.equal(salud.almacen, motivo);
  }
  assert.equal(resumirSaludDatos(conAlmacen(undefined)).global, 'comprobada');
});

test('el día observado de la edición nueva es el de Cataluña, no el UTC', (t) => {
  instalar(t);
  fijarReloj(t);
  t.after(() => activarIdiomaPanel());
  // A las 22:30 UTC del 20 de octubre ya es 21 de octubre en Cataluña.
  const datos = detenida({ motivo: 'tablas' }, '2026-10-20T22:30:00Z');
  assert.ok(pintado(datos, 'es').includes('Observado: hace 24 días, el 21 oct. 2026.'));
  assert.ok(pintado(datos, 'ca').includes('Observat: fa 24 dies, el 21 d’oct. del 2026.'));
});
