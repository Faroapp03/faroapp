/** APT solo admite configurar la UA; no se le atribuye soporte de las tres pistas. */
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

export function configuracionApt(): string {
  return `${['http', 'https']
    .map((protocolo) => `Acquire::${protocolo}::User-Agent "${IDENTIDAD_WEB['User-Agent']}";`)
    .join('\n')}\n`;
}
if (import.meta.main) {
  process.stdout.write(configuracionApt());
}
