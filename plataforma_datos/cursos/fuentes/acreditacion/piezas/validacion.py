"""Validación de la acreditación: cobertura y cada control con su motivo."""

from collections import Counter, defaultdict
from collections.abc import Container
from datetime import date
from typing import Any

import plataforma_datos.cursos.fuentes.acreditacion.relaciones as relaciones
import plataforma_datos.cursos.fuentes.agencia.lector as agencia
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import (
    DESCARTADAS,
    EJEMPLOS,
    EJEMPLOS_DE_GRUPO,
    ERRATAS_DE_NIVEL,
    HORAS_SIN_CUADRAR,
    HUELLA_DE_LA_REGLA,
    MAX_DIAS_REGISTRO,
    MIN_PARTE_CODIGOS_CONOCIDOS,
    MIN_PARTE_CON_ANEXO,
    MIN_PARTE_UNIDADES_EN_EL_ANEXO,
    MIN_REALES_DECRETOS_DEL_INDICE,
    PUNTO_DE_INFORMACION,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.relacion_con_ocupaciones import (
    Cadena,
    Relaciones,
    de_la_ocupacion,
    ocupaciones_por_grupo,
)
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import Revision
from plataforma_datos.orquestacion.admision import leer_validado

# Cifras del código de un grupo ISCO-08; las claves de DESCARTADAS más largas son ocupaciones ESCO.
CIFRAS_GRUPO_ISCO = 4

# Lo que la Agència FP.CAT dice de tres certificados de Sanidad, comprobado a mano en sus dos listas.
EJEMPLOS_DE_CATALUNA = {"SANT0208": "en la oferta", "SANT0108": "en la oferta", "SANP0108": "no disponible"}
# Las unidades de competencia de la atención domiciliaria (SSCS0108) que el Real Decreto 151/2022 sustituye.
UNIDADES_SUSTITUIDAS = ("UC0249_2", "UC0250_2", "UC0251_2")

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar: cobertura
# ---------------------------------------------------------------------------------------------------------------------


def _grupo_del_censo(grupo_cno11: str, censo: dict[str, Any]) -> str | None:
    """El grupo del censo de un grupo CNO-11 de 4 cifras: el de 3 cifras o, si el INE no lo publica, el de 2.

    Returns:
        El código del grupo del censo, o None si el INE no publica ninguno.
    """
    if grupo_cno11[:3] in censo["ocupados_cno3"]:
        return grupo_cno11[:3]
    return grupo_cno11[:2] if grupo_cno11[:2] in censo["ocupados_cno2"] else None


def _personas(en_grupo: dict[str, list[bool]], personas: dict[str, Any]) -> dict[str, Any]:
    """Las tres cifras de personas ocupadas alcanzadas, sobre el total de los grupos del censo con ocupaciones ESCO.

    Returns:
        Las personas alcanzadas, el total y su porcentaje.
    """
    total = sum(personas[grupo]["ocupados"] for grupo in en_grupo)
    todas = sum(personas[grupo]["ocupados"] for grupo, marcas in en_grupo.items() if all(marcas))
    alguna = sum(personas[grupo]["ocupados"] for grupo, marcas in en_grupo.items() if any(marcas))
    estimacion = sum(personas[grupo]["ocupados"] * sum(marcas) / len(marcas) for grupo, marcas in en_grupo.items())
    return {
        "total": total,
        "cota_baja": todas,
        "cota_alta": alguna,
        "estimacion": round(estimacion),
        "fuente": "INE, Censo de Población 2021: personas ocupadas en Cataluña por grupo de la CNO-11 (cataluna)",
    }


def certificados_para_cobertura(certificados: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Proyecta el catálogo validado a los campos de cobertura, conservando su orden y nombres catalanes.

    Returns:
        Los certificados con solo los campos de la cobertura, en el mismo orden.
    """
    return [
        {"codigo": codigo, "familia": datos["familia"], "nivel": datos["nivel"], "nombre_ca": datos["nombre"]["ca"]}
        for codigo, datos in certificados.items()
    ]


def de_cataluna(certificados: list[dict[str, Any]]) -> dict[str, Any]:
    """Qué certificados ofrece hoy la Agència FP.CAT con seguridad y cuáles no se acreditan.

    La lista de la Agència la prepara `cursos/fuentes/agencia/lector.py`.

    Returns:
        Los certificados que se ofrecen con seguridad y los que no se acreditan.
    """
    listas = leer_validado("agencia")
    return {
        "no_disponibles": agencia.no_disponibles(certificados, listas["no_disponibles"]["cualificaciones"]),
        "en_la_oferta": sorted(agencia.casar(certificados, listas["oferta"]["filas"])),
        "oferta_actualizada": listas["oferta"]["actualizada"],
        "no_disponibles_actualizada": listas["no_disponibles"]["actualizada"],
    }


def cobertura(
    cadena: Cadena, certificados: list[dict[str, Any]], todas: Relaciones, censo: dict[str, Any]
) -> dict[str, Any]:
    """Cuántas ocupaciones ESCO y grupos ISCO-08 tienen bloque, de qué tipo, y a cuántas personas ocupadas alcanza.

    Las personas solo se publican por grupo del censo (3 cifras, o 2 si el INE no da las 3): se dan tres cifras, la
    de los grupos en que todas sus ocupaciones ESCO tienen bloque (cota baja), la de los grupos en que alguna lo tiene
    (cota alta) y la que reparte cada grupo por la parte de sus ocupaciones con bloque (estimación).

    Returns:
        Los recuentos de la cobertura y las personas alcanzadas.
    """
    excluidos = de_cataluna(certificados)["no_disponibles"]

    def variante(encontradas: dict[str, str]) -> str:
        """La variante de unas relaciones, sin contar los certificados que no se acreditan en Cataluña.

        Returns:
            El nombre de la variante del bloque.
        """
        return relaciones.variante(encontradas, excluidos)

    por_ocupacion, en_grupo = {}, defaultdict(list)
    for esco, encontradas in todas.ocupaciones.items():
        por_ocupacion[esco] = variante(encontradas)
        grupos = de_la_ocupacion(esco, cadena).grupos
        for grupo_censo in {_grupo_del_censo(grupo, censo) for grupo in grupos} - {None}:
            en_grupo[grupo_censo].append(por_ocupacion[esco] in ("por-ocupacion", "por-grupo"))
    grupos_isco = {isco: variante(encontradas) for isco, encontradas in todas.grupos.items()}
    personas = {**censo["ocupados_cno3"], **censo["ocupados_cno2"]}
    return {"ocupaciones": por_ocupacion, "grupos_isco": grupos_isco, "personas": _personas(en_grupo, personas)}


def resumen_de_revision(
    propuestas: Relaciones, todas: Relaciones, admitidas: dict[tuple[str, str], Revision]
) -> dict[str, Any]:
    """Cuántas relaciones propone la regla, cuántas admite la revisión y cuántas se enseñan, y su regla y fechas.

    Returns:
        Los recuentos de la revisión con su regla y sus fechas.
    """
    propuestas_por_pareja = {(esco, codigo) for esco, lista in propuestas.ocupaciones.items() for codigo in lista}
    ensenadas = {(esco, codigo) for esco, lista in todas.ocupaciones.items() for codigo in lista}
    return {
        "regla_sha256": HUELLA_DE_LA_REGLA,
        "fechas": sorted({revision.fecha for revision in admitidas.values()}),
        "admitidas": len(admitidas),
        "propuestas": len(propuestas_por_pareja),
        "se_ensenan": len(ensenadas),
        "se_ensenan_sin_proponer": len(ensenadas - propuestas_por_pareja),
        "admitidas_que_no_se_ensenan": sorted(f"{esco}→{codigo}" for esco, codigo in set(admitidas) - ensenadas),
        "propuestas_sin_admitir": len(propuestas_por_pareja - set(admitidas)),
        "admitidas_que_la_regla_no_propone": len(set(admitidas) - propuestas_por_pareja),
        "grupos_isco08": {
            "propuestas": sum(len(lista) for lista in propuestas.grupos.values()),
            "se_ensenan": sum(len(lista) for lista in todas.grupos.values()),
        },
    }


def resumen_de_cobertura(calculada: dict[str, Any]) -> dict[str, Any]:
    """Lo que la validación guarda de la cobertura: recuentos, no la lista de cada ocupación.

    Returns:
        Los recuentos de la cobertura.
    """
    personas = calculada["personas"]
    exigir(personas["total"] > 0, "acreditacion: el total de personas de la cobertura debe ser positivo")
    parte = {clave: round(personas[clave] / personas["total"], 3) for clave in ("cota_baja", "estimacion", "cota_alta")}
    return {
        "ocupaciones_esco": dict(sorted(Counter(calculada["ocupaciones"].values()).items())),
        "grupos_isco08": dict(sorted(Counter(calculada["grupos_isco"].values()).items())),
        "personas_ocupadas": {**personas, "parte": parte},
    }


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar: controles
# ---------------------------------------------------------------------------------------------------------------------


def controles_de_lectura(controles: Controles, certificados: list[dict[str, Any]], resumen: dict[str, Any]) -> None:
    """El índice, los títulos de las páginas y cuántos certificados tienen su anexo leído."""
    controles.comprobar(
        resumen["reales_decretos_del_indice"] >= MIN_REALES_DECRETOS_DEL_INDICE,
        f"el índice (Real Decreto 189/2013) da {resumen['reales_decretos_del_indice']} reales decretos de certificados "
        f"(se esperan al menos {MIN_REALES_DECRETOS_DEL_INDICE})",
    )
    controles.comprobar(
        not resumen["titulos_que_no_cuadran"],
        "cada texto consolidado es el del real decreto que se pidió, según su título"
        + (f" (no: {', '.join(resumen['titulos_que_no_cuadran'])})" if resumen["titulos_que_no_cuadran"] else ""),
    )
    con_anexo = [certificado for certificado in certificados if certificado["anexo"]]
    controles.comprobar(
        len(con_anexo) / max(len(certificados), 1) >= MIN_PARTE_CON_ANEXO,
        f"{len(con_anexo)} de {len(certificados)} certificados del SOC con su anexo leído en el BOE (se espera al "
        f"menos el {MIN_PARTE_CON_ANEXO:.0%})",
    )
    distinto_nivel = [
        certificado["codigo"]
        for certificado in con_anexo
        if certificado["anexo"]["nivel"] not in (None, certificado["nivel"])
        and certificado["codigo"] not in ERRATAS_DE_NIVEL
    ]
    controles.comprobar(
        not distinto_nivel,
        "el nivel de cada anexo es el que da el SOC, salvo las erratas del BOE comprobadas a mano (ERRATAS_DE_NIVEL)"
        + (f" (no: {', '.join(distinto_nivel)})" if distinto_nivel else ""),
    )
    unidades = [unidad for certificado in con_anexo for unidad in certificado["unidades"]]
    en_el_anexo = sum(1 for unidad in unidades if unidad["nombre_es"])
    controles.comprobar(
        en_el_anexo / max(len(unidades), 1) >= MIN_PARTE_UNIDADES_EN_EL_ANEXO,
        f"{en_el_anexo} de {len(unidades)} unidades del SOC están en el anexo de su certificado (se espera al menos el "
        f"{MIN_PARTE_UNIDADES_EN_EL_ANEXO:.0%})",
    )


def horas_que_no_cuadran(certificados: list[dict[str, Any]]) -> list[str]:
    """Los certificados, por código, cuyos módulos formativos suman más horas que el certificado.

    Solo se comparan los que tienen todas las cifras: la del certificado y la de cada módulo.

    Returns:
        Los códigos de los certificados que no cuadran; vacía si cuadran todos.
    """
    return sorted(
        certificado["codigo"]
        for certificado in certificados
        if certificado["horas"] is not None
        and all(unidad["horas"] is not None for unidad in certificado["unidades"])
        and sum(unidad["horas"] for unidad in certificado["unidades"]) > certificado["horas"]
    )


def controles_de_horas(controles: Controles, certificados: list[dict[str, Any]]) -> None:
    """Las horas de los módulos de cada certificado no pasan de las del certificado, salvo los conocidos."""
    nuevos = sorted(set(horas_que_no_cuadran(certificados)) - HORAS_SIN_CUADRAR)
    controles.comprobar(
        not nuevos,
        "las horas de los módulos de cada certificado no pasan de las del certificado, salvo los "
        f"{len(HORAS_SIN_CUADRAR)} conocidos (HORAS_SIN_CUADRAR), de los que el motor no da las horas del certificado"
        + (f" (no: {', '.join(nuevos)})" if nuevos else ""),
    )


def controles_de_codigos(controles: Controles, certificados: list[dict[str, Any]]) -> None:
    """Los códigos de ocupación de los anexos existen en su clasificación."""
    lineas = [
        ocupacion
        for certificado in certificados
        if certificado["anexo"]
        for ocupacion in certificado["anexo"]["ocupaciones"]
        if ocupacion["clase"] != "sin-codigo"
    ]
    conocidos = sum(1 for ocupacion in lineas if ocupacion["clase"] != "desconocido")
    controles.comprobar(
        conocidos / max(len(lineas), 1) >= MIN_PARTE_CODIGOS_CONOCIDOS,
        f"{conocidos} de {len(lineas)} códigos de ocupación de los anexos tienen su grupo en la CNO-11 o en la "
        f"correspondencia CNO-94 del INE (se espera al menos el {MIN_PARTE_CODIGOS_CONOCIDOS:.0%})",
    )
    relacionables = sum(1 for certificado in certificados if certificado["ocupaciones"] or certificado["grupos"])
    controles.comprobar(
        relacionables > 0,
        f"{relacionables} certificados con algún código de ocupación que los relaciona con una ocupación",
    )


def controles_de_ejemplos(controles: Controles, todas: Relaciones) -> None:
    """Las ocupaciones del estudio y sus grupos dan su certificado, y ninguna relación descartada vuelve a aparecer."""
    for esco, certificado, esperada in EJEMPLOS:
        obtenida = todas.ocupaciones.get(esco, {}).get(certificado)
        controles.comprobar(
            obtenida == esperada,
            f"la ocupación {esco} se relaciona con {certificado} por {esperada} (da: {obtenida or 'ninguna'})",
        )
    for isco, certificado in EJEMPLOS_DE_GRUPO:
        controles.comprobar(
            certificado in todas.grupos.get(isco, {}),
            f"el grupo ISCO-08 {isco}, sin ocupación ESCO, da {certificado} (la mayoría de sus ocupaciones lo dan)",
        )
    vueltas = [
        f"{clave}→{descartado}"
        for clave, descartado in DESCARTADAS
        if descartado in (todas.grupos if len(clave) == CIFRAS_GRUPO_ISCO else todas.ocupaciones).get(clave, {})
    ]
    controles.comprobar(
        not vueltas,
        "ninguna relación descartada a mano vuelve a aparecer (DESCARTADAS)"
        + (f" (vuelven: {', '.join(vueltas)})" if vueltas else ""),
    )


def controles_de_revision(
    controles: Controles,
    cadena: Cadena,
    todas: Relaciones,
    admitidas: dict[tuple[str, str], Revision],
    catalogo: Container[str],
) -> None:
    """Se enseña justo lo admitido: nada sin admitir ni descartado, y ninguna admitida del paquete se queda fuera.

    La relación de un grupo ISCO-08, además, la comparten así más de la mitad de sus ocupaciones.
    """
    descartadas = set(DESCARTADAS)

    def vale(esco: str, codigo: str) -> bool:
        """Si la revisión admite la relación y el certificado está en el paquete.

        Returns:
            Si la relación se enseña.
        """
        return (esco, codigo) in admitidas and codigo in catalogo

    del_grupo = ocupaciones_por_grupo(cadena)
    sueltas = [
        f"{esco}→{codigo}"
        for esco, encontradas in todas.ocupaciones.items()
        for codigo in encontradas
        if not vale(esco, codigo) or (esco, codigo) in descartadas
    ] + [
        f"{isco}→{codigo}"
        for isco, encontradas in todas.grupos.items()
        for codigo in encontradas
        if (isco, codigo) in descartadas
        or 2 * sum(vale(esco, codigo) for esco in del_grupo.get(isco, [])) <= len(del_grupo.get(isco, []))
    ]
    controles.comprobar(
        not sueltas,
        "cada relación que se enseña la admite la revisión (ADMITIDAS) y no está en DESCARTADAS"
        + (f" (no: {', '.join(sueltas[:20])})" if sueltas else ""),
    )
    fuera = [
        f"{esco}→{codigo}"
        for esco, codigo in sorted(admitidas)
        if esco in cadena.ocupaciones
        and codigo in catalogo
        and (esco, codigo) not in descartadas
        and codigo not in todas.ocupaciones.get(esco, {})
    ]
    controles.comprobar(
        not fuera,
        "ninguna relación admitida con su ocupación y su certificado en el paquete se queda sin enseñar"
        + (f" (fuera: {', '.join(fuera[:20])})" if fuera else ""),
    )


def controles_de_normas(controles: Controles, normas: dict[str, Any]) -> None:
    """Cada pasaje está literal en su norma, y las unidades de la atención domiciliaria tienen su equivalente."""
    for clave, pasaje in normas["pasajes"].items():
        controles.comprobar(pasaje["literal"], f"el pasaje «{clave}» está literal en el {pasaje['norma']}")
    sustituidas = [unidad for unidad in UNIDADES_SUSTITUIDAS if normas["equivalencias"].get(unidad)]
    controles.comprobar(
        len(sustituidas) == len(UNIDADES_SUSTITUIDAS),
        "el anexo XIII-a del Real Decreto 151/2022 da la unidad actual de UC0249_2, UC0250_2 y UC0251_2 (SSCS0108)",
    )


def punto_de_informacion(paginas: dict[str, Any]) -> dict[str, Any]:
    """El teléfono del punto de información de Cornellà, con la página que lo dice y el día en que se comprobó.

    Returns:
        El teléfono, la página que lo dice y el día de la comprobación.
    """
    pagina = paginas[PUNTO_DE_INFORMACION]
    return {"telefono": pagina["telefono"], "url": pagina["url"]["ca"], "comprobado": pagina["comprobado"]}


def controles_del_punto_de_informacion(controles: Controles, paginas: dict[str, Any]) -> None:
    """El teléfono exportado figura en la cita registrada del Ajuntament y tiene una huella registrada."""
    pagina = paginas[PUNTO_DE_INFORMACION]
    controles.comprobar(
        f"Tel. {pagina['telefono']}" in pagina["dice"] and pagina["sha256"] is not None,
        f"el teléfono del punto de información de Cornellà ({pagina['telefono']}) está en la cita "
        "registrada del Ajuntament, con una huella registrada",
    )


def avisos_de_paginas(paginas: dict[str, Any], hoy: date) -> list[str]:
    """Avisos (no fallos) de las páginas registradas a mano: sin huella o comprobadas hace más de MAX_DIAS_REGISTRO.

    Returns:
        Los avisos por página; vacía si no hay ninguno.

    Raises:
        FormatoInesperado: Si una fecha registrada es ilegible o futura.
    """
    avisos = []
    for clave, pagina in paginas.items():
        try:
            comprobado = date.fromisoformat(pagina["comprobado"])
        except (TypeError, ValueError) as error:
            raise FormatoInesperado(f"{clave}: fecha de comprobación no válida: {pagina['comprobado']!r}") from error
        exigir(comprobado <= hoy, f"{clave}: fecha de comprobación futura: {pagina['comprobado']}")
        dias = (hoy - comprobado).days
        if dias > MAX_DIAS_REGISTRO:
            avisos.append(f"{clave}: comprobada hace {dias} días (más de {MAX_DIAS_REGISTRO}); volver a comprobarla")
        if pagina["sha256"] is None:
            avisos.append(f"{clave}: sin huella; robots.txt prohíbe la lectura automática y falta guardarla a mano")
    return avisos
