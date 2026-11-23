"""El único sitio donde se dan de alta las fuentes en la sombra de la regla de retirada: un ámbito por línea.

Cada línea dice el ámbito, dónde se publican sus unidades (el prefijo en el catálogo de cursos servido, o el paquete de
datos: `catalogo_servido` y `paquete_servido`) y cómo se leen las declaraciones de su fuente. Las declaraciones se leen
de lo que la instalación conserva de la captura de la lectura (la `procedencia.json` de sus originales) con el
`declaraciones` del `lectura.py` de la fuente, que comprueba que es la captura de esa lectura. Una fuente que no afirma
nada, o cuyas declaraciones aún no se pueden leer después de la adquisición, se decide solo con la evidencia del
censo. Un ámbito que no publica unidades propias se salta.
"""

import json
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.decisiones_en_sombra import Alta
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion as adquisicion_cibernarium
from plataforma_datos.cursos.fuentes.barcelonactiva import lectura as lectura_cibernarium
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion as adquisicion_cibervoluntarios
from plataforma_datos.cursos.fuentes.cibervoluntarios import lectura as lectura_cibervoluntarios
from plataforma_datos.cursos.fuentes.citilab import lector as lector_citilab
from plataforma_datos.cursos.fuentes.citilab import lectura as lectura_citilab
from plataforma_datos.cursos.fuentes.claude_academy import lectura as lectura_academy
from plataforma_datos.cursos.fuentes.consorci import lectura as lectura_consorci
from plataforma_datos.cursos.fuentes.consorci.constantes import ACCIONES
from plataforma_datos.cursos.fuentes.formacion import lectura as lectura_soc
from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate, ediciones, lectura_preinscripcion
from plataforma_datos.cursos.fuentes.fundae import lectura as lectura_fundae
from plataforma_datos.cursos.fuentes.hp_life import lectura as lectura_hp_life
from plataforma_datos.cursos.operacion_fuente import rutas_de_la_fuente
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

type Declaradas = dict[str, tuple[Declaracion, ...]]


def _procedencia(carpeta: Path) -> ObjetoJson:
    return json.loads((carpeta / "procedencia.json").read_bytes())


def declaraciones_de_cibernarium(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """Las declaraciones de las ediciones, con las actividades de las páginas del censo que respondieron.

    Returns:
        Las declaraciones por edición.
    """
    original = rutas_de_la_fuente("barcelonactiva", raiz)[0]
    actividades = [
        actividad
        for captura in _procedencia(original)["capturas"]
        if adquisicion_cibernarium.fallo_de_pagina(original, captura) is None
        for actividad in adquisicion_cibernarium.actividades(original, captura)[0]
    ]
    return lectura_cibernarium.declaraciones(lectura, actividades)


def declaraciones_de_digitalizate(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """Las bajas declaradas de Digitalízate, con el censo que conserva la procedencia de su canal.

    Returns:
        Las declaraciones por recurso.

    Raises:
        ValueError: Si la procedencia no conserva un censo.
    """
    original = rutas_de_la_fuente("fundae", raiz)[0]
    censo = _procedencia(original).get("censo")
    if not censo:
        raise ValueError("la procedencia de Digitalízate no conserva su censo")
    return lectura_fundae.declaraciones(lectura, censo_digitalizate.leer(original, censo))


def declaraciones_de_preinscripcion(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """El fin de la preinscripción de cada edición, con lo que conserva la procedencia de las fichas de FUNDAE.

    Returns:
        Las declaraciones por edición.
    """
    fundae = rutas_de_la_fuente("fundae", raiz)[0].parent
    documento = _procedencia(fundae / ediciones.CARPETA)
    return lectura_preinscripcion.declaraciones(lectura, lectura_preinscripcion.capturar(fundae, documento))


def declaraciones_de_academy(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """Lo que afirma cada curso de Anthropic, con el índice y las fichas que conserva su procedencia.

    Returns:
        Las declaraciones por curso.
    """
    original = rutas_de_la_fuente("claude_academy", raiz)[0]
    procedencia = _procedencia(original)
    captura = lectura_academy.leer_captura(original, procedencia["auxiliares"]["indice"], procedencia["capturas"])
    return lectura_academy.declaraciones(lectura, captura)


def declaraciones_de_cibervoluntarios(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """Las bajas que declara Cibervoluntarios de cada material, con las páginas que conserva su procedencia.

    Returns:
        Las declaraciones por material.
    """
    original = rutas_de_la_fuente("cibervoluntarios", raiz)[0]
    paginas = (
        adquisicion_cibervoluntarios.pagina_para_la_lectura(original, captura)
        for captura in _procedencia(original)["capturas"]
    )
    materiales = tuple(material for pagina in paginas if pagina is not None for material in pagina.materiales)
    return lectura_cibervoluntarios.declaraciones(lectura, materiales)


def _originales(raiz: Path, fuente: str) -> Path:
    return raiz / DATOS_RELATIVOS / "originales" / fuente


def declaraciones_del_consorci(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """El fin publicado de cada edición del Consorci, con las filas de la última copia que conserva.

    Returns:
        Las declaraciones por edición.
    """
    original = _originales(raiz, lectura_consorci.FUENTE)
    return lectura_consorci.declaraciones(lectura, list(lectura_consorci.leer_captura(original, ACCIONES).filas))


def declaraciones_de_citilab(raiz: Path, lectura: ObjetoJson) -> Declaradas:
    """El fin publicado de cada ficha de Citilab, con las páginas de la última copia que conserva su procedencia.

    Returns:
        Las declaraciones por ficha.
    """
    original = _originales(raiz, lectura_citilab.FUENTE)
    procedencia = _procedencia(original)
    captura = lectura_citilab.leer_captura(original, procedencia["archivos"], procedencia["totales"])
    return lectura_citilab.declaraciones(lectura, captura.fichas, lector_citilab.calendario_de_la_ficha)


ALTAS: tuple[Alta, ...] = (
    Alta(
        fuente="barcelonactiva",
        ambito=lectura_cibernarium.AMBITO_EDICIONES,
        prefijo=lectura_cibernarium.PREFIJO_EDICION,
        declaraciones=declaraciones_de_cibernarium,
    ),
    # Cibernàrium sirve ediciones, no programas: el programa solo es el padre de cada edición servida.
    Alta(fuente="barcelonactiva", ambito=lectura_cibernarium.AMBITO_PROGRAMAS, prefijo=None),
    Alta(
        fuente="fundae",
        ambito=lectura_preinscripcion.AMBITO,
        prefijo=lectura_preinscripcion.PREFIJO,
        declaraciones=declaraciones_de_preinscripcion,
    ),
    Alta(
        fuente="fundae",
        ambito=lectura_fundae.AMBITO,
        prefijo=lectura_fundae.PREFIJO,
        declaraciones=declaraciones_de_digitalizate,
    ),
    Alta(
        fuente="cibervoluntarios",
        ambito=lectura_cibervoluntarios.AMBITO_MATERIALES,
        prefijo=lectura_cibervoluntarios.PREFIJO_MATERIAL,
        declaraciones=declaraciones_de_cibervoluntarios,
    ),
    # Cibervoluntarios sirve materiales; sus actividades no son unidades del catálogo.
    Alta(fuente="cibervoluntarios", ambito=lectura_cibervoluntarios.AMBITO_ACTIVIDADES, prefijo=None),
    # Los cursos del SOC, del Consorci y de Citilab se publican en el paquete de datos (`paquete_servido`). El SOC no
    # afirma nada que la regla lea: se decide solo con su censo.
    Alta(fuente=lectura_soc.FUENTE, ambito=lectura_soc.AMBITO, prefijo=None, en_el_paquete=True),
    Alta(
        fuente=lectura_consorci.FUENTE,
        ambito=lectura_consorci.AMBITO_EDICIONES,
        prefijo=None,
        declaraciones=declaraciones_del_consorci,
        en_el_paquete=True,
    ),
    # El paquete agrupa las acciones previstas por especialidad y no conserva su identificador
    # (`conjunto.previstas_por_especialidad`): sin unidades con el identificador de su lectura no hay qué comparar.
    Alta(fuente=lectura_consorci.FUENTE, ambito=lectura_consorci.AMBITO_PREVISTAS, prefijo=None),
    Alta(
        fuente=lectura_citilab.FUENTE,
        ambito=lectura_citilab.AMBITO,
        prefijo=None,
        declaraciones=declaraciones_de_citilab,
        en_el_paquete=True,
    ),
    # El índice de HP LIFE lista cursos, no estados: la fuente no afirma nada.
    Alta(fuente=lectura_hp_life.FUENTE, ambito=lectura_hp_life.AMBITO, prefijo=lectura_hp_life.PREFIJO),
    Alta(
        fuente=lectura_academy.FUENTE,
        ambito=lectura_academy.AMBITO,
        prefijo=lectura_academy.PREFIJO,
        declaraciones=declaraciones_de_academy,
    ),
)
