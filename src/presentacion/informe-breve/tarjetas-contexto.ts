import { porcentaje } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import { UMBRALES } from '../../dominio/franjas.ts';
import type { InformeBreve } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import type { LenguaHtml } from '../lengua-html.ts';
import { medidor } from './graficos.ts';
import { personasDelUso } from './textos.ts';

export const POR_CIEN = 100;
export const VUELTA = 2 * Math.PI;
const CENTRO = 100;
const DECIMALES_COORDENADAS = 3;
const SEMICIRCULO = { radio: 80, punta: 94, base: 68, aperturaAguja: 0.04 };
const ANILLO = { radio: 34, cuadrantes: 4 };
export const OBSERVATORI = 'Obs. del Treball';

export function fuenteBreve(fuente: string, idioma: Idioma, cita = fuente): string {
  return `<small class="ib-fuente-breve" title="${escapar(cita)}">${idioma === 'ca' ? 'Font' : 'Fuente'}: ${escapar(fuente)}</small>`;
}

export interface Carta {
  titulo: string;
  grafico: string;
  lectura: string;
  fuente: string;
  cita?: string | undefined;
  id?: string;
}

export function carta(datos: Carta, idioma: Idioma, etiqueta: 'article' | 'li' = 'article'): string {
  return `<${etiqueta} class="ib-carta"${datos.id ? ` id="${escapar(datos.id)}"` : ''}><h2>${escapar(datos.titulo)}</h2>
  <div class="ib-carta-figura">${datos.grafico}</div><div class="ib-carta-lectura">${datos.lectura}</div>
  ${fuenteBreve(datos.fuente, idioma, datos.cita)}</${etiqueta}>`;
}

export function anillo(proporcion: number, cifra: string, unidad = ''): string {
  const longitud = VUELTA * ANILLO.radio;
  const marcado = (proporcion * longitud) / POR_CIEN;
  const rotacion = longitud / ANILLO.cuadrantes;
  return `<div class="ib-anillo"><svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <circle cx="40" cy="40" r="34"/><circle class="ib-anillo-valor" cx="40" cy="40" r="34" stroke-dasharray="${marcado} ${longitud - marcado}" stroke-dashoffset="${rotacion}"/>
  </svg><strong>${escapar(cifra)}</strong>${unidad ? `<span class="ib-anillo-unidad">${escapar(unidad)}</span>` : ''}</div>`;
}

interface Barra {
  valor: number;
  etiqueta: string;
  cifra: string;
}

export function barras(filas: readonly Barra[], maximo = POR_CIEN, escala = ''): string {
  return `<ul class="ib-barras-compactas">${filas
    .map(
      (
        fila,
      ) => `<li><div><span>${escapar(fila.etiqueta)}</span><strong class="ib-barra-cifra">${escapar(fila.cifra)}</strong></div>
  <span class="ib-carta-pista" aria-hidden="true"><span class="ib-barra-tramo" data-ancho="${(POR_CIEN * fila.valor) / maximo}"></span></span></li>`,
    )
    .join('')}</ul>${escala}`;
}

export function eje(...rotulos: string[]): string {
  return `<div class="ib-carta-eje" aria-hidden="true">${rotulos.map((rotulo) => `<span>${escapar(rotulo)}</span>`).join('')}</div>`;
}

export function punto(angulo: number, radio: number): string {
  return `${(CENTRO + radio * Math.cos(angulo)).toFixed(DECIMALES_COORDENADAS)} ${(CENTRO + radio * Math.sin(angulo)).toFixed(DECIMALES_COORDENADAS)}`;
}

function medidorJornada(exposicion: NonNullable<InformeBreve['exposicion']>, idioma: Idioma): string {
  const ca = idioma === 'ca';
  const franjas = ca
    ? { baja: 'Baixa', media: 'Mitjana', alta: 'Alta' }
    : { baja: 'Baja', media: 'Media', alta: 'Alta' };
  const cortes = [0, UMBRALES.media, UMBRALES.alta, 1];
  const colores = ['#69ad89', '#dfa944', '#b85668'];
  const angulo = (fraccion: number) => Math.PI * (1 + fraccion);
  const arcos = colores.map(
    (color, i) =>
      `<path d="M ${punto(angulo(cortes[i] ?? 0), SEMICIRCULO.radio)} A 80 80 0 0 1 ${punto(angulo(cortes[i + 1] ?? 1), SEMICIRCULO.radio)}" fill="none" stroke-width="24" stroke="${color}"/>`,
  );
  const posicion = angulo(exposicion.valor / POR_CIEN);
  const aguja = [
    punto(posicion, SEMICIRCULO.punta),
    punto(posicion + SEMICIRCULO.aperturaAguja, SEMICIRCULO.base),
    punto(posicion - SEMICIRCULO.aperturaAguja, SEMICIRCULO.base),
  ];
  const franja = franjas[exposicion.nivel];
  const puntuacion = `${exposicion.valor} de 100`;
  return `<svg class="ib-indicador ib-indicador-jornada" viewBox="0 0 200 112" role="img"
  aria-label="${franja}, ${puntuacion}. ${ca ? 'Marge' : 'Margen'} ${exposicion.minimo}–${exposicion.maximo}">
  ${arcos.join('')}
  <path d="M ${aguja.join(' L ')} Z" fill="#3e3328" stroke="#dbcaa3" stroke-linejoin="round"/>
  <text x="100" y="91" text-anchor="middle" font-size="25">${franja}</text>
  <text x="100" y="108" text-anchor="middle" font-size="13">${puntuacion}</text></svg>`;
}

function tarjetaDelGrupo(grupoOdee: NonNullable<InformeBreve['grupoOdee']>, lengua: LenguaHtml): Carta {
  const { idioma } = lengua;
  const ca = idioma === 'ca';
  const { cno, nombre, nivel, niveles, gruposEstudiados, gruposEnElNivel, desde } = grupoOdee;
  const grupo = nombre ? lengua.dato(nombre) : `CNO ${escapar(cno)}`;
  const rotulo = `${ca ? 'Nivell' : 'Nivel'} ${nivel} de ${niveles}`;
  const luces = Array.from(
    { length: niveles },
    (_, i) => `<span class="ib-nivel-luz"${i + 1 === nivel ? ' data-activo' : ''}>${i + 1}</span>`,
  );
  const escala = ca
    ? `El nivell comença als ${desde} punts de l’ODEE.`
    : `El nivel empieza en ${desde} puntos del ODEE.`;
  const texto = ca
    ? `${grupo} és un dels ${gruposEnElNivel} de ${gruposEstudiados} grups al nivell ${nivel}.`
    : `${grupo} es uno de los ${gruposEnElNivel} de ${gruposEstudiados} grupos en el nivel ${nivel}.`;
  return {
    titulo: ca ? 'El teu grup a Catalunya' : 'Tu grupo en Cataluña',
    grafico: `<div class="ib-niveles-grupo"><strong class="ib-nivel-rotulo">${rotulo}</strong><div class="ib-niveles-luces" aria-hidden="true">${luces.join('')}</div>
      ${eje(ca ? 'Menys exposició' : 'Menor exposición', ca ? 'Més exposició' : 'Mayor exposición')}</div>`,
    lectura: desde !== null && nivel === niveles ? `${texto} ${escala}` : texto,
    fuente: 'ODEE',
    cita: `Observatori Dona, Empresa i Economia · CNO ${cno}`,
  };
}

function tarjetaTareas(altas: number, tareas: number, idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const umbral = POR_CIEN * UMBRALES.alta;
  return {
    id: 'lectura-exposicion',
    titulo: ca ? 'Tasques més exposades' : 'Tareas más expuestas',
    grafico: anillo((POR_CIEN * altas) / tareas, String(altas), `de ${tareas} ${ca ? 'tasques' : 'tareas'}`),
    lectura: ca
      ? `De les tasques amb puntuació, el gràfic destaca les que arriben als ${umbral} punts.`
      : `De las tareas con puntuación, el gráfico destaca las que alcanzan ${umbral} puntos.`,
    fuente: 'Faro',
  };
}

function tarjetaJornada(exposicion: NonNullable<InformeBreve['exposicion']>, idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const baja = POR_CIEN * UMBRALES.media;
  const alta = POR_CIEN * UMBRALES.alta;
  return {
    titulo: ca ? 'Exposició total' : 'Exposición total',
    grafico: medidorJornada(exposicion, idioma),
    lectura: ca
      ? `Faro pondera les tasques pel temps que hi dediques. El tram mitjà va de ${baja} a menys de ${alta} punts.`
      : `Faro pondera las tareas por el tiempo que les dedicas. El tramo medio va de ${baja} a menos de ${alta} puntos.`,
    fuente: exposicion.estimadasPorFaro === exposicion.conNota ? 'Faro' : 'OIT + Faro',
  };
}

export function exposicionEnTresTarjetas(breve: InformeBreve, lengua: LenguaHtml): string {
  const { exposicion, grupoOdee } = breve;
  const { idioma } = lengua;
  const cartas: Carta[] = [];
  if (exposicion) {
    const altas = breve.tareas.filter(({ franja }) => franja === 'alta').length;
    cartas.push(tarjetaTareas(altas, exposicion.conNota, idioma));
  }
  if (grupoOdee) {
    cartas.push(tarjetaDelGrupo(grupoOdee, lengua));
  }
  if (exposicion) {
    cartas.push(tarjetaJornada(exposicion, idioma));
  }
  return cartas.length
    ? `<ol class="ib-cartas ib-cartas-exposicion" data-cartas="${cartas.length}" aria-label="${idioma === 'ca' ? 'Exposició a la IA' : 'Exposición a la IA'}">${cartas.map((item) => carta(item, idioma, 'li')).join('')}</ol>`
    : '';
}

function tarjetaUso(uso: NonNullable<InformeBreve['uso']>, lengua: LenguaHtml): Carta {
  const { idioma } = lengua;
  const ca = idioma === 'ca';
  const donde =
    uso.ambito === 'cataluna' ? { es: 'En Cataluña', ca: 'A Catalunya' } : { es: 'En España', ca: 'A Espanya' };
  const personas = lengua.texto(personasDelUso(uso, idioma));
  return {
    id: 'uso-ia-trabajo',
    titulo: ca ? 'Ús de la IA a la feina' : 'Uso de IA al trabajar',
    grafico: anillo(uso.deCada100, String(uso.deCada100), 'de cada 100'),
    lectura: ca
      ? `${donde.ca}, ${uso.deCada100} de cada 100 ${personas} van utilitzar IA generativa per treballar.`
      : `${donde.es}, ${uso.deCada100} de cada 100 ${personas} usaron IA generativa para trabajar.`,
    fuente: 'INE',
    cita: `INE · TIC-H ${uso.anio} · ${uso.intervalo[0]}–${uso.intervalo[1]}`,
  };
}

type Traduccion = Record<Idioma, string>;
interface IndicadorDeIa {
  titulo: Traduccion;
  filas: readonly { etiqueta: Traduccion; valor: number; decimales?: number }[];
  lectura: Traduccion;
  fuente: string;
  cita: string;
}
const SEXO = { mujeres: { es: 'Mujeres', ca: 'Dones' }, hombres: { es: 'Hombres', ca: 'Homes' } };
const INDICADORES_IA: readonly IndicadorDeIa[] = [
  {
    titulo: { es: 'Cambios al usar IA', ca: 'Canvis en usar IA' },
    filas: [
      { etiqueta: { es: 'Trabajaban más rápido', ca: 'Treballaven més de pressa' }, valor: 67 },
      { etiqueta: { es: 'Tareas nuevas o distintas', ca: 'Tasques noves o diferents' }, valor: 41 },
      { etiqueta: { es: 'La IA asumió tareas completas', ca: 'La IA va assumir tasques senceres' }, valor: 30 },
    ],
    lectura: {
      es: 'En 11 países de la UE, de cada 100 personas que usaban IA en el trabajo, 67 dijeron que trabajaban más rápido.',
      ca: 'En 11 països de la UE, de cada 100 persones que feien servir IA a la feina, 67 van dir que treballaven més de pressa.',
    },
    fuente: 'Cedefop',
    cita: 'Cedefop AI skills survey · 2024',
  },
  {
    titulo: { es: 'IA según la plantilla', ca: 'IA segons la plantilla' },
    filas: [
      { etiqueta: { es: '10 a 49 personas', ca: 'De 10 a 49 persones' }, valor: 17 },
      { etiqueta: { es: '250 personas o más', ca: '250 persones o més' }, valor: 55 },
    ],
    lectura: {
      es: 'En la UE, el 17 % de las empresas de 10 a 49 personas usó IA. Entre las de 250 o más, la usó el 55 %.',
      ca: 'A la UE, el 17 % de les empreses de 10 a 49 persones va fer servir IA. Entre les de 250 o més, en va fer servir el 55 %.',
    },
    fuente: 'Eurostat',
    cita: 'Eurostat · isoc_eb_ai · 2025',
  },
  {
    titulo: { es: 'Exposición por sexo', ca: 'Exposició per sexe' },
    filas: [
      { etiqueta: SEXO.mujeres, valor: 30 },
      { etiqueta: SEXO.hombres, valor: 23 },
    ],
    lectura: {
      es: 'En Cataluña, 30 de cada 100 mujeres que trabajan tienen un empleo con exposición media o alta a la IA. Entre los hombres, son 23 de cada 100.',
      ca: 'A Catalunya, 30 de cada 100 dones que treballen tenen una feina amb exposició mitjana o alta a la IA. Entre els homes, en són 23 de cada 100.',
    },
    fuente: 'ODEE',
    cita: 'ODEE · Cambra de Comerç de Barcelona · 2021–2022',
  },
  {
    titulo: { es: 'Uso de IA por sexo', ca: 'Ús de la IA per sexe' },
    filas: [
      { etiqueta: SEXO.mujeres, valor: 23.3, decimales: 1 },
      { etiqueta: SEXO.hombres, valor: 25.3, decimales: 1 },
    ],
    lectura: {
      es: 'Entre quienes usaban internet en Cataluña, unas 23 de cada 100 mujeres y 25 de cada 100 hombres usaron IA generativa para trabajar.',
      ca: 'Entre les persones que feien servir internet a Catalunya, unes 23 de cada 100 dones i 25 de cada 100 homes van utilitzar IA generativa per treballar.',
    },
    fuente: 'Idescat',
    cita: 'Idescat · TIC-H 2025 · 3.4.1',
  },
];

function tarjetaCapacidad(capacidad: InformeBreve['capacidad'], idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const completadas = capacidad.deCada100;
  return {
    titulo: ca ? 'IA en tasques llargues' : 'IA en tareas largas',
    grafico: `<div class="ib-cifra-figura">${completadas}<small>de 100</small></div>${medidor(completadas, `${completadas} de 100`)}`,
    lectura: ca
      ? `La prova incloïa 108 tasques de diversos passos en un ordinador. Un sistema d’IA en va acabar unes ${completadas} de cada 100.`
      : `La prueba incluía 108 tareas de varios pasos en un ordenador. Un sistema de IA logró terminar unas ${completadas} de cada 100.`,
    fuente: 'OSWorld 2.0',
    cita: `OSWorld 2.0 · ${capacidad.anio}`,
  };
}

export function contextoIaConGraficos(breve: InformeBreve, lengua: LenguaHtml): string {
  const { idioma } = lengua;
  const cartas = INDICADORES_IA.map(
    ({ titulo, filas, lectura, fuente, cita }): Carta => ({
      titulo: titulo[idioma],
      grafico: barras(
        filas.map(({ valor, etiqueta, decimales }) => ({
          valor,
          etiqueta: etiqueta[idioma],
          cifra: porcentaje(valor, decimales ?? 0),
        })),
      ),
      lectura: lectura[idioma],
      fuente,
      cita,
    }),
  );
  if (breve.uso) {
    cartas.unshift(tarjetaUso(breve.uso, lengua));
  }
  cartas.push(tarjetaCapacidad(breve.capacidad, idioma));
  return `<section class="ib-cartas ib-cartas-contexto" id="contexto-ia" data-solo-pantalla aria-label="${idioma === 'ca' ? 'IA i feina' : 'IA y trabajo'}">${cartas.map((item) => carta(item, idioma)).join('')}</section>`;
}
