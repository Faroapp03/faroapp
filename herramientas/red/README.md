# Identidad de los transportes

El generador de `plataforma_datos.comun.perfil_web` es la única implementación del perfil de Chrome.
`config/identidad-web.json` contiene solo UA y tres pistas públicas, sin HOME, cuentas, idioma ni opciones
privadas. Python, TypeScript, Worker y preloads consumen este mismo archivo. Python comprueba además que
la versión y las pistas coincidan con el generador canónico. Una configuración ausente o inválida impide
la consulta; no se toma otra del equipo ni se recuperan valores implícitos. No se incluyen cabeceras de
navegación HTML en APIs. El perfil HTML se define en el módulo común y no lee archivos personales.

Tras revisar una actualización del perfil, regenerar y comprobar desde la raíz:

```sh
python -m plataforma_datos.comun.exportar_identidad_web --version 156.0.0.0
python -m plataforma_datos.comun.exportar_identidad_web --comprobar
```

Git antes del checkout y curl antes de instalar Node necesitan valores públicos de bootstrap. Sus literales
se contrastan con el JSON en `workflow-mantenimiento.test.ts`; se actualizan conjuntamente, sin otro algoritmo
GREASE. La versión del ejemplo se sustituye por la versión contrastada. La escritura exige una versión
explícita y sustituye el archivo completo; repetirla con el mismo perfil no lo modifica. El exportador
no lee ni modifica configuraciones personales. La fuente mensual no activa automáticamente un nuevo perfil.

`identidad-http.cjs` se precarga exclusivamente en los instaladores npm y Playwright. Conserva opciones,
destinos, cuerpo, llamadas de retorno y verificación TLS de `http`/`https`; sobrescribe las cuatro cabeceras antes del
primer envío. Los procesos hijos de Playwright heredan el preload por `execArgv`. APT recibe únicamente
una UA genérica mediante `configurar-apt.ts`: no se le atribuye soporte de las tres pistas. El mismo archivo le da
solo las fuentes del archivo oficial de Ubuntu para las bibliotecas de los navegadores.

`identidad-wrangler.cjs` se precarga solo al lanzar el CLI privado. Antes de cargarlo comprueba la versión
y los SHA del lanzador y del paquete construido, fijados en `compatibilidad-wrangler.json`. La implementación comprobada
publica sus agentes mediante `Object.defineProperty` en `undici.globalDispatcher.1` y `.2`. El adaptador
intercepta exclusivamente esas publicaciones y conserva sus descriptores, delegando en el agente original;
no sustituye TLS, credenciales, firmas, destinos ni opciones ajenas. El registro de cabeceras de fetch y el
vector plano de dispatch se validan y reciben el mismo cuarteto. Un formato distinto se rechaza antes de
delegar. También se aplica el preload de `http`/`https`. Esta mutación global existe solo en ese proceso.

Una actualización de Wrangler exige revisar el transporte del paquete construido nuevo y repetir las pruebas sin red
antes de cambiar sus huellas. No basta con actualizar una versión ni interceptar `globalThis.fetch`.
No se modifica `node_modules`, no se ejecutan despliegues en las pruebas y no se concede una excepción
de identidad a APIs con credenciales. Las pruebas de compatibilidad cargan el paquete construido como biblioteca con
HOME temporal y sockets prohibidos. Las capturas y recibos históricos conservan su identidad observada.
