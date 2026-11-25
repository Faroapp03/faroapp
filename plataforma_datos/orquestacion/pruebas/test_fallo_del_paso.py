"""Un paso del paquete que falla dice en qué tramo y con qué error, y eso llega cerrado al diario y a su resumen.

`componer` falla de verdad (sus dependencias, sustituidas por dobles que fallan en un tramo concreto); su salida pasa
por el diagnóstico del informe como en el ciclo; `causas_del_paquete` la lee y el diario, la consola y el resumen lo
dicen con valores de listas cerradas. Una línea con valores fuera de lista se lee como `otra`; ningún texto libre pasa.
"""

import errno
import io
import json
import re
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from functools import partial
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.cursos import aplicar_fuentes_catalogo, componer_catalogo
from plataforma_datos.cursos.fallos_almacen import AUSENTE
from plataforma_datos.orquestacion import causas_del_ciclo as causas
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import fallo_del_paso, ordenes, resumen_diario
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe
from plataforma_datos.orquestacion.actualizar import Paso
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPONER_EL_CATALOGO, ENSAMBLADO
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import preparar

INFORME = f"{generacion.CARPETA_DE_INFORMES}/2026-11-25-073000"
COMIENZO = "2026-11-25T07:30:00+00:00"
CORTE = "2026-11-25T08:38:46Z"


def _lanzar(error: Exception) -> None:
    """Una orden que falla con `error`.

    Raises:
        Exception: Siempre, el error dado.
    """
    raise error


def _componer_que_falla(raiz: Path, dobles: dict[str, object]) -> tuple[int, str]:
    """Ejecuta `componer_catalogo.main` sobre `raiz`, con las dependencias de `dobles` sustituidas.

    Returns:
        El código de salida y la salida conjunta (estándar y de errores), como la recoge la actualización.
    """
    salida, errores = io.StringIO(), io.StringIO()
    componer = partial(componer_catalogo.componer, raiz=raiz, corte_utc=CORTE)
    with ExitStack() as pila:
        pila.enter_context(mock.patch.object(componer_catalogo, "componer", componer))
        for nombre, doble in dobles.items():
            pila.enter_context(mock.patch.object(componer_catalogo, nombre, doble))
        pila.enter_context(redirect_stdout(salida))
        pila.enter_context(redirect_stderr(errores))
        codigo = componer_catalogo.main()
    return codigo, salida.getvalue() + errores.getvalue()


def _almacen_admitido_sin_tocar(raiz: Path) -> dict[str, object]:
    """Dobles con que `componer` pasa sus primeros tramos sin almacén real y aplica las fuentes sobre la raíz.

    Returns:
        Los dobles por nombre del módulo.
    """
    base = raiz / componer_catalogo.almacen.RUTA
    return {
        "_almacen_admitido": mock.Mock(return_value=mock.Mock(snapshot=mock.Mock(ruta=base))),
        "_sin_identidades": mock.Mock(return_value=()),
        "fundae_conservado_sin_aplicar": mock.Mock(return_value=None),
        "_aplicar_hp": mock.Mock(return_value=base),
        "_aplicar_ciber": mock.Mock(return_value=base),
        "_aplicar_academy": mock.Mock(return_value=base),
    }


class PruebaComponerQueFalla(unittest.TestCase):
    """`componer` termina su salida con la línea cerrada del tramo y la clase del error."""

    def setUp(self) -> None:
        """Una instalación vacía de la candidata."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name).resolve()

    def test_almacen_ausente_dice_su_tramo_su_clase_y_su_motivo(self) -> None:
        """Sin almacén falla en «almacen-admitido» con AlmacenNoDisponible y el motivo cerrado del almacén."""
        codigo, salida = _componer_que_falla(self.raiz, {})
        self.assertEqual(codigo, 1)
        self.assertEqual(
            salida.splitlines()[-1],
            f"fallo-paso tramo=almacen-admitido clase=AlmacenNoDisponible errno=- motivoAlmacen={AUSENTE}",
        )

    def test_disco_lleno_en_los_temporales_dice_su_errno(self) -> None:
        """Un OSError al crear las carpetas de trabajo lleva su errno simbólico."""
        dobles = {
            **_almacen_admitido_sin_tocar(self.raiz),
            "tempfile": mock.Mock(mkdtemp=mock.Mock(side_effect=OSError(errno.ENOSPC, "sin espacio"))),
        }
        codigo, salida = _componer_que_falla(self.raiz, dobles)
        self.assertEqual(codigo, 1)
        self.assertEqual(
            salida.splitlines()[-1], "fallo-paso tramo=temporales clase=OSError errno=ENOSPC motivoAlmacen=-"
        )

    def test_sqlite_en_una_fuente_nombra_la_fuente_y_la_clase_de_sqlite(self) -> None:
        """Un error de SQLite al aplicar Cibervoluntarios se nombra con su tramo y su clase, con el módulo delante."""
        dobles = {
            **_almacen_admitido_sin_tocar(self.raiz),
            "_aplicar_ciber": mock.Mock(side_effect=sqlite3.OperationalError("database is locked")),
        }
        codigo, salida = _componer_que_falla(self.raiz, dobles)
        self.assertEqual(codigo, 1)
        self.assertEqual(
            salida.splitlines()[-1],
            "fallo-paso tramo=cibervoluntarios clase=sqlite3.OperationalError errno=- motivoAlmacen=-",
        )
        self.assertFalse(list((self.raiz / "var").rglob(".componer-cursos-*")), "la limpieza no se hizo")

    def test_un_error_sin_motivo_sale_con_su_traza_y_la_linea(self) -> None:
        """Un KeyError (fuera de ERRORES_CON_MOTIVO) sale con 1, con su traza y con la línea al final."""
        dobles = {**_almacen_admitido_sin_tocar(self.raiz), "_aplicar_academy": mock.Mock(side_effect=KeyError("x"))}
        codigo, salida = _componer_que_falla(self.raiz, dobles)
        self.assertEqual(codigo, 1)
        self.assertIn("Traceback (most recent call last)", salida)
        self.assertEqual(
            salida.splitlines()[-1], "fallo-paso tramo=claude_academy clase=KeyError errno=- motivoAlmacen=-"
        )

    def test_las_fuentes_de_componer_tienen_su_carpeta_y_sus_tramos(self) -> None:
        """Cada fuente que aplica `componer` tiene carpeta de trabajo y tramos en la lista cerrada."""
        self.assertEqual(set(aplicar_fuentes_catalogo.CARPETAS_DE_LAS_FUENTES), set(fallo_del_paso.FUENTES_DE_COMPONER))
        for fuente in fallo_del_paso.FUENTES_DE_COMPONER:
            self.assertIn(fuente, fallo_del_paso.TRAMOS)
            self.assertIn(f"pendiente-{fuente}", fallo_del_paso.TRAMOS)


class PruebaLineaDeFallo(unittest.TestCase):
    """La línea se compone y se lee solo con valores de sus listas."""

    def test_el_tramo_mas_interno_es_el_que_vale(self) -> None:
        """Un error que sale de dos tramos queda marcado por el interior.

        Raises:
            ValueError: El error de la prueba, dentro de los dos tramos.
        """
        with (
            self.assertRaises(ValueError) as fallo,
            fallo_del_paso.tramo("proyeccion"),
            fallo_del_paso.tramo("publicar"),
        ):
            raise ValueError("x")
        self.assertIn("tramo=publicar", fallo_del_paso.linea(fallo.exception))

    def test_un_tramo_fuera_de_la_lista_no_se_admite(self) -> None:
        """Nombrar un tramo que la lista no tiene es un error del código, antes de ejecutar nada."""
        with self.assertRaises(ValueError), fallo_del_paso.tramo("tramo-inventado"):
            self.fail("El cuerpo del tramo se ejecutó")

    def test_una_subclase_se_nombra_por_la_clase_de_la_lista(self) -> None:
        """Una clase que la lista no nombra se lee por su antecesora más cercana que sí está, u «otra»."""

        class ErrorPropio(ValueError):
            pass

        self.assertEqual(fallo_del_paso.clase(ErrorPropio()), "ValueError")
        self.assertEqual(fallo_del_paso.clase(json.JSONDecodeError("x", "", 0)), "JSONDecodeError")
        self.assertEqual(fallo_del_paso.clase(RuntimeError()), "otra")

    def test_valores_fuera_de_lista_se_leen_como_otra(self) -> None:
        """Una línea bien formada pero con valores ajenos a sus listas no deja pasar ninguno."""
        self.assertEqual(
            fallo_del_paso.leer("fallo-paso tramo=…/privado clase=ClaseSecreta errno=EINVENTADO motivoAlmacen=texto"),
            {"tramo": "otra", "clase": "otra", "errno": "otra", "motivoAlmacen": "otra"},
        )

    def test_ningun_texto_libre_pasa(self) -> None:
        """Una línea que no encaja entera con la forma fija no se lee: ni una palabra de más ni un campo de menos."""
        for texto in (
            "fallo-paso tramo=hp_life clase=OSError errno=- motivoAlmacen=- y el disco de Ana",
            "fallo-paso tramo=hp_life clase=OSError errno=-",
            "Error: fallo-paso tramo=hp_life clase=OSError errno=- motivoAlmacen=-",
            "fallo-paso tramo=hp life clase=OSError errno=- motivoAlmacen=-",
            "",
        ):
            with self.subTest(texto=texto):
                self.assertIsNone(fallo_del_paso.leer(texto))

    def test_se_lee_la_ultima_linea_de_fallo(self) -> None:
        """Con texto antes y después, vale la última línea de fallo; los valores ausentes no se anotan."""
        salida = "Error: algo\nfallo-paso tramo=hp_life clase=OSError errno=EACCES motivoAlmacen=-\n"
        salida += "fallo-paso tramo=- clase=ValueError errno=- motivoAlmacen=-\nResourceWarning: ...\n"
        self.assertEqual(fallo_del_paso.leer(salida), {"clase": "ValueError"})

    def test_con_motivo_sin_linea_de_fallo_no_cambia(self) -> None:
        """Las órdenes de las fuentes siguen escribiendo solo «Error: motivo» y relanzando lo demás."""
        errores = io.StringIO()
        with redirect_stderr(errores):
            self.assertEqual(ordenes.con_motivo(partial(_lanzar, OSError("x"))), 1)
        self.assertEqual(errores.getvalue(), "Error: x\n")
        with self.assertRaises(KeyError):
            ordenes.con_motivo(partial(_lanzar, KeyError("x")))

    def test_el_informe_conserva_la_linea_aunque_se_agote_su_tope(self) -> None:
        """Cuando los diagnósticos anteriores agotan el total, el paso conserva su línea de fallo tras SIN_DETALLE."""
        relleno = "\n".join("x" * 199 for _ in range(40))
        linea = "fallo-paso tramo=fundae clase=HuellaIncorrecta errno=- motivoAlmacen=-"
        pasos = [Paso(f"fuente {n}", 1, 1.0, relleno) for n in range(5)]
        pasos.append(Paso(COMPONER_EL_CATALOGO.nombre, 1, 1.0, f"{relleno}\nError: huella\n{linea}\n"))
        ultimo = informe.diagnosticos(pasos)[-1]
        self.assertEqual(ultimo, f"{informe.SIN_DETALLE}\n{linea}")


class CicloDeLaCandidata(unittest.TestCase):
    """Una candidata con el paquete en ámbar y el informe de sus pasos."""

    def setUp(self) -> None:
        """Una candidata con el paquete en ámbar."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name).resolve()
        self.raiz = self.carpeta / "candidato"
        preparar(self.raiz)

    def escribir_ciclo(self, pasos: list[Paso], alarmas: list[str] | None = None) -> None:
        """Estado e informe del candidato como los escribe la actualización, con el diagnóstico de cada paso."""
        estado = json.loads((self.raiz / generacion.ESTADO).read_bytes())
        estado["actualizacion"].update(comienzo_utc=COMIENZO, informe=f"{INFORME}.md")
        estado["modulos"]["paquete"].update(ultimo_intento_utc=COMIENZO, veredicto="ámbar", motivo="")
        guardar_json(self.raiz / generacion.ESTADO, estado)
        filas = [
            {"nombre": p.nombre, "codigo": p.codigo} | ({} if d is None else {"diagnostico": d})
            for p, d in zip(pasos, informe.diagnosticos(pasos), strict=True)
        ]
        guardar_json(self.raiz / f"{INFORME}.json", {"pasos": filas, "comparacion": {"alarmas": alarmas or []}})


class PruebaFalloEnElDiario(CicloDeLaCandidata):
    """La línea del paso en rojo llega a `paquete retenido`, a la consola y a `retenciones.paquete`."""

    def registrar(self) -> tuple[dict, dict, str]:
        """Anota el paquete retenido como el supervisor y compone su resumen.

        Returns:
            El evento del diario, `retenciones.paquete` del resumen y la línea de la consola.
        """
        ruta, consola = self.carpeta / "diario.jsonl", io.StringIO()
        with redirect_stderr(consola), diario.abrir(ruta, {"operacion": "ejecutar", "run": "45567253187"}):
            causas.registrar_paquete(self.raiz, "rechazado")
        lineas = ruta.read_text().splitlines()
        resumen = json.loads(resumen_diario.componer(lineas, "ejecutar", "45567253187", "1"))
        return json.loads(lineas[0]), resumen["retenciones"]["paquete"], consola.getvalue().strip()

    def test_componer_que_falla_lo_dice_en_el_diario_la_consola_y_el_resumen(self) -> None:
        """El ciclo 45567253187, con su motivo: componer falla en «fundae» con un error de disco sin permiso."""
        instalacion = self.carpeta / "instalacion"
        instalacion.mkdir()
        dobles = {
            **_almacen_admitido_sin_tocar(instalacion),
            "_aplicar_fundae": mock.Mock(side_effect=PermissionError(errno.EACCES, "denegado", str(instalacion))),
        }
        codigo, salida = _componer_que_falla(instalacion, dobles)
        self.escribir_ciclo(
            [Paso("Exportar el paquete del motor", 0, 1.0, ""), Paso(COMPONER_EL_CATALOGO.nombre, codigo, 1.0, salida)]
        )
        evento, retenido, consola = self.registrar()
        fallo = {"tramo": "fundae", "clase": "PermissionError", "errno": "EACCES"}
        self.assertEqual(
            {c: evento.get(c) for c in ("fase", "estado", "paso", "codigo", *fallo)},
            {"fase": "paquete", "estado": "retenido", "paso": "componer-catalogo", "codigo": 1, **fallo},
        )
        self.assertNotIn("motivoAlmacen", evento)
        self.assertEqual(
            retenido,
            {"paso": "componer-catalogo", "codigo": 1, "alarmas": [], "legible": True, **fallo, "motivoAlmacen": None},
        )
        self.assertEqual(
            json.loads(consola),
            {"fase": "paquete", "estado": "retenido", "paso": "componer-catalogo", **fallo},
        )
        self.assertNotIn(str(instalacion), json.dumps(evento))

    def test_el_motivo_del_almacen_llega_al_resumen(self) -> None:
        """Un almacén ausente llega con su tramo, su clase y su motivo cerrado."""
        codigo, salida = _componer_que_falla(self.carpeta / "sin-almacen", {})
        self.escribir_ciclo([Paso(COMPONER_EL_CATALOGO.nombre, codigo, 1.0, salida)])
        _, retenido, _ = self.registrar()
        self.assertEqual(
            {c: retenido[c] for c in ("tramo", "clase", "errno", "motivoAlmacen")},
            {"tramo": "almacen-admitido", "clase": "AlmacenNoDisponible", "errno": None, "motivoAlmacen": AUSENTE},
        )

    def test_otra_orden_del_paquete_dice_su_clase_sin_tramo(self) -> None:
        """«Incorporar datos globales» deja su clase; sin tramos propios, el tramo no se anota."""
        salida = "Error: falta\nfallo-paso tramo=- clase=FileNotFoundError errno=ENOENT motivoAlmacen=-\n"
        self.escribir_ciclo([Paso(ENSAMBLADO[0].nombre, 1, 1.0, salida)])
        evento, retenido, _ = self.registrar()
        self.assertEqual(
            (evento["paso"], evento["clase"], evento["errno"]), ("incorporar-globales", "FileNotFoundError", "ENOENT")
        )
        self.assertNotIn("tramo", evento)
        self.assertIsNone(retenido["tramo"])

    def test_valores_fuera_de_lista_llegan_como_otra_y_nada_libre_pasa(self) -> None:
        """Una línea con valores ajenos llega como «otra» en el diario y en el resumen; la consola no los enseña."""
        salida = "fallo-paso tramo=disco-de-ana clase=Secreto errno=EINVENTADO motivoAlmacen=almacen-de-ana\n"
        self.escribir_ciclo([Paso(COMPONER_EL_CATALOGO.nombre, 1, 1.0, salida)])
        evento, retenido, consola = self.registrar()
        otra = dict.fromkeys(("tramo", "clase", "errno", "motivoAlmacen"), "otra")
        self.assertEqual({c: evento[c] for c in otra}, otra)
        self.assertEqual({c: retenido[c] for c in otra}, otra)
        self.assertNotIn("de-ana", json.dumps(evento) + json.dumps(retenido) + consola)


class PruebaAvisoDelCicloRechazado(CicloDeLaCandidata):
    """Lo que el aviso de un ciclo rechazado dice de dónde está el motivo es cierto en cada caso."""

    def aviso(self) -> str:
        """El párrafo fijo del aviso de `actualizar.yml` para un ciclo rechazado.

        Returns:
            Su texto, tal como lo imprime el aviso.
        """
        flujo = (Path(__file__).resolve().parents[3] / ".github/workflows/actualizar.yml").read_text(encoding="utf-8")
        (texto,) = re.findall(r"^\s*motivo='([^'$`\\]*)'$", flujo, re.MULTILINE)
        return texto

    def resumen(self, *anotar: Callable[[], None]) -> tuple[dict, str]:
        """Anota lo que hace el supervisor con un ciclo rechazado y compone su resumen.

        Returns:
            El resumen y todo lo que salió por la consola del job.
        """
        ruta, consola = self.carpeta / "rechazado.jsonl", io.StringIO()
        with redirect_stderr(consola), diario.abrir(ruta, {"operacion": "ejecutar", "run": "45567253187"}):
            for orden in anotar:
                orden()
        documento = json.loads(resumen_diario.componer(ruta.read_text().splitlines(), "ejecutar", "45567253187", "1"))
        return documento, consola.getvalue()

    def test_paquete_retenido_solo_por_alarmas_consta_en_el_resumen_aunque_la_consola_no_nombre_paso(self) -> None:
        """Sin paso en rojo, la alarma consta en «retenciones.paquete»; la consola no nombra paso ni fuente."""
        self.escribir_ciclo(
            [Paso(COMPONER_EL_CATALOGO.nombre, 0, 1.0, "")], ["ocupaciones.json desaparece del paquete"]
        )
        documento, consola = self.resumen(lambda: causas.registrar_paquete(self.raiz, "rechazado"))
        self.assertEqual(
            documento["retenciones"]["paquete"]["alarmas"], [{"tipo": "desaparece", "archivo": "ocupaciones.json"}]
        )
        self.assertIsNone(documento["retenciones"]["paquete"]["paso"])
        self.assertNotIn('"paso"', consola)
        self.assertNotIn('"fuente"', consola)

    def test_candidato_no_verificable_consta_en_el_resumen_aunque_la_consola_no_nombre_nada(self) -> None:
        """El error del recibo y la excepción constan en «retenciones.candidato»; la consola no enseña su clase."""
        documento, consola = self.resumen(
            lambda: diario.anotar("candidato", "excepcion", clase="OSError", funcion="candidato.verificar"),
            lambda: diario.anotar("candidato", "resultado", resultado="rechazado", error="candidato_no_verificable"),
        )
        self.assertEqual(
            documento["retenciones"]["candidato"],
            {"error": "candidato_no_verificable", "clase": "OSError", "funcion": "candidato.verificar"},
        )
        for privado in ("OSError", "candidato.verificar", "candidato_no_verificable"):
            self.assertNotIn(privado, consola)

    def test_generacion_no_conservada_consta_en_el_resumen_y_la_consola_no_enseña_su_clase(self) -> None:
        """La clase, la comprobación y la causa constan en «retenciones.generacion»; la consola no enseña la clase."""
        (self.raiz / ".datos-exportando-1").mkdir()

        def anotar() -> None:
            try:
                generacion.sin_recuperacion(self.raiz)
            except ValueError as error:
                causas.registrar_generacion_no_conservada(error)

        documento, consola = self.resumen(anotar)
        self.assertEqual(
            documento["retenciones"]["generacion"],
            {"clase": "GeneracionInvalida", "comprobacion": "sin_recuperacion", "causa": "recuperacion-pendiente"},
        )
        self.assertNotIn("GeneracionInvalida", consola)
        self.assertNotIn("clase", consola)

    def test_el_aviso_nombra_cada_apartado_del_resumen_donde_consta_el_motivo(self) -> None:
        """El párrafo del aviso nombra «retenciones», cada una de sus entradas y «fuentes»; el resumen los tiene."""
        documento, _ = self.resumen(lambda: diario.anotar("paquete", "ilegible"))
        self.assertIn("fuentes", documento)
        self.assertEqual(set(documento["retenciones"]), {"paquete", "generacion", "candidato"})
        aviso = self.aviso()
        for apartado in ("retenciones", "fuentes", *documento["retenciones"]):
            self.assertIn(apartado, aviso)
        self.assertNotIn("consta en el diario", aviso)
        self.assertIn("no quedó registrado", aviso)

    def test_en_la_consola_solo_el_evento_del_paquete_enseña_el_fallo_del_paso_y_solo_de_sus_listas(self) -> None:
        """Tramo, clase, errno y motivo del almacén salen solo en `paquete`, y un valor ajeno no sale."""
        valores = {"tramo": "fundae", "clase": "PermissionError", "errno": "EACCES", "motivoAlmacen": AUSENTE}
        self.assertEqual(
            json.loads(diario.linea_de_consola({"fase": "paquete", "estado": "retenido", **valores})),
            {"fase": "paquete", "estado": "retenido", **valores},
        )
        self.assertEqual(
            json.loads(
                diario.linea_de_consola(
                    {"fase": "paquete", "estado": "retenido", **dict.fromkeys(valores, "disco-de-ana")}
                )
            ),
            {"fase": "paquete", "estado": "retenido"},
        )
        for fase in ("candidato", "generacion", "etapa-fuente", "motor"):
            with self.subTest(fase=fase):
                self.assertEqual(
                    json.loads(diario.linea_de_consola({"fase": fase, "estado": "error", **valores})),
                    {"fase": fase, "estado": "error"},
                )


if __name__ == "__main__":
    unittest.main()
