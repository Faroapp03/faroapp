"""Estado de los datos para `npm run datos:estado`, en JSON por la salida estándar.

Edad y plazo de cada fuente, la revisión pendiente de la formación abierta y la última actualización mensual,
con los módulos que conservan su última versión buena (var/actualizacion/ejecuciones/estado.json) y los archivos del
paquete en cuarentena, que esperan una decisión (ejecuciones/cuarentena.json). Expone los
hechos para que el administrador o un consumidor de este JSON pueda valorar la necesidad de renovar cada fuente.

Reutiliza las reglas de la actualización mensual (piezas_de_la_actualizacion.py): la política de cada fuente, su plazo
de renovación y la fecha del dato, que sale de la procedencia de sus originales. No consulta la red ni escribe nada.
Python estándar.

Uso: python3 -m plataforma_datos.orquestacion.estado_de_los_datos [--hoy AAAA-MM-DD]
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

import plataforma_datos.cursos.fuentes.abierta.lector as abierta
from plataforma_datos.comun.entrada_salida import hoy_utc, leer_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, exigir
from plataforma_datos.orquestacion.cuarentena_del_paquete import leer_cuarentena
from plataforma_datos.orquestacion.estado_de_la_actualizacion import AMBAR, leer_estado
from plataforma_datos.orquestacion.ordenes import con_motivo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    EDICION,
    FUENTES,
    MENSUAL,
    fecha_de_la_fuente,
    informes_fechados,
)

# Margen supletorio para fuentes automáticas sin plazo propio declarado.
# El aviso describe una necesidad de revisión, no la falsedad o desaparición de datos.
PLAZO_DE_LA_ACTUALIZACION_MENSUAL = 45  # días


def plazo(nombre: str) -> int | None:
    """Da los días que puede tener el dato de una fuente antes de pedir que se renueve.

    Args:
        nombre: La fuente, clave de FUENTES.

    Returns:
        Plazo explícito de la fuente; sin él, el margen mensual para fuentes
        automáticas por red. None si no hay un plazo aplicable.
    """
    fuente = FUENTES[nombre]
    if fuente.renovar_dias is not None:
        return fuente.renovar_dias
    if fuente.politica in (MENSUAL, EDICION) and fuente.red:
        return PLAZO_DE_LA_ACTUALIZACION_MENSUAL
    return None


def estado_de_las_fuentes(raiz: Path, hoy: date) -> list[dict[str, Any]]:
    """Describe cada fuente con originales: política, frecuencia, fecha del dato, días que tiene y su plazo.

    Args:
        raiz: La raíz del repositorio.
        hoy: El día con que se cuenta la edad.

    Returns:
        Una fila por fuente con originales, en el orden de FUENTES; «fecha» y «dias» son None si no consta la fecha.
    """
    filas: list[dict[str, Any]] = []
    for nombre, fuente in FUENTES.items():
        if not fuente.originales and nombre != "hechos_informe":
            continue
        fecha = fecha_de_la_fuente(raiz, nombre)
        filas.append(
            {
                "fuente": nombre,
                "politica": fuente.politica,
                "frecuencia": fuente.frecuencia,
                "fecha": fecha.isoformat() if fecha else None,
                "dias": (hoy - fecha).days if fecha else None,
                "plazo": plazo(nombre),
            }
        )
    return filas


def revision_pendiente_de_la_formacion_abierta(raiz: Path, hoy: date) -> str | None:
    """Calcula el primer día en que alguna ficha admitida lleva más de 90 días sin revisar.

    Es un aviso de revisión: la ficha sigue admitida y visible hasta su fin publicado, y desde entonces deja de contar.

    Args:
        raiz: La raíz del repositorio.
        hoy: El día de la observación.

    Returns:
        Ese día (AAAA-MM-DD); None si no queda ninguna ficha admitida y sin terminar.

    Raises:
        ArchivoFaltante: Si falta fichas.json.
        FormatoInesperado: Si fichas.json no es JSON válido o no tiene la forma de un documento de fichas.
    """
    documento = leer_json(raiz / DATOS_RELATIVOS / "preparados" / "abierta" / "fichas.json")
    exigir(
        isinstance(documento, dict) and isinstance(documento.get("fichas"), list),
        "fichas.json tiene que llevar «fichas» (lista)",
    )
    pendiente = abierta.revision_pendiente(documento, hoy)
    return None if pendiente is None else pendiente.isoformat()


def conservados(raiz: Path) -> list[dict[str, str | None]]:
    """Lista los módulos en ámbar en estado.json: de cuándo es su versión buena y cuándo se reintentan.

    Args:
        raiz: La raíz del repositorio.

    Returns:
        Una fila por módulo en ámbar; cada instante UTC es None si no consta.
    """
    return [
        {
            "modulo": modulo,
            "version_buena_utc": (registro.get("ultima_version_buena") or {}).get("publicada_utc"),
            "proximo_reintento_utc": registro.get("proximo_reintento_utc"),
        }
        for modulo, registro in leer_estado(raiz).items()
        if registro.get("veredicto") == AMBAR
    ]


def en_cuarentena(raiz: Path) -> list[dict[str, Any]]:
    """Lista los archivos del paquete que conservan su versión publicada porque superaron el umbral de pérdida.

    Cada fila pide una decisión: aceptar el cambio (`actualizar --aceptar-cuarentena ARCHIVO`) o esperar a que la fuente
    vuelva a dar las cifras anteriores.

    Args:
        raiz: La raíz del repositorio.

    Returns:
        Una fila por archivo, en orden de nombre: los que conserva con él, sus cifras de antes y después, desde cuándo,
        la última vez que se observó y, si ya se aceptó, cuándo.

    Raises:
        FormatoInesperado: Si el estado de la cuarentena está roto.
    """
    return [
        {
            "archivo": nombre,
            "grupo": registro["grupo"],
            "perdidas": [
                {"medida": perdida["medida"], "antes": perdida["antes"], "despues": perdida["despues"]}
                for perdida in registro["perdidas"]
            ],
            "desde_utc": registro["desde_utc"],
            "ultima_utc": registro["ultima_utc"],
            "aceptada_utc": registro["aceptada_utc"],
        }
        for nombre, registro in sorted(leer_cuarentena(raiz).items())
    ]


def ultima_actualizacion(raiz: Path) -> dict[str, Any] | None:
    """Resume la última actualización mensual: veredicto, fecha, informe y módulos conservados.

    Args:
        raiz: La raíz del repositorio.

    Returns:
        El resumen del informe más reciente de ejecuciones/; None si nunca se ejecutó.

    Raises:
        FormatoInesperado: Si el informe JSON más reciente no es JSON válido.
    """
    informes = informes_fechados(raiz)
    if not informes:
        return None
    datos = leer_json(informes[-1])
    exigir(
        isinstance(datos, dict) and isinstance(datos.get("veredicto"), str) and isinstance(datos.get("utc"), str),
        f"{informes[-1]} debe llevar veredicto y utc como textos",
    )
    return {
        "veredicto": datos["veredicto"],
        "utc": datos["utc"],
        "informe": informes[-1].with_suffix(".md").relative_to(raiz).as_posix(),
        "conservados": conservados(raiz),
    }


def estado(raiz: Path, hoy: date) -> dict[str, Any]:
    """Reúne todo lo que el doctor necesita de los datos.

    Args:
        raiz: La raíz del repositorio.
        hoy: El día con que se cuenta la edad.

    Returns:
        El día, las fuentes, la revisión pendiente de la formación abierta, la última actualización y la cuarentena.
    """
    return {
        "hoy": hoy.isoformat(),
        "fuentes": estado_de_las_fuentes(raiz, hoy),
        "formacion_abierta_revision_pendiente": revision_pendiente_de_la_formacion_abierta(raiz, hoy),
        "ultima_actualizacion": ultima_actualizacion(raiz),
        "cuarentena": en_cuarentena(raiz),
    }


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: escribe el estado en JSON por la salida estándar.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        0 si escribe el estado; 1 si un archivo falta o está roto (el motivo va a la salida de errores, sin traza).
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--hoy", type=date.fromisoformat, help="el día con que se calcula la edad (AAAA-MM-DD)")
    argumentos = analizador.parse_args(argv)
    hoy = argumentos.hoy or hoy_utc()
    return con_motivo(lambda: print(json.dumps(estado(RAIZ, hoy), ensure_ascii=False, indent=2)))


if __name__ == "__main__":
    sys.exit(main())
