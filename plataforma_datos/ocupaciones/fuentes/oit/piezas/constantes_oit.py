"""Procedencia, archivos y reglas declaradas de oit; las etapas viven en `ocupaciones/fuentes/oit/lector.py`."""

from types import MappingProxyType

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable

FUENTE = "oit"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: los grupos primarios ISCO-08 (las «ocupaciones» de 4 cifras de la tabla A1),
# sus tareas oficiales y el contraste entre las notas del autor y la tabla A1.
OCUPACIONES = PREPARADO / "ocupaciones-isco08.jsonl"
TAREAS = PREPARADO / "tareas-isco08.jsonl"
CONTRASTE = PREPARADO / "contraste-autor-tabla-a1.json"
DOI_WP140 = "https://doi.org/10.54394/HETP0387"
CITA = (
    "Gmyrek, P., Berg, J., Kamiński, K., Konopczyński, F., Ładna, A., Nafradi, B., Rosłaniec, K., Troszyński, M. "
    "Generative AI and Jobs: A Refined Global Index of Occupational Exposure. ILO Working Paper 140. "
    f"Geneva: International Labour Office, 2025. © ILO. {DOI_WP140}"
)
# Los avisos que la licencia del WP140 (página 2 del documento) exige junto a la cita en una adaptación (las notas y
# medias del paquete) y en una traducción (los textos de las tareas en castellano y en catalán). Son literales y van
# enteros: `validar` los compara con los del documento oficial.
AVISO_ADAPTACION = (
    "This is an adaptation of a copyrighted work of the International Labour Organization (ILO). This adaptation has "
    "not been prepared, reviewed or endorsed by the ILO and should not be considered an official ILO adaptation. The "
    "ILO disclaims all responsibility for its content and accuracy. Responsibility rests solely with the author(s) of "
    "the adaptation."
)
AVISO_TRADUCCION = (
    "This is a translation of a copyrighted work of the International Labour Organization (ILO). This translation "
    "has not been prepared, reviewed or endorsed by the ILO and should not be considered an official ILO translation. "
    "The ILO disclaims all responsibility for its content and accuracy. Responsibility rests solely with the "
    "author(s) of the translation."
)
# Cada aviso tal como lo publica el documento: de «This is a…» a «…the author(s) of the translation.». Lleva el
# marcador `{tipo}` («adaptation» o «translation») y se compone con `PATRON_AVISO.format(tipo=...)`: una llave más en
# el patrón rompería esa composición.
PATRON_AVISO = (
    r"This is an? {tipo} of a copyrighted work of the International Labour Organization \(ILO\)\..*?"
    r"Responsibility rests solely with the author\(s\) of the {tipo}\."
)
LICENCIA_CLASIFICACION_OIT = (
    "Clasificación oficial de la OIT anterior a 2023: se usa como clasificación de referencia, citando la fuente."
)
LICENCIA = (
    "WP140: CC BY 4.0 (página 2 del documento), con la cita de la OIT y, en una traducción o una adaptación, su aviso "
    "literal; sin usar el emblema, el nombre ni el logotipo de la OIT como aval. ISCO-08 y notas por tarea: política "
    "de acceso abierto de la OIT, citando a la OIT. Detalle por archivo en «archivos»."
)
# Lo que la licencia no permite: dar a entender que la OIT avala una traducción o adaptación (va a la procedencia).
PROHIBIDO = "Usar el emblema, el nombre o el logotipo de la OIT como aval de traducciones o adaptaciones."
DOCUMENTO = "wp140-documento.html"
ESTRUCTURA = "isco08-estructura-definiciones.xlsx"
NOTAS_AUTOR = "notas-tareas-isco08-autor.xlsx"
POLITICA = "politica-derechos-oit.html"
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": DOCUMENTO,
        "nivel": "oficial",
        "titulo": "ILO Working Paper 140, versión HTML oficial (contiene la tabla A1 por ocupación)",
        "url": "https://webapps.ilo.org/static/english/intserv/working-papers/wp140/index.html",
        "licencia": "CC BY 4.0, declarada en la página 2 del documento. Exige cita y aviso de adaptación o traducción.",
    },
    {
        "archivo": ESTRUCTURA,
        "nivel": "oficial",
        "titulo": "ISCO-08: estructura y definiciones oficiales en inglés, con la lista «Tasks include» de cada grupo",
        "url": "https://www.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/ISCO-08%20EN%20Structure%20and%20definitions.xlsx",
        "licencia": LICENCIA_CLASIFICACION_OIT,
    },
    {
        "archivo": NOTAS_AUTOR,
        "nivel": "complementaria",
        "titulo": "Notas por tarea 2025 (Final_Scores_ISCO08_Gmyrek_et_al_2025.xlsx), enlazadas desde la figura 16 del "
        "documento oficial",
        "url": "https://raw.githubusercontent.com/pgmyrek/2025_GenAI_scores_ISCO08/main/Final_Scores_ISCO08_Gmyrek_et_al_2025.xlsx",
        "licencia": "Material complementario del WP140. El documento oficial (CC BY 4.0) remite a él: «task-level "
        "scores within the overall hierarchy of ISCO-08 are available here: "
        "https://pgmyrek.github.io/2025_GenAI_scores_ISCO08/». La política de acceso abierto de la OIT (desde el "
        "3/5/2023) cubre «todos los materiales publicados o puestos a disposición por la OIT… hasta bases de datos», "
        "citando a la OIT. Comprobado el 27/09/2026: el repositorio del autor sigue sin archivo de licencia ni README. "
        "Se recomienda una confirmación escrita de cortesía a la OIT; no es obligatoria.",
    },
    {
        "archivo": POLITICA,
        "nivel": "oficial",
        "titulo": "OIT · Derechos y autorizaciones: política de acceso abierto (evidencia de las condiciones de "
        "reutilización)",
        "url": "https://www.ilo.org/es/derechos-y-autorizaciones",
        "licencia": "Página informativa oficial; se conserva como evidencia de las condiciones de reutilización.",
        # Página informativa: se conserva la primera captura aunque la página cambie.
        "conservar_primera_captura": True,
    },
]
# Los rótulos de la tabla A1 y de las notas del autor → la clave del gradiente en el paquete. Solo lectura.
GRADIENTES = MappingProxyType(
    {
        "Exposed: Gradient 4": "gradiente_4",
        "Exposed: Gradient 3": "gradiente_3",
        "Exposed: Gradient 2": "gradiente_2",
        "Exposed: Gradient 1": "gradiente_1",
        "Gradient 4": "gradiente_4",
        "Gradient 3": "gradiente_3",
        "Gradient 2": "gradiente_2",
        "Gradient 1": "gradiente_1",
        "Minimal Exposure": "exposicion_minima",
        "Not Exposed": "no_expuesta",
    }
)
TITULO_TABLA_A1 = "Table A1. ISCO-08 occupations by exposure gradient"
CABECERA_TABLA_A1 = ["Exposure", "4-digit code", "Occupation Name", "Mean", "SD"]
# ISCO-08, estructura oficial: 436 grupos primarios (4 dígitos). WP140, tabla A1: nota para 427 de ellos.
GRUPOS_PRIMARIOS_ISCO08 = 436
OCUPACIONES_TABLA_A1 = 427
# Filas del autor que no son tareas oficiales (encabezados como «In such cases tasks performed would include -»):
# se excluyen y se documentan. Con más de una, habría que revisar el cruce.
MAX_FILAS_AUTOR_SIN_TAREA = 1
# La tabla A1 publica media y desviación con dos decimales: diferencias menores son redondeo.
TOLERANCIA_A1 = 0.005
# Holgura de coma flotante al comprobar que una nota queda dentro del margen de sus dos modelos.
HOLGURA = 1e-9
# Los grupos primarios de ISCO-08: código de cuatro cifras, que es el nivel 4 de la estructura.
CIFRAS_DEL_GRUPO_PRIMARIO = 4
NIVEL_DEL_GRUPO_PRIMARIO = str(CIFRAS_DEL_GRUPO_PRIMARIO)
# La nota de cada tarea la dan dos modelos (GPT-4o y Gemini): el margen solo existe con las dos.
MODELOS_DE_LA_NOTA = 2
# Las frases que deben seguir en la página de la política de la OIT para dar por vigente su permiso de reutilización.
FRASES_POLITICA = ("sin necesidad de solicitar permiso", "bases de datos")
