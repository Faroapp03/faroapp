/** Catálogo y aprendizaje exclusivamente sintéticos: no acreditan oferta ni activan Cursos. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import type { AfirmacionAprendizaje, RevisionAprendizaje } from '../../src/seleccion-formacion/aprendizaje.ts';
import type { CompaneroAprendizaje, PreferenciasSeleccion } from '../../src/seleccion-formacion/contrato.ts';
import { leerCompanero } from '../../src/seleccion-formacion/lectura.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';

const SHA_CIFRAS = 64;
export const AHORA_FORMACION = Date.parse('2026-10-22T11:00:00Z');
export const CIERRA_EL_FORMACION = '2026-12-15T10:00:00Z';
const BASE: EntregaCatalogo = leerCatalogo(
  readFileSync(new URL('./catalogo-cursos-publico.utf8', import.meta.url)),
  JSON.parse(readFileSync(new URL('./catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8')),
);
const REGISTRO = readFileSync(
  new URL('../../plataforma_datos/cursos/esquemas/registro_aprendizaje.json', import.meta.url),
  'utf8',
);
const IDENTIDAD: { id: string; version: string } = JSON.parse(REGISTRO);
const R = { id: IDENTIDAD.id, version: IDENTIDAD.version, sha256: createHash('sha256').update(REGISTRO).digest('hex') };
const REVISION: RevisionAprendizaje = {
  tipo: 'automatizada',
  referencia: 'fixture-no-admitido',
  metodo: { nombre: 'fixture', version: '1' },
  fecha_utc: '2026-10-22T10:00:00Z',
};
const EVIDENCIA = {
  url: 'https://formacion.example/ficha',
  capturado_utc: '2026-10-20T09:00:00Z',
  sha256: 'c'.repeat(SHA_CIFRAS),
  localizador: { tipo: 'objetivo', valor: 'body/lista/1' } as const,
  fragmento: 'Aprendre a protegir dades en una tasca.',
};
export const PREFERENCIAS_FORMACION: PreferenciasSeleccion = {
  etapa: 'inicial',
  idiomas: ['es'],
  modalidad: 'cualquiera',
  aceptaRegistro: true,
  requisitosConfirmados: [],
  excluidos: [],
};
function ofertaSintetica() {
  const original = BASE.ofertas[0];
  if (!original) {
    throw new Error('Fixture de catálogo sin oferta');
  }
  const oferta = {
    ...original,
    titulo_programa: 'Curso sintético de privacidad',
    url: 'https://formacion.example/curso',
    comprobado_el: '2026-10-22T10:00:00Z',
    corte_evaluacion_utc: '2026-10-22T11:00:00Z',
    // Límite publicado sintético, semanas después de la comprobación.
    cierra_el: CIERRA_EL_FORMACION,
    hechos: {
      ...original.hechos,
      coste_formacion_tipo: {
        ...original.hechos.coste_formacion_tipo,
        valor: 'gratis_formacion',
        motivo: 'conocido',
      } as const,
      coste_formacion: { ...original.hechos.coste_formacion, valor: 0, motivo: 'conocido' } as const,
      idiomas_declarados: { ...original.hechos.idiomas_declarados, valor: ['ca', 'es'], motivo: 'conocido' } as const,
      requiere_registro_previo: {
        ...original.hechos.requiere_registro_previo,
        valor: true,
        motivo: 'conocido',
      } as const,
    },
    referencias: [
      {
        url: EVIDENCIA.url,
        sha256: EVIDENCIA.sha256,
        fecha_referencia: EVIDENCIA.capturado_utc,
        alcance: 'entidad',
        naturaleza_fecha: 'recepcion_conservada',
        naturaleza_documento: 'no_acreditada',
      } as const,
    ],
  };
  return oferta;
}
function catalogoSintetico() {
  const oferta = ofertaSintetica();
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...BASE, corte_proyeccion_utc: oferta.corte_evaluacion_utc, ofertas: [oferta] }),
  );
  const ref = {
    revision: BASE.revision,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
  const catalogo = leerCatalogo(bytes, ref);
  return { catalogo, ref, oferta };
}
function afirmacionesSinteticas(requisito: boolean) {
  const afirmaciones: AfirmacionAprendizaje[] = [
    {
      id: 'privacidad',
      competencia: null,
      dimension: 'resultado_previsto',
      descripcion: EVIDENCIA.fragmento,
      nivel: { escala: null, valor: null },
      origen: 'extraccion_oficial',
      estado: 'extraida',
      metodo: { nombre: 'fixture', version: '1' },
      revision: null,
      evidencias: [EVIDENCIA],
      discrepancias: [],
      revision_requerida: false,
    },
  ];
  if (requisito) {
    afirmaciones.push({
      ...(afirmaciones[0] as AfirmacionAprendizaje),
      id: 'entrada',
      dimension: 'requisito_entrada',
      descripcion: 'Saber guardar un fichero.',
      evidencias: [{ ...EVIDENCIA, localizador: { tipo: 'requisito', valor: 'body/requisito' } }],
    });
  }
  return afirmaciones;
}
function companeroSintetico(
  programa: string,
  ref: CompaneroAprendizaje['catalogo'],
  requisito: boolean,
): CompaneroAprendizaje {
  const afirmaciones = afirmacionesSinteticas(requisito);
  return {
    schema_version: 1,
    catalogo: ref,
    registro: R,
    registro_json: REGISTRO,
    fichas: [
      {
        programa_id: programa,
        idioma_ficha: 'ca',
        aprendizaje: { schema_version: 1, registro: R, contenido_observado: true, afirmaciones },
        requisitos: requisito ? 'publicados' : 'no_publicados',
        revision: REVISION,
        cobertura: [
          {
            criterio: 'privacidad',
            afirmaciones: ['privacidad'],
            via: null,
            justificacion: {
              es: 'El temario sintético trata protección de datos.',
              ca: 'El temari sintètic tracta la protecció de dades.',
            },
          },
        ],
      },
    ],
    caminos: [
      {
        id: 'camino-sintetico',
        etapa: 'inicial',
        programas: [programa],
        revision: REVISION,
        justificacion: {
          es: 'Aporte de privacidad; los otros criterios siguen pendientes.',
          ca: 'Aportació de privacitat; els altres criteris continuen pendents.',
        },
      },
    ],
  };
}
export function casoDeFormacion(requisito = false) {
  const { catalogo, ref, oferta } = catalogoSintetico();
  const preparado = companeroSintetico(oferta.unidad.programa_id, ref, requisito);
  const b = new TextEncoder().encode(JSON.stringify(preparado));
  const companero = leerCompanero(
    b,
    { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.byteLength },
    ref,
    catalogo,
  );
  return {
    catalogo,
    companero,
    preferencias: PREFERENCIAS_FORMACION,
    seleccion: seleccionarFormacion(catalogo, companero, PREFERENCIAS_FORMACION, AHORA_FORMACION),
  };
}
