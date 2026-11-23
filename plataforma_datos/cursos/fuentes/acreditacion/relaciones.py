"""La relación entre una ocupación y un certificado profesional, con los datos oficiales y sin IA.

Una ocupación ESCO se relaciona con un certificado:
- «por su ocupación», si el anexo del certificado nombra uno de sus códigos CO-SISPE de la CNO-11: los que EURES le da
  como exactos, cercanos o más amplios (una variante más específica puede ser otro oficio);
- «por su grupo», si el anexo nombra una ocupación de uno de sus grupos CNO-11 de 4 cifras que es la suya dicha con
  otras palabras: una línea de ese grupo con un código que solo da el grupo (anterior a 2011, que el INE pasa a uno o
  varios grupos de la CNO-11, o de 4 cifras) cuyas palabras que distinguen están todas en los nombres de la ocupación
  (su título y sus nombres alternativos en ESCO y el nombre oficial de sus códigos en EURES). Un código de 8 cifras de
  la CNO-11 de otra ocupación es otro oficio. Así, «5330.001.0 Dependiente de comercio» (CNO-94, que el INE pasa a seis
  grupos de la CNO-11) vale para una asistente de tienda, cuyo código se llama «Dependientes de comercio, en general»,
  pero no para un vendedor de gasolinera, aunque su grupo esté entre esos seis; y «Dependiente de floristería», del
  mismo grupo, no vale para la asistente de tienda.
Sin un código propio en EURES, los grupos de la ocupación son los que el INE hace corresponder con su grupo ISCO-08, y
cuenta también la línea con el código de 8 cifras de otra ocupación de esos grupos que es la suya con otras palabras.
Un grupo ISCO-08 confirmado sin ocupación ESCO se relaciona, por grupo, con los certificados que comparte más de la
mitad de sus ocupaciones ESCO; si no hay ninguno, con ninguno.
La regla solo propone: se enseñan las relaciones que una revisión con cita literal admite, las proponga o no
(`cursos/fuentes/acreditacion/piezas/revision.py`, lo_que_se_ensena), y los grupos se calculan con esas.

Las palabras se comparan por su raíz (sin tildes, sin plural ni género, sus seis primeras letras) y solo cuentan las
que distinguen: no las vacías, ni las de un puesto que se da en cualquier oficio (técnico, operador, auxiliar…), ni las
que llevan más de MAX_OCUPACIONES_CON_LA_PALABRA ocupaciones ESCO (comercio, industria, empresa…). Una línea cuyas
palabras que distinguen son solo una función que se da en cualquier oficio (FUNCIONES: «Técnico en control de calidad»)
no dice de qué oficio es: relaciona solo en un certificado de esa función («Control de calidad de productos en textil y
piel»), donde nombra su propio trabajo. Se comparan en castellano, la lengua de ESCO, de EURES y del BOE: los nombres
catalanes de las ocupaciones ESCO son traducciones de Faro hechas con IA y no se usan para decidir una relación
oficial. Python estándar.
"""

import re
import unicodedata
from collections import Counter
from collections.abc import Container, Iterable
from functools import lru_cache
from typing import Any, NamedTuple


def _lista(palabras: str) -> frozenset[str]:
    """Una lista de palabras escrita como texto, que se lee mejor que una lista de cadenas.

    Va antes de las constantes porque las construye: es la única pieza del módulo que no sigue el orden de la guía.

    Returns:
        Las palabras de la lista.
    """
    return frozenset(palabras.split())


# Una variante más específica de la ocupación, según EURES: puede ser de otro oficio y de otro grupo.
CORRESPONDENCIA_EXCLUIDA = "estrecha"
# Una palabra que llevan más ocupaciones ESCO que estas no distingue una de otra.
MAX_OCUPACIONES_CON_LA_PALABRA = 100
# Una palabra de menos letras no cuenta: son artículos, preposiciones y siglas.
MIN_LETRAS = 4
LETRAS_DE_LA_RAIZ = 6
VACIAS = _lista(
    "de del la las el los y e en a al por para con o u sus su que se sin como segun tipo tipos clase otros otras "
    "general generales"
)
# Puestos que se dan en cualquier oficio: comparten el nombre, no el trabajo («diseñador web» / «diseñador de
# jardines»). Su raíz no cuenta.
PUESTOS = _lista(
    "tecnico operador operario auxiliar ayudante encargado jefe oficial empleado asistente especialista responsable "
    "director gerente coordinador supervisor disenador montador instalador mantenedor reparador conductor vendedor "
    "analista consultor agente gestor trabajador peon profesional experto inspector controlador monitor maestro mozo "
    "personal persona cualificado especializado"
)
# Funciones que se dan en cualquier oficio: el control de calidad de la pesca no es el de los motores ni el de una
# editorial. Su raíz cuenta al comparar, pero una línea que solo nombra una de ellas relaciona por grupo solo en un
# certificado de esa misma función.
FUNCIONES = _lista("calidad")
# Las líneas del anexo que no llevan a ningún grupo.
CLASES_SIN_GRUPO = ("sin-codigo", "desconocido")


# Las terminaciones que quita la raíz: primero el plural y después el género.
_PLURAL = re.compile(r"(es|s)$")
_GENERO = re.compile(r"[aoe]$")
# Textos distintos (nombres de certificado y líneas de anexo) cuyas raíces se recuerdan: hay unos miles; con el tope,
# la memoria queda acotada aunque llegue un catálogo mayor.
MAX_TEXTOS_RECORDADOS = 16_384


class Ocupacion(NamedTuple):
    """Lo que la regla usa de una ocupación: sus códigos CO-SISPE, sus grupos CNO-11 y las palabras de sus nombres."""

    codigos: frozenset[str]
    grupos: frozenset[str]
    palabras: frozenset[str]


def raiz(palabra: str) -> str:
    """Reduce una palabra sin tildes a su raíz: sus seis primeras letras tras quitar plural y género.

    Las terminaciones solo se quitan mientras la palabra pasa de MIN_LETRAS letras, así que en palabras cortas el
    singular, el plural y el género no siempre dan la misma raíz: «jefe» y «jefa» quedan enteras y «jefes» da «jef».
    En las de siete letras o más coinciden siempre («dependientes» y «dependienta»: «depend»).

    Args:
        palabra: La palabra, en minúsculas y sin tildes.

    Returns:
        La raíz.
    """
    if len(palabra) > MIN_LETRAS:
        palabra = _PLURAL.sub("", palabra)
    if len(palabra) > MIN_LETRAS:
        palabra = _GENERO.sub("", palabra)
    return palabra[:LETRAS_DE_LA_RAIZ]


# Las raíces de FUNCIONES, calculadas una vez; van tras `raiz` porque la usan.
RAICES_DE_FUNCIONES = frozenset(raiz(funcion) for funcion in FUNCIONES)


def raices(texto: str) -> list[str]:
    """Las raíces de las palabras de un texto, sin las vacías ni las más cortas.

    Returns:
        Las raíces, en el orden del texto.
    """
    sin_tildes = unicodedata.normalize("NFD", texto.lower()).encode("ascii", "ignore").decode()
    return [
        raiz(palabra)
        for palabra in re.findall(r"[a-z]+", sin_tildes)
        if len(palabra) >= MIN_LETRAS and palabra not in VACIAS
    ]


def que_no_distinguen(nombres_por_ocupacion: dict[str, list[str]]) -> frozenset[str]:
    """Las raíces que no cuentan: las de los puestos y las de más de MAX_OCUPACIONES_CON_LA_PALABRA ocupaciones.

    Returns:
        Las raíces que no distinguen.
    """
    ocupaciones_con = Counter(
        raiz_
        for nombres in nombres_por_ocupacion.values()
        for raiz_ in {de_un_nombre for nombre in nombres for de_un_nombre in raices(nombre)}
    )
    frecuentes = {raiz_ for raiz_, cuantas in ocupaciones_con.items() if cuantas > MAX_OCUPACIONES_CON_LA_PALABRA}
    return frozenset({raiz(puesto) for puesto in PUESTOS} | frecuentes)


def palabras(textos: Iterable[str], genericas: frozenset[str]) -> frozenset[str]:
    """Las raíces que distinguen de unos textos.

    Returns:
        Las raíces que distinguen.
    """
    return frozenset(raiz_ for texto in textos for raiz_ in raices(texto) if raiz_ not in genericas)


@lru_cache(maxsize=MAX_TEXTOS_RECORDADOS)
def _palabras_de(texto: str, genericas: frozenset[str]) -> frozenset[str]:
    """Calcula `palabras` de un solo texto una vez: la regla compara cada certificado con miles de ocupaciones.

    Args:
        texto: El nombre de un certificado o una línea de su anexo.
        genericas: Las raíces que no distinguen.

    Returns:
        Las raíces que distinguen del texto.
    """
    return palabras([texto], genericas)


def ocupacion(
    eures: list[tuple[str, str, str]], cno11_del_isco: Iterable[str], nombres: list[str], genericas: frozenset[str]
) -> Ocupacion:
    """Los códigos, los grupos y las palabras de una ocupación ESCO (ver la cabecera).

    `eures` son sus filas de la tabla EURES (código, correspondencia, nombre oficial del código); `nombres`, su título y
    sus nombres alternativos en ESCO.

    Returns:
        La ocupación con sus códigos, sus grupos y sus palabras.
    """
    codigos = frozenset(cosispe for cosispe, relacion, _ in eures if relacion != CORRESPONDENCIA_EXCLUIDA)
    grupos = frozenset(cosispe[:4] for cosispe in codigos) if codigos else frozenset(cno11_del_isco)
    return Ocupacion(codigos, grupos, palabras([*nombres, *(etiqueta for _, _, etiqueta in eures)], genericas))


def relacion(certificado: dict[str, Any], de: Ocupacion, genericas: frozenset[str]) -> str | None:
    """Cómo se relaciona un certificado con una ocupación: «ocupacion», «grupo» o None (ver la cabecera).

    Returns:
        «ocupacion», «grupo» o None si no se relacionan.
    """
    if not de.codigos.isdisjoint(certificado["ocupaciones"]):
        return "ocupacion"
    # Con códigos propios, un código de 8 cifras de otra ocupación del mismo grupo es otro oficio: no cuenta.
    no_cuentan = CLASES_SIN_GRUPO + (("cno11",) if de.codigos else ())
    del_certificado = _palabras_de(certificado.get("nombre_es") or "", genericas)
    for linea in (certificado["anexo"] or {}).get("ocupaciones", []):
        if linea["clase"] in no_cuentan or de.grupos.isdisjoint(linea["grupos"]):
            continue
        de_la_linea = _palabras_de(linea["texto"], genericas)
        if de_la_linea <= RAICES_DE_FUNCIONES and not de_la_linea <= del_certificado:
            continue  # solo nombra una función de cualquier oficio, y el certificado es de otra cosa
        if de_la_linea and de_la_linea <= de.palabras:
            return "grupo"
    return None


def del_grupo(relaciones_por_ocupacion: dict[str, dict[str, str]], ocupaciones_del_grupo: list[str]) -> dict[str, str]:
    """Los certificados de un grupo ISCO-08 sin ocupación ESCO: los que comparte más de la mitad de sus ocupaciones.

    Returns:
        {certificado: «grupo»} de los que comparte más de la mitad de sus ocupaciones.
    """
    cuantas = Counter(codigo for esco in ocupaciones_del_grupo for codigo in relaciones_por_ocupacion.get(esco, {}))
    return {codigo: "grupo" for codigo, veces in sorted(cuantas.items()) if veces > len(ocupaciones_del_grupo) / 2}


def variante(relaciones: dict[str, str], no_disponibles: Container[str]) -> str:
    """El bloque que corresponde a una ocupación según sus certificados relacionados.

    «por-ocupacion» con alguno que nombra su ocupación; «por-grupo» con alguno solo por su grupo; «sanidad» si solo los
    hay de cualificaciones que la Agència FP.CAT no acredita (profesiones sanitarias reguladas, `no_disponibles`);
    «sin-relacion» sin ninguno.

    Returns:
        El nombre de la variante del bloque.
    """
    acreditables = [rel for codigo, rel in relaciones.items() if codigo not in no_disponibles]
    if "ocupacion" in acreditables:
        return "por-ocupacion"
    if acreditables:
        return "por-grupo"
    return "sanidad" if relaciones else "sin-relacion"
