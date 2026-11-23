# Composición de datos globales por territorio

Generado de `fuente.json`; editar el descriptor y regenerar.

Datos globales («Faro en el mundo»): el archivo `datos-globales.json` que leen el panel de comparación y el globo.

ID: `datos_globales` · tema: `derivados` · institución: Equipo Faro, a partir de los conjuntos admitidos.
Lector estático: `plataforma_datos.derivados.fuentes.datos_globales.lector`. Casa de datos: `datos-globales`.

## Alcance

- No descarga nada: compone, con la forma del contrato común (versión 1), lo que ya validaron otras fuentes:
- - `mundo-eurostat`: empresas que usan IA (serie desde 2021), personas que usan IA generativa y personas de 25 a 64 años en formación (serie desde 2021), por país europeo, en la UE-27 y, la formación, en Cataluña (ES51); - `empresas`: las empresas que usan IA en Cataluña (Eurostat, región ES51), la misma medida que la de los países; - `tic-llars`: la IA generativa en Cataluña (Idescat, a partir de la TIC-H del INE), en la base de los usuarios de internet, la misma que `PC_IND_IU3` de Eurostat (los indicadores «-usuarios-internet»); - `clima-empresarial`: los establecimientos de Cataluña que usan IA, quién la usa y si valoran las competencias digitales al contratar (Idescat); solo Cataluña, cobertura «cataluna», nunca comparados con Europa; - `ue-eurostat`: la UE-27 en conjunto (Parte II): empresas que usan IA por tamaño, tecnología, uso y motivo, IA generativa por finalidad, edad y estudios, capacidades digitales, especialistas en TIC y formación en TIC; - `decada-digital`: las metas para 2030 de la Decisión (UE) 2022/2481 (artículo 4) que mide un indicador del archivo, con su texto literal, en el bloque `metas`; el número de especialistas en TIC va en `recuentos`; - `eurobarometro`: opinión (Eurobarómetro especial 554, QB5, QB6.1–QB6.3, QB11.1–QB11.5 y QB3), en el bloque `encuestas` con «opinion»; - `ceo-panel`: opinión de Cataluña (CEO, Panel Ciutadà 2025, pregunta 26: de 7 a 10 en la probabilidad de que las máquinas o la IA sustituyan a las personas en la mayoría de los trabajos), en `encuestas`, solo de Cataluña; - `ilostat`: el peso de cada gran grupo ISCO-08 en el empleo y la parte de mujeres en él, en cada país con encuesta; - `ia-nacional`: el uso de la IA por las empresas medido por una estadística oficial nacional fuera de la UE (hoy, EE. UU., Canadá y Australia), cada país con su indicador y su definición, sin comparar; Islandia, el Reino Unido, Brasil, Suiza e Israel, igual, cada uno en su propio módulo (`ia-nacional-<iso3>`); y, aparte, el uso de la IA generativa por las personas de Corea del Sur (`ia-nacional-kor`, indicador `personas-ia-nacional-kor`); - `encuestas-isco4`: la exposición a la IA generativa CALCULADA con microdatos de encuestas oficiales de empleo (hoy, Brasil, Chile, Colombia y Uruguay), con los gradientes de la OIT (WP140), en el bloque `calculados` con «calculado» (`catalogo_calculado.py`): cada cifra con su intervalo del 95 % y su método, o sus cotas, y su encuesta y su cita; - `territorios`: el código ISO 3166-1 alfa-3 y el nombre en castellano y en catalán de cada país; - `clasificaciones` e `idescat`: el nombre oficial de cada gran grupo en las dos lenguas (en catalán, el de la CIUO-2008 (ca), salvo el del gran grupo 9, que es el de la CCO-2011 (ca): `GRUPOS_CON_NOMBRE_DE_LA_CCO`).
- Cada cifra lleva su año y, si su fuente la marca, su nota; cada indicador dice si es medido o estimado, su fuente, su licencia y si se compara entre territorios. Solo territorios: ninguna cifra describe a una persona. La fecha `generado` es la de la consulta más reciente de las fuentes que se vuelven a consultar en cada actualización (mundo-eurostat, ue-eurostat, ilostat, las medidas nacionales, tic-llars y clima-empresarial), no la del día en que se compone, para que las mismas entradas den siempre los mismos bytes. Python estándar.

## Recursos y condiciones de uso

- `entradas-conservadas` (familia): Conjuntos admitidos con sus procedencias/licencias individuales; el agregado no concede otra licencia.
  Ubicación: var/actualizacion/validados/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `composicion-local` (local): Lee conjuntos previamente admitidos y compone/valida el agregado. No descarga datos, no se convierte en productor primario ni admite nuevos indicadores.
  Recursos: entradas-conservadas. Autenticación: No aplicable al procesamiento local; no acredita cuenta, disponibilidad o tarea instalada.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.

## Operación actual

Política: `fija`. Consulta red: no.
Frecuencia declarada: la de sus fuentes (se compone, no se descarga). Aviso de renovación: no definido días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| datos_globales | derivada | entradas-admitidas | recomponer | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: clasificaciones, idescat, empresas, territorios, mundo_eurostat, ilostat, tic_llars, clima_empresarial, ue_eurostat, decada_digital, eurobarometro, ceo_panel, ia_nacional_isl, ia_nacional_gbr, ia_nacional_bra, ia_nacional_che, ia_nacional_isr, ia_nacional_kor.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.derivados.fuentes.datos_globales.lector preparar
python -m plataforma_datos.derivados.fuentes.datos_globales.lector validar
python -m plataforma_datos.contratos.fuentes --fuente datos_globales --tema derivados --comprobar
```
