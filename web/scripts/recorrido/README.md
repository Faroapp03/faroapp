# Recorrido

Estos módulos coordinan las decisiones de la persona y las consultas al motor de Faro. Los datos oficiales, las
referencias y la construcción del informe pertenecen al motor; el cliente conserva su contrato y presenta sus
respuestas.

`../recorrido.js` conecta los pasos y coordina su ciclo de vida. La página conserva el estado de la conversación
en memoria; los módulos de cada paso reciben acciones concretas y presentan las respuestas del motor.

| Responsabilidad | Módulos |
| --- | --- |
| Escritura y conversación | `compositor.js`, `conversacion.js`, `ayudas.js`, `saludo.js` |
| Navegación, espera y accesibilidad | `navegacion.js`, `pagina.js`, `guia.js`, `altura-visible.js`, `enlaces-de-salida.js` |
| Diálogo con el motor local | `motor.js`, `espera-del-motor.js`, `flujo-local.js`, `contrato-preguntas.js`, `ocupacion-local.js` |
| Ocupación y relato | `paso-ocupacion.js`, `lista-oficial.js`, `tarjeta-*.js` |
| Selección y revisión de tareas | `paso-tareas.js`, `fila-tarea.js`, `revision.js` |
| Informe e intercambio entre dispositivos | `paso-informe.js`, `../otro-dispositivo/` |
| Idioma de los datos | `idioma-de-los-datos.js` |

- `estado.js` conserva la ocupación, las tareas y la hoja de ruta confirmada en memoria. `flujo-ocupacion.js`
  define las transiciones de la selección de ocupación sin depender del DOM ni de la red.
- `api.js` define las operaciones del recorrido. `traduccion-api.js` construye sus cuerpos e interpreta sus
  respuestas; `datos-traducidos.js` reúne las traducciones recibidas sin reemplazar los datos de origen.
- `api/transporte.js` utiliza únicamente el motor del dispositivo y conserva los plazos, la cancelación y la
  validación de respuestas. El plazo incluye la carga del filtro, aunque su importación siga pendiente.
- `minimizar.js` carga el filtro compartido antes de procesar el texto. Si no puede cargarlo, se rechaza la operación;
  solo se retiran los datos personales que el filtro reconoce.
- `tareas-libres.js` conserva cada entrada como un literal limpio, sin dividirla ni atribuirle referencias o notas.
  La persona puede elegir una tarea oficial; en otro caso, la ausencia de nota se mantiene explícita.
- `memoria-llamadas.js` comparte peticiones equivalentes en curso y conserva un número limitado de respuestas en
  memoria. `formato.js` contiene las operaciones de formato y comparación del texto.

Cancelar las peticiones, reiniciar el estado y vaciar las memorias de llamadas y traducciones son operaciones
distintas. Quien controla el ciclo de vida del recorrido debe coordinarlas para que una respuesta antigua no vuelva
a introducir datos después de empezar de nuevo. Estos módulos no guardan el contenido del recorrido en los almacenes
del navegador; las preferencias de idioma tienen su propio ciclo de vida fuera de este directorio.

El informe recibido desde otro dispositivo se reconstruye con el paquete local. Su código se retira del fragmento
de la dirección al cargar la página; no se envía al servidor. `../webmcp.js` ofrece únicamente herramientas de
lectura del motor local cuando el navegador dispone de esa capacidad; no lee la conversación.

Las pruebas están en `pruebas/web-recorrido-*/` y forman parte de `npm run verificar`. La construcción web
regenera las huellas y los catálogos con `npm run web:preparar`.
