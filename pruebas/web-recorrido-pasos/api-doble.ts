type Api = typeof import('../../web/scripts/recorrido/api.js');
let respuestas: Partial<Api> = {};

export function configurarApi(implementacion: Partial<Api>) {
  respuestas = implementacion;
}

export const fichaDeGrupo: Api['fichaDeGrupo'] = (...args) => {
  if (!respuestas.fichaDeGrupo) {
    throw new Error('La prueba debe definir fichaDeGrupo');
  }
  return respuestas.fichaDeGrupo(...args);
};
export const gruposHijos: Api['gruposHijos'] = (...args) => {
  if (!respuestas.gruposHijos) {
    throw new Error('La prueba debe definir gruposHijos');
  }
  return respuestas.gruposHijos(...args);
};
