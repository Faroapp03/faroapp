import { sha256Hex } from '../comun/huella.ts';
import { esObjeto } from '../comun/json.ts';
import { RelojAtrasado } from '../comun/reloj-atrasado.ts';
import { diaCivilDeInstante } from './calendarios.ts';
import {
  CAMPOS_CALENDARIO,
  CAMPOS_HECHOS,
  CatalogoNoValido,
  type EntregaCatalogo,
  MAX_BYTES_CATALOGO,
  type OfertaCatalogo,
  type ReferenciaEntregaCatalogo,
  VERSION_CATALOGO,
} from './contrato.ts';
import { compararTextos, esEntregaCatalogo, esSha } from './forma.ts';
import { evidenciasDeClasificacion } from './forma-clasificacion.ts';
import { instanteCatalogo, relojCatalogo, sePuedeOfrecer } from './vigencia.ts';

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function deserializar(bytes: Uint8Array, referencia: ReferenciaEntregaCatalogo): unknown {
  if (
    !esSha(referencia.sha256) ||
    !esSha(referencia.revision) ||
    !Number.isSafeInteger(referencia.bytes) ||
    referencia.bytes <= 0 ||
    referencia.bytes > MAX_BYTES_CATALOGO ||
    bytes.byteLength !== referencia.bytes ||
    sha256Hex(bytes) !== referencia.sha256
  ) {
    throw new CatalogoNoValido('El catálogo no coincide con la entrega admitida');
  }
  try {
    return JSON.parse(UTF8.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new CatalogoNoValido('El catálogo no contiene JSON UTF-8 válido', { cause: error });
    }
    throw error;
  }
}

function comprobarOrden<T>(filas: readonly T[], comparar: (a: T, b: T) => number): void {
  for (let indice = 1; indice < filas.length; indice++) {
    const anterior = filas[indice - 1];
    const actual = filas[indice];
    if (anterior === undefined || actual === undefined || comparar(anterior, actual) >= 0) {
      throw new CatalogoNoValido('Identidades repetidas o sin orden canónico');
    }
  }
}

function compararOfertas(a: OfertaCatalogo, b: OfertaCatalogo): number {
  return compararTextos(a.unidad.tipo, b.unidad.tipo) || compararTextos(a.unidad.id, b.unidad.id);
}

/** Cada hecho conserva su comprobación fechada; no tiene caducidad propia. */
function comprobarFechasDeHechos(oferta: OfertaCatalogo, corte: bigint): void {
  const fechas = new Set(oferta.referencias.map((r) => instanteCatalogo(r.fecha_referencia)));
  for (const campo of CAMPOS_HECHOS) {
    const plazo = oferta.hechos[campo].vigencia;
    if (!plazo) {
      continue;
    }
    const comprobado = instanteCatalogo(plazo.comprobado_el);
    if (!(comprobado <= corte && fechas.has(comprobado))) {
      throw new CatalogoNoValido('Condición posterior al corte o sin referencia fechada');
    }
  }
}

function comprobarEvidenciaMateria(oferta: OfertaCatalogo, corte: bigint): void {
  const evidencia = oferta.evidencia_materia;
  if (evidencia == null) {
    return;
  }
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    oferta.unidad.tipo !== 'edicion' ||
    !oferta.unidad.id.startsWith('cibernarium-edicion:') ||
    !oferta.unidad.programa_id.startsWith('cibernarium:') ||
    evidencia.edicion_id !== oferta.unidad.id ||
    evidencia.programa_id !== oferta.unidad.programa_id ||
    (evidencia.estado_censo === 'sin-evidencia' && evidencia.censo_ia !== null) ||
    [evidencia.vinculo, evidencia.contenido, evidencia.censo_ia].some(
      (parte) => parte !== null && instanteCatalogo(parte.capturado_utc) > corte,
    )
  ) {
    throw new CatalogoNoValido('Evidencia de materia incompatible con la oferta o el corte');
  }
}

function comprobarNivelActividad(oferta: OfertaCatalogo, corte: bigint): void {
  const dato = oferta.nivel_actividad;
  if (!dato) {
    return;
  }
  const valores = { Básico: 'inicial', Intermedio: 'intermedio', Avanzado: 'avanzado' } as const;
  const url = new URL(dato.url);
  if (
    oferta.proveedor_id !== 'cibervoluntarios' ||
    oferta.unidad.tipo !== 'recurso' ||
    oferta.unidad.id !== `cibervoluntarios:material:${dato.material_id}` ||
    oferta.unidad.programa_id !== oferta.unidad.id ||
    !/^[0-9]+$/u.test(dato.actividad_id) ||
    !/^[0-9]+$/u.test(dato.material_id) ||
    valores[dato.literal] !== dato.valor ||
    url.origin !== 'https://www.cibervoluntarios.org' ||
    url.pathname !== '/api/public/activity_catalogs' ||
    !/^\/hydra:member\/\d+\/level$/u.test(dato.localizador) ||
    instanteCatalogo(dato.capturado_utc) > corte ||
    !oferta.referencias.some(
      (r) => r.url === dato.url && r.sha256 === dato.sha256 && r.fecha_referencia === dato.capturado_utc,
    )
  ) {
    throw new CatalogoNoValido('Nivel de actividad sin vínculo acreditado');
  }
}

function comprobarIdiomaPrograma(oferta: OfertaCatalogo): void {
  const dato = oferta.idioma_programa;
  if (!dato) {
    return;
  }
  const codigo = /^fundae:oferta:programa:([A-Z0-9_-]{1,40})$/u.exec(oferta.unidad.programa_id)?.[1];
  const url = new URL(dato.url);
  if (
    !codigo ||
    oferta.proveedor_id !== 'fundae:publicador:catalogo:3' ||
    oferta.unidad.tipo !== 'edicion' ||
    !/^fundae:edicion:[1-9]\d*$/u.test(oferta.unidad.id) ||
    url.origin !== 'https://agora.fundae.es' ||
    url.pathname !== '/Oferta/RecuperarDifusionesRFO' ||
    url.searchParams.getAll('codigoTitulacion').join() !== codigo ||
    !oferta.referencias.some((r) => r.url === dato.url && r.sha256 === dato.sha256)
  ) {
    throw new CatalogoNoValido('Idioma de programa sin vínculo acreditado');
  }
}

/** Lo que decide el productor se apoya en capturas que ya existían en el corte de la entrega. */
function comprobarClasificacion(oferta: OfertaCatalogo, corte: bigint): void {
  if (
    oferta.clasificacion &&
    evidenciasDeClasificacion(oferta.clasificacion).some((e) => instanteCatalogo(e.capturado_utc) > corte)
  ) {
    throw new CatalogoNoValido('Evidencia de clasificación posterior al corte');
  }
}

function comprobarPreinscripcion(oferta: OfertaCatalogo, corte: bigint): void {
  const { preinscripcion, unidad } = oferta;
  const proveedor = oferta.proveedor_id === 'fundae:publicador:catalogo:3';
  const especialidad = /^fundae:oferta:programa:([A-Z0-9_-]{1,40})$/u.exec(unidad.programa_id)?.[1];
  if (
    !preinscripcion &&
    !unidad.id.startsWith('fundae:edicion:') &&
    !(unidad.tipo === 'edicion' && (proveedor || unidad.programa_id.startsWith('fundae:oferta:programa:')))
  ) {
    return;
  }
  if (
    !preinscripcion ||
    !proveedor ||
    unidad.tipo !== 'edicion' ||
    !/^fundae:edicion:[1-9]\d*$/u.test(unidad.id) ||
    !especialidad ||
    oferta.url !== `https://experienciafundae.es/ficha-curso/oferta/2/${especialidad}`
  ) {
    throw new CatalogoNoValido('Preinscripción de otra edición o especialidad');
  }
  const hoy = diaCivilDeInstante(corte);
  if (
    preinscripcion.inicio > hoy ||
    hoy > preinscripcion.fin ||
    preinscripcion.fin === '9999-12-31' ||
    oferta.cierra_el === null ||
    diaCivilDeInstante(instanteCatalogo(oferta.cierra_el) - 1n) > preinscripcion.fin
  ) {
    throw new CatalogoNoValido('Preinscripción fuera del plazo publicado');
  }
}

function comprobarRelaciones(dato: EntregaCatalogo): void {
  comprobarOrden(dato.proveedores, (a, b) => compararTextos(a.id, b.id));
  comprobarOrden(dato.ofertas, compararOfertas);
  const proveedores = new Set(dato.proveedores.map((p) => p.id));
  const usados = new Set(dato.ofertas.map((o) => o.proveedor_id));
  const corte = instanteCatalogo(dato.corte_proyeccion_utc);
  const cobertura = { recurso: 0, edicion: 0 };
  for (const oferta of dato.ofertas) {
    if (
      (oferta.unidad.tipo === 'recurso' && CAMPOS_CALENDARIO.some((c) => oferta.hechos[c].valor !== null)) ||
      !proveedores.has(oferta.proveedor_id) ||
      (oferta.unidad.tipo === 'recurso' && oferta.unidad.id !== oferta.unidad.programa_id) ||
      !sePuedeOfrecer(oferta, corte, corte) ||
      // La incidencia puede ser del catálogo y anterior a la comprobación de la ficha: solo se exige, como en el
      // contrato del productor, que no sea posterior a la evaluación que la registró.
      (oferta.incidencia_enlace_el !== null &&
        instanteCatalogo(oferta.incidencia_enlace_el) > instanteCatalogo(oferta.corte_evaluacion_utc))
    ) {
      throw new CatalogoNoValido('Relación o intervalo de oferta no admitido');
    }
    comprobarFechasDeHechos(oferta, corte);
    comprobarEvidenciaMateria(oferta, corte);
    comprobarNivelActividad(oferta, corte);
    comprobarIdiomaPrograma(oferta);
    comprobarClasificacion(oferta, corte);
    if (dato.schema_version >= VERSION_CATALOGO) {
      comprobarPreinscripcion(oferta, corte);
    }
    cobertura[oferta.unidad.tipo]++;
  }
  if (
    proveedores.size !== usados.size ||
    cobertura.recurso !== dato.cobertura.recurso ||
    cobertura.edicion !== dato.cobertura.edicion
  ) {
    throw new CatalogoNoValido('Proveedor o cobertura sin oferta acreditada');
  }
}

function congelar(dato: EntregaCatalogo): void {
  const pendientes: unknown[] = [dato];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (Array.isArray(actual)) {
      Object.freeze(actual);
      for (const hijo of actual) {
        pendientes.push(hijo);
      }
    } else if (esObjeto(actual)) {
      Object.freeze(actual);
      for (const clave of Object.keys(actual)) {
        pendientes.push(actual[clave]);
      }
    }
  }
}

/**
 * Lee una vez el recurso estático admitido. La plataforma suministra SHA/tamaño/revisión de
 * la composición confiable, nunca del visitante. No recalcula revisión como JCS.
 */
export function leerCatalogo(bytes: Uint8Array, referencia: ReferenciaEntregaCatalogo): EntregaCatalogo {
  const dato = deserializar(bytes, referencia);
  if (!esEntregaCatalogo(dato) || dato.revision !== referencia.revision) {
    throw new CatalogoNoValido('Contrato público de catálogo no admitido');
  }
  comprobarRelaciones(dato);
  congelar(dato);
  return dato;
}

/**
 * El reloj viene de la plataforma y solo retira por límites publicados. Un reloj anterior al corte de la entrega no
 * simula una lista vacía ni deja pasar cursos de los que no se puede saber si han terminado: lanza RelojAtrasado.
 * Aquí se comparan dos instantes UTC (el reloj y el corte de la proyección), que no dependen de la zona horaria de
 * la persona: la comparación es exacta y no lleva margen. El margen de un día es solo de las comparaciones de días
 * (primerDiaPosibleDelDispositivo, en el informe).
 */
export function ofertasVigentes(catalogo: EntregaCatalogo, ahoraMilisegundos: number): readonly OfertaCatalogo[] {
  const ahora = relojCatalogo(ahoraMilisegundos);
  const corte = instanteCatalogo(catalogo.corte_proyeccion_utc);
  if (ahora < corte) {
    throw new RelojAtrasado('Reloj anterior al corte de la entrega');
  }
  return Object.freeze(catalogo.ofertas.filter((oferta) => sePuedeOfrecer(oferta, corte, ahora)));
}
