import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALCANCES_HECHO,
  CAMPOS_HECHOS,
  CAMPOS_SIN_PROYECCION,
  CatalogoNoValido,
  MAX_BYTES_CATALOGO,
  MAX_TEXTO_CATALOGO,
  MOTIVOS_HECHO,
  type OfertaCatalogo,
  type ReferenciaEntregaCatalogo,
  VERSION_CATALOGO,
  VERSION_CATALOGO_ANTERIOR,
  VERSION_CATALOGO_CON_MATERIA,
} from '../../src/catalogo-cursos/contrato.ts';
import { compararTextos, esEntregaCatalogo, esSha } from '../../src/catalogo-cursos/forma.ts';
import { leerCatalogo, ofertasVigentes } from '../../src/catalogo-cursos/lectura.ts';
import { instanteCatalogo, relojCatalogo, sePuedeOfrecer } from '../../src/catalogo-cursos/vigencia.ts';
import { RelojAtrasado } from '../../src/comun/reloj-atrasado.ts';
import { objeto } from '../ayudas/objeto-json.ts';

const CIFRAS_SHA = 64;
const HORAS_DECIMAL_PYTHON = 0.0000001;
const UTF8_CABECERA_DOS_BYTES = 0xc3;
const UTF8_CONTINUACION_INVALIDA = 0x28;
const FRACCION_RELOJ_INVALIDA = 0.5;
const MICROS_POR_MILISEGUNDO = 1_000n;
const VERSION_ANTERIOR = 3;
const BYTES = new Uint8Array(readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)));
function lista(valor: unknown): unknown[] {
  assert.ok(Array.isArray(valor));
  return valor;
}
function referenciaFixture(nombre = 'catalogo-cursos-publico'): ReferenciaEntregaCatalogo {
  const dato = objeto(
    JSON.parse(readFileSync(new URL(`../fixtures/${nombre}.referencia.json`, import.meta.url), 'utf8')),
  );
  assert.ok(esSha(dato.sha256) && esSha(dato.revision) && typeof dato.bytes === 'number');
  return { sha256: dato.sha256, revision: dato.revision, bytes: dato.bytes };
}
const REFERENCIA = referenciaFixture();
function mutable(): Record<string, unknown> {
  return objeto(JSON.parse(new TextDecoder().decode(BYTES)));
}
function primera(dato: Record<string, unknown>): Record<string, unknown> {
  return objeto(lista(dato.ofertas)[0]);
}
function empaquetar(dato: unknown): readonly [Uint8Array, ReferenciaEntregaCatalogo] {
  const bytes = new TextEncoder().encode(JSON.stringify(dato));
  return [bytes, { ...REFERENCIA, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }];
}
function rechaza(cambiar: (dato: Record<string, unknown>) => void): void {
  const dato = mutable();
  cambiar(dato);
  assert.throws(() => leerCatalogo(...empaquetar(dato)), CatalogoNoValido);
}
function ofertaLeida(): OfertaCatalogo {
  const oferta = leerCatalogo(BYTES, REFERENCIA).ofertas[0];
  assert.ok(oferta);
  return oferta;
}
const CORTE = Date.parse('2026-10-22T11:00:00Z');

test('la preinscripción de FUNDAE exige la misma edición, el centro y un plazo abierto de Madrid', () => {
  const dto = mutable();
  dto.schema_version = VERSION_CATALOGO;
  dto.proveedores = [{ id: 'fundae:publicador:catalogo:3', nombre: 'FUNDAE' }];
  dto.cobertura = { recurso: 0, edicion: 1 };
  const oferta = primera(dto);
  Object.assign(oferta, {
    unidad: { tipo: 'edicion', id: 'fundae:edicion:3177', programa_id: 'fundae:oferta:programa:IFCD1' },
    proveedor_id: 'fundae:publicador:catalogo:3',
    url: 'https://experienciafundae.es/ficha-curso/oferta/2/IFCD1',
    evidencia_materia: null,
    cierra_el: '2026-10-25T23:00:00Z',
    preinscripcion: {
      inicio: '2026-10-01',
      fin: '2026-10-25',
      centro: 'Centro A',
      colectivos: ['autonomos'],
      sector: 'INTERSECTORIAL',
    },
  });
  const leido = leerCatalogo(...empaquetar(dto));
  assert.equal(ofertasVigentes(leido, Date.parse('2026-10-25T22:59:59.999Z')).length, 1);
  assert.equal(ofertasVigentes(leido, Date.parse('2026-10-25T23:00:00Z')).length, 0);
  for (const cambio of [
    { proveedor_id: 'ajeno' },
    { url: 'https://experienciafundae.es/ficha-curso/oferta/2/OTRA' },
    { cierra_el: null },
    { cierra_el: '2026-10-25T23:00:00.000001Z' },
    { preinscripcion: undefined },
    { unidad: { ...objeto(oferta.unidad), id: 'fundae:edicion:0' } },
    { unidad: { ...objeto(oferta.unidad), programa_id: 'cibernarium:1' } },
    ...[
      { inicio: '2026-10-24' },
      { fin: '2026-09-31' },
      { centro: '' },
      { centro: '    ' },
      { centro: 'Usuario <ejemplo@invalido.test>' },
      { sector: 'Contacto 612345678' },
      { fin: '9999-12-31' },
      { colectivos: [] },
      { colectivos: ['autonomos', 'autonomos'] },
      { colectivos: ['todos'] },
      { sector: null },
    ].map((claves) => ({ preinscripcion: { ...objeto(oferta.preinscripcion), ...claves } })),
  ]) {
    assert.throws(() => leerCatalogo(...empaquetar({ ...dto, ofertas: [{ ...oferta, ...cambio }] })), CatalogoNoValido);
  }
  assert.doesNotThrow(() =>
    leerCatalogo(...empaquetar({ ...dto, ofertas: [{ ...oferta, cierra_el: '2026-10-24T12:00:00Z' }] })),
  );
  for (const version of [VERSION_CATALOGO_ANTERIOR, VERSION_CATALOGO_CON_MATERIA]) {
    assert.throws(() => leerCatalogo(...empaquetar({ ...dto, schema_version: version })), CatalogoNoValido);
  }
});

test('Lee el DTO público reducido emitido por Python sin recalcular su revisión como JCS', () => {
  const dato = leerCatalogo(BYTES, REFERENCIA);
  assert.equal(dato.ofertas.length, 1);
  assert.equal(dato.ofertas[0]?.titulo_programa, 'Formación ñ 🔧');
  assert.match(new TextDecoder().decode(BYTES), /1e-07/u);
  assert.notEqual(createHash('sha256').update(JSON.stringify(dato)).digest('hex'), REFERENCIA.sha256);
  assert.equal(dato.revision, REFERENCIA.revision);
  assert.equal(dato.ofertas[0]?.hechos.horas_publicadas.valor, HORAS_DECIMAL_PYTHON);
});

function catalogoConMateria(): Record<string, unknown> {
  const dato = mutable();
  dato.schema_version = VERSION_CATALOGO;
  const oferta = primera(dato);
  oferta.unidad = { tipo: 'edicion', id: 'cibernarium-edicion:2', programa_id: 'cibernarium:1' };
  oferta.proveedor_id = 'cibernarium';
  dato.proveedores = [{ id: 'cibernarium', nombre: 'Proveedor' }];
  dato.cobertura = { recurso: 0, edicion: 1 };
  const soporte = {
    url: 'https://example.org/captura',
    sha256: 'a'.repeat(CIFRAS_SHA),
    capturado_utc: '2026-10-22T08:00:00Z',
    localizador: 'activities[0]',
  };
  oferta.evidencia_materia = {
    version: 1,
    actividad_id: '3',
    programa_id: 'cibernarium:1',
    edicion_id: 'cibernarium-edicion:2',
    vinculo: soporte,
    contenido: { ...soporte, metodo: 'cibernarium-descripcion-api-v1', sha256_captura: 'b'.repeat(CIFRAS_SHA) },
    censo_ia: { ...soporte, ambito: 'ia' },
    estado_censo: 'parcial',
  };
  return dato;
}

type CambioDeMateria = (dato: Record<string, unknown>, oferta: Record<string, unknown>) => void;

function cambiarMateria(dato: Record<string, unknown>, cambiar: CambioDeMateria): Record<string, unknown> {
  const copia = objeto(structuredClone(dato));
  cambiar(copia, primera(copia));
  return copia;
}

const CAMBIOS_INCOMPATIBLES: readonly CambioDeMateria[] = [
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(o.evidencia_materia).programa_id = 'cibernarium:otro';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(o.evidencia_materia).edicion_id = 'cibernarium-edicion:otra';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).contenido).sha256_captura = 'z'.repeat(CIFRAS_SHA);
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).vinculo).capturado_utc = '2026-10-23T00:00:00Z';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).contenido).capturado_utc = '2026-10-23T00:00:00Z';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).censo_ia).capturado_utc = '2026-10-23T00:00:00Z';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).contenido).metodo = 'otro';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).vinculo).url = 'file:///tmp/privado';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).vinculo).url = 'http://localhost/captura';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).contenido).url = 'http://192.168.1.2/captura';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).censo_ia).url = 'http://[::1]/captura';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(objeto(o.evidencia_materia).vinculo).url = 'http://0x7f000001/captura';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(o.evidencia_materia).estado_censo = 'sin-evidencia';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    objeto(o.evidencia_materia).descripcion = 'no redistribuible';
  },
  (_d: Record<string, unknown>, o: Record<string, unknown>) => {
    delete o.evidencia_materia;
  },
  (d: Record<string, unknown>) => {
    d.schema_version = VERSION_CATALOGO_ANTERIOR;
  },
];

test('contratos 4 y 5 separan evidencia de materia, identidad y corte', () => {
  const dato = catalogoConMateria();
  assert.equal(leerCatalogo(...empaquetar(dato)).ofertas[0]?.evidencia_materia?.actividad_id, '3');
  assert.doesNotThrow(() => leerCatalogo(...empaquetar({ ...dato, schema_version: VERSION_CATALOGO_CON_MATERIA })));
  const completoSinCoincidencia = cambiarMateria(dato, (_d, o) => {
    Object.assign(objeto(o.evidencia_materia), { estado_censo: 'completo', censo_ia: null });
  });
  assert.doesNotThrow(() => leerCatalogo(...empaquetar(completoSinCoincidencia)));
  const ipPublica = cambiarMateria(dato, (_d, o) => {
    objeto(objeto(o.evidencia_materia).vinculo).url = 'https://8.8.8.8/captura';
  });
  assert.throws(() => leerCatalogo(...empaquetar(ipPublica)), CatalogoNoValido);
  for (const cambiar of CAMBIOS_INCOMPATIBLES) {
    assert.throws(() => leerCatalogo(...empaquetar(cambiarMateria(dato, cambiar))), CatalogoNoValido);
  }
  const historico = cambiarMateria(dato, (d, o) => {
    d.schema_version = VERSION_CATALOGO_ANTERIOR;
    delete o.evidencia_materia;
  });
  assert.equal(leerCatalogo(...empaquetar(historico)).schema_version, VERSION_CATALOGO_ANTERIOR);
  const historicoConDireccionLocal = mutable();
  primera(historicoConDireccionLocal).url = 'http://127.0.0.1/curso';
  assert.doesNotThrow(() => leerCatalogo(...empaquetar(historicoConDireccionLocal)));
});

test('La integridad se comprueba sobre bytes externos, truncamiento y límites antes de interpretar', () => {
  for (const referencia of [
    { ...REFERENCIA, sha256: 'f'.repeat(CIFRAS_SHA) },
    { ...REFERENCIA, bytes: BYTES.byteLength - 1 },
    { ...REFERENCIA, bytes: MAX_BYTES_CATALOGO + 1 },
    { ...REFERENCIA, bytes: Number.NaN },
    { ...REFERENCIA, revision: 'f'.repeat(CIFRAS_SHA) },
  ]) {
    assert.throws(() => leerCatalogo(BYTES, referencia), CatalogoNoValido);
  }
  assert.throws(() => leerCatalogo(BYTES.subarray(1), REFERENCIA), CatalogoNoValido);
});

test('Rechaza JSON roto, UTF-8 mal formado y BOM sin repararlos ni devolver catálogo vacío', () => {
  for (const bytes of [
    Uint8Array.of(UTF8_CABECERA_DOS_BYTES, UTF8_CONTINUACION_INVALIDA),
    new TextEncoder().encode('{'),
    new TextEncoder().encode(`\ufeff${new TextDecoder().decode(BYTES)}`),
  ]) {
    const referencia = {
      ...REFERENCIA,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    assert.throws(() => leerCatalogo(bytes, referencia), CatalogoNoValido);
  }
});

test('El contrato cerrado rechaza diagnóstico, colecciones ocultas, originales y controles privados', () => {
  for (const campo of ['catalogo_privado', 'ediciones', 'unidades', 'variantes', 'anuncios', 'estado_registro']) {
    rechaza((dato) => {
      dato[campo] = [];
    });
  }
  rechaza((dato) => {
    primera(dato).estado_registro = 'evaluado';
  });
  rechaza((dato) => {
    primera(dato).politica = { ttl: 1 };
  });
  rechaza((dato) => {
    objeto(primera(dato).hechos).original_html = 'privado';
  });
});

test('Versiones, tipos, proveedores y recuentos no se sustituyen ni se deducen de títulos', () => {
  rechaza((dato) => {
    dato.schema_version = 1;
  });
  rechaza((dato) => {
    dato.schema_version = true;
  });
  rechaza((dato) => {
    primera(dato).proveedor_id = 'inexistente';
  });
  rechaza((dato) => {
    objeto(primera(dato).unidad).tipo = 'programa';
  });
  rechaza((dato) => {
    objeto(primera(dato).unidad).programa_id = 'otro';
  });
  rechaza((dato) => {
    objeto(dato.cobertura).recurso = 0;
  });
  rechaza((dato) => {
    objeto(dato.cobertura).edicion = false;
  });
});

test('No quedan enlaces huérfanos o entidades auxiliares públicas sin procedencia', () => {
  rechaza((dato) => {
    lista(dato.proveedores).push({ id: 'sin-oferta', nombre: 'Sin oferta' });
  });
  rechaza((dato) => {
    lista(dato.proveedores).push(structuredClone(lista(dato.proveedores)[0]));
  });
  rechaza((dato) => {
    lista(dato.ofertas).push(structuredClone(lista(dato.ofertas)[0]));
    objeto(dato.cobertura).recurso = 2;
  });
});

interface CasoFrontera {
  readonly nombre: string;
  readonly ruta: readonly (string | number)[];
  readonly valor?: string;
  readonly relleno?: number;
  readonly admitido: boolean;
}
type Contenedor = Record<string, unknown> | unknown[];
function hijo(contenedor: Contenedor, paso: string | number): Contenedor {
  const siguiente: unknown = Array.isArray(contenedor) ? contenedor[Number(paso)] : contenedor[String(paso)];
  return Array.isArray(siguiente) ? siguiente : objeto(siguiente);
}
function aplicarCaso(dato: Record<string, unknown>, caso: CasoFrontera): void {
  const ultimo = caso.ruta.at(-1);
  if (ultimo === undefined) {
    return;
  }
  const destino = caso.ruta.slice(0, -1).reduce<Contenedor>(hijo, dato);
  const valor = `${caso.valor ?? ''}${'a'.repeat(caso.relleno ?? 0)}`;
  if (Array.isArray(destino)) {
    destino[Number(ultimo)] = valor;
  } else {
    destino[String(ultimo)] = valor;
  }
}

test('Resuelve como el contrato del productor los casos compartidos (test_entrega_catalogo.py)', () => {
  // Una entrega que el productor admitiera y este lector rechazara dejaría la página de cursos sin ninguna oferta.
  const tabla = objeto(
    JSON.parse(readFileSync(new URL('../fixtures/catalogo-cursos-publico-fronteras.json', import.meta.url), 'utf8')),
  );
  const casos = lista(tabla.casos) as CasoFrontera[];
  assert.ok(casos.length > 0);
  for (const caso of casos) {
    const dato = mutable();
    aplicarCaso(dato, caso);
    if (caso.admitido) {
      assert.doesNotThrow(() => leerCatalogo(...empaquetar(dato)), caso.nombre);
    } else {
      assert.throws(() => leerCatalogo(...empaquetar(dato)), CatalogoNoValido, caso.nombre);
    }
  }
});

test('Las URLs son las publicadas por el productor, no campos de reserva o credenciales', () => {
  for (const url of ['javascript:alert(1)', 'https://usuario:clave@example.org/curso', 'https://example.org/a b']) {
    rechaza((dato) => {
      primera(dato).url = url;
    });
  }
  rechaza((dato) => {
    primera(dato).url_programa_alternativa = 'https://example.org/';
  });
});

test('Horas, costes, monedas y campos desconocidos conservan la forma factual sin defaults', () => {
  const dato = leerCatalogo(BYTES, REFERENCIA);
  const oferta = dato.ofertas[0];
  assert.ok(oferta);
  for (const campo of CAMPOS_SIN_PROYECCION) {
    assert.equal(oferta.hechos[campo].valor, null);
    assert.equal(oferta.hechos[campo].motivo, 'sin_soporte_de_campo');
  }
  assert.equal(oferta.hechos.idiomas_material_observado.valor, null);
  rechaza((d) => {
    objeto(objeto(primera(d).hechos).acceso_fundae).valor = true;
  });
  rechaza((d) => {
    objeto(objeto(primera(d).hechos).horas_publicadas).unidad = 'semanas';
  });
  rechaza((d) => {
    objeto(objeto(primera(d).hechos).coste_formacion).moneda = 'euros';
  });
  rechaza((d) => {
    objeto(objeto(primera(d).hechos).modalidad).valor = 'inventada';
  });
  rechaza((d) => {
    objeto(objeto(primera(d).hechos).requisitos_publicados).valor = 'texto no admitido';
  });
});

test('La forma y los vocabularios concuerdan con el JSON Schema público congelado', () => {
  const esquema = objeto(
    JSON.parse(
      readFileSync(new URL('../../plataforma_datos/cursos/esquemas/entrega_catalogo.json', import.meta.url), 'utf8'),
    ),
  );
  const defs = objeto(esquema.$defs);
  const dato = mutable();
  assert.deepEqual(new Set(lista(esquema.required)), new Set(Object.keys(dato)));
  assert.equal(esquema.additionalProperties, false);
  assert.deepEqual(new Set(lista(objeto(defs.hechos).required)), new Set(CAMPOS_HECHOS));
  const campos = objeto(objeto(defs.hechos).properties);
  const modalidad = objeto(objeto(campos.modalidad).properties);
  assert.deepEqual(lista(objeto(modalidad.alcance).enum), [...ALCANCES_HECHO]);
  assert.deepEqual(lista(objeto(modalidad.motivo).enum), [...MOTIVOS_HECHO]);
  assert.deepEqual(new Set(lista(objeto(defs.oferta).required)), new Set(Object.keys(primera(dato))));
});

test('Las lenguas son conjuntos de literales en orden Unicode de Python, no UTF-16 ni traducciones', () => {
  assert.ok(compararTextos('\ue000', '😀') < 0);
  const dato = mutable();
  const idioma = objeto(objeto(primera(dato).hechos).idiomas_declarados);
  idioma.valor = ['\ue000', '😀'];
  idioma.motivo = 'conocido';
  assert.doesNotThrow(() => leerCatalogo(...empaquetar(dato)));
  rechaza((d) => {
    const i = objeto(objeto(primera(d).hechos).idiomas_declarados);
    i.valor = ['es', 'ca'];
    i.motivo = 'conocido';
  });
  rechaza((d) => {
    const i = objeto(objeto(primera(d).hechos).idiomas_declarados);
    i.valor = ['es', 'es'];
    i.motivo = 'conocido';
  });
});

test('Los límites de texto cuentan puntos Unicode sin truncar caracteres astrales', () => {
  const dato = mutable();
  objeto(lista(dato.proveedores)[0]).nombre = '🔧'.repeat(MAX_TEXTO_CATALOGO);
  assert.doesNotThrow(() => leerCatalogo(...empaquetar(dato)));
  rechaza((d) => {
    objeto(lista(d.proveedores)[0]).nombre = '🔧'.repeat(MAX_TEXTO_CATALOGO + 1);
  });
  rechaza((d) => {
    objeto(lista(d.proveedores)[0]).nombre = '\ud800';
  });
});

test('Los instantes preservan microsegundos, fracciones equivalentes y UTC explícito', () => {
  const primero = instanteCatalogo('2026-10-23T10:00:00.000001Z');
  const segundo = instanteCatalogo('2026-10-23T10:00:00.000002Z');
  assert.equal(segundo - primero, 1n);
  assert.equal(instanteCatalogo('2026-10-23T10:00:00.1Z'), instanteCatalogo('2026-10-23T10:00:00.100000+00:00'));
  assert.equal(instanteCatalogo('2026-10-23T10:00Z'), instanteCatalogo('2026-10-23T10:00:00Z'));
  assert.equal(instanteCatalogo('2026-10-23T10:00:01.000001Z') - instanteCatalogo('2026-10-23T10:00:00.999999Z'), 2n);
});

test('Las fechas imposibles, zonas ajenas, segundos intercalares y precisión excedida se rechazan', () => {
  for (const fecha of [
    '2026-02-30T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-10-23T24:00:00Z',
    '2026-10-23T10:00:60Z',
    '2026-10-23T10:00:00+01:00',
    '2026-10-23T10:00:00',
    '2026-10-23T10:00:00.0000001Z',
    '0000-01-01T00:00:00Z',
  ]) {
    assert.throws(() => instanteCatalogo(fecha), CatalogoNoValido);
    rechaza((dato) => {
      primera(dato).cierra_el = fecha;
    });
  }
  assert.doesNotThrow(() => instanteCatalogo('2024-02-29T12:00:00Z'));
});

test('El lector comprueba la coherencia temporal en el corte y exige el límite publicado del contrato 4', () => {
  rechaza((dato) => {
    primera(dato).cierra_el = dato.corte_proyeccion_utc;
  });
  rechaza((dato) => {
    delete primera(dato).cierra_el;
  });
  rechaza((dato) => {
    delete primera(dato).cierra_el;
    primera(dato).vence_el = '2026-10-23T08:00:00Z';
  });
  rechaza((dato) => {
    primera(dato).vence_el = '2026-10-23T08:00:00Z';
  });
  rechaza((dato) => {
    dato.schema_version = VERSION_ANTERIOR;
  });
  rechaza((dato) => {
    primera(dato).incidencia_enlace_el = '2026-10-22T10:30:00.000002Z';
  });
  // Posterior a la evaluación aunque anterior a la proyección: el productor tampoco la admite.
  rechaza((dato) => {
    primera(dato).incidencia_enlace_el = '2026-10-22T10:00:00.000001Z';
  });
  // Una incidencia del catálogo puede ser anterior a la comprobación de la ficha o coincidir con ella o con la
  // evaluación: la oferta se lee y se sigue ofreciendo con su enlace.
  for (const fecha of ['2026-10-22T07:00:00Z', '2026-10-22T08:00:00Z', '2026-10-22T10:00:00Z']) {
    const dato = mutable();
    primera(dato).incidencia_enlace_el = fecha;
    const catalogoLeido = leerCatalogo(...empaquetar(dato));
    assert.equal(catalogoLeido.ofertas[0]?.incidencia_enlace_el, fecha);
    assert.equal(ofertasVigentes(catalogoLeido, CORTE).length, catalogoLeido.ofertas.length);
  }
  rechaza((dato) => {
    delete primera(dato).incidencia_enlace_el;
  });
  const conIncidencia = mutable();
  primera(conIncidencia).incidencia_enlace_el = '2026-10-22T09:00:00Z';
  const leida = leerCatalogo(...empaquetar(conIncidencia));
  // La incidencia del enlace solo avisa: la oferta sigue en la vista con su enlace.
  assert.equal(ofertasVigentes(leida, CORTE)[0]?.url, leida.ofertas[0]?.url);
  rechaza((dato) => {
    objeto(objeto(primera(dato).hechos).horas_publicadas).vigencia = {
      comprobado_el: '2026-10-22T08:00:00Z',
      vence_el: '2026-10-23T08:00:00Z',
    };
  });
  rechaza((dato) => {
    primera(dato).comprobado_el = '2026-10-24T10:00:00Z';
  });
  rechaza((dato) => {
    primera(dato).corte_evaluacion_utc = '2026-10-24T10:00:00Z';
  });
  rechaza((dato) => {
    primera(dato).comprobado_el = null;
  });
});

test('Semanas sin entrega nueva no retiran la oferta ni sus hechos; solo el límite publicado retira la vista', () => {
  const dato = leerCatalogo(BYTES, REFERENCIA);
  const anterior = JSON.stringify(dato);
  assert.equal(ofertasVigentes(dato, CORTE).length, 1);
  const [tarde] = ofertasVigentes(dato, Date.parse('2027-01-15T10:00:00Z'));
  assert.equal(tarde, dato.ofertas[0]);
  assert.equal(tarde?.hechos.horas_publicadas.valor, HORAS_DECIMAL_PYTHON);
  const conLimite = mutable();
  primera(conLimite).cierra_el = '2026-11-30T23:00:00Z';
  const limitado = leerCatalogo(...empaquetar(conLimite));
  assert.equal(ofertasVigentes(limitado, Date.parse('2026-11-30T23:00:00Z') - 1).length, 1);
  assert.equal(ofertasVigentes(limitado, Date.parse('2026-11-30T23:00:00Z')).length, 0);
  assert.equal(JSON.stringify(dato), anterior);
  assert.equal(limitado.ofertas.length, 1);
});

test('El borde de un microsegundo conserva el intervalo sin igualdad falsa', () => {
  const oferta = {
    ...ofertaLeida(),
    comprobado_el: '2026-10-23T10:00:00.000001Z',
    corte_evaluacion_utc: '2026-10-23T10:00:00.000001Z',
    cierra_el: '2026-10-23T10:00:00.000002Z',
  };
  const corte = instanteCatalogo(oferta.corte_evaluacion_utc);
  assert.equal(sePuedeOfrecer(oferta, corte, corte), true);
  assert.equal(sePuedeOfrecer(oferta, corte, instanteCatalogo(oferta.cierra_el)), false);
  assert.equal(sePuedeOfrecer({ ...oferta, cierra_el: null }, corte, instanteCatalogo(oferta.cierra_el)), true);
});

test('El reloj es de plataforma: uno inválido es un catálogo no válido, uno anterior al corte es un reloj atrasado y ninguno simula cero ofertas', () => {
  const dato = leerCatalogo(BYTES, REFERENCIA);
  for (const reloj of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    CORTE + FRACCION_RELOJ_INVALIDA,
  ]) {
    assert.throws(() => ofertasVigentes(dato, reloj), CatalogoNoValido);
  }
  assert.throws(() => ofertasVigentes(dato, Date.parse('2026-10-21T10:00:00Z')), RelojAtrasado);
  assert.equal(relojCatalogo(CORTE), BigInt(CORTE) * MICROS_POR_MILISEGUNDO);
});

test('La lectura devuelve una instantánea inmutable apta para caché y la vista no admite mutaciones', () => {
  const dato = leerCatalogo(BYTES, REFERENCIA);
  assert.ok(Object.isFrozen(dato) && Object.isFrozen(dato.ofertas));
  const oferta = dato.ofertas[0];
  assert.ok(oferta);
  assert.ok(Object.isFrozen(oferta.hechos.idiomas_declarados));
  assert.equal(Reflect.set(oferta, 'url', 'https://example.org/sustituida'), false);
  assert.ok(Object.isFrozen(ofertasVigentes(dato, CORTE)));
  assert.equal(esEntregaCatalogo(dato), true);
});

test('Un asset admitido sin ofertas se lee distinto de un error y no afirma ausencia de cursos', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/catalogo-cursos-vacio.utf8', import.meta.url)));
  const dato = leerCatalogo(bytes, referenciaFixture('catalogo-cursos-vacio'));
  assert.deepEqual(dato.ofertas, []);
  assert.deepEqual(dato.proveedores, []);
  assert.deepEqual(dato.cobertura, { recurso: 0, edicion: 0 });
  assert.deepEqual(ofertasVigentes(dato, Date.parse('2026-10-23T07:00:00Z')), []);
  assert.throws(() => leerCatalogo(bytes.subarray(1), referenciaFixture('catalogo-cursos-vacio')), CatalogoNoValido);
});
