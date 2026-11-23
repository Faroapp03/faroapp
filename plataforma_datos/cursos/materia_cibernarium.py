"""Evidencia estructurada de materia, a partir de recepciones admitidas de Cibernàrium.

No decide una clasificación ni reproduce la descripción en la entrega.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import contenido_aprendizaje, contenido_cibernarium, operacion_fuente, registro_vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.materia_censos_cibernarium import (
    CARPETA_CENSOS as CARPETA_CENSOS,
)
from plataforma_datos.cursos.materia_censos_cibernarium import (
    _censo_en_almacen,
    _copiar_censo,
    _resumen_canal,
)
from plataforma_datos.cursos.materia_censos_cibernarium import (
    guardar_censo_admitido as guardar_censo_admitido,
)
from plataforma_datos.cursos.materia_censos_cibernarium import (
    leer_censo_archivado as leer_censo_archivado,
)

METODO_CONTENIDO = "cibernarium-descripcion-api-v1"
CAMPOS_CONTENIDO = ("title", "description", "category", "categoryId", "subCategoryId")
CONTROL = "control-materia-cibernarium"
APOYOS_IDENTIDAD = 2


@dataclass(frozen=True)
class CicloMateria:
    """Conjunto del canal y condición causal de su aplicación."""

    conjunto: dict
    pendiente: bool = False


@dataclass
class _ContextoLectura:
    referencias: dict
    control: dict
    censos: dict
    corte: str


def _apoyos_identidad(seleccion: dict, id_edicion: str) -> tuple[dict, dict]:
    """Comprueba los roles de actividad y edición, sin depender del orden de las pruebas.

    Returns:
        Los apoyos verificados de actividad y edición.
    """
    actividad, edicion, identidad = seleccion["actividad"], seleccion["edicion"], seleccion["identidad"]
    exigir(
        actividad.get("activityId") == identidad["actividad_id"]
        and id_edicion == "cibernarium-edicion:" + edicion.get("activityId", ""),
        "Identidad de materia ajena a la selección",
    )
    pruebas = [e for e in seleccion["observacion"]["evidencias"] if e["alcance"] == "identidad"]
    exigir(len(pruebas) == APOYOS_IDENTIDAD, "Identidad de edición sin sus dos apoyos")
    actividad_pruebas = []
    edicion_pruebas = []
    for prueba in pruebas:
        localizador = prueba.get("localizador")
        exigir(isinstance(localizador, dict) and localizador.get("tipo") == "campo", "Apoyo sin localizador de campo")
        valor = localizador.get("valor")
        exigir(isinstance(valor, str), "Localizador de identidad incompatible")
        if re.fullmatch(r"/activities/[0-9]+/activityId", valor):
            actividad_pruebas.append(prueba)
        elif re.fullmatch(r"/activities/[0-9]+/listEditions/[0-9]+/activityId", valor):
            edicion_pruebas.append(prueba)
    exigir(len(actividad_pruebas) == 1 and len(edicion_pruebas) == 1, "Apoyos de identidad ambiguos")
    a, e = actividad_pruebas[0], edicion_pruebas[0]
    raiz = a["localizador"]["valor"].removesuffix("/activityId")
    exigir(
        e["localizador"]["valor"].startswith(raiz + "/listEditions/")
        and all(a.get(k) == e.get(k) for k in ("url", "sha256", "capturado_utc")),
        "Apoyos de identidad de distinta captura o actividad",
    )
    return a, e


def proyectar(selecciones: dict, censo: dict | None, anteriores: dict) -> dict:
    """Proyecta la evidencia de selecciones verificadas; el estado anterior debe ser una entrega admitida.

    Un censo parcial conserva únicamente la evidencia de censo anterior de la misma edición,
    programa y cabecera, sin cambiar su fecha. Un censo completo sin presencia no afirma otra materia.

    Returns:
        Evidencias por ID de edición, sin títulos ni descripciones de la fuente.
    """
    salida = {}
    for id, seleccion in selecciones.items():
        actividad, identidad = seleccion["actividad"], seleccion["identidad"]
        descripcion = actividad.get("description")
        contenido_conocido = (
            isinstance(descripcion, str) and bool(descripcion.strip()) and all(k in actividad for k in CAMPOS_CONTENIDO)
        )
        prueba_actividad, evidencia = _apoyos_identidad(seleccion, id)
        actividad_id = identidad["actividad_id"]
        programa_id = identidad["programa_id"]
        huella_contenido = sha256_json([actividad[k] for k in CAMPOS_CONTENIDO]) if contenido_conocido else None
        anterior = anteriores.get(id)
        previa = (
            anterior.get("censo_ia")
            if isinstance(anterior, dict)
            and anterior.get("edicion_id") == id
            and anterior.get("programa_id") == programa_id
            and anterior.get("actividad_id") == actividad_id
            else None
        )
        censo_fila = previa if censo is None else censo.get(actividad_id)
        localizador = prueba_actividad["localizador"]["valor"].removesuffix("/activityId")
        salida[id] = {
            "version": 1,
            "actividad_id": actividad_id,
            "programa_id": programa_id,
            "edicion_id": id,
            "vinculo": {
                "url": evidencia["url"],
                "sha256": evidencia["sha256"],
                "capturado_utc": evidencia["capturado_utc"],
                "localizador": evidencia["localizador"]["valor"],
            },
            "contenido": {
                "metodo": METODO_CONTENIDO,
                "sha256": huella_contenido,
                "url": prueba_actividad["url"],
                "sha256_captura": prueba_actividad["sha256"],
                "capturado_utc": prueba_actividad["capturado_utc"],
                "localizador": localizador,
            }
            if contenido_conocido
            else None,
            "censo_ia": censo_fila,
            "estado_censo": "parcial" if censo is None else "completo",
        }
    return salida


def _selecciones(solicitud: admision.SolicitudAdmision, ids_ediciones: set[str], corte: str) -> dict:
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
    evaluaciones = {}
    for id in ids_ediciones:
        fila = registro_vigencia.consultar_edicion(solicitud.snapshot.ruta, id)
        evaluacion = fila.get("evaluacion")
        if evaluacion is not None and robot.fecha_utc(evaluacion["corte_utc"]) <= robot.fecha_utc(corte):
            evaluaciones[id] = evaluacion
    return contenido_cibernarium.selecciones_verificadas(solicitud, ids_ediciones, referencias, evaluaciones, corte)


def _control_materia(solicitud: admision.SolicitudAdmision, referencias: dict) -> dict | None:
    ref = solicitud.procedencia.get(CONTROL)
    if ref is None:
        return None
    control = almacen.leer_documento_indexado(ref, referencias)
    exigir(
        set(control) == {"version", "ediciones", "ciclos", "fuentes"}
        and control["version"] == 1
        and all(isinstance(control[k], dict) for k in ("ediciones", "ciclos", "fuentes")),
        "Control de materia incompatible",
    )
    return control


def _verificar_fila(guardada: dict, actual: dict, contexto: _ContextoLectura) -> None:
    """Reproduce la observación y el positivo de una fila antes de usarla."""
    referencias, control, censos, corte = contexto.referencias, contexto.control, contexto.censos, contexto.corte
    id = actual["edicion_id"]
    exigir(guardada["estado_censo"] in ("completo", "parcial", "sin-evidencia"), "Estado de censo incompatible")
    evidencia = guardada["censo_ia"]
    relaciones = control["ciclos"].get(id, {})
    exigir(isinstance(relaciones, dict) and set(relaciones) == {"observacion", "positivo"}, "Ciclos IA incompatibles")
    observacion = relaciones["observacion"]
    if observacion is not None:
        exigir(observacion in control["fuentes"], "Observación IA sin recibo")
        if observacion not in censos:
            censos[observacion] = _censo_en_almacen(referencias, control["fuentes"][observacion], corte)
        exigir((censos[observacion] is None) == (guardada["estado_censo"] == "parcial"), "Estado IA distinto del ciclo")
    else:
        exigir(guardada["estado_censo"] == "sin-evidencia", "Estado IA sin observación")
    exigir(guardada["estado_censo"] != "sin-evidencia" or evidencia is None, "Censo sin evidencia incompatible")
    if evidencia is not None:
        exigir(isinstance(evidencia, dict) and evidencia.get("sha256") in referencias, "Censo IA sin cuerpo indexado")
        clave = relaciones["positivo"]
        exigir(clave in control["fuentes"], "Censo IA sin ciclo admitido")
        exigir(
            guardada["estado_censo"] != "completo" or clave == observacion,
            "Censo completo con evidencia de otro ciclo",
        )
        if clave not in censos:
            censos[clave] = _censo_en_almacen(referencias, control["fuentes"][clave], corte)
        exigir(
            censos[clave] is not None and censos[clave].get(actual["actividad_id"]) == evidencia,
            "Censo IA de otra actividad o captura",
        )
    elif observacion is not None and guardada["estado_censo"] == "completo":
        exigir(actual["actividad_id"] not in censos[observacion], "Ausencia IA no reproducida")
    if evidencia is None:
        exigir(relaciones["positivo"] is None, "Ciclo positivo sin evidencia")


def _actuales(solicitud: admision.SolicitudAdmision, ids_ediciones: set[str], corte: str, *, herencia: bool) -> dict:
    """Lee únicamente la evidencia archivada en el índice de la solicitud admitida.

    Returns:
        Evidencia por edición aún ligada a la selección actual; sin control, ninguna.
    """
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
    control = _control_materia(solicitud, referencias)
    if control is None:
        return {}
    selecciones = _selecciones(solicitud, ids_ediciones, corte)
    reproducidas = proyectar(selecciones, None, {})
    salida = {}
    contexto = _ContextoLectura(referencias, control, {}, corte)
    for id, actual in reproducidas.items():
        guardada = control["ediciones"].get(id)
        if not isinstance(guardada, dict):
            continue
        exigir(set(guardada) == set(actual), "Materia archivada incompatible")
        campos = ("version", "actividad_id", "programa_id", "edicion_id")
        if not herencia:
            campos += ("vinculo", "contenido")
        if any(guardada[k] != actual[k] for k in campos):
            continue
        _verificar_fila(guardada, actual, contexto)
        salida[id] = guardada
    return salida


def actuales(solicitud: admision.SolicitudAdmision, ids_ediciones: set[str], corte: str) -> dict:
    """Devuelve únicamente materia que coincide con la selección vigente.

    Returns:
        Evidencia verificada por identificador de edición.
    """
    filas = _actuales(solicitud, ids_ediciones, corte, herencia=False)
    # La clasificación se calcula después de validar el control archivado: no altera su esquema ni sus recibos.
    if not any(fila.get("contenido") for fila in filas.values()):
        return filas
    from plataforma_datos.cursos import materia_sugerencias_cibernarium as sugerencias
    from plataforma_datos.cursos import nivel_sugerencias_cibernarium as niveles

    reglas, huella_reglas = sugerencias.leer_reglas()
    selecciones = _selecciones(solicitud, set(filas), corte)
    salida = {}
    for id_edicion, fila in filas.items():
        contenido = fila.get("contenido")
        seleccion = selecciones.get(id_edicion)
        if not contenido or not seleccion:
            salida[id_edicion] = fila
            continue
        actividad = seleccion["actividad"]
        if not all(k in actividad for k in CAMPOS_CONTENIDO):
            salida[id_edicion] = fila
            continue
        huella = sha256_json([actividad[k] for k in CAMPOS_CONTENIDO])
        if huella != contenido["sha256"]:
            salida[id_edicion] = fila
            continue
        temas = sugerencias.sugerir(actividad, reglas)
        nivel = niveles.sugerir(actividad)
        extras = {}
        if temas:
            extras.update(temas_sugeridos=temas, reglas_sha256=huella_reglas)
        if nivel:
            extras["nivel_sugerido"] = nivel
        salida[id_edicion] = {**fila, "contenido": {**contenido, **extras}} if extras else fila
    return salida


def _preparar_control(
    selecciones: dict, anteriores: dict, anterior: dict | None, ciclo: dict | None, conjunto: dict
) -> tuple[dict, set]:
    """Construye las filas y conserva las relaciones causales de cada edición.

    Returns:
        Control reproducido y huellas de los ciclos utilizados.
    """
    recibos_canal = {c["recibo"]["sha256"] for c in conjunto["recepciones"]}
    filas = dict((anterior or {}).get("ediciones", {}))
    relaciones = dict((anterior or {}).get("ciclos", {}))
    for id, seleccion in selecciones.items():
        propio = ciclo is not None and seleccion["contexto"]["api"]["recibo_sha256"] in recibos_canal
        censo = ciclo["censo"] if propio else None
        fila = proyectar({id: seleccion}, censo, anteriores)[id]
        previo = (anterior or {}).get("ciclos", {}).get(id, {"observacion": None, "positivo": None})
        if propio:
            observacion = ciclo["sha256"]
        elif fila["censo_ia"] is not None:
            observacion = previo["observacion"]
            fila["estado_censo"] = anteriores[id]["estado_censo"]
        else:
            observacion = None
            fila["estado_censo"] = "sin-evidencia"
        positivo = None
        if fila["censo_ia"] is not None:
            positivo = ciclo["sha256"] if propio and censo is not None else previo["positivo"]
        filas[id] = fila
        relaciones[id] = {"observacion": observacion, "positivo": positivo}
    fuentes = dict((anterior or {}).get("fuentes", {}))
    usados = {sha for relacion in relaciones.values() for sha in relacion.values() if sha is not None}
    fuentes = {sha: dato for sha, dato in fuentes.items() if sha in usados}
    esperado = {"version": 1, "ediciones": filas, "ciclos": relaciones, "fuentes": fuentes}
    if ciclo is not None and ciclo["sha256"] in usados:
        esperado["fuentes"][ciclo["sha256"]] = {
            "recibo_sha256": ciclo["sha256"],
            "raiz": "evidencias/materia-censo/" + ciclo["sha256"],
            "canal": _resumen_canal(conjunto),
        }
    return esperado, usados


def incorporar(
    entrada: almacen.EntradaCatalogo, *, raiz: Path, ciclo_materia: CicloMateria, destino: Path, corte: str
) -> bool:
    """Admite una candidata con materia reproducida y el censo causal, sin mutar la entrada.

    Returns:
        True si preparó una candidata nueva, False si la evidencia no cambia.
    """
    from plataforma_datos.cursos.fuentes.barcelonactiva import negocio_actual

    conjunto = ciclo_materia.conjunto
    solicitud = entrada.admision
    admision.exigir_snapshot_admitido(solicitud, sha256_validacion=entrada.sha256_admision)
    _, ediciones = negocio_actual.leer(solicitud.snapshot.ruta)
    ids = set(ediciones)
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
    anterior = _control_materia(solicitud, referencias)
    anteriores = _actuales(solicitud, ids, corte, herencia=True)
    selecciones = _selecciones(solicitud, ids, corte)
    ciclo = leer_censo_archivado(raiz, conjunto, corte, pendiente=ciclo_materia.pendiente)
    esperado, usados = _preparar_control(selecciones, anteriores, anterior, ciclo, conjunto)
    if esperado == anterior or (anterior is None and not esperado["ediciones"]):
        return False
    control = almacen.conservar(entrada, destino=destino)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    if ciclo is not None and ciclo["sha256"] in usados:
        _copiar_censo(raiz, destino, ciclo, conjunto, inventario)
    control["procedencia"][CONTROL] = almacen.archivar_documento(
        operacion_fuente.json_bytes(esperado),
        destino,
        inventario,
        campos_evento=frozenset({"ediciones", "ciclos", "fuentes"}),
    )
    control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
    from plataforma_datos.comun.entrada_salida import guardar_json

    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return True


def corte_proyeccion(solicitud: admision.SolicitudAdmision, corte_vigencia: str, limite: str) -> str:
    """Incluye el corte de materia sin cambiar ni rehacer evaluaciones de edición.

    Returns:
        Corte máximo admitido que no supera el límite solicitado.
    """
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
    control = _control_materia(solicitud, referencias)
    if control is None:
        return corte_vigencia
    mayor = robot.fecha_utc(corte_vigencia)
    resultado = corte_vigencia
    for ciclo in control["fuentes"].values():
        ref = referencias.get(ciclo["recibo_sha256"])
        exigir(ref is not None, "Corte IA sin recibo admitido")
        recibo = operacion_fuente.recibos_compartidos.leer_json(
            almacen.leer_evidencia(ref.ruta, ciclo["recibo_sha256"], "Recibo de corte IA alterado")
        )
        fecha = recibo["corte_utc"]
        instante = robot.fecha_utc(fecha)
        exigir(instante <= robot.fecha_utc(limite), "Corte IA posterior al solicitado")
        if instante > mayor:
            mayor, resultado = instante, fecha
    return resultado
