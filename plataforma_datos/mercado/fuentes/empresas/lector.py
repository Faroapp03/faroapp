"""Uso de la IA en las empresas por sector: Encuesta sobre el uso de TIC y del comercio electrónico en las empresas.

La ETICCE del INE es la encuesta oficial del uso de las TIC en las empresas de España; Eurostat publica la misma
encuesta, armonizada en toda la UE (`isoc_eb_ain2`), con algún sector más detallado. Se guardan, de la edición
vigente:

- INE: el % de empresas de 10 o más personas que usan alguna tecnología de inteligencia artificial (pregunta E.1),
  por agrupación de actividad y tamaño (España), por comunidad autónoma y gran sector (Cataluña) y en las empresas de
  menos de 10 personas (España), con la tabla de errores de muestreo que publica el INE;
- Eurostat: el mismo indicador (`E_AI_TANY`) para España, con sus marcas de fiabilidad;
- Eurostat por región (`isoc_r_eb_ain2`, Cataluña es la región NUTS 2 ES51): el mismo indicador en Cataluña por
  sección de actividad, los tres últimos años, con su marca. Una cifra poco fiable no se da como firme.

Con ellos, una tabla de paso lleva cada división de la CNAE-09 (2 cifras) a la agrupación más detallada que la mide, y
con los sectores del Censo 2021 (`mercado/fuentes/sectores/lector.py`) se calcula qué parte de cada grupo de ocupación
trabaja en sectores que la encuesta mide. No se hace ninguna media ponderada por grupo: el % de empresas de un sector no
dice qué hace cada persona, y las empresas grandes, que usan más la IA, emplean a más gente.

La edición no se escribe a mano. `descargar` lee en INEbase la página de resultados de la operación, encuentra la
edición más reciente (por el año del «primer trimestre» de sus capítulos) y, en cada capítulo, la tabla «Inteligencia
artificial». Otra edición avanza si conserva la definición y las categorías de las tablas guardadas. Un cambio de
definición requiere revisar el contrato, también con `--aceptar-cambio`: ese flag solo acepta bytes nuevos. Eurostat
publica con su propio periodo; una consulta fallida solo permite conservar originales previamente admitidos
y verificados.
La fuente compuesta queda con comprobación remota parcial y sin rejuvenecer las fechas de Eurostat.
La ampliación de plantilla TIC reutiliza los capítulos de actividad y comunidades: conserva por separado cada serie,
base, unidad y periodo en el bloque plantilla_tic. Sus dos variables sin año propio mantienen el periodo compuesto
del capítulo, sin atribuirles un año o trimestre único. Ese bloque no se exporta al informe. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.empresas.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import hashlib
import json
import re
import sys
from datetime import date
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit

import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
from plataforma_datos.comun import vigencia
from plataforma_datos.comun.dia_de_consulta import dia_de_consulta
from plataforma_datos.comun.entrada_salida import (
    Json,
    ahora_utc,
    comprobar_originales,
    controles_de_huella,
    entradas_procedencia,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
    ruta_del_conjunto,
)
from plataforma_datos.comun.estadisticas import API_TEMPUS, CITA_INE, LICENCIA_INE, LICENCIA_TEXTO_INE
from plataforma_datos.comun.estadisticas import SITIO_INE as INEBASE
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, ReglaDeCambio, exigir
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga, registros_previos
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine, plantilla_tic
from plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas import (
    agregados_eurostat,
    cifras_de_cataluna,
    cifras_tempus,
    conjunto,
    divisiones_existentes,
    filas_eurostat,
    filas_eurostat_cataluna,
    filas_ine,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    ANIOS_DE_CATALUNA,
    CAPITULOS,
    EDICION,
    EUROSTAT,
    EUROSTAT_API,
    EUROSTAT_CATALUNA,
    EUROSTAT_CATALUNA_API,
    EUROSTAT_CATALUNA_DOI,
    EUROSTAT_CATALUNA_FILTRO,
    EUROSTAT_DOI,
    EUROSTAT_FILTRO,
    FUENTE,
    INE,
    LICENCIA_EUROSTAT,
    LICENCIA_EUROSTAT_TEXTO,
    NOMBRE_FUENTE,
    ORIGINAL,
    PREPARADO,
    PROCEDENCIA,
    RESULTADOS,
    SIN_PUBLICAR_EN_EUROSTAT,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.controles_empresas import (
    comprobar_cataluna,
    comprobar_contraste,
    comprobar_disponibilidad,
    comprobar_paso,
    comprobar_serie_cataluna,
    comprobar_tablas,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.periodos_empresas import (
    ConsultaEurostatFallida,
    comprobar_continuidad,
    contraste_pendiente,
    fechas_del_original,
    filas_publicadas,
    leer_respuesta,
    periodos_del_original,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido
from plataforma_datos.orquestacion.cobertura_originales import leer_archivo
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de descargar
# ---------------------------------------------------------------------------------------------------------------------


def _descargar_eurostat(
    archivo: dict[str, Any], previos: dict[str, Any], aceptar_cambio: bool
) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    """El original de Eurostat y su fecha de actualización, o nada si Eurostat aún no publica ese año.

    Returns:
        El registro de descarga y las fechas de actualización y de consulta; (None, None) si Eurostat aún no
        publica ese año.

    Raises:
        HTTPError: Si Eurostat responde con un error que no significa «aún sin publicar».
        FormatoInesperado: Si la respuesta no es una tabla válida o desaparece un año publicado.
    """
    previo = previos.get(archivo["archivo"])
    try:
        descarga = descargar_url(archivo["url"])
    except HTTPError as error:
        if error.code in SIN_PUBLICAR_EN_EUROSTAT:
            exigir(previo is None, f"{FUENTE}: Eurostat deja de ofrecer un año ya publicado ({archivo['archivo']})")
            return None, None
        raise
    try:
        tabla = json.loads(descarga.datos)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise FormatoInesperado(f"{FUENTE}: Eurostat no devuelve JSON válido ({archivo['archivo']})") from error
    exigir(
        isinstance(tabla, dict) and isinstance(tabla.get("value"), (dict, list)),
        f"{FUENTE}: Eurostat no devuelve una tabla con valores ({archivo['archivo']})",
    )
    if not tabla["value"]:
        exigir(previo is None, f"{FUENTE}: Eurostat deja vacío un año ya publicado ({archivo['archivo']})")
        return None, None
    actualizado = tabla.get("updated")
    exigir(isinstance(actualizado, str), f"{FUENTE}: Eurostat no da su fecha de actualización")
    try:
        fecha = date.fromisoformat(actualizado[:10]).isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"{FUENTE}: Eurostat da una fecha de actualización inválida: {actualizado}") from error
    regla = ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio)
    datos = conservar_o_sustituir(ORIGINAL / archivo["archivo"], descarga, regla)
    observar_original(archivo["url"], descarga, datos)
    registro = registro_descarga(archivo, descarga, datos, previo)
    return registro, {"actualizado": fecha, "consulta": dia_de_consulta(registro["descargado_utc"])}


# ---------------------------------------------------------------------------------------------------------------------
# La edición: dónde publica el INE sus tablas y cuál es la más reciente
# ---------------------------------------------------------------------------------------------------------------------


class _EnlacesINE(HTMLParser):
    """Lee enlaces HTML con texto anidado sin buscar cierres mediante expresiones regulares."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.encontrados: list[tuple[str, str]] = []
        self.direccion: str | None = None
        self.textos: list[str] = []

    def handle_starttag(self, etiqueta: str, atributos: list[tuple[str, str | None]]) -> None:
        if etiqueta == "a":
            self.direccion = dict(atributos).get("href")
            self.textos = []
        elif self.direccion is not None:
            self.textos.append(" ")

    def handle_endtag(self, etiqueta: str) -> None:
        if etiqueta == "a" and self.direccion is not None:
            texto = " ".join("".join(self.textos).split())
            self.encontrados.append((self.direccion, texto))
            self.direccion = None
        elif self.direccion is not None:
            self.textos.append(" ")

    def handle_data(self, texto: str) -> None:
        if self.direccion is not None:
            self.textos.append(texto)


def enlaces(pagina: str) -> list[tuple[str, str]]:
    """Los enlaces de INEbase como (dirección, texto), con entidades y etiquetas HTML resueltas.

    Returns:
        Los enlaces completos en el orden de la página; uno sin cierre no se interpreta como capítulo.
    """
    lector = _EnlacesINE()
    lector.feed(pagina)
    lector.close()
    return lector.encontrados


def direccion_del_ine(direccion: str) -> str:
    """La dirección completa de un enlace leído en INEbase, que solo puede llevar al propio sitio del INE por https.

    El enlace sale de una página descargada y luego se descarga: si apuntara a otro sitio, a otro puerto o con
    credenciales, la cadena pediría lo que dicta la página (CWE-918). En ese caso se detiene.

    Returns:
        La dirección https completa del enlace.
    """
    completa = urljoin(f"{INEBASE}/", direccion)
    partes, sitio = urlsplit(completa), urlsplit(INEBASE)
    exigir(
        (partes.scheme, partes.netloc) == (sitio.scheme, sitio.netloc),
        f"{FUENTE}: un enlace de la página de resultados lleva fuera de {INEBASE}: {direccion}",
    )
    return completa


def capitulos(pagina: str) -> tuple[int | None, dict[str, str]]:
    """El año de la edición más reciente y la dirección de cada capítulo que trae una tabla de IA.

    Returns:
        El año de la edición (None si no hay ninguna) y la dirección de cada capítulo, por parte.
    """
    por_anio: dict[int, dict[str, str]] = {}
    anio_del_bloque: int | None = None
    for direccion, texto in enlaces(pagina):
        for parte, (patron, _) in CAPITULOS.items():
            coincidencia = re.search(patron, texto)
            if coincidencia is None or "capsel=" not in direccion:
                continue
            if coincidencia.groups():
                anio_del_bloque = int(coincidencia.group(1))
            # El capítulo de errores no repite el año: pertenece al bloque de capítulos que lo precede.
            if anio_del_bloque is not None:
                del_anio = por_anio.setdefault(anio_del_bloque, {})
                completa = direccion_del_ine(direccion)
                exigir(
                    parte not in del_anio or del_anio[parte] == completa,
                    f"{FUENTE}: capítulos distintos para {parte} en {anio_del_bloque}",
                )
                del_anio[parte] = completa
    anio = max(por_anio, default=None)
    return anio, por_anio[anio] if anio is not None else {}


def tabla_del_capitulo(pagina: str, titulo: str) -> str | None:
    """El número (tpx) de la tabla de un capítulo cuyo enlace empieza por ese título.

    Returns:
        El número de la tabla, o None si el capítulo no la trae.
    """
    for direccion, texto in enlaces(pagina):
        coincidencia = re.search(r"Tabla\.htm\?tpx=(\d+)", direccion)
        if coincidencia and texto.casefold().startswith(titulo.casefold()):
            return coincidencia.group(1)
    return None


def archivo_de_descubrimiento(parte: str, direccion: str) -> dict[str, str]:
    """El original HTML de una sonda del INE, con nombre cerrado y licencia.

    Returns:
        El descriptor para guardar y comprobar la página de resultados o un capítulo de la encuesta.
    """
    exigir(parte in {"resultados", *CAPITULOS}, f"{FUENTE}: parte de descubrimiento desconocida {parte}")
    exigir(parte != "resultados" or direccion == RESULTADOS, f"{FUENTE}: índice de descubrimiento inesperado")
    nombre = "resultados" if parte == "resultados" else f"capitulo-{parte}"
    return {
        "archivo": f"ine-eticce-{nombre}.html",
        "nivel": "oficial",
        "titulo": f"INE, ETICCE: descubrimiento de edición ({parte})",
        "url": direccion_del_ine(direccion),
        "licencia": LICENCIA_INE,
    }


def edicion_publicada(*, guardar_descubrimiento: bool = False) -> dict[str, Any]:
    """Sonda: la edición más reciente de INEbase, con el número de su tabla de IA en cada parte.

    Returns:
        El año y el nombre de la edición y el número de su tabla de IA, por parte.
    """
    registros: list[dict[str, Any]] = []
    previos = registros_previos(PROCEDENCIA) if guardar_descubrimiento else {}

    def pagina(parte: str, direccion: str) -> str:
        archivo = archivo_de_descubrimiento(parte, direccion)
        descarga = descargar_url(archivo["url"])
        if guardar_descubrimiento:
            ORIGINAL.mkdir(parents=True, exist_ok=True)
            previo = previos.get(archivo["archivo"])
            datos = conservar_o_sustituir(
                ORIGINAL / archivo["archivo"], descarga, ReglaDeCambio(None, previo["sha256"] if previo else None, True)
            )
            observar_original(archivo["url"], descarga, datos)
            registros.append(registro_descarga(archivo, descarga, datos, previo))
        return descarga.datos.decode("utf-8", "strict")

    anio, direcciones = capitulos(pagina("resultados", RESULTADOS))
    exigir(anio is not None and set(direcciones) == set(CAPITULOS), f"{FUENTE}: la página de resultados ha cambiado")
    tablas: dict[str, str] = {}
    paginas = {}
    for parte, direccion in direcciones.items():
        paginas[parte] = pagina(parte, direccion)
        tabla = tabla_del_capitulo(paginas[parte], CAPITULOS[parte][1])
        exigir(tabla is not None, f"{FUENTE}: el capítulo «{parte}» ya no trae la tabla de IA")
        tablas[parte] = tabla
    return {
        "anio": anio,
        "nombre": f"{anio - 1}–1T{anio}",
        "tablas": tablas,
        **descubrir_plantilla(anio, paginas),
        **({"_descubrimiento": registros} if guardar_descubrimiento else {}),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descubrir_plantilla(anio: int, paginas: dict[str, str]) -> dict[str, Json]:
    """Reutiliza los capítulos de actividad y comunidades para descubrir la ampliación TIC.

    Returns:
        Bloque revisado, o vacío para históricos y capítulos sin esa ampliación. Una tabla aislada se rechaza.
    """
    if anio < contrato_eticce.PRIMERA_EDICION_REVISADA:
        return {}
    tablas = {}
    for parte in plantilla_tic.PARTES:
        candidatos = {
            coincidencia[1]
            for direccion, texto in enlaces(paginas[parte])
            if texto.casefold() == plantilla_tic.TITULO.casefold()
            and (coincidencia := re.search(r"Tabla\.htm\?tpx=(\d+)", direccion))
        }
        exigir(len(candidatos) <= 1, "empresas: capítulo con tablas TIC ambiguas")
        tablas[parte] = next(iter(candidatos), None)
    if not any(tablas.values()):
        return {}
    return {"plantilla_tic": plantilla_tic.metadatos(f"{anio - 1}–1T{anio}", tablas)}


def archivos_del_ine(edicion: dict[str, Any]) -> list[dict[str, Any]]:
    """Los originales del INE de una edición: una tabla de Tempus por parte.

    Returns:
        Una entrada por parte con su archivo, su dirección y su licencia.
    """
    return [
        {
            "archivo": f"ine-eticce-{edicion['anio']}-{parte}.json",
            "nivel": "oficial",
            "titulo": f"INE, ETICCE {edicion['nombre']}, tabla {tabla} ({CAPITULOS[parte][1]}, "
            f"{parte.replace('_', ' ')})",
            "url": f"{API_TEMPUS}/{tabla}?tip=AM",
            "licencia": LICENCIA_INE,
        }
        for parte, tabla in sorted(edicion["tablas"].items())
    ]


def archivo_de_eurostat(anio: int) -> dict[str, Any]:
    """El original de Eurostat de un año: el indicador E_AI_TANY para España, empresas de 10 o más personas.

    Returns:
        La entrada del original con su archivo, su dirección y su licencia.
    """
    return {
        "archivo": f"eurostat-isoc_eb_ain2-ES-{anio}.json",
        "nivel": "oficial",
        "titulo": f"Eurostat, isoc_eb_ain2: empresas que usan alguna tecnología de IA por actividad, España, {anio}",
        "url": f"{EUROSTAT_API}?{EUROSTAT_FILTRO}&time={anio}",
        "licencia": LICENCIA_EUROSTAT,
    }


def archivo_de_eurostat_cataluna(anio: int) -> dict[str, Any]:
    """El original de Eurostat por región: el indicador E_AI_TANY en Cataluña (ES51), los tres años hasta `anio`.

    Returns:
        La entrada del original con su archivo, su dirección y su licencia.
    """
    anios = range(anio - ANIOS_DE_CATALUNA + 1, anio + 1)
    return {
        "archivo": f"eurostat-isoc_r_eb_ain2-ES51-{anios[0]}-{anio}.json",
        "nivel": "oficial",
        "titulo": f"Eurostat, isoc_r_eb_ain2: empresas que usan alguna tecnología de IA por actividad, Cataluña "
        f"(ES51), {anios[0]}–{anio}",
        "url": f"{EUROSTAT_CATALUNA_API}?{EUROSTAT_CATALUNA_FILTRO}"
        + "".join(f"&time={de_la_serie}" for de_la_serie in anios),
        "licencia": LICENCIA_EUROSTAT,
    }


def archivo_de_notas(parte: str, edicion: dict[str, Any]) -> dict[str, str]:
    """Descriptor de las notas oficiales que fijan el denominador de cada tabla.

    Returns:
        Original HTML identificado por parte y edición.
    """
    return {
        "archivo": f"ine-eticce-{edicion['anio']}-{parte}-notas.html",
        "nivel": "oficial",
        "titulo": f"INE ETICCE {edicion['nombre']}: notas de {parte}",
        "url": f"{INEBASE}/jaxi/Tabla.htm?tpx={edicion['tablas'][parte]}&L=0",
        "licencia": LICENCIA_INE,
    }


def archivo_de_eurostat_disponible(regional: bool) -> dict[str, Any]:
    """Consulta los periodos publicados sin exigir que coincidan con el año del INE.

    Returns:
        Descriptor de una consulta con territorio y medida cerrados, sin filtro de año.
    """
    api, filtro, territorio, tabla = (
        (EUROSTAT_CATALUNA_API, EUROSTAT_CATALUNA_FILTRO, "ES51", "isoc_r_eb_ain2")
        if regional
        else (EUROSTAT_API, EUROSTAT_FILTRO, "ES", "isoc_eb_ain2")
    )
    return {
        "nivel": "oficial",
        "licencia": LICENCIA_EUROSTAT,
        "archivo": f"eurostat-{tabla}-{territorio}-publicados.json",
        "titulo": f"Eurostat {tabla}: periodos publicados, {territorio}, empresas que utilizan IA",
        "url": f"{api}?{filtro}",
    }


def _descargar_notas(parte: str, edicion: dict[str, Any], previos: dict[str, Any]) -> dict[str, Any]:
    """Comprueba las notas antes de conservar el original que acredita el denominador.

    Returns:
        Registro vinculado al cuerpo oficial validado.
    """
    archivo = archivo_de_notas(parte, edicion)
    descarga = descargar_url(archivo["url"])
    contrato_eticce.comprobar_notas(parte, descarga.datos.decode("utf-8", "strict"))
    previo = previos.get(archivo["archivo"])
    datos = conservar_o_sustituir(
        ORIGINAL / archivo["archivo"], descarga, ReglaDeCambio(None, previo["sha256"] if previo else None, True)
    )
    observar_original(archivo["url"], descarga, datos)
    return registro_descarga(archivo, descarga, datos, previo)


def _descargar_plantilla(
    edicion: dict[str, Json], previos: dict[str, dict[str, Json]], aceptar_cambio: bool
) -> list[dict[str, Json]]:
    """Descarga y contrasta las dos tablas TIC y sus notas antes de registrar su procedencia.

    Returns:
        Registros de los cuatro cuerpos oficiales comprobados.
    """
    if "plantilla_tic" not in edicion:
        return []
    registros = []
    for parte, archivo, notas in zip(
        sorted(edicion["plantilla_tic"]["tablas"]),
        plantilla_tic.archivos(edicion),
        plantilla_tic.archivos(edicion, notas=True),
        strict=True,
    ):
        for descriptor, es_nota in ((archivo, False), (notas, True)):
            respuesta = descargar_url(descriptor["url"])
            finales = {descriptor["url"], descriptor["url"].replace("/js/", "/jsCache/", 1)}
            exigir(respuesta.url_final in finales, "empresas: URL final TIC distinta de la tabla prevista")
            if es_nota:
                plantilla_tic.comprobar_notas(parte, respuesta.datos.decode("utf-8", "strict"))
            else:
                plantilla_tic.comprobar_series(parte, json.loads(respuesta.datos), edicion)
            previo = previos.get(descriptor["archivo"])
            datos = conservar_o_sustituir(
                ORIGINAL / descriptor["archivo"],
                respuesta,
                ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio),
            )
            observar_original(descriptor["url"], respuesta, datos)
            registros.append(registro_descarga(descriptor, respuesta, datos, previo))
    return registros


def _filas_plantilla(edicion: dict[str, Json]) -> list[dict[str, Json]]:
    """Relee datos y notas de la ampliación desde originales que pertenecen a esta edición.

    Returns:
        Filas sin agregación, reproducibles desde los originales públicos.
    """
    if "plantilla_tic" not in edicion:
        return []
    filas = []
    for parte, archivo, notas in zip(
        sorted(edicion["plantilla_tic"]["tablas"]),
        plantilla_tic.archivos(edicion),
        plantilla_tic.archivos(edicion, notas=True),
        strict=True,
    ):
        series = leer_json(original(FUENTE, archivo["archivo"]))
        pagina = original(FUENTE, notas["archivo"]).read_text(encoding="utf-8")
        filas.extend(plantilla_tic.normalizar(parte, series, pagina, edicion))
    return filas


def _descriptor_previo(procedencia: dict[str, Any], regional: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resuelve únicamente nombres y consultas oficiales previstos, incluidos los originales históricos.

    Returns:
        Descriptor esperado y metadatos originales, sin convertir una consulta filtrada en una consulta histórica.
    """
    campo = "eurostat_cataluna" if regional else "eurostat"
    meta = procedencia.get(campo)
    exigir(isinstance(meta, dict), "empresas: no existe un original previo de Eurostat para continuar")
    anio = meta.get("anio", procedencia["edicion"]["anio"])
    historico = archivo_de_eurostat_cataluna(anio) if regional else archivo_de_eurostat(anio)
    publicado = archivo_de_eurostat_disponible(regional)
    nombre = meta.get("archivo", historico["archivo"])
    candidatos = {d["archivo"]: d for d in (historico, publicado)}
    exigir(nombre in candidatos, "empresas: el original previo no corresponde a una consulta Eurostat prevista")
    return candidatos[nombre], meta


def _continuar_eurostat(
    procedencia: dict[str, Any], regional: bool, fallo: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Conserva solo un original íntegro que reproduce las cifras de un conjunto admitido.

    Returns:
        El registro histórico sin cambios y su periodo propio, con el fallo actual documentado por separado.
    """
    descriptor, meta = _descriptor_previo(procedencia, regional)
    registros = {r["archivo"]: r for r in entradas_procedencia(procedencia)}
    registro = registros[descriptor["archivo"]]
    exigir(
        registro["url"] == descriptor["url"] and registro["url_final"] == descriptor["url"],
        "empresas: la URL histórica de Eurostat no coincide con su consulta prevista",
    )
    datos = leer_archivo(ORIGINAL, descriptor["archivo"], 1 << 20)
    exigir(
        len(datos) == registro["bytes"] and hashlib.sha256(datos).hexdigest() == registro["sha256"],
        "empresas: el original previo de Eurostat no coincide con su huella",
    )
    tabla = leer_respuesta(Descarga(datos, registro["url_final"], registro["content_type"]), descriptor["url"])
    conjunto_anterior = leer_json(ruta_del_conjunto(FUENTE))
    prueba = {
        "edicion": procedencia["edicion"]["nombre"],
        "validacion": exigir_admitido(FUENTE),
        "registro": registro,
        "actualizacion": {k: meta[k] for k in ("actualizado", "consulta")},
        "publicado": conjunto_anterior["cataluna_por_seccion" if regional else "eurostat"],
    }
    anios = comprobar_continuidad(tabla, prueba, regional)
    nombre = f"eurostat-continuidad-{'ES51' if regional else 'ES'}-admitida.json"
    guardar_json(ORIGINAL / nombre, prueba)
    cuerpo = leer_archivo(ORIGINAL, nombre, 1 << 20)
    return registro, {
        **prueba["actualizacion"],
        "anio": anios[-1],
        "anios": anios,
        "anios_disponibles": periodos_del_original(tabla, "ES51" if regional else "ES"),
        "archivo": descriptor["archivo"],
        "consulta_actual": fallo,
        "continuidad": {"archivo": nombre, "sha256": hashlib.sha256(cuerpo).hexdigest(), "bytes": len(cuerpo)},
    }


def _eurostat_independiente(
    regional: bool, procedencia: dict[str, Any], aceptar_cambio: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Valida una consulta actual o conserva un original admitido ante un fallo de transporte o de sintaxis JSON.

    Un cambio de NACE, pregunta, estructura o ventana incompleta detiene la actualización; no activa continuidad.

    Returns:
        Registro del original realmente utilizado y metadatos de su consulta propia.
    """
    descriptor = archivo_de_eurostat_disponible(regional)
    fallo = {"estado": "fallo_consulta", "url": descriptor["url"], "consultado_utc": ahora_utc()}
    try:
        descarga = descargar_url(descriptor["url"])
    except (HTTPError, URLError, TimeoutError) as error:
        fallo.update(tipo=type(error).__name__, detalle=str(error))
        return _continuar_eurostat(procedencia, regional, fallo)
    exigir(descarga.url_final == descriptor["url"], "empresas: URL final de Eurostat distinta de la prevista")
    try:
        tabla = leer_respuesta(descarga, descriptor["url"])
    except ConsultaEurostatFallida as error:
        fallo.update(
            tipo="respuesta_no_json",
            detalle=str(error),
            respuesta_sha256=hashlib.sha256(descarga.datos).hexdigest(),
            bytes=len(descarga.datos),
            content_type=descarga.content_type,
            url_final=descarga.url_final,
        )
        return _continuar_eurostat(procedencia, regional, fallo)
    _, anios = filas_publicadas(tabla, "ES51" if regional else "ES")
    previo_meta = procedencia.get("eurostat_cataluna" if regional else "eurostat")
    if previo_meta:
        exigir(anios[-1] >= previo_meta.get("anio", procedencia["edicion"]["anio"]), "empresas: Eurostat retrocede")
    previos = {r["archivo"]: r for r in entradas_procedencia(procedencia)} if procedencia else {}
    previo = previos.get(descriptor["archivo"])
    datos = conservar_o_sustituir(
        ORIGINAL / descriptor["archivo"],
        descarga,
        ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio),
    )
    observar_original(descriptor["url"], descarga, datos)
    registro = registro_descarga(descriptor, descarga, datos, previo)
    return registro, {
        **fechas_del_original(tabla, registro),
        "anio": anios[-1],
        "anios": anios,
        "anios_disponibles": periodos_del_original(tabla, "ES51" if regional else "ES"),
        "archivo": descriptor["archivo"],
        "consulta_actual": {"estado": "correcta", "url": descriptor["url"], "consultado_utc": ahora_utc()},
    }


def definicion_ine_de_series(series: list[dict[str, Any]]) -> list[tuple[tuple[str, str], ...]]:
    """Las variables y categorías de cada serie; ignora valores, fechas y nombres redundantes de la serie.

    Returns:
        La estructura semántica ordenada, incluidas las tecnologías de IA y la pregunta del error de referencia.
    """
    cifras = cifras_tempus(series)
    firmas = [tuple(sorted(cifra.variables.items())) for cifra in cifras]
    exigir(bool(firmas) and len(set(firmas)) == len(firmas), f"{FUENTE}: definición INE vacía o con series repetidas")
    return sorted(firmas)


def descargar(aceptar_cambio: bool = False) -> None:
    """Descubre la edición y acepta nuevos valores con el contrato guardado.

    Raises:
        FormatoInesperado: Si retrocede la edición, cambia su definición o el INE no da JSON válido.
    """
    publicada = dict(edicion_publicada(guardar_descubrimiento=True))
    descubrimiento = publicada.pop("_descubrimiento", [])
    procedencia_anterior = leer_json(PROCEDENCIA) if PROCEDENCIA.exists() else {}
    anterior = procedencia_anterior.get("edicion")
    exigir(
        not anterior
        or (
            publicada["anio"] >= anterior["anio"] and ("plantilla_tic" not in anterior or "plantilla_tic" in publicada)
        ),
        "empresas: la edición retrocede o pierde la ampliación TIC conservada; revisar antes de admitir",
    )
    ORIGINAL.mkdir(parents=True, exist_ok=True)
    previos = registros_previos(PROCEDENCIA)
    registros: list[dict[str, Any]] = []
    anteriores = dict(zip(sorted(anterior["tablas"]), archivos_del_ine(anterior), strict=True)) if anterior else {}
    contratos_revisados: list[bool] = []
    for parte, archivo in zip(sorted(publicada["tablas"]), archivos_del_ine(publicada), strict=True):
        descarga = descargar_url(archivo["url"])
        try:
            series = json.loads(descarga.datos)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise FormatoInesperado(f"{FUENTE}: el INE no devuelve JSON válido en {parte}") from error
        firma = definicion_ine_de_series(series)
        revisado = contrato_eticce.definicion_conocida(parte, firma)
        contratos_revisados.append(revisado)
        if anterior and not revisado:
            previo_archivo = anteriores.get(parte)
            exigir(previo_archivo is not None, f"{FUENTE}: cambia la definición de las partes de ETICCE")
            exigir(
                firma == definicion_ine_de_series(leer_json(ORIGINAL / previo_archivo["archivo"])),
                f"{FUENTE}: cambia la definición del INE en {parte}; revisar el contrato antes de admitirla",
            )
        previo = previos.get(archivo["archivo"])
        datos = conservar_o_sustituir(
            ORIGINAL / archivo["archivo"],
            descarga,
            ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio),
        )
        observar_original(archivo["url"], descarga, datos)
        registros.append(registro_descarga(archivo, descarga, datos, previo))
        if revisado:
            registros.append(_descargar_notas(parte, publicada, previos))
    exigir(
        not any(contratos_revisados) or all(contratos_revisados),
        "empresas: las partes del INE mezclan contratos distintos",
    )
    if all(contratos_revisados):
        publicada["contrato_ine"] = contrato_eticce.IDENTIFICADOR
        europa, actualizacion = _eurostat_independiente(False, procedencia_anterior, aceptar_cambio)
        cataluna, actualizacion_cataluna = _eurostat_independiente(True, procedencia_anterior, aceptar_cambio)
    else:
        europa, actualizacion = _descargar_eurostat(archivo_de_eurostat(publicada["anio"]), previos, aceptar_cambio)
        cataluna, actualizacion_cataluna = _descargar_eurostat(
            archivo_de_eurostat_cataluna(publicada["anio"]), previos, aceptar_cambio
        )
    registros.extend(
        [
            *_descargar_plantilla(publicada, previos, aceptar_cambio),
            *calendario_ine.descargar(ORIGINAL, publicada["anio"], previos),
        ]
    )
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": f"{CITA_INE} (ETICCE, edición {publicada['nombre']}). Eurostat, isoc_eb_ain2 ({EUROSTAT_DOI}) e "
            f"isoc_r_eb_ain2 ({EUROSTAT_CATALUNA_DOI}).",
            "licencia": f"INE: {LICENCIA_INE} Eurostat: {LICENCIA_EUROSTAT}",
            "licencia_texto": {"ine": LICENCIA_TEXTO_INE, "eurostat": LICENCIA_EUROSTAT_TEXTO},
            "edicion": {**publicada, "encontrada_en": RESULTADOS},
            "eurostat": actualizacion,
            "eurostat_cataluna": actualizacion_cataluna,
            **({"descubrimiento": descubrimiento} if descubrimiento else {}),
            "archivos": [*registros, *(archivo for archivo in (europa, cataluna) if archivo)],
        },
    )
    print(
        f"edición {publicada['nombre']}: {len(registros)} tablas del INE · Eurostat: {'sí' if europa else 'aún no'} · "
        f"Cataluña por sección: {'sí' if cataluna else 'aún no'}"
    )


def _preparar_eurostat_independiente(procedencia: dict[str, Any], regional: bool) -> list[dict[str, Any]]:
    """Recalcula el periodo desde el original; no confía en un año escrito en la procedencia.

    Returns:
        Filas comprobadas con el periodo propio de Eurostat.
    """
    campo, territorio = ("eurostat_cataluna", "ES51") if regional else ("eurostat", "ES")
    descriptor, actualizacion = _descriptor_previo(procedencia, regional)
    registrados = {r["archivo"]: r for r in entradas_procedencia(procedencia)}
    registro = registrados[descriptor["archivo"]]
    datos = leer_archivo(ORIGINAL, descriptor["archivo"], 1 << 20)
    exigir(
        registro["url"] == descriptor["url"]
        and registro["url_final"] == descriptor["url"]
        and len(datos) == registro["bytes"]
        and hashlib.sha256(datos).hexdigest() == registro["sha256"],
        "empresas: el original de Eurostat no conserva su consulta o su cuerpo registrados",
    )
    tabla = leer_respuesta(Descarga(datos, registro["url_final"], registro["content_type"]), descriptor["url"])
    exigir(
        all(actualizacion.get(k) == v for k, v in fechas_del_original(tabla, registro).items()),
        "empresas: las fechas de Eurostat no coinciden con el original utilizado",
    )
    filas, anios = filas_publicadas(tabla, territorio)
    exigir(
        actualizacion.get("anios_disponibles") == periodos_del_original(tabla, territorio),
        "empresas: los periodos observados no coinciden con el original de Eurostat",
    )
    exigir(
        (actualizacion.get("anio"), actualizacion.get("anios"), actualizacion.get("archivo"))
        == (anios[-1], anios, descriptor["archivo"]),
        f"empresas: el periodo declarado de Eurostat {territorio} no coincide con el original",
    )
    continuidad = actualizacion.get("continuidad")
    if continuidad is not None:
        nombre = f"eurostat-continuidad-{territorio}-admitida.json"
        exigir(continuidad["archivo"] == nombre, "empresas: nombre de prueba de continuidad ajeno")
        cuerpo = leer_archivo(ORIGINAL, nombre, 1 << 20)
        exigir(
            len(cuerpo) == continuidad["bytes"] and hashlib.sha256(cuerpo).hexdigest() == continuidad["sha256"],
            "empresas: cambia la prueba de continuidad admitida de Eurostat",
        )
        prueba = json.loads(cuerpo)
        registrados = {r["archivo"]: r for r in entradas_procedencia(procedencia)}
        exigir(prueba["registro"] == registrados[descriptor["archivo"]], "empresas: cambia el original continuado")
        exigir(
            prueba["actualizacion"] == {k: actualizacion[k] for k in ("actualizado", "consulta")},
            "empresas: cambian las fechas históricas de Eurostat",
        )
        comprobar_continuidad(tabla, prueba, regional)

    return filas


def _filas_ine_revisadas(edicion: dict[str, Any]) -> list[dict[str, Any]]:
    """Recalcula las filas desde originales con firma y notas comprobadas.

    Returns:
        Todas las filas de D.1 y del error D.1.A del contrato revisado.
    """
    filas: list[dict[str, Any]] = []
    for parte, archivo in zip(sorted(edicion["tablas"]), archivos_del_ine(edicion), strict=True):
        series = leer_json(original(FUENTE, archivo["archivo"]))
        exigir(
            contrato_eticce.definicion_conocida(parte, definicion_ine_de_series(series)),
            "empresas: el original no cumple su contrato",
        )
        notas = original(FUENTE, archivo_de_notas(parte, edicion)["archivo"]).read_text(encoding="utf-8")
        contrato_eticce.comprobar_notas(parte, notas)
        filas.extend(filas_ine(parte, cifras_tempus(series)))
    return filas


def _comprobar_preparados_revisados(
    procedencia: dict[str, Any], edicion: dict[str, Any], preparados: dict[str, list[dict[str, Any]]]
) -> None:
    """Impide atribuir al candidato filas o fechas distintas de las verificadas en sus originales."""
    esperada = {
        **procedencia["edicion"],
        "eurostat": procedencia.get("eurostat"),
        "eurostat_cataluna": procedencia.get("eurostat_cataluna"),
    }
    exigir(edicion == esperada, "empresas: los metadatos preparados no coinciden con su procedencia")
    exigir(preparados["ine"] == _filas_ine_revisadas(edicion), "empresas: las cifras preparadas no reproducen el INE")
    for campo, regional in (("eurostat", False), ("eurostat_cataluna", True)):
        exigir(
            preparados[campo] == _preparar_eurostat_independiente(procedencia, regional),
            f"empresas: las filas preparadas no reproducen el original de {campo}",
        )


def preparar() -> None:
    """Pasa las tablas a filas: la pregunta E.1 de cada parte del INE, sus errores y los agregados de Eurostat."""
    comprobar_originales(FUENTE)
    procedencia = leer_json(PROCEDENCIA)
    edicion = procedencia["edicion"]
    filas = []
    if contrato_eticce.es_contrato_2026(edicion):
        filas = _filas_ine_revisadas(edicion)
        filas_europa = _preparar_eurostat_independiente(procedencia, False)
        filas_cataluna = _preparar_eurostat_independiente(procedencia, True)
    else:
        for parte, archivo in zip(sorted(edicion["tablas"]), archivos_del_ine(edicion), strict=True):
            filas.extend(filas_ine(parte, cifras_tempus(leer_json(original(FUENTE, archivo["archivo"])))))
        archivo_europa = archivo_de_eurostat(edicion["anio"])["archivo"]
        archivo_cataluna = archivo_de_eurostat_cataluna(edicion["anio"])["archivo"]
        registrados = {entrada["archivo"] for entrada in entradas_procedencia(procedencia)}
        filas_europa = (
            filas_eurostat(leer_json(original(FUENTE, archivo_europa)), edicion["anio"])
            if archivo_europa in registrados
            else []
        )
        filas_cataluna = (
            filas_eurostat_cataluna(
                leer_json(original(FUENTE, archivo_cataluna)),
                set(range(edicion["anio"] - ANIOS_DE_CATALUNA + 1, edicion["anio"] + 1)),
            )
            if archivo_cataluna in registrados
            else []
        )
    if "plantilla_tic" in edicion:
        guardar_jsonl(PREPARADO / "plantilla-tic.jsonl", _filas_plantilla(edicion))
    guardar_jsonl(INE, filas)
    guardar_jsonl(EUROSTAT, filas_europa)
    guardar_jsonl(EUROSTAT_CATALUNA, filas_cataluna)
    guardar_json(
        EDICION,
        {**edicion, "eurostat": procedencia.get("eurostat"), "eurostat_cataluna": procedencia.get("eurostat_cataluna")},
    )
    print(
        f"INE: {len(filas)} cifras · Eurostat: {len(filas_europa)} agregados · Cataluña: {len(filas_cataluna)} cifras"
    )


def validar() -> None:
    """Valida con una sola captura de los contratos y vincula esos bytes a su admisión."""
    edicion = leer_json(EDICION)
    if contrato_eticce.es_contrato_2026(edicion):
        with contrato_eticce.recursos_en_uso(incluir_plantilla="plantilla_tic" in edicion) as recursos:
            _validar(recursos)
    else:
        _validar(None)


def _plantilla_validada(edicion: dict[str, Json], procedencia: dict[str, Json]) -> dict[str, Json] | None:
    """Contrasta las filas preparadas con los originales y conserva su procedencia explícita.

    Returns:
        Bloque independiente de D.1 y Eurostat, o None para conjuntos anteriores sin ampliación.
    """
    if "plantilla_tic" not in edicion:
        return None
    esperadas = _filas_plantilla(edicion)
    recibidas = leer_jsonl(PREPARADO / "plantilla-tic.jsonl")
    exigir(plantilla_tic.mismas_filas(esperadas, recibidas), "empresas: las filas TIC no reproducen sus originales")
    descriptores = [*plantilla_tic.archivos(edicion), *plantilla_tic.archivos(edicion, notas=True)]
    registros = {r["archivo"]: r for r in entradas_procedencia(procedencia)}
    for descriptor in descriptores:
        exigir(descriptor["archivo"] in registros, "empresas: falta procedencia de plantilla TIC")
        registro = registros[descriptor["archivo"]]
        finales = {descriptor["url"], descriptor["url"].replace("/js/", "/jsCache/", 1)}
        exigir(registro["url"] == descriptor["url"] and registro["url_final"] in finales, "empresas: origen TIC ajeno")
    definicion = plantilla_tic.contrato()
    return {
        "contrato": plantilla_tic.IDENTIFICADOR,
        "clasificacion": definicion["clasificacion"],
        "poblacion": definicion["poblacion"],
        "originales": [registros[d["archivo"]] for d in descriptores],
        "filas": esperadas,
    }


def _validar(recursos: dict[str, str] | None) -> None:
    """Comprueba las tablas, contrasta INE y Eurostat, construye la tabla de paso y guarda el conjunto."""
    # La tabla de paso usa las divisiones de los sectores: esa fuente tiene que estar admitida.
    exigir_admitido("sectores")
    existentes = divisiones_existentes()
    filas, filas_europa, edicion = leer_jsonl(INE), leer_jsonl(EUROSTAT), leer_json(EDICION)
    filas_cataluna = leer_jsonl(EUROSTAT_CATALUNA)
    controles = Controles()
    procedencia = leer_json(PROCEDENCIA)
    if contrato_eticce.es_contrato_2026(edicion):
        _comprobar_preparados_revisados(
            procedencia, edicion, {"ine": filas, "eurostat": filas_europa, "eurostat_cataluna": filas_cataluna}
        )
    plantilla = _plantilla_validada(edicion, procedencia)
    controles_de_huella(controles, ORIGINAL, procedencia)
    controles_de_huella(controles, ORIGINAL, {"archivos": procedencia.get("descubrimiento", [])})
    comprobar_tablas(controles, filas, edicion)
    comprobar_disponibilidad(controles, filas_europa, edicion.get("eurostat"), "España")
    comprobar_disponibilidad(controles, filas_cataluna, edicion.get("eurostat_cataluna"), "Cataluña")
    controles.comprobar(
        bool(filas_europa)
        and bool(filas_cataluna)
        and bool(edicion.get("eurostat"))
        and bool(edicion.get("eurostat_cataluna")),
        (
            "Eurostat: España y Cataluña tienen originales publicados, cada uno con su periodo propio"
            if contrato_eticce.es_contrato_2026(edicion)
            else "Eurostat: España y Cataluña de la edición deben estar publicados para admitir empresas"
        ),
    )
    datos = conjunto(filas, filas_europa, filas_cataluna, edicion, existentes)
    if plantilla is not None:
        datos["plantilla_tic"] = plantilla
    agrupaciones = datos["agrupaciones_ine"]
    comprobar_paso(controles, datos, existentes)
    seccion = datos["cataluna_por_seccion"]
    if contrato_eticce.es_contrato_2026(edicion):
        datos["eurostat"]["contraste"] = contraste_pendiente(edicion, "eurostat")
        if seccion:
            comprobar_serie_cataluna(controles, seccion, filas_cataluna, edicion["eurostat_cataluna"]["anio"])
            seccion["contraste"] = contraste_pendiente(edicion, "eurostat_cataluna")
    else:
        comprobar_contraste(controles, agrupaciones, agregados_eurostat(filas_europa, existentes), filas_europa)
        sectores_ine = cifras_de_cataluna(filas, agrupaciones)["sectores"]
        comprobar_cataluna(controles, seccion, filas_cataluna, sectores_ine, edicion["anio"])
    vigencia.comprobar(
        controles,
        {
            "ine": datos["vigencia"],
            **({"eurostat": datos["eurostat"]["vigencia"]} if datos["eurostat"]["vigencia"] else {}),
            **({"eurostat_cataluna": seccion["vigencia"]} if seccion else {}),
        },
    )
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "edicion": edicion["nombre"],
            **(
                {"plantilla_tic": {"contrato": plantilla_tic.IDENTIFICADOR, "filas": len(plantilla["filas"])}}
                if plantilla is not None
                else {}
            ),
            "agrupaciones_ine": len(agrupaciones),
            "agregados_eurostat": len(datos["eurostat"]["agregados"]),
            "divisiones_en_la_tabla_de_paso": len(datos["paso"]),
            "cataluna_por_seccion": {"agregados": len(seccion["actividades"]), "anios": seccion["anios"]}
            if seccion
            else None,
        },
        "limites": "Describe empresas, no personas ni su empresa: una empresa cuenta si usa al menos una tecnología de "
        "IA, sin decir cuántos puestos toca. Empresas de 10 o más personas; sin la Administración, la educación, la "
        "sanidad y los servicios sociales, las actividades financieras ni los hogares. Encuesta: el INE solo publica "
        "el error de muestreo de una pregunta concreta de IA, que se guarda como referencia y no como cota. "
        "Cataluña por sección "
        "(Eurostat, ES51): una cifra poco fiable no se da como firme.",
        "controles": controles.lista,
        **({"recursos_de_validacion": recursos} if recursos is not None else {}),
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: datos)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si todo va bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
