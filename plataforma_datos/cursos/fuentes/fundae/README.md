# FUNDAE: índices públicos y ediciones descubiertas en ellos

Generado de `fuente.json`; editar el descriptor y regenerar.

Los índices públicos de Digitalízate y formación subvencionada registran presencia de programas. Del índice de formación subvencionada salen las ediciones en teleformación con la preinscripción abierta de las especialidades que FUNDAE sitúa en IA o competencias digitales, cada una con su ficha consultada y su evidencia. La presencia no acredita acceso individual.

ID: `fundae` · tema: `cursos` · institución: FUNDAE · Fundación Estatal para la Formación en el Empleo.
Lector estático: `plataforma_datos.cursos.fuentes.fundae.lector`. Casa de datos: `fundae`.

## Alcance

- Solo especialidades en teleformación con la inscripción abierta y del ámbito de Faro según la propia fuente: área de interés de FUNDAE «Inteligencia Artificial» (38) u «Ofimática / Competencias digitales» (46), comprobadas por su nombre en el índice, o familia profesional Informática y comunicaciones del SEPE, deducida del prefijo IFC del código porque el índice no trae la familia
- Difusiones por especialidad, entidad y colectivos de cada edición abierta el día civil de España de su consulta, con cuerpo, recibo, huella y hora; contactos nunca exportados
- Preinscripción publicada no garantiza plaza; inicio de clases no publicado en este conjunto

## Recursos y condiciones de uso

- `respuestas` (familia): Fichas de la API pública de cada especialidad del índice de formación subvencionada en teleformación con la inscripción abierta: sus difusiones, y de cada edición abierta, la de su entidad y la de sus colectivos; nunca se exportan contactos.
  Ubicación: var/actualizacion/originales/fundae/ediciones/. Licencia: desconocida; no acreditada por este descriptor.
- `buscador` (url): Referencia pública de oferta; no es un permiso para activar la descarga de la API.
  Ubicación: https://experienciafundae.es/formacion-subvencionada. Licencia: desconocida; no acreditada por este descriptor.
- `catalogos` (familia): Tres índices públicos (espacio, Digitalízate y formación subvencionada) y el censo de Digitalízate: la lista de proveedores con su número de cursos y la ficha de cada proveedor con sus recursos. Se conservan hechos de presencia y de alta, sin reproducir contactos ni acreditar convocatorias.
  Ubicación: https://agora.fundae.es/Buscador/. Licencia: desconocida; no acreditada por este descriptor.

La licencia del código está en `LICENSE`; no concede derechos sobre recursos externos.

## Canales utilizados

- `fundae` (remoto): Un índice caído no consulta fichas: la salida anterior se conserva y la validación lo deja como consulta parcial. Cada edición publicada lleva en la validación la evidencia de su índice y sus fichas.
  Recursos: respuestas, buscador. Autenticación: Sin cuenta, cookies ni claves.
  - Consultas secuenciales mediante transporte central, al menos dos segundos por dominio: cada día los índices y las fichas de difusiones, empezando por una especialidad que rota con el día; las de entidad y colectivos, de ediciones nuevas o cambiadas y de las 60 reutilizadas más antiguas, con su parte del presupuesto reservada. Tope propio de 600 consultas y 30 minutos, con el plazo de red de cada consulta acotado a lo que queda; un corte queda como consulta parcial.
  - Una ausencia en el índice o un fallo de consulta conservan la edición con su evidencia anterior; la retirada exige que su plazo individual haya vencido o conste fuera de vigencia.
  - La descarga parte de las identidades FUNDAE del almacén de cursos: tras una siembra no hay consulta hasta restaurar el almacén conservado, que es lo normal: la siembra es el último recurso.
- `catalogos-publicos` (remoto): Originales, preparados y admisión bajo catalogos/ dentro de la misma casa FUNDAE; un fallo conserva la versión admitida y sus fechas.
  Recursos: catalogos. Autenticación: Sin cuenta, cookies ni claves.
  - Consultas secuenciales mediante transporte central, al menos dos segundos por dominio: tres índices, las listas activa y de baja de proveedores de Digitalízate y una ficha por proveedor activo con cursos o recursos conocidos, y por proveedor conocido fuera de las dos listas (unas 47 al día).
  - Un curso de Digitalízate solo cuenta como presente por la ficha de un proveedor de la lista activa (baja falsa, tipo «Curso» y destino público). Con un censo completo se retira si esa ficha lo da de baja o de otro tipo, o si falta de las fichas activas (proveedor activo, dado de baja o que ya no existe) y el buscador del catálogo 1 de ese día tampoco lo lista; si se contradicen, queda sin noticia y avisa. Un censo parcial no da ni altas ni bajas; una presencia no acredita acceso, matrícula ni gratuidad individual.

## Operación actual

Política: `diaria`. Consulta red: sí.
Frecuencia declarada: Consulta diaria de índices públicos y de las fichas de difusiones de las especialidades acotadas; entidad y colectivos, solo de ediciones nuevas o cambiadas. Aviso de renovación: 1 días.
Originales: `fundae`.

| Conjunto | Clase | Alcance | Operación | Intervalo de consulta (días UTC) |
| --- | --- | --- | --- | --- |
| fundae | cambiante | contenido-actual-acotado | descargar | 1 |

El intervalo de consulta no es la frecuencia de publicación ni acredita una tarea instalada.
Dependencias: ninguna declarada.
Contratos y controles: lector.py:validar, ediciones.py:leer, salida.py:componer, adquisicion.py:calcular, contrato-catalogos.md.

Retirada: Una edición deja de publicarse solo con evidencia: 404 o 410 de su ficha, un plazo que su ficha ya no da por abierto o su plazo vencido; una ausencia o un fallo de consulta no la retiran.

Conservación: Se conservan las rutas, originales, procedencias y revisiones actuales en var/actualizacion; este descriptor no habilita limpieza automática ni fija nuevos plazos de retención.

## Reproducción

```sh
python -m plataforma_datos.cursos.fuentes.fundae.lector preparar
python -m plataforma_datos.cursos.fuentes.fundae.lector validar
python -m plataforma_datos.contratos.fuentes --fuente fundae --tema cursos --comprobar
```
