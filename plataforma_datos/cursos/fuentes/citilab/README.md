# Formación de Citilab

Generado de `fuente.json`; editar el descriptor y regenerar.

Hechos de fichas de formación en catalán dirigidas a público adulto, con enlace; sin descripciones, imágenes ni logos.

ID: `citilab` · tema: `cursos` · institución: Citilab (Fundació pel Foment de la Societat del Coneixement).
Lector estático: `plataforma_datos.cursos.fuentes.citilab.lector`. Casa de datos: `citilab`.

## Alcance

- id, modified, link y vocabularios; totales HTTP WP; procedencia de cada cuerpo
- Hechos de ficha, desconocidos conservados; no comprueba plazas/inscripción

## Recursos y condiciones de uso

- `formacio` (url): Colección de fichas, por páginas; campos y tamaño de página fijados por el lector.
  Ubicación: https://www.citilab.eu/wp-json/wp/v2/formacio. Licencia: Condiciones de citilab.eu declaradas en lector.py: uso informativo y de servicio con atribución; se exportan solo hechos.
- `public` (url): Vocabulario de destinatarios.
  Ubicación: https://www.citilab.eu/wp-json/wp/v2/public. Licencia: Condiciones de citilab.eu declaradas en lector.py: uso informativo y de servicio con atribución; se exportan solo hechos.
- `tipus-formacio` (url): Vocabulario de tipos de formación.
  Ubicación: https://www.citilab.eu/wp-json/wp/v2/tipus-formacio. Licencia: Condiciones de citilab.eu declaradas en lector.py: uso informativo y de servicio con atribución; se exportan solo hechos.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `citilab` (remoto): formacio, public, tipus-formacio; tres colecciones
  Recursos: formacio, public, tipus-formacio. Autenticación: Ninguna configurada.
  - per_page=100 y paginación con page=N hasta x-wp-totalpages; cada página con el tamaño que le toca y totales WP estables; la copia cuadra con x-wp-total; sin cuota acreditada

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta diaria de la API pública de citilab.eu; el panel avisa de revisar la copia con el mismo plazo que la aplicación. Aviso de renovación: 30 días.
Originales: `citilab`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| citilab | cambiante | catalogo-actual | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.citilab.lector preparar
python -m plataforma_datos.cursos.fuentes.citilab.lector validar
python -m plataforma_datos.contratos.fuentes --fuente citilab --tema cursos --comprobar
```
