"""Un día de la comprobación de enlaces con las piezas reales, hasta el estado que lee el panel.

El lector de enlaces (descargar, preparar y validar), el seguimiento, el registro y `estado_panel` son los de
producción. Solo son dobles la red (la respuesta de cada dirección), el reloj monótono del plazo y la recepción de la
descarga, que en producción escribe el transporte. Se puede ejecutar como módulo para producir, en JSON, el registro y
el estado de un escenario: `python -m plataforma_datos.orquestacion.pruebas.dia_de_enlaces <raíz> <escenario>`.
"""

import contextlib
import io
import json
import sys
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.fuentes.enlaces import consulta, lector
from plataforma_datos.cursos.fuentes.enlaces.observaciones import PROGRAMAS, observacion
from plataforma_datos.cursos.pruebas.instalacion_de_formacion import montar_consorci, montar_formacion
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion import contrato_comprobaciones_panel as contrato
from plataforma_datos.orquestacion import seguimiento_de_comprobaciones as seguimiento
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.modulos import MODULOS

RESPONDE = 200
LIMITE = 429
NO_EXISTE = 404
ERROR_DE_SERVIDOR = 503
SANA = "sana.example"
LIMITADO = "limitado.example"
# Cuatro webs de un dominio que pide que se le deje en paz y otra web; la formación, de la muestra real: una ficha de
# curso y dos programas.
CONSORCI = {"ediciones": [{"web": f"https://{LIMITADO}/{n}"} for n in range(4)] + [{"web": "https://sana.example/"}]}
CON_TOPE = 7
TOPE_NORMAL = lector.MAX_CONSULTAS
SIN_RESPUESTA = None
ESCENARIOS = (
    "tope",
    "dominio",
    "plazo",
    "plazo-sin-duracion",
    "sin-validar",
    "validacion-de-otro-dia",
    "validacion-con-las-mismas-cifras",
    "sin-respuesta",
    "sin-fecha",
    "todo-503",
    "todo-429",
    "plazo-con-un-503",
    "enlace-repetido",
)


def _respuesta(url: str, conjunto: str, *, codigo: int | None, instante: str) -> dict:
    if codigo is None:
        return observacion(instante, None, None, motivo="red")
    es_pdf = True if conjunto == PROGRAMAS and codigo == RESPONDE else None
    return observacion(instante, codigo, url, es_pdf=es_pdf, huella="c" * 64 if es_pdf else None)


def _consulta_simulada(
    *, codigo: Callable[[str], int | None], fechada: Callable[[str], bool] = lambda _url: True
) -> Callable[[str, str], dict]:
    def pedir(url: str, conjunto: str) -> dict:
        ahora = datetime.now(UTC).replace(microsecond=0).isoformat() if fechada(url) else "2026-01-01T00:00:00+00:00"
        return _respuesta(url, conjunto, codigo=codigo(url), instante=ahora)

    return pedir


def _reloj_que_corta_tras(consultas: int) -> Callable[[], float]:
    """Un reloj monótono que marca cero para las primeras consultas y pasa del plazo en la siguiente.

    Returns:
        La función de reloj: una lectura para fijar el límite y una por cada enlace.
    """
    lecturas = iter([0.0] * (consultas + 1))
    return lambda: next(lecturas, 1e9)


@contextlib.contextmanager
def instalacion(
    raiz: Path, *, tope: int = TOPE_NORMAL, plazo_s: float = lector.PLAZO_S, repetido: bool = False
) -> Iterator[None]:
    """Redirige el lector de enlaces a una raíz temporal con el conjunto del Consorci y los preparados de la formación.

    Args:
        raiz: La raíz de la instalación temporal.
        tope: Las consultas máximas del ciclo.
        plazo_s: El plazo del ciclo, en segundos.
        repetido: Si un segundo curso enseña la misma ficha que el primero.

    Yields:
        Nada: dentro, el lector escribe bajo `raiz/var/actualizacion`.
    """
    datos = raiz / DATOS_RELATIVOS
    original = datos / "originales" / lector.FUENTE
    with contextlib.ExitStack() as pila:
        for nombre, carpeta in (("ORIGINALES", "originales"), ("PREPARADOS", "preparados"), ("VALIDADOS", "validados")):
            pila.enter_context(mock.patch.object(entrada_salida, nombre, datos / carpeta))
        pila.enter_context(mock.patch.object(lector, "ORIGINAL", original))
        pila.enter_context(mock.patch.object(lector, "PREPARADO", datos / "preparados" / lector.FUENTE))
        pila.enter_context(mock.patch.object(lector, "PROCEDENCIA", original / "procedencia.json"))
        pila.enter_context(mock.patch.object(lector, "PAQUETE", raiz / "paquete"))
        # Los mismos topes el día de la pasada larga: el caso no depende del día de la semana en que se ejecuta.
        for corto, largo in (("MAX_CONSULTAS", "MAX_CONSULTAS_DIA_LARGO"), ("PLAZO_S", "PLAZO_S_DIA_LARGO")):
            valor = tope if corto == "MAX_CONSULTAS" else plazo_s
            pila.enter_context(mock.patch.object(lector, corto, valor))
            pila.enter_context(mock.patch.object(lector, largo, valor))
        pila.enter_context(contextlib.redirect_stdout(io.StringIO()))
        montar_consorci(CONSORCI | {"entidades": {}})
        montar_formacion(pila, cursos=1, ficha_repetida=repetido)
        entrada_salida.guardar_json(datos / "preparados" / "abierta" / "fichas.json", {"fichas": []})
        yield


def _recepcion(comienzo: datetime, fin: datetime) -> dict:
    """La recepción de la descarga, con una petición completada dentro de su ventana.

    Returns:
        La recepción, con la forma que escribe el transporte común.
    """
    return {
        "version": 2,
        "fuente": lector.FUENTE,
        "intento": "recepcion-enlaces",
        "comienzo_utc": comienzo.isoformat(),
        "fin_utc": fin.isoformat(),
        "peticiones": [
            {
                "recurso_sha256": "a" * 64,
                "url_final_sha256": "b" * 64,
                "respuesta_sha256": "c" * 64,
                "bytes": 42,
                "completado_utc": fin.isoformat(),
                "original_sha256": "c" * 64,
                "original_bytes": 42,
            }
        ],
    }


def dia_completo(pedir: Callable[[str, str], dict], *, reloj: Callable[[], float] | None = None) -> None:
    """Un día entero del lector, fuera del seguimiento: descargar, preparar y validar."""
    con_reloj = lector.comprobar_ciclo if reloj is None else partial(lector.comprobar_ciclo, reloj=reloj)
    with mock.patch.object(consulta, "consultar", pedir), mock.patch.object(lector, "comprobar_ciclo", con_reloj):
        lector.descargar()
    lector.preparar()
    lector.validar()


def ciclo_con_seguimiento(
    raiz: Path,
    pedir: Callable[[str, str], dict],
    *,
    validar: bool = True,
    reloj: Callable[[], float] | None = None,
) -> str:
    """Un ciclo del seguimiento sobre el lector real; devuelve el resultado que registra para `enlaces`.

    Args:
        raiz: La raíz de la instalación temporal.
        pedir: La consulta simulada de cada enlace.
        validar: Si la etapa de validación se ejecuta; sin ella termina con código cero pero sin conjunto nuevo.
        reloj: El reloj monótono del plazo; None usa el real.

    Returns:
        El resultado registrado de la fuente.
    """
    recepcion: dict[str, dict] = {}
    con_reloj = lector.comprobar_ciclo if reloj is None else partial(lector.comprobar_ciclo, reloj=reloj)

    def ejecutar(orden: list[str], _area: Path) -> actualizar.Resultado:
        etapa = etapa_de_fuente(orden)[1]
        if etapa == "descargar":
            comienzo = datetime.now(UTC)
            with (
                mock.patch.object(consulta, "consultar", pedir),
                mock.patch.object(lector, "comprobar_ciclo", con_reloj),
            ):
                lector.descargar()
            recepcion["descarga"] = _recepcion(comienzo, datetime.now(UTC))
        elif etapa == "preparar":
            lector.preparar()
        elif validar:
            lector.validar()
        return actualizar.Resultado(0, "", recepcion["descarga"] if etapa == "descargar" else None)

    inicio = datetime.now(UTC)
    ciclo = registro.iniciar_ciclo(raiz, inicio, "programada")
    observador = seguimiento.Seguimiento(raiz, ciclo, ejecutar, lambda: datetime.now(UTC))
    for orden in actualizar.ordenes_de_la_fuente(lector.FUENTE):
        observador.ejecutar(orden.orden, raiz)
    observador.terminar_modulo(
        next(m for m in MODULOS if m.id == lector.FUENTE), actualizar.ResultadoDelModulo("verde")
    )
    registro.cerrar_ciclo(raiz, ciclo, datetime.now(UTC), resultado="preparado", paquete_preparado=True)
    return registro.leer_registro(raiz)["fuentes"][lector.FUENTE]["resultado"]


def producir(raiz: Path, escenario: str) -> dict:
    """El día de un escenario hasta el estado del panel, con su contrato validado.

    Args:
        raiz: La raíz de la instalación temporal.
        escenario: Uno de `ESCENARIOS`.

    Returns:
        `registro` (el resultado de `enlaces`) e `instantanea` (el estado del panel).
    """
    sana = _consulta_simulada(codigo=lambda _url: RESPONDE)
    pedir = {
        "dominio": _consulta_simulada(codigo=lambda url: LIMITE if LIMITADO in url else RESPONDE),
        "validacion-con-las-mismas-cifras": _consulta_simulada(
            codigo=lambda url: NO_EXISTE if SANA in url else RESPONDE
        ),
        "sin-respuesta": _consulta_simulada(codigo=lambda _url: SIN_RESPUESTA),
        "sin-fecha": _consulta_simulada(codigo=lambda _url: RESPONDE, fechada=lambda url: LIMITADO not in url),
        "todo-503": _consulta_simulada(codigo=lambda _url: ERROR_DE_SERVIDOR),
        "todo-429": _consulta_simulada(codigo=lambda _url: LIMITE),
        "plazo-con-un-503": _consulta_simulada(codigo=lambda url: ERROR_DE_SERVIDOR if SANA in url else SIN_RESPUESTA),
    }.get(escenario, sana)
    tope = CON_TOPE if escenario in ("tope", "validacion-de-otro-dia") else TOPE_NORMAL
    plazo_s, reloj = lector.PLAZO_S, None
    if escenario in ("plazo", "plazo-con-un-503"):
        plazo_s, reloj = 1, _reloj_que_corta_tras(CON_TOPE)
    elif escenario == "plazo-sin-duracion":
        reloj = _reloj_que_corta_tras(CON_TOPE)
    with instalacion(raiz, tope=tope, plazo_s=plazo_s, repetido=escenario == "enlace-repetido"):
        if escenario in ("validacion-de-otro-dia", "validacion-con-las-mismas-cifras"):
            with (
                mock.patch.object(lector, "MAX_CONSULTAS", TOPE_NORMAL),
                mock.patch.object(lector, "MAX_CONSULTAS_DIA_LARGO", TOPE_NORMAL),
            ):
                dia_completo(sana)
        resultado = ciclo_con_seguimiento(
            raiz,
            pedir,
            validar=escenario not in ("sin-validar", "validacion-de-otro-dia", "validacion-con-las-mismas-cifras"),
            reloj=reloj,
        )
        instantanea = estado_panel(raiz, datetime.now(UTC) + timedelta(seconds=1))
    contrato.validar_comprobaciones_panel(instantanea)
    contrato.validar_seguimiento_panel(instantanea)
    return {"registro": resultado, "instantanea": instantanea}


if __name__ == "__main__":
    print(json.dumps(producir(Path(sys.argv[1]), sys.argv[2])))
    sys.exit(0)
