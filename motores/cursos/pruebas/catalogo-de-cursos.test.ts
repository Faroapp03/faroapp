// La sección «Cursos»: la bolsa filtrada en una sola lista por páginas (primero lo que tiene fecha), el recuento de
// cada opción con los demás filtros puestos, y la ruta GET /api/cursos con sus validaciones.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../../src/api/api.ts';
import { IDENTIDAD_WEB } from '../../../src/comun/identidad-web.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../../src/comun/protocolo-web.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { bolsaDeCursos } from '../src/bolsa-de-cursos.ts';
import { catalogoDeCursos } from '../src/catalogo-de-cursos.ts';
import { OFERTA_POR_DEFECTO } from '../src/oferta-de-formacion.ts';

/** El tema de los cursos que tratan la inteligencia artificial, tal como lo recibe el filtro. */
const TEMA_IA = 'ia';
const DATOS = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const HOY = '2026-10-21';
const CONSULTA = { hoy: HOY, oferta: OFERTA_POR_DEFECTO };
const BOLSA = bolsaDeCursos(DATOS, HOY);
assert.ok(DATOS.formacion);
const CURSOS_CON_FECHA = 13;

function nombreDelCurso(i: number): string {
  if (i === 0) {
    return 'Inteligencia artificial';
  }
  if (i === 1) {
    return 'Gestión de proyectos';
  }
  return `Curso ${i}`;
}
const CONTROLADOS = {
  ...DATOS,
  formacion: {
    ...DATOS.formacion,
    cursos: Array.from({ length: 26 }, (_, i) => ({
      id: `prueba-${i}`,
      nombre: nombreDelCurso(i),
      especialidades: [],
      modalidad: i % 2 === 0 ? 'Teleformación' : 'Presencial',
      municipio: 'Cornellà',
      inicio: i < CURSOS_CON_FECHA ? '2026-11-01' : null,
      fin: i < CURSOS_CON_FECHA ? '2026-12-01' : null,
      horas: '20',
      estado: 'Información',
      centro: i === 1 ? 'Entidad Ágora' : 'Centro de prueba',
      enlace: '',
      destinatarios: 'en-busqueda-de-empleo' as const,
    })),
  },
};
delete CONTROLADOS.consorci;
delete CONTROLADOS.fundae;
delete CONTROLADOS.citilab;
delete CONTROLADOS.barcelonaActiva;
delete CONTROLADOS.formacionAbierta;
delete CONTROLADOS.enlaces;
const BOLSA_CONTROLADA = bolsaDeCursos(CONTROLADOS, HOY);
const POR_PAGINA = 24;
const PETICION_MAL_HECHA = 400;
const CORRECTA = 200;
/** Un tema más largo de lo que admite la consulta (120 caracteres). */
const MAX_TEMA = 120;
const TEMA_DEMASIADO_LARGO = 'a'.repeat(MAX_TEMA + 1);
const ids = (fichas: readonly { id: string }[]) => fichas.map((c) => c.id);

test('cursos: sin filtros, toda la bolsa en una lista, su primera página', () => {
  const pagina = catalogoDeCursos(DATOS, CONSULTA);
  assert.equal(pagina.fecha, HOY);
  assert.equal(pagina.total, BOLSA.length);
  assert.equal(pagina.enLaBolsa, BOLSA.length);
  assert.equal(pagina.pagina, 1);
  assert.equal(pagina.paginas, Math.ceil(BOLSA.length / POR_PAGINA));
  assert.deepEqual(ids(pagina.fichas), ids(BOLSA.slice(0, POR_PAGINA)));
});

test('cursos: «cuándo» separa lo que tiene fecha de lo que hay que preguntar a la entidad', () => {
  const conFecha = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { cuando: 'con-fecha' } });
  const sinFecha = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { cuando: 'sin-fecha' } });
  assert.equal(conFecha.total, CURSOS_CON_FECHA);
  assert.equal(sinFecha.total, CURSOS_CON_FECHA);
  assert.equal(conFecha.total + sinFecha.total, BOLSA_CONTROLADA.length);
  assert.ok(conFecha.fichas.every((c) => c.conFecha));
  assert.ok(sinFecha.fichas.every((c) => !c.conFecha));
});

test('cursos: el recuento de cada opción es lo que queda al elegirla, con los demás filtros puestos', () => {
  const filtros = { modalidad: 'a-distancia' as const };
  const pagina = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros });
  // Con «a distancia» puesto, el recuento del tema «IA» es el total de pedir los dos filtros a la vez.
  const conIa = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { ...filtros, tema: TEMA_IA } });
  assert.equal(pagina.recuentos.tema[TEMA_IA], conIa.total);
  // El recuento de la modalidad no cuenta su propio filtro: dice cuántos quedarían con cada opción.
  const presencial = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { modalidad: 'presencial' } });
  assert.equal(pagina.recuentos.modalidad.presencial, presencial.total);
  assert.equal(pagina.recuentos.modalidad['a-distancia'], pagina.total);
  assert.ok(Object.keys(pagina.recuentos.tema).every((familia) => familia !== '-'));
});

test('cursos: la búsqueda encuentra por nombre y por entidad, sin tildes ni mayúsculas', () => {
  const porNombre = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { texto: 'GESTION PROYECTOS' } });
  assert.deepEqual(ids(porNombre.fichas), ['soc:prueba-1']);
  const porEntidad = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, filtros: { texto: 'entidad agora' } });
  assert.deepEqual(ids(porEntidad.fichas), ['soc:prueba-1']);
});

test('cursos: otra página; una página de más se queda en la última', () => {
  const segunda = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, pagina: 2 });
  assert.equal(segunda.pagina, 2);
  assert.deepEqual(ids(segunda.fichas), ids(BOLSA_CONTROLADA.slice(POR_PAGINA, 2 * POR_PAGINA)));
  const deMas = catalogoDeCursos(CONTROLADOS, { ...CONSULTA, pagina: 100_000 });
  assert.equal(deMas.pagina, deMas.paginas);
  assert.ok(deMas.fichas.length > 0);
});

test('GET /api/cursos: filtra y valida; un valor que no existe es una petición mal hecha', async () => {
  const api = await crearApi({ datos: CONTROLADOS, origenesPermitidos: [] });
  const pedir = (consulta: string) =>
    api(
      new Request(`https://faro.invalid/api/cursos${consulta}`, {
        headers: { ...IDENTIDAD_WEB, [CABECERA_CONTRATO]: String(CONTRATO_API) },
      }),
    );
  const respuesta = await pedir(`?fecha=${HOY}&tema=ia&modalidad=a-distancia&cuando=con-fecha`);
  assert.equal(respuesta.status, CORRECTA);
  const pagina = (await respuesta.json()) as ReturnType<typeof catalogoDeCursos>;
  assert.equal(pagina.fecha, HOY);
  assert.ok(pagina.total > 0);
  for (const ficha of pagina.fichas) {
    assert.equal(ficha.conIa, true);
    assert.equal(ficha.aDistancia, true);
    assert.equal(ficha.conFecha, true);
  }
  for (const mal of ['?nivel=4', '?fuente=sepe', '?cuando=nunca', '?pagina=0', '?pagina=1.5', '?fecha=2026-02-30']) {
    assert.equal((await pedir(mal)).status, PETICION_MAL_HECHA, mal);
  }
  assert.equal((await pedir(`?tema=${TEMA_DEMASIADO_LARGO}`)).status, PETICION_MAL_HECHA);
});
