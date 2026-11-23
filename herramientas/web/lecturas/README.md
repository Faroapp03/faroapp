# Biblioteca

El catálogo editorial se mantiene en
[`plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json`](../../../plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json),
junto con su procedencia. Su productor prepara, valida y exporta `datos/lecturas.json`,
la entrega que este generador lee junto con `datos/observaciones-lecturas.json`. Reúne las guías y las lecturas: textos en
castellano y catalán, tipo, niveles, temas, fuentes, fechas, licencias y enlaces. No pertenece al paquete de datos ocupacionales ni a su manifiesto.
Los textos de los resúmenes son propios; las publicaciones externas se enlazan, sin descargarlas al producto.

Desde la raíz del producto:

```sh
node herramientas/web/lecturas.ts --comprobar
node herramientas/web/lecturas.ts
node --test pruebas/web-lecturas/*.test.*
```

La primera orden comprueba la página y ambos diccionarios sin escribir. La segunda valida todo el catálogo y
prepara los tres resultados antes de escribirlos, con el formato de Biome del producto. Conserva la cabecera,
navegación y pie de la página. Las rutas se calculan desde el módulo, independientemente del directorio actual.
Después de modificar JavaScript o comentarios de diccionarios, la publicación web debe regenerar sus integridades.

Para revisar una lectura, comprobar la fuente original y actualizar sus textos, fecha de consulta y condiciones de
uso en el catálogo de autoría, y registrar su huella y revisión en `procedencia.json`.
Después se ejecutan la preparación, validación y exportación común descritas en
[`plataforma_datos/biblioteca/`](../../../plataforma_datos/biblioteca/README.md), antes
de regenerar la página. La entrega no se edita directamente. El segmento (la pestaña) de cada lectura sale de su `tipo`: `guia`, `informe` o `nota`, que van a
Guías, Informes y Notas, en ese orden (`TIPOS` en `registro.ts`); ningún segmento puede quedar vacío. Las entradas no
llevan `segmento` ni `seccion`. Dentro de cada segmento se ordenan por nivel (Inicial, Intermedio y Avanzado: ids
`empezar`, `profundizar` e `investigacion`); en cada nivel va primero el contenido propio de Faro (un enlace que no es
`https://`: una página o una ficha de Faro), después lo fechado, de lo más reciente a lo más antiguo (`fecha.iso`), y
al final lo que no tiene fecha, por su título; las guías propias sin enlace se presentan como «En preparación» y
cierran su nivel. Solo el contenido del Equipo Faro (`fuente`) puede enlazar una página de Faro o ir sin enlace; lo
demás necesita su enlace. La ficha muestra la fuente y, en su franja, el nivel, los minutos, los idiomas
(`idiomas`, con los nombres de `lecturas.lengua.*`) y qué abre: «PDF» o «Página web» según el `formato`
o, sin él, la dirección. Con la web en catalán, el enlace lleva a `enlace_ca` si lo hay. El `tema` y el `subtipo` son
opcionales y la página no los enseña; el tema, si lo hay, debe estar en `temas`. Los minutos deben ser enteros
positivos; las referencias, identificadores y enlaces deben ser válidos antes de generar. No se corrigen entradas
automáticamente. La comprobación de archivos generados también forma parte de las pruebas.

La página reparte las fichas de cada segmento en páginas de seis como mucho, todas con el mismo número o una más en
las primeras (`POR_PAGINA` y `repartir` en `web/scripts/lecturas.js`); sin JavaScript se ven todas.

La Biblioteca enlaza las lecturas a sus fuentes originales. Los PDF propios solo se publican si existen como
entradas explícitas del catálogo; este generador no incorpora archivos desde carpetas externas.

## Estado de los enlaces

La ficha editorial y la comprobación del enlace son entradas distintas. Un fallo de consulta o una identidad no
acreditada no elimina una lectura ni inventa una baja. Solo una evidencia concluyente desactiva su enlace.
Cada versión lingüística conserva su propia comprobación. La fecha visible corresponde a una confirmación
vigente; al vencer, desaparece la marca de comprobación, no la ficha ni su enlace. El navegador controla ese plazo
sin nuevas consultas y sin renovar fechas.

El ensamblado regenera la página y los diccionarios. La construcción de una candidata vuelve a derivarlos de las
entradas admitidas antes de calcular integridades, incluso si la copia generada en `web/` estaba desactualizada.
El JSON técnico de observaciones no forma parte del paquete público: solo se proyectan las acciones y las fechas
que necesita la página. El contrato y las secuencias de evidencia están documentados en
[`src/biblioteca/observaciones-lecturas.md`](../../../src/biblioteca/observaciones-lecturas.md).
