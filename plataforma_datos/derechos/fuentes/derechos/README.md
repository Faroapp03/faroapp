# Derechos laborales ante formación y tecnología

Generado de `fuente.json`; editar el descriptor y regenerar.

Derechos de quien trabaja, de formación y ante la tecnología: las citas literales que el informe muestra a todas.

ID: `derechos` · tema: `derechos` · institución: BOE; Consell de Relacions Laborals.
Lector estático: `plataforma_datos.derechos.fuentes.derechos.lector`. Casa de datos: `derechos`.

## Alcance

- El informe recuerda, igual para todas, tres derechos que convierten una formación «de pago» en tiempo de trabajo o en tiempo de la empresa: el Estatuto de los Trabajadores, art. 23.1.d (la formación para adaptarse a los cambios del puesto corre a cargo de la empresa y es tiempo de trabajo) y art. 23.3 (veinte horas anuales retribuidas), y el permiso individual de formación del Real Decreto 694/2017, art. 29 (formación oficial, con un máximo de 200 horas financiadas por permiso; y cómo se pide). Se citan literalmente, del BOE, con su enlace, sin prometer nada.
- El segundo grupo, «Tus derechos ante la IA y la tecnología en el trabajo», sale de tecnologia.py: citas del Estatuto (art. 64.4.d) y de la LOPDGDD (arts. 87 a 90) del texto consolidado del BOE, los pasajes del documento del Consell de Relacions Laborals (2025) en que se apoya el resumen que hace Faro de sus recomendaciones y las nueve cláusulas sectoriales de su anexo, que van solo en los datos.
- `descargar` lee los dos artículos vigentes de la API de datos abiertos del BOE y las páginas de los demás originales (los textos consolidados, el PDF del CRL y los dos convenios del BOE), una petición cada uno, con una pausa entre ellas; la extracción de texto del PDF no se descarga: se conserva con su huella y la del PDF del que sale. `preparar` comprueba que cada fragmento citado está, letra a letra, en la versión vigente de su artículo, y lo guarda con su enlace y su fecha; `validar` lo vuelve a comprobar con la huella de cada original. Las pruebas del motor exigen que el informe cite estos mismos fragmentos. Python estándar.

## Recursos y condiciones de uso

- `recurso-01` (url): Estatuto de los Trabajadores, artículo 23, todas sus versiones (API de datos abiertos del BOE)
  Ubicación: https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2015-11430/texto/bloque/a23. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).
- `recurso-02` (url): Real Decreto 694/2017, artículo 29, todas sus versiones (API de datos abiertos del BOE)
  Ubicación: https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2017-7769/texto/bloque/a2-11. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).
- `recurso-03` (url): Estatuto de los Trabajadores, texto consolidado (BOE)
  Ubicación: https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).
- `recurso-04` (url): Ley Orgánica 3/2018 (LOPDGDD), texto consolidado (BOE)
  Ubicación: https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).
- `recurso-05` (url): CRL: Recomendaciones a la negociación colectiva para la implementación de la digitalización y la IA (2025)
  Ubicación: https://treball.gencat.cat/web/.content/13_-_consell_relacions_laborals/documents/04_-_recursos/publicacions/Negociacio-collectiva/Recomanacions-IA/Recomendaciones-Digitalitzacion-IA-Cast-Acc-DEF.pdf. Licencia: Generalitat de Catalunya: Llicència oberta d'ús d'informació – Catalunya. El documento declara además «Los contenidos de esta obra están sujetos a una licencia de Reconocimiento - No comercial - Sin obras derivadas 3.0 de Creative Commons» (p. 3): Faro solo resume con sus palabras, cita pasajes breves y enlaza el original.
- `recurso-06` (archivo): Texto por páginas del PDF del CRL, extraído en la captura del 07/10/2026
  Ubicación: var/actualizacion/originales/derechos/crl-recomendaciones-ia-paginas-2026-10-07.json. Licencia: Generalitat de Catalunya: Llicència oberta d'ús d'informació – Catalunya. El documento declara además «Los contenidos de esta obra están sujetos a una licencia de Reconocimiento - No comercial - Sin obras derivadas 3.0 de Creative Commons» (p. 3): Faro solo resume con sus palabras, cita pasajes breves y enlaza el original.
- `recurso-07` (url): XXI Convenio colectivo general de la industria química (BOE)
  Ubicación: https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-3083. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).
- `recurso-08` (url): XXV Convenio colectivo del sector de la banca (BOE)
  Ubicación: https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-47. Licencia: Aviso legal del BOE: reutilización de sus contenidos citando la fuente (Ley 37/2007); las disposiciones legales no son objeto de propiedad intelectual (Real Decreto Legislativo 1/1996, art. 13).

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `consulta` (remoto): API XML de bloques vigentes BOE y páginas/PDF oficiales; la extracción de texto del CRL no se descarga ni se genera aquí.
  Recursos: recurso-01, recurso-02, recurso-03, recurso-04, recurso-05, recurso-07, recurso-08. Autenticación: No se configura autenticación de cuenta en este lector.
  - Rigen los controles y límites del lector; no se acredita una cuota remota nueva.
  - Sin consulta de red nueva en esta preparación; URL conservada no acredita disponibilidad actual.
- `extraccion-conservada` (local): Texto extraído conservado del PDF CRL, procesado con comprobación de procedencia; no una descarga ni otro productor.
  Recursos: recurso-06. Autenticación: No aplicable al procesamiento local.
  - La extracción de texto por páginas debe estar vinculada por SHA al PDF conservado.
  - El lector no genera esta extracción; un cambio de PDF exige aportar su extracción comprobada.

## Operación actual

Política: `mensual`. Consulta red: sí.
Frecuencia declarada: cuando el BOE consolida la norma. Aviso de renovación: no definido días.
Originales: `derechos`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| derechos | cambiante | contenido-actual-acotado | descargar | 7 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: No se retira contenido por fallo de consulta o ausencia de un original; se conservan las guardas de admisión existentes.

Conservación: Casas y bytes operativos en var/actualizacion conservados. Este descriptor no rejuvenece fechas, no genera traducciones, no limpia originales ni cambia la política de admisión.

## Reproducción

```sh
python -m plataforma_datos.derechos.fuentes.derechos.lector preparar
python -m plataforma_datos.derechos.fuentes.derechos.lector validar
python -m plataforma_datos.contratos.fuentes --fuente derechos --tema derechos --comprobar
```
