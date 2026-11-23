"""El informe conserva el diagnóstico de cada paso fallido, saneado y acotado, en el Markdown y en el JSON."""

import json
import os
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe
from plataforma_datos.orquestacion.actualizar import Paso
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, Comparacion

CASA = str(Path.home())
RECHAZO = (
    "usage: lector.py [-h] [--depurar] {descargar,preparar,validar,todo}\n"
    "lector.py: error: unrecognized arguments: --aceptar-cambio\n"
)
# Los tres fallos de una noche real: dos órdenes rechazadas y la composición, con datos que no deben salir del equipo.
PASOS = [
    Paso("actic · validar", 0, 0.1, "todo bien"),
    Paso("barcelonactiva · descargar", 2, 60.4, RECHAZO),
    Paso("fundae · descargar", 2, 60.4, RECHAZO.replace("lector.py", f"{CASA}/Faro/lector.py")),
    Paso(
        "Componer el catálogo admitido de Cursos",
        1,
        72.8,
        f'Traceback:\n  File "{CASA}/Mis documentos/Año 2026/componer_catalogo.py", line 9\n'
        "Authorization: Bearer abc.def token=sintetico-123 aviso a persona@example.org\n"
        "https://usuario:clave@example.org/api?key=sintetica&x=1\n"
        "Error: el catálogo admitido no coincide con su procedencia",
    ),
]

# Credenciales sintéticas con la forma de las reales; se componen por partes para que ninguna aparezca entera aquí.
GITHUB = "ghp_" + "Sint3tic0" * 4
SECRETOS = {
    "json": ('{"api_key": "sk-ant-' + "api03-sintetica" * 2 + '", "token":"' + GITHUB + '"}', ("sintetica", GITHUB)),
    "entorno": ("GITHUB_TOKEN=" + "gho_" + "x" * 36, ("gho_",)),
    "aws": ("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG+bPxRfiCYsintetica", ("wJalr", "bPxRfiCY")),
    "camello": ("clientSecret=valor-sintetico dbPassword: otro-sintetico", ("valor-sintetico", "otro-sintetico")),
    "entrecomillado": ("'password': 'una frase secreta larga'", ("una frase secreta",)),
    "basica": ("Authorization: Basic dXN1YXJpbzpjbGF2ZQ==", ("dXN1YXJpbzpjbGF2ZQ",)),
    "sueltos": (
        f"{GITHUB} gho_{'a' * 36} github_pat_{'b' * 40} sk-{'c' * 40} sk-ant-{'d' * 40} sk-proj-{'e' * 40}"
        f" xoxb-1234567890-{'f' * 20} xoxp-{'g' * 20} AKIA{'H' * 16} eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh",
        (GITHUB, "a" * 36, "b" * 40, "c" * 40, "d" * 40, "e" * 40, "f" * 20, "g" * 20, "H" * 16, "eyJ"),
    ),
    "url de archivo": (
        "file:///Users/otra-persona/Documents/Proyecto/datos.json",
        ("otra-persona", "Documents", "Proyecto"),
    ),
    "ruta con espacios": (
        "/Users/otra-persona/Mis documentos/Año 2026/componer.py:12: fallo",
        ("otra-persona", "Mis documentos", "Año 2026"),
    ),
}
# Lo que no es secreto sigue legible: el motivo de la orden y los recuentos.
LEGIBLE = (
    "lector.py: error: unrecognized arguments: --aceptar-cambio",
    "max_tokens=1024 tokens: 5 fallos_seguidos: 2",
    "https://example.org/api/datos.json?x=1",
    # La cabecera de npm («> paquete@versión orden») no es un correo.
    "> faro@1.0.0 verificar",
)


class DiagnosticoDeCadaFallo(unittest.TestCase):
    """Ningún fallo desaparece del informe y ninguno saca rutas, credenciales ni correos."""

    def setUp(self) -> None:
        """Raíz temporal propia."""
        temporal = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.ahora = datetime(2026, 10, 25, 2, 16, 41, tzinfo=UTC)

    def escribir(self, pasos: list[Paso]) -> tuple[str, dict]:
        """Escribe el informe de los pasos.

        Returns:
            El Markdown y el JSON del informe.
        """
        resumen = informe.Resumen("ámbar", pasos, Comparacion(None, [], []), [], 1391.0)
        ruta = informe.escribir_informe(self.raiz, resumen, self.ahora)
        return ruta.read_text(encoding="utf-8"), json.loads(ruta.with_suffix(".json").read_text(encoding="utf-8"))

    def test_cada_paso_fallido_consta_con_su_diagnostico(self) -> None:
        """Las dos descargas rechazadas y la composición aparecen, cada una con el final de su salida."""
        markdown, datos = self.escribir(PASOS)
        for paso in PASOS[1:]:
            self.assertIn(f"### Lo que falló: {paso.nombre} (código {paso.codigo})", markdown)
        self.assertEqual(markdown.count("unrecognized arguments: --aceptar-cambio"), 2)
        self.assertIn("el catálogo admitido no coincide con su procedencia", markdown)
        self.assertNotIn("diagnostico", datos["pasos"][0])
        for fila, paso in zip(datos["pasos"][1:], PASOS[1:], strict=True):
            self.assertEqual((fila["nombre"], fila["codigo"]), (paso.nombre, paso.codigo))
            self.assertIn(fila["diagnostico"], markdown)
        self.assertIn("--aceptar-cambio", datos["pasos"][2]["diagnostico"])

    def test_el_diagnostico_sale_saneado(self) -> None:
        """Sin rutas del equipo, credenciales ni correos; queda el nombre del archivo y el motivo."""
        markdown, datos = self.escribir(PASOS)
        texto = markdown + json.dumps(datos, ensure_ascii=False)
        for privado in (CASA, "Mis documentos", "abc.def", "sintetico-123", "persona@example.org", "usuario:clave"):
            self.assertNotIn(privado, texto)
        self.assertNotIn("key=sintetica", texto)
        self.assertIn("…/componer_catalogo.py", texto)
        self.assertIn("…/lector.py", texto)
        self.assertIn("example.org/api", texto)

    def test_credenciales_y_rutas_de_cada_forma_no_salen(self) -> None:
        """JSON, variables de entorno, prefijos conocidos, URL de archivo y rutas con espacios, cada una en su paso."""
        pasos = [
            Paso(f"{caso} · descargar", 1, 1.0, f"antes\n{salida}\ndespués") for caso, (salida, _) in SECRETOS.items()
        ]
        pasos.append(Paso("legible · validar", 1, 1.0, "\n".join(LEGIBLE)))
        markdown, datos = self.escribir(pasos)
        texto = markdown + json.dumps(datos, ensure_ascii=False)
        for caso, (_, privados) in SECRETOS.items():
            for privado in privados:
                with self.subTest(caso=caso, privado=privado):
                    self.assertNotIn(privado, texto)
        diagnosticos = {fila["nombre"].split(" · ")[0]: fila["diagnostico"] for fila in datos["pasos"]}
        self.assertEqual(
            diagnosticos["json"], f'antes\n{{"api_key": "{informe.OCULTO}", "token":"{informe.OCULTO}"}}\ndespués'
        )
        self.assertIn(f"GITHUB_TOKEN={informe.OCULTO}", diagnosticos["entorno"])
        self.assertIn(f"AWS_SECRET_ACCESS_KEY={informe.OCULTO}", diagnosticos["aws"])
        self.assertIn(f"'password': '{informe.OCULTO}'", diagnosticos["entrecomillado"])
        self.assertEqual(diagnosticos["sueltos"].count(informe.OCULTO), 10)
        self.assertIn("file://…/datos.json", diagnosticos["url de archivo"])
        self.assertIn("…/componer.py:12: fallo", diagnosticos["ruta con espacios"])
        for legible in LEGIBLE:
            self.assertIn(legible, diagnosticos["legible"])

    def test_el_saneado_es_lineal_con_entradas_adversas(self) -> None:
        """Las expresiones no retroceden de forma catastrófica: cada entrada del tamaño de la cola tarda poco."""
        tamano = 2 * informe.MAX_DIAGNOSTICO_POR_PASO
        adversas = (
            "a=" * (tamano // 2),
            "/" + "a " * (tamano // 2),
            "/a b" * (tamano // 4),
            "eyJ" + "a" * tamano,
            '"' + "a" * tamano,
            "token: " + '"' * tamano,
            "sk-" + "-" * tamano,
        )
        for adversa in adversas:
            inicio = time.perf_counter()
            informe.sanear(adversa)
            self.assertLess(time.perf_counter() - inicio, 1.0, adversa[:20])

    def test_cotas_por_paso_y_total_sin_perder_ningun_fallo(self) -> None:
        """Una salida enorme queda en su cota; agotado el total, los siguientes constan sin detalle."""
        salida = "x" * 200_000 + "\n" + ("x" * 300 + "\n") * 700 + "FINAL"
        pasos = [Paso(f"fuente{numero} · descargar", 1, 1.0, salida) for numero in range(8)]
        markdown, datos = self.escribir(pasos)
        detalles = [fila["diagnostico"] for fila in datos["pasos"]]
        self.assertEqual(len(detalles), len(pasos))
        self.assertTrue(all(len(d.encode()) <= informe.MAX_DIAGNOSTICO_POR_PASO for d in detalles))
        con_detalle = [d for d in detalles if d != informe.SIN_DETALLE]
        self.assertLessEqual(sum(len(d.encode()) for d in con_detalle), informe.MAX_DIAGNOSTICOS_BYTES)
        self.assertTrue(detalles[0].endswith("FINAL"))
        self.assertIn(informe.SIN_DETALLE, detalles)
        for paso in pasos:
            self.assertIn(f"### Lo que falló: {paso.nombre}", markdown)
        self.assertTrue((self.raiz / CARPETA_DE_INFORMES).is_dir())


if __name__ == "__main__":
    unittest.main()
