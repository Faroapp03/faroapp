# Guía de comentarios

Un comentario cuenta lo que el código no puede decir por sí mismo: por qué es así, qué contrato cumple y qué límites
respeta. Los nombres, los tipos y la estructura evitan tener que explicar lo obvio. Esta guía se aplica a TypeScript,
JavaScript, Python, HTML y CSS, y a los documentos que acompañan al código.

## Lo que se comenta

- **Contratos.** Qué recibe y qué devuelve una función pública, qué errores lanza y en qué casos. En TypeScript, con
  `/** … */` sin repetir los tipos que ya declara la firma. En Python, con docstrings estilo Google (`Args`, `Returns`,
  `Raises`), según la configuración de Ruff del proyecto. Las secciones se usan cuando aportan información.
- **Razones no evidentes.** La alternativa descartada y su motivo, un límite de la plataforma, una decisión de
  seguridad o de rendimiento. Ejemplo: «crossorigin, porque la regla solo admite huellas comprobadas en modo CORS».
- **Invariantes, unidades y límites.** Qué acota una recursión o termina un bucle, en qué unidad va una magnitud si el
  nombre no lo dice y qué tamaño máximo admite una entrada. Ejemplo: «Termina porque `posicion` crece en cada vuelta y
  `tabla` es finita».
- **Procedencia.** De dónde sale un dato transcrito a mano (fuente, edición, tabla o página) y su licencia.
- **Cabecera de archivo.** Breve y en presente: qué es el archivo y por qué existe, cuando no resulta evidente.
  En TypeScript y JavaScript puede ser un comentario `//`; en Python, el docstring del módulo. La extensión responde
  a lo que necesita entender quien lo mantiene, sin desplazar cabeceras obligatorias del formato.

## Comentarios que leen las herramientas

No se retiran como limpieza editorial; cualquier cambio debe comprobar su efecto:

- Los tipos JSDoc del JavaScript de navegador (`@type`, `@typedef`, `@import`, `@param`, `@returns`): TypeScript los
  comprueba como código.
- Las directivas `biome-ignore`, `@ts-expect-error`, `# noqa` y `# type: ignore`. Cada una lleva su motivo y se retira
  cuando deja de hacer falta.
- Los docstrings de las órdenes de Python que se muestran como ayuda (`argparse.ArgumentParser(description=__doc__)`).
  Se escriben para quien ejecuta la orden, no para quien lee el código.
- Los avisos de licencia y atribución, en el código propio y en el de terceros.

El bloque JSDoc debe quedar asociado a la declaración que documenta; separar ambos puede hacer que el editor o el
analizador deje de reconocerlo.

## Lo que no va en un comentario

- **Historia.** Cómo era antes, qué se cambió, qué versión sustituye a cuál. La historia vive en el control de
  versiones y en el registro de cambios. Una compatibilidad que siga vigente se describe como contrato actual: qué
  formatos se aceptan y por qué.
- **Notas sobre cómo se hizo.** Etapas del proyecto, tandas de trabajo, revisiones, entornos o herramientas con las
  que se escribió el código. Las funciones se nombran por lo que hacen en el producto, no por la etapa en que se
  crearon.
- **Referencias que no se pueden comprobar.** Una ruta, una orden o un documento citados deben existir y ser útiles
  para quien mantiene el código. Una ruta generada, un ejemplo o una entrada operativa se identifica como tal y
  explica cómo se obtiene. Si la referencia no aporta nada, se quita.
- **Rutas personales o de otros equipos**, y datos personales.
- **Paráfrasis del código** («incrementa el contador») y **código comentado**.
- **Comentarios que contradicen el código.** Se corrige el que esté mal, sea el comentario o el código.

## Pendientes

Un pendiente funcional no desaparece al borrar su comentario. Se resuelve o se registra en la sección «Límites» del
documento del área, en `docs/`, con lo que falta y lo que implica. En el código queda, si hace falta, el
comportamiento actual descrito como tal.

Antes de afirmar que falta una comprobación, se buscan sus casos y garantías por contenido, aunque la prueba citada
se haya renombrado o la cobertura esté repartida. Un enlace roto no demuestra que falte la comprobación. Si el área no
tiene documento propio, se usa la guía de operación o el README pertinente, sin duplicar el pendiente.

## Documentos que identifican una decisión

Un documento cuya huella identifica una regla admitida o una evidencia conserva sus bytes durante una limpieza.
Sus aclaraciones se publican en la documentación operativa que lo acompaña. Modificar esa decisión requiere el
procedimiento de revisión correspondiente; nunca se cambia su huella solo para que pase una comprobación.

## Mensajes que ven otras personas

Los mensajes de error, de consola y de registro forman parte del producto. Dicen qué ha pasado y qué puede hacerse,
sin secretos ni datos personales. Las indicaciones que solo sirven en el equipo de desarrollo van en la documentación
de operación, no en un mensaje que se publica.

## Archivos generados

Su origen y orden de generación se indican con «Archivo generado por `<orden>`. No se edita a mano.», cuando el
formato admite comentarios y la indicación aporta valor. En JSON u otros formatos que no los admiten, se documenta
en el README o manifiesto correspondiente. Se respetan shebang, declaración de codificación, doctype y licencias.
Se modifica la fuente y se vuelve a generar; nunca se mantienen dos versiones a mano.

## Estilo

- En castellano, en presente y en forma impersonal; frases completas, terminadas en punto.
- Ancho máximo de 120 caracteres, como el código.
- Breves: una explicación extensa puede ir al README del módulo o a `docs/`; contratos y razones necesarios para
  entender una función permanecen junto a ella.
- Comillas «», sin mayúsculas enfáticas ni emojis.

## Lo que se publica

La salida destinada a publicación debe omitir notas de desarrollo y comentarios prescindibles, conservando avisos
legales y directivas necesarias. Eso no cambia esta guía: el código fuente es lo que leerá quien mantenga Faro y debe
poder leerse entero.

## Cómo se comprueba

TypeScript, Biome y Ruff comprueban los tipos, las directivas y los docstrings. La revisión de cada cambio aplica el
resto de la guía. Comparar programas sin comentarios es una ayuda, no una demostración suficiente: hay comentarios y
docstrings que las herramientas o la propia aplicación interpretan.
