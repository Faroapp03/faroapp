# Catálogo editorial de lecturas

Generado de `fuente.json`; editar el descriptor y regenerar.

Selección editorial de guías, informes y notas de la Biblioteca, con textos propios y referencias a publicaciones externas.

ID: `lecturas` · tema: `biblioteca` · institución: no declarada.
Lector estático: `plataforma_datos.biblioteca.fuentes.lecturas.lector`. Casa de datos: `lecturas`.

## Alcance

- La autoría en git es catalogo.json; datos/lecturas.json es su entrega byte a byte. La incorporación inicial conserva 75 lecturas y todos sus textos, idiomas, tipos, enlaces, fechas y licencias.
- La revisión general declarada 2026-10-07 y las consultas individuales se conservan como datos editoriales; ejecutar no comprueba enlaces ni renueva vigencia. Sin plazo editorial declarado, la vigencia queda no acreditada y la revisión pendiente.
- Los idiomas y tipos se validan mediante los contratos TypeScript existentes de la Biblioteca, sin trasladar sus reglas a Python. No se descargan ni redistribuyen documentos externos.

## Recursos y condiciones de uso

- `catalogo` (archivo): Autoría versionada del catálogo editorial.
  Ubicación: plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json. Licencia: Textos editoriales propios; las condiciones de las publicaciones enlazadas se conservan por lectura.
- `procedencia` (archivo): Huella de incorporación, autoría declarada y alcance de la fecha de revisión.
  Ubicación: plataforma_datos/biblioteca/fuentes/lecturas/procedencia.json. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `editorial` (editorial): Preparación y validación locales con procedencia; una modificación editorial exige revisar el catálogo y registrar su nueva huella.
  Recursos: catalogo, procedencia. Autenticación: Ninguna; lectura local del repositorio.
  - No consulta servicios remotos ni acredita que los enlaces sigan disponibles.
  - No hay plazo de vigencia editorial ni cadencia automática declarados.
  - Requiere Python 3.12 y Node local compatible con los módulos TypeScript del repositorio.

## Operación actual

Política: `redactada`. Consulta red: no.
Frecuencia declarada: revisión editorial explícita, sin cadencia automática declarada. Aviso de renovación: no definido días.
Sin carpeta de originales declarada.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| lecturas | editorial | copia-local | revision | no automático |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: herramientas/web/lecturas/registro.ts:comoRegistro, herramientas/web/lecturas/referencias.ts:comprobarReferencias, procedencia.json:sha256 y revision_declarada, lector.py:preparar, validar y exportar.

Retirada: Solo una modificación editorial explícita del catálogo retira una lectura. Un fallo local o un enlace no comprobado no se interpreta como retirada.

Conservación: La autoría y la procedencia quedan versionadas en git; preparados y admitidos se guardan en la casa lecturas de var/actualizacion. Exportar conserva bytes y fechas, comprueba las huellas actuales y no limpia históricos.

## Reproducción

```sh
python -m plataforma_datos.biblioteca.fuentes.lecturas.lector preparar
python -m plataforma_datos.biblioteca.fuentes.lecturas.lector validar
python -m plataforma_datos.contratos.fuentes --fuente lecturas --tema biblioteca --comprobar
```
