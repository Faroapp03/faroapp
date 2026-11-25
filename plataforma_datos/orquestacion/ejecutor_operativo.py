"""Ejecuta o reenvía un trabajo privado sin repetir el motor tras un comienzo incierto.

El bootstrap prepara las dependencias del mismo checkout autorizado antes de adquirir secretos. El candidato
se ejecuta en otro proceso con entorno filtrado; solo el supervisor conserva las capacidades HTTP/almacén.
La conservación de contenido, índice y referencia CAS precede siempre a la llamada de retorno. No activa datos.
"""

import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from plataforma_datos.comun import instante_del_ciclo
from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import movimientos_de_cursos, recuperar_ediciones, ultimo_fallo
from plataforma_datos.orquestacion.actualizar import entorno_de_las_ordenes
from plataforma_datos.orquestacion.almacen_artefactos import guardar_artefacto
from plataforma_datos.orquestacion.almacen_generaciones import guardar_generacion, recuperar_generacion
from plataforma_datos.orquestacion.almacen_trabajos import (
    ACCIONES,
    MAX_ENTERO,
    MAX_RECIBO_BYTES,
    RUN,
    UUID,
    VERSION_RECIBO_CATALOGO,
    VERSION_RECIBO_CONSERVADOS,
    AlmacenTrabajos,
    conservar_trabajo,
    leer_referencia,
    recuperar_trabajo,
)
from plataforma_datos.orquestacion.aprovisionar_candidato import aprovisionar_candidato
from plataforma_datos.orquestacion.bloqueo_al_empezar import levantar_al_empezar
from plataforma_datos.orquestacion.causas_del_ciclo import registrar_generacion_no_conservada, registrar_paquete
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub
from plataforma_datos.orquestacion.fin_del_motor import MotorSinRecibo, exigir_recibo
from plataforma_datos.orquestacion.generacion_operativa import REVISION, exportar_generacion
from plataforma_datos.orquestacion.generacion_operativa import SHA256 as HUELLA
from plataforma_datos.orquestacion.hora_limite_del_motor import VARIABLE as HORA_LIMITE
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPLETAR_RENOMBRES, SI
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.procesos import ejecutar_con_plazo

# Las fuentes del último ciclo real completo y el paquete medido llevado al runner lento (medidas_del_ciclo), más su
# margen y redondeado hacia arriba a cinco minutos: (6.898 + 5.486) × 1,2 = 14.861 s, 250 minutos; lo exige
# pruebas/test_plazo_del_motor.py. actualizar.yml concede al supervisor al menos 280 minutos (tope de 323,
# preparación en frío y navegadores) para que quepan también la descarga y la restauración de la base antes del motor
# y, después, la lectura de la generación, la exportación y la conservación del artefacto y el recibo;
# pruebas/herramientas/workflow-presupuesto.test.ts mantiene las cifras de acuerdo.
PLAZO_CANDIDATO_S = 250 * 60
PLAZO_VALIDACION_S = 30
PLAZO_ARTEFACTO_S = 300
MAX_RESUMEN_ARTEFACTO_BYTES = 4096
ERROR = "No se ha completado la ejecución de mantenimiento."
CAMPOS_RECIBO = {"version", "accion", "resultado", "veredicto", "terminadoEn", "estado", "huellaPaquete", "error"}
VALIDADOR = "herramientas/mantenimiento/comprobar-recibo.ts"
EXPORTADOR = "herramientas/web/construir.ts"
# Cada variante lleva su propio Worker principal: solo la oficial atiende el disparador horario (scheduled).
VARIANTES_CLOUDFLARE = ("privado", "oficial")


class ErrorEjecucionOperativa(ValueError):
    """Fallo cerrado: no autoriza repetir el motor ni afirma activación o conservación."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ErrorEjecucionOperativa(ERROR)


@dataclass(frozen=True, kw_only=True)
class ConfiguracionEjecutorOperativo:
    """Expectativas privadas del workflow; ninguna contiene credenciales u órdenes recibidas por HTTP.

    `variante_cloudflare` es la de la instalación: el artefacto se exporta con ella y la activación exige que coincida.
    No tiene valor por omisión, porque exportar otra variante sustituiría el Worker de la instalación por otro.
    """

    checkout: Path
    directorio_trabajo: Path
    revision_codigo: str
    solicitud_id: str
    revision_reserva: int
    run_id: str
    run_attempt: str
    accion: str
    variante_cloudflare: str
    recuperacion_activacion: bool = False
    revisar_paquete_pendiente: bool = False
    en_paralelo: bool = False  # descargar las fuentes en paralelo (variable FARO_FUENTES_EN_PARALELO); si no, en serie
    fuentes_en_serie: tuple[str, ...] = ()  # con en_paralelo, las que se quedan en serie (FARO_FUENTES_EN_SERIE)

    def __post_init__(self) -> None:
        _exigir(isinstance(self.checkout, Path) and isinstance(self.directorio_trabajo, Path))
        _exigir(isinstance(self.revision_codigo, str) and REVISION.fullmatch(self.revision_codigo) is not None)
        _exigir(isinstance(self.solicitud_id, str) and UUID.fullmatch(self.solicitud_id) is not None)
        _exigir(type(self.revision_reserva) is int and 0 < self.revision_reserva <= MAX_ENTERO)
        _exigir(isinstance(self.run_id, str) and RUN.fullmatch(self.run_id) is not None)
        _exigir(type(self.recuperacion_activacion) is bool)
        _exigir(type(self.revisar_paquete_pendiente) is bool and type(self.en_paralelo) is bool)
        _exigir(type(self.fuentes_en_serie) is tuple and all(fuente in FUENTES for fuente in self.fuentes_en_serie))
        _exigir(self.en_paralelo or not self.fuentes_en_serie)  # la lista solo acompaña al paralelo
        _exigir(
            not self.revisar_paquete_pendiente
            or (self.accion == "comprobar-programada" and not self.recuperacion_activacion)
        )
        _exigir(isinstance(self.variante_cloudflare, str) and self.variante_cloudflare in VARIANTES_CLOUDFLARE)
        _exigir(isinstance(self.run_attempt, str) and RUN.fullmatch(self.run_attempt) is not None)
        intento = int(self.run_attempt)
        _exigir(int(self.run_id) <= MAX_ENTERO and intento <= MAX_ENTERO and self.accion in ACCIONES)
        _exigir(intento > 1 if self.recuperacion_activacion else intento == 1)


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _json(contenido: bytes) -> dict[str, Any]:
    def constante(_valor: str) -> None:
        raise ErrorEjecucionOperativa(ERROR)

    _exigir(type(contenido) is bytes and 0 < len(contenido) <= MAX_RECIBO_BYTES)
    valor = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=constante)
    _exigir(type(valor) is dict)
    return valor


def _leer_archivo(ruta: Path) -> bytes:
    descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as archivo:
        estado = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and estado.st_size <= MAX_RECIBO_BYTES)
        contenido = archivo.read(MAX_RECIBO_BYTES + 1)
    _exigir(0 < len(contenido) <= MAX_RECIBO_BYTES)
    return contenido


def _escribir_exclusivo(ruta: Path, contenido: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=ruta.parent, prefix=".recibo-", delete=False) as archivo:
        temporal = Path(archivo.name)
        try:
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
            os.link(temporal, ruta, follow_symlinks=False)
        finally:
            temporal.unlink()


# Las variables con que el ensayo fija su reloj (FARO_HOY y FARO_INSTANTE): nunca llegan a un ciclo de producción.
RELOJ_DEL_ENSAYO = ("FARO_HOY", instante_del_ciclo.VARIABLE)


def _entorno(directorio: Path) -> dict[str, str]:
    hogar, temporal = directorio / "hogar", directorio / "temporales"
    hogar.mkdir()
    temporal.mkdir()
    entorno = entorno_de_las_ordenes(os.environ)
    # El reloj fijo es del ensayo con datos grabados: un ciclo de producción usa siempre la fecha y la hora reales.
    for variable in RELOJ_DEL_ENSAYO:
        entorno.pop(variable, None)
    entorno["HOME"] = str(hogar)
    entorno["TMPDIR"] = str(temporal)
    entorno.setdefault("PATH", os.defpath)
    return entorno


def _validar_recibo(raiz_codigo: Path, ruta: Path, entorno: dict[str, str]) -> None:
    nodo = shutil.which("node", path=entorno["PATH"])
    _exigir(nodo is not None and (raiz_codigo / VALIDADOR).is_file())
    resultado = _proceso([nodo, str(raiz_codigo / VALIDADOR), str(ruta)], raiz_codigo, PLAZO_VALIDACION_S, entorno)
    _exigir(resultado.returncode == 0)


def _proceso(orden: list[str], raiz: Path, plazo: int, entorno: dict[str, str]) -> subprocess.CompletedProcess[str]:
    try:
        return ejecutar_con_plazo(orden, raiz, plazo, entorno)
    except (OSError, subprocess.SubprocessError) as error:
        # La causa queda encadenada para que el diario nombre el fallo (un plazo agotado, por ejemplo); su texto, que
        # lleva la orden y sus rutas, no sale: el diario lo sanea y `main` solo imprime el mensaje genérico.
        raise ErrorEjecucionOperativa(ERROR) from error


def _directorio_job(configuracion: ConfiguracionEjecutorOperativo) -> Path:
    for ruta in (configuracion.checkout, configuracion.directorio_trabajo):
        _exigir(stat.S_ISDIR(ruta.lstat().st_mode))
    checkout = configuracion.checkout.resolve()
    raiz = configuracion.directorio_trabajo.resolve()
    _exigir(not raiz.is_relative_to(checkout) and not checkout.is_relative_to(raiz))
    destino = raiz / f"run-{configuracion.run_id}-1"
    destino.mkdir()
    return destino


def _dependencias(checkout: Path, candidato: Path) -> None:
    for nombre in (".venv", "node_modules"):
        dependencias = checkout / nombre
        _exigir(stat.S_ISDIR(dependencias.lstat().st_mode))
        (candidato / nombre).symlink_to(dependencias.resolve(), target_is_directory=True)
    _exigir((candidato / ".venv/bin/python").is_file())


def _candidato(configuracion: ConfiguracionEjecutorOperativo, directorio: Path, entorno: dict[str, str]) -> bytes:
    raiz = directorio / "candidato"
    _dependencias(configuracion.checkout, raiz)
    recibo = directorio / "recibo-candidato.json"
    with (directorio / "motor-iniciado").open("xb") as marcador:
        marcador.write(b"1\n")
        marcador.flush()
        os.fsync(marcador.fileno())
    resultado = _proceso(
        [
            str(raiz / ".venv/bin/python"),
            "-m",
            "plataforma_datos.orquestacion.candidato",
            configuracion.accion,
            str(raiz),
            *(["--revisar-paquete-pendiente"] if configuracion.revisar_paquete_pendiente else []),
            *(["--en-paralelo"] if configuracion.en_paralelo else []),
            *(opcion for fuente in configuracion.fuentes_en_serie for opcion in ("--fuente-en-serie", fuente)),
            "--recibo",
            str(recibo),
        ],
        raiz,
        PLAZO_CANDIDATO_S,
        # La hora a la que se cortará el motor, para que no empiece lo que ya no cabe (`hora_limite_del_motor`).
        # Y que es el ciclo operativo: su exportación completa los renombres del paquete (ordenes_del_paquete).
        {**entorno, HORA_LIMITE: str(int(time.time()) + PLAZO_CANDIDATO_S), COMPLETAR_RENOMBRES: SI},
    )
    exigir_recibo(resultado.returncode, recibo.exists() or recibo.is_symlink(), ERROR)
    contenido = _json(_leer_archivo(recibo))
    _exigir(
        set(contenido)
        == CAMPOS_RECIBO
        | ({"catalogo"} if contenido.get("version") in (VERSION_RECIBO_CATALOGO, VERSION_RECIBO_CONSERVADOS) else set())
        | ({"conservados"} if contenido.get("version") == VERSION_RECIBO_CONSERVADOS else set())
        and contenido["accion"] == configuracion.accion
    )
    _exigir(resultado.returncode == (1 if contenido["resultado"] == "rechazado" else 0))
    contenido.update(solicitudId=configuracion.solicitud_id, revisionReserva=configuracion.revision_reserva)
    enriquecido = json.dumps(contenido, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    ruta = directorio / "recibo-callback.json"
    _escribir_exclusivo(ruta, enriquecido)
    _validar_recibo(raiz, ruta, entorno)
    return enriquecido


def _conservar_generacion(
    configuracion: ConfiguracionEjecutorOperativo,
    directorio: Path,
    recibo: bytes,
    referencia: dict[str, Any],
    almacen: AlmacenTrabajos,
) -> dict | None:
    resultado = _json(recibo)["resultado"]
    if resultado == "sin-pendientes":
        return referencia["baseOperativa"]
    generacion = directorio / "generacion-intento"
    try:
        resumen = exportar_generacion(directorio / "candidato", generacion, configuracion.revision_codigo)
    except (ErrorFuente, OSError, ValueError) as error:
        _exigir(resultado == "rechazado")
        # El rechazo deja la base operativa como estaba; el diario dice qué comprobación impidió conservar el intento.
        registrar_generacion_no_conservada(error)
        return None
    # Un fallo de transporte no se degrada a ausencia: no confirma referencia ni habilita la llamada de retorno.
    guardar_generacion(generacion, configuracion.revision_codigo, resumen["sha256Manifiesto"], almacen)
    return {"revisionCodigo": configuracion.revision_codigo, "sha256Manifiesto": resumen["sha256Manifiesto"]}


def _resumen(configuracion: ConfiguracionEjecutorOperativo, recibo: bytes, confirmacion: str) -> dict[str, Any]:
    _exigir(confirmacion in ("aplicado", "repetido"))
    return {
        "version": 1,
        "estado": confirmacion,
        "solicitudId": configuracion.solicitud_id,
        "revisionReserva": configuracion.revision_reserva,
        "runId": configuracion.run_id,
        "resultado": _json(recibo)["resultado"],
    }


def _conservar_artefacto(
    configuracion: ConfiguracionEjecutorOperativo,
    directorio: Path,
    recibo: bytes,
    entorno: dict[str, str],
    almacen: AlmacenTrabajos,
) -> dict | None:
    contenido = _json(recibo)
    if contenido["resultado"] != "validado":
        return None
    raiz = directorio / "candidato"
    nodo = shutil.which("node", path=entorno["PATH"])
    _exigir(nodo is not None and (raiz / EXPORTADOR).is_file())
    destino = directorio / "artefacto"
    resultado = _proceso(
        [
            nodo,
            str(raiz / EXPORTADOR),
            "--destino",
            str(destino),
            "--revision-codigo",
            configuracion.revision_codigo,
            "--huella-paquete",
            contenido["huellaPaquete"],
            "--solo-nuevo",
            "--destino-cloudflare",
            configuracion.variante_cloudflare,
        ],
        raiz,
        PLAZO_ARTEFACTO_S,
        entorno,
    )
    salida = resultado.stdout.encode("utf-8")
    _exigir(resultado.returncode == 0 and 0 < len(salida) <= MAX_RESUMEN_ARTEFACTO_BYTES)
    resumen = _json(salida)
    _exigir(
        set(resumen) == {"version", "revisionCodigo", "huellaPaquete", "sha256Artefacto", "archivos", "bytesTotales"}
        and type(resumen["version"]) is int
        and resumen["version"] == 1
        and resumen["revisionCodigo"] == configuracion.revision_codigo
        and resumen["huellaPaquete"] == contenido["huellaPaquete"]
        and isinstance(resumen["sha256Artefacto"], str)
        and HUELLA.fullmatch(resumen["sha256Artefacto"]) is not None
        and type(resumen["archivos"]) is int
        and type(resumen["bytesTotales"]) is int
    )
    confirmado = guardar_artefacto(
        destino, configuracion.revision_codigo, contenido["huellaPaquete"], resumen["sha256Artefacto"], almacen
    )
    _exigir(confirmado == resumen)
    return {clave: resumen[clave] for clave in ("revisionCodigo", "huellaPaquete", "sha256Artefacto")}


def _reanudar(
    configuracion: ConfiguracionEjecutorOperativo,
    existente: tuple[dict, bytes],
    cliente: ClienteMantenimientoGitHub,
    almacen: AlmacenTrabajos,
) -> dict[str, Any]:
    descriptor, recibo = existente
    _exigir(
        descriptor["revisionCodigo"] == configuracion.revision_codigo and descriptor["accion"] == configuracion.accion
    )
    with tempfile.TemporaryDirectory(prefix=".reanudar-", dir=configuracion.directorio_trabajo) as nombre:
        directorio = Path(nombre)
        entorno = _entorno(directorio)
        ruta = directorio / "recibo.json"
        _escribir_exclusivo(ruta, recibo)
        _validar_recibo(RAIZ, ruta, entorno)
    conservar_trabajo(
        recibo,
        configuracion.run_id,
        configuracion.revision_codigo,
        leer_referencia(almacen),
        descriptor["generacion"],
        artefacto=descriptor.get("artefacto"),
        almacen=almacen,
    )
    resumen = _resumen(configuracion, recibo, cliente.enviar_resultado(recibo))
    trabajo = configuracion.directorio_trabajo / f"run-{configuracion.run_id}-1"
    ultimo_fallo.cerrar_rechazo(cliente, configuracion, trabajo, resumen["resultado"])
    return resumen


def ejecutar_trabajo(
    configuracion: ConfiguracionEjecutorOperativo,
    cliente: ClienteMantenimientoGitHub,
    almacen: AlmacenTrabajos,
    *,
    reanudar: bool = False,
    apoyo_fundae: Path | None = None,
) -> dict[str, Any]:
    """Conecta permiso, candidato, conservación confirmada y llamada de retorno; un índice evita repetir el motor.

    Returns:
        Resumen cerrado tras la llamada de retorno confirmada; no afirma activación.
    """
    _exigir(not configuracion.recuperacion_activacion)
    referencia = diario.leer_con_reintento("referencia", lambda: leer_referencia(almacen))
    existente = diario.leer_con_reintento(
        "buscar-recibo",
        lambda: recuperar_trabajo(
            configuracion.solicitud_id, configuracion.revision_reserva, configuracion.run_id, almacen
        ),
    )
    if existente is not None:
        with diario.paso("reanudar-recibo"):
            return _reanudar(configuracion, existente, cliente, almacen)
    referencia = referencia if reanudar else levantar_al_empezar(referencia, almacen)
    with diario.paso("permiso-inicio"):
        _exigir(not reanudar and not referencia["bloqueoOperativo"])
        directorio = _directorio_job(configuracion)
        confirmacion = cliente.confirmar_inicio(
            configuracion.solicitud_id, configuracion.revision_reserva, configuracion.accion
        )
        _exigir(confirmacion == "aplicado")
    base = referencia["baseOperativa"]
    diario.anotar(
        "base", "seleccionada", revisionBase=base["revisionCodigo"], sha256Manifiesto=base["sha256Manifiesto"]
    )
    diario.leer_con_reintento(
        "descargar-base",
        lambda: recuperar_generacion(
            directorio / "generacion-base", base["revisionCodigo"], base["sha256Manifiesto"], almacen
        ),
    )
    with diario.paso("restaurar-base"):
        aprovisionar_candidato(
            configuracion.checkout,
            directorio / "candidato",
            configuracion.revision_codigo,
            directorio / "generacion-base",
            base["revisionCodigo"],
            base["sha256Manifiesto"],
            buscar_apoyo=lambda raiz, destino: recuperar_ediciones.descargar(raiz, destino, almacen),
            apoyo=apoyo_fundae,
        )
    with diario.paso("motor"):
        entorno = _entorno(directorio)
        antes = movimientos_de_cursos.anterior(almacen, referencia, configuracion.checkout, entorno)
        recibo = _motor(configuracion, directorio, entorno, cliente)
        contenido = _json(recibo)
        registrar_paquete(directorio / "candidato", contenido["resultado"])
        despues = (
            antes
            if contenido["resultado"] == "sin-pendientes"
            else movimientos_de_cursos.inventario(directorio / "candidato", entorno)
        )
        movimientos_de_cursos.comparar(antes, despues)
        diario.registrar_recibo(contenido)
    with diario.paso("conservar-generacion"):
        generacion = _conservar_generacion(configuracion, directorio, recibo, referencia, almacen)
    with diario.paso("conservar-artefacto"):
        artefacto = _conservar_artefacto(configuracion, directorio, recibo, entorno, almacen)
    if contenido["resultado"] == "validado" and generacion:
        with diario.paso("conservar-inventario"):
            movimientos_de_cursos.guardar(almacen, generacion, despues)
    # Sin el recibo conservado se perdería el trabajo del motor: se repite si el almacén no responde. Repetirlo no
    # duplica ni revierte nada (`conservar_trabajo` reconoce el índice ya escrito y avanza la referencia con su CAS).
    trabajo = (recibo, configuracion.run_id, configuracion.revision_codigo, referencia, generacion)
    diario.conservar_con_reintento(
        "conservar-recibo", lambda: conservar_trabajo(*trabajo, artefacto=artefacto, almacen=almacen)
    )
    with diario.paso("confirmar-resultado"):
        resumen = _resumen(configuracion, recibo, cliente.enviar_resultado(recibo))
    ultimo_fallo.cerrar_rechazo(cliente, configuracion, directorio, resumen["resultado"])
    return resumen


def _motor(
    configuracion: ConfiguracionEjecutorOperativo,
    directorio: Path,
    entorno: dict[str, str],
    cliente: ClienteMantenimientoGitHub,
) -> bytes:
    """Ejecuta el motor; si no deja un recibo válido, dice al servidor por qué antes de dejar salir el fallo.

    Returns:
        El recibo enriquecido y validado.

    Raises:
        ErrorEjecucionOperativa: Si el motor no termina a tiempo o su recibo no es válido.
        MotorSinRecibo: Si lo mató una señal o terminó sin recibo.
    """
    try:
        return _candidato(configuracion, directorio, entorno)
    except (ErrorEjecucionOperativa, MotorSinRecibo) as error:
        # Sin recibo válido, el servidor solo sabría que el job acabó: se le dice por qué, y el fallo sigue.
        ultimo_fallo.cerrar(cliente, configuracion, ultimo_fallo.fallo_sin_recibo(error, directorio / "candidato"))
        raise
    finally:
        diario.registrar_intentos(directorio / "candidato")
