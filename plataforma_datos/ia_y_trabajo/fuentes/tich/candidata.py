"""La edición nueva como candidata: su preparación aparte, su validación y lo que la detiene.

Una edición nueva pendiente de incorporar, con sus tablas localizadas (navegacion.py) y sus originales descargados en
la carpeta de su año, es la candidata: la procedencia de la operación la registra aparte de la admitida
(`candidata`, con su edición y sus archivos). La preparación la calcula como a la admitida, con los mismos pasos, y
además lee sus documentos: las secciones en muestra de su metodología y el enunciado de su cuestionario, por partes
(documentos_de_la_edicion.py). Lo preparado queda en `preparados/tich/candidata/`, junto con las huellas de los
originales de que sale. La validación la contrasta con los mismos controles que a la admitida:

- si los pasa todos, su conjunto es el publicado, con la serie de años que mide; el estado de la edición pasa a ella,
  con sus secciones y las huellas de sus documentos, y la procedencia de la operación registra sus originales y retira
  la observación de la edición nueva, que ya es la admitida;
- si no, lo publicado sigue siendo la edición admitida, y el informe de validación y el panel dicen que la nueva está
  detenida («detenida-por-controles»), con un motivo de lista cerrada (`MOTIVOS`): «enunciado-distinto», si una
  parte del enunciado de `IAG` o `IAG_TRAB` (pregunta, periodo, opciones o códigos) no es la de la serie, con las
  partes que difieren; «tablas», si no se pudieron localizar o descargar sus tablas, documentos u originales;
  «controles», si otro control no pasa.

Nada se decide por fecha ni por plazo: la edición nueva se incorpora solo cuando está observada con sus microdatos,
navegada, descargada, con su enunciado comprobado y validada.
"""

import csv
import http.client
import traceback
import zlib
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any, Literal, TypedDict

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import (
    escribir_bytes_entero,
    guardar_json,
    leer_json,
    original,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ERRORES_CON_MOTIVO,
    ArchivoDescargable,
    ArchivoFaltante,
    Controles,
    EntradaDeDescarga,
    ErrorFuente,
    FormatoInesperado,
    HuellaIncorrecta,
    exigir,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich import epa_por_anio
from plataforma_datos.ia_y_trabajo.fuentes.tich.clases_de_ocupacion import control_de_los_cambios_de_clase
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    FUENTE,
    ORIGINAL,
    PREPARADO,
    cita,
    documentos_del_anio,
    nombre_fuente,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.documentos_de_la_edicion import (
    PARTES,
    EnunciadoDistinto,
    leer_documentos,
    partes_distintas,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion_nueva import PENDIENTE, anios_medidos_validos

DETENIDA: Literal["detenida-por-controles"] = "detenida-por-controles"
type Motivo = Literal["enunciado-distinto", "tablas", "controles"]
MOTIVOS: tuple[Motivo, ...] = ("enunciado-distinto", "tablas", "controles")
PREPARADA = PREPARADO / "candidata" / "candidata.json"
# Lo que lanza leer un original dañado de la candidata: un .zip ilegible (BadZipFile), con el flujo comprimido corrupto
# (zlib.error) o truncado (EOFError), un TSV mal formado (csv.Error), un JSON o un texto ilegibles (ValueError) o sin
# una clave. Detiene la candidata, nunca la edición admitida.
ERRORES_DE_UN_ORIGINAL_DANADO = (*ERRORES_CON_MOTIVO, ValueError, KeyError, zlib.error, EOFError, csv.Error)
# Lo que la procedencia de la operación registra de la edición nueva mientras no es la admitida.
DE_LA_EDICION_NUEVA = (
    "edicion_nueva",
    "edicion_nueva_descartada",
    "captura_edicion_nueva",
    "tablas_edicion_nueva",
    "tablas_edicion_nueva_detenida",
    "candidata",
    "candidata_detenida",
)

type PrepararEdicion = Callable[
    [Mapping[str, Any], Callable[[dict[str, Any]], dict[str, Any]]], tuple[dict[str, Any], dict[str, Any]]
]
type Validacion = Callable[
    [dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]], tuple[Controles, dict[str, Any], dict[str, Any]]
]


class Base(TypedDict):
    """La candidata antes de leer sus documentos: año, años que mediría el dato, tablas y año de la EPA."""

    anio: str
    anios_medidos: list[str]
    tablas: estado.Tablas
    epa_anio: str


class Incorporada(TypedDict):
    """La candidata que pasa todos sus controles: su validación, su conjunto y su edición completa."""

    controles: Controles
    informe: dict[str, Any]
    conjunto: dict[str, Any]
    edicion: estado.Edicion


def base_valida(objeto: object) -> Base:
    """Exige la forma de la candidata antes de leer sus documentos, con las mismas reglas que el estado de la edición.

    Returns:
        La candidata, copiada.

    Raises:
        FormatoInesperado: Si le falta o le sobra un campo, o si sus años o tablas no tienen su forma.
    """
    exigir(
        isinstance(objeto, dict) and set(objeto) == set(Base.__annotations__),
        "TIC-H: la candidata registrada no tiene la forma esperada",
    )
    # Las secciones y huellas de la primera solo completan la forma para exigirla: la base aún no ha leído las suyas.
    primera = estado.primera()
    completa = estado.valida({**objeto, "secciones": primera["secciones"], "documentos": primera["documentos"]})
    return {
        "anio": completa["anio"],
        "anios_medidos": completa["anios_medidos"],
        "tablas": completa["tablas"],
        "epa_anio": completa["epa_anio"],
    }


def detencion(motivo: Motivo, detalle: str, partes: Iterable[str] = ()) -> dict[str, Any]:
    """Una detención de la candidata, con su motivo cerrado, su detalle y, si el enunciado es distinto, sus partes.

    Returns:
        `{"motivo", "detalle"}` y, con «enunciado-distinto», `partes` (de `PARTES`, en su orden).

    Raises:
        FormatoInesperado: Si el motivo no es de la lista, o las partes no van con «enunciado-distinto».
    """
    pedidas = set(partes)
    lista = [parte for parte in PARTES if parte in pedidas]
    exigir(
        motivo in MOTIVOS and (motivo == "enunciado-distinto") == bool(lista) and len(lista) == len(pedidas),
        f"TIC-H: detención mal formada: {motivo!r} con {sorted(pedidas)!r}",
    )
    return {"motivo": motivo, "detalle": detalle, **({"partes": lista} if lista else {})}


def de_la_procedencia(procedencia: Mapping[str, Any]) -> Base | None:
    """La candidata que registra la procedencia de la operación, si sigue observada como pendiente de incorporar.

    Returns:
        Su base, o None si no hay candidata o no es la edición nueva observada.
    """
    candidata, nueva = procedencia.get("candidata"), procedencia.get("edicion_nueva")
    if candidata is None or not isinstance(nueva, dict) or nueva.get("estado") != PENDIENTE:
        return None
    base = base_valida(candidata["edicion"])
    return base if base["anio"] == nueva["anio"] else None


def detenida_al_descargar(procedencia: Mapping[str, Any]) -> dict[str, Any] | None:
    """La detención que ya registró la consulta: tablas o documentos no localizados, u originales no descargados.

    Returns:
        La detención («tablas»), o None.
    """
    nueva = procedencia.get("edicion_nueva")
    if not isinstance(nueva, dict) or nueva.get("estado") != PENDIENTE:
        return None
    for clave in ("tablas_edicion_nueva_detenida", "candidata_detenida"):
        registrada = procedencia.get(clave)
        if isinstance(registrada, dict) and registrada.get("anio") == nueva["anio"]:
            return detencion("tablas", f"{registrada.get('motivo')}: {registrada.get('detalle')}")
    return None


def _copia_de_la_admitida(
    admitida: estado.Edicion, registros: list[EntradaDeDescarga], original_de_la_fuente: Path, carpeta: Path
) -> epa_por_anio.Declarada:
    """La EPA del año declarado para la candidata: la copia de la que la admitida acaba de descargar.

    Returns:
        La función que copia el archivo comprobando su huella y devuelve su registro, con `copia_de`.
    """

    def copiar(archivo: ArchivoDescargable) -> EntradaDeDescarga:
        registro = next((r for r in registros if r["archivo"] == archivo["archivo"]), None)
        if registro is None:
            raise FormatoInesperado(f"TIC-H: la admitida no descargó {archivo['archivo']} en esta consulta")
        datos = (estado.carpeta(admitida, original_de_la_fuente) / archivo["archivo"]).read_bytes()
        exigir(sha256_bytes(datos) == registro["sha256"], f"TIC-H: {archivo['archivo']} no conserva su huella")
        escribir_bytes_entero(carpeta / archivo["archivo"], datos)
        copiado: EntradaDeDescarga = {**registro}
        copiado["copia_de"] = f"{admitida['anio']}/{archivo['archivo']}"  # type: ignore[typeddict-unknown-key]
        return copiado

    return copiar


def descargar(
    tablas: Mapping[str, Any],
    admitida: estado.Edicion,
    registros_admitidos: list[EntradaDeDescarga],
    original_de_la_fuente: Path,
) -> dict[str, Any]:
    """Los originales y los documentos de la candidata en la carpeta de su año, con su procedencia.

    Solo hay candidata cuando la edición nueva se navegó entera (`tablas_edicion_nueva`, con sus tablas y sus dos
    documentos). Baja sus microdatos, sus dos tablas, su EPA (la de su año si Eurostat la publica; si no, la del año
    declarado, copiada de la admitida) y su metodología y su cuestionario. En cada consulta se piden todos otra vez y
    se aceptan los bytes nuevos con su huella nueva: la candidata no es lo publicado, y si el INE corrige un original en
    la misma dirección, el intento siguiente lo ve. Un fallo no tumba la consulta: deja la candidata detenida con motivo
    «tablas», su detalle y las peticiones hechas hasta el fallo (`archivos`, y `epa_sondeo` si el sondeo de la EPA ya
    se había hecho; un fallo dentro de la propia petición de la EPA no deja sondeo que guardar).

    Args:
        tablas: Lo navegado de la edición nueva (navegacion.tablas_de_la_edicion_nueva).
        admitida: La edición admitida, con la EPA de esta consulta.
        registros_admitidos: Los registros de sus originales en esta consulta.
        original_de_la_fuente: La carpeta de originales de la fuente.

    Returns:
        `{}`, `{"candidata": {"edicion", "archivos"}}` o
        `{"candidata_detenida": {"anio", "motivo", "detalle", "archivos"}}`, con `epa_sondeo` si lo hubo.
    """
    navegadas = tablas.get("tablas_edicion_nueva")
    if navegadas is None:
        return {}
    base = base_valida(
        {
            "anio": navegadas["anio"],
            "anios_medidos": [*admitida["anios_medidos"], navegadas["anio"]],
            "tablas": {"uso": navegadas["uso"]["tabla"], "errores": navegadas["errores"]["tabla"]},
            "epa_anio": admitida["epa_anio"],
        }
    )
    carpeta = estado.carpeta(base, original_de_la_fuente)
    hechos: list[EntradaDeDescarga] = []
    epa_anio, sondeo = base["epa_anio"], {}
    try:
        carpeta.mkdir(parents=True, exist_ok=True)
        copia = _copia_de_la_admitida(admitida, registros_admitidos, original_de_la_fuente, carpeta)
        for archivo in (*estado.archivos(base), *documentos_del_anio(base["anio"], navegadas["documentos"])):
            if archivo["archivo"] == estado.nombres(base).epa:
                registro, epa_anio, sondeo = epa_por_anio.descargar(base, carpeta, True, copia)
            else:
                registro = red.descargar_originales([archivo], carpeta, True)[0]
            hechos.append(registro)
    except (OSError, ErrorFuente, http.client.HTTPException) as error:
        detenida = {
            "anio": base["anio"],
            "motivo": "tablas",
            "detalle": f"{type(error).__name__}: {error}",
            "archivos": hechos,
            **sondeo,
        }
        return {"candidata_detenida": detenida}
    base = base_valida({**base, "epa_anio": epa_anio})
    citada = {"fuente": nombre_fuente(base["anio"], base["tablas"]), "cita": cita(base["anio"], base["tablas"])}
    del_anio = {
        "anio": base["anio"],
        "epa_anio": epa_anio,
        **sondeo,
        **citada,
        "archivos": hechos,
    }
    guardar_json(carpeta / ARCHIVO_DE_PROCEDENCIA, del_anio)
    return {"candidata": {"edicion": base, "archivos": estado.en_la_operacion(base, hechos)}}


def _documentos(base: Base, carpeta: Path) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """La lectura de los documentos de la candidata, que detiene la preparación si el enunciado no es el de la serie.

    Returns:
        La función que, con el diseño de registro, lee la metodología y el cuestionario comprobados con su huella.
    """

    def leer(diseno: dict[str, Any]) -> dict[str, Any]:
        nombres = estado.nombres(base)
        leidos = leer_documentos(
            diseno,
            original(FUENTE, nombres.metodologia, carpeta),
            original(FUENTE, nombres.cuestionario, carpeta),
            base["anio"],
        )
        if diferencias := leidos["enunciado"]["diferencias"]:
            raise EnunciadoDistinto(diferencias)
        return leidos

    return leer


def preparar(
    procedencia: Mapping[str, Any],
    preparar_edicion: PrepararEdicion,
    original_de_la_fuente: Path = ORIGINAL,
    destino: Path = PREPARADA,
) -> None:
    """Prepara la candidata, si la hay, en su propia carpeta: lo calculado o lo que la detiene.

    Un fallo de la candidata no detiene la preparación de la admitida: queda guardado como detención, con su motivo.

    Args:
        procedencia: La procedencia de la operación.
        preparar_edicion: La preparación de una edición, la misma que la de la admitida (lector.py).
        original_de_la_fuente: La carpeta de originales de la fuente.
        destino: El archivo de lo preparado de la candidata.
    """
    base = de_la_procedencia(procedencia)
    detenida = detenida_al_descargar(procedencia)
    if base is None and detenida is None:
        return
    archivos = procedencia["candidata"]["archivos"] if base is not None else []
    anio = base["anio"] if base is not None else procedencia["edicion_nueva"]["anio"]
    if base is not None and detenida is None:
        try:
            carpeta = estado.carpeta(base, original_de_la_fuente)
            epa = estado.procedencia_del_anio(base, original_de_la_fuente).get("epa_anio", base["epa_anio"])
            base = base_valida({**base, "epa_anio": epa})
            preparado, publicadas = preparar_edicion(base, _documentos(base, carpeta))
        except EnunciadoDistinto as error:
            detenida = detencion("enunciado-distinto", str(error), partes_distintas(error.diferencias))
        except (ArchivoFaltante, HuellaIncorrecta, OSError) as error:
            detenida = detencion("tablas", f"{type(error).__name__}: {error}")
        except ERRORES_DE_UN_ORIGINAL_DANADO as error:
            # Un original dañado detiene la candidata, no la preparación de la admitida; un error de programación
            # también, pero deja su traza.
            traceback.print_exc()
            detenida = detencion("controles", f"{type(error).__name__}: {error}")
        else:
            calculada = {"preparado": preparado, "publicadas": publicadas}
            guardar_json(destino, {"anio": anio, "archivos": archivos, **calculada})
            return
    guardar_json(destino, {"anio": anio, "archivos": archivos, "detenida": detenida})


def validar(
    procedencia: Mapping[str, Any],
    validacion: Validacion,
    origen: Path = PREPARADA,
    admitida: Mapping[str, Any] | None = None,
) -> Incorporada | dict[str, Any] | None:
    """Valida la candidata preparada con los mismos controles que la admitida.

    Un fallo de la validación o de la lectura de lo preparado de la candidata (`ERRORES_DE_UN_ORIGINAL_DANADO`) la
    detiene con «controles» y deja su traza en stderr: la validación de la admitida sigue. Con el conjunto de la
    admitida, se añade el control de las clases: ningún grupo pasa de manual a no manual o al revés, y el informe
    declara los grupos que pasan a «sin clase» o salen de ella (`cambios_de_clase`).

    Args:
        procedencia: La procedencia de la operación.
        validacion: La validación de una edición preparada (lector.py), con las clasificaciones ya fijadas.
        origen: El archivo de lo preparado de la candidata.
        admitida: El conjunto validado de la edición admitida, con el que se comparan las clases.

    Returns:
        None sin candidata; la candidata incorporada si pasa todos sus controles; si no, su detención.

    Raises:
        FormatoInesperado: Si lo preparado de la candidata no es de la candidata que registra la procedencia.
    """
    base = de_la_procedencia(procedencia)
    detenida = detenida_al_descargar(procedencia)
    if detenida is not None or base is None:
        return detenida
    preparada = leer_json(origen) if origen.exists() else {}
    exigir(
        preparada.get("anio") == base["anio"] and preparada.get("archivos") == procedencia["candidata"]["archivos"],
        "TIC-H: lo preparado de la candidata no es de la candidata registrada; repetir preparar",
    )
    if "detenida" in preparada:
        motivo = preparada["detenida"]
        return detencion(motivo["motivo"], motivo["detalle"], motivo.get("partes", ()))
    del_dato = {"anios_medidos": anios_medidos_validos(base["anios_medidos"], base["anio"])}
    registrados = {"archivos": procedencia["candidata"]["archivos"]}
    try:
        controles, informe, conjunto = validacion(
            preparada["preparado"], preparada["publicadas"], registrados, del_dato
        )
        if admitida is not None:
            informe = {**informe, "cambios_de_clase": control_de_los_cambios_de_clase(controles, admitida, conjunto)}
        if not controles.admitido:
            return detencion("controles", "; ".join(controles.fallidos))
        edicion = estado.valida(preparada["preparado"]["edicion"])
    except ERRORES_DE_UN_ORIGINAL_DANADO as error:
        traceback.print_exc()
        return detencion("controles", f"{type(error).__name__}: {error}")
    return {"controles": controles, "informe": informe, "conjunto": conjunto, "edicion": edicion}


def en_el_informe(procedencia: Mapping[str, Any], detenida: Mapping[str, Any]) -> dict[str, Any]:
    """La detención de la candidata como la guarda el informe de validación de la admitida, para el panel.

    El dato publicado no cambia: sigue siendo el de la edición admitida, con la edición nueva observada, y la persona
    lee lo mismo sea cual sea el motivo. El panel lee de aquí el estado, el motivo y las partes (ediciones_observadas).

    Returns:
        `{"estado": «detenida-por-controles», "anio", "motivo", "detalle"}` y, si las hay, `partes`.
    """
    return {"estado": DETENIDA, "anio": procedencia["edicion_nueva"]["anio"], **detenida}


def operacion_con_la_incorporada(procedencia: Mapping[str, Any], edicion: estado.Edicion) -> dict[str, Any]:
    """La procedencia de la operación cuando la candidata pasa a ser la admitida.

    Registra los originales de su contrato (microdatos, tablas y EPA) como los de la edición admitida, con su cita, y
    retira lo que solo se guardaba de la edición nueva: ya no es nueva. Sus PDF siguen registrados en la procedencia de
    su año, y sus huellas, en el estado de la edición: la admitida no los vuelve a leer.

    La consulta de ese día pidió más de lo que registra la edición ya admitida: los originales de la edición anterior,
    los índices navegados y los dos PDF de la candidata. Quedan en `consulta_de_la_incorporacion`, tal como estaban
    registrados, para que la cobertura de ese día cuente exactamente esas peticiones. La consulta del día siguiente
    escribe la procedencia normal, sin ese bloque.

    Args:
        procedencia: La procedencia de la operación con la candidata.
        edicion: La edición que pasa a ser la admitida.

    Returns:
        La procedencia.

    Raises:
        FormatoInesperado: Si la candidata no registra todos los originales de su contrato.
    """
    contrato = {f"{edicion['anio']}/{archivo['archivo']}" for archivo in estado.archivos(edicion)}
    archivos = [entrada for entrada in procedencia["candidata"]["archivos"] if entrada["archivo"] in contrato]
    exigir(len(archivos) == len(contrato), "TIC-H: la candidata no registra todos los originales de su edición")
    sin_la_nueva = {clave: valor for clave, valor in procedencia.items() if clave not in DE_LA_EDICION_NUEVA}
    consulta = {
        "anterior": {"anio": edicion["anios_medidos"][-2], "archivos": procedencia["archivos"]},
        "indices": procedencia["tablas_edicion_nueva"]["paginas"],
        "documentos": [
            entrada for entrada in procedencia["candidata"]["archivos"] if entrada["archivo"] not in contrato
        ],
    }
    return {
        **sin_la_nueva,
        "fuente": nombre_fuente(edicion["anio"], edicion["tablas"]),
        "cita": cita(edicion["anio"], edicion["tablas"]),
        "archivos": archivos,
        "consulta_de_la_incorporacion": consulta,
    }
