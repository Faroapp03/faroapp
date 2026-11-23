"""Contrato de aprendizaje previsto; no acredita dominio, acceso ni equivalencias."""

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson


class ErrorAprendizaje(ValueError):
    """Referencia, nivel o evidencia de aprendizaje incoherente."""


def _exigir(condicion: bool, mensaje: str) -> None:
    if not condicion:
        raise ErrorAprendizaje(mensaje)


def _campos(objeto: ValorJson, campos: tuple[str, ...], lugar: str) -> None:
    _exigir(
        isinstance(objeto, dict) and set(objeto) == set(campos),
        f"{lugar}: campos inválidos",
    )


def _texto(valor: ValorJson, lugar: str) -> None:
    _exigir(
        isinstance(valor, str) and bool(valor.strip()) and not any(ord(c) < PRIMER_CARACTER_IMPRIMIBLE for c in valor),
        f"{lugar}: texto no vacío sin controles obligatorio",
    )


def _identidad(objeto: ObjetoJson, campos: tuple[str, ...], lugar: str) -> tuple[str, ...]:
    _campos(objeto, campos, lugar)
    for campo in campos:
        _texto(objeto[campo], lugar + "." + campo)
    return tuple(objeto[campo] for campo in campos)


PRIMER_CARACTER_IMPRIMIBLE = 32

CLAVE_COMPETENCIA = ("marco", "version", "codigo")
CLAVE_ESCALA = ("id", "version")


def cargar_registro() -> tuple[ObjetoJson, str]:
    """Lee el registro compartido local; su huella identifica exactamente sus bytes.

    Returns:
        Registro comprobado y SHA-256 de los bytes leídos.
    """
    contenido = (Path(__file__).parent / "esquemas" / "registro_aprendizaje.json").read_bytes()

    def pares_unicos(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
        resultado = {}
        for clave, valor in pares:
            _exigir(clave not in resultado, "Clave repetida en registro de aprendizaje")
            resultado[clave] = valor
        return resultado

    registro = json.loads(contenido, object_pairs_hook=pares_unicos)
    validar_registro(registro)
    return registro, hashlib.sha256(contenido).hexdigest()


def validar_registro(registro: ObjetoJson) -> None:
    """Rechaza identidades, valores y estructuras duplicadas o incoherentes."""
    _campos(registro, ("id", "version", "competencias", "escalas"), "registro")
    _texto(registro["id"], "registro.id")
    _texto(registro["version"], "registro.version")
    for grupo in ("competencias", "escalas"):
        _exigir(isinstance(registro[grupo], list), f"registro.{grupo}: lista obligatoria")
        vistas = set()
        for entrada in registro[grupo]:
            claves = CLAVE_COMPETENCIA if grupo == "competencias" else CLAVE_ESCALA
            campos = (*claves, "denominacion", "fuente") + (("valores",) if grupo == "escalas" else ())
            _campos(entrada, campos, "registro." + grupo)
            identidad = _identidad({k: entrada[k] for k in claves}, claves, grupo)
            _exigir(identidad not in vistas, f"{grupo}: identidad duplicada")
            vistas.add(identidad)
            _texto(entrada["denominacion"], grupo + ".denominacion")
            _texto(entrada["fuente"], grupo + ".fuente")
            if grupo == "escalas":
                valores = entrada["valores"]
                _exigir(
                    isinstance(valores, list) and bool(valores),
                    "escala: valores literales obligatorios",
                )
                for valor in valores:
                    _texto(valor, "escala.valor")
                _exigir(len(set(valores)) == len(valores), "escala: valores duplicados")


def competencia_registrada(referencia: ObjetoJson, registro: ObjetoJson) -> bool:
    """Solo acredita presencia de identidad; nunca equivalencia ni cobertura curricular.

    Returns:
        Si la identidad completa figura en el registro recibido.
    """
    clave = _identidad(referencia, CLAVE_COMPETENCIA, "competencia")
    return any(tuple(c[k] for k in CLAVE_COMPETENCIA) == clave for c in registro["competencias"])


def _metodo(metodo: ObjetoJson) -> None:
    _identidad(metodo, ("nombre", "version"), "metodo")


def _evidencias(evidencias: list[ObjetoJson], capturas: set[tuple[str, str, str]]) -> None:
    _exigir(isinstance(evidencias, list), "aprendizaje.evidencias: lista obligatoria")
    for evidencia in evidencias:
        _campos(
            evidencia,
            ("url", "capturado_utc", "sha256", "localizador", "fragmento"),
            "evidencia de aprendizaje",
        )
        for campo in ("url", "capturado_utc", "sha256"):
            _texto(evidencia[campo], "evidencia." + campo)
        _exigir(
            (evidencia["url"], evidencia["capturado_utc"], evidencia["sha256"]) in capturas,
            "Evidencia de aprendizaje sin captura incluida en el programa",
        )
        _identidad(evidencia["localizador"], ("tipo", "valor"), "localizador")
        _exigir(
            evidencia["localizador"]["tipo"] in ("objetivo", "modulo", "requisito"),
            "Tipo de localizador inválido",
        )
        _texto(evidencia["fragmento"], "fragmento de evidencia")


def validar_aprendizaje(
    aprendizaje: ObjetoJson,
    evidencias_programa: list[ObjetoJson],
    registro: ObjetoJson,
    huella_registro: str,
    validar_fecha: Callable[[ValorJson, str], object],
) -> None:
    """Valida referencias y niveles sin generar correspondencias o transformar null."""
    _campos(
        aprendizaje,
        ("schema_version", "registro", "contenido_observado", "afirmaciones"),
        "aprendizaje",
    )
    _exigir(
        type(aprendizaje["schema_version"]) is int and aprendizaje["schema_version"] == 1,
        "schema_version de aprendizaje debe ser 1",
    )
    referencia = aprendizaje["registro"]
    _campos(referencia, ("id", "version", "sha256"), "aprendizaje.registro")
    _exigir(
        referencia
        == {
            "id": registro["id"],
            "version": registro["version"],
            "sha256": huella_registro,
        },
        "El registro de aprendizaje no coincide en identidad, versión o huella",
    )
    _exigir(
        type(aprendizaje["contenido_observado"]) is bool,
        "contenido_observado debe ser booleano",
    )
    afirmaciones = aprendizaje["afirmaciones"]
    _exigir(isinstance(afirmaciones, list), "afirmaciones debe ser lista")
    _exigir(
        aprendizaje["contenido_observado"] or not afirmaciones,
        "Sin contenido observado no se atribuyen afirmaciones",
    )
    capturas = {(e["url"], e["capturado_utc"], e["sha256"]) for e in evidencias_programa}
    escalas = {tuple(e[k] for k in CLAVE_ESCALA): e["valores"] for e in registro["escalas"]}
    vistos = set()
    for afirmacion in afirmaciones:
        _campos(
            afirmacion,
            (
                "id",
                "competencia",
                "dimension",
                "descripcion",
                "nivel",
                "origen",
                "estado",
                "metodo",
                "revision",
                "evidencias",
                "discrepancias",
                "revision_requerida",
            ),
            "afirmacion",
        )
        _texto(afirmacion["id"], "afirmacion.id")
        _exigir(afirmacion["id"] not in vistos, "ID de afirmación duplicado")
        vistos.add(afirmacion["id"])
        _validar_afirmacion(afirmacion, registro, escalas, capturas, validar_fecha)


def _validar_nivel(afirmacion: ObjetoJson, registro: ObjetoJson, escalas: dict[tuple[str, ...], list[str]]) -> None:
    """Comprueba pertenencia a la escala sin inferir niveles desconocidos."""
    nivel = afirmacion["nivel"]
    _campos(nivel, ("escala", "valor"), "nivel")
    escala = nivel["escala"]
    if escala is not None:
        clave = _identidad(escala, CLAVE_ESCALA, "nivel.escala")
        _exigir(clave in escalas, "Escala no registrada: conservar nivel desconocido")
    if nivel["valor"] is not None:
        _texto(nivel["valor"], "nivel.valor")
        _exigir(
            escala is not None and nivel["valor"] in escalas[clave],
            "Valor ajeno a la escala registrada",
        )
        _exigir(
            afirmacion["competencia"] is not None and competencia_registrada(afirmacion["competencia"], registro),
            "Un nivel conocido exige competencia registrada",
        )


def _validar_revision(afirmacion: ObjetoJson, validar_fecha: Callable[[ValorJson, str], object]) -> None:
    """Exige la procedencia de una revisión y conserva su tipo."""
    revision = afirmacion["revision"]
    if afirmacion["estado"] == "revisada":
        _campos(revision, ("tipo", "referencia", "metodo", "fecha_utc"), "revision")
        _exigir(
            revision["tipo"] in ("humana", "automatizada"),
            "Tipo de revisión inválido",
        )
        _texto(revision["referencia"], "revision.referencia")
        _metodo(revision["metodo"])
        validar_fecha(revision["fecha_utc"], "revision.fecha_utc")
    else:
        _exigir(
            revision is None,
            "La revisión solo se declara para inferencias revisadas",
        )


def _validar_afirmacion(
    afirmacion: ObjetoJson,
    registro: ObjetoJson,
    escalas: dict[tuple[str, ...], list[str]],
    capturas: set[tuple[str, str, str]],
    validar_fecha: Callable[[ValorJson, str], object],
) -> None:
    """Contrasta significado, nivel, revisión y evidencia de una afirmación."""
    if afirmacion["competencia"] is not None:
        # Una identidad no registrada se conserva pendiente; no se fabrica ni certifica.
        competencia_registrada(afirmacion["competencia"], registro)
    _texto(afirmacion["dimension"], "afirmacion.dimension")
    _texto(afirmacion["origen"], "afirmacion.origen")
    _texto(afirmacion["estado"], "afirmacion.estado")
    _exigir(
        afirmacion["dimension"] in ("requisito_entrada", "resultado_previsto"),
        "Dimensión inválida",
    )
    if afirmacion["descripcion"] is not None:
        _texto(afirmacion["descripcion"], "afirmacion.descripcion")
    _validar_nivel(afirmacion, registro, escalas)
    nivel = afirmacion["nivel"]
    _exigir(
        (afirmacion["origen"], afirmacion["estado"])
        in {
            ("extraccion_oficial", "extraida"),
            ("inferencia", "propuesta"),
            ("inferencia", "revisada"),
        },
        "Origen y estado incompatibles",
    )
    _metodo(afirmacion["metodo"])
    _exigir(
        type(afirmacion["revision_requerida"]) is bool,
        "revision_requerida debe ser booleano",
    )
    _validar_revision(afirmacion, validar_fecha)
    _evidencias(afirmacion["evidencias"], capturas)
    conocida = any(
        (
            afirmacion["descripcion"] is not None,
            afirmacion["competencia"] is not None,
            nivel["valor"] is not None,
        )
    )
    _exigir(
        not conocida or bool(afirmacion["evidencias"]),
        "Afirmación conocida sin evidencia",
    )
    if afirmacion["dimension"] == "resultado_previsto" and conocida:
        _exigir(
            any(e["localizador"]["tipo"] in ("objetivo", "modulo") for e in afirmacion["evidencias"]),
            "Resultado previsto sin localizador de objetivo o módulo",
        )
    if afirmacion["origen"] == "extraccion_oficial":
        _exigir(
            afirmacion["descripcion"] is not None and bool(afirmacion["evidencias"]),
            "La extracción oficial exige declaración y evidencia",
        )
    if afirmacion["dimension"] == "requisito_entrada" and nivel["valor"] is not None:
        _exigir(
            afirmacion["origen"] == "extraccion_oficial"
            and any(e["localizador"]["tipo"] == "requisito" for e in afirmacion["evidencias"]),
            "Nivel de entrada solo como requisito oficial declarado",
        )
    _exigir(
        isinstance(afirmacion["discrepancias"], list),
        "discrepancias debe ser lista",
    )
    for discrepancia in afirmacion["discrepancias"]:
        _campos(discrepancia, ("descripcion", "evidencias"), "discrepancia")
        _texto(discrepancia["descripcion"], "discrepancia.descripcion")
        _evidencias(discrepancia["evidencias"], capturas)
        _exigir(bool(discrepancia["evidencias"]), "Discrepancia sin evidencia")
