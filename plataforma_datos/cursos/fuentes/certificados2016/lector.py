"""Certificados de profesionalidad que el SEPE relacionó con cada ocupación en su informe de necesidades de 2016.

El Informe de prospección y detección de necesidades formativas 2016 del Observatorio de las Ocupaciones trae dos
tablas de ocupación (CNO-11 de 4 cifras) ↔ certificado ↔ unidades de competencia: el Anexo III (España, pp. 872–897) y
el Anexo IV (Cataluña, pp. 1.015–1.031). Las acordó una mesa del SEPE, el INCUAL, la Subdirección General de Políticas
Activas de Empleo y Fundae como formación que responde a las necesidades detectadas en cada ocupación. Es la tercera
fuente del bloque de acreditación, después de lo comprobado por Faro y de los perfiles del SEPE
(`mercado/fuentes/perfiles/lector.py`).

Entradas operativas: el PDF conservado y las celdas JSONL registradas de sus dos tablas. Preparar monta la tabla
con esas celdas; validar la lleva a las ocupaciones ESCO con el mismo criterio que los perfiles (un único grupo
CNO-11, solo certificados vigentes, sin lo que la revisión de Faro descartó para esa ocupación) y sin lo que ya
enseñan las fuentes de más precedencia. El extractor histórico PDFKit no forma parte de este flujo Python estándar.

Uso: python3 -m plataforma_datos.cursos.fuentes.certificados2016.lector {descargar,preparar,validar,todo}
"""

import csv
import io
import math
import sys
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any, NamedTuple

import plataforma_datos.cursos.fuentes.acreditacion.piezas.validacion as validacion
import plataforma_datos.mercado.fuentes.perfiles.lector as perfiles
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    comprobar_originales,
    escribir_entero_creando_carpeta,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Cadena,
    Relaciones,
    de_la_ocupacion,
    leer_cadena,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import leer_descartadas_en_la_revision
from plataforma_datos.cursos.fuentes.certificados2016.constantes import (
    CELDAS,
    CERTIFICADO,
    CNO4,
    COLUMNAS,
    CORRECCIONES,
    FUENTE,
    LIMITES,
    NOMBRE_FUENTE,
    NUMERO_COLUMNAS_CELDAS,
    PROCEDENCIA,
    TABLA,
    TODAS,
    TODAS_LAS_UNIDADES,
    UNIDAD,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

type Celda = dict[str, Any]


class Bloque(NamedTuple):
    """Un bloque de ocupación de una página: su grupo CNO-11, su nombre y su tramo de altura, de y0 (incluido) a y1."""

    cno4: str
    nombre: str
    y0: float
    y1: float


class EstadoEntrePaginas(NamedTuple):
    """Lo que una página deja a la siguiente al montar la tabla."""

    bloque: Bloque | None
    """El último bloque de ocupación: lo continúa una celda sin código al principio de la página siguiente."""
    fila: dict[str, Any] | None
    """La fila del certificado de la última celda, si se creó: recibe las unidades del principio de la siguiente."""
    pendientes: tuple[str, ...]
    """Unidades al pie de la página de un certificado que empieza en la siguiente."""


SIN_ESTADO = EstadoEntrePaginas(None, None, ())


# ---------------------------------------------------------------------------------------------------------------------
# Descargar: el original se registra a mano
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """El original no se descarga con código: lo explica y comprueba sus huellas."""
    aviso_descarga_manual(
        FUENTE,
        "Son el PDF del informe y las celdas JSONL de sus dos tablas, con las huellas de la procedencia.",
    )


# ---------------------------------------------------------------------------------------------------------------------
# Preparar: la tabla a partir de las celdas leídas por posición
# ---------------------------------------------------------------------------------------------------------------------


def _comprobar_celda(celda: object, contexto: str) -> None:
    """Exige texto y un intervalo vertical finito antes de asociar una celda a una fila.

    Raises:
        FormatoInesperado: Si una coordenada no cabe en el cálculo del centro.
    """
    exigir(isinstance(celda, dict), f"{contexto}: no es un objeto de celda")
    exigir(isinstance(celda.get("texto"), str), f"{contexto}: texto ausente o no textual")
    limites = [celda.get(clave) for clave in ("y0", "y1")]
    try:
        exigir(
            all(type(valor) in (int, float) and math.isfinite(valor) for valor in limites),
            f"{contexto}: y0 e y1 deben ser números finitos",
        )
        exigir(math.isfinite((limites[0] + limites[1]) / 2), f"{contexto}: centro fuera de rango")
    except OverflowError as error:
        raise FormatoInesperado(f"{contexto}: coordenadas fuera de rango") from error
    exigir(limites[0] < limites[1], f"{contexto}: y0 debe ser menor que y1")


def _comprobar_pagina(ambito: str, pagina: object) -> None:
    """Comprueba las cuatro columnas con su cabecera y la geometría usada por el montaje."""
    exigir(isinstance(pagina, dict), f"{ambito}: la página no es un objeto")
    numero = pagina.get("pagina")
    contexto = f"{ambito}, página {numero}"
    exigir(type(numero) is int and numero > 0, f"{contexto}: número de página no válido")
    columnas = pagina.get("celdas")
    exigir(
        isinstance(columnas, list) and len(columnas) == NUMERO_COLUMNAS_CELDAS,
        f"{contexto}: se esperan cuatro columnas",
    )
    for indice, columna in enumerate(columnas, start=1):
        lugar = f"{contexto}, columna {indice}"
        exigir(isinstance(columna, list) and bool(columna), f"{lugar}: falta la cabecera de celdas")
        for posicion, celda in enumerate(columna, start=1):
            _comprobar_celda(celda, f"{lugar}, celda {posicion}")


def _centro(celda: Celda) -> float:
    """La altura del centro de una celda en la página.

    Returns:
        La altura del centro, en las unidades de la página.
    """
    return (celda["y0"] + celda["y1"]) / 2


def _contiene(celda: Celda, altura: float) -> bool:
    """Si una altura de la página cae dentro de una celda: desde su y0, incluido, hasta su y1, excluido.

    Returns:
        True si la altura está en [y0, y1) de la celda.
    """
    return celda["y0"] <= altura < celda["y1"]


def bloques_de_ocupacion(codigos: list[Celda], nombres: list[Celda], anterior: Bloque | None) -> list[Bloque]:
    """Los bloques de ocupación de una página.

    Una celda sin código continúa el bloque anterior: las subfilas del Anexo III o el trozo de un bloque que parte el
    salto de página.

    Args:
        codigos: Las celdas de la columna de códigos CNO-11, sin la cabecera.
        nombres: Las celdas de la columna de nombres de ocupación, sin la cabecera.
        anterior: El último bloque de la página anterior, o None en la primera.

    Returns:
        Los bloques de la página, de arriba abajo.
    """
    bloques: list[Bloque] = []
    for celda in codigos:
        nombre = " ".join(otra["texto"] for otra in nombres if _contiene(celda, _centro(otra)))
        codigo = CNO4.match(celda["texto"])
        if codigo:
            bloques.append(Bloque(codigo.group(1), nombre, celda["y0"], celda["y1"]))
        elif bloques:
            bloques[-1] = bloques[-1]._replace(y1=celda["y1"])
        elif anterior:
            bloques.append(Bloque(anterior.cno4, anterior.nombre, celda["y0"], celda["y1"]))
    return bloques


def unidades_de(textos: list[str]) -> str:
    """«todas», o la lista de unidades separada por comas, sin repetir y en el orden de la tabla.

    Returns:
        «todas» o las unidades separadas por comas (vacío si no nombra ninguna).
    """
    if any(TODAS.search(texto) for texto in textos):
        return TODAS_LAS_UNIDADES
    return ",".join(dict.fromkeys(unidad for texto in textos for unidad in UNIDAD.findall(texto)))


def _filas_de_la_pagina(
    ambito: str, pagina: dict[str, Any], estado: EstadoEntrePaginas
) -> tuple[list[dict[str, Any]], EstadoEntrePaginas]:
    """Las filas de los certificados de una página y lo que esta deja a la siguiente.

    Args:
        ambito: «España» o «Cataluña», el anexo de la página.
        pagina: Su número y sus cuatro columnas de celdas, cada una con la cabecera delante.
        estado: Lo que dejó la página anterior (`SIN_ESTADO` en la primera).

    Returns:
        Las filas creadas en la página y el estado para la siguiente. Las unidades del principio de la página que
        son del último certificado de la anterior se añaden a la fila de `estado`.
    """
    # La primera celda de cada columna es la cabecera de la tabla.
    codigos, nombres, certificados, unidades = (columna[1:] for columna in pagina["celdas"])
    bloques = bloques_de_ocupacion(codigos, nombres, estado.bloque)
    filas: list[dict[str, Any]] = []
    pendientes: tuple[str, ...] = ()
    for numero, celda in enumerate(certificados, start=1):
        bloque = next((tramo for tramo in bloques if tramo.y0 <= _centro(celda) < tramo.y1), None)
        textos = [unidad["texto"] for unidad in unidades if _contiene(celda, _centro(unidad)) and unidad["texto"]]
        codigo = CERTIFICADO.search(celda["texto"])
        if codigo and bloque:
            if numero == 1:  # la celda pudo empezar al pie de la página anterior
                textos = [*estado.pendientes, *textos]
            nombre = CERTIFICADO.sub("", celda["texto"], count=1).strip(" -\u2010\u2013")
            filas.append(
                {
                    "cno4": bloque.cno4,
                    "ocupacion": bloque.nombre,
                    "certificado": codigo.group(1),
                    "certificado_nombre": nombre,
                    "unidades": unidades_de(textos),
                    "pagina": pagina["pagina"],
                    "fila": numero,
                    "ambito": ambito,
                }
            )
        elif textos and numero == 1 and estado.fila:  # unidades del último certificado de la página anterior
            if estado.fila["unidades"] != TODAS_LAS_UNIDADES:
                estado.fila["unidades"] = unidades_de([estado.fila["unidades"].replace(",", " "), *textos])
        elif textos and numero == len(certificados):  # unidades de un certificado de la página siguiente
            pendientes = tuple(textos)
    # Solo la fila de la última celda recibe unidades de la página siguiente; si esa celda no creó fila, ninguna.
    ultima = filas[-1] if filas and filas[-1]["fila"] == len(certificados) else None
    return filas, EstadoEntrePaginas(bloques[-1] if bloques else estado.bloque, ultima, pendientes)


def filas_de_las_celdas(ambito: str, paginas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Una fila por celda de certificado con código, con su ocupación y sus unidades.

    Su bloque es el que contiene su centro, y sus unidades, las celdas de la última columna cuyo centro cae en ella.
    Una celda partida por el salto de página junta sus unidades; las unidades pendientes de una página solo pasan a la
    primera celda de la siguiente.

    Args:
        ambito: «España» o «Cataluña», el anexo de las páginas.
        paginas: Las páginas del anexo, en orden.

    Returns:
        Las filas de la tabla, en el orden de las páginas.
    """
    filas: list[dict[str, Any]] = []
    estado = SIN_ESTADO
    exigir(bool(paginas), f"{ambito}: no hay páginas de celdas")
    for pagina in paginas:
        _comprobar_pagina(ambito, pagina)
        de_la_pagina, estado = _filas_de_la_pagina(ambito, pagina, estado)
        filas += de_la_pagina
    return filas


def preparar() -> None:
    """Monta la tabla de los dos anexos con las celdas y la escribe."""
    rutas = {ruta.name: ruta for ruta in comprobar_originales(FUENTE)}
    filas = []
    for ambito, archivo in CELDAS.items():
        exigir(archivo in rutas, f"{FUENTE}: falta el original registrado {archivo}")
        filas += filas_de_las_celdas(ambito, leer_jsonl(rutas[archivo]))
    exigir(bool(filas), f"{FUENTE}: las celdas no producen filas de certificados")
    contenido = io.StringIO(newline="")
    escritor = csv.DictWriter(contenido, COLUMNAS, delimiter="\t", lineterminator="\n")
    escritor.writeheader()
    escritor.writerows(filas)
    escribir_entero_creando_carpeta(TABLA, [contenido.getvalue()])
    print(f"{len(filas)} filas de certificado en la tabla de 2016")


# ---------------------------------------------------------------------------------------------------------------------
# Validar: por ocupación ESCO, lo que la tabla añade a lo comprobado y a los perfiles, y la cobertura del bloque
# ---------------------------------------------------------------------------------------------------------------------


def _comprobar_fila(fila: dict[str, str], contexto: str) -> None:
    """Comprueba los códigos y las referencias que la selección toma de la tabla preparada."""
    exigir(CNO4.fullmatch(fila["cno4"]) is not None, f"{contexto}: grupo CNO-11 no válido")
    exigir(CERTIFICADO.fullmatch(fila["certificado"]) is not None, f"{contexto}: certificado no válido")
    exigir(fila["ambito"] in CELDAS, f"{contexto}: ámbito no válido")
    for clave in ("pagina", "fila"):
        valor = fila[clave]
        exigir(valor.isascii() and valor.isdecimal() and int(valor) > 0, f"{contexto}: {clave} no válida")
    unidades = fila["unidades"]
    exigir(
        not limita_a_unidades(unidades) or all(UNIDAD.fullmatch(unidad) for unidad in unidades.split(",")),
        f"{contexto}: unidades no válidas",
    )


def leer_tabla(ruta: Path = TABLA) -> list[dict[str, str]]:
    """Lee las ocho columnas de la tabla extraída, sin aceptar filas truncadas ni una tabla vacía.

    Returns:
        Una fila por certificado, por el nombre de cada columna.

    Raises:
        FormatoInesperado: Si la tabla no es UTF-8, no tiene la cabecera o contiene una fila inválida.
    """
    filas = []
    try:
        with ruta.open(newline="", encoding="utf-8") as archivo:
            lector = csv.reader(archivo, delimiter="\t", strict=True)
            exigir(next(lector, None) == list(COLUMNAS), f"{ruta}: cabecera distinta de la tabla de certificados")
            for valores in lector:
                contexto = f"{ruta}, línea {lector.line_num}"
                exigir(len(valores) == len(COLUMNAS), f"{contexto}: se esperan {len(COLUMNAS)} campos")
                fila = dict(zip(COLUMNAS, valores, strict=True))
                _comprobar_fila(fila, contexto)
                filas.append(fila)
    except UnicodeError as error:
        raise FormatoInesperado(f"{ruta}: no es una tabla UTF-8 válida") from error
    except csv.Error as error:
        raise FormatoInesperado(f"{ruta}, línea {lector.line_num}: TSV no válido: {error}") from error
    exigir(bool(filas), f"{ruta}: tabla sin filas de certificados")
    return filas


def parejas(filas: list[dict[str, str]]) -> dict[tuple[str, str], str]:
    """(grupo CNO-11, certificado) → unidades, con las erratas del código corregidas.

    Si alguna fila dice «todas», todas; si no, la unión de las listas; vacío si la tabla no da ninguna.

    Returns:
        Por (grupo CNO-11, certificado), «todas» o sus unidades separadas por comas.
    """
    listas: dict[tuple[str, str], list[str]] = defaultdict(list)
    for fila in filas:
        certificado = CORRECCIONES.get(fila["certificado"], fila["certificado"])
        listas[(fila["cno4"], certificado)].append(fila["unidades"])
    return {
        pareja: TODAS_LAS_UNIDADES
        if TODAS_LAS_UNIDADES in unidades
        else ",".join(dict.fromkeys(unidad for lista in unidades for unidad in lista.split(",") if unidad))
        for pareja, unidades in sorted(listas.items())
    }


def unidad_vigente(impresa: str, vigentes: list[str]) -> str | None:
    """La unidad del certificado vigente que corresponde a la impresa, o None si ya no está.

    La misma, con el número a cuatro cifras («UC556_3» es UC0556_3) o, sin nivel impreso, la única que empieza igual.

    Returns:
        El código de la unidad vigente, o None si no hay una sola que corresponda.
    """
    numero, _, nivel = impresa.removeprefix("UC").partition("_")
    candidatas = [
        unidad
        for unidad in vigentes
        if unidad == f"UC{numero.zfill(4)}_{nivel}" or (not nivel and unidad.startswith(f"UC{numero.zfill(4)}_"))
    ]
    return candidatas[0] if len(candidatas) == 1 else None


def limita_a_unidades(unidades: str) -> bool:
    """Si la tabla nombra unidades concretas de un certificado (y no «todas» ni ninguna).

    Args:
        unidades: El valor de «unidades» de la tabla: «todas», vacío o una lista separada por comas.

    Returns:
        True si nombra unidades concretas.
    """
    return unidades not in (TODAS_LAS_UNIDADES, "")


def unidades_nombradas_vigentes(unidades: str, vigentes: list[str]) -> list[str]:
    """Las unidades que la tabla nombra y que siguen en el certificado vigente, sin repetir.

    Args:
        unidades: Las unidades nombradas, separadas por comas, tal como las imprime la tabla.
        vigentes: Las unidades del certificado vigente.

    Returns:
        Las unidades vigentes nombradas; vacío si ninguna sigue vigente.
    """
    encontradas = [unidad_vigente(impresa, vigentes) for impresa in unidades.split(",")]
    return list(dict.fromkeys(unidad for unidad in encontradas if unidad))


def por_ocupacion(
    relaciones: dict[tuple[str, str], list[str]],
    grupos_de: dict[str, set[str]],
    previas: dict[str, set[str]],
    descartadas: set[tuple[str, str]],
) -> dict[str, list[list[Any]]]:
    """[certificado, unidades] de cada ocupación ESCO con un único grupo CNO-11.

    Sin lo que ya enseña una fuente de más precedencia ni lo que la revisión descartó para esa ocupación.

    Returns:
        Por ocupación ESCO, los [certificado, unidades] nuevos.
    """
    del_grupo: dict[str, list[tuple[str, list[str]]]] = defaultdict(list)
    for (cno4, certificado), unidades in sorted(relaciones.items()):
        del_grupo[cno4].append((certificado, unidades))
    resultado: dict[str, list[list[Any]]] = {}
    for esco, grupos in sorted(grupos_de.items()):
        if len(grupos) != 1:
            continue
        (grupo,) = grupos
        nuevas = [
            [certificado, unidades]
            for certificado, unidades in del_grupo.get(grupo, [])
            if certificado not in previas.get(esco, set()) and (esco, certificado) not in descartadas
        ]
        if nuevas:
            resultado[esco] = nuevas
    return resultado


def certificados_y_unidades_vigentes(
    tabla: dict[tuple[str, str], str], certificados: dict[str, Any]
) -> tuple[dict[tuple[str, str], list[str]], dict[str, int]]:
    """Las parejas con su certificado vigente y las unidades que se nombran, y cuántas se quedan fuera y por qué.

    Una pareja que no limita a unidades concretas se queda con una lista vacía; una que nombra unidades y ninguna sigue
    vigente queda fuera.

    Args:
        tabla: Por (grupo CNO-11, certificado), «todas» o sus unidades.
        certificados: El catálogo de certificados vigentes de la acreditación.

    Returns:
        Las parejas usadas con sus unidades vigentes y el recuento de las que quedan fuera, por motivo.
    """
    usadas: dict[tuple[str, str], list[str]] = {}
    fuera = {"certificado_no_vigente": 0, "ninguna_unidad_vigente": 0}
    for (cno4, certificado), unidades in tabla.items():
        if certificado not in certificados:
            fuera["certificado_no_vigente"] += 1
            continue
        nombradas: list[str] = []
        if limita_a_unidades(unidades):
            nombradas = unidades_nombradas_vigentes(
                unidades, [unidad["codigo"] for unidad in certificados[certificado]["unidades"]]
            )
            if not nombradas:
                fuera["ninguna_unidad_vigente"] += 1
                continue
        usadas[(cno4, certificado)] = nombradas
    return usadas, fuera


def _codigos_por_ocupacion(relaciones: dict[str, list[list[Any]]]) -> dict[str, set[str]]:
    """De «ocupación ESCO → [[certificado, unidades], …]» a «ocupación ESCO → certificados».

    Returns:
        Por ocupación ESCO, el conjunto de sus certificados.
    """
    return {esco: {certificado for certificado, _ in lista} for esco, lista in relaciones.items()}


def _con_el_grupo(hoy: Relaciones, ocupaciones: Iterable[str], *listas: dict[str, set[str]]) -> Relaciones:
    """Lo que el bloque enseña hoy más, por el grupo, los certificados de `listas` (lo comprobado manda).

    Args:
        hoy: Las relaciones comprobadas de hoy.
        ocupaciones: Las ocupaciones ESCO de la cadena.
        *listas: Por ocupación ESCO, los certificados que se añaden por su grupo CNO-11.

    Returns:
        Las relaciones de hoy con los certificados añadidos como «grupo» donde no hay una comprobada.
    """
    extra = {esco: {codigo: "grupo" for lista in listas for codigo in lista.get(esco, ())} for esco in ocupaciones}
    return Relaciones({esco: {**extra[esco], **propias} for esco, propias in hoy.ocupaciones.items()}, hoy.grupos)


def _cobertura_del_bloque(
    cadena: Cadena,
    validado: dict[str, Any],
    hoy: Relaciones,
    del_perfil: dict[str, set[str]],
    de_la_tabla: dict[str, set[str]],
) -> dict[str, Any]:
    """La cobertura del bloque de formación hoy, con los perfiles del SEPE y con los perfiles y la tabla de 2016.

    Es el mismo cálculo que la validación de la acreditación (`validacion.cobertura`).

    Args:
        cadena: La cadena de la ocupación (ESCO → CNO-11) de la acreditación.
        validado: El conjunto validado de la acreditación.
        hoy: Las relaciones comprobadas de hoy.
        del_perfil: Por ocupación ESCO, los certificados de los perfiles del SEPE.
        de_la_tabla: Por ocupación ESCO, los certificados que añade la tabla de 2016.

    Returns:
        Por escenario («hoy», «con_perfiles», «con_perfiles_y_2016»), su resumen de cobertura.
    """
    certificados = validacion.certificados_para_cobertura(validado["certificados"])
    censo = leer_validado("cataluna")
    escenarios = (
        ("hoy", (), False),
        ("con_perfiles", (del_perfil,), True),
        ("con_perfiles_y_2016", (del_perfil, de_la_tabla), True),
    )
    return {
        nombre: perfiles.resumen_de_cobertura(
            validacion.cobertura(cadena, certificados, _con_el_grupo(hoy, cadena.ocupaciones, *listas), censo),
            con_sepe=con_sepe,
        )
        for nombre, listas, con_sepe in escenarios
    }


def _controles(
    filas: list[dict[str, str]],
    nuevas: dict[str, list[list[Any]]],
    descartadas: set[tuple[str, str]],
    ya_ensenado: dict[str, set[str]],
    certificados_vigentes: dict[str, Any],
) -> Controles:
    """Los controles de la tabla y de lo que añade: grupo, revisión, precedencia y vigencia.

    Args:
        filas: Las filas de la tabla extraída.
        nuevas: Por ocupación ESCO, los [certificado, unidades] que añade la tabla.
        descartadas: Las parejas (ocupación ESCO, certificado) que la revisión descartó.
        ya_ensenado: Por ocupación ESCO, los certificados que ya enseñan lo comprobado y los perfiles del SEPE.
        certificados_vigentes: El catálogo de certificados de la acreditación.

    Returns:
        Los controles, con su resultado.
    """
    exigir(bool(filas), f"{FUENTE}: no hay filas para validar")
    controles = Controles()
    controles.comprobar(all(fila["cno4"] for fila in filas), "cada fila de la tabla tiene su grupo CNO-11")
    controles.comprobar(
        not any((esco, codigo) in descartadas for esco, lista in nuevas.items() for codigo, _ in lista),
        "ninguna pareja (ocupación ESCO, certificado) que la revisión descartó se usa",
    )
    controles.comprobar(
        not any(codigo in ya_ensenado[esco] for esco, lista in nuevas.items() for codigo, _ in lista),
        "precedencia: nada de lo que ya enseñan lo comprobado o los perfiles del SEPE sale otra vez",
    )
    controles.comprobar(
        all(codigo in certificados_vigentes for lista in nuevas.values() for codigo, _ in lista),
        "solo certificados vigentes (en el catálogo de la acreditación)",
    )
    return controles


def validar() -> None:
    """Calcula las relaciones de cada ocupación ESCO, la cobertura antes y después, y guarda el conjunto."""
    filas = leer_tabla()
    tabla = parejas(filas)
    validado = leer_validado("acreditacion")
    usadas, fuera = certificados_y_unidades_vigentes(tabla, validado["certificados"])
    descartadas = leer_descartadas_en_la_revision()
    cadena = leer_cadena()
    grupos_de = {esco: set(de_la_ocupacion(esco, cadena).grupos) for esco in cadena.ocupaciones}
    hoy = perfiles.relaciones_comprobadas(validado, list(cadena.ocupaciones))
    perfiles_sepe = leer_validado("perfiles")["ocupaciones"]
    del_perfil = _codigos_por_ocupacion(perfiles_sepe)
    ya_ensenado = {esco: set(hoy.ocupaciones[esco]) | del_perfil.get(esco, set()) for esco in cadena.ocupaciones}
    nuevas = por_ocupacion(usadas, grupos_de, ya_ensenado, descartadas)
    de_la_tabla = _codigos_por_ocupacion(nuevas)
    cobertura = _cobertura_del_bloque(cadena, validado, hoy, del_perfil, de_la_tabla)
    controles = _controles(filas, nuevas, descartadas, ya_ensenado, validado["certificados"])
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "filas_de_la_tabla": len(filas),
            "parejas_cno4_certificado": len(tabla),
            "parejas_vigentes": len(usadas),
            **fuera,
            "con_unidades_nombradas": sum(1 for unidades in usadas.values() if unidades),
            "ocupaciones_esco_con_2016": len(nuevas),
            "ocupaciones_esco_solo_con_2016": sum(1 for esco in nuevas if not ya_ensenado[esco]),
            "parejas_esco_certificado": sum(len(lista) for lista in nuevas.values()),
        },
        # El mismo cálculo que la validación de la acreditación (cobertura()): hoy, con los perfiles y con la tabla.
        "cobertura_del_bloque": cobertura,
        "limites": LIMITES,
        "controles": controles.lista,
    }
    procedencia = leer_json(PROCEDENCIA)
    conjunto = {
        "fuente": NOMBRE_FUENTE,
        "cita": procedencia["cita"],
        "licencia": procedencia["licencia"],
        "limites": LIMITES,
        "ocupaciones": nuevas,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto, compacto=True)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar (solo comprueba los originales), preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
