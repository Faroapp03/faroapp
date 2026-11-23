// La fecha del informe la pone el dispositivo: una anterior en dos o más días a la de los datos es un reloj atrasado y
// se rechaza con su problema propio; un día por detrás es posible en otra zona horaria y una posterior no se puede
// acreditar como errónea, y se aceptan.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/api/problemas.ts';
import { diaUtc, MS_POR_DIA } from '../../src/comun/tiempo.ts';
import { InvarianteRoto } from '../../src/dominio/errores.ts';
import { fechaDeLosDatos, primerDiaPosibleDelDispositivo } from '../../src/dominio/fecha-de-los-datos.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';
import { construirInformeConFormacion } from '../ayudas/informe-con-formacion.ts';
import { objeto } from '../ayudas/objeto-json.ts';

const SECRETO = 'secreto-sintetico-de-prueba-de-mas-de-treinta-y-dos-caracteres';
const CORRECTO = 200;
const SOLICITUD_INCORRECTA = 400;
const ERROR_INTERNO = 500;
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const ENTRADA: Entrada = {
  isco08: '7512',
  fecha: FECHA_DEL_INFORME,
  sinIa: true,
  tareas: [
    {
      id: 'uno',
      texto: 'Tarea oficial 7512-1',
      tiempo: 'algo',
      referencia: { tareaOit: '7512-1', relacion: 'propia' },
    },
  ],
};

function pedirInforme(api: ResponderApi, ruta: string, cuerpo: unknown) {
  return api(
    new Request(`https://dispositivo.test${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
      body: JSON.stringify(cuerpo),
    }),
  );
}
function crearLocal() {
  return crearApiLocal({ datos: DATOS, secretoFirma: SECRETO, motorDeCursos });
}
const datosConCopias = (copias: { soc?: string; consorci?: string; fundae?: string; citilab?: string }): Datos =>
  ({
    ...(copias.soc ? { formacion: { fecha_cursos: copias.soc } } : {}),
    ...(copias.consorci ? { consorci: { fecha_copia: copias.consorci } } : {}),
    ...(copias.fundae ? { fundae: { consulta: copias.fundae } } : {}),
    ...(copias.citilab ? { citilab: { copia: copias.citilab } } : {}),
  }) as unknown as Datos;

/** El día `dias` días antes (negativo) o después de `dia`. */
const desplazado = (dia: string, dias: number) => diaUtc(Date.parse(`${dia}T00:00:00Z`) + dias * MS_POR_DIA);
const DIAS_DE_UN_MES = 30;
const UN_DIA_ANTES = desplazado(FECHA_DEL_INFORME, -1);
const DOS_DIAS_ANTES = desplazado(FECHA_DEL_INFORME, -2);

test('la fecha de los datos es la de la copia de cursos más reciente y falta si el paquete no trae ninguna', () => {
  assert.equal(
    fechaDeLosDatos(
      datosConCopias({ soc: '2026-09-27', consorci: '2026-10-11', fundae: '2026-10-21', citilab: '2026-10-06' }),
    ),
    '2026-10-21',
  );
  assert.equal(fechaDeLosDatos(datosConCopias({ soc: '2026-09-27', citilab: '2026-10-06' })), '2026-10-06');
  assert.equal(fechaDeLosDatos(datosConCopias({ consorci: '2026-10-11' })), '2026-10-11');
  assert.equal(fechaDeLosDatos(datosConCopias({})), null);
});

test('una copia de cursos del paquete que no es un día real es un fallo explícito, no una comprobación saltada', () => {
  const malas = ['21/10/2026', '2026-10-21T00:00:00Z', '2026-02-30', '', null, Number.NaN];
  for (const mala of malas) {
    for (const fuente of ['formacion', 'consorci', 'fundae', 'citilab'] as const) {
      const clave = { formacion: 'fecha_cursos', consorci: 'fecha_copia', fundae: 'consulta', citilab: 'copia' }[
        fuente
      ];
      const datos = { ...datosConCopias({ soc: '2026-09-27' }), [fuente]: { [clave]: mala } } as unknown as Datos;
      assert.throws(() => fechaDeLosDatos(datos), InvarianteRoto, `${fuente} ${String(mala)}`);
      assert.throws(() => primerDiaPosibleDelDispositivo(datos), InvarianteRoto, `${fuente} ${String(mala)}`);
    }
  }
});

test('con una copia de cursos mal formada en el paquete, el informe responde un fallo interno y no se salta la comprobación', async (t) => {
  t.mock.method(console, 'error', () => {});
  const datos = { ...DATOS, consorci: { ...DATOS.consorci, fecha_copia: '21/10/2026' } } as Datos;
  const api = crearApiLocal({ datos, secretoFirma: SECRETO, motorDeCursos });
  const respuesta = await pedirInforme(await api, '/api/informe?formato=html', ENTRADA);
  assert.equal(respuesta.status, ERROR_INTERNO);
  assert.equal(objeto(await respuesta.json()).type, `${RAIZ_DE_LOS_PROBLEMAS}error_interno`);
});

for (const idioma of ['es', 'ca'] as const) {
  for (const ruta of ['/api/informe', '/api/informe?formato=html', '/api/informe?formato=breve&reloj=dispositivo']) {
    test(`${idioma} ${ruta}: una fecha dos o más días anterior a la de los datos se rechaza como reloj atrasado`, async () => {
      const api = await crearLocal();
      for (const fecha of [DOS_DIAS_ANTES, '2020-01-01']) {
        const respuesta = await pedirInforme(api, ruta, { ...ENTRADA, idioma, fecha });
        assert.equal(respuesta.status, SOLICITUD_INCORRECTA, fecha);
        const cuerpo = objeto(await respuesta.json());
        assert.equal(cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}reloj_atrasado`, fecha);
        assert.equal(cuerpo.informe, undefined);
        assert.equal(cuerpo.html, undefined);
      }
    });
  }
}

test('el informe breve sin `reloj=dispositivo` no contrasta la fecha: la de un resultado antiguo se abre', async () => {
  const api = await crearLocal();
  for (const fecha of [DOS_DIAS_ANTES, '2020-01-01']) {
    const respuesta = await pedirInforme(api, '/api/informe?formato=breve', { ...ENTRADA, fecha });
    assert.equal(respuesta.status, CORRECTO, `${fecha}: ${await respuesta.clone().text()}`);
    assert.ok(objeto(await respuesta.json()).html);
  }
});

test('`reloj` solo admite el valor dispositivo', async () => {
  const respuesta = await pedirInforme(await crearLocal(), '/api/informe?formato=breve&reloj=servidor', ENTRADA);
  assert.equal(respuesta.status, SOLICITUD_INCORRECTA);
  assert.equal(objeto(await respuesta.json()).type, `${RAIZ_DE_LOS_PROBLEMAS}solicitud_invalida`);
});

test('una fecha que no existe es una petición mal formada, no un reloj atrasado', async () => {
  const respuesta = await pedirInforme(await crearLocal(), '/api/informe', { ...ENTRADA, fecha: '2026-02-30' });
  assert.equal(respuesta.status, SOLICITUD_INCORRECTA);
  assert.equal(objeto(await respuesta.json()).type, `${RAIZ_DE_LOS_PROBLEMAS}solicitud_invalida`);
});

for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: con un día por detrás de los datos, con su fecha y con una posterior, el informe se calcula con esa fecha`, async () => {
    const api = await crearLocal();
    const fechas = [UN_DIA_ANTES, FECHA_DEL_INFORME, desplazado(FECHA_DEL_INFORME, 1), '2099-12-31'];
    for (const fecha of fechas) {
      const respuesta = await pedirInforme(api, '/api/informe?formato=html', { ...ENTRADA, idioma, fecha });
      assert.equal(respuesta.status, CORRECTO, `${fecha}: ${await respuesta.clone().text()}`);
      const esperado = construirInformeConFormacion({ ...ENTRADA, fecha }, DATOS, { idioma });
      assert.deepEqual(objeto(await respuesta.json()).informe, JSON.parse(JSON.stringify(esperado)), fecha);
    }
  });
}

test('la ruta contrasta con la copia más reciente de las cuatro fuentes, sea cual sea la que la tiene', async () => {
  const antigua = desplazado(FECHA_DEL_INFORME, -DIAS_DE_UN_MES);
  const copias = { formacion: 'fecha_cursos', consorci: 'fecha_copia', fundae: 'consulta', citilab: 'copia' } as const;
  for (const [fuente, campo] of Object.entries(copias)) {
    const todasAntiguas = {
      ...DATOS,
      formacion: { ...DATOS.formacion, fecha_cursos: antigua },
      consorci: { ...DATOS.consorci, fecha_copia: antigua },
      fundae: { ...DATOS.fundae, consulta: antigua },
      citilab: { ...DATOS.citilab, copia: antigua },
    };
    const datos = {
      ...todasAntiguas,
      [fuente]: { ...todasAntiguas[fuente as keyof typeof copias], [campo]: FECHA_DEL_INFORME },
    };
    const api = await crearApiLocal({ datos: datos as Datos, secretoFirma: SECRETO, motorDeCursos });
    const rechazada = await pedirInforme(api, '/api/informe?formato=html', { ...ENTRADA, fecha: DOS_DIAS_ANTES });
    assert.equal(rechazada.status, SOLICITUD_INCORRECTA, `la más reciente es ${fuente}`);
    const aceptada = await pedirInforme(api, '/api/informe?formato=html', { ...ENTRADA, fecha: UN_DIA_ANTES });
    assert.equal(aceptada.status, CORRECTO, `la más reciente es ${fuente}`);
  }
});

test('con el paquete real, la copia de cada fuente anterior en dos o más días a la más reciente no sirve de suelo', async () => {
  const api = await crearLocal();
  const copias = [
    DATOS.formacion?.fecha_cursos,
    DATOS.consorci?.fecha_copia,
    DATOS.fundae?.consulta,
    DATOS.citilab?.copia,
  ];
  for (const copia of copias.filter((dia): dia is string => dia !== undefined && dia < UN_DIA_ANTES)) {
    const respuesta = await pedirInforme(api, '/api/informe?formato=html', { ...ENTRADA, fecha: copia });
    assert.equal(respuesta.status, SOLICITUD_INCORRECTA, copia);
  }
});

test('el primer día posible del dispositivo es el anterior al de los datos, también al cambiar de mes y de año', () => {
  assert.equal(primerDiaPosibleDelDispositivo(datosConCopias({ fundae: '2026-10-21' })), '2026-10-20');
  assert.equal(primerDiaPosibleDelDispositivo(datosConCopias({ soc: '2026-11-01' })), '2026-10-31');
  assert.equal(primerDiaPosibleDelDispositivo(datosConCopias({ soc: '2027-01-01' })), '2026-12-31');
  assert.equal(primerDiaPosibleDelDispositivo(datosConCopias({})), null);
});

test('un dispositivo en Los Ángeles con el reloj bien en las primeras horas tras la copia no ve el error', async () => {
  // Poco después de la medianoche del día de la copia en España (con +02:00, horario de verano; en invierno sería la
  // 01:30): en Los Ángeles, 7 u 8 horas por detrás de UTC, todavía es el día anterior.
  const ahora = `${FECHA_DEL_INFORME}T00:30:00+02:00`;
  const formato = new URL('../../web/scripts/recorrido/formato.js', import.meta.url).href;
  const programa = [
    `import { fechaLocalDeHoy } from ${JSON.stringify(formato)};`,
    "import { mock } from 'node:test';",
    "mock.timers.enable({ apis: ['Date'], now: Date.parse(process.env.AHORA_DE_LA_PRUEBA) });",
    'console.log(fechaLocalDeHoy());',
  ].join('\n');
  const fechaLocal = execFileSync(process.execPath, ['--input-type=module', '-e', programa], {
    env: { ...process.env, TZ: 'America/Los_Angeles', AHORA_DE_LA_PRUEBA: ahora },
    encoding: 'utf8',
  }).trim();
  assert.equal(fechaLocal, UN_DIA_ANTES);
  const ruta = '/api/informe?formato=breve&reloj=dispositivo';
  const respuesta = await pedirInforme(await crearLocal(), ruta, { ...ENTRADA, fecha: fechaLocal });
  assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
});
