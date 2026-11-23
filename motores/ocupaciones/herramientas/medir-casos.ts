// Mide caso a caso el motor de ocupaciones con el mismo servicio que usa la pantalla (pasoDePantalla).
//
// Cada simulación tiene una identidad coherente: para cada caso se simula una persona por cada grupo válido de la frase
// (una frase ambigua la puede escribir gente de varios oficios); esa persona responde todo como alguien de su grupo,
// solo acepta su grupo y solo acaba bien si termina en su grupo. Por caso guarda los candidatos ordenados y la primera
// pantalla; por persona, lo que ve, su recorrido completo y dos caminos más tras rechazar la primera propuesta.
//
// Uso: node motores/ocupaciones/herramientas/medir-casos.ts --salida resultado.json [--producto DIR] [--bancos DIR]
//      [--traza] [--sin-vectores] [--ruido personas] [--etiqueta nombre] [--limite N]
// Por omisión mide este producto con los tres bancos de motores/ocupaciones/banco/ (ver su README.md).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearAzar } from './medicion/azar.ts';
import { bancosMedidos, leerCasos } from './medicion/bancos.ts';
import { medirCaso } from './medicion/caso.ts';
import { cargarMotor } from './medicion/motor.ts';
import { leerOpciones } from './medicion/opciones.ts';
import { procedencia } from './medicion/procedencia.ts';
import type { Simulacion } from './medicion/respuestas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MILISEGUNDOS = 1000;
/** Las clases de la primera pantalla en que la persona ve su grupo. */
const CON_LA_SUYA = new Set(['propuesta_suya', 'alternativa_suya', 'opciones_con_la_suya']);

/** La huella del medidor: este archivo y sus módulos, en orden. */
function huellaDelMedidor(): string {
  const modulos = readdirSync(join(AQUI, 'medicion'))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => join(AQUI, 'medicion', f));
  const huella = createHash('sha256');
  for (const archivo of [fileURLToPath(import.meta.url), ...modulos]) {
    huella.update(readFileSync(archivo));
  }
  return huella.digest('hex');
}

interface PersonaMedida {
  readonly pantalla: string;
  readonly recorrido: { readonly final: string };
}

function resumen(etiqueta: string, sim: Simulacion, resultados: readonly object[], segundos: number): string {
  const personas = resultados.flatMap((r) => (r as { personas: PersonaMedida[] }).personas);
  const conLaSuya = personas.filter((p) => CON_LA_SUYA.has(p.pantalla)).length;
  const bien = personas.filter((p) => p.recorrido.final === 'bien').length;
  const vectores = sim.opciones.conVectores ? '' : ' (sin vectores)';
  return (
    `${etiqueta}${vectores}: ${resultados.length} casos y ${personas.length} personas en ${segundos} s · ` +
    `su grupo en la primera pantalla ${conLaSuya} · recorrido acaba en su grupo ${bien}`
  );
}

async function principal(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2), AQUI);
  const motor = await cargarMotor(opciones);
  const bancos = bancosMedidos(opciones);
  const clavesDeRuido = new Map(bancos.map((b) => [b.nombre, b.claveDeRuido]));
  const sim: Simulacion = { motor, opciones, azar: crearAzar(opciones.semilla), clavesDeRuido };
  const casos = leerCasos(motor.datos, bancos, opciones);
  const t0 = performance.now();
  const resultados = casos.map((caso) => medirCaso(sim, caso));
  const segundos = Math.round((performance.now() - t0) / MILISEGUNDOS);
  const base = procedencia(opciones, motor, bancos, { segundos, medidor: huellaDelMedidor() });
  if (opciones.salida) {
    writeFileSync(String(opciones.salida), JSON.stringify({ base, resultados }));
  }
  console.log(resumen(String(opciones.etiqueta), sim, resultados, segundos));
}

await principal();
