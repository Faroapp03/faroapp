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

    def test_componer_tiene_el_plazo_que_le_reserva_el_paquete(self) -> None:
        """El tope de la orden es la cifra que reserva el motor: si una cambia sin la otra, el paquete no cabe."""
        self.assertEqual(ordenes.COMPONER_EL_CATALOGO.tope, medidas_del_ciclo.PLAZO_DE_COMPONER_S)
        self.assertEqual(ordenes.COMPONER_EL_CATALOGO.tope, 90 * 60)
        self.assertGreater(ordenes.COMPONER_EL_CATALOGO.tope, actualizar.TOPE_POR_ORDEN)

    def test_componer_cubre_cada_medida_con_su_margen(self) -> None:
        """La medida del runner se toma tal cual; la del Mac, llevada al runner lento. Las dos, con el margen.

        Una medida nueva que tarde más se anota en `medidas_del_ciclo` y esta prueba exige revisar el plazo antes de
        que la orden se corte en el ciclo real, como estuvo a punto de pasar en la ejecución 45859673175.
        """
        m = medidas_del_ciclo
        redondeo = 5 * 60
        for nombre, medido in (
            ("runner", m.COMPONER_EN_EL_RUNNER_S),
            ("Mac en el runner lento", m.COMPONER_EN_EL_MAC_S * m.PYTHON_EN_EL_RUNNER_LENTO),
        ):
            with self.subTest(medida=nombre):
                self.assertGreater(medido, 0)
                necesario = math.ceil(medido * m.MARGEN / redondeo) * redondeo
                self.assertGreaterEqual(ordenes.COMPONER_EL_CATALOGO.tope, necesario)

    def test_cada_orden_del_paquete_se_ejecuta_con_su_tope(self) -> None:
        """La actualización corta cada orden con el tope que declara; la de una fuente, con el general."""
        casos = [(orden.orden, orden.tope or actualizar.TOPE_POR_ORDEN) for orden in ordenes.ORDENES_DEL_PAQUETE]
        casos.append(([actualizar.PYTHON, "-m", "plataforma_datos.cursos.fuentes.formacion", "descargar"], 45 * 60))
        self.assertIn((ordenes.COMPROBAR_LOS_DATOS, 85 * 60), casos)
        self.assertIn((ordenes.COMPONER_EL_CATALOGO.orden, 90 * 60), casos)
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
