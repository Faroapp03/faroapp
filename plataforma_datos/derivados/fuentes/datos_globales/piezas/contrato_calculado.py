"""Las cifras calculadas de `datos-globales.json` (bloque `calculados`, «calculado»): la forma de cada cifra por país.

Una cifra calculada lleva su intervalo de confianza del 95 % con su método; un valor dentro del intervalo y sin cotas,
o null con sus cotas (inferior < superior, dentro del intervalo), su motivo y la parte del empleo sin correspondencia;
su año, su encuesta, su licencia, su cita y una dirección https. La cabecera de cada indicador la comprueba el
contrato (`contrato_datos_globales.py`). Python estándar.
"""

from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    METODOS_DEL_INTERVALO,
    MOTIVOS_DE_LAS_COTAS,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_comun import (
    ISO3,
    es_anio,
    es_numero,
    texto_doble,
)

CLAVES_DEL_VALOR_CALCULADO = (
    "territorio",
    "nombre",
    "valor",
    "intervalo",
    "cotas",
    "anio",
    "encuesta",
    "licencia",
    "cita",
    "url",
)
# Tope de un porcentaje: las cifras y las partes del empleo van de 0 a 100.
PORCENTAJE_MAXIMO = 100
CLAVES_DEL_INTERVALO = ("desde", "hasta", "metodo")
CLAVES_DE_LAS_COTAS = ("inferior", "superior", "motivo", "parte_sin_correspondencia")


def cotas_validas(cotas: object, desde: object, hasta: object) -> bool:
    """Si las cotas tienen su forma, inferior < superior dentro del intervalo, su motivo y la parte del empleo.

    Returns:
        `True` si las cotas cumplen el contrato; `False` si falta o sobra algo.
    """
    if not (isinstance(cotas, dict) and tuple(cotas) == CLAVES_DE_LAS_COTAS):
        return False
    inferior, superior, parte = cotas["inferior"], cotas["superior"], cotas["parte_sin_correspondencia"]
    return (
        all(es_numero(cifra) for cifra in (inferior, superior, parte, desde, hasta))
        and desde <= inferior < superior <= hasta
        and cotas["motivo"] in MOTIVOS_DE_LAS_COTAS
        and 0 < parte <= PORCENTAJE_MAXIMO
    )


def problemas_del_valor_calculado(nombre: str, valor: object) -> list[str]:
    """Lo que no cumple el contrato en una cifra calculada: intervalo y método, valor o cotas, año, encuesta y cita.

    Returns:
        Un texto por incumplimiento; vacía si la cifra cumple el contrato.
    """
    if not isinstance(valor, dict) or tuple(valor) != CLAVES_DEL_VALOR_CALCULADO:
        return [f"{nombre}: valor calculado con otras claves: {valor!r:.80}"]
    intervalo, cifra = valor["intervalo"], valor["valor"]
    con_forma = isinstance(intervalo, dict) and tuple(intervalo) == CLAVES_DEL_INTERVALO
    desde, hasta = (intervalo["desde"], intervalo["hasta"]) if con_forma else (None, None)
    numeros = es_numero(desde) and es_numero(hasta)
    reglas = {
        "país por su ISO 3166-1 alfa-3": bool(ISO3.fullmatch(str(valor["territorio"]))),
        "nombre del país en castellano y en catalán": texto_doble(valor["nombre"]),
        "intervalo del 95 % con su método": con_forma
        and isinstance(intervalo["metodo"], str)
        and intervalo["metodo"] in METODOS_DEL_INTERVALO,
        "intervalo dentro de [0, 100] y no invertido": numeros and 0 <= desde <= hasta <= PORCENTAJE_MAXIMO,
        "una cifra dentro de su intervalo y sin cotas, o null con sus cotas": (
            es_numero(cifra) and numeros and desde <= cifra <= hasta and valor["cotas"] is None
        )
        or (cifra is None and cotas_validas(valor["cotas"], desde, hasta)),
        "año entero": es_anio(valor["anio"]),
        "encuesta, licencia y cita": all(
            isinstance(valor[campo], str) and valor[campo] for campo in ("encuesta", "licencia", "cita")
        ),
        "dirección https": str(valor["url"]).startswith("https://"),
    }
    return [f"{nombre} · {valor['territorio']}: {regla}" for regla, cumple in reglas.items() if not cumple]
