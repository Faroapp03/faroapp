/** Construcción local reproducible desde fuentes y datos admitidos; no firma, actualiza ni despliega. */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { exportarArtefactoCloudflare, type ResumenArtefactoCloudflare } from '../cloudflare/artefacto.ts';
import type { WebConstruida } from '../cloudflare/comprobar-construccion.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { publicarPaquete } from '../publicar-paquete.ts';
import { BARRERA } from './barrera-publicacion.ts';
import { CARPETA_DEL_MOTOR, listarArchivos } from './carpeta-del-motor.ts';
import { comprobarArtefactos } from './comprobar-artefactos.ts';
import { comprobarRegistroHechos } from './comprobar-hechos-informe.ts';
import type { ContextoWeb } from './contexto.ts';
import { comprobarCspScripts, SCRIPTS_CLASICOS } from './csp.ts';
import { capturarRevisiones, prepararDiagnosticoClasificacion } from './diagnostico-clasificacion.ts';
import {
  comprobarGrafoEmitido,
  empaquetarWeb,
  type PaqueteNavegador,
  RESUMEN_DEL_GRAFO,
  retirarFuentes,
  seEmpaqueta,
} from './empaquetado.ts';
import { archivosDeBiblioteca } from './lecturas.ts';
import { prepararListadoCursos } from './listado-cursos.ts';
import { MANIFIESTO_PUBLICADO, manifiestoDelDispositivo } from './manifiesto-del-dispositivo.ts';
import { comprobarWeb, prepararWeb } from './preparar.ts';
import { archivosPublicados, SERVICE_WORKER } from './publicados.ts';
import { cssPublicado, htmlPublicado, javascriptPublicado } from './recursos-publicados.ts';
import { comprobarReferencias } from './referencias.ts';
import { promoverSalidaConstruida } from './salida-construida.ts';
import { DESCRIPTOR_LOCAL, huellaDeLasFuentes, WEB_LOCAL, type WebLocal, webLocalVigente } from './web-local.ts';

const PLAZO_GIT_MS = 10_000;
const REVISION = /^[0-9a-f]{40}$/;
const DECODIFICADOR = new TextDecoder('utf-8', { fatal: true });
/** La carpeta de la construcción publicable cuando no se indica otra, en la raíz del proyecto. */
export const DESTINO_POR_DEFECTO = 'dist';

interface OpcionesConstruccion {
  readonly huellaPaquete?: string | undefined;
  readonly soloNuevo?: boolean | undefined;
  readonly destinoCloudflare?: 'privado' | 'oficial' | undefined;
  /** Dónde se escribe el resumen del grafo emitido; por omisión, junto a la carpeta de destino. */
  readonly grafoEmitido?: string | undefined;
}

function comprobarHuella(esperada: string | undefined, actual: string): void {
  if (esperada !== undefined && (!/^[0-9a-f]{16}$/.test(esperada) || esperada !== actual)) {
    throw new Error('El paquete no coincide con la huella esperada; no se construye la entrega');
  }
}

/** Git identifica la revisión declarada, no acredita que las fuentes coincidan con ella ni las firma. */
function revisionDeGit(): string {
  const resultado = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: RUTAS.raiz,
    encoding: 'utf8',
    timeout: PLAZO_GIT_MS,
  });
  const revision = resultado.stdout?.trim() ?? '';
  if (resultado.error || resultado.status !== 0 || !REVISION.test(revision)) {
    throw new Error('Indica --revision-codigo con la revisión de origen de esta entrega (40 caracteres hexadecimales)');
  }
  return revision;
}

/** Solo archivos ordinarios: nunca incorpora un destino enlazado ni un mapa de fuentes. */
function leerRecurso(archivo: string): Buffer {
  const ruta = join(RUTAS.web, archivo);
  const estado = lstatSync(ruta);
  if (!estado.isFile() || estado.isSymbolicLink() || archivo.endsWith('.map')) {
    throw new Error(`Recurso no publicable: ${archivo}`);
  }
  return readFileSync(ruta);
}

/**
 * Mantiene los recursos binarios y de terceros; transforma únicamente código propio. Los módulos se copian tal cual:
 * los minifica el empaquetado (empaquetado.ts). Solo pierden aquí sus comentarios los guiones clásicos, aún con el
 * nombre de su fuente: la preparación los renombra después por su huella (guiones-con-huella.ts). El service
 * worker ya es un derivado normalizado (servicio/servicio-publicado.ts) y la preparación lo vuelve a construir con los
 * catálogos de la candidata.
 */
function recursoPublicado(archivo: string, bytes: Uint8Array): Uint8Array | string {
  if (archivo.startsWith('terceros/') || archivo === SERVICE_WORKER) {
    return bytes;
  }
  if (seEmpaqueta(archivo)) {
    return bytes;
  }
  if (archivo.endsWith('.js')) {
    return javascriptPublicado(DECODIFICADOR.decode(bytes), SCRIPTS_CLASICOS.has(archivo) ? 'script' : 'module');
  }
  if (archivo.endsWith('.html')) {
    return htmlPublicado(DECODIFICADOR.decode(bytes));
  }
  return archivo.endsWith('.css') ? cssPublicado(DECODIFICADOR.decode(bytes)) : bytes;
}

function escribir(web: string, archivo: string, contenido: string | Uint8Array): void {
  const destino = join(web, archivo);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido, { flag: 'wx' });
}

/** Captura la selección antes de generar los archivos derivados en una raíz propia vacía. */
function copiarRecursos(web: string): void {
  const biblioteca = archivosDeBiblioteca();
  for (const archivo of archivosPublicados()) {
    const generado = biblioteca.get(`web/${archivo}`);
    escribir(
      web,
      archivo,
      recursoPublicado(archivo, generado === undefined ? leerRecurso(archivo) : Buffer.from(generado)),
    );
  }
  // La fuente de la barrera no se publica con su nombre: la preparación la renombra por su huella (prepararGuion).
  escribir(web, BARRERA.fuente, recursoPublicado(BARRERA.fuente, leerRecurso(BARRERA.fuente)));
  // Solo lo leen los verificadores; el exportador excluye este archivo de la entrega.
  escribir(web, '.assetsignore', leerRecurso('.assetsignore'));
}

/**
 * Sustituye en la copia los módulos de la web por el paquete del navegador. La CSP de los guiones se comprueba antes,
 * sobre sus fuentes: el paquete minificado ya no conserva los nombres que esa comprobación busca.
 */
async function empaquetar(web: string, revisiones: ReadonlyMap<string, Uint8Array>): Promise<PaqueteNavegador> {
  const problemas = comprobarCspScripts(archivosPublicados(web), web);
  if (problemas.length) {
    throw new Error(problemas.join('\n'));
  }
  const { paquete, html, empaquetadas } = await empaquetarWeb(web, undefined, revisiones);
  retirarFuentes(web, empaquetadas);
  for (const [archivo, contenido] of paquete.archivos) {
    if (!archivo.startsWith(`${CARPETA_DEL_MOTOR}/`)) {
      escribir(web, archivo, contenido);
    }
  }
  for (const [pagina, texto] of html) {
    writeFileSync(join(web, pagina), texto);
  }
  return paquete;
}

/** El motor empaquetado proporciona los bytes que comparten copia, SRI y comprobación. */
function prepararContexto(web: string, paquete: PaqueteNavegador): ContextoWeb {
  for (const [archivo, contenido] of paquete.motor) {
    escribir(web, archivo, contenido);
  }
  return {
    web,
    paquete: RUTAS.paquete,
    motor: paquete.motor,
    paqueteNavegador: paquete.archivos,
    grafoEmitido: paquete.resumen,
  };
}

/** La candidata solo contiene recursos seleccionados y generados; el archivo de selección no se publica. */
async function comprobarCandidata(
  contexto: ContextoWeb,
  paquete: PaqueteNavegador,
  huellaMapaModulos: string,
): Promise<void> {
  const finales = listarArchivos(contexto.web).filter((archivo) => archivo !== '.assetsignore');
  const problemas = [
    ...(await comprobarWeb(huellaMapaModulos, contexto)),
    ...comprobarReferencias(finales, contexto.web),
    ...comprobarGrafoEmitido(contexto.web, paquete),
  ];
  if (problemas.length) {
    throw new Error(problemas.join('\n'));
  }
}

/** La web construida y comprobada en `temporal/web`, con lo que necesitan la salida oficial y la local. */
interface Candidata {
  readonly contexto: ContextoWeb;
  readonly paquete: PaqueteNavegador;
  readonly version: string;
  readonly huellaMapaModulos: string;
}

/** El mismo camino para la salida oficial y para la web local: mapas, SRI y marcador se inyectan aquí, no en web/. */
async function construirCandidata(temporal: string, huellaPaquete: string | undefined): Promise<Candidata> {
  comprobarHuella(huellaPaquete, paqueteParaPublicar(RUTAS.paquete).version);
  const web = join(temporal, 'web');
  const revisiones = capturarRevisiones();
  copiarRecursos(web);
  const cursos = prepararDiagnosticoClasificacion(web, undefined, revisiones.editorial, revisiones.materias);
  prepararListadoCursos(web, cursos);
  const paquete = await empaquetar(
    web,
    new Map([
      ['src/catalogo-cursos/clasificacion-revisada.json', revisiones.editorial],
      ['src/catalogo-cursos/materias-revisadas.json', revisiones.materias],
    ]),
  );
  comprobarRegistroHechos();
  const contexto = prepararContexto(web, paquete);
  const version = publicarPaquete(contexto.paquete, web);
  comprobarHuella(huellaPaquete, version);
  escribir(web, MANIFIESTO_PUBLICADO, manifiestoDelDispositivo(web, version, contexto.motor));
  const huellaMapaModulos = await prepararWeb(contexto);
  await comprobarCandidata(contexto, paquete, huellaMapaModulos);
  if (comprobarArtefactos(web, contexto.paquete, contexto.motor) !== version) {
    throw new Error('El paquete publicado en la candidata no es el de esta construcción');
  }
  return { contexto, paquete, version, huellaMapaModulos };
}

/** Construye y comprueba antes de sustituir la salida; las fuentes y la web local permanecen intactas. */
export async function construirWeb(
  revisionCodigo: string,
  destino: string = join(RUTAS.raiz, DESTINO_POR_DEFECTO),
  opciones: OpcionesConstruccion = {},
): Promise<ResumenArtefactoCloudflare> {
  if (!REVISION.test(revisionCodigo)) {
    throw new Error('La revisión de código debe tener 40 caracteres hexadecimales en minúscula');
  }
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'faro-construccion-'));
  try {
    const { contexto, paquete, version, huellaMapaModulos } = await construirCandidata(
      temporal,
      opciones.huellaPaquete,
    );
    const grafo = opciones.grafoEmitido ?? join(dirname(destino), `${basename(destino)}.${RESUMEN_DEL_GRAFO}`);
    writeFileSync(grafo, `${JSON.stringify(paquete.resumen, null, 1)}\n`);
    if (opciones.soloNuevo) {
      return await exportarArtefactoCloudflare(destino, revisionCodigo, version, {
        ...contexto,
        huellaMapaModulos,
        destinoCloudflare: opciones.destinoCloudflare,
      });
    }
    const artefacto = join(temporal, 'artefacto');
    const resumen = await exportarArtefactoCloudflare(artefacto, revisionCodigo, version, {
      ...contexto,
      huellaMapaModulos,
      destinoCloudflare: opciones.destinoCloudflare,
    });
    promoverSalidaConstruida(artefacto, destino, resumen.sha256Artefacto);
    return resumen;
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}

export { huellaDeLasFuentes, WEB_LOCAL, type WebLocal, webLocalVigente } from './web-local.ts';

/**
 * La web local vigente como contexto de una construcción: su web, el paquete canónico, el motor que lleva y la huella
 * de sus mapas (construccion.json).
 *
 * @param destino - La carpeta de la web local; por omisión, .web-local/.
 * @returns El contexto de la web local.
 * @throws {Error} Si falta o salió de otras fuentes: hay que ejecutar antes npm run web:preparar.
 */
export function contextoDeLaWebLocal(destino: string = WEB_LOCAL): WebConstruida {
  const local = webLocalVigente(destino);
  if (local === undefined) {
    throw new Error('Falta la web local de estas fuentes (.web-local/): ejecuta antes npm run web:preparar');
  }
  const motor = join(local.web, CARPETA_DEL_MOTOR);
  return {
    web: local.web,
    paquete: RUTAS.paquete,
    motor: new Map(
      listarArchivos(motor).map((ruta) => [`${CARPETA_DEL_MOTOR}/${ruta}`, readFileSync(join(motor, ruta))] as const),
    ),
    huellaMapaModulos: local.huellaMapaModulos,
  };
}

/**
 * Construye la web local por el camino de la oficial (sin artefacto de Cloudflare) y la sustituye entera, solo cuando
 * ya está comprobada. Se construye en una carpeta temporal, como la oficial (la salida no depende de cuál: lo que se
 * empaqueta desde el repositorio lleva su ruta desde la raíz, empaquetado/fuentes.ts), y se copia a una etapa junto al
 * destino para que el cambio sea un renombrado en el mismo disco.
 */
export async function construirWebLocal(destino: string = WEB_LOCAL): Promise<WebLocal> {
  const huellaDeFuentes = huellaDeLasFuentes();
  const etapa = mkdtempSync(`${destino}.etapa-`);
  const retirada = `${etapa}.anterior`;
  let temporal: string | undefined;
  try {
    temporal = mkdtempSync(join(realpathSync(tmpdir()), 'faro-construccion-'));
    const { version, huellaMapaModulos } = await construirCandidata(temporal, undefined);
    cpSync(join(temporal, 'web'), join(etapa, 'web'), { recursive: true, errorOnExist: true });
    const descriptor = { huellaDeFuentes, huellaMapaModulos, version };
    writeFileSync(join(etapa, DESCRIPTOR_LOCAL), `${JSON.stringify(descriptor, null, 1)}\n`, { flag: 'wx' });
    const habia = lstatSync(destino, { throwIfNoEntry: false }) !== undefined;
    if (habia) {
      renameSync(destino, retirada);
    }
    try {
      renameSync(etapa, destino);
    } catch (error) {
      if (habia) {
        renameSync(retirada, destino);
      }
      throw error;
    }
    rmSync(retirada, { recursive: true, force: true });
    return { ...descriptor, web: join(destino, 'web') };
  } finally {
    if (temporal !== undefined) {
      rmSync(temporal, { recursive: true, force: true });
    }
    rmSync(etapa, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await ejecutar(async () => {
    const { values } = orden(
      'npm run construir -- [--local] [--revision-codigo <sha>] [--destino <carpeta>] [--huella-paquete <huella>] [--solo-nuevo] [--destino-cloudflare privado|oficial] [--grafo-emitido <archivo>]\n--local construye la web que sirve `npm run servir` en .web-local/ (solo admite --destino); --destino indica la carpeta; --destino-cloudflare, la variante de instalación; --grafo-emitido, dónde se escribe el resumen del grafo del navegador.',
    ).leer({
      options: {
        local: { type: 'boolean' },
        'revision-codigo': { type: 'string' },
        destino: { type: 'string' },
        'huella-paquete': { type: 'string' },
        'solo-nuevo': { type: 'boolean' },
        'destino-cloudflare': { type: 'string' },
        'grafo-emitido': { type: 'string' },
      },
    });
    if (values.local) {
      const { local: _local, destino, ...resto } = values;
      if (Object.keys(resto).length) {
        throw new Error('--local solo admite --destino');
      }
      console.log(JSON.stringify(await construirWebLocal(destino === undefined ? WEB_LOCAL : resolve(destino))));
      return;
    }
    const destinoCloudflare = values['destino-cloudflare'];
    if (destinoCloudflare !== undefined && destinoCloudflare !== 'privado' && destinoCloudflare !== 'oficial') {
      throw new Error('Destino Cloudflare inválido');
    }
    if (values['solo-nuevo'] && destinoCloudflare === undefined) {
      throw new Error('La exportación con --solo-nuevo necesita --destino-cloudflare privado|oficial');
    }
    console.log(
      JSON.stringify(
        await construirWeb(values['revision-codigo'] ?? revisionDeGit(), values.destino, {
          huellaPaquete: values['huella-paquete'],
          soloNuevo: values['solo-nuevo'],
          destinoCloudflare,
          grafoEmitido: values['grafo-emitido'],
        }),
      ),
    );
  }, 'Construcción');
}
