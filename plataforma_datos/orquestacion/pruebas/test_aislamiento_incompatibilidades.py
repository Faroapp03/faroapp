"""La incompatibilidad conserva su causa entre rondas y no bloquea fuentes independientes."""

import io
import shutil
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.modulos import carpetas
from plataforma_datos.orquestacion.pruebas import test_actualizacion_dependientes as casos


class EjecutorIndependiente(casos.EjecutorDependencias):
    """Hace avanzar Citilab sin red mientras reproduce el fallo de clasificaciones."""

    valor_independiente = "independiente-nuevo"

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Escribe una novedad independiente y conserva las etapas sintéticas del montador.

        Returns:
            Resultado de la etapa simulada, sin subprocesos.
        """
        if etapa_de_fuente(orden) == ("citilab", "descargar"):
            casos.archivo(area, "citilab", 0).write_text(self.valor_independiente, encoding="utf-8")
        return super().__call__(orden, area)


class PruebaIncompatibilidadConservada(unittest.TestCase):
    """El orquestador y sus publicaciones son reales; las cuatro fuentes están simuladas."""

    def setUp(self) -> None:
        """Crea versiones anteriores fechadas en un árbol temporal propio."""
        self.montador = casos.PruebaActualizacionDependientes()
        self.montador.setUp()
        self.addCleanup(self.montador.doCleanups)
        self.raiz, self.area = self.montador.caso()
        shutil.rmtree(self.area)
        previos = {
            m.id: estado.ResultadoDelModulo(estado.VERDE, publicado=actualizar.huella(self.raiz, carpetas(m)))
            for m in casos.REGISTRO
        }
        intento = estado.Intento(datetime(2025, 10, 1, tzinfo=UTC), estado.VERDE, self.raiz / "previo.json")
        estado.registrar_estado(self.raiz, previos, intento, lambda *_args: None)
        self.ultima_buena = estado.leer_estado(self.raiz)["clasificaciones"]["ultima_version_buena"]
        self.paquete = mock.Mock(
            return_value=([], actualizar.Comparacion(None, [], []), estado.ResultadoDelModulo(estado.VERDE))
        )

    def ejecutar(
        self, ejecutor: EjecutorIndependiente, *, solo: tuple[str, ...] | None = None
    ) -> actualizar.ResultadoActualizacion:
        """Ejecuta una ronda; observa si se permite exportar sin simular su admisión.

        Returns:
            Resultado completo del coordinador sobre la raíz temporal.
        """
        self.paquete.reset_mock()
        with (
            mock.patch.object(actualizar, "MODULOS", casos.REGISTRO),
            mock.patch.object(actualizar, "ejecutar_paquete", self.paquete),
            redirect_stdout(io.StringIO()),
        ):
            return actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(area=self.area, solo=solo, pausa=0, reintento=0), ejecutor
            )

    def crear_incompatibilidad(self) -> actualizar.ResultadoActualizacion:
        """Publica OIT nueva y conserva clasificaciones incompatible, sin ejecutar datos reales.

        Returns:
            Primera ronda con incompatibilidad demostrada por la revalidación fallida.
        """
        resultado = self.ejecutar(EjecutorIndependiente(falla=True, cambia=True))
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, estado.ROJO)
        self.paquete.assert_not_called()
        return resultado

    def test_segunda_ronda_no_olvida_incompatibilidad(self) -> None:
        """Sin otra publicación de OIT, el anterior fallido sigue requiriendo revalidación."""
        self.crear_incompatibilidad()
        ejecutor = EjecutorIndependiente(falla=True, cambia=False)
        resultado = self.ejecutar(ejecutor)
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, estado.ROJO)
        self.assertEqual(ejecutor.ordenes.count(("clasificaciones", "validar")), 2)
        self.paquete.assert_not_called()
        self.assertEqual(casos.archivo(self.raiz, "clasificaciones", 2).read_text(), "vigente")
        self.assertEqual(estado.leer_estado(self.raiz)["clasificaciones"]["ultima_version_buena"], self.ultima_buena)

    def test_parcial_con_rojo_omitido_no_finge_intento_ni_exporta(self) -> None:
        """Citilab avanza; no seleccionar el módulo rojo no borra su incompatibilidad."""
        self.crear_incompatibilidad()
        anterior = estado.leer_estado(self.raiz)["clasificaciones"]
        ejecutor = EjecutorIndependiente(falla=False, cambia=False)
        ejecutor.valor_independiente = "independiente-segundo"
        resultado = self.ejecutar(ejecutor, solo=("citilab",))
        self.paquete.assert_not_called()
        self.assertEqual(resultado.resultados["citilab"].veredicto, estado.VERDE)
        self.assertIsNotNone(resultado.resultados["citilab"].publicado)
        self.assertNotIn("clasificaciones", resultado.resultados)
        self.assertNotIn("cambra", resultado.resultados)
        self.assertEqual(estado.leer_estado(self.raiz)["clasificaciones"], anterior)
        self.assertEqual(casos.archivo(self.raiz, "citilab", 2).read_text(), ejecutor.valor_independiente)
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)

    def test_fallo_sin_rojo_previo_conserva_anterior_compatible(self) -> None:
        """El fallo ordinario conserva ámbar, fecha anterior e independientes sin forzar otra validación."""
        ejecutor = EjecutorIndependiente(falla=True, cambia=False)
        resultado = self.ejecutar(ejecutor)
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, estado.AMBAR)
        self.assertEqual(ejecutor.ordenes.count(("clasificaciones", "validar")), 1)
        self.paquete.assert_called_once()
        self.assertEqual(casos.archivo(self.raiz, "citilab", 2).read_text(), ejecutor.valor_independiente)
        self.assertEqual(estado.leer_estado(self.raiz)["clasificaciones"]["ultima_version_buena"], self.ultima_buena)

    def test_reparacion_real_vuelve_a_acreditar_compatibilidad(self) -> None:
        """Una validación y publicación nuevas reparan el rojo y permiten sus consumidores."""
        self.crear_incompatibilidad()
        resultado = self.ejecutar(EjecutorIndependiente(falla=False, cambia=False))
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, estado.VERDE)
        self.assertEqual(resultado.resultados["cambra"].veredicto, estado.VERDE)
        self.assertEqual(casos.archivo(self.raiz, "clasificaciones", 2).read_text(), "nueva")
        self.assertEqual(casos.archivo(self.raiz, "cambra", 2).read_text(), "nueva")
        self.paquete.assert_called_once()

    def test_rechazo_del_lector_de_estado_se_propaga_antes_de_fuentes(self) -> None:
        """Un contrato rechazado no se transforma en estado vacío ni permite olvidar el rojo."""
        ejecutor = EjecutorIndependiente()
        with (
            mock.patch.object(
                actualizar, "leer_estado", create=True, side_effect=FormatoInesperado("versión no admitida")
            ),
            self.assertRaisesRegex(FormatoInesperado, "versión no admitida"),
        ):
            self.ejecutar(ejecutor)
        self.assertEqual(ejecutor.ordenes, [])
        self.paquete.assert_not_called()

    def test_hijo_rojo_no_ejecuta_e_independiente_publica(self) -> None:
        """Clasificaciones roja bloquea Cambra sin impedir la publicación independiente."""
        ejecutor = EjecutorIndependiente(falla=True, cambia=True)
        resultado = self.ejecutar(ejecutor)
        self.assertEqual(resultado.resultados["cambra"].veredicto, estado.ROJO)
        self.assertFalse(any(nombre == "cambra" for nombre, _etapa in ejecutor.ordenes))
        self.assertIn("clasificaciones", resultado.resultados["cambra"].motivo)
        self.assertEqual(casos.archivo(self.raiz, "cambra", 2).read_text(), "vigente")
        self.assertEqual(resultado.resultados["citilab"].veredicto, estado.VERDE)
        self.assertIsNotNone(resultado.resultados["citilab"].publicado)
        self.paquete.assert_not_called()

    def test_hijo_seleccionado_no_lee_rojo_anterior_omitido(self) -> None:
        """El bloqueo heredado sigue vigente aunque no se seleccione la entrada roja."""
        self.crear_incompatibilidad()
        anterior = estado.leer_estado(self.raiz)["clasificaciones"]
        ejecutor = EjecutorIndependiente(falla=False, cambia=False)
        resultado = self.ejecutar(ejecutor, solo=("cambra",))
        self.assertEqual(resultado.resultados["cambra"].veredicto, estado.ROJO)
        self.assertEqual(ejecutor.ordenes, [])
        self.assertEqual(estado.leer_estado(self.raiz)["clasificaciones"], anterior)
        self.paquete.assert_not_called()

    def test_rojo_transitivo_no_fabrica_intento_del_intermedio_omitido(self) -> None:
        """OIT roja bloquea Cambra a través de clasificaciones omitida sin ejecutar ninguna."""
        intento = estado.Intento(datetime(2025, 10, 2, tzinfo=UTC), estado.ROJO, self.raiz / "fallo.json")
        estado.registrar_estado(
            self.raiz,
            {"oit": estado.ResultadoDelModulo(estado.ROJO, "incompatibilidad previa")},
            intento,
            lambda *_args: None,
        )
        anterior = estado.leer_estado(self.raiz)["clasificaciones"]
        ejecutor = EjecutorIndependiente(falla=False, cambia=False)
        resultado = self.ejecutar(ejecutor, solo=("cambra",))
        self.assertEqual(resultado.resultados["cambra"].veredicto, estado.ROJO)
        self.assertEqual(ejecutor.ordenes, [])
        self.assertNotIn("clasificaciones", resultado.resultados)
        self.assertEqual(estado.leer_estado(self.raiz)["clasificaciones"], anterior)
        self.paquete.assert_not_called()

    def test_recuperacion_de_area_incompleta_para_independiente(self) -> None:
        """Un área compartida que no se restaura continúa parando también Citilab."""
        restaurar = actualizar.restaurar
        rutas_fallidas = carpetas(casos.POR_ID["clasificaciones"])

        def fallar(raiz: Path, area: Path, rutas: tuple[str, ...]) -> None:
            if rutas == rutas_fallidas:
                raise OSError("restauración incompleta simulada")
            restaurar(raiz, area, rutas)

        ejecutor = EjecutorIndependiente(falla=True, cambia=True)
        with mock.patch.object(actualizar, "restaurar", fallar):
            resultado = self.ejecutar(ejecutor)
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, estado.ROJO)
        self.assertNotIn("citilab", resultado.resultados)
        self.assertFalse(any(nombre == "citilab" for nombre, _etapa in ejecutor.ordenes))
        self.assertEqual(casos.archivo(self.raiz, "citilab", 2).read_text(), "vigente")
        self.paquete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
