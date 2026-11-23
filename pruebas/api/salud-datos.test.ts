import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { CONSULTA_SALUD, instantaneaSaludV4, operacionSalud, v4ConFormacionAbierta } from '../ayudas/salud-datos.ts';

const VERSION_CATALOGO = 4;

test('v4 conserva hechos, metadatos e inmutabilidad y excluye candidatas del resumen operativo', () => {
  const leido = leerEstadoDatosPanel(instantaneaSaludV4());
  assert.equal(leido.version, VERSION_CATALOGO);
  assert.ok(Object.isFrozen(leido));
  const salud = resumirSaludDatos(leido);
  assert.equal(salud.operativas.length, 1);
  assert.equal(salud.otras.length, 1);
  assert.equal(salud.otras[0]?.estado, 'candidata');
  assert.equal(salud.operativas[0]?.estado, 'comprobada');
  assert.equal(salud.temas[0]?.tema, 'mercado');
  assert.equal(salud.operativas[0]?.comprobaciones[0]?.fecha, CONSULTA_SALUD);
});

test('un fallo remoto no desaparece tras reconstruir correctamente y conserva comprobación anterior', () => {
  const base = instantaneaSaludV4();
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    ultimoIntentoRemotoEn: '2026-10-23T10:00:00Z',
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  const local = operacionSalud({
    ...fallo,
    remoto: false,
    inicioEn: '2026-10-23T11:00:00Z',
    finEn: '2026-10-23T11:01:00Z',
    resultado: 'local',
  });
  const datos = instantaneaSaludV4({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: local })),
    comprobaciones: { ...base.comprobaciones, registradoEn: local.finEn },
    seguimientoRemoto: [
      { fuente: 'empresas', ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] },
    ],
  });
  const [fuente] = resumirSaludDatos(leerEstadoDatosPanel(datos)).operativas;
  assert.equal(fuente?.estado, 'incidencia');
  assert.equal(fuente?.ultimaConsulta, fallo.inicioEn);
  assert.equal(fuente?.resultadoConsulta, 'fallo');
  assert.equal(fuente?.comprobaciones[0]?.fecha, CONSULTA_SALUD);
});

test('el intervalo vence la consulta prevista, no la validez del dato ni una oferta', () => {
  const datos = instantaneaSaludV4({ observadoEn: '2026-11-21T00:00:00.000000Z' });
  const [fuente] = resumirSaludDatos(leerEstadoDatosPanel(datos)).operativas;
  assert.equal(fuente?.estado, 'pendiente');
  assert.equal(fuente?.proximasConsultas[0]?.fecha, '2026-11-21T00:00:00.000Z');
  assert.match(fuente?.mensaje ?? '', /no declara que el dato sea incorrecto/);
});

test('revisión manual y externa no equivalen a fallo de descarga ni se vuelven verdes', () => {
  const base = instantaneaSaludV4();
  const datos = instantaneaSaludV4({
    comprobaciones: {
      ...base.comprobaciones,
      conjuntos: base.comprobaciones.conjuntos.map((c) => ({
        ...c,
        alcance: 'edicion-conocida',
        revisionNecesaria: true,
      })),
    },
    catalogoFuentes: [
      ...base.catalogoFuentes,
      { id: 'externa', nombre: 'Revisión externa de prueba', tema: 'ia_y_trabajo', modalidad: 'productor-externo' },
    ],
  });
  const salud = resumirSaludDatos(leerEstadoDatosPanel(datos));
  assert.equal(salud.operativas[0]?.estado, 'revision');
  assert.equal(salud.otras.find((f) => f.id === 'externa')?.estado, 'externa');
});

test('seguimiento desconocido legado no se inventa como éxito ni se deduce del último intento', () => {
  const base = instantaneaSaludV4();
  const local = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    remoto: false,
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    resultado: 'local',
    huellaEvidencia: null,
  });
  const datos = instantaneaSaludV4({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: local })),
    comprobaciones: { ...base.comprobaciones, registradoEn: local.finEn },
    seguimientoRemoto: null,
  });
  const [fuente] = resumirSaludDatos(leerEstadoDatosPanel(datos)).operativas;
  assert.equal(fuente?.estado, 'sin-observacion');
  assert.equal(fuente?.resultadoConsulta, null);
});

test('contrato v4 rechaza temas, modalidades, controles y pertenencias manipuladas', () => {
  const base = instantaneaSaludV4();
  for (const cambio of [
    { tema: 'inventado' },
    { modalidad: 'otra' },
    { nombre: 'Nombre\u0000oculto' },
    { modalidad: 'candidata' },
  ]) {
    assert.throws(() =>
      leerEstadoDatosPanel({
        ...base,
        catalogoFuentes: base.catalogoFuentes.map((f) => (f.id === 'empresas' ? { ...f, ...cambio } : f)),
      }),
    );
  }
  assert.throws(() =>
    leerEstadoDatosPanel({ ...base, catalogoFuentes: [...base.catalogoFuentes, ...base.catalogoFuentes] }),
  );
  let ejecutado = false;
  const maliciosa = { ...base };
  Object.defineProperty(maliciosa, 'catalogoFuentes', {
    get() {
      ejecutado = true;
      return base.catalogoFuentes;
    },
  });
  assert.throws(() => leerEstadoDatosPanel(maliciosa));
  assert.equal(ejecutado, false);
});

test('una consulta aún abierta no se vuelve verde por una comprobación anterior', () => {
  const base = instantaneaSaludV4();
  const remota = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T09:00:00Z',
    finEn: null,
    resultado: 'en-curso',
    ultimoIntentoRemotoEn: '2026-10-23T09:00:00Z',
    huellaEvidencia: null,
  });
  const datos = instantaneaSaludV4({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: remota })),
    comprobaciones: { ...base.comprobaciones, registradoEn: remota.inicioEn },
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento: remota, incidenciasPendientes: [] }],
  });
  assert.equal(resumirSaludDatos(leerEstadoDatosPanel(datos)).operativas[0]?.estado, 'pendiente');
});

test('el tema no tapa una fuente sin observación con otra comprobada', () => {
  const base = instantaneaSaludV4();
  const [fuente] = base.fuentes;
  const [modulo] = base.modulos;
  const [conjunto] = base.comprobaciones.conjuntos;
  assert.ok(fuente && modulo && conjunto);
  const datos = instantaneaSaludV4({
    fuentes: [...base.fuentes, { ...fuente, id: 'otra', ultimaOperacion: null }],
    modulos: [...base.modulos, { ...modulo, id: 'otra' }],
    catalogoFuentes: [
      ...base.catalogoFuentes,
      { id: 'otra', nombre: 'Otra fuente', tema: 'mercado', modalidad: 'operativa' },
    ],
    comprobaciones: {
      ...base.comprobaciones,
      conjuntos: [
        ...base.comprobaciones.conjuntos,
        { ...conjunto, id: 'otra', fuente: 'otra', ultimaComprobacion: null },
      ],
    },
    seguimientoRemoto: [
      ...(base.seguimientoRemoto ?? []),
      { fuente: 'otra', ultimoIntento: null, incidenciasPendientes: [] },
    ],
  });
  const salud = resumirSaludDatos(leerEstadoDatosPanel(datos));
  assert.equal(salud.operativas[0]?.estado, 'comprobada');
  assert.equal(salud.operativas[1]?.estado, 'sin-observacion');
  assert.equal(salud.temas[0]?.estado, 'sin-observacion');
  assert.equal(salud.global, 'sin-observacion');
});

test('el global de comprobaciones hereda rojo y ámbar sin contar candidatas', () => {
  const base = instantaneaSaludV4();
  for (const [veredicto, estado] of [
    ['rojo', 'atencion'],
    ['ámbar', 'incidencia'],
  ] as const) {
    const datos = instantaneaSaludV4({
      modulos: base.modulos.map((m) =>
        m.id === 'empresas'
          ? { ...m, veredicto, ultimoIntento: CONSULTA_SALUD, fallos: 1, proximoReintento: '2026-10-24T10:00:00Z' }
          : m,
      ),
    });
    const salud = resumirSaludDatos(leerEstadoDatosPanel(datos));
    assert.equal(salud.global, estado);
    assert.equal(salud.global, salud.temas[0]?.estado);
    assert.equal(salud.operativas.length, 1);
    assert.equal(salud.otras[0]?.estado, 'candidata');
  }
  assert.equal(resumirSaludDatos(leerEstadoDatosPanel(base)).global, 'comprobada');
});

test('el global desconocido nunca se vuelve verde por una positiva de otra fuente o un éxito local', () => {
  const base = instantaneaSaludV4();
  const local = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    resultado: 'local',
    remoto: false,
    huellaEvidencia: null,
  });
  const datos = instantaneaSaludV4({
    fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: local })),
    comprobaciones: { ...base.comprobaciones, registradoEn: local.finEn },
    seguimientoRemoto: null,
  });
  assert.equal(resumirSaludDatos(leerEstadoDatosPanel(datos)).global, 'sin-observacion');
});

test('una consulta remota sin cierre seguida de una local es incoherente y se rechaza', () => {
  const base = instantaneaSaludV4();
  const remota = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: '2026-10-23T09:00:00Z',
    finEn: null,
    resultado: 'en-curso',
    ultimoIntentoRemotoEn: '2026-10-23T09:00:00Z',
    huellaEvidencia: null,
  });
  const local = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000003',
    inicioEn: '2026-10-23T10:00:00Z',
    finEn: '2026-10-23T10:01:00Z',
    resultado: 'local',
    remoto: false,
    ultimoIntentoRemotoEn: remota.inicioEn,
  });
  assert.throws(() =>
    leerEstadoDatosPanel(
      instantaneaSaludV4({
        fuentes: base.fuentes.map((f) => ({ ...f, ultimaOperacion: local })),
        comprobaciones: { ...base.comprobaciones, registradoEn: local.finEn },
        seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento: remota, incidenciasPendientes: [] }],
      }),
    ),
  );
});

test('en un estado v4 la revisión de Formación abierta sale de formacionAbiertaCaduca y solo para esa fuente', () => {
  const salud = resumirSaludDatos(leerEstadoDatosPanel(v4ConFormacionAbierta('2026-09-30')));
  const abierta = salud.operativas.find((fuente) => fuente.id === 'abierta');
  assert.deepEqual(abierta?.revisionPendiente, { fecha: '2026-09-30', vencida: true });
  assert.ok(salud.operativas.every((fuente) => fuente.id === 'abierta' || fuente.revisionPendiente === null));
});
