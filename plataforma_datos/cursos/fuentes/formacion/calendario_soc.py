"""Las fechas de un curso del SOC tal como Faro las entiende, las mismas para su preparación y para su lectura.

El SOC publica las fechas en mes/día/año. Una pareja de fechas que se contradice (el fin antes del inicio) no dice
cuándo empieza ni cuándo acaba el curso: las dos quedan por confirmar y se anota la causa.
"""

from datetime import datetime


def fecha_iso_desde_mdy(fecha: str) -> str | None:
    """Convierte una fecha del SOC (mes/día/año) al formato ISO.

    Args:
        fecha: Fecha tal como la publica el SOC, o vacía.

    Returns:
        La fecha en formato AAAA-MM-DD, o `None` si no consta.
    """
    if not fecha:
        return None
    return datetime.strptime(fecha, "%m/%d/%Y").date().isoformat()


def calendario_curso(registro: dict[str, str]) -> dict[str, str | None]:
    """Interpreta las fechas publicadas para una edición.

    Returns:
        Sus fechas ISO o, si se contradicen, dos valores desconocidos y la causa para la auditoría.
    """
    inicio = fecha_iso_desde_mdy(registro["data_inici"])
    fin = fecha_iso_desde_mdy(registro["data_fi"])
    if inicio and fin and fin < inicio:
        return {"inicio": None, "fin": None, "incidencia_calendario": "fin-anterior-al-inicio"}
    return {"inicio": inicio, "fin": fin}
