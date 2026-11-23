# Barcelona Activa: ocupaciones y Cibernàrium

Generado de `fuente.json`; editar el descriptor y regenerar.

Una misma fuente conserva enlaces ocupacionales por ESCO exacto y mantiene el catálogo completo de Cibernàrium por actividad y edición nativas. Las formaciones de IA que ve la persona salen del censo diario del ámbito de IA del propio Cibernàrium, cruzado con el censo completo admitido. Matrícula anunciada no equivale a plaza ni acceso al Campus.

ID: `barcelonactiva` · tema: `cursos` · institución: Barcelona Activa · Ajuntament de Barcelona.
Lector estático: `plataforma_datos.cursos.fuentes.barcelonactiva.lector`. Casa de datos: `barcelonactiva`.

## Alcance

- ESCO exacto/id ficha; id actividad, título, fechas y modalidad de cada formación del ámbito de IA (scopeIds=22), con la evidencia de las páginas del censo
- Plazas de una lista cerrada de códigos, calendario, botón de inscripción del día y estado de la inscripción de la edición propia tal como los publica la API; lo desconocido no consta y se avisa; continuidad, horas, duración e idioma no constan

## Recursos y condiciones de uso

- `catalogo` (archivo): Catálogo ocupacional conservado manualmente; un enlace solo si ESCO tiene una ficha inequívoca.
  Ubicación: var/actualizacion/originales/barcelonactiva/barcelonactiva-cataleg-ocupacions-2026-10-07.html. Licencia: Aviso legal restrictivo declarado en lector.py; hechos mínimos y enlaces, sin reproducción de fichas.
- `cibernarium` (familia): Página pública de filtros (nombre del ámbito 22 «Intel·ligència Artificial (IA)» e instancia del portlet, comprobados en cada ciclo) y censo diario de las formaciones de ese ámbito, con cuerpos y recibos inmutables.
  Ubicación: var/actualizacion/originales/barcelonactiva/cibernarium-ia/. Licencia: Aviso legal restrictivo declarado en lector.py; hechos mínimos y enlaces, sin objetivos ni temarios.
- `cibernarium-operativo` (familia): Censo API completo, normas generales y apoyos HTML estrictamente identificados; cuerpos y recibos inmutables, selección actual por edición.
  Ubicación: var/actualizacion/originales/barcelonactiva/cibernarium/. Licencia: Aviso legal restrictivo; hechos mínimos y enlaces, sin redistribuir objetivos, temarios o fichas.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `barcelonactiva` (remoto): El catálogo ocupacional permanece fijado. Un censo de IA o del canal parcial deja la salida anterior y la validación lo dice como consulta parcial; la evidencia de las páginas va en la validación.
  Recursos: catalogo, cibernarium. Autenticación: Consulta pública sin cuenta ni claves.
  - 1 734 fichas ocupacionales en copia fijada, sin contenido protegido.
  - Página de filtros y censo de IA con transporte central, al menos dos segundos por dominio; si el ámbito 22 cambia de nombre o falta la instancia del portlet, no se consulta el censo y lo publicado se conserva. Solo un censo de IA completo con un censo del canal admitido y completo sustituye la salida.
- `cibernarium-operativo` (remoto): Originales, preparados y validados en cibernarium/ dentro de Barcelona Activa. La composición conjunta conserva otras fuentes y produce una candidata, nunca una instalación automática.
  Recursos: cibernarium-operativo. Autenticación: Consulta pública sin cuenta ni claves; inscripción requiere registro previo según norma general. No se entra al Campus.
  - Recepciones seriales con transporte central, al menos dos segundos por dominio; máximo 100 páginas de 15 actividades y 20 apoyos HTML nuevos o cambiados por ciclo.
  - Estado, calendario y matrícula propios de cada edición; no se fusionan por título ni se interpreta ausencia como baja.
  - DISP0 exige descripción y señales concordantes. Respuesta identificada incierta desplaza favor previo; error técnico conserva la prueba anterior, sin rejuvenecer su fecha, hasta una respuesta identificada posterior.

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Censo Cibernàrium y censo del ámbito de IA diarios; el catálogo ocupacional conserva su fecha propia. Aviso de renovación: 1 días.
Originales: `barcelonactiva`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| barcelonactiva | cambiante | contenido-actual-acotado | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: catalan.
Contratos y controles: lector.py:validar, censo_ia.py:leer, adquisicion.py:calcular, actualizacion.py:aplicar, contrato-cibernarium.md.

Retirada: Una formación de IA deja de publicarse si la fuente la da por cerrada o terminada, si su ficha responde 404 o 410 cuando falta en un censo completo, o cuando acaba su calendario publicado; una ausencia, un fallo de consulta o un censo parcial no la retiran.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.barcelonactiva.lector preparar
python -m plataforma_datos.cursos.fuentes.barcelonactiva.lector validar
python -m plataforma_datos.contratos.fuentes --fuente barcelonactiva --tema cursos --comprobar
```
