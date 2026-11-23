// Banco de necesidades: referencia histórica fijada por huella y validez frente a los datos vigentes; no ejecuta el
// selector. Las comprobaciones viven en `ayudas/banco-necesidades.ts` y aquí se aplican al producto y a copias alteradas.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  CARPETA_BANCO,
  comprobarIntervenciones,
  comprobarPares,
  comprobarReferenciaHistorica,
  comprobarReferenciasVigentes,
  huella,
  procedenciaDe,
} from '../ayudas/banco-necesidades.ts';

const RAIZ = new URL('../../', import.meta.url);
const comprobaciones = [
  comprobarPares,
  comprobarIntervenciones,
  comprobarReferenciasVigentes,
  comprobarReferenciaHistorica,
];

type Json = Record<string, unknown>;
const leerJson = (raiz: URL, ruta: string): Json => JSON.parse(readFileSync(new URL(ruta, raiz), 'utf8')) as Json;
const escribirJson = (raiz: URL, ruta: string, valor: unknown): void =>
  writeFileSync(new URL(ruta, raiz), `${JSON.stringify(valor, null, 2)}\n`);

/** Copia del producto con todo lo que el banco consulta, incluido el catálogo que registra su procedencia. */
function conCopia(alterar: (raiz: URL) => void, comprobar: (raiz: URL) => void): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-banco-'));
  try {
    const procedencia = procedenciaDe(RAIZ);
    const rutas = [
      CARPETA_BANCO,
      'datos/esco.json',
      'datos/oit.json',
      ...Object.keys(procedencia.catalogo),
      ...procedencia.fuentesDeAnclajes.filter((fuente) => fuente.ambito === 'producto').map((fuente) => fuente.ruta),
    ];
    for (const ruta of new Set(rutas)) {
      cpSync(new URL(ruta, RAIZ), join(carpeta, ruta), { recursive: true });
    }
    const raiz = pathToFileURL(`${carpeta}/`);
    alterar(raiz);
    comprobar(raiz);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

test('el banco del producto cumple su referencia histórica y es válido con los datos vigentes', () => {
  for (const comprobacion of comprobaciones) {
    comprobacion(RAIZ);
  }
});

test('una actualización válida de cursos pasa sin modificar perfiles ni expectativas', () => {
  const protegidos = ['personas.json', 'contrato.json'].map((nombre) => `${CARPETA_BANCO}${nombre}`);
  const antes = protegidos.map((ruta) => huella(RAIZ, ruta));
  conCopia(
    (raiz) => {
      const formacion = leerJson(raiz, 'datos/formacion.json') as { cursos: Json[]; fecha_cursos: string };
      const [retirado, ...resto] = formacion.cursos;
      assert.ok(retirado);
      const nuevo = { ...retirado, id: `${String(retirado.id)}-nueva-edicion`, inicio: '2026-11-30' };
      escribirJson(raiz, 'datos/formacion.json', {
        ...formacion,
        cursos: [...resto, nuevo],
        fecha_cursos: '2026-10-25',
      });
      const manifiesto = leerJson(raiz, 'datos/manifiesto.json') as Record<string, Json>;
      const entrada = { ...manifiesto['formacion.json'], sha256: huella(raiz, 'datos/formacion.json') };
      escribirJson(raiz, 'datos/manifiesto.json', { ...manifiesto, 'formacion.json': entrada });
    },
    (raiz) => {
      const historico = procedenciaDe(raiz).catalogo;
      for (const ruta of ['datos/formacion.json', 'datos/manifiesto.json']) {
        assert.notEqual(huella(raiz, ruta), historico[ruta], `${ruta}: la copia publica un catálogo distinto`);
      }
      for (const comprobacion of comprobaciones) {
        comprobacion(raiz);
      }
      assert.deepEqual(
        protegidos.map((ruta) => huella(raiz, ruta)),
        antes,
        'perfiles y expectativas intactos',
      );
    },
  );
});

test('una ocupación o una tarea que deja de existir en los datos vigentes se detecta', () => {
  const persona = (leerJson(RAIZ, `${CARPETA_BANCO}personas.json`).personas as { id: string; entrada: Json }[])[0];
  assert.ok(persona);
  const { ocupacion, necesidad } = persona.entrada as {
    ocupacion: { esco: string };
    necesidad: { tareas: { id: string }[] };
  };
  const tarea = necesidad.tareas[0]?.id;
  assert.ok(tarea);
  conCopia(
    (raiz) => {
      const esco = leerJson(raiz, 'datos/esco.json') as { ocupaciones: Record<string, Json> };
      esco.ocupaciones[ocupacion.esco] = { ...esco.ocupaciones[ocupacion.esco], isco08: '9999' };
      escribirJson(raiz, 'datos/esco.json', esco);
    },
    (raiz) => {
      assert.throws(() => comprobarReferenciasVigentes(raiz), new RegExp(`${persona.id}: ocupación ESCO`, 'u'));
      comprobarReferenciaHistorica(raiz);
    },
  );
  conCopia(
    (raiz) => {
      const oit = leerJson(raiz, 'datos/oit.json') as { tareas: Record<string, unknown> };
      delete oit.tareas[tarea];
      escribirJson(raiz, 'datos/oit.json', oit);
    },
    (raiz) => {
      assert.throws(() => comprobarReferenciasVigentes(raiz), new RegExp(`tarea OIT ${tarea} ausente`, 'u'));
      comprobarReferenciaHistorica(raiz);
    },
  );
  conCopia(
    (raiz) => {
      const banco = leerJson(raiz, `${CARPETA_BANCO}personas.json`) as {
        personas: { entrada: { necesidad: { tareas: { id: string }[]; tareaObjetivo: string } } }[];
      };
      const primera = banco.personas[0]?.entrada.necesidad;
      assert.ok(primera);
      const otra = primera.tareas.findIndex((t) => t.id !== primera.tareaObjetivo);
      assert.ok(otra >= 0);
      primera.tareas[otra] = { ...primera.tareas[otra], id: 'tarea-inexistente' };
      escribirJson(raiz, `${CARPETA_BANCO}personas.json`, banco);
    },
    (raiz) => {
      assert.throws(() => comprobarReferenciasVigentes(raiz), /tarea OIT tarea-inexistente ausente/u);
      assert.throws(() => comprobarReferenciaHistorica(raiz), /personas\.json/u);
    },
  );
});

test('alterar la referencia histórica protegida hace fallar su comprobación', () => {
  const alteraciones: [string, (raiz: URL) => void, RegExp][] = [
    [
      'huella del catálogo histórico sustituida',
      (raiz) => {
        const procedencia = leerJson(raiz, `${CARPETA_BANCO}procedencia.json`) as { catalogo: Json };
        procedencia.catalogo['datos/formacion.json'] = huella(raiz, 'datos/formacion.json').replace(/^./u, '0');
        escribirJson(raiz, `${CARPETA_BANCO}procedencia.json`, procedencia);
      },
      /procedencia\.json/u,
    ],
    [
      'expectativa retirada de un perfil',
      (raiz) => {
        const banco = leerJson(raiz, `${CARPETA_BANCO}personas.json`) as { personas: { expectativas: string[] }[] };
        banco.personas[0]?.expectativas.pop();
        escribirJson(raiz, `${CARPETA_BANCO}personas.json`, banco);
      },
      /personas\.json/u,
    ],
    [
      'regla del contrato cambiada',
      (raiz) => writeFileSync(new URL(`${CARPETA_BANCO}contrato.json`, raiz), ' ', { flag: 'a' }),
      /contrato\.json/u,
    ],
    [
      'instantánea de anclajes cambiada',
      (raiz) => writeFileSync(new URL(`${CARPETA_BANCO}anclajes.json`, raiz), ' ', { flag: 'a' }),
      /anclajes\.json/u,
    ],
    [
      'banco 240 cambiado',
      (raiz) => writeFileSync(new URL('pruebas/datos/banco-hoja-240/personas.json', raiz), ' ', { flag: 'a' }),
      /banco-240/u,
    ],
  ];
  for (const [caso, alterar, mensaje] of alteraciones) {
    conCopia(alterar, (raiz) => assert.throws(() => comprobarReferenciaHistorica(raiz), mensaje, caso));
  }
});
