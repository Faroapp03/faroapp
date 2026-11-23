"""La recepción HTTP no certifica la Biblioteca sin identidad, legibilidad y admisión por objetivo."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.contrato import instante
from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.lector import ARCHIVO, FUENTE, firmas_en, objetivos
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.comun.observacion_remota import identidad_recurso

VERSION_RECEPCION = 2


def _vinculada(observacion: object, peticion: dict, fin: datetime) -> bool:
    """Comprueba respuesta original y tiempo real de esa consulta.

    Returns:
        True solo con cuerpo específico, destino y recepción correspondientes; False si falta alguno.

    Raises:
        FormatoInesperado: Si un instante de la observación o de la petición no es UTC válido.
    """
    if not isinstance(observacion, dict):
        return False
    huella, url_final = observacion.get("cuerpo_sha256"), observacion.get("url_final")
    return (
        observacion.get("estado") == "verificado"
        and observacion.get("identidad_acreditada") is True
        and isinstance(huella, str)
        and isinstance(url_final, str)
        and peticion.get("respuesta_sha256") == huella == peticion.get("original_sha256")
        and peticion.get("bytes") == peticion.get("original_bytes")
        and peticion.get("url_final_sha256") == hashlib.sha256(url_final.encode()).hexdigest()
        and instante(peticion.get("completado_utc")) <= instante(observacion.get("capturado_utc")) <= fin
        and datetime.now(UTC) < instante(observacion.get("vence_utc"))
    )


def _admitido(raiz: Path) -> dict:
    """Vuelve a comprobar todas las entradas y el inventario realmente admitidos.

    Returns:
        Informe de observaciones íntegro bajo los contratos actuales.

    Raises:
        ErrorFuente: Si la admisión no coincide con sus recursos o el catálogo actual.
    """
    carpeta = raiz / DATOS_RELATIVOS / "validados" / FUENTE
    datos = (carpeta / ARCHIVO).read_bytes()
    informe = json.loads((carpeta / "validacion.json").read_bytes())
    casa = raiz / "plataforma_datos/biblioteca/fuentes/enlaces_lecturas"
    catalogo = casa.parent / "lecturas/catalogo.json"
    original = raiz / DATOS_RELATIVOS / "originales" / FUENTE
    documento = json.loads(datos)
    if not _con_forma_de_admision(informe, documento):
        raise ErrorFuente("enlaces_lecturas: cobertura sin admisión actual verificable")
    declarados = objetivos(catalogo)
    condiciones = (
        informe.get("estado") == "Admitido",
        informe.get("conjunto_sha256") == hashlib.sha256(datos).hexdigest(),
        informe.get("entradas") == firmas_en(casa, catalogo, original),
        documento.get("catalogo_sha256") == hashlib.sha256(catalogo.read_bytes()).hexdigest(),
        [(fila["objetivo"], fila["url"]) for fila in documento["objetivos"]]
        == [(fila["objetivo"], fila["url"]) for fila in declarados],
    )
    if not all(condiciones):
        raise ErrorFuente("enlaces_lecturas: cobertura sin admisión actual verificable")
    return documento


def _con_forma_de_admision(informe: object, documento: object) -> bool:
    """Si el informe y las observaciones admitidas tienen la forma que lee la cobertura.

    Returns:
        True si ambos son objetos y cada objetivo lleva su identificador y su URL (texto o ninguna).
    """
    if not isinstance(informe, dict) or not isinstance(documento, dict):
        return False
    filas = documento.get("objetivos")
    return isinstance(filas, list) and all(
        isinstance(fila, dict) and "objetivo" in fila and "url" in fila and isinstance(fila["url"], str | None)
        for fila in filas
    )


def _peticiones_del_recibo(evidencia: object) -> list[dict] | None:
    """Las peticiones de un recibo de esta fuente, si tiene la forma esperada.

    Returns:
        Las peticiones, cada una con la identidad de su recurso, o `None` si el recibo es de otra versión, de otra
        fuente o tiene otra forma.
    """
    if not isinstance(evidencia, dict):
        return None
    if evidencia.get("version") != VERSION_RECEPCION or evidencia.get("fuente") != FUENTE:
        return None
    peticiones = evidencia.get("peticiones")
    if not isinstance(peticiones, list):
        return None
    if not all(
        isinstance(peticion, dict) and isinstance(peticion.get("recurso_sha256"), str) for peticion in peticiones
    ):
        return None
    return peticiones


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige cobertura actual de todos los enlaces declarados, no solo peticiones exitosas.

    Returns:
        False con desconocidos, captura conservada, contrato alterado o recibo parcial o con otra forma. Un error de
        programación no se confunde con un dato defectuoso: se propaga.
    """
    lista = _peticiones_del_recibo(evidencia)
    if lista is None:
        return False
    try:
        documento = _admitido(raiz)
        externos = [fila for fila in documento["objetivos"] if fila.get("url") and fila["url"].startswith("https://")]
        peticiones = {peticion["recurso_sha256"]: peticion for peticion in lista}
        if not externos or len(peticiones) != len(lista):
            return False
        urls = {fila["url"] for fila in externos}
        if set(peticiones) != {identidad_recurso(url) for url in urls}:
            return False
        fin = instante(evidencia.get("fin_utc"))
        return all(
            _vinculada(fila.get("ultimo_intento"), peticiones[identidad_recurso(fila["url"])], fin) for fila in externos
        )
    except (ErrorFuente, OSError, ValueError):
        return False
