"""Calendarios públicos propios de edición, conservando precisión y soporte.

No deduce matrícula del inicio del curso ni transforma un intervalo en sesiones.
Las fechas civiles y horas sin zona se conservan; no son instantes comparables.
"""

import re
from copy import deepcopy
from datetime import date, datetime

from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CAMPOS_CALENDARIO = ("calendario_matricula", "calendario_formacion", "calendario_aula")
MAX_SESIONES_CALENDARIO = 1000
HORAS_DIA = 24
MINUTOS_HORA = 60
TIPOS_CAMPO = {
    "calendario_matricula": ("matricula",),
    "calendario_formacion": ("periodo-formativo", "sesiones"),
    "calendario_aula": ("ventana-acceso",),
}
CAMPOS_ORIGEN = {
    "matricula": "fechas_matricula",
    "periodo-formativo": "fechas_edicion",
    "sesiones": "fechas_edicion",
    "ventana-acceso": "fechas_aula",
}
FECHA = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,6})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?"
)


class ErrorCalendarioEntrega(ValueError):
    """El calendario no conserva una forma o relación temporal válida."""


def _exigir(condicion: object, mensaje: str) -> None:
    if not condicion:
        raise ErrorCalendarioEntrega(mensaje)


def _fecha(valor: ValorJson) -> date | datetime | None:
    if valor is None:
        return None
    _exigir(isinstance(valor, str) and FECHA.fullmatch(valor), "Fecha de calendario no válida")
    zona = re.search(r"([+-])([0-9]{2}):([0-9]{2})$", valor)
    _exigir(zona is None or int(zona[2]) < HORAS_DIA and int(zona[3]) < MINUTOS_HORA, "Zona de calendario no válida")
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")) if "T" in valor else date.fromisoformat(valor)
    except ValueError as error:
        raise ErrorCalendarioEntrega("Fecha de calendario imposible") from error


def _periodo(valor: ObjetoJson) -> None:
    inicio, fin = (_fecha(valor[k]) for k in ("inicio", "fin"))
    _exigir(inicio is not None or fin is not None, "Calendario sin fecha publicada")
    if inicio is None or fin is None or type(inicio) is not type(fin):
        return
    if isinstance(inicio, datetime):
        if valor["inicio"].endswith("-00:00"):
            inicio = inicio.replace(tzinfo=None)
        if valor["fin"].endswith("-00:00"):
            fin = fin.replace(tzinfo=None)
        if (inicio.utcoffset() is None) != (fin.utcoffset() is None):
            return
    _exigir(inicio <= fin, "Calendario invertido")


def validar_valor(valor: ValorJson, campo: str) -> None:
    """Valida el objeto público sin normalizar fechas o completar zonas.

    Raises:
        ErrorCalendarioEntrega: Si cambia el tipo, forma, campo o validez civil.
    """
    _exigir(
        campo in TIPOS_CAMPO and isinstance(valor, dict) and valor.get("tipo") in TIPOS_CAMPO[campo],
        "Tipo de calendario ajeno al campo",
    )
    if valor["tipo"] == "sesiones":
        _exigir(
            set(valor) == {"tipo", "sesiones"}
            and isinstance(valor["sesiones"], list)
            and 0 < len(valor["sesiones"]) <= MAX_SESIONES_CALENDARIO,
            "Lista de sesiones vacía o excesiva",
        )
        for sesion in valor["sesiones"]:
            _exigir(isinstance(sesion, dict) and set(sesion) == {"inicio", "fin"}, "Campos de sesión incompatibles")
            _periodo(sesion)
    else:
        _exigir(set(valor) == {"tipo", "inicio", "fin"}, "Campos de periodo incompatibles")
        _periodo(valor)


def _desconocido(motivo: str, alcance: str) -> ObjetoJson:
    return {"valor": None, "motivo": motivo, "unidad": None, "moneda": None, "alcance": alcance}


def _propio(dato: ObjetoJson, id: str) -> bool:
    vinculo = dato.get("vinculo_edicion")
    e = dato.get("evidencia")
    return (
        dato.get("alcance") == "edicion"
        and isinstance(vinculo, dict)
        and vinculo.get("tipo") == "id"
        and isinstance(vinculo.get("edicion"), dict)
        and vinculo["edicion"].get("id") == id
        and isinstance(e, dict)
        and e.get("localizador") is not None
        and vinculo.get("evidencia") == e
    )


def _hecho(dato: ObjetoJson, campo: str) -> ObjetoJson:
    try:
        validar_valor(dato["valor"], campo)
    except ErrorCalendarioEntrega:
        return _desconocido("no_interpretable", "edicion")
    plazo = dato.get("vigencia")
    e = dato["evidencia"]
    # El calendario conserva solo la fecha de su propia captura; no caduca por el tiempo.
    if (
        not isinstance(plazo, dict)
        or set(plazo) != {"comprobado_el"}
        or plazo["comprobado_el"] != e.get("capturado_utc")
    ):
        return _desconocido("no_interpretable", "edicion")
    try:
        comprobado = _fecha(plazo["comprobado_el"])
    except ErrorCalendarioEntrega:
        return _desconocido("no_interpretable", "edicion")
    if (
        not isinstance(comprobado, datetime)
        or comprobado.utcoffset() is None
        or plazo["comprobado_el"].endswith("-00:00")
    ):
        return _desconocido("no_interpretable", "edicion")
    return {
        "valor": deepcopy(dato["valor"]),
        "motivo": "conocido",
        "unidad": None,
        "moneda": None,
        "alcance": "edicion",
        "vigencia": dict(plazo),
    }


def _resolver(candidatos: list[ObjetoJson]) -> ObjetoJson:
    if not candidatos:
        return _desconocido("sin_soporte_de_campo", "edicion")
    if any(c["motivo"] != "conocido" for c in candidatos):
        return _desconocido("no_interpretable", "edicion")
    if any(c["valor"] != candidatos[0]["valor"] for c in candidatos[1:]):
        return _desconocido("declaraciones_contradictorias", "edicion")
    # Se conserva un apoyo real con la comprobación más antigua, nunca una fecha sintética.
    return min(candidatos, key=lambda c: _fecha(c["vigencia"]["comprobado_el"]))


def proyectar(actual: ObjetoJson, *, alcance: str) -> ObjetoJson:
    """Devuelve tres hechos; solo una selección propia, fechada y no contradictoria acredita fechas.

    Returns:
        Calendarios de matrícula, formación y aula, manteniendo los desconocidos.
    """
    salida = {c: _desconocido("sin_soporte_de_campo", alcance) for c in CAMPOS_CALENDARIO}
    id = actual.get("edicion_id")
    if alcance != "edicion" or not isinstance(id, str):
        return salida
    calendarios = actual.get("calendarios_propios", [])
    if not isinstance(calendarios, list):
        return {c: _desconocido("no_interpretable", alcance) for c in CAMPOS_CALENDARIO}
    for campo, tipos in TIPOS_CAMPO.items():
        candidatos = []
        for dato in calendarios:
            if not isinstance(dato, dict) or not isinstance(dato.get("valor"), dict):
                continue
            tipo = dato["valor"].get("tipo")
            if tipo not in tipos or dato.get("campo") != CAMPOS_ORIGEN[tipo] or not _propio(dato, id):
                continue
            candidatos.append(_hecho(dato, campo))
        salida[campo] = _resolver(candidatos)
    return salida
