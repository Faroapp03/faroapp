// Hoja 2 del informe breve, «El mercado laboral»: cuatro tarjetas (contratación, ofertas, empleo y salario), los
// contratos por año, dónde se contrata, quién trabaja en la ocupación, qué vigilar, cómo leer el informe y sus fuentes.
// Cada bloque sale solo si hay datos para la ocupación; las frases salen de las reglas de textos.ts. «Qué vigilar» se
// escribe en que-vigilar.ts.

import { fechaConBarras, mesEnIdioma, numero, porcentaje } from '../../comun/formato.ts';
import { IDIOMAS, type Idioma } from '../../comun/idioma.ts';
import { CORTE_ANTERIOR, FUENTES_GENERALES } from '../../dominio/hechos-del-informe-breve.ts';
import { mesesDelPeriodoAnual, redondear } from '../../dominio/informe-breve.ts';
import type {
  AnualBreve,
  ComarcasBreve,
  ComparacionContratacionDemandaBreve,
  ContratacionBreve,
  Direccion,
  EmpleoBreve,
  FilaPerfil,
  InformeBreve,
  PerfilBreve,
  SalarioBreve,
} from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import type { LenguaHtml } from '../lengua-html.ts';
import { periodoEmpresarial } from './contexto-de-datos.ts';
import { columnasPorAnio, icono, type NombreDeIcono } from './graficos.ts';
import { type AmbitoDeLaHoja, fichaDeLaOcupacion } from './hoja-ia.ts';
import { type ClaveBreve, texto as t, textoRegistrado } from './idioma.ts';
import { finDelPeriodo, periodo } from './periodos.ts';
import { banda, cierre, confianza, estado, MARCA, sello, tonoDe } from './piezas.ts';
import { queVigilar } from './que-vigilar.ts';
import { fuenteBreve, OBSERVATORI } from './tarjetas-contexto.ts';
import { graficosDelMercado, senalesDelMercado } from './tarjetas-mercado.ts';
import { GRANDES_GRUPOS, proximaEaes, variacionEnPalabras } from './textos.ts';

const POR_CIEN = 100;
/** Por debajo de esta variación (en %) los contratos de un año se dicen «casi los mismos» que los del anterior. */
const CASI_IGUAL = 0.5;
/** Cómo se llama cada dato del perfil. */
const NOMBRE_DEL_DATO: Readonly<Record<FilaPerfil['dato'], ClaveBreve>> = Object.freeze({
  mujeres: 'Mujeres',
  menores30: 'Menores de 30 años',
  mayores55: '55 años o más',
  universitarios: 'Estudios universitarios',
});

/** Una tarjeta del mercado: icono, título, estado, cifra y su frase. */
function tarjeta(
  nombre: NombreDeIcono,
  titulo: string,
  direccion: Direccion,
  cuerpo: {
    cifra: string;
    texto: string;
    neutro?: boolean;
    idioma: Idioma;
    etiquetaEstado?: string;
    fuente: string;
    estimacion?: boolean;
  },
): string {
  const { idioma } = cuerpo;
  const neutro = cuerpo.neutro ?? false;
  return `<div class="ib-tarjeta" data-tono="${tonoDe(direccion, neutro)}"${cuerpo.etiquetaEstado ? ' data-comparacion' : ''}${cuerpo.estimacion ? ' data-estimacion' : ''}><div class="ib-tarjeta-cabeza">${icono(nombre)}<h2 class="ib-tarjeta-titulo">${titulo}</h2>${estado(direccion, neutro, idioma, cuerpo.etiquetaEstado)}</div><div class="ib-cifra">${cuerpo.cifra}</div><p>${cuerpo.texto}</p>${fuenteBreve(cuerpo.fuente, idioma)}</div>`;
}

/** «… que el año anterior», o nada si no hay comparación. */
function comparacion(variacion: number | null, conQue: string, idioma: Idioma): string {
  if (variacion === null) {
    return '';
  }
  const palabras = variacionEnPalabras(variacion, idioma);
  return palabras === t(idioma, 'lo mismo')
    ? t(idioma, ': las mismas que {0}', conQue)
    : t(idioma, ': {0} que {1}', palabras, conQue);
}

/** Contratación: personas contratadas en 12 meses y su variación anual. */
function deLaContratacion(contratacion: ContratacionBreve, idioma: Idioma): string {
  const hasta = contratacion.hasta ? t(idioma, ', hasta {0}', finDelPeriodo(contratacion.hasta, idioma)) : '';
  const recuento =
    contratacion.gruposCno.length > 1
      ? t(
          idioma,
          'suma de los recuentos de personas contratadas en {0} grupos de ocupación durante',
          contratacion.gruposCno.length,
        )
      : t(idioma, 'personas contratadas en');
  return tarjeta('contratacion', t(idioma, 'Contratación'), contratacion.direccion, {
    cifra: numero(contratacion.personas),
    fuente: OBSERVATORI,
    texto: t(
      idioma,
      '{0} el último año{1}{2}.',
      recuento,
      hasta,
      comparacion(contratacion.variacion, t(idioma, 'el año anterior'), idioma),
    ),
    idioma,
  });
}

/** Comparación de la relación entre recuentos, nunca de una tasa individual de colocación. */
function comparadoConElAnioAnterior(comparacion: ComparacionContratacionDemandaBreve, idioma: Idioma): string {
  if (comparacion.anteriorContratadasPorDemandante === null || comparacion.direccion === 'sin-dato') {
    return '';
  }
  return t(idioma, ' Hace un año: ≈{0}/100.', numero(comparacion.anteriorContratadasPorDemandante * POR_CIEN));
}

/** La relación de dos recuentos distintos, sin presentarla como probabilidad individual. */
function deLaComparacionContratacionDemanda(comparacion: ComparacionContratacionDemandaBreve, idioma: Idioma): string {
  const alcance =
    comparacion.gruposCno.length > 1
      ? t(idioma, 'Suma de recuentos de {0} grupos de ocupación: ', comparacion.gruposCno.length)
      : '';
  const etiquetas = {
    sube: 'Sube',
    baja: 'Baja',
    estable: 'Estable',
    'sin-dato': 'Sin comparación',
  } as const;
  return tarjeta('ofertas', idioma === 'ca' ? 'Cerca laboral' : 'Búsqueda laboral', comparacion.direccion, {
    cifra: `${numero(comparacion.contratadasPorDemandante * POR_CIEN)} / 100`,
    fuente: OBSERVATORI,
    etiquetaEstado: t(idioma, etiquetas[comparacion.direccion]),
    texto: t(
      idioma,
      '{0}{1} personas contratadas; {2} demandantes no ocupados ({3}). Grupos distintos: no predice tus opciones de empleo.{4}',
      alcance,
      numero(comparacion.personasContratadas),
      numero(comparacion.personasDemandantes),
      periodo(comparacion.periodo, idioma),
      comparadoConElAnioAnterior(comparacion, idioma),
    ),
    idioma,
  });
}

/**
 * La frase de la EPA, que es una encuesta por muestreo: las dos cifras y la variación, con la advertencia de que la
 * diferencia puede deberse en parte a la muestra. Sin la media del año anterior, solo la cifra.
 */
function fraseDeLaEpa(empleo: EmpleoBreve, grupo: string, idioma: Idioma): string {
  const base =
    idioma === 'ca'
      ? `Persones ${grupo} a Catalunya, de mitjana durant els últims quatre trimestres.`
      : `Personas ${grupo} en Cataluña, de media durante los últimos cuatro trimestres.`;
  if (empleo.anterior === null || empleo.variacion === null) {
    return base;
  }
  return idioma === 'ca'
    ? `L’enquesta estima ${numero(empleo.personas)} persones ${grupo} a Catalunya. L’any anterior n’estimava ${numero(empleo.anterior)}. La diferència pot deure’s al mostreig.`
    : `La encuesta estima ${numero(empleo.personas)} personas ${grupo} en Cataluña. El año anterior estimaba ${numero(empleo.anterior)}. La diferencia puede deberse al muestreo.`;
}

/** La tarjeta de la EPA con las dos cifras no dice hacia dónde va el empleo: lo que puede afirmar es «no concluyente». */
function noConcluyente(empleo: EmpleoBreve): boolean {
  return empleo.fuente === 'epa' && empleo.anterior !== null && empleo.variacion !== null;
}

/** Empleo: personas ocupadas en su gran grupo (EPA) o en su grupo del censo. */
function delEmpleo(empleo: EmpleoBreve, lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const gran = GRANDES_GRUPOS[empleo.codigo];
  const texto =
    empleo.fuente === 'epa' && gran
      ? fraseDeLaEpa(empleo, t(idioma, gran.en), idioma)
      : t(
          idioma,
          'personas en el grupo «{0}» en Cataluña (a 1 de enero de {1}){2}.',
          lengua.dato(empleo.grupo ?? ''),
          escapar(empleo.hasta),
          comparacion(empleo.variacion, t(idioma, 'un año antes'), idioma),
        );
  const cambio =
    empleo.variacion === null
      ? undefined
      : `${empleo.variacion > 0 ? '+' : ''}${porcentaje(empleo.variacion).replace(/^-/, '−')}`;
  return tarjeta('empleo', t(idioma, 'Empleo'), empleo.direccion, {
    cifra: numero(empleo.personas),
    fuente: empleo.fuente === 'epa' ? 'INE · EPA' : 'Idescat · INE',
    texto,
    idioma,
    ...(noConcluyente(empleo) && cambio
      ? {
          neutro: true,
          estimacion: true,
          etiquetaEstado: cambio,
        }
      : {}),
  });
}

/** Lo que cobran las mujeres frente a los hombres, en una frase. */
function fraseDeLaBrecha(brecha: number | null, idioma: Idioma): string {
  if (brecha === null) {
    return '';
  }
  if (brecha >= 1) {
    return t(idioma, ' Las mujeres cobran un {0} menos.', porcentaje(brecha, 0));
  }
  return brecha <= -1
    ? t(idioma, ' Las mujeres cobran un {0} más.', porcentaje(-brecha, 0))
    : t(idioma, ' Mujeres y hombres cobran lo mismo de media.');
}

/** Salario: ganancia media anual del grupo en España, su variación y la diferencia entre mujeres y hombres. */
function delSalario(salario: SalarioBreve, idioma: Idioma): string {
  const variacion =
    salario.variacion === null
      ? ''
      : t(idioma, ': {0} que en {1}', variacionEnPalabras(salario.variacion, idioma), salario.anioAnterior);
  return tarjeta('salario', t(idioma, 'Salario'), salario.direccion, {
    cifra: `${numero(salario.euros)} <small>${t(idioma, '€ al año')}</small>`,
    fuente: 'INE · EAES',
    texto: t(
      idioma,
      'España, {0}{1}.{2} Próximo dato: {3}.',
      salario.anio,
      variacion,
      fraseDeLaBrecha(salario.brecha, idioma),
      proximaEaes(salario.anio),
    ),
    idioma,
  });
}

/**
 * Las cuatro tarjetas, en su orden: contratación, comparación con la demanda, empleo y salario. Las ofertas del SOC no salen: solo
 * las 50 ocupaciones más ofertadas tienen cifra propia (quedan en el dominio para el cuaderno del mercado).
 */
function tarjetas(mercado: InformeBreve['mercado'], lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  return [
    mercado.contratacion ? deLaContratacion(mercado.contratacion, idioma) : '',
    mercado.comparacionContratacionDemanda
      ? deLaComparacionContratacionDemanda(mercado.comparacionContratacionDemanda, idioma)
      : '',
    mercado.empleo ? delEmpleo(mercado.empleo, lengua) : '',
    mercado.salario ? delSalario(mercado.salario, idioma) : '',
  ].join('');
}

/** «El último año se firmaron un 4 % más de contratos que el anterior.» */
function fraseDelUltimoAnio(valores: readonly number[], idioma: Idioma): string {
  const ultimo = valores.at(-1) ?? 0;
  const anterior = valores.at(-2) ?? 0;
  if (!anterior) {
    return '';
  }
  const variacion = POR_CIEN * (ultimo / anterior - 1);
  if (Math.abs(variacion) < CASI_IGUAL) {
    return t(idioma, 'Contratos: casi los mismos que el año anterior. No son personas.');
  }
  return t(
    idioma,
    'Contratos: un {0} {1} que el año anterior. No son personas.',
    porcentaje(Math.abs(variacion), 0),
    t(idioma, variacion > 0 ? 'más' : 'menos'),
  );
}

/** «Contratos por año», con su gráfico y su frase. */
function tablaDeContratos(
  anual: AnualBreve,
  idioma: Idioma,
  rotuloCaida: string | null,
  reconstruidos: boolean,
): string {
  const cabecerasImpresas = anual.etiquetas.map((etiqueta) => `<th scope="col">${escapar(etiqueta)}</th>`).join('');
  const cifrasImpresas = anual.valores
    .map((valor, i) => `<td>${numero(valor)}${anual.publicado[i] ? '' : '*'}</td>`)
    .join('');
  return `<div class="ib-serie-papel"><table class="ib-tabla"><thead><tr>${cabecerasImpresas}</tr></thead><tbody><tr>${cifrasImpresas}</tr></tbody></table>${rotuloCaida ? `<p>${escapar(rotuloCaida)}</p>` : ''}${reconstruidos ? `<p>* ${t(idioma, 'Cálculo de Faro')} · ${t(idioma, 'años anteriores')}</p>` : ''}</div>`;
}

function contratosPorAnio(anual: AnualBreve, idioma: Idioma): string {
  const [desde, hasta] = (anual.periodo === undefined ? CORTE_ANTERIOR : mesesDelPeriodoAnual(anual.periodo)).map(
    (mes) => mesEnIdioma(mes, idioma),
  );
  const meses = t(idioma, 'de {0} a {1}', desde ?? '', hasta ?? '');
  const maximo = Math.max(...anual.valores);
  const ultimo = anual.valores.at(-1) ?? 0;
  const caida = redondear(POR_CIEN * (1 - ultimo / maximo));
  const rotuloCaida = caida > 0 ? t(idioma, '−{0} desde el máximo', porcentaje(caida, 0)) : null;
  // El rótulo se coloca con su ancho en el idioma en que es más largo: el gráfico es igual en todos.
  const letrasDeLaCaida = Math.max(
    ...IDIOMAS.map((otro) => [...t(otro, '−{0} desde el máximo', porcentaje(caida, 0))].length),
  );
  const lista = anual.etiquetas.map((etiqueta, i) => `${etiqueta} ${numero(anual.valores[i] ?? 0)}`).join(', ');
  const rotulo = t(
    idioma,
    'Contratos por año, {0}: {1}.{2}',
    meses,
    lista,
    rotuloCaida ? t(idioma, ' Desde el máximo, {0} menos.', porcentaje(caida, 0)) : '',
  );
  const reconstruidos = anual.publicado.some((publicado) => !publicado)
    ? sello('faro', t(idioma, 'años anteriores'), idioma)
    : '';
  const tipos = idioma === 'ca' ? 'Indefinits i temporals' : 'Indefinidos y temporales';
  const titulo = idioma === 'ca' ? 'Total de contractes per any' : 'Total de contratos por año';
  const tablaImpresa = tablaDeContratos(anual, idioma, rotuloCaida, Boolean(reconstruidos));
  return `<section aria-label="${t(idioma, 'Contratos por año')}">
    <h2 class="ib-seccion"><span>${titulo}</span><small>${t(idioma, 'Cataluña')} · ${tipos}, ${t(idioma, 'De {0} a {1}.', desde ?? '', hasta ?? '').toLowerCase()}</small></h2>
    <figure class="ib-figura-ancha">${columnasPorAnio({ ...anual, caida: rotuloCaida, rotulo, letrasDeLaCaida })}</figure>
    ${tablaImpresa}
    <p class="ib-texto">${escapar(fraseDelUltimoAnio(anual.valores, idioma))}</p>
    <div class="ib-origen">${sello('oficial', OBSERVATORI, idioma)}${reconstruidos}</div>
  </section>`;
}

/** Una fila de comarca con su barra de 0 a 100. */
function filaDeComarca(nombre: string, valor: number, resto = false): string {
  return `<li class="ib-comarca"${resto ? ' data-resto' : ''}><span>${escapar(nombre)}</span><span class="ib-comarca-pista"><span data-ancho="${valor}"></span></span><b>${valor}</b></li>`;
}

/** «Dónde se contrata»: las tres comarcas con más contratos y las demás juntas. */
function dondeSeContrata(comarcas: ComarcasBreve, idioma: Idioma): string {
  const filas = comarcas.primeras.map((comarca) => filaDeComarca(comarca.nombre, comarca.deCada100));
  if (comarcas.resto.comarcas > 0) {
    const otras = idioma === 'ca' ? 'Resta de comarques' : 'Resto de comarcas';
    const nombre = comarcas.resto.comarcas === 1 ? t(idioma, 'La otra comarca') : otras;
    filas.push(filaDeComarca(nombre, comarcas.resto.deCada100, true));
  }
  return `<section aria-label="${t(idioma, 'Dónde se contrata')}">
    <h2 class="ib-seccion"><span>${t(idioma, 'Dónde se contrata')}</span><small>${t(idioma, 'De cada 100 contratos, último año.')}</small></h2>
    <ol class="ib-comarcas">${filas.join('')}</ol>
    <div class="ib-origen">${sello('oficial', OBSERVATORI, idioma)}</div>
  </section>`;
}

/** Una fila del perfil: rótulo, cifra, barra con la media marcada y rotulada, y la comparación en palabras. */
function filaDelPerfil(fila: FilaPerfil, idioma: Idioma): string {
  const tuya = Math.round(fila.grupo);
  const nombre = t(idioma, NOMBRE_DEL_DATO[fila.dato]);
  return `<li class="ib-p2"><span class="ib-p2-nombre">${nombre}</span><span class="ib-p2-cifra"><b>${tuya}</b> de cada 100</span><span class="ib-p2-barra" aria-hidden="true"><span class="ib-p2-relleno" data-ancho="${tuya}"></span></span></li>`;
}

function descripcionDelPerfil(perfil: PerfilBreve, idioma: Idioma): string {
  const { grupo } = perfil;
  if (!grupo) {
    return '';
  }
  if (grupo.cno === '441') {
    return idioma === 'ca'
      ? 'Perfil del personal d’informació i recepció a Catalunya, un grup professional que inclou la recepció mèdica.'
      : 'Perfil del personal de información y recepción en Cataluña, un grupo profesional que incluye la recepción médica.';
  }
  return idioma === 'ca'
    ? `Perfil del grup ${grupo.nombre} a Catalunya (CNO ${grupo.cno}).`
    : `Perfil del grupo ${grupo.nombre} en Cataluña (CNO ${grupo.cno}).`;
}

/** «Quién trabaja en tu ocupación»: titular, filas y relevo de edades. */
function quienTrabaja(perfil: PerfilBreve, idioma: Idioma): string {
  const relevo = perfil.relevo
    ? `<p class="ib-texto">${t(idioma, 'Por cada 10 menores de 30 años hay {0} personas de 55 o más (en todas las ocupaciones, {1}).', perfil.relevo.grupo, perfil.relevo.conjunto)}</p>`
    : '';
  const anios = perfil.cuando.join(' · ');
  const ca = idioma === 'ca';
  const recepcion = perfil.grupo?.cno === '441';
  const tituloRecepcion = ca ? 'Qui treballa en informació i recepció' : 'Quién trabaja en información y recepción';
  const titulo = recepcion ? tituloRecepcion : t(idioma, 'Quién trabaja en tu ocupación');
  const explicacion = descripcionDelPerfil(perfil, idioma);
  return `<section id="perfil-laboral" class="ib-perfil-retrato" aria-label="${escapar(titulo)}">
  <h2 class="ib-seccion"><span>${escapar(titulo)}</span><small>${t(idioma, 'Cataluña')}</small></h2>
  <p class="ib-titular-bloque">${escapar(explicacion)}</p>
  <ol class="ib-perfil2">${perfil.filas.map((fila) => filaDelPerfil(fila, idioma)).join('')}</ol>
  <div class="ib-origen" title="${escapar(anios)}">${sello('oficial', ca ? 'Idescat i INE' : 'Idescat e INE', idioma)}</div>
  <div class="solo-lectores">${relevo}</div>
</section>`;
}

/** «Cómo leer este informe»: sellos, confianza, colores y lo que hay que tener en cuenta. */
function comoLeer(idioma: Idioma): string {
  const sellos = `${sello('tu', t(idioma, 'lo que contaste'), idioma)}${sello('oficial', '', idioma)}${sello('estudio', '', idioma)}${sello('norma', '', idioma)}${sello('faro', '', idioma)}${sello('ia', t(idioma, 'lo propuso la IA'), idioma)}`;
  const confianzas = `${confianza('alta', '', true, idioma)}${confianza('media', '', true, idioma)}${confianza('baja', '', true, idioma)}`;
  return `<section class="ib-leer" aria-label="${t(idioma, 'Cómo leer este informe')}">
  <div class="ib-leer-rejilla">
    <div><h2 class="ib-leyenda-titulo">${t(idioma, 'De dónde sale cada dato')}</h2><p class="ib-sellos">${sellos}</p></div>
    <div><h2 class="ib-leyenda-titulo">${t(idioma, 'Confianza y colores')}</h2><p class="ib-confs ib-confs-linea">${confianzas}</p>
    <p class="ib-colores">${estado('sube', false, idioma)} ${estado('estable', false, idioma)} ${estado('baja', false, idioma)}${t(idioma, ' · azul: exposición a la IA.')}</p></div>
    <div><h2 class="ib-leyenda-titulo">${t(idioma, 'Ten en cuenta')}</h2><p>${t(idioma, 'Las cifras son de grupos de personas y no sirven para predecir tu caso ni para evaluarte. La IA puede equivocarse.')}</p></div>
  </div>
</section>`;
}

/** Un trimestre de la EPA como se escribe en las fuentes: «2026T2» → «2T 2026». */
function trimestre(codigo: string): string {
  const [anio, numeroDelTrimestre] = codigo.split('T');
  return `${numeroDelTrimestre}T ${anio}`;
}

/** Las fuentes de los bloques que salen en el informe, y las generales. */
function fuentes(breve: InformeBreve, lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const { mercado } = breve;
  const ine = [
    ...(breve.uso ? [`TIC-H ${breve.uso.anio}`] : []),
    ...(mercado.empleo?.fuente === 'epa' ? [`EPA ${trimestre(mercado.empleo.hasta)}`] : []),
    ...(mercado.salario ? [`EAES ${mercado.salario.anio}`] : []),
  ];
  const partes = [
    escapar(FUENTES_GENERALES.oit),
    ...(ine.length ? [escapar(`INE: ${ine.join(', ')}`)] : []),
    ...(mercado.perfil || mercado.empleo?.fuente === 'censo' ? [t(idioma, 'Idescat e INE: censos')] : []),
    ...(breve.empresas
      ? [t(idioma, 'INE ETICCE ({0})', escapar(periodoEmpresarial(breve.empresas.vigencia.periodo)))]
      : []),
    escapar(FUENTES_GENERALES.osworld),
    ...(mercado.contratacion || mercado.anual || mercado.comarcas
      ? [`Observatori del Treball${breve.datosHasta ? ` (${periodo(breve.datosHasta, idioma)})` : ''}`]
      : []),
    escapar(FUENTES_GENERALES.indeed),
    textoRegistrado(idioma, FUENTES_GENERALES.normas),
  ];
  return `<p class="ib-fuentes"><b>${t(idioma, 'Fuentes')}</b> ${partes.join(' · ')}.</p>`;
}

/** El cuerpo de la hoja 2: cabecera, tarjetas y los bloques con datos; las fuentes van en su cierre. */
function cuerpo(ambito: AmbitoDeLaHoja): string {
  const { breve, tituloTexto, lengua } = ambito;
  const idioma = lengua.idioma;
  const { mercado } = breve;
  const cartas = tarjetas(mercado, lengua);
  const cuantas = [
    mercado.contratacion,
    mercado.comparacionContratacionDemanda,
    mercado.empleo,
    mercado.salario,
  ].filter(Boolean).length;
  const dos = [
    mercado.anual ? contratosPorAnio(mercado.anual, idioma) : '',
    mercado.comarcas ? dondeSeContrata(mercado.comarcas, idioma) : '',
  ].join('');
  const sinDatos = `<p class="ib-texto">${t(idioma, 'No hay datos del mercado de trabajo de esta ocupación en Cataluña.')}</p>`;
  return `<header class="ib-cabecera ib-cabecera-2 ib-cabecera-retrato">
  <div class="ib-titular"><h1>${idioma === 'ca' ? 'El teu mercat laboral' : 'Tu mercado laboral'}</h1></div>${MARCA}
</header>
${fichaDeLaOcupacion(ambito)}
<section aria-label="${t(idioma, '{0} en Cataluña', tituloTexto)}">
  ${cartas ? `<div class="ib-mercado" data-tarjetas="${cuantas}">${cartas}</div>` : sinDatos}
</section>
${dos ? `<div class="ib-dos ib-contratos-territorio">${dos}</div>` : ''}
${graficosDelMercado(breve, idioma)}
${mercado.perfil ? quienTrabaja(mercado.perfil, idioma) : ''}
${senalesDelMercado(breve, idioma)}`;
}

export function detalleDelMercado({ breve, lengua }: AmbitoDeLaHoja): string {
  const { idioma } = lengua;
  const nombre = idioma === 'ca' ? 'Fonts i context del mercat laboral' : 'Fuentes y contexto del mercado laboral';
  return `<details class="ib-contexto metodo"><summary>${nombre}</summary>
    ${queVigilar(breve, lengua)}${comoLeer(idioma)}</details>`;
}

/**
 * La hoja 2 entera.
 *
 * @param ambito - El informe breve, el título de la ocupación y la lengua.
 * @returns El HTML de la hoja.
 */
export function hojaDelMercado(ambito: AmbitoDeLaHoja): string {
  const { hojas, tituloVisto, lengua, ejemplo } = ambito;
  const idioma = lengua.idioma;
  return `<section class="hoja ib" aria-label="${t(idioma, 'Hoja 2, el mercado laboral')}">${banda(2, hojas, idioma, ejemplo)}<div class="ib-cuerpo">${cuerpo(ambito)}</div>${cierre(fuentes(ambito.breve, lengua), 2, hojas, t(idioma, 'Faro · Informe de {0} · {1}', tituloVisto, escapar(fechaConBarras(ambito.breve.fecha))))}</section>`;
}
