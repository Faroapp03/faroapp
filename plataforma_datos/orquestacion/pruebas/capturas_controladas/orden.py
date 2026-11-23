"""Ejecuta la actualización real sobre una raíz de ensayo, como lo haría `python -m ...actualizar`.

Todo es el motor del producto (cerrojo, recuperación, selección, área, órdenes de las fuentes, seguimiento remoto,
estado, informe, composición del catálogo y sustitución de la entrega) salvo dos cosas:
- las órdenes de las fuentes reciben en su entorno las respuestas externas controladas (ver `sitecustomize.py`);
- las órdenes de construcción y verificación del producto completo (exportar el paquete del motor, ensamblar la web,
  `npm run verificar:datos` y el cotejo de artefactos) devuelven verde sin ejecutarse: son la batería y la construcción
  de la versión, no tocan el catálogo de cursos y tardan minutos. La composición del catálogo sí se ejecuta.

Con `--dias-adelante N`, la selección de reintentos pendientes se calcula como si hubieran pasado N días: es la
forma de ensayar hoy un reintento escalonado que vence mañana. Escribe en la salida un JSON con el código y el
veredicto de cada módulo.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from plataforma_datos.comun.observacion_remota import VARIABLE_RECEPCION
from plataforma_datos.orquestacion import actualizar

CAPTURAS = Path(__file__).resolve().parent
SUSTITUIDAS = frozenset(
    tuple(orden.orden)
    for orden in (
        actualizar.EXPORTAR_EL_PAQUETE,
        *actualizar.ENSAMBLADO,
        *actualizar.COMPROBACIONES,
        actualizar.COTEJO_DE_ARTEFACTOS,
    )
)


def ejecutar(orden: list[str], area: Path) -> actualizar.Resultado:
    """Ejecuta de verdad toda orden que no sea de construcción o verificación del producto completo.

    Returns:
        El resultado real de la orden, o verde para las sustituidas.
    """
    if tuple(orden) in SUSTITUIDAS:
        return actualizar.Resultado(0, "sustituida en el ensayo del circuito")
    return actualizar.ejecutar_orden(orden, area)


def main(argv: list[str] | None = None) -> int:
    """Lanza una ronda de actualización sobre la raíz indicada.

    Returns:
        El código de salida de la actualización.
    """
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("--raiz", type=Path, required=True)
    analizador.add_argument("--plan", type=Path, required=True)
    analizador.add_argument("--solo", nargs="+")
    analizador.add_argument("--pendientes", action="store_true")
    analizador.add_argument("--sin-descargar", nargs="+", default=[])
    analizador.add_argument("--dias-adelante", type=int, default=0)
    argumentos = analizador.parse_args(argv)
    entorno_real = actualizar.entorno_de_las_ordenes

    def entorno(variables: dict[str, str]) -> dict[str, str]:
        filtrado = entorno_real(variables)
        filtrado.pop(VARIABLE_RECEPCION, None)
        return {**filtrado, "PYTHONPATH": str(CAPTURAS), "FARO_CAPTURAS_CONTROLADAS": str(argumentos.plan)}

    actualizar.entorno_de_las_ordenes = entorno
    if argumentos.dias_adelante:
        seleccionar = actualizar._opciones_de_pendientes
        adelanto = timedelta(days=argumentos.dias_adelante)

        def pendientes_adelantados(raiz: Path, opciones: actualizar.Opciones, ahora: datetime) -> object:
            return seleccionar(raiz, opciones, ahora + adelanto)

        actualizar._opciones_de_pendientes = pendientes_adelantados
    opciones = actualizar.Opciones(
        pausa=0,
        reintento=0,
        sin_descargar=tuple(argumentos.sin_descargar),
        solo=tuple(argumentos.solo) if argumentos.solo else None,
        reintentar_pendientes=argumentos.pendientes,
    )
    resultado = actualizar.actualizar_con_resultado(argumentos.raiz, opciones, ejecutar)
    resumen = {
        "codigo": resultado.codigo,
        "modulos": {nombre: [r.veredicto, r.motivo, r.publicado] for nombre, r in resultado.resultados.items()},
    }
    sys.stdout.flush()
    os.write(1, ("\nRESUMEN " + json.dumps(resumen, ensure_ascii=False) + "\n").encode())
    return resultado.codigo


if __name__ == "__main__":
    sys.exit(main())
