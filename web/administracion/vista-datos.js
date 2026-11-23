import { texto as textoPanel } from '../scripts/textos.js';
import { avisosDeFuente, avisosDeLaInstalacion } from './avisos-datos.js';
import { diaPanel, fechaPanel, fechaTecnica } from './fechas-panel.js';
/** Presentación de una observación histórica; ningún texto se interpreta como HTML. */
import { ESTADOS_SALUD, NOMBRES_TEMAS, resumirSaludDatos } from './salud-datos.js';

/** @typedef {import('./salud-datos.js').SaludFuente} SaludFuente */
/** @typedef {import('./salud-datos.js').EstadoSalud} EstadoSalud */
/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */
/** @typedef {Exclude<EstadoDatosPanel,{version:1}>} EstadoDatosV2 */
/** @typedef {EstadoDatosV2['comprobaciones']['conjuntos'][number]} Conjunto */
/** @typedef {EstadoDatosV2['fuentes'][number]['ultimaOperacion']} Operacion */

const RESULTADOS_LOCALES = {
  verde: 'panel.datos.local.verde',
  ámbar: 'panel.datos.local.ambar',
  rojo: 'panel.datos.local.rojo',
};
const RESULTADOS_OPERACION = {
  'en-curso': 'panel.datos.operacion.en-curso',
  interrumpido: 'panel.datos.operacion.interrumpido',
  comprobada: 'panel.datos.operacion.comprobada',
  completa: 'panel.datos.operacion.completa',
  parcial: 'panel.datos.operacion.parcial',
  fallo: 'panel.datos.operacion.fallo',
  local: 'panel.datos.operacion.local',
};
const ALCANCES = {
  'copia-local': 'panel.datos.alcance.copia-local',
  'edicion-conocida': 'panel.datos.alcance.edicion-conocida',
  'catalogo-actual': 'panel.datos.alcance.catalogo-actual',
  'serie-abierta': 'panel.datos.alcance.serie-abierta',
  'descubre-edicion': 'panel.datos.alcance.descubre-edicion',
  'contenido-actual-acotado': 'panel.datos.alcance.contenido-actual-acotado',
  'recurso-actual-sin-edicion': 'panel.datos.alcance.recurso-actual-sin-edicion',
  'entradas-admitidas': 'panel.datos.alcance.entradas-admitidas',
  'productor-externo': 'panel.datos.alcance.productor-externo',
};
const LIMITES = {
  'copia-local': 'panel.datos.limite.copia-local',
  'edicion-conocida': 'panel.datos.limite.edicion-conocida',
  'catalogo-actual': 'panel.datos.limite.catalogo-actual',
  'serie-abierta': 'panel.datos.limite.serie-abierta',
  'descubre-edicion': 'panel.datos.limite.descubre-edicion',
  'contenido-actual-acotado': 'panel.datos.limite.contenido-actual-acotado',
  'recurso-actual-sin-edicion': 'panel.datos.limite.recurso-actual-sin-edicion',
  'entradas-admitidas': 'panel.datos.limite.entradas-admitidas',
  'productor-externo': 'panel.datos.limite.productor-externo',
};
const OPERACIONES_CONJUNTO = {
  descargar: 'panel.datos.conjunto.descargar',
  revision: 'panel.datos.conjunto.revision',
  integridad: 'panel.datos.conjunto.integridad',
  recomponer: 'panel.datos.conjunto.recomponer',
};

/** @param {HTMLElement} destino @param {string} texto */
function parrafo(destino, texto) {
  const linea = document.createElement('p');
  linea.textContent = texto;
  destino.append(linea);
}
/** @param {HTMLElement} celda @param {Operacion} operacion @param {readonly Conjunto[]} conjuntos */
function mostrarConsultas(celda, operacion, conjuntos) {
  if (operacion) {
    parrafo(
      celda,
      textoPanel('panel.datos.ultima-operacion', { v0: textoPanel(RESULTADOS_OPERACION[operacion.resultado]) }),
    );
    parrafo(
      celda,
      textoPanel('panel.datos.inicio-fin', {
        v0: fechaTecnica(operacion.inicioEn),
        v1: fechaTecnica(operacion.finEn, 'panel.no-consta'),
      }),
    );
    parrafo(
      celda,
      textoPanel('panel.datos.remota-prevista', {
        v0: operacion.remoto ? textoPanel('panel.si') : textoPanel('panel.no'),
      }),
    );
    parrafo(
      celda,
      textoPanel('panel.datos.ultimo-remoto', {
        v0: fechaTecnica(operacion.ultimoIntentoRemotoEn),
      }),
    );
  } else {
    parrafo(celda, textoPanel('panel.datos.sin-operacion'));
  }
  for (const conjunto of conjuntos) {
    parrafo(
      celda,
      textoPanel('panel.datos.conjunto-comprobacion', {
        v0: conjunto.id,
        v1: fechaTecnica(conjunto.ultimaComprobacion?.fecha, 'panel.datos.sin-comprobacion'),
      }),
    );
  }
}
/** @param {HTMLElement} destino @param {Extract<EstadoDatosPanel,{seguimientoRemoto:unknown}>} datos @param {string} fuente */
function mostrarSeguimientoRemoto(destino, datos, fuente) {
  const seguimiento = datos.seguimientoRemoto?.find((f) => f.fuente === fuente);
  const ultimo = seguimiento?.ultimoIntento;
  parrafo(
    destino,
    ultimo
      ? textoPanel('panel.datos.resultado-remoto', {
          v0: textoPanel(RESULTADOS_OPERACION[ultimo.resultado]),
          v1: fechaTecnica(ultimo.inicioEn),
          v2: fechaTecnica(ultimo.finEn, 'panel.no-consta'),
        })
      : textoPanel('panel.datos.sin-resultado-remoto'),
  );
  for (const pendiente of seguimiento?.incidenciasPendientes ?? []) {
    parrafo(
      destino,
      textoPanel('panel.datos.comprobacion-pendiente', {
        v0: pendiente.conjunto,
        v1: fechaTecnica(pendiente.operacion.inicioEn),
        v2: textoPanel(RESULTADOS_OPERACION[pendiente.operacion.resultado]),
      }),
    );
  }
}
/** @param {HTMLElement} destino @param {readonly Conjunto[]} conjuntos */
function mostrarCobertura(destino, conjuntos) {
  for (const conjunto of conjuntos) {
    parrafo(destino, `${conjunto.id} · ${conjunto.alcance}: ${textoPanel(ALCANCES[conjunto.alcance])}.`);
    const intervalo =
      conjunto.intervaloDias === null ? '' : textoPanel('panel.datos.intervalo', { v0: conjunto.intervaloDias });
    parrafo(destino, `${textoPanel(OPERACIONES_CONJUNTO[conjunto.operacion])}${intervalo}.`);
  }
}
/** @param {HTMLElement} destino @param {readonly Conjunto[]} conjuntos */
function mostrarLimites(destino, conjuntos) {
  for (const conjunto of conjuntos) {
    parrafo(destino, `${conjunto.id} · ${textoPanel(LIMITES[conjunto.alcance])}`);
    if (conjunto.revisionNecesaria) {
      parrafo(destino, textoPanel('panel.datos.revision-manual'));
    }
  }
}
/** @param {EstadoDatosPanel} datos */
function crearTabla(datos) {
  const tabla = document.createElement('table');
  const titulo = document.createElement('caption');
  titulo.textContent = textoPanel('panel.datos.tabla.titulo');
  const cabecera = document.createElement('thead');
  const filaCabecera = document.createElement('tr');
  for (const texto of [
    textoPanel('panel.datos.tabla.fuente'),
    textoPanel('panel.datos.tabla.local'),
    textoPanel('panel.datos.tabla.consulta'),
    textoPanel('panel.datos.tabla.cobertura'),
    textoPanel('panel.datos.tabla.limites'),
  ]) {
    const celda = document.createElement('th');
    celda.setAttribute('scope', 'col');
    celda.textContent = texto;
    filaCabecera.append(celda);
  }
  cabecera.append(filaCabecera);
  const cuerpo = document.createElement('tbody');
  for (const fuente of datos.fuentes) {
    cuerpo.append(crearFila(datos, fuente));
  }
  tabla.append(titulo, cabecera, cuerpo);
  const marco = document.createElement('div');
  marco.className = 'tabla-datos';
  marco.setAttribute('tabindex', '0');
  marco.setAttribute('role', 'region');
  marco.setAttribute('aria-label', textoPanel('panel.datos.tabla.region'));
  marco.append(tabla);
  return marco;
}
/** @param {EstadoDatosPanel} datos @param {EstadoDatosPanel['fuentes'][number]} fuente */
function crearFila(datos, fuente) {
  const modulo = datos.modulos.find((entrada) => entrada.id === fuente.id);
  const fila = document.createElement('tr');
  const nombre = document.createElement('th');
  nombre.setAttribute('scope', 'row');
  parrafo(nombre, fuente.id);
  parrafo(
    nombre,
    textoPanel('panel.datos.politica-fecha', {
      v0: fuente.politica,
      v1: fechaTecnica(fuente.fecha, 'panel.no-consta'),
    }),
  );
  const local = document.createElement('td');
  const ultimoLocal = fechaTecnica(modulo?.ultimoIntento, 'panel.datos.sin-intento');
  parrafo(local, textoPanel('panel.datos.ultimo-local', { v0: ultimoLocal }));
  parrafo(
    local,
    modulo?.veredicto
      ? textoPanel(RESULTADOS_LOCALES[modulo.veredicto])
      : textoPanel('panel.datos.sin-resultado-local'),
  );
  if (modulo?.ultimaVersionBuena) {
    parrafo(local, textoPanel('panel.datos.ultima-buena', { v0: fechaTecnica(modulo.ultimaVersionBuena.fecha) }));
  }
  const consulta = document.createElement('td');
  const cobertura = document.createElement('td');
  const limites = document.createElement('td');
  if (datos.version !== 1) {
    const conjuntos = datos.comprobaciones.conjuntos.filter((conjunto) => conjunto.fuente === fuente.id);
    const fuenteV2 = datos.fuentes.find((entrada) => entrada.id === fuente.id);
    mostrarConsultas(consulta, fuenteV2?.ultimaOperacion ?? null, conjuntos);
    if ('seguimientoRemoto' in datos) {
      mostrarSeguimientoRemoto(consulta, datos, fuente.id);
    }
    mostrarCobertura(cobertura, conjuntos);
    mostrarLimites(limites, conjuntos);
  } else {
    consulta.textContent = textoPanel('panel.datos.sin-consulta');
    cobertura.textContent = textoPanel('panel.datos.sin-cobertura');
    limites.textContent = textoPanel('panel.datos.sin-revision');
  }
  fila.append(nombre, local, consulta, cobertura, limites);
  return fila;
}
/** @param {HTMLElement} destino @param {EstadoDatosV2} datos */
function mostrarExternos(destino, datos) {
  const externos = datos.comprobaciones.conjuntos.filter((conjunto) => conjunto.fuente === null);
  if (!externos.length) {
    return;
  }
  const apartado = document.createElement('div');
  apartado.className = 'productores-externos';
  const titulo = document.createElement('h3');
  titulo.textContent = textoPanel('panel.datos.externos');
  apartado.append(titulo);
  mostrarCobertura(apartado, externos);
  mostrarLimites(apartado, externos);
  destino.append(apartado);
}
/** @param {HTMLElement} destino @param {EstadoDatosPanel|null} datos */
export function mostrarEstadoDatos(destino, datos) {
  destino.replaceChildren();
  if (!datos) {
    return;
  }
  fechaLegible(destino, textoPanel('panel.datos.observacion'), datos.observadoEn);
  if (datos.version !== 1 && datos.comprobaciones.reconstruccionPendiente) {
    parrafo(destino, textoPanel('panel.datos.reconstruccion-pendiente'));
  }
  destino.append(resumenDeSalud(datos));
  const detalle = document.createElement('details');
  detalle.className = 'salud-detalle';
  const titulo = document.createElement('summary');
  titulo.textContent = textoPanel('panel.datos.detalle');
  detalle.append(titulo);
  parrafo(detalle, textoPanel('panel.datos.consultado', { v0: fechaTecnica(datos.observadoEn) }));
  if (datos.version !== 1) {
    parrafo(
      detalle,
      textoPanel('panel.datos.registro', {
        v0: fechaTecnica(datos.comprobaciones.registradoEn, 'panel.datos.no-disponible'),
      }),
    );
  }
  detalle.append(crearTabla(datos));
  if (datos.version !== 1) {
    mostrarExternos(detalle, datos);
  }
  destino.append(detalle);
}

/** Fecha en hora de Cataluña y relativa; el atributo title conserva el instante completo sin redondear la evidencia.
 * @param {HTMLElement} destino @param {string} etiqueta @param {string|null} fecha
 */
function fechaLegible(destino, etiqueta, fecha) {
  const p = document.createElement('p');
  const instante = fecha === null ? Number.NaN : Date.parse(fecha);
  const valida = Number.isFinite(instante);
  const sinFecha = fecha === null ? textoPanel('panel.sin-registro') : textoPanel('panel.fecha-no-valida');
  p.textContent = `${etiqueta}: ${valida ? fechaPanel(instante) : sinFecha}.`;
  if (fecha !== null) {
    p.title = fecha;
  }
  destino.append(p);
}
/** @param {SaludFuente} fuente */
function tarjetaDeSalud(fuente) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'salud-fuente';
  const titulo = document.createElement('h4');
  titulo.textContent = fuente.nombre;
  const estado = document.createElement('p');
  const visual = ESTADOS_SALUD[fuente.estado];
  estado.className = `salud-indicador salud-${visual.tono}`;
  estado.textContent = `${visual.forma} ${textoPanel(`panel.salud.estado.${fuente.estado}`)}`;
  tarjeta.append(titulo, estado);
  if (!fuente.comprobaciones.length) {
    fechaLegible(tarjeta, textoPanel('panel.datos.ultima-comprobacion'), null);
  }
  for (const [i, comprobacion] of fuente.comprobaciones.entries()) {
    fechaLegible(
      tarjeta,
      etiquetaDeParte('panel.datos.ultima-comprobacion', i, fuente.comprobaciones.length),
      comprobacion.fecha,
    );
  }
  const detalle = document.createElement('details');
  detalle.className = 'salud-fuente-detalle';
  const resumen = document.createElement('summary');
  resumen.textContent = textoPanel('panel.datos.diagnostico');
  detalle.append(resumen);
  diagnosticoDeSalud(detalle, fuente);
  tarjeta.append(detalle);
  return tarjeta;
}
/** @param {HTMLElement} detalle @param {SaludFuente} fuente */
function diagnosticoDeSalud(detalle, fuente) {
  const mensaje = fuente.atencionPorAviso ? 'panel.datos.atencion-por-aviso' : `panel.salud.mensaje.${fuente.estado}`;
  parrafo(detalle, textoPanel(mensaje));
  fechaLegible(detalle, textoPanel('panel.datos.ultimo-intento'), fuente.ultimaConsulta);
  parrafo(
    detalle,
    textoPanel('panel.datos.resultado-consulta', {
      v0:
        fuente.resultadoConsulta === null
          ? textoPanel('panel.datos.no-conservado')
          : textoPanel(RESULTADOS_OPERACION[fuente.resultadoConsulta]),
    }),
  );
  const accion = document.createElement('p');
  accion.className = 'salud-accion';
  accion.textContent = textoPanel('panel.datos.que-hacer', { v0: textoPanel(`panel.salud.accion.${fuente.estado}`) });
  detalle.append(accion);
  if (fuente.proximoReintento !== null) {
    fechaLegible(detalle, textoPanel('panel.datos.reintento'), fuente.proximoReintento);
  }
  avisosDeConsulta(detalle, fuente);
  avisosDeFuente(detalle, fuente);
  for (const [i, proxima] of fuente.proximasConsultas.entries()) {
    fechaLegible(detalle, etiquetaDeParte('panel.datos.proxima', i, fuente.proximasConsultas.length), proxima.fecha);
  }
}
/** Una fuente puede tener varias partes que se comprueban por separado; su identificador interno no se enseña.
 * @param {string} clave @param {number} indice @param {number} total */
function etiquetaDeParte(clave, indice, total) {
  return total > 1 ? textoPanel(`${clave}-parte`, { v0: indice + 1, v1: total }) : textoPanel(clave);
}
/** Avisos del mantenimiento: cuándo vuelve a consultarse la fuente, si la última consulta fue parcial, si la
 * cobertura de la fuente es limitada (información, no incidencia) y cuándo toca revisar sus fichas. No cambian lo
 * que ve la persona usuaria.
 * @param {HTMLElement} detalle @param {SaludFuente} fuente
 */
function avisosDeConsulta(detalle, fuente) {
  if (fuente.proximaConsulta !== null) {
    parrafo(detalle, textoPanel('panel.datos.proxima-consulta', { v0: diaPanel(fuente.proximaConsulta) }));
  }
  if (fuente.fallosSeguidos > 0) {
    parrafo(detalle, textoPanel('panel.datos.fallos-seguidos', { v0: String(fuente.fallosSeguidos) }));
  }
  if (fuente.consultaParcial !== null) {
    parrafo(
      detalle,
      textoPanel('panel.datos.consulta-parcial', {
        v0: String(fuente.consultaParcial.unidadesFallidas),
        v1: String(fuente.consultaParcial.unidadesEsperadas),
      }),
    );
  }
  if (fuente.coberturaLimitada !== null) {
    parrafo(
      detalle,
      textoPanel('panel.datos.cobertura-limitada', {
        v0: textoPanel(`panel.datos.cobertura-limitada.${fuente.coberturaLimitada}`),
      }),
    );
  }
  if (fuente.revisionPendiente !== null) {
    const clave = fuente.revisionPendiente.vencida ? 'panel.datos.revision-pendiente' : 'panel.datos.revision-prevista';
    parrafo(detalle, textoPanel(clave, { v0: diaPanel(fuente.revisionPendiente.fecha) }));
  }
}
/** @param {readonly SaludFuente[]} fuentes @returns {string} */
function recuentoDeSalud(fuentes) {
  return Object.entries(ESTADOS_SALUD)
    .map(([estado]) => {
      const cantidad = fuentes.filter((f) => f.estado === estado).length;
      return cantidad ? `${cantidad} · ${textoPanel(`panel.salud.estado.${estado}`)}` : '';
    })
    .filter(Boolean)
    .join('; ');
}
/** @param {HTMLSelectElement} selector @param {string} valor @param {string} texto */
function opcionSalud(selector, valor, texto) {
  const opcion = document.createElement('option');
  opcion.value = valor;
  opcion.textContent = texto;
  selector.append(opcion);
}
/** @param {HTMLElement} destino @param {string} nombre @param {string} id */
function selectorSalud(destino, nombre, id) {
  const etiqueta = document.createElement('label');
  etiqueta.setAttribute('for', id);
  etiqueta.textContent = nombre;
  const selector = document.createElement('select');
  selector.id = id;
  opcionSalud(selector, '', textoPanel('panel.datos.todas'));
  selector.value = '';
  destino.append(etiqueta, selector);
  return selector;
}
/** @param {HTMLElement} destino @param {readonly SaludFuente[]} fuentes */
function fuentesFiltrables(destino, fuentes) {
  const filtros = document.createElement('div');
  filtros.className = 'salud-filtros';
  const porFuente = selectorSalud(filtros, textoPanel('panel.datos.tabla.fuente'), 'salud-filtro-fuente');
  const porEstado = selectorSalud(filtros, textoPanel('panel.datos.estado-comprobacion'), 'salud-filtro-estado');
  for (const fuente of fuentes) {
    opcionSalud(porFuente, fuente.id, fuente.nombre);
  }
  for (const estado of Object.keys(ESTADOS_SALUD)) {
    if (fuentes.some((f) => f.estado === estado)) {
      opcionSalud(porEstado, estado, textoPanel(`panel.salud.estado.${estado}`));
    }
  }
  const resultado = document.createElement('p');
  resultado.setAttribute('role', 'status');
  const lista = document.createElement('div');
  lista.className = 'salud-fuentes';
  const tarjetas = fuentes.map((fuente) => {
    const tarjeta = tarjetaDeSalud(fuente);
    lista.append(tarjeta);
    return { fuente, tarjeta };
  });
  const filtrar = () => {
    let visibles = 0;
    for (const { fuente, tarjeta } of tarjetas) {
      tarjeta.hidden =
        Boolean(porFuente.value && fuente.id !== porFuente.value) ||
        Boolean(porEstado.value && fuente.estado !== porEstado.value);
      if (!tarjeta.hidden) {
        visibles++;
      }
    }
    resultado.textContent = textoPanel('panel.datos.recuento', { v0: visibles, v1: fuentes.length });
  };
  porFuente.addEventListener('change', filtrar);
  porEstado.addEventListener('change', filtrar);
  filtrar();
  destino.append(filtros, resultado, lista);
}
/** @param {EstadoDatosPanel} datos */
function resumenDeSalud(datos) {
  const salud = resumirSaludDatos(datos);
  const contenedor = document.createElement('section');
  contenedor.className = 'salud-datos';
  const titulo = document.createElement('h3');
  titulo.textContent = textoPanel('panel.datos.comprobacion-fuentes');
  contenedor.append(titulo);
  const global = document.createElement('div');
  global.className = 'salud-global';
  const etiqueta = document.createElement('h4');
  etiqueta.textContent = textoPanel('panel.datos.estado-global');
  const indicador = document.createElement('p');
  const visual = ESTADOS_SALUD[salud.global];
  indicador.className = `salud-indicador salud-${visual.tono}`;
  indicador.textContent = `${visual.forma} ${textoPanel(`panel.salud.estado.${salud.global}`)}`;
  global.append(etiqueta, indicador);
  parrafo(global, recuentoDeSalud(salud.operativas));
  contenedor.append(global);
  avisosDeLaInstalacion(contenedor, salud);
  const alcance = document.createElement('details');
  const tituloAlcance = document.createElement('summary');
  tituloAlcance.textContent = textoPanel('panel.datos.que-indican');
  alcance.append(tituloAlcance);
  parrafo(alcance, textoPanel('panel.datos.alcance-luces'));
  contenedor.append(alcance);
  mostrarTemasDeSalud(contenedor, salud.temas);
  fuentesFiltrables(contenedor, salud.operativas);
  if (salud.otras.length) {
    const otras = document.createElement('details');
    const encabezado = document.createElement('summary');
    encabezado.textContent = textoPanel('panel.datos.otras');
    otras.append(encabezado);
    parrafo(otras, textoPanel('panel.datos.otras-limite'));
    for (const fuente of salud.otras) {
      otras.append(tarjetaDeSalud(fuente));
    }
    contenedor.append(otras);
  }
  return contenedor;
}

/** @param {HTMLElement} destino @param {ReturnType<typeof resumirSaludDatos>['temas']} temas */
function mostrarTemasDeSalud(destino, temas) {
  const lista = document.createElement('div');
  lista.className = 'salud-temas';
  for (const tema of temas) {
    const resumen = document.createElement('div');
    resumen.className = 'salud-tema';
    const nombre = document.createElement('h4');
    nombre.textContent = Object.hasOwn(NOMBRES_TEMAS, tema.tema) ? textoPanel(`panel.tema.${tema.tema}`) : tema.tema;
    resumen.append(nombre);
    const estado = document.createElement('p');
    const visual = ESTADOS_SALUD[tema.estado];
    estado.className = `salud-indicador salud-${visual.tono}`;
    estado.textContent = `${visual.forma} ${textoPanel(`panel.salud.estado.${tema.estado}`)}`;
    resumen.append(estado);
    parrafo(resumen, recuentoDeSalud(tema.fuentes));
    lista.append(resumen);
  }
  destino.append(lista);
}
