// Un escenario del presupuesto de rendimiento medido, comprobado y anotado (presupuesto-rendimiento.mjs): dentro del
// límite total de su condición (presupuesto-plazo.mjs), con lo medido anotado tras cada hito y, si la medida no vale
// o el ensayo no puede medir, con el fallo añadido a lo medido, sin perderlo. Cada medida dice qué lo sirvió
// (`servidoPor`): el destino, la ruta y la huella del Worker y la del artefacto.json de la construcción a la que
// pertenece, y si está comprobado; la portada y el acceso, solo el Worker oficial del artefacto medido, y el resto, el
// Worker privado de su construcción, los dos comprobados (presupuesto-servidor.mjs). Lo que solo se declaró (un fallo
// antes de comprobarlo) consta con `comprobado: false`.
import assert from 'node:assert/strict';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { crearFixture } from './fixture.ts';
import { bytesPorSegundo, CONDICIONES } from './presupuesto-condiciones.mjs';
import { medir } from './presupuesto-medida.mjs';
import { crearPlazoTotal, ESTADO } from './presupuesto-plazo.mjs';
import { comprobarWorkerPrivado, RUTAS_DEL_OFICIAL, servidorOficialDe } from './presupuesto-servidor.mjs';

/** El Worker que sirve un escenario: su destino, su ruta y su huella y la del artefacto.json de su construcción. */
function workerQueSirve(worker, destino) {
  return {
    destino,
    worker: worker ? { ruta: worker.ruta, sha256: worker.sha256 } : null,
    artefacto: worker ? { carpeta: worker.carpeta, sha256: worker.sha256Artefacto } : null,
  };
}

/**
 * Lo que sirve el escenario según la construcción (servible()), declarado y sin comprobar: la portada y el acceso, el
 * Worker oficial del artefacto medido; el resto, el Worker privado con la web de la construcción medida.
 */
export function procedenciaDe(construccion, escenario) {
  if (escenario.oficial) {
    return { ...workerQueSirve(construccion?.oficial, 'oficial'), comprobado: false };
  }
  const web = construccion?.artefacto?.directorio;
  return { ...workerQueSirve(construccion?.privado, 'privado'), web: web ? { carpeta: web } : null, comprobado: false };
}

/**
 * En la portada y el acceso, lo que llegó al navegador es lo que responde el Worker oficial comprobado: cada respuesta
 * 200 a una de sus rutas lleva la huella que dio el Worker del artefacto medido al comprobarlo.
 */
function comprobarLoServido(medida) {
  const { respuestas } = medida.servidoPor ?? {};
  assert.ok(respuestas, 'La portada y el acceso los sirve el Worker oficial comprobado del artefacto medido');
  const cotejadas = (medida.peticiones ?? []).filter(
    (p) => RUTAS_DEL_OFICIAL.includes(p.ruta) && p.metodo === 'GET' && p.estado === ESTADO_HTTP.correcto,
  );
  assert.ok(cotejadas.length > 0, 'El navegador ha recibido la portada o el acceso del Worker oficial');
  for (const peticion of cotejadas) {
    assert.equal(
      peticion.huella,
      respuestas[peticion.ruta].sha256,
      `${peticion.ruta}: lo servido es del Worker oficial`,
    );
  }
}

/**
 * Lo que el ensayo exige para que la medición valga (`medida`, con lo que la sirvió); el resto se anota sin fallar.
 */
export function comprobarMedida(medida, nombreCondicion, escenario = {}) {
  if (escenario.oficial) {
    comprobarLoServido(medida);
  }
  assert.deepEqual(medida.errores, [], 'El servidor del ensayo y el de arriba no han fallado');
  assert.equal(medida.servidor.sinIdentidadEsperada, 0, 'El navegador llega siempre con la identidad de la condición');
  assert.equal(medida.estadoNavegacion, ESTADO_HTTP.correcto, 'La página responde');
  if (!CONDICIONES[nombreCondicion].bajada) {
    const { interfaz, analisis } = medida.hitos;
    assert.ok(interfaz.alcanzado, `Sin red limitada la interfaz llega a estar usable: ${interfaz.error ?? ''}`);
    assert.ok(analisis?.alcanzado ?? true, `Sin red limitada el primer análisis llega: ${analisis?.error ?? ''}`);
  }
  assert.equal(medida.servidoPor?.comprobado, true, 'Lo que sirvió el escenario está comprobado, no solo declarado');
}

/**
 * Un escenario medido y anotado. `anotar` recibe lo medido tras cada hito y al final. Si la medida no vale o el ensayo
 * no puede medirlo, se anota lo medido (o lo último anotado) con `estado: fallo del arnés`, el estado que tenía al
 * medirlo y el `fallo`, y la prueba falla. `piezas` sustituye a medir() y al plazo en las pruebas sin navegador.
 */
export async function escenarioMedido(
  { sesion, motor, servible: construccion, nombreCondicion },
  escenario,
  anotar,
  { medirCon = medir, plazoTotal = crearPlazoTotal(CONDICIONES[nombreCondicion].limiteTotalMs) } = {},
) {
  const condicion = CONDICIONES[nombreCondicion];
  let servidoPor = procedenciaDe(construccion, escenario);
  let ultima = null;
  const anotarUltima = (medida) => {
    ultima = { ...medida, servidoPor: medida.servidoPor ?? servidoPor };
    anotar(ultima);
  };
  try {
    // El Worker privado se comprueba antes de medir; el oficial, al crear su servidor (servidorOficialDe).
    if (!escenario.oficial) {
      servidoPor = comprobarWorkerPrivado(construccion);
    }
    const medida = await medirCon({
      sesion,
      motor,
      escenario,
      condicion: { ...condicion, nombre: nombreCondicion, bytesPorSegundo: bytesPorSegundo(condicion) },
      arriba: async () =>
        escenario.oficial
          ? servidorOficialDe(construccion)
          : Object.assign(await crearFixture(construccion.artefacto, { modoRecorrido: escenario.modoRecorrido }), {
              procedencia: servidoPor,
            }),
      plazoTotal,
      alAvanzar: anotarUltima,
    });
    anotarUltima(medida);
    comprobarMedida(ultima, nombreCondicion, escenario);
  } catch (error) {
    const fallo = String(error).split('\n')[0];
    anotar({ ...(ultima ?? { servidoPor }), estado: ESTADO.fallo, estadoAlMedir: ultima?.estado ?? null, fallo });
    throw error;
  } finally {
    plazoTotal.detener();
  }
}
