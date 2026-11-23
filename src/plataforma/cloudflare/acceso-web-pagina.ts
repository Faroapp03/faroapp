/**
 * Página de inicio de sesión, con su estilo y su guion en línea; la fotografía de fondo es la de la portada, servida
 * una sola vez como activo público. No implementa ni conoce la autoridad de autenticación.
 */

import { esNavegacion } from '../navegacion.ts';
import { FOTOGRAFIA_PORTADA, rutaDeActivo } from './activos-publicos.ts';
import {
  BANDERA_CA,
  BANDERA_ES,
  FUENTE_SORA_CSS,
  IDIOMA_PUBLICO_JS,
  LOGOTIPO_CSS,
  LOGOTIPO_INTERIOR,
  PORTADA_PUBLICA,
} from './portada-publica.ts';
import { PARAMETRO_RETORNO, RETORNO_POR_DEFECTO, rechazoSinSesion, retornoValido } from './sin-sesion.ts';
import { CABECERA_LIMITE, LIMITE_SATURADO, TEXTOS_ACCESO } from './textos-acceso.ts';

const icono = /<link rel="icon" href="(data:image\/svg\+xml,[^"]+)">/.exec(PORTADA_PUBLICA)?.[1];
if (!icono) {
  throw new Error('Falta el icono de portada');
}
const ESTILO = `
${FUENTE_SORA_CSS}*{box-sizing:border-box}html{color-scheme:dark}html,body{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;color:#fff;background:#101718}.fondo{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.velo{position:fixed;inset:0;background:linear-gradient(115deg,rgba(5,15,20,.90),rgba(5,15,20,.66));z-index:-1}.cabecera{height:64px;display:flex;justify-content:space-between;align-items:center;padding:0 clamp(18px,4vw,48px);background:rgba(12,18,20,.80)}${LOGOTIPO_CSS}.entrada-logo{font-family:Sora,sans-serif;color:#fff;text-decoration:none}.entrada-logo:focus-visible{outline:3px solid #fff;outline-offset:4px}.opciones{display:flex;gap:8px}.opciones #idioma-entrada{display:flex;align-items:center;justify-content:center;gap:6px}.bandera-idioma{display:block;width:24px;height:16px;object-fit:cover;border:1px solid rgba(128,128,128,.5);border-radius:2px}.opciones button{min-width:44px;min-height:44px;border:0;background:transparent;color:#fff;font:inherit;cursor:pointer}main{min-height:calc(100svh - 64px);display:grid;place-items:center;padding:36px 18px}.panel{width:min(100%,490px);padding:clamp(28px,5vw,48px);background:rgba(10,20,23,.90);border:1px solid rgba(255,255,255,.22);border-radius:20px;box-shadow:0 22px 70px rgba(0,0,0,.25)}h1{font-size:clamp(1.7rem,4vw,2.35rem);line-height:1.16;font-weight:500;margin:0 0 18px}p{line-height:1.6;color:#d7e0dd;margin:0 0 28px}label{display:block;font-weight:600;margin:19px 0 8px}input{display:block;width:100%;min-height:50px;padding:12px 14px;border:1px solid #92a7a1;border-radius:9px;background:#fff;color:#15231f;font:inherit}button.entrar{width:100%;min-height:54px;margin-top:28px;border:1px solid #87877f;border-radius:4px;background:#0c0f11;color:#ece8e0;font:500 .95rem system-ui,sans-serif;cursor:pointer;transition:background-color .2s ease,color .2s ease,border-color .2s ease}button.entrar:hover{background:#ece8e0;color:#1b1d1b;border-color:#ece8e0}button.entrar:active{background:#d6d1c6;color:#1b1d1b;border-color:#d6d1c6}button.entrar:disabled{opacity:.6;cursor:default}button.volver{display:block;min-height:44px;margin:14px auto 0;border:0;background:transparent;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:4px;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #9dd9ff;outline-offset:4px}.error{margin:16px 0 0;color:#ffd9ce}.progreso{margin:0}.progreso:not(:empty){margin-top:16px}.aviso-carga p{margin:16px 0 0;color:#ffd9ce}html[data-guion] .aviso-carga{display:none}@media(scripting:none){.aviso-carga{display:none}}@media(prefers-reduced-motion:reduce){button.entrar{transition:none}}
`;

/** Sin JavaScript el idioma no puede cambiar: el aviso lleva las dos frases, cada una marcada con su idioma. */
export const AVISO_SIN_JAVASCRIPT = {
  ca: 'Per entrar, activa el JavaScript al navegador.',
  es: 'Para entrar, activa JavaScript en tu navegador.',
} as const;
/**
 * Plazo de un envío del formulario hasta que llegan las cabeceras de la respuesta. La conexión ya está abierta (la
 * pantalla acaba de llegar por ella), el cuerpo no llega a 2 KB y el servidor solo consulta el límite de intentos y
 * registra la sesión: en una red móvil lenta tarda unos pocos segundos. Quince dan margen de sobra a esa red y, pasados,
 * la petición se da por perdida: se cancela, se dice que el servicio no está disponible y el botón vuelve a quedar listo
 * para un reintento manual. Con las cabeceras ya ha llegado la decisión del servidor, también su cookie: el plazo se
 * anula entonces y no corta la lectura del cuerpo, porque con un 200 la sesión ya estaría creada aunque se avisara de
 * un fallo.
 */
export const PLAZO_ENTRADA_MS = 15_000;
/** El guion solo necesita los textos que puede cambiar; el aviso de carga fallida existe solo en el HTML. */
const TEXTOS_DEL_GUION = JSON.stringify(TEXTOS_ACCESO, (clave, valor) =>
  clave === 'carga-fallida' ? undefined : valor,
);
// Al terminar de preparar el formulario, data-guion en <html> oculta el aviso de carga fallida, que llega después del
// guion: con el guion sano nunca se pinta; si no arranca (bloqueado por la CSP o roto), el aviso queda a la vista.
const GUION = `
(()=>{
${IDIOMA_PUBLICO_JS}
const textos=${TEXTOS_DEL_GUION}, portada=document.getElementById('volver-portada');
let idioma=idiomaInicial(portada), causa='';
const raiz=document.documentElement,alternarIdioma=document.getElementById('idioma-entrada'),formulario=document.getElementById('formulario-acceso'),boton=document.getElementById('entrar'),continuar=document.getElementById('continuar'),aviso=document.getElementById('error-acceso'),pasoUsuario=document.getElementById('paso-usuario'),pasoClave=document.getElementById('paso-clave'),campoUsuario=document.getElementById('campo-usuario'),campoClave=document.getElementById('campo-clave'),volver=document.getElementById('volver-usuario'),progreso=document.getElementById('progreso-acceso');function pintar(){const t=textos[idioma];raiz.lang=idioma;document.title=t.pestana;for(const clave of ['titulo','descripcion','usuario','clave','continuar','volver','entrar'])document.getElementById(clave==='volver'?'volver-usuario':clave).textContent=t[clave];if(causa)aviso.textContent=t[causa];if(boton.hasAttribute('aria-busy'))progreso.textContent=t.progreso;alternarIdioma.querySelector('img').src=alternarIdioma.querySelector('img').dataset[idioma];alternarIdioma.setAttribute('aria-label',t.idioma);portada.setAttribute('aria-label',t.portada);alternarIdioma.setAttribute('title',t.idioma);}
alternarIdioma.addEventListener('click',()=>{
  idioma=idioma==='es'?'ca':'es';
  guardarIdioma(idioma,portada);
  pintar();
});
volver.addEventListener('click',()=>{pasoClave.hidden=true;pasoUsuario.hidden=false;continuar.type='submit';boton.type='button';campoClave.required=false;campoClave.value='';aviso.hidden=true;campoUsuario.focus()});formulario.addEventListener('submit',async evento=>{evento.preventDefault();if(!pasoUsuario.hidden){pasoUsuario.hidden=true;pasoClave.hidden=false;continuar.type='button';boton.type='submit';campoClave.required=true;campoClave.focus();return}if(boton.disabled)return;boton.disabled=true;volver.disabled=true;boton.setAttribute('aria-busy','true');progreso.textContent=textos[idioma].progreso;aviso.hidden=true;const corte=new AbortController(),plazo=setTimeout(()=>corte.abort(),${PLAZO_ENTRADA_MS});try{const respuesta=await fetch('/acceso-web/entrar',{method:'POST',mode:'cors',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(formulario)),signal:corte.signal});clearTimeout(plazo);if(respuesta.ok){const dato=await respuesta.json();if(dato&&dato.ok===true){location.assign(formulario.dataset.volver+location.hash);return}}causa=respuesta.status===403?'error-credenciales':respuesta.status===429?(respuesta.headers.get('${CABECERA_LIMITE}')==='${LIMITE_SATURADO}'?'error-saturacion':'error-intentos'):'error-servicio'}catch{clearTimeout(plazo);causa='error-servicio'}boton.removeAttribute('aria-busy');progreso.textContent='';aviso.textContent=textos[idioma][causa];aviso.hidden=false;boton.disabled=false;volver.disabled=false;campoClave.focus()});pintar();continuar.disabled=false;raiz.dataset.guion='activo'})();
`;
export const CSP_ESTILO_ACCESO_WEB = 'sha256-MjiOXjbodpFh70hCB0UJ72OS/nPOl8GCtQb5T2N6/74=';
export const CSP_GUION_ACCESO_WEB = 'sha256-B6VWFUOTCrL9YSNvPHu5U+3WFukvDoG/Livo7MdrRAI=';
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};
/** Sin escapar, una entidad como &sol; podría convertir la ruta validada en la de otro origen al leer el atributo. */
function escaparAtributo(texto: string): string {
  return texto.replace(/[&"'<>]/g, (caracter) => ESCAPES[caracter] ?? caracter);
}
/**
 * La pantalla, con la ruta ya validada a la que el guion vuelve tras entrar. El guion va dentro del panel, después de
 * todo lo que prepara y antes del aviso de carga fallida, para ocultarlo antes de que se pinte.
 */
function paginaAccesoWeb(retorno: string): string {
  return `<!doctype html><html lang="ca" data-tema="oscuro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TEXTOS_ACCESO.ca.pestana}</title><link rel="icon" href="${icono}"><style>${ESTILO}</style></head><body><img class="fondo" src="${rutaDeActivo(FOTOGRAFIA_PORTADA)}" alt=""><div class="velo" aria-hidden="true"></div><header class="cabecera"><a class="entrada-logo" id="volver-portada" href="/" aria-label="${TEXTOS_ACCESO.ca.portada}">${LOGOTIPO_INTERIOR}</a><div class="opciones"><button id="idioma-entrada" type="button" aria-label="${TEXTOS_ACCESO.ca.idioma}" title="${TEXTOS_ACCESO.ca.idioma}"><img class="bandera-idioma" src="${BANDERA_CA}" data-es="${BANDERA_ES}" data-ca="${BANDERA_CA}" alt=""></button></div></header><main><section class="panel" aria-labelledby="titulo"><h1 id="titulo">${TEXTOS_ACCESO.ca.titulo}</h1><p id="descripcion">${TEXTOS_ACCESO.ca.descripcion}</p><form id="formulario-acceso" method="post" action="/acceso-web/entrar" data-volver="${escaparAtributo(retorno)}"><div id="paso-usuario"><label id="usuario" for="campo-usuario">${TEXTOS_ACCESO.ca.usuario}</label><input id="campo-usuario" name="usuario" autocomplete="username" required><button id="continuar" class="entrar" type="submit" disabled>${TEXTOS_ACCESO.ca.continuar}</button></div><div id="paso-clave" hidden><label id="clave" for="campo-clave">${TEXTOS_ACCESO.ca.clave}</label><input id="campo-clave" name="clave" type="password" autocomplete="current-password"><button id="entrar" class="entrar" type="button">${TEXTOS_ACCESO.ca.entrar}</button><button id="volver-usuario" class="volver" type="button">${TEXTOS_ACCESO.ca.volver}</button></div></form><p id="progreso-acceso" class="progreso" role="status" aria-live="polite"></p><p id="error-acceso" class="error" role="alert" hidden></p><script>${GUION}</script><div id="aviso-carga" class="aviso-carga"><p lang="ca">${TEXTOS_ACCESO.ca['carga-fallida']}</p><p lang="es">${TEXTOS_ACCESO.es['carga-fallida']}</p></div><noscript><p lang="ca">${AVISO_SIN_JAVASCRIPT.ca}</p><p lang="es">${AVISO_SIN_JAVASCRIPT.es}</p></noscript></section></main></body></html>`;
}
/** La pantalla con el retorno de inicio: de ella salen las huellas CSP de su estilo y su guion. */
export const PAGINA_ACCESO_WEB = paginaAccesoWeb(RETORNO_POR_DEFECTO);
/**
 * La pantalla se sirve con 200 a una navegación. A un módulo o un dato, un 403 vacío: una página HTML en su lugar se
 * tomaría por ese archivo. Lleva su propia CSP; HSTS y las cabeceras de aislamiento las pone la puerta
 * (protegerRespuestaPortal), por la que pasa toda respuesta del Worker oficial.
 */
export function paginaAcceso(peticion: Request): Response {
  if (!esNavegacion(peticion)) {
    return rechazoSinSesion();
  }
  const retorno = retornoValido(new URL(peticion.url).searchParams.get(PARAMETRO_RETORNO));
  return new Response(peticion.method === 'HEAD' ? null : paginaAccesoWeb(retorno), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src '${CSP_GUION_ACCESO_WEB}'; style-src '${CSP_ESTILO_ACCESO_WEB}'; connect-src 'self'; img-src data: 'self'; font-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
