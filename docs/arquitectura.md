# Arquitectura de Faro

Esta guía explica cómo está construido Faro: los principios que sigue el código, las piezas y de qué depende cada una,
el recorrido de una consulta y el de un dato, cómo se protege la calidad y los términos propios del proyecto. Para
instalarlo y probarlo, empieza por el [README](../README.md).

## Principios de diseño

| Principio | Qué significa | Por qué | Dónde se ve |
| --- | --- | --- | --- |
| Cálculo en el dispositivo | El recorrido de la persona se calcula en su navegador, en un Worker dedicado, con el mismo motor que el servidor. | Lo que la persona escribe sobre su trabajo no tiene que salir de su dispositivo. | `web/scripts/recorrido/api/transporte.js`, `web/scripts/motor-local/worker.js` |
| Filtro de datos personales | Antes de procesar un texto, el dispositivo retira los datos personales que reconoce; si el filtro no carga, no se procesa. | Una descripción del trabajo puede incluir nombres o contactos. | `web/scripts/recorrido/minimizar.js`, `src/seguridad/privacidad.ts` |
| Motores independientes | Ocupaciones y Cursos tienen su entrada pública y no se importan entre sí; los tipos comunes viven en `compartido/`. | Cada motor se prueba, se sella y se sustituye por separado. | `motores/README.md`, `pruebas/motores/motores-independientes.test.ts` |
| Datos con procedencia y huella | Cada archivo del paquete figura en `datos/manifiesto.json` con su SHA-256, y se comprueba al leerlo, en Node y en el navegador. | Un archivo a medias o de otra versión no llega nunca al motor. | `datos/README.md`, `src/plataforma/navegador/paquete.ts` |
| Funcionamiento sin conexión | El service worker guarda la web y el paquete con sus huellas, y el motor solo lee esas copias comprobadas. | Faro sigue orientando sin red una vez guardada la copia. | `src/service-worker/paquete.js`, `src/service-worker/comprobado.js` |
| Verificación con una sola orden | `npm run verificar` ejecuta todos los controles y todas las pruebas, con plazos medidos. | Un cambio se da por bueno solo si pasa la misma comprobación completa. | `scripts/verificar.ts` |
| Castellano y catalán con un contrato común | Los textos del informe en catalán tienen la misma estructura tipada que los castellanos. | Un texto que falta en un idioma es un error de tipos, no un hueco en pantalla. | `src/dominio/textos-informe.ts`, `src/dominio/textos-informe-ca.ts`, `web/idiomas/` |

## Las piezas

| Pieza | Qué hace | Dónde vive y por dónde empezar | Depende de |
| --- | --- | --- | --- |
| Web | Páginas, estilos y módulos de la interfaz; el recorrido conversa con la persona y presenta las respuestas del motor. | `web/recorrido.html`, `web/scripts/recorrido.js`, `web/scripts/recorrido/README.md` | Motor en el dispositivo, textos de `web/idiomas/` |
| Service worker | Guarda la web y el paquete de datos, comprueba sus huellas y sirve esas copias al motor. | `src/service-worker/paquete.js`, `src/service-worker/copia.js`, `src/service-worker/comprobado.js` | Construcción de la web, que le da sus listas con huella |
| Motor en el dispositivo | Worker dedicado que carga el motor empaquetado y responde a la página como si fuera la API. | `web/scripts/motor-local/worker.js`, `web/scripts/motor-local/cliente.js`, `src/plataforma/navegador/motor.ts` | Service worker, motores, dominio |
| Motor de ocupaciones | Busca la ocupación a partir de lo que escribe la persona, hace las preguntas para afinarla y da sus tareas. Está sellado. | `motores/ocupaciones/README.md`, `motores/ocupaciones/src/index.ts`, `motores/ocupaciones/sello.json` | Paquete de datos (`esco.json`, `oit.json`, vectores) |
| Motor de cursos | Responde consultas factuales sobre la formación del paquete; la selección personal se hace en el dispositivo. | `motores/cursos/README.md`, `motores/cursos/src/index.ts` | `compartido/contratos/`, paquete de datos |
| Selección de formación | Elige formación gratuita y vigente para el plan de la persona. | `src/seleccion-formacion/README.md`, `src/seleccion-formacion/seleccionar.ts` | Catálogo de cursos (`src/catalogo-cursos/`) |
| Dominio | Reglas de interpretación y composición del informe: referencias de la OIT, grupos, contexto y textos. | `src/dominio/README.md`, `src/dominio/informe-breve.ts`, `src/dominio/referencias.ts` | Paquete de datos |
| Presentación | Convierte el informe en HTML; la impresión y el PDF los hace el propio navegador. | `src/presentacion/README.md`, `src/presentacion/informe-breve.ts`, `web/scripts/pdf/impresion.js` | Dominio |
| Servicios de Cloudflare | Worker principal (web, paquete, API, MCP/A2A, panel y tarea programada) y Worker de Cursos, al que solo llama el principal. | `src/plataforma/cloudflare/worker-oficial.ts`, `src/plataforma/cloudflare/worker.ts`, `src/plataforma/cloudflare/worker-cursos.ts`, `config/cloudflare/README.md` | Construcción en `dist/`, almacenes durables |
| Administración | Panel con identidad autorizada: secciones, conectividad, estado de los datos y solicitudes de actualización. | `src/administracion/`, `web/administracion/`, `docs/administracion.md` | Servicios de Cloudflare o servidor Node |
| API, MCP y A2A | Consultas factuales de datos públicos para otras entidades y asistentes; se entregan apagadas. | `src/api/README.md`, `src/api/api.ts`, `src/api/mcp/`, `src/api/a2a/`, `docs/api/README.md` | Motores, dominio |
| Plataforma de datos | Lee cada fuente oficial, la valida con su contrato, conserva su vigencia y exporta el paquete. | `plataforma_datos/README.md`, `plataforma_datos/orquestacion/actualizar.py`, `plataforma_datos/orquestacion/exportar_paquete.py` | Fuentes oficiales, `var/` |
| Herramientas de construcción | Construyen la web y los Workers, generan publicaciones y despliegan. | `herramientas/README.md`, `herramientas/web/construir.ts`, `herramientas/cloudflare/desplegar.ts` | Todo lo anterior |

El servidor local de Node (`src/plataforma/node/servidor.ts`, que arranca `npm run servir`) compone la misma API y
sirve la web construida, para trabajar sin Cloudflare.

## El recorrido de una consulta

1. **La página arranca.** `web/recorrido.html` carga `web/scripts/recorrido.js`, que conecta los pasos. El service
   worker guarda la web y el paquete de datos (`src/service-worker/paquete.js`).
2. **La persona escribe a qué se dedica.** El compositor (`web/scripts/recorrido/compositor.js`) recoge el texto y
   `web/scripts/recorrido/api.js` prepara la petición.
3. **El texto se filtra en el dispositivo.** `web/scripts/recorrido/api/transporte.js` aplica el filtro de datos
   personales (`web/scripts/recorrido/minimizar.js`) y entrega la petición al motor local, nunca a la red.
4. **El motor local responde.** `web/scripts/motor-local/cliente.js` pasa la petición al Worker dedicado
   (`web/scripts/motor-local/worker.js`), que comprueba el motor y el paquete contra sus huellas y la resuelve con
   `src/plataforma/navegador/motor.ts`.
5. **Faro identifica la ocupación.** El motor de ocupaciones (`motores/ocupaciones/src/index.ts`) busca en ESCO,
   hace las preguntas necesarias y la persona confirma su ocupación (`web/scripts/recorrido/paso-ocupacion.js`).
6. **La persona elige sus tareas.** `web/scripts/recorrido/paso-tareas.js` muestra las tareas oficiales; una tarea
   escrita a mano se conserva tal cual (`web/scripts/recorrido/tareas-libres.js`).
7. **Faro compone el informe.** `web/scripts/recorrido/paso-informe.js` pide el informe breve. El dominio estima cada
   tarea con las referencias de la OIT (`src/dominio/referencias.ts`), compone el informe (`src/dominio/informe-breve.ts`)
   y la presentación lo convierte en HTML (`src/presentacion/informe-breve.ts`).
8. **Faro propone el plan de formación.** `web/scripts/recorrido/formacion/cliente.js` pide al motor local la ruta
   `/local/formacion/seleccionar` (`src/plataforma/navegador/ruta-formacion.ts`), que elige formación gratuita y
   vigente con `src/seleccion-formacion/seleccionar.ts`. El perfil de formación no sale del dispositivo.
9. **La persona se lleva su resultado.** Puede imprimirlo o guardarlo como PDF desde el navegador
   (`web/scripts/pdf/impresion.js`), descargar su calendario (`web/scripts/recorrido/plan-formacion/calendario-ics.js`)
   o pasarlo a otro dispositivo con un código en el fragmento de la dirección, que no llega al servidor
   (`web/scripts/otro-dispositivo/fragmento.js`).

**Qué queda guardado y dónde.** La conversación, la ocupación y las tareas viven solo en la memoria de la página
(`web/scripts/recorrido/estado.js`). En el dispositivo quedan la copia de la web y del paquete (almacén del service
worker), las preferencias de idioma y tema (`localStorage`) y la clave con la que el motor firma sus propias
estimaciones (IndexedDB, `web/scripts/motor-local/secreto-firma.js`). «Borrar todo» retira las tres cosas
(`web/scripts/borrar-datos.js`).

## El recorrido de un dato

1. **Lector de la fuente.** Cada fuente oficial tiene su lector en el tema al que pertenece, por ejemplo
   `plataforma_datos/ocupaciones/fuentes/esco/`. Descarga o recibe los originales y los guarda en `var/actualizacion/`.
2. **Validación.** Los contratos de `plataforma_datos/contratos/` comprueban estructura, procedencia, licencia y
   vigencia; una fuente que no los cumple no se admite.
3. **Paquete con huellas.** `plataforma_datos/orquestacion/exportar_paquete.py` escribe en `datos/` los archivos
   admitidos y su manifiesto con la huella SHA-256 de cada uno.
4. **Copia en el dispositivo.** La construcción publica el paquete con la web; el service worker lo guarda y el
   motor lo comprueba contra el manifiesto antes de usarlo (`src/plataforma/navegador/paquete.ts`).

**Cómo se actualiza solo cada día.** El Worker principal tiene una tarea programada (`scheduled` en
`src/plataforma/cloudflare/worker.ts`) con un único horario diario (`config/cloudflare/programacion.example.jsonc`).
La tarea reserva un trabajo en el almacén durable y lanza el workflow de GitHub `.github/workflows/actualizar.yml`.
El workflow pide permiso de inicio, lee las fuentes cuya cadencia ha vencido, prepara y valida módulo a módulo
(`plataforma_datos/orquestacion/actualizar.py`) y conserva cada módulo válido aunque otro falle. Al terminar, envía
al servidor un recibo autenticado con la identidad de GitHub; solo un recibo validado permite activar el paquete
nuevo. Un fallo queda en el historial con su fase y su motivo, y el vigilante del panel lo muestra. La
[actualización remota](actualizacion-remota.md) explica cada paso, la recuperación y los avisos.

## Cómo se protege la calidad

`npm run verificar` (`scripts/verificar.ts`) se detiene en el primer paso que falla, y en este orden comprueba:

1. La base ESCO local, que el motor de ocupaciones necesita para sus pruebas.
2. Los tipos de TypeScript y del JavaScript de la web, y el estilo con Biome.
3. Que cada archivo generado coincide con su generador: vectores, informe de ejemplo, utilidades compartidas, datos
   globales, Biblioteca y contrato OpenAPI.
4. Que las fuentes de `web/` no llevan generados de la construcción, la construcción de la web local con su copia sin
   conexión, la construcción aislada de Cloudflare y las huellas CSP de las páginas de entrada.
5. El intérprete de Python con SQLite y FTS5, y el estilo y el formato de Python con Ruff.
6. Las pruebas de unidad de Node, las de navegador y las de Python. Cada archivo de pruebas tiene que informar, y solo
   se admiten las omisiones de una lista cerrada (`scripts/resumen-pruebas.ts`).

**Límites automáticos.** Biome limita cada función a 40 líneas y a una complejidad cognitiva de 12, y cada archivo a
400 líneas (`biome.json`). Las excepciones de tamaño están en `scripts/tamano-de-archivos.json`, cada una con su
techo y su motivo; `plataforma_datos/comun/pruebas/test_tamano_de_archivos.py` mide Python y comprueba que la lista
coincide con `biome.json`.

**El motor sellado y su banco.** `motores/ocupaciones/sello.json` guarda la huella de cada archivo protegido del
motor de ocupaciones, y `npm run ocupaciones:comprobar-sello` la comprueba. Cambiar un archivo protegido exige
demostrar con el banco de evaluación (`motores/ocupaciones/banco/README.md`, 2.112 frases y 2.473 personas simuladas)
que lo que vive cada persona en pantalla no cambia.

## Glosario

- **Paquete**: los archivos de datos de `datos/` que leen los motores, inventariados con su huella en
  `datos/manifiesto.json`. En la web construida se publica en `paquete/`.
- **Huella**: el SHA-256 de un archivo. Si los bytes cambian, la huella deja de coincidir y el archivo no se usa.
- **Sello**: la lista de huellas de los archivos protegidos del motor de ocupaciones (`motores/ocupaciones/sello.json`).
- **Banco**: las frases con las que se mide el motor de ocupaciones, simulando a una persona por cada grupo válido de
  cada frase, para comprobar que un cambio no altera lo que se ve en pantalla.
- **Copia sin conexión**: la web y el paquete que guarda el service worker en el dispositivo, comprobados por huella.
- **Motor local**: el motor de Faro ejecutado en un Worker dedicado del navegador.
- **Vigencia**: si una oferta, un enlace o una cifra siguen valiendo en una fecha, según la política de su fuente
  (`plataforma_datos/cursos/vigencia.py`). Una fecha de consulta no basta para darla por vigente.
- **Edición**: una convocatoria concreta de un curso, con sus fechas y su lugar. Una variante o un anuncio no se
  convierten en una edición confirmada.
- **Generación operativa**: el paquete vigente de `datos/` junto con las entradas de `var/actualizacion/` que necesita
  la cadena periódica, que se trasladan juntas (`plataforma_datos/orquestacion/generacion_operativa.py`).
- **Reserva**: el registro de un trabajo de actualización en el almacén durable antes de lanzarlo; solo una reserva
  nueva autoriza lanzar el workflow, y caduca si no empieza a tiempo.
- **Recibo**: el resultado que envía el workflow al terminar, autenticado con la identidad de GitHub. Solo un recibo
  validado permite activar los datos nuevos.
- **Vigilante**: la comprobación del panel que evalúa el estado de los datos y de las actualizaciones y avisa de
  los fallos (`src/administracion/vigilante.md`).
- **Extensión**: un mecanismo para añadir variantes del recorrido; la entrega no tiene ninguna instalada
  (`src/plataforma/extensiones-instaladas.ts`).
