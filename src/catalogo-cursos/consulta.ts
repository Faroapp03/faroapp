/** Consulta del catálogo factual. Las fichas preparadas y la consulta pública comparten orden, búsqueda y recuentos. */
import type { EntregaCatalogo, OfertaCatalogo } from './contrato.ts';
import { orientadorDelCatalogo } from './idioma-cibernarium.ts';
import { ofertasVigentes } from './lectura.ts';
import {
  type ConsultaListado,
  type ContextoConsulta,
  consultarFichas,
  esperaHastaCierre,
  type FichaListado,
  type FiltrosCatalogo,
} from './listado.ts';
import { fichaDelListado, formacionGratuita } from './proyeccion-listado.ts';

export { CAMPOS_FILTRO, type CampoFiltro, type ContextoConsulta, type FiltrosCatalogo } from './listado.ts';
export { formacionGratuita, idiomasDelCurso } from './proyeccion-listado.ts';
export type ConsultaCatalogo = ConsultaListado<OfertaCatalogo>;

const INDICES = new WeakMap<EntregaCatalogo, ReadonlyMap<OfertaCatalogo, FichaListado>>();
function indice(catalogo: EntregaCatalogo) {
  let filas = INDICES.get(catalogo);
  if (!filas) {
    const proveedores = new Map(catalogo.proveedores.map((p) => [p.id, p.nombre]));
    const orientarIdioma = orientadorDelCatalogo(catalogo);
    filas = new Map(
      catalogo.ofertas
        .filter(formacionGratuita)
        .map((o) => [o, fichaDelListado(o, proveedores.get(o.proveedor_id) ?? '', undefined, orientarIdioma)]),
    );
    INDICES.set(catalogo, filas);
  }
  return filas;
}
export function consultarCatalogo(
  catalogo: EntregaCatalogo,
  filtros: FiltrosCatalogo,
  ahora: number,
  contexto?: ContextoConsulta,
): ConsultaCatalogo {
  const fichas = indice(catalogo);
  const origenes = new Map<FichaListado, OfertaCatalogo>();
  for (const oferta of ofertasVigentes(catalogo, ahora)) {
    const ficha = fichas.get(oferta);
    if (ficha) {
      origenes.set(ficha, oferta);
    }
  }
  const consulta = consultarFichas([...origenes.keys()], filtros, ahora, contexto);
  return { ...consulta, ofertas: consulta.ofertas.map((ficha) => origenes.get(ficha) as OfertaCatalogo) };
}
export function proximaRevision(catalogo: EntregaCatalogo, ahora: number): number | null {
  return esperaHastaCierre(ofertasVigentes(catalogo, ahora), ahora);
}
