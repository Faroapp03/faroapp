// Informe breve con el caso de oficina (4110.1) y tiempos fijados, para comprobar redondeos y dirección.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { direccionDe } from '../../src/dominio/direcciones.ts';
import { construirInformeBreve, redondear } from '../../src/dominio/informe-breve.ts';
import type { Tiempo } from '../../src/dominio/tipos-entrada.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { construirInformeConFormacion as construirInforme } from '../ayudas/informe-con-formacion.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const MERCADO = JSON.parse(readFileSync(new URL('../../datos/mercado.json', import.meta.url), 'utf8'));
const TICH = JSON.parse(readFileSync(new URL('../../datos/tich.json', import.meta.url), 'utf8'));
const CENSO = JSON.parse(readFileSync(new URL('../../datos/censo.json', import.meta.url), 'utf8'));
const CATALUNA = JSON.parse(readFileSync(new URL('../../datos/cataluna.json', import.meta.url), 'utf8'));
const OBSERVATORI = JSON.parse(readFileSync(new URL('../../datos/observatori.json', import.meta.url), 'utf8'));
const suficiente = (cifra: { muestra: number; pct: number; ic95: [number, number] } | undefined) =>
  cifra && cifra.muestra >= TICH.min_muestra ? cifra : undefined;
const catalana = suficiente(TICH.cataluna_isco1?.['4']);
const bloque = TICH.bloque_por_isco2['41'];
function cifraPrincipal() {
  if (bloque) {
    return TICH.espana_bloques[bloque];
  }
  return TICH.grandes_grupos_enteros.includes('4') ? TICH.espana_isco1['4'] : TICH.espana_isco2['41'];
}
const principal = cifraPrincipal();
const uso = catalana ?? suficiente(principal) ?? suficiente(TICH.espana_isco1['4']);
const salarioOficina = MERCADO.salarios.grupos.E;
const edadOficina = CATALUNA.ocupados_cno3['430'];
const edadConjunto = CENSO.ocupados_cataluna;
const oficina = OBSERVATORI.cataluna.cno4['4309'];
const demandaOficina = MERCADO.demandantes.cno4['4309'];
const empleoOficina = MERCADO.empleo.grandes_grupos['4'];
const ofertasOficina = MERCADO.ofertas.cno4['4309'];
const POR_CIEN = 100;
const COMARCAS_PRINCIPALES = 5;
const PRECISION_PORCENTAJE = 1000;
const porcentajeOfertas = (POR_CIEN * ofertasOficina.puestos) / MERCADO.ofertas.total;
const porcentajeOfertasAnterior = (POR_CIEN * ofertasOficina.anterior) / MERCADO.ofertas.total_anterior;
function direccion(variacion: number): 'sube' | 'baja' | 'estable' {
  if (variacion >= 1) {
    return 'sube';
  }
  return variacion <= -1 ? 'baja' : 'estable';
}
const numero = (valor: number) => valor.toLocaleString('es-ES');
const comarcasOficina = MERCADO.comarcas.cno4['4309'];
const porcentajesComarcas = comarcasOficina.todas
  .slice(0, COMARCAS_PRINCIPALES)
  .map(([, contratos]: [string, number]) => Math.round((POR_CIEN * contratos) / comarcasOficina.total));

/** Las tareas de la maqueta, con sus tiempos de ejemplo. */
const TAREAS: readonly [string, Tiempo][] = [
  ['4110-8', 'mucho'],
  ['4110-7', 'algo'],
  ['4110-4', 'algo'],
  ['4110-6', 'mucho'],
  ['4110-1', 'mucho'],
  ['4110-5', 'poco'],
  ['4110-3', 'poco'],
  ['4110-2', 'poco'],
];

/** Las cifras de la maqueta aprobada para el caso de referencia (testigos/informe-breve-oficina.json). */
const TESTIGO: {
  exposicion: unknown[];
  capacidad: number;
  menosExpuestas: number[];
  metodosOficina: unknown[];
  confianzaCocina: unknown[];
  redondeos: [number, number, number][];
  variacionPequena: number;
} = JSON.parse(readFileSync(new URL('../testigos/informe-breve-oficina.json', import.meta.url), 'utf8'));
/** Decimales de la variación del salario en la tarjeta. */
const DECIMAL = 1;

/** El informe breve del caso de referencia. */
function deOficina() {
  const tareas = TAREAS.map(([id, tiempo], i) => ({
    id: `t${i + 1}`,
    texto: DATOS.textos.tareas[id]?.corto ?? id,
    tiempo,
    referencia: { tareaOit: id, relacion: 'propia' as const },
  }));
  const informe = construirInforme(
    { isco08: '4110', ocupacionEsco: '4110.1', sinIa: true, fecha: '2026-10-21', tareas },
    DATOS,
  );
  return { informe, breve: construirInformeBreve(informe, DATOS) };
}

test('redondear lleva la mitad hacia arriba aunque la coma flotante diga 64,4999…', () => {
  for (const [valor, decimales, resultado] of TESTIGO.redondeos) {
    assert.equal(redondear(valor, decimales), resultado);
  }
});

test('un dato sube o baja desde un 1 % de variación; por debajo se mantiene, y sin comparación no tiene dirección', () => {
  assert.equal(direccionDe(1), 'sube');
  assert.equal(direccionDe(-1), 'baja');
  assert.equal(direccionDe(TESTIGO.variacionPequena), 'estable');
  assert.equal(direccionDe(null), 'sin-dato');
});

function comprobarComarcas(comarcas: ReturnType<typeof deOficina>['breve']['mercado']['comarcas']): void {
  assert.deepEqual(
    comarcas?.primeras.map((comarca) => comarca.deCada100),
    porcentajesComarcas,
  );
  assert.deepEqual(comarcas?.resto, {
    comarcas: comarcasOficina.todas.length - COMARCAS_PRINCIPALES,
    deCada100: POR_CIEN - porcentajesComarcas.reduce((suma: number, valor: number) => suma + valor, 0),
  });
}

function comprobarMercadoDeOficina(breve: ReturnType<typeof deOficina>['breve']): void {
  const { contratacion, empleo, salario, anual, comarcas, perfil } = breve.mercado;
  assert.deepEqual(
    [contratacion?.personas, contratacion?.direccion, contratacion?.hasta],
    [
      CATALUNA.contratacion_cno4['4309'].personas_contratadas,
      direccion(
        POR_CIEN *
          (CATALUNA.contratacion_cno4['4309'].personas_contratadas /
            CATALUNA.contratacion_cno4['4309'].personas_contratadas_anterior -
            1),
      ),
      CATALUNA.periodo_contratacion.replace('12 meses a ', ''),
    ],
  );
  assert.deepEqual(
    [empleo?.personas, empleo?.variacion, empleo?.direccion],
    [empleoOficina.personas, empleoOficina.variacion_pct, 'sin-dato'],
  );
  assert.deepEqual(
    [salario?.euros, redondear(salario?.variacion ?? 0, DECIMAL), salario?.brecha],
    [
      salarioOficina.total,
      Math.round(PRECISION_PORCENTAJE * (salarioOficina.total / salarioOficina.anterior - 1)) / 10,
      Math.round(POR_CIEN * (1 - salarioOficina.mujeres / salarioOficina.hombres)),
    ],
  );
  assert.deepEqual(anual?.valores, MERCADO.anual.cno4['4309']);
  comprobarComarcas(comarcas);
  assert.deepEqual(perfil?.relevo, {
    grupo: Math.round((10 * edadOficina.pct_55_o_mas) / edadOficina.pct_menores_30),
    conjunto: Math.round((10 * edadConjunto.pct_55_o_mas) / edadConjunto.pct_menores_30),
  });
}

test('el caso de referencia da las cifras de la maqueta aprobada', () => {
  const { breve } = deOficina();
  assert.deepEqual(
    [breve.exposicion?.valor, breve.exposicion?.minimo, breve.exposicion?.maximo, breve.exposicion?.nivel],
    TESTIGO.exposicion,
  );
  if (uso) {
    assert.deepEqual(
      [breve.uso?.deCada100, breve.uso?.intervalo, breve.uso?.ambito],
      [Math.round(uso.pct), uso.ic95.map(Math.round), catalana ? 'cataluna' : 'espana'],
    );
  } else {
    assert.equal(breve.uso, null);
  }
  assert.equal(breve.capacidad.deCada100, TESTIGO.capacidad);
  assert.deepEqual(
    breve.menosExpuestas.map((tarea) => tarea.valor),
    TESTIGO.menosExpuestas,
  );
  comprobarMercadoDeOficina(breve);
});

function comprobarComparacionYOfertas(breve: ReturnType<typeof deOficina>['breve']): void {
  const { comparacionContratacionDemanda, ofertas } = breve.mercado;
  assert.deepEqual(
    [
      comparacionContratacionDemanda?.personasContratadas,
      comparacionContratacionDemanda?.personasDemandantes,
      comparacionContratacionDemanda?.contratadasPorDemandante,
      comparacionContratacionDemanda?.direccion,
    ],
    [
      oficina.personas_contratadas,
      demandaOficina.personas_12m,
      oficina.personas_contratadas / demandaOficina.personas_12m,
      direccion(
        POR_CIEN *
          ((1 + MERCADO.contratacion.cno4['4309'].variacion_exacta) / (1 + demandaOficina.variacion_exacta) - 1),
      ),
    ],
  );
  // Las ofertas del SOC se calculan (para el cuaderno), pero no salen en el informe breve.
  assert.deepEqual(
    [redondear(ofertas?.pct ?? 0), redondear(ofertas?.pctAnterior ?? 0), ofertas?.direccion, ofertas?.nivel],
    [
      Math.round(porcentajeOfertas),
      Math.round(porcentajeOfertasAnterior),
      direccion(POR_CIEN * (porcentajeOfertas / porcentajeOfertasAnterior - 1)),
      'ocupacion',
    ],
  );
}

test('la tarjeta de contratación y demanda compara recuentos y no predice las opciones de empleo', () => {
  const { informe, breve } = deOficina();
  comprobarComparacionYOfertas(breve);
  const datosAntes = JSON.stringify({ breve, informe });
  const html = renderizarInformeBreve(breve, informe, { incrustado: true });
  assert.match(html, /data-tarjetas="4"/);
  assert.match(html, /<h3 class="ib-tarjeta-titulo">Búsqueda laboral<\/h3>/);
  const proporcion = Math.round((POR_CIEN * oficina.personas_contratadas) / demandaOficina.personas_12m);
  assert.ok(html.includes(`${proporcion} / 100</div>`));
  assert.match(html, /data-comparacion/u);
  const htmlCa = renderizarInformeBreve(breve, { ...informe, idioma: 'ca' });
  assert.match(htmlCa, /Cerca laboral/u);
  assert.match(htmlCa, /Grups diferents: no prediu les teves opcions de feina/u);
  assert.equal(JSON.stringify({ breve, informe }), datosAntes, 'La presentación no altera los datos calculados');
  assert.doesNotMatch(html, /<h4 class="ib-tarjeta-titulo">Ofertas<\/h4>/);
  assert.doesNotMatch(html, /encontraron contrato/u);
  assert.match(html, /Grupos distintos: no predice tus opciones de empleo/u);
  assert.doesNotMatch(html, /style="/);
});

test('la confianza de la exposición sale de cuántos métodos publicados coinciden con la OIT', () => {
  const { breve } = deOficina();
  assert.deepEqual(
    [breve.exposicion?.confianza, breve.exposicion?.motivo, breve.exposicion?.metodos],
    TESTIGO.metodosOficina,
  );
  const tareas = [
    {
      id: 't1',
      texto: 'Cocinar',
      tiempo: 'mucho' as const,
      referencia: { tareaOit: '5120-1', relacion: 'propia' as const },
    },
  ];
  const cocina = construirInformeBreve(
    construirInforme({ isco08: '5120', sinIa: true, fecha: '2026-10-21', tareas }, DATOS),
    DATOS,
  );
  assert.deepEqual([cocina.exposicion?.confianza, cocina.exposicion?.motivo], TESTIGO.confianzaCocina);
});

test('una ocupación con varios grupos de la estadística suma su contratación y deja fuera lo que no tienen todos', () => {
  const tareas = [
    {
      id: 't1',
      texto: 'Controlar y extinguir incendios',
      tiempo: 'mucho' as const,
      referencia: { tareaOit: '5411-1', relacion: 'propia' as const },
    },
  ];
  const informe = construirInforme({ isco08: '5411', sinIa: true, fecha: '2026-10-21', tareas }, DATOS);
  const breve = construirInformeBreve(informe, DATOS);
  assert.deepEqual(breve.ocupacion.cno4, ['5931', '5932']);
  const suma = informe.contexto.contratacion.reduce((total, grupo) => total + grupo.personas, 0);
  assert.equal(breve.mercado.contratacion?.personas, suma);
  assert.equal(breve.mercado.anual, null);
  // Los bomberos no están entre las 50 ocupaciones más ofertadas: sale la cifra de su subgrupo, con su nombre.
  assert.equal(breve.mercado.ofertas?.nivel, 'grupo');
  assert.equal(breve.mercado.ofertas?.grupo, DATOS.clasificaciones.cno11['59']?.titulo);
});

test('las fuentes sin fecha conocida no inventan un año ni muestran paréntesis vacíos', () => {
  const { breve, informe } = deOficina();
  const sinFecha = { ...breve, datosHasta: null };
  const html = renderizarInformeBreve(sinFecha, informe, { incrustado: true });
  const fuentes = html.match(/<p class="ib-fuentes">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(fuentes);
  assert.ok(fuentes.includes('Observatori del Treball'));
  assert.doesNotMatch(fuentes, /Observatori del Treball \(\)/);
  for (const cita of ['OIT/NASK 2025', 'OSWorld 2.0', 'INE ETICCE (1T 2026)', 'Indeed (jul. 2026)']) {
    assert(fuentes.includes(cita));
  }
});

test('la búsqueda compara recuentos distintos, también cuando contratadas supera demandantes', () => {
  const tareas = [
    {
      id: 't1',
      texto: 'Tarea oficial 7549-1',
      tiempo: 'algo' as const,
      referencia: { tareaOit: '7549-1', relacion: 'propia' as const },
    },
  ];
  const datos = structuredClone(DATOS);
  assert.ok(datos.cataluna && datos.observatori && datos.mercado?.demandantes);
  const grupo = datos.observatori.cataluna.cno4['7899'];
  assert.ok(grupo);
  const contratadas = 18_196;
  grupo.personas_contratadas = contratadas;
  assert.ok(datos.cataluna.contratacion_cno4['7899']);
  datos.cataluna.contratacion_cno4['7899'].personas_contratadas = contratadas;
  datos.mercado.demandantes.cno4['7899'] = { personas_12m: 124, variacion_exacta: null, ratio: null };
  const informe = construirInforme({ isco08: '7549', sinIa: true, fecha: '2026-10-21', tareas }, datos);
  const breve = construirInformeBreve(informe, datos);
  const html = renderizarInformeBreve(breve, informe);
  assert.doesNotMatch(html, /encontraron contrato|1467[^<]*<small>de cada 10/u);
  assert.match(html, /18[.\s]196 personas contratadas/u);
  assert.match(html, /124 demandantes no ocupados/u);
  assert.match(html, /Grupos distintos: no predice tus opciones de empleo/u);
});

test('una relación menor que uno tampoco acredita colocación; periodos distintos omiten la comparación', () => {
  assert.ok(DATOS.observatori);
  assert.ok(DATOS.mercado?.demandantes);
  const { informe } = deOficina();
  const oficina = DATOS.observatori.cataluna.cno4['4309'];
  assert.ok(oficina);
  const datos: Datos = {
    ...DATOS,
    observatori: {
      ...DATOS.observatori,
      cataluna: {
        ...DATOS.observatori.cataluna,
        cno4: {
          ...DATOS.observatori.cataluna.cno4,
          '4309': { ...oficina, personas_contratadas: 5 },
        },
      },
    },
    mercado: {
      ...DATOS.mercado,
      demandantes: {
        ...DATOS.mercado.demandantes,
        cno4: { ...DATOS.mercado.demandantes.cno4, '4309': { personas_12m: 10, variacion_exacta: null, ratio: null } },
      },
    },
  };
  const breve = construirInformeBreve(informe, datos);
  const html = renderizarInformeBreve(breve, informe);
  assert.doesNotMatch(html, /encontraron contrato/u);
  assert.match(html, /5 personas contratadas/u);
  assert.match(html, /10 demandantes no ocupados/u);
  assert.match(html, /Grupos distintos: no predice tus opciones de empleo/u);
  const distinto: Datos = {
    ...datos,
    mercado: {
      ...DATOS.mercado,
      demandantes: {
        ...DATOS.mercado.demandantes,
        periodo: '12 meses a mayo de 2026',
      },
    },
  };
  const htmlDistinto = renderizarInformeBreve(construirInformeBreve(informe, distinto), informe);
  assert.doesNotMatch(htmlDistinto, /class="ib-tarjeta-titulo">Contratación y demanda<\/h[1-6]>/u);
});

function datosMultigrupo(filas: readonly (readonly [string, number, number])[]): Datos {
  const datos = structuredClone(DATOS);
  assert.ok(datos.cataluna && datos.observatori && datos.mercado?.demandantes);
  for (const [cno, contratadas, demandantes] of filas) {
    const grupo: NonNullable<Datos['observatori']>['cataluna']['cno4'][string] | undefined =
      datos.observatori.cataluna.cno4[cno];
    assert.ok(grupo);
    grupo.personas_contratadas = contratadas;
    const contratacion: NonNullable<Datos['cataluna']>['contratacion_cno4'][string] | undefined =
      datos.cataluna.contratacion_cno4[cno];
    assert.ok(contratacion);
    contratacion.personas_contratadas = contratadas;
    datos.mercado.demandantes.cno4[cno] = { personas_12m: demandantes, variacion_exacta: null, ratio: null };
  }
  return datos;
}

test('los recuentos multigrupo conservan su procedencia y no afirman personas únicas', () => {
  const contratadas1411 = 215;
  const contratadas1419 = 90;
  const demandantes1411 = 400;
  const demandantes1419 = 100;
  const tareas = [
    {
      id: 't1',
      texto: 'Tarea oficial 1411-1',
      tiempo: 'algo' as const,
      referencia: { tareaOit: '1411-1', relacion: 'propia' as const },
    },
  ];
  const datos = datosMultigrupo([
    ['1411', contratadas1411, demandantes1411],
    ['1419', contratadas1419, demandantes1419],
  ]);
  const informe = construirInforme({ isco08: '1411', sinIa: true, fecha: '2026-10-21', tareas }, datos);
  const breve = construirInformeBreve(informe, datos);
  const comparacion = breve.mercado.comparacionContratacionDemanda;
  assert.ok(comparacion);
  assert.equal(breve.version, 2);
  assert.deepEqual(comparacion.gruposCno, ['1411', '1419']);
  assert.equal(comparacion.personasContratadas, contratadas1411 + contratadas1419);
  assert.equal(comparacion.personasDemandantes, demandantes1411 + demandantes1419);
  assert.equal(
    comparacion.contratadasPorDemandante,
    (contratadas1411 + contratadas1419) / (demandantes1411 + demandantes1419),
  );
  assert.deepEqual(breve.mercado.contratacion?.gruposCno.toSorted(), ['1411', '1419']);
  const html = renderizarInformeBreve(breve, informe);
  assert.match(html, /suma de los recuentos de personas contratadas en 2 grupos/u);
  assert.match(html, /Suma de recuentos de 2 grupos de ocupación/u);
  assert.doesNotMatch(html, /personas únicas|encontraron contrato/u);
});

test('los recuentos unigrupo conservan cifras y procedencia sin rótulo de suma', () => {
  const { informe, breve } = deOficina();
  assert.deepEqual(breve.mercado.comparacionContratacionDemanda?.gruposCno, ['4309']);
  assert.deepEqual(breve.mercado.contratacion?.gruposCno, ['4309']);
  assert.equal(breve.mercado.contratacion?.personas, CATALUNA.contratacion_cno4['4309'].personas_contratadas);
  const html = renderizarInformeBreve(breve, informe);
  assert.doesNotMatch(html, /[Ss]uma de (?:los )?recuentos/u);
  assert.ok(html.includes(`${numero(oficina.personas_contratadas)} personas contratadas`));
  assert.ok(html.includes(`${numero(demandaOficina.personas_12m)} demandantes no ocupados`));
});

for (const fecha of ['2030-10-21', '2030-10-22', '2030-10-23']) {
  test(`el calendario estadístico no acredita una publicación: ${fecha}`, () => {
    const { informe, breve } = deOficina();
    const senales = breve.senales.map((senal) =>
      senal.clave === 'empresas' ? { ...senal, proxima: '2030-10-22' } : senal,
    );
    const html = renderizarInformeBreve({ ...breve, fecha, senales }, informe, { incrustado: true });
    const fila = html.match(/<tr[^>]*><td>Uso de IA: empresas catalanas[\s\S]*?<\/tr>/u)?.[0] ?? '';
    assert.ok(fila, 'la señal permanece disponible con su periodo');
    assert.match(fila, /1T 2026/u);
    assert.doesNotMatch(fila, /Ya publicado|pendiente de incorporar|El INE publicó/u);
    // El mismo día sigue prevista; después no se da como próxima una fecha pasada.
    if (fecha > '2030-10-22') {
      assert.doesNotMatch(fila, /22 oct\. 2030/u);
      assert.match(fila, /Fecha por confirmar/u);
    } else {
      assert.match(fila, /22 oct\. 2030/u);
    }
    if (fecha === '2030-10-22') {
      assert.match(fila, /Fecha prevista:/u);
    }
  });
}
