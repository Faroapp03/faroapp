// Ensayo: el presupuesto de rendimiento de cada escenario en una primera visita con perfil limpio, por navegador y por
// condición (escritorio sin limitar, segunda visita en escritorio, móvil con 4G lenta y móvil con 3G). Mide, sin
// ningún techo que falle:
// (a) cuatro hitos (presupuesto-medida.mjs): interfaz usable, primer análisis completo (recorridos), copia web lista
//     y copia completa lista, cada uno con su tiempo y lo pedido y servido hasta él;
// (b) datos: bytes servidos (con la compresión del servidor del ensayo) y sin comprimir, por petición, por vía y por
//     tipo de contenido, con el texto servido sin comprimir y lo que se comprime con poca ganancia;
// (c) peticiones reales al servidor y direcciones distintas, por vía, el JavaScript con el criterio de
//     descargas-js.mjs y, en Chromium, lo que ve el contexto, solo como contraste;
// (d) duplicaciones: el mismo contenido bajo direcciones distintas y las direcciones pedidas más de una vez.
// Con varias construcciones, la primera es la referencia y se escribe además la tabla de diferencias de las demás;
// todas se preparan antes de medir ninguna, para que la preparación de una no coincida con la medida de otra.
// La portada y el acceso los sirve el Worker oficial de cada construcción medida (de destino oficial, con su Worker
// privado al lado, de su misma revisión y VERSION: `--worker-privado nombre=<dist>`, uno por construcción); sin él,
// esos dos escenarios fallan. El JSON y el resumen se escriben en un temporal de su carpeta y se renombran.
// El servidor del ensayo (presupuesto-servidor.mjs) se pone delante del fixture con HTTPS, compresión y la red de la
// condición. Solo falla si el servidor falla, si el navegador no llega con la identidad esperada o si sin red
// limitada la interfaz o el primer análisis no llegan (la medición no valdría).
//
//   node pruebas/navegadores/presupuesto-rendimiento.mjs --artefacto referencia=<dist> [--artefacto mejora=<dist>] \
//     [--worker-privado nombre=<dist> …] [--motor chromium …] [--condicion escritorio|segunda-visita|movil-4g-lenta|movil-3g …]
//     [--escenario inicio …] [--salida <carpeta>]
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { argumentos, servible, workerPrivadoDe } from './paquete-comun.mjs';
import { arrancarCon, CONDICIONES, DISPOSITIVO } from './presupuesto-condiciones.mjs';
import { esJavaScriptDelServidor } from './presupuesto-criterios.mjs';
import { escenarioMedido } from './presupuesto-ejecucion.mjs';
import { ESCENARIOS } from './presupuesto-medida.mjs';
import {
  ANTICIPACION_MS,
  ARRANQUE_MS,
  CIERRE_DEL_ESCENARIO_MS,
  CIERRE_DEL_NAVEGADOR_MS,
  cerrarAcotado,
  descendientesConOrden,
  ESTADO,
  limiteDeEjecucion,
  MARGEN_DE_CIERRE_MS,
  matarArbol,
  PREPARACION_MS,
  SALIDA_POR_CIERRE_FORZADO,
  SALIDA_POR_LIMITE_DE_EJECUCION,
} from './presupuesto-plazo.mjs';
import { comparacionMarkdown, resumenMarkdown } from './presupuesto-resumen.mjs';
import { ahora, precomprimir } from './presupuesto-servidor.mjs';

const normalizar = (nombre) => nombre.replaceAll('-', ' ');
const opciones = argumentos({
  'worker-privado': { type: 'string', multiple: true },
  condicion: { type: 'string', multiple: true },
  escenario: { type: 'string', multiple: true },
});
const condiciones = opciones.condicion ?? Object.keys(CONDICIONES);
for (const condicion of condiciones) {
  assert.ok(condicion in CONDICIONES, `Condición desconocida: ${condicion}`);
}
const elegidos = new Set((opciones.escenario ?? ESCENARIOS.map((e) => e.nombre)).map(normalizar));
const escenarios = ESCENARIOS.filter((e) => elegidos.delete(e.nombre));
assert.deepEqual([...elegidos], [], 'Escenarios desconocidos');

const salida = opciones.salida;
if (salida) {
  mkdirSync(salida, { recursive: true });
}
const construcciones = {};
/** Lo abierto que el vencimiento de la ejecución tiene que cerrar: `[nombre, cerrar]`. */
const abiertos = new Map();
const inicioDeEjecucion = ahora();
/** La fase en curso, que el JSON lleva siempre: preparación, arranque, escenario o cierre. */
let fase = 'inicio';
const LIMITE_DE_EJECUCION_MS = limiteDeEjecucion(
  {
    construcciones: opciones.artefactos.length,
    motores: opciones.motores.length,
    limitesDeCondicion: condiciones.map((c) => CONDICIONES[c].limiteTotalMs),
    escenarios: escenarios.length,
  },
  {
    preparacionMs: PREPARACION_MS,
    arranqueMs: ARRANQUE_MS,
    cierreDelEscenarioMs: CIERRE_DEL_ESCENARIO_MS,
    cierreDelNavegadorMs: CIERRE_DEL_NAVEGADOR_MS,
  },
);
/** Escribe `texto` en `ruta` sin dejarla nunca a medias: en un temporal de la misma carpeta, que después se renombra. */
function escribir(ruta, texto) {
  const temporal = `${ruta}.${process.pid}.tmp`;
  writeFileSync(temporal, texto);
  renameSync(temporal, ruta);
}
/** Escribe el JSON y el resumen de una construcción con lo medido hasta ahora (tras cada navegador y al final). */
function guardar(documento) {
  documento.fin = new Date().toISOString();
  if (salida) {
    escribir(join(salida, `presupuesto-${documento.nombre}.json`), `${JSON.stringify(documento, null, 1)}\n`);
    escribir(join(salida, `presupuesto-${documento.nombre}.md`), resumenMarkdown(documento));
  }
  const todas = Object.values(construcciones);
  if (salida && todas.length > 1) {
    escribir(join(salida, 'presupuesto-comparacion.md'), comparacionMarkdown(todas));
  }
}
/** Cada cuánto se anota el árbol de procesos del arnés. */
const RECORRIDO_DEL_ARBOL_MS = 1000;
/** Los procesos vistos colgando del arnés (PID → orden), para terminarlos aunque su padre los deje huérfanos. */
const conocidos = new Map();
function anotarArbol() {
  for (const [pid, orden] of descendientesConOrden(process.pid)) {
    conocidos.set(pid, orden);
  }
}
setInterval(anotarArbol, RECORRIDO_DEL_ARBOL_MS).unref();
/** Cambia de fase la ejecución y el documento de la construcción en curso, anota el árbol de procesos y lo escribe. */
function entrarEn(nueva, documento) {
  fase = nueva;
  anotarArbol();
  documento.fase = nueva;
  guardar(documento);
}
/** Termina con SIGKILL los procesos que sigan colgando del arnés (navegadores, servidores hijos) y lo anota. */
function limpiarArbol() {
  const terminados = matarArbol(process.pid, conocidos);
  for (const documento of Object.values(construcciones)) {
    documento.limpieza = { fase, procesosTerminados: terminados };
    guardar(documento);
  }
}
/** Sale con `codigo` sin dejar ningún proceso del arnés vivo. */
function terminar(codigo) {
  limpiarArbol();
  process.exit(codigo);
}
after(() => {
  clearTimeout(vigilanteDeEjecucion);
  limpiarArbol();
});

/**
 * El vigilante de la ejecución completa, armado antes de preparar nada: al vencer, escribe lo medido con la fase en
 * que estaba, cierra lo abierto dentro del margen de cierre, termina el árbol de procesos y sale con
 * SALIDA_POR_LIMITE_DE_EJECUCION.
 */
const vigilanteDeEjecucion = setTimeout(async () => {
  anotarArbol();
  for (const documento of Object.values(construcciones)) {
    documento.limiteDeEjecucionVencido = { fase, usadoMs: Math.round(ahora() - inicioDeEjecucion) };
    guardar(documento);
  }
  const cierre = await cerrarAcotado([...abiertos], MARGEN_DE_CIERRE_MS);
  for (const documento of Object.values(construcciones)) {
    documento.limiteDeEjecucionVencido.cierre = cierre;
  }
  terminar(SALIDA_POR_LIMITE_DE_EJECUCION);
}, LIMITE_DE_EJECUCION_MS);
vigilanteDeEjecucion.unref();

/**
 * El vigilante del cierre: si lo que sigue abierto no se cierra dentro de `ms`, escribe lo medido y termina el proceso
 * (Playwright cierra al salir los navegadores que lanzó). Devuelve con qué soltarlo.
 */
function vigilarCierre(ms, motivo) {
  const vigilante = setTimeout(() => {
    for (const documento of Object.values(construcciones)) {
      documento.cierreForzado = motivo;
      guardar(documento);
    }
    terminar(SALIDA_POR_CIERRE_FORZADO);
  }, ms);
  return () => clearTimeout(vigilante);
}

// Cortado desde fuera, lo medido hasta entonces queda escrito con la señal que lo cortó.
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.once(senal, () => {
    for (const documento of Object.values(construcciones)) {
      documento.interrumpido = senal;
      guardar(documento);
    }
    terminar(SALIDA_POR_CIERRE_FORZADO);
  });
}

const nombres = opciones.artefactos.map(({ nombre }) => nombre);
assert.equal(new Set(nombres).size, nombres.length, 'Cada --artefacto lleva un nombre distinto');
// Todas las construcciones se preparan antes de registrar ninguna medida: node:test empieza a medir en cuanto se
// registra la primera, y la preparación de otra (la compresión Brotli incluida) coincidiría con ella.
const preparadas = [];
for (const { nombre, carpeta } of opciones.artefactos) {
  const documento = {
    nombre,
    carpeta,
    fase,
    inicio: new Date().toISOString(),
    node: process.version,
    dispositivoMovil: DISPOSITIVO,
    criterioJavaScript: String(esJavaScriptDelServidor),
    condiciones: Object.fromEntries(condiciones.map((c) => [c, CONDICIONES[c]])),
    plazo: {
      limiteTotalMs: Object.fromEntries(condiciones.map((c) => [c, CONDICIONES[c].limiteTotalMs])),
      anticipacionMs: ANTICIPACION_MS,
      margenDeCierreMs: MARGEN_DE_CIERRE_MS,
      cierreDelEscenarioMs: CIERRE_DEL_ESCENARIO_MS,
      cierreDelNavegadorMs: CIERRE_DEL_NAVEGADOR_MS,
      salidaPorCierreForzado: SALIDA_POR_CIERRE_FORZADO,
      limiteDeEjecucionMs: LIMITE_DE_EJECUCION_MS,
      preparacionMs: PREPARACION_MS,
      arranqueMs: ARRANQUE_MS,
      salidaPorLimiteDeEjecucion: SALIDA_POR_LIMITE_DE_EJECUCION,
      estados: Object.values(ESTADO),
    },
    navegadores: {},
    resultados: {},
  };
  construcciones[nombre] = documento;
  entrarEn(`preparación ${nombre}`, documento);
  const construccion = await servible(carpeta, workerPrivadoDe(opciones['worker-privado'], nombre, nombres), {
    mismaRevision: true,
  });
  const { oficial, privado } = construccion;
  documento.servidorDeArriba = construccion.servidor;
  documento.workers = {
    oficial: oficial
      ? {
          ruta: oficial.ruta,
          sha256: oficial.sha256,
          carpeta: oficial.carpeta,
          sha256Artefacto: oficial.sha256Artefacto,
        }
      : null,
    privado: privado
      ? {
          ruta: privado.ruta,
          sha256: privado.sha256,
          carpeta: privado.carpeta,
          sha256Artefacto: privado.sha256Artefacto,
          revisionCodigo: privado.revisionCodigo,
          version: privado.version,
        }
      : null,
  };
  documento.precompresion = await precomprimir(construccion.artefacto);
  guardar(documento);
  preparadas.push({ nombre, documento, construccion });
}

for (const { nombre, documento, construccion } of preparadas) {
  for (const nombreCondicion of condiciones) {
    documento.resultados[nombreCondicion] = {};
    for (const motor of opciones.motores) {
      test(`presupuesto de ${nombre} en ${motor}, ${nombreCondicion}`, async (t) => {
        entrarEn(`arranque ${motor} · ${nombreCondicion}`, documento);
        const sesion = await arrancarCon(motor, CONDICIONES[nombreCondicion]);
        abiertos.set(`navegador ${motor}`, () => sesion.cerrar());
        const porEscenario = {};
        documento.resultados[nombreCondicion][motor] = porEscenario;
        documento.navegadores[motor] = sesion.navegador.version();
        try {
          for (const escenario of escenarios) {
            const limite = CONDICIONES[nombreCondicion].limiteTotalMs;
            entrarEn(`escenario ${escenario.nombre}`, documento);
            const soltar = vigilarCierre(limite + MARGEN_DE_CIERRE_MS, `escenario ${escenario.nombre}`);
            try {
              await t.test(escenario.nombre, () =>
                escenarioMedido({ sesion, motor, servible: construccion, nombreCondicion }, escenario, (medida) => {
                  porEscenario[escenario.nombre] = medida;
                  guardar(documento);
                }),
              );
            } finally {
              soltar();
            }
          }
        } finally {
          entrarEn(`cierre ${motor}`, documento);
          const soltar = vigilarCierre(CIERRE_DEL_NAVEGADOR_MS, `navegador ${motor}`);
          const cierre = await cerrarAcotado([['navegador', () => sesion.cerrar()]], CIERRE_DEL_NAVEGADOR_MS);
          soltar();
          abiertos.delete(`navegador ${motor}`);
          documento.cierreDelNavegador ??= {};
          documento.cierreDelNavegador[`${nombreCondicion} · ${motor}`] = cierre;
          // Lo que el navegador deje vivo (procesos auxiliares huérfanos) mantendría vivo el proceso: se termina aquí.
          limpiarArbol();
        }
      });
    }
  }
}
