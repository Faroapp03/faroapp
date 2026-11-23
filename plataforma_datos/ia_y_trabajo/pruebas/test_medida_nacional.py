"""Definiciones nacionales y validación común con archivos temporales reales."""

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.comun.medida_nacional as medida_nacional
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector as ia_nacional_che
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector as ia_nacional_isl
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector as ia_nacional_isr
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector as ia_nacional_kor
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import Carpetas, Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import controles_del_indicador
from plataforma_datos.orquestacion import admision

NUEVOS = {
    "ia_nacional_isl": ia_nacional_isl,
    "ia_nacional_gbr": ia_nacional_gbr,
    "ia_nacional_bra": ia_nacional_bra,
    "ia_nacional_che": ia_nacional_che,
    "ia_nacional_isr": ia_nacional_isr,
    "ia_nacional_kor": ia_nacional_kor,
}


class Definiciones(unittest.TestCase):
    """Cada indicador conserva su universo y declara que no es comparable."""

    def test_cada_definicion_dice_lo_que_debe(self) -> None:
        """Con sus frases, admitida; sin la que dice el universo o el mínimo, no."""
        for modulo in NUEVOS.values():
            indicador = modulo.INDICADORES_NACIONALES[modulo.PAIS]
            with self.subTest(pais=modulo.PAIS):
                controles = Controles()
                controles_del_indicador(controles, modulo.PAIS, indicador, modulo.LICENCIA, modulo.FRASES)
                self.assertTrue(controles.admitido, controles.fallidos)
                callada = {**indicador, "definicion": {"es": "Porcentaje.", "ca": "Percentatge."}}
                controles = Controles()
                controles_del_indicador(controles, modulo.PAIS, callada, modulo.LICENCIA, modulo.FRASES)
                self.assertFalse(controles.admitido)


class Validacion(unittest.TestCase):
    """Pipeline real: huella, controles, cierre y conservación del conjunto admitido."""

    def setUp(self) -> None:
        """Monta una fuente propia en temporal sin tocar datos de la aplicación."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        raiz = Path(self.temporal.name)
        self.rutas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
        for ruta in self.rutas:
            ruta.mkdir()
        for modulo in (medida_nacional, entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", return_value=self.rutas)
            parche.start()
            self.addCleanup(parche.stop)
        self.conjunto = self.rutas.validado / "ia-nacional-prueba.json"
        self.anterior = b'{"conjunto":"admitido anterior"}\n'
        self.conjunto.write_bytes(self.anterior)
        captura = b"captura temporal"
        (self.rutas.original / "captura.html").write_bytes(captura)
        self.procedencia = {
            "licencia": ia_nacional_bra.LICENCIA,
            "archivos": [
                {
                    "archivo": "captura.html",
                    "sha256": hashlib.sha256(captura).hexdigest(),
                    "licencia": ia_nacional_bra.LICENCIA,
                    "descargado_utc": "2026-10-11T21:43:12.650019+00:00",
                }
            ],
        }
        self.cifras = {
            "paises": {
                "BRA": {
                    "valor": 17.0,
                    "anio": 2025,
                    "titulo": ia_nacional_bra.TITULO,
                    "base": ia_nacional_bra.BASE,
                    "pies": [f"Fonte: {ia_nacional_bra.CITA}", ia_nacional_bra.NOTA],
                }
            }
        }

    def validar(self) -> None:
        """Usa lectura, huellas, propios y cerrar_validacion sin sustituir su lógica."""
        guardar_json(self.rutas.original / "procedencia.json", self.procedencia)
        guardar_json(self.rutas.preparado / "cifras.json", self.cifras)
        with contextlib.redirect_stdout(io.StringIO()):
            medida_nacional.validar_medida(
                "ia-nacional-prueba", "BRA", range(2025, 2026), ia_nacional_bra._propios, "Límite de prueba"
            )

    def test_booleano_no_es_porcentaje(self) -> None:
        """True no debe validarse como 1 % ni reemplazar el conjunto anterior."""
        self.cifras["paises"]["BRA"]["valor"] = True
        with self.assertRaises(ValidacionFallida):
            self.validar()
        self.assertEqual(self.conjunto.read_bytes(), self.anterior)
        self.assertEqual(leer_json(self.rutas.validacion)["estado"], "Con errores")

    def test_descargado_utc_no_se_trunca_sin_validar(self) -> None:
        """Una fecha imposible o incompleta no acredita la consulta del conjunto."""
        for fecha in ("2026-02-30T21:43:12+00:00", "2026-10-11", "2026-10", "2026-10-11T25:00:00+00:00"):
            with self.subTest(fecha=fecha):
                self.procedencia["archivos"][0]["descargado_utc"] = fecha
                with self.assertRaisesRegex(FormatoInesperado, "procedencia.json.*descargado_utc"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_estructuras_preparadas_se_diagnostican(self) -> None:
        """Las formas que se leen tienen motivo de archivo/campo y conservan lo admitido."""
        for cifras in ([], {}, {"paises": []}, {"paises": {"BRA": []}}, {"paises": {"BRA": None}}):
            with self.subTest(cifras=cifras):
                self.cifras = cifras
                with self.assertRaisesRegex(FormatoInesperado, "cifras.json"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_estructuras_procedencia_se_diagnostican(self) -> None:
        """Solo se exige la forma de los campos consumidos por este auxiliar y las huellas."""
        entrada = self.procedencia["archivos"][0]
        variantes = [[], {}, {"licencia": "prueba", "archivos": []}, {"licencia": "prueba", "archivos": {}}]
        for campo in ("archivo", "sha256", "licencia", "descargado_utc"):
            for valor in (None, 4, []):
                variantes.append({"licencia": ia_nacional_bra.LICENCIA, "archivos": [{**entrada, campo: valor}]})
            variantes.append(
                {"licencia": ia_nacional_bra.LICENCIA, "archivos": [{k: v for k, v in entrada.items() if k != campo}]}
            )
        variantes.extend(
            ({"licencia": None, "archivos": [entrada]}, {"licencia": ia_nacional_bra.LICENCIA, "archivos": [None]})
        )
        for procedencia in variantes:
            with self.subTest(procedencia=procedencia):
                self.procedencia = procedencia
                with self.assertRaisesRegex(FormatoInesperado, "procedencia.json"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_fecha_utc_exige_hora_y_zona(self) -> None:
        """UTC completa, con segundos y zona explícita; sin convertir otras zonas."""
        for fecha in (None, 4, "2026-10-11T21:43", "2026-10-11T21:43:12", "2026-10-11T21:43:12+01:00"):
            with self.subTest(fecha=fecha):
                self.procedencia["archivos"][0]["descargado_utc"] = fecha
                with self.assertRaisesRegex(FormatoInesperado, "procedencia.json.*descargado_utc"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_limites_del_porcentaje_se_conservan(self) -> None:
        """Los extremos 0/100 y valores no numéricos permanecen fuera del contrato."""
        for valor in (0, 100, False, "17", None):
            with self.subTest(valor=valor):
                self.cifras["paises"]["BRA"]["valor"] = valor
                with self.assertRaises(ValidacionFallida):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_cierre_real_conserva_json_completos(self) -> None:
        """La entrada nominal da el conjunto completo y exactamente el informe habitual."""
        reloj = "2026-10-11T21:43:12.653211+00:00"
        with mock.patch.object(medida_nacional, "ahora_utc", return_value=reloj):
            self.validar()
        esperado = {"consultado": "2026-10-11", "paises": self.cifras["paises"]}
        self.assertEqual(
            self.conjunto.read_bytes(), (json.dumps(esperado, ensure_ascii=False, indent=2) + "\n").encode()
        )
        controles = Controles()
        controles.comprobar(True, "huella de captura.html")
        controles.comprobar(True, "BRA: cada original lleva la licencia de la fuente")
        controles.comprobar(True, "BRA: una sola cifra, la del país")
        controles.comprobar(True, "BRA: 17.0 % entre 0 y 100")
        controles.comprobar(True, "BRA: año 2025 en 2025–2025")
        ia_nacional_bra._propios(controles, self.cifras["paises"]["BRA"], self.procedencia)
        informe = {
            "estado": "Admitido",
            "comprobado_utc": reloj,
            "cobertura": {"paises": ["BRA"]},
            "limites": "Límite de prueba",
            "controles": controles.lista,
        }
        self.assertEqual(
            self.rutas.validacion.read_bytes(), (json.dumps(informe, ensure_ascii=False, indent=2) + "\n").encode()
        )
        for fecha in ("2026-10-11T21:43:12Z", "2026-10-11T21:43:12+00:00"):
            self.procedencia["archivos"][0]["descargado_utc"] = fecha
            with mock.patch.object(medida_nacional, "ahora_utc", return_value=reloj):
                self.validar()
            self.assertEqual(
                self.conjunto.read_bytes(), (json.dumps(esperado, ensure_ascii=False, indent=2) + "\n").encode()
            )


if __name__ == "__main__":
    unittest.main()
