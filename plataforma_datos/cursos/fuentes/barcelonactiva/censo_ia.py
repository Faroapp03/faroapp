"""Cibernàrium: el censo de sus formaciones de IA, con el filtro de ámbito del propio proveedor.

La consulta pública de formaciones del Cibernàrium filtra por ámbito con `_<portlet>_scopeIds`. El ámbito 22 es el de
inteligencia artificial: cada ciclo empieza por la página de filtros (ambitos.py), que tiene que seguir llamándolo
«Intel·ligència Artificial (IA)» y de la que sale la instancia del portlet. Este censo pide esas páginas con el mismo
transporte y la misma paginación que el censo completo del canal cibernarium/ y conserva cada respuesta con su cuerpo y
su recibo en cibernarium-ia/. Su lectura solo da el censo por completo si respondieron todas las páginas y suman el
total que publica la primera; una página caída lo deja parcial y nada se da por ausente. De cada actividad publicada
antes que falta en un censo completo se consulta su ficha: solo un 404 o un 410 de esa ficha la cierra.
"""

from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, ambitos
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

CARPETA = "cibernarium-ia"
CERRADA = frozenset({HTTPStatus.NOT_FOUND, HTTPStatus.GONE})
CENSO_IA_PARCIAL = "censo-ia-parcial"
AMBITO_IA = ambitos.AMBITO_IA
Recibir = Callable[[str, Path], dict[str, Any]]


def url_pagina(desde: int, portlet: str = robot.PORTLET) -> str:
    """La página `desde` de la consulta pública de formaciones del ámbito de IA.

    Returns:
        La URL del censo completo del canal para esa página, con el filtro de ámbito.
    """
    return adquisicion.url_pagina(desde, portlet) + f"&_{portlet}_scopeIds={AMBITO_IA}"


def _recibir(url: str, carpeta: Path) -> dict[str, Any]:
    return comun.recibir_url(url, carpeta, None, perfil="datos")


def evidencia(captura: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Lo que acredita una página: dirección, código, hora, cuerpo y recibo conservados, con sus huellas.

    Returns:
        La evidencia de la página.
    """
    return {
        "url": meta["url"],
        "http": meta.get("http"),
        "consultado_utc": meta["fin_utc"],
        "cuerpo": captura.get("cuerpo"),
        "recibo": captura["recibo"],
    }


def pagina(
    carpeta: Path, captura: dict[str, Any], desde: int, portlet: str = robot.PORTLET
) -> tuple[tuple[int, list[dict]] | None, dict]:
    """Lee una página del censo de IA tras comprobar su dirección, su recibo y su cuerpo.

    Returns:
        El total publicado y las actividades, o None si la página no respondió un JSON completo; y su recibo.

    Raises:
        FormatoInesperado: Si la captura es de otra página o su cuerpo no es el del recibo.
    """
    cuerpo, meta = adquisicion.pagina(carpeta, captura)
    comun.exigir(meta["url"] == url_pagina(desde, portlet), "Página del censo de IA ajena", FormatoInesperado)
    tipo = meta.get("content_type")
    if (
        cuerpo is None
        or meta["completo"] is not True
        or meta["http"] != HTTPStatus.OK
        or meta.get("url_final") != meta["url"]
        or not isinstance(tipo, str)
        or tipo.split(";", 1)[0].strip().lower() != "application/json"
    ):
        return None, meta
    try:
        return robot.validar_pagina(recibos_compartidos.leer_json(cuerpo), desde), meta
    except robot.ErrorRobot as error:
        raise FormatoInesperado(f"Página {desde} del censo de IA: {error}") from error


def publicadas_antes(casa: Path) -> list[str]:
    """Los identificadores que publica la última salida admitida de la casa (validados/barcelonactiva/).

    Returns:
        Sus identificadores, o ninguno si nunca se admitió.
    """
    ruta = casa.parent.parent / "validados" / adquisicion.FUENTE / f"{adquisicion.FUENTE}.json"
    return [a["id"] for a in leer_json(ruta)["cibernarium"]] if ruta.is_file() else []


def descargar(casa: Path, recibir: Recibir = _recibir, publicadas: list[str] | None = None) -> str | None:
    """Pide la página de filtros, las páginas del censo de IA y, si está completo, la ficha de cada publicada que falte.

    Si el ámbito 22 cambia de nombre o no aparece, o no se encuentra la instancia del portlet, no se pide ninguna
    página: el documento lo dice y lo publicado se conserva. Sin la primera página no se conoce el total y no se pide
    ninguna más. El documento se guarda aunque una consulta se corte, para no perder los intentos ya conservados.

    Returns:
        La instancia del portlet que publica la página de filtros, para el censo del canal; None si no se encontró.
    """
    carpeta = casa / CARPETA
    carpeta.mkdir(parents=True, exist_ok=True)
    publicadas = publicadas_antes(casa) if publicadas is None else publicadas
    documento = {"schema_version": 1, "fuente_id": adquisicion.FUENTE, "ambito": AMBITO_IA, "paginas": [], "fichas": {}}
    portlet = None
    try:
        documento["filtros"] = recibir(ambitos.FILTROS, carpeta)
        portlet, motivo = ambitos.leer(carpeta, documento["filtros"])
        if motivo in ambitos.DETIENEN:
            return portlet
        documento["portlet"] = portlet
        documento["paginas"].append(recibir(url_pagina(0, portlet), carpeta))
        leida, _ = pagina(carpeta, documento["paginas"][0], 0, portlet)
        if leida is not None:
            for desde in range(robot.PAGINA, leida[0], robot.PAGINA):
                documento["paginas"].append(recibir(url_pagina(desde, portlet), carpeta))
            lectura = leer(casa, documento)
            if lectura["completo"]:
                vistas = {str(a["activityId"]) for a in lectura["actividades"]}
                for id in sorted(set(publicadas) - vistas):
                    documento["fichas"][id] = recibir(robot.url_ficha(id), carpeta)
    finally:
        guardar_json(carpeta / "procedencia.json", documento)
    return portlet


def leer(casa: Path, documento: dict[str, Any]) -> dict[str, Any]:
    """Reproduce el censo de IA solo desde lo conservado.

    Returns:
        `completo`, las actividades tal como las publica la API, la evidencia de cada página y las caídas.

    Raises:
        FormatoInesperado: Si el documento es de otra fuente u otro ámbito, o las páginas no son consecutivas.
    """
    comun.exigir(
        documento.get("schema_version") == 1
        and documento.get("fuente_id") == adquisicion.FUENTE
        and documento.get("ambito") == AMBITO_IA
        and isinstance(documento.get("paginas"), list)
        and "filtros" in documento,
        "Procedencia del censo de IA ajena o sin página de filtros",
        FormatoInesperado,
    )
    carpeta = casa / CARPETA
    portlet, motivo = ambitos.leer(carpeta, documento["filtros"])
    vacia = {"actividades": [], "ubicadas": [], "paginas": [], "caidas": [], "fichas_cerradas": [], "avisos": []}
    if motivo in ambitos.DETIENEN:
        return {"completo": False, "motivo": motivo, **vacia}
    comun.exigir(
        bool(documento["paginas"]) and documento.get("portlet") == portlet,
        "Censo de IA sin páginas o con otra instancia de portlet",
        FormatoInesperado,
    )
    actividades, ubicadas, pruebas, caidas, total = [], [], [], [], None
    for posicion, captura in enumerate(documento["paginas"]):
        leida, meta = pagina(carpeta, captura, posicion * robot.PAGINA, portlet)
        pruebas.append(evidencia(captura, meta))
        if leida is None:
            caidas.append(pruebas[-1])
            continue
        comun.exigir(total in (None, leida[0]), "Censo de IA con totales distintos", FormatoInesperado)
        total = leida[0]
        actividades.extend(leida[1])
        ubicadas.extend((fila, pruebas[-1], f"activities[{n}]") for n, fila in enumerate(leida[1]))
    try:
        ids = [robot.identificador(a.get("activityId")) for a in actividades]
    except robot.ErrorRobot as error:
        raise FormatoInesperado(f"Censo de IA: {error}") from error
    comun.exigir(len(ids) == len(set(ids)), "Actividad repetida en el censo de IA", FormatoInesperado)
    completo = (
        not caidas and total is not None and len(documento["paginas"]) * robot.PAGINA >= total and len(ids) == total
    )
    cerradas = []
    for id, captura in sorted(documento.get("fichas", {}).items()):
        _, meta = adquisicion.pagina(carpeta, captura)
        comun.exigir(meta["url"] == robot.url_ficha(id), "Ficha del Cibernàrium de otra actividad", FormatoInesperado)
        if meta.get("http") in CERRADA and meta.get("url_final") == meta["url"]:
            cerradas.append(id)
    return {
        "completo": completo,
        "motivo": None if completo else CENSO_IA_PARCIAL,
        "avisos": [{"id": None, "motivo": motivo}] if motivo else [],
        "actividades": actividades,
        "ubicadas": ubicadas,
        "paginas": pruebas,
        "caidas": caidas,
        "fichas_cerradas": cerradas,
    }
