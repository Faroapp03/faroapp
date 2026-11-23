import { nombresDeLosMeses } from '../../comun/fechas.js';
import { numero, porcentaje } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import type { ContextoSectorial } from '../../dominio/tipos-contexto-empresarial.ts';
import type { ContratosMensualesBreve, InformeBreve, TiposDeContratoBreve } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import { anillo, barras, type Carta, carta, eje, OBSERVATORI, POR_CIEN, punto, VUELTA } from './tarjetas-contexto.ts';

const SECTORES = { visibles: 3, radio: 98, interior: 70, medio: 50, minimoRotulo: 5, redondeo: 0.05 };
const FECHA = { anio: 4, inicioMes: 5, mesBreve: 3 };
const OFERTAS = { escala: 80_000 };
const GESTION = { escala: 10 };
const DECIMALES_EMPRESAS = 2;

function porMes({ meses, valores }: ContratosMensualesBreve, idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const nombres = nombresDeLosMeses(idioma);
  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  const mes = (i: number) => nombres[Number(meses[i]?.slice(FECHA.inicioMes)) - 1] ?? '';
  const etiquetaMes = (i: number) => `${mes(i)} ${meses[i]?.slice(0, FECHA.anio) ?? ''}`;
  const nombreMes = (i: number) => mes(i).slice(0, FECHA.mesBreve);
  const grafico = `<ul class="ib-meses" aria-label="${escapar(`${etiquetaMes(0)} – ${etiquetaMes(meses.length - 1)}`)}">${valores
    .map(
      (valor, i) =>
        `<li><span class="ib-mes-columna"><span class="ib-mes-barra" data-ancho="${(POR_CIEN * valor) / maximo}"${valor === maximo ? ' data-maximo' : ''}></span></span><span class="ib-mes-nombre">${escapar(nombreMes(i))}</span><span class="solo-lectores">: ${numero(valor)}</span></li>`,
    )
    .join('')}</ul>`;
  const mesMayor = `${escapar(mes(valores.indexOf(maximo)))} (${numero(maximo)})`;
  const mesMenor = `${escapar(mes(valores.indexOf(minimo)))} (${numero(minimo)})`;
  let lectura = ca
    ? `A Catalunya es van signar més contractes al ${mesMayor} i menys al ${mesMenor}.`
    : `En Cataluña se firmaron más contratos en ${mesMayor} y menos en ${mesMenor}.`;
  if (maximo === minimo) {
    lectura = ca
      ? `A Catalunya es van signar ${numero(maximo)} contractes cada mes del període.`
      : `En Cataluña se firmaron ${numero(maximo)} contratos cada mes del periodo.`;
  }
  return {
    id: 'contratos-mensuales',
    titulo: ca ? 'Contractes per mes' : 'Contratos por mes',
    grafico,
    lectura,
    fuente: OBSERVATORI,
    cita: `Observatori del Treball · ${meses[0]} – ${meses.at(-1)}`,
  };
}

function porTipo({ indefinidos, diasTemporales, periodo }: TiposDeContratoBreve, idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const temporales = POR_CIEN - indefinidos;
  const duracion = ca
    ? ` Els temporals van durar ${numero(diasTemporales ?? 0)} dies de mitjana.`
    : ` Los temporales duraron ${numero(diasTemporales ?? 0)} días de media.`;
  return {
    id: 'tipos-de-contrato',
    titulo: ca ? 'Tipus de contracte' : 'Tipos de contrato',
    grafico: `<div class="ib-tipos-contrato">${barras(
      [
        { etiqueta: ca ? 'Indefinits' : 'Indefinidos', valor: indefinidos, cifra: porcentaje(indefinidos) },
        { etiqueta: ca ? 'Temporals' : 'Temporales', valor: temporales, cifra: porcentaje(temporales) },
      ],
      POR_CIEN,
      eje('0 %', '100 %'),
    )}</div>`,
    lectura:
      (ca
        ? `${porcentaje(indefinidos)} dels contractes es van signar sense data de finalització.`
        : `El ${porcentaje(indefinidos)} de los contratos se firmó sin fecha de fin.`) +
      (diasTemporales === null ? '' : duracion),
    fuente: OBSERVATORI,
    cita: `Observatori del Treball · ${periodo}`,
  };
}

const ACTIVIDADES_RECEPCION: Record<string, readonly [string, string]> = {
  '82': ['Servicios de oficina y apoyo a empresas', 'Serveis d’oficina i de suport a empreses'],
  '84': ['Administración pública', 'Administració pública'],
  '86': ['Sanidad', 'Sanitat'],
};

function porSector(contexto: ContextoSectorial, idioma: Idioma): Carta {
  const ca = idioma === 'ca';
  const recepcion = contexto.grupoMostrado === '441';
  const sectores = recepcion
    ? Object.keys(ACTIVIDADES_RECEPCION).flatMap((codigo) =>
        contexto.sectores.filter((sector) => sector.codigo === codigo),
      )
    : contexto.sectores.slice(0, SECTORES.visibles);
  const filas = sectores.map(({ codigo, nombre, porcentaje: valor }) => ({
    nombre: ACTIVIDADES_RECEPCION[codigo]?.[ca ? 1 : 0] ?? nombre,
    valor,
  }));
  const resto = POR_CIEN - filas.reduce((total, { valor }) => total + valor, 0);
  if (resto > SECTORES.redondeo) {
    filas.push({ nombre: ca ? 'Altres sectors' : 'Otros sectores', valor: resto });
  }
  const colores = ['#245889', '#788c68', '#b07d58', '#b7aea0'];
  let desde = -Math.PI / 2;
  const dibujos = filas.map(({ valor }, i) => {
    const arco = (valor * VUELTA) / POR_CIEN;
    const hasta = desde + arco;
    // biome-ignore lint/style/noMagicNumbers: coeficientes de la fórmula del centroide de un sector circular.
    const radio = valor > SECTORES.medio ? (4 * SECTORES.radio * Math.sin(arco / 2)) / (3 * arco) : SECTORES.interior;
    const [x, y] = punto((desde + hasta) / 2, radio).split(' ');
    const forma =
      valor >= POR_CIEN
        ? `<circle cx="100" cy="100" r="98" fill="${colores[i]}"/>`
        : `<path d="M 100 100 L ${punto(desde, SECTORES.radio)} A 98 98 0 ${valor > SECTORES.medio ? 1 : 0} 1 ${punto(hasta, SECTORES.radio)} Z" fill="${colores[i]}"/>`;
    desde = hasta;
    const rotulo = `<text x="${x}" y="${y}" fill="${i === 0 ? '#fff' : '#222'}" text-anchor="middle">${numero(valor, 1)}%</text>`;
    return { forma, rotulo: valor >= SECTORES.minimoRotulo ? rotulo : '' };
  });
  const leyenda = filas.map(
    ({ nombre, valor }, i) => `<li><span class="ib-color-sector" data-sector="${i}" aria-hidden="true"></span>
    <span>${escapar(nombre)}<span class="solo-lectores">, ${porcentaje(valor)}</span></span></li>`,
  );
  return {
    id: 'sectores-recepcion',
    titulo: ca ? 'Ocupació per sector' : 'Empleo por sector',
    grafico: `<svg class="ib-sectores-pastel" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${dibujos.map((dibujo) => dibujo.forma).join('')}${dibujos.map((dibujo) => dibujo.rotulo).join('')}</svg>`,
    lectura: `<p class="ib-sector-ambito">${ca ? 'Catalunya' : 'Cataluña'} · CNO ${escapar(contexto.grupoMostrado)}</p><ul class="ib-sectores-leyenda">${leyenda.join('')}</ul>`,
    fuente: ca ? 'INE · Cens 2021' : 'INE · Censo 2021',
    cita: `${contexto.fuente} · CNO ${contexto.grupoMostrado}`,
  };
}

export function graficosDelMercado(breve: InformeBreve, idioma: Idioma): string {
  const { mensual, tiposDeContrato } = breve.mercado;
  const graficos = [
    mensual ? carta(porMes(mensual, idioma), idioma) : '',
    tiposDeContrato ? carta(porTipo(tiposDeContrato, idioma), idioma) : '',
    breve.sectores ? carta(porSector(breve.sectores, idioma), idioma) : '',
  ].filter(Boolean);
  return graficos.length
    ? `<div class="ib-cartas ib-cartas-mercado" id="tarjetas-mercado" data-cartas="${graficos.length}">${graficos.join('')}</div>`
    : '';
}

export function senalesDelMercado(breve: InformeBreve, idioma: Idioma): string {
  const ca = idioma === 'ca';
  const empresas = breve.empresas?.cataluna.total ?? null;
  const cartas: Carta[] = [];
  if (empresas !== null) {
    cartas.push({
      titulo: ca ? 'IA a les empreses' : 'IA en las empresas',
      grafico: anillo(empresas, porcentaje(empresas, DECIMALES_EMPRESAS)),
      lectura: ca
        ? `A Catalunya, fan servir IA el ${porcentaje(empresas, DECIMALES_EMPRESAS)} de les empreses amb Internet i almenys 10 persones en plantilla.`
        : `En Cataluña, el ${porcentaje(empresas, DECIMALES_EMPRESAS)} de las empresas con Internet y al menos 10 personas en plantilla usa IA.`,
      fuente: 'INE',
      cita: breve.empresas?.vigencia.periodo,
    });
  }
  cartas.push(
    {
      id: 'ofertas-con-ia',
      titulo: ca ? 'Ofertes que demanen IA' : 'Ofertas que piden IA',
      grafico: barras(
        [
          { etiqueta: '2024', valor: 48000, cifra: '48.000' },
          { etiqueta: '2025', valor: 74000, cifra: '74.000' },
        ],
        OFERTAS.escala,
        eje('0', ca ? '80.000 ofertes' : '80.000 ofertas'),
      ),
      lectura: ca
        ? 'El 2025, unes 4 de cada 100 ofertes analitzades a Espanya demanaven coneixements d’IA. L’estudi recull anuncis de diversos portals.'
        : 'En 2025, unas 4 de cada 100 ofertas analizadas en España pedían conocimientos de IA. El estudio recoge anuncios de varios portales.',
      fuente: 'PwC · Lightcast',
      cita: 'PwC · Global AI Jobs Barometer 2026 · Spain, p. 5',
    },
    {
      titulo: ca ? 'IA en la gestió' : 'IA en la gestión',
      grafico: barras(
        [
          { etiqueta: '2023', valor: 2.22, cifra: '2,22 %' },
          { etiqueta: '2024', valor: 3.24, cifra: '3,24 %' },
          { etiqueta: '2025', valor: 5.79, cifra: '5,79 %' },
        ],
        GESTION.escala,
        eje('0 %', '5 %', '10 %'),
      ),
      lectura: ca
        ? 'A Espanya, el 2025 gairebé 6 de cada 100 empreses amb almenys 10 persones en plantilla feien servir IA per a tasques de gestió.'
        : 'En España, en 2025, casi 6 de cada 100 empresas con al menos 10 personas en plantilla usaban IA para tareas de gestión.',
      fuente: 'Eurostat',
      cita: 'Eurostat · isoc_eb_ai · ES · E_AI_PBAM · GE10',
    },
  );
  return `<section id="indicadores-de-ia" class="ib-cartas ib-cartas-senales" data-solo-pantalla aria-label="${ca ? 'IA al mercat laboral' : 'IA en el mercado laboral'}" data-cartas="${cartas.length}">${cartas.map((item) => carta(item, idioma)).join('')}</section>`;
}
