"""Academy usa la operación registrada: descubre IDs y conserva pruebas sin cuentas."""

import hashlib
import json
import tempfile
import unittest
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado
from plataforma_datos.cursos import cobertura_catalogo
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_formacion as condiciones
from plataforma_datos.cursos.pruebas.test_acceso_publico_academy import captura
from plataforma_datos.orquestacion import admision


class AcademyCicloRecepcionesPruebas(unittest.TestCase):
    """Transporte sintético y etapas reales; la admisión no acredita curso entero."""

    def setUp(self) -> None:
        """Prepara una instalación temporal con una identidad nativa conocida."""
        temporal = tempfile.TemporaryDirectory(prefix="Ciclo Academy ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.ids_indice = ["nuevo"]
        self.leccion_ajena = False
        self.llamadas = []
        self.numero = 0
        self.programas = [{"id": "claude-academy:anterior", "url": acceso.ORIGEN + "/courses/anterior"}]
        self.pila = ExitStack()
        self.addCleanup(self.pila.close)

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

        for contexto in (
            patch.object(fuente, "RAIZ", self.raiz),
            patch.object(fuente, "conocidos", return_value=self.programas),
            patch.object(fuente, "consultar", side_effect=self.recibir),
            patch.object(admision, "carpetas", carpetas),
            patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / f"{id}.json"),
        ):
            self.pila.enter_context(contexto)

    def recibir(self, url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
        """Simula respuestas completas por URL, con tiempos distintos por intento.

        Returns:
            Recepción sintética; nunca se sustituye por ella una fecha real.
        """
        self.llamadas.append(url)
        self.numero += 1
        inicio = datetime(2026, 10, 23, 10, tzinfo=UTC) + timedelta(seconds=self.numero)
        if url == acceso.INDICE:
            titulo = "Courses · Claude Academy"
            contenido = "<h1>Courses</h1>" + "".join(f'<a href="/courses/{id}">Curso</a>' for id in self.ids_indice)
        elif url == condiciones.FAQ:
            titulo = "FAQ · Claude Academy"
            contenido = (
                "<h1>Frequently asked questions</h1><h2>Sign-in and access</h2>"
                "<p>Condiciones sintéticas no acreditadas.</p>"
            )
        elif url == acceso.PORTADA:
            titulo = "Claude Academy"
            contenido = "<h1>Academy</h1><p>" + acceso.DECLARACION + "</p>"
        elif url.endswith("/inicio"):
            slug = url.split("/")[-2]
            curso = "Curso ajeno" if self.leccion_ajena else "Curso " + slug
            titulo = "Inicio · " + curso + " · Claude Academy"
            contenido = "<h1>Inicio</h1><article><h2>Summary</h2><p>Texto didáctico público.</p></article>"
        else:
            slug = url.rsplit("/", 1)[1]
            titulo = "Curso " + slug + " · Claude Academy"
            contenido = f'<h1>Curso {slug}</h1><a href="/courses/{slug}/inicio">Start course</a>'
        cuerpo, _meta = captura(url, titulo, contenido)
        return transporte.RespuestaCatalogo(
            url=url,
            inicio_utc=inicio.isoformat(),
            fin_utc=(inicio + timedelta(microseconds=1)).isoformat(),
            cuerpo=cuerpo,
            url_final=url,
            http=200,
            completo=True,
            content_type="text/html",
        )

    def ciclo(self) -> dict:
        """Ejecuta descarga, preparación y controles reales de la fuente registrada.

        Returns:
            Conjunto admitido, sin importar o publicar automáticamente sus recursos.
        """
        fuente.descargar("claude_academy", raiz=self.raiz)
        fuente.preparar("claude_academy", raiz=self.raiz)
        fuente.validar("claude_academy", raiz=self.raiz)
        return fuente.leer_validado("claude_academy", self.raiz)

    def test_indice_descubre_alta_y_no_retira_conocido_ausente(self) -> None:
        """El recurso omitido del índice se consulta, y la nueva identidad no se duplica."""
        conjunto = self.ciclo()
        self.assertEqual(
            [c["id"] for c in conjunto["recepciones"]], ["claude-academy:anterior", "claude-academy:nuevo"]
        )
        self.assertFalse(conjunto["censo_completo"])
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        recibos = cobertura_catalogo._recibos("claude_academy", original=original, admitido=conjunto)
        canales = cobertura_catalogo._canales(self.raiz, "claude_academy", conjunto)
        self.assertEqual({r["url"] for r in recibos}, set(self.llamadas))
        self.assertEqual(canales, set(self.llamadas))
        self.assertIn(acceso.ORIGEN + "/courses/anterior", self.llamadas)
        self.assertIn(acceso.ORIGEN + "/courses/nuevo/inicio", self.llamadas)
        for r in conjunto["recepciones"]:
            self.assertEqual(
                r["lectura"]["leccion_publica"]["alcance"], "texto_publico_de_primera_leccion_no_curso_entero"
            )
        self.assertIsNotNone(conjunto["auxiliares"]["portada"]["lectura"]["gratuidad_formacion_declarada"])

    def test_repeticion_conserva_cuerpos_e_historial_de_todos_los_canales(self) -> None:
        """Una consulta nueva conserva pruebas sin clonar cuerpos ni perder auxiliares."""
        primero = self.ciclo()
        original, _, _ = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        cuerpos = {
            p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in (original / "cuerpos").iterdir() if p.is_file()
        }
        antes = json.loads((original / "procedencia.json").read_bytes())
        segundo = self.ciclo()
        despues = json.loads((original / "procedencia.json").read_bytes())
        self.assertEqual(len(segundo["recepciones"]), len(primero["recepciones"]))
        self.assertTrue({f["sha256"] for f in antes["historial"]} <= {f["sha256"] for f in despues["historial"]})
        self.assertEqual(
            cuerpos,
            {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in (original / "cuerpos").iterdir() if p.is_file()},
        )

    def test_200_generico_o_leccion_ajena_no_renueva_el_admitido(self) -> None:
        """Conserva el intento nuevo y la última fuente buena sin publicar una muestra."""
        self.ciclo()
        _, _, validado = fuente.rutas_de_la_fuente("claude_academy", self.raiz)
        antes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in validado.iterdir() if p.is_file()}
        self.leccion_ajena = True
        fuente.descargar("claude_academy", raiz=self.raiz)
        with self.assertRaises(FormatoInesperado):
            fuente.preparar("claude_academy", raiz=self.raiz)
        self.assertEqual(
            antes, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in validado.iterdir() if p.is_file()}
        )


if __name__ == "__main__":
    unittest.main()
