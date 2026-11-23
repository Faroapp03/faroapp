"""Hechos públicos por campos y origen explícitos; nunca elige entre contradicciones.

La falta de un campo, una declaración no interpretable y varias publicaciones
contradictorias son resultados diferentes. Se conservan como desconocidos tipados;
no permiten elegir otro alias, importe, moneda o soporte por orden de llegada.
La prosa y los originales permanecen en el almacén privado.
"""

import math
import re

from plataforma_datos.cursos import calendario_entrega, contrato_fichas
from plataforma_datos.cursos.fuentes.barcelonactiva.idioma_ficha import literal_de_idioma
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CAMPOS_SIN_PROYECCION = (
    "acceso_fundae",
    "marca_comercial",
    "nivel_entrada",
    "nivel_salida",
)
CAMPOS_HECHOS = (
    "idiomas_declarados",
    "idiomas_material_observado",
    "modalidad",
    "sincronia",
    "horas_publicadas",
    "coste_formacion_tipo",
    "coste_formacion",
    "certificado_gratuito",
    "coste_certificado",
    "coste_practicas",
    "requiere_registro_previo",
    "requisitos_publicados",
    *CAMPOS_SIN_PROYECCION,
    *calendario_entrega.CAMPOS_CALENDARIO,
)
MOTIVOS = (
    "conocido",
    "no_consta_en_evidencia",
    "no_interpretable",
    "sin_soporte_de_campo",
    "texto_no_redistribuido",
    "declaraciones_contradictorias",
)
ALCANCES = ("unidad", "edicion", "declaracion_general", "material_observado")
MAX_LITERAL = 80
GENERAL_FUNDAE = "Declaración general del catálogo; admisión individual sin comprobar."
IDIOMAS = (
    "idiomas_publicados",
    "idiomas",
    "idioma_publicado",
    "idioma_literal",
    "idioma_fuente",
)
# Un idioma nunca lleva dos puntos: el literal que los contiene arrastra el rótulo de otro campo.
ROTULO = ":"
CAMPOS_HORAS = ("horas", "duracion_horas", "horas_totales", "duracion")


def _objeto(valor: ValorJson) -> ObjetoJson:
    return valor if isinstance(valor, dict) else {}


def _hecho(valor: ValorJson = None, *, motivo: str | None = None, alcance: str = "unidad") -> ObjetoJson:
    return {
        "valor": valor,
        "motivo": motivo or ("conocido" if valor is not None else "no_consta_en_evidencia"),
        "unidad": None,
        "moneda": None,
        "alcance": alcance,
    }


def _resolver(candidatos: list[ObjetoJson], alcance: str) -> ObjetoJson:
    if not candidatos:
        return _hecho(alcance=alcance)
    primero = candidatos[0]
    if all(c == primero for c in candidatos):
        return primero
    motivo = (
        "declaraciones_contradictorias" if all(c["motivo"] == "conocido" for c in candidatos) else "no_interpretable"
    )
    return _hecho(motivo=motivo, alcance=alcance)


def _idiomas(datos: ObjetoJson, alcance: str) -> ObjetoJson:
    publicados = [datos[c] for c in IDIOMAS if datos.get(c) is not None]
    # Los hechos de ficha conservados pueden venir de una regla anterior que dejaba el calendario
    # detrás del idioma; se releen con la regla vigente del lector antes de publicarlos.
    de_ficha = (
        _objeto(datos.get("hechos_ficha_principal")).get("idioma_publicado_ficha"),
        datos.get("idioma_ficha_principal"),
    )
    publicados.extend(literal_de_idioma(v) if isinstance(v, str) else v for v in de_ficha if v is not None)
    candidatos = []
    for valor in publicados:
        lista = [valor] if isinstance(valor, str) else valor
        valido = (
            isinstance(lista, list)
            and bool(lista)
            and all(isinstance(v, str) and 0 < len(v) <= MAX_LITERAL and ROTULO not in v for v in lista)
        )
        candidatos.append(
            _hecho(sorted(set(lista)), alcance=alcance)
            if valido
            else _hecho(motivo="no_interpretable", alcance=alcance)
        )
    return _resolver(candidatos, alcance)


def _vocabulario(valor: ValorJson, vocabulario: set[str], alcance: str) -> ObjetoJson:
    conocido = isinstance(valor, str) and valor in vocabulario
    return _hecho(valor, alcance=alcance) if conocido else _hecho(motivo="no_interpretable", alcance=alcance)


def _numero(valor: ValorJson) -> bool:
    return type(valor) is int and valor >= 0 or type(valor) is float and math.isfinite(valor) and valor >= 0


def _importe(valor: ValorJson, alcance: str) -> ObjetoJson:
    if isinstance(valor, dict) and _numero(valor.get("importe")):
        moneda = valor.get("moneda")
        if moneda is None or isinstance(moneda, str) and re.fullmatch("[A-Z]{3}", moneda):
            return {**_hecho(valor["importe"], alcance=alcance), "moneda": moneda}
    return _hecho(motivo="texto_no_redistribuido" if isinstance(valor, str) else "no_interpretable", alcance=alcance)


def _alcance_formacion(datos: ObjetoJson, proveedor: str | None, alcance: str) -> str:
    declaracion = _objeto(datos.get("coste_formacion")).get("alcance")
    if proveedor == "fundae:publicador:catalogo:3" and declaracion == GENERAL_FUNDAE:
        return "declaracion_general"
    return alcance


def _monetario(
    datos: ObjetoJson,
    campos: tuple[str, ...],
    alcance: str,
    eur: str | None = None,
    *,
    alcance_principal: str | None = None,
) -> ObjetoJson:
    candidatos = [_importe(datos[c], alcance_principal or alcance) for c in campos if datos.get(c) is not None]
    if eur is not None and datos.get(eur) is not None:
        candidatos.append(_importe({"importe": datos[eur], "moneda": "EUR"}, alcance))
    return _resolver(candidatos, alcance)


def _costes(datos: ObjetoJson, proveedor: str | None, alcance: str) -> ObjetoJson:
    costes = _objeto(datos.get("costes_publicados"))
    marco = "declaracion_general" if proveedor in ("hp-life", "cibervoluntarios") else alcance
    alcance_formacion = _alcance_formacion(datos, proveedor, marco)
    tipos = []
    if datos.get("coste_formacion_tipo") is not None:
        tipos.append(_vocabulario(datos["coste_formacion_tipo"], contrato_fichas.COSTES, alcance))
    if costes.get("formacion") is not None:
        tipos.append(_vocabulario(costes["formacion"], contrato_fichas.COSTES, alcance_formacion))
    gratuito = costes.get("certificado_finalizacion_gratuito_declarado")
    return {
        "coste_formacion_tipo": _resolver(tipos, alcance),
        "coste_formacion": _monetario(
            datos,
            ("coste_formacion",),
            alcance,
            "matricula_eur",
            alcance_principal=_alcance_formacion(datos, proveedor, alcance),
        ),
        "certificado_gratuito": _hecho(gratuito if type(gratuito) is bool else None, alcance=marco),
        "coste_certificado": _monetario(
            datos, ("coste_certificado", "coste_certificado_publicado"), alcance, "certificado_coste_eur"
        ),
        "coste_practicas": _monetario(datos, ("coste_practicas", "coste_practica_publicado"), alcance),
    }


def _horas(datos: ObjetoJson, alcance: str) -> ObjetoJson:
    candidatos = []
    publicados = [
        datos.get("horas_publicadas"),
        _objeto(datos.get("hechos_ficha_principal")).get("horas_publicadas_ficha"),
    ]
    for publicado in publicados:
        if publicado is not None:
            candidatos.append(
                _hecho(publicado, alcance=alcance)
                if _numero(publicado)
                else _hecho(motivo="no_interpretable", alcance=alcance)
            )
    if any(datos.get(c) is not None for c in CAMPOS_HORAS):
        valor = contrato_fichas.normalizar_horas(datos)[0]
        candidatos.append(
            _hecho(valor, alcance=alcance) if valor is not None else _hecho(motivo="no_interpretable", alcance=alcance)
        )
    return {**_resolver(candidatos, alcance), "unidad": "h"}


def _modalidad(datos: ObjetoJson, alcance: str, actual: ObjetoJson) -> tuple[ObjetoJson, ObjetoJson]:
    modalidad, sincronia, _ = contrato_fichas.normalizar_modalidad(datos.get("modalidad"), datos.get("sincronia"))
    candidatos = []
    if datos.get("modalidad") is not None:
        candidatos.append(_vocabulario(modalidad, contrato_fichas.MODALIDADES, alcance))
    if datos.get("modalidad_normalizada") is not None:
        candidatos.append(_vocabulario(datos["modalidad_normalizada"], contrato_fichas.MODALIDADES, alcance))
    return _resolver(candidatos, alcance), _hecho(sincronia, alcance=alcance)


def _hecho_actual(anterior: ObjetoJson, valor: ValorJson, dato: ObjetoJson) -> ObjetoJson:
    """Conserva contradicciones y el alcance de la declaración actual acreditada.

    Returns:
        Hecho actual si falta el histórico o coincide su valor; discrepancias no
        se resuelven por fecha, orden o marca. La evidencia antigua no se reescribe
        y el hecho conserva la fecha de su captura sin caducar por el tiempo.
    """
    alcance = dato.get("alcance", anterior["alcance"])
    nuevo = _hecho(valor, alcance=alcance)
    if anterior["motivo"] in ("no_consta_en_evidencia", "sin_soporte_de_campo") or (
        anterior["motivo"] == "conocido" and type(anterior["valor"]) is type(valor) and anterior["valor"] == valor
    ):
        salida = nuevo
    else:
        salida = _resolver([anterior, nuevo], anterior["alcance"])
    if salida["motivo"] == "conocido" and dato.get("vigencia") is not None:
        salida["vigencia"] = dato["vigencia"]
    return salida


def proyectar_hechos(
    datos: ObjetoJson, *, alcance: str, proveedor_id: str | None = None, condiciones_actuales: ObjetoJson | None = None
) -> ObjetoJson:
    """Conserva hechos y contradicciones de todos los alias reconocidos, sin elegir.

    Returns:
        Campos filtrables con alcance por origen explícito y desconocidos tipados.
    """
    actual = condiciones_actuales or {}
    modalidad, sincronia = _modalidad(datos, alcance, actual)
    requisitos = _objeto(datos.get("requisitos_publicados"))
    registro = requisitos.get("registro_previo_para_inscribirse")
    registros = (
        [_hecho(registro, alcance="declaracion_general" if proveedor_id == "hp-life" else alcance)]
        if type(registro) is bool
        else []
    )
    hecho_registro = _resolver(registros, alcance)
    prosa = any(datos.get(c) is not None for c in ("requisitos_publicados", "requisitos_conocimientos_titulacion"))
    salida = {
        **{campo: _hecho(motivo="sin_soporte_de_campo", alcance=alcance) for campo in CAMPOS_SIN_PROYECCION},
        **calendario_entrega.proyectar(actual, alcance=alcance),
        "idiomas_declarados": _idiomas(datos, alcance),
        "idiomas_material_observado": _hecho(motivo="sin_soporte_de_campo", alcance="material_observado"),
        "modalidad": modalidad,
        "sincronia": sincronia,
        "horas_publicadas": _horas(datos, alcance),
        **_costes(datos, proveedor_id, alcance),
        "requiere_registro_previo": hecho_registro,
        "requisitos_publicados": _hecho(motivo="texto_no_redistribuido" if prosa else None, alcance=alcance),
    }
    for clave, campo, atributo in (
        ("inscripcion", "requiere_registro_previo", "registro_previo_para_inscribirse"),
        ("formacion", "coste_formacion_tipo", "valor"),
        ("idioma", "idiomas_declarados", "valor"),
        ("modalidad", "modalidad", "valor"),
        ("sincronia", "sincronia", "valor"),
    ):
        if actual.get(clave) is not None:
            dato = {"alcance": "declaracion_general", **actual[clave]} if clave == "inscripcion" else actual[clave]
            salida[campo] = _hecho_actual(salida[campo], dato[atributo], dato)
    return salida
