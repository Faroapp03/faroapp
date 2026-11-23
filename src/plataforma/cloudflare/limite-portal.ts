/** Separa la cuota del portal de cualquier otro uso de la misma autoridad; no conserva la IP. */
import type { IdentificadoresLimite } from '../acceso-publico/limite-continuo-sqlite.ts';
import { identificadoresLimiteRecorrido } from './limite-recorrido.ts';

const HEXADECIMAL = 16;

/** Aísla el propósito portal en todas las huellas del recorrido, también en las que solo se leen. */
export async function identificadoresLimitePortal(
  peticion: Request,
  secreto: string,
  ahora: number,
): Promise<IdentificadoresLimite> {
  const ids = await identificadoresLimiteRecorrido(peticion, secreto, ahora);
  const encoder = new TextEncoder();
  const firma = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const transformar = async (base: string) => {
    const resultado = await crypto.subtle.sign('HMAC', firma, encoder.encode(`faro/acceso-portal/v1:${base}`));
    return Array.from(new Uint8Array(resultado), (byte) => byte.toString(HEXADECIMAL).padStart(2, '0')).join('');
  };
  return {
    clave: await transformar(ids.clave),
    recientes: await Promise.all(ids.recientes.map(transformar)),
    anteriores: await Promise.all(ids.anteriores.map(transformar)),
    ...(ids.prefijo
      ? {
          prefijo: {
            clave: await transformar(ids.prefijo.clave),
            recientes: await Promise.all(ids.prefijo.recientes.map(transformar)),
          },
        }
      : {}),
  };
}
