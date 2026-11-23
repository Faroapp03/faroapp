# Acreditación de competencias digitales ACTIC

Generado de `fuente.json`; editar el descriptor y regenerar.

Modelo, normas, equivalencias y trámite de acreditación digital; no acredita el nivel de una persona ni reserva una plaza.

ID: `actic` · tema: `cursos` · institución: Generalitat de Catalunya.
Lector estático: `plataforma_datos.cursos.fuentes.actic.lector`. Casa de datos: `actic`.

## Alcance

- Norma, DOGC, CVE, publicado, URL/SHA/captura; equivalencia por texto solo HTML
- Modelo/trámite de acreditación digital; no nivel de persona ni plaza/reserva

## Recursos y condiciones de uso

- `dogc` (familia): Tres PDF por ELI: órdenes EMT/47/2026, EMT/48/2026 y EMT/136/2026; direcciones explícitas en el lector.
  Ubicación: desconocida. Licencia: desconocida; no acreditada por este descriptor.
- `portal` (familia): Dos páginas HTML explícitas del portal, con pasajes y equivalencias; no se descubre toda norma sucesora.
  Ubicación: https://actic.gencat.cat/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `actic` (remoto): Cinco recursos explícitos
  Recursos: dogc, portal. Autenticación: Ninguna configurada.
  - No descubrimiento de normas sucesoras; transcripción y pasajes literales, revisión editorial conserva vigencia de selección

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: cuando la Generalitat cambia una orden o el portal. Aviso de renovación: no definido días.
Originales: `actic`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| actic | cambiante | contenido-actual-acotado | descargar | 7 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector actual; no se declara una conciliación genérica de entidades ni se interpreta un fallo como baja.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.actic.lector preparar
python -m plataforma_datos.cursos.fuentes.actic.lector validar
python -m plataforma_datos.contratos.fuentes --fuente actic --tema cursos --comprobar
```
