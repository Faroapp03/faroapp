# Sectores del grupo ocupacional: Censo 2021

Generado de `fuente.json`; editar el descriptor y regenerar.

Reparto censal de ocupados por grupo CNO-11 y actividad CNAE-09 del establecimiento de trabajo en Barcelona y Cataluña; no asigna un sector a una persona.

ID: `sectores` · tema: `mercado` · institución: INE.
Lector estático: `plataforma_datos.mercado.fuentes.sectores.lector`. Casa de datos: `sectores`.

## Alcance

- Censo 2021, personas ocupadas de dieciséis o más años; dos consultas POST por provincia de trabajo, ocupación y actividad a dos cifras.
- Cataluña suma cuatro provincias; perturbación hasta doce personas y agregación de celdas pequeñas preservadas.
- Sectores desde cien personas y tres por ciento; grupo de mil o descenso al de dos cifras; resto en otros sectores.

## Recursos y condiciones de uso

- `copias` (familia): Consultas históricas admitidas con huellas.
  Ubicación: var/actualizacion/originales/sectores/. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.
- `api-censo` (url): Dos consultas POST de viv.ppal; clasificación de actividad CNAE-09.
  Ubicación: https://www.ine.es/Censo2021/api. Licencia: Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE (https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, patrocina o apoya la reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `archivo` (local): Reconstrucción local del reparto.
  Recursos: copias. Autenticación: No aplicable al procesamiento local; no acredita acceso remoto ni una cuenta configurada.
  - Fuente fija: la selección periódica comprueba las copias; no vuelve a perturbarlas.
- `consulta-explicita` (remoto): Canal explícito del lector, no actualización automática.
  Recursos: api-censo. Autenticación: No se configura autenticación de cuenta en el lector.
  - Solo consulta de nuevo con --aceptar-cambio; la perturbación cambia en cada respuesta.
  - Actividad del establecimiento registrado; ETT cuenta en su actividad, no en la de la empresa usuaria.

## Operación actual

Política: `fija`. Consulta red: no.
Frecuencia declarada: decenal (Censo 2021). Aviso de renovación: no definido días.
Originales: `sectores`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| sectores | historica | copia-local | integridad | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, cataluna.
Contratos y controles: lector.py:validar.

Retirada: Se mantienen los controles de admisión y reconstrucción del lector; un fallo de consulta o una lectura parcial no autoriza una retirada ni una cifra cero.

Conservación: Las rutas, originales, procedencias y revisiones actuales en var/actualizacion se conservan; este descriptor no activa limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.mercado.fuentes.sectores.lector preparar
python -m plataforma_datos.mercado.fuentes.sectores.lector validar
python -m plataforma_datos.contratos.fuentes --fuente sectores --tema mercado --comprobar
```
