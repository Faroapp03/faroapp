"""La adquisición de Cibernàrium emite en cada ciclo una lectura de ediciones y otra de programas, sin red."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import recibos_compartidos as recibos
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion as a
from plataforma_datos.cursos.fuentes.barcelonactiva import lectura
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.recepciones_catalogo import conservar_bytes
from plataforma_datos.cursos.retirada_por_evidencia import Curso, decidir

CERRADA = {
    "registrationCode": "DISP2",
    "registrationDesc": "Inscripció tancada.",
    "openingsAvailable": False,
    "tancada": True,
    "isFinished": True,
}


def actividad(
    id: int, *, codigo: str = "DISP0", fin: str = "Thu Dec 31 23:59:00 CET 2026", **matricula: object
) -> dict:
    """Una actividad en línea con su única edición, del mismo identificador.

    Returns:
        La actividad tal como la publica la API.
    """
    edicion = {
        "activityId": str(id),
        "listSessions": [],
        "registrationCode": codigo,
        "sessionsOnline": {"startDate": "Thu Jan 01 00:00:00 CET 2026", "endDate": fin},
        **matricula,
    }
    return {"activityId": str(id), "title": f"Activitat {id}", "formationType": "ONLINE", "listEditions": [edicion]}


def captura(  # noqa: PLR0913 - La respuesta varía su URL, cuerpo, hora, código y tipo de forma explícita.
    original: Path, url: str, cuerpo: bytes, *, fin: str, http: int = 200, tipo: str = "text/html"
) -> dict:
    """Conserva una respuesta con su recibo, como la deja el conector serial.

    Returns:
        La captura con sus referencias conservadas.
    """
    ref = conservar_bytes(original / "cuerpos", cuerpo, ".body")
    meta = {
        "url": url,
        "url_final": url,
        "http": http,
        "completo": True,
        "bytes": len(cuerpo),
        "cuerpo_sha256": ref.sha256,
        "inicio_utc": fin,
        "fin_utc": fin,
        "content_type": tipo,
        "error": None,
    }
    estable, evento = recibos.separar(recibos.canonico(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    e = conservar_bytes(original / "recepciones", evento, ".json")
    m = conservar_bytes(original / "metadatos", estable, ".json")
    return {
        "id": None,
        "cuerpo": comun.referencia_conservada(ref.ruta, original),
        "recibo": comun.referencia_conservada(e.ruta, original),
        "intento": comun.referencia_conservada(e.ruta, original),
        "metadatos": comun.referencia_conservada(m.ruta, original),
    }


class Instalacion:
    """Una instalación temporal con la procedencia anterior de la casa, donde se ejecuta `descargar`."""

    def __init__(self, caso: unittest.TestCase) -> None:
        """Crea la carpeta de originales del canal y la procedencia ocupacional que exige su vínculo."""
        area = tempfile.TemporaryDirectory()
        caso.addCleanup(area.cleanup)
        self.raiz = Path(area.name)
        self.original = a.rutas(self.raiz)[0]
        self.original.mkdir(parents=True)
        legado = {"fuente_id": "barcelonactiva", "archivos": []}
        (self.original.parent / "procedencia.json").write_bytes(recibos.canonico(legado))

    def ciclo(self, actividades: list[dict], hora: str, *, caidas: frozenset[int] = frozenset()) -> lectura.Resultado:
        """Recibe el censo de esas actividades a esa hora; las páginas de `caidas` responden 503.

        Returns:
            El resultado de la adquisición.
        """
        por_url = {a.NORMAS: captura(self.original, a.NORMAS, b"<html></html>", fin=hora)}
        for desde in range(0, len(actividades), 15):
            filas = actividades[desde : desde + 15]
            pagina = {"numActivities": len(actividades), "start": desde, "end": desde + len(filas), "activities": filas}
            url = a.url_pagina(desde)
            http = 503 if desde in caidas else 200
            por_url[url] = captura(
                self.original, url, recibos.canonico(pagina), fin=hora, http=http, tipo="application/json"
            )
        ruta = self.original / "procedencia.json"
        anterior = recibos.leer_json(ruta.read_bytes()) if ruta.exists() else {}
        with patch.object(comun, "recibir_url", side_effect=lambda url, *_a, **_k: por_url[url]):
            # Las actividades ya son conocidas con su título: el ciclo no pide fichas de altas.
            conocidos = [{"id": "cibernarium:" + x["activityId"], "titulo": x["title"]} for x in actividades]
            return a.descargar(conocidos, self.original, anterior)

    def lecturas(self, ambito: str) -> list[dict]:
        """Las lecturas guardadas de un ámbito, en el orden del almacén.

        Returns:
            Las lecturas del ámbito.
        """
        return [x for x in listar_lecturas(self.raiz, "barcelonactiva") if x["ambito"] == ambito]


class LecturaEnCadaCiclo(unittest.TestCase):
    """Cada ciclo de la adquisición deja su lectura por ámbito, encadenada con la anterior."""

    def test_dos_ciclos_dejan_dos_lecturas_encadenadas_por_ambito(self) -> None:
        """La segunda lectura cita la primera y lista quién entra y quién sale; sin catálogo nada se explica."""
        sitio = Instalacion(self)
        primero = sitio.ciclo([actividad(i) for i in (1, 2, 3)], "2026-11-15T05:00:10Z")
        segundo = sitio.ciclo([actividad(i) for i in (2, 3, 4)], "2026-11-16T05:00:10Z")
        self.assertEqual((len(primero.emisiones), primero.problemas), (2, ()))
        self.assertEqual((len(segundo.emisiones), segundo.problemas), (2, ()))
        for ambito, prefijo in (
            ("cibernarium:edicion", "cibernarium-edicion:"),
            ("cibernarium:programa", "cibernarium:"),
        ):
            antes, despues = sitio.lecturas(ambito)
            self.assertEqual(despues["anterior"], antes["lectura_id"])
            self.assertEqual(despues["observado_utc"], "2026-11-16T05:00:10Z")
            self.assertEqual(despues["entradas"], [prefijo + "4"])
            self.assertEqual(despues["salidas"], [{"id": prefijo + "1", "explicada_por": None}])
            self.assertEqual((despues["estado"], despues["recuento_bruto"]), ("sana", 3))
        programas = sitio.lecturas("cibernarium:programa")[-1]
        self.assertEqual(programas["total_declarado"], 3)

    def test_un_censo_con_una_pagina_caida_da_una_lectura_incompleta(self) -> None:
        """Si una página del censo no responde, la lectura dice que no llegó entero y por qué."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo([actividad(i) for i in range(1, 17)], "2026-11-15T05:00:10Z", caidas=frozenset({15}))
        self.assertEqual(resultado.problemas, ())
        for emision in resultado.emisiones:
            self.assertEqual(
                (emision.lectura["estado"], emision.lectura["motivo_incompleta"]), ("incompleta", "consulta_fallida")
            )
            self.assertEqual(emision.lectura["recuento_bruto"], 15)

    def test_un_codigo_de_matricula_desconocido_queda_anotado(self) -> None:
        """Un código fuera del vocabulario de matrícula queda en la forma y hace anómala la lectura."""
        sitio = Instalacion(self)
        resultado = sitio.ciclo([actividad(1), actividad(2, codigo="DISP9")], "2026-11-15T05:00:10Z")
        for emision in resultado.emisiones:
            self.assertEqual(
                emision.lectura["huella_forma"]["valores_nuevos"],
                [{"campo": "edicion.registrationCode", "valor": "DISP9"}],
            )
            self.assertIn("valor_desconocido", emision.lectura["motivos"])

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
        self.assertEqual(listar_lecturas(fallida.raiz, "barcelonactiva"), [])

    def test_una_lectura_anterior_a_la_guardada_se_dice_y_no_detiene_nada(self) -> None:
        """Volver a un censo más antiguo no parte la cadena: la adquisición termina y el problema queda dicho."""
        sitio = Instalacion(self)
        sitio.ciclo([actividad(1)], "2026-11-16T05:00:10Z")
        resultado = sitio.ciclo([actividad(1), actividad(2)], "2026-11-15T05:00:10Z")
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("se emiten en orden", resultado.problemas[0])

    def test_una_carpeta_que_no_es_de_una_instalacion_no_emite(self) -> None:
        """Sin instalación no hay dónde guardar: se dice y no se escribe nada."""
        resultado = lectura.emitir(
            Path("/originales"),
            {"fin_utc": "2026-11-15T05:00:10Z", "total_actividades": 1},
            [actividad(1)],
            {},
            completa=True,
        )
        self.assertEqual(resultado.emisiones, ())
        self.assertIn("no es la carpeta de originales", resultado.problemas[0])


def conocida(id: str, fin: str | None) -> dict:
    """Una edición del catálogo instalado con su fin publicado.

    Returns:
        La edición como la devuelve el catálogo.
    """
    return {"id": id, "programa_id": "cibernarium:" + id.split(":")[1], "datos": {"fechas_publicadas": {"fin": fin}}}


class ExplicarSalidas(unittest.TestCase):
    """Una salida se explica por su fin publicado; la de un programa, cuando terminaron todas sus ediciones."""

    def test_sale_con_su_fin_pasado_explicada_y_sin_fin_no(self) -> None:
        """La edición 1 terminó antes de la lectura; la 2 todavía no; la 3 no tiene fin conocido."""
        original = Instalacion(self).original
        conocidas = {
            "cibernarium-edicion:1": conocida("cibernarium-edicion:1", "2026-11-10T20:00:00+01:00"),
            "cibernarium-edicion:2": conocida("cibernarium-edicion:2", "2026-12-10T20:00:00+01:00"),
        }
        antes = {"fin_utc": "2026-11-01T05:00:00Z", "total_actividades": 4}
        lectura.emitir(original, antes, [actividad(i) for i in (1, 2, 3, 4)], {}, completa=True)
        despues = {"fin_utc": "2026-11-15T05:00:00Z", "total_actividades": 1}
        resultado = lectura.emitir(original, despues, [actividad(4)], conocidas, completa=True)
        ediciones, programas = (e.lectura for e in resultado.emisiones)
        esperadas = [("1", "fin_publicado"), ("2", None), ("3", None)]
        self.assertEqual(
            ediciones["salidas"], [{"id": "cibernarium-edicion:" + i, "explicada_por": x} for i, x in esperadas]
        )
        self.assertEqual(programas["salidas"], [{"id": "cibernarium:" + i, "explicada_por": x} for i, x in esperadas])


class DeclaracionesDeLaFuente(unittest.TestCase):
    """La inscripción cerrada, la falta de plazas y el fin publicado, citando su lectura."""

    def test_declaraciones_salen_con_su_lectura_y_las_lee_la_retirada(self) -> None:
        """Cada declaración cita la lectura de la captura y la regla de retirada la acepta tal cual."""
        sitio = Instalacion(self)
        censo = [actividad(1, **CERRADA), actividad(2, codigo="DISP3"), actividad(3)]
        ediciones = next(
            e.lectura
            for e in sitio.ciclo(censo, "2026-11-15T05:00:10Z").emisiones
            if e.lectura["ambito"] == "cibernarium:edicion"
        )
        declaradas = lectura.declaraciones(ediciones, censo)
        canales = {id: [d.canal for d in lista] for id, lista in declaradas.items()}
        self.assertEqual(
            canales,
            {
                "cibernarium-edicion:1": ["fin_publicado", "inscripcion_cerrada"],
                "cibernarium-edicion:2": ["fin_publicado", "sin_plazas"],
                "cibernarium-edicion:3": ["fin_publicado"],
            },
        )
        self.assertTrue(all(d.lectura_id == ediciones["lectura_id"] for lista in declaradas.values() for d in lista))
        self.assertEqual(declaradas["cibernarium-edicion:3"][0].cierra_el, "2026-12-31T22:59:00Z")
        for id, decision in (("cibernarium-edicion:1", "retirar"), ("cibernarium-edicion:3", "mantener")):
            curso = Curso(id=id, fuente="barcelonactiva", ambito="cibernarium:edicion", declaraciones=declaradas[id])
            self.assertEqual(decidir(curso, [ediciones]).decision, decision)

    def test_las_actividades_de_otra_captura_no_dan_declaraciones(self) -> None:
        """Las declaraciones solo salen de las actividades que dieron esa lectura."""
        sitio = Instalacion(self)
        emisiones = sitio.ciclo([actividad(1)], "2026-11-15T05:00:10Z").emisiones
        ediciones, programas = (e.lectura for e in emisiones)
        with self.assertRaises(lectura.ErrorLecturaCibernarium):
            lectura.declaraciones(ediciones, [actividad(2)])
        with self.assertRaises(lectura.ErrorLecturaCibernarium):
            lectura.declaraciones(programas, [actividad(1)])


# Presencia de cada edición en las lecturas del 21/10, 23/10, 25/10, 15/11 y 18/11, y cuántas la siguen
# (estudio de la base inteligente, `auditoria_coordinacion.json`, ámbito de ediciones de Cibernàrium).
PATRONES = {
    "11111": 396, "11100": 182, "00011": 39, "00001": 24, "11110": 23,
    "00010": 11, "11101": 7, "01111": 7, "11000": 1, "01100": 1,
}  # fmt: skip
LECTURAS = {2: "2026-10-25T05:00:00Z", 3: "2026-11-15T05:00:00Z", 4: "2026-11-18T05:00:00Z"}
# Las salidas sin fin publicado que contó la regla de salud: 15 el 15/11 (las 7 que volvieron, 8 más) y 8 el 18/11.
SIN_FIN = {"11101": 7, "11100": 8, "00010": 8}


class HistorialReal(unittest.TestCase):
    """Con los identificadores reales del 25/10, 15/11 y 18/11, la lectura del 15/11 sale anómala."""

    def test_la_lectura_del_15_11_sale_anomala_y_la_del_18_11_sana(self) -> None:
        """Salen 190 ediciones el 15/11 y 15 sin explicar superan el umbral; el 18/11, 8 sin explicar no."""
        original = Instalacion(self).original
        ediciones, conocidas, numero = {}, {}, 1000
        for patron, cuantas in PATRONES.items():
            for n in range(cuantas):
                numero += 1
                ediciones[numero] = patron
                fin = None if n < SIN_FIN.get(patron, 0) else "2026-11-01T20:00:00+01:00"
                conocidas[f"cibernarium-edicion:{numero}"] = conocida(f"cibernarium-edicion:{numero}", fin)
        estados = {}
        for posicion, hora in LECTURAS.items():
            presentes = [actividad(n) for n, patron in ediciones.items() if patron[posicion] == "1"]
            primera = {"fin_utc": hora, "total_actividades": len(presentes)}
            resultado = lectura.emitir(original, primera, presentes, conocidas, completa=True)
            self.assertEqual(resultado.problemas, ())
            estados[hora[:10]] = resultado.emisiones[0].lectura
        self.assertEqual(estados["2026-10-25"]["recuento_bruto"], 616)
        del_15 = estados["2026-11-15"]
        self.assertEqual(len(del_15["salidas"]), 190)
        self.assertEqual(sum(s["explicada_por"] is None for s in del_15["salidas"]), 15)
        self.assertEqual((del_15["estado"], del_15["motivos"]), ("anomala", ["salidas_no_explicadas_en_bloque"]))
        self.assertEqual(estados["2026-11-18"]["estado"], "sana")


if __name__ == "__main__":
    unittest.main()
