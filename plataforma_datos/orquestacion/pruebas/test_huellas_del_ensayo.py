"""Las huellas de un ensayo: sin horas, por archivo y comparables campo a campo."""

import io
import json
import re
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import ensayo_grabado, huellas_del_ensayo
from plataforma_datos.orquestacion.huellas_del_ensayo import SIN_HORA, calcular, comparar, separar_codigo, sin_horas

RELOJ = {"hoy": "2026-11-24", "instante": "2026-11-24T05:06:07Z"}


def _recibo(terminado: str, unidades: int = 3, version: str = "0123456789abcdef") -> dict:
    return {
        "version": 4,
        "resultado": "validado",
        "terminadoEn": terminado,
        "huellaPaquete": version,
        "estado": {"modulos": [{"id": "cursos", "ultimoIntento": terminado, "veredicto": "verde"}]},
        "catalogo": {"corteProyeccion": "2026-11-24T05:06:07Z", "unidades": unidades, "desde": "2026-11-01"},
    }


class HuellasPruebas(unittest.TestCase):
    """Las huellas de una salida pequeña."""

    def setUp(self) -> None:
        """Prepara una carpeta temporal propia."""
        self.salida = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.salida)
        datos = self.salida / "candidato" / "datos"
        (datos / "cursos").mkdir(parents=True)
        (datos / "manifiesto.json").write_text("{}")
        (datos / "cursos" / "catalogo.json").write_text('{"cursos": []}')
        generacion = self.salida / "generacion-resultado"
        generacion.mkdir()
        manifiesto = {
            "manifiestoPaqueteSha256": "a" * 64,
            "estadoSha256": "b" * 64,
            "archivos": [{"ruta": "datos/manifiesto.json", "bytes": 2, "sha256": "c" * 64}],
        }
        (generacion / "manifiesto.json").write_text(json.dumps(manifiesto))
        (generacion / "contenido" / "datos").mkdir(parents=True)
        (generacion / "contenido" / "datos" / "manifiesto.json").write_text("{}")
        (self.salida / "reloj.json").write_text(json.dumps(RELOJ))

    def huellas(self, recibo: dict) -> dict:
        """Escribe el recibo y calcula las huellas de la salida.

        Returns:
            Las huellas calculadas.
        """
        (self.salida / "recibo.json").write_text(json.dumps(recibo))
        return ensayo_grabado.huellas(self.salida)

    def test_solo_los_campos_de_hora_nombrados_no_cuentan(self) -> None:
        """Solo los campos de hora nombrados no cuentan: cualquier otro instante sigue siendo un dato."""
        self.assertEqual(
            sin_horas(
                {"terminadoEn": "2026-11-24T05:06:07Z", "l": [{"ultimoIntento": "x"}], "fin": "2026-11-24T05:06Z"}
            ),
            {"terminadoEn": SIN_HORA, "l": [{"ultimoIntento": SIN_HORA}], "fin": "2026-11-24T05:06Z"},
        )
        self.assertIn("observadoEn", json.dumps(sin_horas({"observadoEn": "2026-11-24T23:59:59Z"})))
        self.assertNotIn(SIN_HORA, json.dumps(sin_horas({"observadoEn": "2026-11-24T23:59:59Z"})))

    def test_la_version_del_paquete_no_se_exige_y_se_informa(self) -> None:
        """La versión del paquete es una huella compuesta de código: dos distintas dan datos iguales y se informa."""
        a = self.huellas(_recibo("2026-11-24T05:30:00Z", version="0123456789abcdef"))
        b = self.huellas(_recibo("2026-11-24T05:30:00Z", version="fedcba9876543210"))
        exigidas, de_codigo = comparar(a, b)
        self.assertEqual(exigidas, [])
        self.assertEqual(len(de_codigo), 1)
        self.assertIn("compuestas › versionDelPaquete", de_codigo[0])

    def test_un_enlace_simbolico_cuenta_por_su_destino(self) -> None:
        """Un enlace simbólico del paquete cuenta por su destino, y la comparación dice por qué."""
        enlace = self.salida / "candidato" / "datos" / "atajo.json"
        enlace.symlink_to("cursos/catalogo.json")
        a = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        self.assertEqual(a["datos"]["paquete"]["atajo.json"], "enlace a cursos/catalogo.json")
        enlace.unlink()
        enlace.symlink_to("manifiesto.json")
        b = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        self.assertEqual(comparar(a, b)[0][0].split(":")[1].strip(), "datos › paquete › atajo.json")
        self.assertTrue(any(linea.startswith("Enlaces simbólicos:") for linea in huellas_del_ensayo.exclusiones()))

    def test_dos_recibos_que_solo_difieren_en_la_hora_dan_las_mismas_huellas(self) -> None:
        """Dos recibos que solo difieren en la hora dan las mismas huellas."""
        a = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        b = self.huellas(_recibo("2026-11-24T06:45:00Z"))
        self.assertEqual(comparar(a, b), ([], []))
        self.assertEqual(a, json.loads((self.salida / "huellas.json").read_text()))

    def test_la_huella_lleva_cada_archivo_del_paquete_y_de_la_generacion(self) -> None:
        """La huella lleva cada archivo del paquete y de la generacion."""
        huellas = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        self.assertEqual(set(huellas["datos"]["paquete"]), {"manifiesto.json", "cursos/catalogo.json"})
        self.assertEqual(set(huellas["datos"]["generacion"]), {"datos/manifiesto.json"})
        self.assertEqual(huellas["codigo"]["compuestas"]["archivosTalCual"], {"datos/manifiesto.json": "c" * 64})
        self.assertEqual(huellas["reloj"], RELOJ)
        # Cada módulo del estado se resume en su huella, para que la comparación lo nombre.
        self.assertRegex(huellas["datos"]["recibo"]["estado"]["modulos"]["cursos"], "^[0-9a-f]{64}$")
        self.assertEqual(huellas["datos"]["recibo"]["resultado"], "validado")

    def test_un_cambio_solo_de_firmas_de_codigo_no_cuenta_y_se_informa(self) -> None:
        """Un cambio solo de firmas de codigo no cuenta y se informa."""
        validacion = self.salida / "candidato" / "datos" / "validacion.json"
        validacion.write_text(json.dumps({"filas": 3, "codigo_sha256": "a" * 64}))
        a = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        validacion.write_text(json.dumps({"filas": 3, "codigo_sha256": "b" * 64}))
        b = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        exigidas, de_codigo = comparar(a, b)
        self.assertEqual(exigidas, [])
        self.assertEqual(len(de_codigo), 1)
        self.assertTrue(de_codigo[0].startswith("no se exige (código) distinto: paquete › validacion.json"))
        validacion.write_text(json.dumps({"filas": 4, "codigo_sha256": "b" * 64}))
        c = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        self.assertEqual([d.split(":")[1].strip() for d in comparar(b, c)[0]], ["datos › paquete › validacion.json"])

    def test_las_firmas_de_codigo_se_separan_en_cualquier_nivel(self) -> None:
        """Las firmas de código se separan en cualquier nivel, también la huella de la regla de retirada."""
        datos, firmas = separar_codigo(
            {
                "entrada": {"codigo_admision": "x", "n": 1},
                "l": [{"codigo_proyeccion": "y"}],
                "decision": {"regla": {"id": "retirada", "version": 2, "sha256": "z"}},
                "evaluador": {"sha256": "e"},
                "codigo_postal": "08001",
            }
        )
        self.assertEqual(
            datos,
            {
                "entrada": {"n": 1},
                "l": [{}],
                "decision": {"regla": {"id": "retirada", "version": 2}},
                "codigo_postal": "08001",
            },
        )
        self.assertEqual(
            firmas,
            {
                "entrada › codigo_admision": "x",
                "l › 0 › codigo_proyeccion": "y",
                "decision › regla › sha256": "z",
                "evaluador": {"sha256": "e"},
            },
        )

    def test_el_codigo_postal_con_nombre_de_camello_es_un_dato(self) -> None:
        """«codigoPostal», que llega de los datos de la Cambra, se queda como dato y no se toma por firma."""
        datos, firmas = separar_codigo({"codigoPostal": "08001"})
        self.assertEqual((datos, firmas), ({"codigoPostal": "08001"}, {}))

    def test_un_campo_con_nombre_de_firma_sin_clasificar_detiene_las_huellas(self) -> None:
        """Un campo «codigo_…» que no está en ninguna lista detiene las huellas: hay que decir si es firma o dato."""
        with self.assertRaises(huellas_del_ensayo.CampoDeCodigoSinClasificar):
            separar_codigo({"a": [{"codigo_nuevo_sha256": "x"}]})
        with self.assertRaises(huellas_del_ensayo.CampoDeCodigoSinClasificar):
            separar_codigo({"codigoDelMotor": "x"})

    def test_todo_campo_con_nombre_de_firma_del_codigo_esta_clasificado(self) -> None:
        """Guardia: cada «codigo_…» o «codigoAlgo» que el código escribe está clasificado como firma o como dato."""
        clasificados = set(huellas_del_ensayo.CAMPOS_DE_CODIGO) | huellas_del_ensayo.CAMPOS_CODIGO_QUE_SON_DATOS
        patron = re.compile(r"[\"'](" + huellas_del_ensayo.NOMBRE_DE_CODIGO.pattern + r")[\"']")
        vistos = {
            nombre.group(1)
            for ruta in (RAIZ / "plataforma_datos").rglob("*.py")
            if "pruebas" not in ruta.parts
            for nombre in patron.finditer(ruta.read_text(encoding="utf-8"))
        }
        self.assertTrue(vistos)
        self.assertEqual(sorted(vistos - clasificados), [])

    def test_la_comparacion_dice_que_difiere(self) -> None:
        """La comparacion dice que difiere."""
        a = self.huellas(_recibo("2026-11-24T05:30:00Z"))
        (self.salida / "candidato" / "datos" / "cursos" / "catalogo.json").write_text('{"cursos": [1]}')
        (self.salida / "candidato" / "datos" / "nuevo.json").write_text("{}")
        b = self.huellas(_recibo("2026-11-24T05:30:00Z", unidades=4))
        diferencias, _ = comparar(a, b)
        self.assertEqual(len(diferencias), 3)
        self.assertTrue(diferencias[0].startswith("distinto: datos › catalogo › unidades: 3 → 4"))
        self.assertTrue(diferencias[1].startswith("distinto: datos › paquete › cursos/catalogo.json"))
        self.assertEqual(diferencias[2], "solo en B: datos › paquete › nuevo.json")

    def test_comparar_desde_la_orden(self) -> None:
        """Comparar desde la orden."""
        a = self.salida / "a.json"
        a.write_text(json.dumps(self.huellas(_recibo("2026-11-24T05:30:00Z"))))
        b = self.salida / "b.json"
        b.write_text(json.dumps(self.huellas(_recibo("2026-11-24T05:30:00Z", unidades=4))))
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(ensayo_grabado.main(["comparar", str(a), str(a)]), 0)
            self.assertEqual(ensayo_grabado.main(["comparar", str(a), str(b)]), 1)
        lineas = salida.getvalue().splitlines()
        self.assertIn("Las huellas de datos son iguales.", lineas)
        self.assertIn("distinto: datos › catalogo › unidades: 3 → 4", lineas)
        self.assertEqual(lineas[-1], "Las huellas de datos son distintas.")
        self.assertTrue(any(linea.startswith("Se excluye codigo_sha256:") for linea in lineas))

    def test_sin_generacion_validada_no_hay_huella_de_la_generacion(self) -> None:
        """Sin generacion validada no hay huella de la generacion."""
        huellas = calcular(self.salida / "candidato", _recibo("2026-11-24T05:30:00Z"), None, RELOJ)
        self.assertIsNone(huellas["datos"]["generacion"])


if __name__ == "__main__":
    unittest.main()
