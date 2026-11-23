"""Un grupo que la EPA no confirma se da en su gran grupo; si su gran grupo tampoco cuadra, la validación se detiene."""

import contextlib
import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, Controles
from plataforma_datos.ia_y_trabajo.fuentes.tich import reparto_con_la_epa as reparto
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_tich import catalogo
from plataforma_datos.orquestacion.ediciones_observadas import campos_del_panel

# Un gran grupo 2 con tres grupos: en la EPA, 40/40/20; en la TIC-H, el 26 tiene menos de la mitad de su cuota.
EPA = {"21": 40.0, "22": 40.0, "26": 20.0, "31": 50.0, "32": 50.0}
TICH = {"21": 45.0, "22": 47.0, "26": 8.0, "31": 50.0, "32": 50.0}


class PruebaRepartoConLaEpa(unittest.TestCase):
    """El grupo baja de nivel con su motivo y la edición sigue, salvo que su gran grupo no cuadre."""

    def test_un_grupo_fuera_de_la_regla_o_sin_cuota_baja_a_su_gran_grupo(self) -> None:
        """El 26 (×0,4) y un grupo sin cuota en la EPA bajan, cada uno con su motivo; los demás siguen a 2 cifras."""
        razones = reparto.razones_de_cuota(TICH, EPA)
        self.assertEqual(razones["26"], 0.4)
        bajados = reparto.grupos_a_su_gran_grupo(["21", "22", "26", "33"], razones)
        self.assertEqual(bajados, {"26": reparto.FUERA_DE_LA_REGLA, "33": reparto.SIN_CUOTA})

    def test_su_gran_grupo_tiene_que_tener_cifra_y_cumplir_la_regla(self) -> None:
        """Con el gran grupo en la regla pasa; sin cifra o fuera de la regla en el total de ocupados, se detiene."""
        bajados = {"26": reparto.FUERA_DE_LA_REGLA}
        controles = Controles()
        reparto.control_de_sus_grandes_grupos(controles, bajados, {"2", "3"}, TICH, EPA)
        self.assertTrue(controles.admitido, controles.fallidos)
        self.assertIn("se dan en su gran grupo", controles.lista[0]["control"])
        sin_cifra = Controles()
        reparto.control_de_sus_grandes_grupos(sin_cifra, bajados, {"3"}, TICH, EPA)
        self.assertTrue(any("sin cifra: ['2']" in fallo for fallo in sin_cifra.fallidos), sin_cifra.fallidos)
        desplazado = {"21": 4.5, "22": 4.7, "26": 0.8, "31": 50.0, "32": 50.0}
        fuera = Controles()
        reparto.control_de_sus_grandes_grupos(fuera, bajados, {"2", "3"}, desplazado, EPA)
        self.assertTrue(any("fuera: {'2'" in fallo for fallo in fuera.fallidos), fuera.fallidos)

    def test_sin_grupos_bajados_no_hay_control(self) -> None:
        """Con la EPA confirmándolos todos, como en 2025, no se registra nada."""
        controles = Controles()
        reparto.control_de_sus_grandes_grupos(controles, {}, {"2"}, TICH, EPA)
        self.assertEqual(controles.lista, [])


class PruebaValidarConUnGrupoBajado(unittest.TestCase):
    """Validar entera con un grupo que la EPA no confirma: sale de las 2 cifras, la edición sigue y el panel lo sabe."""

    def _validar(self) -> tuple[dict, dict]:
        """Valida un preparado con el gran grupo 2 de EPA y TICH (el 26, ×0,4) y los controles ajenos al reparto fijos.

        Returns:
            El informe de validación y el conjunto validado.
        """
        cifra = {"pct": 10.0, "regla_nchs": {"publicable": True}}
        poblacion = {**TICH, "25": 10.0, "35": 10.0}
        epa = {**EPA, "25": 10.0, "35": 10.0}
        preparado = {
            "estimaciones": {
                "espana_isco2": dict.fromkeys(poblacion, cifra),
                "espana_isco1": {"2": cifra, "3": cifra},
                **{clave: {} for clave in ("espana_bloques", "espana_grupos", "cataluna_isco1", "cataluna_grupos")},
            },
            "clases_por_isco2": {},
            "grupos_isco": {},
            "contraste_errores": {},
            "contraste_no_sabe_como": {"descripcion": None, "por_clase": {}},
            "enunciado": {"diferencias": [], "sha256_cuestionario": "0" * 64},
            "secciones_en_muestra": {"espana": 2500, "cataluna": 216, "sha256": "0" * 64},
            "edicion": primera(),
            "poblacion_isco2": poblacion,
            "epa_isco2": epa,
        }
        cuerpo = catalogo().encode()
        archivos = {
            tich.ESTIMACIONES: preparado,
            tich.PUBLICADAS: {"errores": {}},
            tich.PROCEDENCIA: {
                "archivos": [],
                "edicion": edicion_del_catalogo(cuerpo.decode()),
                "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
            },
        }
        ajenos = (
            "controles_de_huella",
            "_controles_publicadas",
            "_controles_grupos",
            "_controles_correspondencia",
            "_controles_regla",
            "contraste_errores_ine",
        )
        with contextlib.ExitStack() as parches:
            for nombre in ajenos:
                parches.enter_context(mock.patch.object(tich, nombre, return_value={}))
            parches.enter_context(
                mock.patch.object(tich, "leer_validado", return_value={"isco08_es": {}, "isco08_a_cno11": {}})
            )
            parches.enter_context(mock.patch.object(tich, "leer_json", side_effect=archivos.__getitem__))
            cerrar = parches.enter_context(mock.patch.object(tich, "cerrar_validacion"))
            temporal = parches.enter_context(tempfile.TemporaryDirectory())
            parches.enter_context(mock.patch.object(tich, "ESTADO_EDICION", Path(temporal) / "edicion.json"))
            tich.validar()
        return cerrar.call_args.args[1], cerrar.call_args.args[3]()

    def test_el_grupo_sale_de_las_2_cifras_y_su_gran_grupo_lo_recibe_y_lo_avisa(self) -> None:
        """Las cuatro cosas juntas: fuera de espana_isco2, control de la EPA sin él, control de su gran grupo, panel."""
        informe, conjunto = self._validar()
        self.assertEqual(sorted(conjunto["espana_isco2"]), ["21", "22", "31", "32"])
        self.assertEqual(conjunto["grupos_en_su_gran_grupo"], {"26": reparto.FUERA_DE_LA_REGLA})
        controles = {control["control"]: control["resultado"] for control in informe["controles"]}
        epa = next(control for control in controles if control.startswith("los 4 grupos que se dan a 2 cifras"))
        self.assertNotIn("fuera", epa)
        gran_grupo = [control for control in controles if "se dan en su gran grupo" in control]
        self.assertEqual(len(gran_grupo), 1)
        self.assertEqual(set(controles.values()), {"correcto"}, controles)
        self.assertEqual(informe["estado"], "Admitido")
        with tempfile.TemporaryDirectory() as carpeta:
            validado = Path(carpeta) / DATOS_RELATIVOS / "validados" / "tich" / "tich.json"
            validado.parent.mkdir(parents=True)
            validado.write_text(json.dumps(conjunto), encoding="utf-8")
            campos = campos_del_panel(Path(carpeta), "tich", datetime(2026, 11, 15, tzinfo=UTC))
        self.assertEqual(campos["gruposEnSuGranGrupo"], 1)


if __name__ == "__main__":
    unittest.main()
