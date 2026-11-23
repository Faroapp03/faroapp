"""FUNDAE: las ediciones que descubre su índice de formación subvencionada, cada una con su ficha consultada.

El índice público del catálogo 3 (`adquisicion.URLS["subvencionada"]`, el que consulta el canal diario catalogos/)
dice qué especialidades en teleformación tienen la inscripción abierta. Faro orienta sobre IA y competencias digitales,
así que solo consulta las que la propia fuente sitúa en ese terreno (`del_ambito`): las que FUNDAE clasifica en sus
áreas de interés «Inteligencia Artificial» (38) u «Ofimática / Competencias digitales» (46), y las de la familia
profesional Informática y comunicaciones del SEPE (código que empieza por IFC). De cada una se consulta su ficha de
difusiones; de cada edición con la preinscripción abierta ese día según esa ficha, la ficha de su entidad (con su
sector) y la de sus colectivos; la descarga diaria, con su presupuesto, su rotación y su refresco, está en descarga.py.
Cada respuesta se conserva con su cuerpo y su recibo en ediciones/, y la lectura solo usa respuestas cuyo recibo y
cuerpo coinciden. Los errores al consultar las listas de difusiones, entidades o colectivos dejan la consulta parcial.
Los plazos que publica cada difusión se conservan por separado.
"""

import hashlib
import json
from datetime import date
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.fundae import adquisicion, digitalizate, hechos

CARPETA = "ediciones"
FICHAS = adquisicion.ORIGEN + "/Oferta/"
# Áreas de interés de FUNDAE (idAreaInteres del índice) que acotan la consulta, con el nombre que publica el propio
# índice en `descripcionAreasInteres`: si cambia, la validación se para. La familia profesional no viene en el índice:
# se deduce del prefijo del código de la especialidad (IFC, Informática y comunicaciones del SEPE).
AREAS = {38: "Inteligencia Artificial", 46: "Ofimática / Competencias digitales"}
FAMILIA = "IFC"
# Palabras de un nombre que piden revisar una especialidad excluida, como aviso y nunca como filtro.
A_REVISAR = ("inteligencia artificial", "digital", "datos")


def url_difusiones(codigo: str) -> str:
    """La ficha de difusiones en teleformación de una especialidad.

    Returns:
        Su dirección en la API pública de FUNDAE.
    """
    return (
        FICHAS
        + "RecuperarDifusionesRFO?"
        + urlencode({"idModalidad": hechos.TELEFORMACION, "codigoTitulacion": codigo})
    )


def url_centro(codigo: str, cif: str) -> str:
    """La ficha de las difusiones de una especialidad en una entidad, con el sector de esa entidad.

    Returns:
        Su dirección en la API pública de FUNDAE.
    """
    consulta = {"idModalidad": hechos.TELEFORMACION, "codigoTitulacion": codigo, "cifEntidadFormadora": cif}
    return FICHAS + "RecuperarDifusionesRFOCentro?" + urlencode(consulta)


def url_colectivos(identificador: int) -> str:
    """La ficha de los colectivos a los que se dirige una edición.

    Returns:
        Su dirección en la API pública de FUNDAE.
    """
    return FICHAS + "RecuperarColectivosDeDifusion?" + urlencode({"idDifusionAccionFormativa": identificador})


def del_ambito(fila: dict[str, Any]) -> bool:
    """Si FUNDAE sitúa una especialidad en IA o competencias digitales: por su área de interés o por su familia.

    Returns:
        True si tiene el área 38 o 46, o su código es de la familia IFC.

    Raises:
        FormatoInesperado: Si sus áreas de interés no tienen la forma publicada.
    """
    areas = fila.get("listaAreasInteres")
    comun.exigir(
        isinstance(areas, list) and all(isinstance(a, dict) and type(a.get("idAreaInteres")) is int for a in areas),
        "Áreas de interés FUNDAE sin la forma publicada",
        FormatoInesperado,
    )
    return bool(set(AREAS) & {a["idAreaInteres"] for a in areas}) or fila["codigoTitulacion"].startswith(FAMILIA)


def nombres_de_areas(indice: object) -> dict[int, list[str]]:
    """Los nombres con que el índice publica las áreas que acotan la consulta.

    Returns:
        Por área, los nombres distintos que trae el índice, ordenados.
    """
    nombres: dict[int, set[str]] = {id: set() for id in AREAS}
    for fila in adquisicion._filas(indice, 3):
        for area in fila.get("listaAreasInteres") or []:
            if isinstance(area, dict) and area.get("idAreaInteres") in nombres:
                nombres[area["idAreaInteres"]].add(str(area.get("descripcionAreasInteres")))
    return {id: sorted(n) for id, n in nombres.items()}


def _abiertas_en_teleformacion(indice: object) -> list[dict[str, Any]]:
    return [
        f
        for f in adquisicion._filas(indice, 3)
        if f["idModalidad"] == hechos.TELEFORMACION and f.get("inscripcionAbierta") is True
    ]


def _ambito(fila: dict[str, Any]) -> bool | None:
    """Si la fila es del ámbito de Faro; una fila con las áreas de otra forma se descarta sin parar el ciclo.

    Returns:
        True o False, o None si sus áreas de interés no tienen la forma publicada.
    """
    try:
        return del_ambito(fila)
    except FormatoInesperado:
        return None


def a_revisar(indice: object) -> list[dict[str, str]]:
    """Las especialidades abiertas en teleformación excluidas cuyo nombre habla de IA, lo digital o los datos.

    Returns:
        Su código y su nombre, para revisarlas con evidencia; no cambian lo que se consulta.
    """
    return sorted(
        (
            {"codigo": f["codigoTitulacion"], "nombre": str(f.get("denominacion"))}
            for f in _abiertas_en_teleformacion(indice)
            if _ambito(f) is False and any(p in str(f.get("denominacion")).casefold() for p in A_REVISAR)
        ),
        key=lambda f: f["codigo"],
    )


def descartes_del_indice(indice: object) -> list[dict[str, Any]]:
    """Las filas del índice cuyas áreas de interés no tienen la forma publicada: no se consultan y quedan dichas.

    Returns:
        Su especialidad y el motivo.
    """
    return [
        {"especialidad": f["codigoTitulacion"], "id": None, "motivo": "Áreas de interés FUNDAE sin la forma publicada"}
        for f in _abiertas_en_teleformacion(indice)
        if _ambito(f) is None
    ]


def especialidades(indice: object) -> list[str]:
    """Las especialidades en teleformación, con la inscripción abierta y del ámbito de Faro, del índice del catálogo 3.

    Returns:
        Sus códigos, ordenados y sin repetir.
    """
    return sorted({f["codigoTitulacion"] for f in _abiertas_en_teleformacion(indice) if _ambito(f)})


def inicio_rotado(codigos: list[str], dia: str) -> int:
    """Dónde empieza la consulta del día: rota cada día para que un corte por tope no deje siempre fuera las mismas.

    Returns:
        La posición de la primera especialidad que se consulta.
    """
    return date.fromisoformat(dia).toordinal() % len(codigos) if codigos else 0


def en_orden_del_dia(codigos: list[str], inicio: int) -> list[str]:
    """Las especialidades en el orden en que se consultan, empezando por `inicio`.

    Returns:
        La lista rotada.
    """
    return codigos[inicio:] + codigos[:inicio]


def respuesta(carpeta: Path, captura: dict[str, Any], url: str) -> tuple[object | None, dict[str, Any]]:
    """Lee una ficha conservada tras comprobar que su recibo es de `url` y que el cuerpo es el del recibo.

    Returns:
        El JSON de la ficha, o None si no respondió 200 completa, y su recibo.

    Raises:
        FormatoInesperado: Si el recibo es de otra dirección, no es causal, no casa con el cuerpo o el JSON está roto.
    """
    meta = comun.leer_recibo(carpeta, captura)
    comun.exigir(meta["url"] == url, "Ficha FUNDAE de otra dirección", FormatoInesperado)
    inicio = vigencia.instante_utc(meta["inicio_utc"], "inicio de la ficha FUNDAE")
    fin = vigencia.instante_utc(meta["fin_utc"], "fin de la ficha FUNDAE")
    comun.exigir(inicio <= fin, "Recepción de ficha FUNDAE no causal", FormatoInesperado)
    cuerpo = None
    if captura.get("cuerpo") is not None:
        cuerpo = comun.leer_conservado(carpeta, captura["cuerpo"])
        comun.exigir(
            meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
            "Recibo y cuerpo de la ficha FUNDAE distintos",
            FormatoInesperado,
        )
    if meta["http"] != HTTPStatus.OK or meta["completo"] is not True or cuerpo is None:
        return None, meta
    comun.exigir(meta["url_final"] == url, "Redirección de ficha FUNDAE no acreditada", FormatoInesperado)
    try:
        dato = json.loads(
            cuerpo.decode("utf-8"), object_pairs_hook=digitalizate._pares, parse_constant=digitalizate._constante
        )
    except (UnicodeError, ValueError) as error:
        raise FormatoInesperado("Ficha FUNDAE no es JSON íntegro") from error
    return dato, meta


def evidencia(captura: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Lo que acredita una consulta: dirección, código, hora, cuerpo y recibo conservados, con sus huellas.

    Returns:
        La evidencia de esa ficha o índice.
    """
    return {
        "url": meta["url"],
        "http": meta["http"],
        "consultado_utc": meta["fin_utc"],
        "cuerpo": captura.get("cuerpo"),
        "recibo": captura["recibo"],
    }


def _leer_edicion(carpeta: Path, entrada: dict[str, Any], fila: dict[str, Any], lectura: dict[str, Any]) -> None:
    codigo, identificador = entrada["codigo"], fila["idDifusionAccionFormativa"]
    cif = fila.get("cifEntidadFormadora")
    if not isinstance(cif, str) or not cif:
        lectura["descartadas"].append(
            {"especialidad": codigo, "id": str(identificador), "motivo": "difusión sin entidad"}
        )
        return
    capturas = {
        "centro": (entrada["centros"].get(cif), url_centro(codigo, cif)),
        "colectivos": (entrada["colectivos"].get(str(identificador)), url_colectivos(identificador)),
    }
    datos, pruebas = {}, {}
    for nombre, (captura, url) in capturas.items():
        comun.exigir(
            captura is not None, f"{codigo}: edición abierta {identificador} sin su ficha {nombre}", FormatoInesperado
        )
        datos[nombre], meta = respuesta(carpeta, captura, url)
        pruebas[nombre] = evidencia(captura, meta)
        if datos[nombre] is None:
            lectura["fallidas"].append(pruebas[nombre])
            return
    try:
        leida = hechos.edicion(codigo, identificador, entrada["dato"], datos["centro"], datos["colectivos"])
    except FormatoInesperado as error:
        lectura["descartadas"].append({"especialidad": codigo, "id": str(identificador), "motivo": str(error)})
        return
    lectura["ediciones"].append(leida)
    lectura["evidencias"][str(identificador)] = {**entrada["prueba"], **pruebas}


def leer(fundae: Path, documento: dict[str, Any]) -> dict[str, Any]:
    """Reproduce, solo desde lo conservado, lo que dicen el índice y las fichas de una consulta.

    Returns:
        El índice (su evidencia o su caída), las ediciones abiertas con la evidencia de sus fichas, las consultas
        fallidas y el plazo que publica cada ficha de difusiones respondida.

    Raises:
        FormatoInesperado: Si el documento es de otra fuente o una ficha no tiene la forma publicada.
    """
    comun.exigir(
        documento.get("schema_version") == 1 and documento.get("fuente_id") == "fundae",
        "Procedencia de fichas FUNDAE ajena",
        FormatoInesperado,
    )
    canal, carpeta = fundae / comun.CANALES["fundae"], fundae / CARPETA
    dato, meta = adquisicion.pagina(canal, documento["indice"], "subvencionada")
    indice = evidencia(documento["indice"], meta)
    lectura: dict[str, Any] = {"indice": indice, "indice_caido": dato is None, "ediciones": [], "evidencias": {}}
    lectura.update(fallidas=[], plazos={}, descartadas=[])
    descubiertas = en_orden_del_dia(especialidades(dato), documento.get("inicio", 0)) if dato is not None else []
    lectura["descartadas"].extend(descartes_del_indice(dato) if dato is not None else [])
    consultadas = [e["codigo"] for e in documento["especialidades"]]
    # Una descarga cortada por su tope cubre un principio del orden del día; el resto queda sin consultar,
    # nunca ausente.
    cubiertas = descubiertas[: len(consultadas)] if "corte" in documento else descubiertas
    comun.exigir(consultadas == cubiertas, "Fichas FUNDAE sin cobertura exacta del índice", FormatoInesperado)
    lectura["sin_consultar"] = descubiertas[len(consultadas) :]
    lectura["areas"] = nombres_de_areas(dato) if dato is not None else None
    lectura["a_revisar"] = a_revisar(dato) if dato is not None else []
    lectura["corte"] = documento.get("corte")
    for entrada in documento["especialidades"]:
        url = url_difusiones(entrada["codigo"])
        de_difusiones, meta = respuesta(carpeta, entrada["difusiones"], url)
        prueba = {"indice": indice, "difusiones": evidencia(entrada["difusiones"], meta)}
        if de_difusiones is None:
            lectura["fallidas"].append(prueba["difusiones"])
            continue
        dia = hechos.dia_civil(meta["fin_utc"])
        try:
            filas = hechos.difusiones(de_difusiones)
        except FormatoInesperado as error:
            lectura["descartadas"].append({"especialidad": entrada["codigo"], "id": None, "motivo": str(error)})
            continue
        for fila in filas:
            identificador = str(fila["idDifusionAccionFormativa"])
            try:
                lectura["plazos"][identificador] = {"dia": dia, **hechos.plazo(fila)}
            except FormatoInesperado as error:
                lectura["descartadas"].append(
                    {"especialidad": entrada["codigo"], "id": identificador, "motivo": str(error)}
                )
                continue
            if hechos.abierta(fila, dia):
                _leer_edicion(carpeta, {**entrada, "dato": de_difusiones, "prueba": prueba}, fila, lectura)
    lectura["ediciones"].sort(key=lambda e: (e["especialidad"], int(e["id"])))
    return lectura
