// El bloque «Acreditar lo que ya sabes hacer» de una ocupación confirmada: qué certificados profesionales relaciona su
// real decreto con la ocupación, sus unidades de competencia, la lista de requisitos para comprobarla sola y las
// páginas oficiales del trámite. Sin IA: es una consulta a datos oficiales, como la formación del SOC.
// Qué certificados van con cada ocupación ESCO y con cada grupo ISCO-08 lo decide la cadena de datos
// (plataforma_datos/cursos/fuentes/acreditacion/relaciones.py), que lo valida con sus ejemplos y sus descartes, y viaja hecho en el paquete:
// «por su ocupación», si el anexo del real decreto nombra uno de sus códigos; «por su grupo», si nombra una ocupación
// de su grupo que es la suya con otras palabras. Un grupo ISCO-08 confirmado sin ocupación ESCO lleva los certificados
// que comparte más de la mitad de sus ocupaciones. Aquí solo se consulta.
// Los certificados que la Agència FP.CAT da como no disponibles (profesiones sanitarias reguladas, Real Decreto
// 659/2023, art. 175.2) no se acreditan por esta vía: no se enseñan, y si son los únicos el bloque lo dice. Sin
// ninguno, una línea neutra remite a los puntos de orientación.
// Faro orienta y no decide (textos-acreditacion.ts): el bloque es igual para todas las personas con la misma
// ocupación; no recibe nada de la persona más que su ocupación confirmada, y los certificados se ordenan sin
// recomendar ninguno: primero los que nombran su ocupación y, dentro, de menor a mayor nivel.
// Los requisitos se dan siempre con la fecha de la comprobación a mano de las páginas oficiales («Comprobado el …»).
// Pasados MAX_DIAS_COMPROBACION días, comprobacionAntigua solo informa: no oculta ni cambia nada de lo que se ve.
// El aviso para quien mantiene los datos lo da la validación de la fuente (plataforma_datos/cursos/fuentes/acreditacion/piezas/validacion.py).
// Aparte van los certificados que el SEPE relaciona con la ocupación en sus perfiles de la oferta de empleo y Faro no
// ha comprobado (plataforma_datos/mercado/fuentes/perfiles/lector.py), agrupados por perfil y con su aviso. Lo comprobado manda: un
// certificado que está en las dos listas se enseña como comprobado. Detrás, sin año en pantalla, los que el SEPE
// relacionó en su informe de necesidades formativas (plataforma_datos/cursos/fuentes/certificados2016/lector.py), con las unidades que
// nombra si no son todas: un certificado sale una sola vez, con la fuente que manda (comprobado > perfil > informe).
// Cuentan para los requisitos, que son los del procedimiento, pero no para la variante ni para la frase de entrada:
// lo comprobado manda. Sin nada comprobado, la entrada dice que el SEPE los relaciona y que Faro no los ha comprobado;
// si lo comprobado es solo sanitario, el aviso de sanidad se mantiene aunque el SEPE relacione otros.

import { diasEntreFechas } from '../../compartido/utilidades/fechas.ts';
import { fechaLarga, lista, numero } from '../comun/formato.ts';
import { IDIOMA_POR_DEFECTO, type Idioma } from '../comun/idioma.ts';
import { compararPorCodigo } from '../comun/orden.js';
import type { OcupacionConfirmada } from './ocupacion-confirmada.ts';
import { TEXTOS_ACREDITACION_ES, type TextosAcreditacion } from './textos-acreditacion.ts';
import { TEXTOS_ACREDITACION_CA } from './textos-acreditacion-ca.ts';
import type {
  BloqueAcreditacion,
  CertificadoAcreditable,
  CertificadoOficial,
  CertificadosDelSepe,
  DatosAcreditacion,
  DatosCertificadosSepe2016,
  DatosPerfilesSepe,
  EnlaceAcreditacion,
  PerfilDelSepe,
  RelacionAcreditacion,
  RequisitosAcreditacion,
  UnidadAcreditable,
  UnidadOficial,
  VarianteAcreditacion,
} from './tipos-acreditacion.ts';
import type { Datos } from './tipos-paquete.ts';

/** Días de la comprobación a mano de las páginas oficiales a partir de los cuales se informa de que es antigua. */
export const MAX_DIAS_COMPROBACION = 60;
/** Prioridad de los certificados: ocupación comprobada antes que grupo. */
const ORDEN_RELACION: Readonly<Record<RelacionAcreditacion, number>> = { ocupacion: 0, grupo: 1 };
/** La frase de entrada del bloque según su variante. */
const INTRODUCCION: Record<VarianteAcreditacion, (textos: TextosAcreditacion) => string> = {
  'por-ocupacion': (textos) => textos.existe.ocupacion,
  'por-grupo': (textos) => textos.existe.grupo,
  sanidad: (textos) => textos.sanidad,
  'solo-sepe': (textos) => textos.soloSepe,
  'sin-relacion': (textos) => textos.sinRelacion,
};

/** Un certificado relacionado con la ocupación, por su código. */
export type Relacionado = [codigo: string, relacion: RelacionAcreditacion];

/** Un certificado que relaciona el SEPE, con la posición de su perfil en DatosPerfilesSepe.perfiles. */
type DelSepe = [codigo: string, perfil: number];

/** Un certificado del informe del SEPE, con las unidades que nombra (vacío: no limita a ninguna). */
type DelInforme = [codigo: string, unidades: string[]];

/**
 * Los certificados relacionados con una ocupación confirmada, en el orden en que se enseñan (ver la cabecera): los de
 * su ocupación ESCO o, sin ella, los de su grupo ISCO-08.
 *
 * @param acreditacion - Certificados y relaciones del paquete de acreditación.
 * @param ocupacion - Ocupación confirmada: su URI ESCO (o null) y su grupo ISCO-08.
 * @returns Código y relación de cada certificado, sin repetir y en el orden del bloque.
 */
export function certificadosRelacionados(
  acreditacion: Pick<DatosAcreditacion, 'certificados' | 'relaciones'>,
  ocupacion: Pick<OcupacionConfirmada, 'esco' | 'isco08'>,
): Relacionado[] {
  const { ocupaciones, grupos } = acreditacion.relaciones;
  const relacionados: Relacionado[] =
    ocupacion.esco === null
      ? (grupos[ocupacion.isco08] ?? []).map((codigo): Relacionado => [codigo, 'grupo'])
      : [...(ocupaciones[ocupacion.esco] ?? [])];
  // La cadena construye las relaciones desde las fichas del catálogo: cada código relacionado tiene su certificado.
  const nivel = (codigo: string): number => (acreditacion.certificados[codigo] as CertificadoOficial).nivel;
  return relacionados.sort(
    ([a, relacionA], [b, relacionB]) =>
      ORDEN_RELACION[relacionA] - ORDEN_RELACION[relacionB] || nivel(a) - nivel(b) || compararPorCodigo(a, b),
  );
}

/** Los certificados que el SEPE relaciona con la ocupación ESCO y Faro no enseña ya como comprobados. */
function certificadosDelSepe(
  perfilesSepe: DatosPerfilesSepe | undefined,
  acreditacion: Pick<DatosAcreditacion, 'certificados'>,
  ocupacion: Pick<OcupacionConfirmada, 'esco'>,
  comprobados: Relacionado[],
): DelSepe[] {
  if (!perfilesSepe || ocupacion.esco === null) {
    return [];
  }
  const yaComprobados = new Set(comprobados.map(([codigo]) => codigo));
  return (perfilesSepe.ocupaciones[ocupacion.esco] ?? []).filter(
    ([codigo]) => !yaComprobados.has(codigo) && codigo in acreditacion.certificados,
  );
}

/** Los certificados del informe del SEPE para la ocupación ESCO que no enseñan ya lo comprobado ni los perfiles. */
function certificadosDelInforme(
  informe: DatosCertificadosSepe2016 | undefined,
  acreditacion: Pick<DatosAcreditacion, 'certificados'>,
  ocupacion: Pick<OcupacionConfirmada, 'esco'>,
  previos: string[],
): DelInforme[] {
  if (!informe || ocupacion.esco === null) {
    return [];
  }
  const yaEnsenados = new Set(previos);
  return (informe.ocupaciones[ocupacion.esco] ?? []).filter(
    ([codigo]) => !yaEnsenados.has(codigo) && codigo in acreditacion.certificados,
  );
}

/**
 * Qué bloque corresponde a unos certificados relacionados (ver la cabecera).
 *
 * @param relacionados - Certificados relacionados (certificadosRelacionados).
 * @param acreditacion - Los certificados que no se pueden acreditar hoy.
 * @returns La variante del bloque.
 */
export function varianteDe(
  relacionados: Relacionado[],
  acreditacion: Pick<DatosAcreditacion, 'no_disponibles'>,
): VarianteAcreditacion {
  const acreditables = relacionados.filter(([codigo]) => !acreditacion.no_disponibles.includes(codigo));
  if (acreditables.some(([, relacion]) => relacion === 'ocupacion')) {
    return 'por-ocupacion';
  }
  if (acreditables.length) {
    return 'por-grupo';
  }
  return relacionados.length ? 'sanidad' : 'sin-relacion';
}

// ---------- La presentación ----------

/** El nombre de un texto oficial en el idioma pedido o, si la fuente no lo da en él, en el otro. */
function enIdioma(texto: Record<Idioma, string | null>, idioma: Idioma): string | null {
  return texto[idioma] ?? texto[idioma === 'es' ? 'ca' : 'es'];
}

/** Conserva cada unidad oficial y presenta sus equivalencias sin modificar horas o módulos. */
function unidadAcreditable(unidad: UnidadOficial, idioma: Idioma, textos: TextosAcreditacion): UnidadAcreditable {
  const actuales = unidad.actuales.map(({ codigo, nombre }) => (nombre ? `${codigo} «${nombre}»` : codigo));
  return {
    codigo: unidad.codigo,
    nombre: enIdioma(unidad.nombre, idioma),
    modulo: unidad.modulo,
    horas: unidad.horas,
    equivalencia: actuales.length ? textos.equivalencia(lista(actuales, idioma)) : null,
  };
}

/**
 * Las horas del certificado, o null si sus módulos formativos suman más: una de las dos cifras del SOC está mal y no se
 * sabe cuál (la validación de la fuente los conoce, HORAS_SIN_CUADRAR en
 * plataforma_datos/cursos/fuentes/acreditacion/piezas/constantes.py).
 */
function horasDelCertificado({ horas, unidades }: CertificadoOficial): number | null {
  const deLosModulos = unidades.reduce((suma, unidad) => suma + (unidad.horas ?? 0), 0);
  return horas !== null && deLosModulos > horas ? null : horas;
}

/** Presenta la ficha oficial con su categoría de relación; no decide si la persona cumple requisitos. */
function certificadoAcreditable(
  [codigo, relacion]: Relacionado,
  certificado: CertificadoOficial,
  idioma: Idioma,
  textos: TextosAcreditacion,
): CertificadoAcreditable {
  const nombre = enIdioma(certificado.nombre, idioma) ?? codigo;
  const datos = { nombre, codigo, nivel: certificado.nivel, unidades: certificado.unidades.length, relacion };
  return {
    codigo,
    nombre,
    nivel: certificado.nivel,
    horas: horasDelCertificado(certificado),
    relacion,
    presentacion: textos.certificado(datos),
    etiqueta: relacion === 'grupo' ? textos.etiquetaGrupo : null,
    realDecreto: certificado.real_decreto,
    enlaceBoe: certificado.boe,
    unidades: certificado.unidades.map((unidad) => unidadAcreditable(unidad, idioma, textos)),
    sePuedePedirAhora: certificado.oferta_cataluna === 'si',
  };
}

/** Los certificados del informe, con las unidades que nombra el SEPE por su nombre oficial. */
function delInformeAcreditables(
  delInforme: DelInforme[],
  acreditacion: DatosAcreditacion,
  idioma: Idioma,
  textos: TextosAcreditacion,
): CertificadoAcreditable[] {
  return delInforme
    .filter(([codigo]) => !acreditacion.no_disponibles.includes(codigo))
    .map(([codigo, unidades]) => {
      // Los códigos proceden del catálogo validado y el selector excluye los que no tienen ficha.
      const oficial = acreditacion.certificados[codigo] as CertificadoOficial;
      const certificado = certificadoAcreditable([codigo, 'grupo'], oficial, idioma, textos);
      const nombradas = oficial.unidades
        .filter((unidad) => unidades.includes(unidad.codigo))
        .map((unidad) => enIdioma(unidad.nombre, idioma) ?? unidad.codigo);
      const datos = { ...certificado, unidades: oficial.unidades.length };
      return { ...certificado, presentacion: textos.sepe.certificadoDelInforme(datos, nombradas), etiqueta: null };
    });
}

/** De menor a mayor nivel y, a igual nivel, por código: el orden del bloque, que no recomienda ninguno. */
function ordenados(certificados: CertificadoAcreditable[]): CertificadoAcreditable[] {
  return certificados.sort((a, b) => a.nivel - b.nivel || compararPorCodigo(a.codigo, b.codigo));
}

/**
 * El apartado del SEPE: los certificados acreditables por esta vía, por perfil con la nota de cada uno y, al final,
 * los de su informe de necesidades formativas, con su nota.
 */
function apartadoDelSepe(
  { delSepe, delInforme }: { delSepe: DelSepe[]; delInforme: DelInforme[] },
  { acreditacion, perfilesSepe }: { acreditacion: DatosAcreditacion; perfilesSepe: DatosPerfilesSepe | undefined },
  idioma: Idioma,
  textos: TextosAcreditacion,
): CertificadosDelSepe | null {
  const porPerfil = new Map<number, CertificadoAcreditable[]>();
  for (const [codigo, perfil] of delSepe) {
    // El selector del SEPE solo conserva códigos presentes en este catálogo validado.
    const oficial = acreditacion.certificados[codigo] as CertificadoOficial;
    if (acreditacion.no_disponibles.includes(codigo)) {
      continue;
    }
    const certificado = certificadoAcreditable([codigo, 'grupo'], oficial, idioma, textos);
    const datos = { ...certificado, unidades: oficial.unidades.length };
    const delPerfil = { ...certificado, presentacion: textos.sepe.certificado(datos), etiqueta: null };
    porPerfil.set(perfil, [...(porPerfil.get(perfil) ?? []), delPerfil]);
  }
  const perfiles = [...porPerfil.entries()].flatMap(([perfil, certificados]): PerfilDelSepe[] => {
    if (!perfilesSepe) {
      return [];
    }
    // La cadena asigna el índice enumerando esta misma lista de perfiles; cada posición utilizada existe.
    const [nombre, anio] = perfilesSepe.perfiles[perfil] as DatosPerfilesSepe['perfiles'][number];
    return [{ nota: textos.sepe.nota(nombre, anio), anio, certificados: ordenados(certificados) }];
  });
  const informe = delInformeAcreditables(delInforme, acreditacion, idioma, textos);
  if (informe.length) {
    perfiles.push({ nota: textos.sepe.notaInforme, anio: null, certificados: ordenados(informe) });
  }
  return perfiles.length ? { titulo: textos.sepe.titulo, perfiles } : null;
}

/** Una lista de requisitos para el nivel 1 y otra para los niveles 2 y 3, según los niveles de los certificados. */
function requisitosDe(
  certificados: CertificadoAcreditable[],
  horasNivel1: number | null,
  textos: TextosAcreditacion,
): RequisitosAcreditacion[] {
  const niveles = [...new Set(certificados.map(({ nivel }) => nivel))].sort();
  const grupos = [niveles.filter((nivel) => nivel === 1), niveles.filter((nivel) => nivel !== 1)];
  return grupos
    .filter((grupo) => grupo.length)
    .map((grupo) => {
      const nivel1 = grupo[0] === 1;
      const { documentacion, edad, experiencia, justificar, identificacion } = textos.requisitos;
      return {
        niveles: grupo,
        titulo: textos.requisitosTitulo(grupo),
        lista: [documentacion, edad(nivel1), experiencia(nivel1, horasNivel1), justificar, identificacion],
      };
    });
}

/** Las páginas oficiales a las que remite el bloque; sin certificados, solo la de los puntos de orientación. */
function enlacesDe(
  acreditacion: DatosAcreditacion,
  conCertificados: boolean,
  idioma: Idioma,
  textos: TextosAcreditacion,
): EnlaceAcreditacion[] {
  const claves = conCertificados
    ? (['tramite', 'agencia', 'orientacion', 'expedicion'] as const)
    : (['orientacion'] as const);
  return claves.map((clave) => {
    const urls = acreditacion.enlaces[clave];
    return { texto: textos.enlaces[clave], url: urls[idioma] ?? urls.ca };
  });
}

/** Los textos del bloque en `idioma`: los catalanes o, en cualquier otro caso, los castellanos. */
function textosEn(idioma: Idioma): TextosAcreditacion {
  return idioma === 'ca' ? TEXTOS_ACREDITACION_CA : TEXTOS_ACREDITACION_ES;
}

/**
 * Si la comprobación a mano del día `comprobado` tiene, el día `hoy`, más de MAX_DIAS_COMPROBACION días. Solo informa:
 * el bloque da los requisitos igual. Una fecha que no se puede leer cuenta como antigua; la exportación del paquete
 * ya la rechaza (plataforma_datos/cursos/fuentes/acreditacion/exportacion.py).
 *
 * @param comprobado - Día de la comprobación (AAAA-MM-DD).
 * @param hoy - Día de la consulta (AAAA-MM-DD).
 * @returns Si la comprobación pasa del límite o su edad no se puede calcular.
 */
export function comprobacionAntigua(comprobado: string, hoy: string): boolean {
  return !(diasEntreFechas(comprobado, hoy) <= MAX_DIAS_COMPROBACION);
}

/** La escala del servicio en una línea con su fuente, o nada si el paquete no trae la memoria. */
function escalaDelServicio(
  memoria: DatosAcreditacion['memoria_fpcat'],
  textos: TextosAcreditacion,
): Pick<BloqueAcreditacion, 'escala'> {
  if (!memoria) {
    return {};
  }
  const [desde = '', hasta = ''] = memoria.periodo.split('-');
  const escala = textos.escala({
    personas: numero(memoria.personas_con_cualificacion_entera),
    pendientes: numero(memoria.solicitudes_pendientes),
    puntos: numero(memoria.puntos_de_orientacion),
    desde,
    hasta,
    pagina: memoria.pagina,
  });
  return { escala };
}

/** Los certificados ya seleccionados y la variante que determina la entrada del bloque. */
interface SeleccionAcreditacion {
  acreditacion: DatosAcreditacion;
  certificados: CertificadoAcreditable[];
  sepe: CertificadosDelSepe | null;
  variante: VarianteAcreditacion;
  antigua: boolean;
  fecha: string;
}

/** Redacta el bloque conservando el orden de sus campos y las cifras del paquete. */
function presentarBloque(
  { acreditacion, certificados, sepe, variante, antigua, fecha }: SeleccionAcreditacion,
  idioma: Idioma,
  textos: TextosAcreditacion,
): BloqueAcreditacion {
  const todos = [...certificados, ...(sepe?.perfiles.flatMap((perfil) => perfil.certificados) ?? [])];
  const hayCertificados = todos.length > 0;
  return {
    variante,
    titulo: textos.titulo,
    introduccion: INTRODUCCION[variante](textos),
    certificados,
    comprueba: hayCertificados ? textos.comprueba(fecha) : null,
    requisitos: hayCertificados ? requisitosDe(todos, acreditacion.horas_nivel_1, textos) : [],
    horasNivel1: acreditacion.horas_nivel_1,
    comoFunciona: hayCertificados ? textos.comoFunciona : null,
    dondeInformarse: textos.cornella(acreditacion.punto_de_informacion?.telefono ?? null),
    ...escalaDelServicio(acreditacion.memoria_fpcat, textos),
    expedicion: hayCertificados ? textos.expedicion : null,
    enlaces: enlacesDe(acreditacion, hayCertificados, idioma, textos),
    sepe,
    fuente: textos.fuente(fecha),
    comprobado: acreditacion.comprobado,
    ofertaActualizada: acreditacion.oferta_actualizada,
    comprobacionAntigua: antigua,
  };
}

/**
 * El bloque de acreditación de una ocupación confirmada, el día `hoy` (AAAA-MM-DD), en `idioma`. Null si el paquete
 * no trae la acreditación. Solo depende de la ocupación y de los datos oficiales: dos personas con la misma ocupación
 * reciben el mismo bloque.
 *
 * @param datos - Las partes del paquete que lee el bloque.
 * @param ocupacion - Ocupación confirmada: su URI ESCO (o null) y su grupo ISCO-08.
 * @param hoy - Día de la consulta (AAAA-MM-DD).
 * @param idioma - Idioma del informe.
 * @returns El bloque, o null si el paquete no trae la acreditación.
 */
export function bloqueDeAcreditacion(
  datos: Pick<Datos, 'acreditacion' | 'perfilesSepe' | 'certificadosSepe2016'>,
  ocupacion: Pick<OcupacionConfirmada, 'esco' | 'isco08'>,
  hoy: string,
  idioma: Idioma = IDIOMA_POR_DEFECTO,
): BloqueAcreditacion | null {
  const acreditacion = datos.acreditacion;
  if (!acreditacion) {
    return null;
  }
  const textos = textosEn(idioma);
  const relacionados = certificadosRelacionados(acreditacion, ocupacion);
  const delSepe = certificadosDelSepe(datos.perfilesSepe, acreditacion, ocupacion, relacionados);
  const previos = [...relacionados, ...delSepe].map(([codigo]) => codigo);
  const delInforme = certificadosDelInforme(datos.certificadosSepe2016, acreditacion, ocupacion, previos);
  const certificados = relacionados
    .filter(([codigo]) => !acreditacion.no_disponibles.includes(codigo))
    // La cadena genera estas relaciones desde las fichas oficiales presentes en el catálogo.
    .map((relacionado) =>
      certificadoAcreditable(
        relacionado,
        acreditacion.certificados[relacionado[0]] as CertificadoOficial,
        idioma,
        textos,
      ),
    );
  const antigua = comprobacionAntigua(acreditacion.comprobado, hoy);
  const fecha = fechaLarga(acreditacion.comprobado, idioma);
  const fuentesSepe = { acreditacion, perfilesSepe: datos.perfilesSepe };
  const sepe = apartadoDelSepe({ delSepe, delInforme }, fuentesSepe, idioma, textos);
  const comprobada = varianteDe(relacionados, acreditacion);
  const variante = comprobada === 'sin-relacion' && sepe ? 'solo-sepe' : comprobada;
  return presentarBloque({ acreditacion, certificados, sepe, variante, antigua, fecha }, idioma, textos);
}
