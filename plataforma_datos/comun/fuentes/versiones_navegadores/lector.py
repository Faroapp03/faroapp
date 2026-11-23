"""Chrome Windows estable: captura pública, admisión monotónica y perfil reducido.

No conectado al registro ni al perfil por defecto. Ninguna orden escribe curlrc.
La captura histórica sin recibo se usa solo en pruebas, nunca se admite como adquisición.
"""

import json
import math
import re
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    guardar_json,
    leer_json,
    sha256,
    sha256_bytes,
    temporal_hermano,
)
from plataforma_datos.comun.nucleo import ArchivoDescargable, Controles, Descarga, FormatoInesperado
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import descargar_url, registro_descarga
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga
from plataforma_datos.orquestacion.sustitucion import RecuperacionIncompleta, recuperar, sustituir

FUENTE = "versiones_navegadores"
MODULO = "plataforma_datos.comun.fuentes.versiones_navegadores.lector"
URL = (
    "https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions/all/releases"
    "?filter=endtime=none&order_by=version%20desc"
)
MAX_CAPTURA = 2 * 1024 * 1024
MAX_RELEASES = 10_000
MAX_VERSION = 64
VERSION_PROCEDENCIA = 2
VERSION_OBSERVACION = 1
VERSION = re.compile(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){3}")
RECURSO = re.compile(r"chrome/platforms/win/channels/stable/versions/([^/]+)/releases/[0-9]+")


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise FormatoInesperado(f"Chrome estable: {motivo}")


def _objeto(valor: object) -> dict[str, object]:
    _exigir(isinstance(valor, dict) and all(isinstance(k, str) for k in valor), "objeto no válido")
    return dict(valor) if isinstance(valor, dict) else {}


def _instante(valor: object) -> datetime:
    _exigir(isinstance(valor, str), "fecha ausente")
    try:
        instante = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except ValueError as error:
        raise FormatoInesperado("Chrome estable: fecha no válida") from error
    _exigir(instante.tzinfo is not None, "fecha sin zona")
    return instante.astimezone(UTC)


def _version(valor: object) -> str:
    _exigir(isinstance(valor, str) and len(valor) <= MAX_VERSION and VERSION.fullmatch(valor), "versión no canónica")
    return str(valor)


def _orden(version: str) -> tuple[int, ...]:
    return tuple(int(n) for n in _version(version).split("."))


def _pares(pares: list[tuple[str, object]]) -> dict[str, object]:
    resultado: dict[str, object] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado, "clave JSON duplicada")
        resultado[clave] = valor
    return resultado


def _release(entrada: object, reloj: datetime) -> tuple[str, str] | None:
    release = _objeto(entrada)
    version = _version(release.get("version"))
    recurso = RECURSO.fullmatch(str(release.get("name")))
    _exigir(recurso and recurso.group(1) == version, "producto, plataforma, canal o versión incorrectos")
    fraction = release.get("fraction")
    _exigir(type(fraction) in (int, float), "fraction no numérica")
    numero = float(fraction) if isinstance(fraction, (int, float)) else math.nan
    _exigir(math.isfinite(numero) and 0 <= numero <= 1, "fraction fuera de rango")
    serving = _objeto(release.get("serving"))
    comienzo = _instante(serving.get("startTime"))
    fin = _instante(serving["endTime"]) if "endTime" in serving else None
    _exigir(fin is None or comienzo <= fin, "intervalo invertido")
    if numero == 0 or comienzo > reloj or (fin is not None and fin <= reloj):
        return None
    return version, comienzo.isoformat()


def seleccionar(datos: bytes, observado_utc: str) -> dict[str, object]:
    """Selecciona la mayor versión numérica activa a la fecha de recepción, sin contar rollout duplicado.

    Returns:
        Versiones únicas activas y fecha de inicio; no acredita instalación ni disponibilidad universal.

    Raises:
        FormatoInesperado: Si el JSON es incompleto, ambiguo o no contiene publicaciones activas.
    """
    _exigir(len(datos) <= MAX_CAPTURA, "captura demasiado grande")
    try:
        documento = _objeto(json.loads(datos, object_pairs_hook=_pares))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise FormatoInesperado("Chrome estable: JSON no válido") from error
    _exigir(documento.get("nextPageToken", "") == "", "paginación incompleta")
    releases = documento.get("releases")
    _exigir(isinstance(releases, list) and 0 < len(releases) <= MAX_RELEASES, "releases ausentes o excesivos")
    activas: dict[str, str] = {}
    reloj = _instante(observado_utc)
    for entrada in releases if isinstance(releases, list) else []:
        release = _release(entrada, reloj)
        if release is not None:
            version, comienzo = release
            activas[version] = min(comienzo, activas.get(version, comienzo))
    _exigir(activas, "ninguna publicación activa")
    versiones = sorted(activas, key=_orden, reverse=True)
    return {
        "version_completa": versiones[0],
        "versiones_activas": versiones,
        "serving_inicio_utc": activas[versiones[0]],
    }


def _firmas() -> dict[str, str]:
    return {
        "lector.py": sha256(Path(__file__)),
        "fuente.json": sha256(Path(__file__).with_name("fuente.json")),
        "perfil_web.py": sha256(Path(perfil_web.__file__)),
    }


def _guardar(ruta: Path, contenido: object) -> None:
    if not ruta.exists() or leer_json(ruta) != contenido:
        guardar_json(ruta, contenido)


def _entradas() -> list[dict[str, object]]:
    ruta = carpetas(FUENTE).original / "procedencia.json"
    if not ruta.exists():
        return []
    documento = _objeto(leer_json(ruta))
    _exigir(
        set(documento) == {"version", "archivos"}
        and type(documento.get("version")) is int
        and documento["version"] == VERSION_PROCEDENCIA,
        "procedencia experimental anterior: requiere adquisición explícita en una instalación nueva",
    )
    entradas = documento.get("archivos")
    _exigir(isinstance(entradas, list) and entradas, "procedencia sin archivos")
    filas = [_objeto(e) for e in entradas] if isinstance(entradas, list) else []
    nombres = [e.get("archivo") for e in filas]
    _exigir(
        all(isinstance(n, str) for n in nombres) and len(set(nombres)) == len(nombres),
        "archivos de procedencia ausentes o repetidos",
    )
    return filas


def _inmutable(ruta: Path, datos: bytes) -> None:
    """Guarda una evidencia una sola vez; nunca repara ni sustituye una distinta.

    Raises:
        FormatoInesperado: Si el destino es un enlace o ya contiene otros bytes.
    """
    _exigir(not ruta.is_symlink(), "evidencia enlazada")
    if ruta.exists():
        _exigir(ruta.read_bytes() == datos, "evidencia conservada alterada")
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo=".captura-") as archivo:
            temporal = Path(archivo.name)
            archivo.write(datos)
        temporal.replace(ruta)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def _indice(nombre: str, datos: bytes, tipo: str) -> dict[str, object]:
    return {"archivo": nombre, "sha256": sha256_bytes(datos), "bytes": len(datos), "tipo": tipo}


def _registrar(descarga: Descarga) -> dict[str, object]:
    """Deduplica cuerpos, conserva recepciones completas y devuelve su referencia inmutable.

    Returns:
        Referencia a la observación de esta recepción; ninguna entrada previa se sustituye.
    """
    entradas = _entradas()
    nombre = f"chrome-{sha256_bytes(descarga.datos)}.json"
    archivo: ArchivoDescargable = {
        "archivo": nombre,
        "nivel": "oficial",
        "titulo": "Chrome Windows stable: releases activos",
        "url": URL,
        "licencia": "Licencia de la respuesta no acreditada; metadatos de publicación.",
    }
    recepcion = dict(registro_descarga(archivo, descarga, descarga.datos, None))
    observacion = (
        json.dumps(
            {"version": VERSION_OBSERVACION, "recepcion": recepcion},
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n"
    ).encode()
    cuerpo = _indice(nombre, descarga.datos, "cuerpo_http")
    referencia = {
        **_indice(f"observaciones/chrome-{sha256_bytes(observacion)}.json", observacion, "observacion_http"),
        "descargado_utc": recepcion["descargado_utc"],
    }
    carpeta = carpetas(FUENTE).original
    for entrada, datos in ((cuerpo, descarga.datos), (referencia, observacion)):
        _inmutable(carpeta / str(entrada["archivo"]), datos)
        previa = next((e for e in entradas if e.get("archivo") == entrada["archivo"]), None)
        _exigir(previa is None or previa == entrada, "entrada inmutable de procedencia alterada")
        if previa is None:
            entradas.append(entrada)
    _guardar(carpeta / "procedencia.json", {"version": VERSION_PROCEDENCIA, "archivos": entradas})
    return referencia


def _recepcion(entrada: dict[str, object]) -> dict[str, object]:
    """Comprueba la referencia y la observación sin confundir su SHA con el del cuerpo.

    Returns:
        Metadatos originales de la recepción específica conservada.
    """
    _exigir(entrada in _entradas() and entrada.get("tipo") == "observacion_http", "captura sin procedencia conservada")
    nombre, huella = str(entrada.get("archivo")), str(entrada.get("sha256"))
    _exigir(re.fullmatch(r"observaciones/chrome-[0-9a-f]{64}\.json", nombre), "observación no válida")
    _exigir(nombre == f"observaciones/chrome-{huella}.json", "observación no vinculada")
    ruta = carpetas(FUENTE).original / nombre
    _exigir(not ruta.is_symlink() and ruta.stat().st_size <= MAX_CAPTURA, "observación no verificable")
    datos = ruta.read_bytes()
    _exigir(sha256_bytes(datos) == huella and len(datos) == entrada.get("bytes"), "observación alterada")
    documento = _objeto(leer_json(ruta))
    _exigir(
        set(documento) == {"version", "recepcion"}
        and type(documento.get("version")) is int
        and documento["version"] == VERSION_OBSERVACION,
        "versión de observación no válida",
    )
    recepcion = _objeto(documento.get("recepcion"))
    _exigir(entrada.get("descargado_utc") == recepcion.get("descargado_utc"), "fecha de observación no vinculada")
    return recepcion


def _contenido(entrada: dict[str, object]) -> dict[str, object]:
    recepcion = _recepcion(entrada)
    nombre, huella = str(recepcion.get("archivo")), str(recepcion.get("sha256"))
    _exigir(re.fullmatch(r"chrome-[0-9a-f]{64}\.json", nombre), "nombre de captura no válido")
    _exigir(nombre == f"chrome-{huella}.json" and recepcion.get("url") == URL, "procedencia no vinculada")
    ruta = carpetas(FUENTE).original / nombre
    _exigir(not ruta.is_symlink() and ruta.stat().st_size <= MAX_CAPTURA, "cuerpo no verificable")
    datos = ruta.read_bytes()
    _exigir(_indice(nombre, datos, "cuerpo_http") in _entradas(), "cuerpo sin procedencia conservada")
    _exigir(sha256_bytes(datos) == huella and len(datos) == recepcion.get("bytes"), "captura alterada")
    observado = str(recepcion.get("descargado_utc"))
    _exigir(recepcion.get("url_final") == URL, "redirección no acreditada")
    tipo = str(recepcion.get("content_type", "")).split(";", 1)[0].strip().lower()
    _exigir(tipo == "application/json", "MIME de respuesta no acreditado")
    _exigir(_instante(observado) <= _instante(ahora_utc()), "recepción futura")
    seleccion = seleccionar(datos, observado)
    completa = str(seleccion["version_completa"])
    return {
        "producto": "Chrome",
        "plataforma": "win",
        "canal": "stable",
        **seleccion,
        "version_reducida": completa.split(".")[0] + ".0.0.0",
        "perfil": perfil_web.perfil_chrome(completa),
        "observado_utc": observado,
        "original": entrada,
        "firmas": _firmas(),
    }


def _anterior_integra() -> dict[str, object]:
    """Comprueba bytes y evidencia de la anterior sin presentarla como validada con código vigente.

    Solo tolera firmas antiguas bien formadas; el resto debe ser reproducible con el contrato actual.
    Un cambio semántico incompatible exige revisión, no una migración inferida.

    Returns:
        La anterior íntegra para comparar versiones y fechas antes de una revalidación explícita.
    """
    informe = exigir_admitido(FUENTE)
    ruta = carpetas(FUENTE).validado / f"{FUENTE}.json"
    contenido = _objeto(leer_json(ruta))
    _exigir(informe.get("sha256_conjunto") == sha256(ruta), "conjunto alterado")
    firmas = _objeto(contenido.get("firmas"))
    _exigir(
        set(firmas) == set(_firmas())
        and all(isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in firmas.values()),
        "firmas anteriores no verificables",
    )
    recalculado = _contenido(_objeto(contenido.get("original")))
    _exigir(contenido == {**recalculado, "firmas": firmas}, "admisión anterior no reproducible")
    return contenido


def admitido() -> dict[str, object]:
    """Lee la última buena solo si sus bytes, evidencia, contrato y firmas siguen vigentes.

    Returns:
        Metadatos admitidos, sin renovar su fecha ni sustituir la configuración explícita del usuario.
    """
    contenido = _anterior_integra()
    _exigir(contenido.get("firmas") == _firmas(), "admisión o contrato desactualizado: requiere revalidar")
    return contenido


def _no_retroceder(candidato: dict[str, object]) -> None:
    carpeta = carpetas(FUENTE)
    if not carpeta.validacion.exists() and not (carpeta.validado / f"{FUENTE}.json").exists():
        return
    previo = _anterior_integra()
    _exigir(
        _orden(str(candidato["version_completa"])) >= _orden(str(previo["version_completa"])),
        "retroceso requiere revisión",
    )
    _exigir(
        _instante(candidato["observado_utc"]) >= _instante(previo["observado_utc"]), "captura anterior a última buena"
    )


def descargar(_aceptar_cambio: bool = False) -> None:
    """Conserva cada cuerpo y su procedencia antes de revisar contenido; el fallo no altera la última admisión."""
    descarga = descargar_url(URL, {"Accept": "application/json"})
    entrada = _registrar(descarga)
    observar_original(URL, descarga, descarga.datos)
    _exigir(descarga.url_final == URL, "redirección no acreditada")
    candidato = _contenido(entrada)
    _no_retroceder(candidato)
    _guardar(carpetas(FUENTE).preparado / "candidato.json", candidato)


def preparar() -> None:
    """Recalcula el candidato desde la última captura real, sin fabricar una fecha de consulta."""
    entradas = _entradas()
    _exigir(entradas, "sin adquisiciones")
    observaciones = [e for e in entradas if e.get("tipo") == "observacion_http"]
    _exigir(observaciones, "sin recepciones conservadas")
    # Una consulta anterior llegada tarde no gana; en el mismo instante conserva orden de adquisición.
    entrada = max(reversed(observaciones), key=lambda e: _instante(_recepcion(e).get("descargado_utc")))
    candidato = _contenido(entrada)
    _exigir(_instante(candidato["observado_utc"]) <= _instante(ahora_utc()), "recepción futura")
    _no_retroceder(candidato)
    _guardar(carpetas(FUENTE).preparado / "candidato.json", candidato)


def _promover(area: Path, destino: Path) -> None:
    """Promueve el conjunto y su informe como carpeta, recuperando excepciones observadas.

    Raises:
        RecuperacionIncompleta: Si la recuperación falla; conserva área, diario y respaldos.
    """
    diario = area / "diario.json"
    try:
        sustituir(destino.parent, area, (destino.name,), diario)
    except RecuperacionIncompleta:
        raise
    except BaseException:
        recuperar(destino.parent, (destino.name,), diario)
        raise


def _publicar(candidato: dict[str, object], controles: Controles) -> None:
    """Prepara ambos archivos completos antes de promover; no garantiza atomicidad ante muerte abrupta.

    Raises:
        FormatoInesperado: Si quedan respaldos de una operación anterior que requieren revisión.
        RecuperacionIncompleta: Si falla restaurar; el área indicada se conserva para intervenir.
    """
    destino = carpetas(FUENTE).validado
    destino.parent.mkdir(parents=True, exist_ok=True)
    _exigir(
        not any(destino.with_name(destino.name + sufijo).exists() for sufijo in (".nuevo", ".anterior")),
        "admisión anterior pendiente de recuperación",
    )
    area = Path(tempfile.mkdtemp(dir=destino.parent, prefix=f".{destino.name}-admision-"))
    conservar = False
    try:
        conjunto = area / destino.name / f"{FUENTE}.json"
        guardar_json(conjunto, candidato)
        guardar_json(
            conjunto.with_name("validacion.json"),
            {
                "estado": "Admitido: metadatos Chrome; sin activación del perfil",
                "comprobado_utc": candidato["observado_utc"],
                "controles": controles.lista,
                "sha256_conjunto": sha256(conjunto),
            },
        )
        _promover(area, destino)
    except RecuperacionIncompleta:
        conservar = True
        raise
    finally:
        if not conservar:
            shutil.rmtree(area)


def validar() -> None:
    """Admite solo el candidato reproducible y no decreciente; ante fallo conserva la última buena."""
    candidato = _objeto(leer_json(carpetas(FUENTE).preparado / "candidato.json"))
    _exigir(candidato == _contenido(_objeto(candidato.get("original"))), "preparado alterado")
    _no_retroceder(candidato)
    if carpetas(FUENTE).validacion.exists() and _anterior_integra() == candidato:
        return
    controles = Controles()
    controles.comprobar(True, "Chrome win stable completo, activo a recepción, perfil reducido y sin retroceso")
    controles.imprimir()
    controles.exigir(FUENTE)
    _publicar(candidato, controles)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta etapas explícitas; no registra ni activa la fuente.

    Returns:
        Código de salida de la interfaz común.
    """
    return principal_fuente_con_descarga(__doc__, descargar, {"preparar": preparar, "validar": validar}, argv)


if __name__ == "__main__":
    sys.exit(main())
