import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarHechosDelInforme, comprobarRegistroHechos } from '../../herramientas/web/comprobar-hechos-informe.ts';
import { MS_POR_DIA } from '../../src/comun/tiempo.ts';
import {
  CAPACIDAD_DE_LA_IA,
  HECHOS_DEL_INFORME,
  NORMAS_DE_ALTO_RIESGO,
  OFERTAS_QUE_MENCIONAN_IA,
  PROXIMA_TICH,
} from '../../src/dominio/hechos-del-informe-breve.ts';
import { leerHechosDelInforme } from '../../src/dominio/registro-hechos-del-informe.ts';

const HOY = '2026-11-15';
const CAPACIDAD_PUBLICADA = 20.6;
const HORAS_PUBLICADAS = 1.6;
const ANIO_REFERENCIA = 2026;
const ANUNCIOS_PUBLICADOS = 13;
const FLUJOS_DEL_ENSAYO = 108;
const PRESUPUESTO_DEL_ENSAYO = 500;
const FUERA_DE_PORCENTAJE = 101;
test('las cuatro afirmaciones mantienen valores y su significado propio', () => {
  assert.deepEqual(
    [CAPACIDAD_DE_LA_IA.pct, CAPACIDAD_DE_LA_IA.horasPersona, CAPACIDAD_DE_LA_IA.anio],
    [CAPACIDAD_PUBLICADA, HORAS_PUBLICADAS, ANIO_REFERENCIA],
  );
  assert.deepEqual(
    [OFERTAS_QUE_MENCIONAN_IA.deCada100, OFERTAS_QUE_MENCIONAN_IA.anio],
    [ANUNCIOS_PUBLICADOS, ANIO_REFERENCIA],
  );
  assert.equal(PROXIMA_TICH, '2026-11-11');
  assert.equal(NORMAS_DE_ALTO_RIESGO.aplicacion, '2027-12-02');
  const { capacidad, ofertas_ia, proxima_tich, normas } = HECHOS_DEL_INFORME.afirmaciones;
  assert.equal(capacidad.flujos_del_benchmark, FLUJOS_DEL_ENSAYO);
  assert.equal(capacidad.presupuesto_pasos, PRESUPUESTO_DEL_ENSAYO);
  assert.equal(ofertas_ia.poblacion, 'Anuncios de empleo de Indeed en España');
  assert.equal(ofertas_ia.fecha_corte, null);
  assert.equal(proxima_tich.tipo, 'prevision-de-publicacion');
  assert.equal(normas.tipo, 'aplicacion-normativa');
});

test('la previsión no puede hacerse pasar por aplicación normativa ni se acepta un hecho sin consumidor', () => {
  const alterado = structuredClone(HECHOS_DEL_INFORME);
  const incorrecto = {
    ...alterado,
    afirmaciones: { ...alterado.afirmaciones, normas: alterado.afirmaciones.proxima_tich },
  };
  assert.throws(() => leerHechosDelInforme(incorrecto), /contrato editorial/u);
  assert.throws(
    () => leerHechosDelInforme({ ...alterado, afirmaciones: { ...alterado.afirmaciones, extra: {} } }),
    /contrato editorial/u,
  );
});

test('no se usa una cifra sin medida, población, procedencia completa y huella', () => {
  for (const campo of ['medida', 'poblacion', 'fuente'] as const) {
    const copia = structuredClone(HECHOS_DEL_INFORME);
    const { [campo]: _retirado, ...sinCampo } = copia.afirmaciones.capacidad;
    assert.throws(
      () => leerHechosDelInforme({ ...copia, afirmaciones: { ...copia.afirmaciones, capacidad: sinCampo } }),
      /contrato editorial/u,
    );
  }
  const copia = structuredClone(HECHOS_DEL_INFORME);
  copia.afirmaciones.capacidad.fuente.captura_sha256 = 'sin evidencia';
  assert.throws(() => leerHechosDelInforme(copia), /contrato editorial/u);
  const conCampoAjeno = { ...HECHOS_DEL_INFORME, rutaPrivada: '/privado/no-publicar' };
  assert.throws(() => leerHechosDelInforme(conCampoAjeno), /contrato editorial/u);
});

test('rechaza magnitudes inválidas sin sustituirlas por otra cifra', () => {
  for (const porcentaje of [-1, FUERA_DE_PORCENTAJE, Number.NaN, Number.POSITIVE_INFINITY]) {
    const copia = structuredClone(HECHOS_DEL_INFORME);
    copia.afirmaciones.capacidad.porcentaje = porcentaje;
    assert.throws(() => leerHechosDelInforme(copia), /contrato editorial/u);
  }
});

test('fechas imposibles o procedencia posterior a revisión impiden construir el registro', () => {
  const copia = structuredClone(HECHOS_DEL_INFORME);
  copia.afirmaciones.proxima_tich.fecha = '2026-02-30';
  assert.throws(() => leerHechosDelInforme(copia), /contrato editorial/u);
  copia.afirmaciones.proxima_tich.fecha = PROXIMA_TICH;
  copia.afirmaciones.capacidad.fuente.revisado_captura = '2026-11-16';
  assert.throws(() => leerHechosDelInforme(copia), /cronología/u);
});

test('el plazo editorial no se renueva al validar ni se confunde con la fecha de publicación prevista', () => {
  const antes = JSON.stringify(HECHOS_DEL_INFORME);
  const primero = comprobarHechosDelInforme(HECHOS_DEL_INFORME, HOY);
  const ultimoDia = comprobarHechosDelInforme(HECHOS_DEL_INFORME, '2026-11-22');
  assert.equal(primero.vence, '2026-11-22');
  assert.equal(primero.revision_pendiente, false);
  assert.deepEqual(ultimoDia, primero);
  assert.equal(comprobarHechosDelInforme(HECHOS_DEL_INFORME, '2026-11-23').revision_pendiente, true);
  assert.equal(JSON.stringify(HECHOS_DEL_INFORME), antes);
  assert.throws(() => comprobarHechosDelInforme(HECHOS_DEL_INFORME, '2026-11-14'), /anterior/u);
});

test('el vencimiento editorial avisa sin invalidar cifras de su periodo ni bloquear la construcción', () => {
  const antes = JSON.stringify(HECHOS_DEL_INFORME);
  const caducado = new Date(
    Date.parse(`${HECHOS_DEL_INFORME.revision.fecha}T00:00:00Z`) +
      (HECHOS_DEL_INFORME.revision.plazo_dias + 1) * MS_POR_DIA,
  )
    .toISOString()
    .slice(0, 10);
  const resultado = comprobarRegistroHechos(undefined, caducado);
  assert.equal(resultado.revision_pendiente, true);
  assert.equal(JSON.stringify(HECHOS_DEL_INFORME), antes);
});

test('revisar una captura no inventa una consulta remota ni rejuvenece su fecha', () => {
  const fuente = HECHOS_DEL_INFORME.afirmaciones.proxima_tich.fuente;
  assert.equal(fuente.capturado, '2026-11-15');
  assert.equal(fuente.revisado_captura, '2026-11-15');
  assert.equal(fuente.captura_sha256, '72a55e4163500bb031af39b09837590da9537b70d3849fc4602a2b569297ca5b');
  assert.match(fuente.localizador, /sin fecha para la TIC-H del año 2027/u);
  assert.equal(HECHOS_DEL_INFORME.afirmaciones.normas.fuente.capturado, '2026-11-14');
  const alterado = structuredClone(HECHOS_DEL_INFORME);
  alterado.afirmaciones.proxima_tich.fuente.capturado = '2026-11-16';
  assert.throws(() => leerHechosDelInforme(alterado), /cronología/u);
});

test('la TIC-H publicada según el calendario exige una captura posterior a su fecha; otro estado no se admite', () => {
  const { proxima_tich } = HECHOS_DEL_INFORME.afirmaciones;
  assert.equal(proxima_tich.estado, 'publicada-segun-calendario');
  assert.match(proxima_tich.fuente.localizador, /DTSTAMP 20261113T103836Z/u);
  for (const cambio of [
    (copia: typeof HECHOS_DEL_INFORME) => {
      copia.afirmaciones.proxima_tich.fuente.capturado = null;
    },
    (copia: typeof HECHOS_DEL_INFORME) => {
      copia.afirmaciones.proxima_tich.fecha = '2026-11-16';
    },
    // Una captura del mismo día puede ser anterior a la hora de publicación.
    (copia: typeof HECHOS_DEL_INFORME) => {
      copia.afirmaciones.proxima_tich.fecha = '2026-11-15';
    },
  ]) {
    const copia = structuredClone(HECHOS_DEL_INFORME);
    cambio(copia);
    assert.throws(() => leerHechosDelInforme(copia), /captura de un día posterior/u);
  }
  const sinAnio = structuredClone(HECHOS_DEL_INFORME);
  sinAnio.afirmaciones.proxima_tich.periodo = '2026';
  assert.throws(() => leerHechosDelInforme(sinAnio), /Año AAAA/u);
  const prevista = structuredClone(HECHOS_DEL_INFORME);
  prevista.afirmaciones.proxima_tich.estado = 'prevista-no-confirmada';
  prevista.afirmaciones.proxima_tich.fecha = '2026-11-16';
  assert.doesNotThrow(() => leerHechosDelInforme(prevista));
  const otro = structuredClone(HECHOS_DEL_INFORME) as unknown as { afirmaciones: { proxima_tich: { estado: string } } };
  otro.afirmaciones.proxima_tich.estado = 'confirmada';
  assert.throws(() => leerHechosDelInforme(otro), /contrato editorial/u);
});

test('las cuatro afirmaciones llevan la revisión del 15/11/2026 con sus capturas', () => {
  const { capacidad, ofertas_ia, proxima_tich, normas } = HECHOS_DEL_INFORME.afirmaciones;
  assert.deepEqual(
    [capacidad, ofertas_ia, proxima_tich, normas].map(({ fuente }) => [fuente.revisado_captura, fuente.capturado]),
    [
      ['2026-11-15', '2026-11-15'],
      ['2026-11-15', '2026-11-15'],
      ['2026-11-15', '2026-11-15'],
      ['2026-11-15', '2026-11-14'],
    ],
  );
  assert.equal(ofertas_ia.fuente.captura_sha256, '6b69798d00118d8d3fa7964724d52e3ef254c923a66ccb51093638da1a04f7ee');
  assert.match(ofertas_ia.fuente.localizador, /Spain \(13%\)/u);
  assert.equal(capacidad.fuente.captura_sha256, 'a1e4d52bbf3a5fae8e3153835adcfd5f314efc45bbc8e9e73b19bcbf20d3fefc');
  assert.equal(normas.fuente.captura_sha256, '8d6d9825b8131aff76a6a062d210e354b2b985b154390e3b8712e7299ffd4641');
});

test('una captura conocida no puede preceder a la publicación de la versión citada', () => {
  const alterado = structuredClone(HECHOS_DEL_INFORME);
  alterado.afirmaciones.capacidad.fuente.capturado = '2026-01-01';
  assert.throws(() => leerHechosDelInforme(alterado), /cronología/u);
  alterado.afirmaciones.capacidad.fuente.capturado = null;
  assert.doesNotThrow(() => leerHechosDelInforme(alterado));
});
