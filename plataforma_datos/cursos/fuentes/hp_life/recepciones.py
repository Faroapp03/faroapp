"""Recibos completos de HP LIFE: integridad e intervalo propios, sin E/S ni reloj."""

import hashlib
import json
from dataclasses import dataclass, fields
from datetime import datetime, timedelta
from http import HTTPStatus

from plataforma_datos.cursos.fuentes.hp_life.lector import CapturaHpLife, ErrorFichaHpLife
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

MAX_CUERPO = 8 * 1024 * 1024
MAX_RECIBO = 32 * 1024
ULTIMO_CODIGO_HTTP = 599
CAMPOS_RECIBO = frozenset({"captura", "inicio_utc", "content_type", "representacion_hash"})


def fecha_utc(valor: str) -> datetime:
    """Comprueba un instante explícito; nunca interpreta mtime o una fecha sin zona.

    Returns:
        Instante original con zona UTC.

    Raises:
        ErrorFichaHpLife: Si no es un instante UTC válido.
    """
    try:
        instante = datetime.fromisoformat(valor)
    except (TypeError, ValueError) as error:
        raise ErrorFichaHpLife("La recepción requiere un instante UTC válido") from error
    if instante.utcoffset() != timedelta(0):
        raise ErrorFichaHpLife("La recepción requiere zona UTC explícita")
    return instante


def _pares(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    salida = {}
    for clave, valor in pares:
        if clave in salida:
            raise ErrorFichaHpLife("Recibo ambiguo con claves duplicadas")
        salida[clave] = valor
    return salida


def _constante(_valor: str) -> None:
    raise ErrorFichaHpLife("Recibo con constante no JSON")


@dataclass(frozen=True, kw_only=True)
class RecepcionHpLife:
    """Cuerpo y recibo originales; la completitud se declara en la recepción, no por HTTP200."""

    cuerpo: bytes
    recibo: bytes
    captura: CapturaHpLife
    inicio_utc: str
    content_type: str

    @property
    def sha256_recibo(self) -> str:
        """Identidad de recepción completa, independiente del cuerpo deduplicable.

        Returns:
            SHA256 de los metadatos originales.
        """
        return hashlib.sha256(self.recibo).hexdigest()


def leer_recepcion(cuerpo: bytes, recibo: bytes) -> RecepcionHpLife:
    """Verifica el formato completo de recepción sin corregir metadatos antiguos.

    Returns:
        Recepción comprobada; todavía no interpreta acceso o identidad del curso.

    Raises:
        ErrorFichaHpLife: Si faltan completitud explícita, integridad o fechas comprobables.
    """
    if type(cuerpo) is not bytes or len(cuerpo) > MAX_CUERPO or type(recibo) is not bytes or len(recibo) > MAX_RECIBO:
        raise ErrorFichaHpLife("Cuerpo o recibo fuera de cota")
    try:
        dato = json.loads(recibo, object_pairs_hook=_pares, parse_constant=_constante)
        if not isinstance(dato, dict) or set(dato) != CAMPOS_RECIBO:
            raise ErrorFichaHpLife("Recibo sin contrato completo explícito")
        datos = dato["captura"]
        if not isinstance(datos, dict) or set(datos) != {f.name for f in fields(CapturaHpLife)}:
            raise ErrorFichaHpLife("Captura de recepción con campos no declarados")
        captura = CapturaHpLife(**datos)
        inicio = fecha_utc(dato["inicio_utc"])
        fin = fecha_utc(captura.recibido_utc)
    except (TypeError, ValueError, RecursionError) as error:
        raise ErrorFichaHpLife("Recibo no verificable: " + str(error)) from error
    if inicio > fin or type(captura.http) is not int or not HTTPStatus.CONTINUE <= captura.http <= ULTIMO_CODIGO_HTTP:
        raise ErrorFichaHpLife("Intervalo o estado HTTP incoherentes")
    if (
        type(captura.completo) is not bool
        or captura.original_conservado is not True
        or type(captura.bytes_cuerpo) is not int
        or captura.bytes_cuerpo != len(cuerpo)
        or captura.sha256_cuerpo != hashlib.sha256(cuerpo).hexdigest()
        or captura.sha256_respuesta != captura.sha256_cuerpo
    ):
        raise ErrorFichaHpLife("Original y metadatos no conservan su integridad")
    if not isinstance(dato["content_type"], str) or not isinstance(dato["representacion_hash"], str):
        raise ErrorFichaHpLife("Representación o tipo de contenido no declarados")
    return RecepcionHpLife(
        cuerpo=cuerpo, recibo=recibo, captura=captura, inicio_utc=dato["inicio_utc"], content_type=dato["content_type"]
    )
