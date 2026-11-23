"""Instantánea del panel que viaja en un recibo de mantenimiento: forma cerrada, fuentes, módulos y comprobaciones.

Valida el DTO existente sin convertirlo en un estado operativo restaurable. Falla cerrado con AlmacenTrabajoInvalido.
"""

import re
from typing import Any

from plataforma_datos.contratos.fuentes import POLITICAS
from plataforma_datos.cursos.fallos_almacen import CODIGOS as CODIGOS_ALMACEN
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import (
    VERSION_PANEL_RETENIDOS,
    VERSIONES_PANEL,
    clave_revision_pendiente,
    instante_panel,
    validar_catalogo_panel,
    validar_comprobaciones_panel,
    validar_seguimiento_panel,
)
from plataforma_datos.orquestacion.contrato_de_trabajos import (
    ERROR,
    AlmacenTrabajoInvalido,
    _bytes,
    _entero,
    _fecha,
    exigir,
    hexa,
    instante,
    objeto,
)
from plataforma_datos.orquestacion.cuarentena_panel import CLAVE_RETENIDOS, validar_retenidos
from plataforma_datos.orquestacion.ediciones_observadas import clave_en_la_fila, comprobar_en_el_recibo
from plataforma_datos.orquestacion.generacion_operativa import SHA256

VERSION_SNAPSHOT_COMPROBACIONES = 2
VERSION_SNAPSHOT_SEGUIMIENTO = 3
VERSION_SNAPSHOT_CATALOGO = 4
MAX_ESTADO_RECIBO_BYTES = 128 * 1024
MAX_REGISTROS = 64
VEREDICTOS = ("verde", "ámbar", "rojo")


def _fuente_con_su_edicion(r: dict[str, Any], observado: str) -> None:
    _fuente(r)
    comprobar_en_el_recibo(r, observado)


def _fuente(r: dict[str, Any]) -> None:
    exigir(r["id"] != "paquete" and r["politica"] in POLITICAS)
    if r["fecha"] is not None:
        _fecha(r["fecha"])
    if r["plazoDias"] is not None:
        _entero(r["plazoDias"])


def _modulo(r: dict[str, Any], observado: str) -> None:
    if "motivoAlmacen" in r:
        # Solo el paquete cita el fallo de su almacén de Cursos, con un código de la lista y sin estar en verde.
        exigir(r["id"] == "paquete" and r["motivoAlmacen"] in CODIGOS_ALMACEN and r["veredicto"] in ("ámbar", "rojo"))
    _entero(r["fallos"])
    exigir(r["veredicto"] is None or r["veredicto"] in VEREDICTOS)
    for campo in ("ultimoIntento", "proximoReintento"):
        if r[campo] is not None:
            instante(r[campo])
    buena = r["ultimaVersionBuena"]
    if buena is not None:
        objeto(buena, "fecha,huella")
        instante(buena["fecha"])
        hexa(buena["huella"], SHA256)
    if r["veredicto"] is None:
        exigir(r["ultimoIntento"] is None and buena is None and r["fallos"] == 0 and r["proximoReintento"] is None)
        return
    exigir(r["ultimoIntento"] is not None and instante_panel(r["ultimoIntento"]) <= instante_panel(observado))
    exigir(buena is None or buena["fecha"] <= r["ultimoIntento"])
    if r["veredicto"] == "verde":
        exigir(r["fallos"] == 0 and r["proximoReintento"] is None)
    else:
        exigir(r["fallos"] > 0 and r["proximoReintento"] is not None and r["proximoReintento"] > r["ultimoIntento"])


def validar_instantanea(valor: object) -> None:
    """Valida el DTO cerrado existente; no lo convierte en un estado operativo restaurable.

    Raises:
        AlmacenTrabajoInvalido: Si falla la estructura o el vínculo de las comprobaciones.
    """
    exigir(type(valor) is dict and type(valor.get("version")) is int and valor["version"] in VERSIONES_PANEL)
    exigir(len(_bytes(valor)) <= MAX_ESTADO_RECIBO_BYTES)
    version = valor["version"]
    revision = clave_revision_pendiente(version)
    claves = "version,observadoEn,fuentes,modulos," + revision
    claves += ",comprobaciones" if version >= VERSION_SNAPSHOT_COMPROBACIONES else ""
    claves += ",seguimientoRemoto" if version >= VERSION_SNAPSHOT_SEGUIMIENTO else ""
    claves += ",catalogoFuentes" if version >= VERSION_SNAPSHOT_CATALOGO else ""
    claves += "," + CLAVE_RETENIDOS if version >= VERSION_PANEL_RETENIDOS else ""
    o = objeto(valor, claves)
    if version == 1:
        instante(o["observadoEn"])
    else:
        instante_panel(o["observadoEn"])
    if o[revision] is not None:
        _fecha(o[revision])
    for campo, claves in (
        (
            "fuentes",
            "id,politica,fecha,plazoDias" + (",ultimaOperacion" if version >= VERSION_SNAPSHOT_COMPROBACIONES else ""),
        ),
        ("modulos", "id,ultimoIntento,veredicto,ultimaVersionBuena,fallos,proximoReintento"),
    ):
        lista = o[campo]
        exigir(type(lista) is list and 0 < len(lista) <= MAX_REGISTROS)
        ids = []
        for registro in lista:
            con_almacen = campo == "modulos" and type(registro) is dict and "motivoAlmacen" in registro
            propias = claves + (",motivoAlmacen" if con_almacen else "") + clave_en_la_fila(campo, registro)
            r = objeto(registro, propias)
            exigir(isinstance(r["id"], str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", r["id"]) is not None)
            ids.append(r["id"])
            if campo == "fuentes":
                _fuente_con_su_edicion(r, o["observadoEn"])
            else:
                _modulo(r, o["observadoEn"])
        exigir(len(ids) == len(set(ids)))
    exigir({r["id"] for r in o["modulos"]} == {"paquete", *(r["id"] for r in o["fuentes"])})
    if version >= VERSION_SNAPSHOT_COMPROBACIONES:
        try:
            _validar_bloques(o, version)
        except ValueError:
            raise AlmacenTrabajoInvalido(ERROR) from None


def _validar_bloques(o: dict[str, Any], version: int) -> None:
    """Valida los bloques que cada versión añade: comprobaciones, seguimiento, catálogo y retenidos."""
    validar_comprobaciones_panel(o)
    if version == VERSION_SNAPSHOT_SEGUIMIENTO or (
        version >= VERSION_SNAPSHOT_CATALOGO and o["seguimientoRemoto"] is not None
    ):
        validar_seguimiento_panel(o)
    if version >= VERSION_SNAPSHOT_CATALOGO:
        validar_catalogo_panel(o)
    if version >= VERSION_PANEL_RETENIDOS:
        validar_retenidos(o[CLAVE_RETENIDOS])
