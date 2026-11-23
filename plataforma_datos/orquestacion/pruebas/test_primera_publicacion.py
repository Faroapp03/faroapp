"""Pruebas de la primera publicación de un módulo: automática, recuperable y con los casos que siguen siendo manuales.

Cada prueba monta el repositorio mínimo de test_actualizacion_por_modulos, quita de lo publicado las carpetas de un
módulo del registro (como el primer ciclo real de la EPA, la EAES o las ofertas) y ejecuta la actualización con el
ejecutor simulado, que escribe en el área la versión «nuevo <fuente>».
"""

import shutil
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, modulos
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import (
    VALIDADOS,
    Base,
    EjecutorDeModulos,
    corte_en,
    montar,
    publicado,
    restos,
)

NUEVO = "epa"
CARPETA_NUEVA = VALIDADOS[NUEVO]
DIARIO_NUEVO = f"diario-{NUEVO}.json"
ORDEN_MINIMA = 4  # python, -m, módulo y etapa


def modulo(identificador: str) -> modulos.Modulo:
    """El módulo del registro con ese identificador.

    Returns:
        El módulo.
    """
    return next(registrado for registrado in modulos.MODULOS if registrado.id == identificador)


class EjecutorConCambios(EjecutorDeModulos):
    """El simulado: «preparar» crea la carpeta validada si falta, y con efecto extra al preparar una fuente.

    Anota también si el paquete, al exportarse, encuentra la carpeta validada del módulo nuevo.
    """

    def __init__(
        self, fuente: str = NUEVO, efecto: Callable[[Path], None] = lambda area: None, **opciones: object
    ) -> None:
        super().__init__(**opciones)
        self.fuente, self.efecto = fuente, efecto
        self.en_la_exportacion: list[bool] = []

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Responde como el simulado y añade el efecto al preparar su fuente.

        Returns:
            El resultado de la orden.
        """
        por_modulo = {adaptador.__name__: nombre for nombre, adaptador in actualizar.FUENTES_EN_ORDEN}
        fuente = por_modulo.get(orden[2]) if len(orden) >= ORDEN_MINIMA else None
        preparando = fuente is not None and orden[3] == "preparar"
        if preparando:
            (area / VALIDADOS[fuente]).mkdir(parents=True, exist_ok=True)
        resultado = super().__call__(orden, area)
        if preparando and fuente == self.fuente:
            self.efecto(area)
        if "plataforma_datos.orquestacion.exportar_paquete" in orden:
            self.en_la_exportacion.append((area / CARPETA_NUEVA / "v.json").is_file())
        return resultado


class Nuevo(Base):
    """El módulo nuevo (sus carpetas no están publicadas) en un ciclo normal."""

    def setUp(self) -> None:
        """Quita lo publicado del módulo nuevo y recoge la huella de lo demás."""
        super().setUp()
        shutil.rmtree(self.raiz / CARPETA_NUEVA)
        self.antes = publicado(self.raiz)

    def test_en_verde_se_publica_sola(self) -> None:
        """Sus carpetas quedan publicadas, el veredicto es verde con su huella y la exportación las encuentra."""
        ejecutor = EjecutorConCambios()
        self.assertEqual(self.actualizar(ejecutor), 0)
        self.assertEqual((self.raiz / CARPETA_NUEVA / "v.json").read_text(encoding="utf-8"), f"nuevo {NUEVO}")
        registro = self.estado()["modulos"][NUEVO]
        self.assertEqual(registro["veredicto"], estado.VERDE)
        carpetas = modulos.carpetas(modulo(NUEVO))
        self.assertEqual(registro["ultima_version_buena"]["huella"], actualizar.huella(self.raiz, carpetas))
        self.assertEqual(ejecutor.en_la_exportacion, [True])
        self.assertEqual(self.estado()["modulos"][modulos.PAQUETE]["veredicto"], estado.VERDE)
        self.assertEqual(restos(self.raiz), [])

    def test_en_rojo_no_publica_nada_y_el_ciclo_sigue(self) -> None:
        """Si falla, ninguna carpeta aparece en lo publicado ni en el área, y los demás módulos publican lo suyo."""
        self.assertEqual(self.actualizar(EjecutorConCambios(), conservar_area=True), 0)
        verde = publicado(self.raiz)
        shutil.rmtree(self.raiz / CARPETA_NUEVA)
        ejecutor = EjecutorConCambios(fallos={NUEVO: "codigo"})
        self.assertEqual(self.actualizar(ejecutor, conservar_area=True), actualizar.CODIGO_AMBAR)
        self.assertFalse((self.raiz / CARPETA_NUEVA).exists())
        self.assertFalse((self.area / CARPETA_NUEVA).exists())
        self.assertEqual(self.estado()["modulos"][NUEVO]["veredicto"], estado.AMBAR)
        self.assertEqual(self.estado()["modulos"]["eaes"]["veredicto"], estado.VERDE)
        despues = publicado(self.raiz)
        self.assertEqual(
            {k: v for k, v in despues.items() if k != NUEVO}, {k: v for k, v in verde.items() if k != NUEVO}
        )
        self.assertEqual(restos(self.raiz), [])

    def test_ensayo_no_publica_nada(self) -> None:
        """Con --ensayo, el módulo nuevo produce su versión en el área y lo publicado sigue sin ella."""
        self.assertEqual(self.actualizar(EjecutorConCambios(), ensayo=True), 0)
        self.assertFalse((self.raiz / CARPETA_NUEVA).exists())
        self.assertEqual(publicado(self.raiz), self.antes)
        self.assertEqual(restos(self.raiz), [])

    def test_un_fallo_del_disco_a_mitad_retira_lo_creado(self) -> None:
        """Con dos carpetas nuevas, si falla colocar la segunda, la primera tampoco queda y el motivo lo dice."""
        propias = modulos.carpetas(modulo(NUEVO))
        ejecutor = EjecutorConCambios(NUEVO, lambda area: (area / propias[0]).mkdir(parents=True))
        colocar = Path.rename

        def falla_en_la_segunda(ruta: Path, destino: Path) -> Path:
            if ruta == self.raiz / f"{propias[2]}.nuevo":
                raise OSError("disco lleno (simulado)")
            return colocar(ruta, destino)

        with mock.patch.object(Path, "rename", falla_en_la_segunda):
            self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        self.assertEqual([(self.raiz / ruta).exists() for ruta in propias], [False, False, False])
        self.assertIn("disco lleno", self.estado()["modulos"][NUEVO]["motivo"])
        self.assertEqual(restos(self.raiz), [])

    def test_un_corte_a_mitad_no_deja_la_carpeta_a_medias(self) -> None:
        """Con el proceso cortado en cada operación de disco, tras recuperar la carpeta está entera o no está."""
        propias = modulos.carpetas(modulo(NUEVO))
        ejecutor_con = lambda: EjecutorConCambios(NUEVO, lambda area: (area / propias[0]).mkdir(parents=True))  # noqa: E731
        numero, a_medias = 0, 0
        while True:
            numero += 1
            with corte_en(numero):
                try:
                    self.actualizar(ejecutor_con(), solo=(NUEVO,))
                    break
                except Corte:
                    pass
            a_medias += (
                any((self.raiz / ruta).exists() for ruta in propias)
                and (self.raiz / "var" / "actualizacion" / "ejecuciones" / DIARIO_NUEVO).exists()
            )
            with mock.patch("builtins.print"):
                actualizar.recuperar_todo(self.raiz)
            existen = [(self.raiz / ruta).exists() for ruta in propias]
            self.assertIn(existen, ([False] * 3, [True, False, True]), f"corte {numero}")
            self.assertEqual(restos(self.raiz), [], f"corte {numero}")
            shutil.rmtree(self.raiz)
            montar(self.raiz)
            shutil.rmtree(self.raiz / CARPETA_NUEVA)
        self.assertGreater(a_medias, 0)


class Desaparece(Base):
    """Lo que sigue necesitando a una persona."""

    def test_una_carpeta_publicada_que_el_modulo_ya_no_produce(self) -> None:
        """El Consorci tenía su lista publicada y ya no la produce: nada cambia y el motivo dice que desaparece."""
        consorci = modulo("consorci")
        lista = modulos.carpetas(consorci)[0]
        (self.raiz / lista).mkdir(parents=True)
        (self.raiz / lista / "lista.json").write_text("publicada", encoding="utf-8")
        self.antes = publicado(self.raiz)
        ejecutor = EjecutorConCambios("consorci", lambda area: shutil.rmtree(area / lista))
        self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        motivo = self.estado()["modulos"]["consorci"]["motivo"]
        self.assertIn(f"desaparece {lista}", motivo)
        self.assertIn("se publica a mano", motivo)
        self.assertEqual(publicado(self.raiz)["consorci"], self.antes["consorci"])
        self.assertEqual(restos(self.raiz), [])


class Rutas(unittest.TestCase):
    """`publicar` y `restaurar` sobre árboles pequeños."""

    def setUp(self) -> None:
        """Dos árboles vacíos: lo publicado y el área."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz, self.area = Path(temporal.name) / "raiz", Path(temporal.name) / "area"
        (self.raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
        self.area.mkdir()

    def test_archivo_que_pasa_a_carpeta(self) -> None:
        """Una ruta que cambia entre archivo y carpeta se publica a mano, y el mensaje lo dice."""
        (self.raiz / "a").write_text("archivo", encoding="utf-8")
        (self.area / "a").mkdir()
        (self.area / "a" / "x").write_text("x", encoding="utf-8")
        with self.assertRaisesRegex(OSError, "a cambia entre archivo y carpeta: se revisa y se publica a mano"):
            actualizar.publicar(self.raiz, self.area, "oit", ("a",), False)
        self.assertEqual((self.raiz / "a").read_text(encoding="utf-8"), "archivo")

    def test_el_paquete_sigue_sin_crear_rutas_solo(self) -> None:
        """La primera publicación automática es de los módulos del registro; el paquete no crea rutas nuevas."""
        (self.area / "b").mkdir()
        with self.assertRaisesRegex(OSError, "aparece b: se revisa y se publica a mano"):
            actualizar.publicar(self.raiz, self.area, modulos.PAQUETE, ("b",), False)
        self.assertFalse((self.raiz / "b").exists())

    def test_modulo_nuevo_con_una_ruta_publicada_y_otra_nueva(self) -> None:
        """Sustituye la que existe, crea la nueva y deja la huella de lo publicado."""
        for base, texto in ((self.raiz, "antes"), (self.area, "despues")):
            (base / "a").mkdir()
            (base / "a" / "x").write_text(texto, encoding="utf-8")
        (self.area / "b").mkdir()
        (self.area / "b" / "y").write_text("nueva", encoding="utf-8")
        resultado = actualizar.publicar(self.raiz, self.area, "oit", ("a", "b", "c"), False)
        self.assertEqual(resultado.veredicto, estado.VERDE)
        self.assertEqual(resultado.publicado, actualizar.huella(self.raiz, ("a", "b", "c")))
        self.assertEqual((self.raiz / "b" / "y").read_text(encoding="utf-8"), "nueva")
        self.assertEqual((self.raiz / "a" / "x").read_text(encoding="utf-8"), "despues")
        self.assertFalse((self.raiz / "c").exists())

    def test_restaurar_con_rutas_que_aun_no_estan_publicadas(self) -> None:
        """El área recupera lo publicado y pierde lo que lo publicado todavía no tiene."""
        (self.raiz / "a").mkdir()
        (self.raiz / "a" / "x").write_text("publicada", encoding="utf-8")
        (self.area / "a").mkdir()
        (self.area / "a" / "x").write_text("otra", encoding="utf-8")
        (self.area / "b").mkdir()
        (self.area / "b" / "y").write_text("nueva", encoding="utf-8")
        actualizar.restaurar(self.raiz, self.area, ("a", "b"))
        self.assertEqual((self.area / "a" / "x").read_text(encoding="utf-8"), "publicada")
        self.assertFalse((self.area / "b").exists())


if __name__ == "__main__":
    unittest.main()
