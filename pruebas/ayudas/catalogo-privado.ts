/** Registro privado sintético pequeño, sin cuerpos ni acceso a almacenes de producción. */
import { leerCatalogoPrivado } from '../../src/administracion/catalogo-privado.js';

const TAM_SHA = 64;
const HUELLA = 'e'.repeat(TAM_SHA);
export function catalogoPrivado(
  cantidad = 1,
  ajustar: (u: ReturnType<typeof unidad>) => Record<string, unknown> = (u) => u,
) {
  return leerCatalogoPrivado({
    version: 1,
    snapshotSha256: HUELLA,
    admisionSha256: HUELLA,
    evaluadorSha256: HUELLA,
    corteRegistro: '2026-10-15T12:00:00Z',
    corteProyeccion: '2026-10-15T12:00:00Z',
    publicacionConfirmada: null,
    revision: HUELLA,
    referencias: [
      {
        tipo: 'remota',
        url: 'https://curso.example/ficha',
        parametrosOmitidos: true,
        documento: null,
        sha256: HUELLA,
        alcance: 'ficha',
        fecha: '2026-10-15T10:00:00Z',
      },
    ],
    unidades: Array.from({ length: cantidad }, (_, i) => ajustar(unidad(i))),
  });
}

function unidad(i: number) {
  return {
    tipo: i % 2 === 0 ? 'recurso' : 'edicion',
    id: `unidad-${i}`,
    programaId: `programa-${i}`,
    titulo: 'Curso conservado <sin HTML>',
    url: 'https://curso.example/ficha',
    parametrosOmitidos: false,
    fuenteId: 'prueba',
    estadoRegistro: 'evaluado',
    motivoRegistro: 'corte_conservado',
    motivoRetencion: 'decision_registrada_no_acredita_oferta',
    decision: 'sin-confirmar',
    motivos: ['sin_comprobacion_de_ficha'],
    comprobadoEl: '2026-10-15T10:00:00Z',
    cierraEl: null,
    revisarEl: '2026-10-16T10:00:00Z',
    ultimoIntentoFallidoEl: null,
    incidenciaEnlace: null,
    ultimoIntentoEl: '2026-10-15T11:00:00Z',
    ultimoFinEl: '2026-10-15T11:00:01Z',
    evaluadoEl: '2026-10-15T12:00:00Z',
    evaluadorSha256: HUELLA,
    schemaEvaluacion: 2,
    politicaVersion: 'prueba-v1',
    politicaSha256: HUELLA,
    referencias: [0],
  };
}
