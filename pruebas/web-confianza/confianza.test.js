// La política faro-informe (scripts/confianza.js) frente a las familias conocidas de inyección de HTML: el informe del
// motor entra en la página con innerHTML, y aunque la CSP ya frena lo ejecutable, esta es la segunda línea. La política
// limita etiquetas, atributos y esquemas de dirección a una lista cerrada y exige la sintaxis del motor. Estos casos
// comprueban las familias de ataque enumeradas; no ejecutan el parser de un navegador. Los informes de los testigos
// (pruebas/informe/informe-breve-admitido.test.ts) tienen comprobación separada con el catálogo actual.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GuionNoAdmitido, htmlDeConfianza, urlDeGuion } from '../../web/scripts/confianza.js';

/** Párrafos de un informe muy largo (unos 2,4 millones de caracteres) y niveles de uno muy anidado. */
const EN_UN_INFORME_LARGO = 300_000;
const EN_UN_INFORME_ANIDADO = 5000;

/**
 * Los motivos por los que la política puede rechazar cada familia (el paréntesis del mensaje de confianza.js): el
 * rechazo tiene que venir de la regla que frena esa familia, no de otra demasiado amplia que lo rechace todo.
 */
/** @type {Readonly<Record<string, RegExp>>} */
const MOTIVOS = Object.freeze({
  'guiones y elementos ejecutables': /^(?:etiqueta|«<»)/,
  'manejadores de eventos': /^(?:atributo|«<»)/,
  'atributos que rompen la sintaxis': /^(?:«<»|atributo)/,
  'espacios de nombres SVG y MathML': /^(?:etiqueta|esquema|«<»|atributo)/,
  'esquemas de dirección, también disfrazados': /^(?:esquema|referencia|dirección|target|valor|atributo)/,
  'recursos de otro origen en el informe': /^dirección/,
  'comentarios, declaraciones y entidades rotas': /^(?:«<»|referencia de carácter)/,
  'un orden de Tab propio': /^(?:valor de tabindex|atributo tabindex)/,
  'elementos que no escribe el motor': /^etiqueta/,
});

/**
 * Comprueba que la política rechaza `html` por uno de los motivos de su familia.
 * @param {string} html @param {RegExp} motivo
 */
function rechazadoPor(html, motivo) {
  assert.throws(
    () => htmlDeConfianza(html),
    (error) => {
      assert.ok(error instanceof Error);
      const detalle = /no admite \((.*)\)$/s.exec(error.message)?.[1] ?? '';
      assert.match(detalle, motivo, `${JSON.stringify(html)}: ${error.message}`);
      return true;
    },
    JSON.stringify(html),
  );
}

/** Cada familia de ataque, con sus variantes. Ninguna puede llegar a innerHTML. */
const PELIGROSOS = {
  'guiones y elementos ejecutables': [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//x.example/x.js></SCRIPT>',
    '<scr<script>ipt>alert(1)</script>',
    '<iframe src="https://x.example"></iframe>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<object data="x.swf"></object>',
    '<embed src="x.swf">',
    '<frameset><frame src="x"></frameset>',
    '<base href="https://x.example/">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<link rel="stylesheet" href="https://x.example/x.css">',
    '<style>@import "https://x.example/x.css";</style>',
    '<form action="https://x.example"><button>Enviar</button></form>',
    '<input autofocus onfocus="alert(1)">',
    '<textarea><img src=x onerror=alert(1)></textarea>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<video><source onerror="alert(1)"></video>',
    '<audio src=x onerror=alert(1)>',
    '<marquee onstart=alert(1)>',
    '<isindex action=javascript:alert(1)>',
    '<portal src="https://x.example"></portal>',
  ],
  'manejadores de eventos': [
    '<img src="x" onerror="alert(1)">',
    '<img src=x onerror=alert(1)>',
    "<img src='x' onerror='alert(1)'>",
    '<p onclick="alert(1)">x</p>',
    '<p ONMOUSEOVER="alert(1)">x</p>',
    '<p\tonclick="alert(1)">x</p>',
    '<p\nonclick="alert(1)">x</p>',
    '<p\fonclick="alert(1)">x</p>',
    '<details open ontoggle="alert(1)"><summary>x</summary></details>',
    '<button popovertarget="x" onbeforetoggle="alert(1)">x</button>',
    '<span class="a" onanimationstart="alert(1)">x</span>',
  ],
  'atributos que rompen la sintaxis': [
    '<svg/onload=alert(1)>',
    '<img/onerror=alert(1) src=x>',
    '<img/src="x"/onerror=alert(1)>',
    '<img src="x"onerror="alert(1)">',
    "<img src='x'onerror='alert(1)'>",
    '<p class="a"/onclick="alert(1)">x</p>',
    '<p class=a onclick=alert(1)>x</p>',
    '<p class="a" class=b onclick="alert(1)">x</p>',
    '<p class="a"">x</p>',
    '<p class="a>x</p>',
    '<p class="<img src=x onerror=alert(1)>">x</p>',
    '<p =onclick="alert(1)">x</p>',
    '<p\u000bonclick="alert(1)">x</p>',
    '<p\u0000onclick="alert(1)">x</p>',
    '<img src="x" on\u0000error="alert(1)">',
    '<p class="a" style="background:url(javascript:alert(1))">x</p>',
    '<p style="background-image:url(https://x.example/rastreo.png)">x</p>',
    '<p style="width:expression(alert(1))">x</p>',
    '<a href="https://x.example" name="location">x</a>',
    '<img src="imagenes/x.webp" name="cookie">',
  ],
  'espacios de nombres SVG y MathML': [
    '<svg><script>alert(1)</script></svg>',
    '<svg><script href="data:,alert(1)"></script></svg>',
    '<svg><a href="javascript:alert(1)"><text x="0" y="10">x</text></a></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><rect width="1" height="1"></rect></a></svg>',
    '<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>',
    '<svg><set attributeName="onmouseover" to="alert(1)"></set></svg>',
    '<svg><use href="data:image/svg+xml,&lt;svg id=x&gt;&lt;/svg&gt;#x"></use></svg>',
    '<svg><foreignObject><iframe src="https://x.example"></iframe></foreignObject></svg>',
    '<svg><style>@import "https://x.example/x.css";</style></svg>',
    '<svg><image href="https://x.example/rastreo.png"></image></svg>',
    '<svg><![CDATA[<img src=x onerror=alert(1)>]]></svg>',
    '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
    '<svg><rect width="1" onload="alert(1)"></rect></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<math href="javascript:alert(1)">x</math>',
    '<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>',
  ],
  'esquemas de dirección, también disfrazados': [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="&#0000106avascript:alert(1)">x</a>',
    '<a href="&#x6A;avascript:alert(1)">x</a>',
    '<a href="&#X6a;avascript:alert(1)">x</a>',
    '<a href="java&#x09;script:alert(1)">x</a>',
    '<a href="java&#9;script:alert(1)">x</a>',
    '<a href="java&#10;script:alert(1)">x</a>',
    '<a href="java&#13;script:alert(1)">x</a>',
    '<a href="java&Tab;script:alert(1)">x</a>',
    '<a href="java&NewLine;script:alert(1)">x</a>',
    '<a href="javascript&colon;alert(1)">x</a>',
    '<a href="&constructor;javascript:alert(1)">x</a>',
    '<a href="&ampx;javascript:alert(1)">x</a>',
    '<a href="javascript&#58;alert(1)">x</a>',
    '<a href="javascript&#x3a;alert(1)">x</a>',
    '<a href="&#x01;javascript:alert(1)">x</a>',
    '<a href="\u0001javascript:alert(1)">x</a>',
    '<a href="java\u0000script:alert(1)">x</a>',
    '<a href="jav\tascript:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="VBScript:msgbox(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">x</a>',
    '<a href="&#100;ata:text/html,x">x</a>',
    '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;">',
    '<img src="javascript:alert(1)">',
    '<img src="imagenes/x.webp" srcset="javascript:alert(1) 1x">',
    '<img src="imagenes/x.webp" srcset="imagenes/x.webp 800w, data:image/svg+xml,x 1800w">',
    '<a href="file:///etc/passwd">x</a>',
    '<a href="blob:https://x.example/1">x</a>',
    '<a href="filesystem:https://x.example/x">x</a>',
    '<a href="https://x.example" target="_blank">x</a>',
    '<a href="https://x.example" rel="opener">x</a>',
    '<a href="https://x.example" ping="https://x.example/ping">x</a>',
  ],
  'recursos de otro origen en el informe': [
    '<img src="https://x.example/rastreo.png" alt="">',
    '<img src="//x.example/rastreo.png" alt="">',
    '<img src="\\\\x.example/rastreo.png" alt="">',
    '<img src="/\\x.example/rastreo.png" alt="">',
    '<img src="imagenes/x.webp" srcset="https://x.example/rastreo.png 800w" alt="">',
  ],
  'comentarios, declaraciones y entidades rotas': [
    '<!--><img src=x onerror=alert(1)>-->',
    '<!-- --!><img src=x onerror=alert(1)> -->',
    '<!-- a --><img src=x onerror=alert(1)><!-- -->',
    '<!-- <img src=x onerror=alert(1)> -->',
    '<!--',
    '<!DOCTYPE html><p>x</p>',
    '<?xml version="1.0"?><p>x</p>',
    '<p>x</p><',
    '<p>x</ p>',
    '<p>x</p><img',
    '< script>alert(1)</script>',
    '<p>x &amp y</p>',
    '<p>x &lt</p>',
    '<p title="a &quot b">x</p>',
  ],
  'un orden de Tab propio': [
    '<a href="https://x.example" tabindex="1">x</a>',
    '<p tabindex="0">x</p>',
    '<section tabindex="-2">x</section>',
    '<p tabindex>x</p>',
  ],
  'elementos que no escribe el motor': [
    '<h1>x</h1>',
    '<em>x</em>',
    '<template><script>alert(1)</script></template>',
    '<select><option>x</option></select>',
    '<dialog open>x</dialog>',
    '<slot name="x"></slot>',
    '<custom-element>x</custom-element>',
  ],
};

/**
 * Lo que sí escribe el motor, en sus formas extremas: debe pasar tal cual. Los fragmentos de HTML largos se dejan
 * enteros, en una línea, para poder buscarlos tal cual en los informes de los testigos.
 */
const ADMITIDOS = Object.freeze([
  '',
  'Solo texto, con &lt;script&gt; escapado y comillas "sueltas" y \'simples\' y un &gt; suelto >.',
  '<section class="informe"><h2 id="t">Tus tareas</h2><p>&lt;script&gt; son = 3 tareas</p></section>',
  '<a href="https://www.sepe.es/ruta?x=1&amp;y=2" hreflang="es" target="_blank" rel="noopener noreferrer">SEPE</a>',
  '<a href="creditos.html#f-12">Fuente · 12</a>',
  '<a href="tel:+34900000000">900 000 000</a>',
  '<a href="mailto:hola@faro.example">Correo</a>',
  '<a class="secundaria" href="recorrido.html">Empezar de nuevo</a>',
  '<button type="button" class="info-grupo" popovertarget="nombre-oficial" aria-label="Nombre oficial">i</button>',
  '<p id="nombre-oficial" popover role="note">Nombre</p>',
  '<button type="button" class="desplegar" aria-expanded="true" aria-controls="f1" hidden data-detalle>x</button>',
  '<svg class="icono" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M1 1h3"/></svg>',
  '<svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16" fill="none" stroke-width="5" stroke-dasharray="40 60" stroke-dashoffset="25"></circle><text x="21" y="21" text-anchor="middle" class="n">4</text><rect x="0" y="0" width="10" height="2" rx="1" class="b"></rect></svg>',
  '<img src="imagenes/fotografias/faro-penmon.webp" srcset="imagenes/fotografias/faro-penmon-800.webp 800w, imagenes/fotografias/faro-penmon.webp 1800w" sizes="(max-width: 700px) 100vw, 1040px" alt="" width="1800" height="1200" />',
  '<template data-aprendizaje>{&quot;plan&quot;:[1,2]}</template>',
  '<fieldset class="opciones" hidden><legend class="solo-lectores">Opción</legend><button type="button" aria-pressed="true" data-opcion="una">Una</button></fieldset>',
  '<table><caption class="solo-lectores">Datos</caption><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td class="n">1</td></tr></tbody></table>',
  '<span lang="ca" data-nivel="2" data-valor="0,5">x</span><i data-ancho="40" data-banda="alta"></i>',
  '<p>a&nbsp;b &middot; c &#8212; d &#x2014; e</p>',
  '<!-- 01 · Primer bloque --><section class="bloque"></section>',
  '<a class="salto" href="#plan-de-aprendizaje">Saltar a mi plan de aprendizaje</a>',
  '<section class="aprendizaje" id="plan-de-aprendizaje" tabindex="-1" aria-label="Mi plan">x</section>',
]);

test('el HTML que escribe el motor, en sus formas extremas, pasa tal cual', () => {
  for (const html of ADMITIDOS) {
    assert.equal(htmlDeConfianza(html), html, html);
  }
});

for (const [familia, casos] of Object.entries(PELIGROSOS)) {
  test(`faro-informe rechaza ${familia}, por la regla de su familia`, async (contexto) => {
    const motivo = MOTIVOS[familia];
    assert.ok(motivo);
    for (const html of casos) {
      await contexto.test(JSON.stringify(html), () => {
        rechazadoPor(html, motivo);
        // Dentro de un informe válido, igual: lo peligroso no se diluye entre lo bueno.
        rechazadoPor(`<section class="informe"><p>Antes</p>${html}<p>Después</p></section>`, motivo);
      });
    }
  });
}

test('un informe muy largo o muy anidado se examina entero, sin colgarse', () => {
  const largo = '<p>x</p>'.repeat(EN_UN_INFORME_LARGO);
  assert.equal(htmlDeConfianza(largo), largo);
  const anidado = `${'<div>'.repeat(EN_UN_INFORME_ANIDADO)}${'</div>'.repeat(EN_UN_INFORME_ANIDADO)}`;
  assert.equal(htmlDeConfianza(anidado), anidado);
  // Lo peligroso al final de un informe largo no se diluye.
  rechazadoPor(
    `${largo}<script>alert(1)</script>`,
    MOTIVOS['guiones y elementos ejecutables'] ?? assert.fail('falta motivo'),
  );
});

test('faro-guiones admite los guiones propios solo dentro de la web, no en otra carpeta de la misma longitud', () => {
  const raiz = new URL('../../web/', import.meta.url);
  const propio = new URL('service-worker.js', raiz);
  assert.equal(urlDeGuion(propio), propio.href);
  assert.throws(() => urlDeGuion(new URL('scripts/pdf/worker.js', raiz)), GuionNoAdmitido);
  // La misma longitud que la ruta de la web, pero otra carpeta: cortar por longitud la daría por propia.
  const ajena = `/${'x'.repeat(raiz.pathname.length - 2)}/service-worker.js`;
  assert.throws(() => urlDeGuion(new URL(ajena, raiz)), GuionNoAdmitido);
});

test('la política general rechaza el guion externo del desafío y sus variantes', () => {
  const guion = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  for (const direccion of [guion, `${guion}?render=explicit`, `${guion}#fragmento`]) {
    assert.throws(() => urlDeGuion(direccion), GuionNoAdmitido);
  }
});
