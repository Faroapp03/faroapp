"""Preparación de la acreditación: textos del BOE, códigos de ocupación, cada certificado y lo registrado a mano."""

import re
import unicodedata
from collections import defaultdict
from typing import Any, NamedTuple

from plataforma_datos.comun import boe, pdf
from plataforma_datos.comun.entrada_salida import entradas_procedencia, original, procedencia
from plataforma_datos.comun.hojas import leer_xls
from plataforma_datos.comun.nucleo import ErrorFuente, FormatoInesperado, exigir
from plataforma_datos.comun.textos_y_cifras import codigo, texto, texto_sin_controles_de_windows
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    ARCHIVO_CNO94,
    EQUIVALENCIAS,
    FUENTE,
    HORAS_NIVEL_1,
    LARGO_CODIGO_OFICIAL,
    LEY,
    MIN_PARECIDO_MISMO_CODIGO,
    PALABRAS_VACIAS,
    PASAJES,
    REGLAMENTO,
    Texto,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga import (
    numero_del_archivo,
    orden_de_numero,
    real_decreto_del_soc,
)

# La CNO-11 entró en vigor en 2011 (Real Decreto 1591/2010): un código de 8 cifras anterior es del SISPE de la CNO-94.
PRIMER_ANIO_CNO11 = 2011

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar: los textos del BOE
# ---------------------------------------------------------------------------------------------------------------------


class Encontrado(NamedTuple):
    """Un anexo de certificado y el texto del que sale."""

    texto: Texto
    anexo: boe.Anexo


def registrados() -> list[dict[str, Any]]:
    """Las entradas de la procedencia: cada original con su dirección y su huella.

    Returns:
        La lista de entradas registradas, en el orden del archivo.
    """
    return entradas_procedencia(procedencia(FUENTE))


def _lineas(archivo: str) -> list[str]:
    """Las líneas de un original del BOE, comprobado con su huella: su HTML o su PDF sin cabeceras de página.

    Returns:
        Las líneas del texto, en orden.
    """
    contenido = original(FUENTE, archivo).read_bytes()
    return boe.texto_de_html(contenido) if archivo.endswith(".html") else boe.sin_cabeceras(pdf.texto(contenido))


def textos_de_los_reales_decretos() -> tuple[list[Texto], dict[str, str | None]]:
    """El texto de cada real decreto de certificados (consolidado y, si se descargó, PDF) y su número según su título.

    La fecha de cada real decreto sale del título de su texto consolidado; su PDF la comparte.

    Returns:
        Los textos de los reales decretos y, por cada uno, su número según el título.

    Raises:
        FormatoInesperado: Si el consolidado no tiene título con fecha o un PDF carece de su consolidado.
    """
    archivos = sorted(
        (entrada["archivo"] for entrada in registrados() if entrada["archivo"].startswith("boe-rd-")),
        key=lambda archivo: (*orden_de_numero(numero_del_archivo(archivo)), not archivo.endswith(".html")),
    )
    fechas: dict[str, str] = {}
    titulos: dict[str, str | None] = {}
    textos = []
    for archivo in archivos:
        numero, lineas = numero_del_archivo(archivo), _lineas(archivo)
        if archivo.endswith(".html"):
            titulo = boe.titulo_de(lineas)
            if titulo is None:
                raise FormatoInesperado(f"{FUENTE}: {archivo} no trae un título de real decreto con fecha")
            titulos[archivo] = titulo[0]
            fechas[numero] = titulo[1]
        exigir(numero in fechas, f"{FUENTE}: {archivo} sin fecha de su texto consolidado")
        textos.append(Texto(numero, fechas[numero], archivo, lineas))
    return textos, titulos


def anexos_por_codigo(textos: list[Texto]) -> dict[str, list[Encontrado]]:
    """Todos los anexos de certificado de los textos, por el código que les da el BOE, del más reciente al más antiguo.

    Un real decreto posterior que actualiza un certificado publica su anexo entero: manda el más reciente y, del mismo
    real decreto, el texto consolidado antes que el PDF.

    Returns:
        Cada código del BOE con sus anexos, del más reciente al más antiguo.
    """
    encontrados: dict[str, list[Encontrado]] = defaultdict(list)
    for texto_del_boe in textos:
        for codigo_del_boe, lista in boe.anexos(texto_del_boe.lineas).items():
            encontrados[codigo_del_boe] += [Encontrado(texto_del_boe, anexo) for anexo in lista]
    for lista in encontrados.values():
        lista.sort(
            key=lambda encontrado: (encontrado.texto.fecha, encontrado.texto.archivo.endswith(".html")), reverse=True
        )
    return dict(encontrados)


def _palabras(nombre: str) -> set[str]:
    """Las palabras de un nombre sin tildes, mayúsculas ni signos, y sin las que no distinguen («de», «y»…).

    Returns:
        El conjunto de palabras significativas, normalizadas.
    """
    sin_tildes = unicodedata.normalize("NFD", nombre.lower()).encode("ascii", "ignore").decode()
    return set(re.findall(r"[a-z0-9]+", sin_tildes)) - PALABRAS_VACIAS


def parecido(uno: str, otro: str) -> float:
    """Cuánto se parecen dos nombres de certificado: la parte de sus palabras que comparten (de 0 a 1).

    Entre el BOE y el SOC cambian el orden, el género o un adjetivo («maquinaria agraria» / «agrícola»: 0,6; «viajeros»
    / «personas viajeras»: 0,4); dos certificados distintos con el mismo código por errata no comparten casi ninguna
    («Trabajos de carpintería y mueble» / «Aserrado de madera»: 0).

    Returns:
        La parte de palabras compartidas, de 0 a 1.
    """
    palabras_uno, palabras_otro = _palabras(uno), _palabras(otro)
    union = palabras_uno | palabras_otro
    return len(palabras_uno & palabras_otro) / len(union) if union else 0.0


def anexos_del_certificado(
    certificado: dict[str, Any], encontrados: dict[str, list[Encontrado]], por_real_decreto: dict[str, list[Encontrado]]
) -> list[Encontrado]:
    """Los anexos de un certificado del SOC: el que vale, primero.

    Son los de su código cuya denominación se parece a la del SOC (o que no la traen), del más parecido al menos y, a
    igual parecido, del más reciente al más antiguo. Si no hay ninguno, los de su real decreto con su misma
    denominación, palabra por palabra: el BOE le dio otro código por errata, que se apunta. Dos certificados distintos
    del mismo real decreto pueden llamarse casi igual («Producción de semillas…» / «Gestión de la producción de
    semillas…»): por eso aquí no basta con parecerse.

    Returns:
        Los anexos que valen para el certificado, el elegido primero; vacía si ninguno se parece.
    """
    nombre = texto(certificado["filas"][0].get("desccas"))
    oficial = certificado["codigo"][:LARGO_CODIGO_OFICIAL]
    medidos = [
        (parecido(encontrado.anexo.denominacion, nombre) if encontrado.anexo.denominacion else 1.0, encontrado)
        for encontrado in encontrados.get(oficial, [])
    ]
    por_codigo = [(medida, encontrado) for medida, encontrado in medidos if medida >= MIN_PARECIDO_MISMO_CODIGO]
    if por_codigo:
        por_codigo.sort(
            key=lambda par: (par[0], par[1].texto.fecha, par[1].texto.archivo.endswith(".html")), reverse=True
        )
        return [encontrado for _, encontrado in por_codigo]
    del_real_decreto = por_real_decreto.get(real_decreto_del_soc(certificado) or "", [])
    return [encontrado for encontrado in del_real_decreto if parecido(encontrado.anexo.denominacion, nombre) == 1.0]


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar: los códigos de ocupación
# ---------------------------------------------------------------------------------------------------------------------


# Columnas de la tabla de correspondencia CNO-94 → CNO-11 del INE: el grupo CNO-94 y el CNO-11, de 4 cifras.
COLUMNA_CNO94 = 0
COLUMNA_CNO11 = 3


def correspondencia_cno94() -> dict[str, list[str]]:
    """Los grupos CNO-11 de 4 cifras que el INE hace corresponder con cada grupo CNO-94 de 4 cifras.

    Returns:
        Cada grupo CNO-94 de 4 cifras con sus grupos CNO-11 de 4 cifras.

    Raises:
        ErrorFuente: Si la tabla no tiene su fila de cabecera o una fila con grupo CNO-94 no trae el CNO-11.
    """
    filas = next(iter(leer_xls(original(FUENTE, ARCHIVO_CNO94)).values()))
    cabecera = next(
        (posicion for posicion, fila in enumerate(filas) if fila and codigo(fila[COLUMNA_CNO94]) == "CNO94"), None
    )
    if cabecera is None:
        raise ErrorFuente(f"{FUENTE}: la tabla CNO-94 → CNO-11 del INE no tiene la fila de cabecera «CNO94»")
    correspondencia: dict[str, set[str]] = defaultdict(set)
    for numero, fila in enumerate(filas[cabecera + 1 :], start=cabecera + 2):
        cno94 = codigo(fila[COLUMNA_CNO94]) if fila else ""
        if len(fila) <= COLUMNA_CNO11:
            if re.fullmatch(r"\d{4}", cno94):
                raise ErrorFuente(f"{FUENTE}: la fila {numero} de la tabla CNO-94 → CNO-11 no trae el grupo CNO-11")
            continue
        cno11 = codigo(fila[COLUMNA_CNO11])
        if re.fullmatch(r"\d{4}", cno94) and re.fullmatch(r"\d{4}", cno11):
            correspondencia[cno94].add(cno11)
    return {cno94: sorted(grupos) for cno94, grupos in sorted(correspondencia.items())}


def _clase(forma: str | None, cifras: str, anio: int, tablas: tuple[set[str], dict[str, list[str]]]) -> str:
    """De qué clasificación es un código según cómo está escrito, el año de su real decreto y las tablas oficiales.

    Returns:
        La clase del código: su clasificación.
    """
    cno11, cno94 = tablas
    grupo = cifras[:4]
    if forma == "4.4":
        return "cno11" if grupo in cno11 else "desconocido"
    if forma == "4.3.1":
        return "cno94" if grupo in cno94 else "desconocido"
    # Ocho cifras seguidas o solo el grupo: lo dice el año, si el grupo existe en la clasificación de esa época.
    candidatas = ("cno11", "cno94") if anio >= PRIMER_ANIO_CNO11 else ("cno94", "cno11")
    for clase in candidatas:
        if grupo in (cno11 if clase == "cno11" else cno94):
            return clase if forma == "8" else f"{clase}-grupo"
    return "desconocido"


def ocupacion_clasificada(
    ocupacion: boe.Ocupacion, anio: int, tablas: tuple[set[str], dict[str, list[str]]]
) -> dict[str, Any]:
    """Una ocupación del anexo con su clase, su CO-SISPE de la CNO-11 (si lo es) y sus grupos CNO-11 de 4 cifras.

    Returns:
        La ocupación con su clase, su CO-SISPE (o None) y sus grupos CNO-11.
    """
    salida: dict[str, Any] = {"codigo": ocupacion.codigo, "forma": ocupacion.forma, "texto": ocupacion.texto}
    if ocupacion.codigo is None:
        return {**salida, "clase": "sin-codigo", "cosispe": None, "grupos": []}
    clase = _clase(ocupacion.forma, ocupacion.codigo, anio, tablas)
    grupo = ocupacion.codigo[:4]
    grupos = {"cno11": [grupo], "cno11-grupo": [grupo]}.get(clase) or tablas[1].get(grupo, [])
    if clase == "desconocido":
        grupos = []
    return {**salida, "clase": clase, "cosispe": ocupacion.codigo if clase == "cno11" else None, "grupos": grupos}


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar: cada certificado
# ---------------------------------------------------------------------------------------------------------------------


def _entero_del_soc(valor: object, campo: str) -> int | None:
    """Convierte las cifras decimales del SOC sin confundir otros dígitos Unicode con un entero.

    Returns:
        El entero o None si el campo no trae cifras, como en el contrato de preparación.
    """
    contenido = texto(valor)
    exigir(not contenido.isdigit() or contenido.isdecimal(), f"SOC: {campo} no es un entero decimal: {contenido!r}")
    return int(contenido) if contenido.isdecimal() else None


def _unidades_del_soc(filas: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Las unidades de competencia de un certificado del SOC, con su módulo, y su módulo de prácticas.

    Returns:
        Las unidades con su módulo y el módulo de prácticas, o None si no lo tiene.
    """
    unidades: dict[str, dict[str, Any]] = {}
    practicas = None
    for fila in filas:
        unidad = texto(fila.get("unitcompcodi"))
        horas = _entero_del_soc(fila.get("modulformdurada"), "modulformdurada")
        if unidad.startswith("noUC_"):
            practicas = {"modulo": texto(fila.get("modulformcodi")), "horas": horas}
        elif unidad.startswith("UC") and unidad not in unidades:
            unidades[unidad] = {
                "codigo": unidad,
                "nombre_ca": texto_sin_controles_de_windows(fila.get("unitcompdesccat")).rstrip(".") or None,
                "modulo": texto(fila.get("modulformcodi")) or None,
                "modulo_ca": texto(fila.get("modulformdesccat")) or None,
                "horas": horas,
            }
    return list(unidades.values()), practicas


def _anexo_preparado(
    encontrados: list[Encontrado], tablas: tuple[set[str], dict[str, list[str]]]
) -> dict[str, Any] | None:
    """Lo que se guarda del anexo elegido (el primero) y de qué otros textos sale el mismo certificado.

    Returns:
        Lo que se guarda del anexo, o None si no hay ninguno.
    """
    if not encontrados:
        return None
    elegido = encontrados[0]
    anio = int(elegido.texto.fecha[:4])
    return {
        "real_decreto": elegido.texto.numero,
        "codigo_en_el_boe": elegido.anexo.codigo,
        "fecha": elegido.texto.fecha,
        "archivo": elegido.texto.archivo,
        "nivel": elegido.anexo.nivel,
        "denominacion": elegido.anexo.denominacion,
        "unidades": [list(unidad) for unidad in elegido.anexo.unidades],
        # Las que el BOE publica con un código que no se corrige sin adivinar: a la vista, sin nombrar ninguna del SOC.
        "unidades_con_codigo_irregular": [list(unidad) for unidad in elegido.anexo.irregulares],
        "ocupaciones": [ocupacion_clasificada(ocupacion, anio, tablas) for ocupacion in elegido.anexo.ocupaciones],
        "otros_textos": [encontrado.texto.archivo for encontrado in encontrados[1:]],
    }


def certificado_preparado(
    codigo_soc: str,
    filas: list[dict[str, Any]],
    encontrados: list[Encontrado],
    tablas: tuple[set[str], dict[str, list[str]]],
    equivalencias: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    """Un certificado del SOC con su anexo del BOE, sus códigos de ocupación y las equivalencias de sus unidades.

    Returns:
        El certificado preparado, listo para la validación.
    """
    primera = filas[0]
    unidades, practicas = _unidades_del_soc(filas)
    anexo = _anexo_preparado(encontrados, tablas)
    nombres_es = dict(anexo["unidades"]) if anexo else {}
    for unidad in unidades:
        unidad["nombre_es"] = nombres_es.get(unidad["codigo"])
    ocupaciones = anexo["ocupaciones"] if anexo else []
    return {
        "codigo": codigo_soc,
        "codigo_oficial": codigo_soc[:LARGO_CODIGO_OFICIAL],
        "nombre_es": texto_sin_controles_de_windows(primera.get("desccas")),
        "nombre_ca": texto_sin_controles_de_windows(primera.get("desccat")),
        "nivel": _entero_del_soc(primera.get("nivellespecialitat"), "nivellespecialitat"),
        "horas": _entero_del_soc(primera.get("hores"), "hores"),
        "familia": texto(primera.get("famprofcodi")),
        "real_decreto_soc": real_decreto_del_soc({"filas": filas}),
        "unidades": unidades,
        "practicas": practicas,
        "anexo": anexo,
        "ocupaciones": sorted({ocupacion["cosispe"] for ocupacion in ocupaciones if ocupacion["cosispe"]}),
        "grupos": sorted(
            {grupo for ocupacion in ocupaciones if not ocupacion["cosispe"] for grupo in ocupacion["grupos"]}
        ),
        "equivalencias": {
            unidad["codigo"]: equivalencias[unidad["codigo"]]
            for unidad in unidades
            if unidad["codigo"] in equivalencias
        },
    }


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar: normas y páginas registradas a mano
# ---------------------------------------------------------------------------------------------------------------------


def equivalencias_de_unidades(lineas: list[str]) -> dict[str, list[dict[str, str]]]:
    """Las unidades actuales de cada unidad suprimida (Real Decreto 151/2022, anexo XIII-a), con su nombre.

    Returns:
        Cada unidad suprimida con sus unidades actuales y sus nombres.
    """
    nombres = boe.nombres_de_unidades(lineas)
    equivalencias: dict[str, list[dict[str, str]]] = defaultdict(list)
    for suprimida, requisitos, actual in boe.equivalencias(lineas):
        equivalencias[suprimida].append({"codigo": actual, "nombre": nombres.get(actual, ""), "requisitos": requisitos})
    return dict(equivalencias)


def normas_preparadas() -> dict[str, Any]:
    """Cada pasaje que se comprueba, con su norma y si está literal en ella; y las equivalencias de unidades.

    Returns:
        Los pasajes con su norma y su comprobación, y las equivalencias de unidades.
    """
    textos = {norma.archivo: " ".join(_lineas(norma.archivo)) for norma in (EQUIVALENCIAS, REGLAMENTO, LEY)}
    pasajes = {
        clave: {"norma": norma.titulo, "boe": norma.boe, "pasaje": pasaje, "literal": pasaje in textos[norma.archivo]}
        for clave, (norma, pasaje) in PASAJES.items()
    }
    return {
        "pasajes": pasajes,
        "equivalencias": equivalencias_de_unidades(_lineas(EQUIVALENCIAS.archivo)),
        "horas_nivel_1": {
            "cifra": HORAS_NIVEL_1,
            # HORAS_NIVEL_1 es una cifra fijada con su fuente (constantes.py): siempre confirmada.
            "estado": "confirmada",
            "motivo": "Agència FP.CAT, Guia de la persona usuària (agosto de 2024, pág. 8): «Experiència d'almenys 2 "
            "anys amb un mínim de 1.000 hores realitzades […] de nivell 1», en los últimos 15 años; formación, en los "
            "últimos 10. La Sindicatura de Comptes (informe 15/2026, cuadro 13) atribuye 1.200 horas a la Resolució "
            "PRE/735/2024.",
        },
    }
