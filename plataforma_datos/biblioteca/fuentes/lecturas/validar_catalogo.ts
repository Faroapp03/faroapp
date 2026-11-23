// Puente local: reutiliza los contratos de la Biblioteca; no construye web ni consulta enlaces.
import { readFileSync } from 'node:fs';
import { comprobarReferencias } from '../../../../herramientas/web/lecturas/referencias.ts';
import { comoRegistro } from '../../../../herramientas/web/lecturas/registro.ts';

const ARGUMENTOS_CON_ARCHIVO = 3;
const ruta = process.argv[2];
if (ruta === undefined || process.argv.length !== ARGUMENTOS_CON_ARCHIVO) {
  throw new Error('Uso: node validar_catalogo.ts <catalogo.json>');
}
const valor: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
const registro = comoRegistro(valor);
comprobarReferencias(registro);
const revisado = typeof valor === 'object' && valor !== null && 'revisado' in valor ? valor.revisado : null;
console.log(JSON.stringify({ lecturas: registro.lecturas.length, revisado }));
