"""La regla de retirada activa y la cuarentena del paquete no se pisan, y la retirada amplia se avisa con su cifra.

Lo que la regla activa de una fuente retira con su evidencia no es una pérdida sin explicar: no lleva el archivo a
cuarentena. Lo que el archivo pierde además sí, aunque coincida con un ciclo en que la regla retira. Con la regla en
sombra todo es como sin ella, y la regla de una fuente no explica lo que pierde el archivo de otra.
"""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.activacion_de_la_retirada import CRITERIO
from plataforma_datos.cursos.decisiones_retirada import guardar_registro as guardar_decisiones
from plataforma_datos.cursos.estado_de_la_retirada import guardar_registro
from plataforma_datos.cursos.pruebas.test_error_de_retirada import lecturas_de, registros_de
from plataforma_datos.orquestacion import cuarentena_del_paquete as cuarentena
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas
from plataforma_datos.orquestacion.aviso_de_la_retirada import retirada_amplia
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import validar_retirada_amplia
from plataforma_datos.orquestacion.pruebas.test_cuarentena_del_paquete import escribir
from plataforma_datos.orquestacion.retiradas_explicadas import retiradas_explicadas

ORIGENES = {
    "consorci.json": "var/actualizacion/validados/consorci/consorci.json",
    "citilab.json": "var/actualizacion/validados/citilab/citilab.json",
}
CICLO_UTC = "2026-11-13T05:00:00Z"


def unidades(cuantas: int, *, desde: int = 0) -> list[dict[str, str]]:
    """Unidades de un archivo del paquete con identificadores en orden.

    Returns:
        Las unidades `u000`, `u001`… desde la posición pedida.
    """
    return [{"id": f"u{numero:03d}"} for numero in range(desde, desde + cuantas)]


def regla(  # noqa: PLR0913 - Cada argumento es un hecho distinto del ciclo que se deja guardado.
    raiz: Path, fuente: str, estado: str, retiradas: list[str], mantenidas: int, *, activada_utc: str | None = None
) -> None:
    """Deja una fuente con ese modo y un último ciclo cuya regla retira esos cursos, con su evidencia.

    La decisión es la de la regla real sobre un curso que desaparece del censo, repetida para cada curso pedido. Con
    `activada_utc`, el estado guarda además que la regla se activó a esa hora con 30 decisiones comprobadas.
    """
    lecturas = lecturas_de("1100", ("formacion", "soc:curso"))
    (registro,) = registros_de(lecturas, desde=3)
    plantilla = registro["decisiones"][0]
    registro |= {
        "fuente": fuente,
        "ambito": f"{fuente}:curso",
        "decisiones": [{**plantilla, "curso": curso} for curso in sorted(retiradas)],
        "mantenidas": mantenidas,
    }
    guardar_decisiones(raiz, registro)
    activa = estado == "activa"
    lectura_id = lecturas[3]["lectura_id"]
    guardar_registro(
        raiz,
        {
            "version": 1,
            "fuente": fuente,
            "numero": 1,
            "ciclo": sha256_json([lectura_id]),
            "lecturas": [lectura_id],
            "observado_utc": CICLO_UTC,
            "en_el_ciclo": estado,
            "estado": estado,
            "cambio": None,
            "ultimo_cambio": (
                None
                if activada_utc is None
                else {"cambio": "activada", "decisiones": 30, "observado_utc": activada_utc}
            ),
            "confirmadas": 30 if activa else 3,
            "ciclos": 7 if activa else 1,
            "aplicadas": [lectura_id] if activa else [],
            "consulta": {"confirman": 0, "contradicen": 0, "no_se_sabe": 0, "sin_comprobar": 0, "motivo": None},
            "comprobaciones": [],
            "aplicada_contradicha": False,
            "salud_con_historia": True,
            "criterio": CRITERIO.a_json(),
        },
    )


class PaqueteConRegla(unittest.TestCase):
    """Un paquete publicado de 100 ediciones del Consorci y 100 cursos de Citilab, y el área con el nuevo."""

    def setUp(self) -> None:
        """La raíz con lo publicado; el área tendrá lo exportado y el estado de la regla con que se exportó."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz, self.area = Path(temporal.name) / "raiz", Path(temporal.name) / "area"
        self.publicado = {"consorci.json": {"ediciones": unidades(100)}, "citilab.json": {"cursos": unidades(100)}}
        escribir(self.raiz / "datos", self.publicado, ORIGENES)

    def exportar(self, consorci: list[dict[str, str]], citilab: list[dict[str, str]] | None = None) -> None:
        """Escribe en el área el paquete nuevo."""
        nuevo = {"consorci.json": {"ediciones": consorci}, "citilab.json": {"cursos": citilab or unidades(100)}}
        escribir(self.area / "datos", nuevo, ORIGENES)

    def comparacion(self) -> piezas.Comparacion:
        """La comparación del ciclo, con lo que explica la regla, y su cuarentena aplicada.

        Returns:
            La comparación con su cuarentena.
        """
        explicadas = retiradas_explicadas(self.raiz, self.area)
        return cuarentena.poner_en_cuarentena(
            self.raiz, self.area, piezas.comparar(self.raiz, self.area, True, explicadas)
        )

    def test_lo_que_la_regla_activa_retira_con_evidencia_no_va_a_cuarentena_y_se_avisa(self) -> None:
        """(a) Activa retira el 30 % con evidencia: el archivo se publica sin cuarentena y el panel lo avisa."""
        retiradas = [unidad["id"] for unidad in unidades(30)]
        regla(self.area, "consorci", "activa", retiradas, mantenidas=70)
        self.exportar(unidades(70, desde=30))
        comparacion = self.comparacion()
        self.assertEqual(comparacion.perdidas, ())
        self.assertEqual(comparacion.retenidos, frozenset())
        self.assertEqual(comparacion.alarmas, [])
        self.assertEqual(retirada_amplia(self.area, "consorci"), {"retiradas": 30, "cursos": 100, "en": CICLO_UTC})

    def test_una_caida_de_la_fuente_sigue_en_cuarentena_aunque_la_regla_retire(self) -> None:
        """(b) Activa retira el 5 % y la fuente pierde además el 30 %: cuarentena por lo que no se explica."""
        regla(self.area, "consorci", "activa", [unidad["id"] for unidad in unidades(5)], mantenidas=95)
        self.exportar(unidades(65, desde=35))
        comparacion = self.comparacion()
        self.assertEqual(
            comparacion.perdidas, ({"archivo": "consorci.json", "medida": "entradas", "antes": 100, "despues": 65},)
        )
        self.assertEqual(comparacion.retenidos, {"consorci.json"})
        self.assertEqual(
            (self.area / "datos" / "consorci.json").read_bytes(), (self.raiz / "datos" / "consorci.json").read_bytes()
        )
        self.assertIsNone(retirada_amplia(self.area, "consorci"), "un 5 % no es una retirada amplia")

    def test_lo_explicado_solo_descuenta_lo_que_estaba_publicado_y_ya_no_esta(self) -> None:
        """Una retirada que sigue en el archivo nuevo, o que no estaba publicada, no explica ninguna pérdida."""
        retiradas = [unidad["id"] for unidad in unidades(30, desde=70)] + ["x-no-publicada"]
        regla(self.area, "consorci", "activa", retiradas, mantenidas=70)
        self.exportar(unidades(70))
        self.assertEqual(retiradas_explicadas(self.raiz, self.area)["consorci.json"], piezas.Explicada(30, 70))
        self.exportar(unidades(100))
        self.assertEqual(retiradas_explicadas(self.raiz, self.area), {})

    def test_en_sombra_todo_es_como_sin_la_regla(self) -> None:
        """(c) En sombra no hay nada explicado: la misma comparación y la misma cuarentena que sin la regla."""
        regla(self.area, "consorci", "sombra", [unidad["id"] for unidad in unidades(30)], mantenidas=70)
        self.exportar(unidades(70, desde=30))
        self.assertEqual(retiradas_explicadas(self.raiz, self.area), {})
        sin_regla = piezas.comparar(self.raiz, self.area)
        self.assertEqual(
            piezas.comparar(self.raiz, self.area, True, retiradas_explicadas(self.raiz, self.area)), sin_regla
        )
        self.assertEqual(self.comparacion().retenidos, {"consorci.json"})
        self.assertIsNone(retirada_amplia(self.area, "consorci"))

    def test_la_regla_de_una_fuente_no_explica_lo_que_pierde_otra(self) -> None:
        """(d) La regla del Consorci retira 30 unidades; Citilab pierde esas mismas 30 y va a cuarentena él solo."""
        retiradas = [unidad["id"] for unidad in unidades(30)]
        regla(self.area, "consorci", "activa", retiradas, mantenidas=70)
        self.exportar(unidades(70, desde=30), citilab=unidades(70, desde=30))
        comparacion = self.comparacion()
        self.assertEqual([perdida["archivo"] for perdida in comparacion.perdidas], ["citilab.json"])
        self.assertEqual(comparacion.retenidos, {"citilab.json"})
        self.assertIsNone(retirada_amplia(self.area, "citilab"))


class ContratoDelAviso(unittest.TestCase):
    """La retirada amplia viaja al panel con su forma cerrada."""

    def test_admite_su_forma_y_rechaza_cifras_imposibles(self) -> None:
        """Más retiradas que cursos, ninguna retirada o un campo de más no son un aviso del panel."""
        validar_retirada_amplia({"retiradas": 30, "cursos": 100, "en": CICLO_UTC})
        for malo in (
            {"retiradas": 101, "cursos": 100, "en": CICLO_UTC},
            {"retiradas": 0, "cursos": 100, "en": CICLO_UTC},
            {"retiradas": 30, "cursos": 100, "en": CICLO_UTC, "extra": 1},
            {"retiradas": 30, "cursos": 100},
        ):
            with self.assertRaises(ValueError):
                validar_retirada_amplia(malo)


if __name__ == "__main__":
    unittest.main()
