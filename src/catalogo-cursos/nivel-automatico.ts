/** Orientaciones conservadoras de dificultad apoyadas en contenido y título. */
import type { NivelClasificado, NivelCurso } from './clasificacion.ts';
import type { EvidenciaMateriaCatalogo, OfertaCatalogo } from './contrato.ts';
export interface NivelContenidoObservado {
  readonly unidad: OfertaCatalogo['unidad'];
  readonly titulo: string;
  readonly contenido_sha256: string;
  readonly captura_sha256: string;
  readonly url: string;
  readonly capturadoEl: string;
  readonly valor: NivelCurso;
  readonly literal: string;
  readonly campo: 'categoria' | 'descripcion';
}
function literalNivel(oferta: OfertaCatalogo): { valor: NivelCurso; literal: string } | null {
  // El título y los requisitos son evidencias distintas; las reglas solo detectan expresiones explícitas.
  const esCibernarium = oferta.proveedor_id === 'cibernarium';
  const excluirHerramientas = esCibernarium
    ? /\b(?:herramientas|eines|t[eè]cnicas|t[eè]cniques)\s+(?:avanzad[oa]s?|avan[cç](?:at|ada|ats|ades))\b/giu
    : /\b(?:herramientas|eines|t[eè]cnicas|t[eè]cniques)\s+avan[cç]ad[ao]s?\b/giu;
  const titulo = oferta.titulo_programa.replace(excluirHerramientas, '');
  const textos = [titulo];
  const patrones: readonly [NivelCurso, RegExp][] = [
    [
      'inicial',
      /\b(?:principiantes|principiants|principiante|principiant|b[aáà]sic[oa]s?|des\s+de\s+(?:cero|zero))\b|\b(?:nivel|nivell)\s+(?:inicial|b[aá]sico|b[aà]sic|principiante)|\b(?:curso|curs|formaci[oó])\s+(?:de\s+)?(?:iniciaci[oó]n?|introducci[oó]n?)\b|\b(?:iniciaci[oó]n?|introducci[oó]n?)\s+(?:a|al|a la|als|a les)\b/iu,
    ],
    ['intermedio', /\b(?:nivel|nivell)\s+(?:intermedio|intermedi|medio|mitj[aà])\b/iu],
    [
      'avanzado',
      esCibernarium
        ? /\b(?:avanzad[oa]s?|avan[cç](?:ad[ao]s?|at|ada|ats|ades))\b|\b(?:nivel|nivell)\s+(?:avanzado|avan[cç]at|avanzada|avan[cç]ada)\b/iu
        : /\b(?:avanzad[oa]s?|avan[cç]ad[oa]s?)\b|\b(?:nivel|nivell)\s+(?:avanzado|avan[cç]at|avanzada|avan[cç]ada)\b/iu,
    ],
  ];
  const coincidencias = textos.flatMap((texto) =>
    patrones.flatMap(([valor, patron]) => {
      const match = patron.exec(texto);
      return match ? [{ valor, literal: match[0] }] : [];
    }),
  );
  const fundamento = esCibernarium
    ? /\b(?:nivel|nivell)\s+1\b(?=\s*[:\-–]\s*(?:fonaments|fundamentos))/iu.exec(titulo)
    : null;
  if (fundamento) {
    coincidencias.push({ valor: 'inicial', literal: fundamento[0] });
  }
  return new Set(coincidencias.map((x) => x.valor)).size === 1 ? (coincidencias[0] ?? null) : null;
}
function referenciaTitulo(oferta: OfertaCatalogo) {
  const materia = oferta.evidencia_materia;
  const captura =
    materia?.edicion_id === oferta.unidad.id && materia.programa_id === oferta.unidad.programa_id
      ? materia.contenido
      : null;
  return oferta.referencias.find(
    (r) =>
      (captura && r.url === captura.url && r.sha256 === captura.sha256_captura) ||
      (oferta.proveedor_id.startsWith('fundae:publicador:') &&
        r.url.startsWith('https://agora.fundae.es/Buscador/BuscarRecursosFormativosFundaeSEB?')),
  );
}
function formarNivelContenido(dato: NivelContenidoObservado, localizador: string): NivelClasificado {
  return {
    valor: dato.valor,
    origen: 'faro',
    literal: dato.literal,
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    evidencia: {
      url: dato.url,
      sha256: dato.captura_sha256,
      capturadoEl: dato.capturadoEl,
      localizador,
    },
    motivo: {
      es:
        dato.valor === 'intermedio' && dato.campo === 'descripcion'
          ? 'Orientación de Faro por las acciones y el contexto descritos. Consulta los requisitos publicados.'
          : 'Orientación de Faro basada en la categoría o la descripción que publica el centro.',
      ca:
        dato.valor === 'intermedio' && dato.campo === 'descripcion'
          ? 'Orientació de Faro per les accions i el context descrits. Consulta els requisits publicats.'
          : 'Orientació de Faro basada en la categoria o la descripció que publica el centre.',
    },
  };
}
function registrosDinamicos(
  oferta: OfertaCatalogo,
  contenido: NonNullable<EvidenciaMateriaCatalogo['contenido']>,
): readonly NivelContenidoObservado[] | null {
  const sugerencia = contenido.nivel_sugerido;
  if (
    !sugerencia ||
    !['nivel-cibernarium-v1', 'nivel-cibernarium-v2', 'nivel-cibernarium-v3'].includes(sugerencia.regla)
  ) {
    return null;
  }
  if (sugerencia.valor === 'intermedio' && sugerencia.regla !== 'nivel-cibernarium-v3') {
    return null;
  }
  const textos: Record<NivelCurso, string> = {
    inicial: 'inicio o conocimientos previos no necesarios',
    intermedio: 'continuación o aplicación especializada',
    avanzado: 'certificación experta y competencias avanzadas',
  };
  let literal = textos[sugerencia.valor];
  if (sugerencia.origen === 'categoria') {
    literal = sugerencia.valor === 'inicial' ? 'formación tecnológica básica' : 'formación tecnológica avanzada';
  }
  return [
    {
      unidad: oferta.unidad,
      titulo: oferta.titulo_programa,
      contenido_sha256: contenido.sha256,
      captura_sha256: contenido.sha256_captura,
      url: contenido.url,
      capturadoEl: contenido.capturado_utc,
      valor: sugerencia.valor,
      campo: sugerencia.origen,
      literal,
    },
  ];
}
function contenidoContradiceTitulo(oferta: OfertaCatalogo, dato: NivelContenidoObservado): boolean {
  const limpio = oferta.titulo_programa.replace(
    /\b(?:herramientas|eines|t[eè]cnicas|t[eè]cniques)\s+(?:avanzad[oa]s?|avan[cç](?:at|ada|ats|ades))\b/giu,
    '',
  );
  if (
    /\b(?:avanzad[oa]s?|avan[cç](?:ad[ao]s?|at|ada|ats|ades))\b/iu.test(limpio) &&
    /\b(?:principiants?|principiantes?|des\s+de\s+(?:zero|cero)|b[aáà]sic[oa]s?)\b/iu.test(limpio)
  ) {
    return true;
  }
  const titulo = literalNivel(oferta);
  if (titulo && titulo.valor !== dato.valor) {
    return true;
  }
  return false;
}
function nivelDeContenido(
  oferta: OfertaCatalogo,
  registros: readonly NivelContenidoObservado[],
): NivelClasificado | 'conflicto' | null {
  const evidencia = oferta.evidencia_materia;
  const contenido = evidencia?.contenido;
  if (
    !evidencia ||
    !contenido ||
    evidencia.edicion_id !== oferta.unidad.id ||
    evidencia.programa_id !== oferta.unidad.programa_id
  ) {
    return null;
  }
  const dinamicos = registrosDinamicos(oferta, contenido) ?? registros;
  const candidatas = dinamicos.filter(
    (r) =>
      r.unidad.id === oferta.unidad.id &&
      r.unidad.programa_id === oferta.unidad.programa_id &&
      r.unidad.tipo === oferta.unidad.tipo &&
      r.titulo === oferta.titulo_programa &&
      r.contenido_sha256 === contenido.sha256 &&
      r.captura_sha256 === contenido.sha256_captura &&
      r.url === contenido.url &&
      oferta.referencias.some((ref) => ref.url === r.url && ref.sha256 === r.captura_sha256),
  );
  if (candidatas.length !== 1) {
    return null;
  }
  const dato = candidatas[0];
  if (!dato) {
    return null;
  }
  if (contenidoContradiceTitulo(oferta, dato)) {
    return 'conflicto';
  }
  return formarNivelContenido(dato, contenido.localizador);
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: identidad y límites de la fuente se comprueban juntos.
function nivelDeItinerario(oferta: OfertaCatalogo): NivelClasificado | 'conflicto' | null {
  const dato = oferta.nivel_itinerario;
  if (
    !dato ||
    oferta.proveedor_id !== 'cibernarium' ||
    oferta.unidad.tipo !== 'edicion' ||
    !/^cibernarium:[1-9][0-9]*$/u.test(oferta.unidad.programa_id) ||
    !/^cibernarium-edicion:[1-9][0-9]*$/u.test(oferta.unidad.id) ||
    dato.unidad_id !== oferta.unidad.id ||
    dato.programa_id !== oferta.unidad.programa_id ||
    dato.titulo !== oferta.titulo_programa ||
    !['cibernarium-itinerario-v1', 'cibernarium-ficha-tareas-v1'].includes(dato.version) ||
    (dato.version === 'cibernarium-itinerario-v1' && dato.valor !== 'intermedio') ||
    dato.url !==
      `https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=${oferta.unidad.programa_id.replace(/^cibernarium:/u, '')}`
  ) {
    return null;
  }
  const referencia = oferta.referencias.find((r) => r.url === dato.url && r.sha256 === dato.sha256);
  if (!referencia) {
    return null;
  }
  const titulo = literalNivel(oferta);
  if (titulo && titulo.valor !== dato.valor) {
    return 'conflicto';
  }
  return {
    valor: dato.valor,
    origen: 'faro',
    literal: null,
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    evidencia: {
      url: dato.url,
      sha256: dato.sha256,
      capturadoEl: referencia.fecha_referencia,
      localizador: dato.localizador,
    },
    motivo: {
      es:
        dato.version === 'cibernarium-itinerario-v1'
          ? 'Orientación de Faro: el curso es una etapa posterior dentro del itinerario recomendado. No es un nivel oficial ni un requisito de acceso.'
          : 'Orientación de Faro según las tareas descritas en el temario. No es un nivel oficial ni un requisito de acceso.',
      ca:
        dato.version === 'cibernarium-itinerario-v1'
          ? 'Orientació de Faro: el curs és una etapa posterior dins de l’itinerari recomanat. No és un nivell oficial ni un requisit d’accés.'
          : 'Orientació de Faro segons les tasques descrites en el temari. No és un nivell oficial ni un requisit d’accés.',
    },
  };
}

function nivelDeActividad(oferta: OfertaCatalogo): NivelClasificado | 'conflicto' | null {
  const dato = oferta.nivel_actividad;
  if (
    !dato ||
    oferta.proveedor_id !== 'cibervoluntarios' ||
    oferta.unidad.tipo !== 'recurso' ||
    oferta.unidad.id !== `cibervoluntarios:material:${dato.material_id}` ||
    oferta.unidad.programa_id !== oferta.unidad.id ||
    !oferta.referencias.some(
      (r) => r.url === dato.url && r.sha256 === dato.sha256 && r.fecha_referencia === dato.capturado_utc,
    )
  ) {
    return null;
  }
  const titulo = literalNivel(oferta);
  if (titulo && titulo.valor !== dato.valor) {
    return 'conflicto';
  }
  return {
    valor: dato.valor,
    origen: 'fuente',
    literal: dato.literal,
    alcance: 'actividad-contenedora',
    escala: 'nivel-publicado-actividad',
    evidencia: { url: dato.url, sha256: dato.sha256, capturadoEl: dato.capturado_utc, localizador: dato.localizador },
    motivo: {
      es: 'Nivel publicado por Cibervoluntarios para la actividad que contiene este material.',
      ca: 'Nivell publicat per Cibervoluntarios per a l’activitat que conté aquest material.',
    },
  };
}
export function nivelAutomatico(
  oferta: OfertaCatalogo,
  anterior: NivelClasificado,
  registros: readonly NivelContenidoObservado[],
): NivelClasificado {
  if (anterior.valor !== null) {
    return anterior;
  }
  const actividad = nivelDeActividad(oferta);
  if (actividad === 'conflicto') {
    return anterior;
  }
  if (actividad) {
    return actividad;
  }
  const contenido = nivelDeContenido(oferta, registros);
  const itinerario = nivelDeItinerario(oferta);
  if (contenido === 'conflicto' || itinerario === 'conflicto') {
    return anterior;
  }
  if (contenido && itinerario && contenido.valor !== itinerario.valor) {
    return anterior;
  }
  if (contenido) {
    return contenido;
  }
  if (itinerario) {
    return itinerario;
  }
  const referencia = referenciaTitulo(oferta);
  const pista = referencia ? literalNivel(oferta) : null;
  if (!pista || !referencia) {
    return anterior;
  }
  return {
    valor: pista.valor,
    origen: 'faro',
    literal: pista.literal,
    evidencia: {
      url: referencia.url,
      sha256: referencia.sha256,
      capturadoEl: referencia.fecha_referencia,
      localizador: 'titulo_programa',
    },
    alcance: 'orientacion',
    escala: 'inicial-intermedio-avanzado',
    motivo: {
      es: 'Orientación de Faro basada en el nivel que indica el título del curso.',
      ca: 'Orientació de Faro basada en el nivell que indica el títol del curs.',
    },
  };
}
