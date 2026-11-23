/**
 * Perfiles cerrados de la configuración de cada Worker que publica la activación. Una configuración con un campo de
 * otro perfil se rechaza antes de invocar Wrangler: así el Worker de Cursos nunca recibe la web, los almacenes ni los
 * enlaces del principal, y el principal nunca se sube sin ellos.
 */
import { leerCronDiario } from '../../src/administracion/configuracion-programada.ts';
import { usaFetchPublico } from './compatibilidad.ts';
import { cerrado, ErrorVersionesCloudflare, exigir, objeto, texto } from './contrato-versiones.ts';
import { cursosDelPrincipal } from './pareja-de-workers.ts';

export type ServicioCloudflare = 'principal' | 'cursos';
export const SERVICIOS_CLOUDFLARE: readonly ServicioCloudflare[] = ['principal', 'cursos'];
const CAMPOS_PRINCIPAL = new Set([
  '$schema',
  'name',
  'account_id',
  'main',
  'base_dir',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'version_metadata',
  'assets',
  'rules',
  'durable_objects',
  'migrations',
  'vars',
  'secrets',
  'kv_namespaces',
  'd1_databases',
  'r2_buckets',
  'services',
  'queues',
  'send_email',
  'analytics_engine_datasets',
  'ai',
  'browser',
  'images',
  'vectorize',
  'hyperdrive',
  'limits',
  'placement',
  'observability',
  'logpush',
  'tail_consumers',
  'streaming_tail_consumers',
  'routes',
  'route',
  'triggers',
]);
// Cursos solo calcula con el paquete que lleva dentro y responde al principal por el binding: sin web, sin almacenes,
// sin rutas públicas, sin variables ni tareas programadas. Tampoco `limits`, que la publicación a mano no admite: la
// activación nunca deja un Worker que esa publicación no pueda reproducir.
const CAMPOS_CURSOS = new Set([
  '$schema',
  'name',
  'account_id',
  'main',
  'base_dir',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'rules',
  'placement',
  'observability',
]);
function comprobarAssets(valor: unknown): void {
  exigir(
    cerrado(valor, 'directory,binding,run_worker_first,html_handling,not_found_handling'),
    'configuracion-incompatible',
  );
  exigir(typeof valor.directory === 'string' && valor.binding === 'ASSETS', 'configuracion-incompatible');
  exigir(
    valor.run_worker_first === true && valor.html_handling === 'none' && valor.not_found_handling === 'none',
    'configuracion-incompatible',
  );
}
function comprobarDurables(valor: unknown): void {
  exigir(cerrado(valor, 'bindings') && Array.isArray(valor.bindings), 'configuracion-incompatible');
  const esperados = new Map([['REGISTRO_SOCIOS', 'AccesoPublicoDurable']]);
  exigir(valor.bindings.length === esperados.size, 'configuracion-incompatible');
  for (const binding of valor.bindings) {
    exigir(cerrado(binding, 'name,class_name') && typeof binding.name === 'string', 'configuracion-incompatible');
    exigir(
      esperados.get(binding.name) === binding.class_name && esperados.delete(binding.name),
      'configuracion-incompatible',
    );
  }
}
function comprobarReglas(valor: unknown): void {
  exigir(Array.isArray(valor) && valor.length === 1, 'configuracion-incompatible');
  const regla: unknown = valor[0];
  exigir(cerrado(regla, 'type,globs,fallthrough'), 'configuracion-incompatible');
  exigir(regla.type === 'Data' && regla.fallthrough === true, 'configuracion-incompatible');
  exigir(
    Array.isArray(regla.globs) && regla.globs.length === 1 && regla.globs[0] === '**/datos/*.json',
    'configuracion-incompatible',
  );
}
function comprobarProgramacion(valor: unknown): void {
  if (valor === undefined) {
    return;
  }
  exigir(
    cerrado(valor, 'crons') && Array.isArray(valor.crons) && valor.crons.length <= 1,
    'configuracion-incompatible',
  );
  try {
    if (valor.crons.length === 1) {
      leerCronDiario(valor.crons[0]);
    }
  } catch {
    throw new ErrorVersionesCloudflare('configuracion-incompatible');
  }
}
/** Lo que exigen los dos perfiles: identidad, fecha de compatibilidad, sin URL públicas de prueba y datos como módulos. */
function comprobarComun(valor: Record<string, unknown>, campos: ReadonlySet<string>): void {
  exigir(
    Object.keys(valor).every((k) => campos.has(k)),
    'configuracion-incompatible',
  );
  exigir(
    texto(valor.name, /^[a-z0-9][a-z0-9_-]{0,62}$/) && texto(valor.account_id, /^[0-9a-f]{32}$/),
    'configuracion-incompatible',
  );
  exigir(
    typeof valor.main === 'string' && texto(valor.compatibility_date, /^\d{4}-\d{2}-\d{2}$/),
    'configuracion-incompatible',
  );
  exigir(valor.workers_dev === false && valor.preview_urls === false, 'configuracion-incompatible');
  comprobarReglas(valor.rules);
  exigir(usaFetchPublico(valor.compatibility_flags), 'configuracion-incompatible');
}
export function configuracionDe(valor: unknown, servicio: ServicioCloudflare): Record<string, unknown> {
  exigir(objeto(valor), 'configuracion-incompatible');
  if (servicio === 'cursos') {
    comprobarComun(valor, CAMPOS_CURSOS);
    return valor;
  }
  comprobarComun(valor, CAMPOS_PRINCIPAL);
  exigir(
    cerrado(valor.version_metadata, 'binding') && valor.version_metadata.binding === 'CF_VERSION_METADATA',
    'configuracion-incompatible',
  );
  comprobarAssets(valor.assets);
  comprobarDurables(valor.durable_objects);
  comprobarProgramacion(valor.triggers);
  return valor;
}
/** Las dos configuraciones son la pareja de la misma instalación, con la regla de la publicación a mano. */
export function comprobarPareja(principal: Record<string, unknown>, cursos: Record<string, unknown>): void {
  exigir(cursosDelPrincipal(principal, cursos), 'configuracion-incompatible');
}
