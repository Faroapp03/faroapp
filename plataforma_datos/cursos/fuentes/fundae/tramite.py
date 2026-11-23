"""Comprueba en estático el formulario de preinscripción que el sitio público asocia a cada difusión."""

import hashlib
import re
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from urllib.parse import quote

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

ORIGEN = "https://experienciafundae.es/"
DOCUMENTO = "tramite.json"


class TramiteDistinto(ValueError):
    """El contenido completo recibido del proveedor ya no acredita el recorrido conocido."""


def ficha(codigo: str) -> str:
    """Dirección de la especialidad. La solicitud se abre eligiendo la fila de la entidad.

    Returns:
        URL pública de la especialidad en teleformación.
    """
    exigir(isinstance(codigo, str) and re.fullmatch(r"[A-Z0-9_-]{1,40}", codigo), "Especialidad no identificada")
    return ORIGEN + "ficha-curso/oferta/2/" + quote(codigo, safe="")


def _enlace(cuerpo: bytes, patron: bytes) -> str:
    coincidencias = re.findall(patron, cuerpo)
    if len(coincidencias) != 1:
        raise TramiteDistinto("El sitio no identifica un único componente del trámite")
    return ORIGEN + coincidencias[0].decode("ascii")


def principal(html: bytes) -> str:
    """Lee solo la entrada JavaScript de la propia página.

    Returns:
        URL del módulo principal alojado por el propio sitio.
    """
    return _enlace(html, rb'<script\b[^>]{0,150}?src="(main-[A-Za-z0-9_-]+\.js)"')


def componente(main: bytes) -> str:
    """Resuelve la dependencia declarada únicamente para fichaCurso.

    Returns:
        URL del componente declarado para las fichas.
    """
    return _enlace(
        main,
        rb'path:\w+\.fichaCurso,loadChildren:\(\)=>import\("\./(chunk-[A-Za-z0-9_-]+\.js)"\)\.then\(\w+=>\w+\.FichasModule\)',
    )


def metodo(codigo: bytes) -> bool:
    """Contrasta ruta, vista de oferta, clic por fila, selección autenticada y envío por difusión.

    Returns:
        Si la ficha y el formulario conservan el vínculo entre clic, centro y difusión.
    """
    ruta = re.search(rb"path:`\x24\{\w+\.oferta\}/:idModalidad/:id`,component:(\w+),", codigo)
    if ruta is None:
        return False
    definicion = re.search(
        rb"(?:var |,)" + re.escape(ruta[1]) + rb"=\(\(\)=>\{.{1,30000}?return \w+\}\)\(\)", codigo, re.DOTALL
    )
    if definicion is None:
        return False
    vista = definicion[0]
    return (
        b".RecuperarDifusionesRFO({idModalidad:this._modalidadId,codigoTitulacion:this._cursoId" in vista
        and b"this.listaDifusiones=e.centrosRFO.map(" in vista
        and b"subscribeToCourse(e){if(!this._authService.getUserId())" in vista
        and b"this.idDifusionAccionFormativa=e.idDifusionAccionFormativa,this.centerSelected=e," in vista
        and b"open(j.ofertaItinerarioFormModal)" in vista
        and b'("click",function(){let n=O(e).$implicit,p=m(2);return b(p.subscribeToCourse(n))})' in codigo
        and b'"records.offer.inscription"' in codigo
        and b".getColectivosDeDifusion({idDifusionAccionFormativa:this.idDifusionAccionFormativa})" in codigo
        and b".solicitudInscripcion({centro:this.center.centro,centroFormador:this.center.entidadFormadora" in codigo
        and (
            b"idCentro:this.center.idCentro,idColectivo:Number(e.collective.id),"
            b"idDifusionAccionFormativa:this.idDifusionAccionFormativa"
        )
        in codigo
    )


def cuerpo(carpeta: Path, cap: dict, url: str) -> tuple[bytes, dict]:
    """Comprueba recibo, identidad, causalidad y cuerpo sin ejecutar el código del proveedor.

    Returns:
        Bytes íntegros del recurso y sus metadatos.
    """
    meta = comun.leer_recibo(carpeta, cap)
    exigir(
        meta["url"] == meta["url_final"] == url and meta["http"] == HTTPStatus.OK and meta["completo"] is True,
        "Trámite sin respuesta propia",
    )
    exigir(
        vigencia.instante_utc(meta["inicio_utc"], "inicio") <= vigencia.instante_utc(meta["fin_utc"], "fin"),
        "Recibo de trámite no causal",
    )
    dato = comun.leer_conservado(carpeta, cap["cuerpo"])
    exigir(
        len(dato) == meta["bytes"] and hashlib.sha256(dato).hexdigest() == meta["cuerpo_sha256"],
        "Trámite de otro recibo",
    )
    return dato, meta


def comprobar(carpeta: Path, doc: dict) -> tuple[dict, str]:
    """Reproduce la cadena completa del sitio enlazando los cuerpos en el orden publicado.

    Returns:
        Último recibo y SHA-256 del componente comprobado.

    Raises:
        TramiteDistinto: Si el componente recibido ya no acredita la solicitud.
    """
    html, primero = cuerpo(carpeta, doc["pagina"], ficha(doc["especialidad"]))
    main, siguiente = cuerpo(carpeta, doc["principal"], principal(html))
    modulo, ultimo = cuerpo(carpeta, doc["componente"], componente(main))
    if not metodo(modulo):
        raise TramiteDistinto("El componente no acredita el trámite de la difusión")
    fechas = [vigencia.instante_utc(m["fin_utc"], "fin del trámite") for m in (primero, siguiente, ultimo)]
    exigir(fechas == sorted(fechas), "Recibos desordenados del trámite")
    return ultimo, doc["componente"]["cuerpo"]["sha256"]


def descargar(carpeta: Path, especialidad: str, *, recibir: Callable[[str, Path], dict] | None = None) -> None:
    """Refresca la prueba del trámite. Un intento fallido conserva la última cadena acreditada."""
    carpeta.mkdir(parents=True, exist_ok=True)
    doc = {"especialidad": especialidad}
    try:
        url = ficha(especialidad)
        for clave, resolver in (("pagina", principal), ("principal", componente), ("componente", None)):
            cap = (
                recibir(url, carpeta)
                if recibir
                else comun.recibir_url(
                    url, carpeta, None, perfil="pagina" if clave == "pagina" else "datos", seguir_redirecciones=False
                )
            )
            doc[clave] = cap
            contenido, _ = cuerpo(carpeta, cap, url)
            if resolver is not None:
                url = resolver(contenido)
        comprobar(carpeta, doc)
    except TramiteDistinto:
        guardar_json(carpeta / "ultimo-intento.json", {"estado": "tramite-cambiado", "capturas": doc})
        return
    except (ErrorFuente, ValueError, OSError, KeyError) as error:
        guardar_json(
            carpeta / "ultimo-intento.json", {"estado": "pendiente", "tipo": type(error).__name__, "capturas": doc}
        )
        return
    guardar_json(carpeta / DOCUMENTO, doc)
    guardar_json(carpeta / "ultimo-intento.json", {"estado": "acreditado", "capturas": doc})


def leer(carpeta: Path) -> tuple[dict, dict, str] | None:
    """Lee únicamente capturas acreditadas. Un cambio del contrato web requiere renovar la comprobación.

    Returns:
        Documento verificado, último recibo y huella, o None si no hubo captura válida.
    """
    if not (carpeta / DOCUMENTO).is_file():
        return None
    doc = leer_json(carpeta / DOCUMENTO)
    meta, sha = comprobar(carpeta, doc)
    return doc, meta, sha


def contraste_actual(carpeta: Path, corte: str) -> tuple[str, dict]:
    """Reproduce intentos que, antes del corte, muestran una interfaz distinta o un fallo técnico.

    Returns:
        Estado del recorrido web y referencias de los recursos comprobados.
    """
    ruta = carpeta / "ultimo-intento.json"
    if not ruta.is_file():
        return "sin-intento", {}
    intento = leer_json(ruta)
    doc = intento["capturas"]
    recibos = {k: doc[k] for k in ("pagina", "principal", "componente") if k in doc}
    if not recibos:
        return "pendiente", {}
    meta = comun.leer_recibo(carpeta, list(recibos.values())[-1])
    if vigencia.instante_utc(meta["fin_utc"], "intento") > vigencia.instante_utc(corte, "corte"):
        return "sin-intento", {}
    if intento["estado"] != "tramite-cambiado":
        return intento["estado"], recibos
    cambiado = _cambio_reproducible(carpeta, doc, recibos)
    return ("tramite-cambiado" if cambiado else "pendiente"), recibos


def _cambio_reproducible(carpeta: Path, doc: dict, recibos: dict) -> bool:
    url = ficha(doc["especialidad"])
    for clave, resolver in (("pagina", principal), ("principal", componente), ("componente", None)):
        if clave not in recibos:
            break
        dato, _ = cuerpo(carpeta, recibos[clave], url)
        try:
            if resolver:
                url = resolver(dato)
            elif not metodo(dato):
                return True
        except TramiteDistinto:
            return True
    return False
