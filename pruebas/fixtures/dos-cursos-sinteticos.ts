/** Ofertas sintéticas para los recorridos de elección y sus límites temporales. */
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { casoDeFormacion } from './seleccion-formacion.ts';

export function dosCursosSinteticos() {
  const caso = casoDeFormacion();
  const base = caso.catalogo.ofertas[0];
  if (!base) {
    throw new Error('Catálogo sintético sin oferta');
  }
  const ofertas: OfertaCatalogo[] = ['ia-1', 'ia-2', 'digital-1', 'digital-2'].map((id) => ({
    ...base,
    unidad: { tipo: 'edicion', id, programa_id: id },
    titulo_programa: `Curso sintético ${id}`,
    cierra_el: '2026-12-31T22:59:00Z',
    hechos: {
      ...base.hechos,
      calendario_aula: {
        ...base.hechos.calendario_aula,
        motivo: 'conocido',
        alcance: 'edicion',
        vigencia: { comprobado_el: '2026-10-22T10:00:00Z' },
        valor: { inicio: '2026-01-01T00:00:00+01:00', fin: '2026-12-31T23:59:00+01:00', tipo: 'ventana-acceso' },
      },
    },
  }));
  return {
    catalogo: { ...caso.catalogo, ofertas },
    companero: { ...caso.companero, fichas: [], caminos: [] },
  };
}
