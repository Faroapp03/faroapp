"""Foto de la paridad de la clasificación con lo que veía la persona el 18/11 (`foto-clasificacion-20261118.utf8`).

Compara el catálogo publicado, unidad a unidad, con la foto de aquel día: solo vale con aquel paquete, así que es una
foto del paquete y la comprobación del ciclo no la ejecuta. Lo que vale con cualquier catálogo está en
`test_clasificacion_emision.py`.
"""

import copy
import json
import unittest

from plataforma_datos.comun.pruebas.foto_del_paquete import foto_del_paquete
from plataforma_datos.cursos.clasificacion import paridad

# El módulo, no sus clases: así sus pruebas no se ejecutan otra vez aquí.
from plataforma_datos.cursos.pruebas import test_clasificacion_emision as clasificadores


@foto_del_paquete(
    catalogo="7bc6f1d393a90aca7dd3f46156c533e32a47a46c8f216041c3e0a5a97bc8a018",
    regenerar=(
        "regenera antes la foto de la clasificación como indica pruebas/herramientas/foto-clasificacion.test.ts y "
        "después su referencia con .venv/bin/python -m plataforma_datos.cursos.clasificacion.paridad > "
        "pruebas/fixtures/paridad-clasificacion.json"
    ),
)
class ParidadConLaFoto(unittest.TestCase):
    """La paridad de hoy coincide con su referencia y distingue igual, distinto y sin decidir."""

    def test_la_paridad_de_hoy_es_la_de_su_referencia(self) -> None:
        """Con los clasificadores de hoy, todo está «sin decidir»; cada lote verá su avance en la referencia."""
        hoy = paridad.paridad_de_hoy()
        self.assertEqual(paridad.texto(hoy), paridad.REFERENCIA.read_text(encoding="utf-8"))
        self.assertEqual(paridad.main(["--comprobar"]), 0)
        for fuente, datos in hoy.items():
            self.assertEqual(datos["distintos"], [], fuente)
            for nombre, recuento in datos["recuentos"].items():
                self.assertEqual(recuento["igual"] + recuento["distinto"], 0, fuente + " " + nombre)

    def test_cada_origen_de_la_foto_tiene_correspondencia(self) -> None:
        """La foto no tiene ningún origen que el contrato no sepa leer."""
        foto = json.loads(paridad.FOTO.read_text(encoding="utf-8"))
        for unidad in foto["unidades"]["cursos"]:
            for nombre in paridad.DATOS:
                dato = unidad["datos"][nombre]
                origen = dato["origen"] if dato["estado"] != "por-confirmar" else None
                self.assertIn((nombre, origen), paridad.CORRESPONDENCIA)

    def test_una_fuente_que_decide_ve_sus_iguales_y_sus_distintos_sin_tocar_a_las_demas(self) -> None:
        """Afirmar «ca» de edición en Cibernàrium coincide donde la web muestra «ca» de edición; el resto, distinto."""
        antes = paridad.paridad_de_hoy()
        with clasificadores.con_clasificador("cibernarium", clasificadores.idioma_de_la_edicion):
            ahora = paridad.paridad_de_hoy()
        idioma = ahora["cibernarium"]["recuentos"]["idioma"]
        self.assertGreater(idioma["igual"], 0)
        self.assertGreater(idioma["distinto"], 0)
        self.assertEqual(idioma["igual"] + idioma["distinto"], 313)
        self.assertEqual(
            len([d for d in ahora["cibernarium"]["distintos"] if d["dato"] == "idioma"]), idioma["distinto"]
        )
        materia = ahora["cibernarium"]["recuentos"]["materia"]
        self.assertEqual(materia["distinto"], 313)
        ejemplo = ahora["cibernarium"]["distintos"][0]
        self.assertEqual(set(ejemplo), {"clave", "dato", "foto", "productor"})
        otras = {f: d for f, d in ahora.items() if f != "cibernarium"}
        self.assertEqual(otras, {f: d for f, d in antes.items() if f != "cibernarium"})

    def test_un_origen_desconocido_detiene_la_comparacion(self) -> None:
        """Si la foto anota un origen nuevo, hay que decidir antes cómo se lee en el contrato."""
        foto = json.loads(paridad.FOTO.read_text(encoding="utf-8"))
        foto = copy.deepcopy(foto)
        foto["unidades"]["cursos"][0]["datos"]["idioma"]["origen"] = "origen-nuevo"
        with self.assertRaises(ValueError):
            paridad.paridad(paridad.catalogo_publicado(), foto)


if __name__ == "__main__":
    unittest.main()
