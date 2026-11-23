"""Productor HP offline: copia aislada, canales, registro único y admisión."""

import hashlib
import json
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures


class ActualizacionHpLifePruebas(unittest.TestCase):
    """Todo archivo y toda base pertenecen al fixture; no se consulta red ni var."""

    def setUp(self) -> None:
        """Crea una base V9 admitida con canal antiguo sin atribución retrospectiva."""
        temporal = tempfile.TemporaryDirectory(prefix="HP Año ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.base = self.raiz / "entrada.sqlite3"
        cuerpo, _recibo = fixtures.recepcion()
        self.viejo = self.raiz / "curso-anterior.body"
        self.viejo.write_bytes(cuerpo)
        evidencia = {
            "url": fixtures.URL,
            "capturado_utc": "2026-10-22T02:07:20Z",
            "sha256": hashlib.sha256(cuerpo).hexdigest(),
            "archivo": self.viejo.name,
        }
        dato = fixtures.negocio()
        programa = {
            "id": fixtures.OFERTA["id"],
            "proveedor_id": "hp-life",
            "titulo": dato["name"],
            "url": fixtures.URL,
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
        lote = {
            "schema_version": 1,
            "observado_utc": evidencia["capturado_utc"],
            "fuente_lote": "sintetica",
            "proveedores": [{"id": "hp-life", "nombre": "HP LIFE", "naturaleza": None, "territorio": None}],
            "programas": [programa],
            "ediciones": [],
        }
        canal = {
            "entidad": "programa",
            "id": fixtures.OFERTA["id"],
            "canal": "documento-historico",
            "evidencias": [evidencia],
        }
        catalogo.cargar_lote(self.base, lote, True, self.raiz, canales_temporales=[canal])
        referencia = self.raiz / "linaje.json"
        referencia.write_text('{"origen":"sintetico"}')
        self.admision = admision.SolicitudAdmision(
            snapshot=self.ref(self.base),
            procedencia={"linaje": self.ref(referencia)},
            validacion_destino=self.raiz / "validacion-base.json",
        )
        admision.admitir_snapshot(self.admision)
        self.entrada = self.guardar_recepcion()
        self.solicitud = hp.SolicitudHpLife(
            admision=self.admision,
            sha256_admision=self.ref(self.admision.validacion_destino).sha256,
            recepciones=(self.entrada,),
            raiz_evidencias=self.raiz,
            area=self.raiz / "preparada",
            corte_utc=fixtures.AHORA,
        )

    def ref(self, ruta: Path) -> admision.ReferenciaArchivo:
        """Fija una referencia de bytes actuales sin usar el reloj del archivo.

        Returns:
            Ruta y SHA esperados.
        """
        return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

    def guardar_recepcion(self, *, cambio: bool = False, fecha: str = fixtures.FIN) -> hp.RecepcionEnDisco:
        """Guarda un cuerpo propio con una recepción verificable.

        Returns:
            Referencias explícitas a la misma identidad nativa.
        """
        dato = fixtures.negocio()
        if cambio:
            dato.update(name="Título nuevo", body="<p>Contenido nuevo.</p>")
        cuerpo, recibo = fixtures.recepcion(dato, recibido_utc=fecha)
        nombre = hashlib.sha256(recibo).hexdigest()
        body, meta = self.raiz / (nombre + ".body"), self.raiz / (nombre + ".json")
        body.write_bytes(cuerpo)
        meta.write_bytes(recibo)
        return hp.RecepcionEnDisco(id=fixtures.OFERTA["id"], cuerpo=self.ref(body), recibo=self.ref(meta))

    def test_preparar_copia_admitida_y_repetir_conserva_bytes_y_fechas(self) -> None:
        """El anclaje no actualiza negocio ni fecha antigua; la oferta viene del único registro."""
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        control = hp.preparar(self.solicitud)
        salida = self.solicitud.area / "catalogo.sqlite3"
        actual = registro.consultar_unidad(salida, tipo="recurso", id=fixtures.OFERTA["id"])
        self.assertEqual(actual["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(actual["evaluacion"]["resultado"]["comprobado_el"], "2026-10-23T02:07:20.814607Z")
        self.assertIsNone(hp.validar(self.solicitud.area)["publicacion_confirmada"])
        files = {
            p.relative_to(self.solicitud.area).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in self.solicitud.area.rglob("*")
            if p.is_file()
        }
        self.assertEqual(hp.preparar(self.solicitud), control)
        self.assertEqual(
            files,
            {
                p.relative_to(self.solicitud.area).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.solicitud.area.rglob("*")
                if p.is_file()
            },
        )
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)
        with sqlite3.connect(salida) as conexion:
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM versiones WHERE entidad='programa'").fetchone()[0], 1
            )
            self.assertEqual(conexion.execute("SELECT count(*) FROM ediciones").fetchone()[0], 0)

    def siguiente(self, entrada: hp.RecepcionEnDisco) -> hp.SolicitudHpLife:
        """Usa la salida admitida como entrada del siguiente ciclo, sin migración.

        Returns:
            Ciclo explícito en otro destino.
        """
        actual = hp.solicitud_admision(self.solicitud.area)
        return replace(
            self.solicitud,
            admision=actual,
            sha256_admision=self.ref(actual.validacion_destino).sha256,
            raiz_evidencias=self.solicitud.area / "evidencias",
            recepciones=(entrada,),
            area=self.raiz / "siguiente",
            corte_utc="2026-10-23T04:00:00Z",
        )

    def test_bytes_efectivos_ausentes_alterados_o_enlazados_no_se_readmiten(self) -> None:
        """La guarda común rechaza cada cuerpo/recibo/antecedente/pendiente en todas las rutas."""
        cuerpo = self.raiz / "pendiente.body"
        recibo = self.raiz / "pendiente.json"
        cuerpo.write_bytes("captura pendiente sintética".encode())
        recibo.write_bytes(b'{"http":200}')
        pendiente = hp.RecepcionEnDisco(id="hp-life:135:es", cuerpo=self.ref(cuerpo), recibo=self.ref(recibo))
        solicitud = replace(self.solicitud, recepciones=(*self.solicitud.recepciones, pendiente))
        control = hp.preparar(solicitud)
        adm = hp.solicitud_admision(solicitud.area)
        publicacion = entrega.SolicitudEntrega(
            admision=adm,
            instalacion=self.raiz,
            sha256_admision=self.ref(adm.validacion_destino).sha256,
            area=self.raiz / "proyección alterada",
            corte_utc=solicitud.corte_utc,
        )
        self.assertEqual(len(control["archivos_conservados"]), 6)
        antes = adm.validacion_destino.read_bytes()
        for prueba in control["archivos_conservados"]:
            archivo = solicitud.area / prueba["archivo"]
            original = archivo.read_bytes()
            for cambio in ("ausente", "alterado", "enlace"):
                with self.subTest(archivo=prueba["archivo"], cambio=cambio):
                    archivo.unlink()
                    if cambio == "alterado":
                        archivo.write_bytes(b"contenido sustituido")
                    elif cambio == "enlace":
                        archivo.symlink_to(cuerpo)
                    try:
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            hp.validar(solicitud.area)
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            hp.preparar(solicitud)
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            admision.admitir_snapshot(hp.solicitud_admision(solicitud.area))
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            entrega.preparar(publicacion)
                        self.assertFalse(publicacion.area.exists())
                        self.assertEqual(adm.validacion_destino.read_bytes(), antes)
                    finally:
                        archivo.unlink(missing_ok=True)
                        archivo.write_bytes(original)
        self.assertEqual(hp.preparar(solicitud), control)

    def test_cuatro_ciclos_conservan_todos_los_recibos_y_sus_vinculos(self) -> None:
        """La historia referida no se reduce al último soporte de cada canal."""
        actual = self.solicitud
        recibos = [self.entrada.recibo.sha256]
        for numero in range(4):
            if numero:
                adm = hp.solicitud_admision(actual.area)
                entrada = self.guardar_recepcion(fecha=f"2026-10-23T0{numero + 2}:30:00Z")
                recibos.append(entrada.recibo.sha256)
                actual = replace(
                    actual,
                    admision=adm,
                    sha256_admision=self.ref(adm.validacion_destino).sha256,
                    recepciones=(entrada,),
                    raiz_evidencias=actual.area / "evidencias",
                    area=self.raiz / f"ciclo-{numero + 1}",
                    corte_utc=f"2026-10-23T0{numero + 3}:00:00Z",
                )
            control = hp.preparar(actual)
            archivos = {e["archivo"]: e["sha256"] for e in control["archivos_conservados"]}
            for sha in recibos:
                relativa = "evidencias/hp-life/recepciones/" + sha + ".json"
                self.assertEqual(archivos[relativa], sha)
                self.assertEqual(self.ref(actual.area / relativa).sha256, sha)
        estado = registro.consultar_unidad(actual.area / "catalogo.sqlite3", tipo="recurso", id=self.entrada.id)
        observaciones = estado["evaluacion"]["entradas"]["observaciones"]
        self.assertEqual(len(observaciones), 4)
        self.assertEqual(observaciones[0]["terminado_el"], fixtures.FIN)
        antes = {
            str(p.relative_to(actual.area)): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in actual.area.rglob("*")
            if p.is_file()
        }
        self.assertEqual(hp.preparar(actual), control)
        self.assertEqual(
            antes,
            {
                str(p.relative_to(actual.area)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in actual.area.rglob("*")
                if p.is_file()
            },
        )
        primera = actual.area / "evidencias/hp-life/recepciones" / (recibos[0] + ".json")
        original = primera.read_bytes()
        for alterada in (False, True):
            with self.subTest(primera_alterada=alterada):
                primera.unlink()
                if alterada:
                    primera.write_bytes(b"recibo sustituido")
                try:
                    with self.assertRaises(admision.ErrorAdmisionCatalogo):
                        hp.validar(actual.area)
                    with self.assertRaises(admision.ErrorAdmisionCatalogo):
                        hp.preparar(actual)
                    with self.assertRaises(admision.ErrorAdmisionCatalogo):
                        admision.admitir_snapshot(hp.solicitud_admision(actual.area))
                finally:
                    primera.unlink(missing_ok=True)
                    primera.write_bytes(original)

    def test_proyeccion_no_sobrescribe_indice_cuerpos_recibos_ni_antecedentes(self) -> None:
        """La lista indexada conserva las fronteras directas e inversas del consumidor."""
        control = hp.preparar(self.solicitud)
        adm = hp.solicitud_admision(self.solicitud.area)
        solicitud = entrega.SolicitudEntrega(
            admision=adm,
            instalacion=self.raiz,
            sha256_admision=self.ref(adm.validacion_destino).sha256,
            area=self.raiz / "proyección segura",
            corte_utc=self.solicitud.corte_utc,
        )
        entrega.preparar(solicitud)
        entrega.validar(solicitud)
        rutas = [
            self.solicitud.area / "control-hp-life.json",
            *(self.solicitud.area / e["archivo"] for e in control["archivos_conservados"]),
        ]
        for ruta in rutas:
            with self.subTest(entrada=ruta.name):
                antes = ruta.read_bytes()
                with self.assertRaises(entrega.contrato.ErrorEntregaCatalogo):
                    entrega.exportar(solicitud, destino=ruta)
                with self.assertRaises(entrega.contrato.ErrorEntregaCatalogo):
                    entrega.preparar(replace(solicitud, area=ruta.parent))
                self.assertEqual(ruta.read_bytes(), antes)
        alias = self.raiz / "alias-publico.json"
        alias.symlink_to(rutas[-1])
        with self.assertRaises(entrega.contrato.ErrorEntregaCatalogo):
            entrega.exportar(solicitud, destino=alias)
        alias.unlink()
        alias.hardlink_to(rutas[-1])
        with self.assertRaises((entrega.contrato.ErrorEntregaCatalogo, admision.ErrorAdmisionCatalogo)):
            entrega.exportar(solicitud, destino=alias)
        alias.unlink()
        self.assertEqual(hp.validar(self.solicitud.area)["schema_version"], 2)

    def test_cambio_real_posterior_actualiza_canal_y_marca_etiquetas(self) -> None:
        """Un título/body nuevos continúan por el cargador y dejan los antecedentes intactos."""
        hp.preparar(self.solicitud)
        siguiente = self.siguiente(self.guardar_recepcion(cambio=True, fecha="2026-10-23T03:30:00Z"))
        hp.preparar(siguiente)
        with sqlite3.connect(siguiente.area / "catalogo.sqlite3") as conexion:
            titulo, datos = conexion.execute("SELECT titulo,datos FROM programas").fetchone()
            self.assertEqual(titulo, "Título nuevo")
            self.assertEqual(json.loads(datos)["soporte_acceso"], {"fecha": "2026-10-22T02:07:20Z"})
            self.assertEqual(
                conexion.execute("SELECT revision FROM etiquetas WHERE vigente=1").fetchone()[0], "requiere_revision"
            )
        self.assertEqual(len(catalogo.buscar(siguiente.area / "catalogo.sqlite3", "nuevo")), 1)

    def test_fallo_de_registro_o_admision_no_promueve_y_conserva_entrada(self) -> None:
        """No queda una preparación parcial visible aunque ya haya escrito en staging."""
        antes = self.base.read_bytes()
        for modulo, nombre in ((registro, "registrar_unidad"), (hp.admision, "admitir_snapshot")):
            with (
                self.subTest(fallo=nombre),
                patch.object(modulo, nombre, side_effect=RuntimeError("corte-sintetico")),
                self.assertRaisesRegex(RuntimeError, "corte-sintetico"),
            ):
                hp.preparar(self.solicitud)
            self.assertFalse(self.solicitud.area.exists())
            self.assertEqual(self.base.read_bytes(), antes)
        self.assertFalse(list(self.raiz.glob(".hp-life-*")))

    def test_recibo_sin_completitud_queda_conservado_pendiente(self) -> None:
        """No se inventa una observación de curso para rescatar un recibo antiguo plano."""
        self.entrada.recibo.ruta.write_text('{"http":200,"original_conservado":true}')
        entrada = replace(self.entrada, recibo=self.ref(self.entrada.recibo.ruta))
        solicitud = replace(self.solicitud, recepciones=(entrada,))
        control = hp.preparar(solicitud)
        self.assertEqual(control["recepciones"][0]["estado"], "pendiente")
        self.assertEqual(len(list((solicitud.area / "pendientes").iterdir())), 3)
        self.assertEqual(
            registro.consultar_unidad(solicitud.area / "catalogo.sqlite3", tipo="recurso", id=entrada.id)[
                "estado_registro"
            ],
            "no_evaluado",
        )

    def test_proyeccion_publica_comun_sin_reevaluar_y_revision_sin_renovacion(self) -> None:
        """Solo sale el recurso confirmado; pasada su revisión interna sigue igual, sin rejuvenecer."""
        hp.preparar(self.solicitud)
        adm = hp.solicitud_admision(self.solicitud.area)
        solicitud = entrega.SolicitudEntrega(
            admision=adm,
            instalacion=self.raiz,
            sha256_admision=self.ref(adm.validacion_destino).sha256,
            area=self.raiz / "proyección pública",
            corte_utc=self.solicitud.corte_utc,
        )
        with patch.object(registro.vigencia, "evaluar_vigencia", side_effect=AssertionError("No reevaluar")):
            entrega.preparar(solicitud)
            entrega.validar(solicitud)
            destino = entrega.exportar(solicitud, destino=self.raiz / "publico" / "catalogo-cursos.json")
            publico = json.loads(destino.read_bytes())
            self.assertEqual(len(publico["ofertas"]), 1)
            self.assertEqual(publico["ofertas"][0]["unidad"]["tipo"], "recurso")
            self.assertEqual(publico["ofertas"][0]["comprobado_el"], "2026-10-23T02:07:20.814607Z")
            pasada = replace(solicitud, area=self.raiz / "proyección pasada", corte_utc="2026-10-24T02:07:20.814607Z")
            entrega.preparar(pasada)
            entrega.validar(pasada)
            tardio = entrega.exportar(pasada, destino=self.raiz / "pasada" / "catalogo-cursos.json")
            ofertas = json.loads(tardio.read_bytes())["ofertas"]
            self.assertEqual(len(ofertas), 1)
            self.assertEqual(ofertas[0]["comprobado_el"], "2026-10-23T02:07:20.814607Z")
            self.assertEqual(ofertas[0]["corte_evaluacion_utc"], publico["ofertas"][0]["corte_evaluacion_utc"])
            self.assertNotIn("vence_el", ofertas[0])
        self.assertNotIn(str(self.raiz), destino.read_text())
        self.assertNotIn("soporte_acceso", destino.read_text())

    def test_captura_antigua_y_corte_distinto_no_reutilizan_preparacion(self) -> None:
        """Rechaza retroceso sin alterar el origen ni promover un directorio parcial."""
        hp.preparar(self.solicitud)
        anterior = self.solicitud.area / "catalogo.sqlite3"
        bytes_antes = anterior.read_bytes()
        vieja = self.guardar_recepcion(cambio=True, fecha="2026-10-23T02:07:19Z")
        siguiente = self.siguiente(vieja)
        with self.assertRaises(catalogo.ErrorTemporal):
            hp.preparar(siguiente)
        self.assertFalse(siguiente.area.exists())
        self.assertEqual(anterior.read_bytes(), bytes_antes)
        with self.assertRaisesRegex(hp.lector.ErrorFichaHpLife, "otra preparación"):
            hp.preparar(replace(self.solicitud, corte_utc="2026-10-23T04:00:00Z"))
