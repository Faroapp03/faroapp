"""Evidencias por encima del umbral de trozos: la admisión y la preparación HP las reconocen como el mismo cuerpo.

El almacén guarda por trozos todo cuerpo de más de `trozos_catalogo.UMBRAL` (procedencia incluida), y una ficha HP
admite hasta 8 MiB. Antes, la admisión verificaba la procedencia byte a byte contra el manifiesto y la preparación HP
tomaba por colisión la repetición de una ficha ya conservada por trozos.
"""

import hashlib
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import trozos_catalogo
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life import lotes_actualizacion as lotes
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.pruebas import test_hp_life_fallos_por_unidad as hp
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures

GRANDE = trozos_catalogo.UMBRAL + 512 * 1024


def _ref(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())


def _ficha_grande(texto: str) -> tuple[bytes, bytes]:
    """Una ficha HP válida de más de UMBRAL bytes.

    Returns:
        Cuerpo y recibo de la recepción.
    """
    dato = fixtures.negocio()
    dato["body"] = "<p>" + (texto + " ") * (GRANDE // (len(texto) + 1)) + "</p>"
    return fixtures.recepcion(dato)


class EvidenciasGrandesPruebas(unittest.TestCase):
    """Piezas reales del almacén, la admisión y la preparación HP sobre carpetas temporales."""

    def setUp(self) -> None:
        """Carpeta de trabajo propia, con espacios y Unicode."""
        temporal = tempfile.TemporaryDirectory(prefix="Evidencias grandes Año ")
        self.addCleanup(temporal.cleanup)
        self.trabajo = Path(temporal.name)

    def test_almacen_admite_procedencia_conservada_por_trozos(self) -> None:
        """Conservar una admisión con procedencia grande deja un manifiesto y la nueva casa se admite."""
        caso = hp.FallosPorUnidadHpPruebas("test_url_fallida_conserva_su_confirmacion_y_las_demas_se_confirman")
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        instalada = almacen.solicitud(caso.raiz / almacen.RUTA)
        grande = self.trabajo / "procedencia-grande.bin"
        grande.write_bytes(_ficha_grande("procedencia")[0])
        entrada = admision.SolicitudAdmision(
            snapshot=instalada.snapshot,
            procedencia={**instalada.procedencia, "grande": _ref(grande)},
            indices_evidencias=instalada.indices_evidencias,
            validacion_destino=self.trabajo / "validacion.json",
        )
        admision.admitir_snapshot(entrada)
        destino = self.trabajo / "casa" / almacen.RUTA
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=_ref(entrada.validacion_destino).sha256),
            destino=destino,
        )
        conservada = almacen.solicitud(destino).procedencia["grande"]
        self.assertIsNotNone(trozos_catalogo.manifiesto_de(conservada.ruta, conservada.sha256, limite=GRANDE * 2))
        self.assertEqual(
            trozos_catalogo.leer(conservada.ruta, conservada.sha256, limite=GRANDE * 2), grande.read_bytes()
        )

    def test_ficha_hp_repetida_sobre_su_manifiesto_no_es_colision(self) -> None:
        """La misma ficha ya conservada por trozos se reconoce; otra ficha en esa ruta sigue siendo colisión."""
        recepcion = leer_recepcion(*_ficha_grande("curso"))
        destino = self.trabajo / "evidencias"
        primera = lotes.conservar_recepcion(recepcion, destino)
        cuerpo = destino / primera[0]["archivo"]
        self.assertTrue(trozos_catalogo.migrar_archivo(cuerpo, primera[0]["sha256"]))
        self.assertEqual(lotes.conservar_recepcion(recepcion, destino), primera)
        otra = leer_recepcion(*_ficha_grande("distinto"))
        cuerpo.with_name(otra.captura.sha256_cuerpo + ".body").write_bytes(cuerpo.read_bytes())
        with self.assertRaises(lector.ErrorFichaHpLife):
            lotes.conservar_recepcion(otra, destino)


if __name__ == "__main__":
    unittest.main()
