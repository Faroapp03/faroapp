"""Constantes de la fuente Citilab que comparten su lector, su paginación y su cobertura."""

FUENTE = "citilab"
API = "https://www.citilab.eu/wp-json/wp/v2"
# Segundos entre dos peticiones a la API de la web de Citilab, la misma pausa que la cadena guarda con el BOE.
PAUSA_ENTRE_PETICIONES_S = 2.0
# Elementos por petición. Cada página se conserva tal como llega y se exige que su tamaño y los totales WordPress que
# declara (x-wp-total, x-wp-totalpages) concuerden; las páginas de un recurso se juntan al leer la copia.
POR_PAGINA = 100
# Páginas como máximo por recurso (2.000 fichas): una colección que declare más se revisa antes de hacer tantas
# peticiones seguidas a su web.
MAX_PAGINAS = 20
# Lo que dice la etapa cuando la web contesta con una página HTML (una comprobación anti-robots, aunque llegue con un
# estado 2xx) en lugar de la colección JSON. La orquestación lo reconoce y lo anota con su propia causa; no se intenta
# saltar la comprobación: la fuente conserva su última versión y el ciclo siguiente vuelve a consultar.
PAGINA_DE_COMPROBACION = "la fuente responde con una página de comprobación y no con datos"
LICENCIA = (
    "Condiciones de uso de citilab.eu (https://www.citilab.eu/condicions-dus/, fechadas el 23/09/2026 y "
    "consultadas el 06/10/2026), apartado 7: «Sólo se autoriza la utilización de los contenidos del dominio web con "
    "fines informativos y de servicio, siempre que se cite o se haga referencia a la fuente». Faro muestra solo "
    "hechos, con la fuente y el enlace a la ficha; sin descripciones, imágenes ni logos."
)
# Los dos vocabularios de la API con que Citilab clasifica las fichas (CONSULTAS los pide, `leer_copia` los lee).
VOCABULARIOS = ("public", "tipus-formacio")
# Las tres consultas de una copia: las fichas y los dos vocabularios con que Citilab las clasifica.
CONSULTAS = (
    ("formacio", "id,modified,link,title,content,public,estat,tipus-formacio", "Fichas de formación"),
    (VOCABULARIOS[0], "id,slug,name", "Vocabulario «a quién se dirige»"),
    (VOCABULARIOS[1], "id,slug,name", "Vocabulario «tipo de formación»"),
)
