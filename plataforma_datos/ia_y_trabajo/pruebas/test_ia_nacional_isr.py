"""Pruebas focales de la medida nacional de Israel, CBS junio de 2025."""

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.comun.medida_nacional as medida_nacional
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector as ia_nacional_isr
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion import admision

CBS = [
    {"A": "לוח 1"},
    {"E": ia_nacional_isr.PREGUNTA},
    {"B": "שימוש ב-AI בחינם"},
    {"A": "%עסקים", "B": "Yes, which are provided for free only", "C": "Yes, including those that are paid"}
    | {"D": "No", "E": "% Businesses"},
    {"A": "Total of Industries"},
    {
        "A": "סך הענפים",
        "B": "0.10766573411663695",
        "C": "0.17440106950330908",
        "D": "0.71793319638005404",
        "E": "Total",
    },
    {"A": "50-11 מועסקים", "B": "0.1", "C": "0.2", "D": "0.7", "E": "11-50 employees"},
]


class Lectura(unittest.TestCase):
    """Lectura de la fila nacional y rechazo de entradas ambiguas o incompletas."""

    def test_israel(self) -> None:
        """La suma de los dos «Yes» en la fila «Total»; otra pregunta o respuestas que no suman 100 detienen."""
        cifra = ia_nacional_isr.cifra_de_la_tabla(CBS)
        self.assertEqual((cifra["valor"], cifra["anio"], cifra["clase_menor"]), (28.2, 2025, "11-50 employees"))
        with self.assertRaises(FormatoInesperado):
            ia_nacional_isr.cifra_de_la_tabla([*CBS[:1], {"E": "Table 1 (Employees)"}, *CBS[2:]])
        with self.assertRaises(FormatoInesperado):
            ia_nacional_isr.cifra_de_la_tabla([*CBS[:5], {**CBS[5], "D": "0.6"}, *CBS[6:]])

    def test_total_de_ramas_unico(self) -> None:
        """Una segunda sección no puede quedar oculta por la primera coincidencia."""
        for filas in ([*CBS, *CBS[4:]], [*CBS[:4], *CBS[5:]]):
            with self.subTest(filas=filas), self.assertRaisesRegex(FormatoInesperado, "Total of Industries"):
                ia_nacional_isr.cifra_de_la_tabla(filas)

    def test_seccion_truncada_con_diagnostico(self) -> None:
        """La sección exige sus dos filas posteriores, sin IndexError."""
        for filas in (CBS[:5], CBS[:6]):
            with (
                self.subTest(filas=filas),
                self.assertRaisesRegex(FormatoInesperado, "cbs-31_25_216t2.xlsx.*sección"),
            ):
                ia_nacional_isr.cifra_de_la_tabla(filas)

    def test_celdas_del_total_ausentes_o_no_numericas(self) -> None:
        """El error indica original, Total y columna sin escapar KeyError/ValueError."""
        for columna in "BCD":
            for variante in ("ausente", "", "no disponible", None):
                with self.subTest(columna=columna, variante=variante):
                    total = dict(CBS[5])
                    if variante == "ausente":
                        del total[columna]
                    else:
                        total[columna] = variante
                    with self.assertRaisesRegex(FormatoInesperado, f"cbs-31_25_216t2.xlsx.*Total.*{columna}"):
                        ia_nacional_isr.cifra_de_la_tabla([*CBS[:5], total, CBS[6]])

    def test_proporciones_fuera_de_escala_no_se_compensan(self) -> None:
        """Sumar uno no hace válida una proporción negativa o mayor que uno."""
        for proporciones in (("-0.1", "0.3", "0.8"), ("1.1", "0.1", "-0.2"), ("0.3", "0.8", "-0.1")):
            with self.subTest(proporciones=proporciones):
                total = {**CBS[5], **dict(zip("BCD", proporciones, strict=True))}
                with self.assertRaisesRegex(FormatoInesperado, "cbs-31_25_216t2.xlsx.*Total.*[BCD]"):
                    ia_nacional_isr.cifra_de_la_tabla([*CBS[:5], total, CBS[6]])

    def test_proporciones_no_finitas(self) -> None:
        """Un número no finito se diagnostica en su columna de origen."""
        for texto in ("nan", "inf", "-inf", "1e309"):
            with (
                self.subTest(texto=texto),
                self.assertRaisesRegex(FormatoInesperado, "cbs-31_25_216t2.xlsx.*Total.*B"),
            ):
                ia_nacional_isr.cifra_de_la_tabla([*CBS[:5], {**CBS[5], "B": texto}, CBS[6]])

    def test_extremos_de_proporciones_conservados_en_lector(self) -> None:
        """El lector conserva cero/uno; el contrato común de admisión no se modifica."""
        for proporciones, esperado in ((("0", "0", "1"), 0.0), (("0", "1", "0"), 100.0)):
            with self.subTest(proporciones=proporciones):
                total = {**CBS[5], **dict(zip("BCD", proporciones, strict=True))}
                self.assertEqual(ia_nacional_isr.cifra_de_la_tabla([*CBS[:5], total, CBS[6]])["valor"], esperado)


class Edicion(unittest.TestCase):
    """El año ausente del XLSX solo se atribuye al recurso de la edición conocida."""

    def setUp(self) -> None:
        """Aísla el cierre real y conserva un conjunto admitido anterior."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        self.rutas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
        for ruta in self.rutas:
            ruta.mkdir()
        for modulo in (medida_nacional, entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", return_value=self.rutas)
            parche.start()
            self.addCleanup(parche.stop)
        self.conjunto = self.rutas.validado / f"{ia_nacional_isr.FUENTE}.json"
        self.anterior = b'{"conjunto":"admitido anterior"}\n'
        self.conjunto.write_bytes(self.anterior)
        captura = b"captura de prueba con huella correcta"
        self.entrada = {
            "archivo": ia_nacional_isr.ARCHIVO,
            "url": ia_nacional_isr.URL,
            "url_final": ia_nacional_isr.URL,
            "sha256": hashlib.sha256(captura).hexdigest(),
            "licencia": ia_nacional_isr.LICENCIA,
            "descargado_utc": "2026-10-11T21:53:23+00:00",
        }
        (self.rutas.original / ia_nacional_isr.ARCHIVO).write_bytes(captura)
        (self.rutas.original / "otra-edicion.xlsx").write_bytes(captura)
        self.cifras = {"paises": {"ISR": ia_nacional_isr.cifra_de_la_tabla(CBS)}}
        entrada_salida.guardar_json(self.rutas.preparado / "cifras.json", self.cifras)

    def validar(self, entradas: list[dict[str, object]]) -> None:
        """Ejecuta las huellas, controles propios y cierre sin sustituir su lógica."""
        entrada_salida.guardar_json(
            self.rutas.original / "procedencia.json", {"licencia": ia_nacional_isr.LICENCIA, "archivos": entradas}
        )
        with contextlib.redirect_stdout(io.StringIO()):
            ia_nacional_isr.validar()

    def test_otro_recurso_no_hereda_el_anio_del_comunicado(self) -> None:
        """Ni la huella correcta ni la pregunta idéntica acreditan otra edición o redirección."""
        for campo, valor in (
            ("archivo", "otra-edicion.xlsx"),
            ("url", ia_nacional_isr.URL.replace("2025/216", "2026/216")),
            ("url_final", ia_nacional_isr.URL.replace("2025/216", "2026/216")),
            ("url", None),
            ("url_final", None),
        ):
            entrada = {**self.entrada, campo: valor}
            if valor is None:
                del entrada[campo]
            with self.subTest(campo=campo, valor=valor):
                with self.assertRaisesRegex(ValidacionFallida, "216/2025"):
                    self.validar([entrada])
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_original_adicional_no_acredita_la_edicion(self) -> None:
        """El recurso conocido no puede ocultar otro original registrado en la medida."""
        with self.assertRaisesRegex(ValidacionFallida, "216/2025"):
            self.validar([self.entrada, {**self.entrada, "archivo": "otra-edicion.xlsx"}])
        self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_recurso_conocido_conserva_el_conjunto_exacto(self) -> None:
        """La procedencia actual sigue dando los mismos bytes del conjunto nacional."""
        self.validar([self.entrada])
        esperado = {"consultado": "2026-10-11", "paises": self.cifras["paises"]}
        self.assertEqual(
            self.conjunto.read_bytes(), (json.dumps(esperado, ensure_ascii=False, indent=2) + "\n").encode()
        )


if __name__ == "__main__":
    unittest.main()
