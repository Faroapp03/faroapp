"""La EPA con que se contrasta cada edición: la de su año, o la del anterior mientras Eurostat no publique la suya.

Eurostat publica `lfsa_egai2d` después de la encuesta. En cada consulta se pide la EPA del año de la edición
(`time=<año>`). Si la respuesta es el JSON-stat de la tabla con cifras, es el original. Si no, la consulta sigue con la
EPA del año declarado en el estado de la edición (`epa_anio`) y el sondeo queda en la procedencia del año
(`epa_sondeo`, con su dirección y, si hubo respuesta, su huella), con un resultado cerrado: «sin-el-anio» (el JSON-stat
de la tabla, sin cifras), «respuesta-no-verificable» (otra cosa) o «fallido» (no llegó una respuesta entera y
verificable: la red falló, la respuesta se cortó, superó el límite de descarga o su transporte no se pudo verificar; no
tumba la consulta). El
año que se usó queda en la procedencia del año y en el dato; cuando Eurostat publica el año, la siguiente consulta lo
descarga, la preparación lo usa y la validación lo registra en el estado al admitir el conjunto: es un estado observado,
que no retira la edición. La EPA se localiza entre los originales por su nombre.
"""

import http.client
import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, Literal

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import ahora_utc, sha256_bytes
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    EntradaDeDescarga,
    FormatoInesperado,
    ReglaDeCambio,
)
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import EPA_DATASET

type Resultado = Literal["con-valores", "sin-el-anio", "respuesta-no-verificable"]


def leer_respuesta(datos: bytes) -> Resultado:
    """Qué es una respuesta de Eurostat a la EPA de un año.

    Returns:
        «con-valores» si es el JSON-stat de la tabla con alguna cifra; «sin-el-anio» si lo es sin cifras;
        «respuesta-no-verificable» si no es el JSON-stat de la tabla.
    """
    try:
        documento = json.loads(datos)
    except ValueError:
        return "respuesta-no-verificable"
    valores = documento.get("value") if isinstance(documento, dict) else None
    extension = documento.get("extension") if isinstance(documento, dict) else None
    if not isinstance(extension, dict) or extension.get("id") != EPA_DATASET or not isinstance(valores, (dict, list)):
        return "respuesta-no-verificable"
    cifras = valores.values() if isinstance(valores, dict) else valores
    return "con-valores" if any(valor is not None for valor in cifras) else "sin-el-anio"


def _la_epa(edicion: Mapping[str, Any], epa_anio: str) -> ArchivoDescargable:
    """La EPA de un año entre los originales de la edición, por su nombre.

    Returns:
        Su archivo descargable.
    """
    con_ese_anio = {**edicion, "epa_anio": epa_anio}
    nombre = estado.nombres(con_ese_anio).epa
    return next(archivo for archivo in estado.archivos(con_ese_anio) if archivo["archivo"] == nombre)


type Declarada = Callable[[ArchivoDescargable], EntradaDeDescarga]


def descargar(
    edicion: Mapping[str, Any], carpeta: Path, aceptar_cambio: bool, declarada: Declarada | None = None
) -> tuple[EntradaDeDescarga, str, dict[str, Any]]:
    """La EPA de la edición: la de su año si Eurostat la publica; si no, la del año declarado en el estado.

    Args:
        edicion: La edición admitida o la candidata.
        carpeta: La carpeta de originales de su año.
        aceptar_cambio: Si se acepta una versión nueva de un original ya registrado.
        declarada: Cómo se obtiene la EPA del año declarado; por omisión, se descarga. La candidata la copia de la
            admitida, que la acaba de descargar en la misma consulta: así no se pide dos veces el mismo recurso.

    Returns:
        El registro del original, el año de la EPA que se usa y, si se sondeó el año, `epa_sondeo`.
    """
    usada = _la_epa(edicion, edicion["epa_anio"])
    obtener = declarada or (lambda archivo: red.descargar_originales([archivo], carpeta, aceptar_cambio)[0])
    if edicion["epa_anio"] == edicion["anio"]:
        return obtener(usada), edicion["epa_anio"], {}
    del_anio = _la_epa(edicion, edicion["anio"])
    sondeo: dict[str, Any] = {"anio": edicion["anio"], "url": del_anio["url"], "consultado_utc": ahora_utc()}
    try:
        descarga = red.descargar_url(del_anio["url"])
    except (OSError, FormatoInesperado, http.client.HTTPException) as error:
        # FormatoInesperado recoge el límite de descarga (LimiteDescargaExcedido) y un transporte no verificable.
        sondeo |= {"resultado": "fallido", "detalle": f"{type(error).__name__}: {error}"}
    else:
        resultado = leer_respuesta(descarga.datos)
        if resultado == "con-valores":
            previo = red.registros_previos(carpeta / ARCHIVO_DE_PROCEDENCIA).get(del_anio["archivo"])
            regla = ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio)
            datos = red.conservar_o_sustituir(carpeta / del_anio["archivo"], descarga, regla)
            observar_original(del_anio["url"], descarga, datos)
            return red.registro_descarga(del_anio, descarga, datos, previo), edicion["anio"], {}
        sondeo |= {"resultado": resultado, "sha256": sha256_bytes(descarga.datos)}
    return obtener(usada), edicion["epa_anio"], {"epa_sondeo": sondeo}


def originales_de_la_edicion(
    edicion: Mapping[str, Any], carpeta: Path, aceptar_cambio: bool, declarada: Declarada | None = None
) -> tuple[list[EntradaDeDescarga], str, dict[str, Any]]:
    """Los originales de la edición, en el orden de su contrato, con la EPA que haya, localizada por su nombre.

    Returns:
        Los registros, el año de la EPA que se usa y, si se sondeó el año, `epa_sondeo`.
    """
    nombre_epa = estado.nombres(edicion).epa
    registros: list[EntradaDeDescarga] = []
    epa_anio, sondeo = edicion["epa_anio"], {}
    for archivo in estado.archivos(edicion):
        if archivo["archivo"] == nombre_epa:
            registro, epa_anio, sondeo = descargar(edicion, carpeta, aceptar_cambio, declarada)
        else:
            registro = red.descargar_originales([archivo], carpeta, aceptar_cambio)[0]
        registros.append(registro)
    return registros, epa_anio, sondeo


def con_la_epa_descargada(admitida: estado.Edicion, original: Path) -> estado.Edicion:
    """La edición admitida con el año de la EPA que registró la última descarga en la procedencia de su año.

    Returns:
        La edición con ese `epa_anio`; sin registro, el del estado.
    """
    epa_anio = estado.procedencia_del_anio(admitida, original).get("epa_anio", admitida["epa_anio"])
    return estado.valida({**admitida, "epa_anio": epa_anio})
