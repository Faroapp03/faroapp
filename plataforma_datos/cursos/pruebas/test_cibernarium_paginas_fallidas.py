"""Ciclos Cibernàrium sin red: una página caída del censo no anula lo visto ni retira lo no visto.

Recorren las piezas reales encadenadas: recepción, procedencia del canal, admisión de la
fuente, registro de vigencia, entrega pública y panel privado. Cada página trae una actividad.
"""

import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, ambitos, censo_ia, negocio_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx
from plataforma_datos.cursos.pruebas import test_cibernarium_matricula_actual as matricula
from plataforma_datos.cursos.pruebas.ayuda_panel_copia import InstalacionConPanel
from plataforma_datos.cursos.pruebas.test_cibernarium_ia import RECORTE_FILTROS

# Actividad de cada página (por su inicio) y su edición.
PAGINAS = {0: ("123", "456"), 1: ("124", "457")}
PRIMERA, SEGUNDA = ("cibernarium-edicion:" + e for _a, e in PAGINAS.values())


def _actividad(desde: int, *, cerrada: bool = False) -> dict:
    actividad, edicion = PAGINAS[desde]
    a = matricula.actividad()
    a.update(activityId=actividad, title="Activitat " + actividad)
    a["listEditions"][0]["activityId"] = edicion
    if cerrada:
        a["listEditions"][0].update(registrationCode="DISP3", registrationDesc="Sense places.", openingsAvailable=False)
    return a


def _cuerpo(desde: int, *, cerrada: bool = False) -> bytes:
    return json.dumps(
        {
            "numActivities": len(PAGINAS),
            "start": desde,
            "end": desde + 1,
            "activities": [_actividad(desde, cerrada=cerrada)],
        }
    ).encode()


def _ref(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())


class PaginasFallidasCibernariumPruebas(InstalacionConPanel, unittest.TestCase):
    """Cada prueba tiene su instalación sintética; ninguna consulta sale a la red."""

    TIPO_OBSERVADO = "edicion"

    def setUp(self) -> None:
        """Instala dos actividades admitidas, una por página, con su edición, capturadas el 23/10 a las 21:00."""
        temporal = tempfile.TemporaryDirectory(prefix="Cibernàrium páginas Año ")
        self.addCleanup(temporal.cleanup)
        self.trabajo = Path(temporal.name)
        self.raiz = self.trabajo / "Instalación ñ"
        # Ninguna consulta puede salir a la red, aunque un parche de transporte falle.
        for parche in (
            patch.object(red, "descargar_url", side_effect=AssertionError("sin red")),
            patch.object(robot, "PAGINA", 1),
        ):
            parche.start()
            self.addCleanup(parche.stop)
        evidencias = self.trabajo / "evidencias"
        evidencias.mkdir()
        programas, ediciones, canales, archivos = [], [], [], []
        for desde in PAGINAS:
            cap = rx._captura(evidencias, adquisicion.url_pagina(desde), _cuerpo(desde), tipo="application/json")
            _, meta = adquisicion.pagina(evidencias, cap)
            prueba = {
                "url": meta["url"],
                "capturado_utc": meta["fin_utc"],
                "sha256": cap["cuerpo"]["sha256"],
                "archivo": cap["cuerpo"]["archivo"],
            }
            actividad = _actividad(desde)
            programa = negocio_actual.programa(actividad)
            edicion = robot.normalizar_edicion(programa["id"], actividad, actividad["listEditions"][0])
            edicion.pop("evidencias")
            edicion["datos"].update(
                horas_publicadas=2, metodo_horas=negocio_actual.METODO_HORAS_HTML, idioma_ficha_principal="Català"
            )
            programas.append({**programa, "etiquetas": [], "evidencias": [prueba]})
            ediciones.append({**edicion, "evidencias": [prueba]})
            canales.extend(
                {"entidad": e, "id": o["id"], "canal": "actividad-api", "evidencias": [prueba]}
                for e, o in (("programa", programa), ("edicion", edicion))
            )
            archivos.append(cap["cuerpo"])
        base = self.trabajo / "entrada.sqlite3"
        lote = {
            "schema_version": 1,
            "observado_utc": "2026-10-23T21:00:02Z",
            "fuente_lote": "sintetica-cibernarium",
            "proveedores": [
                {"id": "cibernarium", "nombre": "Fuente sintética", "naturaleza": None, "territorio": None}
            ],
            "programas": programas,
            "ediciones": ediciones,
        }
        catalogo.cargar_lote(base, lote, True, evidencias, canales_temporales=canales)
        indice = self.trabajo / "indice.json"
        guardar_json(indice, {"schema_version": 1, "archivos_conservados": archivos})
        solicitud = admision.SolicitudAdmision(
            snapshot=_ref(base),
            procedencia={"captura": _ref(indice)},
            indices_evidencias={"api-inicial": admision.IndiceEvidencias(archivo=_ref(indice), raiz=evidencias)},
            validacion_destino=self.trabajo / "validacion.json",
        )
        admision.admitir_snapshot(solicitud)
        almacen.conservar(
            almacen.EntradaCatalogo(admision=solicitud, sha256_admision=_ref(solicitud.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        # La casa Barcelona Activa ya tiene su procedencia ocupacional; el canal se vincula a ella.
        casa = self.raiz / "var/actualizacion/originales/barcelonactiva"
        casa.mkdir(parents=True)
        guardar_json(casa / "procedencia.json", {"fuente_id": "barcelonactiva", "archivos": []})

    # -- Ciclo real -------------------------------------------------------------------------------------------------

    def consultar_fuente(self, hora: str, paginas: dict[int, str | int | None]) -> bool:
        """Recibe, prepara y admite Cibernàrium con un transporte falso.

        Cada página responde «normal», «cerrada» (edición sin plazas), None (sin respuesta)
        o un código HTTP de fallo con cuerpo. Las normas responden siempre.

        Returns:
            Si la recepción terminó sin fallo total.
        """

        def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
            inicio, fin = f"2026-10-23T{hora}:00+00:00", f"2026-10-23T{hora}:01+00:00"
            if url == adquisicion.NORMAS:
                cuerpo, tipo = rx._normas(), "text/html; charset=utf-8"
            elif url == ambitos.FILTROS:
                cuerpo, tipo = RECORTE_FILTROS.encode(), "text/html; charset=utf-8"
            else:
                # El censo del ámbito de IA pide las mismas páginas con su filtro: aquí responde lo mismo.
                desde = next(d for d in PAGINAS if url in (adquisicion.url_pagina(d), censo_ia.url_pagina(d)))
                estado = paginas[desde]
                if estado is None:
                    return transporte.RespuestaCatalogo(
                        url=url, inicio_utc=inicio, fin_utc=fin, cuerpo=None, error="timeout"
                    )
                if type(estado) is int:
                    return transporte.RespuestaCatalogo(
                        url=url,
                        inicio_utc=inicio,
                        fin_utc=fin,
                        cuerpo=b"Servei no disponible",
                        url_final=url,
                        http=estado,
                        completo=True,
                        content_type="text/plain",
                    )
                cuerpo, tipo = _cuerpo(desde, cerrada=estado == "cerrada"), "application/json"
            return transporte.RespuestaCatalogo(
                url=url,
                inicio_utc=inicio,
                fin_utc=fin,
                cuerpo=cuerpo,
                url_final=url,
                http=200,
                completo=True,
                content_type=tipo,
            )

        with self._rutas_globales(), patch.object(fuente, "consultar", side_effect=responder):
            try:
                fuente.descargar("barcelonactiva", raiz=self.raiz)
            except FormatoInesperado:
                return False
            fuente.preparar("barcelonactiva", raiz=self.raiz)
            fuente.validar("barcelonactiva", raiz=self.raiz)
        return True

    def componer(self, corte: str) -> dict:
        """Compone e instala el catálogo como lo hace un paquete en verde.

        Returns:
            Ofertas públicas por edición.
        """
        with patch.object(fuente, "consultar", side_effect=AssertionError("sin red")):
            resultado = componer.componer(raiz=self.raiz, corte_utc=corte)
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        return {o["unidad"]["id"]: o for o in dto["ofertas"]}

    # -- Pruebas ----------------------------------------------------------------------------------------------------

    def test_pagina_caida_confirma_lo_visto_y_conserva_lo_no_visto(self) -> None:
        """Lo visto se confirma con su fecha; lo no visto conserva su confirmación y avisa del intento."""
        self.assertTrue(self.consultar_fuente("21:10", {0: "normal", 1: "normal"}))
        antes = self.componer("2026-10-23T21:40:00Z")
        self.assertTrue(self.consultar_fuente("22:00", {0: "normal", 1: None}))
        conjunto = fuente.leer_validado("barcelonactiva", self.raiz)
        self.assertIs(conjunto["censo_completo"], False)
        self.assertNotIn("conocidos_ausentes", conjunto["censo"])
        self.assertEqual(
            conjunto["consulta_parcial"],
            {
                "unidades_fallidas": ["cibernarium:124"],
                "unidades_esperadas": 2,
                "paginas_fallidas": [1],
                "paginas_esperadas": 2,
            },
        )
        dto = self.componer("2026-10-23T22:30:00Z")
        self.assertEqual(set(dto), {PRIMERA, SEGUNDA})
        self.assertEqual(dto[PRIMERA]["comprobado_el"], "2026-10-23T22:00:01Z")
        self.assertEqual(dto[SEGUNDA]["comprobado_el"], "2026-10-23T21:10:01Z")
        # Los hechos de la edición no vista siguen siendo los de su última recepción válida.
        self.assertEqual(dto[SEGUNDA]["hechos"], antes[SEGUNDA]["hechos"])
        panel = self.panel("2026-10-23T22:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "disponible-publicamente")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T21:10:01Z")
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T22:00:01Z")
        self.assertIsNone(panel[PRIMERA]["ultimoIntentoFallidoEl"])
        fallo = [o for o in self.observaciones(SEGUNDA) if o["resultado"] == "fallo"]
        self.assertEqual(len(fallo), 1)
        self.assertEqual(fallo[0]["detalle"], {"motivo": "pagina_del_censo_sin_respuesta_valida"})
        self.assertEqual(fallo[0]["url_consultada"], adquisicion.url_pagina(1))

    def test_respuesta_503_es_fallo_de_consulta_como_el_transporte(self) -> None:
        """Una página con cuerpo y código de fallo de consulta no se lee como censo ni anula la fuente."""
        self.assertTrue(self.consultar_fuente("21:10", {0: "normal", 1: "normal"}))
        self.componer("2026-10-23T21:40:00Z")
        for hora, codigo in (("22:00", 503), ("22:10", 429), ("22:20", 401)):
            self.assertTrue(self.consultar_fuente(hora, {0: "normal", 1: codigo}))
            self.assertEqual(
                fuente.leer_validado("barcelonactiva", self.raiz)["consulta_parcial"]["paginas_fallidas"], [1]
            )
            corte = f"2026-10-23T{hora}:30Z"
            self.assertEqual(self.componer(corte)[SEGUNDA]["comprobado_el"], "2026-10-23T21:10:01Z")
            self.assertEqual(self.panel(corte)[SEGUNDA]["ultimoIntentoFallidoEl"], f"2026-10-23T{hora}:01Z")

    def test_confirmacion_fallo_y_recuperacion(self) -> None:
        """Tras el fallo, una respuesta válida renueva la fecha, retira el aviso y la consulta vuelve a ser completa."""
        self.consultar_fuente("21:10", {0: "normal", 1: "normal"})
        self.consultar_fuente("22:00", {0: "normal", 1: None})
        self.componer("2026-10-23T22:30:00Z")
        self.assertEqual(self.panel("2026-10-23T22:30:00Z")[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T22:00:01Z")
        self.assertTrue(self.consultar_fuente("23:00", {0: "normal", 1: "normal"}))
        conjunto = fuente.leer_validado("barcelonactiva", self.raiz)
        self.assertIs(conjunto["censo_completo"], True)
        self.assertNotIn("consulta_parcial", conjunto)
        dto = self.componer("2026-10-23T23:30:00Z")
        self.assertEqual(dto[SEGUNDA]["comprobado_el"], "2026-10-23T23:00:01Z")
        panel = self.panel("2026-10-23T23:30:00Z")
        self.assertIsNone(panel[SEGUNDA]["ultimoIntentoFallidoEl"])
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T23:00:01Z")

    def test_cierre_confirmado_y_fallo_posterior_no_resucita(self) -> None:
        """Una edición sin plazas sale de la entrega; una página caída después no la devuelve."""
        self.assertTrue(self.consultar_fuente("21:10", {0: "normal", 1: "cerrada"}))
        self.assertNotIn(SEGUNDA, self.componer("2026-10-23T21:40:00Z"))
        cerrada = self.panel("2026-10-23T21:40:00Z")[SEGUNDA]
        self.assertEqual(cerrada["decision"], "no-disponible-publicamente")
        self.assertTrue(self.consultar_fuente("22:00", {0: "normal", 1: None}))
        self.assertNotIn(SEGUNDA, self.componer("2026-10-23T22:30:00Z"))
        panel = self.panel("2026-10-23T22:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "no-disponible-publicamente")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], cerrada["comprobadoEl"])
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T22:00:01Z")

    def test_respuestas_desordenadas_no_cambian_la_evaluacion(self) -> None:
        """El orden de las páginas en el índice no decide fecha, aviso ni proyección."""
        self.consultar_fuente("21:10", {0: "normal", 1: "normal"})
        self.componer("2026-10-23T21:40:00Z")
        self.consultar_fuente("22:00", {0: "normal", 1: None})
        esperado = self.panel_en_copia("2026-10-23T22:30:00Z")
        original, _, _ = fuente.rutas_de_la_fuente("barcelonactiva", self.raiz)
        documento = json.loads((original / "procedencia.json").read_bytes())
        documento["capturas"].reverse()
        (original / "procedencia.json").write_text(json.dumps(documento))
        with self._rutas_globales():
            fuente.preparar("barcelonactiva", raiz=self.raiz)
            fuente.validar("barcelonactiva", raiz=self.raiz)
        self.componer("2026-10-23T22:30:00Z")
        invertido = self.panel("2026-10-23T22:30:00Z")
        self.assertEqual(invertido[SEGUNDA]["comprobadoEl"], "2026-10-23T21:10:01Z")
        self.assertEqual(invertido[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T22:00:01Z")
        self.assertEqual(invertido[PRIMERA]["comprobadoEl"], "2026-10-23T22:00:01Z")
        self.assertEqual(invertido, esperado)

    def test_repetir_sin_red_no_renueva_fechas(self) -> None:
        """Readmitir y recomponer sin consultar conserva bytes, fechas y avisos."""
        self.consultar_fuente("21:10", {0: "normal", 1: "normal"})
        self.consultar_fuente("22:00", {0: "normal", 1: None})
        self.componer("2026-10-23T22:30:00Z")
        antes = self.inventario()
        with sqlite3.connect(almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta) as conexion:
            observaciones = conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0]
        with self._rutas_globales(), patch.object(fuente, "consultar", side_effect=AssertionError("sin red")):
            fuente.preparar("barcelonactiva", raiz=self.raiz)
            fuente.validar("barcelonactiva", raiz=self.raiz)
        self.componer("2026-10-23T23:50:00Z")
        self.assertEqual(self.inventario(), antes)
        with sqlite3.connect(almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta) as conexion:
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], observaciones
            )

    def test_fallo_total_registra_el_intento_sin_tocar_lo_publicado(self) -> None:
        """Sin la primera página no hay censo: no se admite nada y la instalación sigue igual."""
        self.consultar_fuente("21:10", {0: "normal", 1: "normal"})
        self.componer("2026-10-23T21:40:00Z")
        antes = self.inventario()
        _, _, validado = fuente.rutas_de_la_fuente("barcelonactiva", self.raiz)
        admitida = (validado / "validacion.json").read_bytes()
        for hora, primera in (("22:00", None), ("22:10", 503)):
            self.assertFalse(self.consultar_fuente(hora, {0: primera, 1: "normal"}))
            original, _, _ = fuente.rutas_de_la_fuente("barcelonactiva", self.raiz)
            documento = json.loads((original / "procedencia.json").read_bytes())
            self.assertEqual(len(documento["capturas"]), 1)
            self.assertEqual((validado / "validacion.json").read_bytes(), admitida)
        self.componer("2026-10-23T22:30:00Z")
        self.assertEqual(self.inventario(), antes)


if __name__ == "__main__":
    unittest.main()
