"""FUNDAE sin red: un índice caído no anula los demás ni se lee como ausencia.

Recorre lectura de índices, admisión de la fuente, registro de vigencia y panel privado.
Las unidades FUNDAE solo aportan presencia en catálogo («sin confirmar»), así que no
llegan a la entrega pública ni con consulta completa ni con consulta parcial.
"""

import contextlib
import copy
import hashlib
import io
import json
import shutil
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import Carpetas
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo, operacion_fuente, panel_catalogo, recepciones_catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.fundae import actualizacion as fundae
from plataforma_datos.cursos.fuentes.fundae import adquisicion, conocidos
from plataforma_datos.cursos.pruebas import test_fundae_admision_catalogos as fixtures
from plataforma_datos.orquestacion import admision as admision_fuentes

DIGITALIZATE = ("fundae:1:1", "fundae:1:2")


class FallosPorUnidadFundaePruebas(unittest.TestCase):
    """Catálogo admitido con una primera consulta completa de los tres índices."""

    def setUp(self) -> None:
        """Aplica la consulta completa y guarda la instalación resultante."""
        self.caso = fixtures.AdmisionFundaePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.primera = self.caso.raiz / "primera"
        fundae.aplicar(
            self.caso.entrada,
            conjunto=self.caso.conjunto,
            original=self.caso.original,
            destino=self.primera,
            corte="2026-10-23T10:01:00Z",
        )

    def entrada(self) -> almacen.EntradaCatalogo:
        """Entrada admitida de la primera aplicación.

        Returns:
            Referencia al catálogo instalado tras la consulta completa.
        """
        solicitud = almacen.solicitud(self.primera)
        sha = hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        return almacen.EntradaCatalogo(admision=solicitud, sha256_admision=sha)

    def test_indice_caido_registra_el_fallo_sin_retirar_ni_anular_el_resto(self) -> None:
        """Digitalízate cae con 503; subvencionada se lee; sus unidades conservan su estado con aviso."""
        rx = self.caso.rx
        documento = copy.deepcopy(rx.documento)
        hora = {"inicio": "2026-10-23T10:30:00Z", "fin": "2026-10-23T10:30:01Z"}
        documento["auxiliares"]["digitalizate"] = rx.captura("digitalizate", {}, http=503, **hora)
        documento["auxiliares"]["subvencionada"] = rx.captura("subvencionada", rx.datos["subvencionada"], **hora)
        documento["auxiliares"]["catalogos"] = rx.captura("catalogos", rx.datos["catalogos"], **hora)
        guardar_json(self.caso.original / "procedencia.json", documento)
        entrada = self.entrada()
        conjunto = adquisicion.calcular(self.caso.original, documento, conocidos.leer(entrada))
        self.assertTrue(operacion_fuente._respuestas_interpretables("fundae", conjunto))
        self.assertEqual(conjunto["consulta_parcial"]["canales_fallidos"], ["digitalizate"])
        self.assertEqual(conjunto["consulta_parcial"]["unidades_fallidas"], list(DIGITALIZATE))
        antes = {
            id: registro.consultar_unidad(self.primera / "catalogo.sqlite3", tipo="recurso", id=id)["evaluacion"]
            for id in DIGITALIZATE
        }
        segunda = self.caso.raiz / "segunda"
        fundae.aplicar(
            entrada, conjunto=conjunto, original=self.caso.original, destino=segunda, corte="2026-10-23T10:31:00Z"
        )
        for id in DIGITALIZATE:
            despues = registro.consultar_unidad(segunda / "catalogo.sqlite3", tipo="recurso", id=id)["evaluacion"]
            self.assertEqual(despues["resultado"]["estado"], antes[id]["resultado"]["estado"])
            self.assertEqual(despues["resultado"]["comprobado_el"], antes[id]["resultado"]["comprobado_el"])
            # La política FUNDAE no exige catálogo: el evaluador no eleva su fallo a aviso,
            # pero el intento queda registrado y fechado.
            self.assertEqual(despues["resultado"]["ultimo_fin_el"], "2026-10-23T10:30:01Z")
            observaciones = despues["entradas"]["observaciones"]
            self.assertEqual(len(observaciones), len(antes[id]["entradas"]["observaciones"]) + 1)
            self.assertEqual(observaciones[-1]["resultado"], "fallo")
        solicitud = almacen.solicitud(segunda)
        sha = hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        panel = {
            f["id"]: f
            for f in panel_catalogo.desde_admision(solicitud, sha, corte_utc="2026-10-23T10:31:00Z")["unidades"]
        }
        for id in DIGITALIZATE:
            self.assertEqual(panel[id]["ultimoFinEl"], "2026-10-23T10:30:01Z")
            self.assertEqual(panel[id]["decision"], antes[id]["resultado"]["estado"])


class PendientesFundaePruebas(unittest.TestCase):
    """Instalación con catálogo admitido; recepción, admisión y composición reales, sin red."""

    def setUp(self) -> None:
        """Instala el catálogo de entrada y bloquea el transporte."""
        for modulo in (operacion_fuente, recepciones_catalogo):
            bloqueo = patch.object(modulo, "consultar", side_effect=AssertionError("consulta de red no simulada"))
            bloqueo.start()
            self.addCleanup(bloqueo.stop)
        self.caso = fixtures.AdmisionFundaePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.raiz / "Instalación ñ"
        almacen.conservar(self.caso.entrada, destino=self.raiz / almacen.RUTA)
        self.original, _, _ = operacion_fuente.rutas_de_la_fuente("fundae", self.raiz)
        self.original.mkdir(parents=True)

    def _carpetas(self, id: str) -> Carpetas:
        return Carpetas(*operacion_fuente.rutas_de_la_fuente(id, self.raiz))

    def ciclo(self, hora: str, digitalizate: int = 200) -> None:
        """Conserva los tres índices de una consulta y la prepara y admite.

        Args:
            hora: Hora UTC de la consulta (HH:MM).
            digitalizate: Código del índice Digitalízate; 200 lo lee.
        """
        rx = self.caso.rx
        rx.raiz = self.original
        tiempos = {"inicio": f"2026-10-23T{hora}:00Z", "fin": f"2026-10-23T{hora}:01Z"}
        auxiliares = {
            nombre: rx.captura(
                nombre, rx.datos[nombre], http=digitalizate if nombre == "digitalizate" else 200, **tiempos
            )
            for nombre in ("catalogos", "digitalizate", "subvencionada")
        }
        guardar_json(
            self.original / "procedencia.json",
            {"schema_version": 1, "fuente_id": "fundae", "capturas": [], "auxiliares": auxiliares, "historial": []},
        )
        with (
            patch.object(operacion_fuente, "RAIZ", self.raiz),
            patch.object(admision_fuentes, "carpetas", self._carpetas),
            patch.object(admision_fuentes, "ruta_del_conjunto", lambda id: self._carpetas(id).validado / f"{id}.json"),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            operacion_fuente.preparar("fundae", raiz=self.raiz)
            operacion_fuente.validar("fundae", raiz=self.raiz)

    def componer(self, raiz: Path, corte: str) -> dict:
        """Compone e instala en la raíz indicada, sin red.

        Returns:
            Entrega pública publicada por la composición.
        """
        resultado = componer_catalogo.componer(raiz=raiz, corte_utc=corte)
        return json.loads((raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())

    def inventario(self) -> dict[str, tuple[str, int]]:
        """Fija huella y mtime de cada archivo del catálogo instalado y de la web.

        Returns:
            Archivo relativo con su huella y su mtime.
        """
        return {
            p.relative_to(self.raiz).as_posix(): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for carpeta in (self.raiz / almacen.RUTA, self.raiz / "web")
            for p in carpeta.rglob("*")
            if p.is_file()
        }

    def panel(self, corte: str) -> dict[str, dict]:
        """Lee el panel privado de la instalación.

        Returns:
            Filas por unidad.
        """
        solicitud = almacen.solicitud(self.raiz / almacen.RUTA)
        sha = hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        return {f["id"]: f for f in panel_catalogo.desde_admision(solicitud, sha, corte_utc=corte)["unidades"]}

    def comprobar_cuerpos_unicos(self) -> None:
        """Cada índice recibido se conserva una sola vez en el catálogo instalado, aunque llegue en varios ciclos."""
        control = json.loads((self.raiz / almacen.RUTA / almacen.CONTROL).read_bytes())
        conservados = Counter(p["sha256"] for p in control["archivos_conservados"])
        cuerpos = {hashlib.sha256(r.read_bytes()).hexdigest() for r in self.original.rglob("*.body")}
        self.assertTrue(cuerpos)
        self.assertEqual({sha: conservados[sha] for sha in cuerpos}, dict.fromkeys(cuerpos, 1))

    def observaciones(self, id: str) -> list[dict]:
        """Lee las observaciones registradas de la unidad instalada.

        Returns:
            Observaciones únicas registradas.
        """
        ruta = almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta
        return registro.observaciones_hasta(ruta, tipo="recurso", id=id, corte="2026-10-24T00:00:00Z")

    def test_conjunto_instalado_sin_censo_no_relee_identidades_para_comparar_una_huella_ausente(self) -> None:
        """Un conjunto anterior al censo, ya instalado, conserva sus bytes sin reconstruir el inventario FUNDAE."""
        self.ciclo("10:00")
        conjunto = operacion_fuente.leer_validado("fundae", self.raiz)
        self.assertIsNotNone(conjunto)
        self.assertNotIn("censo", conjunto)
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        base = self.raiz / almacen.RUTA
        with patch.object(componer_catalogo.conocidos_fundae, "leer", side_effect=AssertionError("huella ausente")):
            repetida = componer_catalogo._aplicar_fundae(
                self.raiz, base, self.raiz / "nueva", "2026-10-23T10:15:00Z", conjunto
            )
        self.assertEqual(repetida, base)
        self.assertFalse((self.raiz / "nueva").exists())

    def test_paquete_fallido_el_ciclo_siguiente_evalua_lo_pendiente(self) -> None:
        """El ciclo admitido sin instalar entra con su fecha y sus índices, sin duplicarse."""
        self.ciclo("10:00")
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        registradas = {id: len(self.observaciones(id)) for id in DIGITALIZATE}
        antes = self.panel("2026-10-23T10:05:00Z")
        self.ciclo("10:30")
        apartado = operacion_fuente.leer_validado("fundae", self.raiz)
        copia = self.caso.raiz / "ciclo descartado"
        shutil.copytree(self.raiz, copia)
        self.componer(copia, "2026-10-23T10:35:00Z")
        shutil.rmtree(copia)
        self.ciclo("11:00", digitalizate=503)
        self.assertEqual([c for _corte, c in operacion_fuente.leer_pendientes("fundae", self.raiz)], [apartado])
        dto = self.componer(self.raiz, "2026-10-23T11:30:00Z")
        for id in DIGITALIZATE:
            observaciones = self.observaciones(id)
            self.assertEqual(len(observaciones), registradas[id] + 2)
            self.assertEqual(len({o["id"] for o in observaciones}), len(observaciones))
            nuevas = sorted((o["terminado_el"], o["resultado"]) for o in observaciones)[-2:]
            self.assertEqual(nuevas, [("2026-10-23T10:30:01Z", "correcta"), ("2026-10-23T11:00:01Z", "fallo")])
        # FUNDAE es solo índice: sus unidades siguen sin confirmar y fuera de la entrega pública.
        self.assertFalse(set(DIGITALIZATE) & {o["unidad"]["id"] for o in dto["ofertas"]})
        panel = self.panel("2026-10-23T11:30:00Z")
        for id in DIGITALIZATE:
            # La política FUNDAE no confirma por catálogo: la decisión no cambia y el panel fecha el último intento;
            # la observación correcta del ciclo pendiente consta en el registro con su fecha (arriba).
            self.assertEqual(panel[id]["decision"], antes[id]["decision"])
            self.assertIsNone(panel[id]["comprobadoEl"])
            self.assertEqual(panel[id]["ultimoFinEl"], "2026-10-23T11:00:01Z")
            self.assertEqual(panel[id]["evaluadoEl"], "2026-10-23T11:30:00Z")
        self.comprobar_cuerpos_unicos()
        # Repetir sin consulta nueva y sin red no cambia fechas ni bytes.
        inventario = self.inventario()
        with (
            patch.object(operacion_fuente, "consultar", side_effect=AssertionError("sin red")),
            patch.object(recepciones_catalogo, "consultar", side_effect=AssertionError("sin red")),
        ):
            self.assertEqual(self.componer(self.raiz, "2026-10-23T11:45:00Z"), dto)
        self.assertEqual(self.inventario(), inventario)
        self.ciclo("12:00")
        self.assertEqual(operacion_fuente.leer_pendientes("fundae", self.raiz), [])
        _, _, validado = operacion_fuente.rutas_de_la_fuente("fundae", self.raiz)
        self.assertEqual(list((validado / "pendientes").glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
