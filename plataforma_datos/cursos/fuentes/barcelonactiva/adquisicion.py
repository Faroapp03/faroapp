"""Canal operativo de Cibernàrium, dentro de la casa Barcelona Activa.

El censo público se reproduce con el normalizador existente. Las capturas y su
índice tienen su propia subcarpeta: nunca sustituyen la procedencia ni las
salidas ocupacionales. Recibir una página no acredita una oferta. Una página caída
deja la consulta parcial: lo leído en las demás se conserva y nada se da por ausente.
"""

import hashlib
import re
import time
from copy import deepcopy
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.barcelonactiva import contraste_ediciones, lectura, lectura_censo
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

FUENTE = "barcelonactiva"
CANAL = "cibernarium"
NORMAS = robot.ORIGEN + "/ca/normesfaqs"
MAX_PAGINAS = 100
MAX_FICHAS_NUEVAS = 20
# El supervisor limita la orden a 45 minutos. A partir del minuto 35 solo conserva el censo ya recibido.
PLAZO_PARA_OPCIONALES_S = 35 * 60
PORTLET_VALIDO = re.compile(r"cAct_INSTANCE_[A-Za-z0-9]{1,32}")


def _exigir(condicion: bool, mensaje: str) -> None:
    comun.exigir(condicion, mensaje, FormatoInesperado)


def rutas(raiz: Path) -> tuple[Path, Path, Path]:
    """Ubica el canal anidado sin adoptar la validación ocupacional.

    Returns:
        Originales, preparados y validados exclusivos del canal de Cursos.
    """
    return tuple(raiz / DATOS_RELATIVOS / g / FUENTE / CANAL for g in ("originales", "preparados", "validados"))


def _guardar_distinto(ruta: Path, documento: ObjetoJson) -> None:
    contenido = recibos_compartidos.canonico(documento)
    _exigir(not ruta.is_symlink(), "Índice Cibernàrium enlazado")
    if ruta.exists() and ruta.read_bytes() == contenido:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    escribir_atomico(ruta, contenido.decode())


def url_pagina(desde: int, portlet: str = robot.PORTLET) -> str:
    """Reutiliza la URL del robot con una cota operativa de paginación y la instancia de portlet publicada.

    Returns:
        Consulta pública exacta, sin identificadores del entorno ni de personas.
    """
    _exigir(
        type(desde) is int and 0 <= desde < MAX_PAGINAS * robot.PAGINA and desde % robot.PAGINA == 0,
        "Página Cibernàrium fuera de límite",
    )
    _exigir(PORTLET_VALIDO.fullmatch(portlet) is not None, "Instancia de portlet Cibernàrium no reconocida")
    return robot.url_pagina(desde, portlet)


def inicio_de_pagina(url: str) -> int:
    """Exige que `url` sea exactamente la de una página de la API del censo y devuelve su primer elemento.

    Returns:
        El desplazamiento `_<portlet>_start` de la página.

    Raises:
        FormatoInesperado: Si la URL no lleva un intervalo exacto o no es la que se pediría para esa página.
    """
    partes = urlsplit(url)
    parametros = parse_qs(partes.query, keep_blank_values=True)
    # Sin instancia declarada se lee con la de siempre: la comparación final con la URL exacta decide.
    portlet = (parametros.get("p_p_id") or [robot.PORTLET])[0]
    _exigir(PORTLET_VALIDO.fullmatch(portlet) is not None, "Página API sin instancia de portlet reconocida")
    valores = parametros.get(f"_{portlet}_start")
    _exigir(isinstance(valores, list) and len(valores) == 1 and valores[0].isdigit(), "Página API sin intervalo exacto")
    desde = int(valores[0])
    _exigir(url == url_pagina(desde, portlet), "Consulta ajena a la API Cibernàrium")
    return desde


def censo_instalado(conjunto: ObjetoJson, instalados: set[str]) -> bool | None:
    """Comprueba cada página del ciclo con su recibo de la API. Las fichas HTML se pueden reutilizar.

    Returns:
        True si constan todos sus recibos, False si falta alguno y None si no se puede identificar el ciclo.
    """
    if conjunto.get("fuente_id") != FUENTE or conjunto.get("canal") != CANAL:
        return None
    try:
        leidas = conjunto["recepciones"]
        primera = next(p for p in leidas if p["lectura"]["desde"] == 0)
        total = primera["lectura"]["total_actividades"]
        if type(total) is not int or not 0 < total <= MAX_PAGINAS * robot.PAGINA:
            return None
        paginas = [(p["lectura"]["desde"], p["recibo"]["sha256"]) for p in leidas]
        paginas.extend((p["lectura"]["desde"], p["intento"]["sha256"]) for p in conjunto.get("paginas_fallidas", []))
        if sorted(desde for desde, _ in paginas) == list(range(0, total, robot.PAGINA)):
            return {sha for _, sha in paginas} <= instalados
    except (KeyError, StopIteration, TypeError):
        # Un apartado histórico incompleto conserva su evidencia hasta poder identificar el ciclo.
        return None
    return None


def pagina(original: Path, captura: ObjetoJson) -> tuple[bytes | None, ObjetoJson]:
    """Verifica bytes y recibo real, también para respuestas fallidas.

    Returns:
        Cuerpo si se recibió y metadatos íntegros, sin renovar su reloj.
    """
    _exigir(
        isinstance(captura, dict)
        and set(captura)
        in (
            {"id", "cuerpo", "recibo", "metadatos", "intento"},
            {"id", "cuerpo", "recibo", "metadatos", "intento", "lectura"},
        ),
        "Campos de recepción desconocidos",
    )
    meta = comun.leer_recibo(original, captura)
    _exigir(robot.fecha_utc(meta["inicio_utc"]) <= robot.fecha_utc(meta["fin_utc"]), "Recibo Cibernàrium invertido")
    cuerpo = None
    if captura.get("cuerpo") is not None:
        cuerpo = comun.leer_conservado(original, captura["cuerpo"])
        _exigir(
            meta["bytes"] == len(cuerpo) and meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest(),
            "Cuerpo y recibo Cibernàrium distintos",
        )
    else:
        _exigir(meta.get("cuerpo_sha256") is None, "Cuerpo declarado sin referencia")
    return cuerpo, meta


def actividades(original: Path, captura: ObjetoJson) -> tuple[list[ObjetoJson], ObjetoJson]:
    """Lee una página API por su URL, estado, EOF y contrato del robot.

    Returns:
        Actividades originales para el normalizador y metadatos de la página.
    """
    cuerpo, meta = pagina(original, captura)
    desde = inicio_de_pagina(meta["url"])
    _exigir(
        cuerpo is not None
        and meta["url_final"] == meta["url"]
        and meta["http"] == HTTPStatus.OK
        and meta["completo"] is True
        and isinstance(meta.get("content_type"), str)
        and meta["content_type"].split(";", 1)[0].strip().lower() == "application/json",
        "Censo Cibernàrium sin respuesta JSON completa e identificada",
    )
    total, filas = robot.validar_pagina(recibos_compartidos.leer_json(cuerpo), desde)
    _exigir(0 < total <= MAX_PAGINAS * robot.PAGINA, "Censo Cibernàrium vacío o excesivo")
    return filas, {**meta, "total_actividades": total, "desde": desde}


def fallo_de_pagina(original: Path, captura: ObjetoJson) -> ObjetoJson | None:
    """Reconoce el intento de una página del censo que no aportó una lectura válida.

    Sin respuesta, con descarga incompleta o con un código que es fallo de consulta
    (5xx, autenticación, ritmo), la página no describe el censo: sus actividades
    quedan sin noticia, nunca ausentes. Otras respuestas se leen con el contrato estricto.

    Returns:
        Lectura del intento, sin identidades; None si la respuesta debe leerse como censo.
    """
    cuerpo, meta = pagina(original, captura)
    if cuerpo is not None and meta["completo"] is True and not comun.codigo_de_fallo(meta["http"]):
        return None
    return {
        "ids": [],
        "ediciones": [],
        "errores_ediciones": [],
        "desde": inicio_de_pagina(meta["url"]),
        **{k: meta.get(k) for k in ("inicio_utc", "fin_utc", "http")},
        "completo": False,
        "fallo": meta.get("error") or "http_" + str(meta.get("http")),
    }


def extraer(original: Path, captura: ObjetoJson) -> ObjetoJson:
    """Reproduce identidades y ediciones, sin copiar p_auth, descripciones o imágenes.

    Returns:
        Lectura técnica y fallos locales de formato; aún no decide disponibilidad.
    """
    filas, meta = actividades(original, captura)
    ids, ediciones, errores = [], [], []
    for actividad in filas:
        id = robot.identificador(actividad.get("activityId"))
        ids.append("cibernarium:" + id)
        lista = actividad.get("listEditions")
        _exigir(isinstance(lista, list) and all(isinstance(e, dict) for e in lista), "Actividad sin lista de ediciones")
        for edicion in lista:
            nativo = robot.identificador(edicion.get("activityId"))
            ediciones.append("cibernarium-edicion:" + nativo)
            try:
                robot.normalizar_edicion("cibernarium:" + id, actividad, edicion)
            except robot.ErrorRobot:
                errores.append({"id": "cibernarium-edicion:" + nativo, "motivo": "edicion_no_interpretable"})
    _exigir(len(ids) == len(set(ids)) and len(ediciones) == len(set(ediciones)), "Identidades repetidas en página")
    return {
        "ids": ids,
        "ediciones": ediciones,
        "errores_ediciones": errores,
        "total_actividades": meta["total_actividades"],
        "desde": meta["desde"],
        **{k: meta[k] for k in ("inicio_utc", "fin_utc", "http", "completo")},
    }


def _lectura_html(original: Path, captura: ObjetoJson, id: str | None = None, *, historica: bool = False) -> ObjetoJson:
    cuerpo, meta = pagina(original, captura)
    finales = {NORMAS} if id is None else lectura_censo.destinos_ficha(id, historica=historica)
    esperadas = {NORMAS, robot.ORIGEN + "/normes"} if id is None else {robot.url_ficha(id)}
    _exigir(meta["url"] in esperadas, "Apoyo Cibernàrium de otra URL")
    correcta = (
        cuerpo is not None
        and meta["http"] == HTTPStatus.OK
        and meta["completo"] is True
        and meta["url_final"] in finales
        and isinstance(meta.get("content_type"), str)
        and meta["content_type"].split(";", 1)[0].strip().lower() == "text/html"
    )
    return {"identificada": correcta, **{k: meta[k] for k in ("inicio_utc", "fin_utc", "http", "completo")}}


def calcular(  # noqa: PLR0915
    original: Path, documento: ObjetoJson, programas: list[ObjetoJson], *, historica: bool = False
) -> ObjetoJson:
    """Exige todos los intervalos consecutivos y mantiene cada fecha de recepción.

    Una página caída deja la consulta parcial: lo leído en las demás se conserva y
    las actividades conocidas que no aparecen quedan sin noticia, no ausentes.

    Returns:
        Conjunto común privado del canal; una ausencia no es baja ni oferta vacía.
    """
    _exigir(
        isinstance(documento, dict)
        and set(documento) - {contraste_ediciones.CAMPO}
        == {"schema_version", "fuente_id", "canal", "capturas", "auxiliares", "fichas", "historial"}
        and type(documento.get("schema_version")) is int
        and documento["schema_version"] == 1
        and documento.get("fuente_id") == FUENTE
        and documento.get("canal") == CANAL
        and isinstance(documento.get("capturas"), list)
        and documento["capturas"],
        "Índice Cibernàrium vacío o ajeno",
    )
    filas, fallidas = [], []
    for cap in documento["capturas"]:
        fallo = fallo_de_pagina(original, cap)
        if fallo is None:
            filas.append({**cap, "lectura": extraer(original, cap)})
        else:
            fallidas.append({**cap, "lectura": fallo})
    # El intervalo de la URL identifica cada página; el orden del índice no decide nada.
    filas.sort(key=lambda r: r["lectura"]["desde"])
    fallidas.sort(key=lambda r: r["lectura"]["desde"])
    _exigir(bool(filas) and filas[0]["lectura"]["desde"] == 0, "Primera página sin respuesta: no hay censo")
    total = filas[0]["lectura"]["total_actividades"]
    _exigir(
        sorted(r["lectura"]["desde"] for r in [*filas, *fallidas]) == list(range(0, total, robot.PAGINA))
        and all(r["lectura"]["total_actividades"] == total for r in filas),
        "Censo truncado o con totales distintos",
    )
    ids = [id for r in filas for id in r["lectura"]["ids"]]
    ediciones = [id for r in filas for id in r["lectura"]["ediciones"]]
    _exigir(
        (len(ids) <= total if fallidas else len(ids) == total)
        and len(ids) == len(set(ids))
        and len(ediciones) == len(set(ediciones)),
        "Relación actividad/edición ambigua o repetida",
    )
    auxiliares = documento.get("auxiliares", {})
    _exigir(isinstance(auxiliares, dict) and set(auxiliares) == {"normas"}, "Falta apoyo de normas declarado")
    normas = {**auxiliares["normas"], "lectura": _lectura_html(original, auxiliares["normas"])}
    normas["lectura"]["condiciones"] = None
    if normas["lectura"]["identificada"]:
        from plataforma_datos.cursos.fuentes.barcelonactiva import declaraciones_actuales

        cuerpo, meta = pagina(original, auxiliares["normas"])
        try:
            normas["lectura"]["condiciones"] = declaraciones_actuales.extraer(cuerpo, meta)
        except (FormatoInesperado, UnicodeDecodeError):
            # La respuesta identificada dejó de respaldar declaraciones. No es
            # un fallo de transporte que permita seguir eligiendo otra favorable.
            normas["lectura"]["diagnostico"] = "faq_identificada_no_interpretable"
    fichas = documento.get("fichas", {})
    _exigir(isinstance(fichas, dict) and len(fichas) <= total, "Inventario de fichas excesivo")
    leidas = {}
    conocidos = {p["id"].removeprefix("cibernarium:") for p in programas if p["id"].startswith("cibernarium:")}
    for id, cap in fichas.items():
        robot.identificador(id)
        # En una consulta parcial, la ficha de una actividad sin noticia se conserva.
        _exigir(
            ("cibernarium:" + id in ids or id in conocidos or bool(fallidas)) and cap.get("id") == "cibernarium:" + id,
            "Ficha ajena al censo",
        )
        leidas[id] = {**cap, "lectura": _lectura_html(original, cap, id, historica=historica)}
    sin_ver = sorted({p["id"] for p in programas} - set(ids))
    resultado = {
        "schema_version": 1,
        "fuente_id": FUENTE,
        "canal": CANAL,
        "procedencia_sha256": hashlib.sha256(recibos_compartidos.canonico(documento)).hexdigest(),
        lectura_censo.CAMPO: lectura_censo.VERSION,
        "recepciones": filas,
        "censo_completo": not fallidas,
        "censo": {"actividades": ids, "ediciones": ediciones},
        "auxiliares": {"normas": normas},
        "fichas": leidas,
        "publicacion_confirmada": None,
    }
    if fallidas:
        # Las conocidas sin ver pudieron estar en la página caída: no se leen como ausencias.
        resultado["paginas_fallidas"] = fallidas
        resultado["consulta_parcial"] = {
            "unidades_fallidas": sin_ver,
            "unidades_esperadas": len(programas),
            "paginas_fallidas": [r["lectura"]["desde"] for r in fallidas],
            "paginas_esperadas": len(filas) + len(fallidas),
        }
    else:
        resultado["censo"]["conocidos_ausentes"] = sin_ver
    return contraste_ediciones.incluir(original, documento, resultado)


def vincular_originales(original: Path, documento: ObjetoJson) -> None:
    """Incluye el canal en el manifiesto raíz conservando todos sus campos anteriores."""
    _exigir(original.name == CANAL and original.parent.name == FUENTE, "Canal fuera de la casa declarada")
    raiz = original.parent
    ruta = raiz / "procedencia.json"
    anterior = recibos_compartidos.leer_json(ruta.read_bytes())
    _exigir(
        anterior.get("fuente_id") == FUENTE and isinstance(anterior.get("archivos"), list),
        "Falta procedencia ocupacional anterior: no se crea otra fuente",
    )
    nuevo = deepcopy(anterior)
    canales = nuevo.setdefault("canales_operativos", {})
    _exigir(isinstance(canales, dict), "Canales operativos de procedencia no reconocidos")
    refs = documento["historial"]
    _exigir(isinstance(refs, list), "Historial de originales desconocido")
    for ref in refs:
        _exigir(isinstance(ref, dict) and set(ref) == {"archivo", "sha256"}, "Referencia de historial desconocida")
        comun.leer_conservado(original, ref)
    prefijo = original.relative_to(raiz).as_posix() + "/"
    canales[CANAL] = {
        "indice": {
            "archivo": prefijo + "procedencia.json",
            "sha256": entrada_salida.sha256(original / "procedencia.json"),
        },
        "archivos": [{"archivo": prefijo + r["archivo"], "sha256": r["sha256"]} for r in refs],
    }
    _exigir(
        {k: v for k, v in nuevo.items() if k != "canales_operativos"}
        == {k: v for k, v in anterior.items() if k != "canales_operativos"},
        "Se alteró procedencia anterior",
    )
    _guardar_distinto(ruta, nuevo)


def _guardar(  # noqa: PLR0913 - Recibos de las dos clases de ficha y del censo.
    original: Path,
    capturas: list[ObjetoJson],
    auxiliares: ObjetoJson,
    fichas: ObjetoJson,
    anterior: ObjetoJson,
    *,
    individuales: ObjetoJson | None = None,
) -> None:
    _exigir(
        not anterior or anterior.get("fuente_id") == FUENTE and anterior.get("canal") == CANAL,
        "El índice anterior pertenece a otro canal",
    )
    historial = {ref["archivo"]: ref for ref in anterior.get("historial", [])}
    for cap in [*capturas, *auxiliares.values(), *fichas.values(), *(individuales or {}).values()]:
        for ref in comun.referencias_de_captura(cap):
            _exigir(ref["archivo"] not in historial or historial[ref["archivo"]] == ref, "Colisión de original")
            historial[ref["archivo"]] = ref
    doc = {
        "schema_version": 1,
        "fuente_id": FUENTE,
        "canal": CANAL,
        "capturas": capturas,
        "auxiliares": auxiliares,
        "fichas": fichas,
        "historial": [historial[k] for k in sorted(historial)],
    }
    if individuales is not None:
        doc[contraste_ediciones.CAMPO] = individuales
    _guardar_distinto(original / "procedencia.json", doc)
    vincular_originales(original, doc)


def _programas_con_idioma_pendiente(actividades: list[dict], programas: dict, ediciones: dict) -> set[str]:
    """Selecciona padres acreditados por edición conocida; no une programas por título.

    Returns:
        Identificadores nativos canónicos con alguna edición pendiente o nueva.
    """
    from plataforma_datos.cursos.fuentes.barcelonactiva import matricula_actual

    pendientes = set()
    for actividad in actividades:
        lista = [e for e in actividad.get("listEditions", []) if matricula_actual.estado_inscripcion(e) != "cerrada"]
        conocidas = [
            ediciones["cibernarium-edicion:" + e["activityId"]]
            for e in lista
            if "cibernarium-edicion:" + e["activityId"] in ediciones
        ]
        padres = {e["programa_id"] for e in conocidas}
        directo = "cibernarium:" + actividad["activityId"]
        if len(padres) > 1:
            continue
        padre = next(iter(padres), directo)
        if padre not in programas or (padre != directo and directo in programas):
            continue
        falta = any(
            e["datos"].get("idioma_ficha_principal") is None and e["datos"].get("sincronia") != "asincrona"
            for e in conocidas
        )
        nueva = any(
            "cibernarium-edicion:" + e["activityId"] not in ediciones and bool(e.get("listSessions")) for e in lista
        )
        if falta or nueva:
            pendientes.add(padre.removeprefix("cibernarium:"))
    return pendientes


def _sin_fichas_ya_resueltas(  # noqa: PLR0913, PLR0917, C901
    pendientes: set[str], actividades: list[dict], programas: dict, ediciones: dict, fichas: dict, original: Path
) -> set[str]:
    """Evita repetir fichas que ya acreditan todos los idiomas pendientes.

    Returns:
        Padres con alguna edición todavía sin prueba propia.
    """
    from plataforma_datos.cursos.fuentes.barcelonactiva import idiomas_edicion, matricula_actual

    salida = set(pendientes)
    for id in pendientes & fichas.keys():
        cap = fichas[id]
        if not _lectura_html(original, cap, id)["identificada"]:
            continue
        cuerpo, _meta = pagina(original, cap)
        if cuerpo is None:
            continue
        padre = "cibernarium:" + id
        nativas = {k.removeprefix("cibernarium-edicion:"): v for k, v in ediciones.items() if v["programa_id"] == padre}
        horarios = {
            k: idiomas_edicion.horario_de_sesiones(v["datos"].get("sesiones") or []) for k, v in nativas.items()
        }
        try:
            leidos = idiomas_edicion.idiomas_por_edicion(
                cuerpo, actividad_id=id, titulo=programas[padre]["titulo"], calendarios=horarios
            )
        except (ValueError, UnicodeDecodeError, FormatoInesperado):
            continue
        faltan, nuevas = set(), False
        for actividad in actividades:
            lista = [e for e in actividad["listEditions"] if matricula_actual.estado_inscripcion(e) != "cerrada"]
            testigos = {
                ediciones["cibernarium-edicion:" + e["activityId"]]["programa_id"]
                for e in lista
                if "cibernarium-edicion:" + e["activityId"] in ediciones
            }
            if testigos != {padre} and not (not testigos and actividad["activityId"] == id):
                continue
            for edicion in lista:
                nativo = nativas.get(edicion["activityId"])
                if nativo is None:
                    nuevas = nuevas or bool(edicion.get("listSessions"))
                elif (
                    nativo["datos"].get("idioma_ficha_principal") is None
                    and nativo["datos"].get("sincronia") != "asincrona"
                ):
                    faltan.add(edicion["activityId"])
        soportados = {"català", "catalán", "castellà", "castellano", "español", "anglès", "inglés"}

        acreditados = set()
        for ident in faltan:
            literal = leidos.get(ident, ("", ""))[0]
            partes = [x.strip() for x in re.split(r"\s*(?:,|/|\bi\b|\by\b)\s*", literal) if x.strip()]
            if partes and all(x in soportados for x in partes):
                acreditados.add(ident)
        if faltan and not nuevas and acreditados == faltan:
            salida.remove(id)
    return salida


def descargar(  # noqa: C901, PLR0912, PLR0913, PLR0915 - Comparte presupuesto y selección del censo.
    programas: list[ObjetoJson],
    original: Path,
    anterior: ObjetoJson,
    portlet: str = robot.PORTLET,
    *,
    base: Path | None = None,
    inicio: float | None = None,
) -> lectura.Resultado:
    """Recibe API y normas, y rota fichas de altas y ediciones sin idioma acreditado.

    Una ficha fallida se conserva como intento individual. La admisión no la
    interpreta como cierre y conserva la selección anterior hasta una respuesta identificada posterior.
    Una página del censo caída queda como intento propio y las demás se siguen consultando.
    Al final emite la lectura del censo; si no se puede emitir, el resultado lo dice y nada más cambia.

    Returns:
        Las lecturas emitidas y los problemas que impidieron emitirlas, si los hubo.
    """
    inicio = time.monotonic() if inicio is None else inicio
    capturas, auxiliares, fichas = [], {}, deepcopy(anterior.get("fichas", {}))
    individuales = None
    try:
        capturas.append(comun.recibir_url(url_pagina(0, portlet), original, None, perfil="datos"))
        # Sin la primera página no se conoce el total: la consulta falla entera.
        _exigir(fallo_de_pagina(original, capturas[0]) is None, "Primera página Cibernàrium sin respuesta válida")
        primera = extraer(original, capturas[0])
        total = primera["total_actividades"]
        for desde in range(robot.PAGINA, total, robot.PAGINA):
            capturas.append(comun.recibir_url(url_pagina(desde, portlet), original, None, perfil="datos"))
        auxiliares["normas"] = comun.recibir_url(NORMAS, original, None, perfil="idioma-original")
        conocidos = {p["id"]: p for p in programas}
        nuevas, ids_actuales, ediciones_vistas, actividades_vistas = [], set(), set(), []
        leidas = [cap for cap in capturas if fallo_de_pagina(original, cap) is None]
        for cap in leidas:
            for a in actividades(original, cap)[0]:
                actividades_vistas.append(a)
                id = robot.identificador(a["activityId"])
                ids_actuales.add(id)
                ediciones_vistas.update(
                    "cibernarium-edicion:" + robot.identificador(e["activityId"]) for e in a["listEditions"]
                )
                actual = conocidos.get("cibernarium:" + id)
                if actual is None or actual["titulo"] != a.get("title"):
                    nuevas.append(id)

        def prioridad(id: str) -> tuple[bool, str, int]:
            previa = fichas.get(id)
            fecha = comun.leer_recibo(original, previa)["fin_utc"] if previa is not None else ""
            return previa is not None, fecha, int(id)

        # Los padres conocidos se prueban por sus ediciones, no por similitud de títulos.
        pendientes_idioma, padres_vistos, ediciones_nativas = set(), set(), {}
        if base is not None and base.is_file():
            from plataforma_datos.cursos.fuentes.barcelonactiva import negocio_actual

            programas_nativos, ediciones_nativas = negocio_actual.leer(base)
            pendientes_idioma = _programas_con_idioma_pendiente(
                actividades_vistas, programas_nativos, ediciones_nativas
            )
            padres_vistos = {
                e["programa_id"].removeprefix("cibernarium:")
                for k, e in ediciones_nativas.items()
                if k in ediciones_vistas
            }
            pendientes_idioma = _sin_fichas_ya_resueltas(
                pendientes_idioma, actividades_vistas, programas_nativos, ediciones_nativas, fichas, original
            )
            # Una cabecera con testigos del mismo padre no vuelve a ser alta.
            for actividad in actividades_vistas:
                cabecera = actividad["activityId"]
                testigos = [
                    ediciones_nativas.get("cibernarium-edicion:" + e["activityId"]) for e in actividad["listEditions"]
                ]
                padres = {e["programa_id"] for e in testigos if e is not None}
                if len(padres) != 1 or cabecera not in nuevas:
                    continue
                padre = next(iter(padres))
                if (
                    padre in programas_nativos
                    and padre != "cibernarium:" + cabecera
                    and "cibernarium:" + cabecera not in programas_nativos
                ):
                    nuevas.remove(cabecera)
                    # El inventario conserva una sola ficha por identidad canónica.
                    fichas.pop(cabecera, None)
                    if programas_nativos[padre]["titulo"] != actividad.get("title"):
                        nuevas.append(padre.removeprefix("cibernarium:"))
        # Con una página caída, la ausencia de una actividad no dice nada: su ficha se conserva.
        parcial = len(leidas) < len(capturas)
        fichas = {id: cap for id, cap in fichas.items() if id in ids_actuales or id in padres_vistos or parcial}
        ahora = time.monotonic()
        hasta = min(inicio + PLAZO_PARA_OPCIONALES_S, ahora + contraste_ediciones.PLAZO_FICHAS_S)
        # Reserva la mitad para las ausentes; los contrastes pueden usar lo que sobre de las cabeceras.
        limite_cabeceras = (ahora + hasta) / 2 if base is not None and not parcial else hasta
        altas = sorted(set(nuevas), key=prioridad)
        retrasadas = sorted(pendientes_idioma - set(altas), key=prioridad)
        # Una plaza para pendientes evita su hambre ante un flujo continuo de altas.
        cupo_altas = max(0, MAX_FICHAS_NUEVAS - 1) if retrasadas else MAX_FICHAS_NUEVAS
        colas = [altas[:cupo_altas], retrasadas[: MAX_FICHAS_NUEVAS - min(cupo_altas, len(altas))]]
        limite_altas = ahora + (limite_cabeceras - ahora) * 0.8 if retrasadas else limite_cabeceras
        for cola, limite in zip(colas, (limite_altas, limite_cabeceras), strict=True):
            for id in cola:
                cap = contraste_ediciones.recibir_ficha(
                    robot.url_ficha(id), original, "cibernarium:" + id, limite, perfil="idioma-original"
                )
                if cap is None:
                    break
                fichas[id] = cap
        if base is not None and not parcial:
            individuales = contraste_ediciones.recibir(
                original,
                base,
                ediciones_vistas,
                primera["fin_utc"],
                anterior.get(contraste_ediciones.CAMPO, {}),
                hasta=hasta,
            )
    finally:
        _guardar(original, capturas, auxiliares, fichas, anterior, individuales=individuales)
    return lectura.emitir(original, primera, actividades_vistas, ediciones_nativas, completa=not parcial)
