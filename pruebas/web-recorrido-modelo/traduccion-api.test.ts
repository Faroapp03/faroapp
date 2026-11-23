import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fichaGrupoTraducida } from '../../src/api/datos-traducidos.ts';
import { fichaGrupo } from '../../src/api/fichas.ts';
import { MAX_OCUPACION_PERSONA } from '../../src/comun/protocolo-web.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { MAX_TAREAS_INFORME } from '../../web/scripts/protocolo-web.js';
import { anotarFallo, nuevaTarea } from '../../web/scripts/recorrido/estado.js';
import {
  cuerpoDelInforme,
  cuerpoDeOcupacion,
  cuerpoDeOcupacionPrincipal,
  hechoSinAporteInferido,
  leerFichaDeGrupo,
  leerGruposHijos,
  leerOrigen,
  MAX_LETRAS_OCUPACION_PERSONA,
  origenDeGrupo,
  rutaEnIdioma,
  traduccionesDeFicha,
  traduccionesDeHijos,
} from '../../web/scripts/recorrido/traduccion-api.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { estimacion, ocupacion } from './datos.ts';

test('el cuerpo del informe conserva tareas, firma y orden; solo la palabra se recorta al límite vigente', () => {
  const tareas = Array.from({ length: MAX_TAREAS_INFORME }, (_, i) => ({
    id: `t${i}`,
    texto: `Tarea ${i}`,
    tiempo: 'mucho' as const,
    estimacion: estimacion(),
  }));
  const entrada = {
    ocupacion: { ...ocupacion(), palabra: 'a'.repeat(MAX_OCUPACION_PERSONA + 1) },
    fecha: '2026-10-14',
    tareas,
  };
  const copia = structuredClone(entrada);
  const cuerpo = cuerpoDelInforme(entrada, { idioma: 'ca' });
  assert.equal(MAX_LETRAS_OCUPACION_PERSONA, MAX_OCUPACION_PERSONA);
  assert.equal(cuerpo.ocupacionPersona?.length, MAX_OCUPACION_PERSONA);
  assert.equal(cuerpo.tareas, tareas);
  assert.deepEqual(cuerpo.tareas, copia.tareas);
  assert.deepEqual(entrada, copia);
  assert.equal(cuerpo.idioma, 'ca');
  assert.equal('sinIa' in cuerpo, false);
  assert.equal('grupoPropuestoPorIa' in cuerpo, false);
});

test('cuerpos e idioma: la ocupación principal excluye el grupo secundario; el informe toma el idioma actual', () => {
  const elegida = { ...ocupacion(), esco: '8331.1', isco08Secundario: '7512' };
  assert.deepEqual(cuerpoDeOcupacionPrincipal(elegida), { isco08: '8331', ocupacionEsco: '8331.1' });
  assert.deepEqual(cuerpoDeOcupacion(elegida), { isco08: '8331', ocupacionEsco: '8331.1', isco08Secundario: '7512' });
  fijarIdioma('ca');
  try {
    const cuerpo = cuerpoDelInforme({
      ocupacion: { ...elegida, origen: 'ia' },
      fecha: '2026-10-14',
      tareas: [],
      sinIa: true,
    });
    assert.equal(cuerpo.grupoPropuestoPorIa, true);
    assert.equal(cuerpo.sinIa, true);
    assert.equal(cuerpo.idioma, 'ca');
  } finally {
    fijarIdioma('es');
  }
});

test('marca sin IA solo con referencias marcadas o ausencia probada; estimación/enlace/origen IA la impiden', () => {
  const tarea = nuevaTarea('Conducir');
  anotarFallo(tarea, tarea.texto, 'sinEstimacionAcreditada');
  assert.equal(hechoSinAporteInferido(ocupacion(), [tarea]), true);
  assert.equal(hechoSinAporteInferido({ origen: 'ia' }, [tarea]), false);
  assert.equal(hechoSinAporteInferido(ocupacion(), [{ ...tarea, estimacion: estimacion() }]), false);
  assert.equal(hechoSinAporteInferido(ocupacion(), [{ ...tarea, oficial: '8331-1' }]), false);
  assert.equal(hechoSinAporteInferido(ocupacion(), [{ ...tarea, marcada: true, oficial: '8331-1' }]), true);
  anotarFallo(tarea, tarea.texto, 'contenido');
  assert.equal(hechoSinAporteInferido(ocupacion(), [tarea]), false);
});

test('una tarea oficial sin nota finita no se lee', () => {
  assert.deepEqual(leerFichaDeGrupo({ tareas: [{ nota: '0.5' }, { nota: Number.POSITIVE_INFINITY }, {}] }).tareas, []);
});

test('orígenes y consulta conservan códigos y orden; las traducciones quedan aparte del dato en castellano', () => {
  const datos = { padre: null, hijos: [{ isco08: '8', titulo: 'Operadores', titulo_ca: 'Operadors', ocupaciones: 3 }] };
  assert.deepEqual(leerGruposHijos(datos), [{ codigo: '8', titulo: 'Operadores', ocupaciones: 3 }]);
  assert.deepEqual(traduccionesDeHijos(datos, '', 'ca'), [
    { castellano: 'Operadores', traduccion: 'Operadors', origen: 'hijos:' },
  ]);
  assert.deepEqual(leerOrigen('hijos:'), { tipo: 'hijos', codigo: '' });
  assert.equal(origenDeGrupo('833'), null);
  assert.equal(origenDeGrupo('8331'), 'grupo:8331');
  assert.equal(rutaEnIdioma('/grupos?padre=83', 'ca'), '/grupos?padre=83&idioma=ca');
  assert.equal(rutaEnIdioma('/grupos/8331', 'es'), '/grupos/8331');
});

test('todas las fichas actuales ES/CA conservan textos, notas, marcas y orden oficiales sin mutar la respuesta', () => {
  const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
  const codigos = Object.keys(datos.clasificaciones.isco08_es).filter((codigo) => /^\d{4}$/.test(codigo));
  assert.ok(codigos.length > 0);
  for (const codigo of codigos) {
    const ficha = fichaGrupo(datos, codigo, 'ocupacion');
    for (const idioma of ['es', 'ca'] as const) {
      const respuesta = idioma === 'ca' ? fichaGrupoTraducida(datos, ficha, idioma) : ficha;
      const copia = structuredClone(respuesta);
      const leida = leerFichaDeGrupo(respuesta);
      assert.deepEqual(
        leida.tareas,
        ficha.tareas.map(({ id, corto, texto_es, texto_en, nota }) => ({ id, corto, texto_es, texto_en, nota })),
      );
      assert.deepEqual(leida.ocupaciones, ficha.ocupaciones);
      assert.deepEqual(
        [leida.titulo, leida.sinTareasOit, leida.sinReferencias, leida.referenciasSubgrupo],
        [ficha.titulo, ficha.sinTareasOit, ficha.sinReferencias, ficha.referenciasSubgrupo],
      );
      const pares = traduccionesDeFicha(respuesta, idioma);
      assert.ok(pares.every(({ origen }) => origen === `grupo:${codigo}`));
      if (idioma === 'ca') {
        assert.equal(pares[0]?.traduccion, Reflect.get(respuesta, 'titulo_ca'));
      } else {
        assert.ok(pares.every(({ traduccion }) => traduccion === undefined));
      }
      assert.deepEqual(respuesta, copia);
    }
  }
});
