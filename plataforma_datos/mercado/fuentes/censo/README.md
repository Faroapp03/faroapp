# Censo 2021: residencia, lugar de trabajo y perfiles ocupacionales

Generado de `fuente.json`; editar el descriptor y regenerar.

Contexto histórico municipal y perfiles por estudios, situación profesional y nacionalidad del grupo ocupacional en enero de 2021; no caracteriza a una persona.

ID: `censo` · tema: `mercado` · institución: INE.
Lector estático: `plataforma_datos.mercado.fuentes.censo.lector`. Casa de datos: `censo`.

## Alcance

- Tabla viv.ppal: personas ocupadas de dieciséis o más años; CNO-11 a dos y tres cifras.
- Celdas perturbadas por confidencialidad; umbral municipal cien y perfil mil personas, con descenso al agregado válido o supresión.
- Situación profesional anterior a la reforma laboral de 2022; no sustituye censos anuales ni EPA.

## Recursos y condiciones de uso

- `copias` (familia): Consultas censales archivadas con procedencia y SHA.
  Ubicación: var/actualizacion/originales/censo/. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `api-censo` (url): API de difusión del Censo 2021; consultas POST sobre viv.ppal.
  Ubicación: https://www.ine.es/Censo2021/api. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `archivo` (local): Reproduce las copias históricas.
  Recursos: copias. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - La política fija comprueba integridad, no ejecuta consultas periódicas.
- `consulta-explicita` (remoto): Canal disponible en el lector, excluido de la actualización remota automática por su política fija.
  Recursos: api-censo. Autenticación: No se configura autenticación de cuenta en el lector.
  - Solo la CLI explícita con --aceptar-cambio vuelve a consultar; cada respuesta puede tener perturbación distinta.
  - Aceptar bytes no cambia población, categorías ni reglas de publicación.

## Operación actual

Política: `fija`. Consulta red: no.
Frecuencia declarada: decenal (Censo 2021). Aviso de renovación: no definido días.
Originales: `censo`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| censo | historica | copia-local | integridad | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, cataluna, ocupados.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.censo.lector preparar
python -m plataforma_datos.mercado.fuentes.censo.lector validar
python -m plataforma_datos.contratos.fuentes --fuente censo --tema mercado --comprobar
```
