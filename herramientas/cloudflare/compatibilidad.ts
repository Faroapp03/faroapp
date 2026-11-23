/** Las peticiones a proveedores atraviesan la ruta pública de Cloudflare, también dentro de la propia zona. */
export function usaFetchPublico(flags: unknown): boolean {
  return (
    Array.isArray(flags) &&
    flags.every((flag) => typeof flag === 'string' && /^[a-z][a-z0-9_]*$/.test(flag)) &&
    new Set(flags).size === flags.length &&
    flags.includes('global_fetch_strictly_public') &&
    !flags.includes('global_fetch_private_origin')
  );
}
