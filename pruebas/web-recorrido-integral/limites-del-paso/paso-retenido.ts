// El paso 4 que recibe recorrido.js. Su evaluación espera a la promesa que suelta la prueba: mientras tanto, la
// importación sigue pendiente igual que en una red lenta. Cada entrada solo apunta que la han llamado.
import { prueba } from './dobles.ts';

prueba.iniciarImportacion();
await prueba.entradaLista;
export function verMiInforme() {
  prueba.paso4.push('ver');
}
export function abrirResultadoRecibido(codigo: string) {
  prueba.paso4.push(codigo);
}
export function olvidarInforme() {
  prueba.paso4.push('olvidar');
}
