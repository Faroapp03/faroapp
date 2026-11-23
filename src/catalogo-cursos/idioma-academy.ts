/** Respaldo histórico de Course.inLanguage; no interpreta el idioma de la página. */
import type { IdiomaClasificado } from './clasificacion.ts';
import type { OfertaCatalogo } from './contrato.ts';
import datos from './idiomas-academy.json' with { type: 'json' };

const POR_ID = new Map<string, (typeof datos.registros)[number][]>();
for (const registro of datos.registros) {
  const anteriores = POR_ID.get(registro.unidad.id) ?? [];
  anteriores.push(registro);
  POR_ID.set(registro.unidad.id, anteriores);
}
export function idiomaAcademy(oferta: OfertaCatalogo): IdiomaClasificado | null {
  const coincidencias = POR_ID.get(oferta.unidad.id) ?? [];
  const r = coincidencias.length === 1 ? coincidencias[0] : undefined;
  const hecho = oferta.hechos.idiomas_declarados;
  if (
    !r ||
    oferta.proveedor_id !== 'anthropic' ||
    oferta.unidad.tipo !== 'recurso' ||
    r.unidad.tipo !== oferta.unidad.tipo ||
    r.unidad.programa_id !== oferta.unidad.programa_id ||
    r.titulo !== oferta.titulo_programa ||
    r.url !== oferta.url ||
    !['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(hecho.motivo) ||
    !oferta.referencias.some((x) => x.url === r.url && x.sha256 === r.sha256) ||
    oferta.referencias.some(
      (x) => x.url === r.url && x.sha256 !== r.sha256 && Date.parse(x.fecha_referencia) > Date.parse(r.capturadoEl),
    )
  ) {
    return null;
  }
  return {
    unidadId: oferta.unidad.id,
    tipoUnidad: oferta.unidad.tipo,
    valorOriginal: hecho.valor,
    motivoOriginal: hecho.motivo,
    modalidadOriginal: oferta.hechos.modalidad,
    sincroniaOriginal: oferta.hechos.sincronia,
    valores: ['en'],
    origen: 'fuente',
    alcance: 'edicion',
    confianza: 'alta',
    literal: 'en',
    motivo: {
      es: 'Idioma declarado para este curso por Anthropic.',
      ca: 'Idioma declarat per a aquest curs per Anthropic.',
    },
    evidencias: [{ url: r.url, sha256: r.sha256, capturadoEl: r.capturadoEl, localizador: 'Course.inLanguage' }],
    anclajesEnOferta: [0],
  };
}
