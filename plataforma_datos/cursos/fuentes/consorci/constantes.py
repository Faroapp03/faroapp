"""Declaraciones, tipos, procedencia y reglas de los cuatro conjuntos del Consorci."""

import re
from typing import Any, NamedTuple

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA
from plataforma_datos.comun.socrata import (
    LICENCIA_DE_LA_GENERALITAT,
    Conjunto,
)

FUENTE = "consorci"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
EDICIONES = PREPARADO / "ediciones.jsonl"
PREVISTAS = PREPARADO / "previstas.jsonl"
SIN_FECHA = PREPARADO / "programadas-sin-fecha.json"
RESUMEN = PREPARADO / "resumen.json"
# Versiones admitidas de jdcj-za6r con la huella de su oferta: las candidatas a pareja de 7vig-4syr (oferta_emparejada).
VERSIONES_DE_LOS_CURSOS = VALIDADO / "versiones-de-jdcj-za6r.json"

NOMBRE_FUENTE = "Consorci per a la Formació Contínua de Catalunya · cursos para personas que trabajan"
ORGANISMO = (
    "Generalitat de Catalunya. Departament d'Empresa i Treball. Consorci per a la Formació Contínua de Catalunya"
)
LICENCIA = LICENCIA_DE_LA_GENERALITAT.format(cita=f" («{ORGANISMO}»)")
# Buscador oficial de cursos del Consorci: la persona encuentra ahí lo que el informe no muestra.
BUSCADOR = "https://conforcat.gencat.cat/ca/Treballadors/cercador-cursos-del-consorci/"
# Página de contacto del Consorci: a ella se envía a la persona para preguntar por un curso de una entidad que es una
# persona física, cuyo contacto Faro no guarda (contactos.py). No hay página propia de cada curso ni de cada edición:
# los cuatro conjuntos no la publican, y el buscador es un informe de Power BI incrustado con «Publicar en la web», que
# no admite filtros en la dirección. La página de contacto ofrece los teléfonos de atención del Consorci.
CONTACTO_OFICIAL = "https://conforcat.gencat.cat/ca/contacte/"
# Lo que publican los conjuntos y comprueba la validación: a quién se dirigen, cuánto cuestan y cómo se imparten.
DESTINATARIOS_OCUPADAS = "Persones treballadores ocupades"
PRECIO_GRATUITO = "0"
FINANCIACION_PUBLICA = "Sí"
PRECIO_SUBVENCIONADO = "Subvencionat"
EN_PROGRAMACION = "En programació"
ORIGEN_CONSORCI = "CFCC"
# Modalidades que publica el Consorci. En las dos a distancia, el municipio de la edición es el de la entidad.
TELEFORMACION = "Teleformació"
ADAPTADA_A_AULA_VIRTUAL = "Adaptada a Aula virtual"
PRESENCIAL = "Presencial"
MODALIDADES_A_DISTANCIA = (TELEFORMACION, ADAPTADA_A_AULA_VIRTUAL)
# Cada modalidad con la letra que la distingue en el identificador de una edición: una misma acción se publica a veces
# con las mismas fechas en dos modalidades, que son dos ediciones.
LETRA_DE_MODALIDAD = {PRESENCIAL: "p", TELEFORMACION: "t", ADAPTADA_A_AULA_VIRTUAL: "v"}
MODALIDADES = tuple(LETRA_DE_MODALIDAD)
# Cómo se encuentra el código de especialidad de una edición o de una acción prevista (campo «union» de cada una y
# recuento «union» del resumen), por orden de preferencia; la última, si no se encuentra.
UNION_CERTIFICADO = "certificado-en-el-nombre"
UNION_NOMBRE_Y_FECHA = "nombre-y-fecha"
UNION_EDICIONES_DE_LA_ACCION = "ediciones-de-la-accion"
UNION_NOMBRE = "nombre"
UNION_SIN_CODIGO = "sin-codigo"
# Las acciones previstas se publican como presenciales, en teleformación o mixtas.
MODALIDADES_PREVISTAS = (PRESENCIAL, TELEFORMACION, "Mixta")
# Por debajo de esta parte de ediciones (o de acciones previstas) con su código de especialidad, la unión ha fallado.
MIN_PARTE_CON_CODIGO = 0.85
# Un módulo de certificado lleva su código en el nombre: «B_SSCS0108_MF0249_Higiene…».
# Se admite también el prefijo «: » de los nombres publicados en qv5z-dgk3.
PATRON_MODULO = re.compile(r"^(?::\s*)?B_([A-Z]{4}\d{4})_(MF\d{4}(?:_\d)?)_(.+)$")
# Las entidades del paquete se citan por un identificador propio («e001»), nunca por su NIF.
FORMATO_ENTIDAD = "e{:03d}"
# Lo que identifica a una entidad de las acciones previstas, y lo que el paquete guarda de ella.
CAMPOS_DE_LA_ENTIDAD = ("entidad", "municipio", "web", "correo", "telefono", "contacto_oficial")
# Campos y momentos del contrato exportado de una edición.
CAMPOS_DE_LA_EDICION = (
    "id",
    "nombre",
    "certificado",
    "modulo",
    "especialidad",
    "modalidad",
    "a_distancia",
    "municipio",
    "inicio",
    "fin",
    "horas",
    "entidad",
    "web",
    "correo",
    "telefono",
    "contacto_oficial",
)
TERMINADO = "terminado"
SIN_FECHA_CONOCIDA = "sin-fecha"
POR_INICIAR = "por-iniciar"
INICIADO = "iniciado"
# Los cuatro conjuntos de Dades Obertes que se leen.
ACCIONES = Conjunto(
    "qv5z-dgk3", "Accions formatives programades pel Consorci per a la Formació Contínua de Catalunya", LICENCIA
)
CURSOS = Conjunto(
    "jdcj-za6r",
    "Cursos programats i en programació pel Consorci per a la Formació Contínua de Catalunya (FPCAT 365)",
    LICENCIA,
)
OFERTA = Conjunto(
    "7vig-4syr", "Oferta formativa FPCAT (nou), filas del Consorci", LICENCIA, filtro=f"origen='{ORIGEN_CONSORCI}'"
)
ACCIONES_PREVISTAS = Conjunto(
    "hhvr-cedj", "Accions formatives previstes pel Consorci per a la Formació Contínua de Catalunya", LICENCIA
)
CONJUNTOS = (ACCIONES, CURSOS, OFERTA, ACCIONES_PREVISTAS)
# Los conjuntos del Consorci que se muestran a la persona: su fecha de actualización va en la cita.
CONJUNTOS_CITADOS = (ACCIONES, CURSOS, ACCIONES_PREVISTAS)


class IndiceDeCursos(NamedTuple):
    """Códigos de especialidad de jdcj-za6r por nombre de curso y fecha de inicio, y por nombre solo."""

    por_nombre_y_fecha: dict[tuple[str, str], set[str]]
    por_nombre: dict[str, set[str]]


class Copia(NamedTuple):
    """Las filas de los conjuntos de una copia y sus metadatos."""

    fecha: str
    filas: dict[str, list[dict[str, Any]]]
    metadatos: dict[str, dict[str, Any]]


class Preparados(NamedTuple):
    """Lo que escribe preparar y lee validar."""

    ediciones: list[dict[str, Any]]
    previstas: list[dict[str, Any]]
    sin_fecha: dict[str, int]
    resumen: dict[str, Any]
    versiones: tuple[dict[str, Any], ...] = ()
