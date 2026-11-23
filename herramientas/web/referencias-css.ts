/** Referencias de CSS: distingue comentarios, cadenas decorativas e importaciones y funciones de recursos. */
const REEMPLAZO = 0xfffd;
const MAX_UNICODE = 0x10ffff;
function caracterEscapado(css: string, inicio: number): { valor: string; fin: number } {
  const hex = /^[\da-f]{1,6}\s?/i.exec(css.slice(inicio + 1))?.[0];
  if (!hex) {
    return { valor: css[inicio + 1] ?? '', fin: inicio + 2 };
  }
  const codigo = Number.parseInt(hex.trim(), 16);
  return {
    valor: String.fromCodePoint(codigo > 0 && codigo <= MAX_UNICODE ? codigo : REEMPLAZO),
    fin: inicio + hex.length + 1,
  };
}
function cadena(css: string, inicio: number): { valor: string; fin: number } {
  const comilla = css[inicio];
  let valor = '';
  let indice = inicio + 1;
  while (indice < css.length && css[indice] !== comilla) {
    const caracter = css[indice] ?? '';
    if (caracter !== '\\' || indice + 1 >= css.length) {
      valor += caracter;
      indice += 1;
      continue;
    }
    const escapado = caracterEscapado(css, indice);
    valor += escapado.valor;
    indice = escapado.fin;
  }
  return { valor, fin: Math.min(indice + 1, css.length) };
}

class LectorCss {
  private indice = 0;
  private readonly referencias: string[] = [];
  private readonly funciones: string[] = [];
  private readonly css: string;
  constructor(css: string) {
    this.css = css;
  }

  leer(): string[] {
    while (this.indice < this.css.length) {
      this.paso();
    }
    return this.referencias;
  }
  private paso(): void {
    if (this.comentario() || this.importacion() || this.funcion()) {
      return;
    }
    const caracter = this.css[this.indice] ?? '';
    if (caracter === '"' || caracter === "'") {
      const leida = cadena(this.css, this.indice);
      if (['image-set', '-webkit-image-set'].includes(this.funciones.at(-1) ?? '')) {
        this.referencias.push(leida.valor);
      }
      this.indice = leida.fin;
      return;
    }
    if (caracter === '(') {
      this.funciones.push('');
    }
    if (caracter === ')') {
      this.funciones.pop();
    }
    this.indice += 1;
  }
  private comentario(): boolean {
    if (!this.css.startsWith('/*', this.indice)) {
      return false;
    }
    const fin = this.css.indexOf('*/', this.indice + 2);
    this.indice = fin < 0 ? this.css.length : fin + 2;
    return true;
  }
  private importacion(): boolean {
    const importacion = /^@import(?:\s|\/\*[\s\S]*?\*\/)*(["'])/i.exec(this.css.slice(this.indice));
    if (!importacion) {
      return false;
    }
    const leida = cadena(this.css, this.indice + importacion[0].length - 1);
    this.referencias.push(leida.valor);
    this.indice = leida.fin;
    return true;
  }
  private funcion(): boolean {
    const funcion = /^([a-z_-][\w-]*)\s*\(/i.exec(this.css.slice(this.indice));
    if (!funcion) {
      return false;
    }
    const nombre = (funcion[1] ?? '').toLowerCase();
    this.indice += funcion[0].length;
    if (nombre === 'url') {
      this.url();
    } else {
      this.funciones.push(nombre);
    }
    return true;
  }
  private urlSinComillas(): string {
    let valor = '';
    while (this.indice < this.css.length && this.css[this.indice] !== ')') {
      const actual = this.css[this.indice] ?? '';
      if (actual === '\\' && this.indice + 1 < this.css.length) {
        const escapado = caracterEscapado(this.css, this.indice);
        valor += escapado.valor;
        this.indice = escapado.fin;
      } else {
        valor += actual;
        this.indice += 1;
      }
    }
    return valor.trim();
  }
  private url(): void {
    while (this.indice < this.css.length && /\s/.test(this.css[this.indice] ?? '')) {
      this.indice += 1;
    }
    if (this.css[this.indice] === '"' || this.css[this.indice] === "'") {
      const leida = cadena(this.css, this.indice);
      this.referencias.push(leida.valor);
      this.indice = leida.fin;
    } else {
      this.referencias.push(this.urlSinComillas());
    }
    while (this.indice < this.css.length && this.css[this.indice] !== ')') {
      this.indice += 1;
    }
    this.indice += 1;
  }
}

/** Reconoce url(), @import con cadena e image-set con cadenas, en orden de aparición. */
export function referenciasCss(css: string): string[] {
  return new LectorCss(css).leer();
}
