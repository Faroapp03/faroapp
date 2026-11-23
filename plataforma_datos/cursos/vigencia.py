"""Vigencia pública de una oferta a partir de comprobaciones recibidas, sin E/S.

El productor aporta identidad, fechas, interpretación y capturas; este módulo no
certifica su verdad semántica. Una comprobación positiva identifica la ficha,
no acredita plaza, elegibilidad personal, gratuidad ni aprendizaje. El contrato
JSON describe las entradas; la API ejecuta su validación estructural y semántica.
"""

import ipaddress
import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from http import HTTPStatus
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from plataforma_datos.cursos import oferta_continua, retirada_proveedor
from plataforma_datos.cursos.contrato_fichas import (
    ErrorFicha,
    calendarios_edicion,
    validar_datos_edicion,
    vinculo_matricula,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import cabeceras_actuales, matricula_actual
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

PRIMER_CARACTER_IMPRIMIBLE = 32
ULTIMO_CODIGO_HTTP = 599
# datetime exige offsets de magnitud <24h. Es un dominio conservador de cálculo,
# no una zona de la fuente. La resolución de estos instantes es de microsegundos.
DESFASE_UTC_MAXIMO = timedelta(days=1) - timedelta(microseconds=1)

ESTADOS = (
    "disponible-publicamente",
    "no-disponible-publicamente",
    "apertura-futura",
    "sin-confirmar",
)
ALCANCES_EVIDENCIA = (
    "identidad",
    "disponibilidad",
    "calendario",
    "catalogo",
    "politica",
    "diagnostico",
)
CAMPOS_OFERTA = ("id", "fuente_id", "url")
CAMPOS_POLITICA = (
    "fuente_id",
    "version",
    "ttl_ficha_segundos",
    "ttl_catalogo_segundos",
    "requiere_catalogo",
    "zona_fechas_dia",
    "inicio_dia_inclusivo",
    "fin_dia_inclusivo",
    "plazo_tecnico",
    "evidencias",
)
# Los TTL de la política fijan la próxima revisión interna de Faro: avisan en el
# panel y nunca retiran la oferta ni cambian lo que ve la persona.
PLAZO_TECNICO = "revision_interna"
CODIGOS_ENLACE_NO_ENCONTRADO = (HTTPStatus.NOT_FOUND, HTTPStatus.GONE)
CAMPOS_OBSERVACION = (
    "id",
    "tipo",
    "intentado_el",
    "terminado_el",
    "resultado",
    "url_consultada",
    "detalle",
    "evidencias",
)
CAMPOS_EVIDENCIA = ("alcance", "url", "capturado_utc", "sha256", "localizador")


class ErrorVigencia(ValueError):
    """Entrada inválida o incoherente; no se convierte en oferta disponible."""


def _exigir(condicion: bool, mensaje: str) -> None:
    if not condicion:
        raise ErrorVigencia(mensaje)


def _campos(objeto: ValorJson, campos: tuple[str, ...], lugar: str) -> None:
    _exigir(
        isinstance(objeto, dict) and set(objeto) == set(campos),
        f"{lugar}: campos inválidos",
    )


def _texto(valor: ValorJson, lugar: str) -> None:
    _exigir(
        isinstance(valor, str) and bool(valor.strip()) and not any(ord(c) < PRIMER_CARACTER_IMPRIMIBLE for c in valor),
        f"{lugar}: texto no vacío sin controles obligatorio",
    )


def _json_valido(valor: object) -> None:
    if valor is None or isinstance(valor, (str, bool, int)):
        return
    if isinstance(valor, float):
        _exigir(math.isfinite(valor), "Solo se admiten números JSON finitos")
        return
    if isinstance(valor, list):
        for elemento in valor:
            _json_valido(elemento)
        return
    _exigir(
        isinstance(valor, dict) and all(isinstance(k, str) for k in valor),
        "Solo se admiten valores JSON",
    )
    for elemento in valor.values():
        _json_valido(elemento)


def instante_utc(valor: str, lugar: str) -> datetime:
    """Lee un instante UTC explícito (`Z` o `+00:00`), con minutos y, si los hay, segundos y microsegundos.

    Returns:
        El instante con zona UTC.

    Raises:
        ErrorVigencia: Si no es texto, no lleva la zona UTC explícita o no es una fecha válida; `lugar` nombra el
            campo en el mensaje.
    """
    _texto(valor, lugar)
    _exigir(
        re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|\+00:00)",
            valor,
        )
        is not None,
        f"{lugar}: instante UTC explícito obligatorio",
    )
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError as error:
        raise ErrorVigencia(f"{lugar}: fecha UTC inválida") from error


def _utc(fecha: datetime) -> str:
    return fecha.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _url(valor: str, lugar: str) -> None:
    _texto(valor, lugar)
    try:
        url = urlsplit(valor)
        host = url.hostname
        _exigir(
            url.scheme in ("http", "https") and host and not url.username and not url.password,
            f"{lugar}: URL pública sin credenciales obligatoria",
        )
        _exigir(
            not any(c.isspace() for c in valor) and "\\" not in valor,
            f"{lugar}: URL inválida",
        )
        _ = url.port
        try:
            direccion = ipaddress.ip_address(host)
        except ValueError:
            _exigir(
                "." in host
                and not host.endswith(".")
                and not host.lower().endswith(
                    (
                        ".local",
                        ".internal",
                        ".localhost",
                        ".localdomain",
                        ".onion",
                        ".test",
                        ".invalid",
                    )
                )
                and re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", host.split(".")[-1]) is not None
                and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", p) for p in host.split(".")),
                f"{lugar}: host público inválido",
            )
        else:
            _exigir(direccion.is_global, f"{lugar}: dirección privada o reservada")
    except ValueError as error:
        raise ErrorVigencia(f"{lugar}: URL pública inválida") from error


def _evidencias(
    lista: list[ObjetoJson],
    ahora: datetime,
    *,
    inicio: datetime | None = None,
    fin: datetime | None = None,
    urls: set[str] | None = None,
) -> None:
    _exigir(isinstance(lista, list), "evidencias debe ser lista")
    for evidencia in lista:
        _campos(evidencia, CAMPOS_EVIDENCIA, "evidencia")
        _exigir(
            isinstance(evidencia["alcance"], str) and evidencia["alcance"] in ALCANCES_EVIDENCIA,
            "Alcance de evidencia inválido",
        )
        _url(evidencia["url"], "evidencia.url")
        fecha = instante_utc(evidencia["capturado_utc"], "evidencia.capturado_utc")
        _exigir(fecha <= ahora, "Evidencia posterior a ahora")
        if inicio is not None:
            _exigir(inicio <= fecha <= fin, "Captura fuera del intervalo de comprobación")
        if urls is not None:
            _exigir(
                evidencia["url"] in urls,
                "Evidencia no vinculada a la URL consultada o final",
            )
        _exigir(
            isinstance(evidencia["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", evidencia["sha256"]) is not None,
            "SHA-256 inválida",
        )
        localizador = evidencia["localizador"]
        if localizador is not None:
            _campos(localizador, ("tipo", "valor"), "localizador")
            _exigir(
                isinstance(localizador["tipo"], str)
                and localizador["tipo"] in ("selector", "pagina", "campo", "seccion"),
                "Tipo de localizador inválido",
            )
            _texto(localizador["valor"], "localizador.valor")


def _evidencia_de(observacion: ObjetoJson, alcance: str) -> bool:
    return any(e["alcance"] == alcance and e["localizador"] is not None for e in observacion["evidencias"])


def _transporte_correcto(observacion: ObjetoJson, tipo: str) -> bool:
    if observacion["resultado"] != "correcta":
        return False
    detalle = observacion["detalle"]
    return HTTPStatus.OK <= detalle["codigo_http"] < HTTPStatus.MULTIPLE_CHOICES and detalle["tipo_destino"] == tipo


def _redireccion_sin_identidad(observacion: ObjetoJson, oferta: ObjetoJson) -> bool:
    detalle = observacion["detalle"]
    if detalle["tipo_destino"] != observacion["tipo"]:
        return True
    if observacion["tipo"] == "ficha":
        return detalle["identidad_observada"] != oferta["id"] or detalle["datos_edicion"] is None
    return detalle["lectura_completa"] is not True


def _respuesta_para_estado(observacion: ObjetoJson, oferta: ObjetoJson) -> bool:
    """Separa fallos de consulta de respuestas que pueden limitar el hecho observado.

    «Correcta» describe una consulta terminada, no certifica los hechos del cuerpo.
    Un 5xx, bloqueo de autenticación, 429, 408 o redirección sin identidad no
    contradice por sí mismo una ficha/catálogo aún vigente. 404/410 describen la URL
    consultada, sin afirmar cierre del curso; en la ficha son incidencias del enlace.

    Returns:
        True si la respuesta participa en la selección factual; no acredita disponibilidad.
    """
    if observacion["resultado"] != "correcta":
        return False
    codigo = observacion["detalle"]["codigo_http"]
    if codigo >= HTTPStatus.INTERNAL_SERVER_ERROR or codigo in (
        HTTPStatus.UNAUTHORIZED,
        HTTPStatus.FORBIDDEN,
        HTTPStatus.PROXY_AUTHENTICATION_REQUIRED,
        HTTPStatus.TOO_MANY_REQUESTS,
        HTTPStatus.REQUEST_TIMEOUT,
    ):
        return False
    return not (
        HTTPStatus.MULTIPLE_CHOICES <= codigo < HTTPStatus.BAD_REQUEST
        and _redireccion_sin_identidad(observacion, oferta)
    )


def ficha_identificada_de_oferta(observacion: ObjetoJson, oferta: ObjetoJson) -> bool:
    """Indica si la observación trae la ficha de esta oferta, bien transportada y con datos de edición.

    Returns:
        Si la ficha identifica la oferta.
    """
    return (
        _transporte_correcto(observacion, "ficha")
        and observacion["detalle"]["identidad_observada"] == oferta["id"]
        and observacion["detalle"]["datos_edicion"] is not None
    )


def validar_entrada(oferta: ObjetoJson, observaciones: list[ObjetoJson], politica: ObjetoJson, *, ahora: str) -> None:
    """Valida las entradas usadas por evaluar_vigencia, incluidas las fichas reales.

    Raises:
        ErrorVigencia: Si las pruebas o su selección no cumplen el contrato de la fuente.
    """
    _json_valido(
        {
            "oferta": oferta,
            "observaciones": observaciones,
            "politica": politica,
            "ahora": ahora,
        }
    )
    instante = instante_utc(ahora, "ahora")
    _campos(oferta, CAMPOS_OFERTA, "oferta")
    for campo in ("id", "fuente_id"):
        _texto(oferta[campo], "oferta." + campo)
    _url(oferta["url"], "oferta.url")
    _validar_politica(politica, oferta, instante)
    _exigir(isinstance(observaciones, list), "observaciones debe ser lista")
    cabeceras = _politica_cabeceras(oferta, observaciones, politica)
    ids = set()
    for observacion in observaciones:
        _campos(observacion, CAMPOS_OBSERVACION, "observacion")
        _texto(observacion["id"], "observacion.id")
        _exigir(observacion["id"] not in ids, "ID de observación duplicado")
        ids.add(observacion["id"])
        if isinstance(observacion["detalle"], dict) and matricula_actual.CAMPO in observacion["detalle"]:
            _exigir(
                politica.get("regla_disponibilidad") == matricula_actual.METODO,
                "El método de matrícula exige su política explícita",
            )
        _validar_observacion(observacion, oferta, instante)
    if cabeceras:
        try:
            cabeceras_actuales.validar_actual(
                oferta, _ultimo(cabeceras_actuales.identificadas(observaciones, oferta))[0]
            )
        except matricula_actual.ErrorMatriculaActual as error:
            raise ErrorVigencia(str(error)) from error


def _politica_cabeceras(oferta: ObjetoJson, observaciones: list[ObjetoJson], politica: ObjetoJson) -> bool:
    presente = any(
        isinstance(o.get("detalle"), dict)
        and (cabeceras_actuales.CAMPO in o["detalle"] or matricula_actual.CAMPO in o["detalle"])
        for o in observaciones
        if isinstance(o, dict)
    )
    if presente:
        from plataforma_datos.cursos import politicas_vigencia

        _exigir(
            oferta["fuente_id"] == matricula_actual.FUENTE
            and politica
            == politicas_vigencia.leer_politica(matricula_actual.FUENTE, matricula_actual.VERSION_POLITICA),
            "Cabeceras nativas exigen la política registrada exacta de Barcelona Activa",
        )
    return presente


def _limite_dia(valor: str, politica: ObjetoJson, *, fin: bool) -> datetime | None:
    zona = politica["zona_fechas_dia"]
    if zona is None:
        try:
            # Primera hora en que algún offset admisible podría alcanzar el día publicado.
            # El límite publicado se aplica aquí aunque no se conozca la hora real de cierre.
            return datetime.combine(date.fromisoformat(valor), time(), UTC) - DESFASE_UTC_MAXIMO
        except OverflowError:
            return None
    dia = date.fromisoformat(valor)
    inclusivo = politica["fin_dia_inclusivo" if fin else "inicio_dia_inclusivo"]
    if (fin and inclusivo is True) or (not fin and inclusivo is False):
        try:
            dia += timedelta(days=1)
        except OverflowError as error:
            raise ErrorVigencia("Límite de día fuera del intervalo representable") from error
    return datetime.combine(dia, time(), ZoneInfo(zona)).astimezone(UTC)


def _relacion(valor: str, instante: datetime, politica: ObjetoJson) -> int | None:
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        limite = date.fromisoformat(valor)
        if politica["zona_fechas_dia"] is None:
            try:
                primero = (instante - DESFASE_UTC_MAXIMO).date()
                ultimo = (instante + DESFASE_UTC_MAXIMO).date()
            except OverflowError:
                return None
            # Solo se decide cuando TODAS las fechas civiles compatibles dan la misma relación.
            return -1 if ultimo < limite else 1 if primero > limite else None
        actual = instante.astimezone(ZoneInfo(politica["zona_fechas_dia"])).date()
    else:
        if re.search(r"\.\d{7,}", valor):
            return None
        limite = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        if limite.utcoffset() is None:
            return None
        actual = instante
    return -1 if actual < limite else 1 if actual > limite else 0


def _cota_fin(valor: str | None, politica: ObjetoJson) -> datetime | None:
    if valor is None:
        return None
    if "T" not in valor:
        return _limite_dia(valor, politica, fin=True)
    if re.search(r"\.\d{7,}", valor):
        return None
    instante = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    return instante if instante.utcoffset() is not None else None


def _periodo(
    periodo: ObjetoJson, ahora: datetime, comprobado: datetime, politica: ObjetoJson
) -> tuple[str, datetime | None]:
    inicio, fin = periodo["inicio"], periodo["fin"]
    vence = None
    if fin is not None:
        relacion = _relacion(fin, ahora, politica)
        dia = "T" not in fin
        vence = _cota_fin(fin, politica)
        if relacion == 1 or relacion == 0 and (not dia or politica["fin_dia_inclusivo"] is False):
            return "vencido", vence
        if relacion is None or relacion == 0 and politica["fin_dia_inclusivo"] is None:
            return "pendiente", vence
    if inicio is not None:
        relacion = _relacion(inicio, ahora, politica)
        dia = "T" not in inicio
        if relacion == -1 or relacion == 0 and dia and politica["inicio_dia_inclusivo"] is False:
            return "futuro", vence
        if relacion is None or relacion == 0 and dia and politica["inicio_dia_inclusivo"] is None:
            return "pendiente", vence
        previo = _relacion(inicio, comprobado, politica)
        if previo is None or previo == -1 or previo == 0 and dia and politica["inicio_dia_inclusivo"] is False:
            return "sin_recomprobar", vence
    return ("activo" if inicio is not None or fin is not None else "sin_periodo"), vence


def _capturas_localizadas(
    observacion: ObjetoJson, alcances: tuple[str, ...] | list[str], *, orden_causal: bool = False
) -> list[datetime]:
    calendario = _apoyos_calendarios(observacion, incluir_pendientes=orden_causal) if "calendario" in alcances else []
    return [
        instante_utc(e["capturado_utc"], "capturado_utc")
        for e in observacion["evidencias"]
        if e["alcance"] in alcances
        and e["localizador"] is not None
        and (e["alcance"] != "calendario" or e in calendario)
    ]


@dataclass(frozen=True, kw_only=True)
class _CalendarioOferta:
    """Calendario interpretado y su soporte comprobado para esta edición."""

    campo: str
    clase: str
    periodo: ObjetoJson
    apoyos: tuple[ObjetoJson, ...]


def _misma_captura(primera: ObjetoJson, segunda: ObjetoJson) -> bool:
    return all(primera[c] == segunda[c] for c in ("url", "sha256", "capturado_utc"))


def _localizador_del_campo(identidad: ObjetoJson, campo: str) -> ObjetoJson | None:
    localizador = identidad["localizador"]
    if not localizador or localizador["tipo"] != "campo":
        return None
    ruta = localizador["valor"]
    if not ruta.startswith("/") or ruta.rsplit("/", 1)[-1] not in ("id", "key"):
        return None
    registro = ruta.rsplit("/", 1)[0]
    relativo = campo.removeprefix("run.")
    valor = registro if campo == "run" else registro + "/" + relativo
    return {"tipo": "campo", "valor": valor}


def _soporte_estructurado(observacion: ObjetoJson, campo: str) -> tuple[ObjetoJson, ...]:
    """Exige un mismo objeto identificado, no solo un mismo documento multiedición.

    Returns:
        Soportes con identidad y campo exacto bajo el mismo localizador estructurado.
    """
    identidades = [e for e in observacion["evidencias"] if e["alcance"] == "identidad" and e["localizador"]]
    return tuple(
        e
        for e in observacion["evidencias"]
        if e["alcance"] == "calendario"
        and any(
            _misma_captura(e, identidad) and e["localizador"] == _localizador_del_campo(identidad, campo)
            for identidad in identidades
        )
    )


def _apoyos_vinculo(observacion: ObjetoJson, oferta: ObjetoJson, vinculo: ObjetoJson) -> tuple[ObjetoJson, ...] | None:
    """Coteja el destino declarado y la evidencia exacta del vínculo.

    Returns:
        None para otra edición; tupla vacía si falta soporte de la edición destino.
    """
    destino = vinculo["edicion"]
    urls = {oferta["url"], observacion["url_consultada"], observacion["detalle"]["url_final"]}
    coincidencias = []
    if destino["id"] is not None:
        coincidencias.append(destino["id"] == oferta["id"])
    if destino["url"] is not None:
        coincidencias.append(destino["url"] in urls)
    if not any(coincidencias):
        return None
    if not all(coincidencias):
        return ()
    soporte = vinculo["evidencia"]
    return tuple(
        e
        for e in observacion["evidencias"]
        if e["alcance"] == "calendario" and {k: v for k, v in e.items() if k != "alcance"} == soporte
    )


def _campo_matricula(datos: ObjetoJson) -> str:
    original = datos["publicacion_original"]
    if original.get("run"):
        return "run.enrollmentStart/enrollmentEnd"
    return next(
        (c for c in ("fechas_matricula", "plazo_matricula") if original.get(c) is not None),
        "inicio_matricula/fin_matricula",
    )


def _calendario_diagnosticado(datos: ObjetoJson, campo: str) -> bool:
    base = "calendarios_publicados." + campo
    prefijos = [base + ".inicio", base + ".fin"]
    principal = calendarios_edicion(datos)[0]["campo"]
    if campo == principal:
        prefijos.append("fechas_publicadas.")
    if campo == _campo_matricula(datos):
        prefijos.append("fechas_matricula.")
    return any(
        isinstance(d, dict)
        and isinstance(d.get("campo"), str)
        and (d["campo"] == base or d["campo"].startswith(tuple(prefijos)))
        for d in datos["diagnosticos_normalizacion"]
    )


def _calendarios_oferta(observacion: ObjetoJson, oferta: ObjetoJson) -> list[_CalendarioOferta]:
    """Conserva solo dimensiones pertinentes; una declaración de alcance no prueba identidad.

    Returns:
        Matrícula, formación y acceso con su soporte; las sesiones no son vencimiento global.
    """
    datos = observacion["detalle"]["datos_edicion"]
    if datos is None:
        return []
    entradas = [
        {
            "campo": _campo_matricula(datos),
            "alcance": "edicion",
            "periodo": {"tipo": "matricula", **datos["fechas_matricula"]},
            "vinculo_edicion": vinculo_matricula(datos),
        },
        *calendarios_edicion(datos),
    ]
    clases = {"matricula": "matricula", "periodo-formativo": "formativo", "ventana-acceso": "acceso"}
    resultado = []
    for entrada in entradas:
        periodo = entrada["periodo"]
        if entrada["alcance"] == "material-auxiliar" or periodo["tipo"] not in clases:
            continue
        if not any(periodo[c] is not None for c in ("inicio", "fin")) and not _calendario_diagnosticado(
            datos, entrada["campo"]
        ):
            continue
        vinculo = entrada["vinculo_edicion"]
        apoyos = (
            _soporte_estructurado(observacion, entrada["campo"])
            if vinculo is None
            else _apoyos_vinculo(observacion, oferta, vinculo)
        )
        if apoyos is None:
            continue
        resultado.append(
            _CalendarioOferta(
                campo=entrada["campo"],
                clase=clases[periodo["tipo"]],
                periodo=periodo,
                apoyos=apoyos if entrada["alcance"] == "edicion" else (),
            )
        )
    return resultado


def tiene_calendario_acreditado_de_oferta(observacion: ObjetoJson, oferta: ObjetoJson) -> bool:
    """Indica si hay calendario de acceso o matrícula con fechas y apoyo propio.

    Returns:
        Si existe una restricción no formativa con fechas y apoyos.
    """
    calendarios = _calendarios_exigibles(_calendarios_oferta(observacion, oferta))
    return any(
        c.clase != "formativo" and c.apoyos and any(c.periodo[e] is not None for e in ("inicio", "fin"))
        for c in calendarios
    )


def _calendarios_exigibles(calendarios: list[_CalendarioOferta]) -> list[_CalendarioOferta]:
    """El acceso explícito permite continuidad después del periodo formativo.

    Returns:
        Restricciones independientes, sin convertir el fin formativo en cierre del acceso.
    """
    acceso_publicado = any(c.clase == "acceso" and c.apoyos for c in calendarios)
    return [c for c in calendarios if not (c.clase == "formativo" and acceso_publicado)]


def _apoyos_calendarios(observacion: ObjetoJson, *, incluir_pendientes: bool = False) -> list[ObjetoJson]:
    if observacion["tipo"] != "ficha" or observacion["resultado"] != "correcta":
        return []
    detalle = observacion["detalle"]
    oferta = {"id": detalle["identidad_observada"], "url": observacion["url_consultada"]}
    apoyos = []
    for calendario in _calendarios_exigibles(_calendarios_oferta(observacion, oferta)):
        apoyos.extend(calendario.apoyos)
        if incluir_pendientes and not calendario.apoyos:
            # Una afirmación pendiente conserva su intervalo causal sin acreditar
            # apertura, cierre ni renovar la fecha de una confirmación independiente.
            apoyos.extend(
                e
                for e in observacion["evidencias"]
                if e["alcance"] == "calendario"
                and any(
                    e["localizador"] == _localizador_del_campo(identidad, calendario.campo)
                    for identidad in observacion["evidencias"]
                    if identidad["alcance"] == "identidad"
                )
            )
    return apoyos


def _alcances_apoyo(observacion: ObjetoJson) -> list[str] | tuple[str, ...]:
    if observacion["tipo"] == "catalogo":
        return ("catalogo",)
    alcances = ["identidad"]
    detalle = observacion["detalle"]
    datos = detalle["datos_edicion"]
    if datos is not None:
        if (
            any(datos[c] is not None for c in ("estado_inscripcion", "estado_edicion"))
            or detalle["acceso_abierto"] is not None
            or oferta_continua.CAMPO in detalle
        ):
            alcances.append("disponibilidad")
        if any(datos["fechas_matricula"][e] is not None for e in ("inicio", "fin")) or any(
            c["periodo"][e] is not None for c in calendarios_edicion(datos) for e in ("inicio", "fin")
        ):
            alcances.append("calendario")
    return alcances


def fecha_de_comprobacion(observacion: ObjetoJson) -> datetime:
    """Devuelve cuándo se comprobó la observación: la captura de apoyo más antigua o, si falló, su final.

    Returns:
        El instante de comprobación, en UTC.
    """
    if observacion["resultado"] == "fallo":
        return instante_utc(observacion["terminado_el"], "terminado_el")
    capturas = _capturas_localizadas(observacion, _alcances_apoyo(observacion))
    if not capturas:
        capturas = [instante_utc(e["capturado_utc"], "capturado_utc") for e in observacion["evidencias"]]
    # Cada apoyo conserva su edad; la comprobación data del apoyo más antiguo.
    return min(capturas)


def _intervalo_estado(observacion: ObjetoJson) -> tuple[datetime, datetime]:
    if observacion["resultado"] == "fallo":
        fecha = instante_utc(observacion["terminado_el"], "terminado_el")
        return fecha, fecha
    # Todas las afirmaciones necesarias participan en el orden causal. Ordenar
    # solo disponibilidad podría descartar un calendario capturado después.
    capturas = _capturas_localizadas(observacion, _alcances_apoyo(observacion), orden_causal=True)
    if not capturas:
        capturas = [instante_utc(e["capturado_utc"], "capturado_utc") for e in observacion["evidencias"]]
    return min(capturas), max(capturas)


def _ultimo(grupo: list[ObjetoJson]) -> tuple[list[ObjetoJson], bool]:
    if not grupo:
        return [], False
    intervalos = {o["id"]: _intervalo_estado(o) for o in grupo}
    inicio_mas_reciente = max(inicio for inicio, _ in intervalos.values())
    # Solo una captura enteramente posterior demuestra sucesión. Si se solapan,
    # las conclusiones incompatibles quedan pendientes; el fin no las ordena.
    ultimos = [o for o in grupo if intervalos[o["id"]][1] >= inicio_mas_reciente]
    ultimos.sort(
        key=lambda o: (fecha_de_comprobacion(o), intervalos[o["id"]][1], o["id"]),
        reverse=True,
    )
    firmas = {
        json.dumps(
            {k: o[k] for k in ("resultado", "detalle")},
            sort_keys=True,
            ensure_ascii=False,
        )
        for o in ultimos
    }
    return ultimos, len(firmas) > 1


def _ultima_comprobacion(grupo: list[ObjetoJson]) -> str | None:
    ultimos, conflicto = _ultimo(grupo)
    if not ultimos:
        return None
    fecha = min(fecha_de_comprobacion(o) for o in ultimos) if conflicto else fecha_de_comprobacion(ultimos[0])
    return _utc(fecha)


def _diagnostico_consulta(observacion: ObjetoJson, oferta: ObjetoJson) -> ObjetoJson:
    detalle = observacion["detalle"]
    if (
        observacion["resultado"] == "correcta"
        and observacion["tipo"] == "ficha"
        and HTTPStatus.MULTIPLE_CHOICES <= detalle["codigo_http"] < HTTPStatus.BAD_REQUEST
        and detalle["identidad_observada"] is not None
        and detalle["identidad_observada"] != oferta["id"]
    ):
        return {"resultado_consulta": "fallo", "motivo_consulta": "la_ficha_ya_no_lleva_a_este_curso"}
    return {}


def _traza_capturas(observacion: ObjetoJson, oferta: ObjetoJson) -> ObjetoJson:
    alcances = sorted({e["alcance"] for e in observacion["evidencias"]})
    desde, hasta = _intervalo_estado(observacion)
    return {
        **_diagnostico_consulta(observacion, oferta),
        "intentado_el": observacion["intentado_el"],
        "terminado_el": observacion["terminado_el"],
        "comprobado_el": _utc(fecha_de_comprobacion(observacion))
        if _respuesta_para_estado(observacion, oferta)
        else None,
        "conocimiento_desde": _utc(desde),
        "conocimiento_hasta": _utc(hasta),
        "por_alcance": {
            alcance: {
                "primera_captura_el": _utc(
                    min(
                        instante_utc(e["capturado_utc"], "capturado_utc")
                        for e in observacion["evidencias"]
                        if e["alcance"] == alcance
                    )
                ),
                "ultima_captura_el": _utc(
                    max(
                        instante_utc(e["capturado_utc"], "capturado_utc")
                        for e in observacion["evidencias"]
                        if e["alcance"] == alcance
                    )
                ),
            }
            for alcance in alcances
        },
    }


def _fecha_maxima(grupo: list[ObjetoJson], campo: str) -> str | None:
    return _utc(max(instante_utc(o[campo], campo) for o in grupo)) if grupo else None


@dataclass(frozen=True, kw_only=True)
class _Evaluacion:
    """Contexto de una decisión: entradas admitidas, evidencia y límites temporales."""

    oferta: ObjetoJson
    politica: ObjetoJson
    instante: datetime
    fichas: list[ObjetoJson]
    conflicto_ficha: bool
    catalogos: list[ObjetoJson]
    conflicto_catalogo: bool
    resultado: ObjetoJson
    limites: list[datetime]


def evaluar_vigencia(
    oferta: ObjetoJson, observaciones: list[ObjetoJson], politica: ObjetoJson, *, ahora: str
) -> ObjetoJson:
    """Calcula disponibilidad pública sin modificar las observaciones recibidas.

    Los instantes de fin son exclusivos. Las fechas de día usan convenciones
    acreditadas de la fuente; una cota calculada no se presenta como hora publicada.
    No consulta reloj, red, modelos ni SQLite.

    El plazo técnico de la política solo fija ``revisar_el`` para el panel; el
    tiempo cambia la oferta únicamente al alcanzar un límite publicado
    (``cierra_el``).

    Returns:
        Decisión, motivos, límite publicado, próxima revisión y trazabilidad.
    """
    validar_entrada(oferta, observaciones, politica, ahora=ahora)
    evaluacion = _preparar_evaluacion(oferta, observaciones, politica, instante_utc(ahora, "ahora"))
    decision = retirada_proveedor.decidir(evaluacion, ficha_identificada_de_oferta) or _estado_ficha(evaluacion)
    if decision is None and politica["requiere_catalogo"]:
        decision = _estado_catalogo(evaluacion)
    if decision is None:
        decision = _estado_oferta(evaluacion)
    return _terminar(evaluacion, *decision)


def _preparar_evaluacion(
    oferta: ObjetoJson, observaciones: list[ObjetoJson], politica: ObjetoJson, instante: datetime
) -> _Evaluacion:
    """Reúne las capturas y cotas sin resolver todavía si la oferta está disponible.

    Returns:
        Contexto con la trazabilidad reunida y los límites de las capturas.
    """
    fichas = [o for o in observaciones if o["tipo"] == "ficha"]
    catalogos = [o for o in observaciones if o["tipo"] == "catalogo"]
    positivas = [o for o in fichas if ficha_identificada_de_oferta(o, oferta)]
    completos = [o for o in catalogos if _transporte_correcto(o, "catalogo") and o["detalle"]["lectura_completa"]]
    presentes = [o for o in catalogos if _transporte_correcto(o, "catalogo") and o["detalle"]["presente"] is True]
    catalogos_positivos = [o for o in completos if o["detalle"]["presente"] is True]
    # Un intento sin respuesta no sustituye el último contenido observado.
    # Se consideran todas las respuestas, incluso cierres e identidades distintas;
    # elegir solo las positivas podría resucitar una oferta ya contradicha.
    # Una incidencia del enlace (404/410, redirección sin identidad, otra identidad o página que no
    # es el catálogo) dice que la URL falla, no que la oferta haya cambiado: no participa ni se
    # confirma por repetición. Solo describe el desconocimiento si nunca hubo respuesta válida.
    incidencias = {o["id"] for o in fichas + catalogos if _tipo_incidencia(o, oferta) is not None}
    respuestas = [o for o in fichas if _respuesta_para_estado(o, oferta) and o["id"] not in incidencias]
    respuestas_catalogo = [o for o in catalogos if _respuesta_para_estado(o, oferta) and o["id"] not in incidencias]
    ultimas_fichas, conflicto_ficha = _ultimo(respuestas or fichas)
    ultimos_catalogos, conflicto_catalogo = _ultimo(respuestas_catalogo or catalogos)
    ultima_positiva, _ = _ultimo(positivas)
    usado = {o["id"]: o for o in ultimas_fichas + ultima_positiva + ultimos_catalogos}
    # Los intentos fallidos mantienen su referencia aunque no anulen la evidencia.
    for grupo in (fichas, catalogos, completos, presentes, catalogos_positivos):
        ultimos, _ = _ultimo(grupo)
        usado.update((o["id"], o) for o in ultimos)
    evidencia = deepcopy(politica["evidencias"])
    for identificador in sorted(usado):
        evidencia.extend(deepcopy(usado[identificador]["evidencias"]))
    resultado = {
        "schema_version": 2,
        "oferta_id": oferta["id"],
        "estado": "sin-confirmar",
        "motivos": [],
        "evaluado_el": _utc(instante),
        "ultimo_intento_el": _fecha_maxima(observaciones, "intentado_el"),
        "ultimo_fin_el": _fecha_maxima(observaciones, "terminado_el"),
        "comprobado_el": _ultima_comprobacion(positivas),
        "cierra_el": None,
        "revisar_el": _revisar_el(positivas, catalogos_positivos, politica),
        "ultimo_intento_fallido_el": _ultimo_intento_fallido(
            [fichas, catalogos] if politica["requiere_catalogo"] else [fichas], oferta, incidencias
        ),
        "incidencia_enlace": _incidencia_enlace(
            [(fichas, respuestas), *([(catalogos, respuestas_catalogo)] if politica["requiere_catalogo"] else [])],
            oferta,
        ),
        "alcance": "disponibilidad-publica",
        "trazabilidad": {
            "politica": deepcopy({k: v for k, v in politica.items() if k != "evidencias"}),
            "ficha": {
                "ultimo_intento_el": _fecha_maxima(fichas, "intentado_el"),
                "ultimo_fin_el": _fecha_maxima(fichas, "terminado_el"),
                "ultima_positiva_el": _ultima_comprobacion(positivas),
            },
            "catalogo": {
                "ultimo_intento_el": _fecha_maxima(catalogos, "intentado_el"),
                "ultimo_fin_el": _fecha_maxima(catalogos, "terminado_el"),
                "ultima_positiva_el": _ultima_comprobacion(catalogos_positivos),
                "ultima_lectura_completa_el": _ultima_comprobacion(completos),
                "ultima_presencia_el": _ultima_comprobacion(presentes),
            },
            "observaciones": sorted(usado),
            "capturas": {
                identificador: _traza_capturas(usado[identificador], oferta) for identificador in sorted(usado)
            },
            "evidencias": evidencia,
            "limites_calculados": [],
        },
    }
    # Solo los límites publicados con evidencia cambian la oferta con el tiempo.
    limites = []
    # Un fallo no extiende las cotas acreditadas de la última ficha identificada.
    for positiva in ultima_positiva:
        _agregar_cotas_calendarios(positiva, oferta, politica, resultado, limites)

    return _Evaluacion(
        oferta=oferta,
        politica=politica,
        instante=instante,
        fichas=ultimas_fichas,
        conflicto_ficha=conflicto_ficha,
        catalogos=ultimos_catalogos,
        conflicto_catalogo=conflicto_catalogo,
        resultado=resultado,
        limites=limites,
    )


def _revisar_el(positivas: list[ObjetoJson], catalogos_positivos: list[ObjetoJson], politica: ObjetoJson) -> str | None:
    """Próxima revisión interna: aviso de panel, nunca límite de la oferta.

    Returns:
        Instante UTC de la revisión pendiente, o None si nunca se comprobó.
    """
    candidatos = []
    comprobado = _ultima_comprobacion(positivas)
    if comprobado is not None:
        candidatos.append(instante_utc(comprobado, "comprobado_el") + timedelta(seconds=politica["ttl_ficha_segundos"]))
    presencia = _ultima_comprobacion(catalogos_positivos) if politica["requiere_catalogo"] else None
    if presencia is not None:
        candidatos.append(
            instante_utc(presencia, "catalogo positivo") + timedelta(seconds=politica["ttl_catalogo_segundos"])
        )
    return _utc(min(candidatos)) if candidatos else None


def _ultimo_intento_fallido(grupos: list[list[ObjetoJson]], oferta: ObjetoJson, excluidas: set[str]) -> str | None:
    """Informa del último intento sin respuesta válida posterior a la última válida.

    No interviene en la decisión: un fallo no retira, no renueva ni rejuvenece. Las
    incidencias del enlace tienen su propio aviso (``incidencia_enlace``).

    Returns:
        Fin UTC del intento fallido más reciente, o None si la última respuesta fue válida.
    """
    fallidos = []
    for grupo in grupos:
        validas = [o for o in grupo if _respuesta_para_estado(o, oferta) and o["id"] not in excluidas]
        referencia = max((_intervalo_estado(o)[1] for o in validas), default=None)
        for observacion in grupo:
            fin = instante_utc(observacion["terminado_el"], "terminado_el")
            fallido = not _respuesta_para_estado(observacion, oferta) and observacion["id"] not in excluidas
            if fallido and (referencia is None or fin > referencia):
                fallidos.append(fin)
    return _utc(max(fallidos)) if fallidos else None


def _tipo_incidencia(observacion: ObjetoJson, oferta: ObjetoJson) -> str | None:
    """Clasifica las respuestas de ficha o catálogo que muestran un fallo del enlace, no de la oferta.

    Una lectura completa del catálogo sin la oferta no es incidencia: es un hecho observado.

    Returns:
        «no_encontrado», «redireccion_sin_identidad», «otra_identidad» o None.
    """
    if observacion["resultado"] != "correcta":
        return None
    detalle = observacion["detalle"]
    codigo = detalle["codigo_http"]
    if codigo in CODIGOS_ENLACE_NO_ENCONTRADO:
        return "no_encontrado"
    if HTTPStatus.MULTIPLE_CHOICES <= codigo < HTTPStatus.BAD_REQUEST and _redireccion_sin_identidad(
        observacion, oferta
    ):
        return "redireccion_sin_identidad"
    if HTTPStatus.OK <= codigo < HTTPStatus.MULTIPLE_CHOICES and (
        detalle["tipo_destino"] != observacion["tipo"]
        or observacion["tipo"] == "ficha"
        and detalle["identidad_observada"] != oferta["id"]
    ):
        return "otra_identidad"
    return None


def _incidencia_enlace(
    grupos: list[tuple[list[ObjetoJson], list[ObjetoJson]]], oferta: ObjetoJson
) -> ObjetoJson | None:
    """Describe la incidencia de enlace más reciente posterior a la última respuesta válida de su canal.

    Solo avisa: la información acreditada conserva su valor y su fecha.

    Returns:
        Fin, origen (ficha o catálogo), tipo y código HTTP de la incidencia, o None si no hay ninguna.
    """
    candidatas = []
    for observaciones, respuestas in grupos:
        referencia = max((_intervalo_estado(o)[1] for o in respuestas), default=None)
        candidatas.extend(
            o
            for o in observaciones
            if _tipo_incidencia(o, oferta) is not None and (referencia is None or _intervalo_estado(o)[0] > referencia)
        )
    if not candidatas:
        return None
    ultima = max(candidatas, key=lambda o: (instante_utc(o["terminado_el"], "terminado_el"), o["tipo"], o["id"]))
    return {
        "el": _utc(instante_utc(ultima["terminado_el"], "terminado_el")),
        "origen": ultima["tipo"],
        "tipo": _tipo_incidencia(ultima, oferta),
        "codigo_http": ultima["detalle"]["codigo_http"],
    }


def _agregar_cotas_calendarios(
    observacion: ObjetoJson,
    oferta: ObjetoJson,
    politica: ObjetoJson,
    resultado: ObjetoJson,
    limites: list[datetime],
) -> None:
    for calendario in _calendarios_exigibles(_calendarios_oferta(observacion, oferta)):
        valor = calendario.periodo["fin"]
        cota = _cota_fin(valor, politica) if calendario.apoyos else None
        if cota is not None:
            limites.append(cota)
            resultado["trazabilidad"]["limites_calculados"].append(
                {
                    "observacion_id": observacion["id"],
                    "campo": calendario.campo + ".fin",
                    "valor_publicado": valor,
                    "cota_operativa_utc": _utc(cota),
                    **(
                        {"criterio": "inicio_de_ambiguedad_sin_zona_desfase_menor_24h"}
                        if "T" not in valor and politica["zona_fechas_dia"] is None
                        else {}
                    ),
                }
            )


def _terminar(evaluacion: _Evaluacion, estado: str, motivo: str) -> ObjetoJson:
    resultado, limites, instante = evaluacion.resultado, evaluacion.limites, evaluacion.instante
    resultado["cierra_el"] = _utc(min(limites)) if limites else None
    if estado == "disponible-publicamente" and limites and instante >= min(limites):
        estado, motivo = "sin-confirmar", "limite_publicado_alcanzado"
    resultado["estado"] = estado
    resultado["motivos"].append(motivo)
    return resultado


def _estado_ficha(evaluacion: _Evaluacion) -> tuple[str, str] | None:
    """Comprueba identidad y respuesta de la última ficha; su edad no la retira.

    Returns:
        Estado y motivo impeditivos, o None si la ficha permite continuar.
    """
    if evaluacion.conflicto_ficha or not evaluacion.fichas:
        motivo = "fichas_simultaneas_discrepantes" if evaluacion.conflicto_ficha else "sin_comprobacion_de_ficha"
        return "sin-confirmar", motivo
    ficha = evaluacion.fichas[0]
    motivo = _motivo_respuesta_ficha(ficha)
    if motivo is not None:
        return "sin-confirmar", motivo
    detalle = ficha["detalle"]
    if detalle["identidad_observada"] != evaluacion.oferta["id"]:
        return "sin-confirmar", "identidad_de_ficha_no_coincidente"
    if detalle["datos_edicion"] is None:
        return "sin-confirmar", "ficha_sin_contenido_contrastable"
    return None


def _motivo_respuesta_ficha(ficha: ObjetoJson) -> str | None:
    """Distingue el estado de la consulta y del enlace del estado de la oferta.

    Returns:
        Motivo si la última respuesta no es una ficha legible, o None.
    """
    if ficha["resultado"] == "fallo":
        return "ultimo_intento_de_ficha_fallido"
    if ficha["detalle"]["codigo_http"] in CODIGOS_ENLACE_NO_ENCONTRADO:
        # Solo llega aquí si nunca hubo respuesta de este curso: describe el desconocimiento.
        return "enlace_de_ficha_no_encontrado"
    if not _transporte_correcto(ficha, "ficha"):
        return "respuesta_sin_ficha_identificada"
    return None


def _estado_catalogo(evaluacion: _Evaluacion) -> tuple[str, str] | None:
    """Exige lectura completa y presencia en el catálogo requerido; su edad no la retira.

    Returns:
        Estado y motivo impeditivos, o None si el catálogo permite continuar.
    """
    if evaluacion.conflicto_catalogo or not evaluacion.catalogos:
        motivo = (
            "catalogos_simultaneos_discrepantes"
            if evaluacion.conflicto_catalogo
            else "sin_comprobacion_de_catalogo_requerido"
        )
        return "sin-confirmar", motivo
    catalogo = evaluacion.catalogos[0]
    if catalogo["resultado"] == "fallo" or not _transporte_correcto(catalogo, "catalogo"):
        motivo = (
            "ultimo_intento_de_catalogo_fallido"
            if catalogo["resultado"] == "fallo"
            else "respuesta_sin_catalogo_identificado"
        )
        return "sin-confirmar", motivo
    if not catalogo["detalle"]["lectura_completa"]:
        return "sin-confirmar", "lectura_de_catalogo_incompleta"
    if catalogo["detalle"]["presente"] is not True:
        return "sin-confirmar", "ausente_o_no_identificada_en_catalogo_completo"
    return None


def _estado_oferta(evaluacion: _Evaluacion) -> tuple[str, str]:
    """Resuelve cierre, calendario y disponibilidad después de acreditar las lecturas.

    Returns:
        Estado y motivo de disponibilidad de la oferta.
    """
    ficha = evaluacion.fichas[0]
    detalle = ficha["detalle"]
    politica, instante = evaluacion.politica, evaluacion.instante
    datos = detalle["datos_edicion"]
    if datos["estado_edicion"] in ("finalizada", "archivada"):
        return ("no-disponible-publicamente", "edicion_finalizada_o_archivada")
    if datos["estado_inscripcion"] in ("cerrada", "sin-plazas"):
        return ("no-disponible-publicamente", "inscripcion_cerrada_o_sin_plazas")
    calendarios = _calendarios_exigibles(_calendarios_oferta(ficha, evaluacion.oferta))
    if any(c.apoyos and _calendario_diagnosticado(datos, c.campo) for c in calendarios):
        return ("sin-confirmar", "calendario_publicado_no_resuelto")
    estados_periodos = _estados_periodos(calendarios, instante, politica)
    matricula_confirmada = politica.get(
        "regla_disponibilidad"
    ) == matricula_actual.METODO and matricula_actual.acreditada(detalle)
    decision = _restricciones_periodos(
        datos, estados_periodos, detalle["acceso_abierto"], matricula_actual_confirmada=matricula_confirmada
    )
    if (
        politica.get("regla_disponibilidad") == matricula_actual.METODO
        and matricula_actual.CAMPO in detalle
        and not matricula_confirmada
        and (decision is None or decision[0] != "no-disponible-publicamente")
    ):
        return ("sin-confirmar", "matricula_actual_de_edicion_no_acreditada")
    if decision is not None:
        return decision
    return _disponibilidad_declarada(datos, detalle, estados_periodos, politica)


def _periodos_discrepan(primero: ObjetoJson, segundo: ObjetoJson) -> bool:
    for extremo in ("inicio", "fin"):
        a, b = primero[extremo], segundo[extremo]
        if a is None or b is None or ("T" in a) != ("T" in b):
            continue
        fecha_a, fecha_b = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in (a, b))
        if (fecha_a.utcoffset() is None) == (fecha_b.utcoffset() is None) and fecha_a != fecha_b:
            return True
    return False


def _estados_periodos(calendarios: list[_CalendarioOferta], instante: datetime, politica: ObjetoJson) -> dict[str, str]:
    """Evalúa calendarios pertinentes sin convertir las sesiones en disponibilidad.

    Returns:
        Estado de cada dimensión; un soporte ausente no prueba apertura ni cierre.
    """
    estados = {"matricula": "sin_periodo"}
    anteriores: dict[str, ObjetoJson] = {}
    for calendario in calendarios:
        periodo = calendario.periodo
        if not calendario.apoyos:
            estado = "sin_vinculo"
        else:
            if calendario.clase == "formativo":
                periodo = {"inicio": None, "fin": periodo["fin"]}
            comprobado = min(instante_utc(e["capturado_utc"], "capturado_utc") for e in calendario.apoyos)
            estado = _periodo(periodo, instante, comprobado, politica)[0]
        anterior = estados.get(calendario.clase)
        distinto = calendario.clase in anteriores and _periodos_discrepan(anteriores[calendario.clase], periodo)
        estados[calendario.clase] = "pendiente" if distinto or anterior not in (None, "sin_periodo", estado) else estado
        anteriores[calendario.clase] = periodo
    return estados


def _restricciones_periodos(
    datos: ObjetoJson,
    estados_periodos: dict[str, str],
    acceso_abierto: bool | None,
    *,
    matricula_actual_confirmada: bool = False,
) -> tuple[str, str] | None:
    """Conserva la precedencia de vencimiento, incertidumbre y apertura futura.

    Returns:
        Restricción temporal impeditiva, o None si no hay una.
    """
    if datos["estado_inscripcion"] == "disponible-publicamente" and estados_periodos.get("acceso") == "vencido":
        return ("sin-confirmar", "fuente_contradictoria_matricula_abierta_y_acceso_finalizado")
    if "sin_vinculo" in estados_periodos.values() and acceso_abierto is not True:
        return ("sin-confirmar", "calendario_sin_vinculo_verificable_a_edicion")
    if "vencido" in estados_periodos.values():
        if estados_periodos.get("acceso") == "vencido":
            motivo = "ventana_de_acceso_finalizada"
        elif estados_periodos.get("formativo") == "vencido":
            motivo = "periodo_formativo_finalizado"
        else:
            motivo = "plazo_de_inscripcion_o_acceso_vencido"
        return ("no-disponible-publicamente", motivo)
    # Se puede solicitar matrícula hoy para un aula que abrirá después.
    # Eso no acredita acceso al contenido ahora. Un acceso ya terminado sí
    # sigue bloqueando la oferta, como se ha comprobado antes de este punto.
    matricula_actual_confirmada = matricula_actual_confirmada or (
        estados_periodos["matricula"] == "activo" and datos["estado_inscripcion"] == "disponible-publicamente"
    )
    estados_exigibles = [
        estado
        for nombre, estado in estados_periodos.items()
        if not (nombre == "acceso" and matricula_actual_confirmada and estado in ("futuro", "sin_recomprobar"))
    ]
    if any(estado in ("pendiente", "sin_recomprobar") for estado in estados_exigibles):
        return ("sin-confirmar", "limite_temporal_no_resuelto_o_apertura_sin_recomprobar")
    if "futuro" in estados_exigibles:
        return ("apertura-futura", "plazo_de_inscripcion_o_acceso_futuro")
    return None


def _disponibilidad_declarada(
    datos: ObjetoJson, detalle: ObjetoJson, estados_periodos: dict[str, str], politica: ObjetoJson
) -> tuple[str, str]:
    """Exige una declaración de acceso y distingue matrícula de apertura del aula.

    Returns:
        Estado y motivo de la declaración de disponibilidad.
    """
    matricula_actual_confirmada = (
        estados_periodos["matricula"] == "activo" and datos["estado_inscripcion"] == "disponible-publicamente"
    )
    if datos["estado_inscripcion"] == "apertura-futura":
        return ("apertura-futura", "apertura_futura_publicada")
    if politica.get("regla_disponibilidad") == matricula_actual.METODO and matricula_actual.CAMPO in detalle:
        return (
            ("disponible-publicamente", "matricula_actual_de_edicion_acreditada")
            if matricula_actual.acreditada(detalle)
            else ("sin-confirmar", "matricula_actual_de_edicion_no_acreditada")
        )
    if politica.get("regla_disponibilidad") == oferta_continua.METODO:
        return (
            ("disponible-publicamente", "oferta_publicada_continua_acreditada")
            if oferta_continua.acreditada(detalle)
            else ("sin-confirmar", "oferta_publicada_continua_no_acreditada")
        )
    if datos["estado_inscripcion"] != "disponible-publicamente" and detalle["acceso_abierto"] is not True:
        return ("sin-confirmar", "sin_declaracion_de_disponibilidad_publica")
    if (
        not any(estado != "sin_periodo" for nombre, estado in estados_periodos.items() if nombre != "formativo")
        and detalle["acceso_abierto"] is not True
    ):
        return ("sin-confirmar", "sin_periodo_ni_acceso_abierto_declarado")
    motivo = (
        "matricula_abierta_con_contenido_de_acceso_futuro"
        if estados_periodos.get("acceso") == "futuro" and matricula_actual_confirmada
        else "ficha_identificada_y_disponibilidad_vigente"
    )
    return ("disponible-publicamente", motivo)


def _evidencias_politica(politica: ObjetoJson, instante: datetime) -> None:
    """Admite referencia Faro solo en política; observar hechos sigue exigiendo evidencia HTTP.

    La API pura valida la referencia y su coherencia. El productor debe verificar
    el artefacto real mediante el lector explícito; aquí no se lee el paquete.
    """
    lista = politica["evidencias"]
    _exigir(isinstance(lista, list), "evidencias de política debe ser lista")
    for evidencia in lista:
        if not isinstance(evidencia, dict) or evidencia.get("tipo") != "interna-faro":
            _evidencias([evidencia], instante)
            continue
        _campos(
            evidencia,
            ("alcance", "tipo", "documento_id", "version", "sha256", "localizador"),
            "referencia interna de política",
        )
        _exigir(evidencia["alcance"] == "politica", "Referencia interna fuera de política")
        _exigir(
            isinstance(evidencia["documento_id"], str)
            and re.fullmatch(r"faro:vigencia:[a-z][a-z0-9_-]*", evidencia["documento_id"]) is not None
            and evidencia["documento_id"] == "faro:vigencia:" + politica["fuente_id"]
            and evidencia["version"] == politica["version"],
            "Referencia interna de otra política o versión",
        )
        _exigir(
            isinstance(evidencia["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", evidencia["sha256"]) is not None,
            "Huella de política interna inválida",
        )
        _exigir(
            evidencia["localizador"] == {"tipo": "campo", "valor": "/criterios"},
            "Campo de política interna no identificado",
        )


def _validar_politica(politica: ObjetoJson, oferta: ObjetoJson, instante: datetime) -> None:
    """Comprueba plazos, fuente y convenciones antes de leer observaciones.

    Raises:
        ErrorVigencia: Si el plazo o la zona no se pueden representar.
    """
    campos = CAMPOS_POLITICA + (("regla_disponibilidad",) if "regla_disponibilidad" in politica else ())
    _campos(politica, campos, "politica")
    if "regla_disponibilidad" in politica:
        regla = politica["regla_disponibilidad"]
        _exigir(
            regla == oferta_continua.METODO
            or retirada_proveedor.regla_valida(politica)
            or regla == matricula_actual.METODO
            and politica["fuente_id"] == matricula_actual.FUENTE
            and politica["version"] == matricula_actual.VERSION_POLITICA,
            "Regla de disponibilidad no registrada",
        )
    _texto(politica["fuente_id"], "politica.fuente_id")
    _texto(politica["version"], "politica.version")
    _exigir(
        politica["fuente_id"] == oferta["fuente_id"],
        "La política pertenece a otra fuente",
    )
    _exigir(
        type(politica["requiere_catalogo"]) is bool,
        "requiere_catalogo debe ser booleano",
    )
    _exigir(
        politica["plazo_tecnico"] == PLAZO_TECNICO,
        "La política debe declarar su plazo técnico como revisión interna",
    )
    for campo in ("ttl_ficha_segundos", "ttl_catalogo_segundos"):
        if campo == "ttl_catalogo_segundos" and politica[campo] is None:
            _exigir(
                not politica["requiere_catalogo"],
                "El catálogo requerido exige TTL propio",
            )
            continue
        _exigir(
            type(politica[campo]) is int and politica[campo] > 0,
            campo + ": entero positivo obligatorio",
        )
        try:
            instante + timedelta(seconds=politica[campo])
        except OverflowError as error:
            raise ErrorVigencia(campo + ": TTL fuera del intervalo representable") from error
    for campo in ("inicio_dia_inclusivo", "fin_dia_inclusivo"):
        _exigir(
            politica[campo] is None or type(politica[campo]) is bool,
            campo + ": booleano o null obligatorio",
        )
    zona = politica["zona_fechas_dia"]
    if zona is not None:
        _texto(zona, "zona_fechas_dia")
        try:
            ZoneInfo(zona)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ErrorVigencia("Zona horaria de fuente no reconocida") from error
    _evidencias_politica(politica, instante)
    _exigir(
        _evidencia_de(politica, "politica"),
        "Política sin evidencia y localizador de su alcance",
    )


def _validar_observacion(observacion: ObjetoJson, oferta: ObjetoJson, instante: datetime) -> None:
    """Comprueba tiempos, respuesta y apoyos de una observación.

    Raises:
        ErrorVigencia: Si la respuesta o el método incumple su contrato cerrado.
    """
    _exigir(
        isinstance(observacion["tipo"], str) and observacion["tipo"] in ("ficha", "catalogo"),
        "Tipo de comprobación inválido",
    )
    _exigir(
        isinstance(observacion["resultado"], str) and observacion["resultado"] in ("correcta", "fallo"),
        "Resultado de intento inválido",
    )
    inicio = instante_utc(observacion["intentado_el"], "intentado_el")
    fin = instante_utc(observacion["terminado_el"], "terminado_el")
    _exigir(
        inicio <= fin <= instante,
        "Intento/comprobación invertido o posterior a ahora",
    )
    _url(observacion["url_consultada"], "url_consultada")
    urls = {observacion["url_consultada"]}
    _validar_detalle(observacion, oferta, urls)
    _evidencias(observacion["evidencias"], instante, inicio=inicio, fin=fin, urls=urls)
    try:
        propia = cabeceras_actuales.oferta_propia(observacion, oferta)
        if cabeceras_actuales.CAMPO in observacion["detalle"]:
            cabeceras_actuales.validar(observacion, propia)
        if matricula_actual.CAMPO in observacion["detalle"]:
            matricula_actual.validar(observacion, propia)
    except matricula_actual.ErrorMatriculaActual as error:
        raise ErrorVigencia(str(error)) from error
    _validar_apoyos(observacion, oferta)


def _validar_detalle(observacion: ObjetoJson, oferta: ObjetoJson, urls: set[str]) -> None:
    """Contrasta el detalle HTTP y de edición antes de usarlo.

    Raises:
        ErrorVigencia: Si la edición incumple su contrato factual.
    """
    detalle = observacion["detalle"]
    if observacion["resultado"] == "fallo":
        _campos(detalle, ("motivo",), "fallo")
        _texto(detalle["motivo"], "fallo.motivo")
    else:
        campos = ("url_final", "codigo_http", "tipo_destino")
        campos += (
            ("identidad_observada", "datos_edicion", "acceso_abierto")
            if observacion["tipo"] == "ficha"
            else ("identidad_buscada", "lectura_completa", "presente")
        )
        if oferta_continua.CAMPO in detalle and observacion["tipo"] == "ficha":
            campos += (oferta_continua.CAMPO,)
            try:
                oferta_continua.validar(observacion, oferta)
            except oferta_continua.ErrorOfertaContinua as error:
                raise ErrorVigencia(str(error)) from error
            urls.update(oferta_continua.urls_apoyadas(observacion))
        for campo in (matricula_actual.CAMPO, cabeceras_actuales.CAMPO):
            campos += (campo,) if campo in detalle and observacion["tipo"] == "ficha" else ()
        _campos(detalle, campos, "detalle")
        _url(detalle["url_final"], "url_final")
        urls.add(detalle["url_final"])
        _exigir(
            type(detalle["codigo_http"]) is int and HTTPStatus.CONTINUE <= detalle["codigo_http"] <= ULTIMO_CODIGO_HTTP,
            "Código HTTP inválido",
        )
        tipos = (observacion["tipo"], "portada", "error", "desconocido")
        _exigir(
            isinstance(detalle["tipo_destino"], str) and detalle["tipo_destino"] in tipos,
            "Tipo de destino inválido",
        )
        if observacion["tipo"] == "ficha":
            if detalle["identidad_observada"] is not None:
                _texto(detalle["identidad_observada"], "identidad_observada")
            _exigir(
                detalle["acceso_abierto"] is None or type(detalle["acceso_abierto"]) is bool,
                "acceso_abierto debe ser booleano o null",
            )
            if detalle["datos_edicion"] is not None:
                try:
                    validar_datos_edicion(detalle["datos_edicion"])
                except ErrorFicha as error:
                    raise ErrorVigencia(str(error)) from error
        else:
            _exigir(
                detalle["identidad_buscada"] == oferta["id"],
                "El catálogo se comprobó para otra oferta",
            )
            _exigir(
                type(detalle["lectura_completa"]) is bool,
                "lectura_completa debe ser booleano",
            )
            _exigir(
                detalle["presente"] is None or type(detalle["presente"]) is bool,
                "presente debe ser booleano o null",
            )


def _validar_apoyos(observacion: ObjetoJson, oferta: ObjetoJson) -> None:
    """Exige evidencia localizada para cada conclusión factual de la ficha."""
    detalle = observacion["detalle"]
    if observacion["resultado"] == "correcta":
        _exigir(
            bool(observacion["evidencias"]),
            "Respuesta leída sin captura de evidencia",
        )
        if observacion["tipo"] == "ficha" and ficha_identificada_de_oferta(observacion, oferta):
            _exigir(
                _evidencia_de(observacion, "identidad"),
                "Identidad de ficha sin evidencia localizada",
            )
            datos = detalle["datos_edicion"]
            if (
                any(datos[c] is not None for c in ("estado_inscripcion", "estado_edicion"))
                or detalle["acceso_abierto"] is not None
            ):
                _exigir(
                    _evidencia_de(observacion, "disponibilidad"),
                    "Disponibilidad declarada sin evidencia localizada",
                )
            if any(datos["fechas_matricula"][e] is not None for e in ("inicio", "fin")) or any(
                c["periodo"][e] is not None for c in calendarios_edicion(datos) for e in ("inicio", "fin")
            ):
                _exigir(
                    _evidencia_de(observacion, "calendario"),
                    "Fechas publicadas sin evidencia localizada",
                )
        elif observacion["tipo"] == "catalogo" and _transporte_correcto(observacion, "catalogo"):
            _exigir(
                _evidencia_de(observacion, "catalogo"),
                "Catálogo sin evidencia localizada de lectura/presencia",
            )
