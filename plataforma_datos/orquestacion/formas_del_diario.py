"""Formas cerradas que comparten el diario del supervisor, su resumen y el almacén privado que los guarda.

No depende de ningún otro módulo: así lo pueden importar a la vez quien escribe el diario, quien lo resume y
quien comprueba las claves del almacén, sin ciclos.
"""

import re
from collections.abc import Callable

OPERACIONES = ("ejecutar", "reanudar", "activar", "recuperar", "reconciliar")
# Por qué el parte de salud del resumen no se pudo calcular; el diario lo anota con la misma palabra.
MOTIVOS_NO_CALCULADO = ("sin-almacen", "almacen-ilegible")
# Causas que el supervisor anota con su propio código, además de las de cada etapa de fuente.
CAUSAS_DEL_DIARIO = (
    "almacen-no-disponible",
    # El almacén respondió que el objeto pedido no existe (404): no es una indisponibilidad y no se reintenta.
    "objeto-ausente",
    "integridad-generacion",
    "censo-cibernarium-no-reproducible",
    "archivo-ediciones-ausente",
    "entrada-salida",
    "comprobacion-fallida",
    "proyeccion-no-verificable",
    "inventario-no-verificable",
    "fin-anterior-al-inicio",
    "diario-no-resumible",
    "almacen-no-confirmado",
    "base-no-verificable",
    "referencia-en-conflicto",
    # El motor no empezó un paso porque lo que quedaba hasta su hora límite no cubría el paquete.
    "plazo-insuficiente",
    # El motor murió por una señal o terminó sin recibo (`fin_del_motor`).
    "motor-terminado-por-senal",
    "motor-sin-recibo",
    *MOTIVOS_NO_CALCULADO,
)
# Única causa que una etapa de fuente puede llevar al diario; cualquier otra se anota como etapa rechazada.
CAUSA_DE_ETAPA = re.compile(
    r"http-[45][0-9]{2}|etapa-rechazada|certificado-no-verificable|plazo-agotado|proceso-no-disponible|"
    r"evidencias-ediciones-incompletas|pagina-de-comprobacion"
)
# Identificador que la fuente da a un curso; si no tiene esta forma, el diario guarda su SHA-256.
ID_CURSO = re.compile(r"[a-z0-9][A-Za-z0-9:._-]{0,160}")
CURSO = re.compile(rf"(?:edicion|recurso)/{ID_CURSO.pattern}")
MAX_RESUMEN = 64 * 1024
# La ejecución lleva 16 cifras para que el orden de las claves sea el de las ejecuciones.
CLAVE_RESUMEN = re.compile(rf"diarios-resumen/[0-9]{{16}}/[1-9][0-9]{{0,15}}/(?:{'|'.join(OPERACIONES)})\.json")


def es_causa(valor: str) -> bool:
    """Indica si una causa pertenece a la lista cerrada del diario.

    Returns:
        Verdadero si es una causa del supervisor o de una etapa de fuente.
    """
    return valor in CAUSAS_DEL_DIARIO or CAUSA_DE_ETAPA.fullmatch(valor) is not None


# Forma cerrada del bloque `salud` del resumen (versión 2): el parte de cómo está la base de datos ese día. Solo lleva
# identificadores y recuentos: ningún título de curso ni dato personal.
NOMBRE = re.compile(r"[a-z][a-z0-9-]{0,47}")
FUENTE_DE_SALUD = re.compile(r"[a-z0-9]+(?:[_-][a-z0-9]+)*")
AMBITO_DE_SALUD = re.compile(r"[a-z0-9]+(?:[_:-][a-z0-9]+)*")
# El veredicto del día sale solo de lo observado en este ciclo; «sana-parcial» dice que las fuentes con lectura están
# sanas pero otras aún no registran o no se leyeron, y «no-calculado» que el parte no se pudo componer.
VEREDICTOS_DE_SALUD = ("sana", "sana-parcial", "anomala", "sin-lectura", "sin-observaciones", "no-calculado")
# «lee»: dejó lectura en este ciclo; «sin-lectura»: se leyó y no dejó lectura; «no-registra-todavia»: su adquisición
# aún no emite lecturas; «no-leida»: este ciclo no la descargó.
REGISTROS_DE_FUENTE = ("lee", "sin-lectura", "no-registra-todavia", "no-leida")
ESTADOS_DE_LECTURA = ("sana", "anomala", "incompleta", "reconstruida")
MOTIVOS_DE_LECTURA = (
    "forma_cambiada",
    "total_declarado_distinto",
    "valor_desconocido",
    "salidas_no_explicadas_en_bloque",
)
MOTIVOS_DE_CENSO_INCOMPLETO = ("sin_censo", "consulta_fallida", "limite_alcanzado")
EXPLICACIONES_DE_SALIDA = ("fin_publicado", "fuente_declara_baja")
GRUPOS_DE_RETIRADA = ("fuente", "censo_y_pagina", "censo_repetido")
ESTADOS_DEL_ERROR = ("medido", "sin-retiradas-comprobables", "sin-medida")
NATURALEZA_DEL_ERROR = "limite_inferior"
MAX_RECUENTO = 2**53 - 1


def _de(admitidos: tuple[str, ...], *, o_nulo: bool = False) -> Callable[[object], bool]:
    return lambda valor: (valor is None and o_nulo) or (isinstance(valor, str) and valor in admitidos)


def _patron(patron: re.Pattern[str], *, o_nulo: bool = False) -> Callable[[object], bool]:
    return lambda valor: (valor is None and o_nulo) or (isinstance(valor, str) and patron.fullmatch(valor) is not None)


def _entero(valor: object) -> bool:
    return type(valor) is int and 0 <= valor <= MAX_RECUENTO


def _entero_o_nulo(valor: object) -> bool:
    return valor is None or _entero(valor)


def _proporcion(valor: object) -> bool:
    return valor is None or (type(valor) is float and 0 <= valor <= 1)


def _causa_o_nula(valor: object) -> bool:
    return valor is None or (isinstance(valor, str) and es_causa(valor))


def _objeto(esquema: dict[str, Callable[[object], bool]]) -> Callable[[object], bool]:
    return lambda valor: (
        isinstance(valor, dict) and valor.keys() == esquema.keys() and all(p(valor[c]) for c, p in esquema.items())
    )


def _lista(prueba: Callable[[object], bool]) -> Callable[[object], bool]:
    return lambda valor: isinstance(valor, list) and all(prueba(elemento) for elemento in valor)


_LECTURA = _objeto(
    {
        "ambito": _patron(AMBITO_DE_SALUD),
        "estado": _de(ESTADOS_DE_LECTURA),
        "motivos": _lista(_de(MOTIVOS_DE_LECTURA)),
        "motivoIncompleta": _de(MOTIVOS_DE_CENSO_INCOMPLETO, o_nulo=True),
        "bruto": _entero,
        "vigente": _entero,
        "declarado": _entero_o_nulo,
        "entradas": _entero,
        "salidasExplicadas": _objeto(dict.fromkeys(EXPLICACIONES_DE_SALIDA, _entero)),
        "salidasSinExplicar": _entero,
        "valoresNuevos": _entero,
        "formaCambiada": lambda valor: type(valor) is bool,
    }
)
_DECISIONES = _objeto(
    {
        "registros": _entero,
        "retirar": _objeto(dict.fromkeys(GRUPOS_DE_RETIRADA, _entero)),
        "pendientes": _entero,
        "mantenidas": _entero,
    }
)
_ERROR = _objeto(
    {
        "estado": _de(ESTADOS_DEL_ERROR),
        "retiradas": _entero,
        "comprobables": _entero,
        "reaparecidas": _entero,
        "tasa": _proporcion,
        "cota95": _proporcion,
        "naturaleza": _de((NATURALEZA_DEL_ERROR,)),
    }
)
_FUENTE = _objeto(
    {
        "fuente": _patron(FUENTE_DE_SALUD),
        "registro": _de(REGISTROS_DE_FUENTE),
        "descarga": _objeto({"estado": _patron(NOMBRE, o_nulo=True), "causa": _causa_o_nula}),
        "estado": _de(ESTADOS_DE_LECTURA, o_nulo=True),
        "lecturas": _lista(_LECTURA),
        "decisiones": _DECISIONES,
        "error": _ERROR,
    }
)
_SALUD = _objeto(
    {
        "veredicto": _de(VEREDICTOS_DE_SALUD),
        "motivo": _de(MOTIVOS_NO_CALCULADO, o_nulo=True),
        "cuenta": _objeto(dict.fromkeys(("sanas", "anomalas", "sinLectura", "noRegistran", "noLeidas"), _entero)),
        "fuentes": _lista(_FUENTE),
    }
)


def es_salud_valida(salud: object) -> bool:
    """Indica si un bloque `salud` tiene exactamente la forma cerrada del resumen.

    Returns:
        Verdadero si los campos son los del contrato y cada uno tiene su forma; falso en otro caso.
    """
    return _SALUD(salud)


# Detalle de un paso que falla, para que ningún fallo quede a ciegas: el nombre de la clase de la excepción y el de la
# que la provocó, el paso donde ocurrió, los últimos lugares del código propio por los que pasó, el plazo si se agotó
# y, si nadie la esperaba, su mensaje saneado. Va solo al diario privado; el resumen no lo copia.
TIPO_DE_ERROR = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
# Un lugar es el módulo con puntos y la línea, nunca la ruta del archivo en la máquina que ejecuta.
LUGAR = re.compile(r"plataforma_datos(?:\.[a-z_][a-z0-9_]{0,63}){1,6}:[1-9][0-9]{0,5}")
MAX_LUGARES = 3
MAX_MENSAJE = 200
# Sin comillas, barras, arrobas, signos de igual ni caracteres de control: así no caben rutas, direcciones, correos,
# pares clave=valor ni los valores que Python cita entre comillas.
MENSAJE = re.compile(rf"[^\x00-\x1f\x7f'\"/\\@=]{{1,{MAX_MENSAJE}}}")
_DETALLE_DE_ERROR: dict[str, Callable[[object], bool]] = {
    "tipo": _patron(TIPO_DE_ERROR),
    "origen": _patron(TIPO_DE_ERROR),
    "pasoDeOrigen": _patron(NOMBRE),
    "lugares": lambda valor: isinstance(valor, list) and len(valor) <= MAX_LUGARES and _lista(_patron(LUGAR))(valor),
    "mensaje": _patron(MENSAJE),
    "plazoSegundos": _entero,
}
_CAMPOS_OBLIGADOS_DEL_DETALLE = frozenset({"tipo", "pasoDeOrigen", "lugares"})


def tipo_de_error(error: BaseException) -> str:
    """Nombra la clase de una excepción con la forma cerrada del diario.

    Una clase con un nombre fuera de la forma (con tildes, por ejemplo) se nombra por la más cercana de sus clases
    base que sí la tiene: sigue siendo verdad y nunca deja una nota sin tipo.

    Returns:
        El nombre de la clase o el de su base más cercana con la forma de `TIPO_DE_ERROR`.
    """
    return next(clase.__name__ for clase in type(error).__mro__ if TIPO_DE_ERROR.fullmatch(clase.__name__))


def es_detalle_de_error(detalle: object) -> bool:
    """Indica si el detalle de un error tiene exactamente su forma cerrada.

    Returns:
        Verdadero si lleva sus campos obligados, ninguno ajeno, y cada uno con su forma; falso en otro caso.
    """
    return (
        isinstance(detalle, dict)
        and _CAMPOS_OBLIGADOS_DEL_DETALLE <= detalle.keys() <= _DETALLE_DE_ERROR.keys()
        and all(_DETALLE_DE_ERROR[campo](valor) for campo, valor in detalle.items())
    )
