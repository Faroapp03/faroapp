"""Cada descarga de red respeta la pausa también al recorrer módulos distintos."""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN


class PruebaPausasEntreModulos(unittest.TestCase):
    """Dos módulos reales del registro, con órdenes y esperas simuladas."""

    def test_cli_usa_el_modulo_registrado_incluso_despues_del_traslado(self) -> None:
        """Descarga, preparación y revalidación ejecutan el productor real sin fabricar rutas antiguas."""
        for nombre, adaptador in FUENTES_EN_ORDEN:
            with self.subTest(fuente=nombre):
                for orden in actualizar.ordenes_de_la_fuente(nombre):
                    self.assertEqual(orden.orden[2], adaptador.__name__)
                    self.assertEqual(etapa_de_fuente(orden.orden), (nombre, orden.etapa))
        modulo = next(modulo for modulo in actualizar.MODULOS if modulo.id == "consorci")
        ejecutar = mock.Mock(return_value=actualizar.Resultado(0, ""))
        with mock.patch.object(actualizar, "restaurar"):
            self.assertTrue(actualizar.revalidar(Path(), modulo, ejecutar, (), Path()))
        ejecutar.assert_called_once_with(
            [actualizar.PYTHON, "-m", dict(FUENTES_EN_ORDEN)["consorci"].__name__, "validar"], Path()
        )

    def test_la_pausa_no_se_pierde_entre_modulos_ni_cambia_sus_pasos(self) -> None:
        """La pausa precede a cada descarga de red, incluida la primera; lo local no espera."""
        nombres = ("oit", "clasificaciones")
        productores = {adaptador.__name__: nombre for nombre, adaptador in FUENTES_EN_ORDEN if nombre in nombres}
        modulos = tuple(modulo for modulo in actualizar.MODULOS if modulo.id in nombres)
        self.assertEqual(tuple(modulo.id for modulo in modulos), nombres)
        self.assertTrue(all(actualizar.FUENTES[nombre].red for nombre in nombres))
        todas = ("descargar", "preparar", "validar")
        casos = (
            ("positiva", 7, True, (), todas, (7, 7)),
            ("cero", 0, True, (), todas, (0, 0)),
            ("sin red", 7, False, (), todas, ()),
            ("sin descargar", 7, True, nombres, ("preparar", "validar"), ()),
        )
        for caso, pausa, red, sin_descargar, etapas, esperas in casos:
            with self.subTest(caso=caso), tempfile.TemporaryDirectory() as temporal:
                eventos: list[tuple[str, object]] = []

                def ejecutar(
                    orden: list[str], _area: Path, registro: list[tuple[str, object]] = eventos
                ) -> actualizar.Resultado:
                    fuente, etapa = productores[orden[2]], orden[3]
                    self.assertEqual(orden, [actualizar.PYTHON, "-m", dict(FUENTES_EN_ORDEN)[fuente].__name__, etapa])
                    registro.append((fuente, etapa))
                    return actualizar.Resultado(0, f"salida {fuente}:{etapa}")

                salida = io.StringIO()
                raiz, area = Path(temporal) / "producto", Path(temporal) / "area"
                raiz.mkdir()
                area.mkdir()
                fuentes = {nombre: actualizar.FUENTES[nombre]._replace(red=red) for nombre in nombres}
                with (
                    mock.patch.object(actualizar, "MODULOS", modulos),
                    mock.patch.dict(actualizar.FUENTES, fuentes),
                    mock.patch.object(
                        actualizar, "publicar", return_value=actualizar.ResultadoDelModulo(actualizar.VERDE)
                    ),
                    mock.patch.object(
                        actualizar.time,
                        "sleep",
                        side_effect=lambda segundos, registro=eventos: registro.append(("pausa", segundos)),
                    ),
                    contextlib.redirect_stdout(salida),
                ):
                    pasos, resultados = actualizar.ejecutar_modulos(
                        raiz, area, ejecutar, actualizar.Opciones(pausa=pausa, reintento=0, sin_descargar=sin_descargar)
                    )

                esperados = [(fuente, etapa) for fuente in nombres for etapa in etapas]
                self.assertEqual(
                    [(paso.nombre, paso.codigo, paso.salida) for paso in pasos],
                    [(f"{fuente} · {etapa}", 0, f"salida {fuente}:{etapa}") for fuente, etapa in esperados],
                )
                self.assertEqual(tuple(resultados), nombres)
                self.assertTrue(all(resultado.veredicto == actualizar.VERDE for resultado in resultados.values()))
                self.assertEqual(
                    salida.getvalue().splitlines(), [f"== {fuente} · {etapa}" for fuente, etapa in esperados]
                )
                self.assertEqual([valor for tipo, valor in eventos if tipo == "pausa"], list(esperas))
                if esperas:
                    self.assertEqual(
                        eventos,
                        [("pausa", pausa), *esperados[:3], ("pausa", pausa), *esperados[3:]],
                    )


if __name__ == "__main__":
    unittest.main()
