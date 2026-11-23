"""SQLite Ciber aislada: atribución, admisión y decisiones sin tocar datos reales."""

import hashlib
import json
import sqlite3
import unittest
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, entrega_catalogo, politicas_vigencia, registro_vigencia
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, metodo_interfaz
from plataforma_datos.cursos.pruebas import test_ciber_adquisicion as recepciones


class ActualizacionCiberPruebas(unittest.TestCase):
    """Usa SQLite y admisión productivas; solo las pruebas remotas son sintéticas."""

    def setUp(self) -> None:
        """Crea una unidad admitida con ancla histórica sin contrato de atribución."""
        self.rx = recepciones.AdquisicionCiberPruebas()
        self.rx.setUp()
        self.addCleanup(self.rx.doCleanups)
        self.raiz = self.rx.original
        self.base = self.raiz / "entrada.sqlite3"
        self.slug = "diseño-@curso"
        material = {
            "id": 20,
            "title": "Curso  ejemplo\t",
            "slug": self.slug,
            "type": "Autoformación",
            "status": "Disponible",
            "erased": False,
            "lang": "Español",
            "aprenderContent": "<li>Una capacidad</li>",
            "paraTiContent": "<li>Quieres aprender</li>",
            "moodleLink": "https://e-learning.cibervoluntarios.org/course/view.php?id=20",
        }
        cuerpo = json.dumps(
            {
                "hydra:totalItems": 1,
                "hydra:member": [
                    {"id": 10, "title": "Actividad", "type": "Taller", "activityCatalogMaterials": [material]}
                ],
            }
        ).encode()
        self.fila = self.rx.captura(adquisicion.url_pagina(1), cuerpo)
        self.material = adquisicion.materiales(self.raiz, self.fila)[0]
        prueba = {
            "url": self.material.captura.url,
            "capturado_utc": "2026-10-22T18:20:10Z",
            "sha256": self.fila["cuerpo"]["sha256"],
            "archivo": self.fila["cuerpo"]["archivo"],
        }
        self.programa = {
            "id": "cibervoluntarios:material:20",
            "proveedor_id": "cibervoluntarios",
            "titulo": "Curso ejemplo",
            "url": "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/"
            + quote(self.slug, safe=""),
            "tipo_unidad": "material_autoformacion",
            "datos": {
                "identidad_fuente": {"material_id": 20, "actividad_id": 10, "slug": self.slug},
                "material_publicado": self.material.material_publicado,
                "actividad_publicada": self.material.actividad_publicada,
                "soporte_acceso": {"url_api": prueba["url"], "recibido_utc": prueba["capturado_utc"]},
                "campo_ajeno": {"desconocido": None},
            },
        }
        lote = ciber._lote(self.programa, [prueba], prueba["capturado_utc"])
        lote["proveedores"] = [
            {"id": "cibervoluntarios", "nombre": "Fuente sintética", "naturaleza": None, "territorio": None}
        ]
        canal = {"entidad": "programa", "id": self.programa["id"], "canal": "captura-historica", "evidencias": [prueba]}
        catalogo.cargar_lote(self.base, lote, True, self.raiz, canales_temporales=[canal])
        indice = self.raiz / "indice.json"
        guardar_json(
            indice,
            {"schema_version": 1, "archivos_conservados": [{"archivo": prueba["archivo"], "sha256": prueba["sha256"]}]},
        )
        self.solicitud = admision.SolicitudAdmision(
            snapshot=self.ref(self.base),
            procedencia={"captura": self.ref(indice)},
            indices_evidencias={"captura-ciber": admision.IndiceEvidencias(archivo=self.ref(indice), raiz=self.raiz)},
            validacion_destino=self.raiz / "validacion.json",
        )
        admision.admitir_snapshot(self.solicitud)
        self.conjunto = self.rx.calcular([self.fila])
        self.entrada = almacen.EntradaCatalogo(
            admision=self.solicitud, sha256_admision=self.ref(self.solicitud.validacion_destino).sha256
        )
        politica = Path(ciber.__file__).with_name("politica_vigencia_v2.json")
        self.parche_politica = patch.dict(
            politicas_vigencia.POLITICAS,
            {
                ("cibervoluntarios", "2"): (
                    "fuentes/cibervoluntarios/politica_vigencia_v2.json",
                    self.ref(politica).sha256,
                )
            },
        )
        self.parche_politica.start()
        self.addCleanup(self.parche_politica.stop)

    def ref(self, ruta: Path) -> admision.ReferenciaArchivo:
        """Devuelve referencia exacta de una entrada propia.

        Returns:
            Ruta regular y SHA de sus bytes presentes.
        """
        return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

    def test_aplica_y_admite_conservando_identidad_y_campos_ajenos(self) -> None:
        """La interfaz sintética no revisada queda sin oferta, aunque el censo sea correcto."""
        huella = self.ref(self.base).sha256
        destino = self.raiz / "salida"
        ciber.aplicar(
            self.entrada, conjunto=self.conjunto, original=self.raiz, destino=destino, corte="2026-10-23T18:30:00Z"
        )
        self.assertEqual(self.ref(self.base).sha256, huella)
        programa = ciber._programas(destino / "catalogo.sqlite3")[0]
        for campo in ("id", "proveedor_id", "url", "titulo", "tipo_unidad"):
            self.assertEqual(programa[campo], self.programa[campo])
        self.assertEqual(programa["datos"]["campo_ajeno"], {"desconocido": None})
        self.assertEqual(programa["datos"]["material_publicado"]["title"], "Curso  ejemplo\t")
        estado = registro_vigencia.consultar_unidad(destino / "catalogo.sqlite3", tipo="recurso", id=programa["id"])
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "sin-confirmar")
        admision.exigir_snapshot_admitido(
            almacen.solicitud(destino),
            sha256_validacion=hashlib.sha256((destino / "validacion.json").read_bytes()).hexdigest(),
        )

    def test_replay_misma_recepcion_no_crea_observacion_ni_version_nativa(self) -> None:
        """La nueva candidata conserva los hechos/fechas; no fabrica consultas remotas."""
        primera = self.raiz / "primera"
        ciber.aplicar(
            self.entrada, conjunto=self.conjunto, original=self.raiz, destino=primera, corte="2026-10-23T18:30:00Z"
        )
        solicitud = almacen.solicitud(primera)
        entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        segunda = self.raiz / "segunda"
        ciber.aplicar(
            entrada, conjunto=self.conjunto, original=self.raiz, destino=segunda, corte="2026-10-23T18:30:00Z"
        )
        for tabla in ("observaciones_vigencia", "canales_temporales", "versiones", "observaciones"):
            with sqlite3.connect(primera / "catalogo.sqlite3") as a, sqlite3.connect(segunda / "catalogo.sqlite3") as b:
                self.assertEqual(
                    a.execute("SELECT count(*) FROM " + tabla).fetchone(),
                    b.execute("SELECT count(*) FROM " + tabla).fetchone(),
                    tabla,
                )
        id = self.programa["id"]
        anterior = registro_vigencia.consultar_unidad(primera / "catalogo.sqlite3", tipo="recurso", id=id)
        posterior = registro_vigencia.consultar_unidad(segunda / "catalogo.sqlite3", tipo="recurso", id=id)
        self.assertEqual(anterior["evaluacion"], posterior["evaluacion"])

    def test_procesa_la_ausencia_o_el_cambio_de_ruta_una_vez_por_recepcion(self) -> None:
        """Un nuevo censo se vuelve a leer, repetir el mismo no renueva las unidades pendientes."""
        datos = json.loads((self.raiz / self.fila["cuerpo"]["archivo"]).read_bytes())
        datos["hydra:member"][0]["activityCatalogMaterials"][0]["slug"] = "ruta-nueva"
        modificada = self.rx.captura(adquisicion.url_pagina(1), json.dumps(datos).encode())
        for indice, captura in enumerate((self.rx.pagina(1, [1], 1), modificada)):
            conjunto = self.rx.calcular([captura])
            destino = self.raiz / f"censo-{indice}"
            control = ciber.aplicar(
                self.entrada, conjunto=conjunto, original=self.raiz, destino=destino, corte="2026-10-23T18:30:00Z"
            )
            self.assertEqual(control["aplicados_por_fuente"].get("cibervoluntarios"), ciber.firma(conjunto))
            estado = registro_vigencia.consultar_unidad(
                destino / "catalogo.sqlite3", tipo="recurso", id=self.programa["id"]
            )
            self.assertIsNone(estado["evaluacion"])

    def test_ancla_de_titulo_visible_y_url_codificada_se_conserva(self) -> None:
        """Equivalencia solo de la representación ya usada, sin fusionar identidades."""
        seleccionado = ciber.seleccionar_material_del_programa(
            self.programa, {20: (self.material, self.fila)}, {20}, {}
        )
        self.assertEqual(seleccionado, (self.material, self.fila))
        self.assertEqual(ciber.titulo_visible(self.material), self.programa["titulo"])
        with sqlite3.connect(self.base) as conexion:
            conexion.row_factory = sqlite3.Row
            canales = ciber._canales(conexion, self.programa["id"])
        self.assertIsNotNone(ciber._ancla(self.programa, canales, self.raiz))
        alterada = replace(self.material, slug="otra-identidad")
        self.assertEqual(
            ciber.seleccionar_material_del_programa(self.programa, {20: (alterada, self.fila)}, {20}, {}),
            "ruta_actual_distinta_requiere_revision_de_identidad",
        )

    def test_ruta_registrada_resuelve_la_edicion_espanola(self) -> None:
        """El buscador identifica la misma actividad, el material elegido por el visor y su Moodle."""
        aux = self.rx.auxiliares
        revisado = patch.multiple(
            metodo_interfaz,
            VERSIONES_REVISADAS={(aux["declaraciones"]["cuerpo"]["sha256"], aux["componente"]["cuerpo"]["sha256"])},
            IDIOMA_SHA256=aux["idioma"]["cuerpo"]["sha256"],
        )
        revisado.start()
        self.addCleanup(revisado.stop)
        nativo = json.loads((self.raiz / self.fila["cuerpo"]["archivo"]).read_bytes())
        actividad = nativo["hydra:member"][0]
        actividad.update(status="Disponible", erased=False)
        material = actividad["activityCatalogMaterials"][0]
        material["slug"] = "diseño-nuevo"
        actividad["activityCatalogMaterials"].append({**material, "id": 29, "slug": self.slug, "type": "Formación"})
        pagina = self.rx.captura(adquisicion.url_pagina(1), json.dumps(nativo).encode())
        consulta = adquisicion.API + "?activityCatalogMaterials.slug=" + quote(self.slug, safe="") + "&lang=es"
        respuesta = self.rx.captura(consulta, json.dumps(nativo).encode())
        with patch.object(adquisicion.comun, "recibir_url", return_value=respuesta) as recibir:
            self.assertEqual(adquisicion._consultar_rutas(self.raiz, [self.fila], [self.programa]), {})
            recibir.assert_not_called()
            self.rx.auxiliares.update(adquisicion._consultar_rutas(self.raiz, [pagina], [self.programa]))
            recibir.assert_called_once_with(
                consulta,
                self.raiz,
                self.programa["id"],
                perfil="datos",
                tipo_respuesta="application/ld+json",
                seguir_redirecciones=False,
            )
        conjunto = self.rx.calcular([pagina])
        destino = self.raiz / "ruta-acreditada"
        ciber.aplicar(
            self.entrada, conjunto=conjunto, original=self.raiz, destino=destino, corte="2026-10-23T18:30:00Z"
        )
        base = destino / "catalogo.sqlite3"
        evaluacion = registro_vigencia.consultar_unidad(base, tipo="recurso", id=self.programa["id"])["evaluacion"]
        self.assertEqual(evaluacion["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(evaluacion["entradas"]["oferta"]["url"], self.programa["url"])
        self.assertTrue(
            any(e["url"] == consulta for o in evaluacion["entradas"]["observaciones"] for e in o["evidencias"])
        )
        solicitud = almacen.solicitud(destino)
        _, publico = entrega_catalogo._proyectar(
            entrega_catalogo.SolicitudEntrega(
                admision=solicitud,
                instalacion=self.raiz,
                sha256_admision=self.ref(solicitud.validacion_destino).sha256,
                area=self.raiz / "entrega",
                corte_utc="2026-10-23T18:30:00Z",
            )
        )
        self.assertEqual(
            [o["url"] for o in publico["ofertas"] if o["unidad"]["id"] == self.programa["id"]], [self.programa["url"]]
        )
        for campo, valor in (
            ("id", 65),
            ("moodleLink", "https://e-learning.cibervoluntarios.org/course/view.php?id=65"),
        ):
            with self.subTest(campo=campo):
                falsa = deepcopy(nativo)
                falsa["hydra:member"][0]["activityCatalogMaterials"][0][campo] = valor
                self.rx.auxiliares["ruta:20"] = self.rx.captura(consulta, json.dumps(falsa).encode())
                ctx = ciber.puente.contexto(self.raiz, self.rx.auxiliares)
                materiales, seleccionados = ciber.leer_materiales_del_intento(self.raiz, conjunto)
                self.assertEqual(
                    ciber.seleccionar_material_del_programa(self.programa, materiales, seleccionados, ctx),
                    "ruta_actual_distinta_requiere_revision_de_identidad",
                )
        for respuesta in (
            {**nativo, "hydra:totalItems": 2},
            {**nativo, "hydra:member": [actividad, actividad]},
            {**nativo, "hydra:member": [{**actividad, "activityCatalogMaterials": [material, {**material, "id": 27}]}]},
            {**nativo, "hydra:member": [{**actividad, "erased": True}]},
        ):
            with self.subTest(respuesta=respuesta):
                captura = self.rx.captura(consulta, json.dumps(respuesta).encode())
                self.assertIsNone(adquisicion.rutas_publicas.leer(self.raiz, captura))

    def test_alias_inicia_confirmacion_actual_sin_cambiar_negocio_historico(self) -> None:
        """La prueba directa no finge un original Fundae ausente ni reimporta negocio."""
        alias = {
            "id": "fundae:1:3462",
            "proveedor_id": "fundae:publicador:catalogo:1",
            "titulo": "Curso del publicador",
            "tipo_unidad": "recurso_catalogo_tipo_curso",
            "url": adquisicion.ALIAS_FUNDAE,
            "datos": {
                "id_recurso_fuente": 3462,
                "id_catalogo_fuente": 1,
                "estado_inscripcion": "disponible-publicamente",
                "restricciones_colectivo": "Declaración antigua",
            },
        }
        historica = self.raiz / "historica-fundae.body"
        historica.write_bytes(b'{"recurso":3462}')
        prueba = {
            "url": "https://agora.fundae.es/catalogo",
            "capturado_utc": "2026-10-22T18:00:00Z",
            "sha256": self.ref(historica).sha256,
            "archivo": historica.name,
        }
        lote = ciber._lote(alias, [prueba], prueba["capturado_utc"])
        lote["proveedores"] = [
            {"id": alias["proveedor_id"], "nombre": "Publicador sintético", "naturaleza": None, "territorio": None}
        ]
        catalogo.cargar_lote(self.base, lote, True, self.raiz)
        historica.unlink()
        self.solicitud = replace(self.solicitud, snapshot=self.ref(self.base))
        admision.admitir_snapshot(self.solicitud)
        entrada = almacen.EntradaCatalogo(
            admision=self.solicitud, sha256_admision=self.ref(self.solicitud.validacion_destino).sha256
        )
        nativo = {**self.material.material_publicado, "id": self.material.id, "slug": self.slug}
        directo = {
            **nativo,
            "id": ciber.control_actual.MATERIAL_ALIAS_FUNDAE,
            "slug": "introduccion-comercio-electronico",
        }
        cuerpo = json.dumps(
            {
                "hydra:totalItems": 2,
                "hydra:member": [
                    {"id": 10, "title": "Actividad", "type": "Taller", "activityCatalogMaterials": [nativo]},
                    {"id": 11, "activityCatalogMaterials": [directo]},
                ],
            }
        ).encode()
        fila = self.rx.captura(adquisicion.url_pagina(1), cuerpo)
        portada = (self.raiz / self.rx.auxiliares["portada"]["cuerpo"]["archivo"]).read_bytes()
        self.rx.auxiliares["alias"] = self.rx.captura(
            adquisicion.ALIAS_FUNDAE,
            portada,
            final="https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/introduccion-comercio-electronico?origin=fundae",
        )
        conjunto = self.rx.calcular([fila])
        destino = self.raiz / "alias-confirmado"
        ciber.aplicar(entrada, conjunto=conjunto, original=self.raiz, destino=destino, corte="2026-10-23T18:30:00Z")
        actual = next(p for p in ciber._programas(destino / "catalogo.sqlite3") if p["id"] == alias["id"])
        self.assertEqual(actual, alias)
        estado = registro_vigencia.consultar_unidad(destino / "catalogo.sqlite3", tipo="recurso", id=alias["id"])
        self.assertEqual(estado["evaluacion"]["entradas"]["oferta"]["fuente_id"], "cibervoluntarios")
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "sin-confirmar")
        with sqlite3.connect(destino / "catalogo.sqlite3") as conexion:
            self.assertEqual(
                conexion.execute(
                    "SELECT count(*) FROM canales_temporales WHERE entidad_id=?", (alias["id"],)
                ).fetchone()[0],
                0,
            )
            self.assertIsNone(
                conexion.execute(
                    "SELECT id FROM programas WHERE id=?",
                    ("cibervoluntarios:material:" + str(ciber.control_actual.MATERIAL_ALIAS_FUNDAE),),
                ).fetchone()
            )

    def test_alta_nueva_admision_publicacion_y_replay_sin_duplicar(self) -> None:
        """Ciclo completo con capturas sintéticas declaradas y revisión del fixture explícita."""
        nativo = {**self.material.material_publicado, "id": 20, "slug": self.slug}
        nuevo = {**nativo, "id": 21, "slug": "curso-nuevo", "title": "Avanzado Python y automatización"}
        familiar = {**nuevo, "id": 22, "slug": "para-familias", "paraTiContent": "<li>Convives con menores.</li>"}
        otro = {**nuevo, "id": 23, "slug": "otra-modalidad", "type": "Formación"}
        desconocido = {**nuevo, "id": 24, "slug": "desconocido", "paraTiContent": None}
        cuerpo = json.dumps(
            {
                "hydra:totalItems": 5,
                "hydra:member": [
                    {"id": 10 + i, "title": "Actividad", "type": "Taller", "activityCatalogMaterials": [m]}
                    for i, m in enumerate((nativo, nuevo, familiar, otro, desconocido))
                ],
            }
        ).encode()
        conjunto = self.rx.calcular([self.rx.captura(adquisicion.url_pagina(1), cuerpo)])
        aux = self.rx.auxiliares
        # Solo se revisa el código sintético del fixture. No cambia el mecanismo
        # de validación, admisión o selección de oferta de la aplicación.
        with patch.multiple(
            metodo_interfaz,
            VERSIONES_REVISADAS={(aux["declaraciones"]["cuerpo"]["sha256"], aux["componente"]["cuerpo"]["sha256"])},
            IDIOMA_SHA256=aux["idioma"]["cuerpo"]["sha256"],
        ):
            destino = self.raiz / "alta"
            control = ciber.aplicar(
                self.entrada, conjunto=conjunto, original=self.raiz, destino=destino, corte="2026-10-23T18:30:00Z"
            )
            self.assertEqual(control["aplicados_por_fuente"].get("cibervoluntarios"), ciber.firma(conjunto))
            solicitud = almacen.solicitud(destino)
            entrega = entrega_catalogo.SolicitudEntrega(
                admision=solicitud,
                instalacion=self.raiz,
                sha256_admision=self.ref(solicitud.validacion_destino).sha256,
                area=self.raiz / "entrega",
                corte_utc="2026-10-23T18:30:00Z",
            )
            _, publico = entrega_catalogo._proyectar(entrega)
            ofertas = {o["unidad"]["id"]: o for o in publico["ofertas"]}
            self.assertIn("cibervoluntarios:material:21", ofertas)
            self.assertIsNone(ofertas["cibervoluntarios:material:21"]["hechos"]["nivel_entrada"]["valor"])
            self.assertIsNone(ofertas["cibervoluntarios:material:21"]["hechos"]["marca_comercial"]["valor"])
            with sqlite3.connect(destino / "catalogo.sqlite3") as conexion:
                ids = {r[0] for r in conexion.execute("SELECT id FROM programas")}
            self.assertEqual(ids, {"cibervoluntarios:material:20", "cibervoluntarios:material:21"})
            referencias = {
                r["sha256"]: admision.ReferenciaArchivo(ruta=destino / r["archivo"], sha256=r["sha256"])
                for r in control["archivos_conservados"]
            }
            recibo = almacen.leer_documento_indexado(
                referencias[control["procedencia"]["recibo-ciber"]["sha256"]], referencias
            )
            rechazadas = {r["id"]: r["pendiente"] for r in recibo["resultados"] if r.get("alta") is False}
            self.assertIn("destinatarios_constatados", rechazadas["cibervoluntarios:material:22"])
            self.assertEqual(rechazadas["cibervoluntarios:material:23"], "tipo_material_fuera_de_autoformacion")
            self.assertIn("destinatarios_constatados", rechazadas["cibervoluntarios:material:24"])
            segunda = self.raiz / "alta-repetida"
            ciber.aplicar(
                almacen.EntradaCatalogo(
                    admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
                ),
                conjunto=conjunto,
                original=self.raiz,
                destino=segunda,
                corte="2026-10-23T18:30:00Z",
            )
            with sqlite3.connect(segunda / "catalogo.sqlite3") as conexion:
                self.assertEqual(
                    conexion.execute(
                        "SELECT count(*) FROM programas WHERE id='cibervoluntarios:material:21'"
                    ).fetchone()[0],
                    1,
                )
            primero = registro_vigencia.consultar_unidad(
                destino / "catalogo.sqlite3", tipo="recurso", id="cibervoluntarios:material:21"
            )
            repetido = registro_vigencia.consultar_unidad(
                segunda / "catalogo.sqlite3", tipo="recurso", id="cibervoluntarios:material:21"
            )
            self.assertEqual(primero["evaluacion"], repetido["evaluacion"])

    def test_codigo_distinto_no_hereda_revision(self) -> None:
        """El método estático no se acredita por contener las palabras correctas."""
        self.assertFalse(
            metodo_interfaz.confirmado(
                "Autoformación Disponible".encode(), 'es:"Español"'.encode(), "https://ejemplo.test/main.js", b""
            )
        )


if __name__ == "__main__":
    unittest.main()
