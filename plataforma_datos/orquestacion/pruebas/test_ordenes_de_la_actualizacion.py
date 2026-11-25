"""Cada orden del paquete tiene su tope, y el de las comprobaciones de los datos cubre sus plazos internos."""

import math
import re
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import actualizar, medidas_del_ciclo
from plataforma_datos.orquestacion import ordenes_de_la_actualizacion as ordenes

VERIFICAR = RAIZ / "scripts" / "verificar.ts"
VERIFICAR_DATOS = RAIZ / "scripts" / "verificar-datos.ts"
PLAZOS_DE_LAS_SUITES = RAIZ / "scripts" / "plazos-de-las-suites.ts"


def _milisegundos(archivo: Path, nombre: str, *, exportado: bool = False) -> int:
    prefijo = "export const" if exportado else "const"
    (valor,) = re.findall(rf"^{prefijo} {nombre} = ([0-9_]+);", archivo.read_text(encoding="utf-8"), re.MULTILINE)
    return int(valor.replace("_", ""))


def plazos_internos_de_verificar_datos() -> int:
    """Suma, en segundos, los plazos que `npm run verificar:datos` se da por dentro, leídos de su código.

    Cada comprobación de `pasosDeDatos` tiene el plazo por paso; después vienen las pruebas de unidad, las de Python y
    el humo, cada una con el suyo.

    Returns:
        La suma de todos ellos.
    """
    codigo = VERIFICAR_DATOS.read_text(encoding="utf-8")
    pasos = re.search(r"export function pasosDeDatos\(\)[^{]*\{(.*?)\n\}", codigo, re.DOTALL)
    assert pasos is not None
    comprobaciones = len(re.findall(r"^\s+node\('", pasos[1], re.MULTILINE))
    milisegundos = (
        comprobaciones * _milisegundos(VERIFICAR, "PLAZO_POR_PASO_MS")
        + _milisegundos(PLAZOS_DE_LAS_SUITES, "PLAZO_SUITE_UNIDAD_MS", exportado=True)
        + _milisegundos(VERIFICAR_DATOS, "PLAZO_PYTHON_MS")
        + _milisegundos(VERIFICAR_DATOS, "PLAZO_HUMO_MS")
    )
    return milisegundos // 1000


class TopesDeLasOrdenesPruebas(unittest.TestCase):
    """El tope de una orden fija es el suyo; el de las fuentes, el general."""

    def test_el_tope_de_verificar_datos_cubre_sus_plazos_internos(self) -> None:
        """Si verificar:datos se da más tiempo por dentro, esta prueba exige subir su tope antes de que lo corte."""
        self.assertEqual(plazos_internos_de_verificar_datos(), 80 * 60)
        (comprobaciones,) = ordenes.COMPROBACIONES
        self.assertEqual(tuple(comprobaciones.orden), ("npm", "run", "verificar:datos"))
        self.assertGreater(comprobaciones.tope, plazos_internos_de_verificar_datos())

    def test_componer_cubre_su_medida_en_el_runner_lento_con_margen(self) -> None:
        """El tope propio de componer sale de la medida de ese paso y el mismo redondeo que el motor."""
        m = medidas_del_ciclo
        medido = m.COMPONER_EN_EL_MAC_S * m.PYTHON_EN_EL_RUNNER_LENTO
        con_margen = medido * (100 + m.MARGEN_POR_CIENTO) / 100
        redondeo = 5 * 60
        esperado = math.ceil(con_margen / redondeo) * redondeo
        self.assertEqual(ordenes.COMPONER_EL_CATALOGO.tope, esperado)
        self.assertGreater(esperado, actualizar.TOPE_POR_ORDEN)

    def test_cada_orden_del_paquete_se_ejecuta_con_su_tope(self) -> None:
        """La actualización corta cada orden con el tope que declara; la de una fuente, con el general."""
        casos = [(orden.orden, orden.tope or actualizar.TOPE_POR_ORDEN) for orden in ordenes.ORDENES_DEL_PAQUETE]
        casos.append(([actualizar.PYTHON, "-m", "plataforma_datos.cursos.fuentes.formacion", "descargar"], 45 * 60))
        self.assertIn((ordenes.COMPROBAR_LOS_DATOS, 85 * 60), casos)
        self.assertIn((ordenes.COMPONER_EL_CATALOGO.orden, 60 * 60), casos)
        for orden, tope in casos:
            with (
                self.subTest(orden=orden),
                mock.patch.object(
                    actualizar, "ejecutar_con_plazo", side_effect=subprocess.TimeoutExpired(orden, tope)
                ) as lanzar,
            ):
                resultado = actualizar.ejecutar_orden(list(orden), Path.cwd())
                self.assertEqual(lanzar.call_args.args[2], tope)
                self.assertEqual(resultado.codigo, actualizar.CODIGO_TIEMPO_AGOTADO)
                self.assertIn(str(tope), resultado.salida)


if __name__ == "__main__":
    unittest.main()
