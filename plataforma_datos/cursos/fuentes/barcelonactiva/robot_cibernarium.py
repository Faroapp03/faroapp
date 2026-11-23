"""Robot serial de Cibernàrium para investigación local, sin importar la aplicación.

Primera carga sin red:
  python -m plataforma_datos.cursos.fuentes.barcelonactiva.robot_cibernarium --desde-capturas CARPETA
      --salida INSTANTANEAS --base bolsa.sqlite
Próxima consulta real (capturas nuevas, nunca una caché permanente):
  python -m plataforma_datos.cursos.fuentes.barcelonactiva.robot_cibernarium --consultar
      --salida INSTANTANEAS --base bolsa.sqlite

No instala cron, no inscribe personas ni asigna niveles Faro. Una ejecución con errores
conserva las capturas diagnósticas, pero no carga ni concilia el catálogo anterior.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import re
import sys
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, timezone
from email.message import Message
from html.parser import HTMLParser
from http import HTTPStatus
from http.client import HTTPResponse
from pathlib import Path
from typing import BinaryIO, Protocol, override
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from zoneinfo import ZoneInfo

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.confianza_tls import contexto_tls
from plataforma_datos.cursos.catalogo import InstantaneaCatalogo, OpcionesCiclo
from plataforma_datos.cursos.fuentes.barcelonactiva import matricula_actual
from plataforma_datos.cursos.fuentes.barcelonactiva.idioma_ficha import idioma_de_ficha
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson


class ImportadorCiclo(Protocol):
    """Operación pública inyectable que importa y concilia bajo la misma transacción."""

    def __call__(
        self,
        base: str | Path,
        entrada: list[ObjetoJson],
        instantanea: InstantaneaCatalogo,
        *,
        opciones: OpcionesCiclo | None = None,
    ) -> ObjetoJson:
        """Devuelve los resultados de importación y conciliación para la instantánea declarada."""
        ...


PROVEEDOR = "cibernarium"
# Ficha del proveedor en el catálogo: la crea el primer lote que da de alta un curso suyo.
FICHA_PROVEEDOR = {
    "id": PROVEEDOR,
    "nombre": "Cibernàrium · Barcelona Activa",
    "territorio": "Barcelona; acceso online",
    "naturaleza": "publico-municipal",
}
AMBITO = "busqueda-publica-sin-filtros"
PAGINA = 15
PAUSA_MINIMA = 2.0
MAX_BYTES = 8 * 1024 * 1024
ORIGEN = "https://cibernarium.barcelonactiva.cat"
RECURSO = ORIGEN + ":443/ca/web/guest/formacions"
# Instancia del portlet de la consulta pública; el canal la descubre en la página de filtros (censo_ia.descubrir).
PORTLET = "cAct_INSTANCE_uhcx"
MESES = dict(
    zip(
        [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ],
        range(1, 13),
        strict=False,
    )
)


class ErrorRobot(ValueError):
    """La captura o el contrato público no permiten una actualización fiable."""


def utc_ahora() -> str:
    """Devuelve el instante actual de UTC en formato ISO.

    Returns:
        Instante UTC actual en formato ISO.
    """
    return datetime.now(UTC).isoformat()


def sha256(datos: bytes) -> str:
    """Devuelve la huella SHA-256 de los bytes originales.

    Returns:
        Huella hexadecimal SHA-256 de los bytes recibidos.
    """
    return hashlib.sha256(datos).hexdigest()


def escribir_json(ruta: Path, valor: ValorJson) -> None:
    """Escribe el documento JSON completo en su destino local."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(
        json.dumps(valor, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def url_pagina(desde: int, portlet: str = PORTLET) -> str:
    """Construye la consulta pública del intervalo solicitado, con la instancia de portlet que publica la página.

    Returns:
        URL de la página pública para el intervalo solicitado.
    """
    return (
        RECURSO
        + "?"
        + urlencode(
            {
                "p_p_id": portlet,
                "p_p_lifecycle": "2",
                "p_p_state": "normal",
                "p_p_mode": "view",
                "p_p_cacheability": "cacheLevelPage",
                f"_{portlet}_start": desde,
                f"_{portlet}_end": desde + PAGINA,
                f"_{portlet}_typeView": "list",
            }
        )
    )


def url_ficha(identificador: str) -> str:
    """Construye la URL pública de la actividad identificada.

    Returns:
        URL pública correspondiente al identificador.
    """
    return ORIGEN + "/ficha-actividad?" + urlencode({"activityId": identificador})


def fecha_utc(valor: str) -> datetime:
    """Interpreta el instante de captura y exige su zona UTC.

    Returns:
        Instante de captura validado en UTC.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if not isinstance(valor, str):
        raise ErrorRobot("Falta una fecha de captura UTC.")
    try:
        fecha = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError as error:
        raise ErrorRobot("Fecha de captura no interpretable.") from error
    if fecha.utcoffset() != timedelta(0):
        raise ErrorRobot("La fecha de captura debe indicar zona UTC.")
    return fecha


def fecha_publicada(valor: ValorJson) -> datetime | None:
    """Conserva la zona publicada; null significa ausente, no una fecha estimada.

    Returns:
        Instante con la zona publicada, o None si está ausente.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if valor is None or valor == "":
        return None
    if isinstance(valor, str) and re.fullmatch(r"\d{13}", valor):
        return datetime.fromtimestamp(int(valor) / 1000, UTC).astimezone(ZoneInfo("Europe/Madrid"))
    if not isinstance(valor, str):
        raise ErrorRobot("Una fecha publicada tiene un tipo no reconocido.")
    patron = r"\w{3} (\w{3}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) (CET|CEST) (\d{4})"
    coincidencia = re.fullmatch(patron, valor)
    if not coincidencia:
        raise ErrorRobot(f"Formato de fecha publicado no reconocido: {valor!r}")
    mes, dia, hora, minuto, segundo, zona, ano = coincidencia.groups()
    if mes not in MESES:
        raise ErrorRobot("Mes publicado no reconocido.")
    try:
        return datetime(
            int(ano),
            MESES[mes],
            int(dia),
            int(hora),
            int(minuto),
            int(segundo),
            tzinfo=timezone(timedelta(hours=2 if zona == "CEST" else 1)),
        )
    except ValueError as error:
        raise ErrorRobot("Fecha publicada imposible.") from error


def identificador(valor: ValorJson) -> str:
    """Exige la identidad pública sin sustituirla por título o URL.

    Returns:
        Identificador público recibido, sin reemplazarlo ni normalizarlo.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if not isinstance(valor, str) or not re.fullmatch(r"[1-9]\d*", valor):
        raise ErrorRobot("activityId ausente o no reconocido; no se sustituye por el título.")
    return valor


class TextoDeBloque(HTMLParser):
    """Lee únicamente texto de un bloque factual; excluye guiones y estilos."""

    def __init__(self, indice: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.indice = indice
        self.profundidad = 0
        self.raiz = None
        self.excluido = 0
        self.partes = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Registra el comienzo del bloque y las exclusiones de contenido."""
        atributos = dict(attrs)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.profundidad += 1
        if self.indice is not None and atributos.get("data-mobile-index") == self.indice:
            self.raiz = self.profundidad
        if tag in {"script", "style"}:
            self.excluido += 1

    def handle_endtag(self, tag: str) -> None:
        """Cierra el bloque y actualiza la profundidad del lector."""
        if tag in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            return
        if tag in {"script", "style"}:
            self.excluido = max(0, self.excluido - 1)
        if self.raiz == self.profundidad:
            self.raiz = None
        self.profundidad = max(0, self.profundidad - 1)

    def handle_data(self, data: str) -> None:
        """Conserva texto del bloque fuera de guiones y estilos."""
        if not self.excluido and (self.indice is None or self.raiz is not None):
            self.partes.append(data)

    def texto(self) -> str:
        """Devuelve las partes factuales unidas con espacios.

        Returns:
            Texto factual unido con espacios.
        """
        return " ".join(" ".join(self.partes).split())


def texto_html(contenido: bytes, indice: str | None = None) -> str:
    """Extrae el texto factual del bloque HTML indicado.

    Returns:
        Texto factual del bloque solicitado, excluidos guiones y estilos.
    """
    parser = TextoDeBloque(indice)
    parser.feed(contenido.decode("utf-8"))
    parser.close()
    return parser.texto()


def hechos_ficha(contenido: bytes) -> ObjetoJson:
    """No extrae descripción, objetivos, temario, ni menciones sueltas de nivel.

    Returns:
        Horas, idioma y localizador del bloque factual de la ficha.
    """
    texto = texto_html(contenido, "3")
    duracion = re.search(r"Durada:\s*(.*?)(?=Idioma:|Dates:|Modalitat:|$)", texto, re.IGNORECASE)
    horas = None
    if duracion:
        literal = duracion.group(1).strip()
        coincidencia = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(?:hores?|h)", literal)
        if not coincidencia:
            coincidencia = re.fullmatch(r"\d+\s+sessions?\s*\((\d+(?:[.,]\d+)?)h\)", literal)
        if coincidencia:
            horas = float(coincidencia.group(1).replace(",", "."))
    return {
        "horas_publicadas_ficha": horas,
        "idioma_publicado_ficha": idioma_de_ficha(texto),
        "localizador": '[data-mobile-index="3"]',
    }


def normas_generales(contenido: bytes | None) -> ObjetoJson:
    """Conserva únicamente las condiciones reconocidas de las normas públicas.

    Returns:
        Condiciones reconocidas y desconocidos explícitos de las normas públicas.
    """
    texto = texto_html(contenido) if contenido is not None else ""
    acceso = "major de 16 anys" in texto and "DNI, NIE o passaport" in texto
    laboral = "No cal estar en cap situació laboral específica" in texto
    asincrono = "subtítols en castellà" in texto and "escrita està en català" in texto
    return {
        "edad": {"operador": ">", "anos": 16} if acceso else None,
        "documentos_identidad": ["DNI", "NIE", "pasaporte"] if acceso else None,
        "situacion_laboral_exigida": False if laboral else None,
        "sector_profesional_exigido": False if "ni pertànyer a cap sector professional concret" in texto else None,
        "residencia_exigida_en_norma_general": False if acceso else None,
        "registro_previo": True
        if "No és possible inscriure" in texto and "sense fer registre previ" in texto
        else None,
        "asincrono_idioma": {
            "video": "ca",
            "subtitulos": ["es"],
            "documentacion": ["ca", "es"],
        }
        if asincrono
        else None,
        "certificado_asincrono": {
            "tipo": "realizacion",
            "condicion": "superar-modulos-y-test-si-existe",
            "coste_eur": None,
        }
        if "certificat de realització" in texto and "tots els mòduls" in texto
        else None,
        "localizadores": ["NU2", "NU3", "NU10", "NU11"],
        "requisitos_especificos_del_curso": None,
    }


def sesion_virtual(sesion: ObjetoJson) -> bool | None:
    """Interpreta si el lugar publicado identifica una sesión virtual.

    Returns:
        True para sesión virtual, False para presencial y None cuando no consta.
    """
    tipo = str(sesion.get("centerType") or "").strip().casefold()
    nombre = str(sesion.get("centerName") or "").strip().casefold()
    if tipo in {"zoom", "aula virtual"} or nombre == "aula virtual":
        return True
    if tipo == "sessió presencial" or (nombre and nombre not in {"--", "-"}):
        return False
    return None


def apertura_inscripcion(descripcion: ValorJson) -> str | None:
    """Interpreta una apertura de inscripción en la zona publicada.

    Returns:
        Apertura publicada en formato ISO, o None si no tiene forma reconocida.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if not isinstance(descripcion, str):
        return None
    coincidencia = re.fullmatch(
        r"Obertura de la inscripció (\d{2})/(\d{2})/(\d{4}) a les (\d{2}):(\d{2})h\.",
        descripcion,
    )
    if not coincidencia:
        return None
    dia, mes, ano, hora, minuto = map(int, coincidencia.groups())
    try:
        return datetime(ano, mes, dia, hora, minuto, tzinfo=ZoneInfo("Europe/Madrid")).isoformat()
    except ValueError as error:
        raise ErrorRobot("Apertura de inscripción imposible.") from error


def _calendario_publicado(
    asincrona: bool, online: ObjetoJson | None, sesiones: list[ObjetoJson]
) -> tuple[str | None, str | None, ObjetoJson | None, list[ObjetoJson], list[float | None]]:
    modalidad = None
    sincronia = None
    ventana = None
    sesiones_normalizadas = []
    duraciones = []
    if asincrona:
        modalidad, sincronia = ("en-linea", "asincrona")
        inicio, fin = (fecha_publicada(online.get("startDate")), fecha_publicada(online.get("endDate")))
        ventana = {"desde": inicio.isoformat() if inicio else None, "hasta": fin.isoformat() if fin else None}
        if inicio and fin and (fin < inicio):
            raise ErrorRobot("Ventana asíncrona invertida.")
    elif sesiones:
        clases = {sesion_virtual(s) for s in sesiones}
        if clases == {True}:
            modalidad = "en-linea"
        elif clases == {False}:
            modalidad = "presencial"
        elif True in clases and False in clases:
            modalidad = "mixta"
        sincronia = "sincrona"
        for sesion in sesiones:
            inicio = fecha_publicada(sesion.get("beginDateTime"))
            fin = fecha_publicada(sesion.get("endDateTime"))
            if inicio and fin and (fin <= inicio):
                raise ErrorRobot("Sesión con duración no positiva.")
            duraciones.append((fin - inicio).total_seconds() / 3600 if inicio and fin else None)
            sesiones_normalizadas.append(
                {
                    "inicio": inicio.isoformat() if inicio else None,
                    "fin": fin.isoformat() if fin else None,
                    "virtual": sesion_virtual(sesion),
                    "centro_tipo": sesion.get("centerType") or None,
                    "centro_nombre": sesion.get("centerName") or None,
                    "municipio": sesion.get("centerTown") or None,
                    "direccion": sesion.get("centerAddress") or None,
                }
            )
    return (modalidad, sincronia, ventana, sesiones_normalizadas, duraciones)


def normalizar_edicion(
    programa_id: str, actividad: ObjetoJson, edicion: ObjetoJson, hechos: ObjetoJson | None = None
) -> ObjetoJson:
    """Conserva modalidad, sesiones, acceso y matrícula como dimensiones independientes.

    Returns:
        Edición con modalidad, sesiones, acceso y matrícula independientes.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    ident = identificador(edicion.get("activityId"))
    sesiones = edicion.get("listSessions")
    if sesiones is None:
        sesiones = []
    if not isinstance(sesiones, list) or any(not isinstance(s, dict) for s in sesiones):
        raise ErrorRobot("listSessions no es una lista de sesiones.")
    online = edicion.get("sessionsOnline")
    if online is not None and (not isinstance(online, dict)):
        raise ErrorRobot("sessionsOnline tiene una forma no reconocida.")
    asincrona = actividad.get("formationType") == "ONLINE" and online is not None
    if asincrona and sesiones:
        raise ErrorRobot("La edición mezcla sesiones fijas y ventana asíncrona sin un contrato inequívoco.")
    modalidad, sincronia, ventana, sesiones_normalizadas, duraciones = _calendario_publicado(
        asincrona, online, sesiones
    )
    horas = None
    metodo_horas = None
    if duraciones and all(h is not None for h in duraciones):
        horas, metodo_horas = (sum(duraciones), "suma-exacta-de-sesiones-publicadas-no-implica-trabajo-adicional")
    if hechos and ident == actividad["activityId"] and (hechos["horas_publicadas_ficha"] is not None):
        horas, metodo_horas = (hechos["horas_publicadas_ficha"], "ficha-principal-verificada-bloque-3")
    codigo = edicion.get("registrationCode")
    fechas = {"tipo": None, "inicio": None, "fin": None}
    if ventana is not None:
        fechas = {"tipo": "ventana-acceso", "inicio": ventana["desde"], "fin": ventana["hasta"]}
    elif sesiones_normalizadas and all(s["inicio"] and s["fin"] for s in sesiones_normalizadas):
        fechas = {
            "tipo": "sesiones",
            "inicio": min((s["inicio"] for s in sesiones_normalizadas), key=datetime.fromisoformat),
            "fin": max((s["fin"] for s in sesiones_normalizadas), key=datetime.fromisoformat),
        }
    return {
        "id": f"cibernarium-edicion:{ident}",
        "programa_id": programa_id,
        "datos": {
            "activity_id": ident,
            "modalidad": modalidad,
            "sincronia": sincronia,
            "ventana_acceso": ventana,
            "fechas_publicadas": fechas,
            "sesiones": sesiones_normalizadas,
            "horas_publicadas": horas,
            "metodo_horas": metodo_horas,
            "idioma_ficha_principal": hechos["idioma_publicado_ficha"]
            if hechos and ident == actividad["activityId"]
            else None,
            "codigo_inscripcion_publicado": codigo,
            "estado_inscripcion": matricula_actual.estado_inscripcion(edicion),
            "apertura_inscripcion": apertura_inscripcion(edicion.get("registrationDesc")),
            "plazas": "sin-plazas" if codigo == "DISP3" else None,
            "openings_available_senal": edicion.get("openingsAvailable")
            if type(edicion.get("openingsAvailable")) is bool
            else None,
            "admision_definitiva": None,
            "requisitos_especificos": None,
        },
        "evidencias": [],
    }


class RedireccionEspaciada(HTTPRedirectHandler):
    """Las redirecciones también son consultas y respetan la pausa mínima."""

    def __init__(self, pausa: float) -> None:
        self.pausa = pausa

    @override
    def redirect_request(
        self, req: Request, fp: BinaryIO | None, code: int, msg: str, headers: Message | Mapping[str, str], newurl: str
    ) -> Request | None:
        """Espacia cada redirección antes de construir el siguiente envío.

        Returns:
            Resultado de la operación con los valores y el orden de la fuente.
        """
        siguiente = super().redirect_request(req, fp, code, msg, headers, newurl)
        if siguiente is not None:
            time.sleep(self.pausa)
        return siguiente


def abrir_serial(peticion: Request, *, timeout: float, pausa: float) -> HTTPResponse:
    """Abre la petición con el manejador de redirecciones espaciadas.

    Returns:
        Respuesta del transporte con redirecciones espaciadas.
    """
    return build_opener(RedireccionEspaciada(pausa), HTTPSHandler(context=contexto_tls())).open(
        peticion, timeout=timeout
    )


class DescargadorSerial:
    """Transporte serial con identidad genérica y pausa entre intentos."""

    def __init__(self, pausa: float = PAUSA_MINIMA, *, agente_usuario: str | None = None) -> None:
        if type(pausa) not in (int, float) or not math.isfinite(pausa) or pausa < PAUSA_MINIMA:
            raise ValueError("La pausa debe ser finita y de al menos 2 segundos.")
        self.pausa = pausa
        try:
            perfil = (
                perfil_web.leer_perfil() if agente_usuario is None else perfil_web.perfil_del_agente(agente_usuario)
            )
            self.cabeceras = perfil_web.identidad_publica(perfil)
        except perfil_web.PerfilInvalido as error:
            raise ErrorRobot(str(error)) from error
        self.agente_usuario = self.cabeceras["User-Agent"]
        self.ultimo_fin = None

    def obtener(self, url: str) -> tuple[bytes, str, str]:
        """Obtiene bytes originales y registra el cierre de la consulta serial.

        Returns:
            Bytes originales, URL final e instante real de la consulta.

        Raises:
            ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
        """
        if self.ultimo_fin is not None:
            time.sleep(max(0, self.pausa - (time.monotonic() - self.ultimo_fin)))
        peticion = Request(url, headers=self.cabeceras)
        try:
            with abrir_serial(peticion, timeout=40, pausa=self.pausa) as respuesta:
                if respuesta.status != HTTPStatus.OK:
                    raise ErrorRobot(f"Estado HTTP no admitido: {respuesta.status}")
                contenido = respuesta.read(MAX_BYTES + 1)
                if len(contenido) > MAX_BYTES:
                    raise ErrorRobot("La respuesta excede el límite de captura.")
                return contenido, respuesta.geturl(), utc_ahora()
        finally:
            self.ultimo_fin = time.monotonic()


class CapturasDeEjecucion:
    """Capturas originales y metadatos de una ejecución local."""

    def __init__(
        self, salida: str | Path, origen: str | Path | None = None, descargador: DescargadorSerial | None = None
    ) -> None:
        self.salida = Path(salida)
        self.origen = Path(origen).resolve() if origen is not None else None
        self.descargador = descargador

    def _leer_original(self, nombre: str, opcional: bool) -> tuple[bytes, str, str] | None:
        metadatos = self.origen / "consultas" / f"{nombre}.json"
        if opcional and (not metadatos.exists()):
            return None
        meta = json.loads(metadatos.read_text(encoding="utf-8"))
        if not isinstance(meta, dict):
            raise ErrorRobot("Los metadatos de captura no son un objeto.")
        relativa = Path(meta.get("captura", ""))
        original = (self.origen / relativa).resolve()
        if relativa.is_absolute() or not original.is_relative_to(self.origen) or (not original.is_file()):
            raise ErrorRobot("La captura está ausente o fuera de la carpeta de origen.")
        contenido = original.read_bytes()
        if sha256(contenido) != meta.get("sha256"):
            raise ErrorRobot(f"La huella no coincide: {nombre}")
        if meta.get("estadoHttp", 200) != HTTPStatus.OK:
            raise ErrorRobot(f"La consulta original no fue HTTP200: {nombre}")
        capturado = meta.get("consultadoUTC")
        final = meta.get("urlFinal") or meta.get("url") or meta.get("urlSolicitada")
        return (contenido, final, capturado)

    def leer(self, nombre: str, url: str, opcional: bool = False) -> tuple[bytes | None, ObjetoJson | None]:
        """Lee una captura de la ejecución con su procedencia comprobada.

        Returns:
            Bytes y evidencia de captura, o dos None si falta una captura opcional.

        Raises:
            ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
        """
        ruta = Path("capturas") / f"{nombre}.{('json' if nombre.startswith('cibernarium-todas-') else 'html')}"
        if self.origen is not None:
            original = self._leer_original(nombre, opcional)
            if original is None:
                return (None, None)
            contenido, final, capturado = original
        else:
            contenido, final, capturado = self.descargador.obtener(url)
        fecha_utc(capturado)
        if urlsplit(final).hostname != "cibernarium.barcelonactiva.cat":
            raise ErrorRobot("La captura no corresponde al proveedor esperado.")
        parametros = parse_qs(urlsplit(final).query)
        if nombre.startswith("cibernarium-ficha-"):
            ident = nombre.removeprefix("cibernarium-ficha-")
            if parametros.get("activityId") != [ident]:
                raise ErrorRobot("La ficha capturada no identifica la actividad solicitada.")
        if nombre.startswith("cibernarium-todas-"):
            desde = nombre.removeprefix("cibernarium-todas-")
            if parametros.get(f"_{PORTLET}_start") != [desde]:
                raise ErrorRobot("La URL capturada no corresponde a la página solicitada.")
        destino = self.salida / ruta
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(contenido)
        evidencia = {"url": final, "capturado_utc": capturado, "sha256": sha256(contenido), "archivo": str(ruta)}
        escribir_json(
            self.salida / "consultas" / f"{nombre}.json",
            {
                "url": url,
                "urlFinal": final,
                "consultadoUTC": capturado,
                "sha256": evidencia["sha256"],
                "captura": str(ruta),
                "estadoHttp": 200,
            },
        )
        return (contenido, evidencia)


def validar_pagina(pagina: ValorJson, desde: int, total_esperado: int | None = None) -> tuple[int, list[ObjetoJson]]:
    """Comprueba total, límites y actividades de una página pública.

    Returns:
        Total publicado y actividades comprobadas de la página.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if not isinstance(pagina, dict):
        raise ErrorRobot("La página no es un objeto JSON.")
    total = pagina.get("numActivities", pagina.get("total"))
    actividades = pagina.get("activities")
    if type(total) is not int or total < 0 or not isinstance(actividades, list):
        raise ErrorRobot("Faltan el total publicado o la lista activities.")
    if (
        type(pagina.get("start")) is not int
        or type(pagina.get("end")) is not int
        or pagina["start"] != desde
        or pagina["end"] not in {desde + PAGINA, min(desde + PAGINA, total)}
    ):
        raise ErrorRobot("Los límites publicados no corresponden a la página solicitada.")
    if total_esperado is not None and total != total_esperado:
        raise ErrorRobot("El total ha cambiado durante la paginación; no es una instantánea completa.")
    if "total" in pagina and pagina["total"] != total:
        raise ErrorRobot("Los dos totales publicados son contradictorios.")
    if len(actividades) != min(PAGINA, max(0, total - desde)):
        raise ErrorRobot("La cantidad de actividades de la página no coincide con sus límites.")
    if any(not isinstance(a, dict) for a in actividades):
        raise ErrorRobot("Una actividad no es un objeto.")
    return total, actividades


def recoger_catalogo(
    capturas: CapturasDeEjecucion,
) -> tuple[dict[str, ObjetoJson], dict[str, ObjetoJson], int | None, bool, list[str], list[ObjetoJson]]:
    """Recoge las páginas en orden y conserva cualquier fallo de cobertura.

    Returns:
        Actividades, evidencias, total, cobertura, errores y pruebas de las páginas.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    actividades = {}
    evidencias = {}
    errores = []
    total = None
    pruebas_paginas = []
    desde = 0
    while total is None or desde < total:
        try:
            contenido, evidencia = capturas.leer(f"cibernarium-todas-{desde}", url_pagina(desde))
            publicado, pagina = validar_pagina(json.loads(contenido), desde, total)
            total = publicado
            pruebas_paginas.append(evidencia)
            for actividad in pagina:
                ident = identificador(actividad.get("activityId"))
                if ident in actividades:
                    raise ErrorRobot(f"Actividad duplicada en la paginación: {ident}")
                actividades[ident] = actividad
                evidencias[ident] = evidencia
        except (OSError, ValueError, URLError) as error:
            errores.append(f"Página {desde}: {type(error).__name__}: {error}")
            break
        desde += PAGINA
    completa = not errores and total is not None and len(actividades) == total
    return actividades, evidencias, total, completa, errores, pruebas_paginas


def _normalizar_negocio(
    capturas: CapturasDeEjecucion,
    actividades: dict[str, ObjetoJson],
    evidencias: dict[str, ObjetoJson],
    errores: list[str],
    observado_api: str,
) -> tuple[ObjetoJson, list[tuple[ObjetoJson, str]]]:
    normas, evidencia_normas = capturas.leer("cibernarium-normas", ORIGEN + "/normes", opcional=True)
    cursos, evidencia_cursos = capturas.leer("cibernarium-cursos", ORIGEN + "/cursos", opcional=True)
    generales = normas_generales(normas)
    gratuitos = cursos is not None and "Cursos gratuïts de tecnologia" in texto_html(cursos)
    programas = []
    ediciones = {}
    for ident, actividad in actividades.items():
        try:
            titulo = actividad.get("title")
            if not isinstance(titulo, str) or not titulo.strip():
                raise ErrorRobot("Título ausente; no se inventa una ficha sin identidad pública.")
            contenido, evidencia_ficha = capturas.leer(f"cibernarium-ficha-{ident}", url_ficha(ident), opcional=True)
            hechos = hechos_ficha(contenido) if contenido is not None else None
            evidencias_programa = [
                e
                for e in [
                    evidencias[ident],
                    evidencia_ficha,
                    evidencia_normas,
                    evidencia_cursos,
                ]
                if e
            ]
            programa_id = f"cibernarium:{ident}"
            programas.append(
                {
                    "id": programa_id,
                    "proveedor_id": PROVEEDOR,
                    "titulo": titulo,
                    "url": url_ficha(ident),
                    "tipo_unidad": "actividad-formativa",
                    "datos": {
                        "activity_id": ident,
                        "categoria_publicada": actividad.get("category") or None,
                        "categoria_id_publicada": actividad.get("categoryId") or None,
                        "subcategoria_id_publicada": actividad.get("subCategoryId") or None,
                        "matricula_eur": 0 if gratuitos else None,
                        "certificado_coste_eur": None,
                        "normas_generales": generales,
                        "hechos_ficha_principal": hechos,
                        "nivel_faro": None,
                        "clasificacion_tematica": "pendiente",
                    },
                    "evidencias": evidencias_programa,
                    "etiquetas": [],
                }
            )
            entradas = actividad.get("listEditions")
            if not isinstance(entradas, list) or any(not isinstance(e, dict) for e in entradas):
                raise ErrorRobot("Falta la lista explícita listEditions.")
            for entrada in entradas:
                edicion = normalizar_edicion(programa_id, actividad, entrada, hechos)
                edicion["datos"]["coste_formacion_tipo"] = "gratis_formacion" if gratuitos else None
                edicion["datos"]["acceso_territorial"] = (
                    "sin-restriccion-residencia-en-norma-general"
                    if generales["residencia_exigida_en_norma_general"] is False
                    else None
                )
                edicion["evidencias"] = [e for e in [evidencias[ident], evidencia_normas, evidencia_cursos] if e]
                if hechos is not None:
                    edicion["evidencias"].append(evidencia_ficha)
                anterior = ediciones.get(edicion["id"])
                if anterior is not None and anterior != edicion:
                    raise ErrorRobot(f"Edición duplicada con datos o programa contradictorios: {edicion['id']}")
                ediciones[edicion["id"]] = edicion
        except (OSError, ValueError, URLError) as error:
            errores.append(f"Actividad {ident}: {type(error).__name__}: {error}")
    fecha_utc(observado_api)
    return {
        "schema_version": 1,
        "observado_utc": observado_api,
        "fuente_lote": "robot-cibernarium-v1:" + AMBITO,
        "proveedores": [FICHA_PROVEEDOR],
        "programas": programas,
        "ediciones": list(ediciones.values()),
    }, [
        (e, rol)
        for e, rol in (
            (evidencia_normas, "normas-acceso"),
            (evidencia_cursos, "declaracion-coste"),
        )
        if e
    ]


def preparar_importacion(
    capturas: CapturasDeEjecucion,
    actividades: dict[str, ObjetoJson],
    evidencias: dict[str, ObjetoJson],
    errores: list[str],
    paginas: list[ObjetoJson],
) -> ObjetoJson:
    """Lotes exactos por actividad, auxiliares independientes y vector de censo.

    Returns:
        Lotes y canales de entidad y censo con sus evidencias independientes.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    if not paginas:
        raise ErrorRobot("Censo sin pruebas de captura")
    vista, auxiliares = _normalizar_negocio(capturas, actividades, evidencias, errores, paginas[0]["capturado_utc"])
    lotes, canales = [], []
    # Identidad estática, sin afirmar observación renovada del proveedor.
    lotes.append({**vista, "programas": [], "ediciones": []})
    canales.append([])
    por_programa = {p["id"]: p for p in vista["programas"]}
    for grupo, entidad in (("programas", "programa"), ("ediciones", "edicion")):
        for objeto in vista[grupo]:
            programa = objeto if entidad == "programa" else por_programa[objeto["programa_id"]]
            ident = programa["datos"]["activity_id"]
            principal = evidencias[ident]
            lote = {
                "schema_version": 1,
                "observado_utc": principal["capturado_utc"],
                "fuente_lote": vista["fuente_lote"],
                "proveedores": [],
                "programas": [],
                "ediciones": [],
            }
            lote[grupo] = [objeto]
            items = []
            for e in objeto["evidencias"]:
                if e == principal:
                    rol = "actividad-api"
                elif any(e == prueba for prueba, _ in auxiliares):
                    rol = next(rol for prueba, rol in auxiliares if e == prueba)
                elif parse_qs(urlsplit(e["url"]).query).get("activityId") == [ident]:
                    rol = "ficha-html"
                else:
                    raise ErrorRobot("Fuente sin rol temporal revisado: " + e["url"])
                items.append(
                    {
                        "entidad": entidad,
                        "id": objeto["id"],
                        "canal": rol,
                        "evidencias": [e],
                    }
                )
            lotes.append(lote)
            canales.append(items)
    return {
        "lotes": lotes,
        "canales_temporales": canales,
        "canales_censo": [
            {
                "entidad": "catalogo",
                "id": json.dumps([PROVEEDOR, AMBITO], separators=(",", ":")),
                "canal": "enumeracion-api",
                "evidencias": paginas,
            }
        ],
    }


def _ejecutar(
    base: str | Path,
    salida: str | Path,
    desde_capturas: str | Path | None = None,
    descargador: DescargadorSerial | None = None,
    importar_ciclo: ImportadorCiclo | None = None,
) -> tuple[Path, ObjetoJson]:
    """Una sola ejecución serial. No muta la base si descarga, parseo o integridad presentan errores.

    Returns:
        Carpeta de instantánea e informe de carga y conciliación.
    """
    if importar_ciclo is None:
        from plataforma_datos.cursos.catalogo import importar_y_conciliar

        importar_ciclo = importar_y_conciliar
    instante = datetime.now(UTC)
    carpeta = Path(salida) / instante.strftime("%Y%m%dT%H%M%S.%fZ")
    carpeta.mkdir(parents=True, exist_ok=False)
    if descargador is None and desde_capturas is None:
        descargador = DescargadorSerial()
    capturas = CapturasDeEjecucion(carpeta, desde_capturas, descargador)
    actividades, evidencias, total, completa, errores, paginas = recoger_catalogo(capturas)
    preparado = None
    marcas = {e["capturado_utc"] for e in paginas}
    observado_api = next(iter(marcas)) if len(marcas) == 1 else None
    if completa:
        try:
            preparado = preparar_importacion(capturas, actividades, evidencias, errores, paginas)
        except (OSError, ValueError, URLError) as error:
            errores.append(f"Normalización: {type(error).__name__}: {error}")
    informe = {
        "ejecutado_utc": instante.isoformat(),
        "modo": "capturas" if desde_capturas is not None else "consulta-nueva",
        "observado_api_utc": observado_api,
        "capturas_censo": paginas,
        "publicacion_completa": False,
        "total_publicado": total,
        "programas_unicos": len(actividades),
        "paginacion_completa": completa,
        "errores": errores,
        "cargado": False,
        "conciliado": False,
    }
    if preparado is not None:
        escribir_json(carpeta / "importacion.json", preparado)
    if (
        completa
        and not errores
        and preparado is not None
        and sum(len(lote["programas"]) for lote in preparado["lotes"]) == total
    ):
        try:
            resultado = importar_ciclo(
                base,
                preparado["lotes"],
                InstantaneaCatalogo(
                    proveedor_id=PROVEEDOR,
                    ambito=AMBITO,
                    ids_programas=[p["id"] for lote in preparado["lotes"] for p in lote["programas"]],
                    total_publicado=total,
                    completa=True,
                    errores=[],
                    observado_utc=paginas[0]["capturado_utc"],
                ),
                opciones=OpcionesCiclo(
                    canales_temporales=preparado["canales_temporales"],
                    canales_censo=preparado["canales_censo"],
                    comprobar_capturas=True,
                    raiz_evidencias=carpeta,
                ),
            )
            informe["carga"] = resultado["importacion"]
            informe["conciliacion"] = resultado["conciliacion"]
            informe["cargado"] = True
            informe["conciliado"] = True
            informe["publicacion_completa"] = True
        except (OSError, ValueError) as error:
            errores.append(f"Base de datos: {type(error).__name__}: {error}")
            if hasattr(error, "detalle"):
                informe["rechazo_temporal"] = error.detalle
    escribir_json(carpeta / "informe.json", informe)
    return carpeta, informe


@contextmanager
def bloqueo_ejecucion(base: str | Path) -> Iterator[None]:
    """Reserva la ejecución exclusiva del robot para esta base.

    Yields:
        Permiso de ejecución mientras se mantiene el bloqueo local.

    Raises:
        ErrorRobot: Si los datos o la operación local no cumplen el contrato declarado.
    """
    ruta = Path(str(base) + ".cibernarium.lock")
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("a", encoding="utf-8") as archivo:
        try:
            fcntl.flock(archivo.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ErrorRobot("Ya hay un robot Cibernàrium trabajando con esta base.") from error
        try:
            yield
        finally:
            fcntl.flock(archivo.fileno(), fcntl.LOCK_UN)


def ejecutar(
    base: str | Path,
    salida: str | Path,
    desde_capturas: str | Path | None = None,
    descargador: DescargadorSerial | None = None,
    importar_ciclo: ImportadorCiclo | None = None,
) -> tuple[Path, ObjetoJson]:
    """Excluye ejecuciones simultáneas de este robot para la misma base.

    Returns:
        Carpeta de instantánea e informe de carga y conciliación.
    """
    with bloqueo_ejecucion(base):
        return _ejecutar(base, salida, desde_capturas, descargador, importar_ciclo)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de conversión o importación local.

    Returns:
        Cero si la operación concluye; dos si falla la conversión o conciliación.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    modo = parser.add_mutually_exclusive_group(required=True)
    modo.add_argument(
        "--desde-capturas",
        type=Path,
        help="Raíz con consultas/ y capturas/ existentes; nunca usa red.",
    )
    modo.add_argument(
        "--consultar",
        action="store_true",
        help="Consulta serial con la identidad de navegador de config/identidad-web.json.",
    )
    parser.add_argument(
        "--salida",
        required=True,
        type=Path,
        help="Raíz de instantáneas distintas por ejecución UTC.",
    )
    parser.add_argument(
        "--base",
        required=True,
        type=Path,
        help="Base SQLite de investigación, fuera de la aplicación.",
    )
    argumentos = parser.parse_args(argv)
    carpeta, informe = ejecutar(argumentos.base, argumentos.salida, argumentos.desde_capturas)
    print(json.dumps({"instantanea": str(carpeta), **informe}, ensure_ascii=False, indent=2))
    return 0 if informe["conciliado"] else 2


if __name__ == "__main__":
    sys.exit(main())
