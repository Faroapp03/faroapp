// Entrada pública del motor de ocupaciones: lo único que puede importar el resto de la app (src/api, src/plataforma,
// herramientas y pruebas). Los archivos internos del motor se importan entre sí con rutas relativas; desde fuera, solo
// desde aquí. La tabla de atributos (recorrido/preguntas/atributos.json, 390 KB) no pasa por aquí: es un dato que solo
// carga el motor del dispositivo, y la API y el Worker, que importan esta entrada, no la necesitan. Ver
// motores/ocupaciones/README.md.

export { DENOMINACIONES_DE_DICCIONARIO } from './busqueda/denominaciones-de-diccionario.ts';
export type { BusquedaCompleta, Candidata } from './busqueda/ocupaciones.ts';
export {
  buscarConTodo,
  buscarEnElRelato,
  buscarOcupaciones,
  prepararBuscador,
  textoComoEnEsco,
} from './busqueda/ocupaciones.ts';
export { clasificadorDesdeContenedor } from './recorrido/fusion/clasificador-movil.ts';
export type { VectoresMovil } from './recorrido/fusion/vectores-movil.ts';
export { ARCHIVOS_DE_VECTORES, cargarDesdeContenedor, cargarVectores } from './recorrido/fusion/vectores-movil.ts';
export { avisoDeModeracion } from './recorrido/pantalla/moderacion.ts';
export {
  CLASIFICADOR_EN_LA_PANTALLA,
  estadoDeLaIa,
  usarClasificador,
  usarVectores,
  VECTORES_EN_LA_PANTALLA,
} from './recorrido/pantalla/previa-fusion.ts';
export {
  buscarAMano,
  enlazar,
  familias,
  gruposDeFamilia,
  pasoDePantalla,
  resultado,
} from './recorrido/pantalla/servicio.ts';
export { comprobarAtributos } from './recorrido/preguntas/atributos.ts';
export { MAX_RESPUESTAS_DEL_RECORRIDO } from './recorrido/preguntas/motor.ts';
export type { Atributos, Respuesta } from './recorrido/preguntas/tipos.ts';
