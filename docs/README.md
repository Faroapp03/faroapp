# Documentación de Faro

## Si es tu primera vez, lee en este orden

1. [README](../README.md): qué es Faro, el mapa de carpetas y cómo instalarlo, probarlo y servirlo.
2. [Arquitectura](arquitectura.md): principios, piezas, recorrido de una consulta y de un dato, calidad y glosario.
3. [Motores](../motores/README.md) y [código de la aplicación](../src/README.md): las capas del código y sus contratos.
4. [Recorrido de la web](../web/scripts/recorrido/README.md): los módulos que conversan con la persona.
5. [Plataforma de datos](../plataforma_datos/README.md) y [paquete oficial](../datos/README.md): de dónde sale cada dato.
6. [Construcción web](construccion-web.md) y [despliegue](despliegue.md): cómo se publica.
7. [Arnés de verificación](../scripts/README.md) y [pruebas](../pruebas/README.md): cómo se comprueba cada cambio.

Después, las guías se agrupan por tema.

## Instalar, configurar y operar

- [Inicio e instalación](../README.md): requisitos, dependencias y comprobaciones.- [Configuración](configuracion.md): variables, secretos, enlaces del entorno y autoridad de cada ajuste.
- [Operación local](operacion-local.md): arranque, funcionamiento del recorrido local y preparación de la instalación en detalle.
- [Construcción web](construccion-web.md): generación y comprobación de la salida publicable.
- [Portabilidad y transferencia](portabilidad.md): código, entradas operativas e instalación independiente.
- [Despliegue](despliegue.md): entrega, publicación y activación del mantenimiento.
- [Cloudflare](../config/cloudflare/README.md): adaptación al alojamiento y requisitos de despliegue.
- [Comprobaciones de navegador](../pruebas/navegadores/README.md): recorridos, salida y límites del ensayo.
- [Presupuesto de rendimiento](presupuesto-rendimiento.md): cómo se miden JavaScript, tiempos y tráfico por escenario y qué umbrales fallan.

## Administrar el servicio

- [Panel administrativo](administracion.md): autorización, sesión única y operaciones permitidas.
- [Motores locales](motores-locales.md): ejecución del recorrido y servicios de consulta.
- [Conexiones administradas](conexiones-administradas.md): autoridad, seguridad y conectividad del servicio.
- [Actualización remota](actualizacion-remota.md): programación, activación y recuperación de trabajos.
- [Comprobaciones periódicas](comprobaciones-periodicas.md): qué se consulta, qué se reconstruye y qué requiere revisión.

## Datos y contratos

- [Paquete oficial](../datos/README.md): función, procedencia y condiciones de los datos utilizados.
- [Cadena de actualización](../plataforma_datos/orquestacion/README.md): módulos, entradas y reconstrucción.
- [Almacenamiento y recuperación](almacenamiento-datos.md): conservación y traslado de entradas operativas.
- [API y OpenAPI](api/README.md): contrato público y generación de su documentación.
- [Acceso a datos](api/socios.md): consultas, credenciales y límites.
- [Conectividad e invitaciones](conectividad.md): encender servicios, conceder acceso y consultar su uso.
- [MCP y A2A](mcp.md): herramientas, descubrimiento y permisos.
- [Formación abierta](criterio-formacion-abierta.md): condiciones de inclusión de la oferta.
- [Regla de acreditación](regla-de-la-acreditacion.md): guía de la regla que respalda las relaciones admitidas; el
  documento fijado por huella es [`acreditacion/norma-fijada.md`](acreditacion/norma-fijada.md).

Las listas de acreditación se suministran como entradas operativas en
`var/actualizacion/revisiones/acreditacion/`. Su reconstrucción a partir de nuevos juicios no forma parte
de la cadena entregada; la [guía periódica](comprobaciones-periodicas.md) delimita esa revisión.
El documento de la regla conserva su identidad criptográfica; no debe editarse como una guía de instalación. Por eso
está aparte de las guías, solo en `acreditacion/`.

## Mantenimiento del código y condiciones

- [Guía de comentarios](guia-de-comentarios.md): contratos, decisiones y documentación útil del código.
- [Seguridad](../SECURITY.md): comunicación de incidencias y límites de responsabilidad operativa.
- [Confianza TLS](confianza-tls.md): certificados, dependencias y comprobaciones de las conexiones de mantenimiento.
- [Licencia del código](../LICENSE): condiciones vigentes de distribución.

`src/` contiene el dominio de la aplicación, los servicios y los adaptadores de plataforma; `motores/`,
los motores de ocupaciones y cursos con sus contratos y pruebas. `web/` contiene los recursos de la interfaz.
`scripts/` reúne las comprobaciones generales y `herramientas/`, las órdenes de construcción y operación.
`plataforma_datos/` organiza fuentes, contratos y actualización por temas; `datos/` es la entrega que consume la app.
Las pruebas Node están en `pruebas/` y `motores/<motor>/pruebas/`; las de Python acompañan a cada tema en
`plataforma_datos/<tema>/pruebas/`, incluida la orquestación común.
La plantilla de entorno y las del adaptador Cloudflare se describen en la guía de configuración.

## Convención de nombres

- `scripts/` es el arnés de verificación: lo que ejecutan `npm run verificar` y `npm test` para comprobar el producto
  (etapas, plazos, entorno de los navegadores, resumen de pruebas y guardia sin red de Python). `herramientas/` reúne
  las órdenes que preparan, construyen, publican u operan el producto, agrupadas por el ámbito sobre el que actúan.
  Las principales tienen su orden en `package.json`; las demás se lanzan con `node`, como
  `node herramientas/web/catalogo-cursos.ts` o `node herramientas/catalogo-cursos/firmas-editoriales.ts`.
- Los nombres de carpetas y archivos propios están en castellano. Conservan su nombre habitual los que esperan las
  herramientas o el ecosistema (`src/`, `docs/`, `scripts/`, `config/`, `package.json`, los `tsconfig*.json`,
  `biome.json`, `README.md`, `LICENSE`, `SECURITY.md` y `CHANGELOG.md`), los términos técnicos sin
  traducción asentada (`service-worker`, `api`, `mcp`, `a2a`, `pdf`) y `pruebas/fixtures/`, el nombre común de los datos de
  prueba fijados. Las bibliotecas de terceros de `web/terceros/` y las licencias de las tipografías (`LICENSE-*.txt`)
  conservan los nombres de su distribución.
- Fuera de `plataforma_datos/` y `datos/`, carpetas y archivos se escriben en minúsculas con guiones
  (`seleccion-formacion`, `comprobar-oficial.ts`). En `datos/`, la entrega generada, los nombres forman parte del
  contrato de lectura ([paquete oficial](../datos/README.md)): los vectores del móvil se llaman como las matrices que
  lee el motor de ocupaciones (`datos/vectores-movil/ocup_es.i8`, `ocup_ca.i8`, `alt_es.i8` y sus escalas). Los documentos de referencia de una carpeta van en mayúsculas (`README.md`, `FUENTE.md`,
  `RUBRICA.md`, `PUBLICACION.md`).
- Los paquetes y módulos de Python usan guiones bajos, porque Python solo importa nombres válidos como identificador:
  `plataforma_datos/`, sus carpetas y módulos, y `scripts/sin_red/`. Un guion de Python que se ejecuta como programa
  y no se importa sigue la regla general (`pruebas/ayudas/recibo-sintetico-vigente.py`), salvo una excepción:
  `scripts/pruebas_python.py`, que lanzan `scripts/verificar.ts` y sus pruebas como programa, lleva guion bajo.
  Los archivos de datos y documentos de `plataforma_datos/` llevan unos guiones bajos y otros guiones; un archivo
  nuevo sigue la forma de los de su carpeta.
- Las carpetas de `herramientas/` llevan el nombre del ámbito al que sirven, el mismo que en `src/` o `web/` cuando lo
  hay. Una carpeta con un solo archivo se mantiene cuando ese nombre dice sobre qué actúa la herramienta; su
  justificación está en el README que la enlaza.
