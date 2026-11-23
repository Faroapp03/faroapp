"""Retiradas de HP LIFE en una preparación: la observación de ausencia del listado completo y las discrepancias.

Parte de lo que decidió `bajas.decidir` al admitir la consulta, pero no se fía de ello: vuelve a leer las páginas
conservadas del listado y solo observa la ausencia si siguen formando un censo completo.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from plataforma_datos.cursos import retirada_proveedor
from plataforma_datos.cursos.admision_catalogo import ReferenciaArchivo
from plataforma_datos.cursos.fuentes.hp_life import altas, indice, lotes_actualizacion, observaciones_vigencia
from plataforma_datos.cursos.fuentes.hp_life.lector import ErrorFichaHpLife
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

if TYPE_CHECKING:
    from plataforma_datos.cursos.fuentes.hp_life.actualizacion import SolicitudHpLife


def procesar(
    solicitud: SolicitudHpLife, leer: Callable[[ReferenciaArchivo], bytes], conexion: sqlite3.Connection, area: Path
) -> list[ObjetoJson]:
    """Construye las filas de control de las retiradas y de las contradicciones de las unidades que el catálogo conoce.

    Una retirada lleva la observación de ausencia con las páginas del listado como evidencia. Una contradicción
    (el listado no incluye el curso pero su ficha es íntegra) no cambia la oferta: queda anotada en el control.

    Returns:
        Filas del control, con su observación y sus evidencias conservadas cuando las hay.

    Raises:
        ErrorFichaHpLife: Si una observación resultara posterior al corte.
    """
    retiradas, contradicciones, corte = solicitud.retiradas, solicitud.contradicciones, solicitud.corte_utc
    leidas = altas.paginas_leidas(solicitud.indice, leer)
    completo = indice.censo([lectura for _n, _r, lectura in leidas]).completo
    filas = []
    for id in sorted({*retiradas, *contradicciones}):
        fila = conexion.execute("SELECT url FROM programas WHERE id=?", (id,)).fetchone()
        if fila is None:
            continue
        if id in contradicciones:
            filas.append({"id": id, "estado": "ficha-integra-fuera-del-listado", "evidencias": []})
        elif completo:
            oferta = {"id": id, "fuente_id": "hp_life", "url": fila["url"]}
            observacion = observaciones_vigencia.construir_observacion_retirada(
                [(n, r) for n, r, _l in leidas], oferta=oferta
            )
            if fecha_utc(observacion["terminado_el"]) > fecha_utc(corte):
                raise ErrorFichaHpLife("Retirada posterior al corte; no se inventa una fecha")
            pruebas = [
                e for _n, r, _l in leidas for e in lotes_actualizacion.conservar_recepcion(r, area / "evidencias")
            ]
            filas.append(
                {
                    "id": id,
                    "estado": "retirada-por-el-proveedor",
                    "observacion": observacion,
                    "evidencias": pruebas,
                    "metodo": retirada_proveedor.METODO,
                }
            )
    return filas


def procesar_fallos(
    solicitud: SolicitudHpLife, leer: Callable[[ReferenciaArchivo], bytes], conexion: sqlite3.Connection, area: Path
) -> list[ObjetoJson]:
    """Registra cada intento sin respuesta como fallo de consulta de su unidad.

    Una alta cuya ficha no respondió no tiene unidad que evaluar todavía: queda anotada sin observación.

    Returns:
        Filas del control de los intentos.

    Raises:
        ErrorFichaHpLife: Si un intento es posterior al corte o choca con otro conservado.
    """
    control = []
    for fallo in solicitud.fallos:
        intento = leer(fallo.intento)
        fila = conexion.execute(
            "SELECT url FROM programas WHERE id=? AND proveedor_id='hp-life'", (fallo.id,)
        ).fetchone()
        if fila is None:
            control.append({"id": fallo.id, "estado": "alta-sin-respuesta", "evidencias": []})
            continue
        observacion = observaciones_vigencia.construir_observacion_fallo(
            intento, oferta={"id": fallo.id, "fuente_id": "hp_life", "url": fila["url"]}
        )
        if fecha_utc(observacion["terminado_el"]) > fecha_utc(solicitud.corte_utc):
            raise ErrorFichaHpLife("Intento posterior al corte; no se inventa una fecha")
        relativa = Path("hp-life") / "intentos" / (fallo.intento.sha256 + ".json")
        destino = area / "evidencias" / relativa
        destino.parent.mkdir(parents=True, exist_ok=True)
        if destino.exists() and destino.read_bytes() != intento:
            raise ErrorFichaHpLife("Colisión de intento HP")
        destino.write_bytes(intento)
        evidencia = {
            "url": fila["url"],
            "capturado_utc": observacion["terminado_el"],
            "sha256": fallo.intento.sha256,
            "archivo": relativa.as_posix(),
        }
        control.append(
            {
                "id": fallo.id,
                "estado": "intento-fallido",
                "observacion": observacion,
                "evidencias": [evidencia],
                "metodo": observaciones_vigencia.METODO,
            }
        )
    return control
