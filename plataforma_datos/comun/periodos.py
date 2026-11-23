"""Meses del calendario en castellano y catalán y periodos de doce meses.

Las conversiones y los rótulos reciben meses válidos, en las formas indicadas por cada función.
"""

import re

MESES_ES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
            "noviembre", "diciembre")  # fmt: skip
MESES_CA = ("gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre",
            "desembre")  # fmt: skip
# En catalán, «de» ante vocal (o hache y vocal) se apostrofa: «d’abril», «d’agost», «d’octubre» (ortografía del IEC).
# Con el apóstrofo tipográfico (’) y «del» ante el año, como el módulo de fechas de la app (src/comun/fechas.js).
_DE_ANTE_VOCAL = re.compile(r"\bde (?=h?[aeiouàèéíïòóúü])", re.IGNORECASE)


def mes_de(periodo: str) -> int:
    """Convierte un periodo AAAA-MM (2026-06) al entero AAAAMM del Observatori (202606).

    Returns:
        El periodo como número AAAAMM.
    """
    return int(periodo.replace("-", ""))


def mes_iso(mes: int) -> str:
    """Un mes del visor (202606) como mes ISO (2026-06).

    Returns:
        El mes como texto AAAA-MM.
    """
    return f"{str(mes)[:4]}-{str(mes)[4:]}"


def mes_anterior(periodo: str, meses: int) -> str:
    """El mes AAAA-MM que queda `meses` antes de otro.

    Returns:
        El mes resultante, como texto AAAA-MM.
    """
    anio, mes = (int(parte) for parte in periodo.split("-"))
    total = anio * 12 + mes - 1 - meses
    return f"{total // 12}-{total % 12 + 1:02d}"


def rotulo_de_doce_meses(periodo: str, meses: tuple[str, ...], plantilla: str) -> str:
    """Escribe el rótulo de los 12 meses que terminan en `periodo`: «de julio de 2025 a junio de 2026».

    En catalán (`meses` es MESES_CA), el año va tras «del», y «de» ante un mes que empieza por vocal se apostrofa,
    también el de la plantilla: «d’abril del 2025 a març del 2026».

    Args:
        periodo: El último mes, AAAA-MM.
        meses: Los nombres de los meses, MESES_ES o MESES_CA.
        plantilla: El rótulo con `{inicio}` y `{fin}`.

    Returns:
        El rótulo, con la plantilla rellena con el primer y el último mes.
    """

    def nombre(mes: str) -> str:
        """«julio de 2025» (en catalán, «juliol del 2025») para un mes AAAA-MM.

        Returns:
            El nombre del mes seguido de «de» (en catalán, «del») y el año.
        """
        return f"{meses[int(mes[5:]) - 1]} {'del' if meses == MESES_CA else 'de'} {mes[:4]}"

    rotulo = plantilla.format(inicio=nombre(mes_anterior(periodo, 11)), fin=nombre(periodo))
    return _DE_ANTE_VOCAL.sub("d’", rotulo) if meses == MESES_CA else rotulo
