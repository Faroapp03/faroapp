"""Ayudas de las pruebas de `empresas`: el recorte real del calendario del INE (test_calendario_ine) y sus fechas."""

from unittest import mock

from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine
from plataforma_datos.mercado.pruebas.ayuda_productores import RECORTES

CUERPO = (RECORTES / "ine-calendario-recorte.ics").read_bytes()
# El tipo con que el INE sirve el calendario.
CABECERA = "Content-Type: text/Calendar;charset=UTF8\r\n"
# El instante real de la captura del recorte (15/11/2026 a las 00:40 en Barcelona).
CONSULTA = "2026-11-14T23:40:38+00:00"


def fechas_del_recorte() -> mock._patch:
    """Un parche de `calendario_ine.capturadas` que lee las fechas del recorte, consultado el día de la captura.

    Returns:
        El parche, sin empezar.
    """
    texto = CUERPO.decode("utf-8")
    return mock.patch.object(
        calendario_ine, "capturadas", side_effect=lambda anio: calendario_ine.fechas(texto, CONSULTA, anio)
    )
