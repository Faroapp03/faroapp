"""La salida parcial de FUNDAE y del Cibernàrium llega al panel solo cuando tiene valor, con códigos cerrados."""

import re
import tempfile
import unittest
from pathlib import Path

import plataforma_datos.cursos.fuentes.barcelonactiva.lector as barcelonactiva
import plataforma_datos.cursos.fuentes.enlaces.lector as enlaces
import plataforma_datos.cursos.fuentes.fundae.lector as fundae
from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ
from plataforma_datos.cursos.componer_catalogo import CONJUNTO_SIN_APLICAR
from plataforma_datos.cursos.fuentes.barcelonactiva import ambitos, edicion_ia
from plataforma_datos.cursos.fuentes.cibervoluntarios import bajas as bajas_ciber
from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate, descarga
from plataforma_datos.cursos.fuentes.hp_life import bajas
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import MOTIVOS_SALIDA_PARCIAL, validar_salida_parcial
from plataforma_datos.orquestacion.estado_panel import salida_parcial


class SalidaParcialPanelPruebas(unittest.TestCase):
    """Del informe admitido de la fuente al campo del panel."""

    def setUp(self) -> None:
        """Una raíz temporal con la carpeta de validados."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)

    def informe(self, fuente: str, **campos: object) -> None:
        """Guarda la validación admitida de una fuente con esos campos."""
        guardar_json(
            self.raiz / DATOS_RELATIVOS / "validados" / fuente / "validacion.json", {"estado": "Admitido", **campos}
        )

    def test_motivos_descartes_y_avisos_viajan_con_sus_codigos(self) -> None:
        """FUNDAE con fichas fallidas y tope, dos descartes y un aviso; el Cibernàrium con su censo parcial."""
        self.informe(
            "fundae",
            consulta_parcial={"motivo": "fichas-fallidas, tope-de-consultas"},
            descartadas=[{"id": "1"}, {"id": "2"}],
            a_revisar=[{"codigo": "X"}],
        )
        self.informe("barcelonactiva", consulta_parcial={"motivo": "censo-ia-parcial"})
        self.assertEqual(
            salida_parcial(self.raiz, "fundae"),
            {"motivos": ["fichas-fallidas", "tope-de-consultas"], "descartadas": 2, "aRevisar": 1},
        )
        self.assertEqual(
            salida_parcial(self.raiz, "barcelonactiva"),
            {"motivos": ["censo-ia-parcial"], "descartadas": 0, "aRevisar": 0},
        )

    def test_sin_nada_que_decir_el_campo_no_viaja(self) -> None:
        """Una validación completa, una sin admitir, una fuente de otra casa o sin validación: None."""
        self.informe("fundae")
        guardar_json(
            self.raiz / DATOS_RELATIVOS / "validados" / "barcelonactiva" / "validacion.json", {"estado": "Con errores"}
        )
        for fuente in ("fundae", "barcelonactiva", "hp_life", "consorci"):
            with self.subTest(fuente):
                self.assertIsNone(salida_parcial(self.raiz, fuente))

    def test_un_motivo_libre_o_un_valor_vacio_no_se_admiten(self) -> None:
        """El validador del panel solo acepta códigos de la lista, sin repetir, y algo que decir."""
        for malo in (
            {"motivos": ["se cayó"], "descartadas": 0, "aRevisar": 0},
            {"motivos": ["indice-caido", "indice-caido"], "descartadas": 0, "aRevisar": 0},
            {"motivos": [], "descartadas": 0, "aRevisar": 0},
            {"motivos": [], "descartadas": 1},
        ):
            with self.subTest(malo=malo), self.assertRaises(ValueError):
                validar_salida_parcial(malo)

    def test_un_motivo_antiguo_de_un_informe_guardado_se_filtra_y_se_conserva_el_resto(self) -> None:
        """Un motivo que ya no está en la lista se quita; los conocidos, los descartes y los avisos siguen."""
        self.informe("fundae", consulta_parcial={"motivo": "otra-cosa, fichas-fallidas"}, descartadas=[{"id": "1"}])
        self.assertEqual(
            salida_parcial(self.raiz, "fundae"), {"motivos": ["fichas-fallidas"], "descartadas": 1, "aRevisar": 0}
        )
        self.informe("fundae", consulta_parcial={"motivo": "otra-cosa"})
        self.assertIsNone(salida_parcial(self.raiz, "fundae"))

    def test_la_lista_de_motivos_es_la_de_los_que_escriben_los_lectores(self) -> None:
        """Python y JS conocen exactamente los motivos que pueden escribir FUNDAE, el Cibernàrium y los enlaces."""
        escritos = (
            fundae.MOTIVOS
            | descarga.MOTIVOS
            | barcelonactiva.MOTIVOS
            | ambitos.MOTIVOS
            | edicion_ia.MOTIVOS
            | censo_digitalizate.MOTIVOS
            | bajas.MOTIVOS
            | bajas_ciber.MOTIVOS
            | {CONJUNTO_SIN_APLICAR}
            | enlaces.MOTIVOS
        )
        self.assertEqual(MOTIVOS_SALIDA_PARCIAL, escritos)
        fuente_js = (RAIZ / "src/administracion/estado-datos.js").read_text(encoding="utf-8")
        lista_js = re.search(r"const MOTIVOS_SALIDA_PARCIAL = \[(.*?)\];", fuente_js, re.DOTALL)
        self.assertIsNotNone(lista_js)
        self.assertEqual(set(re.findall(r"'([a-z-]+)'", lista_js.group(1))), escritos)

    def test_los_avisos_de_hp_life_llegan_con_su_codigo(self) -> None:
        """El listado sin completar y un curso con ficha íntegra fuera del listado se dicen una vez cada uno."""
        self.informe(
            "hp_life",
            avisos=[{"motivo": "indice-de-hp-life-sin-completar"}, {"motivo": "ficha-integra-fuera-del-listado"}],
        )
        self.assertEqual(
            salida_parcial(self.raiz, "hp_life"),
            {
                "motivos": ["ficha-integra-fuera-del-listado", "indice-de-hp-life-sin-completar"],
                "descartadas": 0,
                "aRevisar": 0,
            },
        )

    def test_los_avisos_de_cibervoluntarios_llegan_con_su_codigo(self) -> None:
        """Un curso ausente cuya página sigue en marcha y otro sin confirmar se dicen una vez cada uno."""
        self.informe(
            "cibervoluntarios",
            avisos=[
                {"motivo": "curso-fuera-del-catalogo-con-su-pagina"},
                {"motivo": "curso-fuera-del-catalogo-sin-confirmar"},
            ],
        )
        self.assertEqual(
            salida_parcial(self.raiz, "cibervoluntarios"),
            {
                "motivos": ["curso-fuera-del-catalogo-con-su-pagina", "curso-fuera-del-catalogo-sin-confirmar"],
                "descartadas": 0,
                "aRevisar": 0,
            },
        )

    def test_los_avisos_del_cibernarium_llegan_una_vez_por_motivo(self) -> None:
        """Plazas que no se pudieron leer y el cambio de portlet se dicen como motivos, sin repetir."""
        self.informe(
            "barcelonactiva",
            avisos=[
                {"id": "1", "motivo": "texto-de-plazas-desconocido"},
                {"id": "2", "motivo": "texto-de-plazas-desconocido"},
                {"id": None, "motivo": "portlet-cambiado"},
            ],
            descartadas=[{"id": "3"}],
        )
        self.assertEqual(
            salida_parcial(self.raiz, "barcelonactiva"),
            {"motivos": ["portlet-cambiado", "texto-de-plazas-desconocido"], "descartadas": 1, "aRevisar": 0},
        )


if __name__ == "__main__":
    unittest.main()
