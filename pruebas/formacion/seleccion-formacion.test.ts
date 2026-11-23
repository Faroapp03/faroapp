// Casos sintéticos del contrato; no acreditan una oferta ni activan Cursos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EntregaCatalogo, OfertaCatalogo, ReferenciaEntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import indicadores from '../../src/catalogo-cursos/indicadores-tema.json' with { type: 'json' };
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { jsonCanonico } from '../../src/comun/jcs.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/comun/protocolo-web.ts';
import { responderFormacionLocal } from '../../src/plataforma/navegador/ruta-formacion.ts';
import type { AfirmacionAprendizaje, RevisionAprendizaje } from '../../src/seleccion-formacion/aprendizaje.ts';
import { cargarCompanero } from '../../src/seleccion-formacion/carga.ts';
import {
  AprendizajeNoValido,
  type CompaneroAprendizaje,
  type PreferenciasSeleccion,
} from '../../src/seleccion-formacion/contrato.ts';
import { leerCompanero } from '../../src/seleccion-formacion/lectura.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';

const REFERENCIA: ReferenciaEntregaCatalogo = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8'),
);
const BASE = leerCatalogo(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)),
  REFERENCIA,
);
const REGISTRO = readFileSync(
  new URL('../../plataforma_datos/cursos/esquemas/registro_aprendizaje.json', import.meta.url),
  'utf8',
);
const R: { id: string; version: string } = JSON.parse(REGISTRO);
const REG = { id: R.id, version: R.version, sha256: createHash('sha256').update(REGISTRO).digest('hex') };
const CIFRAS_SHA = 64;
const COSTE_POSITIVO = 4;
const AHORA = Date.parse('2026-10-22T11:00:00Z');
const REVISION: RevisionAprendizaje = {
  tipo: 'automatizada',
  referencia: 'fixture:sintetico',
  metodo: { nombre: 'fixture', version: '1' },
  fecha_utc: '2026-10-22T10:00:00Z',
};
const P: PreferenciasSeleccion = {
  etapa: 'inicial',
  idiomas: ['es'],
  modalidad: 'cualquiera',
  aceptaRegistro: true,
  requisitosConfirmados: [],
  excluidos: [],
};
function razon(texto: string) {
  return { es: texto, ca: texto };
}
function oferta(): OfertaCatalogo {
  const o = BASE.ofertas[0];
  assert.ok(o);
  const h = { ...o.hechos };
  for (const [campo, valor] of [
    ['coste_formacion_tipo', 'gratis_formacion'],
    ['coste_formacion', 0],
    ['requiere_registro_previo', true],
    ['idiomas_declarados', ['es']],
  ] as const) {
    h[campo] = { ...h[campo], valor, motivo: 'conocido' };
  }
  return { ...o, hechos: h };
}
function catalogo(o = oferta()): EntregaCatalogo {
  return { ...BASE, ofertas: [o] };
}
function afirmacion(id: string): AfirmacionAprendizaje {
  const ref = oferta().referencias[0];
  assert.ok(ref);
  return {
    id,
    competencia: null,
    dimension: 'resultado_previsto',
    descripcion: `Resultado ${id}`,
    nivel: { escala: null, valor: null },
    origen: 'extraccion_oficial',
    estado: 'extraida',
    metodo: { nombre: 'fixture', version: '1' },
    revision: null,
    evidencias: [
      {
        url: ref.url,
        capturado_utc: ref.fecha_referencia,
        sha256: ref.sha256,
        localizador: { tipo: 'objetivo', valor: 'body/lista/1' },
        fragmento: 'Texto sintético',
      },
    ],
    discrepancias: [],
    revision_requerida: false,
  };
}
function companero(): CompaneroAprendizaje {
  const id = oferta().unidad.programa_id;
  return {
    schema_version: 1,
    catalogo: REFERENCIA,
    registro: REG,
    registro_json: REGISTRO,
    fichas: [
      {
        programa_id: id,
        idioma_ficha: 'es',
        aprendizaje: {
          schema_version: 1,
          registro: REG,
          contenido_observado: true,
          afirmaciones: [afirmacion('sencilla'), afirmacion('privada')],
        },
        requisitos: 'no_publicados',
        cobertura: [
          {
            criterio: 'tarea_sencilla',
            afirmaciones: ['sencilla'],
            justificacion: razon('Práctica sencilla demostrada'),
            via: null,
          },
          {
            criterio: 'privacidad',
            afirmaciones: ['privada'],
            justificacion: razon('Privacidad demostrada'),
            via: null,
          },
        ],
        revision: REVISION,
      },
    ],
    caminos: [
      {
        id: 'camino-inicial',
        etapa: 'inicial',
        programas: [id],
        justificacion: razon('Orden revisado'),
        revision: REVISION,
      },
    ],
  };
}
function empaquetar(dato: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(dato));
  return { bytes, ref: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength } };
}
function leer(dato: unknown = companero()) {
  const { bytes, ref } = empaquetar(dato);
  return leerCompanero(bytes, ref, REFERENCIA, catalogo());
}
function cambiar(
  c: CompaneroAprendizaje,
  transformar: (a: AfirmacionAprendizaje) => AfirmacionAprendizaje,
): CompaneroAprendizaje {
  return {
    ...c,
    fichas: c.fichas.map((f) => ({
      ...f,
      aprendizaje: { ...f.aprendizaje, afirmaciones: f.aprendizaje.afirmaciones.map(transformar) },
    })),
  };
}

test('Lee el contrato nativo, conserva null y congela la instantánea sin fabricar niveles', () => {
  const c = leer();
  assert.equal(c.fichas[0]?.aprendizaje.afirmaciones[0]?.nivel.valor, null);
  assert.ok(Object.isFrozen(c.fichas[0]?.aprendizaje.afirmaciones));
  assert.equal(c.registro_json, REGISTRO);
});

function edicionConMateria(actividad: string): OfertaCatalogo {
  const base = oferta();
  const referencia = base.referencias[0];
  assert.ok(referencia);
  const captura = {
    url: referencia.url,
    sha256: referencia.sha256,
    capturado_utc: referencia.fecha_referencia,
    localizador: '/activities/0',
  };
  const programa_id = `cibernarium:${actividad}`;
  const id = `cibernarium-edicion:${actividad}`;
  return {
    ...base,
    unidad: { tipo: 'edicion', programa_id, id },
    titulo_programa: 'Taller práctico',
    proveedor_id: 'cibernarium',
    evidencia_materia: {
      version: 1,
      actividad_id: actividad,
      programa_id,
      edicion_id: id,
      vinculo: captura,
      contenido: {
        ...captura,
        metodo: 'cibernarium-descripcion-api-v1',
        sha256_captura: captura.sha256,
        temas_sugeridos: ['ia'],
        reglas_sha256: createHash('sha256').update(jsonCanonico(indicadores)).digest('hex'),
      },
      censo_ia: null,
      estado_censo: 'sin-evidencia',
    },
  };
}

test('las nuevas materias coinciden con los bloques del catálogo y por sí solas no forman un camino', () => {
  const primera = edicionConMateria('101');
  const segunda = edicionConMateria('102');
  const digital = { ...edicionConMateria('103'), titulo_programa: 'Excel práctico', evidencia_materia: null };
  const excluida = edicionConMateria('104');
  const idioma = edicionConMateria('105');
  const sinIdioma = {
    ...idioma,
    hechos: { ...idioma.hechos, idiomas_declarados: { ...idioma.hechos.idiomas_declarados, valor: null } },
  };
  const datos = {
    ...BASE,
    proveedores: [{ id: 'cibernarium', nombre: 'Cibernàrium' }],
    ofertas: [primera, segunda, digital, excluida, sinIdioma],
  };
  const preferencias = { ...P, excluidos: [excluida.unidad.programa_id] };
  const resultado = seleccionarFormacion(datos, leer(), preferencias, AHORA);
  // Un idioma que no consta no descarta el curso: se propone, detrás de los que lo publican, diciendo que falta.
  assert.deepEqual(
    resultado.opciones.ia.map((opcion) => opcion.oferta),
    [primera, segunda, sinIdioma],
  );
  assert.deepEqual(
    resultado.opciones.ia.map((opcion) => opcion.porConfirmar),
    [[], [], ['idioma']],
  );
  assert.deepEqual(
    resultado.opciones.digital.map((opcion) => opcion.oferta),
    [digital],
  );
  assert.equal(resultado.camino, null);
  assert.deepEqual(resultado.complementarios, []);
  assert.deepEqual(seleccionarFormacion(structuredClone(datos), leer(), preferencias, AHORA), resultado);
});
test('Entre dos ofertas del mismo programa, el camino toma aquella de la que consta todo', () => {
  const completa = oferta();
  const sinRegistro = {
    ...completa,
    unidad: { ...completa.unidad, id: `${completa.unidad.id}-sin-registro` },
    hechos: {
      ...completa.hechos,
      requiere_registro_previo: {
        ...completa.hechos.requiere_registro_previo,
        valor: null,
        motivo: 'no_consta_en_evidencia',
      },
    },
  } as OfertaCatalogo;
  const datos = { ...BASE, ofertas: [sinRegistro, completa] };
  assert.equal(seleccionarFormacion(datos, leer(), P, AHORA).camino?.recursos[0]?.oferta, completa);
  const soloSinRegistro = { ...BASE, ofertas: [sinRegistro] };
  assert.equal(seleccionarFormacion(soloSinRegistro, leer(), P, AHORA).camino?.recursos[0]?.oferta, sinRegistro);
});
test('Un camino parcial muestra el hueco, sin prometer completar una etapa', () => {
  const s = seleccionarFormacion(catalogo(), leer(), P, AHORA);
  assert.equal(s.estado, 'parcial');
  assert.deepEqual(s.huecos, ['contraste']);
  assert.equal(s.camino?.recursos.length, 1);
  assert.equal(s.camino?.completo, false);
});
test('Tres criterios probados completan la etapa sin consultar el título', () => {
  const c = companero();
  const f = c.fichas[0];
  assert.ok(f);
  const completo = {
    ...c,
    fichas: [
      {
        ...f,
        aprendizaje: { ...f.aprendizaje, afirmaciones: [...f.aprendizaje.afirmaciones, afirmacion('contrasta')] },
        cobertura: [
          ...f.cobertura,
          {
            criterio: 'contraste',
            afirmaciones: ['contrasta'],
            justificacion: razon('Contraste probado'),
            via: null,
          } as const,
        ],
      },
    ],
  };
  const o = { ...oferta(), titulo_programa: 'Sin nivel ni nombre temático' };
  assert.equal(seleccionarFormacion(catalogo(o), leer(completo), P, AHORA).estado, 'completa');
});
test('Una propuesta, discrepancia o revisión requerida no cubre ningún criterio', () => {
  for (const transformar of [
    (a: AfirmacionAprendizaje): AfirmacionAprendizaje => ({ ...a, origen: 'inferencia', estado: 'propuesta' }),
    (a: AfirmacionAprendizaje): AfirmacionAprendizaje => ({ ...a, revision_requerida: true }),
    (a: AfirmacionAprendizaje): AfirmacionAprendizaje => ({
      ...a,
      discrepancias: [{ descripcion: 'Pendiente', evidencias: a.evidencias }],
    }),
  ]) {
    const s = seleccionarFormacion(catalogo(), leer(cambiar(companero(), transformar)), P, AHORA);
    assert.equal(s.estado, 'sin_oferta');
    assert.deepEqual(s.huecos, ['tarea_sencilla', 'privacidad', 'contraste']);
  }
});
test('La inferencia revisada se identifica y no se convierte en declaración institucional', () => {
  const c = leer(cambiar(companero(), (a) => ({ ...a, origen: 'inferencia', estado: 'revisada', revision: REVISION })));
  const s = seleccionarFormacion(catalogo(), c, P, AHORA);
  assert.equal(s.estado, 'parcial');
  assert.equal(s.camino?.recursos[0]?.ficha.aprendizaje.afirmaciones[0]?.origen, 'inferencia');
});
test('Registro, SHA, catálogo distinto, captura ajena y campos extra se rechazan', () => {
  const c = companero();
  for (const invalido of [
    { ...c, servidor: 'externo' },
    { ...c, catalogo: { ...REFERENCIA, sha256: 'f'.repeat(CIFRAS_SHA) } },
    { ...c, registro_json: `${REGISTRO} ` },
    cambiar(c, (a) => ({ ...a, evidencias: a.evidencias.map((e) => ({ ...e, sha256: 'f'.repeat(CIFRAS_SHA) })) })),
    cambiar(c, (a) => ({ ...a, nivel: { escala: { id: 'Faro', version: '1' }, valor: 'Inicial' } })),
    cambiar(c, (a) => ({ ...a, revision: REVISION })),
  ]) {
    assert.throws(() => leer(invalido), AprendizajeNoValido);
  }
  const { bytes, ref } = empaquetar(c);
  assert.throws(() => leerCompanero(bytes.subarray(1), ref, REFERENCIA, catalogo()), AprendizajeNoValido);
});
test('Solo el límite publicado retira después de cargar; la antigüedad no, y un reloj inválido no simula vacío', () => {
  const o = oferta();
  const actual = seleccionarFormacion(catalogo(o), leer(), P, AHORA);
  assert.notEqual(actual.estado, 'sin_oferta');
  // Semanas sin entrega nueva: gratuidad, idioma y registro siguen acreditados.
  const tarde = seleccionarFormacion(catalogo(o), leer(), P, Date.parse('2026-12-20T10:00:00Z'));
  assert.equal(tarde.estado, actual.estado);
  assert.deepEqual(tarde.descartes, actual.descartes);
  const limite = '2026-11-02T10:00:00Z';
  const limitada = catalogo({ ...o, cierra_el: limite });
  assert.equal(seleccionarFormacion(limitada, leer(), P, Date.parse(limite) - 1).estado, actual.estado);
  assert.equal(seleccionarFormacion(limitada, leer(), P, Date.parse(limite)).estado, 'sin_oferta');
  assert.throws(() => seleccionarFormacion(catalogo(), leer(), P, Number.NaN));
});
test('Los filtros duros no aceptan costes desconocidos ni una modalidad o un registro que la persona no quiere', () => {
  for (const [campo, valor] of [
    ['coste_formacion_tipo', null],
    ['coste_formacion', COSTE_POSITIVO],
  ] as const) {
    const o = oferta();
    const alterada = {
      ...o,
      hechos: {
        ...o.hechos,
        [campo]: { ...o.hechos[campo], valor, motivo: valor === null ? 'no_consta_en_evidencia' : 'conocido' },
      },
    };
    assert.equal(seleccionarFormacion(catalogo(alterada), leer(), P, AHORA).estado, 'sin_oferta');
  }
  assert.equal(seleccionarFormacion(catalogo(), leer(), { ...P, aceptaRegistro: false }, AHORA).estado, 'sin_oferta');
  const o = oferta();
  const enLinea = {
    ...o,
    hechos: { ...o.hechos, modalidad: { ...o.hechos.modalidad, valor: 'en-linea', motivo: 'conocido' } },
  };
  const presencial = { ...P, modalidad: 'presencial' } as const;
  assert.equal(
    seleccionarFormacion(catalogo(enLinea as OfertaCatalogo), leer(), presencial, AHORA).estado,
    'sin_oferta',
  );
  // Una modalidad que la oferta no publica no es una contradicción: el curso se propone.
  assert.equal(seleccionarFormacion(catalogo(), leer(), presencial, AHORA).estado, 'parcial');
});
test('Una modalidad mixta no satisface una necesidad exclusivamente remota o presencial', () => {
  const o = oferta();
  const mixta = {
    ...o,
    hechos: { ...o.hechos, modalidad: { ...o.hechos.modalidad, valor: 'mixta', motivo: 'conocido' } as const },
  };
  for (const modalidad of ['presencial', 'en-linea'] as const) {
    const s = seleccionarFormacion(catalogo(mixta), leer(), { ...P, modalidad }, AHORA);
    assert.equal(s.estado, 'sin_oferta');
    assert.equal(s.descartes[0]?.motivo, 'modalidad_no_coincide');
  }
});
test('Un requisito publicado necesita confirmación explícita de la persona', () => {
  const c = companero();
  const f = c.fichas[0];
  assert.ok(f);
  const req = { ...afirmacion('entrada'), dimension: 'requisito_entrada' } as const;
  const conRequisito = leer({
    ...c,
    fichas: [
      {
        ...f,
        requisitos: 'publicados',
        aprendizaje: { ...f.aprendizaje, afirmaciones: [...f.aprendizaje.afirmaciones, req] },
      },
    ],
  });
  assert.equal(
    seleccionarFormacion(catalogo(), conRequisito, P, AHORA).descartes[0]?.motivo,
    'requisito_sin_confirmar',
  );
  assert.equal(
    seleccionarFormacion(
      catalogo(),
      conRequisito,
      { ...P, requisitosConfirmados: [JSON.stringify([f.programa_id, 'entrada'])] },
      AHORA,
    ).estado,
    'parcial',
  );
});
test('La etapa avanzada admite verificación rigurosa sin exigir programación', () => {
  const c = companero();
  const f = c.fichas[0];
  assert.ok(f);
  const avanzada = leer({
    ...c,
    fichas: [
      {
        ...f,
        cobertura: [
          {
            criterio: 'procedimiento_verificable',
            afirmaciones: ['sencilla'],
            justificacion: razon('Procedimiento probado'),
            via: null,
          },
          {
            criterio: 'fuentes_y_limites',
            afirmaciones: ['privada'],
            justificacion: razon('Fuentes probadas'),
            via: null,
          },
          {
            criterio: 'caso_complejo',
            afirmaciones: ['sencilla'],
            justificacion: razon('Caso revisado'),
            via: 'verificacion_rigurosa',
          },
        ],
      },
    ],
    caminos: c.caminos.map((camino) => ({ ...camino, etapa: 'avanzado' })),
  });
  assert.equal(seleccionarFormacion(catalogo(), avanzada, { ...P, etapa: 'avanzado' }, AHORA).estado, 'completa');
  const erronea = {
    ...avanzada,
    fichas: avanzada.fichas.map((ficha) => ({
      ...ficha,
      cobertura: ficha.cobertura.map((cobertura) => ({ ...cobertura, via: null })),
    })),
  };
  assert.throws(() => leer(erronea), AprendizajeNoValido);
});

function peticionLocal(dato: unknown = P) {
  return {
    url: 'https://dispositivo.test/local/formacion/seleccionar',
    method: 'POST',
    headers: [],
    body: JSON.stringify(dato),
  } as const;
}
test('La ruta local rechaza campos/etapas/valores ajenos antes de leer datos y conserva el perfil en el dispositivo', async () => {
  let lecturas = 0;
  const fuente = async () => {
    lecturas++;
    return { catalogo: catalogo(), companero: leer() };
  };
  for (const invalido of [
    { ...P, segundaOpinion: true },
    { ...P, etapa: 'nivel-inferido' },
    { ...P, modalidad: ['cualquiera'] },
    { ...P, aceptaRegistro: 'si' },
    { ...P, idiomas: [] },
  ]) {
    assert.equal(
      (await responderFormacionLocal(peticionLocal(invalido), fuente, AHORA)).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }
  assert.equal(lecturas, 0);
  const respuesta = await responderFormacionLocal(peticionLocal(), fuente, AHORA);
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const dato: unknown = await respuesta.json();
  assert.ok(esObjeto(dato));
  assert.equal(dato.estado, 'parcial');
  assert.equal(lecturas, 1);
});
test('Fallo de publicación se distingue de abstención, y un error interno no se disfraza de ausencia de cursos', async () => {
  const caida = async () => {
    throw new AprendizajeNoValido('fixture');
  };
  assert.equal((await responderFormacionLocal(peticionLocal(), caida, AHORA)).status, ESTADO_HTTP.noDisponible);
  const interno = new TypeError('defecto interno sintético');
  await assert.rejects(
    responderFormacionLocal(
      peticionLocal(),
      async () => {
        throw interno;
      },
      AHORA,
    ),
    (e) => e === interno,
  );
});
test('Con el reloj anterior al corte, la ruta local responde el problema de la fecha atrasada y no el de formación no disponible', async () => {
  const fuente = async () => ({ catalogo: catalogo(), companero: leer() });
  const atrasado = await responderFormacionLocal(peticionLocal(), fuente, Date.parse('2020-01-01T00:00:00Z'));
  assert.equal(atrasado.status, ESTADO_HTTP.solicitudIncorrecta);
  assert.match(atrasado.headers.get('content-type') ?? '', /^application\/problem\+json(;|$)/u);
  const cuerpo: unknown = await atrasado.json();
  assert.ok(esObjeto(cuerpo));
  assert.equal(cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}reloj_atrasado`);
  assert.equal((await responderFormacionLocal(peticionLocal(), fuente, AHORA)).status, ESTADO_HTTP.correcto);
});
test('El transporte del compañero solo pide su ruta fija con credenciales del mismo origen y sin perfil; controla bytes y tipo MIME', async () => {
  const { bytes, ref } = empaquetar(companero());
  const publicacion = { ...ref, ruta: `datos/catalogo-aprendizaje/${ref.sha256}.json` };
  const base = new URL('https://dispositivo.test/carpeta/');
  const cargado = await cargarCompanero(
    publicacion,
    { referencia: REFERENCIA, catalogo: catalogo() },
    base,
    async (r) => {
      assert.equal(r.url, new URL(publicacion.ruta, base).href);
      assert.equal(r.method, 'GET');
      assert.equal(r.credentials, 'same-origin');
      assert.equal(r.redirect, 'error');
      assert.equal(r.body, null);
      return new Response(bytes, { headers: { 'content-type': 'application/json' } });
    },
  );
  assert.equal(cargado.fichas.length, 1);
  for (const respuesta of [
    new Response(bytes, { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array([...bytes, 0]), { headers: { 'content-type': 'application/json' } }),
  ]) {
    await assert.rejects(
      cargarCompanero(publicacion, { referencia: REFERENCIA, catalogo: catalogo() }, base, async () => respuesta),
      AprendizajeNoValido,
    );
  }
});

test('La identidad de competencia se comprueba también cuando el nivel es desconocido', () => {
  const inventada = cambiar(companero(), (a) => ({
    ...a,
    competencia: { marco: 'inventado', version: '1', codigo: 'X' },
  }));
  assert.throws(() => leer(inventada), /Competencia no registrada/u);
});
test('La V1 no atribuye requisitos o resultados de un programa a dos ediciones', () => {
  const o = oferta();
  const primera = { ...o, unidad: { ...o.unidad, tipo: 'edicion', id: 'edicion-a' } } as const;
  const segunda = { ...primera, unidad: { ...primera.unidad, id: 'edicion-b' }, referencias: [] };
  const d = { ...catalogo(), ofertas: [primera, segunda], cobertura: { recurso: 0, edicion: 2 } };
  const { bytes, ref } = empaquetar(companero());
  assert.throws(() => leerCompanero(bytes, ref, REFERENCIA, d), /solo admite recursos sin ediciones/u);
});

test('El idioma declarado literal se compara con su código conocido sin cambiar el dato', () => {
  for (const [literal, codigo] of [
    ['Español', 'es'],
    ['Castellano', 'es'],
    ['Spanish', 'es'],
    ['es-ES', 'es'],
    ['es_419', 'es'],
    ['espanol', 'es'],
    ['Castilian', 'es'],
    ['Català', 'ca'],
    ['Catalán', 'ca'],
    ['Catalan', 'ca'],
    ['ca-ES', 'ca'],
    ['ca_AD', 'ca'],
    ['English', 'en'],
    ['en-GB', 'en'],
    ['en_Latn_US', 'en'],
    ['Inglés', 'en'],
    ['Anglès', 'en'],
    ['es', 'es'],
  ] as const) {
    const o = oferta();
    const alterada = {
      ...o,
      hechos: {
        ...o.hechos,
        idiomas_declarados: { ...o.hechos.idiomas_declarados, valor: [literal], motivo: 'conocido' } as const,
      },
    };
    const antes = structuredClone(alterada);
    const s = seleccionarFormacion(catalogo(alterada), leer(), { ...P, idiomas: [codigo] }, AHORA);
    assert.equal(s.estado, 'parcial', literal);
    assert.deepEqual(alterada, antes);
  }
});

test('Las cadenas con subtags arbitrarios no acreditan ni siquiera el idioma preferido', () => {
  for (const [literal, codigo] of [
    ['es-english', 'es'],
    ['en-zzzzzzzz', 'en'],
  ] as const) {
    const o = oferta();
    const alterada = {
      ...o,
      hechos: { ...o.hechos, idiomas_declarados: { ...o.hechos.idiomas_declarados, valor: [literal] } },
    };
    const s = seleccionarFormacion(catalogo(alterada), leer(), { ...P, idiomas: [codigo] }, AHORA);
    assert.equal(s.estado, 'sin_oferta', literal);
    assert.equal(s.descartes[0]?.motivo, 'idioma_no_acreditado');
  }
});

test('Un idioma declarado que no se reconoce o que no es el de la persona no acredita el curso', () => {
  const o = oferta();
  for (const idioma of [
    { ...o.hechos.idiomas_declarados, valor: ['Español e inglés'] },
    { ...o.hechos.idiomas_declarados, valor: ['desconocido'] },
    { ...o.hechos.idiomas_declarados, valor: ['es--ES'] },
    { ...o.hechos.idiomas_declarados, valor: ['es-abcdefghi'] },
    { ...o.hechos.idiomas_declarados, valor: ['Castilian / English'] },
    { ...o.hechos.idiomas_declarados, valor: ['en'] },
  ]) {
    const alterada = {
      ...o,
      hechos: {
        ...o.hechos,
        idiomas_declarados: idioma,
        idiomas_material_observado: {
          ...o.hechos.idiomas_material_observado,
          valor: ['es'],
          motivo: 'conocido',
        } as const,
      },
    };
    const s = seleccionarFormacion(catalogo(alterada), leer(), P, AHORA);
    assert.equal(s.estado, 'sin_oferta');
    assert.equal(s.descartes[0]?.motivo, 'idioma_no_acreditado');
  }
});

function companeroConLector(flujo: ReadableStream<Uint8Array>) {
  const respuesta = new Response(flujo, { headers: { 'content-type': 'application/json' } });
  const lector = flujo.getReader();
  let cancelaciones = 0;
  let liberaciones = 0;
  const cancelar = lector.cancel.bind(lector);
  const liberar = lector.releaseLock.bind(lector);
  lector.cancel = (...argumentos) => {
    cancelaciones += 1;
    return cancelar(...argumentos);
  };
  lector.releaseLock = () => {
    liberaciones += 1;
    liberar();
  };
  Object.defineProperty(flujo, 'getReader', { value: () => lector });
  return {
    respuesta,
    get cancelaciones() {
      return cancelaciones;
    },
    get liberaciones() {
      return liberaciones;
    },
  };
}

test('el flujo de aprendizaje completado no se cancela y conserva la validación de la huella', async () => {
  const { bytes, ref } = empaquetar(companero());
  const publicacion = { ...ref, ruta: `datos/catalogo-aprendizaje/${ref.sha256}.json` };
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(bytes);
      control.close();
    },
  });
  const lector = companeroConLector(flujo);
  assert.equal(
    (
      await cargarCompanero(
        publicacion,
        { referencia: REFERENCIA, catalogo: catalogo() },
        new URL('https://ejemplo.invalid/'),
        async () => lector.respuesta,
      )
    ).fichas.length,
    1,
  );
  assert.equal(lector.cancelaciones, 0);
  assert.equal(lector.liberaciones, 1);
  assert.equal(flujo.locked, false);
});

test('el flujo de aprendizaje excedido o interrumpido se cancela y libera', async () => {
  const { bytes, ref } = empaquetar(companero());
  const publicacion = { ...ref, ruta: `datos/catalogo-aprendizaje/${ref.sha256}.json` };
  const error = new Error('interrupción sintética');
  let indice = 0;
  for (const flujo of [
    new ReadableStream<Uint8Array>({
      start(control) {
        control.enqueue(new Uint8Array(bytes.length + 1));
      },
    }),
    new ReadableStream<Uint8Array>({
      start(control) {
        control.error(error);
      },
    }),
  ]) {
    const lector = companeroConLector(flujo);
    await assert.rejects(
      cargarCompanero(
        publicacion,
        { referencia: REFERENCIA, catalogo: catalogo() },
        new URL('https://ejemplo.invalid/'),
        async () => lector.respuesta,
      ),
      (recibido: unknown) => (indice === 0 ? recibido instanceof AprendizajeNoValido : recibido === error),
    );
    indice += 1;
    assert.equal(lector.cancelaciones, 1);
    assert.equal(lector.liberaciones, 1);
    assert.equal(flujo.locked, false);
  }
});

test('el compañero completo alterado sigue rechazándose por huella', async () => {
  const { bytes, ref } = empaquetar(companero());
  const alterados = Uint8Array.from(bytes);
  alterados[0] = (alterados[0] ?? 0) ^ 1;
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(alterados);
      control.close();
    },
  });
  const lector = companeroConLector(flujo);
  await assert.rejects(
    cargarCompanero(
      { ...ref, ruta: `datos/catalogo-aprendizaje/${ref.sha256}.json` },
      { referencia: REFERENCIA, catalogo: catalogo() },
      new URL('https://ejemplo.invalid/'),
      async () => lector.respuesta,
    ),
    AprendizajeNoValido,
  );
  assert.equal(lector.cancelaciones, 0);
  assert.equal(lector.liberaciones, 1);
});
