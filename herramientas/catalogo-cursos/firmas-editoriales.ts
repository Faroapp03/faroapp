/** Reconstruye guardas editoriales exclusivamente desde la instantánea pública fijada del 25/10/2026. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { firmaEditorial, identidadEditorial } from '../../src/catalogo-cursos/firma-editorial.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { jsonCanonico } from '../../src/comun/jcs.ts';
import { ejecutar, orden } from '../comun/opciones.ts';

interface Revision {
  readonly catalogoSha256: string;
  readonly programas: readonly {
    readonly programaId: string;
    readonly idiomasClasificados?: readonly {
      readonly unidadId: string;
      readonly tipoUnidad: string;
      readonly evidencias: readonly { readonly url: string; readonly sha256: string }[];
      readonly anclajesEnOferta?: readonly number[];
    }[];
  }[];
}

/** No crea decisiones ni evidencias: añade solo guardas derivadas de los bytes de la revisión ya hecha. */
export function conFirmasEditoriales<T extends Revision>(revision: T, catalogo: EntregaCatalogo) {
  const porUnidad = new Map(catalogo.ofertas.map((o) => [identidadEditorial(o), o]));
  return {
    ...revision,
    programas: revision.programas.map((programa) => ({
      ...programa,
      ...(programa.idiomasClasificados
        ? {
            idiomasClasificados: programa.idiomasClasificados.map((idioma) => {
              const oferta = porUnidad.get(JSON.stringify([idioma.tipoUnidad, idioma.unidadId]));
              if (!oferta || oferta.unidad.programa_id !== programa.programaId) {
                throw new Error('Complemento sin unidad revisada');
              }
              const anclajesEnOferta = idioma.evidencias.flatMap((e, i) =>
                oferta.referencias.some((r) => r.url === e.url && r.sha256 === e.sha256) ? [i] : [],
              );
              if (!anclajesEnOferta.length) {
                throw new Error('Complemento sin evidencia propia en la unidad revisada');
              }
              return { ...idioma, anclajesEnOferta };
            }),
          }
        : {}),
    })),
    unidadesRevisadas: Object.fromEntries(catalogo.ofertas.map((o) => [identidadEditorial(o), firmaEditorial(o)])),
  };
}

function principal(): void {
  const { values } = orden('node herramientas/catalogo-cursos/firmas-editoriales.ts [--comprobar]').leer({
    options: { comprobar: { type: 'boolean' } },
  });
  const ruta = new URL('../../src/catalogo-cursos/clasificacion-revisada.json', import.meta.url);
  const revision = JSON.parse(readFileSync(ruta, 'utf8')) as Revision;
  const bytes = readFileSync(new URL('../../pruebas/fixtures/catalogo-clasificacion-20261025.utf8', import.meta.url));
  const declarado = JSON.parse(bytes.toString('utf8')) as EntregaCatalogo;
  const catalogo = leerCatalogo(bytes, {
    sha256: revision.catalogoSha256,
    bytes: bytes.length,
    revision: declarado.revision,
  });
  const nueva = conFirmasEditoriales(revision, catalogo);
  if (values.comprobar) {
    if (jsonCanonico(nueva) !== jsonCanonico(revision)) {
      throw new Error('Guardas editoriales desactualizadas');
    }
  } else {
    writeFileSync(ruta, `${JSON.stringify(nueva, null, 2)}\n`);
  }
}
if (import.meta.main) {
  await ejecutar(principal, 'Firmas editoriales de Cursos');
}
