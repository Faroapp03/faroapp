"""Biblioteca ESCO española: captura oficial, preparación y validación.

Captura completa de ocupaciones y capacidades/conocimientos de la API oficial (versión fija), preparada en JSON Lines y
en una base SQLite con búsqueda de texto completo. Python estándar; sin modelos ni claves privadas. Las consultas a la
base (buscar, ficha, relaciones) están en consultas.py.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.esco.lector {descargar,preparar,validar,todo}
"""

import json
import math
import sqlite3
import sys
import tempfile
import time
import zipfile
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    guardar_json,
    guardar_jsonl,
    guardar_validacion,
    json_compacto,
    leer_json,
    requerir,
    sha256,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    CON_ERRORES,
    ArchivoFaltante,
    Controles,
    ErrorFuente,
    HuellaIncorrecta,
    ValidacionFallida,
    exigir,
    leer_del_zip,
)
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.ocupaciones.fuentes.esco.piezas.base_esco import base_integra as _integra
from plataforma_datos.ocupaciones.fuentes.esco.piezas.base_esco import construir_base
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import (
    API,
    ARCHIVO,
    ATRIBUCION_CAPTURA,
    BASE,
    CABECERAS_API,
    CONSULTA_INEXISTENTE,
    CONSULTA_MALICIOSA,
    CONSULTAS_CONOCIDAS,
    CONTROL_CONSULTAS,
    CONTROL_PREPARADOS,
    CONTROLES_CAPTURA,
    ESTADO_ADMITIDO,
    FECHA_ZIP,
    FUENTE,
    HILOS,
    IDIOMA,
    INFORME,
    INTEGRIDAD_CORRECTA,
    INTENTOS,
    LIMITES_CAPTURA,
    MAX_RESULTADOS_DE_LA_VERIFICACION,
    META_FIJA,
    NIVEL_COMPRESION_ZIP,
    ORIGINAL,
    PERMISOS_ZIP,
    POR_PAGINA,
    PREFIJO_URI,
    PREPARADOS,
    PROCEDENCIA,
    SEGUNDOS_API,
    SISTEMA_ZIP_UNIX,
    TIPOS_API,
    URL_AVISO_LEGAL,
    URL_DOCUMENTACION_API,
    VERIFICACION_CORRECTA,
    VERSION,
)
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import (
    buscar,
    conexion,
    ficha,
    ocupaciones_por_competencia,
)
from plataforma_datos.ocupaciones.fuentes.esco.piezas.registros_esco import (
    LecturaDeLaCaptura,
    Registros,
    campos_ausentes,
    metricas,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de descargar
# ---------------------------------------------------------------------------------------------------------------------


def _url_pagina(tipo: str, pagina: int) -> tuple[str, dict[str, Any]]:
    """Dirección de una página de la búsqueda de la API y sus parámetros (versión fija, en español y completa).

    Returns:
        La dirección y los parámetros de la página.
    """
    parametros = {
        "type": tipo,
        "language": IDIOMA,
        "selectedVersion": VERSION,
        "full": "true",
        "viewObsolete": "false",
        "limit": POR_PAGINA,
        # ESCO usa «offset» como índice de página, no como desplazamiento de registros.
        "offset": pagina,
    }
    return API + "?" + urlencode(parametros), parametros


def _pagina_guardada(ruta: Path, ruta_meta: Path, url: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Página ya descargada, comprobando que no ha cambiado desde que se guardó.

    Returns:
        Los metadatos y el contenido de la página guardada.
    """
    crudo = ruta.read_bytes()
    meta = json.loads(ruta_meta.read_text(encoding="utf-8"))
    intacta = meta["sha256"] == sha256_bytes(crudo) and meta["url"] == url
    exigir(intacta, f"página guardada alterada: {ruta.name}", HuellaIncorrecta)
    return meta, json.loads(crudo)


def _descargar_pagina(ruta: Path, ruta_meta: Path, tipo: str, pagina: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """Descarga una página, comprueba que viene completa y la guarda junto a sus metadatos.

    Returns:
        Los metadatos y el contenido de la página descargada.
    """
    url, parametros = _url_pagina(tipo, pagina)
    descarga = descargar_url(url, dict(CABECERAS_API), SEGUNDOS_API)
    respuesta = json.loads(descarga.datos)
    filas, total = respuesta["_embedded"]["results"], respuesta["total"]
    esperadas = min(POR_PAGINA, total - pagina * POR_PAGINA)
    exigir(len(filas) == esperadas, f"página incompleta: {ruta.name}")
    meta = {
        "archivo": ruta.name,
        "tipo": tipo,
        "url": url,
        "url_final": descarga.url_final,
        "parametros": parametros,
        "sha256": sha256_bytes(descarga.datos),
        "registros": len(filas),
        "total_api": total,
        "content_type": descarga.content_type,
        "descargado_utc": ahora_utc(),
    }
    ruta.write_bytes(descarga.datos)
    ruta_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta, respuesta


def _pedir_pagina(carpeta: Path, tipo: str, pagina: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """Descarga una página de la API (con reintentos) y la guarda con sus metadatos; reutiliza la ya guardada.

    Returns:
        Los metadatos y el contenido de la página.
    """
    nombre = f"{tipo}-{pagina:03d}.json"
    ruta, ruta_meta = carpeta / nombre, carpeta / (nombre + ".meta")
    if ruta.exists() and ruta_meta.exists():
        return _pagina_guardada(ruta, ruta_meta, _url_pagina(tipo, pagina)[0])
    for intento in range(INTENTOS - 1):
        try:
            return _descargar_pagina(ruta, ruta_meta, tipo, pagina)
        except (OSError, ValueError, KeyError, ErrorFuente):
            # Se reintenta tras una espera creciente (1, 2, 4… segundos) para no insistir sobre una API saturada.
            time.sleep(2**intento)
    # El último intento, fuera del bucle, deja pasar su error a quien llama.
    return _descargar_pagina(ruta, ruta_meta, tipo, pagina)


def _capturar_tipo(carpeta: Path, tipo: str) -> tuple[int, list[dict[str, Any]]]:
    """Descarga todas las páginas de un tipo y comprueba que cada URI aparece una sola vez.

    Returns:
        El total que declara la API y los metadatos de cada página descargada.
    """
    meta_primera, primera = _pedir_pagina(carpeta, tipo, 0)
    total = primera["total"]
    vistas: set[str] = set()
    entradas = []

    def aceptar(meta: dict[str, Any], pagina: dict[str, Any]) -> None:
        """Anota las URI de una página, sin admitir repetidas, y registra su entrada en la procedencia."""
        exigir(pagina["total"] == total, f"el total de {tipo} cambió durante la captura")
        for registro in pagina["_embedded"]["results"]:
            uri = registro["uri"]
            exigir(uri.startswith(PREFIJO_URI.format(tipo)) and uri not in vistas, f"URI incorrecta o repetida: {uri}")
            vistas.add(uri)
        entradas.append(meta)
        print(tipo, len(vistas), "/", total, flush=True)

    aceptar(meta_primera, primera)
    with ThreadPoolExecutor(max_workers=HILOS) as hilos:
        paginas = range(1, math.ceil(total / POR_PAGINA))
        pendientes = [hilos.submit(_pedir_pagina, carpeta, tipo, pagina) for pagina in paginas]
        for tarea in as_completed(pendientes):
            aceptar(*tarea.result())
    exigir(len(vistas) == total, f"captura incompleta de {tipo}: {len(vistas)} de {total}")
    return total, entradas


def _entrada_zip(nombre: str) -> zipfile.ZipInfo:
    """Cabecera de una página dentro del ZIP con fecha, permisos y sistema fijos: no depende del disco ni del equipo.

    Returns:
        La cabecera de la entrada, comprimida con DEFLATE.
    """
    entrada = zipfile.ZipInfo(nombre, date_time=FECHA_ZIP)
    entrada.compress_type = zipfile.ZIP_DEFLATED
    entrada.external_attr = PERMISOS_ZIP
    entrada.create_system = SISTEMA_ZIP_UNIX
    return entrada


def _procedencia_captura(totales: dict[str, int], zip_temporal: Path, entradas: list[dict[str, Any]]) -> dict[str, Any]:
    """Procedencia de la captura: versión, totales de la API, huella del ZIP y metadatos de cada página.

    Returns:
        La procedencia que se guarda junto a la captura.
    """
    return {
        **META_FIJA,
        "version_solicitada": VERSION,
        "version_explicita_en_respuesta": None,
        "idioma_preparado": IDIOMA,
        "total_api": totales,
        "archivo": ARCHIVO.name,
        "sha256": sha256(zip_temporal),
        "entradas": entradas,
        "condiciones_url": URL_AVISO_LEGAL,
        "documentacion_api": URL_DOCUMENTACION_API,
        "atribucion": ATRIBUCION_CAPTURA,
        "limites": LIMITES_CAPTURA,
    }


def empaquetar(carpeta: Path, nombres: list[str], destino: Path) -> Path:
    """Reúne las páginas descargadas en un ZIP reproducible: en orden de nombre y con cabeceras fijas.

    Dos capturas con las mismas páginas dan el mismo ZIP byte a byte (con la misma versión de zlib, que es la que
    comprime), así que su huella solo cambia si cambia alguna página.

    Returns:
        La ruta del ZIP escrito, `destino`.
    """
    with zipfile.ZipFile(destino, "w") as captura:
        for nombre in sorted(nombres):
            datos = (carpeta / nombre).read_bytes()
            captura.writestr(_entrada_zip(nombre), datos, compresslevel=NIVEL_COMPRESION_ZIP)
    return destino


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de la lectura de la captura
# ---------------------------------------------------------------------------------------------------------------------


def _paginas(meta: dict[str, Any]) -> Iterator[tuple[dict[str, Any], list[dict[str, Any]]]]:
    """Recorre las páginas del ZIP comprobando huella, totales y parámetros de cada una.

    Yields:
        Los metadatos y los resultados de cada página, en el orden del ZIP.
    """
    with zipfile.ZipFile(ARCHIVO) as captura:
        registradas = {entrada["archivo"] for entrada in meta["entradas"]}
        exigir(set(captura.namelist()) == registradas, "contenido del ZIP inesperado")
        for entrada in meta["entradas"]:
            crudo = leer_del_zip(captura, entrada["archivo"])
            exigir(sha256_bytes(crudo) == entrada["sha256"], "página alterada: " + entrada["archivo"], HuellaIncorrecta)
            pagina = json.loads(crudo)
            filas = pagina["_embedded"]["results"]
            totales_coherentes = (
                pagina["total"] == meta["total_api"][entrada["tipo"]] and len(filas) == entrada["registros"]
            )
            exigir(totales_coherentes, "totales inconsistentes en " + entrada["archivo"])
            parametros = entrada["parametros"]
            parametros_correctos = (
                parametros["full"] == "true" and parametros["selectedVersion"] == meta["version_solicitada"]
            )
            exigir(parametros_correctos, "parámetros incorrectos")
            yield entrada, filas


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar
# ---------------------------------------------------------------------------------------------------------------------


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar
# ---------------------------------------------------------------------------------------------------------------------


def _comprobar_indices(base: sqlite3.Connection, tabla: str, filas: list[dict[str, Any]]) -> None:
    """Las columnas indexadas y el índice de texto completo coinciden con las fichas."""
    columna = "codigo_esco" if tabla == "ocupaciones" else "tipo"
    for fila in filas:
        guardada = base.execute(
            f"SELECT titulo_es,{columna},descripcion_es,alternativos_json FROM {tabla} WHERE uri=?", (fila["uri"],)
        ).fetchone()
        esperada = (
            fila["titulo_es"],
            fila[columna],
            fila["descripcion_es"],
            json_compacto(fila["nombres_alternativos_es"]),
        )
        exigir(tuple(guardada) == esperada, f"columna indexada incorrecta: {fila['uri']}", ValidacionFallida)
    consulta = f"SELECT uri,titulo_es,alternativos,descripcion_es FROM busqueda_{tabla}"
    indice = {tuple(guardada) for guardada in base.execute(consulta)}
    esperado = {
        (fila["uri"], fila["titulo_es"], "\n".join(fila["nombres_alternativos_es"]), fila["descripcion_es"])
        for fila in filas
    }
    exigir(indice == esperado, "el índice de texto no coincide con las fichas", ValidacionFallida)


def _comprobar_claves_relacion(base: sqlite3.Connection, relaciones: list[dict[str, Any]]) -> None:
    """Las claves de la tabla de relaciones coinciden con las del preparado."""
    consulta = "SELECT ocupacion_uri,competencia_uri,tipo FROM relaciones"
    claves = {tuple(guardada) for guardada in base.execute(consulta)}
    esperadas = {(relacion["ocupacion_uri"], relacion["competencia_uri"], relacion["tipo"]) for relacion in relaciones}
    exigir(claves == esperadas, "claves de relación inconsistentes", ValidacionFallida)


def _comprobar_tabla(base: sqlite3.Connection, tabla: str, ruta: Path, esperado: list[dict[str, Any]]) -> None:
    """Un preparado coincide con la captura, y su tabla SQLite, con el preparado."""
    actual = [json.loads(linea) for linea in requerir(ruta).read_text(encoding="utf-8").splitlines()]
    exigir(actual == esperado, f"preparado distinto de la fuente: {ruta.name}", ValidacionFallida)
    en_base = {guardada[0] for guardada in base.execute(f"SELECT registro_json FROM {tabla}")}
    iguales = len(en_base) == len(actual) and en_base == {json_compacto(fila) for fila in actual}
    exigir(iguales, f"SQLite distinta del preparado: {tabla}", ValidacionFallida)
    if tabla == "relaciones":
        _comprobar_claves_relacion(base, actual)
    else:
        _comprobar_indices(base, tabla, actual)


def _comprobar_integridad(_datos: dict[str, list[dict[str, Any]]]) -> None:
    """Comprueba la integridad de la base SQLite y sus claves foráneas.

    Args:
        _datos: Registros de la captura; no se usan, la firma es la común de las comprobaciones de `_intentar`.

    Raises:
        ValidacionFallida: Si la base no supera la comprobación de integridad.
    """
    with conexion() as base:
        exigir(_integra(base), "integridad SQLite", ValidacionFallida)


def _comprobar_preparados(datos: dict[str, list[dict[str, Any]]]) -> None:
    """Comprueba que preparados y base SQLite coinciden íntegramente con lo que se lee de la captura.

    Args:
        datos: Registros de la captura, por tabla.
    """
    with conexion() as base:
        for tabla, ruta in PREPARADOS.items():
            _comprobar_tabla(base, tabla, ruta, datos[tabla])


def _comprobar_consultas(datos: dict[str, list[dict[str, Any]]]) -> None:
    """Consultas directas, por denominación alternativa, inversas y resistentes a entradas maliciosas."""
    for palabra in CONSULTAS_CONOCIDAS:
        exigir(bool(buscar(palabra)), f"búsqueda sin resultado: {palabra}", ValidacionFallida)
    for tipo in TIPOS_API:
        muestra = next(fila for fila in datos[tipo] if fila["nombres_alternativos_es"])
        alternativa = muestra["nombres_alternativos_es"][0]
        encontradas = {fila["uri"] for fila in buscar(alternativa, tipo, MAX_RESULTADOS_DE_LA_VERIFICACION)}
        exigir(muestra["uri"] in encontradas, "no recupera una denominación alternativa", ValidacionFallida)
        exigir(
            not buscar(CONSULTA_INEXISTENTE, tipo) and not buscar("", tipo), "resultados espurios", ValidacionFallida
        )
        # Basta con que no falle: la consulta se pasa como parámetro, nunca dentro del SQL.
        buscar(CONSULTA_MALICIOSA, tipo)
    candidata = buscar(CONSULTAS_CONOCIDAS[0])[0]
    detalle = ficha(candidata["codigo_esco"])
    exigir(
        bool(detalle["descripcion_es"] and detalle["competencias_relacionadas"]), "ficha incompleta", ValidacionFallida
    )
    relacion = detalle["competencias_relacionadas"][0]["relacion"]
    inversa = {fila["ocupacion"]["uri"] for fila in ocupaciones_por_competencia(relacion["competencia_uri"])}
    exigir(candidata["uri"] in inversa, "consulta inversa incorrecta", ValidacionFallida)


def _intentar(
    comprobacion: Callable[[dict[str, list[dict[str, Any]]]], None], datos: dict[str, list[dict[str, Any]]]
) -> str:
    """Ejecuta una comprobación que lanza su motivo al fallar; devuelve ese motivo, o el texto vacío si se cumple.

    Returns:
        El motivo del fallo, o el texto vacío si la comprobación se cumple.
    """
    try:
        comprobacion(datos)
    except (ErrorFuente, sqlite3.Error) as error:
        return str(error)
    return ""


def _controles(registros: Registros) -> tuple[Controles, list[str], str]:
    """Ejecuta los controles de la verificación integral.

    La integridad de SQLite se comprueba primero y aparte, para que el informe diga lo medido; si falla, los
    preparados no se comparan con la base.

    Args:
        registros: Registros leídos de la captura.

    Returns:
        Los controles en el formato común `{control, resultado}`, los motivos de fallo y el resultado de la
        integridad de SQLite («ok» o el motivo por el que no se supera).
    """
    controles = Controles()
    for descripcion in CONTROLES_CAPTURA:
        controles.comprobar(True, descripcion)
    integridad = _intentar(_comprobar_integridad, registros.datos)
    motivo_preparados = integridad or _intentar(_comprobar_preparados, registros.datos)
    motivo_consultas = _intentar(_comprobar_consultas, registros.datos)
    controles.comprobar(not motivo_preparados, CONTROL_PREPARADOS)
    controles.comprobar(not motivo_consultas, CONTROL_CONSULTAS)
    motivos = [motivo for motivo in (motivo_preparados, motivo_consultas) if motivo]
    return controles, motivos, integridad or INTEGRIDAD_CORRECTA


def _informe(registros: Registros, controles: Controles, motivos: list[str], integridad: str) -> dict[str, Any]:
    """Compone el contenido de `validacion.json`: estado, resultado de la verificación, cobertura, huellas y límites.

    Las relaciones sin resolver y las inversas discrepantes valen 0 porque la lectura de la captura
    (`LecturaDeLaCaptura.comprobar_coherencia`) se detiene ante la primera: sin ella no se llega a escribir el
    informe.

    Args:
        registros: Registros leídos de la captura.
        controles: Controles de la verificación integral.
        motivos: Motivos de los controles que fallan.
        integridad: Resultado de la integridad de SQLite, de `_controles`.

    Returns:
        El informe de validación.
    """
    meta = registros.meta
    verificacion = VERIFICACION_CORRECTA if controles.admitido else "Con errores: " + "; ".join(motivos)
    return {
        "estado": ESTADO_ADMITIDO if controles.admitido else CON_ERRORES,
        "comprobado_utc": ahora_utc(),
        "verificacion_integral": verificacion,
        "version_solicitada": meta["version_solicitada"],
        "total_api": meta["total_api"],
        "cobertura": registros.metricas,
        "relaciones_no_resueltas": 0,
        "relaciones_inversas_discrepantes": 0,
        "integridad_sqlite": integridad,
        "sha256_original": meta["sha256"],
        "sha256_preparados": {ruta.name: sha256(ruta) for ruta in PREPARADOS.values()},
        "sha256_sqlite": sha256(BASE),
        "controles": controles.lista,
        "limite": "No valida pertinencia para un relato personal ni estima el impacto de IA. No incluye todas las "
        "taxonomías auxiliares de ESCO ni cursos.",
        "campos_ausentes_en_origen": campos_ausentes(registros.datos),
        "verificacion_integral_utc": ahora_utc(),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Lectura de la captura
# ---------------------------------------------------------------------------------------------------------------------


def registros_origen() -> Registros:
    """Lee y comprueba la captura completa: cada registro conserva su página y fila de origen.

    Returns:
        Los metadatos, los registros por tabla y sus métricas.
    """
    meta = leer_json(PROCEDENCIA)
    exigir(sha256(requerir(ARCHIVO)) == meta["sha256"], "huella original incorrecta", HuellaIncorrecta)
    lectura = LecturaDeLaCaptura(meta)
    for entrada, filas in _paginas(meta):
        anadir = lectura.ocupacion if entrada["tipo"] == TIPOS_API["ocupaciones"] else lectura.competencia
        for posicion, concepto in enumerate(filas, 1):
            anadir(concepto, entrada, posicion)
    lectura.comprobar_coherencia()
    return Registros(meta, lectura.datos, metricas(lectura.datos))


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """Captura completa de la API oficial en un ZIP con su procedencia; una captura existente se conserva."""
    if ARCHIVO.exists() and PROCEDENCIA.exists():
        print(
            f"ESCO: ya existe la captura {VERSION} ({ARCHIVO.name}); se conserva. Una versión nueva se captura aparte."
        )
        return
    # Una captura registrada cuyo ZIP falta no se rehace: la API no fija sus respuestas, así que una captura nueva no
    # sería la validada. Se restaura la copia archivada o se registra aparte como versión nueva.
    exigir(
        not ARCHIVO.exists() and not PROCEDENCIA.exists(),
        "captura incompleta: falta el ZIP o su procedencia; restaurar la copia archivada de la captura registrada",
        ArchivoFaltante,
    )
    with tempfile.TemporaryDirectory(prefix="faro-esco-descarga-") as temporal:
        carpeta = Path(temporal)
        entradas: list[dict[str, Any]] = []
        totales = {}
        for tipo in TIPOS_API.values():
            totales[tipo], nuevas = _capturar_tipo(carpeta, tipo)
            entradas += nuevas
        entradas.sort(key=lambda entrada: entrada["archivo"])
        nombres = [entrada["archivo"] for entrada in entradas]
        zip_temporal = empaquetar(carpeta, nombres, carpeta / ARCHIVO.name)
        ORIGINAL.mkdir(parents=True, exist_ok=True)
        ARCHIVO.write_bytes(zip_temporal.read_bytes())
        guardar_json(PROCEDENCIA, _procedencia_captura(totales, zip_temporal, entradas))
        print("Captura completa:", totales)


def preparar() -> None:
    """Genera los tres JSON Lines y la base SQLite a partir de la captura comprobada."""
    registros = registros_origen()
    with tempfile.TemporaryDirectory(prefix="faro-esco-base-") as temporal:
        base_temporal = Path(temporal) / BASE.name
        construir_base(base_temporal, registros.meta, registros.datos)
        for clave, ruta in PREPARADOS.items():
            guardar_jsonl(ruta, registros.datos[clave])
        BASE.parent.mkdir(parents=True, exist_ok=True)
        # El temporal de construcción puede estar en otro volumen; la sustitución final debe ser local.
        parcial = BASE.with_name(f".{BASE.name}.parcial")
        try:
            parcial.write_bytes(base_temporal.read_bytes())
            parcial.replace(BASE)
        finally:
            parcial.unlink(missing_ok=True)
    print(json.dumps(registros.metricas, ensure_ascii=False, indent=2))


def validar() -> None:
    """Verificación integral: captura, preparados, base SQLite y consultas locales; guarda el informe."""
    registros = registros_origen()
    controles, motivos, integridad = _controles(registros)
    guardar_validacion(INFORME, _informe(registros, controles, motivos, integridad))
    controles.imprimir()
    controles.exigir(FUENTE)
    print(json.dumps(registros.metricas, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
