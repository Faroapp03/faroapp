"""La regla de retirada de Claude Academy, de su estado guardado al catálogo de Cursos publicado y al aviso del panel.

Recorre el ciclo del paquete entero (`actualizar.ejecutar_paquete`) sobre una instalación temporal sin red con el
catálogo de Cursos de hoy ya publicado (el montaje de `test_academy_actualizacion`, que compone de verdad un almacén
admitido con un curso de Academy y otro de HP LIFE). El estado de la regla y sus decisiones con evidencia están
guardados como los deja el módulo de Academy al publicarse, el área se prepara como en cada ciclo y la orden de componer
ejecuta la composición real (`componer_catalogo.componer`), cuya selección retiene lo que retira la regla
(`retirada_en_el_catalogo`); las demás órdenes del paquete responden en verde. Con la regla activa, el curso retirado
con evidencia no se publica, el linaje privado de la entrega lleva el estado de la regla y la retención con su motivo,
la referencia pública apunta a un catálogo nuevo y el panel avisa de la activación y de la retirada amplia. Con la
misma regla en sombra, lo publicado no cambia ni un byte.
"""

import contextlib
import hashlib
import io
import json
import re
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos.estado_de_la_retirada import ultimo_registro
from plataforma_datos.cursos.pruebas import test_academy_actualizacion as academy
from plataforma_datos.cursos.seleccion_entrega_catalogo import RETIRADA_POR_EVIDENCIA
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.area_de_ensayo import preparar_area
from plataforma_datos.orquestacion.estado_de_la_actualizacion import VERDE, ResultadoDelModulo
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPONER_EL_CATALOGO, RUTAS_DE_LA_ENTREGA
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas.test_retirada_y_cuarentena import CICLO_UTC, regla

ACTIVADA_UTC = "2026-11-12T05:00:00Z"
AHORA = datetime(2026, 11, 13, 6, tzinfo=UTC)
RETIRADO = academy.ID
QUEDA = "hp-life:431:es"
REFERENCIA = "web/scripts/catalogo-cursos/referencia.js"
# El catálogo al que apunta la referencia pública, con su huella (publicar_catalogo la escribe así).
PUNTERO = re.compile(
    r"REFERENCIA = Object\.freeze\(\{\n  ruta: '(?P<ruta>[^']+)',\n  sha256: '(?P<sha256>[0-9a-f]{64})'"
)
# La validación real de la entrega, que el espía de cada prueba envuelve sin cambiarla.
VALIDAR = entrega.validar


class RetiradaDePuntaAPuntaEnElCatalogo(unittest.TestCase):
    """Una instalación con el catálogo de Cursos de hoy publicado y la regla de Academy guardada por su módulo."""

    def setUp(self) -> None:
        """Compone y publica el catálogo de hoy, sin regla, y deja lo que lee el panel."""
        self.montaje = academy.AcademyActualizacionPruebas()
        self.addCleanup(self.montaje.doCleanups)
        with contextlib.redirect_stdout(io.StringIO()):
            self.montaje.setUp()
            _, publico = self.montaje.componer()
        self.raiz = self.montaje.raiz
        self.assertEqual({oferta["unidad"]["id"] for oferta in publico["ofertas"]}, {RETIRADO, QUEDA})
        fichas = self.raiz / "var/actualizacion/preparados/abierta/fichas.json"
        fichas.parent.mkdir(parents=True, exist_ok=True)
        fichas.write_text('{"fichas": [], "plataformas": {}}', encoding="utf-8")
        (self.raiz / CARPETA_DE_INFORMES).mkdir(parents=True, exist_ok=True)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name) / "area"
        self.hoy = self.publicado()
        self.linajes: list[ObjetoJson] = []

    def publicado(self) -> dict[str, bytes]:
        """Los bytes de cada archivo de lo que publica la entrega del paquete.

        Returns:
            Sus bytes, por ruta relativa a la instalación.
        """
        return {
            ruta.relative_to(self.raiz).as_posix(): ruta.read_bytes()
            for relativa in RUTAS_DE_LA_ENTREGA
            for ruta in sorted((self.raiz / relativa).rglob("*"))
            if ruta.is_file()
        }

    def validar_y_guardar_el_linaje(self, solicitud: entrega.SolicitudEntrega) -> ObjetoJson:
        """La validación real de la entrega, quedándose con su linaje privado antes de que se borre su área.

        Returns:
            El informe de la validación.
        """
        informe = VALIDAR(solicitud)
        self.linajes.append(json.loads((solicitud.area / "validado" / entrega.LINAJE).read_bytes()))
        return informe

    def ejecutor(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """La orden de componer el catálogo es la real; las demás órdenes del paquete terminan en verde sin hacer nada.

        Returns:
            Éxito, con lo que devuelve la composición.
        """
        if list(orden) != list(COMPONER_EL_CATALOGO.orden):
            return actualizar.Resultado(0, "")
        with mock.patch.object(entrega, "validar", side_effect=self.validar_y_guardar_el_linaje):
            resultado = componer.componer(raiz=area, corte_utc=academy.CORTE)
        return actualizar.Resultado(0, json.dumps(resultado, ensure_ascii=False))

    def ciclo(self) -> ResultadoDelModulo:
        """Prepara el área desde lo publicado y ejecuta el paquete.

        Returns:
            El resultado del paquete.
        """
        preparar_area(self.raiz, self.area)
        opciones = actualizar.Opciones(area=self.area, pausa=0, reintento=0)
        with contextlib.redirect_stdout(io.StringIO()):
            _, comparacion, resultado = actualizar.ejecutar_paquete(self.raiz, self.area, self.ejecutor, opciones)
        self.assertEqual((comparacion.perdidas, comparacion.retenidos, comparacion.alarmas), ((), frozenset(), []))
        return resultado

    def catalogo_publicado(self) -> ObjetoJson:
        """El catálogo público al que apunta la referencia publicada, comprobado con su huella.

        Returns:
            Su contenido.
        """
        referencia = PUNTERO.search((self.raiz / REFERENCIA).read_text(encoding="utf-8"))
        self.assertIsNotNone(referencia)
        cuerpo = (self.raiz / "web" / referencia["ruta"]).read_bytes()
        self.assertEqual(hashlib.sha256(cuerpo).hexdigest(), referencia["sha256"])
        return json.loads(cuerpo)

    def fila_del_panel(self) -> dict[str, object]:
        """El seguimiento de Claude Academy en el estado del panel, leído de lo publicado.

        Returns:
            Su fila del seguimiento remoto.
        """
        filas = estado_panel(self.raiz, AHORA)["seguimientoRemoto"]
        return next(fila for fila in filas if fila["fuente"] == "claude_academy")

    def test_activa_no_publica_lo_retirado_y_el_linaje_y_el_panel_lo_reflejan(self) -> None:
        """El curso de Academy retirado con evidencia deja de publicarse; el de HP LIFE sigue."""
        regla(self.raiz, "claude_academy", "activa", [RETIRADO], mantenidas=1, activada_utc=ACTIVADA_UTC)
        resultado = self.ciclo()
        self.assertEqual((resultado.veredicto, resultado.motivo), (VERDE, ""))
        publico = self.catalogo_publicado()
        self.assertEqual([oferta["unidad"]["id"] for oferta in publico["ofertas"]], [QUEDA])
        self.assertNotEqual(self.publicado()[REFERENCIA], self.hoy[REFERENCIA])
        (linaje,) = self.linajes
        registro = ultimo_registro(self.raiz, "claude_academy")
        estado = {"estado": "activa", "registro": 1, "sha256": sha256_json(registro)}
        self.assertEqual(linaje["entrada"]["regla_de_retirada"]["claude_academy"], estado)
        self.assertEqual(linaje["entrada"]["regla_de_retirada"]["hp_life"], {"estado": "sombra"})
        retenidas = linaje["catalogo_privado"]["retenciones_publicacion"]
        self.assertIn(RETIRADA_POR_EVIDENCIA, {r["motivo"] for r in retenidas if r["unidad"]["id"] == RETIRADO})
        fila = self.fila_del_panel()
        self.assertEqual(fila["retirada"], {"cambio": "activada", "decisiones": 30, "en": ACTIVADA_UTC})
        self.assertEqual(fila["retiradaAmplia"], {"retiradas": 1, "cursos": 2, "en": CICLO_UTC})

    def test_en_sombra_lo_publicado_es_el_de_hoy_byte_a_byte(self) -> None:
        """La misma regla en sombra: el catálogo, su referencia y el almacén no cambian ni un byte."""
        regla(self.raiz, "claude_academy", "sombra", [RETIRADO], mantenidas=1)
        resultado = self.ciclo()
        self.assertEqual((resultado.veredicto, resultado.motivo), (VERDE, "sin cambios"))
        self.assertEqual(self.publicado(), self.hoy)
        (linaje,) = self.linajes
        self.assertEqual(linaje["entrada"]["regla_de_retirada"]["claude_academy"], {"estado": "sombra"})
        motivos = {retenida["motivo"] for retenida in linaje["catalogo_privado"]["retenciones_publicacion"]}
        self.assertNotIn(RETIRADA_POR_EVIDENCIA, motivos)
        fila = self.fila_del_panel()
        self.assertNotIn("retirada", fila)
        self.assertNotIn("retiradaAmplia", fila)


if __name__ == "__main__":
    unittest.main()
