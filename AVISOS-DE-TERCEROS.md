# Avisos de terceros

Faro — Equipo Faro. El código propio conserva la [licencia del producto](LICENSE).
Este índice reúne los avisos locales de los materiales incluidos; no los sustituye ni concede derechos
adicionales. Las versiones identifican las copias documentadas, no todas las dependencias de npm.
Los avisos, las atribuciones y las condiciones originales deben acompañar a sus materiales.

## Bibliotecas y confianza TLS incluidas

| Componente y copia | Alcance | Aviso y procedencia canónicos |
| --- | --- | --- |
| Noble: `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0 y `@noble/post-quantum` 0.7.1 | Cierre de módulos de firmas del navegador, adaptado a imports relativos; MIT. | [Descripción](web/terceros/noble/README.md), [procedencia y huellas](web/terceros/noble/procedencia.json), licencias de [curves](web/terceros/noble/curves/LICENSE), [hashes](web/terceros/noble/hashes/LICENSE) y [post-quantum](web/terceros/noble/post-quantum/LICENSE). |
| qrcode-generator 2.0.4 | Generación local de códigos QR; MIT. | [Licencia](web/terceros/qrcode-generator/LICENSE) y [procedencia](web/terceros/qrcode-generator/procedencia.json). |
| Certificados de certifi 2026.10.23 | Copia de confianza TLS para mantenimiento, no biblioteca del navegador; aviso MPL-2.0 registrado. | [Licencia conservada](plataforma_datos/comun/confianza_tls/LICENSE) y [procedencia de la rueda y del conjunto de certificados](plataforma_datos/comun/confianza_tls/procedencia.json). |

## Tipografías, imágenes y cartografía

| Material | Identidad y alcance | Aviso y procedencia canónicos |
| --- | --- | --- |
| Sora, Space Grotesk y JetBrains Mono | Archivos WOFF2 de la interfaz; SIL Open Font License 1.1. No consta una versión de publicación en estos avisos. | Licencias de [Sora](web/tipografias/LICENSE-sora.txt), [Space Grotesk](web/tipografias/LICENSE-spacegrotesk.txt) y [JetBrains Mono](web/tipografias/LICENSE-jetbrainsmono.txt). |
| Banderas de country-flag-icons 1.6.20 | Selección de SVG, sin cambios en sus imágenes; MIT. | [Licencia](web/imagenes/banderas/LICENSE) y [procedencia y huellas](web/imagenes/banderas/procedencia.json). |
| Fotografías de Unsplash | Fotografías y variantes redimensionadas identificadas individualmente; condiciones de Unsplash según los créditos conservados. | [Autorías, fuentes y transformaciones](web/creditos-fotografias.md). |
| Textura NASA Blue Marble y fronteras Natural Earth 5.1.2 | Textura de julio de 2004 y geometrías cartográficas transformadas para el globo; sus condiciones se conservan separadas. | [Procedencia, condiciones, modificaciones y huellas](web/recursos/globo/procedencia.json). |

## Motores, modelos, vocabularios y datos

| Componente | Qué se distribuye y qué no debe confundirse | Referencia canónica |
| --- | --- | --- |
| Motores de ocupaciones y cursos | Código propio de Faro, distinto de los modelos, vocabularios y datos que consume. Las licencias de esos materiales no se extienden al motor. | [Motores](motores/README.md) y [licencia del código](LICENSE). |
| Vectores derivados de EmbeddingGemma 2 | Tabla estática y vectores ajustados por Faro a partir de `google/embeddinggemma-2`, revisión `914f7f89142e33e77833254d9c9b90c3cef7303b`. La copia documenta Apache-2.0 y condiciones adicionales de uso del modelo. No se distribuye el modelo completo de Google en el navegador. | [Licencia y alcance de los derivados](datos/vectores-movil/LICENCIA.md), [avisos de atribución y modificación](web/terceros/embeddinggemma/AVISOS.txt), [texto de licencia](web/terceros/embeddinggemma/LICENSE) y [procedencia](web/terceros/embeddinggemma/procedencia.json). |
| Procedencia de bancos de formación | Referencias históricas a modelos y valoraciones; no se distribuyen sus pesos ni se ejecutan esos modelos en el banco. Los vectores compartidos conservan sus avisos propios. | [Fuente y alcance del banco](pruebas/datos/banco-necesidades/FUENTE.md). |
| Vocabularios del buscador | Tablas auxiliares y correspondencias con procedencia propia. Algunas entradas automáticas conservan explícitamente referencias de memoria no verificadas y revisión pendiente; no son diccionarios oficiales. | [Buscador](motores/ocupaciones/src/busqueda/README.md), [tablas y procedencias](motores/ocupaciones/src/busqueda/) y metadatos de [americanismos](motores/ocupaciones/src/busqueda/americanismos-anglicismos.json), [siglas](motores/ocupaciones/src/busqueda/siglas.json) y [vocabulario](motores/ocupaciones/src/busqueda/vocabulario-calle.json). |
| Datos ocupacionales, estadísticos y formativos | Cada conjunto conserva fuente, periodo, licencia o condición declarada y modificaciones. Las traducciones y los índices derivados mantienen los avisos de sus textos de origen. Una licencia no declarada no se completa con la del código o la del modelo. | [Índice de datos y condiciones](datos/README.md), [manifiesto del paquete](datos/manifiesto.json) y [plataforma de fuentes](plataforma_datos/README.md). |
| Estudio del ODEE y la Cambra de Comerç de Barcelona (`datos/exposicion-cambra.json`) | Solo el nivel de exposición agregado de cada ocupación del estudio de 2026, su escala, el reparto por sexo que publica el estudio y la cita: lo que la herramienta muestra. La autorización escrita del ODEE cubre mostrar en Faro ese nivel, citando al ODEE y a la Cambra e informándoles de cada publicación; no autoriza reutilizarlo fuera de Faro. **La tabla completa (`datos/cambra.json`) no se distribuye con el código ni en la web**: cada instalación autorizada la recibe aparte, solo para las pruebas, y la comprueba con la huella del manifiesto. | [Condiciones, guardia y cómo se obtiene la tabla](datos/README.md#exposicion-cambrajson). |
| Biblioteca y enlaces de formación | Fichas y referencias sujetas a sus condiciones individuales; enlazar un contenido no incorpora ni licencia su texto completo. | [Catálogo y condiciones por lectura](datos/lecturas.json) y [fuentes de datos](datos/README.md). |

## Dependencias de instalación y mantenimiento

El [lock de npm](package-lock.json) identifica las dependencias de construcción, verificación y despliegue;
no todas aportan código al navegador. Las dependencias Python de mantenimiento y las herramientas de pruebas
se fijan por separado en [requirements.txt](requirements.txt), [requirements-dev.txt](requirements-dev.txt)
y el [lock de ruedas](config/dependencias-python.lock.json). Sus paquetes instalados conservan sus licencias.
Estos ficheros no son un inventario de avisos de todas las dependencias transitivas ni implican que se
redistribuyan `node_modules`, `.venv`, los runtimes o sus cachés dentro de la entrega de código.
