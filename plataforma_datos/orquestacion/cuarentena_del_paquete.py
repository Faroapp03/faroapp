"""Cuarentena de archivos del paquete: qué conserva su versión publicada, qué va junto y qué aceptó una persona.

Un archivo que pierde más de PERDIDA_MAXIMA (piezas_de_la_actualizacion) conserva su versión publicada con los que salen
de sus mismas entradas, y el resto del paquete sigue. El estado vive en ejecuciones/cuarentena.json: se lee en cada
actualización antes de publicar, se registra después de publicar y una persona acepta un cambio con
`actualizar --aceptar-cuarentena`. El umbral solo avisa; nada de aquí ajusta cifras.
"""

import json
import os
import re
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from plataforma_datos.comun.entrada_salida import Json, guardar_json, sha256, temporal_hermano
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente, FormatoInesperado, exigir
from plataforma_datos.orquestacion import sustitucion
from plataforma_datos.orquestacion.estado_de_la_actualizacion import Aviso, ResultadoDelModulo, avisar
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    CARPETA_DE_INFORMES,
    PAQUETE_RELATIVO,
    Comparacion,
    EnCuarentena,
    Perdida,
    texto_de_perdida,
)
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import _leer_json_si_existe as leer_json_si_existe

# Códigos de salida de la orden de aceptar, los mismos que usa actualizar: 2 para argumentos y 1 para el rojo.
CODIGO_DE_ARGUMENTOS = 2
CODIGO_NO_ACEPTADO = 1
# Estado de la cuarentena, junto a estado.json: qué archivos conservan su versión publicada y qué cambios ha aceptado
# una persona para la siguiente ejecución.
ARCHIVO_DE_CUARENTENA = "cuarentena.json"
VERSION_CUARENTENA = 1
# exportado_sha256 es la versión nueva que se vio al entrar en cuarentena: queda como evidencia de lo decidido.
CAMPOS_DE_CUARENTENA = frozenset(
    {"grupo", "perdidas", "desde_utc", "ultima_utc", "vigente_sha256", "exportado_sha256", "aceptada_utc"}
)


class NoEnCuarentena(ValueError):
    """Se pide aceptar el cambio de un archivo que no está en cuarentena."""


class CuarentenaImposible(Exception):
    """Un archivo no puede conservar su versión publicada sin romper la coherencia del paquete."""


def _carpeta_de_origen(ruta: str) -> str:
    """La carpeta de la que sale un origen: una fuente de var/actualizacion en cualquier etapa, o su carpeta.

    Returns:
        «fuente:<carpeta>» para var/actualizacion/<etapa>/<carpeta>/…; si no, la carpeta del archivo.
    """
    partes, operativos = PurePosixPath(ruta).parts, DATOS_RELATIVOS.parts
    # Tras la carpeta operativa vienen la etapa (originales, preparados, validados) y la carpeta de la fuente.
    if partes[: len(operativos)] == operativos and len(partes) > len(operativos) + 1:
        return f"fuente:{partes[len(operativos) + 1]}"
    return str(PurePosixPath(ruta).parent)


def grupos_de_cuarentena(manifiestos: tuple[dict[str, Json], ...]) -> dict[str, frozenset[str]]:
    """Agrupa los archivos del paquete que salen de una misma carpeta de origen, en cualquiera de los manifiestos.

    Dos archivos preparados con las mismas entradas (formacion.json y correspondencia-eures.json, por ejemplo) se
    refieren el uno al otro: conservar uno sin el otro mezclaría versiones. La relación es transitiva.

    Returns:
        Para cada archivo, el grupo de archivos que se conservan con él (él incluido).
    """
    por_carpeta: dict[str, set[str]] = {}
    for manifiesto in manifiestos:
        for nombre, entrada in manifiesto.items():
            origenes = entrada.get("origenes") if isinstance(entrada, dict) else None
            for ruta in origenes if isinstance(origenes, dict) else ():
                por_carpeta.setdefault(_carpeta_de_origen(ruta), set()).add(nombre)
    grupos: dict[str, frozenset[str]] = {
        nombre: frozenset({nombre}) for manifiesto in manifiestos for nombre in manifiesto
    }
    for juntos in por_carpeta.values():
        union = frozenset().union(*(grupos[nombre] for nombre in juntos))
        for nombre in union:
            grupos[nombre] = union
    return grupos


def dentro_de_lo_aceptado(registro: dict, perdidas: list[Perdida] | tuple[Perdida, ...]) -> bool:
    """Indica si el archivo nuevo queda dentro de lo que una persona aceptó.

    Toda cuenta que hoy supera el umbral tiene que estar entre las aceptadas: una pérdida que no se vio al aceptar
    no está aceptada. Ninguna cuenta aceptada puede bajar de su cifra; una que ya no supera el umbral está por encima.
    Los bytes pueden ser otros: una oferta diaria cambia cada día, y lo que se aceptó es «que baje hasta aquí».

    Returns:
        Si no hay pérdidas nuevas y cada cuenta aceptada llega ahora al menos a su cifra aceptada.
    """
    actuales = {perdida["medida"]: perdida["despues"] for perdida in perdidas}
    vistas = {vista["medida"]: vista["despues"] for vista in registro["perdidas"]}
    return set(actuales) <= set(vistas) and all(
        actuales.get(medida, cifra) >= cifra for medida, cifra in vistas.items()
    )


def elegir_cuarentena(comparacion: Comparacion, vigente: Path, nuevo: Path, previa: dict[str, dict]) -> Comparacion:
    """Elige qué archivos conservan su versión publicada: los que superan el umbral y los que van con ellos.

    Se admite el cambio que una persona aceptó sobre la misma versión publicada que sigue vigente. Si un archivo
    aceptado va junto a otro que sigue en cuarentena, se conserva con él y su aceptación queda pendiente.

    Args:
        comparacion: La comparación del paquete recién exportado.
        vigente: La carpeta del paquete publicado.
        nuevo: La carpeta del paquete recién exportado.
        previa: El estado de la cuarentena (leer_cuarentena).

    Returns:
        La comparación con su cuarentena y sus cambios aceptados.
    """
    manifiestos = tuple(leer_json_si_existe(carpeta / "manifiesto.json") or {} for carpeta in (vigente, nuevo))
    superan = sorted({perdida["archivo"] for perdida in comparacion.perdidas})
    huella_vigente = {nombre: (manifiestos[0].get(nombre) or {}).get("sha256") for nombre in superan}
    huella_nueva = {nombre: (manifiestos[1].get(nombre) or {}).get("sha256") for nombre in superan}
    # Se publica lo que la persona aceptó: la misma versión publicada y sin bajar de las cifras que vio.
    aceptados = {
        nombre
        for nombre in superan
        if nombre in previa
        and previa[nombre]["aceptada_utc"] is not None
        and previa[nombre]["vigente_sha256"] == huella_vigente[nombre]
        and dentro_de_lo_aceptado(previa[nombre], [p for p in comparacion.perdidas if p["archivo"] == nombre])
    }
    grupos = grupos_de_cuarentena(manifiestos)
    cuarentena = tuple(
        EnCuarentena(archivo=nombre, grupo=sorted(grupos[nombre]), exportado_sha256=huella_nueva[nombre])
        for nombre in superan
        if nombre not in aceptados
    )
    retenidos = frozenset(otro for retenido in cuarentena for otro in retenido["grupo"])
    # Un aceptado que va con un retenido se conserva con él y también figura en la cuarentena, aún aceptado.
    cuarentena += tuple(
        EnCuarentena(archivo=nombre, grupo=sorted(grupos[nombre]), exportado_sha256=huella_nueva[nombre])
        for nombre in sorted(aceptados & retenidos)
    )
    return comparacion._replace(cuarentena=cuarentena, aceptados=tuple(sorted(aceptados - retenidos)))


def _copiar_entero(origen: Path, destino: Path) -> None:
    """Escribe una copia exacta de un archivo, entera o nada."""
    with temporal_hermano(destino.parent, prefijo=f".{destino.name}.") as archivo:
        archivo.write(origen.read_bytes())
        archivo.flush()
        os.fsync(archivo.fileno())
    Path(archivo.name).replace(destino)


def conservar_en_cuarentena(vigente: Path, nuevo: Path, nombres: frozenset[str]) -> None:
    """Devuelve al paquete nuevo la versión publicada de unos archivos, con su entrada del manifiesto.

    El resto del paquete nuevo no cambia. Las comprobaciones posteriores de la actualización (composición, pruebas y
    web) leen ya este paquete, así que acreditan o rechazan su coherencia.

    Args:
        vigente: La carpeta del paquete publicado.
        nuevo: La carpeta del paquete recién exportado, en el área.
        nombres: Los archivos que conservan su versión publicada.

    Raises:
        CuarentenaImposible: Si un archivo no está publicado, su copia no coincide con su manifiesto o falta en el
            paquete nuevo.
    """
    if not nombres:
        return
    publicado, exportado = (leer_json_si_existe(carpeta / "manifiesto.json") or {} for carpeta in (vigente, nuevo))
    for nombre in sorted(nombres):
        entrada = publicado.get(nombre)
        if not isinstance(entrada, dict) or nombre not in exportado:
            raise CuarentenaImposible(f"{nombre} no tiene una versión publicada que conservar en el paquete nuevo")
        if not (vigente / nombre).is_file() or sha256(vigente / nombre) != entrada.get("sha256"):
            raise CuarentenaImposible(f"{nombre} publicado no coincide con su manifiesto")
        _copiar_entero(vigente / nombre, nuevo / nombre)
        exportado[nombre] = entrada
    guardar_json(nuevo / "manifiesto.json", exportado)


def _es_instante(valor: Json) -> bool:
    """Reconoce un instante ISO 8601 con zona horaria.

    Returns:
        Si el valor es un texto con ese formato.
    """
    if not isinstance(valor, str):
        return False
    try:
        return datetime.fromisoformat(valor).utcoffset() is not None
    except ValueError:
        return False


def _comprobar_entrada_de_cuarentena(nombre: str, entrada: Json, contexto: str) -> None:
    exigir(isinstance(entrada, dict) and set(entrada) == CAMPOS_DE_CUARENTENA, f"{contexto}: campos inesperados")
    grupo, perdidas = entrada["grupo"], entrada["perdidas"]
    exigir(
        isinstance(grupo, list) and nombre in grupo and all(isinstance(otro, str) for otro in grupo),
        f"{contexto}: grupo inválido",
    )
    exigir(isinstance(perdidas, list) and bool(perdidas), f"{contexto}: sin pérdidas registradas")
    for perdida in perdidas:
        exigir(
            isinstance(perdida, dict)
            and set(perdida) == {"archivo", "medida", "antes", "despues"}
            and perdida["archivo"] == nombre
            and perdida["medida"] in ("entradas", "cursos SOC")
            and all(type(perdida[cifra]) is int and perdida[cifra] >= 0 for cifra in ("antes", "despues")),
            f"{contexto}: pérdida inválida",
        )
    exigir(
        _es_instante(entrada["desde_utc"])
        and _es_instante(entrada["ultima_utc"])
        and (entrada["aceptada_utc"] is None or _es_instante(entrada["aceptada_utc"])),
        f"{contexto}: instantes inválidos",
    )
    for campo in ("vigente_sha256", "exportado_sha256"):
        exigir(
            isinstance(entrada[campo], str) and re.fullmatch(r"[0-9a-f]{64}", entrada[campo]) is not None,
            f"{contexto}: {campo} inválida",
        )


def leer_cuarentena(raiz: Path) -> dict[str, dict]:
    """Lee los archivos en cuarentena; sin estado de cuarentena, ninguno.

    Returns:
        Por archivo que supera el umbral: su grupo, sus pérdidas, desde cuándo y hasta cuándo se ha observado, la
        huella de la versión que conserva y, si una persona lo aceptó, cuándo.

    Raises:
        FormatoInesperado: Si el estado existe pero no es JSON legible o no tiene la forma esperada; no se trata
            como vacío.
    """
    ruta = raiz / CARPETA_DE_INFORMES / ARCHIVO_DE_CUARENTENA
    try:
        documento = leer_json_si_existe(ruta)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise FormatoInesperado(f"{ruta}: no es JSON legible") from error
    if documento is None:
        return {}
    exigir(
        isinstance(documento, dict)
        and set(documento) == {"version", "archivos"}
        and documento["version"] == VERSION_CUARENTENA
        and isinstance(documento["archivos"], dict),
        f"{ruta}: no es un estado de cuarentena v{VERSION_CUARENTENA}",
    )
    for nombre, entrada in documento["archivos"].items():
        _comprobar_entrada_de_cuarentena(nombre, entrada, f"{ruta}: {nombre}")
    return documento["archivos"]


def poner_en_cuarentena(raiz: Path, area: Path, comparacion: Comparacion) -> Comparacion:
    """Devuelve a su versión publicada, en el área, los archivos que superan el umbral y los que van con ellos.

    El estado de la cuarentena se lee siempre, haya pérdidas o no: tras publicar hay que registrarlo, y uno roto
    dejaría el paquete publicado sin estado. Si no se puede leer o no se puede conservar un archivo, no se publica el
    paquete: queda una alarma.

    Returns:
        La comparación con su cuarentena, sus cambios aceptados y, si hace falta, esa alarma.
    """
    vigente, nuevo = raiz / PAQUETE_RELATIVO, area / PAQUETE_RELATIVO
    try:
        previa = leer_cuarentena(raiz)
        if not comparacion.perdidas:
            return comparacion
        elegida = elegir_cuarentena(comparacion, vigente, nuevo, previa)
        conservar_en_cuarentena(vigente, nuevo, elegida.retenidos)
    except (ErrorFuente, CuarentenaImposible, OSError) as error:
        return comparacion._replace(alarmas=[*comparacion.alarmas, f"no se pudo aplicar la cuarentena: {error}"])
    return elegida


def motivo_del_paquete(resultado: ResultadoDelModulo, comparacion: Comparacion) -> ResultadoDelModulo:
    """Añade al resultado publicado qué conserva su versión anterior y qué cambio aceptado entra.

    Returns:
        El mismo resultado, con esos hechos en su motivo.
    """
    partes = [resultado.motivo]
    if comparacion.retenidos:
        partes.append(f"conservan su versión publicada (cuarentena): {', '.join(sorted(comparacion.retenidos))}")
    if comparacion.aceptados:
        partes.append(f"cambio aceptado: {', '.join(comparacion.aceptados)}")
    return resultado._replace(motivo="; ".join(parte for parte in partes if parte))


def _escribir_cuarentena(raiz: Path, archivos: dict[str, dict]) -> None:
    documento = {"version": VERSION_CUARENTENA, "archivos": archivos}
    ruta = raiz / CARPETA_DE_INFORMES / ARCHIVO_DE_CUARENTENA
    sustitucion.escribir_atomico(ruta, json.dumps(documento, ensure_ascii=False, indent=2) + "\n")


def registrar_cuarentena(raiz: Path, comparacion: Comparacion, comienzo: datetime, aviso: Aviso = avisar) -> None:
    """Tras publicar el paquete, registra qué conserva su versión anterior y avisa de lo que pide una decisión.

    Un archivo sale de la cuarentena cuando su cambio aceptado se publica o cuando deja de superar el umbral. Mientras
    conserva la misma versión publicada, mantiene la fecha en que entró y su aceptación pendiente.

    Args:
        raiz: La raíz del repositorio, con el paquete ya publicado.
        comparacion: La comparación de esta actualización, con su cuarentena.
        comienzo: El comienzo de esta actualización.
        aviso: Cómo se avisa (avisos.log y FARO_AVISO).
    """
    previa = leer_cuarentena(raiz)
    if not (comparacion.cuarentena or comparacion.aceptados or previa):
        # Nada en cuarentena ni antes ni ahora: no hay estado que escribir, tampoco sin paquete publicado todavía.
        return
    manifiesto = json.loads((raiz / PAQUETE_RELATIVO / "manifiesto.json").read_text(encoding="utf-8"))
    instante = comienzo.isoformat(timespec="seconds")
    archivos = {}
    for retenido in comparacion.cuarentena:
        nombre = retenido["archivo"]
        huella_vigente = manifiesto[nombre]["sha256"]
        anterior = previa.get(nombre)
        sigue = anterior is not None and anterior["vigente_sha256"] == huella_vigente
        perdidas = [perdida for perdida in comparacion.perdidas if perdida["archivo"] == nombre]
        # Una aceptación sigue en pie mientras el archivo nuevo no baje de las cifras aceptadas; entonces se conservan
        # las cifras y la huella que se vieron al aceptar, como evidencia de lo decidido.
        sigue_aceptada = sigue and anterior["aceptada_utc"] is not None and dentro_de_lo_aceptado(anterior, perdidas)
        vista = anterior if sigue_aceptada else {"perdidas": perdidas, "exportado_sha256": retenido["exportado_sha256"]}
        archivos[nombre] = {
            "grupo": retenido["grupo"],
            "perdidas": vista["perdidas"],
            "desde_utc": anterior["desde_utc"] if sigue else instante,
            "ultima_utc": instante,
            "vigente_sha256": huella_vigente,
            "exportado_sha256": vista["exportado_sha256"],
            "aceptada_utc": anterior["aceptada_utc"] if sigue_aceptada else None,
        }
        textos = "; ".join(map(texto_de_perdida, perdidas))
        if not sigue:
            aviso(
                raiz,
                f"{instante} · paquete · cuarentena · {textos}: "
                f"{', '.join(retenido['grupo'])} conservan su versión publicada hasta que alguien decida "
                f"(--aceptar-cuarentena {nombre})",
            )
        elif anterior["aceptada_utc"] is not None and not sigue_aceptada:
            vistas = "; ".join(map(texto_de_perdida, anterior["perdidas"]))
            aviso(
                raiz,
                f"{instante} · paquete · cuarentena · se aceptó «{vistas}», pero esta ejecución trae «{textos}»: "
                f"{', '.join(retenido['grupo'])} siguen con su versión publicada hasta otra decisión "
                f"(--aceptar-cuarentena {nombre})",
            )
    for nombre in comparacion.aceptados:
        aviso(
            raiz,
            f"{instante} · paquete · cambio aceptado publicado · {nombre} (aceptado {previa[nombre]['aceptada_utc']})",
        )
    _escribir_cuarentena(raiz, archivos)


def aceptar_cuarentena(raiz: Path, nombres: Sequence[str], ahora: datetime) -> dict[str, dict]:
    """Acepta que unos archivos en cuarentena bajen hasta las cifras registradas, bajo el cerrojo.

    Vale mientras la versión publicada sea la misma y el archivo nuevo no traiga menos entradas que las aceptadas en
    ninguna de sus cuentas (dentro_de_lo_aceptado); los bytes pueden ser otros.

    Returns:
        El registro aceptado de cada archivo, con las cifras que se aceptan (las de la última ronda registrada).

    Raises:
        NoEnCuarentena: Si algún archivo no está en cuarentena.
        ActualizacionEnCurso: Si otra actualización tiene el cerrojo.
    """
    with sustitucion.cerrojo(raiz):
        archivos = leer_cuarentena(raiz)
        ausentes = [nombre for nombre in nombres if nombre not in archivos]
        if ausentes:
            raise NoEnCuarentena(f"no está en cuarentena: {', '.join(ausentes)}")
        for nombre in nombres:
            archivos[nombre] = {**archivos[nombre], "aceptada_utc": ahora.isoformat(timespec="seconds")}
        _escribir_cuarentena(raiz, archivos)
    return {nombre: archivos[nombre] for nombre in nombres}


def aceptar_desde_la_cli(raiz: Path, nombres: list[str]) -> int:
    """Registra la aceptación y dice qué pasará; no actualiza.

    Returns:
        0 si queda registrada; 2 si un archivo no está en cuarentena; 1 si el cerrojo está ocupado o el estado roto.
    """
    try:
        aceptados = aceptar_cuarentena(raiz, nombres, datetime.now(UTC))
    except NoEnCuarentena as error:
        print(f"No se acepta: {error}.", file=sys.stderr)
        return CODIGO_DE_ARGUMENTOS
    except (sustitucion.ActualizacionEnCurso, ErrorFuente, OSError) as error:
        print(f"No se acepta: {error}.", file=sys.stderr)
        return CODIGO_NO_ACEPTADO
    for nombre, registro in aceptados.items():
        cifras = "; ".join(f"{p['antes']} → {p['despues']} {p['medida']}" for p in registro["perdidas"])
        print(
            f"Aceptado: {nombre} puede bajar hasta {cifras}. La próxima actualización lo publica si su versión "
            "publicada sigue siendo la misma, no trae menos ni otra pérdida y el paquete pasa sus comprobaciones."
        )
    return 0
