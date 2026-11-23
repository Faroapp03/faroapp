// Cada fila conserva su fuente, fecha, conjunto y grupo; la ausencia no se confunde con cero.

import assert from 'node:assert/strict';
import test from 'node:test';
import { frenteAlConjunto } from '../../src/dominio/frente-al-conjunto.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { datosParaContexto, grupoParaComparar } from '../fixtures/datos-contexto.ts';

test('compara mujeres del censo anual y edad histórica conservando cero y omitiendo la cifra nula', () => {
  const datos = datosParaContexto();
  const frente = frenteAlConjunto(datos, grupoParaComparar(), crearLengua(datos));
  assert.deepEqual(frente?.bloques.find(({ pregunta }) => pregunta === 'quien')?.filas, [
    { dato: 'mujeres', cuando: { anio: '2024' }, grupo: 41, conjunto: 51 },
    { dato: 'menores30', cuando: { anio: '2021' }, grupo: 0, conjunto: 20 },
  ]);
});

test('las mujeres del INE se comparan con el conjunto del censo histórico', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  assert.ok(grupo.ocupados[0]);
  grupo.ocupados[0].organismo = 'INE';
  grupo.ocupados[0].anio = '2021';
  const frente = frenteAlConjunto(datos, grupo, crearLengua(datos));
  assert.deepEqual(frente?.bloques.find(({ pregunta }) => pregunta === 'quien')?.filas[0], {
    dato: 'mujeres',
    cuando: { anio: '2021' },
    grupo: 41,
    conjunto: 50,
  });
});

test('los bloques y sus filas conservan el orden de presentación y las variaciones negativas o cero', () => {
  const datos = datosParaContexto();
  const frente = frenteAlConjunto(datos, grupoParaComparar(), crearLengua(datos));
  assert.ok(frente);
  assert.deepEqual(
    frente.bloques.map(({ pregunta }) => pregunta),
    ['quien', 'estudios', 'contrato', 'crece'],
  );
  assert.deepEqual(
    frente.bloques.find(({ pregunta }) => pregunta === 'estudios')?.filas.map(({ dato }) => dato),
    ['obligatoria', 'bachillerato', 'fpGradoMedio', 'fpGradoSuperior', 'universitarios'],
  );
  assert.deepEqual(frente.bloques.find(({ pregunta }) => pregunta === 'crece')?.filas, [
    { dato: 'ocupadosCrece', cuando: { desde: '2023', hasta: '2024' }, grupo: -1, conjunto: 0 },
    {
      dato: 'contratadasCrece',
      cuando: { periodo: 'Periodo castellano' },
      grupo: 0,
      conjunto: 0,
      otroGrupo: 'Ocupación primaria',
    },
  ]);
});

test('una cifra de otro grupo conserva el nombre del dueño en cada fila afectada', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  assert.ok(grupo.perfil[0]);
  grupo.perfil[0].cno11 = '21';
  const frente = frenteAlConjunto(datos, grupo, crearLengua(datos));
  assert.deepEqual(
    frente?.bloques
      .flatMap(({ filas }) => filas)
      .filter(({ otroGrupo }) => otroGrupo !== undefined)
      .map(({ dato, otroGrupo }) => ({ dato, otroGrupo })),
    [
      { dato: 'mujeres', otroGrupo: 'Primer grupo' },
      { dato: 'menores30', otroGrupo: 'Primer grupo' },
      { dato: 'indefinidosFirmados', otroGrupo: 'Ocupación primaria' },
      { dato: 'ocupadosCrece', otroGrupo: 'Primer grupo' },
      { dato: 'contratadasCrece', otroGrupo: 'Ocupación primaria' },
    ],
  );
});

test('sin un perfil único o sin el censo conjunto no elige a quién comparar', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const lengua = crearLengua(datos);
  assert.equal(frenteAlConjunto(datos, { ...grupo, perfil: [] }, lengua), null);
  assert.equal(frenteAlConjunto(datos, { ...grupo, perfil: [...grupo.perfil, ...grupo.perfil] }, lengua), null);
  delete datos.censo;
  assert.equal(frenteAlConjunto(datos, grupo, lengua), null);
});

test('sin ocupados ni contratación conserva los bloques de estudios y situación', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  grupo.ocupados = [];
  grupo.contratacion = [];
  const frente = frenteAlConjunto(datos, grupo, crearLengua(datos));
  assert.deepEqual(
    frente?.bloques.map(({ pregunta }) => pregunta),
    ['estudios', 'contrato'],
  );
  assert.deepEqual(
    frente?.bloques.find(({ pregunta }) => pregunta === 'contrato')?.filas.map(({ dato }) => dato),
    ['indefinido', 'cuentaPropia'],
  );
});

test('varios grupos de contratación omiten sus comparaciones y conservan las del censo', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  grupo.contratacion = [...grupo.contratacion, ...grupo.contratacion];
  const frente = frenteAlConjunto(datos, grupo, crearLengua(datos));
  assert.deepEqual(
    frente?.bloques.find(({ pregunta }) => pregunta === 'contrato')?.filas.map(({ dato }) => dato),
    ['indefinido', 'cuentaPropia'],
  );
  assert.deepEqual(
    frente?.bloques.find(({ pregunta }) => pregunta === 'crece')?.filas.map(({ dato }) => dato),
    ['ocupadosCrece'],
  );
});

test('sin Observatori la contratación conserva el periodo original y lo registra en catalán', () => {
  const datos = datosParaContexto();
  delete datos.observatori;
  const lengua = crearLengua(datos, 'ca');
  const frente = frenteAlConjunto(datos, grupoParaComparar(), lengua);
  assert.deepEqual(
    frente?.bloques.find(({ pregunta }) => pregunta === 'crece')?.filas.find(({ dato }) => dato === 'contratadasCrece')
      ?.cuando,
    { periodo: 'Periodo general' },
  );
  assert.deepEqual(lengua.sinTraducir(), [{ texto: 'Periodo general', idioma: 'es' }]);
});

test('las lecturas no cambian los datos ni las listas del grupo', () => {
  const datos = datosParaContexto();
  const grupo = grupoParaComparar();
  const antes = structuredClone({ datos, grupo });
  frenteAlConjunto(datos, grupo, crearLengua(datos));
  assert.deepEqual({ datos, grupo }, antes);
});
