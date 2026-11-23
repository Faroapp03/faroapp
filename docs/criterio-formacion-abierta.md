# Criterio «Formación abierta» (v1.1)

Qué cursos gratuitos en línea de fuera del catálogo oficial puede enseñar Faro, y en qué orden. Pensado para las
competencias digitales y el uso de la IA de
iniciación (DigComp básico e intermedio), en castellano o en catalán. Cada punto se responde sí o no, con un enlace que
lo prueba y su fecha; `plataforma_datos/cursos/fuentes/abierta/lector.py` lo comprueba en cada ficha.

## Requisitos

Si uno no se cumple, el curso no entra.

| # | Requisito | Cómo se comprueba |
|---|---|---|
| R1 | **Titular identificable y solvente:** organismo público, universidad, organismo internacional o entidad sin ánimo de lucro; una empresa, solo si cumple R7. | Aviso legal con su razón social; en una universidad, que el curso lo firme la universidad. |
| R2 | **Gratis de verdad:** todo el contenido sin pagar ni dar un medio de pago, y sin un acceso que caduque antes de terminar. El certificado puede ser de pago si se dice. | Página del curso y condiciones de la plataforma. |
| R3 | **Temario visible sin registrarse:** objetivos, contenidos y duración en una página pública, sin cuenta ni datos personales. | Abrir el enlace sin sesión. |
| R4 | **Idioma:** contenido en castellano o en catalán, no solo los subtítulos. Una traducción automática de la entidad se dice. | Página del curso. |
| R5 | **Iniciación:** sin requisitos previos, o nivel declarado básico o intermedio (DigComp 1 a 4). | Página del curso. |
| R6 | **Vigente:** se puede empezar el día de la comprobación y no ha llegado a su fin publicado. La antigüedad de su publicación no lo excluye: un recurso continuo puede llevar años publicado y seguir siendo válido. | Página del curso. |
| R7 | **Neutral:** el temario no incluye aprender a manejar un producto comercial concreto, del titular o de otro; puede citarlos como ejemplo. No exige comprar ni instalar software de pago. | Temario completo, también sus prácticas. |
| R8 | **Condiciones compatibles:** permiten enlazar; Faro solo copia el título y no lee nada de forma automática donde las condiciones o `robots.txt` lo prohíben. | Condiciones de uso y `robots.txt`, con su fecha. |
| R9 | **Enlace limpio:** la página pública del curso, sin parámetros de seguimiento ni de afiliación. | La validación de la ficha. |
| R10 | **Sitio íntegro:** la página no lleva enlaces ocultos ni contenido ajeno al curso. | Página del curso. |

## Orden

Lo que pasa los requisitos se enseña siempre detrás de la oferta oficial (SEPE, SOC y Consorci), igual para todas las
ocupaciones, en dos bloques: primero el de titular público y después, si la configuración lo permite, el de otras
entidades. Dentro de cada bloque, de iniciación a avanzado (sin requisitos y DigComp A1 son el mismo escalón; después,
A2, B1, B2, C1 y C2); a igual nivel, de más corto a más largo; a igualdad, por título.

## Lo que dice cada ficha

Solo hechos, redactados por Faro: el título tal como lo publica la entidad, la entidad, el idioma (y si es una
traducción automática), las horas, el nivel, si es a tu ritmo o hasta qué fecha, a quién se dirige si la entidad lo
restringe, el certificado opcional (quién lo emite, lo que cuesta tal como lo publica y sus créditos) y la fecha de la
comprobación. Nunca una descripción, una foto o un logo; nunca «oficial» ni «acreditado» si no lo es. El nombre de la
entidad va como dato, sin destacarlo.

## Versiones

- **v1** (06/10/2026), fijada antes de aplicarla: R1 a R9, con R7 como «no enseña solo el producto comercial de su
  titular».
- **v1.1** (06/10/2026): R7 más estricto (el temario no incluye aprender a manejar ningún producto comercial concreto),
  porque un servicio público no debe recomendar aprender un producto; y R10, sitio íntegro, al encontrar enlaces
  ocultos a webs de apuestas en la página de un curso.

## Aplicación del 06/10/2026

Cada página se abrió a mano el 06/10/2026, con su temario entero. Las fichas, con la evidencia de cada requisito, están
en `var/actualizacion/preparados/abierta/fichas.json`.

| Curso | Titular | Resultado |
|---|---|---|
| *Competencias digitales. Búsqueda y gestión de información y datos. Básico 1 (A1)* | UNED | Pasa (18,75 h) |
| *Competencias digitales. Comunicación y colaboración. Básico 1 (A1)* | UNED | Pasa (37,5 h) |
| *Competencias digitales. Creación Contenidos Digitales. Básico 1 (A1)* | UNED | Pasa (25 h) |
| *Competencias digitales. Seguridad. Básico 1 (A1)* | UNED | Pasa (25 h) |
| *Competencias digitales. Resolución problemas. Básico 1 (A1)* | UNED | Pasa (25 h) |
| *Inteligencia artificial para la empleabilidad y el emprendimiento rural* | UNED | No pasa R7: su laboratorio enseña a crear el currículum con Kickresume. |
| *Creación de contenido digital y comunicación audiovisual con IA* | UNED | No pasa R7: su laboratorio enseña a planificar publicaciones con Meta Business Suite o Buffer. |
| *Exploración de la inteligencia artificial para todos* | Microsoft | No pasa R7: una de sus cinco unidades de contenido está dedicada a Copilot, producto de su titular. |

Ningún curso de otra entidad pasa hoy el criterio: con `FARO_FORMACION_ABIERTA=gratis`, el informe no enseñaría ninguno
más. Ningún curso de IA de iniciación en castellano o catalán, gratuito y a tu ritmo, pasa hoy el criterio.
