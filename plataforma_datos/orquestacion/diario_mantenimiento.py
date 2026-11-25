"""Diario privado del supervisor y recuperación acotada de lecturas antes de cualquier efecto."""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion import fallo_del_candidato, fallo_del_paso
from plataforma_datos.orquestacion.almacen_generaciones import (
    AlmacenGeneracionesInvalido,
    AlmacenGeneracionesNoDisponible,
)
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3Ausente, AlmacenS3NoDisponible
from plataforma_datos.orquestacion.detalle_del_error import detalle, origen
from plataforma_datos.orquestacion.errores_mantenimiento import ErrorMantenimiento
from plataforma_datos.orquestacion.fin_del_motor import MotorSinRecibo
from plataforma_datos.orquestacion.formas_del_diario import CAUSA_DE_ETAPA
from plataforma_datos.orquestacion.hora_limite_del_motor import leer_parada
from plataforma_datos.orquestacion.huellas_de_lo_descargado import huella_o_nada
from plataforma_datos.orquestacion.notas_de_la_sombra import CICLO_CORTADO, EN_CURSO
from plataforma_datos.orquestacion.notas_de_la_sombra import FASE as FASE_DE_LA_SOMBRA
from plataforma_datos.orquestacion.notas_de_la_sombra import leer as leer_notas_de_la_sombra
from plataforma_datos.orquestacion.pasos_del_ciclo import FASE as FASE_DE_LOS_PASOS
from plataforma_datos.orquestacion.pasos_del_ciclo import leer as leer_pasos_del_ciclo

PAUSAS = (2, 4)
FASE_DE_LA_PARADA = "parada-del-motor"
# La causa de un fallo que nadie esperaba; solo ese fallo lleva su mensaje saneado al diario.
CAUSA_POR_OMISION = "comprobacion-fallida"
# Fallos del almacén por su clase, de la más concreta a la más general: un 404 es una respuesta, no una caída.
CAUSAS_DEL_ALMACEN = (
    (AlmacenS3Ausente, "objeto-ausente"),
    ((AlmacenGeneracionesNoDisponible, AlmacenS3NoDisponible), "almacen-no-disponible"),
    (AlmacenGeneracionesInvalido, "integridad-generacion"),
)
# Fallos que se reconocen por su mensaje, fijo en el código que los lanza.
CAUSAS_POR_MENSAJE = {
    "Censo Cibernàrium admitido distinto de sus pruebas": "censo-cibernarium-no-reproducible",
    "Conjunto Cibernàrium no reproducido": "censo-cibernarium-no-reproducible",
    "Falta el archivo histórico de las ediciones FUNDAE": "archivo-ediciones-ausente",
}
# La consola del job es pública: enseña dónde está el ciclo, cómo va, por qué falló y cuánto tardó, y nada más. La
# identidad de la ejecución (solicitud, reserva, revisión), las huellas, los cursos y el detalle de un error solo van
# al diario privado, que se archiva en el almacén.
CAMPOS_DE_CONSOLA = ("fase", "estado", "causa", "fuente", "etapa", "paso", "pasoDeOrigen")
# Lo que dijo la línea de fallo del paso del paquete en rojo (`fallo_del_paso`): solo sale en el evento `paquete`. Los
# demás eventos con una `clase` (la del candidato, la de la generación) la dejan en el diario privado.
FASE_DEL_FALLO_DEL_PASO = "paquete"
CAMPOS_DEL_FALLO_EN_CONSOLA = ("tramo", "clase", "errno", "motivoAlmacen")
# Un valor de la consola es siempre un nombre del código; cualquier otro texto se queda en el diario privado.
VALOR_DE_CONSOLA = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
# Cada campo del fallo del paso solo entra si es un valor de su lista cerrada (la clase y el errno llevan mayúsculas).
VALORES_CERRADOS_DE_CONSOLA = {
    "tramo": frozenset((*fallo_del_paso.TRAMOS, fallo_del_paso.OTRA)),
    "clase": frozenset((*fallo_del_paso.CLASES, fallo_del_paso.OTRA)),
    "errno": frozenset((*fallo_del_paso.ERRNOS, fallo_del_paso.OTRA)),
    "motivoAlmacen": frozenset((*fallo_del_paso.MOTIVOS_DEL_ALMACEN, fallo_del_paso.OTRA)),
}


@dataclass(frozen=True)
class Diario:
    """Destino local privado e identidad validada de una ejecución."""

    ruta: Path
    identidad: dict[str, str | int]
    consola: bool


_ACTIVO: ContextVar[Diario | None] = ContextVar("diario_mantenimiento", default=None)
# La excepción que está saliendo de los pasos y el más interno por el que salió: los pasos exteriores la anotan con
# ese mismo paso de origen.
_SALIENDO: ContextVar[tuple[BaseException, str] | None] = ContextVar("excepcion_saliendo", default=None)


def activo() -> bool:
    """Indica si esta ejecución conserva observaciones.

    Returns:
        Verdadero si se configuró un destino para el diario.
    """
    return _ACTIVO.get() is not None


@contextmanager
def abrir(ruta: Path | None, identidad: dict[str, str | int], *, consola: bool = True) -> Iterator[None]:
    """Vincula el diario a esta invocación, incluso si falla la configuración.

    Yields:
        Contexto del supervisor que posee el directorio y la identidad.
    """
    token = _ACTIVO.set(Diario(ruta, identidad, consola) if ruta else None)
    try:
        yield
    finally:
        _ACTIVO.reset(token)


def anotar(fase: str, estado: str, **datos: object) -> None:
    """Añade una línea JSON sincronizada. Los llamadores proporcionan códigos y campos de contratos verificados."""
    diario = _ACTIVO.get()
    if diario is None:
        return
    evento = {
        "version": 1,
        "utc": datetime.now(UTC).isoformat(timespec="milliseconds"),
        **diario.identidad,
        "fase": fase,
        "estado": estado,
        **datos,
    }
    linea = json.dumps(evento, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if diario.consola:
        print(linea_de_consola(evento), file=sys.stderr, flush=True)
    fd = os.open(diario.ruta, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "ab") as salida:
        salida.write((linea + "\n").encode())
        salida.flush()
        os.fsync(salida.fileno())


def _minutos(inicio: object, fin: object) -> float | None:
    if not (isinstance(inicio, str) and isinstance(fin, str)):
        return None
    try:
        segundos = (datetime.fromisoformat(fin) - datetime.fromisoformat(inicio)).total_seconds()
    except (ValueError, TypeError):
        # Una hora sin la forma ISO, o una sin zona frente a otra con ella: no hay duración que enseñar.
        return None
    return round(segundos / 60, 1) if segundos >= 0 else None


def _de_consola(campo: str, valor: str) -> bool:
    admitidos = VALORES_CERRADOS_DE_CONSOLA.get(campo)
    return valor in admitidos if admitidos is not None else VALOR_DE_CONSOLA.fullmatch(valor) is not None


def _campos_de_consola(evento: dict[str, object]) -> tuple[str, ...]:
    return (
        (*CAMPOS_DE_CONSOLA, *CAMPOS_DEL_FALLO_EN_CONSOLA)
        if evento.get("fase") == FASE_DEL_FALLO_DEL_PASO
        else CAMPOS_DE_CONSOLA
    )


def linea_de_consola(evento: dict[str, object]) -> str:
    """Resume un evento del diario para la consola pública del job.

    Returns:
        Una línea JSON con solo los campos de `CAMPOS_DE_CONSOLA` cuyo valor es un nombre del código (y, en el evento
        `paquete`, los de `CAMPOS_DEL_FALLO_EN_CONSOLA` que son de su lista cerrada) y, si el evento dice cuándo empezó
        y terminó, sus minutos.
    """
    publico: dict[str, object] = {
        campo: valor
        for campo in _campos_de_consola(evento)
        if isinstance(valor := evento.get(campo), str) and _de_consola(campo, valor)
    }
    minutos = _minutos(evento.get("inicio"), evento.get("fin"))
    if minutos is not None:
        publico["minutos"] = minutos
    return json.dumps(publico, ensure_ascii=False, separators=(",", ":"))


def _causa(error: Exception) -> str:
    # Un proceso que se pasa de su plazo llega envuelto en el error cerrado de quien lo lanzó.
    if isinstance(origen(error), subprocess.TimeoutExpired):
        return "plazo-agotado"
    if isinstance(error, MotorSinRecibo):
        return error.causa
    # El servidor del mantenimiento no respondió o rechazó: no es lo mismo, y la recuperación depende de cuál fue.
    if isinstance(error, ErrorMantenimiento) and error.causa is not None:
        return error.causa
    for clases, causa in CAUSAS_DEL_ALMACEN:
        if isinstance(error, clases):
            return causa
    if str(error) in CAUSAS_POR_MENSAJE:
        return CAUSAS_POR_MENSAJE[str(error)]
    return "entrada-salida" if isinstance(error, OSError) else CAUSA_POR_OMISION


@contextmanager
def paso(fase: str) -> Iterator[None]:
    """Registra principio, confirmación y fallo con el mismo nombre estable.

    Un fallo se anota con su causa y con su detalle (`detalle_del_error`): el tipo, el paso donde ocurrió, los lugares
    del código y, si su causa es la de por omisión, el mensaje saneado. Así ningún fallo queda a ciegas.

    Yields:
        Operación real. Su excepción conserva sus efectos y su tipo.
    """
    anotar(fase, "inicio")
    try:
        yield
    except Exception as error:
        saliendo = _SALIENDO.get()
        if saliendo is None or saliendo[0] is not error:
            saliendo = (error, fase)
            _SALIENDO.set(saliendo)
        causa = _causa(error)
        # La traza empieza en este mismo paso, que la recibe dentro del `with`; sus lugares son los siguientes.
        traza = error.__traceback__.tb_next if error.__traceback__ else None
        anotar(fase, "error", causa=causa, **detalle(error, saliendo[1], traza, esperado=causa != CAUSA_POR_OMISION))
        raise
    anotar(fase, "confirmado")


def leer_con_reintento[T](fase: str, leer: Callable[[], T]) -> T:
    """Repite solo lecturas atómicas ante una indisponibilidad, conservando el último error.

    Returns:
        La primera lectura íntegra confirmada por el verificador original.

    Raises:
        AlmacenGeneracionesNoDisponible: Al agotar el plazo de recuperación de la base.
        AlmacenS3Ausente: Si el objeto pedido no existe; no se repite.
        AlmacenS3NoDisponible: Al agotar los intentos de acceso al almacén.
    """
    return _con_reintento(fase, leer)


def conservar_con_reintento[T](fase: str, conservar: Callable[[], T]) -> T:
    """Repite una conservación repetible sin daño ante una indisponibilidad, con los mismos intentos que las lecturas.

    Solo vale para una operación que, repetida tras un intento a medias, no cambia lo que el primero dejó confirmado:
    escrituras condicionadas y comprobadas por lectura (`almacen_trabajos.conservar_trabajo`).

    Returns:
        Lo que devuelve la conservación confirmada.

    Raises:
        AlmacenS3Ausente: Si un objeto que necesita no existe; no se repite.
        AlmacenS3NoDisponible: Al agotar los intentos de acceso al almacén.
    """
    return _con_reintento(fase, conservar)


def _con_reintento[T](fase: str, operacion: Callable[[], T]) -> T:
    with paso(fase):
        for intento, pausa in enumerate(PAUSAS, 1):
            try:
                return operacion()
            except AlmacenS3Ausente:
                # El almacén ha respondido que el objeto no existe: repetir no lo hace aparecer.
                raise
            except (AlmacenGeneracionesNoDisponible, AlmacenS3NoDisponible):
                anotar(fase, "reintento", causa="almacen-no-disponible", intento=intento + 1, esperaSegundos=pausa)
                time.sleep(pausa)
        return operacion()


def _registrar_calendarios_soc(candidato: Path) -> None:
    from plataforma_datos.orquestacion.archivos_de_generacion import _camino, _json

    nombre = "var/actualizacion/validados/formacion/validacion.json"
    informe = _json(_camino(candidato, nombre))
    for curso in informe.get("calendarios_soc_por_confirmar", []):
        identificador = curso if re.fullmatch(r"[0-9]{1,24}", curso) else hashlib.sha256(curso.encode()).hexdigest()
        anotar(
            "calendario-curso", "por-confirmar", fuente="formacion", curso=identificador, causa="fin-anterior-al-inicio"
        )


def registrar_intentos(candidato: Path) -> None:
    """Copia al diario persistente los hechos cerrados de cada etapa del motor recién ejecutado.

    Raises:
        ValueError: Si un archivo del candidato no corresponde a un intento reconocido.
    """
    if not activo():
        return
    from plataforma_datos.orquestacion.ejecucion_observada import CARPETA_DE_INTENTOS, ETAPAS, MAX_INTENTO_BYTES
    from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES

    carpeta = candidato / CARPETA_DE_INFORMES / CARPETA_DE_INTENTOS
    formacion_validada = False
    for ruta in sorted(carpeta.glob("*/intento.json")):
        if ruta.is_symlink() or ruta.parent.is_symlink() or ruta.stat().st_size > MAX_INTENTO_BYTES:
            raise ValueError("Intento de fuente ilegible")
        dato = json.loads(ruta.read_bytes())
        if dato["fuente"] not in FUENTES or dato["etapa"] not in ETAPAS or dato["id"] != ruta.parent.name:
            raise ValueError("Intento de fuente ajeno")
        if (dato["fuente"], dato["etapa"], dato["estado"], dato["codigo"]) == ("formacion", "validar", "terminado", 0):
            formacion_validada = True
        causa = dato.get("causa")
        if causa and not CAUSA_DE_ETAPA.fullmatch(causa):
            causa = "etapa-rechazada"
        anotar(
            "etapa-fuente",
            dato["estado"],
            fuente=dato["fuente"],
            etapa=dato["etapa"],
            intentoFuente=dato["id"],
            inicio=dato["inicio_utc"],
            fin=dato["fin_utc"],
            codigo=dato["codigo"],
            causa=causa,
            # Lo recibido sin horas, para comparar dos ciclos (comparar_ciclos); None si no hubo recibo.
            recepcion=huella_o_nada(dato.get("recibo")),
        )
    if formacion_validada:
        _registrar_calendarios_soc(candidato)
    _registrar_sombra(candidato)
    _registrar_pasos_del_ciclo(candidato)
    _registrar_parada(candidato)
    _registrar_fallo_del_candidato(candidato)


def _registrar_fallo_del_candidato(candidato: Path) -> None:
    """Copia al diario la clase y la función de la excepción que detuvo al candidato (`fallo_del_candidato`).

    Es telemetría, como la parada: un archivo ilegible se anota como un problema y no detiene al supervisor.
    """
    try:
        fallo = fallo_del_candidato.leer(candidato)
    except (OSError, ValueError) as error:
        anotar(fallo_del_candidato.FASE, "problema", motivo="fallo-ilegible", tipo=type(error).__name__)
        return
    if fallo is not None:
        anotar(fallo_del_candidato.FASE, fallo_del_candidato.ESTADO, **fallo)


def _registrar_parada(candidato: Path) -> None:
    """Copia al diario la parada del motor por su hora límite (`hora_limite_del_motor`), si la hubo.

    Lleva la causa `plazo-insuficiente` y el paso que no empezó. Es telemetría: una parada ilegible se anota como un
    problema y no detiene al supervisor.
    """
    try:
        parada = leer_parada(candidato)
    except (OSError, ValueError) as error:
        anotar(FASE_DE_LA_PARADA, "problema", motivo="parada-ilegible", tipo=type(error).__name__)
        return
    if parada is not None:
        anotar(FASE_DE_LA_PARADA, "parado", **parada)


def _registrar_pasos_del_ciclo(candidato: Path) -> None:
    """Copia al diario la hora real de cada paso del ciclo que no es una etapa de fuente (`pasos_del_ciclo`).

    Se copian cuando el ciclo ya no corre: un paso sin fin es el que seguía cuando el ciclo se cortó. Es telemetría,
    como las notas de la sombra: unos registros ilegibles se anotan y no detienen al supervisor.
    """
    try:
        registros = leer_pasos_del_ciclo(candidato)
    except (OSError, ValueError) as error:
        anotar(FASE_DE_LOS_PASOS, "problema", motivo="registros-ilegibles", tipo=type(error).__name__)
        return
    for registro in registros:
        anotar(FASE_DE_LOS_PASOS, "terminado" if registro["fin"] else "cortado", **registro)


def _registrar_sombra(candidato: Path) -> None:
    """Copia al diario las notas de la retirada en sombra del ciclo, ya en su forma cerrada.

    Es telemetría: unas notas ilegibles se anotan como un problema de la sombra y no detienen al supervisor. Las notas
    se copian cuando el ciclo ya no corre: una que sigue «en-curso» es de un ciclo que se detuvo sin poder decirlo (lo
    mató un plazo, por ejemplo), y se copia como lo que es, un ciclo cortado.
    """
    try:
        notas = leer_notas_de_la_sombra(candidato)
    except (OSError, ValueError) as error:
        anotar(FASE_DE_LA_SOMBRA, "problema", motivo="notas-ilegibles", tipo=type(error).__name__)
        return
    for leida in notas:
        nota = replace(leida, **CICLO_CORTADO) if leida.estado == EN_CURSO else leida
        anotar(
            FASE_DE_LA_SOMBRA, nota.estado, **{k: v for k, v in vars(nota).items() if k != "estado" and v is not None}
        )


def registrar_recibo(recibo: dict[str, Any]) -> None:
    """Conserva el veredicto y la situación verificable de cada módulo del recibo confirmado."""
    if _ACTIVO.get() is None:
        return
    for modulo in (recibo["estado"] or {}).get("modulos", []):
        anotar(
            "modulo", "observado", **{k: modulo[k] for k in ("id", "veredicto", "ultimoIntento", "proximoReintento")}
        )
    anotar(
        "candidato",
        "resultado",
        resultado=recibo["resultado"],
        huellaPaquete=recibo["huellaPaquete"],
        error=fallo_del_candidato.error_del_recibo(recibo.get("error")),
    )
