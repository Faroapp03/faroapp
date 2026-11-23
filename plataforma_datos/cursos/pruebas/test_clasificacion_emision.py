"""El productor pregunta a cada fuente por la clasificación de sus ofertas y la emite en el catálogo.

La paridad con lo que veía la persona el 18/11 es una foto del paquete: está en `test_clasificacion_paridad_foto.py`.
"""

import json
import unittest
from collections.abc import Sequence
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.clasificacion import emision, paridad, registro
from plataforma_datos.cursos.clasificacion.contrato import Clasificacion, DatoClasificado, Evidencia

# El módulo, no la clase: así sus pruebas no se ejecutan otra vez aquí.
from plataforma_datos.cursos.pruebas import test_entrega_catalogo as pruebas_entrega
from plataforma_datos.cursos.tipos_json import ObjetoJson

CURSOS = Path(registro.__file__).resolve().parents[1]


def idioma_de_la_edicion(oferta: ObjetoJson, evidencias: Sequence[Evidencia]) -> Clasificacion:
    """Un clasificador de prueba que afirma «ca» como dato de la fuente, apoyado en la primera captura de la oferta.

    Returns:
        La clasificación con el idioma y la materia por confirmar.
    """
    return Clasificacion(
        idioma=DatoClasificado(
            valores=("ca",), estado="fuente", alcance="edicion", certeza="alta", evidencias=(evidencias[0],)
        ),
        materia=DatoClasificado(estado="por-confirmar", motivo_por_confirmar="sin_captura"),
    )


def con_clasificador(proveedor_id: str, clasificador: object) -> patch:
    """Registra un clasificador de prueba para un proveedor mientras dura el bloque `with`.

    Returns:
        El cambio temporal de la tabla.
    """
    return patch.multiple(
        registro,
        FUENTES={**registro.FUENTES, proveedor_id: "prueba"},
        CLASIFICADORES={**registro.CLASIFICADORES, "prueba": clasificador},
    )


class RegistroDeClasificadores(unittest.TestCase):
    """Una sola tabla explícita: cada proveedor del catálogo publicado tiene el clasificador de su fuente."""

    def test_cada_proveedor_publicado_tiene_clasificador(self) -> None:
        """Ningún proveedor del catálogo queda fuera de la tabla."""
        proveedores = {o["proveedor_id"] for o in paridad.catalogo_publicado()["ofertas"]}
        self.assertEqual(proveedores - set(registro.FUENTES), set())
        for proveedor in proveedores:
            self.assertIsNotNone(registro.clasificador_de(proveedor), proveedor)

    def test_cada_fuente_tiene_su_archivo_y_ninguno_decide_todavia(self) -> None:
        """Las fuentes de la tabla son carpetas reales con su `clasificacion.py`, que hoy devuelve «sin bloque»."""
        self.assertEqual(set(registro.FUENTES.values()), set(registro.CLASIFICADORES))
        for fuente in registro.CLASIFICADORES:
            self.assertTrue((CURSOS / "fuentes" / fuente / "clasificacion.py").is_file(), fuente)
        for oferta in paridad.catalogo_publicado()["ofertas"]:
            self.assertIsNone(emision.clasificar_oferta(oferta, "2026-11-18T18:44:35Z"))

    def test_un_proveedor_sin_clasificador_viaja_sin_bloque(self) -> None:
        """La entrega no inventa clasificación para un proveedor que no está en la tabla."""
        self.assertIsNone(registro.clasificador_de("proveedor-desconocido"))

    def test_la_huella_cubre_todo_el_codigo_de_la_clasificacion(self) -> None:
        """Cada archivo de la clasificación existe y el paquete no tiene ninguno fuera de la huella."""
        for nombre in registro.CODIGO:
            self.assertTrue((CURSOS / nombre).is_file(), nombre)
        propios = {"clasificacion/" + p.name for p in (CURSOS / "clasificacion").glob("*.py")}
        # La paridad solo lee el catálogo publicado: no interviene en la entrega.
        self.assertEqual(propios - set(registro.CODIGO), {"clasificacion/paridad.py"})


class EmisionDelBloque(unittest.TestCase):
    """La proyección adjunta el bloque validado y emite la versión 7."""

    def setUp(self) -> None:
        """Prepara la entrega sintética de las pruebas de la proyección, con un recurso confirmado."""
        self.caso = pruebas_entrega.EntregaCatalogoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.confirmar_recurso()

    def test_sin_clasificacion_emite_la_7_con_las_ofertas_de_siempre(self) -> None:
        """Ninguna fuente decide: la entrega es la 7 sin ningún bloque y su huella incluye la clasificación."""
        publico = self.caso.admitir()
        self.assertEqual(publico["schema_version"], 7)
        self.assertEqual(contrato.VERSION, 7)
        self.assertTrue(publico["ofertas"])
        self.assertTrue(all("clasificacion" not in o for o in publico["ofertas"]))
        linaje = json.loads((self.caso.area / "validado" / "linaje-privado.json").read_bytes())
        codigo = linaje["entrada"]["codigo_proyeccion"]
        for nombre in registro.CODIGO:
            self.assertIn("plataforma_datos/cursos/" + nombre, codigo)

    def test_el_bloque_que_decide_la_fuente_viaja_validado(self) -> None:
        """El clasificador recibe las capturas de la oferta y su bloque entra en la entrega admitida."""
        proveedor = self.caso.admitir()["ofertas"][0]["proveedor_id"]
        with con_clasificador(proveedor, idioma_de_la_edicion):
            publico = self.caso.admitir()
        bloque = publico["ofertas"][0]["clasificacion"]
        self.assertEqual(bloque["idioma"]["valores"], ["ca"])
        self.assertEqual(bloque["idioma"]["evidencias"][0]["localizador"], emision.DOCUMENTO_ENTERO)
        self.assertEqual(bloque["materia"]["motivo_por_confirmar"], "sin_captura")
        contrato.validar_publico(publico)

    def test_un_resultado_ajeno_al_contrato_detiene_la_entrega(self) -> None:
        """Un clasificador que no devuelve una `Clasificacion` no publica nada a medias."""
        proveedor = self.caso.admitir()["ofertas"][0]["proveedor_id"]
        with con_clasificador(proveedor, lambda _oferta, _evidencias: {"idioma": {}}), self.assertRaises(ValueError):
            self.caso.admitir()

    def test_la_revision_se_calcula_con_el_bloque(self) -> None:
        """La revisión de la entrega cambia si una oferta lleva bloque, y no cambia si ninguna lo lleva."""
        publico = self.caso.admitir()
        self.assertEqual(emision.clasificar_entrega(publico), publico)
        with con_clasificador(publico["ofertas"][0]["proveedor_id"], idioma_de_la_edicion):
            clasificado = emision.clasificar_entrega(publico)
        self.assertNotEqual(clasificado["revision"], publico["revision"])
        self.assertNotIn("clasificacion", publico["ofertas"][0])


if __name__ == "__main__":
    unittest.main()
