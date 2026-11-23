/** De punta a punta: seguimiento y registro reales → estado_panel y su contrato → lector → salud → texto es/ca.
 * Separa la cobertura de la fuente (lo que puede acreditar) del resultado de cada consulta (si faltaron unidades). */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { mostrarEstadoDatos } from '../../web/administracion/vista-datos.js';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const AHORA = '2026-10-21T12:00:00Z';
const PLAZO_MS = 60_000;
const MAX_SALIDA = 4_194_304;
// Versión del estado que publica hoy el productor real.
const VERSION_PRODUCIDA = 5;
/** Dos ciclos reales con el ejecutor de órdenes como único doble: el primero falla Cibernàrium; el segundo lo consulta
 * (entero o con una página caída), comprueba HP LIFE y falla acreditación. Solo los conjuntos admitidos son sintéticos
 * (los produce otro módulo) y la cobertura de HP LIFE se da por acreditada, como en su prueba propia. */
const PROGRAMA = [
  'import json,sys',
  'from datetime import datetime, timedelta',
  'from pathlib import Path',
  'from unittest import mock',
  'from plataforma_datos.cursos import operacion_fuente',
  'from plataforma_datos.orquestacion import actualizar',
  'from plataforma_datos.orquestacion import comprobaciones_remotas as r',
  'from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as s',
  'from plataforma_datos.orquestacion import contrato_comprobaciones_panel as contrato',
  'from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente',
  'from plataforma_datos.orquestacion.estado_panel import estado_panel',
  'from plataforma_datos.orquestacion.modulos import MODULOS',
  'raiz, escenario = Path(sys.argv[1]), sys.argv[3]',
  'caida = {"censo_completo": False, "consulta_parcial": {"unidades_fallidas": [], "unidades_esperadas": 53,',
  '    "paginas_fallidas": [16], "paginas_esperadas": 4}}',
  'admitidos = {"barcelonactiva": caida if escenario == "caida" else {"censo_completo": True}, "hp_life": {}}',
  'def evidencia(fuente, ahora):',
  '    t = ahora.isoformat()',
  '    peticion = {"recurso_sha256": "a" * 64, "url_final_sha256": "b" * 64, "respuesta_sha256": "c" * 64,',
  '        "bytes": 42, "completado_utc": t, "original_sha256": "c" * 64, "original_bytes": 42}',
  '    return {"version": 2, "fuente": fuente, "intento": "recepcion-" + fuente, "comienzo_utc": t, "fin_utc": t,',
  '        "peticiones": [peticion]}',
  'def ciclo(ahora, fuentes):',
  '    c = r.iniciar_ciclo(raiz, ahora, "programada")',
  '    for fuente, falla in fuentes:',
  '        prueba = None if falla else evidencia(fuente, ahora)',
  '        def ejecutar(orden, _area, falla=falla, prueba=prueba):',
  '            etapa = etapa_de_fuente(orden)[1]',
  '            return actualizar.Resultado(int(falla and etapa == "descargar"), "", prueba if etapa == "descargar" else None)',
  '        o = s.Seguimiento(raiz, c, ejecutar, lambda: ahora)',
  '        for orden in actualizar.ordenes_de_la_fuente(fuente):',
  '            o.ejecutar(orden.orden, raiz)',
  '        veredicto = actualizar.ResultadoDelModulo("ámbar" if falla else "verde")',
  '        o.terminar_modulo(next(m for m in MODULOS if m.id == fuente), veredicto)',
  '    r.cerrar_ciclo(raiz, c, ahora, resultado="preparado", paquete_preparado=True)',
  'antes = datetime.fromisoformat("2026-10-20T10:00:00+00:00")',
  'leer = lambda fuente, _raiz: admitidos.get(fuente)',
  'cobertura_hp = {"hp_life": lambda _raiz, _evidencia: True}',
  'with mock.patch.object(operacion_fuente, "leer_validado", leer), mock.patch.dict(s.COBERTURAS_COMPLETAS, cobertura_hp):',
  '    ciclo(antes - timedelta(days=1), [("barcelonactiva", True)])',
  '    ciclo(antes, [("barcelonactiva", False), ("hp_life", False), ("acreditacion", True)])',
  '    instantanea = estado_panel(raiz, datetime.fromisoformat(sys.argv[2]))',
  'contrato.validar_comprobaciones_panel(instantanea)',
  'contrato.validar_seguimiento_panel(instantanea)',
  'fuentes = r.leer_registro(raiz)["fuentes"]',
  'registro = {f: fuentes[f]["resultado"] for f in ("barcelonactiva", "hp_life", "acreditacion")}',
  'print(json.dumps({"registro": registro, "instantanea": instantanea}))',
].join('\n');

type Escenario = 'completa' | 'caida';
type Salida = { registro: Record<string, string>; instantanea: { seguimientoRemoto: Record<string, unknown>[] } };

function recorrido(t: import('node:test').TestContext, escenario: Escenario): Salida {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'Cobertura de consulta Año-'));
  t.after(() => rmSync(raiz, { recursive: true }));
  const preparada = join(raiz, 'var/actualizacion/preparados/abierta');
  mkdirSync(preparada, { recursive: true });
  writeFileSync(join(preparada, 'fichas.json'), '{"fichas":[]}');
  const bytes = execFileSync(join(RAIZ, '.venv/bin/python'), ['-B', '-c', PROGRAMA, raiz, AHORA, escenario], {
    cwd: RAIZ,
    timeout: PLAZO_MS,
    maxBuffer: MAX_SALIDA,
  });
  return JSON.parse(bytes.toString('utf8'));
}

function pintado(datos: ReturnType<typeof leerEstadoDatosPanel>, idioma: 'es' | 'ca'): string {
  activarIdiomaPanel(idioma);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), datos);
  return destino.textContent;
}

const COBERTURA_ES =
  'Cobertura limitada: la consulta renueva el censo de Cibernàrium, pero el catálogo de ocupaciones y las páginas ' +
  'históricas conservan sus fechas propias.';
const COBERTURA_CA =
  'Cobertura limitada: la consulta renova el cens de Cibernàrium, però el catàleg d’ocupacions i les pàgines ' +
  'històriques conserven les seves dates pròpies.';

test('Cibernàrium completo no es incidencia y muestra su cobertura limitada; HP comprobada; el fallo, reintento', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const { registro, instantanea } = recorrido(t, 'completa');
  assert.deepEqual(registro, { barcelonactiva: 'completa', hp_life: 'comprobada', acreditacion: 'fallo' });
  const datos = leerEstadoDatosPanel(instantanea);
  const fila = (fuente: string) =>
    (datos.version === VERSION_PRODUCIDA ? datos.seguimientoRemoto : null)?.find((f) => f.fuente === fuente);
  // La consulta completa resolvió el fallo del día anterior: sin pendientes ni fallos seguidos.
  assert.deepEqual(
    {
      pendientes: fila('barcelonactiva')?.incidenciasPendientes.length,
      fallos: fila('barcelonactiva')?.fallosSeguidos,
      cobertura: fila('barcelonactiva')?.coberturaLimitada,
      parcial: fila('barcelonactiva')?.consultaParcial,
    },
    { pendientes: 0, fallos: 0, cobertura: 'censo-con-copias-fijadas', parcial: null },
  );
  assert.equal(fila('hp_life')?.coberturaLimitada, null);
  assert.deepEqual(
    { fallos: fila('acreditacion')?.fallosSeguidos, proxima: fila('acreditacion')?.proximaConsultaEn },
    { fallos: 1, proxima: '2026-10-21' },
  );

  const salud = resumirSaludDatos(datos);
  const estado = (id: string) => salud.operativas.find((f) => f.id === id);
  assert.notEqual(estado('barcelonactiva')?.estado, 'incidencia');
  assert.equal(estado('barcelonactiva')?.resultadoConsulta, 'completa');
  assert.equal(estado('barcelonactiva')?.coberturaLimitada, 'censo-con-copias-fijadas');
  assert.equal(estado('hp_life')?.resultadoConsulta, 'comprobada');
  assert.notEqual(estado('hp_life')?.estado, 'incidencia');
  assert.equal(estado('acreditacion')?.estado, 'incidencia');
  assert.equal(estado('acreditacion')?.fallosSeguidos, 1);

  const es = pintado(datos, 'es');
  assert.ok(es.includes(COBERTURA_ES));
  assert.ok(es.includes('Resultado de esa consulta: Consulta completa; la fuente no lo cubre todo.'));
  assert.ok(es.includes('Resultado de esa consulta: Consulta correcta.'));
  assert.ok(es.includes('Fallos seguidos: 1.'));
  assert.ok(!es.includes('Consulta parcial:'));
  const ca = pintado(datos, 'ca');
  assert.ok(ca.includes(COBERTURA_CA));
  assert.ok(ca.includes('Resultat d’aquesta consulta: Consulta completa; la font no ho cobreix tot.'));
  assert.ok(ca.includes('Intents fallits seguits: 1.'));
});

test('Cibernàrium con una página caída queda parcial e incidencia, con su recuento de páginas', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const { registro, instantanea } = recorrido(t, 'caida');
  assert.equal(registro.barcelonactiva, 'parcial');
  const datos = leerEstadoDatosPanel(instantanea);
  const ciber = resumirSaludDatos(datos).operativas.find((f) => f.id === 'barcelonactiva');
  assert.equal(ciber?.estado, 'incidencia', 'una consulta parcial nunca se presenta como completa');
  assert.deepEqual(ciber?.consultaParcial, { unidadesFallidas: 1, unidadesEsperadas: 4 });
  const es = pintado(datos, 'es');
  assert.ok(es.includes('Consulta parcial: 1 de 4 unidades sin respuesta; se conserva su última comprobación.'));
  assert.ok(es.includes('Resultado de esa consulta: Consulta incompleta.'));
  assert.ok(es.includes(COBERTURA_ES), 'la cobertura sigue siendo información aparte');
  const ca = pintado(datos, 'ca');
  assert.ok(ca.includes('Consulta parcial: 1 de 4 unitats sense resposta; es conserva la seva última comprovació.'));
});

test('el lector rechaza una consulta completa sin cobertura limitada, comprobada con ella o parcial', (t) => {
  const { instantanea } = recorrido(t, 'completa');
  const fila = (copia: Salida['instantanea'], fuente: string) => {
    const encontrada = copia.seguimientoRemoto.find((f) => f.fuente === fuente);
    assert.ok(encontrada);
    return encontrada;
  };
  const sinMotivo = structuredClone(instantanea);
  fila(sinMotivo, 'barcelonactiva').coberturaLimitada = null;
  assert.throws(() => leerEstadoDatosPanel(sinMotivo));
  const comprobadaLimitada = structuredClone(instantanea);
  fila(comprobadaLimitada, 'hp_life').coberturaLimitada = 'indices-sin-censo';
  assert.throws(() => leerEstadoDatosPanel(comprobadaLimitada));
  const completaParcial = structuredClone(instantanea);
  fila(completaParcial, 'barcelonactiva').consultaParcial = { unidadesFallidas: 1, unidadesEsperadas: 4 };
  assert.throws(() => leerEstadoDatosPanel(completaParcial));
  const desconocido = structuredClone(instantanea);
  fila(desconocido, 'barcelonactiva').coberturaLimitada = 'otro';
  assert.throws(() => leerEstadoDatosPanel(desconocido));
  const formaAnterior = structuredClone(instantanea);
  delete fila(formaAnterior, 'barcelonactiva').coberturaLimitada;
  assert.throws(() => leerEstadoDatosPanel(formaAnterior), 'una completa exige la forma con cobertura');
});
