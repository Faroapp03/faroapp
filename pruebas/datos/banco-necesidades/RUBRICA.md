# Rúbrica propuesta por persona y curso

Versión inicial para revisión, sin etiquetas asignadas. Unidad: perfil completo y versión del curso, no ocupación aislada. Los perfiles son sintéticos; una variante es un caso nuevo, no hereda la utilidad anotada para el anclaje.

## Dos juicios separados

1. **Contenido:** P si la evidencia del curso cubre una necesidad explícita de esta persona al nivel declarado; Pa si la cubre parcialmente; N si la evidencia demuestra que no cubre esa necesidad o repite lo ya dominado sin aportar aprendizaje pertinente. Si faltan temario, objetivo o nivel necesarios para sostener ese juicio, se registra **no evaluable**, separado de P, Pa y N. Hay que citar módulos/requisitos y el dato del perfil que sostiene el juicio. No basta título, familia, similitud o puntuación del juez. Que un curso sea inicial no lo hace inútil automáticamente: puede cubrir otra necesidad explícita que no se domina.
2. **Acceso:** compatible, pendiente o incompatible, con el requisito publicado y el dato de la persona por separado. Compatible requiere comprobar los requisitos aplicables; no significa «todo lo demás». Si faltan datos necesarios del curso o de la persona, queda pendiente. Curso útil pero inaccesible conserva su juicio de contenido. Nivel de cualificación del SOC/Consorci, dominio de una tarea, nivel actual de IA y nivel deseado de IA son conceptos separados; no se deducen entre sí ni del gran grupo ISCO. Desconocido no significa inicial. Pedir un nivel avanzado no acredita cumplir los prerrequisitos de un curso avanzado.

n01 y n09 declaran conocimiento actual como supuesto sintético explícito: no lo acreditan los anclajes históricos y no se infiere del anexo. Mantienen el deseo desconocido en ambos miembros para aislar esa variable. Estos supuestos no son etiquetas P, Pa ni N.

No se exigen cuotas de IA o ciberseguridad. La etiqueta considera necesidad, acceso y nivel declarados, no el número de cursos que falta para llenar una hoja. Una referencia puede justificar varios cursos o ninguno; no basta pedir que dos hojas tengan ids diferentes.

## Registro que falta completar

Cada etiqueta futura debe guardar `persona`, huella de entrada, `curso`, huella y fecha de su ficha, `contenido` (P/Pa/N/no evaluable), `acceso`, `nivelPublicado` (o desconocido), nivel actual y deseado de la persona separados, evidencia por campo, explicación y versión de rúbrica. Registrar por separado quién o qué modelo evaluó, su versión, parámetros pertinentes, fecha, resultado inicial y desempate. Dos agentes/modelos no se describen como dos personas. Las expectativas objetivas de `contrato.json` no son etiquetas de utilidad.

Evaluar a ciegas respecto de selección y puntuación del selector, con dos evaluadores y desempate de discrepancias; mantener la clave de selección fuera del material de evaluación. Antes de afirmar independencia, contrastar identidades/modelos y pares exactos contra el entrenamiento y el juez. El juez Qwen3-8B y las regresiones productivas no proporcionan sus propias etiquetas de referencia. Los modelos de PA/PB/PC históricos son desconocidos en los artefactos revisados.

## Oferta de referencia y abstención

La abstención solo se comprueba cuando existe un conjunto explícito de oferta para esa persona y fecha, con cobertura documentada, fichas/requisitos revisados y etiquetas independientes. Una hoja vacía no demuestra que no haya oferta. Un curso no elegido o no valorado por el juez tampoco demuestra que sea inútil. Sin esa referencia se informa **abstención no evaluable**. Para medir omisiones, incluir oferta no seleccionada y no limitarse al top del selector.

## Mediciones verificables

- Por persona: cursos con referencia, P/Pa/N y no evaluables; contenido separado de acceso; incompatibles seleccionados, requisitos desconocidos presentados como conocidos, afirmaciones de nivel o cobertura sin evidencia y carga incompatible con horas/fechas. No mezclar los pares no etiquetados con N.
- Por contraste: conservación de todos los campos salvo el declarado, consumo real del campo por el selector, cambios explicables con oferta adecuada y referencia por persona. Ante cambios irrelevantes para un candidato, sus hechos y acceso deben permanecer estables. No exigir que cambien los ids si la oferta apropiada es la misma o insuficiente, ni aceptar diferencias sin explicación solo para demostrar personalización.
- Cobertura: personas, oficios, dimensiones, cursos/fuentes y candidatos revisados frente a oferta documentada; omisiones y abstenciones solo sobre la oferta con referencia.
- Calidad de orden cuando haya etiquetas: utilidad en posiciones iniciales por persona, separando inaccesibles y desconocidos. Publicar numeradores, denominadores y cobertura; los umbrales y metas finales se fijan antes de ajustar el ranking, tras revisión de esta rúbrica.

Los contrafactuales comparten anclaje y catálogo: no son observaciones independientes. Agregar incertidumbre agrupando por oficio y par, publicar dispersión por persona y no presentar veinte filas como veinte observaciones independientes. Estos veinte casos de desarrollo no son un examen reservado ni una estimación representativa de población.

Para ampliar a ochenta perfiles faltan más oficios y escenarios, oferta de referencia, etiquetado nuevo y revisión independiente. Duplicar variantes o reutilizar las 1.401 etiquetas ocupación|curso no cubre esas carencias. Destino/CAP seguirán fuera hasta acordar su entrada y evidencia, sin condicionar el núcleo inicial a esas ampliaciones.


## Criterios fijados antes de ajustar el selector

Son metas de aceptación, no resultados ni garantías para toda la población. Los veinte perfiles iniciales son un banco de desarrollo para reproducir fallos; por sí solos no autorizan empaquetar ni acreditar porcentajes.

- **Acceso y veracidad:** cero incompatibles presentados como cursables en los casos de referencia; cero requisitos pendientes presentados como comprobados; cero fechas, niveles, contenidos o plazas inventados. La confianza del juez no resuelve un requisito. Lo pendiente debe conservar su condición y no sustituir una recomendación disponible sin explicarlo.
- **Primer curso:** P en al menos el 90 % de las hojas no vacías de la muestra de aceptación. Pa y no evaluable no cuentan como P; una hoja sin referencias completas no se elimina del denominador para mejorar el resultado.
- **Primeras opciones:** al menos un P accesible entre los tres primeros en el 95 % de los perfiles cuya oferta de referencia contiene un P accesible y viable. Las hojas vacías cuentan como fallo cuando esa oferta existe.
- **Conjunto visible:** N como máximo en el 5 % de los cursos propuestos. Publicar también Pa y no evaluable; no compensar cursos N añadiendo más cursos a las hojas. Cada propuesta debe tener una referencia independiente o quedar identificada como no evaluable, lo que impide acreditar su calidad.
- **Abstención y cobertura:** cero hojas vacías cuando la oferta revisada incluye una opción P accesible y viable. Publicar aparte los perfiles cuya oferta no se ha podido revisar; no declarar que el catálogo carece de cursos a partir de la lista del motor.
- **Personalización:** cumplir todos los contrastes objetivos de la referencia: retirar incompatibilidades, respetar conocimientos declarados y conservar hechos ante cambios irrelevantes. Cambiar los ids no es una meta: el cambio de selección solo se exige cuando la referencia muestra alternativas adecuadas distintas.
- **Preguntas:** medir mediana y máximo; mediana de cuatro o menos como objetivo de comodidad, subordinado a aclarar acceso y necesidad. No omitir preguntas necesarias para alcanzar esa cifra.

Antes de una decisión de entrega se necesitan al menos ochenta perfiles de aceptación de veinte ocupaciones, con oferta revisada y referencias persona|curso, distintos de los perfiles usados para ajustar. Este mínimo da cobertura de diseño, no representatividad estadística. Los pares y variantes del mismo oficio no son observaciones independientes: publicar intervalos del 95 % agrupados por oficio, numeradores/denominadores y resultados por dimensión/fuente. No anunciar una precisión poblacional que esos intervalos no sostengan. Las métricas también se calculan por persona para no dar más peso a quien recibe más cursos.

Las etiquetas se preparan con la rúbrica congelada y sin ver selección ni puntuación; los controles conocidos deben tener evidencia objetiva, no una respuesta inventada por el selector. El acuerdo de dos evaluadores de IA no sustituye esta revisión de evidencia. Inventariar solapamientos con entrenamiento y separar por persona, ocupación y programa según la generalización que se mida. Las ediciones del mismo programa no sirven para simular independencia entre entrenamiento y evaluación.

El banco de desarrollo admite iteraciones. La muestra de aceptación no elige versiones. El examen reservado se mide una sola vez con la versión congelada y una referencia que permita valorar personas; el antiguo examen por ocupación no acredita por sí solo personalización. Si una comprobación falla, se registra y se corrige sin modificar retrospectivamente etiquetas o umbrales para aprobar.
