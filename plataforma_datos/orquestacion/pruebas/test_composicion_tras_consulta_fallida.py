"""Una consulta fallida de una fuente del catálogo publica sus originales, pero no cambia el catálogo compuesto.

actualizar.ejecutar_modulo publica los originales de una fuente de FUENTES_CON_CATALOGO aunque su consulta falle, y
deja sus preparados y validados en la versión anterior. El candidato solo puede validarse en ámbar si la composición
de Cursos no lee esas recepciones nuevas: lee el conjunto admitido y los originales que este cita por su huella.
"""

import json
import shutil
import unittest

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.pruebas import test_componer_catalogo as fixtures


class ComposicionTrasConsultaFallida(unittest.TestCase):
    """Usa el ciclo vertical sin red de HP LIFE: un conjunto admitido, su SQLite común y su publicación."""

    def setUp(self) -> None:
        """Monta la fuente admitida del fixture de composición."""
        self.caso = fixtures.ComponerCatalogoPruebas(
            "test_fuente_real_controlada_llega_a_oferta_y_repetir_no_rejuvenece"
        )
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def test_recepciones_nuevas_sin_admitir_no_entran_en_el_catalogo(self) -> None:
        """Originales nuevos de una consulta que no llegó a validarse dejan igual la SQLite y la web."""
        raiz = self.caso.raiz
        componer.componer(raiz=raiz, corte_utc="2026-10-23T04:00:00Z")
        antes = self.caso.inventario()
        original, _, validado = fuente.rutas_de_la_fuente("hp_life", raiz)
        admitido = (validado / "validacion.json").read_bytes()
        nueva = self.caso.caso.guardar_recepcion(fecha="2026-10-24T03:00:00Z")
        procedencia = json.loads((original / "procedencia.json").read_bytes())
        fila = {"id": nueva.id}
        for clave, ref in (("cuerpo", nueva.cuerpo), ("recibo", nueva.recibo), ("intento", nueva.recibo)):
            shutil.copyfile(ref.ruta, original / ref.ruta.name)
            fila[clave] = {"archivo": ref.ruta.name, "sha256": ref.sha256}
        procedencia["capturas"].append(fila)
        procedencia["historial"].append(fila["intento"])
        entrada_salida.guardar_json(original / "procedencia.json", procedencia)
        componer.componer(raiz=raiz, corte_utc="2026-10-24T04:00:00Z")
        self.assertEqual((validado / "validacion.json").read_bytes(), admitido)
        self.assertEqual(self.caso.inventario(), antes)
        # Si cambia un original que el conjunto admitido sí cita, la composición se niega en lugar de mezclar.
        (original / self.caso.rx.cuerpo.ruta.name).write_bytes(b"otra respuesta")
        with self.assertRaises(FormatoInesperado):
            componer.componer(raiz=raiz, corte_utc="2026-10-24T05:00:00Z")
        self.assertEqual(self.caso.inventario(), antes)


if __name__ == "__main__":
    unittest.main()
