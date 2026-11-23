"""Las lecturas que una fuente emite en un ciclo sobreviven aunque su módulo falle y el área vuelva a lo publicado."""

import io
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from pathlib import Path

from plataforma_datos.cursos.lecturas.almacen_lecturas import guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.pruebas import ejemplos
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.pruebas import test_actualizacion_dependientes as fixtures

MODULO = fixtures.POR_ID["oit"]
# El nombre de la carpeta validada de la fuente del módulo, que también nombra su almacén de lecturas.
FUENTE = Path(actualizar.carpetas(MODULO)[2]).name
LECTURA = ejemplos.primera(fuente=FUENTE, ambito="prueba")
# Un archivo con nombre de lectura y contenido cortado: lo que dejaría una escritura ajena rota.
ROTO = f"{'0' * 64}.json"


class RestauracionConLecturasPruebas(unittest.TestCase):
    """Un módulo real del registro de pruebas, con datos sintéticos, sin procesos ni red."""

    def setUp(self) -> None:
        """Monta los módulos del fixture con su raíz publicada y su área."""
        self.caso = fixtures.PruebaActualizacionDependientes()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz, self.area = self.caso.caso()
        self.base = fixtures.EjecutorDependencias()
        self.roto = False

    def ejecutor(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """La validación de la fuente emite su lectura, deja un dato no admitido y termina en rojo.

        Returns:
            Fallo en la validación de la fuente del módulo; éxito en las demás órdenes.
        """
        if etapa_de_fuente(orden) == ("oit", "validar"):
            ruta = guardar_lectura(area, LECTURA)
            if self.roto:
                (ruta.parent / ROTO).write_text("{", encoding="utf-8")
            fixtures.archivo(area, "oit", 2).write_text("no admitido", encoding="utf-8")
            return actualizar.Resultado(1, "la captura no valida")
        return self.base(orden, area)

    def ejecutar(self, *, ensayo: bool) -> actualizar.ResultadoDelModulo:
        """Ejecuta el módulo entero por su camino real de fallo.

        Returns:
            El resultado del módulo.
        """
        opciones = actualizar.Opciones(area=self.area, pausa=0, reintento=0, ensayo=ensayo)
        with redirect_stdout(io.StringIO()):
            _pasos, resultado = actualizar.ejecutar_modulo(self.raiz, self.area, MODULO, self.ejecutor, opciones)
        return resultado

    def test_modulo_en_ambar_conserva_la_lectura_del_dia_y_restaura_lo_demas(self) -> None:
        """La lectura pasa a lo publicado; el dato no admitido no, y el área queda igual que lo publicado."""
        resultado = self.ejecutar(ensayo=False)
        self.assertEqual(resultado.veredicto, actualizar.AMBAR)
        self.assertEqual(listar_lecturas(self.raiz, FUENTE), [LECTURA.a_json()])
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 2).read_text(encoding="utf-8"), "vigente")
        self.assertEqual(
            actualizar.huella(self.area, actualizar.carpetas(MODULO)),
            actualizar.huella(self.raiz, actualizar.carpetas(MODULO)),
        )

    def test_un_ensayo_no_publica_ni_las_lecturas(self) -> None:
        """En un ensayo no se publica nada: la lectura del módulo que falla tampoco llega a lo publicado."""
        resultado = self.ejecutar(ensayo=True)
        self.assertEqual(resultado.veredicto, actualizar.AMBAR)
        self.assertEqual(listar_lecturas(self.raiz, FUENTE), [])

    def test_restaurar_sin_conservar_deja_el_area_exactamente_como_lo_publicado(self) -> None:
        """Las demás restauraciones (revalidar, errores internos) siguen devolviendo el área tal cual a lo publicado."""
        guardar_lectura(self.area, LECTURA)
        actualizar.restaurar(self.raiz, self.area, actualizar.carpetas(MODULO))
        self.assertEqual(listar_lecturas(self.area, FUENTE), [])
        self.assertEqual(listar_lecturas(self.raiz, FUENTE), [])

    def test_una_lectura_ilegible_no_detiene_la_ronda_y_queda_dicha(self) -> None:
        """Con una lectura buena y un archivo roto, la buena se conserva, el roto no y el motivo del módulo lo dice."""
        self.roto = True
        resultado = self.ejecutar(ensayo=False)
        self.assertEqual(resultado.veredicto, actualizar.AMBAR)
        self.assertEqual(listar_lecturas(self.raiz, FUENTE), [LECTURA.a_json()])
        self.assertIn("lecturas ilegibles no conservadas", resultado.motivo)
        self.assertIn(f"validados/{FUENTE}/lecturas/{ROTO}", resultado.motivo)
        self.assertFalse((self.raiz / actualizar.carpetas(MODULO)[2] / "lecturas" / ROTO).exists())
        self.assertEqual(
            actualizar.huella(self.area, actualizar.carpetas(MODULO)),
            actualizar.huella(self.raiz, actualizar.carpetas(MODULO)),
        )


if __name__ == "__main__":
    unittest.main()
