"""Controles del almacén privado escritos con condición y confirmados por una lectura exacta.

Un control (la referencia de mantenimiento, el índice de un trabajo, un diario archivado) se escribe con un PUT
condicionado y solo cuenta como escrito cuando una lectura posterior devuelve exactamente sus bytes. Distinguir un
almacén que no respondió de otro valor ya confirmado decide si quien escribe puede repetir o debe detenerse.
"""

from typing import Protocol

from plataforma_datos.orquestacion.almacen_s3 import ERROR_DISPONIBILIDAD, AlmacenS3NoDisponible
from plataforma_datos.orquestacion.contrato_de_trabajos import ERROR, AlmacenTrabajoInvalido

MAX_CONTROL_BYTES = 8192


class ConflictoReferencia(AlmacenTrabajoInvalido):
    """Otro valor confirmado impide avanzar esta referencia; nunca se revierte."""


class AlmacenDeControles(Protocol):
    """Lectura y escritura condicionada de los controles cerrados del almacén."""

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee íntegro y acotado; None significa exclusivamente objeto inexistente, no fallo de transporte."""
        ...

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """PUT condicional: None crea con IfNoneMatch; ETag compara con IfMatch; False solo ante 412."""
        ...


def escribir_confirmado(clave: str, contenido: bytes, etag: str | None, almacen: AlmacenDeControles) -> None:
    """Escribe un control condicionalmente: crea si `etag` es None y, si no, exige ese ETag (If-Match).

    Una respuesta perdida no implica fallo de la escritura; solo la lectura exacta posterior la confirma. Si el almacén
    no respondió y la lectura no muestra esos bytes, no hay conflicto que afirmar: el almacén no estaba disponible, y
    quien escribe puede repetir (`diario_mantenimiento.conservar_con_reintento`).

    Raises:
        AlmacenS3NoDisponible: Si el almacén no respondió a la escritura y la clave no contiene esos bytes.
        ConflictoReferencia: Si la escritura respondió y la clave no contiene exactamente esos bytes.
    """
    sin_respuesta: AlmacenS3NoDisponible | None = None
    try:
        almacen.guardar_control(clave, contenido, etag)
    except AlmacenS3NoDisponible as error:
        sin_respuesta = error
    except OSError:
        # Otra respuesta incierta: la lectura decide igual, y sin ella el resultado es un conflicto.
        pass
    lectura = almacen.leer_control(clave, MAX_CONTROL_BYTES)
    if lectura is not None and lectura[0] == contenido:
        return
    if sin_respuesta is not None:
        raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from sin_respuesta
    raise ConflictoReferencia(ERROR)
