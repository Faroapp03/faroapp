"""Contratación y demanda de empleo por ocupación: más ficheros del visor «Treball per ocupacions» del Observatori.

El Observatori del Treball i Model Productiu publica, en el mismo visor del que `mercado/fuentes/cataluna/lector.py`
toma la contratación, más ficheros por ocupación (CNO-11 a 4 cifras) del mismo periodo:

- `C_P8_IND_COMARQUES`: los indicadores de cada ocupación en cada comarca (se guardan el Baix Llobregat y el
  Barcelonès); el paquete lleva el Baix Llobregat y los contratos de cada ocupación sumados por
  provincia. El Observatori no publica provincias: cada comarca va a la provincia de la mayoría de sus municipios,
  según la tabla del Idescat versionada en `comarca-provincia.json` (con su URL, fecha y huella);
- `C_P5_EVOL_1`, `_2` y `_3`: contratos, personas contratadas y demandantes de cada uno de los últimos 13 meses, y la
  variación interanual de la media móvil de 12 meses de contratos y de demandantes de los últimos 49 meses;
- `C_P2_MES_TOT_CAT`: los mismos indicadores para el total de Cataluña;
- los textos del visor (`assets/i18n/cat.json`), que traen su metodología: qué cuenta cada indicador.

Del fichero por ocupación de Cataluña (`C_P2_MES_IND`, que ya guarda `mercado/fuentes/cataluna/lector.py`) se leen
además la jornada parcial, la duración de los contratos temporales y las personas demandantes, sin descargarlo otra vez.

Qué cuenta cada cifra, según la metodología del visor: los contratos y las personas contratadas se asignan a la
ocupación del contrato; una persona contratada varias veces cuenta una vez. Cada demandante de empleo declara de una a
seis ocupaciones y cuenta una vez en cada una: la suma de las ocupaciones supera el total de personas. Los demandantes
no ocupados (DONO) se acercan a la definición de paro de la EPA. La validación comprueba que esas frases siguen,
literales, en la metodología del visor.

Regla de las cifras: un recuento se da tal como se publica; un porcentaje, una media o una razón, solo si su base llega
a `MIN_BASE`; una serie, solo si la ocupación tiene `MIN_SERIE` contratos o demandantes al año. El periodo no se escribe
a mano: es el de la copia vigente de `mercado/fuentes/cataluna/lector.py`, y `descargar` exige que cada fichero sea de
ese periodo. Las cifras describen al grupo de ocupación, nunca a la persona. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.observatori.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import sys
from typing import Any

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
from plataforma_datos.comun import vigencia
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    conserva_su_huella,
    controles_de_huella,
    entradas_procedencia,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
    original,
    procedencia,
    sha256_bytes,
)
from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA as COMARCAS
from plataforma_datos.comun.nucleo import Controles, OriginalCambiado, ReglaDeCambio, exigir
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.periodos import mes_anterior, mes_de, mes_iso
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga, registros_previos
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna import contenido_visor, mes_valido
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import CONTEXTO as CONTEXTO_DE_CATALUNA
from plataforma_datos.mercado.fuentes.observatori.piezas.conjunto_observatori import conjunto_validado
from plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori import (
    ADITIVOS,
    CATALUNA,
    CATALUNA_CNO4,
    CLAVE_DE_LA_METODOLOGIA,
    COMARCAS_CNO4,
    COMARCAS_DE_CATALUNA,
    DEFINICIONES,
    FICHEROS,
    FUENTE,
    LICENCIA,
    LICENCIA_TEXTO,
    MARGEN_RAZON,
    MARGEN_SUMA,
    MESES_DE_VARIACION,
    MESES_MENSUALES,
    METODOLOGIA,
    MIN_BASE,
    MIN_OCUPACIONES,
    MIN_SERIE,
    NOMBRE_FUENTE,
    NOTA_RUTA,
    ORIGINAL,
    PAGINA,
    PROCEDENCIA,
    PROVINCIAS,
    PROVINCIAS_CNO4,
    SERIES_CNO4,
    SUMAS_COMARCALES,
    TABLA_DE_PROVINCIAS,
    TEXTOS_DEL_VISOR,
    VISOR,
)
from plataforma_datos.mercado.fuentes.observatori.piezas.preparar_observatori import (
    contratos_por_provincia,
    filas_de_datos,
    filas_del_original,
    indicadores,
    metodologia,
    nombre_del_original,
    preparar_comarcas,
    preparar_series,
    provincia_de_cada_comarca,
)
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import codigos_en_cno
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Meses que trae cada fichero de serie del visor; los demás ficheros traen un solo mes.
MESES_DE_CADA_SERIE = {
    "C_P5_EVOL_1": MESES_MENSUALES,
    "C_P5_EVOL_2": MESES_DE_VARIACION,
    "C_P5_EVOL_3": MESES_DE_VARIACION,
}
MESES_DE_UN_FICHERO_DEL_MES = 1

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de descargar
# ---------------------------------------------------------------------------------------------------------------------


def _subarbol_metodologia(datos: bytes) -> dict[str, Any]:
    """El contenido metodológico cuya definición debe conservar una publicación compatible.

    Returns:
        El subárbol de textos que lee la preparación, sin la interfaz ajena.
    """
    seccion = contenido_visor(datos, TEXTOS_DEL_VISOR)
    for clave in CLAVE_DE_LA_METODOLOGIA:
        exigir(isinstance(seccion, dict) and clave in seccion, "visor: falta el subárbol de metodología")
        seccion = seccion[clave]
    exigir(isinstance(seccion, dict) and bool(seccion), "visor: metodología vacía o inválida")
    return seccion


def _comprobar_metodologia_capturada(datos: bytes, previo: dict[str, Any] | None) -> None:
    """Exige el subárbol metodológico registrado, incluso al aceptar nuevos bytes del visor."""
    nuevo = _subarbol_metodologia(datos)
    if previo and sha256_bytes(datos) == previo["sha256"]:
        return
    exigir(
        previo is not None and conserva_su_huella(ORIGINAL, previo),
        "visor: falta una metodología anterior íntegra para comprobar comparabilidad",
        OriginalCambiado,
    )
    anterior = _subarbol_metodologia((ORIGINAL / TEXTOS_DEL_VISOR).read_bytes())
    exigir(
        nuevo == anterior, "visor: ha cambiado la metodología; requiere revisión de comparabilidad", OriginalCambiado
    )


def _descargar_uno(
    archivo: dict[str, Any], periodo: str, previo: dict[str, Any] | None, aceptar_cambio: bool
) -> dict[str, Any]:
    """Descarga un fichero del visor, exige que sea del periodo y lo guarda sin sustituir en silencio la copia.

    Args:
        archivo: El original declarado (archivo y dirección).
        periodo: El periodo AAAA-MM de la copia vigente de `mercado/fuentes/cataluna/lector.py`.
        previo: Su registro en la procedencia, o None si es nuevo.
        aceptar_cambio: Si se sustituye un original que ya no coincide con su procedencia.

    Returns:
        El registro de la descarga para la procedencia.

    Raises:
        OriginalCambiado: Si el fichero no es del periodo de `mercado/fuentes/cataluna/lector.py`.
    """
    descarga = descargar_url(archivo["url"])
    fichero = archivo["url"].rsplit("/", 1)[1].removesuffix(".json")
    if fichero in FICHEROS:
        meses = meses_de(descarga.datos)
        if not _meses_del_periodo(fichero, meses, periodo):
            raise OriginalCambiado(
                f"{fichero}: el Observatori publica datos hasta {mes_iso(meses[-1])} y la copia "
                f"vigente de la fuente cataluna es de {periodo}; se registra primero la de cataluna"
            )
        filas = filas_de_datos(contenido_visor(descarga.datos, fichero), fichero)
        claves = [
            (
                fila["c_grup_primari"] if fichero != "C_P2_MES_TOT_CAT" else None,
                fila["c_comarca_42"] if fichero == "C_P8_IND_COMARQUES" else None,
                fila["c_mes"],
            )
            for fila in filas
        ]
        exigir(len(claves) == len(set(claves)), f"{fichero}: claves duplicadas")
    else:
        _comprobar_metodologia_capturada(descarga.datos, previo)
    regla = ReglaDeCambio(huella_registrada=previo["sha256"] if previo else None, aceptar_cambio=aceptar_cambio)
    datos = conservar_o_sustituir(ORIGINAL / archivo["archivo"], descarga, regla)
    observar_original(archivo["url"], descarga, datos)
    print(archivo["archivo"], len(datos), "bytes")
    return registro_descarga(archivo, descarga, datos, previo)


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar
# ---------------------------------------------------------------------------------------------------------------------


def _controles_periodo(
    controles: Controles, series: dict[str, Any], periodo: str, procedencia_del_visor: dict[str, Any]
) -> None:
    """Comprueba que todo es del periodo de la copia vigente de Cataluña, con las series completas.

    Args:
        controles: Donde se registran los controles.
        series: El resumen de las series de Cataluña.
        periodo: El periodo AAAA-MM de la copia vigente de `mercado/fuentes/cataluna/lector.py`.
        procedencia_del_visor: La procedencia de los ficheros del visor.
    """
    nombres = {entrada["archivo"] for entrada in entradas_procedencia(procedencia_del_visor)}
    esperados = {archivo["archivo"] for archivo in archivos(periodo)}
    controles.comprobar(
        esperados <= nombres,
        f"los ficheros del visor son del periodo de la copia vigente de la fuente cataluna ({periodo})",
    )
    controles.comprobar(
        len(series["meses_mensuales"]) == MESES_MENSUALES
        and len(series["meses_de_variacion"]) == MESES_DE_VARIACION
        and series["meses_de_variacion"][-1] == periodo == series["meses_mensuales"][-1]
        and set(series["valores_de_cataluna_por_mes"].values()) == {1},
        f"las series llegan a {periodo}: {MESES_MENSUALES} meses de recuentos y {MESES_DE_VARIACION} de variaciones, "
        "con un solo valor de Cataluña por mes",
    )


def _controles_cobertura(controles: Controles, filas: dict[str, list[dict[str, Any]]], cno: dict[str, Any]) -> None:
    """Ocupaciones que existen en la CNO-11, las dos comarcas completas y las series de todas las ocupaciones."""
    del_cataluna = {fila["cno11"] for fila in filas["cataluna"]}
    codigos = {fila["cno11"] for lista in filas.values() for fila in lista}
    controles.comprobar(
        codigos_en_cno(codigos, cno, "4"), f"los {len(codigos)} códigos existen en la CNO-11 a 4 cifras"
    )
    por_comarca = [{fila["cno11"] for fila in filas["comarcas"] if fila["comarca"] == comarca} for comarca in COMARCAS]
    controles.comprobar(
        len(del_cataluna) >= MIN_OCUPACIONES and all(ocupaciones == del_cataluna for ocupaciones in por_comarca),
        f"{len(del_cataluna)} ocupaciones en Cataluña y las mismas en {' y '.join(COMARCAS.values())}",
    )
    controles.comprobar(
        del_cataluna <= {fila["cno11"] for fila in filas["series"]},
        f"cada ocupación con indicadores tiene sus series ({len(filas['series'])} ocupaciones con serie)",
    )


def _controles_sumas(controles: Controles, del_cataluna: list[dict[str, Any]], sumas: list[dict[str, Any]]) -> None:
    """Contratos y demandantes de las COMARCAS_DE_CATALUNA comarcas suman, ocupación a ocupación, la de Cataluña."""
    por_codigo = {fila["cno11"]: fila for fila in del_cataluna}
    fuera = [
        f"{suma['cno11']} ({campo})"
        for suma in sumas
        for campo in ADITIVOS
        if por_codigo.get(suma["cno11"], {}).get(campo) is not None
        and abs(suma[campo] - por_codigo[suma["cno11"]][campo]) > MARGEN_SUMA
    ]
    comarcas = {suma["comarcas"] for suma in sumas}
    controles.comprobar(
        not fuera and comarcas == {COMARCAS_DE_CATALUNA},
        f"en las {len(sumas)} ocupaciones, las {COMARCAS_DE_CATALUNA} comarcas suman los contratos y los demandantes "
        "de Cataluña" + (f"; fuera: {fuera[:5]}" if fuera else ""),
    )


def _controles_provincias(
    controles: Controles,
    tabla: dict[str, Any],
    del_visor: dict[str, str],
    del_cataluna: list[dict[str, Any]],
    provincias: list[dict[str, Any]],
) -> None:
    """La tabla del Idescat nombra igual las comarcas del visor, y las provincias suman los contratos de Cataluña."""
    distintas = {
        codigo: nombre
        for codigo, nombre in del_visor.items()
        if tabla["comarcas"].get(codigo, {}).get("nombre") != nombre
    }
    destinos = {comarca["provincia"] for comarca in tabla["comarcas"].values()}
    controles.comprobar(
        not distintas
        and len(del_visor) == len(tabla["comarcas"]) == COMARCAS_DE_CATALUNA
        and destinos == set(PROVINCIAS),
        f"las {len(del_visor)} comarcas del visor están en la tabla del Idescat, con el mismo nombre, y van a "
        f"{len(destinos)} provincias" + (f"; distintas: {distintas}" if distintas else ""),
    )
    por_codigo = {fila["cno11"]: sum(fila["contratos"].values()) for fila in provincias}
    fuera = [
        fila["cno11"]
        for fila in del_cataluna
        if fila["contratos"] is not None and por_codigo.get(fila["cno11"]) != fila["contratos"]
    ]
    controles.comprobar(
        not fuera,
        f"en las {len(del_cataluna)} ocupaciones, las {len(PROVINCIAS)} provincias suman exactamente los contratos de "
        "Cataluña" + (f"; fuera: {fuera[:5]}" if fuera else ""),
    )


def _controles_coherencia(
    controles: Controles, filas: list[dict[str, Any]], total: dict[str, Any], contexto: dict[str, Any]
) -> None:
    """Cada fila cumple las definiciones de la metodología; el total coincide con el de Cataluña.

    El total de Cataluña es el que guarda `mercado/fuentes/cataluna/lector.py`.
    """
    incoherentes = [f"{fila.get('comarca', 'CAT')}·{fila['cno11']}" for fila in filas if incoherente(fila)]
    controles.comprobar(
        not incoherentes,
        "en cada fila, personas contratadas ≤ contratos, contratos por persona y contratadas por demandante cuadran "
        "con sus recuentos y las fracciones están entre 0 y 1"
        + (f"; fuera: {incoherentes[:5]}" if incoherentes else ""),
    )
    controles.comprobar(
        (total["contratos"], total["personas_contratadas"])
        == (contexto["contratos_total"], contexto["personas_contratadas_total"]),
        f"el total de Cataluña ({numero_es(total['contratos'])} contratos, {numero_es(total['personas_contratadas'])} "
        "personas contratadas) es el de la fuente cataluna",
    )


def _controles_metodologia(controles: Controles, documentada: dict[str, Any]) -> None:
    """Cada definición en que se apoya Faro sigue, literal, en la metodología del visor."""
    faltan = [campo for campo, presente in documentada["definiciones"].items() if not presente]
    controles.comprobar(
        not faltan and set(documentada["definiciones"]) == set(DEFINICIONES),
        f"las {len(DEFINICIONES)} definiciones en que se apoya Faro están, literales, en la metodología del visor "
        "(qué es una persona contratada, que cada demandante cuenta en hasta seis ocupaciones…)"
        + (f"; faltan: {faltan}" if faltan else ""),
    )


def _controles_huella_de_cataluna(controles: Controles) -> None:
    """El fichero por ocupación de Cataluña, que también se lee, conserva la huella de su procedencia.

    Es el que guarda `mercado/fuentes/cataluna/lector.py`.
    """
    nombre = cataluna.archivo_del_observatori("C_P2_MES_IND")
    entradas = [entrada for entrada in entradas_procedencia(procedencia("cataluna")) if entrada["archivo"] == nombre]
    controles.comprobar(
        len(entradas) == 1 and conserva_su_huella(carpetas("cataluna").original, entradas[0]),
        f"huella de {nombre}, de la fuente cataluna, que también se lee",
    )


# ---------------------------------------------------------------------------------------------------------------------
# El conjunto para el motor
# ---------------------------------------------------------------------------------------------------------------------


def _controles_del_conjunto(controles: Controles, conjunto: dict[str, Any], del_cataluna: list[dict[str, Any]]) -> None:
    """Ninguna razón ni porcentaje sin base suficiente, ninguna serie de una ocupación pequeña y su vigencia."""
    por_codigo = {fila["cno11"]: fila for fila in del_cataluna}
    sin_base = [
        codigo
        for codigo, cifras in conjunto["cataluna"]["cno4"].items()
        if cifras["pct_parcial"] is not None and (por_codigo[codigo]["contratos"] or 0) < MIN_BASE
    ]
    pequenas = [
        codigo
        for codigo, serie in conjunto["series"]["cno4"].items()
        if serie["contratos"] is not None and (por_codigo[codigo]["contratos"] or 0) < MIN_SERIE
    ]
    controles.comprobar(
        not sin_base and not pequenas,
        f"ningún porcentaje con menos de {MIN_BASE} contratos de base ni ninguna serie de contratos con menos de "
        f"{numero_es(MIN_SERIE)} al año ({len(conjunto['series']['cno4'])} ocupaciones con serie)",
    )
    vigencia.comprobar(controles, {"observatori": conjunto["vigencia"]})


# ---------------------------------------------------------------------------------------------------------------------
# Lectores y comprobaciones del periodo
# ---------------------------------------------------------------------------------------------------------------------


def archivos(periodo: str) -> list[dict[str, Any]]:
    """Declara los originales de un periodo: los ficheros de datos del visor y sus textos, con su dirección.

    Args:
        periodo: El periodo AAAA-MM.

    Returns:
        Cada original con su archivo, nivel, título, dirección y licencia.
    """
    datos = [
        {
            "archivo": nombre_del_original(fichero, periodo),
            "nivel": "oficial",
            "titulo": f"Observatori del Treball, Treball per ocupacions: {titulo} (a {periodo})",
            "url": f"{VISOR}/assets/datas/{fichero}.json",
            "licencia": LICENCIA,
        }
        for fichero, titulo in FICHEROS.items()
    ]
    textos = {
        "archivo": TEXTOS_DEL_VISOR,
        "nivel": "oficial",
        "titulo": "Observatori del Treball, Treball per ocupacions: textos del visor en catalán, con su metodología",
        "url": f"{VISOR}/assets/i18n/cat.json",
        "licencia": LICENCIA,
    }
    return [*datos, textos]


def meses_de(datos: bytes) -> list[int]:
    """Lee los meses de un fichero de datos del visor.

    Args:
        datos: El contenido descargado.

    Returns:
        Los meses (AAAAMM), ordenados y sin repetir; al menos uno.

    Raises:
        FormatoInesperado: Si no es JSON o no trae una lista `items` no vacía de filas con su mes `c_mes` entero.
    """
    contenido = contenido_visor(datos, "visor")
    filas = contenido.get("items") if isinstance(contenido, dict) else None
    exigir(isinstance(filas, list) and bool(filas), "el visor no devolvió una lista items con filas")
    exigir(
        all(isinstance(fila, dict) and mes_valido(fila.get("c_mes")) for fila in filas),
        "una fila del visor no tiene su mes c_mes entero",
    )
    return sorted({fila["c_mes"] for fila in filas})


def _meses_del_periodo(fichero: str, meses: list[int], periodo: str) -> bool:
    """Comprueba que los meses de un fichero terminan en el del periodo (y los de una serie, que están todos).

    Args:
        fichero: El nombre del fichero en el visor.
        meses: Sus meses (AAAAMM), ordenados; al menos uno.
        periodo: El periodo AAAA-MM.

    Returns:
        True si el último mes es el del periodo y el fichero trae los meses que le tocan.
    """
    cantidad = MESES_DE_CADA_SERIE.get(fichero, MESES_DE_UN_FICHERO_DEL_MES)
    calendario = [mes_de(mes_anterior(periodo, atras)) for atras in range(cantidad - 1, -1, -1)]
    return meses == calendario


def incoherente(fila: dict[str, Any]) -> bool:
    """Comprueba si una fila contradice sus propias definiciones.

    Args:
        fila: Una fila preparada de una ocupación.

    Returns:
        True si tiene más personas que contratos, razones mal calculadas o fracciones fuera de [0, 1].
    """
    contratos, personas = fila["contratos"] or 0, fila["personas_contratadas"] or 0
    demandantes, razon = fila["demandantes_no_ocupados_12m"] or 0, fila["contratadas_por_demandante"]
    fracciones = [valor for campo, valor in fila.items() if campo.startswith("fraccion_") and valor is not None]
    rotacion = fila["contratos_por_persona"]
    rotacion_mal = bool(personas) and rotacion is not None and abs(rotacion - contratos / personas) > MARGEN_RAZON
    razon_mal = (
        bool(demandantes) and razon is not None and abs(razon - personas / demandantes) > MARGEN_RAZON * max(razon, 1)
    )
    return personas > contratos or rotacion_mal or razon_mal or any(not 0 <= fraccion <= 1 for fraccion in fracciones)


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga los ficheros del visor, exige que sean del periodo de Cataluña y registra su procedencia.

    El periodo es el de la copia vigente de `mercado/fuentes/cataluna/lector.py`.
    """
    periodo = cataluna.periodo_archivado()
    previos = registros_previos(PROCEDENCIA)
    registros = [
        _descargar_uno(archivo, periodo, previos.get(archivo["archivo"]), aceptar_cambio)
        for archivo in archivos(periodo)
    ]
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": NOMBRE_FUENTE,
            "cita": cataluna.fuentes()["observatori"],
            "licencia": LICENCIA,
            "licencia_texto": LICENCIA_TEXTO,
            "pagina": PAGINA,
            "nota": NOTA_RUTA,
            "lee_ademas": "var/actualizacion/originales/cataluna/observatori-C_P2_MES_IND-<periodo>.json, "
            "la copia vigente de la fuente cataluna, con la huella de su procedencia",
            "archivos": registros,
        },
    )


def preparar() -> None:
    """Pasa los ficheros del visor a filas con nombres en castellano: Cataluña, comarcas, series y metodología."""
    comprobar_originales(FUENTE)
    nombre = cataluna.archivo_del_observatori("C_P2_MES_IND")
    del_cataluna = [
        {"cno11": fila["c_grup_primari"], **indicadores(fila)}
        for fila in filas_de_datos(
            contenido_visor(original("cataluna", nombre).read_bytes(), "C_P2_MES_IND"), "C_P2_MES_IND"
        )
    ]
    comarcas, sumas = preparar_comarcas()
    del_visor = filas_del_original("C_P8_IND_COMARQUES")
    provincias = contratos_por_provincia(del_visor, provincia_de_cada_comarca(leer_json(TABLA_DE_PROVINCIAS)))
    nombres = {fila["c_comarca_42"]: fila["d_comarca"] for fila in del_visor}
    series, resumen = preparar_series()
    total = indicadores(filas_del_original("C_P2_MES_TOT_CAT")[0])
    textos = contenido_visor(original(FUENTE, TEXTOS_DEL_VISOR).read_bytes(), TEXTOS_DEL_VISOR)
    guardar_jsonl(CATALUNA_CNO4, sorted(del_cataluna, key=lambda fila: fila["cno11"]))
    guardar_jsonl(COMARCAS_CNO4, comarcas)
    guardar_jsonl(SUMAS_COMARCALES, sumas)
    guardar_jsonl(SERIES_CNO4, series)
    guardar_jsonl(PROVINCIAS_CNO4, provincias)
    guardar_json(
        CATALUNA,
        {
            "cita": cataluna.fuentes()["observatori"],
            "total": total,
            "series": resumen,
            "comarcas_del_visor": dict(sorted(nombres.items())),
        },
    )
    guardar_json(METODOLOGIA, metodologia(textos))
    print(
        f"Cataluña: {len(del_cataluna)} ocupaciones · comarcas: {len(comarcas)} filas · provincias: {len(provincias)} "
        f"ocupaciones · series: {len(series)}"
    )


def validar() -> None:
    """Comprueba periodo, cobertura, sumas, coherencia y metodología, y guarda el conjunto."""
    cno = leer_validado("clasificaciones")["cno11"]
    exigir_admitido("cataluna")
    contexto = leer_json(CONTEXTO_DE_CATALUNA)
    filas = {
        "cataluna": leer_jsonl(CATALUNA_CNO4),
        "comarcas": leer_jsonl(COMARCAS_CNO4),
        "series": leer_jsonl(SERIES_CNO4),
        "provincias": leer_jsonl(PROVINCIAS_CNO4),
    }
    resumen = leer_json(CATALUNA)
    controles = Controles()
    procedencia_del_visor = leer_json(PROCEDENCIA)
    controles_de_huella(controles, ORIGINAL, procedencia_del_visor)
    _controles_huella_de_cataluna(controles)
    _controles_periodo(controles, resumen["series"], mes_iso(contexto["mes"]), procedencia_del_visor)
    _controles_cobertura(controles, filas, cno)
    _controles_sumas(controles, filas["cataluna"], leer_jsonl(SUMAS_COMARCALES))
    _controles_provincias(
        controles, leer_json(TABLA_DE_PROVINCIAS), resumen["comarcas_del_visor"], filas["cataluna"], filas["provincias"]
    )
    _controles_coherencia(controles, [*filas["cataluna"], *filas["comarcas"]], resumen["total"], contexto)
    _controles_metodologia(controles, leer_json(METODOLOGIA))
    conjunto = conjunto_validado(filas, resumen, contexto, resumen["cita"], leer_json(TABLA_DE_PROVINCIAS))
    _controles_del_conjunto(controles, conjunto, filas["cataluna"])
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "ocupaciones_cataluna": len(conjunto["cataluna"]["cno4"]),
            "ocupaciones_comarca": len(conjunto["comarca"]["cno4"]),
            "ocupaciones_con_provincias": len(conjunto["provincias"]["cno4"]),
            "ocupaciones_con_serie": len(conjunto["series"]["cno4"]),
            "ocupaciones_con_recuentos_mensuales": len(conjunto["mensual"]["cno4"]),
        },
        "limites": "Datos del grupo de ocupación, no de personas. Registros de contratos y de demandantes del Servicio "
        "Público de Empleo, sin error de muestreo pero con la ocupación que anota cada contrato o declara cada "
        "demandante: una persona demandante cuenta en cada una de sus hasta seis ocupaciones, así que las contratadas "
        "por demandante no son la probabilidad de nadie. La variación de un año no permite atribuir causas a la IA.",
        "regla": f"Recuentos tal como se publican; porcentajes, medias y razones con {MIN_BASE} o más de base; series "
        f"con {numero_es(MIN_SERIE)} o más contratos o demandantes al año.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la orden de la fuente del Observatori del Treball: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos de la línea de órdenes; sin ellos, los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
