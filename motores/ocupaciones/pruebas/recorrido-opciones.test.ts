// Las opciones de «¿Cuál de estos es tu trabajo?» excluyen residuos absurdos («maestro cervecero»
// ante «maestra», «limpiador de granos de cacao» ante «limpiador»), ramas raras como nombre del grupo («profesor de
// escuela de negocios» ante «profesor») y títulos dobles aunque la persona escribiera en femenino.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PREFIJO_LOCAL, responderLocal } from '../../../src/plataforma/navegador/ruta-local.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { type PasoDePantalla, pasoDePantalla } from '../src/recorrido/pantalla/servicio.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const atributos = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);

/** Los títulos de la propuesta del primer paso y de sus alternativas (vacío si el primer paso no es una propuesta). */
function titulosPropuestos(texto: string, idioma: 'es' | 'ca' = 'es'): string[] {
  const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
  if (paso.tipo !== 'propuesta') {
    return [];
  }
  return [paso.mejor, ...paso.alternativas.map((a) => a.hipotesis)].map((h) => h.ocupacion?.titulo[idioma] ?? '');
}

/** Los textos de las opciones de la primera pregunta (vacío si el primer paso no es una pregunta). */
function opciones(texto: string, idioma: 'es' | 'ca' = 'es'): string[] {
  const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
  return paso.tipo === 'pregunta' ? paso.pregunta.opciones.map((o) => o.texto) : [];
}

describe('Opciones de la pregunta de grupo', () => {
  it('«maestra»: maestras de primaria e infantil, en femenino y sin «maestro cervecero»', () => {
    const lista = opciones('maestra');
    assert.ok(lista.includes('Maestra de educación primaria'), lista.join(' | '));
    assert.ok(lista.includes('Maestra de educación infantil'), lista.join(' | '));
    assert.ok(!lista.some((o) => /cervecer|o maestra/i.test(o)), lista.join(' | '));
  });

  it('«Sóc mestra»: el femenino también se reconoce en catalán', () => {
    // Con «mestra» en el diccionario de nombres, la primera pantalla puede ser ya la propuesta, con la de
    // infantil como alternativa: vale cualquiera de las dos formas, siempre en femenino.
    const vistos = [...opciones('Sóc mestra', 'ca'), ...titulosPropuestos('Sóc mestra', 'ca')].map((v) =>
      v.toLowerCase(),
    );
    assert.ok(vistos.includes("mestra d'educació primària"), vistos.join(' | '));
  });

  it('«profesor»: la universidad se nombra con su ocupación general, no con una rama', () => {
    const lista = opciones('profesor');
    assert.ok(lista.includes('Profesor de educación superior'), lista.join(' | '));
    assert.ok(!lista.some((o) => /escuela de negocios|pilates/i.test(o)), lista.join(' | '));
  });

  it('«limpiador»: sin residuos como pescado o granos de cacao', () => {
    const lista = opciones('limpiador');
    assert.ok(lista.length >= 2, lista.join(' | '));
    assert.ok(!lista.some((o) => /pescado|cacao/i.test(o)), lista.join(' | '));
  });

  it('un grupo heterogéneo se nombra con su título oficial: «chofer» no ofrece «transporte de enfermos»', () => {
    const lista = opciones('chofer');
    assert.ok(lista.includes('Conductores de automóviles, taxis y camionetas'), lista.join(' | '));
    assert.ok(!lista.some((o) => /enfermos|equitaci/i.test(o)), lista.join(' | '));
  });
});

/** El grupo de la propuesta del primer paso, o null si el primer paso no es una propuesta. */
function grupoPropuesto(texto: string, idioma: 'es' | 'ca' = 'es'): string | null {
  const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
  return paso.tipo === 'propuesta' ? paso.mejor.grupo : null;
}

/** Etapas mínimas que debe ofrecer la pregunta ante «docente»: al menos dos y «Otra cosa». */
const OPCIONES_DE_LA_ETAPA = 3;

describe('Equivalencias de diccionario', () => {
  it('«chofer de bus» y «xofer de bus» proponen conductor de autobús (8331), no chófer privado', () => {
    assert.equal(grupoPropuesto('chofer de bus'), '8331');
    assert.equal(grupoPropuesto('Sóc xofer de bus', 'ca'), '8331');
  });

  it('«docente» y «docent» preguntan por la etapa, nunca proponen secretaría', () => {
    for (const [texto, idioma] of [
      ['docente', 'es'],
      ['Sóc docent', 'ca'],
    ] as const) {
      assert.notEqual(grupoPropuesto(texto, idioma), '4120', texto);
      assert.ok(opciones(texto, idioma).length >= OPCIONES_DE_LA_ETAPA, texto);
    }
  });

  it('lo añadido con «Lo cuento con mis palabras» sigue en la previa calibrada: sin opciones absurdas', () => {
    const texto = 'limpiadora. limpio casas particulares';
    const { paso } = pasoDePantalla(datos, atributos, { texto, idioma: 'es', respuestas: [], anadido: 'limpio casas' });
    const textos = paso.tipo === 'pregunta' ? paso.pregunta.opciones.map((o) => o.texto).join(' | ') : '';
    assert.doesNotMatch(textos, /agua|leña|abogad|trabajo social/i);
  });
});

/** Los pasos de un recorrido en el que la persona dice «No» a todo (a la propuesta y a las preguntas de sí o no). */
function trasDecirNo(texto: string, pasos: number): string[] {
  const respuestas: { pregunta: string; opcion: string }[] = [];
  const tipos: string[] = [];
  for (let i = 0; i < pasos; i++) {
    const { paso } = pasoDePantalla(datos, atributos, { texto, idioma: 'es', respuestas });
    tipos.push(paso.tipo);
    if (paso.tipo === 'propuesta' && !paso.local) {
      respuestas.push({ pregunta: paso.id, opcion: 'no' });
    } else if (paso.tipo === 'pregunta') {
      const no = paso.pregunta.opciones.some((o) => o.id === 'no');
      respuestas.push({ pregunta: paso.pregunta.id, opcion: no ? 'no' : 'otra' });
    } else {
      break;
    }
  }
  return tipos;
}

/** Pasos que se miran: la propuesta, la pregunta que sigue al «No» y la siguiente. */
const PASOS_TRAS_EL_NO = 3;

describe('La propuesta directa vale solo hasta el primer «No»', () => {
  // Tras rechazar una propuesta directa, las preguntas continúan en lugar de repetir la misma decisión.
  it('«auxiliar administrativa» y «jornalero»: tras el «No» sigue preguntando', () => {
    for (const texto of ['auxiliar administrativa', 'jornalero']) {
      const tipos = trasDecirNo(texto, PASOS_TRAS_EL_NO);
      assert.equal(tipos[0], 'propuesta', `${texto}: ${tipos.join(' → ')}`);
      assert.deepEqual(tipos.slice(1), ['pregunta', 'pregunta'], `${texto}: ${tipos.join(' → ')}`);
    }
  });
});

/** Los textos de la primera pantalla: el enunciado y las opciones de la pregunta, o los títulos de la propuesta. */
function textosVisibles(texto: string, idioma: 'es' | 'ca' = 'es'): string[] {
  const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
  if (paso.tipo === 'pregunta') {
    return [paso.pregunta.texto, ...paso.pregunta.opciones.map((o) => o.texto)];
  }
  return paso.tipo === 'propuesta'
    ? [JSON.stringify(paso.mejor), ...paso.alternativas.map((a) => JSON.stringify(a))]
    : [];
}

describe('Regresiones de marcas, palabras de mando y vehículos', () => {
  it('«trabajo en mc donalds» y «trabajo en KFC»: comida rápida, ni inspectores ni camareros', () => {
    for (const texto of ['trabajo en mc donalds', 'trabajo en KFC']) {
      const lista = opciones(texto);
      assert.ok(
        lista.some((o) => /comida rápida/i.test(o)),
        `${texto}: ${lista.join(' | ')}`,
      );
      assert.ok(!lista.some((o) => /inspector|seguridad/i.test(o)), `${texto}: ${lista.join(' | ')}`);
      assert.notEqual(grupoPropuesto(texto), '3257', texto);
    }
  });

  it('«doctor» propone en masculino y «soy doctora» en femenino', () => {
    // Antes, la lista de nombres del diccionario («médico/doctor/doctora/MIR») se leía como masculino/femenino.
    assert.match(titulosPropuestos('doctor')[0] ?? '', /^médico/i);
    assert.match(titulosPropuestos('soy doctora')[0] ?? '', /^médica/i);
  });

  it('«vendo autos» y «vendedor de coches»: vendedor de vehículos (5223)', () => {
    assert.equal(grupoPropuesto('vendedor de coches'), '5223');
    assert.equal(grupoPropuesto('venedora de cotxes', 'ca'), '5223');
  });

  it('«gerente», «director», «jefe» y «cap» solos preguntan «¿… de qué?» antes de proponer nada', () => {
    for (const [texto, idioma] of [
      ['gerente', 'es'],
      ['director', 'es'],
      ['jefe', 'es'],
      ['Sóc cap', 'ca'],
    ] as const) {
      const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
      assert.equal(paso.tipo, 'pregunta', texto);
      assert.match(paso.tipo === 'pregunta' ? paso.pregunta.texto : '', /de qu[eéè]\?/i, texto);
    }
  });
});

describe('Regresiones de áreas y sectores', () => {
  it('«recursos humanos»: pregunta qué haces en el área, con nombres de ocupaciones y no con códigos', () => {
    const { paso } = pasoDePantalla(datos, atributos, { texto: 'recursos humanos', idioma: 'es', respuestas: [] });
    assert.equal(paso.tipo === 'pregunta' && paso.pregunta.tipo, 'area');
    const lista = opciones('recursos humanos');
    assert.ok(
      lista.some((o) => o.startsWith('Director de recursos humanos')),
      lista.join(' | '),
    );
    assert.ok(!lista.some((o) => /\d/.test(o)), lista.join(' | '));
  });

  it('«hostelería» y «hostaleria» preguntan qué haces en el sector, con sus oficios más comunes', () => {
    const lista = opciones('hostelería');
    assert.deepEqual(lista.slice(0, 2), ['Camarero o camarera', 'Cocinero o cocinera'], lista.join(' | '));
    assert.ok(opciones("treballo a l'hostaleria", 'ca').includes('Cambrer o cambrera'));
    assert.notEqual(grupoPropuesto('hostelería'), '1411');
  });

  it('la pregunta del sector se dice con su frase: «en la industria», «con personas mayores», «a l’hostaleria»', () => {
    const enunciado = (texto: string, idioma: 'es' | 'ca' = 'es') => {
      const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
      return paso.tipo === 'pregunta' ? paso.pregunta.texto : '';
    };
    assert.equal(enunciado('fábrica'), '¿Qué haces sobre todo en la industria?');
    assert.equal(enunciado('trabajo con gente mayor'), '¿Qué haces sobre todo con personas mayores?');
    assert.equal(enunciado("treballo a l'hostaleria", 'ca'), "Què fas sobretot a l'hostaleria?");
  });

  it('«recursos humanos»: sin género escrito, los dos; y la opción de técnicos es el agente de empleo', () => {
    const lista = opciones('recursos humanos');
    assert.ok(lista.includes('Director de recursos humanos o directora de recursos humanos'), lista.join(' | '));
    assert.ok(lista.includes('Agente de empleo'), lista.join(' | '));
    assert.ok(!lista.some((o) => /impresión/i.test(o)), lista.join(' | '));
  });

  it('ninguna primera pantalla enseña códigos de grupo en vez de nombres', () => {
    for (const texto of [
      'recursos humanos',
      'contabilidad',
      'logística',
      'marketing',
      'administración',
      'hostelería',
    ]) {
      const visibles = textosVisibles(texto).filter((t) => !t.startsWith('{'));
      assert.ok(!visibles.some((t) => /\d{4}/.test(t)), `${texto}: ${visibles.join(' | ')}`);
    }
  });
});

describe('Americanismos y anglicismos de oficio (src/busqueda/americanismos-anglicismos.json)', () => {
  it('«plomero», «mesero», «carabinero», «flight attendant» y «nail artist» proponen su ocupación', () => {
    assert.equal(grupoPropuesto('plomero'), '7126');
    assert.equal(grupoPropuesto('mesero'), '5131');
    assert.equal(grupoPropuesto('carabinero'), '5412');
    assert.equal(grupoPropuesto('flight attendant'), '5111');
    assert.equal(grupoPropuesto('nail artist'), '5142');
  });
});

describe('Siglas de oficio (src/busqueda/siglas.json)', () => {
  it('«soy DUE», «VS», «sóc TCAI» y «PDI de la UPC» proponen su ocupación', () => {
    assert.equal(grupoPropuesto('soy DUE'), '2221');
    assert.equal(grupoPropuesto('VS'), '5414');
    assert.equal(grupoPropuesto('sóc TCAI', 'ca'), '5321');
    assert.equal(grupoPropuesto('PDI de la UPC', 'ca'), '2310');
  });

  it('las siglas ambiguas no entran en minúscula: «pas» sigue siendo una palabra corriente', () => {
    assert.notEqual(grupoPropuesto('pas'), '4110');
  });

  it('en mayúsculas sí: «Soy TO en un hospital» propone terapeuta ocupacional y «sóc PAS de la UB» ofrece los dos grupos del PAS', () => {
    assert.equal(grupoPropuesto('Soy TO en un hospital'), '2269');
    const { paso } = pasoDePantalla(datos, atributos, { texto: 'sóc PAS de la UB', idioma: 'ca', respuestas: [] });
    const ofrecidos = paso.tipo === 'pregunta' ? paso.pregunta.opciones.map((o) => String(o.id)) : [];
    assert.ok(
      ['3343', '4110'].every((g) => ofrecidos.includes(g)),
      ofrecidos.join(' '),
    );
  });

  it('con puntos, como sin ellos: «A.T.S.», «soy D.U.E.» y «V.S.»', () => {
    assert.equal(grupoPropuesto('A.T.S.'), '2221');
    assert.equal(grupoPropuesto('soy D.U.E.'), '2221');
    assert.equal(grupoPropuesto('V.S.'), '5414');
  });
});

/** Peticiones como mucho en la prueba del recorrido largo (el motor acaba mucho antes). */
const PETICIONES_COMO_MUCHO = 40;
/** Respuestas que admitía la ruta del navegador con el tope fijo de antes: un recorrido largo debe pasar de aquí. */
const TOPE_FIJO_DE_ANTES = 12;
const BIEN = 200;
/** Preguntas que navegan por la clasificación: se contesta con la primera opción para seguir bajando. */
const NAVEGAN = new Set(['nivel1', 'nivel2', 'nivel3', 'precision', 'trato', 'campo']);
const NO_ELIGEN = new Set(['otra', 'no_lo_se', 'ninguna', 'no']);

/** Una respuesta que no acepta nada: baja por la clasificación, dice «No» a las tareas y «Otra cosa» a las listas. */
function sinAceptar(pregunta: { tipo: string; opciones: readonly { id: string | number }[] }): string {
  const ids = pregunta.opciones.map((o) => String(o.id));
  const real = ids.find((id) => !NO_ELIGEN.has(id));
  if (NAVEGAN.has(pregunta.tipo) && real) {
    return real;
  }
  return ids.find((id) => id === 'no') ?? ids.find((id) => id === 'otra') ?? ids[0] ?? '';
}

describe('Recorridos largos por la ruta del navegador (Akinator de 10 preguntas y 4 propuestas)', () => {
  it('un recorrido de más de 12 respuestas llega al final sin que se rechace ninguna petición', async () => {
    const respuestas: { pregunta: string; opcion: string }[] = [];
    for (let i = 0; i < PETICIONES_COMO_MUCHO; i++) {
      const r = await responderLocal(datos, () => atributos, {
        url: `http://127.0.0.1${PREFIJO_LOCAL}paso`,
        method: 'POST',
        headers: [['content-type', 'application/json']],
        body: JSON.stringify({ texto: 'electricidad', idioma: 'es', respuestas }),
      });
      assert.equal(r.status, BIEN, `petición ${i + 1}, con ${respuestas.length} respuestas`);
      const { paso } = (await r.json()) as { paso: PasoDePantalla };
      if (paso.tipo === 'pregunta') {
        respuestas.push({ pregunta: paso.pregunta.id, opcion: sinAceptar(paso.pregunta) });
      } else if (paso.tipo === 'propuesta' && !paso.local) {
        respuestas.push({ pregunta: paso.id, opcion: 'no' });
      } else {
        break;
      }
    }
    assert.ok(respuestas.length > TOPE_FIJO_DE_ANTES, `el recorrido tiene ${respuestas.length} respuestas`);
  });
});
