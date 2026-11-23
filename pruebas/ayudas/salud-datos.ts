/**
 * Estados de datos del panel inventados para las pruebas; ninguno afirma nada sobre la entrega activa. Por defecto se
 * usa la versión actual (v5); la v4 se pide por su nombre para ensayar la lectura de estados guardados antes.
 */
import type {
  EstadoDatosPanelV4,
  EstadoDatosPanelV5,
  OperacionFuenteDatos,
} from '../../src/administracion/estado-datos.js';
export const CORTE_SALUD = '2026-10-23T12:00:00Z';
export const CONSULTA_SALUD = '2026-10-22T10:00:00Z';
const CICLO = '00000000-0000-4000-8000-000000000001';
const CIFRAS_SHA = 64;
const HUELLA = 'a'.repeat(CIFRAS_SHA);

/** Una consulta remota comprobada de una fuente. */
export function operacionSalud(cambios: Partial<OperacionFuenteDatos> = {}): OperacionFuenteDatos {
  return {
    ciclo: CICLO,
    inicioEn: CONSULTA_SALUD,
    finEn: CONSULTA_SALUD,
    resultado: 'comprobada',
    remoto: true,
    ultimoIntentoRemotoEn: CONSULTA_SALUD,
    huellaEvidencia: HUELLA,
    ...cambios,
  };
}

/** Un estado v4, con su campo `formacionAbiertaCaduca`, tal como se guardaba antes de la v5. */
export function instantaneaSaludV4(cambios: Partial<EstadoDatosPanelV4> = {}): EstadoDatosPanelV4 {
  return {
    version: 4,
    observadoEn: CORTE_SALUD,
    fuentes: [
      { id: 'empresas', politica: 'mensual', fecha: '2026-01-01', plazoDias: 30, ultimaOperacion: operacionSalud() },
    ],
    modulos: ['empresas', 'paquete'].map((id) => ({
      id,
      ultimoIntento: null,
      veredicto: null,
      ultimaVersionBuena: null,
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
    comprobaciones: {
      registradoEn: CONSULTA_SALUD,
      reconstruccionPendiente: false,
      conjuntos: [
        {
          id: 'empresas',
          fuente: 'empresas',
          alcance: 'catalogo-actual',
          operacion: 'descargar',
          intervaloDias: 30,
          revisionNecesaria: false,
          ultimaComprobacion: { fecha: CONSULTA_SALUD, ciclo: CICLO, huellaEvidencia: HUELLA },
        },
      ],
    },
    seguimientoRemoto: [{ fuente: 'empresas', ultimoIntento: operacionSalud(), incidenciasPendientes: [] }],
    catalogoFuentes: [
      { id: 'empresas', nombre: 'Empresas y uso de IA', tema: 'mercado', modalidad: 'operativa' },
      { id: 'preparada', nombre: 'Fuente candidata de prueba', tema: 'comun', modalidad: 'candidata' },
    ],
    ...cambios,
  };
}

/** El estado actual (v5): el de la v4 con su campo de aviso renombrado a `formacionAbiertaRevisionPendiente`. */
export function instantaneaSalud(cambios: Partial<EstadoDatosPanelV5> = {}): EstadoDatosPanelV5 {
  const { version: _version, formacionAbiertaCaduca: _anterior, ...comun } = instantaneaSaludV4();
  return { ...comun, version: 5, formacionAbiertaRevisionPendiente: null, ...cambios };
}

/**
 * Un estado v4 con Formación abierta, la única fuente con revisión periódica de sus fichas. Hasta la v4 esa revisión
 * se publicaba en `formacionAbiertaCaduca`; la v5 la renombró.
 */
export function v4ConFormacionAbierta(revision: string): EstadoDatosPanelV4 {
  const datos = instantaneaSaludV4();
  const [fuente] = datos.fuentes;
  const [modulo] = datos.modulos;
  const [conjunto] = datos.comprobaciones.conjuntos;
  if (!(fuente && modulo && conjunto)) {
    throw new Error('El estado v4 de base debe tener una fuente, un módulo y un conjunto');
  }
  return instantaneaSaludV4({
    formacionAbiertaCaduca: revision,
    fuentes: [...datos.fuentes, { ...fuente, id: 'abierta' }],
    modulos: [...datos.modulos, { ...modulo, id: 'abierta' }],
    comprobaciones: {
      ...datos.comprobaciones,
      conjuntos: [...datos.comprobaciones.conjuntos, { ...conjunto, id: 'abierta', fuente: 'abierta' }],
    },
    seguimientoRemoto: [
      ...(datos.seguimientoRemoto ?? []),
      { fuente: 'abierta', ultimoIntento: operacionSalud(), incidenciasPendientes: [] },
    ],
    catalogoFuentes: [
      ...datos.catalogoFuentes,
      { id: 'abierta', nombre: 'Formación abierta', tema: 'cursos', modalidad: 'operativa' },
    ],
  });
}
