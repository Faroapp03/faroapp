"""Escribe un recibo sintético de la versión vigente (v4) con estado v5, hecho por el productor Python real.

Lo usa `pruebas/administracion/recibo-python-en-el-receptor.test.ts` para que el receptor TypeScript lea bytes
producidos de verdad en Python y no una copia escrita a mano. El estado sale de `estado_panel` con un reloj fijo y las
fichas sintéticas de `test_abierta.documento()`; el catálogo, de la preparación de prueba de los recibos compactos.
Nada procede de una instalación real.

Solo trabaja con la guardia de red de la batería puesta (`FARO_PRUEBAS_SIN_RED=1` y `scripts/sin_red` en
`PYTHONPATH`): así una consulta olvidada falla en vez de salir del equipo. Por eso el producto se importa dentro de
`recibo_sintetico`, después de comprobar la guardia, y no al cargar este archivo.
"""

import importlib.util
import json
import sys
from datetime import UTC, datetime

# Reloj fijo: con las fichas sintéticas, comprobadas el 2026-10-06, la revisión pendiente cae el 2027-01-05.
OBSERVADO_EN = datetime(2026, 10, 18, 12, tzinfo=UTC)
SOLICITUD = "11111111-1111-4111-8111-111111111111"
REVISION_RESERVA = 1
SIN_GUARDIA = "La ayuda del recibo sintético exige la guardia de red de la batería"


def exigir_guardia_de_red() -> None:
    """Termina con un error si este intérprete no tiene la guardia de red puesta.

    Raises:
        SystemExit: Si falta la guardia o no se ha aplicado.
    """
    if importlib.util.find_spec("guardia_red") is None:
        raise SystemExit(SIN_GUARDIA)
    # Solo se puede importar si el lanzador puso `scripts/sin_red` en PYTHONPATH.
    import guardia_red

    if not guardia_red.aplicada():
        raise SystemExit(SIN_GUARDIA)


def recibo_sintetico() -> bytes:
    """Construye el recibo y lo pasa por el mismo control que aplica el almacén de trabajos al guardarlo.

    Returns:
        Los bytes JSON compactos del recibo, tal como los enviaría el productor.
    """
    from plataforma_datos.cursos.pruebas.test_abierta import documento as fichas_sinteticas
    from plataforma_datos.orquestacion import almacen_trabajos, candidato, estado_panel
    from plataforma_datos.orquestacion.pruebas import test_estado_panel
    from plataforma_datos.orquestacion.pruebas.test_recibos_catalogo_compactos import RecibosCatalogoCompactos

    panel = test_estado_panel.PruebaEstadoPanel()
    catalogo = RecibosCatalogoCompactos()
    # Las preparaciones de prueba registran su limpieza; se ejecuta en orden inverso aunque falle una de ellas.
    try:
        panel.setUp()
        panel.guardar(test_estado_panel.documento())
        fichas = panel.raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
        fichas.write_text(json.dumps(fichas_sinteticas()), encoding="utf-8")
        estado = estado_panel.estado_panel(panel.raiz, OBSERVADO_EN)
        catalogo.setUp()
        catalogo_preparado = json.loads(catalogo.cuerpo())
        # El mismo constructor que usa el productor para «sin pendientes», sin pasar por la orden completa.
        recibo = candidato._recibo("reintentar-pendientes", "sin-pendientes", estado)
        recibo.update(
            catalogo=catalogo_preparado["catalogo"],
            terminadoEn=catalogo_preparado["terminadoEn"],
            solicitudId=SOLICITUD,
            revisionReserva=REVISION_RESERVA,
            estado=estado,
        )
        contenido = json.dumps(recibo, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        # El control que aplica el almacén al guardar: un recibo que no lo pase no llega a la prueba.
        almacen_trabajos._recibo(contenido)
        return contenido
    finally:
        try:
            catalogo.doCleanups()
        finally:
            panel.doCleanups()


def principal() -> int:
    """Escribe el recibo sintético en la salida estándar.

    Returns:
        Cero al terminar; cualquier fallo sale como excepción con su traza.
    """
    exigir_guardia_de_red()
    sys.stdout.write(recibo_sintetico().decode())
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
