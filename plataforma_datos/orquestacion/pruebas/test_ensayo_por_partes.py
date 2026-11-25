"""El ensayo por partes: repite un tramo con las mismas huellas, se niega ante datos alterados y marca otro código."""

import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Sequence
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.orquestacion import ensayo_grabado, ensayo_por_partes, guardia_sin_red
from plataforma_datos.orquestacion.actualizar import Resultado
from plataforma_datos.orquestacion.ensayo_por_partes import (
    PASOS_REPETIBLES,
    RegistroDePasos,
    SalidaConservadaAlterada,
    ordenes_del_tramo,
)
from plataforma_datos.orquestacion.huellas_del_ensayo import comparar
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import (
    COMPLETAR_RENOMBRES,
    EXPORTAR_EL_PAQUETE,
    EXPORTAR_EN_EL_CICLO_OPERATIVO,
    ORDENES_DEL_PAQUETE,
    SI,
    ordenes_del_paquete,
)
from plataforma_datos.orquestacion.repeticion_del_tramo import repetir

RELOJ = {"hoy": "2026-11-24", "instante": "2026-11-24T23:59:59Z"}


def _git(repositorio: Path, *orden: str) -> str:
    identidad = ["-c", "user.name=Prueba", "-c", "user.email=prueba@ejemplo.invalid"]
    return subprocess.run(
        ["git", "-C", str(repositorio), *identidad, *orden], check=True, capture_output=True, text=True
    ).stdout.strip()


def _paso(orden: Sequence[str], area: Path) -> Resultado:
    """Un paso del paquete doble y determinista: anota su orden en los datos del área.

    Returns:
        Un resultado en verde.
    """
    registro = area / "datos" / "registro.txt"
    registro.write_text(registro.read_text() + " ".join(orden) + "\n")
    return Resultado(0, "")


GENERACION_CONSERVADA = {"estado": "conservada", "sha256Manifiesto": "c" * 64, "supervisor": "conserva"}
GENERACION_NO_CONSERVADA = {
    "estado": "no-conservada",
    "clase": "GeneracionInvalida",
    "comprobacion": "datos",
    "causa": "paquete-incoherente",
    "supervisor": "se detiene: el recibo validó un intento cuya generación no se puede conservar",
}
CIERRES: list[tuple[Path, bool]] = []
# La generación que devuelven los dobles de cierre: conservada salvo que una prueba la cambie.
GENERACION_DEL_CIERRE = [GENERACION_CONSERVADA]


def _cerrar(repeticion: Path, en_verde: bool) -> dict:
    """Publicar y exportar dobles: anotan la llamada y devuelven la generación que toque.

    Returns:
        La generación conservada, o la no conservada si la prueba lo pide.
    """
    CIERRES.append((repeticion, en_verde))
    return GENERACION_DEL_CIERRE[0]


def _lanzar(orden: list[str], **_opciones: object) -> subprocess.CompletedProcess:
    """Lanza el tramo en este mismo proceso, con el paso doble, en vez de bajo la guardia.

    Returns:
        El proceso terminado, con el código del tramo.
    """
    argumentos = dict(zip(orden[::1], orden[1::1], strict=False))
    repeticion = Path(argumentos["--repeticion"])
    codigo = ensayo_por_partes.tramo(repeticion, argumentos["--desde"], argumentos.get("--hasta"), _paso, _cerrar)
    return subprocess.CompletedProcess(orden, codigo)


class EnsayoPorPartesPruebas(unittest.TestCase):
    """Un ensayo completo doble y sus repeticiones."""

    def setUp(self) -> None:
        """Prepara un repositorio con dos revisiones y la salida de un ensayo completo con la primera."""
        self.carpeta = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.carpeta)
        self.raiz = self.carpeta / "repositorio"
        self.raiz.mkdir()
        _git(self.raiz, "init", "-q")
        (self.raiz / "codigo.py").write_text("VERSION = 1\n")
        _git(self.raiz, "add", "codigo.py")
        _git(self.raiz, "commit", "-q", "-m", "primera")
        self.primera = _git(self.raiz, "rev-parse", "HEAD")
        self.salida = self.carpeta / "salida"
        (self.salida / "pasos").mkdir(parents=True)
        (self.salida / "candidato" / "datos").mkdir(parents=True)
        (self.salida / "reloj.json").write_text(json.dumps(RELOJ))
        (self.salida / "pasos" / "codigo.json").write_text(
            json.dumps(ensayo_por_partes.codigo_de(self.primera, self.raiz))
        )
        area = self.carpeta / "area"
        (area / "datos").mkdir(parents=True)
        (area / "datos" / "registro.txt").write_text("")
        (area / "codigo.py").write_text("VERSION = 1\n")
        registro = RegistroDePasos(self.salida, _paso)
        for orden in ORDENES_DEL_PAQUETE:
            registro(orden.orden, area)

    def segunda_revision(self) -> str:
        """Cambia el código (y un dato operativo, que nunca se aplica) en una revisión nueva.

        Returns:
            Su SHA.
        """
        (self.raiz / "codigo.py").write_text("VERSION = 2\n")
        (self.raiz / "datos").mkdir()
        (self.raiz / "datos" / "operativo.txt").write_text("no se aplica")
        _git(self.raiz, "add", "codigo.py", "datos/operativo.txt")
        _git(self.raiz, "commit", "-q", "-m", "segunda")
        return _git(self.raiz, "rev-parse", "HEAD")

    def repetir(self, desde: str, hasta: str | None = None) -> tuple[int, dict, dict]:
        """Repite un tramo con el paso doble.

        Returns:
            El código, el recibo y las huellas de la repetición.
        """
        with redirect_stdout(io.StringIO()):
            codigo = repetir(
                self.salida, desde, hasta, raiz=self.raiz, entorno={"PATH": "/usr/bin:/bin"}, lanzar=_lanzar
            )
        repeticion = sorted((self.salida / "repeticiones").iterdir())[-1]
        recibo = json.loads((repeticion / "recibo.json").read_text())
        return codigo, recibo, json.loads((repeticion / "huellas.json").read_text())

    def test_el_ensayo_completo_conserva_cada_paso_repetible_con_sus_huellas(self) -> None:
        """Cada paso repetible conserva el área de antes de él, con la huella de su entrada, su salida y su código."""
        indice = json.loads((self.salida / "pasos" / "indice.json").read_text())
        self.assertEqual(set(indice), set(PASOS_REPETIBLES))
        # Antes del primer paso del paquete se conserva también el candidato, para publicar en él un tramo.
        self.assertTrue((self.salida / "pasos" / "exportar" / "candidato" / "datos").is_dir())
        conservado = (self.salida / "pasos" / "componer" / "area" / "datos" / "registro.txt").read_text()
        self.assertNotIn("componer_catalogo", conservado)
        self.assertEqual(indice["componer"]["codigo"]["revision"], self.primera)
        self.assertNotEqual(indice["componer"]["entrada"], indice["componer"]["salida"])

    def test_la_exportacion_del_ciclo_operativo_es_el_paso_exportar(self) -> None:
        """La exportación que completa los renombres, la del ciclo operativo y la del ensayo, se conserva igual."""
        salida = self.carpeta / "operativo"
        (salida / "pasos").mkdir(parents=True)
        (salida / "candidato").mkdir()
        shutil.copy(self.salida / "pasos" / "codigo.json", salida / "pasos" / "codigo.json")
        area = self.carpeta / "area"
        registro = RegistroDePasos(salida, _paso)
        for orden in ordenes_del_paquete({COMPLETAR_RENOMBRES: SI}):
            registro(orden.orden, area)
        indice = json.loads((salida / "pasos" / "indice.json").read_text())
        self.assertEqual(set(indice), set(PASOS_REPETIBLES))
        self.assertTrue((salida / "pasos" / "exportar" / "area" / "datos").is_dir())

    def test_un_tramo_con_todo_igual_da_las_mismas_huellas_dos_veces(self) -> None:
        """Con datos y código iguales, el tramo vale, sale igual que en el ensayo completo y dos veces igual."""
        indice = json.loads((self.salida / "pasos" / "indice.json").read_text())
        codigo, recibo, primera = self.repetir("web")
        _, _, segunda = self.repetir("web")
        self.assertEqual((codigo, recibo["resultado"], recibo["publica"]), (0, "validado", False))
        por_partes = recibo["porPartes"]
        self.assertTrue(por_partes["valeParaAceptar"])
        self.assertEqual(
            [p["paso"] for p in por_partes["repetidos"]], [o.nombre for o in ordenes_del_tramo("web", None)]
        )
        self.assertEqual(por_partes["repetidos"][0]["salida"], indice["web"]["salida"])
        componer = next(p for p in por_partes["reutilizados"] if p["paso"] == PASOS_REPETIBLES["componer"].nombre)
        self.assertEqual((componer["entrada"], componer["codigo"]), (indice["componer"]["entrada"], "mismo código"))
        self.assertEqual(comparar(primera, segunda), ([], []))
        # Al llegar al final del paquete publica en su clon del candidato y exporta la generación, como el supervisor.
        self.assertEqual(recibo["generacionDelEnsayo"], GENERACION_CONSERVADA)
        self.assertEqual(primera["datos"]["estadoDeLaGeneracion"]["estado"], "conservada")
        self.assertTrue(all(en_verde and (r / "candidato").is_dir() for r, en_verde in CIERRES[-2:]))

    def test_un_tramo_validado_con_la_generacion_no_conservada_se_detiene_como_el_supervisor(self) -> None:
        """Con todos los pasos en verde pero la generación sin conservar, el tramo devuelve uno y queda rechazado."""
        with patch.object(sys.modules[__name__], "GENERACION_DEL_CIERRE", [GENERACION_NO_CONSERVADA]):
            codigo, recibo, huellas = self.repetir("web")
        self.assertEqual((codigo, recibo["resultado"]), (1, "rechazado"))
        self.assertEqual(recibo["generacionDelEnsayo"], GENERACION_NO_CONSERVADA)
        self.assertEqual(huellas["datos"]["estadoDeLaGeneracion"]["causa"], "paquete-incoherente")
        self.assertTrue(CIERRES[-1][1])

    def test_un_tramo_que_termina_antes_no_llega_a_la_generacion(self) -> None:
        """Un tramo con --hasta antes del final del paquete no publica ni exporta la generación."""
        CIERRES.clear()
        _, recibo, huellas = self.repetir("componer", "web")
        self.assertEqual(CIERRES, [])
        self.assertIsNone(recibo["generacionDelEnsayo"])
        self.assertIsNone(huellas["datos"]["estadoDeLaGeneracion"])

    def test_un_byte_alterado_en_lo_conservado_se_niega_y_dice_desde_donde(self) -> None:
        """Un byte alterado en lo conservado: se niega y dice desde qué paso conservado e intacto empezar."""
        alterado = self.salida / "pasos" / "comprobaciones" / "area" / "datos" / "registro.txt"
        alterado.write_bytes(alterado.read_bytes() + b"x")
        with self.assertRaisesRegex(SalidaConservadaAlterada, "repite desde «web»"):
            self.repetir("comprobaciones")
        for paso in PASOS_REPETIBLES:
            conservado = self.salida / "pasos" / paso / "area" / "codigo.py"
            conservado.write_text("VERSION = 9\n")
        with self.assertRaisesRegex(SalidaConservadaAlterada, "ejecuta el ensayo completo"):
            self.repetir("comprobaciones")
        self.assertFalse((self.salida / "repeticiones").exists())

    def test_con_codigo_cambiado_corre_y_queda_marcado(self) -> None:
        """Con código nuevo el tramo corre con ese código, pero no vale para aceptar y comparar no lo admite."""
        segunda = self.segunda_revision()
        codigo, recibo, huellas = self.repetir("comprobaciones")
        self.assertEqual(codigo, 0)
        por_partes = recibo["porPartes"]
        self.assertFalse(por_partes["valeParaAceptar"])
        self.assertEqual(por_partes["archivosDeCodigoAplicados"], ["codigo.py"])
        distinto = f"reutilizado con código distinto: {self.primera[:12]} → {segunda[:12]}"
        self.assertTrue(all(p["codigo"] == distinto for p in por_partes["reutilizados"]))
        repeticion = sorted((self.salida / "repeticiones").iterdir())[-1]
        self.assertEqual((repeticion / "area" / "codigo.py").read_text(), "VERSION = 2\n")
        self.assertFalse((repeticion / "area" / "datos" / "operativo.txt").exists())
        referencia = self.carpeta / "huellas-por-partes.json"
        referencia.write_text(json.dumps(huellas))
        with redirect_stdout(io.StringIO()) as consola:
            self.assertEqual(ensayo_grabado.main(["comparar", str(referencia), str(referencia)]), 2)
        self.assertIn("no vale para aceptar", consola.getvalue())


class OrdenPruebas(unittest.TestCase):
    """Los límites de la orden por partes."""

    def test_el_tramo_va_de_un_paso_repetible_a_otro(self) -> None:
        """El tramo va de un paso repetible a otro posterior, o hasta el final."""
        self.assertEqual([o.nombre for o in ordenes_del_tramo("web", "web")], [PASOS_REPETIBLES["web"].nombre])
        self.assertEqual(ordenes_del_tramo("comprobaciones", None)[-1], ORDENES_DEL_PAQUETE[-1])
        with self.assertRaises(ValueError):
            ordenes_del_tramo("web", "componer")

    def test_el_tramo_repite_la_exportacion_de_su_entorno(self) -> None:
        """Con la señal del ciclo operativo, el tramo exporta completando los renombres, como el ciclo."""
        self.assertEqual(ordenes_del_tramo("exportar", "exportar", {}), [EXPORTAR_EL_PAQUETE])
        operativo = ordenes_del_tramo("exportar", "componer", {COMPLETAR_RENOMBRES: SI})
        self.assertEqual(operativo, [EXPORTAR_EN_EL_CICLO_OPERATIVO, PASOS_REPETIBLES["componer"]])

    def test_un_tramo_no_admite_otro_reloj_y_hasta_exige_desde(self) -> None:
        """Un tramo repite el reloj de su ensayo, y --hasta solo vale con --desde."""
        base = ["ejecutar", "--salida", "/no/existe"]
        for extra in (["--desde", "web", "--hoy", "2026-11-24"], ["--hasta", "web", "--base", "/b"]):
            with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
                ensayo_grabado.main([*base, *extra])
        with (
            patch.object(ensayo_grabado, "repetir", return_value=0) as repetir_doble,
            redirect_stdout(io.StringIO()) as consola,
        ):
            self.assertEqual(ensayo_grabado.main([*base, "--desde", "web", "--hasta", "comprobaciones"]), 0)
        self.assertEqual(repetir_doble.call_args.args, (Path("/no/existe"), "web", "comprobaciones"))
        self.assertIn("sirve para trabajar, no para aceptar", consola.getvalue())

    def test_el_tramo_no_empieza_fuera_de_la_guardia(self) -> None:
        """La suborden del tramo no empieza si no está bajo la guardia de red."""
        sin_guardia = guardia_sin_red.SinGuardiaDeRed("fuera de la guardia")
        with (
            patch.object(ensayo_por_partes, "exigir_sin_red", side_effect=sin_guardia),
            patch.object(ensayo_por_partes, "tramo") as tramo,
            self.assertRaises(guardia_sin_red.SinGuardiaDeRed),
        ):
            ensayo_por_partes.main(["tramo", "--repeticion", "/no/existe", "--desde", "web"])
        tramo.assert_not_called()


if __name__ == "__main__":
    unittest.main()
