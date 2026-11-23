/** De punta a punta: registro real y estado_panel de Python → lector del panel → salud → texto pintado en es/ca. */
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
import { fijarReloj } from './reloj-fijo.ts';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const AHORA = '2026-10-21T12:00:00Z';
const PLAZO_MS = 60_000;
const MAX_SALIDA = 4_194_304;
// Versión del estado que publica hoy el productor real (la v5 nombra fielmente la revisión pendiente).
const VERSION_PRODUCIDA = 5;
/** Ciclo real del registro: hp_life completa su intento con dos de cinco unidades sin respuesta, acreditación
 * falla y Biblioteca termina bien. Solo el conjunto admitido de hp_life es sintético (lo produce otro módulo). */
const PROGRAMA = [
  'import json,sys',
  'from datetime import datetime',
  'from pathlib import Path',
  'from unittest import mock',
  'from plataforma_datos.cursos import operacion_fuente',
  'from plataforma_datos.orquestacion import comprobaciones_remotas as r',
  'from plataforma_datos.orquestacion.contrato_comprobaciones_panel import validar_seguimiento_panel',
  'from plataforma_datos.orquestacion.estado_panel import estado_panel',
  'from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS',
  'raiz, antes = Path(sys.argv[1]), datetime.fromisoformat("2026-10-20T10:00:00+00:00")',
  'if len(sys.argv) > 3:',
  '    from plataforma_datos.cursos.pruebas.test_abierta import documento',
  '    d = documento()',
  '    d["fichas"][0]["comprobado"] = sys.argv[3]',
  '    d["fichas"].append({**d["fichas"][0], "id": "terminada", "comprobado": "2026-03-01", "fin": "2026-06-30"})',
  '    (raiz / "var/actualizacion/preparados/abierta/fichas.json").write_text(json.dumps(d))',
  'ciclo = r.iniciar_ciclo(raiz, antes, "programada")',
  'for fuente, resultado in (("hp_life","parcial"),("acreditacion","fallo"),("enlaces_lecturas","parcial")):',
  '    r.iniciar_fuente(raiz, ciclo, fuente, tuple(c.id for c in CONJUNTOS if c.fuente == fuente), antes, remoto=True)',
  '    r.terminar_fuente(raiz, ciclo, fuente, antes, resultado=resultado, evidencia=None)',
  'r.cerrar_ciclo(raiz, ciclo, antes, resultado="preparado", paquete_preparado=True)',
  'parcial = {"consulta_parcial": {"unidades_fallidas": ["u2", "u4"], "unidades_esperadas": 5}}',
  'leer = lambda fuente, _raiz: parcial if fuente == "hp_life" else None',
  'with mock.patch.object(operacion_fuente, "leer_validado", leer):',
  '    s = estado_panel(raiz, datetime.fromisoformat(sys.argv[2]))',
  'validar_seguimiento_panel(s)',
  'print(json.dumps(s))',
].join('\n');

/** @param comprobado Si se da, Formación abierta lleva una ficha vigente comprobada ese día y otra que terminó el
 * 30/06/2026 tras comprobarse el 01/03/2026; sin él, ninguna ficha. */
function instantanea(t: import('node:test').TestContext, comprobado?: string): unknown {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'Avisos de consulta Año-'));
  t.after(() => rmSync(raiz, { recursive: true }));
  const preparada = join(raiz, 'var/actualizacion/preparados/abierta');
  mkdirSync(preparada, { recursive: true });
  writeFileSync(join(preparada, 'fichas.json'), '{"fichas":[]}');
  const bytes = execFileSync(
    join(RAIZ, '.venv/bin/python'),
    ['-B', '-c', PROGRAMA, raiz, AHORA, ...(comprobado ? [comprobado] : [])],
    {
      cwd: RAIZ,
      timeout: PLAZO_MS,
      maxBuffer: MAX_SALIDA,
    },
  );
  return JSON.parse(bytes.toString('utf8'));
}

function pintado(datos: ReturnType<typeof leerEstadoDatosPanel>, idioma: 'es' | 'ca'): string {
  activarIdiomaPanel(idioma);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), datos);
  return destino.textContent;
}

test('consulta parcial, fallos seguidos y próxima consulta llegan del registro al texto del panel', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const datos = leerEstadoDatosPanel(instantanea(t));
  assert.equal(datos.version, VERSION_PRODUCIDA);
  const fila = (fuente: string) => datos.seguimientoRemoto?.find((f) => f.fuente === fuente);
  // Tras un éxito, la cadencia semanal; tras un fallo, el día siguiente; la parcial, solo recuentos.
  assert.deepEqual(
    { fallos: fila('enlaces_lecturas')?.fallosSeguidos, proxima: fila('enlaces_lecturas')?.proximaConsultaEn },
    { fallos: 0, proxima: '2026-10-27' },
  );
  assert.deepEqual(
    { fallos: fila('acreditacion')?.fallosSeguidos, proxima: fila('acreditacion')?.proximaConsultaEn },
    { fallos: 1, proxima: '2026-10-21' },
  );
  assert.deepEqual(fila('hp_life')?.consultaParcial, { unidadesFallidas: 2, unidadesEsperadas: 5 });
  assert.equal(fila('acreditacion')?.consultaParcial, null);

  const salud = resumirSaludDatos(datos);
  const hp = salud.operativas.find((f) => f.id === 'hp_life');
  assert.equal(hp?.estado, 'incidencia', 'una consulta parcial nunca se presenta como comprobada');

  fijarReloj(t);
  const es = pintado(datos, 'es');
  assert.ok(es.includes('Consulta parcial: 2 de 5 unidades sin respuesta; se conserva su última comprobación.'));
  assert.ok(es.includes('Fallos seguidos: 1.'));
  assert.ok(es.includes('Próxima consulta: hace 24 días, el 21 oct. 2026.'));
  const ca = pintado(datos, 'ca');
  assert.ok(ca.includes('Consulta parcial: 2 de 5 unitats sense resposta; es conserva la seva última comprovació.'));
  assert.ok(ca.includes('Intents fallits seguits: 1.'));
  assert.ok(ca.includes('Pròxima consulta: fa 24 dies, el 21 d’oct. del 2026.'));
});

test('el lector cierra la forma nueva y rechaza una parcial presentada como completa', (t) => {
  const crudo = instantanea(t) as { seguimientoRemoto: Record<string, unknown>[] };
  const leido = leerEstadoDatosPanel(crudo);
  assert.ok(
    leido.version === VERSION_PRODUCIDA && leido.seguimientoRemoto?.every((f) => typeof f.fallosSeguidos === 'number'),
  );
  const copia = structuredClone(crudo);
  const enlaces = copia.seguimientoRemoto.find((f) => f.fuente === 'enlaces_lecturas');
  assert.ok(enlaces);
  enlaces.consultaParcial = { unidadesFallidas: 1, unidadesEsperadas: 3 };
  (enlaces.ultimoIntento as Record<string, unknown>).resultado = 'comprobada';
  assert.throws(() => leerEstadoDatosPanel(copia));
  const sobrante = structuredClone(crudo);
  (sobrante.seguimientoRemoto[0] as Record<string, unknown>).otro = 1;
  assert.throws(() => leerEstadoDatosPanel(sobrante));
  const fallos = structuredClone(crudo);
  const acreditacion = fallos.seguimientoRemoto.find((f) => f.fuente === 'acreditacion');
  assert.ok(acreditacion);
  acreditacion.fallosSeguidos = 0;
  assert.throws(() => leerEstadoDatosPanel(fallos));
});

test('la revisión pendiente de Formación abierta llega como aviso a su tarjeta, sin contar fichas terminadas', (t) => {
  instalar(t);
  t.after(() => activarIdiomaPanel());
  const vencida = leerEstadoDatosPanel(instantanea(t, '2026-07-01'));
  // 90 días tras la comprobación más antigua de las fichas vigentes; la terminada (01/03) no cuenta.
  assert.ok(vencida.version === VERSION_PRODUCIDA);
  assert.equal(vencida.formacionAbiertaRevisionPendiente, '2026-09-30');
  const abierta = resumirSaludDatos(vencida).operativas.find((f) => f.id === 'abierta');
  assert.deepEqual(abierta?.revisionPendiente, { fecha: '2026-09-30', vencida: true });
  assert.ok(resumirSaludDatos(vencida).operativas.every((f) => f.id === 'abierta' || f.revisionPendiente === null));
  fijarReloj(t);
  assert.match(
    pintado(vencida, 'es'),
    /La revisión de las fichas de Formación abierta está pendiente: venció hace 45 días, el 30 sept. 2026\./,
  );
  assert.match(
    pintado(vencida, 'ca'),
    /La revisió de les fitxes de Formació oberta està pendent: va vèncer fa 45 dies, el 30 de set. del 2026\./,
  );

  const proxima = leerEstadoDatosPanel(instantanea(t, '2026-10-06'));
  assert.ok(proxima.version === VERSION_PRODUCIDA);
  assert.equal(proxima.formacionAbiertaRevisionPendiente, '2027-01-05');
  const es = pintado(proxima, 'es');
  assert.ok(es.includes('La revisión de las fichas de Formación abierta vence dentro de 52 días, el 5 ene. 2027.'));
  assert.ok(!es.includes('está pendiente:'), 'una revisión que aún no vence no se presenta como pendiente');
  assert.match(
    pintado(proxima, 'ca'),
    /La revisió de les fitxes de Formació oberta venç d’aquí a 52 dies, el 5 de gen. del 2027\./,
  );
  assert.equal(
    resumirSaludDatos(proxima).operativas.find((f) => f.id === 'abierta')?.estado,
    resumirSaludDatos(vencida).operativas.find((f) => f.id === 'abierta')?.estado,
    'el aviso no cambia el estado de la fuente',
  );
});
