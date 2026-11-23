/** Evidencia de consulta y cobertura independiente del resultado de reconstrucción del módulo. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { type EstadoDatosPanelV2, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Documento = Mutable<EstadoDatosPanelV2>;
const CICLO = '11111111-1111-4111-8111-111111111111';
const ANTERIOR = '22222222-2222-4222-8222-222222222222';
const LONGITUD_HUELLA = 64;
const HUELLA = 'a'.repeat(LONGITUD_HUELLA);
const OTRA_HUELLA = 'b'.repeat(LONGITUD_HUELLA);
const INICIO = '2026-10-16T12:00:00.000001Z';
const FIN = '2026-10-16T12:00:00.000002Z';
const REGISTRO = '2026-10-16T12:00:00.000003Z';
const AHORA = '2026-10-16T12:00:00.000004Z';
const MAX_REGISTROS = 64;
const INTERVALO_FRACCIONARIO = 0.5;
const BASE: Documento = {
  version: 2,
  observadoEn: AHORA,
  fuentes: [
    {
      id: 'formacion',
      politica: 'mensual',
      fecha: '2026-10-01',
      plazoDias: 1,
      ultimaOperacion: {
        ciclo: CICLO,
        inicioEn: INICIO,
        finEn: FIN,
        resultado: 'comprobada',
        remoto: true,
        ultimoIntentoRemotoEn: INICIO,
        huellaEvidencia: HUELLA,
      },
    },
  ],
  modulos: ['formacion', 'paquete'].map((id) => ({
    id,
    ultimoIntento: null,
    veredicto: null,
    ultimaVersionBuena: null,
    fallos: 0,
    proximoReintento: null,
  })),
  formacionAbiertaCaduca: null,
  comprobaciones: {
    registradoEn: REGISTRO,
    reconstruccionPendiente: true,
    conjuntos: [
      {
        id: 'soc-oferta',
        fuente: 'formacion',
        alcance: 'catalogo-actual',
        operacion: 'descargar',
        intervaloDias: 1,
        revisionNecesaria: false,
        ultimaComprobacion: { fecha: FIN, ciclo: CICLO, huellaEvidencia: HUELLA },
      },
      {
        id: 'formacion-catalogos',
        fuente: 'formacion',
        alcance: 'copia-local',
        operacion: 'revision',
        intervaloDias: null,
        revisionNecesaria: true,
        ultimaComprobacion: null,
      },
      {
        id: 'externo',
        fuente: null,
        alcance: 'productor-externo',
        operacion: 'revision',
        intervaloDias: null,
        revisionNecesaria: true,
        ultimaComprobacion: null,
      },
    ],
  },
};
function documento(): Documento {
  return structuredClone(BASE);
}
function operacion(d: Documento) {
  const fila = d.fuentes[0]?.ultimaOperacion;
  assert.ok(fila);
  return fila;
}
function conjunto(d: Documento) {
  const fila = d.comprobaciones.conjuntos[0];
  assert.ok(fila);
  return fila;
}
function ultima(d: Documento) {
  const fila = conjunto(d).ultimaComprobacion;
  assert.ok(fila);
  return fila;
}
function rechazar(cambios: readonly ((d: Documento) => void)[]) {
  for (const cambiar of cambios) {
    const d = documento();
    cambiar(d);
    assert.throws(() => leerEstadoDatosPanel(d));
  }
}
function comprobarCongelado(valor: unknown): void {
  if (valor !== null && typeof valor === 'object') {
    assert.ok(Object.isFrozen(valor));
    for (const hijo of Object.values(valor)) {
      comprobarCongelado(hijo);
    }
  }
}

test('v2 conserva fechas, microsegundos, orden y todas las copias profundas congeladas', () => {
  const entrada = documento();
  const antes = JSON.stringify(entrada);
  const salida = leerEstadoDatosPanel(entrada);
  assert.equal(salida.version, 2);
  assert.equal(JSON.stringify(salida), antes);
  assert.deepEqual(salida, entrada);
  assert.notEqual(salida.fuentes[0], entrada.fuentes[0]);
  if (salida.version !== 2) {
    assert.fail('Se ha perdido el discriminante v2');
  }
  assert.notEqual(salida.comprobaciones.conjuntos[0]?.ultimaComprobacion, conjunto(entrada).ultimaComprobacion);
  comprobarCongelado(salida);
  ultima(entrada).huellaEvidencia = OTRA_HUELLA;
  assert.equal(salida.comprobaciones.conjuntos[0]?.ultimaComprobacion?.huellaEvidencia, HUELLA);
});

test('ausencia de registro conserva null sin fabricar evidencia del origen ni del módulo verde', () => {
  const d = documento();
  d.comprobaciones.registradoEn = null;
  d.comprobaciones.reconstruccionPendiente = false;
  for (const fuente of d.fuentes) {
    fuente.ultimaOperacion = null;
  }
  for (const fila of d.comprobaciones.conjuntos) {
    fila.ultimaComprobacion = null;
  }
  for (const modulo of d.modulos) {
    modulo.ultimoIntento = '2026-10-16T12:00:00Z';
    modulo.veredicto = 'verde';
    modulo.ultimaVersionBuena = { fecha: '2026-10-16T12:00:00Z', huella: HUELLA };
  }
  assert.deepEqual(leerEstadoDatosPanel(d), d);
  const conOperacion = structuredClone(d);
  conOperacion.fuentes = documento().fuentes;
  assert.throws(() => leerEstadoDatosPanel(conOperacion));
  assert.throws(() =>
    leerEstadoDatosPanel({ ...d, comprobaciones: { ...d.comprobaciones, reconstruccionPendiente: true } }),
  );
  const conUltima = structuredClone(d);
  conjunto(conUltima).ultimaComprobacion = ultima(documento());
  assert.throws(() => leerEstadoDatosPanel(conUltima));
});

test('fechas UTC aceptan segundos o seis decimales exactos sin normalizar la representación', () => {
  const d = documento();
  const instante = '2026-10-16T12:00:00Z';
  d.observadoEn = instante;
  d.comprobaciones.registradoEn = instante;
  operacion(d).inicioEn = instante;
  operacion(d).ultimoIntentoRemotoEn = '2026-10-16T12:00:00.000000Z';
  operacion(d).finEn = instante;
  ultima(d).fecha = '2026-10-16T12:00:00.000000Z';
  assert.deepEqual(leerEstadoDatosPanel(d), d);
  for (const fecha of [
    '2026-10-16T12:00:00.1Z',
    '2026-10-16T12:00:00.00001Z',
    '2026-10-16T12:00:00.0000000Z',
    '2026-10-16T12:00:00+00:00',
    '2026-02-30T12:00:00.000001Z',
    '2026-10-16T24:00:00Z',
    '0000-01-01T00:00:00Z',
  ]) {
    rechazar([
      (d) => {
        d.observadoEn = fecha;
      },
      (d) => {
        operacion(d).inicioEn = fecha;
      },
      (d) => {
        ultima(d).fecha = fecha;
      },
      (d) => {
        d.comprobaciones.registradoEn = fecha;
      },
    ]);
  }
});

test('cronología rechaza un solo microsegundo futuro en cada frontera', () => {
  rechazar([
    (d) => {
      d.comprobaciones.registradoEn = '2026-10-16T12:00:00.000005Z';
    },
    (d) => {
      operacion(d).inicioEn = '2026-10-16T12:00:00.000004Z';
      operacion(d).ultimoIntentoRemotoEn = operacion(d).inicioEn;
    },
    (d) => {
      operacion(d).finEn = '2026-10-16T12:00:00.000004Z';
      ultima(d).fecha = operacion(d).finEn as string;
    },
    (d) => {
      operacion(d).finEn = '2026-10-16T12:00:00Z';
    },
    (d) => {
      operacion(d).ultimoIntentoRemotoEn = FIN;
    },
    (d) => {
      operacion(d).ultimoIntentoRemotoEn = '2026-10-16T12:00:00Z';
    },
    (d) => {
      ultima(d).fecha = '2026-10-16T12:00:00.000004Z';
    },
    (d) => {
      ultima(d).fecha = REGISTRO;
    },
    (d) => {
      ultima(d).ciclo = ANTERIOR;
      ultima(d).fecha = FIN;
    },
  ]);
});

test('historial de ciclo anterior puede preceder una operación local o sin cerrar sin acreditar su ciclo', () => {
  for (const resultado of ['local', 'fallo', 'interrumpido', 'parcial', 'en-curso'] as const) {
    const d = documento();
    operacion(d).resultado = resultado;
    operacion(d).remoto = false;
    operacion(d).ultimoIntentoRemotoEn = '2026-10-15T12:00:00Z';
    operacion(d).huellaEvidencia = null;
    ultima(d).ciclo = ANTERIOR;
    ultima(d).fecha = '2026-10-16T12:00:00Z';
    if (resultado === 'en-curso') {
      operacion(d).finEn = null;
    }
    assert.deepEqual(leerEstadoDatosPanel(d), d);
  }
});

test('operación comprobada exige consulta remota, huella y al menos un conjunto del mismo ciclo', () => {
  rechazar([
    (d) => {
      operacion(d).remoto = false;
    },
    (d) => {
      operacion(d).huellaEvidencia = null;
    },
    (d) => {
      conjunto(d).ultimaComprobacion = null;
    },
    (d) => {
      ultima(d).ciclo = ANTERIOR;
      ultima(d).fecha = '2026-10-16T12:00:00Z';
    },
    (d) => {
      operacion(d).finEn = null;
    },
    (d) => {
      operacion(d).ultimoIntentoRemotoEn = null;
    },
  ]);
  const parcial = documento();
  operacion(parcial).resultado = 'parcial';
  assert.deepEqual(leerEstadoDatosPanel(parcial), parcial);
});

test('una comprobación vinculada comparte fuente, ciclo, fin y huella y excluye resultados locales o fallidos', () => {
  rechazar([
    (d) => {
      ultima(d).huellaEvidencia = OTRA_HUELLA;
    },
    (d) => {
      ultima(d).fecha = INICIO;
    },
    (d) => {
      operacion(d).resultado = 'local';
    },
    (d) => {
      operacion(d).resultado = 'fallo';
    },
    (d) => {
      operacion(d).resultado = 'interrumpido';
    },
    (d) => {
      operacion(d).resultado = 'parcial';
      operacion(d).remoto = false;
    },
    (d) => {
      operacion(d).resultado = 'en-curso';
      operacion(d).finEn = null;
      operacion(d).huellaEvidencia = null;
    },
    (d) => {
      const fuente = d.fuentes[0];
      assert.ok(fuente);
      fuente.ultimaOperacion = null;
    },
  ]);
});

test('en-curso exige fin y huella null, el resto de estados exige fin', () => {
  const d = documento();
  operacion(d).resultado = 'en-curso';
  operacion(d).finEn = null;
  operacion(d).huellaEvidencia = null;
  conjunto(d).ultimaComprobacion = null;
  assert.deepEqual(leerEstadoDatosPanel(d), d);
  assert.throws(() =>
    leerEstadoDatosPanel({ ...d, fuentes: [{ ...d.fuentes[0], ultimaOperacion: { ...operacion(d), finEn: FIN } }] }),
  );
  assert.throws(() =>
    leerEstadoDatosPanel({
      ...d,
      fuentes: [{ ...d.fuentes[0], ultimaOperacion: { ...operacion(d), huellaEvidencia: HUELLA } }],
    }),
  );
  for (const resultado of ['local', 'fallo', 'interrumpido', 'parcial', 'comprobada'] as const) {
    const otro = documento();
    operacion(otro).resultado = resultado;
    operacion(otro).finEn = null;
    assert.throws(() => leerEstadoDatosPanel(otro));
  }
});

test('política de revisión y cadencia corresponde exactamente a la operación y alcance declarados', () => {
  const d = documento();
  for (const alcance of ['edicion-conocida', 'contenido-actual-acotado', 'recurso-actual-sin-edicion'] as const) {
    conjunto(d).alcance = alcance;
    conjunto(d).revisionNecesaria = true;
    assert.deepEqual(leerEstadoDatosPanel(d), d);
    assert.throws(() =>
      leerEstadoDatosPanel({
        ...d,
        comprobaciones: { ...d.comprobaciones, conjuntos: [{ ...conjunto(d), revisionNecesaria: false }] },
      }),
    );
  }
  rechazar([
    (d) => {
      conjunto(d).intervaloDias = 0;
    },
    (d) => {
      conjunto(d).intervaloDias = null;
    },
    (d) => {
      conjunto(d).intervaloDias = -1;
    },
    (d) => {
      conjunto(d).intervaloDias = INTERVALO_FRACCIONARIO;
    },
    (d) => {
      conjunto(d).intervaloDias = Number.MAX_SAFE_INTEGER + 1;
    },
    (d) => {
      conjunto(d).revisionNecesaria = true;
    },
    (d) => {
      conjunto(d).operacion = 'revision';
    },
    (d) => {
      conjunto(d).operacion = 'integridad';
    },
    (d) => {
      conjunto(d).operacion = 'recomponer';
    },
  ]);
});

test('cobertura genérica exige IDs únicos, fuentes existentes y cada fuente representada sin fijar 45/48', () => {
  rechazar([
    (d) => {
      conjunto(d).fuente = 'desconocida';
    },
    (d) => {
      d.comprobaciones.conjuntos = d.comprobaciones.conjuntos.filter((fila) => fila.fuente === null);
    },
    (d) => {
      d.comprobaciones.conjuntos.push(conjunto(d));
    },
    (d) => {
      conjunto(d).id = '../fuente';
    },
    (d) => {
      conjunto(d).id = 'a'.repeat(MAX_REGISTROS + 1);
    },
    (d) => {
      d.comprobaciones.conjuntos = [];
    },
    (d) => {
      d.comprobaciones.conjuntos = Array.from({ length: MAX_REGISTROS + 1 }, (_, i) => ({
        ...conjunto(d),
        id: `conjunto_${i}`,
      }));
    },
  ]);
  const d = documento();
  conjunto(d).id = 'conjunto_nuevo-generico';
  assert.deepEqual(leerEstadoDatosPanel(d), d);
});

test('productor externo solo admite fuente null con revisión, alcance explícito y sin comprobación', () => {
  for (const cambios of [
    { operacion: 'integridad' },
    { alcance: 'copia-local' },
    { ultimaComprobacion: ultima(documento()) },
  ]) {
    const d = documento();
    const externo = d.comprobaciones.conjuntos.find((fila) => fila.fuente === null);
    assert.ok(externo);
    Object.assign(externo, cambios);
    assert.throws(() => leerEstadoDatosPanel(d));
  }
  rechazar([
    (d) => {
      conjunto(d).fuente = null;
    },
  ]);
});

test('objetos v2 son cerrados y rechazan tipos, UUID y huellas inválidos', () => {
  const d = documento();
  for (const entrada of [
    { ...d, version: 3 },
    { ...d, extra: true },
    { ...d, fuentes: [{ ...d.fuentes[0], ultimaOperacion: { ...operacion(d), ruta: '/privado' } }] },
    { ...d, comprobaciones: { ...d.comprobaciones, extra: true } },
    { ...d, comprobaciones: { ...d.comprobaciones, conjuntos: [{ ...conjunto(d), extra: true }] } },
    {
      ...d,
      comprobaciones: {
        ...d.comprobaciones,
        conjuntos: [{ ...conjunto(d), ultimaComprobacion: { ...ultima(d), extra: true } }],
      },
    },
  ]) {
    assert.throws(() => leerEstadoDatosPanel(entrada));
  }
  rechazar([
    (d) => {
      operacion(d).ciclo = '11111111-1111-1111-8111-111111111111';
    },
    (d) => {
      ultima(d).ciclo = 'sin-ciclo';
    },
    (d) => {
      operacion(d).huellaEvidencia = HUELLA.toUpperCase();
    },
    (d) => {
      ultima(d).huellaEvidencia = '';
    },
  ]);
});

test('lectores no ejecutan getters ni toJSON en discriminante o evidencia anidada', () => {
  const d = documento();
  let accesos = 0;
  const accesor = (valor: object, clave: string) =>
    Object.defineProperty({ ...valor }, clave, {
      enumerable: true,
      get() {
        accesos++;
        throw new Error('no ejecutar');
      },
    });
  for (const entrada of [
    accesor(d, 'version'),
    accesor(d, 'comprobaciones'),
    { ...d, fuentes: [{ ...d.fuentes[0], ultimaOperacion: accesor(operacion(d), 'inicioEn') }] },
    { ...d, comprobaciones: accesor(d.comprobaciones, 'conjuntos') },
    { ...d, comprobaciones: { ...d.comprobaciones, conjuntos: [accesor(conjunto(d), 'fuente')] } },
    {
      ...d,
      comprobaciones: {
        ...d.comprobaciones,
        conjuntos: [{ ...conjunto(d), ultimaComprobacion: accesor(ultima(d), 'fecha') }],
      },
    },
    {
      ...d,
      comprobaciones: {
        ...d.comprobaciones,
        toJSON() {
          accesos++;
          return {};
        },
      },
    },
    { ...d, comprobaciones: Object.assign(Object.create({ heredado: true }), d.comprobaciones) },
    { ...d, comprobaciones: { ...d.comprobaciones, [Symbol('oculto')]: true } },
    { ...d, comprobaciones: { ...d.comprobaciones, conjuntos: new Array(1) } },
  ]) {
    assert.throws(() => leerEstadoDatosPanel(entrada));
  }
  assert.equal(accesos, 0);
});

test('fixture compartida Python/Node/Worker conserva cobertura y revisión pendiente tras comprobación remota', () => {
  const entrada: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/estado-datos-v2.json', import.meta.url), 'utf8'),
  );
  const salida = leerEstadoDatosPanel(entrada);
  assert.deepEqual(salida, entrada);
  assert.equal(salida.version, 2);
  if (salida.version === 2) {
    assert.equal(salida.comprobaciones.conjuntos[0]?.revisionNecesaria, true);
    assert.equal(salida.comprobaciones.conjuntos[0]?.ultimaComprobacion?.ciclo, CICLO);
  }
});

test('tipos estrictos de campos nuevos y sus enums no se normalizan ni aceptan valores heredados', () => {
  const d = documento();
  const operaciones = [
    { resultado: 'verde' },
    { remoto: 1 },
    { ciclo: null },
    { inicioEn: null },
    { ultimoIntentoRemotoEn: 0 },
    { huellaEvidencia: 0 },
  ];
  for (const cambio of operaciones) {
    assert.throws(() =>
      leerEstadoDatosPanel({ ...d, fuentes: [{ ...d.fuentes[0], ultimaOperacion: { ...operacion(d), ...cambio } }] }),
    );
  }
  for (const cambio of [
    { alcance: 'otro' },
    { operacion: 'otra' },
    { revisionNecesaria: 1 },
    { fuente: false },
    { id: null },
  ]) {
    assert.throws(() =>
      leerEstadoDatosPanel({
        ...d,
        comprobaciones: { ...d.comprobaciones, conjuntos: [{ ...conjunto(d), ...cambio }] },
      }),
    );
  }
  for (const cambio of [{ registradoEn: 0 }, { reconstruccionPendiente: 0 }, { conjuntos: null }]) {
    assert.throws(() => leerEstadoDatosPanel({ ...d, comprobaciones: { ...d.comprobaciones, ...cambio } }));
  }
});

test('evidencia solo corresponde a descarga y productores externos no se asignan a una fuente local', () => {
  rechazar([
    (d) => {
      conjunto(d).operacion = 'revision';
      conjunto(d).intervaloDias = null;
      conjunto(d).revisionNecesaria = true;
    },
    (d) => {
      conjunto(d).operacion = 'integridad';
      conjunto(d).intervaloDias = null;
    },
    (d) => {
      conjunto(d).operacion = 'recomponer';
      conjunto(d).intervaloDias = null;
    },
    (d) => {
      conjunto(d).alcance = 'productor-externo';
    },
  ]);
});
