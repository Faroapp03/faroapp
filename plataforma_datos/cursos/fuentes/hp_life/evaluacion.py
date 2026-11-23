"""Evaluación de las unidades HP de una preparación: qué recepción describe cada una y su registro de vigencia."""

import sqlite3
from contextlib import closing
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING

from plataforma_datos.cursos import politicas_vigencia, retirada_proveedor
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import RecepcionHpLife, fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

if TYPE_CHECKING:
    from plataforma_datos.cursos.fuentes.hp_life.actualizacion import RecepcionEnDisco


def vigentes(recepciones: list[tuple["RecepcionEnDisco", RecepcionHpLife]]) -> set[str]:
    """Elige por unidad la ficha completa de captura más reciente, sin depender del orden de llegada.

    Una respuesta que es fallo de consulta (5xx, bloqueo, redirección) o un 404 no describe
    el contenido actual: aporta su observación, pero no sustituye la última ficha leída.

    Returns:
        SHA de los recibos que describen y proyectan el contenido actual de su unidad.
    """
    elegidas: dict[str, tuple[object, str]] = {}
    for entrada, recepcion in recepciones:
        if recepcion.captura.http != HTTPStatus.OK or recepcion.captura.completo is not True:
            continue
        clave = (fecha_utc(recepcion.captura.recibido_utc), entrada.recibo.sha256)
        if entrada.id not in elegidas or clave > elegidas[entrada.id]:
            elegidas[entrada.id] = clave
    return {sha for _fecha, sha in elegidas.values()}


def evaluar(filas: list[ObjetoJson], area: Path, corte: str) -> list[ObjetoJson]:
    """Registra cada unidad con observaciones en el registro único de vigencia.

    Returns:
        Las evaluaciones registradas.

    Raises:
        ErrorFichaHpLife: Si una misma recepción llega con dos observaciones distintas.
    """
    resultados = []
    politica = politicas_vigencia.leer_politica(retirada_proveedor.FUENTE, retirada_proveedor.VERSION_POLITICA)
    con_observacion = [f for f in filas if "observacion" in f]
    for id in dict.fromkeys(f["id"] for f in con_observacion):
        actual = registro.consultar_unidad(area / "catalogo.sqlite3", tipo="recurso", id=id)
        anterior = actual["evaluacion"]
        observaciones = list(anterior["entradas"]["observaciones"]) if anterior is not None else []
        # Orden de captura real; una misma recepción o intento no se duplica al reevaluarse.
        nuevas = sorted(
            (f["observacion"] for f in con_observacion if f["id"] == id),
            key=lambda o: (fecha_utc(o["terminado_el"]), o["id"]),
        )
        for nueva in nuevas:
            iguales = [o for o in observaciones if o["id"] == nueva["id"]]
            if iguales and iguales != [nueva]:
                raise lector.ErrorFichaHpLife("Observación de la misma recepción en conflicto")
            if not iguales:
                observaciones.append(nueva)
        with closing(
            sqlite3.connect((area / "catalogo.sqlite3").as_uri() + "?mode=ro&immutable=1", uri=True)
        ) as conexion:
            fila = conexion.execute("SELECT huella,url FROM programas WHERE id=?", (id,)).fetchone()
        if fila is None:
            # Una unidad sin programa (alta sin ficha o sin índice que la acredite) no tiene qué evaluar.
            continue
        huella, url = fila
        resultados.append(
            registro.registrar_unidad(
                area / "catalogo.sqlite3",
                registro.SolicitudEvaluacionUnidad(
                    unidad=registro.UnidadEvaluable(tipo="recurso", id=id, huella=huella),
                    oferta={"id": id, "fuente_id": "hp_life", "url": url},
                    observaciones=observaciones,
                    politica=politica,
                    ahora=corte,
                ),
            )
        )
    return resultados
