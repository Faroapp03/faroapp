"""Academy sin red: una ficha fallida no anula las demás ni retira su unidad.

Recorre las piezas reales: recepción, admisión de la fuente, registro de vigencia,
entrega pública y panel privado.
"""

import hashlib
import json
import shutil
import unittest
from collections import Counter
from dataclasses import replace
from datetime import datetime
from unittest.mock import patch

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import cobertura_catalogo, panel_catalogo, recepciones_catalogo
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.pruebas import test_academy_actualizacion as fixtures

OTRO = "claude-academy:otro"
NUEVO = "claude-academy:nuevo"
URL_OTRO = acceso.ORIGEN + "/courses/otro"


def _instante(valor: str) -> datetime:
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


class FallosPorUnidadAcademyPruebas(unittest.TestCase):
    """Instalación sintética con dos cursos Academy publicados y confirmados."""

    def setUp(self) -> None:
        """Publica «nuevo» y «otro» con una primera consulta completa."""
        # Sin red: los dos transportes quedan bloqueados; el fixture simula cada respuesta en `fuente.consultar`.
        for modulo in (fuente, recepciones_catalogo):
            bloqueo = patch.object(modulo, "consultar", side_effect=AssertionError("consulta de red no simulada"))
            bloqueo.start()
            self.addCleanup(bloqueo.stop)
        self.caso = fixtures.AcademyActualizacionPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.rx.ids_indice = ["nuevo", "otro"]
        self.caso.rx.ciclo()
        _, dto = self.caso.componer("2026-10-23T10:05:00Z")
        self.antes = self.ofertas(dto)

    @staticmethod
    def ofertas(dto: dict) -> dict[str, dict]:
        """Indexa las ofertas públicas por unidad.

        Returns:
            Oferta por identidad de unidad.
        """
        return {o["unidad"]["id"]: o for o in dto["ofertas"]}

    def panel(self, corte: str) -> dict[str, dict]:
        """Lee el panel privado de la instalación.

        Returns:
            Filas por unidad.
        """
        solicitud = almacen.solicitud(self.caso.raiz / almacen.RUTA)
        sha = hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        return {f["id"]: f for f in panel_catalogo.desde_admision(solicitud, sha, corte_utc=corte)["unidades"]}

    def consultar_con_fallo(self, respuesta: str | int) -> dict:
        """Repite la consulta con la ficha «otro» caída; el resto responde.

        Returns:
            Conjunto admitido de la fuente.
        """
        recibir = self.caso.rx.recibir

        def responder(url: str, **opciones: object) -> recepciones_catalogo.RespuestaCatalogo:
            rx = recibir(url, **opciones)
            if url != URL_OTRO:
                return rx
            if respuesta == "transporte":
                return replace(rx, cuerpo=None, http=None, completo=False, url_final=None, error="timeout")
            return replace(rx, http=respuesta)

        with patch.object(fuente, "consultar", side_effect=responder):
            return self.caso.rx.ciclo()

    def comprobar_fallo(self, conjunto: dict) -> None:
        """La unidad caída conserva su confirmación con aviso; la otra se confirma de nuevo."""
        self.assertEqual(conjunto["consulta_parcial"]["unidades_fallidas"], [OTRO])
        fila = next(f for f in conjunto["recepciones"] if f["id"] == OTRO)
        fin = fila["lectura"]["fin_utc"].replace("+00:00", "Z")
        _, dto = self.caso.componer("2026-10-23T10:30:00Z")
        despues = self.ofertas(dto)
        self.assertEqual(set(despues), set(self.antes))
        self.assertEqual(despues[OTRO]["comprobado_el"], self.antes[OTRO]["comprobado_el"])
        self.assertGreater(despues[NUEVO]["comprobado_el"], self.antes[NUEVO]["comprobado_el"])
        panel = self.panel("2026-10-23T10:30:00Z")
        self.assertEqual(panel[OTRO]["decision"], "disponible-publicamente")
        self.assertEqual(panel[OTRO]["comprobadoEl"], self.antes[OTRO]["comprobado_el"])
        self.assertEqual(panel[OTRO]["ultimoIntentoFallidoEl"], fin)
        self.assertIsNone(panel[NUEVO]["ultimoIntentoFallidoEl"])

    def test_ficha_sin_respuesta_es_fallo_de_su_unidad(self) -> None:
        """El transporte sin respuesta de una ficha no anula la consulta de las demás."""
        self.comprobar_fallo(self.consultar_con_fallo("transporte"))

    def test_respuesta_503_es_fallo_de_su_unidad(self) -> None:
        """Un 503 con cuerpo se registra como fallo de esa unidad."""
        self.comprobar_fallo(self.consultar_con_fallo(503))

    def observaciones(self, id: str) -> list[dict]:
        """Lee las observaciones registradas de la unidad en la instalación.

        Returns:
            Observaciones únicas registradas.
        """
        ruta = almacen.solicitud(self.caso.raiz / almacen.RUTA).snapshot.ruta
        return registro.observaciones_hasta(ruta, tipo="recurso", id=id, corte="2026-10-24T00:00:00Z")

    def test_paquete_fallido_el_ciclo_siguiente_evalua_lo_pendiente(self) -> None:
        """El ciclo no instalado entra después con su fecha y sus auxiliares, sin duplicarse."""
        self.caso.rx.ciclo()
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.caso.raiz)
        primero = fuente.leer_validado("claude_academy", self.caso.raiz)
        fin_primero = fuente._corte_del_conjunto(original, primero)
        copia = self.caso.raiz.parent / (self.caso.raiz.name + " ciclo descartado")
        shutil.copytree(self.caso.raiz, copia)
        componer.componer(raiz=copia, corte_utc="2026-10-23T10:20:00Z")
        shutil.rmtree(copia)
        registradas = {id: len(self.observaciones(id)) for id in (NUEVO, OTRO)}
        segundo = self.consultar_con_fallo("transporte")
        self.assertEqual([c for _corte, c in fuente.leer_pendientes("claude_academy", self.caso.raiz)], [primero])
        inicio_segundo = fuente.leer_recibo(original, segundo["auxiliares"]["indice"])["inicio_utc"]
        _, dto = self.caso.componer("2026-10-23T10:30:00Z")
        self.assertEqual(len(self.observaciones(NUEVO)), registradas[NUEVO] + 2)
        self.assertEqual(len(self.observaciones(OTRO)), registradas[OTRO] + 2)
        for id in (NUEVO, OTRO):
            identidades = [o["id"] for o in self.observaciones(id)]
            self.assertEqual(len(identidades), len(set(identidades)))
            # Cada observación del ciclo pendiente termina dentro de su propio ciclo.
            self.assertTrue(
                any(_instante(o["terminado_el"]) <= _instante(fin_primero) for o in self.observaciones(id)[-2:])
            )
        panel = self.panel("2026-10-23T10:30:00Z")
        self.assertGreater(panel[OTRO]["comprobadoEl"], self.antes[OTRO]["comprobado_el"])
        self.assertLessEqual(_instante(panel[OTRO]["comprobadoEl"]), _instante(fin_primero))
        self.assertLess(_instante(panel[OTRO]["comprobadoEl"]), _instante(inicio_segundo))
        # La entrega pública muestra la misma comprobación del ciclo pendiente, no la del intento fallido.
        publicas = self.ofertas(dto)
        self.assertEqual(set(publicas), set(self.antes))
        self.assertEqual(publicas[OTRO]["comprobado_el"], panel[OTRO]["comprobadoEl"])
        self.assertGreater(_instante(publicas[NUEVO]["comprobado_el"]), _instante(fin_primero))
        self.comprobar_cuerpos_unicos()
        # Repetir sin consulta nueva y sin red no cambia fechas ni bytes.
        antes = self.caso.inventario()
        with (
            patch.object(fuente, "consultar", side_effect=AssertionError("sin red")),
            patch.object(recepciones_catalogo, "consultar", side_effect=AssertionError("sin red")),
        ):
            _, repetido = self.caso.componer("2026-10-23T11:30:00Z")
        self.assertEqual(self.caso.inventario(), antes)
        self.assertEqual(repetido, dto)
        # Instalado el catálogo, una consulta nueva ya no arrastra pendientes.
        self.caso.rx.ciclo()
        self.assertEqual(fuente.leer_pendientes("claude_academy", self.caso.raiz), [])
        _, _, validado = fuente.rutas_de_la_fuente("claude_academy", self.caso.raiz)
        self.assertEqual(list((validado / "pendientes").glob("*.json")), [])

    def comprobar_cuerpos_unicos(self) -> None:
        """Cada cuerpo recibido se conserva una sola vez en el catálogo instalado, aunque llegue en varios ciclos."""
        control = json.loads((self.caso.raiz / almacen.RUTA / almacen.CONTROL).read_bytes())
        conservados = Counter(p["sha256"] for p in control["archivos_conservados"])
        originales, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.caso.raiz)
        recibidos = {hashlib.sha256(r.read_bytes()).hexdigest() for r in (originales / "cuerpos").glob("*.body")}
        self.assertTrue(recibidos)
        self.assertEqual({sha: conservados[sha] for sha in recibidos}, dict.fromkeys(recibidos, 1))

    def test_consulta_parcial_no_acredita_la_fuente(self) -> None:
        """Lo válido entra en el registro, pero la fuente no consta comprobada entera."""
        conjunto = self.consultar_con_fallo("transporte")
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.caso.raiz)
        with self.assertRaisesRegex(ErrorFuente, "Recepción sin cuerpo"):
            cobertura_catalogo._recibos("claude_academy", original=original, admitido=conjunto)
        self.assertFalse(
            cobertura_catalogo.comprobada(
                self.caso.raiz, {"version": cobertura_catalogo.VERSION_RECEPCION, "fuente": "claude_academy"}
            )
        )


if __name__ == "__main__":
    unittest.main()
