"""Fichas y relaciones ESCO leídas de la captura, con sus controles de coherencia y cobertura."""

import re
from collections import Counter
from typing import Any, NamedTuple

from plataforma_datos.comun.nucleo import (
    exigir,
)
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import (
    PREFIJO_URI,
    RELACIONES_COMPETENCIA,
    RELACIONES_OCUPACION,
    TIPOS_API,
)


class Registros(NamedTuple):
    """Contenido de la captura en el formato de los preparados, con sus métricas de cobertura."""

    meta: dict[str, Any]
    datos: dict[str, list[dict[str, Any]]]
    metricas: dict[str, Any]


class LecturaDeLaCaptura:
    """Estado de la lectura de la captura: registros, URI vistas, códigos y relaciones en ambos sentidos."""

    def __init__(self, meta: dict[str, Any]) -> None:
        self.meta = meta
        self.datos: dict[str, list[dict[str, Any]]] = {"ocupaciones": [], "competencias": [], "relaciones": []}
        self.vistas: dict[str, set[str]] = {tipo: set() for tipo in TIPOS_API.values()}
        self.codigos: set[str] = set()
        self.relaciones: set[tuple[str, str, str]] = set()
        self.inversas: set[tuple[str, str, str]] = set()

    def _campos_comunes(
        self, concepto: dict[str, Any], tipo: str, entrada: dict[str, Any], posicion: int
    ) -> dict[str, Any]:
        """Campos comunes a ocupaciones y competencias, comprobados; anota la URI como vista.

        Returns:
            Los campos comunes: URI, código, nombre, descripción y nombres alternativos.
        """
        uri = concepto.get("uri")
        exigir(isinstance(uri, str), f"concepto sin URI: {entrada['archivo']}, fila {posicion}")
        vistas = self.vistas[tipo]
        titulo = _objeto(concepto, "preferredLabel", uri).get("es")
        descripcion = _objeto(_objeto(concepto, "description", uri), "es", uri)
        exigir(isinstance(descripcion.get("literal", ""), str), "descripción no textual: " + uri)
        exigir(uri.startswith(PREFIJO_URI.format(tipo)) and uri not in vistas, "URI incorrecta o duplicada: " + uri)
        exigir(isinstance(titulo, str) and bool(titulo.strip()), "falta nombre español: " + uri)
        exigir(concepto.get("status") == "released", "concepto no activo: " + uri)
        alternativos = _objeto(concepto, "alternativeLabel", uri).get("es", [])
        validos = isinstance(alternativos, list) and all(
            isinstance(alternativo, str) and alternativo.strip() for alternativo in alternativos
        )
        exigir(validos, "denominaciones alternativas inválidas: " + uri)
        vistas.add(uri)
        return {
            "uri": uri,
            "titulo_es": titulo,
            "descripcion_es": descripcion.get("literal", ""),
            "descripcion_formato": descripcion.get("mimetype"),
            "nombres_alternativos_es": alternativos,
            "estado": concepto["status"],
            "version_solicitada": self.meta["version_solicitada"],
            "pagina_origen": entrada["archivo"],
            "fila_origen": posicion,
        }

    def _anadir_relaciones(
        self, ocupacion: dict[str, Any], concepto: dict[str, Any], entrada: dict[str, Any], posicion: int
    ) -> None:
        """Anota las competencias esenciales y opcionales de una ocupación, sin admitir relaciones repetidas."""
        for campo, tipo in RELACIONES_OCUPACION:
            for indice, competencia in enumerate(_enlaces(concepto, campo), 1):
                clave = (ocupacion["uri"], _uri(competencia, ocupacion["uri"]), tipo)
                exigir(clave not in self.relaciones, "relación duplicada en origen")
                self.relaciones.add(clave)
                self.datos["relaciones"].append(
                    {
                        "ocupacion_uri": ocupacion["uri"],
                        "competencia_uri": clave[1],
                        "tipo": tipo,
                        "pagina_origen": entrada["archivo"],
                        "fila_origen": posicion,
                        "campo_origen": campo,
                        "posicion_en_campo": indice,
                    }
                )

    def ocupacion(self, concepto: dict[str, Any], entrada: dict[str, Any], posicion: int) -> None:
        """Añade una ocupación y sus relaciones con competencias."""
        fila = self._campos_comunes(concepto, "occupation", entrada, posicion)
        codigo = concepto.get("code")
        valido = isinstance(codigo, str) and re.fullmatch(r"\d{4}(?:\.\d+)+", codigo) and codigo not in self.codigos
        exigir(bool(valido), "código ESCO inválido o duplicado")
        self.codigos.add(codigo)
        fila.update(
            codigo_esco=codigo,
            superiores=_uris(concepto, "broaderOccupation"),
            grupos_isco=_enlaces(concepto, "broaderIscoGroup"),
        )
        self.datos["ocupaciones"].append(fila)
        self._anadir_relaciones(fila, concepto, entrada, posicion)

    def competencia(self, concepto: dict[str, Any], entrada: dict[str, Any], posicion: int) -> None:
        """Añade una capacidad o conocimiento y anota sus relaciones inversas."""
        fila = self._campos_comunes(concepto, "skill", entrada, posicion)
        tipo, tipo_uri = _tipo_competencia(concepto)
        fila.update(
            tipo=tipo,
            tipo_uri=tipo_uri,
            reutilizacion=_enlaces(concepto, "hasReuseLevel"),
            superiores=_uris(concepto, "broaderSkill"),
            grupos_superiores=_enlaces(concepto, "broaderHierarchyConcept"),
        )
        self.datos["competencias"].append(fila)
        for campo, relacion in RELACIONES_COMPETENCIA:
            self.inversas.update((uri, fila["uri"], relacion) for uri in _uris(concepto, campo))

    def comprobar_coherencia(self) -> None:
        """Cobertura, jerarquías resueltas y relaciones coincidentes en ambos sentidos."""
        cuenta = {tipo: len(vistas) for tipo, vistas in self.vistas.items() if vistas}
        exigir(cuenta == self.meta["total_api"], "cobertura distinta del total de la API")
        for tabla, tipo in TIPOS_API.items():
            for fila in self.datos[tabla]:
                resueltas = all(superior in self.vistas[tipo] for superior in fila["superiores"])
                exigir(resueltas, "relación jerárquica sin resolver: " + fila["uri"])
        resueltas = all(
            ocupacion in self.vistas["occupation"] and competencia in self.vistas["skill"]
            for ocupacion, competencia, _ in self.relaciones
        )
        exigir(resueltas, "relación de ocupación y competencia sin resolver")
        faltan, sobran = len(self.relaciones - self.inversas), len(self.inversas - self.relaciones)
        exigir(self.inversas == self.relaciones, f"relaciones inversas inconsistentes: {faltan} / {sobran}")


def _tipo_competencia(concepto: dict[str, Any]) -> tuple[str, str | None]:
    """Tipo de una competencia (conocimiento, capacidad o sin especificar) y la URI de ese tipo en ESCO.

    Returns:
        (tipo, URI del tipo en ESCO); la URI es None si la competencia no tiene tipo.
    """
    tipos = _uris(concepto, "hasSkillType")
    exigir(
        len(tipos) <= 1 and (not tipos or tipos[0].rsplit("/", 1)[-1] in ("knowledge", "skill")),
        "tipo de capacidad desconocido: " + repr(tipos),
    )
    if not tipos:
        return "no_especificado", None
    tipo = "conocimiento" if tipos[0].endswith("/knowledge") else "capacidad_competencia"
    return tipo, tipos[0]


def _objeto(contenedor: dict[str, Any], clave: str, uri: str) -> dict[str, Any]:
    """Lee un campo de la captura que tiene que ser un objeto JSON; si falta, cuenta como vacío.

    Args:
        contenedor: El concepto, o un campo suyo que ya es un objeto.
        clave: El campo.
        uri: La URI del concepto, para el motivo del error.

    Returns:
        El objeto; uno vacío si el campo falta.

    Raises:
        FormatoInesperado: Si el campo existe y no es un objeto (null, texto, lista…).
    """
    valor = contenedor.get(clave, {})
    exigir(isinstance(valor, dict), f"campo «{clave}» que no es un objeto: {uri}")
    return valor


def _uri(enlace: object, de: object) -> str:
    """Lee la URI de un enlace de la captura.

    Args:
        enlace: El enlace, tal como llega.
        de: La URI del concepto que lo lleva, para el motivo del error.

    Returns:
        La URI.

    Raises:
        FormatoInesperado: Si el enlace no es un objeto con una URI de texto.
    """
    uri = enlace.get("uri") if isinstance(enlace, dict) else None
    exigir(isinstance(uri, str), f"enlace sin URI en {de}: {enlace!r}")
    return uri


def _enlaces(concepto: dict[str, Any], clave: str) -> list[dict[str, Any]]:
    """Lee los enlaces `_links[clave]` de un concepto, siempre como lista.

    Args:
        concepto: El concepto de la captura.
        clave: La relación (`hasEssentialSkill`, `broaderOccupation`…).

    Returns:
        Los enlaces; una lista vacía si no hay ninguno.

    Raises:
        FormatoInesperado: Si `_links` no es un objeto o algún enlace no lo es.
    """
    uri = concepto.get("uri")
    filas = _objeto(concepto, "_links", str(uri)).get(clave, [])
    filas = filas if isinstance(filas, list) else [filas]
    exigir(all(isinstance(fila, dict) for fila in filas), f"enlace «{clave}» que no es un objeto: {uri}")
    return filas


def _uris(concepto: dict[str, Any], clave: str) -> list[str]:
    """Lee las URI de los enlaces `_links[clave]` de un concepto.

    Args:
        concepto: El concepto de la captura.
        clave: La relación.

    Returns:
        Las URI de los enlaces, en orden.
    """
    return [_uri(enlace, concepto.get("uri")) for enlace in _enlaces(concepto, clave)]


def _campos_que_faltan(tabla: str, fila: dict[str, Any]) -> list[str]:
    """Campos vacíos en el original: la descripción de cualquier ficha o el tipo de una competencia.

    Returns:
        Los nombres de los campos vacíos.
    """
    faltan = []
    if not fila["descripcion_es"].strip():
        faltan.append("descripcion_es")
    if tabla == "competencias" and fila["tipo_uri"] is None:
        faltan.append("tipo_uri")
    return faltan


def metricas(datos: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Cobertura de la captura: cantidades, tipos y cuántas fichas tienen descripción y nombres alternativos.

    Returns:
        Cantidades, tipos y número de fichas con descripción y con nombres alternativos.
    """
    metricas: dict[str, Any] = {
        "ocupaciones": len(datos["ocupaciones"]),
        "competencias": len(datos["competencias"]),
        "relaciones": len(datos["relaciones"]),
        "tipos_competencias": dict(Counter(fila["tipo"] for fila in datos["competencias"])),
        "tipos_relaciones": dict(Counter(fila["tipo"] for fila in datos["relaciones"])),
    }
    for clave in ("ocupaciones", "competencias"):
        filas = datos[clave]
        metricas[clave + "_con_descripcion_es"] = sum(bool(fila["descripcion_es"].strip()) for fila in filas)
        metricas[clave + "_con_nombres_alternativos_es"] = sum(bool(fila["nombres_alternativos_es"]) for fila in filas)
        metricas[clave + "_nombres_alternativos_es"] = sum(len(fila["nombres_alternativos_es"]) for fila in filas)
    metricas["competencias_sin_tipo_explicito"] = sum(
        fila["tipo"] == "no_especificado" for fila in datos["competencias"]
    )
    return metricas


def campos_ausentes(datos: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Campos que faltan en el propio original (descripción o tipo de competencia): se documentan, no se inventan.

    Returns:
        Un registro por campo ausente, con la ficha y el campo.
    """
    return [
        {
            "uri": fila["uri"],
            "titulo_es": fila["titulo_es"],
            "campo": campo,
            "pagina_origen": fila["pagina_origen"],
            "fila_origen": fila["fila_origen"],
        }
        for tabla in ("ocupaciones", "competencias")
        for fila in datos[tabla]
        for campo in _campos_que_faltan(tabla, fila)
    ]
