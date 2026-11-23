import './idiomas.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type {
  ConjuntoComprobacionDatos,
  EstadoDatosPanelV1,
  EstadoDatosPanelV2,
  OperacionFuenteDatos,
} from '../../src/administracion/estado-datos.js';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { mostrarEstadoDatos } from '../../web/administracion/vista-datos.js';
import { instantaneaSalud, v4ConFormacionAbierta } from '../ayudas/salud-datos.ts';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { fijarReloj } from './reloj-fijo.ts';

const OBSERVADO = '2026-10-17T12:00:00.123456Z';
const INICIO = '2026-10-17T11:00:00.000001Z';
const FIN = '2026-10-17T11:01:00.000002Z';
const HISTORICA = '2026-10-15T10:00:00.654321Z';
const LOCAL = '2026-10-16T09:00:00Z';
const CICLO = '00000000-0000-4000-8000-000000000001';
const CICLO_ANTERIOR = '00000000-0000-4000-8000-000000000002';
const LONGITUD_HUELLA = 64;
const HUELLA = 'a'.repeat(LONGITUD_HUELLA);
const COLUMNAS = ['Fuente', 'Preparación en Faro', 'Consulta oficial', 'Cobertura', 'Límites y revisión'];

function documentoV1(): EstadoDatosPanelV1 {
  return {
    version: 1,
    observadoEn: '2026-10-17T12:00:00Z',
    fuentes: [{ id: 'formacion', politica: 'mensual', fecha: '2026-09-01', plazoDias: 30 }],
    modulos: ['formacion', 'paquete'].map((id) => ({
      id,
      ultimoIntento: LOCAL,
      veredicto: 'verde',
      ultimaVersionBuena: { fecha: LOCAL, huella: HUELLA },
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
  };
}
function operacion(cambios: Partial<OperacionFuenteDatos> = {}): OperacionFuenteDatos {
  return {
    ciclo: CICLO,
    inicioEn: INICIO,
    finEn: FIN,
    resultado: 'parcial',
    remoto: true,
    ultimoIntentoRemotoEn: INICIO,
    huellaEvidencia: HUELLA,
    ...cambios,
  };
}
function conjunto(cambios: Partial<ConjuntoComprobacionDatos> = {}): ConjuntoComprobacionDatos {
  return {
    id: 'soc-oferta',
    fuente: 'formacion',
    alcance: 'catalogo-actual',
    operacion: 'descargar',
    intervaloDias: 1,
    revisionNecesaria: false,
    ultimaComprobacion: { fecha: HISTORICA, ciclo: CICLO_ANTERIOR, huellaEvidencia: HUELLA },
    ...cambios,
  };
}
function documentoV2(): EstadoDatosPanelV2 {
  const base = documentoV1();
  return {
    ...base,
    version: 2,
    observadoEn: OBSERVADO,
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: operacion() })),
    comprobaciones: {
      registradoEn: FIN,
      reconstruccionPendiente: true,
      conjuntos: [
        conjunto(),
        conjunto({
          id: 'formacion-catalogos',
          alcance: 'copia-local',
          operacion: 'revision',
          intervaloDias: null,
          revisionNecesaria: true,
          ultimaComprobacion: null,
        }),
        ...['ia_nacional', 'encuestas_isco4'].map((id) =>
          conjunto({
            id,
            fuente: null,
            alcance: 'productor-externo',
            operacion: 'revision',
            intervaloDias: null,
            revisionNecesaria: true,
            ultimaComprobacion: null,
          }),
        ),
      ],
    },
  };
}

test('v1 distingue reconstrucción correcta de evidencia oficial no disponible en la observación', (t) => {
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), documentoV1());
  const fila = destino.querySelector('tbody tr');
  assert.ok(fila);
  const [fuente, local, oficial, cobertura, limites] = fila.children;
  assert.match(fuente?.textContent ?? '', /formacion.*mensual.*2026-09-01/);
  assert.match(
    local?.textContent ?? '',
    /Último intento local: hace \d+ días, el 16 oct. 2026 a las 11:00 \(registro en UTC: 2026-10-16T09:00:00Z\).*Preparación correcta/,
  );
  assert.equal(oficial?.textContent, 'Evidencia de consulta oficial no disponible en esta observación.');
  assert.match(cobertura?.textContent ?? '', /no disponible en esta observación/);
  assert.match(limites?.textContent ?? '', /no permite determinar.*si hubo una consulta oficial/);
  assert.doesNotMatch(destino.textContent, /Todo actualizado|Sin consulta oficial|Comprobación correcta/);
});

test('v2 conserva las fechas originales y distingue operación, intento remoto e historial por conjunto', (t) => {
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), documentoV2());
  const fila = destino.querySelector('tbody tr');
  assert.ok(fila);
  const [fuente, local, oficial, cobertura, limites] = fila.children;
  assert.match(destino.textContent, /Estado consultado: [^(]+\(registro en UTC: 2026-10-17T12:00:00\.123456Z\)/);
  assert.match(
    destino.textContent,
    /Registro de comprobaciones: [^(]+\(registro en UTC: 2026-10-17T11:01:00\.000002Z\)/,
  );
  assert.match(oficial?.textContent ?? '', /Consulta incompleta/);
  // Cada fecha del detalle técnico conserva su registro original, marcado como UTC.
  const fechas = oficial?.textContent ?? '';
  assert.ok(fechas.includes(`(registro en UTC: ${INICIO}). Fin: `));
  assert.ok(fechas.includes(`(registro en UTC: ${FIN}).`));
  assert.match(
    fechas,
    new RegExp(`Último intento remoto: [^(]+\\(registro en UTC: ${INICIO.replaceAll('.', '\\.')}\\)\\.`, 'u'),
  );
  assert.match(
    fechas,
    new RegExp(
      `soc-oferta · Última comprobación oficial registrada: [^(]+\\(registro en UTC: ${HISTORICA.replaceAll('.', '\\.')}\\)\\.`,
      'u',
    ),
  );
  assert.match(oficial?.textContent ?? '', /formacion-catalogos.*Sin registro en esta observación/);
  assert.doesNotMatch(oficial?.textContent ?? '', /2026-09-01|2026-10-16T09:00:00Z|12:00:00/);
  assert.match(local?.textContent ?? '', /Preparación correcta/);
  assert.match(fuente?.textContent ?? '', /2026-09-01/);
  assert.match(cobertura?.textContent ?? '', /soc-oferta · catalogo-actual.*formacion-catalogos · copia-local/);
  assert.match(limites?.textContent ?? '', /Requiere revisión manual/);
  assert.match(destino.textContent, /preparación de datos pendiente.*no significa que esté en marcha/);
  assert.doesNotMatch(destino.textContent, /Todo actualizado/);
});

test('externos figuran con su alcance y revisión sin inventar fuentes ni módulos locales', (t) => {
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), documentoV2());
  const apartado = destino.querySelector('.productores-externos');
  assert.equal(apartado?.querySelector('h3')?.textContent, 'Productores externos');
  for (const id of ['ia_nacional', 'encuestas_isco4']) {
    assert.ok(apartado?.textContent.includes(`${id} · productor-externo`));
  }
  assert.match(apartado?.textContent ?? '', /no está automatizada.*Requiere revisión manual/);
  assert.equal(destino.querySelectorAll('tbody tr').length, 1);
  assert.doesNotMatch(destino.querySelector('tbody')?.textContent ?? '', /ia_nacional|encuestas_isco4/);
  assert.doesNotMatch(apartado?.textContent ?? '', /Preparación correcta|Último intento local/);
});

test('ausencia de registro v2 es ausencia observada y no éxito ni negación histórica', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = documentoV2();
  const datos: EstadoDatosPanelV2 = {
    ...base,
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: null })),
    comprobaciones: {
      registradoEn: null,
      reconstruccionPendiente: false,
      conjuntos: base.comprobaciones.conjuntos.map((entrada) => ({ ...entrada, ultimaComprobacion: null })),
    },
  };
  mostrarEstadoDatos(html(destino), datos);
  assert.match(destino.textContent, /Registro de comprobaciones: No disponible en esta observación/);
  assert.match(destino.textContent, /Sin operación registrada en esta observación/);
  assert.match(destino.textContent, /Última comprobación oficial registrada: Sin registro en esta observación/);
  assert.doesNotMatch(destino.textContent, /Todo actualizado|Consulta comprobada|Sin consulta oficial/);
});

test('estados registrados de operación no prometen actividad viva ni alteran las comprobaciones anteriores', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = documentoV2();
  const resultados = {
    'en-curso': 'En marcha según el registro; no garantiza que siga funcionando',
    interrumpido: 'Interrumpida',
    comprobada: 'Consulta correcta',
    parcial: 'Consulta incompleta',
    completa: 'Consulta completa; la fuente no lo cubre todo',
    fallo: 'Consulta fallida',
    local: 'Comprobación dentro de Faro, sin consultar la fuente oficial',
  };
  for (const resultado of Object.keys(resultados) as OperacionFuenteDatos['resultado'][]) {
    const op = operacion({
      resultado,
      remoto: resultado !== 'local',
      ultimoIntentoRemotoEn: resultado === 'local' ? HISTORICA : INICIO,
      finEn: resultado === 'en-curso' ? null : FIN,
      huellaEvidencia: resultado === 'en-curso' ? null : HUELLA,
    });
    const comprobacion =
      resultado === 'comprobada'
        ? { fecha: FIN, ciclo: CICLO, huellaEvidencia: HUELLA }
        : conjunto().ultimaComprobacion;
    const datos = {
      ...base,
      fuentes: base.fuentes.map((fuente) => ({ ...fuente, ultimaOperacion: op })),
      comprobaciones: { ...base.comprobaciones, conjuntos: [conjunto({ ultimaComprobacion: comprobacion })] },
    };
    mostrarEstadoDatos(html(destino), datos);
    assert.ok(destino.querySelector('tbody')?.textContent.includes(comprobacion?.fecha ?? ''));
    assert.ok(destino.textContent.includes(resultados[resultado]));
    assert.ok(destino.textContent.includes(`Consulta remota prevista en esta operación: ${op.remoto ? 'Sí' : 'No'}.`));
    assert.doesNotMatch(destino.textContent, /Consulta remota en esta operación:/);
    assert.doesNotMatch(destino.textContent, /Todo actualizado/);
  }
});

test('resultados locales fallidos y ausentes no se presentan como éxito de consulta oficial', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = documentoV1();
  for (const veredicto of ['ámbar', 'rojo', null] as const) {
    const modulos = base.modulos.map((modulo) => ({
      ...modulo,
      veredicto,
      ultimoIntento: veredicto === null ? null : LOCAL,
    }));
    mostrarEstadoDatos(html(destino), { ...base, modulos });
    assert.match(
      destino.textContent,
      /Se conserva la versión anterior|Requiere revisión|Sin resultado local registrado/,
    );
    assert.match(destino.textContent, /Evidencia de consulta oficial no disponible en esta observación/);
    assert.doesNotMatch(destino.textContent, /Preparación correcta|Consulta comprobada|Todo actualizado/);
    if (veredicto === null) {
      assert.match(destino.textContent, /Sin intento registrado/);
    }
  }
});

test('todos los alcances explican su límite y conservan la revisión exigida por el DTO', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = documentoV2();
  const alcances = [
    'edicion-conocida',
    'contenido-actual-acotado',
    'recurso-actual-sin-edicion',
    'serie-abierta',
    'descubre-edicion',
    'entradas-admitidas',
  ] as const;
  for (const alcance of alcances) {
    const revisionNecesaria = ['edicion-conocida', 'contenido-actual-acotado', 'recurso-actual-sin-edicion'].includes(
      alcance,
    );
    const entrada = conjunto({ alcance, revisionNecesaria });
    mostrarEstadoDatos(html(destino), { ...base, comprobaciones: { ...base.comprobaciones, conjuntos: [entrada] } });
    const fila = destino.querySelector('tbody tr');
    assert.ok(fila?.children[3]?.textContent.includes(alcance));
    assert.match(fila?.children[4]?.textContent ?? '', /No acredita|No identifica|se limita|Recomponer/);
    assert.equal(destino.textContent.includes('Requiere revisión manual'), revisionNecesaria);
  }
});

test('la tabla conserva semántica, región desplazable por teclado y limpieza al retirar datos', (t) => {
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), documentoV2());
  assert.equal(destino.querySelector('caption')?.textContent, 'Fuentes que consulta Faro');
  const cabeceras = destino.querySelectorAll('thead th');
  assert.deepEqual(
    cabeceras.map((entrada) => entrada.textContent),
    COLUMNAS,
  );
  assert.equal(
    cabeceras.every((entrada) => entrada.getAttribute('scope') === 'col'),
    true,
  );
  assert.equal(destino.querySelector('tbody th')?.getAttribute('scope'), 'row');
  const region = destino.querySelector('.tabla-datos');
  assert.equal(region?.getAttribute('role'), 'region');
  assert.equal(region?.getAttribute('tabindex'), '0');
  assert.match(region?.getAttribute('aria-label') ?? '', /tabla desplazable/);
  mostrarEstadoDatos(html(destino), null);
  assert.equal(destino.children.length, 0);
  assert.equal(destino.textContent, '');
});

test('los textos recibidos se insertan como texto y nunca se interpretan como HTML', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = documentoV2();
  const malicioso = '<img src=x onerror=alert(1)>';
  const datos = {
    ...base,
    observadoEn: malicioso,
    fuentes: base.fuentes.map((fuente) => ({ ...fuente, fecha: malicioso })),
    comprobaciones: { ...base.comprobaciones, conjuntos: [conjunto({ id: malicioso })] },
  };
  assert.throws(() => mostrarEstadoDatos(html(destino), datos), /Reloj de evaluación del mantenimiento no válido/);
  mostrarEstadoDatos(html(destino), { ...datos, observadoEn: base.observadoEn });
  assert.match(destino.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(destino.querySelector('img'), null);
});

test('v3 muestra fallo pendiente, positiva anterior y operación local sin ocultarlos tras verde', (t) => {
  instalar(t);
  const destino = nodo('div');
  const datos = leerEstadoDatosPanel(
    JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v3.json', import.meta.url), 'utf8')),
  );
  mostrarEstadoDatos(html(destino), datos);
  assert.match(destino.textContent, /Último resultado remoto conservado: Consulta fallida/);
  assert.match(destino.textContent, /Comprobación pendiente, iniciada [^(]+\(registro en UTC: 2026-10-16T12:00:10Z\)/);
  assert.match(destino.textContent, /Comprobación dentro de Faro, sin consultar la fuente oficial/);
  assert.match(
    destino.textContent,
    /Última comprobación oficial registrada: [^(]+\(registro en UTC: 2026-10-16T11:59:59.123456Z\)/,
  );
});

/** Las tarjetas de fuente pintadas, por el nombre visible de cada una. */
function tarjetaDe(destino: ReturnType<typeof nodo>, nombre: string) {
  return destino.querySelectorAll('.salud-fuentes .salud-fuente').find((n) => n.textContent.includes(nombre));
}

test('v4 ofrece resumen, filtros accesibles, candidatas aparte y la revisión de Formación abierta de su campo', (t) => {
  fijarReloj(t);
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), leerEstadoDatosPanel(v4ConFormacionAbierta('2026-09-30')));
  const tarjetas = destino.querySelectorAll('.salud-fuentes .salud-fuente');
  assert.equal(tarjetas.length, 2);
  assert.match(tarjetaDe(destino, 'Empresas y uso de IA')?.textContent ?? '', /● Comprobada/);
  // El aviso sale de `formacionAbiertaCaduca` y es solo de esa fuente.
  const revision =
    /La revisión de las fichas de Formación abierta está pendiente: venció hace 45 días, el 30 sept. 2026\./;
  assert.match(tarjetaDe(destino, 'Formación abierta')?.textContent ?? '', revision);
  assert.doesNotMatch(tarjetaDe(destino, 'Empresas y uso de IA')?.textContent ?? '', revision);
  assert.match(destino.querySelector('.salud-tema')?.textContent ?? '', /Mercado.*Comprobada/);
  assert.match(destino.textContent, /2 de 2 fuentes en uso/);
  assert.match(destino.textContent, /Fuente candidata de prueba.*○ En preparación/);
  assert.match(destino.textContent, /la versión publicada se comprueban aparte/);
  const detalle = destino.querySelector('.salud-detalle');
  assert.ok(detalle?.querySelector('table'));
  assert.equal(detalle?.getAttribute('open'), null);
  for (const id of ['salud-filtro-fuente', 'salud-filtro-estado']) {
    assert.ok(destino.querySelector(`label[for="${id}"]`));
  }
  const filtrar = (id: string, valor: string) => {
    const filtro = destino.querySelector(`#${id}`);
    assert.ok(filtro);
    Object.assign(filtro, { value: valor });
    filtro.dispatchEvent(new Event('change'));
  };
  filtrar('salud-filtro-estado', 'incidencia');
  assert.ok(tarjetas.every((tarjeta) => tarjeta.hidden));
  assert.match(destino.querySelector('[role="status"]')?.textContent ?? '', /0 de 2/);
  filtrar('salud-filtro-estado', '');
  assert.ok(tarjetas.every((tarjeta) => !tarjeta.hidden));
  filtrar('salud-filtro-fuente', 'otra');
  assert.ok(tarjetas.every((tarjeta) => tarjeta.hidden));
});

test('global y temas preceden a fuentes compactas con diagnóstico plegado y fechas conservadas', (t) => {
  instalar(t);
  const destino = nodo('div');
  mostrarEstadoDatos(html(destino), leerEstadoDatosPanel(instantaneaSalud()));
  const global = destino.querySelector('.salud-global');
  assert.ok(global);
  assert.match(global.textContent, /Estado global de las comprobaciones.*● Comprobada/);
  assert.doesNotMatch(global?.textContent ?? '', /sano|actualizado|entrega activa/);
  const tarjeta = destino.querySelector('.salud-fuentes .salud-fuente');
  assert.ok(tarjeta);
  const detalle = tarjeta.querySelector('.salud-fuente-detalle');
  assert.ok(detalle);
  assert.equal(detalle.tagName, 'DETAILS');
  assert.equal(detalle.getAttribute('open'), null);
  assert.equal(detalle.querySelector('summary')?.textContent, 'Diagnóstico y siguientes pasos');
  assert.match(detalle.textContent, /Qué hacer:.*Próxima consulta prevista/);
  assert.match(
    tarjeta.children
      .filter((n) => n !== detalle)
      .map((n) => n.textContent)
      .join(' '),
    /Empresas y uso de IA.*● Comprobada.*Última comprobación registrada/,
  );
  assert.doesNotMatch(
    tarjeta.children
      .filter((n) => n !== detalle)
      .map((n) => n.textContent)
      .join(' '),
    /Qué hacer:|Último intento de consulta|Resultado de esa consulta|Próxima consulta/,
  );
  const resumen = destino.querySelector('.salud-datos');
  assert.ok(resumen);
  const tema = destino.querySelector('.salud-temas');
  const fuentes = destino.querySelector('.salud-fuentes');
  assert.ok(tema && fuentes);
  assert.ok(resumen.children.indexOf(global) < resumen.children.indexOf(tema));
  assert.ok(resumen.children.indexOf(tema) < resumen.children.indexOf(fuentes));
});

test('el último resultado remoto conservado se pinta en toda versión que trae el seguimiento, también la 5 y la 6', (t) => {
  instalar(t);
  const v5 = instantaneaSalud();
  const retenidos = { cuarentena: { lectura: 'leida', cambios: [] }, censoSoc: { lectura: 'leida', pendiente: null } };
  for (const datos of [v5, { ...v5, version: 6, retenidos }]) {
    const destino = nodo('div');
    mostrarEstadoDatos(html(destino), leerEstadoDatosPanel(datos));
    const consulta = destino.querySelector('tbody tr')?.children[2];
    assert.match(
      consulta?.textContent ?? '',
      /Último resultado remoto conservado: Consulta correcta\./,
      `versión ${datos.version}`,
    );
  }
});
