/** Opción de curso sintética para las pruebas de la elección: todos los hechos sin valor salvo los que se indiquen. */
import { CAMPOS_HECHOS, type HechoCatalogo, type OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { idiomaConOrigen } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { datosPorConfirmar } from '../../src/seleccion-formacion/por-confirmar.ts';

export function hechosSinValor(
  conocidos: Partial<Record<(typeof CAMPOS_HECHOS)[number], HechoCatalogo['valor']>> = {},
) {
  return Object.fromEntries(
    CAMPOS_HECHOS.map((campo) => [
      campo,
      {
        valor: conocidos[campo] ?? null,
        motivo: campo in conocidos ? 'conocido' : 'no_consta_en_evidencia',
        unidad: null,
        moneda: null,
        alcance: 'unidad',
      },
    ]),
  );
}

export function opcionSintetica(
  bloque: string,
  id: string,
  conocidos: Partial<Record<(typeof CAMPOS_HECHOS)[number], HechoCatalogo['valor']>> = {},
) {
  const oferta = {
    proveedor_id: 'sintetico',
    unidad: { id, programa_id: `programa-${id}` },
    titulo_programa: `Curso ${id}`,
    url: 'https://ejemplo.invalid/curso',
    hechos: hechosSinValor(conocidos),
    referencias: [],
    comprobado_el: '2026-10-25T12:37:00Z',
    cierra_el: null,
    incidencia_enlace_el: null,
  };
  return {
    bloque,
    aprendizaje: null,
    oferta,
    proveedor: 'Proveedor',
    motivo: { es: 'Materia revisada', ca: 'Matèria revisada' },
    // El motor entrega cada opción con el idioma que decide la pieza común de Cursos y lo que no consta.
    idioma: idiomaConOrigen(oferta as unknown as OfertaCatalogo),
    porConfirmar: datosPorConfirmar(
      oferta as unknown as OfertaCatalogo,
      idiomaConOrigen(oferta as unknown as OfertaCatalogo),
      'cualquiera',
    ),
  };
}
