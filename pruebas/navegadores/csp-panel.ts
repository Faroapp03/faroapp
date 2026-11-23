/** Firma reproducida del estilo interno de SELECT en WebKit; ninguna otra violación queda admitida. */
export interface EntornoObservacion {
  motor: 'chromium' | 'firefox' | 'webkit';
  contexto: 'panel' | 'recorrido';
  origen: string;
}
export interface EventoCsp {
  directiva: string;
  recurso: string;
  muestra: string;
  documento: string;
  elemento: string | null;
  estilo: string | null;
  fuente: string;
  linea: number;
  columna: number;
  confiable: boolean;
}

export function esAvisoSelectWebKit(evento: unknown, entorno: EntornoObservacion): evento is EventoCsp {
  if (entorno.motor !== 'webkit' || entorno.contexto !== 'panel' || !evento || typeof evento !== 'object') {
    return false;
  }
  const aviso = evento as Partial<EventoCsp>;
  return (
    (aviso.documento === `${entorno.origen}/administracion` ||
      aviso.documento === `${entorno.origen}/administracion/`) &&
    aviso.directiva === 'style-src-attr' &&
    aviso.recurso === 'inline' &&
    aviso.muestra === 'text-overflow:inherit' &&
    aviso.elemento === 'SELECT' &&
    aviso.estilo === null &&
    typeof aviso.linea === 'number' &&
    Number.isSafeInteger(aviso.linea) &&
    aviso.linea > 0 &&
    ((aviso.fuente === '' && aviso.columna === 1) ||
      (aviso.fuente === `${entorno.origen}/administracion/vista-datos.js` &&
        typeof aviso.columna === 'number' &&
        Number.isSafeInteger(aviso.columna) &&
        aviso.columna > 0)) &&
    aviso.confiable === true
  );
}
