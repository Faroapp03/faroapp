"""Ciclos Cibervoluntarios sin red: una página caída del censo no anula lo visto ni retira lo no visto.

Recorren las piezas reales encadenadas: recepción, procedencia, admisión de la fuente,
registro de vigencia, entrega pública y panel privado. Cada página trae un material.
"""

import hashlib
import json
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, recibos_compartidos
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, metodo_interfaz
from plataforma_datos.cursos.fuentes.cibervoluntarios import declaraciones_publicadas as declaraciones
from plataforma_datos.cursos.pruebas.ayuda_panel_copia import InstalacionConPanel
from plataforma_datos.cursos.pruebas.test_ciber_adquisicion import codigo_publicado
from plataforma_datos.cursos.recepciones_catalogo import json_bytes

RUTA = "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/"
MODULO = "https://frontend.cibervoluntarios.org/vite/assets/main-ejemplo.js"
COMPONENTE = "https://frontend.cibervoluntarios.org/vite/assets/TrainingCourseView-fixture.js"
IDIOMA = "https://frontend.cibervoluntarios.org/vite/assets/useCatalogMaterialByLocale-fixture.js"
PORTADA = ('<html><head><script type="module" src="' + MODULO + '"></script></head><body></body></html>').encode()
# Material de cada página: (actividad, material, ruta publicada).
PAGINAS = {1: (10, 20, "curso-uno"), 2: (11, 21, "curso-dos")}
PRIMERA, SEGUNDA = ("cibervoluntarios:material:" + str(m) for _a, m, _s in PAGINAS.values())
FAMILIAR = "<li>Si eres padre o madre</li>"


def _material(pagina: int, para_ti: str = "<li>Quieres aprender</li>", *, borrado: bool = False) -> dict:
    _actividad, id, slug = PAGINAS[pagina]
    return {
        "id": id,
        "title": "Curso " + slug,
        "slug": slug,
        "type": "Autoformación",
        "status": "Disponible",
        "erased": borrado,
        "lang": "Español",
        "aprenderContent": "<li>Una capacidad</li>",
        "paraTiContent": para_ti,
        "moodleLink": "https://e-learning.cibervoluntarios.org/course/view.php?id=" + str(id),
    }


def _cuerpo_pagina(pagina: int, para_ti: str | None = None, *, total: int = len(PAGINAS), borrado: str = "") -> bytes:
    """Cuerpo Hydra de una página.

    `borrado` es «material» o «actividad» si el proveedor la declara borrada, o el estado que declara en lugar de
    Disponible: «descatalogado», «pendiente» o «actividad-descatalogada».

    Returns:
        Bytes JSON de la página.
    """
    material = _material(pagina) if para_ti is None else _material(pagina, para_ti)
    estado = {
        "descatalogado": "Descatalogado",
        "pendiente": "Pendiente",
        "minuscula": "disponible",
        "archivado": "Archivado",
    }.get(borrado, "Disponible")
    material = {**material, "erased": borrado == "material", "status": estado}
    if borrado == "titulo-corregido":
        material["title"] = "Título corregido"
    actividad = {
        "id": PAGINAS[pagina][0],
        "title": "Actividad",
        "type": "Taller",
        "erased": borrado == "actividad",
        "status": "Descatalogado" if borrado == "actividad-descatalogada" else "Disponible",
    }
    return json.dumps(
        {"hydra:totalItems": total, "hydra:member": [{**actividad, "activityCatalogMaterials": [material]}]}
    ).encode()


def _captura(carpeta: Path, url: str, cuerpo: bytes, fecha: str) -> dict:
    """Conserva una recepción histórica íntegra, con el formato de recibo común.

    Returns:
        Fila de captura con cuerpo, recibo y metadatos verificables.
    """
    sha = hashlib.sha256(cuerpo).hexdigest()
    (carpeta / (sha + ".body")).write_bytes(cuerpo)
    meta = {
        "url": url,
        "url_final": url,
        "http": 200,
        "completo": True,
        "cuerpo_sha256": sha,
        "bytes": len(cuerpo),
        "inicio_utc": fecha,
        "fin_utc": fecha,
    }
    estable, evento = recibos_compartidos.separar(json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    refs = {}
    for clave, contenido in (("metadatos", estable), ("recibo", evento)):
        sha_meta = hashlib.sha256(contenido).hexdigest()
        (carpeta / (sha_meta + ".json")).write_bytes(contenido)
        refs[clave] = {"archivo": sha_meta + ".json", "sha256": sha_meta}
    return {"id": None, "cuerpo": {"archivo": sha + ".body", "sha256": sha}, **refs, "intento": refs["recibo"]}


def _ref(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())


class InstalacionCiber(InstalacionConPanel, unittest.TestCase):
    """Instalación sintética con dos materiales admitidos y un transporte falso; ninguna consulta sale a la red."""

    TIPO_OBSERVADO = "recurso"

    def setUp(self) -> None:
        """Instala dos materiales admitidos, uno por página, anclados a su captura del 23/10 a las 18:00."""
        temporal = tempfile.TemporaryDirectory(prefix="Ciber páginas Año ")
        self.addCleanup(temporal.cleanup)
        self.trabajo = Path(temporal.name)
        self.raiz = self.trabajo / "Instalación ñ"
        # Ninguna consulta puede salir a la red, aunque un parche de transporte falle.
        for parche in (
            patch.object(red, "descargar_url", side_effect=AssertionError("sin red")),
            patch.object(adquisicion, "TAMANO_PAGINA", 1),
        ):
            parche.start()
            self.addCleanup(parche.stop)
        evidencias = self.trabajo / "evidencias"
        evidencias.mkdir()
        base = self.trabajo / "entrada.sqlite3"
        programas, canales, archivos = [], [], []
        for numero, (actividad, id, slug) in PAGINAS.items():
            fila = _captura(evidencias, adquisicion.url_pagina(numero), _cuerpo_pagina(numero), "2026-10-23T18:00:00Z")
            material = adquisicion.materiales(evidencias, fila)[0]
            prueba = {
                "url": adquisicion.url_pagina(numero),
                "capturado_utc": "2026-10-23T18:00:00Z",
                "sha256": fila["cuerpo"]["sha256"],
                "archivo": fila["cuerpo"]["archivo"],
            }
            programa = {
                "id": "cibervoluntarios:material:" + str(id),
                "proveedor_id": "cibervoluntarios",
                "titulo": ciber.titulo_visible(material),
                "url": RUTA + quote(slug, safe=""),
                "tipo_unidad": "material_autoformacion",
                "datos": {
                    "identidad_fuente": {"material_id": id, "actividad_id": actividad, "slug": slug},
                    "material_publicado": material.material_publicado,
                    "actividad_publicada": material.actividad_publicada,
                    "soporte_acceso": {"url_api": prueba["url"], "recibido_utc": prueba["capturado_utc"]},
                },
            }
            programas.append({**programa, "etiquetas": [], "evidencias": [prueba]})
            canales.append(
                {"entidad": "programa", "id": programa["id"], "canal": "captura-historica", "evidencias": [prueba]}
            )
            archivos.append({"archivo": prueba["archivo"], "sha256": prueba["sha256"]})
        lote = {
            "schema_version": 1,
            "observado_utc": "2026-10-23T18:00:00Z",
            "fuente_lote": "cibervoluntarios:material:1",
            "proveedores": [
                {"id": "cibervoluntarios", "nombre": "Fuente sintética", "naturaleza": None, "territorio": None}
            ],
            "programas": programas,
            "ediciones": [],
        }
        catalogo.cargar_lote(base, lote, True, evidencias, canales_temporales=canales)
        indice = self.trabajo / "indice.json"
        guardar_json(indice, {"schema_version": 1, "archivos_conservados": archivos})
        solicitud = admision.SolicitudAdmision(
            snapshot=_ref(base),
            procedencia={"captura": _ref(indice)},
            indices_evidencias={"captura-ciber": admision.IndiceEvidencias(archivo=_ref(indice), raiz=evidencias)},
            validacion_destino=self.trabajo / "validacion.json",
        )
        admision.admitir_snapshot(solicitud)
        almacen.conservar(
            almacen.EntradaCatalogo(admision=solicitud, sha256_admision=_ref(solicitud.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        # El método de interfaz sintético no es el revisado; se acepta para que la oferta llegue a la entrega.
        metodo = patch.object(metodo_interfaz, "confirmado", return_value=True)
        metodo.start()
        self.addCleanup(metodo.stop)

    # -- Ciclo real -------------------------------------------------------------------------------------------------

    def consultar_fuente(
        self,
        hora: str,
        paginas: dict[int, str | int | None],
        *,
        total: int = len(PAGINAS),
        destinos: Callable[[str, str, str], transporte.RespuestaCatalogo] | None = None,
    ) -> bool:
        """Recibe, prepara y admite Ciber con un transporte falso.

        Cada página responde «normal», «familiar» (destinatario contrario), «borrado» o «actividad-borrada»
        (el proveedor la declara borrada), None (sin respuesta) o un código HTTP de fallo con cuerpo. `total` es el
        total de actividades que declara el censo. `destinos` responde (dirección, inicio, fin) a las consultas del
        destino de un material que falta.

        Returns:
            Si la recepción terminó sin fallo total.
        """
        self.destinos_pedidos = []
        fijos = {
            declaraciones.PORTADA: (PORTADA, "text/html"),
            adquisicion.ALIAS_FUNDAE: (PORTADA, "text/html"),
            MODULO: (codigo_publicado(), "text/javascript"),
            COMPONENTE: (
                b'import{x}from"./main-ejemplo.js";import{u}from"./useCatalogMaterialByLocale-fixture.js";',
                "text/javascript",
            ),
            IDIOMA: (b"export{};", "text/javascript"),
        }

        def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
            inicio, fin = f"2026-10-23T{hora}:00+00:00", f"2026-10-23T{hora}:01+00:00"
            if url.startswith("https://e-learning.cibervoluntarios.org/"):
                self.destinos_pedidos.append((url, _opciones))
                return destinos(url, inicio, fin)
            if url in fijos:
                cuerpo, tipo = fijos[url]
            else:
                numero = next(n for n in PAGINAS if adquisicion.url_pagina(n) == url)
                estado = paginas[numero]
                if estado is None:
                    return transporte.RespuestaCatalogo(
                        url=url, inicio_utc=inicio, fin_utc=fin, cuerpo=None, error="timeout"
                    )
                if type(estado) is int:
                    return transporte.RespuestaCatalogo(
                        url=url,
                        inicio_utc=inicio,
                        fin_utc=fin,
                        cuerpo=b"Servicio no disponible",
                        url_final=url,
                        http=estado,
                        completo=True,
                        content_type="text/plain",
                    )
                cuerpo = _cuerpo_pagina(
                    numero,
                    FAMILIAR if estado == "familiar" else None,
                    total=total,
                    borrado={"borrado": "material", "actividad-borrada": "actividad"}.get(estado, estado),
                )
                tipo = "application/ld+json"
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
                fuente.descargar("cibervoluntarios", raiz=self.raiz)
            except FormatoInesperado:
                return False
            fuente.preparar("cibervoluntarios", raiz=self.raiz)
            fuente.validar("cibervoluntarios", raiz=self.raiz)
        return True

    def componer(self, corte: str) -> dict:
        """Compone e instala el catálogo como lo hace un paquete en verde.

        Returns:
            Ofertas públicas por URL.
        """
        with patch.object(fuente, "consultar", side_effect=AssertionError("sin red")):
            resultado = componer.componer(raiz=self.raiz, corte_utc=corte)
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        return {o["url"]: o for o in dto["ofertas"]}

    @staticmethod
    def url(id: str) -> str:
        """Devuelve la URL publicada de la unidad.

        Returns:
            URL de la ficha pública del material.
        """
        return next(RUTA + quote(s, safe="") for _a, m, s in PAGINAS.values() if id.endswith(":" + str(m)))


class PaginasFallidasCiberPruebas(InstalacionCiber):
    """Una página caída del censo no anula lo visto ni retira lo no visto."""

    def test_visor_desconocido_con_un_cambio_de_titulo_conserva_ficha_y_precio(self) -> None:
        """El título nuevo se incorpora cuando el acceso vuelve a poder comprobarse."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        url = self.url(PRIMERA)
        anterior = self.componer("2026-10-23T19:30:00Z")[url]
        with (
            patch(__name__ + ".codigo_publicado", return_value=codigo_publicado() + b"/*visor nuevo*/"),
            patch.object(metodo_interfaz, "confirmado", side_effect=lambda _c, _i, _u, js: b"visor nuevo" not in js),
        ):
            self.consultar_fuente("20:00", {1: "titulo-corregido", 2: "normal"})
            actual = self.componer("2026-10-23T20:30:00Z")[url]
        self.assertEqual(actual["hechos"], anterior["hechos"])
        self.assertEqual(actual["titulo_programa"], anterior["titulo_programa"])
        self.assertEqual(actual["comprobado_el"], anterior["comprobado_el"])
        intento = self.panel("2026-10-23T20:30:00Z")[PRIMERA]["ultimoIntentoFallidoEl"]
        self.assertEqual(intento, "2026-10-23T20:00:01Z")
        self.consultar_fuente("21:00", {1: "titulo-corregido", 2: "normal"})
        verificada = self.componer("2026-10-23T21:30:00Z")[url]
        self.assertEqual(verificada["titulo_programa"], "Título corregido")
        self.assertEqual(verificada["comprobado_el"], "2026-10-23T21:00:01Z")

    def test_interfaz_desconocida_conserva_la_oferta_y_respeta_una_contraindicacion(self) -> None:
        """Una actualización del visor permite seguir leyendo bajas, pero no renueva el acceso."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        antes = self.componer("2026-10-23T19:30:00Z")
        with (
            patch(__name__ + ".codigo_publicado", return_value=codigo_publicado() + b"/*visor nuevo*/"),
            patch.object(metodo_interfaz, "confirmado", side_effect=lambda _c, _i, _u, js: b"visor nuevo" not in js),
        ):
            self.consultar_fuente("20:00", {1: "normal", 2: "familiar"})
            actual = self.componer("2026-10-23T20:30:00Z")
        self.assertEqual(set(actual), {self.url(PRIMERA)})
        self.assertEqual(actual[self.url(PRIMERA)]["comprobado_el"], antes[self.url(PRIMERA)]["comprobado_el"])
        self.assertEqual(actual[self.url(PRIMERA)]["hechos"], antes[self.url(PRIMERA)]["hechos"])
        panel = self.panel("2026-10-23T20:30:00Z")
        self.assertEqual(panel[PRIMERA]["ultimoIntentoFallidoEl"], "2026-10-23T20:00:01Z")
        self.consultar_fuente("21:00", {1: "normal", 2: "normal"})
        recuperada = self.componer("2026-10-23T21:30:00Z")
        self.assertEqual(set(recuperada), set(antes))
        self.assertEqual(recuperada[self.url(PRIMERA)]["comprobado_el"], "2026-10-23T21:00:01Z")

    def test_pagina_caida_confirma_lo_visto_y_conserva_lo_no_visto(self) -> None:
        """Lo visto se confirma con su fecha; lo no visto conserva su confirmación y avisa del intento."""
        self.assertTrue(self.consultar_fuente("19:00", {1: "normal", 2: "normal"}))
        antes = self.componer("2026-10-23T19:30:00Z")
        self.assertTrue(self.consultar_fuente("20:00", {1: "normal", 2: None}))
        conjunto = fuente.leer_validado("cibervoluntarios", self.raiz)
        self.assertIs(conjunto["censo_completo"], False)
        self.assertNotIn("conocidos_ausentes", conjunto["censo"])
        self.assertEqual(
            conjunto["consulta_parcial"],
            {"unidades_fallidas": [SEGUNDA], "unidades_esperadas": 2, "paginas_fallidas": [2], "paginas_esperadas": 2},
        )
        dto = self.componer("2026-10-23T20:30:00Z")
        self.assertEqual(set(dto), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(dto[self.url(PRIMERA)]["comprobado_el"], "2026-10-23T20:00:01Z")
        self.assertEqual(dto[self.url(SEGUNDA)]["comprobado_el"], "2026-10-23T19:00:01Z")
        # Los hechos de la unidad no vista siguen siendo los de su última recepción válida.
        self.assertEqual(dto[self.url(SEGUNDA)]["hechos"], antes[self.url(SEGUNDA)]["hechos"])
        panel = self.panel("2026-10-23T20:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "disponible-publicamente")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T19:00:01Z")
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T20:00:01Z")
        self.assertEqual(panel[PRIMERA]["decision"], "disponible-publicamente")
        self.assertIsNone(panel[PRIMERA]["ultimoIntentoFallidoEl"])
        fallo = [o for o in self.observaciones(SEGUNDA) if o["resultado"] == "fallo"]
        self.assertEqual(len(fallo), 1)
        self.assertEqual(fallo[0]["detalle"], {"motivo": "pagina_del_censo_sin_respuesta_valida"})
        self.assertEqual(fallo[0]["url_consultada"], adquisicion.url_pagina(2))

    def test_respuesta_503_es_fallo_de_consulta_como_el_transporte(self) -> None:
        """Una página con cuerpo y código de fallo de consulta no se lee como censo ni anula la fuente."""
        self.assertTrue(self.consultar_fuente("19:00", {1: "normal", 2: "normal"}))
        self.componer("2026-10-23T19:30:00Z")
        for hora, codigo in (("20:00", 503), ("21:00", 429), ("22:00", 403)):
            self.assertTrue(self.consultar_fuente(hora, {1: "normal", 2: codigo}))
            self.assertEqual(
                fuente.leer_validado("cibervoluntarios", self.raiz)["consulta_parcial"]["paginas_fallidas"], [2]
            )
            dto = self.componer(f"2026-10-23T{hora[:2]}:30:00Z")
            self.assertEqual(dto[self.url(SEGUNDA)]["comprobado_el"], "2026-10-23T19:00:01Z")
            self.assertEqual(
                self.panel(f"2026-10-23T{hora[:2]}:30:00Z")[SEGUNDA]["ultimoIntentoFallidoEl"], f"2026-10-23T{hora}:01Z"
            )

    def test_confirmacion_fallo_y_recuperacion(self) -> None:
        """Tras el fallo, una respuesta válida renueva la fecha, retira el aviso y la consulta vuelve a ser completa."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        self.consultar_fuente("20:00", {1: "normal", 2: None})
        self.componer("2026-10-23T20:30:00Z")
        self.assertEqual(self.panel("2026-10-23T20:30:00Z")[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T20:00:01Z")
        self.assertTrue(self.consultar_fuente("21:00", {1: "normal", 2: "normal"}))
        conjunto = fuente.leer_validado("cibervoluntarios", self.raiz)
        self.assertIs(conjunto["censo_completo"], True)
        self.assertNotIn("consulta_parcial", conjunto)
        dto = self.componer("2026-10-23T21:30:00Z")
        self.assertEqual(dto[self.url(SEGUNDA)]["comprobado_el"], "2026-10-23T21:00:01Z")
        panel = self.panel("2026-10-23T21:30:00Z")
        self.assertIsNone(panel[SEGUNDA]["ultimoIntentoFallidoEl"])
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], "2026-10-23T21:00:01Z")

    def test_cierre_confirmado_y_fallo_posterior_no_resucita(self) -> None:
        """Un hecho contrario observado retira la oferta; una página caída después no la devuelve.

        La regla de oferta continua de esta fuente no tiene estado de cierre propio: un destinatario
        contrario deja la oferta sin confirmar, con evidencia, y fuera de la entrega pública.
        """
        self.assertTrue(self.consultar_fuente("19:00", {1: "normal", 2: "familiar"}))
        dto = self.componer("2026-10-23T19:30:00Z")
        self.assertNotIn(self.url(SEGUNDA), dto)
        cerrada = self.panel("2026-10-23T19:30:00Z")[SEGUNDA]
        self.assertEqual(cerrada["decision"], "sin-confirmar")
        self.assertEqual(cerrada["comprobadoEl"], "2026-10-23T19:00:01Z")
        self.assertTrue(self.consultar_fuente("20:00", {1: "normal", 2: None}))
        dto = self.componer("2026-10-23T20:30:00Z")
        self.assertNotIn(self.url(SEGUNDA), dto)
        panel = self.panel("2026-10-23T20:30:00Z")
        self.assertEqual(panel[SEGUNDA]["decision"], "sin-confirmar")
        self.assertEqual(panel[SEGUNDA]["comprobadoEl"], cerrada["comprobadoEl"])
        self.assertEqual(panel[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T20:00:01Z")

    def test_respuestas_desordenadas_no_cambian_la_evaluacion(self) -> None:
        """El orden de las páginas en el índice no decide fecha, aviso ni proyección."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        self.componer("2026-10-23T19:30:00Z")
        self.consultar_fuente("20:00", {1: "normal", 2: None})
        esperado = self.panel_en_copia("2026-10-23T20:30:00Z")
        original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        documento = json.loads((original / "procedencia.json").read_bytes())
        documento["capturas"].reverse()
        (original / "procedencia.json").write_text(json.dumps(documento))
        with self._rutas_globales():
            fuente.preparar("cibervoluntarios", raiz=self.raiz)
            fuente.validar("cibervoluntarios", raiz=self.raiz)
        self.componer("2026-10-23T20:30:00Z")
        invertido = self.panel("2026-10-23T20:30:00Z")
        self.assertEqual(invertido[SEGUNDA]["comprobadoEl"], "2026-10-23T19:00:01Z")
        self.assertEqual(invertido[SEGUNDA]["ultimoIntentoFallidoEl"], "2026-10-23T20:00:01Z")
        self.assertEqual(invertido[PRIMERA]["comprobadoEl"], "2026-10-23T20:00:01Z")
        self.assertEqual(invertido, esperado)

    def test_repetir_sin_red_no_renueva_fechas(self) -> None:
        """Readmitir y recomponer sin consultar conserva bytes, fechas y avisos."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        self.consultar_fuente("20:00", {1: "normal", 2: None})
        self.componer("2026-10-23T20:30:00Z")
        antes = self.inventario()
        with sqlite3.connect(almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta) as conexion:
            observaciones = conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0]
        with self._rutas_globales(), patch.object(fuente, "consultar", side_effect=AssertionError("sin red")):
            fuente.preparar("cibervoluntarios", raiz=self.raiz)
            fuente.validar("cibervoluntarios", raiz=self.raiz)
        self.componer("2026-10-23T23:00:00Z")
        self.assertEqual(self.inventario(), antes)
        with sqlite3.connect(almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta) as conexion:
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], observaciones
            )

    def test_fallo_total_registra_el_intento_sin_tocar_lo_publicado(self) -> None:
        """Sin la primera página no hay censo: no se admite nada y la instalación sigue igual."""
        self.consultar_fuente("19:00", {1: "normal", 2: "normal"})
        self.componer("2026-10-23T19:30:00Z")
        antes = self.inventario()
        _, _, validado = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        admitida = (validado / "validacion.json").read_bytes()
        for hora, primera in (("20:00", None), ("21:00", 503)):
            self.assertFalse(self.consultar_fuente(hora, {1: primera, 2: "normal"}))
            original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
            documento = json.loads((original / "procedencia.json").read_bytes())
            self.assertEqual(len(documento["capturas"]), 1)
            self.assertEqual((validado / "validacion.json").read_bytes(), admitida)
        self.componer("2026-10-23T21:30:00Z")
        self.assertEqual(self.inventario(), antes)


if __name__ == "__main__":
    unittest.main()
