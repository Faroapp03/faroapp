import type { IdentificadoresLimite } from '../acceso-publico/limite-continuo-sqlite.ts';
import { huellaEstableV2, huellasPorPeriodo } from './limite-recorrido.ts';

const HEXADECIMAL = 16;

async function deProposito(secreto: string, base: string): Promise<string> {
  const encoder = new TextEncoder();
  const firma = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const resultado = await crypto.subtle.sign('HMAC', firma, encoder.encode(`faro/acceso-pruebas/v1:${base}`));
  return Array.from(new Uint8Array(resultado), (n) => n.toString(HEXADECIMAL).padStart(2, '0')).join('');
}

/**
 * Huellas de propósito exclusivo sin persistir la IP ni la clave de acceso. Las que se escriben salen de la clave del
 * límite, que no conocen los probadores. La estable de la versión 2 se calculaba con la contraseña compartida: solo se
 * lee, para contar las filas que dejó la versión anterior mientras no caduquen.
 */
export async function identificadoresLimitePrivado(
  peticion: Request,
  secretoLimite: string,
  claveCompartida: string,
  ahora = Date.now(),
): Promise<IdentificadoresLimite> {
  const { actual, vecinas } = await huellasPorPeriodo(peticion, secretoLimite, ahora);
  const prefijo = await huellasPorPeriodo(peticion, secretoLimite, ahora, 'prefijo');
  const estable = await deProposito(claveCompartida, await huellaEstableV2(peticion, claveCompartida));
  const cercanas = await Promise.all(vecinas.map((huella) => deProposito(secretoLimite, huella)));
  return {
    clave: await deProposito(secretoLimite, actual),
    recientes: [...cercanas, estable],
    anteriores: [],
    prefijo: {
      clave: await deProposito(secretoLimite, prefijo.actual),
      recientes: await Promise.all(prefijo.vecinas.map((huella) => deProposito(secretoLimite, huella))),
    },
  };
}
