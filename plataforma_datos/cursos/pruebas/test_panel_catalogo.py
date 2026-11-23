"""La lista privada lee la admisión y decisiones existentes, sin evaluarlas ni publicar."""

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import panel_catalogo as panel
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures


class PanelCatalogoPruebas(unittest.TestCase):
    """Autoridad explícita, referencias mínimas y fechas conservadas."""

    def setUp(self) -> None:
        """Crea la misma muestra admitida que usa el productor HP, sin red."""
        self.caso = fixtures.ActualizacionHpLifePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        hp.preparar(self.caso.solicitud)
        self.solicitud = hp.solicitud_admision(self.caso.solicitud.area)
        self.sha = hashlib.sha256(self.solicitud.validacion_destino.read_bytes()).hexdigest()

    def proyectar(self) -> dict:
        """Impide cualquier llamada accidental al evaluador.

        Returns:
            Proyección de registros ya calculados y admitidos.
        """
        with patch.object(vigencia, "evaluar_vigencia", side_effect=AssertionError("No recalcular")):
            return panel.desde_admision(self.solicitud, self.sha, corte_utc=fixtures.fixtures.AHORA)

    def test_decision_fechas_y_firmas_se_conservan_sin_afirmar_publicacion(self) -> None:
        """No convierte una recepción en un despliegue ni cambia bytes del almacén."""
        base = self.solicitud.snapshot.ruta
        antes = (base.read_bytes(), base.stat().st_mtime_ns)
        salida = self.proyectar()
        fila = salida["unidades"][0]
        nativa = registro.consultar_unidad(base, tipo="recurso", id=fila["id"])
        e = nativa["evaluacion"]
        self.assertEqual(fila["decision"], e["resultado"]["estado"])
        self.assertEqual(fila["comprobadoEl"], e["resultado"]["comprobado_el"])
        self.assertEqual(fila["ultimoIntentoEl"], e["resultado"]["ultimo_intento_el"])
        self.assertEqual(fila["evaluadorSha256"], e["evaluador"]["sha256"])
        self.assertIsNone(salida["publicacionConfirmada"])
        self.assertIsNone(fila["motivoRetencion"])
        self.assertEqual((base.read_bytes(), base.stat().st_mtime_ns), antes)
        self.assertEqual(self.proyectar(), salida)
        texto = json.dumps(salida)
        for privado in (str(self.caso.raiz), "cuerpo_html", "observaciones", "huella_entradas"):
            self.assertNotIn(privado, texto)

    def test_casa_operativa_bajo_cerrojo_y_ausencia_explicita(self) -> None:
        """La creación de recibo atraviesa la casa única y no prepara autoridades al leer."""
        raiz = self.caso.raiz / "Candidata ñ"
        raiz.mkdir()
        self.assertIsNone(panel.crear(raiz, corte_utc=fixtures.fixtures.AHORA))
        area = raiz / almacen.RUTA
        almacen.conservar(almacen.EntradaCatalogo(admision=self.solicitud, sha256_admision=self.sha), destino=area)
        base = almacen.solicitud(area).snapshot.ruta
        antes = (base.read_bytes(), base.stat().st_mtime_ns)
        salida = panel.crear(raiz, corte_utc=fixtures.fixtures.AHORA)
        self.assertEqual(salida["unidades"][0]["comprobadoEl"], self.proyectar()["unidades"][0]["comprobadoEl"])
        self.assertEqual((base.read_bytes(), base.stat().st_mtime_ns), antes)
        with (
            patch.object(panel.almacen, "solicitud", side_effect=ValueError("admisión ilegible")),
            self.assertRaises(ValueError),
        ):
            panel.crear(raiz, corte_utc=fixtures.fixtures.AHORA)

    def _nativa(self) -> dict:
        """Lee la unidad registrada que proyecta el panel.

        Returns:
            Estado nativo del registro, copiable sin tocar el almacén.
        """
        fila = self.proyectar()["unidades"][0]
        return registro.consultar_unidad(self.solicitud.snapshot.ruta, tipo="recurso", id=fila["id"])

    def test_revision_interna_vencida_y_fallo_solo_avisan_sin_cambiar_decision(self) -> None:
        """Pasada la revisión interna, el panel avisa pero la unidad no se retiene ni cambia."""
        from plataforma_datos.cursos.entrega_catalogo import estado_interno_de_unidad
        from plataforma_datos.cursos.seleccion_entrega_catalogo import motivo_de_retencion

        inicial = self.proyectar()
        fila = inicial["unidades"][0]
        nativa = self._nativa()
        self.assertEqual(fila["revisarEl"], nativa["evaluacion"]["resultado"]["revisar_el"])
        self.assertIsNotNone(fila["revisarEl"])
        self.assertNotIn("venceEl", fila)
        tarde = "2026-11-02T00:00:00Z"
        self.assertLess(fila["revisarEl"], tarde)
        with patch.object(vigencia, "evaluar_vigencia", side_effect=AssertionError("No recalcular")):
            posterior = panel.desde_admision(self.solicitud, self.sha, corte_utc=tarde)
        actual = posterior["unidades"][0]
        self.assertEqual(posterior["corteRegistro"], inicial["corteRegistro"])
        for campo in ("decision", "motivos", "comprobadoEl", "revisarEl", "cierraEl", "motivoRetencion"):
            self.assertEqual(actual[campo], fila[campo])
        self.assertIsNone(actual["motivoRetencion"])
        con_fallo = copy.deepcopy(nativa)
        con_fallo["evaluacion"]["resultado"]["ultimo_intento_fallido_el"] = "2026-10-23T11:00:00Z"
        vista = panel._fila(con_fallo, {"programa_id": fila["programaId"], "titulo": fila["titulo"]}, [], {})
        self.assertEqual(vista["ultimoIntentoFallidoEl"], "2026-10-23T11:00:00Z")
        self.assertEqual(vista["decision"], fila["decision"])
        self.assertEqual(
            motivo_de_retencion(estado_interno_de_unidad(con_fallo, tarde), tarde),
            motivo_de_retencion(estado_interno_de_unidad(nativa, tarde), tarde),
        )
        con_fallo["evaluacion"]["resultado"]["incidencia_enlace"] = {
            "el": "2026-10-23T11:30:00Z",
            "origen": "ficha",
            "tipo": "otra_identidad",
            "codigo_http": 200,
        }
        referencias = []
        vista = panel._fila(con_fallo, {"programa_id": fila["programaId"], "titulo": fila["titulo"]}, referencias, {})
        self.assertEqual(
            vista["incidenciaEnlace"],
            {"el": "2026-10-23T11:30:00Z", "origen": "ficha", "tipo": "otra_identidad", "codigoHttp": 200},
        )
        self.assertEqual(vista["decision"], fila["decision"])
        vista["motivoRetencion"] = None
        panel._validar_unidad(vista, tarde, len(referencias))
        self.assertEqual(
            motivo_de_retencion(estado_interno_de_unidad(con_fallo, tarde), tarde),
            motivo_de_retencion(estado_interno_de_unidad(nativa, tarde), tarde),
        )

    def test_evaluacion_anterior_se_lee_sin_presentarse_como_comprobacion_nueva(self) -> None:
        """Un resultado schema 1 con `vence_el` sigue legible, conserva su fecha y no se publica."""
        from plataforma_datos.cursos.entrega_catalogo import estado_interno_de_unidad
        from plataforma_datos.cursos.seleccion_entrega_catalogo import motivo_de_retencion

        nativa = copy.deepcopy(self._nativa())
        resultado = nativa["evaluacion"]["resultado"]
        comprobado = resultado["comprobado_el"]
        for campo in ("cierra_el", "revisar_el", "ultimo_intento_fallido_el", "incidencia_enlace"):
            del resultado[campo]
        resultado.update(schema_version=1, vence_el="2026-10-24T10:00:00Z", estado="sin-confirmar")
        identidad = {"programa_id": nativa["unidad"]["id"], "titulo": "Curso", "url": "https://example.test/c"}
        referencias = []
        vista = panel._fila(nativa, identidad, referencias, {})
        vista["motivoRetencion"] = None
        panel._validar_unidad(vista, "2026-11-02T00:00:00Z", len(referencias))
        self.assertEqual((vista["decision"], vista["comprobadoEl"]), ("sin-confirmar", comprobado))
        # La decisión histórica conserva su valor y la fecha de comprobación.
        resultado["estado"] = "comprobacion-caducada"
        referencias_historicas = []
        vista_historica = panel._fila(nativa, identidad, referencias_historicas, {})
        vista_historica["motivoRetencion"] = None
        panel._validar_unidad(vista_historica, "2026-11-02T00:00:00Z", len(referencias_historicas))
        self.assertEqual(
            (vista_historica["decision"], vista_historica["comprobadoEl"]), ("comprobacion-caducada", comprobado)
        )
        self.assertEqual((vista["cierraEl"], vista["revisarEl"], vista["ultimoIntentoFallidoEl"]), (None, None, None))
        self.assertIsNone(vista["incidenciaEnlace"])
        resultado["estado"] = "disponible-publicamente"
        estado = estado_interno_de_unidad(nativa, "2026-10-23T12:00:00Z")
        self.assertEqual(estado["comprobado_el"], comprobado)
        self.assertNotIn("vence_el", estado)
        self.assertEqual(motivo_de_retencion(estado, "2026-10-23T12:00:00Z"), "resultado_de_evaluacion_anterior")

    def test_url_de_edicion_es_suya_y_sin_evaluacion_no_hereda_programa(self) -> None:
        """Una URL del programa no demuestra la identidad de ninguna edición."""
        identidad = {"programa_id": "p", "titulo": "Programa", "url": "https://example.test/programa"}
        nativa = registro.consultar_unidad(
            self.solicitud.snapshot.ruta, tipo="recurso", id=self.proyectar()["unidades"][0]["id"]
        )
        nativa["unidad"] = {**nativa["unidad"], "tipo": "edicion", "id": "edicion-propia"}
        nativa["evaluacion"]["entradas"]["oferta"]["url"] = "https://example.test/edicion"
        self.assertEqual(panel._fila(nativa, identidad, [], {})["url"], "https://example.test/edicion")
        nativa["evaluacion"] = None
        self.assertIsNone(panel._fila(nativa, identidad, [], {})["url"])

    def test_informe_o_snapshot_alterados_no_se_convierten_en_cero_ocultas(self) -> None:
        """La presencia de una SQLite no sustituye su admisión exacta."""
        with self.assertRaises(ValueError):
            panel.desde_admision(self.solicitud, "0" * 64, corte_utc=fixtures.fixtures.AHORA)
        base = self.solicitud.snapshot.ruta
        base.write_bytes(base.read_bytes() + b"alteracion")
        with self.assertRaises(ValueError):
            self.proyectar()

    def test_urls_omiten_todos_los_parametros_y_fragmentos(self) -> None:
        """No depende de adivinar los nombres de las claves secretas."""
        ref = panel._referencia(
            {
                "url": "https://example.test/curso?x=secreto#credencial",
                "sha256": "a" * 64,
                "alcance": "identidad",
                "capturado_utc": "2026-10-23T00:00:00Z",
            }
        )
        self.assertEqual(ref["url"], "https://example.test/curso")
        self.assertTrue(ref["parametrosOmitidos"])
        self.assertNotIn("secreto", json.dumps(ref))
        with self.assertRaises(ValueError):
            panel._url("file:///Volumes/privado")

    def test_no_copia_historial_y_conserva_ultimo_fallo_y_apoyo_vigente(self) -> None:
        """Diez recepciones anteriores no se repiten dentro de la observación del panel."""
        observaciones = []
        capturas = {}
        for dia in range(1, 10):
            fecha = f"2026-10-{dia:02}T00:00:00Z"
            obs = {
                "id": str(dia),
                "tipo": "ficha",
                "terminado_el": fecha,
                "evidencias": [{"fecha": fecha}],
                "resultado": "correcta",
            }
            observaciones.append(obs)
            capturas[str(dia)] = {"comprobado_el": fecha}
        ultimo = "2026-10-09T00:00:00Z"
        e = {
            "entradas": {"observaciones": observaciones},
            "resultado": {"comprobado_el": ultimo, "trazabilidad": {"capturas": capturas}},
        }
        self.assertEqual(panel._evidencias_actuales(e), [{"fecha": ultimo}])
        observaciones.append(
            {
                "id": "fallo",
                "tipo": "ficha",
                "terminado_el": "2026-10-10T00:00:00Z",
                "resultado": "fallo",
                "evidencias": [{"fallo": True}],
            }
        )
        self.assertEqual(panel._evidencias_actuales(e), [{"fecha": ultimo}, {"fallo": True}])

    def test_limite_se_comprueba_antes_de_serializar_coleccion_compartida(self) -> None:
        """No expande una entrada programática completa antes de aplicar el presupuesto."""
        salida = self.proyectar()
        base = salida["unidades"][0]
        salida["unidades"] = [
            {**base, "id": f"unidad-{i}", "motivos": ["x" * panel.MAX_TEXTO] * panel.MAX_REFERENCIAS_UNIDAD}
            for i in range(100)
        ]
        real = json.dumps

        def acotado(valor: object, **opciones: object) -> str:
            if valor is salida:
                raise AssertionError("Colección completa no debe expandirse")
            return real(valor, **opciones)

        with patch.object(panel.json, "dumps", side_effect=acotado), self.assertRaises(ValueError):
            panel.validar(salida)

    def test_validacion_rechaza_campos_abiertos_booleanos_y_referencias_alteradas(self) -> None:
        """El recibo solo transportará esta estructura cerrada y ligada a su revisión."""
        salida = self.proyectar()
        for alteracion in ("booleano", "extra", "referencia", "publicacion"):
            mal = copy.deepcopy(salida)
            if alteracion == "booleano":
                mal["version"] = True
            elif alteracion == "extra":
                mal["ruta_equipo"] = str(self.caso.raiz)
            elif alteracion == "referencia":
                mal["unidades"][0]["referencias"] = [len(mal["referencias"])]
            else:
                mal["publicacionConfirmada"] = True
            with self.assertRaises(ValueError):
                panel.validar(mal)
        with patch.object(panel, "MAX_BYTES", 1), self.assertRaises(ValueError):
            panel.validar(salida)


if __name__ == "__main__":
    unittest.main()
