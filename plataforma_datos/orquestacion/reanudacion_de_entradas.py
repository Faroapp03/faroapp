"""Reutiliza entradas admitidas sin dar una consulta anterior por observada en el nuevo trabajo."""

from __future__ import annotations

import hashlib
import inspect
import json
import os
import subprocess
import sys
import threading
import time
from contextlib import AbstractContextManager, contextmanager, nullcontext
from contextvars import copy_context
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, NamedTuple

from plataforma_datos.orquestacion import comprobaciones_remotas, observacion_de_entradas, sustitucion
from plataforma_datos.orquestacion.hora_limite_del_motor import segundos_hasta_la_hora_limite
from plataforma_datos.orquestacion.modulos import MODULOS, Modulo, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN

if TYPE_CHECKING:
    from collections.abc import Iterator

    from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos
    from plataforma_datos.orquestacion.ejecutor_operativo import ConfiguracionEjecutorOperativo
    from plataforma_datos.orquestacion.entradas_por_fuente import IdentidadEntradas
    from plataforma_datos.orquestacion.estado_de_la_actualizacion import ResultadoDelModulo

CARPETA = "entradas-recuperadas"
PUNTO_DE_CORTE = "entradas-admitidas.json"
CONFIRMACION = "entradas-confirmadas.json"
PLAZO_LOTE_S = 8 * 60
MARGEN_SOCKET_S = 15
CAMBIO_DE_TURNO_S = 0.2
RUNTIME = Path(__file__).resolve().parents[2]
_MODULOS = {modulo.id: modulo for modulo in MODULOS}
_FUENTES = {fuente: modulo for modulo in MODULOS for fuente in modulo.fuentes}
_COMPOSICION = frozenset(
    {
        "plataforma_datos/cursos/aplicar_fuentes_catalogo.py",
        "plataforma_datos/cursos/componer_catalogo.py",
        "plataforma_datos/cursos/panel_catalogo.py",
        "plataforma_datos/cursos/publicar_catalogo.py",
        "plataforma_datos/cursos/retencion_composicion.py",
        "plataforma_datos/orquestacion/retencion_paquete_cursos.py",
    }
)
_INFRA_LECTORES = frozenset(
    {
        "admision.py",
        "cobertura_originales.py",
        "comprobaciones_remotas.py",
        "ejecucion_observada.py",
        "ordenes.py",
        "seguimiento_de_comprobaciones.py",
        "sustitucion.py",
    }
)
_ENTRADAS_COMUNES = ("config/identidad-web.json", "config/dependencias-python.lock.json", "package-lock.json")


class ReanudacionNoDisponible(ValueError):
    """La petición de reanudación no puede usar un lote acreditado."""


class Observacion(NamedTuple):
    """Instante admitido de la fuente y recepción histórica cuando hay evidencia remota."""

    fecha: str
    remota: dict[str, Any] | None
    consulta_nueva: bool


def _huella(valor: object) -> str:
    contenido = json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(contenido).hexdigest()


def _codigo_de_lectores(configuracion: ConfiguracionEjecutorOperativo) -> dict[str, str]:
    """Firma árboles propios, contratos e infraestructura de las fuentes del commit autorizado.

    Returns:
        Huella por fuente, independiente de las órdenes que solo componen o publican el paquete.

    Raises:
        ValueError: Si el árbol no contiene todas las casas declaradas en el registro.
    """
    from plataforma_datos.biblioteca.fuentes.lecturas import lector as lecturas
    from plataforma_datos.ia_y_trabajo.fuentes.hechos_informe import lector as hechos
    from plataforma_datos.orquestacion import actualizar

    contratos = {"lecturas": set(lecturas.CONTRATOS_TS), "hechos_informe": set(hechos.CONTRATOS)}
    casas = {
        fuente: Path(modulo.__file__).resolve().parent.relative_to(RUNTIME).as_posix() + "/"
        for fuente, modulo in FUENTES_EN_ORDEN
    }
    arbol = subprocess.check_output(
        ["git", "-C", configuracion.checkout, "ls-tree", "-rz", configuracion.revision_codigo],
        env={"PATH": os.defpath, "GIT_NO_REPLACE_OBJECTS": "1", "GIT_NO_LAZY_FETCH": "1"},
        timeout=30,
    )
    propias: dict[str, dict[str, str]] = {fuente: {} for fuente in casas}
    comunes = {}
    for fila in arbol.split(b"\0"):
        if not fila:
            continue
        firma, _, ruta = fila.decode().partition("\t")
        partes = ruta.split("/")
        if "pruebas" in partes or "docs" in partes or ruta.endswith(".md") or ruta in _COMPOSICION:
            continue
        fuente = next((fuente for fuente, prefijo in casas.items() if ruta.startswith(prefijo)), None)
        if fuente is not None:
            propias[fuente][ruta] = firma
        elif (
            ruta in _ENTRADAS_COMUNES
            or ruta.startswith("plataforma_datos/")
            and (partes[1] != "orquestacion" or partes[-1] in _INFRA_LECTORES)
        ):
            comunes[ruta] = firma
        for nombre, rutas in contratos.items():
            if ruta in rutas:
                propias[nombre][ruta] = firma
    if not comunes or not all(propias.values()):
        raise ValueError("No se pueden identificar los lectores del candidato")
    admision = [
        inspect.getsource(funcion)
        for funcion in (actualizar.exigir_orden_admitida, actualizar.ejecutar_modulo, actualizar.revalidar)
    ]
    comun = _huella((comunes, admision))
    return {
        fuente: _huella((comun, arbol_propio, _politica_y_ordenes(fuente))) for fuente, arbol_propio in propias.items()
    }


def _politica_y_ordenes(fuente: str) -> tuple:
    from plataforma_datos.orquestacion.actualizar import ordenes_de_la_fuente

    ficha = FUENTES[fuente]
    return (
        ficha.politica,
        ficha.red,
        [[orden.orden[1:] for orden in ordenes_de_la_fuente(fuente, sin)] for sin in ((), (fuente,))],
    )


def dependencias(raiz: Path, modulo: Modulo, lectores: dict[str, str]) -> dict[str, str]:
    """Identifica lo que cada dependencia entrega, con el lector que puede producirlo.

    Returns:
        Huella de los árboles y el código de cada dependencia declarada.
    """
    from plataforma_datos.orquestacion.actualizar import huella

    return {
        nombre: _huella((huella(raiz, carpetas(_MODULOS[nombre])), [lectores[f] for f in _MODULOS[nombre].fuentes]))
        for nombre in modulo.entradas
    }


def aplicar_entrada(plan: Path, raiz: Path, area: Path, modulo: Modulo) -> tuple[ResultadoDelModulo, str] | None:
    """Aplica la entrada al llegar al módulo, una vez resueltas sus dependencias.

    Returns:
        Resultado del módulo y fecha comprobada, o None si se debe ejecutar el módulo.

    Raises:
        AreaNoRestaurada: Si no se puede confirmar la sustitución del área, la publicación o el registro.
    """
    from plataforma_datos.orquestacion.actualizar import AreaNoRestaurada, publicar

    if len(modulo.fuentes) != 1:
        return None  # el formato guarda una fuente; una unidad de publicación conjunta no se divide
    fuente = modulo.fuentes[0]
    nota = plan / fuente / "entrada.json"
    if not nota.is_file():
        return None
    entrada = json.loads(nota.read_bytes())
    lectores = json.loads((plan / "lectores.json").read_bytes())
    if entrada["lectorSha256"] != lectores[fuente] or entrada["dependencias"] != dependencias(raiz, modulo, lectores):
        return None
    copia = plan / "contenido"
    rutas = tuple(ruta for ruta in carpetas(modulo) if (copia / ruta).is_dir())
    if carpetas(modulo)[2] not in rutas or any((area / ruta).exists() for ruta in set(carpetas(modulo)) - set(rutas)):
        return None
    observada = entrada["observadoEn"]
    try:
        sustitucion.sustituir(area, copia, rutas, diario=plan / f"diario-{fuente}.json")
        resultado = publicar(raiz, area, modulo.id, carpetas(modulo), ensayo=False)
        if "observacionRemota" in entrada:
            observacion_de_entradas.recuperar_observacion_remota(raiz, fuente, entrada["observacionRemota"], observada)
        nota.with_name("usada").write_text(observada + "\n", encoding="utf-8")
    except Exception as error:
        raise AreaNoRestaurada(f"aplicación incompleta de las entradas recuperadas de {modulo.id}") from error
    return resultado, observada


def _escribir(ruta: Path, valor: object) -> None:
    sustitucion.escribir_atomico(ruta, json.dumps(valor, ensure_ascii=False, sort_keys=True))


def marcar_y_esperar(destino: Path, resultados: dict) -> None:
    """Mantiene quietos los bytes admitidos hasta que el supervisor confirma su archivo privado.

    Raises:
        ValueError: Si el supervisor no confirma un archivo recuperable dentro del plazo.
    """
    from plataforma_datos.orquestacion.actualizar import VERDE
    from plataforma_datos.orquestacion.entradas_por_fuente import fuente_elegible

    fuentes = [
        fuente
        for fuente, modulo in _FUENTES.items()
        if fuente_elegible(fuente)
        and len(modulo.fuentes) == 1
        and modulo.id in resultados
        and resultados[modulo.id].veredicto == VERDE
    ]
    if not fuentes:
        # Avisa sin bloquear al motor: el supervisor no necesita tocar el candidato ni el almacén.
        _escribir(destino, {"fuentes": []})
        return
    quedan = segundos_hasta_la_hora_limite()
    if quedan is None:
        raise ValueError("La conservación de entradas requiere el plazo del motor")
    # Aun si las fuentes agotaron la reserva del paquete, el trabajo admitido se puede conservar antes de que pare.
    plazo = time.monotonic() + max(0, min(PLAZO_LOTE_S, quedan - MARGEN_SOCKET_S))
    respuesta = destino.with_name(CONFIRMACION)
    _escribir(destino, {"fuentes": fuentes, "plazo": plazo})
    while time.monotonic() < plazo:
        if respuesta.is_file():
            if json.loads(respuesta.read_bytes())["confirmadas"] is True:
                return
            break
        time.sleep(CAMBIO_DE_TURNO_S)
    raise ValueError("No se confirmó el lote de entradas antes del paquete")


def _identidad(tupla: dict[str, Any], base: dict[str, str], dia: str) -> IdentidadEntradas:
    from plataforma_datos.orquestacion.entradas_por_fuente import IdentidadEntradas

    return IdentidadEntradas(
        tupla["runId"],
        "1",
        tupla["solicitudId"],
        tupla["revisionReserva"],
        base["revisionCodigo"],
        base["sha256Manifiesto"],
        dia,
    )


def _observada(fila: dict[str, Any], ciclo: str, dia: str) -> Observacion | None:
    if fila["ciclo"] != ciclo or fila["resultado"] not in ("comprobada", "completa", "parcial", "local"):
        return None
    evidencia = fila["evidencia"]
    con_peticiones = bool(fila["remoto"] and evidencia and evidencia["peticiones"])
    instante = evidencia["fin_utc"] if con_peticiones else fila["fin_utc"]
    fecha = datetime.fromisoformat(instante)
    if fecha.date().isoformat() != dia:
        return None
    return Observacion(
        fecha.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        fila if con_peticiones else None,
        con_peticiones,
    )


def _fuentes_observadas(directorio: Path, fuentes: list[str], dia: str) -> dict[str, Observacion]:
    registro = comprobaciones_remotas.leer_registro(directorio / "candidato")
    ciclo = registro["ultimo_ciclo"]
    if not ciclo or ciclo["inicio_utc"][:10] != dia:
        return {}
    observaciones = {}
    for fuente in fuentes:
        usada = directorio / CARPETA / fuente / "usada"
        fila = registro["fuentes"].get(fuente)
        if usada.is_file():
            entrada = json.loads(usada.with_name("entrada.json").read_bytes())
            observada = Observacion(usada.read_text().strip(), entrada.get("observacionRemota"), False)
        else:
            observada = _observada(fila, ciclo["id"], dia) if fila else None
            if observada is not None and observada.remota is not None:
                _exigir_conjuntos_originales(registro, fuente, observada.remota)
        if observada and observada.fecha[:10] == dia:
            observaciones[fuente] = observada
    return observaciones


def _exigir_conjuntos_originales(registro: dict, fuente: str, fila: dict) -> None:
    for identificador in fila["comprobados"]:
        if registro["conjuntos"].get(identificador) != {
            "fuente": fuente,
            "ciclo": fila["ciclo"],
            "comprobado_utc": fila["fin_utc"],
            "sha256_evidencia": fila["evidencia"]["sha256"],
        }:
            raise ValueError("El registro no acredita los conjuntos declarados por la fuente")


def _conservar(
    configuracion: ConfiguracionEjecutorOperativo,
    directorio: Path,
    identidad: IdentidadEntradas,
    almacen: AlmacenTrabajos,
    punto: dict,
) -> None:
    from plataforma_datos.orquestacion.lotes_de_entradas import DatosEntrada, guardar_lote

    if not punto["fuentes"]:
        from plataforma_datos.orquestacion import diario_mantenimiento as diario

        diario.anotar("lote-entradas", "omitido", motivo="sin-fuentes-remotas-elegibles")
        print(
            "Sin lote previo al paquete: la ronda solo admitió módulos sin originales remotos elegibles.",
            file=sys.stderr,
        )
        return
    observaciones = _fuentes_observadas(directorio, punto["fuentes"], identidad.dia)
    if not observaciones:
        print("Sin lote previo al paquete: ninguna fuente verde acredita una etapa de hoy UTC.", file=sys.stderr)
        return
    raiz = directorio / "candidato"
    lectores = _codigo_de_lectores(configuracion)
    fuentes = {
        fuente: DatosEntrada(
            observada.fecha, lectores[fuente], dependencias(raiz, _FUENTES[fuente], lectores), observada.remota
        )
        for fuente, observada in observaciones.items()
    }
    with _limitar(almacen, punto["plazo"] - MARGEN_SOCKET_S):
        confirmadas = guardar_lote(
            identidad, raiz, fuentes, almacen=almacen, base_sellada=directorio / "generacion-base"
        )
    if not confirmadas:
        raise ValueError("No se pudo conservar ninguna entrada admitida")
    consultas = sum(observaciones[fuente].consulta_nueva for fuente in confirmadas)
    print(
        f"Entradas conservadas para este día UTC: {len(confirmadas)} de {len(fuentes)}; "
        f"{consultas} con peticiones registradas en esta ronda.",
        file=sys.stderr,
    )


def _limitar(almacen: AlmacenTrabajos, plazo: float) -> AbstractContextManager[None]:
    limite = getattr(almacen, "limitar_hasta", None)
    return limite(plazo) if limite is not None else nullcontext()


@contextmanager
def conservar_antes_del_paquete(
    configuracion: ConfiguracionEjecutorOperativo, directorio: Path, base: dict, almacen: AlmacenTrabajos
) -> Iterator[None]:
    """Conserva fuera del subprocess y libera al motor solo tras confirmar su lote.

    Yields:
        El ámbito durante el que el motor puede presentar las entradas del candidato del trabajo.
    """
    dia = datetime.now(UTC).date().isoformat()
    identidad = _identidad(
        {
            "runId": configuracion.run_id,
            "solicitudId": configuracion.solicitud_id,
            "revisionReserva": configuracion.revision_reserva,
        },
        base,
        dia,
    )
    basta = threading.Event()

    def supervisar() -> None:
        punto = directorio / PUNTO_DE_CORTE
        while not punto.is_file():
            if basta.wait(CAMBIO_DE_TURNO_S) and not punto.is_file():
                return
        try:
            _conservar(configuracion, directorio, identidad, almacen, json.loads(punto.read_bytes()))
        except Exception:  # El hijo recibe una negativa incluso ante un fallo interno del auxiliar.
            print("No se confirmó la conservación del lote previo al paquete.", file=sys.stderr)
            _escribir(directorio / CONFIRMACION, {"confirmadas": False})
        else:
            _escribir(directorio / CONFIRMACION, {"confirmadas": True})

    contexto = copy_context()
    hilo = threading.Thread(target=contexto.run, args=(supervisar,))
    hilo.start()
    try:
        yield
    finally:
        basta.set()
        hilo.join()


def _buscar_lote(
    referencia: dict, dia: str, almacen: AlmacenTrabajos
) -> tuple[IdentidadEntradas | None, dict[str, str]]:
    from plataforma_datos.orquestacion.almacen_trabajos import recuperar_trabajo
    from plataforma_datos.orquestacion.lotes_de_entradas import leer_ultimo_lote

    base = referencia["baseOperativa"]
    identidad = leer_ultimo_lote(base["revisionCodigo"], base["sha256Manifiesto"], dia, almacen=almacen)
    if identidad is not None:
        return identidad, base
    trabajo = referencia["trabajo"]
    if trabajo is None or base == referencia["ultimaValidada"]:
        return None, base
    anterior = recuperar_trabajo(trabajo["solicitudId"], trabajo["revisionReserva"], trabajo["runId"], almacen)
    if anterior is None:
        return None, base
    descriptor, recibo = anterior
    if json.loads(recibo)["resultado"] != "rechazado" or descriptor["generacion"] != base:
        return None, base
    inicial = descriptor["base"]
    lote = leer_ultimo_lote(inicial["revisionCodigo"], inicial["sha256Manifiesto"], dia, almacen=almacen)
    if lote is not None and (lote.run_id, lote.solicitud_id, lote.revision_reserva) == (
        trabajo["runId"],
        trabajo["solicitudId"],
        trabajo["revisionReserva"],
    ):
        return lote, inicial
    return None, base


def preparar_si_pedida(
    configuracion: ConfiguracionEjecutorOperativo, directorio: Path, referencia: dict, almacen: AlmacenTrabajos
) -> None:
    """Recupera el lote completo de otra reserva de hoy y la misma base acreditada.

    Raises:
        ReanudacionNoDisponible: Si no hay otra reserva con entradas compatibles para la base actual.
    """
    if not configuracion.reanudar_entradas:
        return
    from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneracionesInvalido, recuperar_generacion
    from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajoInvalido
    from plataforma_datos.orquestacion.entradas_por_fuente import EntradaInvalida, EntradaNoDisponible
    from plataforma_datos.orquestacion.lotes_de_entradas import recuperar_lote

    base = referencia["baseOperativa"]
    ahora = datetime.now(UTC)
    dia = ahora.date().isoformat()
    plan = directorio / CARPETA
    plan.mkdir(mode=0o700)
    plazo = time.monotonic() + PLAZO_LOTE_S - MARGEN_SOCKET_S
    try:
        with _limitar(almacen, plazo):
            identidad, base_del_lote = _buscar_lote(referencia, dia, almacen)
            if (
                identidad is None
                or identidad.intento != "1"
                or identidad.dia != dia
                or identidad.revision_base != base_del_lote["revisionCodigo"]
                or identidad.sha256_base != base_del_lote["sha256Manifiesto"]
                or identidad.run_id == configuracion.run_id
                or identidad.solicitud_id == configuracion.solicitud_id
                or identidad.revision_reserva >= configuracion.revision_reserva
            ):
                raise ReanudacionNoDisponible(
                    "Se requiere una nueva reserva y entradas acreditadas de hoy sobre esta base"
                )
            base_sellada = directorio / "generacion-base"
            if base_del_lote != base:
                base_sellada = directorio / "generacion-base-entradas"
                recuperar_generacion(base_sellada, identidad.revision_base, identidad.sha256_base, almacen)
            entradas = recuperar_lote(identidad, plan / "contenido", almacen=almacen, base_sellada=base_sellada) or {}
    except (EntradaInvalida, EntradaNoDisponible, AlmacenGeneracionesInvalido, AlmacenTrabajoInvalido) as error:
        raise ReanudacionNoDisponible("El almacén privado no ha devuelto un lote de entradas verificable") from error
    if time.monotonic() >= plazo:
        raise ReanudacionNoDisponible("Venció el plazo de lectura y verificación del lote de entradas")
    lectores = _codigo_de_lectores(configuracion)
    _escribir(plan / "lectores.json", lectores)
    compatibles = {
        fuente: entrada
        for fuente, entrada in entradas.items()
        if entrada["lectorSha256"] == lectores.get(fuente)
        and entrada["observadoEn"][:10] == dia
        and datetime.fromisoformat(entrada["observadoEn"]) <= ahora
    }
    if not compatibles:
        raise ReanudacionNoDisponible("El lote previo no conserva lectores compatibles con esta revisión")
    for fuente, entrada in compatibles.items():
        (plan / fuente).mkdir()
        _escribir(plan / fuente / "entrada.json", entrada)
    print(f"Entradas comprobadas del trabajo anterior: {len(compatibles)}.", file=sys.stderr)
