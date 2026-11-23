/** Recursos literales cuya base es el propio módulo, identificados sobre el árbol sintáctico JavaScript. */
import { parse } from 'acorn';

type Arbol = Record<string, unknown>;
function objeto(valor: unknown): valor is Arbol {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
function baseDelModulo(nodo: unknown): boolean {
  if (!objeto(nodo) || nodo.type !== 'MemberExpression' || !objeto(nodo.property) || nodo.property.name !== 'url') {
    return false;
  }
  const base = nodo.object;
  return (
    objeto(base) &&
    base.type === 'MetaProperty' &&
    objeto(base.meta) &&
    base.meta.name === 'import' &&
    objeto(base.property) &&
    base.property.name === 'meta'
  );
}
function recursoDe(nodo: Arbol): string | undefined {
  if (
    nodo.type !== 'NewExpression' ||
    !objeto(nodo.callee) ||
    nodo.callee.name !== 'URL' ||
    !Array.isArray(nodo.arguments)
  ) {
    return undefined;
  }
  const [ruta, base] = nodo.arguments;
  if (!objeto(ruta) || ruta.type !== 'Literal' || typeof ruta.value !== 'string' || !baseDelModulo(base)) {
    return undefined;
  }
  if (!/^\.\.?\//.test(ruta.value) || !/\.[a-z0-9]{1,8}(?:[?#].*)?$/i.test(ruta.value)) {
    return undefined;
  }
  return ruta.value;
}
/** Las rutas de directorio y las URL construidas dinámicamente requieren contrato del consumidor. */
export function recursosDelModulo(js: string): string[] {
  const fuente = parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const rutas: string[] = [];
  function visitar(nodo: unknown): void {
    if (Array.isArray(nodo)) {
      for (const elemento of nodo) {
        visitar(elemento);
      }
      return;
    }
    if (!objeto(nodo)) {
      return;
    }
    const ruta = recursoDe(nodo);
    if (ruta) {
      rutas.push(ruta);
    }
    for (const valor of Object.values(nodo)) {
      visitar(valor);
    }
  }
  visitar(fuente);
  return rutas;
}

/** Visita todos los nodos sin confundir literales con código ejecutado. */
function recorrer(nodo: unknown, visitar: (valor: Arbol) => void): void {
  if (Array.isArray(nodo)) {
    for (const elemento of nodo) {
      recorrer(elemento, visitar);
    }
    return;
  }
  if (!objeto(nodo)) {
    return;
  }
  visitar(nodo);
  for (const valor of Object.values(nodo)) {
    recorrer(valor, visitar);
  }
}

function fragmentoFijo(nodo: Arbol): string | undefined {
  if (!Array.isArray(nodo.quasis) || nodo.quasis.length < 2) {
    return undefined;
  }
  const primero = nodo.quasis[0];
  if (!objeto(primero) || !objeto(primero.value) || typeof primero.value.cooked !== 'string') {
    return undefined;
  }
  const prefijo = primero.value.cooked;
  return prefijo.includes('#') ? prefijo.slice(0, prefijo.indexOf('#')) : undefined;
}

function argumentoDeGuion(nodo: Arbol): unknown {
  if (nodo.type !== 'CallExpression' || !objeto(nodo.callee) || nodo.callee.name !== 'urlDeGuion') {
    return undefined;
  }
  return Array.isArray(nodo.arguments) && nodo.arguments.length === 1 ? nodo.arguments[0] : undefined;
}

function constantesDe(fuente: ReturnType<typeof parse>): Map<string, unknown> {
  const constantes = new Map<string, unknown>();
  const superiores = new Set<unknown>();
  for (const sentencia of fuente.body) {
    if (sentencia.type !== 'VariableDeclaration' || sentencia.kind !== 'const') {
      continue;
    }
    for (const declaracion of sentencia.declarations) {
      superiores.add(declaracion);
      if (declaracion.id.type === 'Identifier') {
        constantes.set(declaracion.id.name, declaracion.init);
      }
    }
  }
  const invalidar = (patron: unknown) =>
    recorrer(patron, (nodo) => {
      if (nodo.type === 'Identifier' && typeof nodo.name === 'string') {
        constantes.delete(nodo.name);
      }
    });
  recorrer(fuente, (nodo) => {
    if (nodo.type === 'VariableDeclarator' && !superiores.has(nodo)) {
      invalidar(nodo.id);
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(String(nodo.type))) {
      invalidar(nodo.params);
    }
    if (nodo.type === 'CatchClause') {
      invalidar(nodo.param);
    }
  });
  return constantes;
}
function destinoEjecutable(nodo: Arbol): unknown {
  if (nodo.type === 'ImportExpression') {
    return nodo.source;
  }
  if (
    nodo.type === 'NewExpression' &&
    objeto(nodo.callee) &&
    nodo.callee.name === 'Worker' &&
    Array.isArray(nodo.arguments)
  ) {
    return nodo.arguments[0];
  }
  return undefined;
}
function resolverIdentificador(nodo: Arbol, constantes: Map<string, unknown>, vistos: Set<string>): string | undefined {
  if (typeof nodo.name !== 'string' || vistos.has(nodo.name)) {
    return undefined;
  }
  vistos.add(nodo.name);
  return resolver(constantes.get(nodo.name), constantes, vistos);
}
function resolver(nodo: unknown, constantes: Map<string, unknown>, vistos = new Set<string>()): string | undefined {
  if (!objeto(nodo)) {
    return undefined;
  }
  switch (nodo.type) {
    case 'Literal':
      return typeof nodo.value === 'string' ? nodo.value : undefined;
    case 'Identifier':
      return resolverIdentificador(nodo, constantes, vistos);
    case 'MemberExpression':
      return !nodo.computed && objeto(nodo.property) && nodo.property.name === 'href'
        ? resolver(nodo.object, constantes, vistos)
        : undefined;
    case 'CallExpression':
      return resolver(argumentoDeGuion(nodo), constantes, vistos);
    case 'TemplateLiteral':
      return fragmentoFijo(nodo);
    default:
      return recursoDe(nodo);
  }
}
/** Separa las rutas demostrables de los destinos dinámicos que requieren un contrato propio. */
export function analizarEjecutablesDelModulo(js: string): { rutas: string[]; sinResolver: number } {
  const fuente = parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const constantes = constantesDe(fuente);
  const rutas: string[] = [];
  let sinResolver = 0;
  recorrer(fuente, (nodo) => {
    const destino = destinoEjecutable(nodo);
    if (destino === undefined) {
      return;
    }
    const ruta = resolver(destino, constantes);
    if (ruta === undefined) {
      sinResolver += 1;
    } else {
      rutas.push(ruta);
    }
  });
  return { rutas: [...new Set(rutas)], sinResolver };
}

/** Solo rutas ejecutables resueltas; los destinos dinámicos se declaran en el análisis, no se infieren. */
export function ejecutablesDelModulo(js: string): string[] {
  return analizarEjecutablesDelModulo(js).rutas;
}
