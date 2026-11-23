# Pruebas de la aplicación

Esta carpeta contiene pruebas de contratos, integración, seguridad, presentación y ejecución web. Las pruebas
propias de cada motor están en `motores/<motor>/pruebas/`; las de la plataforma de datos acompañan a sus temas.

Las pruebas de esta carpeta se agrupan por administración, API, acceso público, Cloudflare, conectividad,
formación, informe, motores, paquetes, plataforma, seguridad, datos de dominio, utilidades comunes y herramientas.

## Dónde vive cada prueba

- Junto a su código viven las pruebas de las piezas con límite propio, que se ejecutan y se entregan como una unidad:
  cada motor (`motores/<motor>/pruebas/`), cada tema de la plataforma de datos (`plataforma_datos/<tema>/pruebas/`,
  en Python, que ejecuta `scripts/pruebas_python.py`) y cada extensión instalada, en la carpeta de pruebas que declara
  su registro.
- En esta carpeta viven las pruebas de `src/`, `web/`, `herramientas/`, `scripts/` y `config/`, y las de integración
  entre componentes. Se agrupan por funcionalidad, una carpeta por grupo; `web-*/` agrupa las de cada componente de la
  interfaz y de su copia sin conexión. Un grupo con un solo archivo se mantiene cuando corresponde a un componente propio: `web-contacto/` (el
  contacto público), `web-paginas/` (la estructura y la accesibilidad básica de las páginas) y
  `web-recorrido-integracion/` (el contrato HTTP entre el motor y los lectores del recorrido).

Las carpetas de apoyo no contienen pruebas:

- `ayudas/`: montajes y funciones que comparten varias pruebas, como la guardia sin red (`sin-red.ts`), los servidores
  y motores de prueba o las comprobaciones locales de una entrega oficial.
- `fixtures/`: entradas fijadas que leen las pruebas: datos sintéticos e instantáneas públicas identificadas, como la
  del catálogo de cursos.
- `testigos/`: resultados esperados con los que se compara una salida, como las cifras del informe breve de referencia
  (`informe-breve-oficina.json`) o los periodos del mercado laboral (`mercado-periodos.json`).
- `datos/`: bancos de evaluación con su rúbrica y procedencia; una medición no sustituye una prueba técnica.

## Convenciones

- Los archivos `*.test.ts` y `*.test.js` prueban servicios y comportamiento local con entradas controladas.
- Formato: `*.test.ts` para contratos y servicios tipados; `*.test.js` cuando la prueba carga módulos web en
  JavaScript tal como se sirven; `*.test.mjs` cuando la prueba necesita un módulo ES sin TypeScript, como los
  recorridos con navegador. Cada `*.test.mjs` se declara en `scripts/pruebas-mjs.ts` como prueba de navegador, de
  unidad o ensayo con orden propia de `package.json` (fuera de las baterías, porque no cabe en su plazo); una sin
  declarar, o un ensayo sin su orden, hace fallar la verificación. Los `*.test.mjs` de la carpeta de pruebas de una extensión
  instalada se clasifican desde el registro como pruebas de navegador.
- [navegadores](navegadores/README.md) ejecuta recorridos reales en Chromium, Firefox y WebKit.
- `ensayo-miniflare-privado.mjs` es un ensayo manual de la entrada privada construida en `dist/`: comprueba con
  Miniflare y una clave sintética que, sin secreto, el Worker cierra con 503, que todo recurso exige credenciales,
  que con ellas la portada redirige y el inicio y la salud responden, y que MCP, A2A, socios y panel siguen apagados. Se ejecuta
  tras construir y antes de publicar en el ensayo, con el `sha256Artefacto` del resumen de la construcción:
  `node pruebas/ensayo-miniflare-privado.mjs "$SHA256_ARTEFACTO"`. Para una construcción privada guardada fuera de
  `dist/`, su carpeta va de segundo argumento. Arranca workerd con `navegadores/worker-miniflare.ts`, el arranque común
  de la construcción con la Miniflare fijada (ver [navegadores](navegadores/README.md)).
- Las pruebas de `cloudflare/` que terminan en `-workerd.test.ts` arrancan workerd con Miniflare en este equipo, sin
  red, con el código real empaquetado, y entran en la batería de unidad: `encuesta-workerd.test.ts` acredita el
  esquema de la encuesta en el SQLite de un objeto durable, `programacion-eventos-workerd.test.ts` la migración del
  historial de eventos de la programación de la versión 1 a la 2, y `salidas-workerd.test.ts`, con un servicio de salida
  simulado, que el despacho a GitHub, la consulta de la ejecución, las claves OIDC y el aviso del vigilante funcionan
  con una respuesta normal y rechazan una redirección. `salidas-sin-redirect-error.test.ts` es su guardia: falla si
  el modo `error` de `redirect`, que workerd rechaza, aparece en código al alcance de un Worker.
- La raíz de esta carpeta solo guarda este documento y el ensayo manual. Un montaje repetido con el mismo contrato se
  comparte desde `ayudas/`; una función local se conserva cuando su contrato difiere del de la ayuda.
- Los nombres describen lo que se comprueba. Un número de versión solo aparece cuando la prueba fija un formato
  versionado que el producto sigue leyendo, como `estado-datos-panel-v2` y `-v3`, o cuando repite el nombre del
  módulo que prueba.

Desde la raíz, `npm run verificar` comprueba tipos, formato, integridad y las suites Node y Python.
`npm test` ejecuta las suites, sin sustituir los demás controles. Para un caso concreto puede usarse
`node --import=./pruebas/ayudas/sin-red.ts --test pruebas/<archivo>.test.ts`; los recursos generados deben estar preparados según el manual de instalación.

La revisión editorial del catálogo conserva su instantánea pública del 25 de octubre de 2026 en
`fixtures/catalogo-clasificacion-20261025.utf8`, comprobada por huella mediante `ayudas/catalogo-clasificacion.ts`.
Sus recuentos históricos no obligan a que las siguientes actualizaciones mantengan las mismas ofertas.
`formacion/catalogo-cursos-renovacion.test.ts` comprueba también la publicación vigente con su propia referencia y el tratamiento
de ofertas nuevas. La instantánea de prueba no actualiza las fechas ni sustituye los datos del producto.

Las omisiones se informan separadas de las ejecuciones correctas. Las pruebas de seguridad usan identidades
y credenciales sintéticas. No se utilizan capturas privadas ni llamadas a proveedores para simular un resultado verde.
Cada fallo reproducido queda cubierto por una prueba que nombra el comportamiento esperado y el riesgo que protege.
El título y los comentarios describen el contrato vigente en presente, sin contar cuándo ni cómo apareció el fallo.
