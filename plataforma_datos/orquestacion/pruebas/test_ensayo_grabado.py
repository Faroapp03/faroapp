"""El ensayo con datos grabados: sin descargas, sin red, sin escribir en el almacén, con un solo reloj y desde HEAD."""

import io
import json
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun import instante_del_ciclo
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.orquestacion import (
    base_del_ensayo,
    ensayo_grabado,
    entorno_del_ensayo,
    generacion_del_ensayo,
    guardia_sin_red,
)
from plataforma_datos.orquestacion.actualizar import (
    Opciones,
    actualizar_con_resultado,
    entorno_de_las_ordenes,
    ordenes_de_la_fuente,
)
from plataforma_datos.orquestacion.candidato import opciones_de_la_accion
from plataforma_datos.orquestacion.ensayo_por_partes import RegistroDePasos
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import (
    EXPORTAR_EN_EL_CICLO_OPERATIVO,
    ordenes_del_paquete,
)
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import ETAPA_DE_DESCARGA, FUENTES
from plataforma_datos.orquestacion.reconstruir import etapas

RELOJ = {"hoy": "2026-11-24", "instante": "2026-11-24T10:06:07Z"}


def _sin_comprobar_la_guardia() -> None:
    """Las pruebas del ciclo no corren bajo la guardia: su comprobación se prueba aparte (test_guardia_sin_red)."""


class AlmacenQueAnota:
    """Un almacén que anota cada llamada que le llega."""

    def __init__(self) -> None:
        self.llamadas: list[str] = []

    def leer_control(self, clave: str, _bytes_maximos: int) -> tuple[bytes, str]:
        """Anota la lectura de un control.

        Returns:
            Un control vacío con su versión.
        """
        self.llamadas.append(f"leer_control {clave}")
        return b"{}", '"etiqueta"'

    def recuperar(self, clave: str, _destino: Path, _huella: str, _bytes_maximos: int) -> None:
        """Anota la recuperación de un objeto."""
        self.llamadas.append(f"recuperar {clave}")

    def guardar(self, *_argumentos: object) -> None:
        """Anota una escritura."""
        self.llamadas.append("guardar")

    def guardar_control(self, *_argumentos: object) -> bool:
        """Anota una escritura de control.

        Returns:
            Que la escritura se habría aplicado.
        """
        self.llamadas.append("guardar_control")
        return True

    def borrar(self, *_argumentos: object) -> None:
        """Anota un borrado."""
        self.llamadas.append("borrar")


class AlmacenSoloLecturaPruebas(unittest.TestCase):
    """El intermediario del almacén solo deja leer."""

    def test_deja_leer_y_ninguna_escritura_llega_al_almacen(self) -> None:
        """Deja leer y ninguna escritura llega al almacén."""
        real = AlmacenQueAnota()
        almacen = base_del_ensayo.AlmacenSoloLectura(real)  # type: ignore[arg-type]
        almacen.leer_control("control/referencia.json", 10)
        almacen.recuperar("generaciones/x.json", Path("/no/se/usa"), "x", 10)
        with self.assertRaises(PermissionError):
            almacen.guardar("objetos/a", Path("a"), "a", 1)
        with self.assertRaises(PermissionError):
            almacen.guardar_control("control/referencia.json", b"{}", None)
        with self.assertRaises(PermissionError):
            almacen.borrar("objetos/a")
        self.assertEqual(real.llamadas, ["leer_control control/referencia.json", "recuperar generaciones/x.json"])


class CicloPruebas(unittest.TestCase):
    """El ciclo del ensayo, con un candidato doble."""

    def setUp(self) -> None:
        """Prepara una salida propia con el código del ensayo anotado, como lo deja `ejecutar`."""
        self.salida = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.salida)
        (self.salida / "pasos").mkdir()
        (self.salida / "pasos" / "codigo.json").write_text(json.dumps({"revision": "a" * 40, "arbol": "b" * 40}))

    def originales(self, *sin_procedencia: str) -> None:
        """Deja en el candidato el lote de originales de cada fuente que lo exige, salvo los de `sin_procedencia`."""
        actualizacion = self.salida / "candidato" / DATOS_RELATIVOS
        (actualizacion / "validados" / "tich").mkdir(parents=True)
        (actualizacion / "validados" / "tich" / "edicion.json").write_text('{"anio": "2026"}')
        # Una subcarpeta sin procedencia en otra fuente no la deja sin originales: no es un lote de los lectores.
        (actualizacion / "originales" / "hp_life" / "recepciones").mkdir(parents=True)
        for fuente, lote in base_del_ensayo.lotes_con_procedencia(self.salida / "candidato").items():
            (actualizacion / "originales" / fuente / lote).mkdir(parents=True)
            if fuente not in sin_procedencia:
                (actualizacion / "originales" / fuente / lote / "procedencia.json").write_text("{}")

    def test_el_ciclo_no_empieza_fuera_de_la_guardia(self) -> None:
        """Si la comprobación de la guardia falla, el ciclo no ejecuta nada."""
        llamadas = []

        def sin_guardia() -> None:
            raise guardia_sin_red.SinGuardiaDeRed("fuera de la guardia")

        with self.assertRaises(guardia_sin_red.SinGuardiaDeRed):
            ensayo_grabado.ciclo(self.salida, "a" * 40, lambda *a, **o: llamadas.append(a), sin_guardia)
        self.assertEqual(llamadas, [])

    def test_ninguna_fuente_descarga_y_las_que_no_traen_originales_reutilizan_su_validado(self) -> None:
        """Ninguna fuente descarga; las que la base no trae con originales solo validan su versión vigente."""
        self.originales("tich", "fundae")
        llamadas = []

        def ejecutar(candidato: Path, accion: str, **opciones: object) -> dict:
            llamadas.append((candidato, accion, opciones))
            return {"resultado": "rechazado"}

        with redirect_stdout(io.StringIO()):
            self.assertEqual(ensayo_grabado.ciclo(self.salida, "a" * 40, ejecutar, _sin_comprobar_la_guardia), 1)
        [(candidato, accion, opciones)] = llamadas
        self.assertEqual((candidato, accion), (self.salida / "candidato", "actualizar-datos"))
        self.assertEqual(set(opciones["sin_descargar"]), set(FUENTES))
        self.assertEqual(set(opciones["reutilizar_validado"]), {"tich", "fundae"})
        # El ciclo ejecuta sus órdenes con el registro de pasos del ensayo por partes.
        self.assertIsInstance(opciones["ejecutor"], RegistroDePasos)
        sin_descargar, reutilizar = opciones["sin_descargar"], opciones["reutilizar_validado"]
        etapas_por_fuente = {
            fuente: [orden.etapa for orden in ordenes_de_la_fuente(fuente, sin_descargar, reutilizar)]
            for fuente in FUENTES
        }
        self.assertNotIn(ETAPA_DE_DESCARGA, {etapa for lista in etapas_por_fuente.values() for etapa in lista})
        self.assertEqual((etapas_por_fuente["tich"], etapas_por_fuente["fundae"]), (["validar"], ["validar"]))
        cobertura = json.loads((self.salida / "recibo.json").read_text())["coberturaDelEnsayo"]
        self.assertEqual(cobertura["tich"], base_del_ensayo.REUTILIZADA)
        self.assertEqual(cobertura["esco"], base_del_ensayo.PREPARADA)
        self.assertEqual(cobertura["hechos_informe"], base_del_ensayo.SOLO_SE_VALIDA)
        # Como el supervisor, también con el recibo rechazado se intenta exportar la generación, y se dice por qué no.
        generacion = json.loads((self.salida / "recibo.json").read_text())["generacionDelEnsayo"]
        self.assertEqual(generacion["estado"], generacion_del_ensayo.NO_CONSERVADA)
        self.assertEqual(generacion["supervisor"], generacion_del_ensayo.SUPERVISOR_RECHAZA)
        self.assertFalse((self.salida / "generacion-resultado").exists())

    def test_un_recibo_validado_exporta_la_generacion_que_se_conservaria(self) -> None:
        """Un recibo validado exporta la generación que se conservaría y dice cómo trató cada fuente."""
        self.originales()
        conservada = {"estado": "conservada", "sha256Manifiesto": "c" * 64, "supervisor": "conserva"}
        with (
            patch.object(ensayo_grabado, "exportar_en_local", return_value=conservada) as exportar,
            redirect_stdout(io.StringIO()),
        ):
            codigo = ensayo_grabado.ciclo(
                self.salida, "a" * 40, lambda *_a, **_o: {"resultado": "validado"}, _sin_comprobar_la_guardia
            )
        self.assertEqual(codigo, 0)
        exportar.assert_called_once_with(
            self.salida / "candidato", self.salida / "generacion-resultado", "a" * 40, "validado"
        )
        recibo = json.loads((self.salida / "recibo.json").read_text())
        self.assertEqual(recibo["generacionDelEnsayo"], conservada)
        self.assertEqual(recibo["resultado"], "validado")
        self.assertNotIn(base_del_ensayo.REUTILIZADA, recibo["coberturaDelEnsayo"].values())

    def test_un_recibo_validado_con_la_generacion_no_conservada_se_detiene_como_el_supervisor(self) -> None:
        """Con el recibo validado y la generación sin conservar, el ciclo devuelve uno, como el supervisor."""
        self.originales()
        no_conservada = {
            "estado": generacion_del_ensayo.NO_CONSERVADA,
            "supervisor": generacion_del_ensayo.SUPERVISOR_SE_DETIENE,
        }
        with (
            patch.object(ensayo_grabado, "exportar_en_local", return_value=no_conservada),
            redirect_stdout(io.StringIO()),
        ):
            codigo = ensayo_grabado.ciclo(
                self.salida, "a" * 40, lambda *_a, **_o: {"resultado": "validado"}, _sin_comprobar_la_guardia
            )
        self.assertEqual(codigo, 1)
        recibo = json.loads((self.salida / "recibo.json").read_text())
        self.assertEqual((recibo["resultado"], recibo["generacionDelEnsayo"]), ("validado", no_conservada))

    def test_el_ciclo_corre_con_el_interprete_del_candidato(self) -> None:
        """La orden del ciclo usa el intérprete del candidato, envuelta en la guardia."""
        orden = ensayo_grabado.orden_del_ciclo(self.salida, "a" * 40)
        self.assertEqual(orden[:3], guardia_sin_red.con_guardia([]))
        self.assertEqual(orden[3], str(self.salida / "candidato" / ".venv" / "bin" / "python"))
        self.assertEqual(orden[4:8], ["-m", "plataforma_datos.orquestacion.ensayo_grabado", "ciclo", "--salida"])


class ReutilizarValidadoPruebas(unittest.TestCase):
    """Reutilizar el validado es solo del ensayo: sin la marca, el ciclo prepara como siempre."""

    def test_una_fuente_que_reutiliza_su_validado_solo_valida(self) -> None:
        """Una fuente que reutiliza su validado solo valida."""
        self.assertEqual([o.etapa for o in ordenes_de_la_fuente("tich", ("tich",), ("tich",))], ["validar"])

    def test_sin_la_marca_del_ensayo_la_conducta_no_cambia(self) -> None:
        """Sin la marca del ensayo, el ciclo prepara cada fuente como siempre."""
        self.assertEqual(Opciones().reutilizar_validado, ())
        self.assertEqual(opciones_de_la_accion("actualizar-datos").reutilizar_validado, ())
        for fuente in FUENTES:
            self.assertEqual([o.etapa for o in ordenes_de_la_fuente(fuente, ())], list(etapas(True, fuente)))
            self.assertEqual([o.etapa for o in ordenes_de_la_fuente(fuente, (fuente,))], list(etapas(False, fuente)))

    def test_una_fuente_que_se_descarga_no_puede_reutilizar_su_validado(self) -> None:
        """Una fuente que se descarga no puede reutilizar su validado."""
        with self.assertRaises(ValueError):
            actualizar_con_resultado(Path("/no/existe"), Opciones(reutilizar_validado=("tich",)))


class EjecutarPruebas(unittest.TestCase):
    """La orden entera, con el candidato y el ciclo dobles."""

    def setUp(self) -> None:
        """Prepara una carpeta temporal propia."""
        self.carpeta = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.carpeta)

    def test_la_salida_no_puede_estar_en_el_repositorio(self) -> None:
        """La salida no puede estar en el repositorio."""
        with self.assertRaises(ValueError):
            ensayo_grabado.ejecutar(ensayo_grabado.RAIZ / "salida-del-ensayo", self.carpeta, RELOJ)
        self.assertFalse((ensayo_grabado.RAIZ / "salida-del-ensayo").exists())

    def test_el_ciclo_se_lanza_desde_el_candidato_y_sin_secretos_ni_proxy(self) -> None:
        """El ciclo corre desde la carpeta del candidato, con el entorno de producción, su reloj y sin secretos."""
        salida = self.carpeta / "salida"
        heredado = {
            "GH_TOKEN": "g",
            "CLOUDFLARE_API_TOKEN": "c",
            "HTTPS_PROXY": "http://proxy",
            "PATH": "/usr/bin:/bin",
        }
        with (
            patch.dict(ensayo_grabado.os.environ, heredado),
            patch.object(ensayo_grabado, "revision_limpia", return_value="a" * 40),
            patch.object(ensayo_grabado, "codigo_de", return_value={"revision": "a" * 40, "arbol": "b" * 40}),
            patch.object(ensayo_grabado, "preparar_candidato"),
            patch.object(ensayo_grabado.subprocess, "run") as lanzar,
            redirect_stdout(io.StringIO()) as consola,
        ):
            lanzar.return_value.returncode = 1
            self.assertEqual(ensayo_grabado.ejecutar(salida, self.carpeta, RELOJ), 1)
        self.assertEqual(lanzar.call_args.kwargs["cwd"], salida / "candidato")
        entorno = lanzar.call_args.kwargs["env"]
        self.assertFalse({"GH_TOKEN", "CLOUDFLARE_API_TOKEN", "HTTPS_PROXY"} & set(entorno))
        self.assertEqual((entorno["HOME"], entorno["TMPDIR"]), (str(salida / "hogar"), str(salida / "temporales")))
        self.assertEqual(entorno["FARO_INSTANTE"], RELOJ["instante"])
        self.assertIn("El ciclo se cortó sin dejar su recibo (código 1)", consola.getvalue())

    def test_un_arbol_con_cambios_sin_confirmar_no_se_ensaya(self) -> None:
        """Con cambios sin confirmar, las huellas no serían las de HEAD: el ensayo no empieza."""
        repositorio = self.carpeta / "repo"
        repositorio.mkdir()
        for orden in (
            ["init", "-q"],
            [
                "-c",
                "user.name=Prueba",
                "-c",
                "user.email=prueba@ejemplo.invalid",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "a",
            ],
        ):
            subprocess.run(["git", "-C", str(repositorio), *orden], check=True, capture_output=True)
        self.assertRegex(base_del_ensayo.revision_limpia(repositorio), "^[0-9a-f]{40}$")
        (repositorio / "nuevo.txt").write_text("sin confirmar")
        with self.assertRaisesRegex(ValueError, "sin confirmar"):
            base_del_ensayo.revision_limpia(repositorio)


class RelojYEntornoPruebas(unittest.TestCase):
    """El reloj único del ensayo y el entorno del ciclo."""

    def setUp(self) -> None:
        """Prepara una carpeta temporal propia."""
        self.salida = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.salida)

    def test_el_instante_por_omision_es_el_comienzo_del_ensayo(self) -> None:
        """Por omisión, el instante es el comienzo del ensayo, al segundo: ya pasado para todo lo que corre luego."""
        comienzo = datetime(2026, 11, 24, 10, 6, 7, 890, tzinfo=UTC)
        self.assertEqual(entorno_del_ensayo.reloj_del_ensayo(None, None, comienzo), RELOJ)
        self.assertEqual(entorno_del_ensayo.reloj_del_ensayo("2026-11-24", None, comienzo), RELOJ)
        antes = datetime.now(UTC).replace(microsecond=0)
        instante = entorno_del_ensayo.reloj_del_ensayo(None, None)["instante"]
        self.assertTrue(antes <= datetime.fromisoformat(instante.replace("Z", "+00:00")) <= datetime.now(UTC))

    def test_otro_dia_de_validacion_necesita_su_instante(self) -> None:
        """Con un día de validación que no es el del comienzo, el comienzo no le sirve de instante: hay que darlo."""
        comienzo = datetime(2026, 11, 24, 12, tzinfo=UTC)
        with self.assertRaises(ValueError):
            entorno_del_ensayo.reloj_del_ensayo("2026-11-20", None, comienzo)
        reloj = entorno_del_ensayo.reloj_del_ensayo("2026-11-20", "2026-11-20T09:00:00Z", comienzo)
        self.assertEqual(reloj, {"hoy": "2026-11-20", "instante": "2026-11-20T09:00:00Z"})

    def test_un_reloj_mal_escrito_se_rechaza(self) -> None:
        """Un reloj mal escrito se rechaza."""
        with self.assertRaises(ValueError):
            entorno_del_ensayo.reloj_del_ensayo("2026-11-24", "2026-11-24 05:06")
        with self.assertRaises(ValueError):
            entorno_del_ensayo.reloj_del_ensayo("24/11/2026", None)

    def test_reloj_de_no_admite_instante_y_se_comprueba(self) -> None:
        """--reloj-de no se combina con --instante ni --hoy, y el reloj leído de unas huellas se comprueba."""
        huellas = self.salida / "huellas.json"
        huellas.write_text(json.dumps({"reloj": RELOJ}))
        base = ["ejecutar", "--base", str(self.salida), "--salida", str(self.salida / "s"), "--reloj-de", str(huellas)]
        for extra in (["--instante", RELOJ["instante"]], ["--hoy", RELOJ["hoy"]]):
            with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
                ensayo_grabado.main([*base, *extra])
        with patch.object(ensayo_grabado, "ejecutar", return_value=0) as ejecutar:
            self.assertEqual(ensayo_grabado.main(base), 0)
        self.assertEqual(ejecutar.call_args.args[2], RELOJ)
        huellas.write_text(json.dumps({"reloj": {"hoy": "2026-11-24", "instante": "mañana"}}))
        with self.assertRaises(ValueError):
            ensayo_grabado.main(base)

    def test_el_ciclo_no_recibe_secretos_ni_proxy(self) -> None:
        """El ciclo recibe el entorno de las órdenes de producción, sin proxy, con su reloj y sus carpetas."""
        heredado = {
            "PATH": "/bin",
            "GH_TOKEN": "g",
            "CLOUDFLARE_API_TOKEN": "c",
            "HTTPS_PROXY": "http://proxy",
            "http_proxy": "http://proxy",
            "FARO_ALMACEN_SECRET_ACCESS_KEY": "s",
        }
        entorno = entorno_del_ensayo.entorno_del_ciclo(heredado, RELOJ, self.salida)
        self.assertFalse(set(heredado) - {"PATH"} & set(entorno))
        self.assertEqual(entorno["PATH"], "/bin")
        self.assertEqual((entorno["FARO_HOY"], entorno["FARO_INSTANTE"]), (RELOJ["hoy"], RELOJ["instante"]))
        self.assertTrue(Path(entorno["HOME"]).is_relative_to(self.salida))
        # Como el candidato del ejecutor: su exportación completa los renombres del paquete.
        self.assertEqual(ordenes_del_paquete(entorno)[0], EXPORTAR_EN_EL_CICLO_OPERATIVO)
        self.assertTrue(Path(entorno["TMPDIR"]).is_relative_to(self.salida))

    def test_una_orden_hija_del_ciclo_recibe_el_reloj(self) -> None:
        """Una orden hija del ciclo recibe el reloj: el filtro de las órdenes deja pasar FARO_HOY y FARO_INSTANTE."""
        entorno = entorno_de_las_ordenes(entorno_del_ensayo.entorno_del_ciclo({"PATH": "/bin"}, RELOJ, self.salida))
        self.assertEqual((entorno["FARO_HOY"], entorno["FARO_INSTANTE"]), (RELOJ["hoy"], RELOJ["instante"]))

    def test_instante_fijado_o_ausente(self) -> None:
        """El instante fijado se lee tal cual; si no hay, la hora es la real; uno mal escrito se rechaza."""
        self.assertIsNone(instante_del_ciclo.fijado({}))
        self.assertEqual(instante_del_ciclo.fijado({"FARO_INSTANTE": "2026-11-24T05:06:07Z"}), "2026-11-24T05:06:07Z")
        with self.assertRaises(ValueError):
            instante_del_ciclo.fijado({"FARO_INSTANTE": "mañana"})


if __name__ == "__main__":
    unittest.main()
