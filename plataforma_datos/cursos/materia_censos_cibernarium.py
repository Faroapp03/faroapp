"""Conservación y reproducción de censos de materia Cibernàrium."""

import hashlib
import tempfile
from pathlib import Path

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, exigir
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, censo_ia, contraste_ediciones
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

CARPETA_CENSOS = "materia-censos"


def _reproducir_general(original: Path, documento: dict, canal: dict) -> None:
    # El proveedor consulta también la ficha de actividades conocidas que desaparecieron de sus páginas.
    conocidas = [{"id": id} for id in canal["censo"].get("conocidos_ausentes", [])]
    lectura = adquisicion.calcular(original, documento, conocidas)
    exigir(
        lectura["procedencia_sha256"] == canal["procedencia_sha256"]
        and lectura["censo_completo"] == canal["censo_completo"]
        and lectura["censo"]["actividades"] == canal["censo"]["actividades"],
        "Censo general de otra recepción o no reproducible",
    )


def guardar_censo_admitido(raiz: Path) -> None:
    """Archiva una selección inmutable de las pruebas de IA del ciclo que acaba de admitirse."""
    base = raiz / DATOS_RELATIVOS
    original = base / "originales" / "barcelonactiva"
    validado = base / "validados" / "barcelonactiva"
    informe = exigir_admitido("barcelonactiva", ruta=validado / "validacion.json")
    canal = operacion_fuente.leer_validado("barcelonactiva", raiz)
    exigir(canal is not None, "Censo del canal sin admisión")
    preparada = leer_json(base / "preparados" / "barcelonactiva" / "cibernarium.json")
    exigir(preparada.get("censo_sha256") == canal["procedencia_sha256"], "Censo IA de otro canal")
    documento_general = leer_json(original / "cibernarium" / "procedencia.json")
    exigir(
        hashlib.sha256(operacion_fuente.recibos_compartidos.canonico(documento_general)).hexdigest()
        == canal["procedencia_sha256"],
        "Procedencia general distinta del canal admitido",
    )
    documento = leer_json(original / censo_ia.CARPETA / "procedencia.json")
    lectura = censo_ia.leer(original, documento)
    if "consulta_parcial" not in informe:
        exigir(
            lectura["completo"]
            and canal.get("censo_completo") is True
            and lectura["paginas"] == informe.get("evidencias") == preparada.get("evidencias"),
            "Censo IA sin prueba completa admitida",
        )
    # Las fichas de bajas no respaldan pertenencia al ámbito y pueden ser posteriores a sus páginas.
    documento = {**documento, "fichas": {}}
    capturas = [documento["filtros"], *documento["paginas"]]
    carpeta = original / censo_ia.CARPETA
    fechas = [operacion_fuente.leer_recibo(carpeta, captura)["fin_utc"] for captura in capturas]
    corte = max(fechas, key=robot.fecha_utc)
    recibo = {
        "version": 1,
        "canal_procedencia_sha256": canal["procedencia_sha256"],
        "documento": documento,
        "documento_general": documento_general,
        "informe": {k: informe[k] for k in ("estado", "evidencias", "consulta_parcial") if k in informe},
        "corte_utc": corte,
    }
    cuerpo = operacion_fuente.json_bytes(recibo)
    sha = hashlib.sha256(cuerpo).hexdigest()
    destino = validado / "cibernarium" / CARPETA_CENSOS / (sha + ".json")
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.exists():
        exigir(destino.read_bytes() == cuerpo, "Recibo de censo IA distinto")
    else:
        escribir_atomico(destino, cuerpo.decode("utf-8"))


def leer_censo_archivado(raiz: Path, conjunto: dict, corte: str, *, pendiente: bool = False) -> dict | None:
    """Reproduce un recibo del mismo canal; nunca toma un censo posterior al corte pedido.

    Un pendiente con más de un recibo posible es ambiguo: no se escoge uno por fecha.

    Returns:
        El ciclo reproducido o None si no existe uno inequívoco dentro del corte.
    """
    base = raiz / DATOS_RELATIVOS
    original = base / "originales" / "barcelonactiva"
    carpeta = base / "validados" / "barcelonactiva" / "cibernarium" / CARPETA_CENSOS
    candidatos = []
    for ruta in sorted(carpeta.glob("*.json")) if carpeta.is_dir() else ():
        contenido = ruta.read_bytes()
        exigir(hashlib.sha256(contenido).hexdigest() == ruta.stem, "Recibo de censo IA alterado")
        recibo = operacion_fuente.recibos_compartidos.leer_json(contenido)
        if recibo.get("canal_procedencia_sha256") != conjunto["procedencia_sha256"]:
            continue
        if robot.fecha_utc(recibo["corte_utc"]) > robot.fecha_utc(corte):
            continue
        candidatos.append((recibo, ruta, contenido))
    if not candidatos or (pendiente and len(candidatos) != 1):
        return None
    corte_maximo = max(robot.fecha_utc(item[0]["corte_utc"]) for item in candidatos)
    if sum(robot.fecha_utc(item[0]["corte_utc"]) == corte_maximo for item in candidatos) != 1:
        return None
    recibo, ruta, contenido = max(candidatos, key=lambda item: robot.fecha_utc(item[0]["corte_utc"]))
    informe, documento = recibo["informe"], recibo["documento"]
    exigir(recibo.get("version") == 1 and informe.get("estado") == "Admitido", "Censo IA no admitido")
    _reproducir_general(original / "cibernarium", recibo["documento_general"], conjunto)
    lectura = censo_ia.leer(original, documento)
    fechas = [
        operacion_fuente.leer_recibo(original / censo_ia.CARPETA, c)["fin_utc"]
        for c in [documento["filtros"], *documento["paginas"]]
    ]
    exigir(max(fechas, key=robot.fecha_utc) == recibo["corte_utc"], "Corte IA distinto de las capturas")
    completo = "consulta_parcial" not in informe
    if completo:
        exigir(
            conjunto.get("censo_completo") is True
            and lectura["completo"]
            and lectura["paginas"] == informe.get("evidencias"),
            "Censo IA archivado no reproducible",
        )
    admitidas = set(conjunto["censo"]["actividades"]) if completo else set()
    filas = {
        str(a["activityId"]): {
            "ambito": "ia",
            "url": p["url"],
            "sha256": p["cuerpo"]["sha256"],
            "capturado_utc": p["consultado_utc"],
            "localizador": localizador,
        }
        for a, p, localizador in lectura["ubicadas"]
        if completo and "cibernarium:" + str(a["activityId"]) in admitidas
    }
    return {
        "recibo": recibo,
        "ruta": ruta,
        "sha256": hashlib.sha256(contenido).hexdigest(),
        "censo": filas if completo else None,
        "corte_utc": recibo["corte_utc"],
    }


def _capturas_censo(documento: dict) -> list[dict]:
    return [documento["filtros"], *documento["paginas"], *documento.get("fichas", {}).values()]


def _resumen_canal(conjunto: dict) -> dict:
    censo = {"actividades": conjunto["censo"]["actividades"]}
    con_ficha = {"cibernarium:" + id for id in conjunto.get("fichas", {})}
    ausentes = sorted(con_ficha.intersection(conjunto["censo"].get("conocidos_ausentes", [])))
    if ausentes:
        censo["conocidos_ausentes"] = ausentes
    return {
        "procedencia_sha256": conjunto["procedencia_sha256"],
        "censo_completo": conjunto["censo_completo"],
        "censo": censo,
    }


def _copiar_capturas(documento: dict, original: Path, carpeta: Path, relativa: str, inventario: dict) -> None:
    for captura in _capturas_censo(documento):
        for campo in ("cuerpo", "recibo", "metadatos"):
            prueba = captura.get(campo)
            if prueba is None:
                continue
            fuente = almacen.ruta_relativa(original, prueba["archivo"])
            ruta = relativa + "/" + censo_ia.CARPETA + "/" + prueba["archivo"]
            almacen.copiar_evidencia(
                admision.ReferenciaArchivo(ruta=fuente, sha256=prueba["sha256"]),
                almacen.ruta_relativa(carpeta, censo_ia.CARPETA + "/" + prueba["archivo"]),
            )
            inventario[ruta] = prueba["sha256"]


def _copiar_censo(raiz: Path, destino: Path, ciclo: dict, conjunto: dict, inventario: dict) -> dict:
    """Guarda el recibo y cada prueba con las rutas que necesita el lector reproducible.

    Returns:
        Referencia al recibo y resumen del canal asociado.
    """
    relativa = "evidencias/materia-censo/" + ciclo["sha256"]
    carpeta = destino / relativa
    carpeta.mkdir(parents=True, exist_ok=True)
    ref = admision.ReferenciaArchivo(ruta=ciclo["ruta"], sha256=ciclo["sha256"])
    almacen.copiar_evidencia(ref, carpeta / "recibo-ia.json")
    inventario[relativa + "/recibo-ia.json"] = ciclo["sha256"]
    original = raiz / DATOS_RELATIVOS / "originales" / "barcelonactiva" / censo_ia.CARPETA
    _copiar_capturas(ciclo["recibo"]["documento"], original, carpeta, relativa, inventario)
    return {"recibo_sha256": ciclo["sha256"], "raiz": relativa, "canal": _resumen_canal(conjunto)}


def _censo_en_almacen(referencias: dict, ciclo: dict, corte: str) -> dict | None:
    sha = ciclo["recibo_sha256"]
    ref = referencias.get(sha)
    exigir(ref is not None, "Recibo de censo IA fuera del índice")
    recibo = operacion_fuente.recibos_compartidos.leer_json(
        almacen.leer_evidencia(ref.ruta, sha, "Recibo de censo IA alterado")
    )
    canal = ciclo["canal"]
    exigir(
        recibo.get("version") == 1
        and recibo["informe"].get("estado") == "Admitido"
        and recibo["canal_procedencia_sha256"] == canal["procedencia_sha256"]
        and robot.fecha_utc(recibo["corte_utc"]) <= robot.fecha_utc(corte),
        "Recibo IA ajeno al canal o corte",
    )
    with tempfile.TemporaryDirectory(prefix="materia-censo-") as temporal:
        raiz = Path(temporal).resolve(strict=True)
        general = recibo["documento_general"]
        capturas_general = [
            *general["capturas"],
            *general["auxiliares"].values(),
            *general["fichas"].values(),
            *general.get(contraste_ediciones.CAMPO, {}).values(),
        ]
        for carpeta, captura in [
            *((raiz / censo_ia.CARPETA, c) for c in _capturas_censo(recibo["documento"])),
            *((raiz / "general", c) for c in capturas_general),
        ]:
            for campo in ("cuerpo", "recibo", "metadatos"):
                prueba = captura.get(campo)
                if prueba is None:
                    continue
                fuente = referencias.get(prueba["sha256"])
                exigir(fuente is not None, "Prueba IA fuera del inventario")
                cuerpo = almacen.leer_evidencia(fuente.ruta, prueba["sha256"], "Prueba IA alterada")
                ruta = almacen.ruta_relativa(carpeta, prueba["archivo"])
                ruta.parent.mkdir(parents=True, exist_ok=True)
                exigir(not ruta.exists() or ruta.read_bytes() == cuerpo, "Ruta IA con dos cuerpos distintos")
                if not ruta.exists():
                    ruta.write_bytes(cuerpo)
        lectura = censo_ia.leer(raiz, recibo["documento"])
        _reproducir_general(raiz / "general", general, canal)
        fechas = [
            operacion_fuente.leer_recibo(raiz / censo_ia.CARPETA, captura)["fin_utc"]
            for captura in [recibo["documento"]["filtros"], *recibo["documento"]["paginas"]]
        ]
        exigir(
            max(fechas, key=robot.fecha_utc) == recibo["corte_utc"],
            "Corte IA distinto de las recepciones",
        )
    if "consulta_parcial" in recibo["informe"]:
        return None
    exigir(
        canal.get("censo_completo") is True
        and lectura["completo"]
        and lectura["paginas"] == recibo["informe"].get("evidencias"),
        "Censo IA no reproducible en el almacén",
    )
    admitidas = set(canal["censo"]["actividades"])
    return {
        str(a["activityId"]): {
            "ambito": "ia",
            "url": p["url"],
            "sha256": p["cuerpo"]["sha256"],
            "capturado_utc": p["consultado_utc"],
            "localizador": localizador,
        }
        for a, p, localizador in lectura["ubicadas"]
        if "cibernarium:" + str(a["activityId"]) in admitidas
    }
