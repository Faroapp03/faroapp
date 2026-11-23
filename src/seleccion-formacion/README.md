# Selección de formación

Este módulo construye un camino de aprendizaje desde una entrega pública de Cursos y su compañero de
aprendizaje acreditado. Se ejecuta en el dispositivo, sin inferencia externa, consultas a proveedores ni
acceso al almacén privado. Su entrada en el recorrido es
[`formacion-acreditada.ts`](../plataforma/navegador/formacion-acreditada.ts).

## Autoridad de las entradas

El [lector del catálogo](../catalogo-cursos/README.md) comprueba las ofertas y conserva sus fechas. El compañero
aporta resultados previstos, requisitos publicados, evidencias y la revisión de las relaciones pedagógicas.
[`contenido_aprendizaje.py`](../../plataforma_datos/cursos/contenido_aprendizaje.py) obtiene el temario de la
recepción actual admitida; [`aprendizaje_entrega.py`](../../plataforma_datos/cursos/aprendizaje_entrega.py)
contrasta cada afirmación con el bloque completo y su contexto. Un texto antiguo que todavía figure entre las
evidencias no sustituye al contenido actual.

`cargarCompanero` exige ruta, tamaño y huella fijados por la publicación. `leerCompanero` comprueba el contrato,
las referencias al catálogo y al registro de competencias, los identificadores y la coherencia de la revisión.
No acepta que la persona elija una URL de aprendizaje. Una entrada ilegible o de otra entrega produce un error;
no se presenta como un catálogo vacío ni se sustituye por una selección anterior.

## Camino y condiciones

`seleccionarFormacion` recibe etapa, idiomas, modalidad, aceptación del registro, requisitos confirmados y
exclusiones, junto con el reloj de la plataforma. Solo considera ofertas vigentes con formación gratuita
acreditada: la gratuidad es una promesa y un coste que no consta descarta la oferta. Lo demás que no consta no
descarta: el curso se propone y la opción lo dice en `porConfirmar` ([`por-confirmar.ts`](por-confirmar.ts)). Solo
descarta lo que contradice una preferencia expresa de la persona. El idioma lo decide la misma pieza que pinta Cursos
(`idiomaConOrigen`, en [`idioma-del-plan.ts`](idioma-del-plan.ts)) y cada opción lleva su origen hasta la hoja: un
idioma declarado por la fuente o una orientación de Faro valen si coinciden con los de la persona, y uno que no
consta queda por confirmar. Un registro previo solo descarta si consta que el curso lo pide y la persona ha dicho
que no quiere crear una cuenta; «Prefiero revisarlo antes» no es una negativa. Una modalidad solo descarta si el
curso la publica y es distinta de la que pide la persona; si no la publica, el curso se propone con `modalidad` por
confirmar. Dentro de cada bloque van primero los
cursos de los que consta todo, en el orden de la entrega. Los requisitos se confirman mediante
identificadores compuestos por programa y afirmación; cumplir el requisito de un curso no confirma el de otro.

No toda afirmación de requisito es una condición. [`requisitos.ts`](requisitos.ts) aplica la revisión editorial de
[`requisitos-revisados.ts`](requisitos-revisados.ts): cada decisión juzga una frase y vale para su programa y su
afirmación mientras el texto literal sea el mismo. La huella de la captura sobre la que se revisó queda como
constancia, sin decidir nada. Una condición revisada se confirma y se enseña con su resumen en castellano o en
catalán; una descripción del curso o un texto general del proveedor se enseña como información y nunca descarta el
curso; una afirmación sin decisión, o cuyo texto ya no es el revisado, se confirma con el texto publicado, en el idioma
de la ficha. Un cambio en la fuente no interrumpe la selección: la decisión deja de aplicarse y `medirRequisitos` la
cuenta, junto con las decisiones sin afirmación publicada y las aplicadas que se revisaron sobre otra captura.

Las etapas son objetivos propios del recorrido, no niveles oficiales ni una medición del dominio de la persona:

| Etapa | Objetivos del camino |
| --- | --- |
| Inicial | Realizar una tarea sencilla con IA, proteger los datos personales y contrastar el resultado. |
| Intermedia | Aplicar IA a una tarea real, mejorar las instrucciones y comprobar con criterios explícitos. |
| Avanzada | Diseñar un procedimiento verificable, documentar fuentes y límites y resolver un caso complejo mediante verificación rigurosa o automatización supervisada. |

Los caminos y su orden proceden de la revisión declarada en
[`aprendizaje-revisado.json`](../../config/formacion/aprendizaje-revisado.json). El selector no deduce
aprendizaje del título ni crea equivalencias entre escalas. Elige el primer camino completo admisible; si no
existe, puede mostrar uno parcial con sus objetivos todavía sin cubrir. Añade como máximo tres complementarios
con una aportación acreditada a la etapa, sin rellenar cupos.

Un camino completo significa que sus recursos elegibles cubren los objetivos declarados; no acredita que la
persona haya cursado la formación ni adquirido la competencia. Un requisito no publicado sigue siendo una
ausencia de información, no una declaración de acceso universal. El resultado conserva motivos de descarte,
requisitos por confirmar y recursos ausentes. La presentación traduce esos estados al castellano y al catalán;
no los convierte en disponibilidad o cobertura supuestas.

## Comprobación y mantenimiento

Las pruebas de [selección](../../pruebas/formacion/seleccion-formacion.test.ts),
[frontera](../../pruebas/formacion/seleccion-formacion-frontera.test.ts) y
[aprendizaje](../../pruebas/formacion/aprendizaje.test.ts) comprueban vigencia, idioma, condiciones, abstención y coherencia
entre las dos entregas. Las [pruebas del productor](../../plataforma_datos/cursos/pruebas/test_aprendizaje_entrega.py)
comprueban cambios de temario, contexto, requisitos y conservación de las fechas de recepción.

Ampliar la oferta requiere revisar evidencias del curso y declarar qué objetivos respalda; no exige añadir
excepciones por proveedor al selector. La ausencia de oferta suficiente es un resultado explícito del contrato.
