"""Regresión de actualizaciones parciales sobre dependencias reales y publicaciones en disco."""

import io
import shutil
import tempfile
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

NOMBRES = ("oit", "clasificaciones", "cambra", "citilab")
REGISTRO = tuple(modulo for modulo in MODULOS if modulo.id in NOMBRES)
POR_ID = {modulo.id: modulo for modulo in REGISTRO}


def archivo(raiz: Path, nombre: str, etapa: int) -> Path:
    """Obtiene el archivo sintético de una carpeta operativa real.

    Returns:
        Archivo de originales, preparados o validados del módulo.
    """
    return raiz / carpetas(POR_ID[nombre])[etapa] / "dato.txt"


class EjecutorDependencias:
    """Simula solo órdenes de fuentes; preparar lee el dato validado de su entrada real."""

    def __init__(self, falla: bool = False, constante: bool = False, cambia: bool = True) -> None:
        self.falla = falla
        self.constante = constante
        self.cambia = cambia
        self.ordenes: list[tuple[str, str]] = []

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Ejecuta etapas en disco sin red ni subprocesos.

        Returns:
            Fallo solo en la validación configurada; éxito en las demás etapas.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is None:
            return actualizar.Resultado(0, "")
        nombre, etapa = identificada
        self.ordenes.append((nombre, etapa))
        if etapa == "descargar" and nombre == "oit" and self.cambia:
            archivo(area, nombre, 0).write_text("nueva", encoding="utf-8")
        elif etapa == "preparar":
            entradas = POR_ID[nombre].entradas
            entrada = archivo(area, entradas[0], 2) if entradas else archivo(area, nombre, 0)
            dato = "vigente" if nombre == "clasificaciones" and self.constante else entrada.read_text()
            archivo(area, nombre, 1).write_text(dato, encoding="utf-8")
        elif etapa == "validar":
            if nombre == "clasificaciones" and self.falla:
                return actualizar.Resultado(1, "no valida con la entrada nueva")
            archivo(area, nombre, 2).write_text(archivo(area, nombre, 1).read_text(), encoding="utf-8")
        return actualizar.Resultado(0, "")


class PruebaActualizacionDependientes(unittest.TestCase):
    """La selección parcial arrastra únicamente consumidores de publicaciones nuevas."""

    def setUp(self) -> None:
        """Prepara una raíz portable con la cadena OIT→clasificaciones→Cambra y Citilab independiente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "Mis documentos" / "Año 2026"

    def caso(self, nombre: str = "caso") -> tuple[Path, Path]:
        """Crea originales y derivados coherentes en un caso exclusivo.

        Returns:
            Raíz operativa y área externa copiada.
        """
        raiz, area = self.base / nombre / "raiz", self.base / nombre / "area"
        for modulo in REGISTRO:
            for etapa in range(len(carpetas(modulo))):
                ruta = archivo(raiz, modulo.id, etapa)
                ruta.parent.mkdir(parents=True)
                ruta.write_text("vigente", encoding="utf-8")
        (raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
        shutil.copytree(raiz, area)
        return raiz, area

    def ejecutar(
        self, caso: tuple[Path, Path], ejecutor: EjecutorDependencias, opciones: actualizar.Opciones
    ) -> dict[str, actualizar.ResultadoDelModulo]:
        """Usa el orquestador y las publicaciones reales con el registro acotado.

        Returns:
            Resultados de los módulos realmente ejecutados.
        """
        with mock.patch.object(actualizar, "MODULOS", REGISTRO), redirect_stdout(io.StringIO()):
            return actualizar.ejecutar_modulos(*caso, ejecutor, opciones)[1]

    def test_parcial_propaga_en_orden_sin_descargar_dependientes(self) -> None:
        """OIT nueva recompone ambos consumidores; Citilab y todos sus bytes quedan intactos."""
        caso = self.caso()
        antes = actualizar.huella(caso[0], carpetas(POR_ID["citilab"]))
        ejecutor = EjecutorDependencias()
        resultados = self.ejecutar(caso, ejecutor, actualizar.Opciones(solo=("oit",), pausa=0))
        self.assertEqual(list(resultados), list(NOMBRES[:-1]))
        self.assertEqual(
            ejecutor.ordenes,
            [("oit", "descargar"), ("oit", "preparar"), ("oit", "validar")]
            + [(nombre, etapa) for nombre in NOMBRES[1:-1] for etapa in ("preparar", "validar")],
        )
        for nombre in NOMBRES[:-1]:
            self.assertEqual(archivo(caso[0], nombre, 2).read_text(), "nueva")
            self.assertIsNotNone(resultados[nombre].publicado)
        self.assertEqual(actualizar.huella(caso[0], carpetas(POR_ID["citilab"])), antes)
        self.assertEqual(archivo(caso[0], "clasificaciones", 0).read_text(), "vigente")

    def test_sin_publicacion_no_arrastra_consumidores(self) -> None:
        """Una comprobación sin cambios no reconstruye módulos ajenos a la selección."""
        ejecutor = EjecutorDependencias(cambia=False)
        resultados = self.ejecutar(self.caso(), ejecutor, actualizar.Opciones(solo=("oit",), pausa=0))
        self.assertEqual(list(resultados), ["oit"])
        self.assertIsNone(resultados["oit"].publicado)

    def test_dependiente_sin_cambios_detiene_propagacion(self) -> None:
        """Repreparar B sin cambiar su publicación no obliga a ejecutar C."""
        ejecutor = EjecutorDependencias(constante=True)
        resultados = self.ejecutar(self.caso(), ejecutor, actualizar.Opciones(solo=("oit",), pausa=0))
        self.assertEqual(list(resultados), ["oit", "clasificaciones"])
        self.assertIsNone(resultados["clasificaciones"].publicado)
        self.assertNotIn(("cambra", "preparar"), ejecutor.ordenes)

    def test_dependiente_seleccionado_se_ejecuta_una_vez_con_su_politica(self) -> None:
        """Un consumidor seleccionado conserva descarga y etapas únicas; el siguiente solo se recompone."""
        ejecutor = EjecutorDependencias()
        self.ejecutar(self.caso(), ejecutor, actualizar.Opciones(solo=NOMBRES[:2], pausa=0))
        self.assertEqual(ejecutor.ordenes.count(("clasificaciones", "descargar")), 1)
        self.assertEqual(ejecutor.ordenes.count(("clasificaciones", "preparar")), 1)
        self.assertEqual(ejecutor.ordenes.count(("cambra", "preparar")), 1)
        self.assertNotIn(("cambra", "descargar"), ejecutor.ordenes)

    def test_fallo_dependiente_incompatible_impide_construir_paquete(self) -> None:
        """Si la versión conservada no valida con A nueva, el protocolo rojo bloquea el paquete."""
        raiz, area = self.caso()
        shutil.rmtree(area)
        ejecutor = EjecutorDependencias(falla=True)
        with (
            mock.patch.object(actualizar, "MODULOS", REGISTRO),
            mock.patch.object(
                actualizar,
                "ejecutar_paquete",
                return_value=(
                    [],
                    actualizar.Comparacion(None, [], []),
                    actualizar.ResultadoDelModulo(actualizar.VERDE),
                ),
            ) as paquete,
            redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(
                raiz, actualizar.Opciones(area=area, solo=("oit",), pausa=0), ejecutor
            )
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, actualizar.ROJO)
        self.assertEqual(ejecutor.ordenes.count(("clasificaciones", "validar")), 2)
        self.assertEqual(archivo(raiz, "clasificaciones", 2).read_text(), "vigente")
        paquete.assert_not_called()

    def test_ensayo_no_acredita_publicacion_ni_arrastra_omitidos(self) -> None:
        """Sin publicación real el ensayo parcial conserva su selección y la raíz intacta."""
        caso = self.caso()
        antes = actualizar.huella(caso[0], ("var/actualizacion/originales", "var/actualizacion/validados"))
        resultados = self.ejecutar(
            caso, EjecutorDependencias(), actualizar.Opciones(solo=("oit",), pausa=0, ensayo=True)
        )
        self.assertEqual(list(resultados), ["oit"])
        self.assertIsNone(resultados["oit"].publicado)
        self.assertEqual(
            actualizar.huella(caso[0], ("var/actualizacion/originales", "var/actualizacion/validados")), antes
        )

    def test_completa_conserva_orden_resultados_y_bytes(self) -> None:
        """La actualización completa equivale a seleccionar todos: mismas órdenes, publicaciones y datos."""
        completa, explicita = self.caso("completa"), self.caso("explicita")
        primero, segundo = EjecutorDependencias(), EjecutorDependencias()
        resultado = self.ejecutar(completa, primero, actualizar.Opciones(pausa=0))
        otro = self.ejecutar(explicita, segundo, actualizar.Opciones(solo=NOMBRES, pausa=0))
        self.assertEqual(resultado, otro)
        self.assertEqual(primero.ordenes, segundo.ordenes)
        self.assertEqual(list(resultado), list(NOMBRES))
        for modulo in REGISTRO:
            self.assertEqual(
                actualizar.huella(completa[0], carpetas(modulo)), actualizar.huella(explicita[0], carpetas(modulo))
            )


if __name__ == "__main__":
    unittest.main()
