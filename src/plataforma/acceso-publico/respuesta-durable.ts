import { exigirTrabajo } from '../../administracion/trabajos.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';

export function responderOperacionPrivada(resultado: unknown, maximo: number): Response {
  if (resultado === undefined) {
    return Response.json(
      { error: 'solicitud_invalida' },
      { status: ESTADO_HTTP.solicitudIncorrecta, headers: { 'cache-control': 'no-store' } },
    );
  }
  const texto = JSON.stringify(resultado);
  exigirTrabajo(new TextEncoder().encode(texto).byteLength <= maximo);
  return new Response(texto, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
