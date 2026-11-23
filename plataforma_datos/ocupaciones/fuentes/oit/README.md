# Tareas oficiales y exposición ocupacional a IA generativa

Generado de `fuente.json`; editar el descriptor y regenerar.

OIT: tareas oficiales ISCO-08 y exposición a la IA generativa (Working Paper 140, 2025).

ID: `oit` · tema: `ocupaciones` · institución: Organización Internacional del Trabajo; material complementario del autor.
Lector estático: `plataforma_datos.ocupaciones.fuentes.oit.lector`. Casa de datos: `oit`.

## Alcance

- Descarga desde las direcciones oficiales, prepara, cruza y valida. Python estándar; sin IA.
- Niveles de fuente: oficial publicado por la OIT (documento CC BY 4.0 y clasificación ISCO-08). complementaria material complementario que la OIT pone a disposición desde el documento oficial (nota de la figura 16): notas por tarea en el repositorio del autor principal. La política de acceso abierto de la OIT (desde el 3 de mayo de 2023) permite reutilizarlo sin permiso citando a la OIT.
- La tabla A1 fija la nota ocupacional; las notas por tarea son complementarias. Exposición por tareas y margen entre modelos publicados no equivalen a probabilidad individual de reemplazo, uso observado o calidad. No se ejecutan esos modelos.
- Las condiciones de reutilización de cada archivo se trasladan literalmente del catálogo existente; no se realiza una nueva verificación jurídica o de red.

## Recursos y condiciones de uso

- `recurso-01` (url): ILO Working Paper 140, versión HTML oficial (contiene la tabla A1 por ocupación)
  Ubicación: https://webapps.ilo.org/static/english/intserv/working-papers/wp140/index.html. Licencia: CC BY 4.0, declarada en la página 2 del documento. Exige cita y aviso de adaptación o traducción.
- `recurso-02` (url): ISCO-08: estructura y definiciones oficiales en inglés, con la lista «Tasks include» de cada grupo
  Ubicación: https://www.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/ISCO-08%20EN%20Structure%20and%20definitions.xlsx. Licencia: Clasificación oficial de la OIT anterior a 2023: se usa como clasificación de referencia, citando la fuente.
- `recurso-03` (url): Notas por tarea 2025 (Final_Scores_ISCO08_Gmyrek_et_al_2025.xlsx), enlazadas desde la figura 16 del documento oficial
  Ubicación: https://raw.githubusercontent.com/pgmyrek/2025_GenAI_scores_ISCO08/main/Final_Scores_ISCO08_Gmyrek_et_al_2025.xlsx. Licencia: Material complementario del WP140. El documento oficial (CC BY 4.0) remite a él: «task-level scores within the overall hierarchy of ISCO-08 are available here: https://pgmyrek.github.io/2025_GenAI_scores_ISCO08/». La política de acceso abierto de la OIT (desde el 3/5/2023) cubre «todos los materiales publicados o puestos a disposición por la OIT… hasta bases de datos», citando a la OIT. Comprobado el 27/09/2026: el repositorio del autor sigue sin archivo de licencia ni README. Se recomienda una confirmación escrita de cortesía a la OIT; no es obligatoria.
- `recurso-04` (url): OIT · Derechos y autorizaciones: política de acceso abierto (evidencia de las condiciones de reutilización)
  Ubicación: https://www.ilo.org/es/derechos-y-autorizaciones. Licencia: Página informativa oficial; se conserva como evidencia de las condiciones de reutilización.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `originales` (remoto): Descarga de la edición conocida, sin activar aceptación automática de cambios. No acredita vigencia posterior de clasificaciones ni nuevas ediciones descubiertas.
  Recursos: recurso-01, recurso-02, recurso-03, recurso-04. Autenticación: No se configura una cuenta en el lector.
  - Se conserva el transporte común y sus controles de procedencia; no se declara una cuota publicada de la fuente.

## Operación actual

Política: `edición`. Consulta red: sí.
Frecuencia declarada: sin calendario (estudio de exposición). Aviso de renovación: no definido días.
Originales: `oit`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| oit | cambiante | edicion-conocida | descargar | 30 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar.

Retirada: Se conservan las guardas actuales; un fallo no acredita ausencia ni retira la última versión admitida.

Conservación: Casas operativas y bytes del paquete conservados; no cambia modelos, motor, sello, datos ni criterios.

## Reproducción

```sh
python -m plataforma_datos.ocupaciones.fuentes.oit.lector preparar
python -m plataforma_datos.ocupaciones.fuentes.oit.lector validar
python -m plataforma_datos.contratos.fuentes --fuente oit --tema ocupaciones --comprobar
```
