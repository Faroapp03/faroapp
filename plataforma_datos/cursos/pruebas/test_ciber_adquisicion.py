"""Censo Ciber reproducible, declaraciones acotadas y fallos sin falsa apertura."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion as adquisicion
from plataforma_datos.cursos.fuentes.cibervoluntarios import declaraciones_publicadas as declaraciones
from plataforma_datos.cursos.recepciones_catalogo import json_bytes


def codigo_publicado(*, gratuito: bool = True) -> bytes:
    """Construye el formato publicado sintético, sin ejecutar funciones JavaScript.

    Returns:
        Diccionarios y ruta específicos, con una sección ajena que no debe usarse.
    """

    def campo(nombre: str, literal: str) -> str:
        return nombre + ":e=>{const{normalize:a}=e;return a([" + json.dumps(literal, ensure_ascii=False) + "])}"

    textos = declaraciones.LITERALES
    formacion = textos["formacion"] if gratuito else "Esta formación es de pago."
    return (
        "const mensajes={es:{training1:{atyourpace:{"
        + campo("title", "APRENDE A TU RITMO")
        + ","
        + campo("screens_text", formacion)
        + ","
        + campo("customized_img_2_text", textos["requisitos"])
        + "},register_form:{"
        + campo("title_atyourpace", textos["registro"])
        + "}},otra:{"
        + campo("screens_text", textos["formacion"])
        + '}}};const rutas=[{path:"'
        + declaraciones.RUTA_CURSO
        + '",name:"es.training-atyourpace-course",component:()=>d(()=>import("./TrainingCourseView-fixture.js"))},'
        '{path:"formacion-gratuita/aprende-a-tu-ritmo/comenzar",name:"es.training-atyourpace-registry"}];'
    ).encode()


class AdquisicionCiberPruebas(unittest.TestCase):
    """No se acredita exhaustividad con páginas repetidas, truncadas o cambiadas."""

    def setUp(self) -> None:
        """Crea recibos íntegros sin red, en una carpeta temporal propia."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.original = Path(self.temporal.name)
        self.modulo = "https://frontend.cibervoluntarios.org/vite/assets/main-ejemplo.js"
        portada = (
            '<html><head><script type="module" src="' + self.modulo + '"></script></head><body></body></html>'
        ).encode()
        self.auxiliares = {
            "portada": self.captura(declaraciones.PORTADA, portada),
            "alias": self.captura(adquisicion.ALIAS_FUNDAE, portada),
            "declaraciones": self.captura(self.modulo, codigo_publicado()),
            "componente": self.captura(
                "https://frontend.cibervoluntarios.org/vite/assets/TrainingCourseView-fixture.js",
                b'import{x}from"./main-ejemplo.js";import{u}from"./useCatalogMaterialByLocale-fixture.js";',
            ),
            "idioma": self.captura(
                "https://frontend.cibervoluntarios.org/vite/assets/useCatalogMaterialByLocale-fixture.js", b"export{};"
            ),
        }

    def captura(self, url: str, cuerpo: bytes, *, http: int = 200, final: str | None = None) -> dict:
        """Guarda un evento realista cuyos bytes y huellas se verifican en producción.

        Returns:
            Fila de captura común; los datos son exclusivamente sintéticos.
        """
        sha = hashlib.sha256(cuerpo).hexdigest()
        nombre = sha + ".body"
        (self.original / nombre).write_bytes(cuerpo)
        meta = {
            "url": url,
            "url_final": final or url,
            "http": http,
            "completo": True,
            "cuerpo_sha256": sha,
            "bytes": len(cuerpo),
            "inicio_utc": "2026-10-23T18:20:00Z",
            "fin_utc": "2026-10-23T18:20:10Z",
        }
        estable, evento = recibos_compartidos.separar(
            json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"})
        )
        refs = {}
        for clave, contenido in (("metadatos", estable), ("recibo", evento)):
            sha_meta = hashlib.sha256(contenido).hexdigest()
            archivo = sha_meta + ".json"
            (self.original / archivo).write_bytes(contenido)
            refs[clave] = {"archivo": archivo, "sha256": sha_meta}
        return {"id": None, "cuerpo": {"archivo": nombre, "sha256": sha}, **refs, "intento": refs["recibo"]}

    def pagina(self, numero: int, ids: list[int], total: int) -> dict:
        """Construye una página sin imágenes ni información de participantes.

        Returns:
            Captura con actividad y material de identidades independientes.
        """
        documento = {
            "hydra:totalItems": total,
            "hydra:member": [
                {"id": id, "activityCatalogMaterials": [{"id": id + 1000, "type": "Autoformación"}]} for id in ids
            ],
        }
        return self.captura(adquisicion.url_pagina(numero), json.dumps(documento).encode())

    def calcular(self, capturas: list[dict]) -> dict:
        """Invoca el conjunto real con referencias verificadas y auxiliares propios.

        Returns:
            Conjunto reproducible de la fuente.
        """
        documento = {
            "schema_version": 1,
            "fuente_id": "cibervoluntarios",
            "capturas": capturas,
            "auxiliares": self.auxiliares,
        }
        guardar_json(self.original / "procedencia.json", documento)
        return adquisicion.calcular(self.original, documento, [{"id": "cibervoluntarios:material:9999"}])

    def test_censo_exactamente_paginado_y_ausencia_sin_borrar(self) -> None:
        """El total se demuestra por IDs únicos, no por contar respuestas HTTP200."""
        conjunto = self.calcular([self.pagina(1, list(range(1, 101)), 101), self.pagina(2, [101], 101)])
        self.assertTrue(conjunto["censo_completo"])
        self.assertEqual(len(conjunto["censo"]["actividades"]), 101)
        self.assertEqual(conjunto["censo"]["conocidos_ausentes"], ["cibervoluntarios:material:9999"])
        self.assertIsNone(conjunto["publicacion_confirmada"])

    def test_pagina_faltante_repetida_y_total_contradictorio_no_admiten_censo(self) -> None:
        """No se rejuvenece un control desde un prefijo válido del catálogo."""
        primera = self.pagina(1, list(range(1, 101)), 101)
        for capturas in ([primera], [primera, primera], [primera, self.pagina(2, [101], 102)]):
            with self.subTest(capturas=capturas), self.assertRaises(FormatoInesperado):
                self.calcular(capturas)

    def test_actividades_o_materiales_repetidos_entre_paginas_rechazados(self) -> None:
        """Un número total coincidente no oculta duplicaciones entre páginas."""
        with self.assertRaisesRegex(FormatoInesperado, "identidades repetidas"):
            self.calcular([self.pagina(1, list(range(1, 101)), 101), self.pagina(2, [1], 101)])

    def test_cuerpo_o_recibo_incompleto_aborta(self) -> None:
        """No se convierte HTTP500 en una página del censo ni en ausencia válida."""
        fila = self.pagina(1, [1], 1)
        fila["cuerpo"]["sha256"] = "a" * 64
        with self.assertRaises(FormatoInesperado):
            self.calcular([fila])
        with self.assertRaises(FormatoInesperado):
            adquisicion.pagina(self.original, self.captura(adquisicion.url_pagina(1), b"{}", http=500))

    def test_declaraciones_precisas_no_prometen_certificado_o_acceso_sin_cuenta(self) -> None:
        """Las tres declaraciones conservan ámbito general y localizadores propios."""
        lectura = adquisicion.interpretar_auxiliares(self.original, self.auxiliares)["declaraciones"]["lectura"]
        self.assertEqual(set(lectura["declaraciones"]), {"formacion", "registro", "requisitos"})
        self.assertIn("registrarte", lectura["declaraciones"]["registro"]["literal"])
        self.assertTrue(all(d["campo"].startswith("es.training1.") for d in lectura["declaraciones"].values()))
        self.assertTrue(
            all(d["alcance"] == "declaracion_general_de_autoformacion" for d in lectura["declaraciones"].values())
        )

    def test_gratis_en_otro_ambito_no_reemplaza_declaracion_cambiada(self) -> None:
        """Otra sección gratuita no acredita la autoformación que ahora dice pago."""
        self.auxiliares["declaraciones"] = self.captura(self.modulo, codigo_publicado(gratuito=False))
        lectura = adquisicion.interpretar_auxiliares(self.original, self.auxiliares)["declaraciones"]["lectura"]
        self.assertIsNone(lectura["declaraciones"]["formacion"])
        self.assertIsNotNone(lectura["declaraciones"]["registro"])

    def test_modulo_no_enlazado_o_ruta_ajena_no_acreditan_declaracion(self) -> None:
        """Ni una copia arbitraria del paquete construido ni otra ruta activan la acreditación."""
        self.auxiliares["declaraciones"] = self.captura("https://otro.test/main-ejemplo.js", codigo_publicado())
        with self.assertRaises(ValueError):
            adquisicion.interpretar_auxiliares(self.original, self.auxiliares)
        self.auxiliares["declaraciones"] = self.captura(
            self.modulo, codigo_publicado().replace(declaraciones.RUTA_CURSO.encode(), b"otra-ruta/:slug")
        )
        with self.assertRaises(ValueError):
            adquisicion.interpretar_auxiliares(self.original, self.auxiliares)

    def test_fallo_alias_no_invalida_censo_independiente(self) -> None:
        """El error queda explícito y no rejuvenece la unidad ni bloquea otras 242."""
        self.auxiliares["alias"] = self.captura(adquisicion.ALIAS_FUNDAE, b"Servicio no disponible", http=503)
        conjunto = self.calcular([self.pagina(1, [1], 1)])
        self.assertTrue(conjunto["censo_completo"])
        self.assertFalse(conjunto["auxiliares"]["alias"]["lectura"]["vinculado"])
        self.assertEqual(conjunto["auxiliares"]["alias"]["recibo"], self.auxiliares["alias"]["recibo"])

    def test_integridad_alias_no_se_oculta_como_fallo_remoto(self) -> None:
        """La corrupción de un cuerpo, inclusoHTTP503, sigue siendo error local."""
        self.auxiliares["alias"] = self.captura(adquisicion.ALIAS_FUNDAE, b"Servicio no disponible", http=503)
        self.auxiliares["alias"]["cuerpo"]["sha256"] = "f" * 64
        with self.assertRaises(FormatoInesperado):
            self.calcular([self.pagina(1, [1], 1)])

    def test_descarga_no_sigue_destinos_y_guarda_intentos_al_fallar(self) -> None:
        """Un fallo del primer censo conserva el intento; no consulta cuentas o cursos."""
        with (
            patch.object(adquisicion.comun, "recibir_pagina_de_fuente", side_effect=OSError("fallo")),
            patch.object(adquisicion.comun, "guardar_capturas_de_fuente") as guardar,
            self.assertRaises(OSError),
        ):
            adquisicion.descargar([], self.original, {})
        guardar.assert_called_once_with(
            self.original, "cibervoluntarios", [], {}, {}, fallos_por_unidad=True, censo=None
        )


if __name__ == "__main__":
    unittest.main()
