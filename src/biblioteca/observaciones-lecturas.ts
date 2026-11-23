/** Proyección de la entrega admitida de enlaces_lecturas, compartida por consumidores.
 * No identifica páginas ni decide actualidad editorial: consume el dictamen del productor.
 * El llamador debe verificar la integridad del paquete y proporcionar el SHA del catálogo
 * exacto. Una respuesta técnica fallida no es una retirada. Los enlaces locales requieren
 * evidencia de integridad del artefacto local, nunca una supuesta consulta remota.
 * La fecha de la última confirmación se conserva siempre; su edad no cambia nada de lo que se ve.
 * Un 404/410 o una redirección genérica describen el enlace, no el artículo: el enlace sigue
 * abierto y la incidencia (tipo y fecha) queda registrada para avisar junto a él. Solo un
 * destino no seguro deja de enlazarse, por seguridad.
 */

export interface ObjetivoLectura {
  readonly objetivo: string;
  readonly id: string;
  readonly campo: string;
  readonly url: string | null;
}
export interface IntegridadLocal {
  readonly objetivo: string;
  readonly url: string;
  readonly sha256: string;
}
export interface ProyeccionEnlace extends ObjetivoLectura {
  readonly estado: string;
  readonly abrir: boolean;
  readonly motivo: string;
  /** Fecha de la última confirmación, conservada incluso cuando ya no autoriza la acción. */
  readonly comprobado_utc: string | null;
  readonly ultimo_intento_utc: string | null;
  readonly cuerpo_sha256: string | null;
  /** Última evidencia contraria sobre el enlace sin confirmación posterior; null si no hay. */
  readonly incidencia: { readonly tipo: string; readonly fecha: string } | null;
}
interface Captura {
  readonly estado: string;
  readonly fecha: string;
  readonly instante: bigint;
  readonly sha256: string | null;
  readonly identificada: boolean;
}
interface Fila {
  readonly estado: string;
  readonly ultimo: Captura | null;
  readonly confirmacion: Captura | null;
  readonly evidencia: Captura | null;
}
export class ObservacionesLecturasInvalidas extends Error {}
const MICROSEGUNDOS_POR_MS = 1000n;
const DECIMALES = 6;
const HTTP_MIN = 100;
const HTTP_MAX = 599;
const DIA_MICROSEGUNDOS = 86_400_000_000n;
const SHA256 = /^[a-f0-9]{64}$/;
const FALLOS_SIN_RESPUESTA = new Set(['fallo_temporal', 'http_error']);
const FALLOS_TECNICOS = new Set([...FALLOS_SIN_RESPUESTA, 'servicio_no_disponible', 'limite_tamano']);
const EVIDENCIAS_POSITIVAS = new Set(['verificado']);
/** Incidencias del enlace: no retiran la ficha ni lo desactivan. */
const INCIDENCIAS_DEL_ENLACE = new Set(['http_no_encontrado', 'http_retirado', 'redireccion_generica']);
/** Por seguridad, un destino no seguro no se enlaza. */
const DESTINO_NO_SEGURO = 'destino_no_seguro';
const EVIDENCIAS_CONTRARIAS = new Set([...INCIDENCIAS_DEL_ENLACE, DESTINO_NO_SEGURO]);
const EVIDENCIAS_CONCLUYENTES = new Set([...EVIDENCIAS_POSITIVAS, ...EVIDENCIAS_CONTRARIAS]);
const HTTP_NO_ENCONTRADO = 404;
const HTTP_RETIRADO = 410;

function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) {
    throw new ObservacionesLecturasInvalidas(mensaje);
  }
}
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
function objeto(valor: unknown): Record<string, unknown> {
  exigir(esObjeto(valor), 'Se requiere objeto');
  return valor;
}
function claves(valor: Record<string, unknown>, esperadas: readonly string[]): void {
  exigir(
    Object.keys(valor).length === esperadas.length && esperadas.every((clave) => Object.hasOwn(valor, clave)),
    'Campos de contrato distintos',
  );
}
/** UTC con precisión contractual de hasta seis decimales; sin truncar orden causal a milisegundos. */
function instante(valor: unknown): bigint {
  exigir(typeof valor === 'string', 'Instante ausente');
  const coincidencia = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(valor);
  exigir(coincidencia?.[1], 'Instante UTC completo requerido');
  const base = `${coincidencia[1]}.000Z`;
  const fecha = Date.parse(base);
  exigir(Number.isFinite(fecha) && new Date(fecha).toISOString() === base, 'Fecha UTC inválida');
  return BigInt(fecha) * MICROSEGUNDOS_POR_MS + BigInt((coincidencia[2] ?? '').padEnd(DECIMALES, '0'));
}
function huella(valor: unknown): valor is string {
  return typeof valor === 'string' && SHA256.test(valor);
}
function estadoSinCuerpo(dato: Record<string, unknown>): unknown {
  if (dato.resultado === 'http_error') {
    if (dato.codigo_http === HTTP_NO_ENCONTRADO) {
      return 'http_no_encontrado';
    }
    if (dato.codigo_http === HTTP_RETIRADO) {
      return 'http_retirado';
    }
  }
  if (dato.resultado === 'fallo_temporal') {
    if (dato.error_tipo === 'LimiteDescargaExcedido') {
      return 'limite_tamano';
    }
    if (dato.error_tipo === 'DestinoNoSeguro') {
      return 'destino_no_seguro';
    }
  }
  return dato.resultado;
}

function validarRespuesta(dato: Record<string, unknown>): void {
  if (dato.resultado === 'respuesta') {
    exigir(
      typeof dato.url_final === 'string' && huella(dato.cuerpo_sha256) && dato.codigo_http === null,
      'Respuesta sin cuerpo específico',
    );
    const destino = new URL(dato.url_final);
    exigir(destino.protocol === 'https:' && !destino.username && !destino.password, 'Destino no público');
  } else {
    exigir(
      FALLOS_SIN_RESPUESTA.has(String(dato.resultado)) &&
        dato.estado === estadoSinCuerpo(dato) &&
        dato.url_final === null &&
        dato.cuerpo_sha256 === null &&
        !dato.identidad_acreditada,
      'Fallo confundido con respuesta',
    );
    exigir(
      dato.resultado === 'http_error'
        ? Number.isInteger(dato.codigo_http) &&
            Number(dato.codigo_http) >= HTTP_MIN &&
            Number(dato.codigo_http) <= HTTP_MAX
        : dato.codigo_http === null,
      'Código HTTP inválido',
    );
  }
  if (dato.estado === 'verificado') {
    exigir(
      dato.resultado === 'respuesta' && dato.identidad_acreditada && huella(dato.cuerpo_sha256),
      'Confirmación sin identidad acreditada',
    );
  }
}
const CAMPOS_CAPTURA = [
  'url',
  'url_final',
  'capturado_utc',
  'cuerpo_sha256',
  'content_type',
  'resultado',
  'codigo_http',
  'error_tipo',
  'estado',
  'identidad_acreditada',
  'vence_utc',
  'lectura_tecnica',
] as const;
function captura(valor: unknown, objetivo: ObjetivoLectura, dias: number, ahora: bigint): Captura {
  const dato = objeto(valor);
  claves(dato, CAMPOS_CAPTURA);
  exigir(
    dato.url === objetivo.url && typeof dato.estado === 'string' && typeof dato.content_type === 'string',
    'Captura ajena o incompleta',
  );
  exigir(
    typeof dato.identidad_acreditada === 'boolean' && (dato.error_tipo === null || typeof dato.error_tipo === 'string'),
    'Identidad o fallo inválidos',
  );
  objeto(dato.lectura_tecnica);
  const fecha = instante(dato.capturado_utc);
  const limite = instante(dato.vence_utc);
  exigir(
    fecha <= ahora && limite === fecha + BigInt(dias) * DIA_MICROSEGUNDOS,
    'Captura futura o vencimiento alterado',
  );
  validarRespuesta(dato);
  // Los textos se han validado como instantes antes de conservar su representación original.
  exigir(typeof dato.capturado_utc === 'string', 'Fechas no textuales');
  return {
    estado: dato.estado,
    fecha: dato.capturado_utc,
    instante: fecha,
    sha256: typeof dato.cuerpo_sha256 === 'string' ? dato.cuerpo_sha256 : null,
    identificada: dato.identidad_acreditada,
  };
}
function comprobarEvidencia(ultimo: Captura | null, confirmacion: Captura | null, evidencia: Captura | null): void {
  exigir(
    !evidencia || (ultimo && evidencia.instante <= ultimo.instante && EVIDENCIAS_CONCLUYENTES.has(evidencia.estado)),
    'Evidencia ajena al último intento',
  );
  exigir(
    !confirmacion || (evidencia && confirmacion.instante <= evidencia.instante),
    'Evidencia anterior a confirmación',
  );
  if (ultimo && EVIDENCIAS_CONCLUYENTES.has(ultimo.estado)) {
    exigir(
      evidencia &&
        evidencia.instante === ultimo.instante &&
        evidencia.estado === ultimo.estado &&
        evidencia.sha256 === ultimo.sha256,
      'Última respuesta útil omitida',
    );
  }
  if (evidencia && EVIDENCIAS_POSITIVAS.has(evidencia.estado)) {
    exigir(
      confirmacion && confirmacion.instante === evidencia.instante && confirmacion.sha256 === evidencia.sha256,
      'Evidencia positiva distinta de la última confirmación',
    );
  }
}
function leerFila(fila: Record<string, unknown>, objetivo: ObjetivoLectura, dias: number, ahora: bigint): Fila {
  const ultimo = fila.ultimo_intento === null ? null : captura(fila.ultimo_intento, objetivo, dias, ahora);
  const confirmacion =
    fila.ultima_confirmacion === null ? null : captura(fila.ultima_confirmacion, objetivo, dias, ahora);
  exigir(
    fila.estado ===
      (ultimo?.estado ?? (objetivo.url?.startsWith('https://') ? 'sin_observacion' : 'no_aplica_consulta_remota')),
    'Estado sin soporte',
  );
  exigir(
    !confirmacion ||
      (ultimo &&
        confirmacion.instante <= ultimo.instante &&
        confirmacion.identificada &&
        EVIDENCIAS_POSITIVAS.has(confirmacion.estado)),
    'Confirmación ajena a la cronología',
  );
  if (ultimo && EVIDENCIAS_POSITIVAS.has(ultimo.estado)) {
    exigir(
      confirmacion && confirmacion.instante === ultimo.instante && confirmacion.sha256 === ultimo.sha256,
      'Confirmación distinta de la última positiva',
    );
  }
  const evidencia = fila.ultima_evidencia === null ? null : captura(fila.ultima_evidencia, objetivo, dias, ahora);
  comprobarEvidencia(ultimo, confirmacion, evidencia);
  return { estado: String(fila.estado), ultimo, confirmacion, evidencia };
}
function cabecera(valor: unknown, sha256: string, total: number) {
  const documento = objeto(valor);
  claves(documento, ['version', 'catalogo_sha256', 'validez_dias', 'revision_editorial', 'objetivos', 'verificados']);
  exigir(
    documento.version === 2 &&
      documento.catalogo_sha256 === sha256 &&
      documento.revision_editorial === 'fuera_del_alcance',
    'Entrega incompatible con el catálogo',
  );
  exigir(
    typeof documento.validez_dias === 'number' &&
      Number.isSafeInteger(documento.validez_dias) &&
      documento.validez_dias > 0,
    'TTL inválido',
  );
  exigir(Array.isArray(documento.objetivos) && documento.objetivos.length === total, 'Inventario incompleto');
  return { objetivos: documento.objetivos, validez_dias: documento.validez_dias, verificados: documento.verificados };
}
function filas(
  observaciones: unknown,
  objetivos: readonly ObjetivoLectura[],
  sha256: string,
  ahora: bigint,
): Map<string, Fila> | null {
  if (observaciones === null) {
    return null;
  }
  const documento = cabecera(observaciones, sha256, objetivos.length);
  const esperados = new Map(objetivos.map((objetivo) => [objetivo.objetivo, objetivo]));
  const resultado = new Map<string, Fila>();
  for (const valor of documento.objetivos) {
    const fila = objeto(valor);
    claves(fila, [
      'objetivo',
      'id',
      'campo',
      'url',
      'estado',
      'ultimo_intento',
      'ultima_confirmacion',
      'ultima_evidencia',
    ]);
    exigir(typeof fila.objetivo === 'string' && !resultado.has(fila.objetivo), 'Objetivo repetido');
    const esperado = esperados.get(fila.objetivo);
    exigir(
      esperado && fila.id === esperado.id && fila.campo === esperado.campo && fila.url === esperado.url,
      'Objetivo ajeno o URL cambiada',
    );
    resultado.set(fila.objetivo, leerFila(fila, esperado, documento.validez_dias, ahora));
  }
  exigir(
    documento.verificados === [...resultado.values()].filter((fila) => fila.estado === 'verificado').length,
    'Recuento de admisión incoherente',
  );
  return resultado;
}
function estadoRemoto(ultimo: Captura | null, confirmacion: Captura | null, evidencia: Captura | null): string {
  if (!ultimo) {
    return 'sin_observacion';
  }
  if (!confirmacion) {
    return 'no_comprobado';
  }
  // Lo comprobado antes no pasa a «nunca comprobado» por una evidencia contraria posterior.
  if (!(evidencia && EVIDENCIAS_POSITIVAS.has(evidencia.estado))) {
    return 'comprobado_antes_con_evidencia_contraria';
  }
  if (FALLOS_TECNICOS.has(ultimo.estado)) {
    return 'verificado_con_fallo_reciente';
  }
  return EVIDENCIAS_POSITIVAS.has(ultimo.estado) ? 'verificado' : 'verificado_con_intento_inconcluyente';
}
function soporte(fila: Fila | undefined) {
  return {
    comprobado_utc: fila?.confirmacion?.fecha ?? null,
    ultimo_intento_utc: fila?.ultimo?.fecha ?? null,
    cuerpo_sha256: fila?.confirmacion?.sha256 ?? null,
  };
}
function proyectarLocal(objetivo: ObjetivoLectura, locales: readonly IntegridadLocal[]): ProyeccionEnlace {
  const local = locales.find((dato) => dato.objetivo === objetivo.objetivo && dato.url === objetivo.url);
  exigir(!local || huella(local.sha256), 'Integridad local sin huella');
  return {
    ...objetivo,
    ...soporte(undefined),
    estado: local ? 'integridad_local' : 'integridad_local_no_acreditada',
    abrir: Boolean(local),
    motivo: 'integridad_del_artefacto_local',
    cuerpo_sha256: local?.sha256 ?? null,
    incidencia: null,
  };
}
/** La incidencia del enlace (tipo y fecha), si la última evidencia contraria es una. */
function incidenciaDe(contraria: Captura | null): ProyeccionEnlace['incidencia'] {
  return contraria && INCIDENCIAS_DEL_ENLACE.has(contraria.estado)
    ? { tipo: contraria.estado, fecha: contraria.fecha }
    : null;
}
function proyectar(
  objetivo: ObjetivoLectura,
  fila: Fila | undefined,
  locales: readonly IntegridadLocal[],
): ProyeccionEnlace {
  if (objetivo.url !== null && !objetivo.url.startsWith('https://')) {
    return proyectarLocal(objetivo, locales);
  }
  const estado = estadoRemoto(fila?.ultimo ?? null, fila?.confirmacion ?? null, fila?.evidencia ?? null);
  const contraria = fila?.evidencia && EVIDENCIAS_CONTRARIAS.has(fila.evidencia.estado) ? fila.evidencia : null;
  return {
    ...objetivo,
    ...soporte(fila),
    estado,
    abrir: objetivo.url !== null && contraria?.estado !== DESTINO_NO_SEGURO,
    motivo: contraria ? contraria.estado : (fila?.ultimo?.estado ?? 'sin_observacion'),
    incidencia: incidenciaDe(contraria),
  };
}
/** No lee disco, red ni reloj global. Un archivo ausente es desconocido; uno corrupto se rechaza. */
export function proyectarObservaciones(entrada: {
  readonly catalogoSha256: string;
  readonly objetivos: readonly ObjetivoLectura[];
  readonly observaciones: unknown;
  readonly ahora: string;
  readonly integridadLocal?: readonly IntegridadLocal[];
}): {
  readonly version: 2;
  readonly catalogo_sha256: string;
  readonly evaluado_utc: string;
  readonly disponibilidad_observaciones: 'disponible' | 'no_disponible';
  readonly objetivos: readonly ProyeccionEnlace[];
} {
  exigir(huella(entrada.catalogoSha256), 'Huella de catálogo inválida');
  const inventario = new Set<string>();
  for (const objetivo of entrada.objetivos) {
    exigir(
      objetivo.objetivo === `${objetivo.id}:${objetivo.campo}` &&
        ['enlace', 'enlace_ca'].includes(objetivo.campo) &&
        !inventario.has(objetivo.objetivo),
      'Inventario de objetivos inválido',
    );
    inventario.add(objetivo.objetivo);
  }
  const ahora = instante(entrada.ahora);
  const comprobadas = filas(entrada.observaciones, entrada.objetivos, entrada.catalogoSha256, ahora);
  return {
    version: 2,
    catalogo_sha256: entrada.catalogoSha256,
    evaluado_utc: entrada.ahora,
    disponibilidad_observaciones: comprobadas === null ? 'no_disponible' : 'disponible',
    objetivos: entrada.objetivos.map((objetivo) =>
      proyectar(objetivo, comprobadas?.get(objetivo.objetivo), entrada.integridadLocal ?? []),
    ),
  };
}
