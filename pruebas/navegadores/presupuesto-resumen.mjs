// El resumen en Markdown del ensayo del presupuesto de rendimiento: por construcción, una tabla por condición
// (escenario × navegador, con los cuatro hitos y lo acumulado hasta cada uno), la compresión por tipo con sus
// candidatos a mejora y el contenido repetido bajo direcciones distintas; y, con varias construcciones, la tabla de
// diferencias de cada una contra la primera (la referencia). Cada fila dice el estado de su medida
// (presupuesto-plazo.mjs): completa, no completada dentro del plazo (con lo observado hasta el límite total), en curso
// (el proceso se cortó) o fallo del arnés.
import { ESTADO, estadoDe } from './presupuesto-plazo.mjs';

const BYTES_POR_MB = 1_000_000;
const DECIMALES_MB = 2;
const DECIMALES_RAZON = 1;
/** Condición, escenario, navegador y estado: las columnas de la comparación antes de las cifras. */
const COLUMNAS_FIJAS = 4;

const mb = (bytes) => (Number.isFinite(bytes) ? (bytes / BYTES_POR_MB).toFixed(DECIMALES_MB) : '—');
const ms = (valor) => (Number.isFinite(valor) ? String(Math.round(valor)) : '—');
/** Las repeticiones de autenticación de un grupo; «—» en los documentos medidos antes de que se contaran. */
const aut = (grupo) =>
  Number.isFinite(grupo.repeticionesDeAutenticacion) ? String(grupo.repeticionesDeAutenticacion) : '—';

/** Un hito en la tabla: su tiempo y lo pedido y servido hasta él; «no aplica» o «no» con el tiempo agotado. */
function celdaHito(hito) {
  if (!hito) {
    return 'no aplica';
  }
  if (hito.pendiente) {
    return 'pendiente';
  }
  if (!hito.alcanzado) {
    return `no (${ms(hito.ms)})`;
  }
  return `${ms(hito.ms)} (${hito.peticiones} · ${mb(hito.bytesServidos)})`;
}

/** El estado de una medida en la tabla; con el fallo, si lo hay, y el límite total si lo cortó. */
function celdaEstado(medida) {
  const estado = estadoDe(medida) ?? 'sin medida';
  if (estado === ESTADO.fallo) {
    return `${estado}: ${medida.fallo ?? medida.error ?? ''}`;
  }
  if (estado === ESTADO.fueraDePlazo && medida.plazo) {
    return `${estado} (límite ${ms(medida.plazo.limiteTotalMs)} ms)`;
  }
  return estado;
}

/** Una fila de la tabla: el escenario de un motor. */
function fila(motor, escenario, medida) {
  if (!medida?.servidor) {
    return `| ${escenario} | ${motor} | ${celdaEstado(medida)} | | | | | | | | | | |`;
  }
  const { hitos, servidor, cotaMs } = medida;
  const { get, javascriptAlCorte: js, mismoContenido } = servidor;
  const celdas = [
    escenario,
    motor,
    celdaHito(hitos.interfaz),
    celdaHito(hitos.analisis),
    celdaHito(hitos.copiaWeb),
    celdaHito(hitos.copiaCompleta),
    `${mb(get.bytesServidos)} / ${mb(get.bytesSinComprimir)}`,
    `${get.peticiones} · ${get.direcciones} · ${get.repetidas}`,
    `${aut(get)} · ${aut(js)}`,
    `${js.peticiones} · ${js.direcciones}`,
    mb(mismoContenido.bytesDuplicadosSinComprimir),
    ms(cotaMs),
    celdaEstado(medida),
  ];
  return `| ${celdas.join(' | ')} |`;
}

const CABECERA = [
  '| Escenario | Navegador | Interfaz usable | Primer análisis | Copia web lista | Copia completa lista | ' +
    'MB servidos / sin comprimir | Pet. · dir. · repetidas | aut. | JS pet. · dir. | ' +
    'MB con el mismo contenido | Mínimo por ancho de banda (ms) | Estado |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
];

/** Todas las medidas de una construcción con su condición, motor y escenario. */
function medidas(documento) {
  return Object.entries(documento.resultados).flatMap(([condicion, porMotor]) =>
    Object.entries(porMotor).flatMap(([motor, porEscenario]) =>
      Object.entries(porEscenario).map(([escenario, medida]) => ({ condicion, motor, escenario, medida })),
    ),
  );
}

/**
 * La compresión por tipo sumada en todas las medidas de una condición. La razón sale del peso de las respuestas, no de
 * lo servido, que en una respuesta cortada es solo una parte (las medidas anteriores a R1f no traen `tamano`: entonces
 * lo servido era ese peso).
 */
export function tablaDeCompresion(lista) {
  const total = {};
  for (const { medida } of lista) {
    for (const [tipo, grupo] of Object.entries(medida.servidor?.compresion ?? {})) {
      total[tipo] ??= { respuestas: 0, sinComprimir: 0, tamano: 0, servidos: 0 };
      const suma = total[tipo];
      suma.respuestas += grupo.respuestas;
      suma.sinComprimir += grupo.sinComprimir;
      suma.tamano += grupo.tamano ?? grupo.servidos;
      suma.servidos += grupo.servidos;
    }
  }
  const filas = Object.entries(total).map(
    ([tipo, g]) =>
      `| ${tipo} | ${g.respuestas} | ${mb(g.sinComprimir)} | ${mb(g.tamano)} | ${mb(g.servidos)} | ` +
      `${g.tamano ? (g.sinComprimir / g.tamano).toFixed(DECIMALES_RAZON) : '—'} |`,
  );
  return [
    '| Tipo | Respuestas | MB sin comprimir | MB de las respuestas | MB servidos | Razón |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...filas,
  ];
}

/** Las direcciones de una lista de revisión de todas las medidas, sin repetir. */
function listaUnica(lista, campo) {
  const vistas = new Map();
  for (const { medida } of lista) {
    for (const e of medida.servidor?.revisionDeCompresion?.[campo] ?? []) {
      vistas.set(e.ruta, e);
    }
  }
  return [...vistas.values()].map(
    (e) =>
      `- \`${e.ruta}\` (${e.tipo}; ${e.sinComprimir} → ${e.tamano ?? e.servidos} bytes; aceptaba «${e.aceptada ?? '—'}»)`,
  );
}

/** Los grupos de direcciones con el mismo contenido, de todas las medidas, sin repetir. */
function listaDeDuplicados(lista) {
  const grupos = new Map();
  for (const { medida } of lista) {
    for (const g of medida.servidor?.mismoContenido?.grupos ?? []) {
      grupos.set(g.huella, g);
    }
  }
  return [...grupos.values()].map(
    (g) => `- ${g.huella}… (${g.bytes} bytes sin comprimir): ${g.rutas.map((r) => `\`${r}\``).join(', ')}`,
  );
}

/** El apartado de compresión y duplicaciones de una condición. */
function revision(lista) {
  const sinComprimir = listaUnica(lista, 'textoSinComprimir');
  const poca = listaUnica(lista, 'pocaGanancia');
  const duplicados = listaDeDuplicados(lista);
  return [
    '### Compresión por tipo (todas las medidas de la condición)',
    '',
    ...tablaDeCompresion(lista),
    '',
    '**Texto servido sin comprimir** (candidatos a mejora):',
    ...(sinComprimir.length ? sinComprimir : ['- ninguno']),
    '',
    '**Comprimido con poca ganancia** (conserva más del 90 % del peso):',
    ...(poca.length ? poca : ['- ninguno']),
    '',
    '**El mismo contenido bajo direcciones distintas**:',
    ...(duplicados.length ? duplicados : ['- ninguno']),
    '',
  ];
}

const NOTA = [
  'Hitos: tiempo en ms desde la navegación y, entre paréntesis, peticiones llegadas al servidor y MB servidos en',
  'respuestas terminadas hasta ese momento. Interfaz usable: página pintada e interactiva (en los recorridos, el',
  'primer mensaje de Faro y el campo de texto o las ocupaciones propuestas, sin esperar al motor). Primer análisis:',
  'la primera respuesta entera del motor del dispositivo. Copia web lista: service worker activado. Copia completa:',
  'además, el paquete de datos guardado. Bytes y peticiones de la visita medida: registro del servidor del ensayo,',
  'solo GET, hasta que deja de haber tráfico. En «segunda-visita», la recarga tras una primera visita completa.',
  'aut.: repeticiones de autenticación, en todas las peticiones · en las de JavaScript hasta el corte: GET',
  'respondidos con 401 cuya ruta se vuelve a pedir con la credencial. Son peticiones reales y ya cuentan en las',
  'peticiones, las repetidas y el JavaScript; la columna solo las señala.',
  'Estado: «completa», todas las esperas terminaron dentro del límite total de la condición; «no completada dentro',
  'del plazo», el límite cortó alguna (los hitos sin llegar constan «pendiente» y las cifras son las de hasta',
  'entonces); «en curso», el proceso se cortó mientras medía; «fallo del arnés», la medida no vale (con su motivo).',
  '',
];

/** El resumen en Markdown de una construcción: por condición, la tabla y su revisión de compresión y duplicados. */
export function resumenMarkdown(documento) {
  const { nombre, carpeta, condiciones, resultados } = documento;
  const lineas = [`# Presupuesto de rendimiento · ${nombre}`, '', `Construcción: \`${carpeta}\`.`, '', ...NOTA];
  const todas = medidas(documento);
  for (const condicion of Object.keys(resultados)) {
    const lista = todas.filter((m) => m.condicion === condicion && m.medida?.servidor);
    lineas.push(`## ${condicion}`, '', `Perfil: \`${JSON.stringify(condiciones[condicion])}\`.`, '', ...CABECERA);
    for (const { motor, escenario, medida } of todas.filter((m) => m.condicion === condicion)) {
      lineas.push(fila(motor, escenario, medida));
    }
    lineas.push('', ...revision(lista));
  }
  return lineas.join('\n');
}

/** Las cifras que se comparan entre construcciones. */
const COMPARADAS = [
  ['Interfaz usable (ms)', (m) => m.hitos.interfaz?.alcanzado && m.hitos.interfaz.ms, ms],
  ['Primer análisis (ms)', (m) => m.hitos.analisis?.alcanzado && m.hitos.analisis.ms, ms],
  ['Copia web (ms)', (m) => m.hitos.copiaWeb?.alcanzado && m.hitos.copiaWeb.ms, ms],
  ['Copia completa (ms)', (m) => m.hitos.copiaCompleta?.alcanzado && m.hitos.copiaCompleta.ms, ms],
  ['MB servidos', (m) => m.servidor.get.bytesServidos, mb],
  ['MB sin comprimir', (m) => m.servidor.get.bytesSinComprimir, mb],
  ['Peticiones', (m) => m.servidor.get.peticiones, String],
  ['Direcciones', (m) => m.servidor.get.direcciones, String],
];

/** Una celda de diferencia: referencia → mejora (diferencia). */
function diferencia(ref, nueva, formato) {
  // Los tiempos se comparan ya redondeados al ms, como se muestran.
  const valor = (x) => (formato === ms ? Math.round(x) : x);
  const a = Number.isFinite(ref) ? valor(ref) : null;
  const b = Number.isFinite(nueva) ? valor(nueva) : null;
  if (a === null || b === null) {
    return `${a === null ? '—' : formato(a)} → ${b === null ? '—' : formato(b)}`;
  }
  const delta = b - a;
  return `${formato(a)} → ${formato(b)} (${delta > 0 ? '+' : ''}${formato(delta)})`;
}

/** La tabla de diferencias de cada construcción contra la primera, por condición, escenario y navegador. */
export function comparacionMarkdown(documentos) {
  const [referencia, ...otras] = documentos;
  const lineas = [`# Presupuesto de rendimiento · comparación contra «${referencia.nombre}»`, ''];
  const cabecera = `| Condición | Escenario | Navegador | Estado | ${COMPARADAS.map(([titulo]) => titulo).join(' | ')} |`;
  for (const otra of otras) {
    lineas.push(`## ${otra.nombre}`, '', cabecera, `|${' --- |'.repeat(COMPARADAS.length + COLUMNAS_FIJAS)}`);
    for (const { condicion, motor, escenario, medida } of medidas(otra)) {
      const ref = referencia.resultados[condicion]?.[motor]?.[escenario];
      if (!(medida?.servidor && ref?.servidor)) {
        continue;
      }
      const celdas = COMPARADAS.map(([, valor, formato]) => diferencia(valor(ref), valor(medida), formato));
      const estados = `${estadoDe(ref)} → ${estadoDe(medida)}`;
      lineas.push(`| ${condicion} | ${escenario} | ${motor} | ${estados} | ${celdas.join(' | ')} |`);
    }
    lineas.push('');
  }
  return lineas.join('\n');
}
