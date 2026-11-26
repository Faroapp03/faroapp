"""Academy dentro del ciclo común: índice, declaración, ficha y primer destino.

La unión con las identidades conocidas descubre altas sin usar una ausencia
del índice para declarar bajas. No publica, importa a SQLite ni crea cuentas.
"""

from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_formacion as condiciones
from plataforma_datos.cursos.fuentes.claude_academy import lector, lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson


def _recibir(url: str, original: Path, id: str | None) -> ObjetoJson:
    partes = urlsplit(url)
    comun.exigir(
        partes.scheme == "https"
        and partes.netloc == lector.HOST_ACADEMY
        and not partes.query
        and not partes.fragment
        and (
            url in (acceso.INDICE, acceso.PORTADA, condiciones.FAQ)
            or lector.PATRON_CURSO.fullmatch(partes.path)
            or acceso.LECCION.fullmatch(partes.path)
        ),
        "URL ajena a Academy",
        FormatoInesperado,
    )
    return comun.recibir_url(url, original, id, perfil="pagina")


def _interpretar_faq(original: Path, captura: ObjetoJson) -> ObjetoJson:
    """Conserva el fallo auxiliar sin bloquear la lectura de fichas independientes.

    Returns:
        Declaración o incertidumbre. Los errores de programación no se capturan.
    """
    meta = None
    try:
        cuerpo, meta = comun.pagina_academy(original, captura)
        declaracion = condiciones.declaracion_inscripcion(cuerpo, meta)
    except (lector.ErrorFichaAcademy, FormatoInesperado, OSError) as error:
        return {
            **captura,
            "lectura": {
                "inscripcion_progreso": None,
                "fallo": type(error).__name__,
                "retener_anterior": meta is None or meta["http"] != HTTPStatus.OK or meta["completo"] is not True,
            },
        }
    return {**captura, "lectura": {"inscripcion_progreso": declaracion._asdict() if declaracion is not None else None}}


def interpretar_auxiliares(original: Path, auxiliares: ObjetoJson) -> ObjetoJson:
    """Reproduce descubrimiento y declaración desde sus bytes exactos.

    Returns:
        Auxiliares con lectura vinculada; no demuestra acceso al curso entero.
    """
    comun.exigir(
        set(auxiliares) in ({"indice", "portada"}, {"indice", "portada", "faq"}),
        "Auxiliares Academy incompletos",
        FormatoInesperado,
    )
    indice = acceso.extraer_indice(*comun.pagina_academy(original, auxiliares["indice"]))
    declaracion = acceso.declaracion_gratuidad(*comun.pagina_academy(original, auxiliares["portada"]))
    general = declaracion if declaracion is not None and declaracion.texto == acceso.DECLARACION else None
    salida = {
        "indice": {
            **auxiliares["indice"],
            "lectura": {"urls": list(indice.urls), "capturado_utc": indice.capturado_utc},
        },
        "portada": {
            **auxiliares["portada"],
            "lectura": {
                "gratuidad_formacion_declarada": general._asdict() if general is not None else None,
            },
        },
    }

    if "faq" in auxiliares:
        salida["faq"] = _interpretar_faq(original, auxiliares["faq"])
    return salida


def descargar(programas: list[ObjetoJson], original: Path, anterior: ObjetoJson) -> lectura.Resultado:
    """Recibe en serie y conserva los intentos; no retira por ausencia del índice.

    Al final emite la lectura del índice; si no se puede emitir, el resultado lo dice y nada más cambia.

    Returns:
        La lectura emitida y los problemas que impidieron emitirla, si los hubo.

    Raises:
        FormatoInesperado: Si una captura no conserva el contrato público de Academy.
    """
    auxiliares, capturas = {}, []
    try:
        auxiliares["indice"] = _recibir(acceso.INDICE, original, None)
        auxiliares["portada"] = _recibir(acceso.PORTADA, original, None)
        auxiliares["faq"] = _recibir(condiciones.FAQ, original, None)
        leidas = interpretar_auxiliares(original, auxiliares)
        urls = set(leidas["indice"]["lectura"]["urls"]) | {p["url"] for p in programas}
        for url in sorted(urls):
            id = "claude-academy:" + urlsplit(url).path.rsplit("/", 1)[1]
            captura = _recibir(url, original, id)
            capturas.append(captura)
            if captura["cuerpo"] is None:
                # Fallo de transporte de esta ficha: queda como fallo de su unidad; las demás siguen.
                continue
            cuerpo, meta = comun.pagina_academy(original, captura)
            if meta["http"] == HTTPStatus.OK and meta["completo"] is True:
                ficha = lector.extraer_ficha(cuerpo, meta, url_esperada=url)
                enlace = acceso.enlace_inicio(ficha)
                if enlace is not None:
                    captura["leccion"] = _recibir(enlace.href, original, id)
    except lector.ErrorFichaAcademy as error:
        raise FormatoInesperado(str(error)) from error
    finally:
        comun.guardar_capturas_de_fuente(
            original, "claude_academy", capturas, anterior, auxiliares, fallos_por_unidad=True
        )
    return lectura.emitir(original, auxiliares, capturas)


def interpretar_leccion(original: Path, cap: ObjetoJson, ficha: lector.FichaAcademy) -> ObjetoJson | None:
    """Conserva el alcance del primer texto observado, nunca el curso entero.

    Returns:
        Texto y pruebas de la primera lección o None si no hay vínculo publicado.
    """
    if cap.get("leccion") is None:
        return None
    cuerpo, meta = comun.pagina_academy(original, cap["leccion"])
    leccion = acceso.extraer_leccion(cuerpo, meta, ficha=ficha)
    return {
        "curso_id": leccion.curso_id,
        "url": leccion.url,
        "titulo": leccion.titulo,
        "texto": leccion.contenido,
        "bloques": [b._asdict() for b in leccion.bloques],
        "capturado_utc": leccion.capturado_utc,
        "sha256": leccion.sha256,
        "alcance": "texto_publico_de_primera_leccion_no_curso_entero",
    }
