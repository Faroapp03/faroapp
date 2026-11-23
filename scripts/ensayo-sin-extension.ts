/**
 * Ensayo de la retirada de una extensión, en una copia aparte de la instalación: borra su carpeta de la web y su línea
 * del registro, regenera los derivados, construye, verifica, comprueba que lo servido no la nombra, recorre el real en
 * los navegadores y compara la medición del motor de ocupaciones con su referencia. No modifica la instalación de
 * origen.
 *
 * Uso: npm run ensayo:sin-extension -- [--extension <id>] [--destino <carpeta>] [--revision <sha>] [--sin-navegadores]
 *   [--sin-banco]
 *
 * - `--extension`: el identificador de la extensión que se retira, el de su registro. Sin él, si hay una sola extensión
 *   instalada, se ensaya la retirada de esa y se indica cuál; sin ninguna instalada, termina con error.
 * - `--destino`: carpeta nueva o vacía, fuera de la instalación, donde se crean la copia (`raiz/`) y el informe
 *   (`informe/`). Por omisión, una carpeta nueva en el directorio temporal.
 * - `--revision`: la revisión de código que se declara al construir (40 caracteres hexadecimales). Por omisión, la de
 *   Git de la instalación de origen.
 * - `--sin-navegadores` y `--sin-banco`: ensayo parcial, sin el recorrido en navegadores o sin la medición del banco.
 *
 * La carpeta y la línea que se retiran salen del registro (`EXTENSIONES`): la carpeta es la de la entrada de la
 * extensión en `web/` y la línea, la única del registro que exporta su `servidor/extension.ts`. Cada paso deja su
 * registro en `informe/`; el resumen queda en `informe/informe.json` e `informe/informe.txt`. La salida es 0 solo si
 * todos los pasos ejecutados terminan bien y, con el banco pedido, su medición coincide con la referencia. No forma
 * parte de `npm run verificar`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutar, orden } from '../herramientas/comun/opciones.ts';
import { EXTENSIONES } from '../src/plataforma/extensiones.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const REGISTRO = 'src/plataforma/extensiones-instaladas.ts';
/** Lo que la copia no lleva: las dependencias se enlazan y la salida construida se genera de nuevo. */
const ENLAZADAS = new Set(['node_modules', '.venv']);
const SIN_COPIAR = new Set([...ENLAZADAS, 'dist']);
const REVISION = /^[0-9a-f]{40}$/u;
const TASKPOLICY = '/usr/sbin/taskpolicy';
const PLAZO_GIT_MS = 10_000;
const PLAZO_PASO_MS = 3_600_000;
const MILISEGUNDOS = 1000;
const CONTEXTO = 48;
const USO =
  'npm run ensayo:sin-extension -- [--extension <id>] [--destino <carpeta>] [--revision <sha>] [--sin-navegadores] ' +
  '[--sin-banco]';

/** La medición de referencia del banco: la huella de `JSON.stringify(resultados)`, su origen y si es comparable. */
export const REFERENCIA_DEL_BANCO = Object.freeze({
  huella: 'f16605878434dd99b8375c8c3dcbfce0660d6a4104091f8d78bff19d5b214e69',
  origen: 'original',
  comparable: true,
});

/**
 * El contrato heredado que sí se sirve sin la extensión (el mismo que admite la guardia del real en
 * `pruebas/plataforma/`): la clave del aviso del panel para un modo guardado cuya variante ya no está instalada
 * (`panel.recorrido.<variante>-retirada`), en el JavaScript del panel y de los idiomas, con el nombre de archivo que le
 * dé la construcción. Se admite solo la aparición que forma esa clave, no otra cercana.
 */
const CONTRATO_HEREDADO: readonly { archivo: RegExp; antes: string; despues: string }[] = [
  { archivo: /^web\/(?:administracion|idiomas)\/.+\.js$/u, antes: 'panel.recorrido', despues: '-retirada' },
];
const DE_TEXTO = /\.(?:[cm]?js|html|css|json|txt|svg|webmanifest|xml)$/u;

/** Lo que el ensayo lee de cada extensión del registro (`Extension`): su identificador y su página de entrada. */
export interface ExtensionDelRegistro {
  readonly id: string;
  readonly entrada: string;
}

/** Lo que el ensayo retira de la copia: el identificador de la extensión y su carpeta, relativa a la raíz. */
export interface ExtensionRetirable {
  readonly id: string;
  readonly carpeta: string;
}

interface Paso {
  readonly nombre: string;
  readonly orden: string;
  readonly salida: number | null;
  readonly segundos: number;
  readonly registro: string;
}

const dentro = (padre: string, hijo: string): boolean => {
  const ruta = relative(padre, hijo);
  return ruta === '' || !(ruta === '..' || ruta.startsWith(`..${sep}`) || isAbsolute(ruta));
};

function real(ruta: string): string {
  return realpathSync(resolve(ruta));
}

/**
 * El destino del ensayo: nuevo o vacío, con su carpeta padre existente, fuera de la instalación y sin contenerla.
 *
 * @param origen - La instalación que se copia.
 * @param destino - La carpeta del ensayo.
 * @returns La ruta absoluta y sin enlaces del destino.
 */
export function destinoDelEnsayo(origen: string, destino: string): string {
  const absoluto = resolve(destino);
  const final = join(real(dirname(absoluto)), basename(absoluto));
  const raiz = real(origen);
  if (dentro(raiz, final) || dentro(final, raiz)) {
    throw new Error(`El destino ${final} no puede estar dentro de la instalación ${raiz} ni contenerla`);
  }
  const estado = lstatSync(final, { throwIfNoEntry: false });
  if (estado && !(estado.isDirectory() && !estado.isSymbolicLink() && readdirSync(final).length === 0)) {
    throw new Error(`El destino ${final} ya existe y no es una carpeta vacía`);
  }
  return final;
}

/**
 * Copia la instalación en `<destino>/raiz` con `cp -pRP` (los enlaces se copian como enlaces), sin su salida
 * construida, y enlaza sus dependencias (`node_modules` y `.venv`) en lugar de copiarlas.
 *
 * @param origen - La instalación que se copia; no se modifica.
 * @param destino - La carpeta del ensayo, comprobada con `destinoDelEnsayo`.
 * @returns La raíz de la copia.
 */
export function prepararCopia(origen: string, destino: string): string {
  const final = destinoDelEnsayo(origen, destino);
  const raiz = real(origen);
  const copia = join(final, 'raiz');
  mkdirSync(copia, { recursive: true });
  for (const nombre of readdirSync(raiz)) {
    if (ENLAZADAS.has(nombre) && existsSync(join(raiz, nombre))) {
      symlinkSync(real(join(raiz, nombre)), join(copia, nombre));
    } else if (!SIN_COPIAR.has(nombre)) {
      const copiado = spawnSync('cp', ['-pRP', join(raiz, nombre), join(copia, nombre)], { encoding: 'utf8' });
      if (copiado.status !== 0) {
        throw new Error(`No se pudo copiar ${nombre}: ${copiado.stderr || String(copiado.error)}`);
      }
    }
  }
  return copia;
}

const escapar = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');

/**
 * La carpeta de la web de una extensión del registro: la de primer nivel de su entrada.
 *
 * @param extension - El identificador y la entrada de la extensión, tal como figuran en su registro.
 * @returns El identificador y la carpeta, relativa a la raíz (`web/<carpeta>`).
 */
export function retirable({ id, entrada }: ExtensionDelRegistro): ExtensionRetirable {
  const barra = entrada.indexOf('/');
  if (barra <= 0) {
    throw new Error(`La extensión «${id}» no tiene su entrada (${entrada}) dentro de una carpeta propia de la web`);
  }
  return { id, carpeta: `web/${entrada.slice(0, barra)}` };
}

/**
 * La extensión que se ensaya: la pedida o, sin pedir ninguna, la única instalada.
 *
 * @param extensiones - Las extensiones del registro.
 * @param id - El identificador pedido con `--extension`, si se pidió.
 * @returns La extensión elegida y, si no se pidió, el aviso de cuál se ha elegido.
 * @throws {Error} Si no hay ninguna instalada, si la pedida no lo está o si hay varias y no se pidió ninguna.
 */
export function elegirExtension(
  extensiones: readonly ExtensionDelRegistro[],
  id?: string,
): { extension: ExtensionRetirable; aviso?: string } {
  const instaladas = extensiones.map(({ id: instalada }) => instalada).join(', ');
  if (!extensiones.length) {
    throw new Error(`No hay ninguna extensión instalada en ${REGISTRO}: no hay retirada que ensayar`);
  }
  if (id !== undefined) {
    const pedida = extensiones.find((extension) => extension.id === id);
    if (!pedida) {
      throw new Error(`La extensión «${id}» no está instalada; las instaladas son: ${instaladas}`);
    }
    return { extension: retirable(pedida) };
  }
  const [unica, ...otras] = extensiones;
  if (!unica || otras.length) {
    throw new Error(`Hay varias extensiones instaladas (${instaladas}): indica cuál con --extension <id>`);
  }
  return {
    extension: retirable(unica),
    aviso: `Se ensaya la retirada de la única extensión instalada, «${unica.id}».`,
  };
}

/** La línea del registro que instala la extensión: la que exporta el `servidor/extension.ts` de su carpeta. */
function lineaDelRegistro(carpeta: string): RegExp {
  return new RegExp(`^export \\{ \\w+ \\} from '\\.\\./\\.\\./${escapar(carpeta)}/servidor/extension\\.ts';$`, 'u');
}

/**
 * Retira una extensión de una copia: borra su carpeta y su línea del registro, y nada más. Solo actúa sobre una copia
 * que no sea la instalación de origen ni esté dentro de ella.
 *
 * @param copia - La raíz de la copia.
 * @param origen - La instalación de origen, que no se toca.
 * @param extension - La extensión que se retira.
 * @returns Las rutas retiradas, relativas a la copia, y la línea borrada del registro.
 */
export function retirarExtension(
  copia: string,
  origen: string,
  { carpeta: relativa }: ExtensionRetirable,
): { carpeta: string; registro: string; linea: string } {
  const raiz = real(copia);
  if (dentro(real(origen), raiz) || dentro(raiz, real(origen))) {
    throw new Error(`La retirada solo se ensaya en una copia aparte, no en ${raiz}`);
  }
  const carpeta = join(raiz, relativa);
  const estado = lstatSync(carpeta, { throwIfNoEntry: false });
  if (!(estado?.isDirectory() && !estado.isSymbolicLink() && dentro(raiz, carpeta) && carpeta !== raiz)) {
    throw new Error(`La copia no tiene la carpeta ${relativa}`);
  }
  const registro = join(raiz, REGISTRO);
  const lineas = readFileSync(registro, 'utf8').split('\n');
  const patron = lineaDelRegistro(relativa);
  const suyas = lineas.filter((linea) => patron.test(linea));
  if (suyas.length !== 1 || suyas[0] === undefined) {
    throw new Error(`${REGISTRO} debe tener exactamente una línea que exporte ${relativa}/servidor/extension.ts`);
  }
  rmSync(carpeta, { recursive: true });
  writeFileSync(registro, lineas.filter((linea) => !patron.test(linea)).join('\n'));
  return { carpeta: relativa, registro: REGISTRO, linea: suyas[0] };
}

function archivosDe(carpeta: string, base = carpeta): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    return entrada.isDirectory() ? archivosDe(ruta, base) : [relative(base, ruta).split('\\').join('/')];
  });
}

function citaDe(texto: string, indice: number, largo: number): string {
  const desde = Math.max(0, indice - CONTEXTO);
  return texto.slice(desde, indice + largo + CONTEXTO).replace(/\s+/gu, ' ');
}

/** Lo que nombra la extensión: su carpeta en rutas y mapas de importación (`/x/`, `./x/`) y sus claves (`*.x`). */
function patronesDe({ id, carpeta }: ExtensionRetirable): readonly RegExp[] {
  return [new RegExp(`\\b${escapar(basename(carpeta))}/`, 'gu'), new RegExp(`\\.${escapar(id)}\\b`, 'gu')];
}

/** Las apariciones de la extensión en el texto de un archivo servido, salvo el contrato heredado. */
function fugasDelTexto(archivo: string, texto: string, patrones: readonly RegExp[]): string[] {
  const heredada = (indice: number, largo: number) =>
    CONTRATO_HEREDADO.some(
      ({ archivo: suyo, antes, despues }) =>
        suyo.test(archivo) &&
        texto.slice(indice - antes.length, indice) === antes &&
        texto.slice(indice + largo, indice + largo + despues.length) === despues,
    );
  return patrones.flatMap((patron) =>
    [...texto.matchAll(patron)]
      .filter((encontrada) => !heredada(encontrada.index, encontrada[0].length))
      .map((encontrada) => `${archivo}: …${citaDe(texto, encontrada.index, encontrada[0].length)}…`),
  );
}

/**
 * Lo servido que nombra la extensión retirada: rutas de archivo dentro de su carpeta y, en los archivos de texto,
 * rutas, mapas de importación y claves de la extensión, salvo el contrato heredado.
 *
 * @param salida - La salida construida (`dist`).
 * @param extension - La extensión retirada.
 * @returns Una fuga por aparición, con su archivo y su contexto; vacía si nada servido nombra la extensión.
 */
export function fugasDeLaExtension(salida: string, extension: ExtensionRetirable): string[] {
  const patrones = patronesDe(extension);
  const deSuCarpeta = new RegExp(`(?:^|/)${escapar(basename(extension.carpeta))}(?:/|$)`, 'u');
  return archivosDe(salida)
    .sort()
    .flatMap((archivo) => [
      ...(deSuCarpeta.test(archivo) ? [`${archivo}: archivo de la extensión`] : []),
      ...(DE_TEXTO.test(archivo) ? fugasDelTexto(archivo, readFileSync(join(salida, archivo), 'utf8'), patrones) : []),
    ]);
}

function revisionDeOrigen(): string {
  const git = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: PLAZO_GIT_MS,
  });
  const revision = git.stdout?.trim() ?? '';
  if (git.status !== 0 || !REVISION.test(revision)) {
    throw new Error('Indica --revision con la revisión de código que se declara (40 caracteres hexadecimales)');
  }
  return revision;
}

/** Ejecuta un paso en la copia, en segundo plano de prioridad cuando el sistema lo permite, con su registro aparte. */
function paso(copia: string, informe: string, nombre: string, argumentos: readonly string[]): Paso {
  const registro = join(informe, `${nombre}.log`);
  const descriptor = openSync(registro, 'w');
  const inicio = performance.now();
  const [programa, ...resto] = existsSync(TASKPOLICY) ? [TASKPOLICY, '-b', ...argumentos] : argumentos;
  try {
    const resultado = spawnSync(programa ?? '', resto, {
      cwd: copia,
      stdio: ['ignore', descriptor, descriptor],
      timeout: PLAZO_PASO_MS,
    });
    const segundos = Math.round((performance.now() - inicio) / MILISEGUNDOS);
    console.log(`${nombre}: salida ${resultado.status} en ${segundos} s`);
    return { nombre, orden: argumentos.join(' '), salida: resultado.status, segundos, registro };
  } finally {
    closeSync(descriptor);
  }
}

/** La medición del banco frente a la referencia: huella de los resultados, origen, comparable y aciertos. */
function comparacionDelBanco(medicion: string) {
  const { base, resultados } = JSON.parse(readFileSync(medicion, 'utf8')) as {
    base: { origen_bancos: string; comparable_con_la_referencia: boolean };
    resultados: { personas: { recorrido: { final: string } }[] }[];
  };
  const huella = createHash('sha256').update(JSON.stringify(resultados)).digest('hex');
  const personas = resultados.flatMap((resultado) => resultado.personas);
  const actual = { huella, origen: base.origen_bancos, comparable: base.comparable_con_la_referencia };
  return {
    ...actual,
    casos: resultados.length,
    personas: personas.length,
    aciertos: personas.filter((persona) => persona.recorrido.final === 'bien').length,
    coincide: JSON.stringify(actual) === JSON.stringify(REFERENCIA_DEL_BANCO),
  };
}

/** Lo que decide el resultado del ensayo. */
export interface Resultado {
  readonly construida: boolean;
  readonly pasos: readonly Pick<Paso, 'salida'>[];
  readonly fugas: readonly string[];
  readonly bancoPedido: boolean;
  readonly banco?: { readonly coincide: boolean } | undefined;
}

/**
 * Si el ensayo es correcto: construido, todos los pasos ejecutados con salida 0, nada servido que nombre la extensión
 * y, si se pidió el banco, una medición que coincide con la referencia. Sin `medicion.json` el banco no coincide.
 *
 * @param resultado - Lo que dejaron la construcción, las comprobaciones y el banco.
 * @returns Si el ensayo pasa.
 */
export function ensayoCorrecto({ construida, pasos, fugas, bancoPedido, banco }: Resultado): boolean {
  const bancoCorrecto = !bancoPedido || banco?.coincide === true;
  return construida && pasos.every(({ salida }) => salida === 0) && fugas.length === 0 && bancoCorrecto;
}

interface Opciones {
  readonly extension: ExtensionRetirable;
  readonly destino: string;
  readonly revision: string;
  readonly navegadores: boolean;
  readonly banco: boolean;
}

/**
 * Los pasos que siguen a la construcción, en su orden; su número continúa el de pasosDeConstruccion. Las fugas no
 * ejecutan nada: dejan su lista en `<nombre>.txt`.
 */
export const PASOS_DE_COMPROBACION = Object.freeze({
  verificar: '4-verificar',
  fugas: '5-fugas',
  navegadores: '6-navegadores',
  sello: '7-sello',
  banco: '8-banco',
});

/** La regeneración de los derivados y la construcción, en su orden. */
export function pasosDeConstruccion(copia: string, revision: string): readonly [string, readonly string[]][] {
  return [
    ['1-comunes', ['npm', 'run', 'comunes:generar']],
    ['2-web-preparar', ['npm', 'run', 'web:preparar']],
    ['3-construir', ['npm', 'run', 'construir', '--', '--revision-codigo', revision, '--destino', join(copia, 'dist')]],
  ];
}

/**
 * Regenera los derivados y construye en una copia ya retirada; si uno de estos pasos falla, los siguientes no tienen
 * sentido. Es también el ensayo parcial hasta la construcción, sin verificar.
 *
 * @param copia - La raíz de la copia, con la extensión ya retirada.
 * @param informe - La carpeta de los registros de cada paso.
 * @param revision - La revisión de código que se declara al construir.
 * @returns Los pasos ejecutados, en orden.
 */
export function regenerarYConstruir(copia: string, informe: string, revision: string): Paso[] {
  const pasos: Paso[] = [];
  for (const [nombre, argumentos] of pasosDeConstruccion(copia, revision)) {
    pasos.push(paso(copia, informe, nombre, argumentos));
    if (pasos.at(-1)?.salida !== 0) {
      break;
    }
  }
  return pasos;
}

function comprobaciones(copia: string, informe: string, opciones: Opciones) {
  const pasos = [paso(copia, informe, PASOS_DE_COMPROBACION.verificar, ['npm', 'run', 'verificar'])];
  const fugas = fugasDeLaExtension(join(copia, 'dist'), opciones.extension);
  writeFileSync(join(informe, `${PASOS_DE_COMPROBACION.fugas}.txt`), fugas.length ? `${fugas.join('\n')}\n` : '');
  if (opciones.navegadores) {
    const salida = join(informe, 'navegadores');
    const artefacto = ['--artefacto', join(copia, 'dist'), '--salida', salida];
    pasos.push(
      paso(copia, informe, PASOS_DE_COMPROBACION.navegadores, ['npm', 'run', 'probar:navegadores', '--', ...artefacto]),
    );
  }
  let banco: ReturnType<typeof comparacionDelBanco> | undefined;
  if (opciones.banco) {
    pasos.push(paso(copia, informe, PASOS_DE_COMPROBACION.sello, ['npm', 'run', 'ocupaciones:comprobar-sello']));
    const medicion = join(informe, 'medicion.json');
    const medir = ['npm', 'run', 'ocupaciones:medir', '--', '--traza', '--salida', medicion];
    pasos.push(paso(copia, informe, PASOS_DE_COMPROBACION.banco, medir));
    banco = existsSync(medicion) ? comparacionDelBanco(medicion) : undefined;
  }
  return { pasos, fugas, banco };
}

function textoDelBanco(pedido: boolean, banco: unknown): string {
  if (!pedido) {
    return 'no pedido';
  }
  return banco ? JSON.stringify(banco) : 'pedido y sin medicion.json';
}

function textoDelInforme(informe: Record<string, unknown>, pasos: readonly Paso[], fugas: readonly string[]): string {
  return [
    `Ensayo sin la extensión «${String(informe.extension)}»: ${informe.correcto ? 'correcto' : 'con fallos'}`,
    `Copia: ${String(informe.copia)} · revisión ${String(informe.revision)}`,
    ...pasos.map((p) => `${p.nombre}: salida ${p.salida} en ${p.segundos} s · ${p.orden}`),
    `Lo servido que nombra la extensión: ${fugas.length}`,
    ...fugas,
    `Banco: ${textoDelBanco(informe.bancoPedido === true, informe.banco)}`,
    '',
  ].join('\n');
}

/**
 * Ejecuta el ensayo completo o parcial y deja su informe.
 *
 * @param opciones - Extensión, destino, revisión y pasos opcionales.
 * @returns Si el ensayo es correcto (`ensayoCorrecto`).
 */
export function ensayarSinExtension(opciones: Opciones): boolean {
  const final = destinoDelEnsayo(RAIZ, opciones.destino);
  const copia = prepararCopia(RAIZ, final);
  const informe = join(final, 'informe');
  mkdirSync(informe);
  const retirada = retirarExtension(copia, RAIZ, opciones.extension);
  const construccion = regenerarYConstruir(copia, informe, opciones.revision);
  const construida =
    construccion.length === pasosDeConstruccion(copia, opciones.revision).length &&
    construccion.every(({ salida }) => salida === 0);
  const resto = construida ? comprobaciones(copia, informe, opciones) : { pasos: [], fugas: [], banco: undefined };
  const pasos = [...construccion, ...resto.pasos];
  const correcto = ensayoCorrecto({
    construida,
    pasos,
    fugas: resto.fugas,
    bancoPedido: opciones.banco,
    banco: resto.banco,
  });
  const resumen = {
    correcto,
    extension: opciones.extension.id,
    copia,
    revision: opciones.revision,
    retirada,
    pasos,
    fugas: resto.fugas,
    bancoPedido: opciones.banco,
    banco: resto.banco ?? null,
    opciones,
  };
  writeFileSync(join(informe, 'informe.json'), `${JSON.stringify(resumen, null, 2)}\n`);
  writeFileSync(join(informe, 'informe.txt'), textoDelInforme(resumen, pasos, resto.fugas));
  console.log(`Informe: ${join(informe, 'informe.txt')}`);
  return correcto;
}

if (import.meta.main) {
  await ejecutar(() => {
    const { values } = orden(USO).leer({
      options: {
        extension: { type: 'string' },
        destino: { type: 'string' },
        revision: { type: 'string' },
        'sin-navegadores': { type: 'boolean' },
        'sin-banco': { type: 'boolean' },
      },
    });
    const { extension, aviso } = elegirExtension(EXTENSIONES, values.extension);
    if (aviso) {
      console.log(aviso);
    }
    const revision = values.revision ?? revisionDeOrigen();
    if (!REVISION.test(revision)) {
      throw new Error('La revisión debe tener 40 caracteres hexadecimales en minúscula');
    }
    const destino = values.destino ?? mkdtempSync(join(realpathSync(tmpdir()), 'ensayo-sin-extension-'));
    const correcto = ensayarSinExtension({
      extension,
      destino,
      revision,
      navegadores: !values['sin-navegadores'],
      banco: !values['sin-banco'],
    });
    if (!correcto) {
      throw new Error(`La aplicación sin la extensión «${extension.id}» no pasa el ensayo; consulta el informe`);
    }
  }, 'Ensayo sin la extensión');
}
