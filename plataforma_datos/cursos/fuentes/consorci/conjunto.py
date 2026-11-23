"""Valida y monta el conjunto del Consorci que exporta `cursos/fuentes/consorci/lector.py` al paquete del motor.

Separa los controles de recuentos, unión, condiciones y ediciones del proceso de preparación. Los contactos
publicables se comprueban como buzones de entidad y teléfonos fijos; las entidades que son personas físicas
solo aportan la página de contacto oficial de la fuente.
"""

import re
from collections import Counter, defaultdict
from typing import Any

from plataforma_datos.comun.entrada_salida import controles_de_huella, leer_json, leer_jsonl, procedencia
from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.comun.socrata import LIMITE_FILAS
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.cursos.fuentes.consorci.constantes import (
    ACCIONES,
    ACCIONES_PREVISTAS,
    BUSCADOR,
    CAMPOS_DE_LA_EDICION,
    CAMPOS_DE_LA_ENTIDAD,
    CONJUNTOS_CITADOS,
    CONTACTO_OFICIAL,
    CURSOS,
    DESTINATARIOS_OCUPADAS,
    EDICIONES,
    EN_PROGRAMACION,
    FINANCIACION_PUBLICA,
    FORMATO_ENTIDAD,
    FUENTE,
    INICIADO,
    MIN_PARTE_CON_CODIGO,
    MODALIDADES,
    MODALIDADES_PREVISTAS,
    OFERTA,
    ORGANISMO,
    ORIGEN_CONSORCI,
    ORIGINAL,
    POR_INICIAR,
    PRECIO_GRATUITO,
    PRECIO_SUBVENCIONADO,
    PREVISTAS,
    RESUMEN,
    SIN_FECHA,
    SIN_FECHA_CONOCIDA,
    TERMINADO,
    VERSIONES_DE_LOS_CURSOS,
    Preparados,
)
from plataforma_datos.cursos.fuentes.consorci.contactos import es_correo_de_la_entidad, es_telefono_fijo
from plataforma_datos.cursos.fuentes.consorci.oferta_emparejada import IDENTICA, NO_COMPARABLE, contrastar
from plataforma_datos.cursos.fuentes.formacion.lector import PREPARADOS as PREPARADOS_FORMACION
from plataforma_datos.cursos.fuentes.formacion.lector import es_fecha_real
from plataforma_datos.orquestacion.admision import exigir_admitido


def _controles_de_recuento(controles: Controles, resumen: dict[str, Any]) -> None:
    """Cada conjunto trae las filas que declaran sus metadatos, sin llegar al límite de la API."""
    for identificador, conjunto in resumen["conjuntos"].items():
        # De la oferta FPCAT solo se descargan las filas del Consorci: se comparan con las que sus metadatos le dan.
        filtrado = identificador == OFERTA.identificador
        declaradas = (
            conjunto["filas_por_origen"].get(ORIGEN_CONSORCI) if filtrado else conjunto["filas_segun_metadatos"]
        )
        controles.comprobar(
            conjunto["filas"] == declaradas,
            f"{identificador}: {numero_es(conjunto['filas'])} filas descargadas, las que declaran sus metadatos "
            f"({numero_es(declaradas or 0)})",
        )
        controles.comprobar(
            conjunto["filas"] < LIMITE_FILAS,
            f"{identificador}: la descarga no llega al límite de {numero_es(LIMITE_FILAS)} filas por petición",
        )


def _comprobar_parte_con_codigo(controles: Controles, filas: list[dict[str, Any]], elementos: str, via: str) -> None:
    """Alarma si menos de MIN_PARTE_CON_CODIGO de las filas tienen su código de especialidad.

    Args:
        controles: Los controles de la validación, donde se anota este.
        filas: Las ediciones o las acciones previstas preparadas.
        elementos: Cómo se llaman las filas en el mensaje («ediciones», «acciones previstas»).
        via: Por dónde se busca el código, para el mensaje.
    """
    con_codigo = sum(1 for fila in filas if fila["especialidad"])
    parte = con_codigo / len(filas) if filas else 0
    controles.comprobar(
        parte >= MIN_PARTE_CON_CODIGO,
        f"{con_codigo} de {len(filas)} {elementos} ({numero_es(parte * 100, 1)} %) tienen su código de especialidad, "
        f"{via} (alarma por debajo del {numero_es(MIN_PARTE_CON_CODIGO * 100)} %)",
    )


def _controles_de_union(controles: Controles, preparados: Preparados) -> None:
    """La unión da su código a casi todas las ediciones y acciones previstas."""
    _comprobar_parte_con_codigo(
        controles,
        preparados.ediciones,
        "ediciones",
        f"por su curso de {CURSOS.identificador} o por el certificado de su nombre",
    )
    _comprobar_parte_con_codigo(
        controles,
        preparados.previstas,
        "acciones previstas",
        f"por sus ediciones, por su nombre en {CURSOS.identificador} o por el certificado de su nombre",
    )


def contraste_de_la_oferta(preparados: Preparados) -> dict[str, Any]:
    """La oferta FPCAT frente a la versión de jdcj-za6r en vigor cuando se actualizó (oferta_emparejada).

    Returns:
        El resultado del contraste, con las fechas de las dos versiones y lo comparado.
    """
    conjuntos = preparados.resumen["conjuntos"]
    return contrastar(
        conjuntos[OFERTA.identificador]["oferta"], conjuntos[CURSOS.identificador]["oferta"], list(preparados.versiones)
    )


def _controles_del_contraste(controles: Controles, preparados: Preparados) -> dict[str, Any]:
    """El formato de las fechas de jdcj-za6r, siempre; y la oferta FPCAT idéntica a su pareja, si la tiene.

    Sin pareja, el contraste no es un control: se devuelve «no comparable» con su desfase, que validar anota.

    Returns:
        El contraste de la oferta, con su resultado.
    """
    cursos = preparados.resumen["conjuntos"][CURSOS.identificador]
    controles.comprobar(
        cursos["con_fecha_o_en_programacion"] == cursos["filas"],
        f"cada curso de {CURSOS.identificador} tiene fecha de inicio o «{EN_PROGRAMACION}» "
        f"({numero_es(cursos['con_fecha_o_en_programacion'])} de {numero_es(cursos['filas'])})",
    )
    contraste = contraste_de_la_oferta(preparados)
    if contraste["resultado"] != NO_COMPARABLE:
        controles.comprobar(
            contraste["resultado"] == IDENTICA,
            f"la oferta FPCAT ({OFERTA.identificador}, actualizada el {contraste['oferta_actualizada']}) tiene las "
            f"mismas ediciones del Consorci, por oferta y fecha de inicio ({numero_es(contraste['con_fecha'])}), que "
            f"la versión de {CURSOS.identificador} en vigor entonces ({', '.join(contraste['comparada_con'])})",
        )
    return contraste


def _controles_de_condiciones(controles: Controles, resumen: dict[str, Any]) -> None:
    """A quién se dirigen, que son gratuitos y que se imparten de una modalidad conocida."""
    controles.comprobar(
        resumen["destinatarios"] == [DESTINATARIOS_OCUPADAS],
        f"todos los cursos se dirigen a «{DESTINATARIOS_OCUPADAS}» ({CURSOS.identificador} y {OFERTA.identificador})",
    )
    precios = resumen["precios"]
    controles.comprobar(
        precios[CURSOS.identificador] == [PRECIO_GRATUITO]
        and resumen["financiacion_publica"] == [FINANCIACION_PUBLICA]
        and precios[OFERTA.identificador] == [PRECIO_SUBVENCIONADO],
        f"todos son gratuitos: precio {PRECIO_GRATUITO} y financiación pública en {CURSOS.identificador}, "
        f"«{PRECIO_SUBVENCIONADO}» en {OFERTA.identificador}",
    )
    controles.comprobar(
        set(resumen["modalidades"]) <= set(MODALIDADES),
        "cada edición tiene una modalidad conocida: " + ", ".join(MODALIDADES),
    )
    controles.comprobar(
        set(resumen["modalidades_de_las_previstas"]) <= set(MODALIDADES_PREVISTAS),
        "cada acción prevista tiene una modalidad conocida: " + ", ".join(MODALIDADES_PREVISTAS),
    )


def _controles_de_ediciones(controles: Controles, ediciones: list[dict[str, Any]], copia: str) -> None:
    """Identidad, fechas, horas, lugar y estado de cada edición el día de la copia."""
    controles.comprobar(
        len({edicion["id"] for edicion in ediciones}) == len(ediciones), "cada edición tiene un identificador propio"
    )
    controles.comprobar(
        all(es_fecha_real(edicion["inicio"]) and es_fecha_real(edicion["fin"]) for edicion in ediciones)
        and all(edicion["inicio"] <= edicion["fin"] for edicion in ediciones),
        "cada edición tiene inicio y fin reales, y no termina antes de empezar",
    )
    controles.comprobar(
        all(es_fecha_real(edicion["fin"]) and edicion["fin"] >= copia for edicion in ediciones),
        f"ninguna edición terminó antes de la copia ({copia})",
    )
    # Las fechas defectuosas ya fallan su control; no deben impedir que se complete el informe.
    empezadas = [
        edicion
        for edicion in ediciones
        if es_fecha_real(edicion["inicio"]) and es_fecha_real(edicion["fin"]) and edicion["inicio"] <= copia
    ]
    controles.comprobar(
        all(momento_en(edicion, copia) == INICIADO for edicion in empezadas),
        f"ninguna de las {len(empezadas)} ediciones empezadas el día de la copia ({copia}) se da por abierta",
    )
    controles.comprobar(
        all(re.fullmatch(r"[1-9]\d*", edicion["horas"]) for edicion in ediciones),
        "las horas de cada edición son un número entero positivo",
    )
    controles.comprobar(
        all(edicion["comarca"] for edicion in ediciones if not edicion["a_distancia"]),
        "cada edición presencial es de un municipio de Cataluña, con su comarca",
    )


def _controles_de_contacto(controles: Controles, filas: list[dict[str, Any]], que: str) -> None:
    """Cada edición o acción prevista dice con quién inscribirse, sin ningún dato que pueda ser de una persona.

    El contacto oficial solo cuenta como forma de contactar si es la página declarada (`CONTACTO_OFICIAL`).
    """
    controles.comprobar(
        all(
            fila["web"] or fila["correo"] or fila["telefono"] or fila["contacto_oficial"] == CONTACTO_OFICIAL
            for fila in filas
        ),
        f"cada una de las {que} tiene una forma de contactar con la entidad (web, correo de la entidad, fijo o, si es "
        "una persona física, la página de contacto del Consorci)",
    )
    controles.comprobar(
        all(not fila["correo"] or es_correo_de_la_entidad(fila["correo"]) for fila in filas)
        and all(not fila["telefono"] or es_telefono_fijo(fila["telefono"]) for fila in filas),
        f"ningún correo ni teléfono de las {que} puede ser el de una persona: solo buzones de la entidad y fijos",
    )
    controles.comprobar(
        all(
            fila["contacto_oficial"] is None
            or (fila["entidad"] is None and not (fila["web"] or fila["correo"] or fila["telefono"]))
            for fila in filas
        ),
        f"las {que} con el contacto oficial son de personas físicas: sin su nombre, su web, su correo ni su teléfono",
    )


def _fechas_en_texto(fechas: list[str]) -> str:
    """Fechas ISO como «03/10/2026 y el 05/10/2026» (o con comas, si son más de dos).

    Returns:
        Las fechas en DD/MM/AAAA, unidas como las dice la cita.
    """
    # La cita procede de CONJUNTOS_CITADOS, una tupla no vacía: siempre hay al menos una fecha.
    legibles = ["/".join(reversed(fecha.split("-"))) for fecha in fechas]
    if len(legibles) == 1:
        return legibles[0]
    return ", el ".join(legibles[:-1]) + " y el " + legibles[-1]


def _entidades_de(previstas: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[tuple[Any, ...], str]]:
    """Cada entidad de las acciones previstas una sola vez, con un identificador propio, y el de cada contacto.

    Returns:
        Por identificador, los campos de cada entidad; y por los campos de cada entidad, su identificador.
    """
    # El orden por el texto de cada campo fija los identificadores; dos entidades con el mismo texto y valores de otro
    # tipo (None y «None») se ordenan después por el tipo, para que el orden no dependa del recorrido del conjunto.
    distintas = sorted(
        {tuple(accion[campo] for campo in CAMPOS_DE_LA_ENTIDAD) for accion in previstas},
        key=lambda fila: ([str(valor) for valor in fila], [type(valor).__name__ for valor in fila]),
    )
    identificadores = {fila: FORMATO_ENTIDAD.format(numero) for numero, fila in enumerate(distintas, start=1)}
    entidades = {
        identificador: dict(zip(CAMPOS_DE_LA_ENTIDAD, fila, strict=True))
        for fila, identificador in identificadores.items()
    }
    return entidades, identificadores


def momento_en(edicion: dict[str, Any], dia: str) -> str:
    """Momento de una edición el día `dia`, con la regla del informe (motores/cursos/src/vigencia-cursos.ts).

    «por-iniciar» solo si empieza después de ese día; el día de inicio ya ha empezado.

    Returns:
        «terminado», «sin-fecha», «por-iniciar» o «iniciado».
    """
    if edicion["fin"] and edicion["fin"] < dia:
        return TERMINADO
    if not edicion["inicio"]:
        return SIN_FECHA_CONOCIDA
    return POR_INICIAR if edicion["inicio"] > dia else INICIADO


def comprobar_preparados(preparados: Preparados) -> Controles:
    """Todos los controles del Consorci, en el orden de `validacion.json`.

    Returns:
        Los controles, con su resultado.
    """
    resumen = preparados.resumen
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia(FUENTE))
    _controles_de_recuento(controles, resumen)
    _controles_de_union(controles, preparados)
    _controles_del_contraste(controles, preparados)
    _controles_de_condiciones(controles, resumen)
    _controles_de_ediciones(controles, preparados.ediciones, resumen["copia"])
    _controles_de_contacto(controles, preparados.ediciones, "ediciones")
    _controles_de_contacto(controles, preparados.previstas, "acciones previstas")
    return controles


def cobertura_de_preparados(preparados: Preparados) -> dict[str, int]:
    """Cuántas ediciones y acciones previstas llegan a la cadena de la ocupación (dato informativo, no un fallo).

    Returns:
        Los recuentos de ediciones y acciones previstas por lo que tienen.
    """
    exigir_admitido("formacion")
    catalogo = {fila["codigo"].split(" ")[0]: fila for fila in leer_jsonl(PREPARADOS_FORMACION["especialidades"])}
    ediciones, copia = preparados.ediciones, preparados.resumen["copia"]
    en_catalogo = [edicion for edicion in ediciones if edicion["especialidad"] in catalogo]
    return {
        "ediciones": len(ediciones),
        "con_codigo_de_especialidad": sum(1 for edicion in ediciones if edicion["especialidad"]),
        "en_el_catalogo_del_sepe": len(en_catalogo),
        "con_ocupaciones_del_sepe": sum(
            1 for edicion in en_catalogo if catalogo[edicion["especialidad"]]["ocupaciones"]
        ),
        "a_distancia": sum(1 for edicion in ediciones if edicion["a_distancia"]),
        "empezadas_el_dia_de_la_copia": sum(1 for edicion in ediciones if momento_en(edicion, copia) == INICIADO),
        "acciones_previstas": len(preparados.previstas),
        "previstas_en_el_catalogo_del_sepe": sum(
            1 for accion in preparados.previstas if accion["especialidad"] in catalogo
        ),
        "ediciones_programadas_sin_fecha": sum(preparados.sin_fecha.values()),
    }


def cita(resumen: dict[str, Any]) -> str:
    """Cita de la licencia: la fuente y la fecha de la última actualización de los conjuntos que se muestran.

    Returns:
        La cita, con la fecha de actualización de cada conjunto citado.
    """
    fechas = sorted({resumen["conjuntos"][conjunto.identificador]["actualizado"] for conjunto in CONJUNTOS_CITADOS})
    return (
        f"{ORGANISMO}: acciones formativas programadas ({ACCIONES.identificador}), cursos programados "
        f"({CURSOS.identificador}) y acciones previstas ({ACCIONES_PREVISTAS.identificador}), datos abiertos "
        f"actualizados el {_fechas_en_texto(fechas)}."
    )


def previstas_por_especialidad(previstas: list[dict[str, Any]]) -> dict[str, Any]:
    """Las acciones previstas agrupadas por especialidad, con sus entidades una sola vez: lo que exporta el paquete.

    Returns:
        Por especialidad, su nombre y sus acciones; y, por identificador, cada entidad.
    """
    # El censo de entidades incluye también acciones sin especialidad: sus ids dependen de toda la copia.
    entidades, identificador_de = _entidades_de(previstas)
    nombres: dict[str, Counter[str]] = defaultdict(Counter)
    acciones: dict[str, list[dict[str, str]]] = defaultdict(list)
    for accion in previstas:
        if not accion["especialidad"]:
            continue
        nombres[accion["especialidad"]][accion["nombre"]] += 1
        entidad = identificador_de[tuple(accion[campo] for campo in CAMPOS_DE_LA_ENTIDAD)]
        acciones[accion["especialidad"]].append(
            {"entidad": entidad, "modalidad": accion["modalidad"], "horas": accion["horas"]}
        )
    # El nombre de la especialidad en catalán: el más repetido entre sus acciones (a igualdad, el primero por orden).
    por_especialidad = {
        codigo: {"nombre": min(nombres[codigo].items(), key=lambda par: (-par[1], par[0]))[0], "acciones": lista}
        for codigo, lista in sorted(acciones.items())
    }
    return {"previstas": por_especialidad, "entidades": entidades}


def conjunto_validado(preparados: Preparados) -> dict[str, Any]:
    """Lo que exporta el paquete del motor: la cita, las fechas y la formación con código de especialidad.

    Las ediciones sin especialidad no se exportan: el motor relaciona la formación con ocupaciones por ese código.

    Returns:
        El conjunto que exporta el paquete (consorci.json).
    """
    resumen = preparados.resumen
    actualizado = min(resumen["conjuntos"][conjunto.identificador]["actualizado"] for conjunto in CONJUNTOS_CITADOS)
    ediciones = [
        {campo: edicion[campo] for campo in CAMPOS_DE_LA_EDICION}
        for edicion in preparados.ediciones
        if edicion["especialidad"]
    ]
    return {
        "fuente": cita(resumen),
        "fecha_copia": resumen["copia"],
        "actualizado": actualizado,
        "buscador": BUSCADOR,
        "ediciones": ediciones,
        **previstas_por_especialidad(preparados.previstas),
        "programadas_sin_fecha": preparados.sin_fecha,
    }


def leer_preparados() -> Preparados:
    """Lo que escribió preparar.

    Returns:
        Las ediciones, las acciones previstas, las programadas sin fecha, el resumen y las versiones de los cursos.
    """
    return Preparados(
        ediciones=leer_jsonl(EDICIONES),
        previstas=leer_jsonl(PREVISTAS),
        sin_fecha=leer_json(SIN_FECHA),
        resumen=leer_json(RESUMEN),
        versiones=tuple(leer_json(VERSIONES_DE_LOS_CURSOS)),
    )
