"""Canales propios de una fuente: la admisión no pisa otros conjuntos ni se rejuvenece."""

import copy
import json
import shutil
import unittest
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.cursos import identidades_de_admision
from plataforma_datos.cursos import operacion_fuente as operacion
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as ejemplo_cibernarium
from plataforma_datos.cursos.pruebas import test_fundae_operacion_catalogos as ejemplo_fundae


class CanalesCatalogoPruebas(unittest.TestCase):
    """Recepciones sintéticas con admisión y lectura reales, sin transporte."""

    def setUp(self) -> None:
        """Monta un canal y un conjunto previo independiente en una única casa."""
        fixture = ejemplo_fundae.CatalogosFundaePruebas()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.raiz = fixture.raiz / "instalacion"
        self.original, self.preparado, self.validado = operacion.rutas_de_la_fuente("fundae", self.raiz)
        self.original.mkdir(parents=True)
        for p in fixture.raiz.iterdir():
            if p.is_file():
                shutil.copy2(p, self.original / p.name)
        self.documento = fixture.documento
        guardar_json(self.original / "procedencia.json", self.documento)
        guardar_json(self.original.parent / "procedencia.json", {"archivos": [], "consulta": "2026-10-21"})
        guardar_json(self.validado.parent / "fundae.json", {"ediciones": ["edicion-conservada"]})
        guardar_json(self.validado.parent / "validacion.json", {"estado": "Admitido", "fecha": "2026-10-21"})
        self.previos = {p: p.read_bytes() for p in self.validado.parent.iterdir() if p.is_file()}
        for nombre, valor in (("RAIZ", self.raiz), ("conocidos", lambda *_args: fixture.conocidos)):
            parche = patch.object(operacion, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)

    def test_listas_de_proveedores_retirados_del_censo_actual_y_anterior_entran_en_el_indice(self) -> None:
        """El exportador debe poder obtener las dos capturas de bajas desde la procedencia principal."""
        antiguo = self.documento["auxiliares"]["catalogos"]
        nuevo = self.documento["auxiliares"]["digitalizate"]
        operacion.guardar_capturas_de_fuente(
            self.original, "fundae", [], {"censo": {"empresas_baja": antiguo}}, censo={"empresas_baja": nuevo}
        )
        operacion.enlazar_canal("fundae", self.raiz)
        padre = json.loads((self.original.parent / "procedencia.json").read_bytes())
        enlaces = {r["archivo"]: r["sha256"] for r in padre["canales_operativos"]["catalogos"]}
        for captura in (antiguo, nuevo):
            for ref in operacion.referencias_de_captura(captura):
                self.assertEqual(enlaces.get("catalogos/" + ref["archivo"]), ref["sha256"])

    def test_material_con_enlace_mal_formado_se_conserva_sin_destino(self) -> None:
        """Un enlace publicado ilegible no impide guardar la identidad del programa censado."""
        programa = {"id": "presente", "datos": {"material_publicado": {"moodleLink": "https://[incompleto"}}}
        informe = identidades_de_admision.sellar("cibervoluntarios", [programa])
        self.assertEqual(
            identidades_de_admision.leer("cibervoluntarios", informe),
            [{"id": "presente", "datos": {"material_publicado": {"moodleLink": None}}}],
        )

    def admitir(self) -> dict:
        """Ejecuta las dos etapas del canal y su lectura admitida.

        Returns:
            Conjunto de los tres índices públicos sintéticos.
        """
        operacion.preparar("fundae", raiz=self.raiz)
        operacion.validar("fundae", raiz=self.raiz)
        return operacion.leer_validado("fundae", self.raiz)

    def test_admision_y_procedencia_no_pisan_ediciones(self) -> None:
        """Una casa mantiene sus conjuntos y registra los originales de su canal."""
        self.documento["historial"] = [
            r for cap in self.documento["auxiliares"].values() for r in cap.values() if isinstance(r, dict)
        ]
        guardar_json(self.original / "procedencia.json", self.documento)
        operacion.enlazar_canal("fundae", self.raiz)
        documento = json.loads((self.original.parent / "procedencia.json").read_bytes())
        self.assertEqual(documento["consulta"], "2026-10-21")
        self.assertTrue(
            all(r["archivo"].startswith("catalogos/") for r in documento["canales_operativos"]["catalogos"])
        )
        self.assertEqual(self.admitir()["cobertura"], {"catalogos": 2, "digitalizate": 1, "subvencionada": 1})
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)

    def test_indice_posterior_fallido_no_cambia_la_lectura_admitida(self) -> None:
        """El intento nuevo conserva el índice anterior admitido y todas sus fechas."""
        admitido = self.admitir()
        documento = copy.deepcopy(self.documento)
        documento["auxiliares"] = {}
        guardar_json(self.original / "procedencia.json", documento)
        self.assertEqual(operacion.leer_validado("fundae", self.raiz), admitido)
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)

    def test_el_censo_se_reproduce_con_las_identidades_de_la_admision(self) -> None:
        """Una composición posterior puede cambiar los programas que se conocían al consultar."""
        admitido = self.admitir()
        with patch.object(operacion, "conocidos", side_effect=AssertionError("Lectura del catálogo posterior")):
            self.assertEqual(operacion.leer_validado("fundae", self.raiz), admitido)

        informe = json.loads((self.validado / "validacion.json").read_bytes())
        informe["identidades_del_calculo"]["programas"]["programas"].pop()
        guardar_json(self.validado / "validacion.json", informe)
        with self.assertRaises(FormatoInesperado):
            operacion.leer_validado("fundae", self.raiz)

    def test_un_contexto_ajeno_o_malformado_no_admite_el_censo(self) -> None:
        """Incluso una huella correcta debe identificar los programas del tipo y fuente declarados."""
        for fuente, indebido in (("fundae", []), ("barcelonactiva", {}), ("cibervoluntarios", {})):
            with self.subTest(fuente=fuente), self.assertRaises(FormatoInesperado):
                contexto = {"version": 1, "fuente": fuente, "programas": indebido}
                informe = {"identidades_del_calculo": contexto, "identidades_sha256": sha256_json(contexto)}
                identidades_de_admision.leer(fuente, informe)
        sello = identidades_de_admision.sellar("barcelonactiva", [])
        with self.assertRaises(FormatoInesperado):
            identidades_de_admision.leer("cibervoluntarios", sello)

    def test_la_admision_historica_se_relee_con_el_contrato_original(self) -> None:
        """En el formato previo el informe aún no citaba las identidades del cálculo."""
        admitido = self.admitir()
        ruta = self.validado / "validacion.json"
        informe = json.loads(ruta.read_bytes())
        del informe["identidades_sha256"]
        del informe["identidades_del_calculo"]
        guardar_json(ruta, informe)
        self.assertEqual(operacion.leer_validado("fundae", self.raiz), admitido)

    def test_controles_incompletos_no_admiten_el_canal(self) -> None:
        """Tres canales declarados no equivalen a tres respuestas válidas."""
        calculado = operacion.calcular_recepciones_de_fuente("fundae", self.raiz)
        calculado["fallos"] = [{"canal": "subvencionada", "http": 503}]
        guardar_json(self.preparado / "recepciones.json", calculado)
        with (
            patch.object(operacion, "calcular_recepciones_de_fuente", return_value=calculado),
            self.assertRaises(ValidacionFallida),
        ):
            operacion.validar("fundae", raiz=self.raiz)
        self.assertFalse((self.validado / "fundae.json").exists())
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)


class CanalCibernariumPruebas(unittest.TestCase):
    """El canal de cursos conserva intacta la admisión ocupacional de su casa."""

    def setUp(self) -> None:
        """Usa dos páginas sintéticas y la admisión común sin simular controles."""
        fixture = ejemplo_cibernarium.AdquisicionCibernarium()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.raiz = fixture.raiz
        self.original, self.preparado, self.validado = operacion.rutas_de_la_fuente("barcelonactiva", self.raiz)
        self.documento = fixture.doc
        guardar_json(self.validado.parent / "barcelonactiva.json", {"ocupaciones": ["registro-conservado"]})
        guardar_json(self.validado.parent / "validacion.json", {"estado": "Admitido", "fecha": "2026-10-21"})
        self.previos = {p: p.read_bytes() for p in self.validado.parent.iterdir() if p.is_file()}
        conocidos = [{"id": "cibernarium:" + str(i), "titulo": "Activitat " + str(i)} for i in range(1, 17)]
        for nombre, valor in (("RAIZ", self.raiz), ("conocidos", lambda *_args: conocidos)):
            parche = patch.object(operacion, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)

    def admitir(self) -> dict:
        """Admite el censo por su contrato y lo relee desde los recibos conservados.

        Returns:
            Conjunto privado del canal Cibernàrium, sin atribuir disponibilidad.
        """
        operacion.preparar("barcelonactiva", raiz=self.raiz)
        operacion.validar("barcelonactiva", raiz=self.raiz)
        return operacion.leer_validado("barcelonactiva", self.raiz)

    def test_censo_admitido_no_sustituye_ocupaciones(self) -> None:
        """Admite las páginas completas sin escribir el conjunto de ocupaciones."""
        admitido = self.admitir()
        self.assertEqual(len(admitido["censo"]["actividades"]), 16)
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)
        self.assertIsNone(admitido["publicacion_confirmada"])

    def test_intento_nuevo_fallido_conserva_censo_y_fechas_admitidos(self) -> None:
        """El último índice de descarga no sustituye la selección previamente admitida."""
        admitido = self.admitir()
        guardar_json(self.original / "procedencia.json", {"fallo": "posterior"})
        self.assertEqual(operacion.leer_validado("barcelonactiva", self.raiz), admitido)
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)

    def test_el_censo_admitido_conserva_su_lista_de_programas(self) -> None:
        """Las altas posteriores conservan la cobertura histórica del censo de Cibernàrium."""
        admitido = self.admitir()
        with patch.object(operacion, "conocidos", return_value=[]):
            self.assertEqual(operacion.leer_validado("barcelonactiva", self.raiz), admitido)

    def test_censo_incompleto_no_se_admite(self) -> None:
        """Una extracción parcial no se convierte en una versión válida del canal."""
        calculado = operacion.calcular_recepciones_de_fuente("barcelonactiva", self.raiz)
        calculado["censo_completo"] = False
        guardar_json(self.preparado / "recepciones.json", calculado)
        with (
            patch.object(operacion, "calcular_recepciones_de_fuente", return_value=calculado),
            self.assertRaises(ValidacionFallida),
        ):
            operacion.validar("barcelonactiva", raiz=self.raiz)
        self.assertFalse((self.validado / "barcelonactiva.json").exists())
        self.assertEqual({p: p.read_bytes() for p in self.previos}, self.previos)


if __name__ == "__main__":
    unittest.main()
