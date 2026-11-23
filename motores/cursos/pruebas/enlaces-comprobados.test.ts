// Contrato de los enlaces registrados en el paquete, con copias autónomas: filtrado exacto, orden, cachés y ausencia
// de mutación de entradas. No necesita datos oficiales, presentación, reloj ni red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DatosConsorci,
  DatosFormacion,
  EnlaceOculto,
  EnlacesComprobados,
  EnlacesComprobadosAnteriores,
} from '../../../compartido/contratos/tipos-formacion.ts';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import {
  CARPETA_DE_PROGRAMAS,
  CATALOGO_SEPE,
  consorciDe,
  direccionDelPrograma,
  formacionComprobada,
  programaOficial,
} from '../src/enlaces-comprobados.ts';

const FECHA = '2026-10-06';
const NO_ENCONTRADO = 404;
const ROTA = 'https://entidad.example/rota';
const SANA = 'https://entidad.example/sana';
const PROGRAMAS = { comprobado: FECHA, candidatas: 3, codigos: ['TMVI14', 'SEAD0058'] };

/** La evidencia de una dirección que dio un 404 el día de la maqueta. */
function oculto(url: string, id?: string): EnlaceOculto {
  return {
    url,
    codigo_http: 404,
    observado_el: `${FECHA}T08:00:00+00:00`,
    url_final: url,
    ...(id === undefined ? {} : { id }),
  };
}

function enlacesCon(ocultas: string[] = [], cursosOcultos: string[] = []): EnlacesComprobados {
  return {
    version: 2,
    programas: { ...PROGRAMAS, codigos: [...PROGRAMAS.codigos] },
    webs: { comprobado: FECHA, candidatas: 3, ocultas: ocultas.map((url) => oculto(url)) },
    cursos: {
      comprobado: FECHA,
      candidatos: 3,
      ocultos: cursosOcultos.map((id) => oculto(`https://soc.example/${id}`, id)),
    },
  };
}

function consorci(): DatosConsorci {
  const contacto = { entidad: 'Entidad', municipio: 'Cornellà', correo: null, telefono: null, contacto_oficial: null };
  const edicion = {
    id: 'primera',
    nombre: 'Curso',
    certificado: null,
    modulo: null,
    especialidad: 'TMVI14',
    modalidad: 'presencial',
    a_distancia: false,
    inicio: FECHA,
    fin: FECHA,
    horas: '10',
    ...contacto,
  };
  return {
    fuente: 'Copia de prueba',
    fecha_copia: FECHA,
    actualizado: FECHA,
    buscador: 'https://consorci.example/',
    ediciones: [
      { ...edicion, web: ROTA },
      { ...edicion, id: 'segunda', web: SANA },
      { ...edicion, id: 'tercera', web: null },
      { ...edicion, id: 'cuarta', web: '' },
    ],
    entidades: { rota: { ...contacto, web: ROTA }, sana: { ...contacto, web: SANA } },
    previstas: { TMVI14: { nombre: 'Curso', acciones: [{ entidad: 'rota', modalidad: 'presencial', horas: '10' }] } },
    programadas_sin_fecha: { TMVI14: 1 },
  };
}

function formacion(): DatosFormacion {
  const curso = {
    nombre: 'Curso',
    especialidades: ['TMVI14'],
    modalidad: 'presencial',
    municipio: 'Cornellà',
    inicio: FECHA,
    fin: FECHA,
    horas: '10',
    estado: 'en inscripción',
    centro: 'Centro',
    enlace: 'https://soc.example/',
  };
  return {
    fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
    fecha_cursos: FECHA,
    cobertura: {},
    ocupaciones: {},
    especialidades: {},
    cursos: [
      { ...curso, id: 'segundo' },
      { ...curso, id: 'primero' },
      { ...curso, id: 'segundo' },
    ],
  };
}

function datosCon(partes: Pick<Datos, 'consorci' | 'formacion' | 'enlaces'> = {}): Datos {
  return {
    esco: { competencias: [], ocupaciones: {} },
    oit: { fuente: { cita: 'OIT', aviso_adaptacion: '' }, ocupaciones: {}, tareas: {} },
    clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
    cambra: {
      fuente: '',
      genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 0 },
    },
    textos: { tareas: {}, competencias_por_ocupacion: {}, aviso_traduccion: '' },
    ...partes,
  };
}

function congelar(valor: unknown): void {
  if (valor === null || typeof valor !== 'object') {
    return;
  }
  // Solo recorre las maquetas de este archivo: estructuras pequeñas, sin ciclos y de profundidad acotada.
  for (const parte of Object.values(valor)) {
    congelar(parte);
  }
  Object.freeze(valor);
}

test('el programa registrado conserva su fecha y una consulta ausente devuelve null', () => {
  assert.deepEqual(programaOficial('TMVI14', PROGRAMAS), {
    enlace: `${CARPETA_DE_PROGRAMAS}TMVI14.pdf`,
    comprobado: FECHA,
  });
  for (const codigo of ['tmvi14', 'TMVI14 ', 'TMVI', '', 'constructor', '__proto__']) {
    assert.equal(programaOficial(codigo, PROGRAMAS), null);
  }
  assert.equal(programaOficial('TMVI14', undefined), null);
  assert.equal(programaOficial('TMVI14', { ...PROGRAMAS, codigos: [] }), null);
});

test('las direcciones conservan la sede del SEPE y codifican cada código completo', () => {
  assert.equal(CATALOGO_SEPE, 'https://sede.sepe.gob.es/FOET_CATALOGO_EEFF_SEDE/flows/main');
  assert.equal(CARPETA_DE_PROGRAMAS, 'https://sede.sepe.gob.es/es/portaltrabaja/resources/pdf/especialidades/');
  assert.equal(direccionDelPrograma('CTRD0018 (FCOI0018)'), `${CARPETA_DE_PROGRAMAS}CTRD0018%20(FCOI0018).pdf`);
  assert.equal(direccionDelPrograma('á/😀?#%'), `${CARPETA_DE_PROGRAMAS}%C3%A1%2F%F0%9F%98%80%3F%23%25.pdf`);
  assert.equal(direccionDelPrograma(''), `${CARPETA_DE_PROGRAMAS}.pdf`);
  assert.throws(() => direccionDelPrograma('\ud800'), URIError);
});

test('cada programa devuelve una ficha propia y una lista nueva determina una consulta nueva', () => {
  const programas = { ...PROGRAMAS, codigos: ['TMVI14', 'TMVI14'] };
  const primera = programaOficial('TMVI14', programas);
  assert.ok(primera);
  primera.enlace = 'https://cambiada.example/';
  assert.deepEqual(programaOficial('TMVI14', programas), {
    enlace: `${CARPETA_DE_PROGRAMAS}TMVI14.pdf`,
    comprobado: FECHA,
  });
  assert.equal(programaOficial('TMVI14', { ...programas, codigos: ['SEAD0058'] }), null);
  assert.equal(programaOficial('TMVI14', { ...programas, comprobado: '' })?.comprobado, '');
});

test('sin partes o sin filtros se conserva la ausencia y la identidad de cada copia', () => {
  assert.equal(consorciDe(datosCon()), null);
  assert.equal(formacionComprobada(datosCon()), undefined);
  const copia = datosCon({ consorci: consorci(), formacion: formacion() });
  for (const datos of [copia, { ...copia, enlaces: enlacesCon() }]) {
    assert.equal(consorciDe(datos), copia.consorci);
    assert.equal(formacionComprobada(datos), copia.formacion);
  }
});

test('el Consorci oculta solo las webs registradas y conserva orden, campos y registros restantes', () => {
  const original = consorci();
  const copia = datosCon({ consorci: original, enlaces: enlacesCon([ROTA, ROTA, 'https://ausente.example/']) });
  const depurado = consorciDe(copia);
  assert.ok(depurado);
  assert.deepEqual(depurado, {
    ...original,
    ediciones: original.ediciones.map((edicion) => (edicion.web === ROTA ? { ...edicion, web: null } : edicion)),
    entidades: { ...original.entidades, rota: { ...original.entidades.rota, web: null } },
  });
  assert.notEqual(depurado, original);
  assert.notEqual(depurado.ediciones[0], original.ediciones[0]);
  assert.equal(depurado.ediciones[1], original.ediciones[1]);
  assert.equal(depurado.entidades.sana, original.entidades.sana);
  assert.equal(depurado.previstas, original.previstas);
  assert.equal(consorciDe({ ...copia }), depurado);
});

test('una lista nueva o un Consorci nuevo invalida la copia depurada por identidad', () => {
  const original = consorci();
  const copia = datosCon({ consorci: original, enlaces: enlacesCon([ROTA]) });
  const primera = consorciDe(copia);
  const otraLista = consorciDe({ ...copia, enlaces: enlacesCon([SANA]) });
  assert.ok(otraLista);
  assert.notEqual(otraLista, primera);
  assert.equal(otraLista.ediciones[0]?.web, ROTA);
  assert.equal(otraLista.ediciones[1]?.web, null);
  assert.notEqual(consorciDe({ ...copia, consorci: { ...original } }), primera);
});

test('el SOC quita todas las coincidencias exactas conservando el orden y la identidad de los cursos restantes', () => {
  const original = formacion();
  const copia = datosCon({ formacion: original, enlaces: enlacesCon([], ['primero', 'Primero', 'ausente']) });
  const depurada = formacionComprobada(copia);
  assert.ok(depurada);
  assert.deepEqual(depurada, { ...original, cursos: [original.cursos[0], original.cursos[2]] });
  assert.equal(depurada.cursos[0], original.cursos[0]);
  assert.equal(depurada.especialidades, original.especialidades);
  assert.equal(formacionComprobada({ ...copia }), depurada);
  const conDuplicados = formacionComprobada({ ...copia, enlaces: enlacesCon([], ['segundo', 'segundo']) });
  assert.deepEqual(conDuplicados?.cursos, [original.cursos[1]]);
});

test('listas y copias nuevas recalculan el SOC incluso cuando todos o ninguno de los cursos coinciden', () => {
  const original = formacion();
  const copia = datosCon({ formacion: original, enlaces: enlacesCon([], ['primero']) });
  const primera = formacionComprobada(copia);
  const ninguna = formacionComprobada({ ...copia, enlaces: enlacesCon([], ['ausente']) });
  assert.ok(ninguna);
  assert.notEqual(ninguna, primera);
  assert.deepEqual(ninguna.cursos, original.cursos);
  assert.notEqual(ninguna.cursos, original.cursos);
  assert.notEqual(formacionComprobada({ ...copia, formacion: { ...original } }), primera);
  assert.deepEqual(formacionComprobada({ ...copia, enlaces: enlacesCon([], ['primero', 'segundo']) })?.cursos, []);
});

test('las consultas preservan entradas congeladas y sus listas, sin requerir conexiones', () => {
  const copia = datosCon({ consorci: consorci(), formacion: formacion(), enlaces: enlacesCon([ROTA], ['primero']) });
  const antes = structuredClone(copia);
  congelar(copia);
  assert.ok(consorciDe(copia));
  assert.ok(formacionComprobada(copia));
  assert.ok(programaOficial('TMVI14', copia.enlaces?.programas));
  assert.deepEqual(copia, antes);
});

test('una web oculta con su 404 vuelve a enseñarse cuando el paquete ya no la trae oculta', () => {
  const original = consorci();
  const oculta = datosCon({ consorci: original, enlaces: enlacesCon([ROTA]) });
  assert.equal(consorciDe(oculta)?.ediciones[0]?.web, null);
  const enlaces = oculta.enlaces as EnlacesComprobados;
  assert.equal(enlaces.webs.ocultas[0]?.codigo_http, NO_ENCONTRADO);
  const recuperada = { ...oculta, enlaces: enlacesCon() };
  assert.equal(consorciDe(recuperada), original);
  assert.equal(consorciDe(recuperada)?.ediciones[0]?.web, ROTA);
});

function enlacesAnteriores(rotas: string[], fuera: string[]): EnlacesComprobadosAnteriores {
  return {
    programas: { ...PROGRAMAS, codigos: [...PROGRAMAS.codigos] },
    webs: { comprobado: FECHA, candidatas: 3, rotas, sin_respuesta: [SANA] },
    cursos: { comprobado: FECHA, candidatos: 3, fuera_de_la_oferta: fuera },
  };
}

test('un paquete de la forma anterior sigue ocultando lo que ocultaba, sin reaparecer antes de la primera observación', () => {
  const original = consorci();
  const copia = datosCon({
    consorci: original,
    formacion: formacion(),
    enlaces: enlacesAnteriores([ROTA], ['primero']),
  });
  assert.equal(consorciDe(copia)?.ediciones[0]?.web, null);
  assert.equal(consorciDe(copia)?.entidades.rota?.web, null);
  assert.equal(consorciDe(copia)?.ediciones[1]?.web, SANA);
  assert.deepEqual(
    formacionComprobada(copia)?.cursos.map((curso) => curso.id),
    ['segundo', 'segundo'],
  );
  assert.equal(consorciDe(copia), consorciDe({ ...copia }));
});

test('con la forma nueva se aplica la regla nueva: lo que el paquete ya no trae oculto vuelve a enseñarse', () => {
  const original = consorci();
  const copia = datosCon({ consorci: original, formacion: formacion(), enlaces: enlacesCon([], []) });
  assert.equal(consorciDe(copia), original);
  assert.equal(formacionComprobada(copia)?.cursos.length, copia.formacion?.cursos.length);
});
