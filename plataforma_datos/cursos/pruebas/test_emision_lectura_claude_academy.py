"""La adquisición de Academy emite en cada ciclo la lectura de su índice, sin red."""

import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import adquisicion, lector, lectura
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_formacion as formacion
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas as publicadas
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.pruebas.test_acceso_publico_academy import captura

CERRADO = "<p>This course is closed.</p>"
REQUISITOS = "<h2>Prerequisites</h2><p>Haber hecho el curso anterior.</p>"


def datos_de_oferta(slug: str, **oferta: str) -> str:
    """Los datos estructurados de la ficha de ese curso con esa oferta.

    Returns:
        El script `application/ld+json` de un curso con su oferta.
    """
    curso = {"@type": "Course", "url": f"{acceso.ORIGEN}/courses/{slug}", "offers": oferta}
    return '<script type="application/ld+json">' + json.dumps(curso) + "</script>"


class Instalacion:
    """Una instalación temporal donde se ejecuta `descargar` con respuestas sintéticas por URL."""

    def __init__(self, caso: unittest.TestCase) -> None:
        """Crea la carpeta de la instalación y deja el índice vacío de cursos."""
        area = tempfile.TemporaryDirectory(prefix="Lectura Academy ñ ")
        caso.addCleanup(area.cleanup)
        self.raiz = Path(area.name)
        self.original = fuente.rutas_de_la_fuente("claude_academy", self.raiz)[0]
        self.original.mkdir(parents=True)
        self.extras: dict[str, str] = {}
        self.indice: list[str] = []
        self.numero = 0
        self.dia = datetime(2026, 11, 15, 5, tzinfo=UTC)

    def recibir(self, url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
        """Responde con HTML completo y una hora que avanza con cada consulta.

        Returns:
            La recepción sintética de esa URL.
        """
        self.numero += 1
        inicio = self.dia + timedelta(seconds=self.numero)
        slug = url.rsplit("/", 1)[1]
        if url == acceso.INDICE:
            titulo = "Courses · Claude Academy"
            contenido = "<h1>Courses</h1>" + "".join(f'<a href="/courses/{id}">Curso</a>' for id in self.indice)
        elif url == formacion.FAQ:
            titulo, contenido = "FAQ · Claude Academy", "<h1>Frequently asked questions</h1><h2>Sign-in and access</h2>"
        elif url == acceso.PORTADA:
            titulo, contenido = "Claude Academy", "<h1>Academy</h1><p>" + acceso.DECLARACION + "</p>"
        elif slug == "inicio":
            titulo = "Inicio · Curso " + url.split("/")[-2] + " · Claude Academy"
            contenido = "<h1>Inicio</h1><article><h2>Summary</h2><p>Texto didáctico público.</p></article>"
        else:
            titulo = "Curso " + slug + " · Claude Academy"
            contenido = f'<h1>Curso {slug}</h1><a href="/courses/{slug}/inicio">Start course</a>'
            contenido += self.extras.get(slug, "")
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

    def ciclo(self, indice: list[str], dia: int = 15) -> lectura.Resultado:
        """Recibe el índice con esos cursos el día indicado de noviembre.

        Returns:
            El resultado de la adquisición.
        """
        self.indice, self.numero = indice, 0
        self.dia = datetime(2026, 11, dia, 5, tzinfo=UTC)
        ruta = self.original / "procedencia.json"
        anterior = json.loads(ruta.read_bytes()) if ruta.exists() else {}
        with patch.object(fuente, "consultar", side_effect=self.recibir):
            return adquisicion.descargar([], self.original, anterior)

    def lecturas(self) -> list[dict]:
        """Las lecturas guardadas de Academy, en el orden del almacén.

        Returns:
            Las lecturas de la fuente.
        """
        return listar_lecturas(self.raiz, "claude_academy")

    def captura(self) -> lectura.Captura:
        """Lo que dejó el último ciclo, leído de los originales conservados.

        Returns:
            La captura del índice con las fichas de sus cursos.
        """
        procedencia = json.loads((self.original / "procedencia.json").read_bytes())
        return lectura.leer_captura(self.original, procedencia["auxiliares"]["indice"], procedencia["capturas"])


class LecturaEnCadaCiclo(unittest.TestCase):
    """Cada ciclo deja su lectura, encadenada con la anterior y siempre sin censo."""

    def test_dos_ciclos_dejan_dos_lecturas_encadenadas(self) -> None:
        """La segunda cita la primera y lista quién entra y quién sale; nada explica la salida."""
        sitio = Instalacion(self)
        primero = sitio.ciclo(["a", "b", "c"])
        segundo = sitio.ciclo(["b", "c", "d"], dia=16)
        self.assertEqual((len(primero.emisiones), primero.problemas), (1, ()))
        self.assertEqual((len(segundo.emisiones), segundo.problemas), (1, ()))
        antes, despues = sitio.lecturas()
        self.assertEqual(despues["anterior"], antes["lectura_id"])
        self.assertEqual(despues["ambito"], "claude_academy:curso")
        self.assertEqual(despues["observado_utc"], "2026-11-16T05:00:01Z")
        self.assertEqual(despues["entradas"], ["claude-academy:d"])
        self.assertEqual(despues["salidas"], [{"id": "claude-academy:a", "explicada_por": None}])
        self.assertEqual((despues["recuento_bruto"], despues["recuento_vigente"]), (3, 3))
        self.assertIsNone(despues["total_declarado"])

    def test_el_indice_no_es_un_censo(self) -> None:
        """Todas las lecturas son incompletas por falta de censo, aunque no falle ninguna consulta."""
        sitio = Instalacion(self)
        sitio.ciclo(["a", "b"])
        (unica,) = sitio.lecturas()
        self.assertFalse(unica["completa"])
        self.assertEqual((unica["motivo_incompleta"], unica["estado"]), ("sin_censo", "incompleta"))

    def test_la_forma_solo_cambia_si_un_campo_desaparece_de_toda_la_fuente(self) -> None:
        """Un curso que pierde sus requisitos no cambia la forma mientras otro los conserve."""
        sitio = Instalacion(self)
        sitio.extras = {"a": REQUISITOS, "b": REQUISITOS}
        sitio.ciclo(["a", "b"])
        sitio.extras = {"a": REQUISITOS}
        sitio.ciclo(["a", "b"], dia=16)
        sitio.extras = {}
        sitio.ciclo(["a", "b"], dia=17)
        huellas = [x["huella_forma"]["campos_sha256"] for x in sitio.lecturas()]
        self.assertEqual(huellas[0], huellas[1])
        self.assertNotEqual(huellas[1], huellas[2])


class ValoresDelVocabulario(unittest.TestCase):
    """Los valores de la oferta que la fuente no reconoce quedan anotados."""

    def test_un_valor_fuera_de_vocabulario_queda_anotado(self) -> None:
        """Una categoría o una disponibilidad desconocidas son valores nuevos; las conocidas, no."""
        sitio = Instalacion(self)
        sitio.extras = {
            "a": datos_de_oferta("a", category="Free", availability="https://schema.org/InStock"),
            "b": datos_de_oferta("b", category="Subscription", availability="https://schema.org/PreOrder"),
        }
        sitio.ciclo(["a", "b"])
        (unica,) = sitio.lecturas()
        self.assertEqual(
            unica["huella_forma"]["valores_nuevos"],
            [
                {"campo": "programa.oferta.availability", "valor": "PreOrder"},
                {"campo": "programa.oferta.category", "valor": "Subscription"},
            ],
        )
        self.assertEqual(unica["motivos"], ["valor_desconocido"])

    def test_los_valores_conocidos_son_los_que_la_ficha_interpreta(self) -> None:
        """Si la fuente cambia lo que interpreta, este vocabulario deja de coincidir y la prueba falla."""
        ficha = lector.extraer_ficha(*self._pagina(), url_esperada=self._url())
        for categoria in lectura.CATEGORIAS:
            self.assertNotEqual(self._condiciones(ficha, category=categoria).precio, "incierto")
        for disponibilidad in lectura.DISPONIBILIDADES:
            self.assertNotEqual(self._condiciones(ficha, availability=disponibilidad).inscripcion, "incierta")
        self.assertEqual(self._condiciones(ficha, category="Subscription").precio, "incierto")
        self.assertEqual(self._condiciones(ficha, availability="PreOrder").inscripcion, "incierta")

    @staticmethod
    def _url() -> str:
        return acceso.ORIGEN + "/courses/ejemplo"

    def _pagina(self, oferta: str = "") -> tuple[bytes, dict]:
        return captura(
            self._url(),
            "Curso ejemplo · Claude Academy",
            '<h1>Curso ejemplo</h1><a href="/courses/ejemplo/inicio">Start course</a>' + oferta,
        )

    def _condiciones(self, ficha: lector.FichaAcademy, **oferta: str) -> publicadas.CondicionesAcademy:
        cuerpo, _meta = self._pagina(datos_de_oferta("ejemplo", **oferta))
        return publicadas.examinar(cuerpo, ficha)


class DeclaracionesDeLaFuente(unittest.TestCase):
    """Lo que la fuente afirma de un curso para la regla de retirada."""

    def test_la_inscripcion_cerrada_se_declara_citando_su_lectura(self) -> None:
        """Solo el curso cuya ficha dice que está cerrado declara, y deja de contar como vigente."""
        sitio = Instalacion(self)
        sitio.extras = {"b": CERRADO}
        sitio.ciclo(["a", "b"])
        (unica,) = sitio.lecturas()
        declaradas = lectura.declaraciones(unica, sitio.captura())
        self.assertEqual(list(declaradas), ["claude-academy:b"])
        (declaracion,) = declaradas["claude-academy:b"]
        self.assertEqual(declaracion.lectura_id, unica["lectura_id"])
        self.assertEqual(declaracion.canal, "inscripcion_cerrada")
        self.assertEqual((unica["recuento_bruto"], unica["recuento_vigente"]), (2, 1))

    def test_unas_declaraciones_de_otra_captura_se_rechazan(self) -> None:
        """Las declaraciones solo valen con la captura que dio la lectura."""
        sitio = Instalacion(self)
        sitio.ciclo(["a", "b"])
        (primera,) = sitio.lecturas()
        sitio.ciclo(["a", "b", "c"], dia=16)
        with self.assertRaises(lectura.ErrorLecturaAcademy):
            lectura.declaraciones(primera, sitio.captura())


class UnaEmisionQueFalla(unittest.TestCase):
    """El registro es telemetría: sus fallos no tocan la adquisición."""

    def test_una_emision_que_falla_no_cambia_la_procedencia(self) -> None:
        """El resultado dice el problema y la procedencia es la de un ciclo sin fallo."""
        sano, roto = Instalacion(self), Instalacion(self)
        sano.ciclo(["a", "b"])
        with patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            resultado = roto.ciclo(["a", "b"])
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("disco lleno", resultado.problemas[0])
        self.assertEqual(roto.lecturas(), [])
        self.assertEqual(
            (roto.original / "procedencia.json").read_bytes(), (sano.original / "procedencia.json").read_bytes()
        )

    def test_una_carpeta_que_no_es_de_una_instalacion_no_rompe_la_adquisicion(self) -> None:
        """Sin instalación a la que pertenecer no hay dónde registrar, y se dice sin lanzar."""
        sitio = Instalacion(self)
        sitio.ciclo(["a"])
        procedencia = json.loads((sitio.original / "procedencia.json").read_bytes())
        resultado = lectura.emitir(sitio.original.parent, procedencia["auxiliares"], procedencia["capturas"])
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales de Academy", resultado.problemas[0])


if __name__ == "__main__":
    unittest.main()
