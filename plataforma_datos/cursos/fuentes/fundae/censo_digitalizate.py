"""FUNDAE: el censo de Digitalízate (catálogo 1), con altas y bajas solo por estados observados.

Cada ciclo se piden, en `agora.fundae.es/Digitalizate/`:
- la lista activa de proveedores (`RecuperarEmpresasDigitalizate?baja=false&idCatalogo=1`, con su `numeroCursos`);
- la lista de los dados de baja (`…?baja=true&idCatalogo=1`);
- la ficha de cada proveedor activo con cursos o con recursos conocidos
  (`RecuperaDetalleEmpresaDigitalizate?baja=false&idCatalogo=1&idEmpresaDigitalizate=N`), con sus recursos y, en
  `filtros.tiposRecursos`, los tipos que contiene;
- la ficha de cada proveedor conocido que no está en ninguna de las dos listas: un 404 `AgoraException` («ya no está
  disponible en este catálogo») es su estado observado; un 200 contradice a las listas.

La ficha de un proveedor dado de baja sigue respondiendo con sus recursos como activos: por eso un recurso solo cuenta
como presente por la ficha de un proveedor de la lista activa, y la ficha de uno dado de baja ni se pide. El censo es
completo si respondieron las dos listas y esas fichas, cada ficha cuadra su recuento con la lista, ningún proveedor está
en las dos listas y la forma es la esperada. El estado de cada recurso conocido lo decide `estado_digitalizate.py`.
"""

import json
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.fundae import adquisicion, digitalizate, ediciones

OPERACIONES = adquisicion.ORIGEN + "/Digitalizate/"
EMPRESAS = OPERACIONES + "RecuperarEmpresasDigitalizate?" + urlencode({"baja": "false", "idCatalogo": 1})
EMPRESAS_BAJA = OPERACIONES + "RecuperarEmpresasDigitalizate?" + urlencode({"baja": "true", "idCatalogo": 1})
MAX_PROVEEDORES = 100
# «Curso» es el tipo 1 con ese nombre; cada ficha declara los pares de tipos que contiene.
CURSO = (1, "Curso")
# La respuesta de un proveedor que ya no existe en el catálogo.
NO_DISPONIBLE = {"title": "AgoraException", "status": 404}
# Por qué un censo no es completo, o por qué un recurso queda sin noticia; todos llegan al panel en `salidaParcial`.
LISTA_CAIDA = "censo-digitalizate-sin-lista"
LISTA_BAJA_CAIDA = "censo-digitalizate-sin-lista-de-baja"
FICHAS_CAIDAS = "censo-digitalizate-fichas-fallidas"
RECUENTO = "censo-digitalizate-recuento-descuadrado"
FORMA = "censo-digitalizate-forma-inesperada"
TOPE = "censo-digitalizate-tope-de-proveedores"
CONTRADICE = "censo-digitalizate-contradice-al-indice"
MOTIVOS = frozenset({LISTA_CAIDA, LISTA_BAJA_CAIDA, FICHAS_CAIDAS, RECUENTO, FORMA, TOPE, CONTRADICE})


def url_detalle(proveedor: int) -> str:
    """La ficha de un proveedor de Digitalízate con sus recursos.

    Returns:
        Su dirección pública.
    """
    consulta = {"baja": "false", "idCatalogo": 1, "idEmpresaDigitalizate": proveedor}
    return OPERACIONES + "RecuperaDetalleEmpresaDigitalizate?" + urlencode(consulta)


def _proveedores(dato: object, baja: bool) -> tuple[list[dict[str, Any]], str | None]:
    """Los proveedores de una lista y, si no se puede leer con seguridad, por qué.

    Returns:
        La lista y None; o una lista vacía y el motivo (tope de proveedores o forma inesperada), sin parar la fuente.
    """
    if not isinstance(dato, list) or (not dato and not baja):
        return [], FORMA
    if len(dato) > MAX_PROVEEDORES:
        return [], TOPE
    vistos = set()
    for p in dato:
        if not (
            isinstance(p, dict)
            and type(p.get("idEmpresaDigitalizate")) is int
            and p["idEmpresaDigitalizate"] not in vistos
            and type(p.get("numeroCursos")) is int
            and p["numeroCursos"] >= 0
            and p.get("baja") is baja
        ):
            return [], FORMA
        vistos.add(p["idEmpresaDigitalizate"])
    return dato, None


def a_consultar(activa: object, baja: object, conocidos: set[int]) -> list[int]:
    """Los proveedores cuya ficha se pide.

    Los de la lista activa con cursos o con recursos conocidos, y los conocidos que no están en ninguna de las dos
    listas. La ficha de un proveedor dado de baja no se pide: no acredita nada.

    Returns:
        Sus identificadores, ordenados; ninguno si una lista no se puede leer.
    """
    activos, motivo_activa = _proveedores(activa, baja=False)
    retirados, motivo_baja = _proveedores(baja, baja=True)
    if motivo_activa or motivo_baja:
        return []
    ids_activos = {p["idEmpresaDigitalizate"] for p in activos}
    ids_baja = {p["idEmpresaDigitalizate"] for p in retirados}
    con_cursos = {p["idEmpresaDigitalizate"] for p in activos if p["numeroCursos"] > 0}
    return sorted(con_cursos | (set(conocidos) & ids_activos) | (set(conocidos) - ids_activos - ids_baja))


def consultar(carpeta: Path, recibir: Callable[[str, Path], dict[str, Any]], conocidos: set[int]) -> dict[str, Any]:
    """Pide las dos listas y, si respondieron, la ficha de cada proveedor que haya que consultar (en serie).

    Las capturas se conservan en `carpeta` (la del canal catalogos/); un corte deja las ya recibidas.

    Returns:
        El documento del censo: las dos listas, los proveedores conocidos y la ficha de cada proveedor consultado.
    """
    documento: dict[str, Any] = {"schema_version": 1, "fuente_id": "fundae", "fichas": {}}
    documento["conocidos"] = sorted(conocidos)
    documento["empresas"] = recibir(EMPRESAS, carpeta)
    documento["empresas_baja"] = recibir(EMPRESAS_BAJA, carpeta)
    activa, _ = ediciones.respuesta(carpeta, documento["empresas"], EMPRESAS)
    baja, _ = ediciones.respuesta(carpeta, documento["empresas_baja"], EMPRESAS_BAJA)
    if activa is not None and baja is not None:
        for id in a_consultar(activa, baja, conocidos):
            documento["fichas"][str(id)] = recibir(url_detalle(id), carpeta)
    return documento


def capturas(documento: dict[str, Any]) -> list[dict[str, Any]]:
    """Las capturas de un documento del censo.

    Returns:
        Las de las listas, si las hay, y las de las fichas.
    """
    listas = [documento.get("empresas"), documento.get("empresas_baja")]
    return [c for c in [*listas, *documento.get("fichas", {}).values()] if c is not None]


def es_curso(recurso: dict[str, Any]) -> bool:
    """Si un recurso es del tipo «Curso» (`idTipoRecurso` 1 con ese nombre).

    Returns:
        True si su par de tipo es el de «Curso».
    """
    return (recurso.get("idTipoRecurso"), recurso.get("tipoRecurso")) == CURSO


def pertenece(recurso: dict[str, Any]) -> bool:
    """El criterio de pertenencia de Faro para un recurso de Digitalízate (el de `digitalizate.py`).

    Returns:
        True si es del catálogo 1, de tipo «Curso», sin baja y con un destino público válido.
    """
    catalogos = recurso.get("catalogos")
    del_catalogo = isinstance(catalogos, list) and any(
        isinstance(c, dict) and c.get("idCatalogo") == 1 and c.get("descripcionCatalogo") == "Digitalizate"
        for c in catalogos
    )
    return (
        del_catalogo
        and es_curso(recurso)
        and recurso.get("baja") is False
        and digitalizate._destino(recurso.get("urlCurso"))[0] is not None
    )


def _no_disponible(carpeta: Path, captura: dict[str, Any], id: int) -> bool | None:
    """Si la ficha de un proveedor fuera de las dos listas dice que ya no existe en el catálogo.

    Returns:
        True ante el 404 `AgoraException` de esa dirección, sin redirección; False ante un 200; None si falló.
    """
    meta = comun.leer_recibo(carpeta, captura)
    if meta["http"] == HTTPStatus.OK and meta.get("completo") is True:
        return False
    if meta["http"] != HTTPStatus.NOT_FOUND or meta.get("url_final") != url_detalle(id) or not captura.get("cuerpo"):
        return None
    try:
        cuerpo = comun.leer_conservado(carpeta, captura["cuerpo"])
        dato = json.loads(cuerpo.decode("utf-8"))
    except (UnicodeError, ValueError):
        return None
    return isinstance(dato, dict) and all(dato.get(k) == v for k, v in NO_DISPONIBLE.items())


def leer(carpeta: Path, documento: dict[str, Any]) -> dict[str, Any]:
    """Reproduce el censo solo desde lo conservado y dice si es completo.

    Returns:
        `completo`, su `motivo`, los proveedores activos, los dados de baja, los que ya no existen y los que
        contradicen a las listas; cada recurso de un proveedor activo con su ficha, categoría, localizador y evidencia;
        los recursos sin noticia por su forma, la evidencia de cada consulta y la que acredita el estado de cada
        proveedor (su ficha activa o el 404 de los que ya no existen).

    Raises:
        FormatoInesperado: Si el documento es de otra fuente.
    """
    comun.exigir(
        documento.get("schema_version") == 1 and documento.get("fuente_id") == "fundae",
        "Procedencia del censo de Digitalízate ajena",
        FormatoInesperado,
    )
    lectura: dict[str, Any] = {"completo": False, "motivo": None, "proveedores": {}, "recursos": {}}
    lectura.update(areas={}, evidencias=[], descuadres=[], fallidas=[], formas=[], sin_noticia=[])
    lectura.update(dados_de_baja=[], no_disponibles=[], contradicen_listas=[], pruebas_del_proveedor={})
    listas = {}
    for clave, url, motivo in (("empresas", EMPRESAS, LISTA_CAIDA), ("empresas_baja", EMPRESAS_BAJA, LISTA_BAJA_CAIDA)):
        captura = documento.get(clave)
        dato, meta = ediciones.respuesta(carpeta, captura, url) if captura else (None, None)
        if meta is not None:
            lectura["evidencias"].append({**ediciones.evidencia(captura, meta), "inicio_utc": meta["inicio_utc"]})
        if dato is None:
            return {**lectura, "motivo": motivo}
        listas[clave] = dato
    activos, motivo = _proveedores(listas["empresas"], baja=False)
    retirados, motivo_baja = _proveedores(listas["empresas_baja"], baja=True)
    if motivo or motivo_baja:
        return {**lectura, "motivo": motivo or motivo_baja}
    ids_activos = {p["idEmpresaDigitalizate"] for p in activos}
    lectura["dados_de_baja"] = sorted(p["idEmpresaDigitalizate"] for p in retirados)
    if ids_activos & set(lectura["dados_de_baja"]):
        return {**lectura, "motivo": FORMA}
    for p in activos:
        lectura["proveedores"][p["idEmpresaDigitalizate"]] = {
            k: p.get(k) for k in ("nombre", "marcaComercial", "url", "numeroCursos")
        }
    _leer_fichas(carpeta, documento, listas, activos, lectura)
    if lectura["formas"]:
        lectura["motivo"] = FORMA
    elif lectura["fallidas"]:
        lectura["motivo"] = FICHAS_CAIDAS
    elif lectura["descuadres"]:
        lectura["motivo"] = RECUENTO
    else:
        lectura["completo"] = True
        # Un recurso mal formado que se pudo aislar queda sin noticia; el resto del censo sigue siendo completo.
        lectura["motivo"] = FORMA if lectura["sin_noticia"] else None
    return lectura


def _leer_fichas(
    carpeta: Path, documento: dict[str, Any], listas: dict[str, Any], activos: list[dict[str, Any]], lectura: dict
) -> None:
    """Lee la ficha de cada proveedor que había que consultar y anota fallos, descuadres y estados observados."""
    publicados = {p["idEmpresaDigitalizate"]: p["numeroCursos"] for p in activos}
    for id in a_consultar(listas["empresas"], listas["empresas_baja"], set(documento.get("conocidos", []))):
        captura = documento["fichas"].get(str(id))
        if captura is None:
            lectura["fallidas"].append({"proveedor": id, "http": None})
            continue
        if id not in publicados:
            # Fuera de las dos listas: solo su 404 «ya no está disponible» es un estado observado.
            estado = _no_disponible(carpeta, captura, id)
            if estado is None:
                lectura["fallidas"].append({"proveedor": id, "http": comun.leer_recibo(carpeta, captura)["http"]})
            else:
                lectura["no_disponibles" if estado else "contradicen_listas"].append(id)
                if estado:
                    meta = comun.leer_recibo(carpeta, captura)
                    prueba = {**ediciones.evidencia(captura, meta), "inicio_utc": meta["inicio_utc"]}
                    lectura["evidencias"].append(prueba)
                    lectura["pruebas_del_proveedor"][id] = prueba
            continue
        ficha, meta = ediciones.respuesta(carpeta, captura, url_detalle(id))
        prueba = {**ediciones.evidencia(captura, meta), "inicio_utc": meta["inicio_utc"]}
        lectura["evidencias"].append(prueba)
        lectura["pruebas_del_proveedor"][id] = prueba
        if ficha is None:
            lectura["fallidas"].append({"proveedor": id, "http": meta.get("http")})
            continue
        recibidos = _leer_ficha(ficha, id, prueba, lectura)
        if recibidos is not None and recibidos != publicados[id]:
            lectura["descuadres"].append({"proveedor": id, "publicados": publicados[id], "recibidos": recibidos})


def _tipos_declarados(ficha: dict[str, Any]) -> set[tuple[int, str]] | None:
    filtros = ficha.get("filtros")
    tipos = filtros.get("tiposRecursos") if isinstance(filtros, dict) else None
    if not isinstance(tipos, list) or not all(
        isinstance(t, dict) and type(t.get("id")) is int and isinstance(t.get("name"), str) for t in tipos
    ):
        return None
    pares = {(t["id"], t["name"]) for t in tipos}
    # Un 1 con otro nombre o «Curso» con otro número es un cambio de forma de toda la ficha.
    if any((i == CURSO[0]) != (n == CURSO[1]) for i, n in pares):
        return None
    return pares


def _lista_de(dato: object, clave: str) -> list[Any] | None:
    # La lista que un objeto trae en `clave` (vacía si falta), o None si no es una lista.
    valor = dato.get(clave) if isinstance(dato, dict) else None
    return [] if valor is None else valor if isinstance(valor, list) else None


def _recursos_de(respuesta: dict[str, Any]) -> list[tuple[int, int, dict[str, Any], Any]] | None:
    """Los recursos de una ficha con su categoría y su posición.

    Returns:
        (posición de la categoría, posición del recurso, categoría, recurso) de cada uno, o None si alguna categoría o
        lista de recursos no tiene la forma esperada.
    """
    categorias = _lista_de(respuesta, "digitalizateCategoria")
    if categorias is None or not all(isinstance(c, dict) for c in categorias):
        return None
    encontrados = []
    for ci, categoria in enumerate(categorias):
        recursos = _lista_de(categoria, "digitalizateRecursoFormativo")
        if recursos is None:
            return None
        encontrados.extend((ci, ri, categoria, recurso) for ri, recurso in enumerate(recursos))
    return encontrados


def _legible(recurso: dict[str, Any], tipos: set[tuple[int, str]]) -> bool:
    # Si la baja y el tipo de un recurso se pueden leer y el tipo es uno de los que declara su ficha.
    id_tipo, tipo = recurso.get("idTipoRecurso"), recurso.get("tipoRecurso")
    return (
        type(id_tipo) is int
        and isinstance(tipo, str)
        and type(recurso.get("baja")) is bool
        and (id_tipo, tipo) in tipos
    )


def _texto(dato: object, *, obligatorio: bool) -> bool:
    # Un texto no vacío; si no es obligatorio, también vale que falte.
    return (dato is None and not obligatorio) or (isinstance(dato, str) and bool(dato.strip()))


def _con_lo_que_lee_el_alta(recurso: dict[str, Any], proveedor: dict[str, Any]) -> bool:
    # Si trae, con la forma que `programa` los lee, el título, el nombre y los datos del proveedor y la gratuidad.
    if not all(isinstance(c, dict) for c in recurso["catalogos"]):
        return False
    catalogo = next((c for c in recurso["catalogos"] if c.get("idCatalogo") == 1), {})
    return (
        _texto(recurso.get("denominacion"), obligatorio=True)
        and _texto(proveedor.get("nombre"), obligatorio=True)
        and _texto(proveedor.get("marcaComercial"), obligatorio=False)
        and _texto(proveedor.get("url"), obligatorio=False)
        and _texto(catalogo.get("descripcionCard"), obligatorio=False)
    )


def _firma(recurso: dict[str, Any]) -> tuple[Any, Any, Any]:
    return recurso.get("idTipoRecurso"), recurso.get("tipoRecurso"), recurso.get("baja")


def _anotar_recurso(lectura: dict[str, Any], rid: int, visto: dict[str, Any] | None) -> None:
    """Registra el recurso `rid` de una ficha; sin noticia si no se pudo leer o si otra ficha lo trae distinto.

    Dos proveedores activos que traen el mismo recurso lo cuentan una vez si coinciden en baja y tipo.
    """
    previo = lectura["recursos"].get(rid)
    if visto is not None and previo is not None and _firma(previo["recurso"]) == _firma(visto["recurso"]):
        return
    if visto is not None and previo is None and rid not in lectura["sin_noticia"]:
        lectura["recursos"][rid] = visto
        return
    lectura["recursos"].pop(rid, None)
    if rid not in lectura["sin_noticia"]:
        lectura["sin_noticia"].append(rid)


def _leer_ficha(ficha: object, proveedor: int, prueba: dict[str, Any], lectura: dict[str, Any]) -> int | None:
    """Anota los recursos de la ficha de un proveedor activo y el nombre de sus áreas.

    Un recurso con su identidad pero con `baja` o tipo mal formados, que pertenece sin traer lo que necesita su alta
    (denominación, nombre de su proveedor) o que otra ficha trae distinto, queda sin noticia (se puede aislar).
    Una ficha sin la forma esperada, un recurso sin identidad o un repetido distinto dejan el censo sin completar.

    Returns:
        Cuántos recursos distintos trae la ficha, o None si su forma no deja contarlos.
    """
    respuesta = ficha.get("respuesta") if isinstance(ficha, dict) else None
    tipos = _tipos_declarados(ficha) if isinstance(ficha, dict) else None
    encontrados = _recursos_de(respuesta) if isinstance(respuesta, dict) else None
    if encontrados is None or respuesta.get("idEmpresaDigitalizate") != proveedor or tipos is None:
        lectura["formas"].append({"proveedor": proveedor, "recurso": None})
        return None
    for area in _lista_de(ficha["filtros"], "areasInteres") or []:
        if isinstance(area, dict) and type(area.get("id")) is int:
            lectura["areas"].setdefault(area["id"], set()).add(str(area.get("name")))
    unicos: dict[int, dict[str, Any]] = {}
    for ci, ri, categoria, recurso in encontrados:
        rid = recurso.get("idRecursoFormativo") if isinstance(recurso, dict) else None
        if type(rid) is not int or rid <= 0 or (rid in unicos and unicos[rid] != recurso):
            lectura["formas"].append({"proveedor": proveedor, "recurso": rid})
            continue
        if rid in unicos:
            continue
        unicos[rid] = recurso
        visto = None
        if _legible(recurso, tipos) and (not pertenece(recurso) or _con_lo_que_lee_el_alta(recurso, respuesta)):
            localizador = f"respuesta.digitalizateCategoria[{ci}].digitalizateRecursoFormativo[{ri}]"
            visto = {"recurso": recurso, "proveedor": proveedor, "padre": respuesta, "categoria": categoria}
            visto.update(evidencia=prueba, localizador=localizador)
        _anotar_recurso(lectura, rid, visto)
    return len(unicos)


def altas(lectura: dict[str, Any], conocidos: set[int]) -> list[int]:
    """Los recursos que cumplen el criterio de pertenencia y aún no están en el catálogo; nunca de un censo parcial.

    Returns:
        Sus identificadores, ordenados.
    """
    if not lectura["completo"]:
        return []
    return sorted(rid for rid, v in lectura["recursos"].items() if rid not in conocidos and pertenece(v["recurso"]))


def programa(visto: dict[str, Any], evidencia: dict[str, Any]) -> dict[str, Any]:
    """El programa de un alta, con su destino y su proveedor, en la forma del adaptador de Digitalízate.

    Returns:
        El programa con su evidencia.
    """
    recurso, padre, categoria = visto["recurso"], visto["padre"], visto["categoria"]
    destino, cambio = digitalizate._destino(recurso["urlCurso"])
    catalogo = next(c for c in recurso["catalogos"] if c.get("idCatalogo") == 1)
    return {
        "id": f"fundae:1:{recurso['idRecursoFormativo']}",
        "proveedor_id": digitalizate.PUBLICADOR_ID,
        "titulo": recurso["denominacion"],
        "url": destino,
        "tipo_unidad": "recurso_catalogo_tipo_curso",
        "datos": {
            "adaptador": "censo-digitalizate",
            "id_catalogo_fuente": 1,
            "id_recurso_fuente": recurso["idRecursoFormativo"],
            "url_destino_publicada": recurso["urlCurso"],
            "normalizacion_url": cambio,
            "rol_proveedor_principal": "publicador_agregador_no_impartidor",
            "entidad_publicada": {
                "id": padre["idEmpresaDigitalizate"],
                "nombre": padre["nombre"],
                "marca": padre.get("marcaComercial"),
                "url": padre.get("url"),
                "rol": "proveedor_del_recurso_publicado_por_agregador; imparticion_no_acreditada",
            },
            "metadatos_fuente": {
                k: recurso.get(k)
                for k in (
                    "tipoRecurso",
                    "descripcionIdioma",
                    "modalidad",
                    "duracion",
                    "areasInteres",
                    "nivelDigitalizacion",
                    "periodoInscripcionInicio",
                    "periodoInscripcionFin",
                    "baja",
                )
            },
            "categoria_publicada": {"id": categoria.get("idCategoria"), "nombre": categoria.get("categoria")},
            "fuente_por_campos": {"recurso": visto["localizador"], "entidad_publicada": "respuesta.nombre"},
            "declaracion_general_gratuidad_publicada": catalogo.get("descripcionCard"),
            "cobertura": "censo_completo_digitalizate",
        },
        "evidencias": [evidencia],
        "etiquetas": [],
    }
