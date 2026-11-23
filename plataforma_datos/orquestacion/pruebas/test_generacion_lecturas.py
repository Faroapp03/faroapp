"""Caracterización: las lecturas de cada fuente viajan en la generación que el ciclo archiva y recupera.

La generación traslada entera la carpeta validada de cada fuente admitida (`generacion_operativa._carpetas_fuentes`,
que recorre su árbol completo con `archivos_de_generacion._arbol`), así que `validados/<fuente>/lecturas/` llega al
ciclo siguiente sin declararla aparte. Una fuente que nunca se ha admitido solo puede tener en su carpeta validada
sus lecturas: así se registra su censo desde el primer día, también antes de admitir ninguna versión.
"""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas.almacen_lecturas import guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.pruebas import ejemplos
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.archivos_de_generacion import GeneracionInvalida
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar

# Fuentes de cursos que la generación sintética da por admitidas.
FUENTES_ADMITIDAS = {"barcelonactiva": "cibernarium:edicion", "fundae": "preinscripcion:edicion", "formacion": "soc"}


class GeneracionLecturasPruebas(unittest.TestCase):
    """Exporta, restaura y vuelve a exportar una generación pequeña, sin red ni instalación real."""

    def setUp(self) -> None:
        """Una instalación sintética con una lectura de cada fuente admitida."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.raiz = self.area / "Origen"
        preparar(self.raiz)
        self.rutas = {}
        for fuente, ambito in FUENTES_ADMITIDAS.items():
            ruta = guardar_lectura(self.raiz, ejemplos.primera(fuente=fuente, ambito=ambito))
            self.rutas[fuente] = ruta.relative_to(self.raiz).as_posix()

    def archivar_y_recuperar(self, raiz: Path, nombre: str) -> tuple[Path, set[str]]:
        """Archiva la generación de una instalación y la recupera en una carpeta nueva, como entre dos ciclos.

        Returns:
            La instalación recuperada y las rutas que lista el manifiesto de la generación.
        """
        bundle, destino = self.area / f"generación {nombre}", self.area / f"Recuperada {nombre}"
        recibo = generacion.exportar_generacion(raiz, bundle, REVISION)
        manifiesto = json.loads((bundle / "manifiesto.json").read_bytes())
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        return destino, {registro["ruta"] for registro in manifiesto["archivos"]}

    def test_lecturas_viajan_y_se_recuperan_en_el_ciclo_siguiente(self) -> None:
        """Cada lectura entra en el manifiesto, vuelve con sus bytes y el ciclo siguiente añade la suya."""
        recuperada, archivadas = self.archivar_y_recuperar(self.raiz, "primera")
        for fuente, relativa in self.rutas.items():
            with self.subTest(fuente=fuente):
                self.assertIn(relativa, archivadas)
                self.assertEqual((recuperada / relativa).read_bytes(), (self.raiz / relativa).read_bytes())
                self.assertEqual(listar_lecturas(recuperada, fuente), listar_lecturas(self.raiz, fuente))
        guardar_lectura(recuperada, ejemplos.segunda())
        siguiente, _ = self.archivar_y_recuperar(recuperada, "segunda")
        lecturas = listar_lecturas(siguiente, ejemplos.FUENTE)
        self.assertEqual(lecturas, [ejemplos.primera().a_json(), ejemplos.segunda().a_json()])

    def test_lectura_de_una_fuente_nunca_admitida_viaja_en_la_generacion(self) -> None:
        """Sin versión admitida, una carpeta validada con solo lecturas no impide archivar, y la lectura llega."""
        ruta = guardar_lectura(self.raiz, ejemplos.primera(fuente="hp_life", ambito="catalogo"))
        recuperada, archivadas = self.archivar_y_recuperar(self.raiz, "nunca admitida")
        relativa = ruta.relative_to(self.raiz).as_posix()
        self.assertIn(relativa, archivadas)
        self.assertEqual((recuperada / relativa).read_bytes(), ruta.read_bytes())

    def test_otro_archivo_de_una_fuente_nunca_admitida_sigue_impidiendo_archivar(self) -> None:
        """Fuera de sus lecturas, la carpeta validada de una fuente sin versión admitida debe seguir vacía."""
        guardar_lectura(self.raiz, ejemplos.primera(fuente="hp_life", ambito="catalogo"))
        carpeta = self.raiz / "var/actualizacion/validados/hp_life"
        (carpeta / "hp_life.json").write_text("{}", encoding="utf-8")
        with self.assertRaises(GeneracionInvalida):
            generacion.exportar_generacion(self.raiz, self.area / "generación", REVISION)
        self.assertFalse((self.area / "generación").exists())

    def test_una_carpeta_lecturas_anidada_no_cuenta_como_la_de_la_fuente(self) -> None:
        """Solo vale la `lecturas/` que cuelga de la validada: `otra/lecturas/x.json` sigue impidiendo archivar."""
        anidada = self.raiz / "var/actualizacion/validados/hp_life/otra/lecturas"
        anidada.mkdir(parents=True)
        (anidada / "x.json").write_text("{}", encoding="utf-8")
        with self.assertRaises(GeneracionInvalida):
            generacion.exportar_generacion(self.raiz, self.area / "generación", REVISION)
        self.assertFalse((self.area / "generación").exists())


if __name__ == "__main__":
    unittest.main()
