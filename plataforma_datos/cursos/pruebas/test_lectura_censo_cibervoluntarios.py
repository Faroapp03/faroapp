"""La adquisición de Cibervoluntarios emite en cada ciclo una lectura de materiales y otra de actividades, sin red."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion as a
from plataforma_datos.cursos.fuentes.cibervoluntarios import declaraciones_publicadas as declaraciones
from plataforma_datos.cursos.fuentes.cibervoluntarios import lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.pruebas.test_ciber_adquisicion import codigo_publicado
from plataforma_datos.cursos.recepciones_catalogo import json_bytes
from plataforma_datos.cursos.retirada_por_evidencia import Curso, decidir

MODULO = "https://frontend.cibervoluntarios.org/vite/assets/main-ejemplo.js"
COMPONENTE = "https://frontend.cibervoluntarios.org/vite/assets/TrainingCourseView-fixture.js"
IDIOMA = "https://frontend.cibervoluntarios.org/vite/assets/useCatalogMaterialByLocale-fixture.js"
POR_PAGINA = 2


def material(id: int, *, estado: str = "Disponible", borrado: bool = False) -> dict:
    """Un material de autoformación en español, tal como lo publica la API.

    Returns:
        El material con su estado y su marca de borrado.
    """
    return {
        "id": id,
        "title": f"Curso {id}",
        "slug": f"curso-{id}",
        "type": "Autoformación",
        "lang": "Español",
        "status": estado,
        "erased": borrado,
    }


def actividad(id: int, *, estado: str = "Disponible", materiales: list[dict] | None = None, **otros: object) -> dict:
    """Una actividad con su único material, que lleva el identificador de la actividad más mil.

    Returns:
        La actividad tal como la publica la API.
    """
    suyos = [material(id + 1000)] if materiales is None else materiales
    return {
        "id": id,
        "title": f"Actividad {id}",
        "type": "Taller",
        "status": estado,
        "erased": False,
        "activityCatalogMaterials": suyos,
        **otros,
    }


def conocido(id: int, *, estado: str = "Disponible", actividad_estado: str = "Disponible") -> dict:
    """El material del catálogo instalado con lo último que se supo de su estado.

    Returns:
        El programa tal como lo devuelve el catálogo.
    """
    publicado = material(id)
    return {
        "id": f"cibervoluntarios:material:{id}",
        "datos": {
            "identidad_fuente": {"material_id": id, "actividad_id": id - 1000},
            "material_publicado": {"status": estado, "erased": publicado["erased"]},
            "actividad_publicada": {"status": actividad_estado},
        },
    }


class Instalacion:
    """Una instalación temporal donde se ejecuta `descargar` con respuestas sintéticas."""

    def __init__(self, caso: unittest.TestCase) -> None:
        """Crea la carpeta de originales y los apoyos públicos del censo."""
        area = tempfile.TemporaryDirectory()
        caso.addCleanup(area.cleanup)
        self.raiz = Path(area.name)
        self.original = self.raiz / DATOS_RELATIVOS / "originales" / "cibervoluntarios"
        self.original.mkdir(parents=True)
        portada = f'<html><head><script type="module" src="{MODULO}"></script></head></html>'.encode()
        patron = b'import{x}from"./main-ejemplo.js";import{u}from"./useCatalogMaterialByLocale-fixture.js";'
        self.apoyos = {
            declaraciones.PORTADA: self.captura(declaraciones.PORTADA, portada, "2026-11-15T05:00:10Z"),
            a.ALIAS_FUNDAE: self.captura(a.ALIAS_FUNDAE, portada, "2026-11-15T05:00:10Z"),
            MODULO: self.captura(MODULO, codigo_publicado(), "2026-11-15T05:00:10Z"),
            COMPONENTE: self.captura(COMPONENTE, patron, "2026-11-15T05:00:10Z"),
            IDIOMA: self.captura(IDIOMA, b"export{};", "2026-11-15T05:00:10Z"),
        }

    def captura(self, url: str, cuerpo: bytes, fin: str, http: int = 200) -> dict:
        """Conserva una respuesta con su recibo, como la deja el conector serial.

        Returns:
            La captura con sus referencias conservadas.
        """
        sha = hashlib.sha256(cuerpo).hexdigest()
        (self.original / (sha + ".body")).write_bytes(cuerpo)
        meta = {
            "url": url,
            "url_final": url,
            "http": http,
            "completo": True,
            "cuerpo_sha256": sha,
            "bytes": len(cuerpo),
            "inicio_utc": fin,
            "fin_utc": fin,
        }
        estable, evento = recibos_compartidos.separar(
            json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"})
        )
        refs = {}
        for clave, contenido in (("metadatos", estable), ("recibo", evento)):
            sha_meta = hashlib.sha256(contenido).hexdigest()
            (self.original / (sha_meta + ".json")).write_bytes(contenido)
            refs[clave] = {"archivo": sha_meta + ".json", "sha256": sha_meta}
        return {"id": None, "cuerpo": {"archivo": sha + ".body", "sha256": sha}, **refs, "intento": refs["recibo"]}

    def ciclo(
        self,
        actividades: list[dict],
        hora: str,
        conocidos: list[dict] | None = None,
        caidas: frozenset[int] = frozenset(),
    ) -> lectura.Resultado:
        """Recibe el censo de esas actividades a esa hora; las páginas de `caidas` responden 503.

        Returns:
            El resultado de la adquisición.
        """
        por_url = dict(self.apoyos)
        paginas = [actividades[desde : desde + POR_PAGINA] for desde in range(0, len(actividades), POR_PAGINA)]
        ruta = self.original / "procedencia.json"
        anterior = recibos_compartidos.leer_json(ruta.read_bytes()) if ruta.exists() else {}
        recibir = patch.object(comun, "recibir_pagina_de_fuente", side_effect=lambda _f, url, *_a: por_url[url])
        otras = patch.object(comun, "recibir_url", side_effect=lambda url, *_a, **_k: por_url[url])
        with patch.object(a, "TAMANO_PAGINA", POR_PAGINA), recibir, otras:
            for numero, filas in enumerate(paginas, start=1):
                cuerpo = json.dumps({"hydra:totalItems": len(actividades), "hydra:member": filas}).encode()
                url = a.url_pagina(numero)
                por_url[url] = self.captura(url, cuerpo, hora, 503 if numero in caidas else 200)
            return a.descargar(conocidos or [], self.original, anterior)

    def lecturas(self, ambito: str) -> list[dict]:
        """Las lecturas guardadas de un ámbito, en el orden del almacén.

        Returns:
            Las lecturas del ámbito.
        """
        return [x for x in listar_lecturas(self.raiz, "cibervoluntarios") if x["ambito"] == ambito]

    def materiales_recibidos(self) -> tuple:
        """Los materiales de las páginas de la última procedencia, como los lee la adquisición.

        Returns:
            Los materiales en el orden del censo.
        """
        capturas = json.loads((self.original / "procedencia.json").read_bytes())["capturas"]
        return tuple(m for cap in capturas for m in a.materiales(self.original, cap))


class LecturaEnCadaCiclo(unittest.TestCase):
    """Cada ciclo de la adquisición deja su lectura por ámbito, encadenada con la anterior."""

    def test_dos_ciclos_dejan_dos_lecturas_encadenadas_por_ambito(self) -> None:
        """La segunda cita la primera, usa la hora del recibo al segundo y lista quién entra y quién sale."""
        sitio = Instalacion(self)
        primero = sitio.ciclo([actividad(i) for i in (1, 2, 3)], "2026-11-15T05:00:10.454510Z")
        segundo = sitio.ciclo([actividad(i) for i in (2, 3, 4)], "2026-11-16T05:00:10.100000Z")
        self.assertEqual((len(primero.emisiones), primero.problemas), (2, ()))
        self.assertEqual((len(segundo.emisiones), segundo.problemas), (2, ()))
        for ambito, prefijo, resto in (
            ("cibervoluntarios:material", "cibervoluntarios:material:", 1000),
            ("cibervoluntarios:actividad", "cibervoluntarios:actividad:", 0),
        ):
            antes, despues = sitio.lecturas(ambito)
            self.assertEqual(antes["observado_utc"], "2026-11-15T05:00:10Z")
            self.assertEqual(despues["anterior"], antes["lectura_id"])
            self.assertEqual(despues["observado_utc"], "2026-11-16T05:00:10Z")
            self.assertEqual(despues["entradas"], [f"{prefijo}{4 + resto}"])
            self.assertEqual(despues["salidas"], [{"id": f"{prefijo}{1 + resto}", "explicada_por": None}])
            self.assertEqual(
                (despues["estado"], despues["recuento_bruto"], despues["recuento_vigente"]), ("sana", 3, 3)
            )
        materiales, actividades = (
            sitio.lecturas(x)[-1] for x in ("cibervoluntarios:material", "cibervoluntarios:actividad")
        )
        self.assertIsNone(materiales["total_declarado"])
        self.assertEqual(actividades["total_declarado"], 3)
        self.assertEqual(materiales["huella_forma"]["niveles"], ["actividad", "programa"])

    def test_lo_no_disponible_cuenta_en_el_bruto_y_no_en_el_vigente(self) -> None:
        """Un material borrado o descatalogado sigue en el censo: no sale, pero no es vigente."""
        sitio = Instalacion(self)
        censo = [
            actividad(1),
            actividad(2, materiales=[material(1002, estado="Descatalogado")]),
            actividad(3, materiales=[material(1003, borrado=True)]),
        ]
        materiales, actividades = (e.lectura for e in sitio.ciclo(censo, "2026-11-15T05:00:10Z").emisiones)
        self.assertEqual((materiales["recuento_bruto"], materiales["recuento_vigente"]), (3, 1))
        self.assertEqual((actividades["recuento_bruto"], actividades["recuento_vigente"]), (3, 1))

    def test_un_censo_con_una_pagina_caida_da_una_lectura_incompleta(self) -> None:
        """Si una página del censo no responde, la lectura dice que no llegó entero y por qué."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo([actividad(i) for i in (1, 2, 3)], "2026-11-15T05:00:10Z", caidas=frozenset({2}))
        self.assertEqual(resultado.problemas, ())
        for emision in resultado.emisiones:
            self.assertEqual(
                (emision.lectura["estado"], emision.lectura["motivo_incompleta"]), ("incompleta", "consulta_fallida")
            )
            self.assertEqual(emision.lectura["recuento_bruto"], 2)

    def test_un_estado_desconocido_queda_anotado(self) -> None:
        """Un estado fuera de los que reconoce la fuente queda en la forma y hace anómala la lectura."""
        sitio = Instalacion(self)
        censo = [actividad(1), actividad(2, estado="Archivada", materiales=[material(1002, estado="Archivado")])]
        materiales, actividades = (e.lectura for e in sitio.ciclo(censo, "2026-11-15T05:00:10Z").emisiones)
        esperados = [
            {"campo": "actividad.status", "valor": "Archivada"},
            {"campo": "programa.status", "valor": "Archivado"},
        ]
        for lectura_emitida in (materiales, actividades):
            self.assertEqual(lectura_emitida["huella_forma"]["valores_nuevos"], esperados)
            self.assertIn("valor_desconocido", lectura_emitida["motivos"])

    def test_un_campo_de_un_solo_curso_no_cambia_la_forma(self) -> None:
        """Los campos de edad, que aparecen en un curso de cada 258, no mueven la huella de la forma."""
        sitio = Instalacion(self)
        sin = sitio.ciclo([actividad(1), actividad(2)], "2026-11-15T05:00:10Z").emisiones[0].lectura
        con = (
            sitio.ciclo([actividad(1, minAge=18, maxAge=30), actividad(2)], "2026-11-16T05:00:10Z").emisiones[0].lectura
        )
        otro = sitio.ciclo([actividad(1, nuevo="x"), actividad(2)], "2026-11-17T05:00:10Z").emisiones[0].lectura
        self.assertEqual(con["huella_forma"], sin["huella_forma"])
        self.assertNotEqual(otro["huella_forma"]["campos_sha256"], sin["huella_forma"]["campos_sha256"])

    def test_si_la_emision_falla_la_adquisicion_termina_igual(self) -> None:
        """Un fallo del registro se dice en el resultado; la procedencia es la misma que sin el fallo."""
        normal, fallida = Instalacion(self), Instalacion(self)
        censo = [actividad(i) for i in (1, 2)]
        normal.ciclo(censo, "2026-11-15T05:00:10Z")
        with patch.object(lectura, "emitir_lectura", side_effect=OSError("disco lleno")):
            resultado = fallida.ciclo(censo, "2026-11-15T05:00:10Z")
        self.assertEqual(resultado.emisiones, ())
        self.assertEqual(len(resultado.problemas), 2)
        self.assertIn("disco lleno", resultado.problemas[0])
        self.assertEqual(
            (fallida.original / "procedencia.json").read_bytes(), (normal.original / "procedencia.json").read_bytes()
        )
        self.assertEqual(listar_lecturas(fallida.raiz, "cibervoluntarios"), [])

    def test_una_pagina_ilegible_se_dice_y_no_emite(self) -> None:
        """Si una página no se puede leer para el registro, el resultado lo dice y no se guarda nada."""

        def alterada(_original: Path, _captura: dict) -> None:
            raise a.FormatoInesperado("página alterada")

        sitio = Instalacion(self)
        resultado = lectura.emitir(sitio.original, [{}], [], leer=alterada)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("página alterada", resultado.problemas[0])
        self.assertEqual(listar_lecturas(sitio.raiz, "cibervoluntarios"), [])

    def test_sin_la_primera_pagina_no_hay_lectura(self) -> None:
        """Una primera página caída no deja censo que registrar, aunque las demás respondan."""
        sitio = Instalacion(self)
        resultado = lectura.emitir(sitio.original, [{}, {}], [], leer=lambda *_: None)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("sin la primera página", resultado.problemas[0])

    def test_una_carpeta_que_no_es_de_una_instalacion_no_emite(self) -> None:
        """Sin instalación no hay dónde guardar: se dice y no se escribe nada."""
        resultado = lectura.emitir(Path("/originales"), [], [], leer=lambda *_: None)
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


class ExplicarSalidas(unittest.TestCase):
    """Una salida se explica por la baja que la fuente ya había declarado; sin ella, no se explica."""

    def test_sale_con_su_baja_declarada_explicada_y_sin_ella_no(self) -> None:
        """El material descatalogado y el de una actividad pendiente salen explicados; el disponible, no."""
        sitio = Instalacion(self)
        sitio.ciclo([actividad(i) for i in (1, 2, 3, 4)], "2026-11-15T05:00:10Z")
        conocidos = [
            conocido(1001, estado="Descatalogado"),
            conocido(1002),
            conocido(1003, actividad_estado="Pendiente"),
        ]
        resultado = sitio.ciclo([actividad(4)], "2026-11-16T05:00:10Z", conocidos)
        materiales, actividades = (e.lectura for e in resultado.emisiones)
        esperadas = [(1, "fuente_declara_baja"), (2, None), (3, "fuente_declara_baja")]
        self.assertEqual(
            materiales["salidas"],
            [{"id": f"cibervoluntarios:material:{1000 + i}", "explicada_por": x} for i, x in esperadas],
        )
        self.assertEqual(
            actividades["salidas"],
            [{"id": f"cibervoluntarios:actividad:{i}", "explicada_por": x} for i, x in esperadas],
        )

    def test_lo_guardado_dice_lo_mismo_que_la_baja_declarada_de_la_captura(self) -> None:
        """Con el material tal como se guarda, explicar su salida equivale a que la captura lo declare de baja."""
        sitio = Instalacion(self)
        censo = [
            actividad(1),
            actividad(2, materiales=[material(1002, estado="Descatalogado")]),
            actividad(3, materiales=[material(1003, estado="Pendiente")]),
            actividad(4, materiales=[material(1004, borrado=True)]),
            actividad(5, estado="Archivada"),
        ]
        sitio.ciclo(censo, "2026-11-15T05:00:10Z")
        for m in sitio.materiales_recibidos():
            guardado = {
                "id": f"cibervoluntarios:material:{m.id}",
                "datos": {"material_publicado": m.material_publicado, "actividad_publicada": m.actividad_publicada},
            }
            explicado = lectura.explicar_material({guardado["id"]: guardado})(guardado["id"])
            self.assertEqual(explicado == "fuente_declara_baja", m.baja_declarada is not None, m.id)


class DeclaracionesDeLaFuente(unittest.TestCase):
    """La baja declarada de un material, citando su lectura."""

    def test_declaraciones_salen_con_su_lectura_y_las_lee_la_retirada(self) -> None:
        """Cada declaración cita la lectura de la captura y la regla de retirada la acepta tal cual."""
        sitio = Instalacion(self)
        censo = [
            actividad(1, materiales=[material(1001, borrado=True)]),
            actividad(2, materiales=[material(1002, estado="Descatalogado")]),
            actividad(3),
        ]
        materiales = next(
            e.lectura
            for e in sitio.ciclo(censo, "2026-11-15T05:00:10Z").emisiones
            if e.lectura["ambito"] == "cibervoluntarios:material"
        )
        declaradas = lectura.declaraciones(materiales, sitio.materiales_recibidos())
        self.assertEqual(
            {id: [d.canal for d in lista] for id, lista in declaradas.items()},
            {
                "cibervoluntarios:material:1001": ["baja_declarada"],
                "cibervoluntarios:material:1002": ["baja_declarada"],
            },
        )
        self.assertTrue(all(d.lectura_id == materiales["lectura_id"] for lista in declaradas.values() for d in lista))
        self.assertTrue(all(d.cierra_el is None for lista in declaradas.values() for d in lista))
        self.assertNotEqual(
            declaradas["cibervoluntarios:material:1001"][0].sha256,
            declaradas["cibervoluntarios:material:1002"][0].sha256,
        )
        for id, decision in (
            ("cibervoluntarios:material:1001", "retirar"),
            ("cibervoluntarios:material:1003", "mantener"),
        ):
            curso = Curso(
                id=id,
                fuente="cibervoluntarios",
                ambito="cibervoluntarios:material",
                declaraciones=declaradas.get(id, ()),
            )
            self.assertEqual(decidir(curso, [materiales]).decision, decision)

    def test_los_materiales_de_otra_captura_no_dan_declaraciones(self) -> None:
        """Las declaraciones solo salen de los materiales que dieron esa lectura y de su ámbito."""
        sitio = Instalacion(self)
        emisiones = sitio.ciclo([actividad(1)], "2026-11-15T05:00:10Z").emisiones
        materiales, actividades = (e.lectura for e in emisiones)
        recibidos = sitio.materiales_recibidos()
        with self.assertRaises(lectura.ErrorLecturaCibervoluntarios):
            lectura.declaraciones(materiales, recibidos[:0])
        with self.assertRaises(lectura.ErrorLecturaCibervoluntarios):
            lectura.declaraciones(actividades, recibidos)


if __name__ == "__main__":
    unittest.main()
