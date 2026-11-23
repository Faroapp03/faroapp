import { objetoTrabajo } from './estado-trabajos.js';
/** Observación privada del registro admitido. Una decisión nunca acredita su publicación efectiva. */
/** @typedef {Readonly<{tipo:'remota'|'interna',url:string|null,parametrosOmitidos:boolean,documento:string|null,sha256:string,alcance:string,fecha:string|null}>} ReferenciaCatalogoPrivado */
/** @typedef {Readonly<{el:string,origen:'ficha'|'catalogo',tipo:string,codigoHttp:number|null}>} IncidenciaEnlace */
/** @typedef {Readonly<{tipo:'recurso'|'edicion',id:string,programaId:string,titulo:string,url:string|null,parametrosOmitidos:boolean,fuenteId:string|null,estadoRegistro:string,motivoRegistro:string,motivoRetencion:string|null,decision:string|null,motivos:readonly string[],comprobadoEl:string|null,cierraEl:string|null,revisarEl:string|null,ultimoIntentoFallidoEl:string|null,incidenciaEnlace:IncidenciaEnlace|null,ultimoIntentoEl:string|null,ultimoFinEl:string|null,evaluadoEl:string|null,evaluadorSha256:string|null,schemaEvaluacion:number|null,politicaVersion:string|null,politicaSha256:string|null,referencias:readonly number[]}>} UnidadCatalogoPrivado */
/** @typedef {Readonly<{version:1,snapshotSha256:string,admisionSha256:string,evaluadorSha256:string,corteRegistro:string|null,corteProyeccion:string,publicacionConfirmada:null,referencias:readonly ReferenciaCatalogoPrivado[],unidades:readonly UnidadCatalogoPrivado[],revision:string}>} CatalogoPrivado */
export const MAX_CATALOGO_PRIVADO_BYTES = 4_194_304;
export const MAX_UNIDADES_CATALOGO_PRIVADO = 10_000;
export const TAMANO_PAGINA_CATALOGO = 50;
const MAX_TEXTO = 2048;
const MAX_REFERENCIAS_UNIDAD = 128;
const MAX_REFERENCIAS = 10_000;
const MAX_PAGINA = 200;
const SHA = /^[0-9a-f]{64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|\+00:00)$/;
const DECISIONES = new Set([
  'disponible-publicamente',
  'no-disponible-publicamente',
  'apertura-futura',
  'sin-confirmar',
  // Solo en evaluaciones históricas conservadas en el registro; el evaluador vigente ya no la produce.
  'comprobacion-caducada',
]);
/** @param {unknown} condicion @returns {asserts condicion} */
function exigir(condicion) {
  if (!condicion) {
    throw new Error('Registro privado del catálogo incompatible');
  }
}
/** @param {unknown} valor @param {string} campos @returns {Record<string,unknown>} */
function objeto(valor, campos) {
  return objetoTrabajo(valor, campos.split(',').sort().join(','));
}
/** @param {unknown} valor @returns {string} */
function texto(valor) {
  exigir(typeof valor === 'string' && valor.length > 0 && valor.length <= MAX_TEXTO && !/\p{Cc}/u.test(valor));
  return valor;
}
/** @param {unknown} valor @returns {string} */
function sha(valor) {
  exigir(typeof valor === 'string' && SHA.test(valor));
  return valor;
}
/** @param {unknown} valor @returns {string|null} */
function fecha(valor) {
  if (valor === null) {
    return null;
  }
  exigir(
    typeof valor === 'string' &&
      FECHA.test(valor) &&
      Number.isFinite(Date.parse(valor)) &&
      new Date(valor).toISOString().slice(0, 10) === valor.slice(0, 10),
  );
  return valor;
}
/** @param {unknown} valor @param {unknown} registro @returns {string} */
function corteProyeccion(valor, registro) {
  const corte = fecha(valor);
  const anterior = fecha(registro);
  exigir(corte !== null && (anterior === null || Date.parse(anterior) <= Date.parse(corte)));
  return corte;
}
/** @param {unknown} valor @returns {string|null} */
function opcional(valor) {
  return valor === null ? null : texto(valor);
}
/** @param {unknown} valor @returns {string} */
function url(valor) {
  const literal = texto(valor);
  exigir(!/[\\\s]/u.test(literal));
  const u = new URL(literal);
  exigir(
    ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !u.search && !u.hash,
  );
  return literal;
}
/** @param {unknown} valor @returns {ReferenciaCatalogoPrivado} */
function referencia(valor) {
  const o = objeto(valor, 'tipo,url,parametrosOmitidos,documento,sha256,alcance,fecha');
  exigir(o.tipo === 'remota' || o.tipo === 'interna');
  exigir(typeof o.parametrosOmitidos === 'boolean');
  const f = fecha(o.fecha);
  let direccion = null,
    documento = null;
  if (o.tipo === 'remota') {
    direccion = url(o.url);
    exigir(o.documento === null && f !== null);
  } else {
    documento = texto(o.documento);
    exigir(/^[a-zA-Z0-9:._-]{1,200}$/.test(documento) && o.url === null && f === null);
  }
  return Object.freeze({
    tipo: o.tipo,
    url: direccion,
    parametrosOmitidos: o.parametrosOmitidos,
    documento,
    sha256: sha(o.sha256),
    alcance: texto(o.alcance),
    fecha: f,
  });
}
const PRIMER_CODIGO_HTTP = 100;
const ULTIMO_CODIGO_HTTP = 599;
/** Incidencia del enlace en la última revisión: solo informa; la unidad sigue con su decisión y su enlace.
 * @param {unknown} valor @returns {IncidenciaEnlace|null} */
function incidencia(valor) {
  if (valor === null) {
    return null;
  }
  const o = objeto(valor, 'el,origen,tipo,codigoHttp');
  const el = fecha(o.el);
  exigir(el !== null && /^[a-z0-9_-]{1,80}$/.test(texto(o.tipo)));
  exigir(o.origen === 'ficha' || o.origen === 'catalogo');
  exigir(
    o.codigoHttp === null ||
      (typeof o.codigoHttp === 'number' &&
        Number.isSafeInteger(o.codigoHttp) &&
        o.codigoHttp >= PRIMER_CODIGO_HTTP &&
        o.codigoHttp <= ULTIMO_CODIGO_HTTP),
  );
  return Object.freeze({
    el,
    origen: o.origen,
    tipo: texto(o.tipo),
    codigoHttp: /** @type {number|null} */ (o.codigoHttp),
  });
}
/** @param {Record<string,unknown>} o */
function fechasUnidad(o) {
  exigir(o.schemaEvaluacion === null || o.schemaEvaluacion === 1 || o.schemaEvaluacion === 2);
  return {
    comprobadoEl: fecha(o.comprobadoEl),
    cierraEl: fecha(o.cierraEl),
    revisarEl: fecha(o.revisarEl),
    ultimoIntentoFallidoEl: fecha(o.ultimoIntentoFallidoEl),
    incidenciaEnlace: incidencia(o.incidenciaEnlace),
    ultimoIntentoEl: fecha(o.ultimoIntentoEl),
    ultimoFinEl: fecha(o.ultimoFinEl),
    evaluadoEl: fecha(o.evaluadoEl),
    evaluadorSha256: o.evaluadorSha256 === null ? null : sha(o.evaluadorSha256),
    schemaEvaluacion: o.schemaEvaluacion,
    politicaVersion: opcional(o.politicaVersion),
    politicaSha256: o.politicaSha256 === null ? null : sha(o.politicaSha256),
  };
}
/** @param {unknown} valor @param {number} referencias @returns {UnidadCatalogoPrivado} */
function unidad(valor, referencias) {
  const o = objeto(
    valor,
    'tipo,id,programaId,titulo,url,parametrosOmitidos,fuenteId,estadoRegistro,motivoRegistro,motivoRetencion,decision,motivos,comprobadoEl,cierraEl,revisarEl,ultimoIntentoFallidoEl,incidenciaEnlace,ultimoIntentoEl,ultimoFinEl,evaluadoEl,evaluadorSha256,schemaEvaluacion,politicaVersion,politicaSha256,referencias',
  );
  exigir(o.tipo === 'recurso' || o.tipo === 'edicion');
  exigir(typeof o.parametrosOmitidos === 'boolean' && (o.url !== null || o.parametrosOmitidos === false));
  exigir(o.estadoRegistro === 'evaluado' || o.estadoRegistro === 'no_evaluado' || o.estadoRegistro === 'no_disponible');
  exigir(o.decision === null || (typeof o.decision === 'string' && DECISIONES.has(o.decision)));
  exigir(Array.isArray(o.motivos) && o.motivos.length <= MAX_REFERENCIAS_UNIDAD);
  const motivos = Object.freeze(o.motivos.map(texto));
  exigir(Array.isArray(o.referencias) && o.referencias.length <= MAX_REFERENCIAS_UNIDAD);
  const refs = Object.freeze(
    o.referencias.map((i) => {
      exigir(typeof i === 'number' && Number.isSafeInteger(i) && i >= 0 && i < referencias);
      return /** @type {number} */ (i);
    }),
  );
  const fuenteId = opcional(o.fuenteId);
  exigir(fuenteId === null || /^[a-z0-9_-]{1,80}$/.test(fuenteId));
  return Object.freeze({
    tipo: o.tipo,
    id: texto(o.id),
    programaId: texto(o.programaId),
    titulo: texto(o.titulo),
    url: o.url === null ? null : url(o.url),
    parametrosOmitidos: o.parametrosOmitidos,
    fuenteId,
    estadoRegistro: o.estadoRegistro,
    motivoRegistro: texto(o.motivoRegistro),
    motivoRetencion: opcional(o.motivoRetencion),
    decision: o.decision,
    motivos,
    ...fechasUnidad(o),
    referencias: refs,
  });
}
/** Cada elemento cerrado se serializa antes de acumular otro: evita expansión programática sin cota.
 * @template T @param {readonly unknown[]} entradas @param {(v:unknown)=>T} leer @param {{bytes:number}} presupuesto @returns {readonly T[]} */
function copiarAcotado(entradas, leer, presupuesto) {
  const salida = [];
  for (const entrada of entradas) {
    const copia = leer(entrada);
    presupuesto.bytes += new TextEncoder().encode(JSON.stringify(copia)).byteLength + 1;
    exigir(presupuesto.bytes <= MAX_CATALOGO_PRIVADO_BYTES);
    salida.push(copia);
  }
  return Object.freeze(salida);
}
/** Copia cerrada para Node, Worker y navegador. El hash del recibo autentica sus bytes completos.
 * @param {unknown} entrada @returns {CatalogoPrivado} */
export function leerCatalogoPrivado(entrada) {
  const o = objeto(
    entrada,
    'version,snapshotSha256,admisionSha256,evaluadorSha256,corteRegistro,corteProyeccion,publicacionConfirmada,referencias,unidades,revision',
  );
  exigir(o.version === 1 && o.publicacionConfirmada === null);
  exigir(Array.isArray(o.referencias) && o.referencias.length <= MAX_REFERENCIAS);
  const presupuesto = { bytes: 0 };
  const refs = copiarAcotado(o.referencias, referencia, presupuesto);
  exigir(Array.isArray(o.unidades) && o.unidades.length <= MAX_UNIDADES_CATALOGO_PRIVADO);
  const unidades = copiarAcotado(o.unidades, (v) => unidad(v, refs.length), presupuesto);
  const corte = corteProyeccion(o.corteProyeccion, o.corteRegistro);
  exigir(refs.every((r) => r.fecha === null || Date.parse(r.fecha) <= Date.parse(corte)));
  exigir(
    unidades.every((u) =>
      [
        u.comprobadoEl,
        u.ultimoIntentoFallidoEl,
        u.incidenciaEnlace?.el ?? null,
        u.ultimoIntentoEl,
        u.ultimoFinEl,
        u.evaluadoEl,
      ].every((f) => f === null || Date.parse(f) <= Date.parse(corte)),
    ),
  );
  const claves = unidades.map((u) => JSON.stringify([u.tipo, u.id]));
  exigir(new Set(claves).size === claves.length);
  const resultado = Object.freeze({
    version: /** @type {const} */ (1),
    snapshotSha256: sha(o.snapshotSha256),
    admisionSha256: sha(o.admisionSha256),
    evaluadorSha256: sha(o.evaluadorSha256),
    corteRegistro: fecha(o.corteRegistro),
    corteProyeccion: corte,
    publicacionConfirmada: null,
    referencias: refs,
    unidades,
    revision: sha(o.revision),
  });
  exigir(new TextEncoder().encode(JSON.stringify(resultado)).byteLength <= MAX_CATALOGO_PRIVADO_BYTES);
  return resultado;
}
/** Paginación de la decisión conservada: no recalcula caducidad, vigencia ni disponibilidad.
 * @param {CatalogoPrivado|null} catalogo @param {unknown} entrada */
export function paginarCatalogoPrivado(catalogo, entrada) {
  const o = objeto(entrada, 'tipo,pagina,revision');
  exigir(o.tipo === 'todos' || o.tipo === 'recurso' || o.tipo === 'edicion');
  exigir(typeof o.pagina === 'number' && Number.isSafeInteger(o.pagina) && o.pagina >= 0 && o.pagina <= MAX_PAGINA);
  exigir(o.revision === null || (typeof o.revision === 'string' && SHA.test(o.revision)));
  if (catalogo === null) {
    return Object.freeze({ estado: 'sin-registro', catalogo: null });
  }
  exigir(o.revision === null || o.revision === catalogo.revision);
  const retenidas = catalogo.unidades.filter(
    (u) => u.motivoRetencion !== null && (o.tipo === 'todos' || u.tipo === o.tipo),
  );
  const inicio = o.pagina * TAMANO_PAGINA_CATALOGO;
  exigir(inicio < retenidas.length || o.pagina === 0);
  const unidades = retenidas.slice(inicio, inicio + TAMANO_PAGINA_CATALOGO);
  const ids = [...new Set(unidades.flatMap((u) => u.referencias))];
  const publicadas = catalogo.unidades.filter((u) => u.motivoRetencion === null);
  return Object.freeze({
    estado: 'disponible',
    catalogo: Object.freeze({
      version: 1,
      revision: catalogo.revision,
      snapshotSha256: catalogo.snapshotSha256,
      admisionSha256: catalogo.admisionSha256,
      evaluadorSha256: catalogo.evaluadorSha256,
      corteRegistro: catalogo.corteRegistro,
      corteProyeccion: catalogo.corteProyeccion,
      publicacionConfirmada: null,
      tipo: o.tipo,
      pagina: o.pagina,
      total: retenidas.length,
      siguiente: inicio + unidades.length < retenidas.length ? o.pagina + 1 : null,
      unidades: Object.freeze(unidades),
      referencias: Object.freeze(ids.map((id) => Object.freeze({ id, referencia: catalogo.referencias[id] }))),
      avisosPublicadas: avisosDePublicadas(publicadas),
    }),
  });
}

/** Fechas de revisión interna de las unidades publicadas, en orden, para que el panel las compare con su reloj.
 * Son avisos: no cambian la decisión conservada ni la publicación.
 * @param {readonly UnidadCatalogoPrivado[]} publicadas */
function avisosDePublicadas(publicadas) {
  const revisiones = publicadas.flatMap((u) => (u.revisarEl === null ? [] : [u.revisarEl]));
  revisiones.sort((a, b) => Date.parse(a) - Date.parse(b));
  return Object.freeze({
    revisiones: Object.freeze(revisiones),
    fallidas: publicadas.filter((u) => u.ultimoIntentoFallidoEl !== null).length,
    incidencias: publicadas.filter((u) => u.incidenciaEnlace !== null).length,
  });
}
/** @param {unknown} entrada */
function leerAvisosPublicadas(entrada) {
  const o = objeto(entrada, 'revisiones,fallidas,incidencias');
  exigir(Array.isArray(o.revisiones) && o.revisiones.length <= MAX_UNIDADES_CATALOGO_PRIVADO);
  const revisiones = o.revisiones.map((f) => {
    const valor = fecha(f);
    exigir(valor !== null);
    return valor;
  });
  exigir(revisiones.every((f, i) => i === 0 || Date.parse(revisiones[i - 1] ?? f) <= Date.parse(f)));
  return Object.freeze({
    revisiones: Object.freeze(revisiones),
    fallidas: cuenta(o.fallidas),
    incidencias: cuenta(o.incidencias),
  });
}
/** @param {unknown} valor @returns {number} */
function cuenta(valor) {
  exigir(
    typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0 && valor <= MAX_UNIDADES_CATALOGO_PRIVADO,
  );
  return valor;
}
/** @typedef {ReturnType<typeof paginarCatalogoPrivado>} PaginaCatalogoPrivado */
/** Frontera de la página, también usada por el navegador: no interpreta cuerpos ni HTML.
 * @param {unknown} entrada @returns {PaginaCatalogoPrivado} */
export function leerPaginaCatalogoPrivado(entrada) {
  const o = objeto(entrada, 'estado,catalogo');
  if (o.estado === 'sin-registro') {
    exigir(o.catalogo === null);
    return Object.freeze({ estado: 'sin-registro', catalogo: null });
  }
  exigir(o.estado === 'disponible');
  const c = objeto(
    o.catalogo,
    'version,revision,snapshotSha256,admisionSha256,evaluadorSha256,corteRegistro,corteProyeccion,publicacionConfirmada,tipo,pagina,total,siguiente,unidades,referencias,avisosPublicadas',
  );
  exigir(c.version === 1 && c.publicacionConfirmada === null);
  exigir(c.tipo === 'todos' || c.tipo === 'recurso' || c.tipo === 'edicion');
  exigir(typeof c.pagina === 'number' && Number.isSafeInteger(c.pagina) && c.pagina >= 0 && c.pagina <= MAX_PAGINA);
  exigir(
    typeof c.total === 'number' &&
      Number.isSafeInteger(c.total) &&
      c.total >= 0 &&
      c.total <= MAX_UNIDADES_CATALOGO_PRIVADO,
  );
  exigir(c.siguiente === null || c.siguiente === c.pagina + 1);
  const refs = referenciasPagina(c.referencias);
  const ids = new Set(refs.map((r) => r.id));
  exigir(ids.size === refs.length);
  exigir(Array.isArray(c.unidades) && c.unidades.length <= TAMANO_PAGINA_CATALOGO);
  const unidades = Object.freeze(c.unidades.map((v) => unidad(v, MAX_REFERENCIAS)));
  exigir(
    unidades.every(
      (u) =>
        u.motivoRetencion !== null &&
        (c.tipo === 'todos' || c.tipo === u.tipo) &&
        u.referencias.every((i) => ids.has(i)),
    ),
  );
  const esperado = Math.min(TAMANO_PAGINA_CATALOGO, c.total - c.pagina * TAMANO_PAGINA_CATALOGO);
  exigir(esperado === unidades.length && (c.pagina === 0 || unidades.length > 0));
  exigir((c.siguiente !== null) === c.pagina * TAMANO_PAGINA_CATALOGO + unidades.length < c.total);
  return copiarPagina(c, unidades, refs);
}
/** @param {unknown} entrada */
function referenciasPagina(entrada) {
  exigir(Array.isArray(entrada) && entrada.length <= MAX_REFERENCIAS);
  const refs = Object.freeze(
    entrada.map((v) => {
      const r = objeto(v, 'id,referencia');
      exigir(typeof r.id === 'number' && Number.isSafeInteger(r.id) && r.id >= 0 && r.id < MAX_REFERENCIAS);
      return Object.freeze({ id: r.id, referencia: referencia(r.referencia) });
    }),
  );
  return refs;
}
/** @param {Record<string,unknown>} c @param {readonly UnidadCatalogoPrivado[]} unidades @param {readonly Readonly<{id:number,referencia:ReferenciaCatalogoPrivado}>[]} refs */
function copiarPagina(c, unidades, refs) {
  exigir(c.tipo === 'todos' || c.tipo === 'recurso' || c.tipo === 'edicion');
  exigir(typeof c.pagina === 'number' && typeof c.total === 'number');
  return Object.freeze({
    estado: 'disponible',
    catalogo: Object.freeze({
      version: /** @type {const} */ (1),
      revision: sha(c.revision),
      snapshotSha256: sha(c.snapshotSha256),
      admisionSha256: sha(c.admisionSha256),
      evaluadorSha256: sha(c.evaluadorSha256),
      corteRegistro: fecha(c.corteRegistro),
      corteProyeccion: corteProyeccion(c.corteProyeccion, c.corteRegistro),
      publicacionConfirmada: null,
      tipo: c.tipo,
      pagina: c.pagina,
      total: c.total,
      siguiente: c.siguiente === null ? null : c.pagina + 1,
      unidades,
      referencias: refs,
      avisosPublicadas: leerAvisosPublicadas(c.avisosPublicadas),
    }),
  });
}
