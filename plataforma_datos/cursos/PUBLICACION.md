# Conexión pública de Cursos

`publicar_catalogo.publicar(solicitud, web=raiz_publica)` recibe la misma
`entrega_catalogo.SolicitudEntrega` ya preparada y validada. Reutiliza `exportar`
y su admisión cotidiana del catálogo V10, incluido el índice de evidencias físicas. No evalúa,
descarga, migra bases ni concede el permiso de una sección.

La salida es un único `datos/catalogo-cursos/<sha256>.json` y el módulo
`scripts/catalogo-cursos/referencia.js`, que fija ruta, SHA, bytes y revisión.
El SHA esperado se contrasta con el informe de proyección admitido: el archivo
no se acredita a sí mismo. Se conserva el puntero anterior si falla una etapa
anterior a su reemplazo. Un recurso estático nuevo huérfano no queda activo. Las entradas
privadas y sus alias no pueden estar dentro de la raíz pública. Repetir una
solicitud idéntica no cambia bytes o mtime.

Ejemplo de conexión, con rutas y referencias aportadas por la instalación:

```python
from pathlib import Path
from plataforma_datos.cursos import entrega_catalogo, publicar_catalogo

solicitud = entrega_catalogo.SolicitudEntrega(
    admision=admision_existente,
    sha256_admision=sha256_esperado_del_informe,
    area=Path(area_proyeccion),
    corte_utc=corte_explicito,
)
entrega_catalogo.preparar(solicitud)
entrega_catalogo.validar(solicitud)
publicar_catalogo.publicar(solicitud, web=Path(raiz_publica))
```

La recepción de HP ya preparada puede proporcionar `admision_existente` con
`hp_life.actualizacion.solicitud_admision(area_hp)` y el SHA esperado de su
informe conservado. No se busca el último archivo por fecha, no hay rutas de
un equipo fijadas en el código y no se admite un origen nuevo por pertenecer
al proveedor. La FAQ general, idiomas declarados y material observado mantienen
su alcance. Publicar estos hechos no concede licencia de los contenidos.

Después de componer el recurso se ejecuta la construcción web existente para
regenerar integridad y catálogos PWA. Solo entonces se activa esa generación
completa mediante el procedimiento de la instalación, fuera de tráfico.
La función de publicación local no firma ni despliega y no promete una
transacción ante muerte abrupta entre todos los archivos de la web.
No se publica `linaje-privado.json`, SQLite, recibos o políticas internas.

`componer_catalogo` solo llama a `publicar` con un almacén admitido que tiene cursos. Si el almacén falta, no se
lee con integridad o queda sin cursos, termina con código 1 y uno de los códigos `almacen-ausente`,
`almacen-ilegible` o `almacen-vacio`, sin escribir en `web/`; la entrega vigente sigue publicada. Cómo se siembra
un almacén nuevo está en el [README de Cursos](README.md#sembrar-un-almacén-nuevo).

`herramientas/web/catalogo-cursos.ts` construye con esbuild el lector TS en
`web/recursos/catalogo-cursos/lector.js`. La declaración adyacente reexporta las
firmas centrales y el manifiesto conserva la huella del paquete construido. La fuente TS y
el adaptador manuscrito siguen bajo tipos estrictos; únicamente el paquete
compilado se excluye de Biome. `web:preparar` lo reconstruye y `--comprobar`
comprueba equivalencia sin escribir. El módulo de referencia y el recurso estático se
incluyen en los recursos comprobados por huella de la PWA/SRI. No hay otra
implementación del lector ni del evaluador.

`web/cursos.html` carga este recurso diferido, sin el selector anterior. Los
filtros solo consultan texto, proveedor, idioma declarado y modalidad. El reloj
de plataforma retira una oferta cuando alcanza su límite publicado (`cierra_el`)
en la apertura, al recuperar visibilidad y al llegar el siguiente límite, también
sin red. Una oferta sin límite publicado sigue ofrecida y los hechos no caducan
con el reloj; la revisión interna de Faro solo avisa en el panel. Un recurso ausente o
corrupto produce un error explícito; un recurso válido sin ofertas suficientes
produce un estado vacío distinto. La comprobación no promete plaza o admisión
individual y los campos desconocidos no se convierten en ausencia de requisitos.

El documento de secciones v2 exige nueve claves. La lectura de v1 exige sus
ocho claves exactas y entrega una vista v2 con Cursos desactivado, sin modificar
el almacén ni la copia conservada. Cursos también comienza desactivado en configuraciones nuevas. Después de publicar
y comprobar la generación, la administración puede autorizarlo mediante
`POST /administracion/api/secciones/cambiar`, con sesión, revisión vigente y
`cursos: true`. Una instalación sin administración mantiene Cursos cerrado;
preparar el panel tampoco lo habilita. El publicador no cambia permisos. SQLite conserva el formato administrativo antiguo
hasta esa escritura; el formato 3 distingue los nueve permisos. El panel deriva
su interruptor del catálogo único de secciones. No se toma prestado el permiso
de Recorrido ni se modifica `/api/cursos`.

La publicación no consulta ninguna fuente: publica la exportación admitida que
recibe. El catálogo publicado es el que fija `scripts/catalogo-cursos/referencia.js`;
sin una exportación admitida no se publica un catálogo vacío ni se afirma ninguna
comprobación. HP LIFE se consulta cada día dentro del ciclo común de actualización
(`fuentes/hp_life/fuente.json`), y lo que llega entra en el catálogo por la misma
admisión, proyección y publicación que las demás fuentes.
