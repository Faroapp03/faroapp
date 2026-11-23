"""Ciclos HP sin red: un fallo por unidad y un paquete no instalado no pierden observaciones.

Recorren las piezas reales encadenadas: recepción, procedencia, admisión de la fuente,
registro de vigencia, entrega pública y panel privado.
"""

import hashlib
import json
import shutil
import sqlite3
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, cobertura_catalogo, contenido_aprendizaje
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures
from plataforma_datos.cursos.pruebas.ayuda_panel_copia import InstalacionConPanel

UNIDADES = {
    "hp-life:431:es": ("https://www.life-global.org/es/course/431", 431),
    "hp-life:432:es": ("https://www.life-global.org/es/course/432", 432),
}
PRIMERA, SEGUNDA = UNIDADES


def negocio_sintetico(numero: int) -> dict:
    """Negocio HP LIFE sintético con el número de curso dado.

    Returns:
        Los datos del curso.
    """
    dato = fixtures.negocio()
    dato.update(id=numero, code=f"COD-{numero}", name=f"Curso sintético {numero}")
    return dato


def cuerpo_sintetico(numero: int, *, estado: str = "Published") -> bytes:
    """Cuerpo de recepción HP LIFE sintético del curso, con el estado dado.

    Returns:
        Los bytes de la recepción.
    """
    dato = negocio_sintetico(numero)
    dato["status"] = estado
    return fixtures.recepcion(dato)[0]


def _ref(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())


class FallosPorUnidadHpPruebas(InstalacionConPanel, unittest.TestCase):
    """Cada prueba tiene su instalación sintética; ninguna consulta sale a la red."""

    TIPO_OBSERVADO = "recurso"

    def setUp(self) -> None:
        """Instala un catálogo admitido con dos recursos HP confirmados el 23/10 a las 02:07."""
        temporal = tempfile.TemporaryDirectory(prefix="HP fallos Año ")
        self.addCleanup(temporal.cleanup)
        # Sin red: cualquier consulta no simulada explícitamente falla la prueba.
        for modulo in (fuente, transporte):
            bloqueo = patch.object(modulo, "consultar", side_effect=AssertionError("consulta de red no simulada"))
            bloqueo.start()
            self.addCleanup(bloqueo.stop)
        self.trabajo = Path(temporal.name)
        self.raiz = self.trabajo / "Instalación ñ"
        base = self.trabajo / "entrada.sqlite3"
        programas, canales, recepciones = [], [], []
        for id, (url, numero) in UNIDADES.items():
            cuerpo, recibo = fixtures.recepcion(negocio_sintetico(numero), url_solicitada=url, url_final=url)
            viejo = self.trabajo / f"anterior-{numero}.body"
            viejo.write_bytes(cuerpo)
            evidencia = {
                "url": url,
                "capturado_utc": "2026-10-22T02:07:20Z",
                "sha256": hashlib.sha256(cuerpo).hexdigest(),
                "archivo": viejo.name,
            }
            dato = negocio_sintetico(numero)
            programas.append(
                {
                    "id": id,
                    "proveedor_id": "hp-life",
                    "titulo": dato["name"],
                    "url": url,
                    "tipo_unidad": "curso",
                    "datos": {
                        "identidad_fuente": {"id": dato["id"], "idioma": dato["language"], "codigo": dato["code"]},
                        "cuerpo_html_publicado": dato["body"],
                        "descripcion_publicada": None,
                        "idiomas_publicados": ["es"],
                        "estado_fuente_literal": "Published",
                        "soporte_acceso": {"fecha": "2026-10-22T02:07:20Z"},
                    },
                    "etiquetas": [{"codigo": "datos", "estado": "propuesta", "metodo": "sintetico", "evidencia": None}],
                    "evidencias": [evidencia],
                }
            )
            canales.append({"entidad": "programa", "id": id, "canal": "documento-historico", "evidencias": [evidencia]})
            nombre = hashlib.sha256(recibo).hexdigest()
            body, meta = self.trabajo / (nombre + ".body"), self.trabajo / (nombre + ".json")
            body.write_bytes(cuerpo)
            meta.write_bytes(recibo)
            recepciones.append(hp.RecepcionEnDisco(id=id, cuerpo=_ref(body), recibo=_ref(meta)))
        lote = {
            "schema_version": 1,
            "observado_utc": "2026-10-22T02:07:20Z",
            "fuente_lote": "sintetica",
            "proveedores": [{"id": "hp-life", "nombre": "HP LIFE", "naturaleza": None, "territorio": None}],
            "programas": programas,
            "ediciones": [],
        }
        catalogo.cargar_lote(base, lote, True, self.trabajo, canales_temporales=canales)
        linaje = self.trabajo / "linaje.json"
        linaje.write_text('{"origen":"sintetico"}')
        entrada = admision.SolicitudAdmision(
            snapshot=_ref(base), procedencia={"linaje": _ref(linaje)}, validacion_destino=self.trabajo / "val.json"
        )
        admision.admitir_snapshot(entrada)
        solicitud = hp.SolicitudHpLife(
            admision=entrada,
            sha256_admision=_ref(entrada.validacion_destino).sha256,
            recepciones=tuple(recepciones),
            raiz_evidencias=self.trabajo,
            area=self.trabajo / "preparada",
            corte_utc=fixtures.AHORA,
        )
        hp.preparar(solicitud)
        preparada = hp.solicitud_admision(solicitud.area)
        almacen.conservar(
            almacen.EntradaCatalogo(admision=preparada, sha256_admision=_ref(preparada.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )

    # -- Ciclo real -------------------------------------------------------------------------------------------------

    def consultar_fuente(self, hora: str, respuestas: dict[str, str | int | None]) -> bool:
        """Recibe, prepara y admite HP; None simula un fallo de transporte de esa URL.

        Cada respuesta es el estado publicado en la ficha («Published» o «Archived»).

        Returns:
            Si la recepción terminó sin fallo total.
        """

        def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
            inicio, fin = f"2026-10-23T{hora}:00+00:00", f"2026-10-23T{hora}:01+00:00"
            if url == gratuidad.URL_AYUDA:
                return indice_hp.ayuda(url, inicio, fin)
            if url.startswith(indice.INDICE):
                return indice_hp.respuesta(url, indice_hp.paginas([n for _u, n in UNIDADES.values()]), inicio, fin)
            id = next(i for i, (u, _n) in UNIDADES.items() if u == url)
            codigo = respuestas[id]
            if codigo is None:
                return transporte.RespuestaCatalogo(
                    url=url, inicio_utc=inicio, fin_utc=fin, cuerpo=None, error="timeout"
                )
            # Un número es una respuesta con cuerpo que es fallo de consulta (5xx, 429, 3xx…).
            http = codigo if isinstance(codigo, int) else HTTPStatus.OK
            cuerpo = (
                b"<html>Error</html>" if isinstance(codigo, int) else cuerpo_sintetico(UNIDADES[id][1], estado=codigo)
            )
            return transporte.RespuestaCatalogo(
                url=url,
                inicio_utc=inicio,
                fin_utc=fin,
                cuerpo=cuerpo,
                url_final=url,
                http=http,
                completo=True,
                content_type="text/html; charset=utf-8",
            )

        with self._rutas_globales(), patch.object(transporte, "consultar", side_effect=responder):
            try:
                fuente.descargar("hp_life", raiz=self.raiz)
            except FormatoInesperado:
                return False
            fuente.preparar("hp_life", raiz=self.raiz)
            fuente.validar("hp_life", raiz=self.raiz)
        return True

    def componer(self, corte: str) -> dict:
        """Compone e instala el catálogo como lo hace un paquete en verde.

        Returns:
            Entrega pública generada.
        """
        with patch.object(transporte, "consultar", side_effect=AssertionError("sin red")):
            resultado = componer.componer(raiz=self.raiz, corte_utc=corte)
        return json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())

    def componer_sin_instalar(self, corte: str) -> None:
        """Compone en una copia que se descarta: el paquete falló y la instalación no cambia."""
        copia = self.trabajo / "copia-del-ciclo"
        shutil.copytree(self.raiz, copia)
        try:
            with patch.object(transporte, "consultar", side_effect=AssertionError("sin red")):
                componer.componer(raiz=copia, corte_utc=corte)
        finally:
            shutil.rmtree(copia)

    @staticmethod
    def ofertas(dto: dict) -> dict[str, dict]:
        """Indexa las ofertas públicas por su URL.

        Returns:
            Oferta pública por URL de la unidad.
        """
        return {o["url"]: o for o in dto["ofertas"]}

    # -- Pruebas ----------------------------------------------------------------------------------------------------

    def test_url_fallida_conserva_su_confirmacion_y_las_demas_se_confirman(self) -> None:
        """La unidad caída avisa del intento; la otra se confirma con su fecha nueva; nada se retira."""
        self.assertTrue(self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: None}))
        dto = self.ofertas(self.componer("2026-10-23T04:30:00Z"))
        self.assertEqual(set(dto), {u for u, _n in UNIDADES.values()})
        self.assertEqual(dto[UNIDADES[PRIMERA][0]]["comprobado_el"], "2026-10-23T04:00:01Z")
        self.assertEqual(dto[UNIDADES[SEGUNDA][0]]["comprobado_el"], "2026-10-23T02:07:20.814607Z")
        panel = self.panel("2026-10-23T04:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "disponible-publicamente")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T02:07:20.814607Z")
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T04:00:01Z")
        self.assertEqual(panel[PRIMERA]["decision"], "disponible-publicamente")
        self.assertIsNone(panel[PRIMERA]["ultimoIntentoFallidoEl"])
        solicitud = almacen.solicitud(self.raiz / almacen.RUTA)
        self.assertEqual(set(contenido_aprendizaje.contenidos_actuales(solicitud, set(UNIDADES))), set(UNIDADES))
        fallo = [o for o in self.observaciones(SEGUNDA) if o["resultado"] == "fallo"]
        self.assertEqual(len(fallo), 1)
        self.assertEqual(fallo[0]["detalle"], {"motivo": "consulta_hp_sin_respuesta"})

    def evidencia_de_consulta(self) -> dict:
        """Describe la consulta admitida como la registra el seguimiento: una petición por URL.

        Returns:
            Evidencia versionada; una URL sin respuesta figura sin cuerpo.
        """
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        peticiones = []
        admitido = fuente.leer_validado("hp_life", self.raiz)
        # Las fichas y, como en cada consulta real, las páginas del índice y la de ayuda.
        consultas = [(UNIDADES[f["id"]][0], f) for f in admitido["recepciones"]]
        consultas += [(indice.url_pagina(p["pagina"]), p) for p in (admitido.get("indice") or {}).get("paginas", [])]
        if admitido.get("gratuidad"):
            consultas.append((gratuidad.URL_AYUDA, admitido["gratuidad"]["captura"]))
        for url, fila in consultas:
            if fila["cuerpo"] is None:
                peticiones.append(
                    {
                        "recurso_sha256": identidad_recurso(url),
                        "url_final_sha256": None,
                        "respuesta_sha256": None,
                        "original_sha256": None,
                        "bytes": 0,
                        "original_bytes": 0,
                        "completado_utc": fila["lectura"]["fin_utc"],
                    }
                )
                continue
            rx = cobertura_catalogo._recepcion("hp_life", original, fila)
            peticiones.append(
                {
                    "recurso_sha256": identidad_recurso(url),
                    "url_final_sha256": hashlib.sha256(rx["url_final"].encode()).hexdigest(),
                    "respuesta_sha256": rx["sha256"],
                    "original_sha256": rx["sha256"],
                    "bytes": rx["bytes"],
                    "original_bytes": rx["bytes"],
                    "completado_utc": rx["fin_utc"],
                }
            )
        return {
            "version": cobertura_catalogo.VERSION_RECEPCION,
            "fuente": "hp_life",
            "comienzo_utc": "2026-10-23T00:00:00Z",
            "fin_utc": "2026-10-23T23:00:00Z",
            "peticiones": peticiones,
        }

    def test_consulta_parcial_no_se_declara_comprobada(self) -> None:
        """Lo válido se conserva, pero la consulta parcial queda marcada y no acredita la fuente."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: None})
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(conjunto["consulta_parcial"], {"unidades_fallidas": [SEGUNDA], "unidades_esperadas": 2})
        self.assertFalse(cobertura_catalogo.comprobada(self.raiz, self.evidencia_de_consulta()))
        self.consultar_fuente("05:00", {PRIMERA: "Published", SEGUNDA: "Published"})
        self.assertNotIn("consulta_parcial", fuente.leer_validado("hp_life", self.raiz))
        self.assertTrue(cobertura_catalogo.comprobada(self.raiz, self.evidencia_de_consulta()))

    def test_respuestas_que_son_fallo_de_consulta_no_anulan_la_fuente(self) -> None:
        """Un 503, 429 o 302 con cuerpo es un fallo de esa unidad, como el transporte sin respuesta."""
        for hora, codigo in (("04:00", 503), ("05:00", 429), ("06:00", 302)):
            with self.subTest(codigo=codigo):
                self.assertTrue(self.consultar_fuente(hora, {PRIMERA: "Published", SEGUNDA: codigo}))
                self.assertEqual(
                    fuente.leer_validado("hp_life", self.raiz)["consulta_parcial"]["unidades_fallidas"], [SEGUNDA]
                )
                corte = f"2026-10-23T{hora[:2]}:30:00Z"
                dto = self.ofertas(self.componer(corte))
                self.assertEqual(dto[UNIDADES[SEGUNDA][0]]["comprobado_el"], "2026-10-23T02:07:20.814607Z")
                self.assertEqual(dto[UNIDADES[PRIMERA][0]]["comprobado_el"], f"2026-10-23T{hora}:01Z")
                panel = self.panel(corte)
                self.assertEqual(panel[SEGUNDA]["decision"], "disponible-publicamente")
                if codigo == HTTPStatus.FOUND:
                    # El evaluador clasifica la redirección sin identidad como incidencia del enlace.
                    self.assertIsNotNone(panel[SEGUNDA]["incidenciaEnlace"])
                else:
                    self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], f"2026-10-23T{hora}:01Z")
                solicitud = almacen.solicitud(self.raiz / almacen.RUTA)
                self.assertEqual(
                    set(contenido_aprendizaje.contenidos_actuales(solicitud, set(UNIDADES))), set(UNIDADES)
                )

    def test_confirmacion_fallo_y_recuperacion(self) -> None:
        """Tras el fallo, una respuesta válida renueva la fecha y retira el aviso."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: None})
        self.componer("2026-10-23T04:30:00Z")
        self.assertEqual(self.panel("2026-10-23T04:30:00Z")[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T04:00:01Z")
        self.assertTrue(self.consultar_fuente("05:00", {PRIMERA: "Published", SEGUNDA: "Published"}))
        dto = self.ofertas(self.componer("2026-10-23T05:30:00Z"))
        self.assertEqual(dto[UNIDADES[SEGUNDA][0]]["comprobado_el"], "2026-10-23T05:00:01Z")
        panel = self.panel("2026-10-23T05:30:00Z")
        self.assertIsNone(panel[SEGUNDA]["ultimoIntentoFallidoEl"])
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T05:00:01Z")

    def test_cierre_confirmado_y_fallo_posterior_no_resucita(self) -> None:
        """Una ficha archivada retira con evidencia; un fallo de transporte después no la devuelve."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: "Archived"})
        dto = self.ofertas(self.componer("2026-10-23T04:30:00Z"))
        self.assertNotIn(UNIDADES[SEGUNDA][0], dto)
        cerrada = self.panel("2026-10-23T04:30:00Z")[SEGUNDA]
        self.assertEqual(cerrada["decision"], "no-disponible-publicamente")
        self.assertTrue(self.consultar_fuente("05:00", {PRIMERA: "Published", SEGUNDA: None}))
        dto = self.ofertas(self.componer("2026-10-23T05:30:00Z"))
        self.assertNotIn(UNIDADES[SEGUNDA][0], dto)
        panel = self.panel("2026-10-23T05:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "no-disponible-publicamente")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], cerrada["comprobadoEl"])
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T05:00:01Z")

    def test_fallo_total_registra_el_intento_sin_tocar_lo_publicado(self) -> None:
        """Sin ninguna respuesta no se admite la fuente ni cambia la instalación."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: "Published"})
        self.componer("2026-10-23T04:30:00Z")
        antes = self.inventario()
        _, _, validado = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        admitida = (validado / "validacion.json").read_bytes()
        self.assertFalse(self.consultar_fuente("05:00", {PRIMERA: None, SEGUNDA: None}))
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        documento = json.loads((original / "procedencia.json").read_bytes())
        self.assertEqual([c["cuerpo"] for c in documento["capturas"]], [None, None])
        self.assertEqual((validado / "validacion.json").read_bytes(), admitida)
        self.componer("2026-10-23T05:30:00Z")
        self.assertEqual(self.inventario(), antes)

    def test_paquete_fallido_el_ciclo_siguiente_evalua_lo_pendiente(self) -> None:
        """Las respuestas del ciclo no instalado entran después con su fecha, sin duplicarse."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: None})
        self.componer_sin_instalar("2026-10-23T04:30:00Z")
        self.assertEqual(len(self.observaciones(PRIMERA)), 1)
        self.consultar_fuente("05:00", {PRIMERA: "Published", SEGUNDA: "Published"})
        self.componer("2026-10-23T05:30:00Z")
        primera = self.observaciones(PRIMERA)
        segunda = self.observaciones(SEGUNDA)
        # El registro ordena por ingreso; la fecha de cada observación es la de su captura.
        self.assertEqual(
            sorted(o["terminado_el"] for o in primera)[1:],
            ["2026-10-23T04:00:01+00:00", "2026-10-23T05:00:01+00:00"],
        )
        self.assertEqual(
            sorted((o["terminado_el"], o["resultado"]) for o in segunda)[1:],
            [("2026-10-23T04:00:01+00:00", "fallo"), ("2026-10-23T05:00:01+00:00", "correcta")],
        )
        self.assertEqual(len({o["id"] for o in primera}), len(primera))
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        # Los cuerpos de las dos fichas, el de la única página del índice y el de la ayuda, cada uno una vez.
        self.assertEqual(len(list((original / "recepciones").glob("*.body"))), 4)
        # Instalado el catálogo, lo pendiente desaparece y un ciclo nuevo no lo repite.
        self.consultar_fuente("06:00", {PRIMERA: "Published", SEGUNDA: "Published"})
        self.assertNotIn("pendientes", json.loads((original / "procedencia.json").read_bytes()))
        self.componer("2026-10-23T06:30:00Z")
        self.assertEqual(len(self.observaciones(PRIMERA)), 4)
        self.assertEqual(self.panel("2026-10-23T06:30:00Z")[PRIMERA]["comprobadoEl"], "2026-10-23T06:00:01Z")

    def test_respuestas_desordenadas_no_cambian_la_evaluacion(self) -> None:
        """El orden de las recepciones pendientes y nuevas no decide fecha ni proyección."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: "Published"})
        self.componer_sin_instalar("2026-10-23T04:30:00Z")
        self.consultar_fuente("05:00", {PRIMERA: "Published", SEGUNDA: None})
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        documento = json.loads((original / "procedencia.json").read_bytes())
        self.assertEqual(len(documento["pendientes"]), 2)
        esperado = self.panel_en_copia("2026-10-23T05:30:00Z")
        documento["pendientes"].reverse()
        documento["capturas"].reverse()
        (original / "procedencia.json").write_text(json.dumps(documento))
        with self._rutas_globales():
            fuente.preparar("hp_life", raiz=self.raiz)
            fuente.validar("hp_life", raiz=self.raiz)
        self.componer("2026-10-23T05:30:00Z")
        invertido = self.panel("2026-10-23T05:30:00Z")
        self.assertEqual(invertido[SEGUNDA]["comprobadoEl"], "2026-10-23T04:00:01Z")
        self.assertEqual(invertido[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T05:00:01Z")
        self.assertEqual(invertido[PRIMERA]["comprobadoEl"], "2026-10-23T05:00:01Z")
        self.assertEqual(invertido, esperado)

    def test_repetir_sin_red_no_renueva_fechas(self) -> None:
        """Recomponer y readmitir sin consultar conserva bytes, fechas y avisos."""
        self.consultar_fuente("04:00", {PRIMERA: "Published", SEGUNDA: None})
        self.componer("2026-10-23T04:30:00Z")
        antes = self.inventario()
        with self._rutas_globales(), patch.object(transporte, "consultar", side_effect=AssertionError("sin red")):
            fuente.preparar("hp_life", raiz=self.raiz)
            fuente.validar("hp_life", raiz=self.raiz)
        self.componer("2026-10-23T07:00:00Z")
        self.assertEqual(self.inventario(), antes)
        with sqlite3.connect(almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 4)


if __name__ == "__main__":
    unittest.main()
