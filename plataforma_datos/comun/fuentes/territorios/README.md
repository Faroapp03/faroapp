# Nombres y códigos de territorios CLDR

Generado de `fuente.json`; editar el descriptor y regenerar.

Nombres de los países en castellano y en catalán, y su código ISO 3166-1 de dos y de tres letras (Unicode CLDR).

ID: `territorios` · tema: `comun` · institución: Unicode Consortium.
Lector estático: `plataforma_datos.comun.fuentes.territorios.lector`. Casa de datos: `territorios`.

## Alcance

- `datos-globales.json` nombra cada país en las dos lenguas de la web y lo identifica por su código ISO 3166-1 alfa-3, el que casa con las fronteras de Natural Earth. Eurostat publica los países con dos letras (con dos excepciones propias: «EL» para Grecia y «UK» para el Reino Unido) e ILOSTAT, con tres. El Common Locale Data Repository de Unicode es la referencia de los nombres de territorio por lengua (la que usan los navegadores y los sistemas) y trae la correspondencia entre los códigos de dos y de tres letras. Se fija una versión publicada: es una fuente fija, que solo cambia con un cambio de proyecto. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Unicode CLDR 48.0.0: nombres de territorios en castellano (es)
  Ubicación: https://raw.githubusercontent.com/unicode-org/cldr-json/48.0.0/cldr-json/cldr-localenames-full/main/es/territories.json. Licencia: Unicode License v3 (https://www.unicode.org/license.txt): uso, copia y redistribución libres siempre que el aviso de copyright y permiso acompañe a las copias o a su documentación (va en la procedencia y en datos/README.md).
- `recurso-02` (url): Unicode CLDR 48.0.0: nombres de territorios en catalán (ca)
  Ubicación: https://raw.githubusercontent.com/unicode-org/cldr-json/48.0.0/cldr-json/cldr-localenames-full/main/ca/territories.json. Licencia: Unicode License v3 (https://www.unicode.org/license.txt): uso, copia y redistribución libres siempre que el aviso de copyright y permiso acompañe a las copias o a su documentación (va en la procedencia y en datos/README.md).
- `recurso-03` (url): Unicode CLDR 48.0.0: correspondencia de los códigos de territorio (ISO 3166-1)
  Ubicación: https://raw.githubusercontent.com/unicode-org/cldr-json/48.0.0/cldr-json/cldr-core/supplemental/codeMappings.json. Licencia: Unicode License v3 (https://www.unicode.org/license.txt): uso, copia y redistribución libres siempre que el aviso de copyright y permiso acompañe a las copias o a su documentación (va en la procedencia y en datos/README.md).
- `recurso-04` (url): Unicode CLDR 48.0.0: aviso de copyright y permiso (Unicode License v3)
  Ubicación: https://raw.githubusercontent.com/unicode-org/cldr-json/48.0.0/LICENSE. Licencia: Unicode License v3 (https://www.unicode.org/license.txt): uso, copia y redistribución libres siempre que el aviso de copyright y permiso acompañe a las copias o a su documentación (va en la procedencia y en datos/README.md).

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): Recursos JSON de CLDR y su licencia; se conserva versión 48 y sus códigos. Una consulta de versión conocida no descubre sucesores ni modifica nombres.
  Recursos: recurso-01, recurso-02, recurso-03, recurso-04. Autenticación: No se configura autenticación de cuenta en este lector.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.

## Operación actual

Política: `fija`. Consulta red: sí.
Frecuencia declarada: por versión (Unicode CLDR 48). Aviso de renovación: no definido días.
Originales: `territorios`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| territorios | referencia-versionada | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.comun.fuentes.territorios.lector preparar
python -m plataforma_datos.comun.fuentes.territorios.lector validar
python -m plataforma_datos.contratos.fuentes --fuente territorios --tema comun --comprobar
```
