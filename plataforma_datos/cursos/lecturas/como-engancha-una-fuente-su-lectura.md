# Cómo engancha una fuente su lectura

Cada fuente emite su lectura al terminar de recibir su censo. Solo registra: no cambia lo que se publica. Cibernàrium
es el ejemplo (`fuentes/barcelonactiva/lectura.py`); las demás fuentes siguen los mismos pasos.

## Pasos

1. **Un módulo `lectura.py` en la carpeta de la fuente.** Recibe lo que la adquisición ya sabe y construye un
   `Censo` por ámbito. No importa la adquisición: es ella la que lo importa a él. Así no aparece ningún ciclo.
2. **Una sola línea en la adquisición.** Va al final de `descargar`, después de guardar la procedencia, y devuelve su
   resultado. En Cibernàrium:
   `return lectura.emitir(original, primera, actividades_vistas, ediciones_nativas, completa=not parcial)`.
3. **Cada dato sale de lo que la adquisición ya calcula.** Nada se vuelve a pedir a la red y nada consulta el reloj:
   - la hora es la del recibo de la captura, escrita en UTC y al segundo;
   - el censo completo y su motivo: una consulta caída da `consulta_fallida`;
   - los identificadores presentes;
   - el recuento bruto (lo que trajo la captura) y el vigente;
   - el total que declara la fuente, o `None` si no lo declara;
   - los niveles y las rutas de campos de la captura;
   - los valores nuevos en los vocabularios cerrados que la fuente valida.
4. **Una función que explica cada salida.** Recibe el identificador de un curso que estaba en la lectura anterior y
   ya no está. Devuelve `fin_publicado`, `fuente_declara_baja` o `None`. Lo que se sabe del curso que sale está en el
   catálogo instalado, porque la captura de hoy ya no lo trae.
5. **Una función `declaraciones(lectura, …)` para la regla de retirada.** Devuelve, por curso, las `Declaracion` de
   `retirada_por_evidencia.py`: canal, huella del dato literal que lo dice y `cierra_el` para el fin publicado. Antes
   comprueba que los datos son los de la captura de esa lectura: sus identificadores deben dar `ids_sha256`.
6. **El registro nunca detiene la adquisición.** `emitir` recoge los errores de los datos y del disco (`ValueError`,
   `OSError`) y los devuelve en `Resultado.problemas`. Un defecto del código no se esconde.
7. **Pruebas sin red, con las capturas de prueba de la fuente.** Hay que comprobar estos casos:
   - dos ciclos dan dos lecturas encadenadas por ámbito;
   - una salida con su fin pasado queda explicada y una sin nada que la explique queda en `None`;
   - un censo incompleto da una lectura incompleta;
   - un valor fuera de vocabulario queda anotado;
   - una emisión que falla no cambia la procedencia;
   - las declaraciones citan su lectura;
   - si el historial lo permite, un caso real.

## Decisiones que toma cada fuente

| Decisión | Cibernàrium | FUNDAE (Digitalízate) |
|---|---|---|
| Ámbitos | `cibernarium:edicion` (cada `listEditions`) y `cibernarium:programa` (cada actividad) | `fundae:digitalizate`: cada recurso del censo, con el identificador de su programa (`fundae:1:<id>`) |
| Hora de la lectura | `fin_utc` de la primera página del censo, la misma que usan los contrastes de ediciones | fin de la consulta de la lista de proveedores activos, que abre el censo |
| Censo incompleto | alguna página caída (`parcial`) da `consulta_fallida`; sin la primera página no hay censo ni lectura | `censo_digitalizate.leer` no lo da por completo (ficha caída, recuento descuadrado o forma inesperada): `consulta_fallida`; sin la lista de proveedores no hay censo ni lectura |
| Total declarado | programas: `numActivities` de la API; ediciones: `None`, porque la API no lo declara | suma de `numeroCursos` de los proveedores activos |
| Vigente | sin fin publicado alcanzado a la hora de la lectura y sin inscripción cerrada | tipo «Curso» y sin `baja: true` |
| Forma | niveles `actividad` y `edicion`; rutas `actividad.<campo>` y `edicion.<campo>` de toda la captura | nivel `programa`; rutas `programa.<campo>` de los recursos de toda la captura |
| Vocabulario cerrado | `edicion.registrationCode`: los códigos de `edicion_ia.CODIGOS_INSCRIPCION` y `DISP2` | ninguno: la fuente solo valida el par «Curso» y los tipos que declara cada ficha |
| Explicar una salida | edición: su fin publicado en el catálogo ya llegó; programa: todas sus ediciones conocidas terminaron | estaba con la baja declarada en el censo del ciclo anterior: `fuente_declara_baja` |
| Baja declarada | ninguna: Cibernàrium no da de baja nada en su censo | `baja: true` en la ficha de un proveedor activo |
| Declaraciones | fin publicado, inscripción cerrada (`DISP2` concordante) y sin plazas (`DISP3`), por edición | baja declarada, por recurso presente |

Para cada fuente nueva hay que decidir lo mismo. Si publica bajas, como el `erased` de Cibervoluntarios o el
`baja:true` de FUNDAE, explican la salida con `fuente_declara_baja` y son también su declaración `baja_declarada`. Si
no tiene censo, como Anthropic, su lectura es `completa=False` con `sin_censo`.
