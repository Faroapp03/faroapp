"""Regresiones de descubrimiento y periodos independientes de INE y Eurostat."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.request import Request

import plataforma_datos.mercado.fuentes.empresas.lector as empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas as cifras_empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas as constantes_empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
import plataforma_datos.mercado.fuentes.empresas.piezas.controles_empresas as controles_empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.periodos_empresas as periodos_empresas
from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado
from plataforma_datos.comun.pruebas.test_observacion_remota import respuesta_http
from plataforma_datos.comun.pruebas.test_red_pausas import RelojVirtual
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine
from plataforma_datos.mercado.pruebas import ayuda_calendario
from plataforma_datos.mercado.pruebas.test_correspondencia_cnae import filas_de_prueba
from plataforma_datos.orquestacion import cobertura_empresas


def setUpModule() -> None:
    """Las fechas de cada edición, del recorte real del calendario del INE; ninguna prueba lo descarga de la red."""
    parche = ayuda_calendario.fechas_del_recorte()
    parche.start()
    unittest.addModuleCleanup(parche.stop)


class PruebaPeriodosEmpresas(unittest.TestCase):
    """Una publicación del INE no adelanta el año que realmente midió Eurostat."""

    def test_descubre_capitulos_con_dos_periodos(self) -> None:
        """El índice de 2026 contiene año previo y primer trimestre en el mismo título."""
        pagina = """
        <a href="/dynt3/inebase/index.htm?capsel=1">Las TIC en las empresas (2025 o primer trimestre de 2026)
        por agrupación de actividad económica (CNAE-25) y tamaño de la empresa</a>
        <a href="/dynt3/inebase/index.htm?capsel=2">Las TIC en las empresas (2025 o primer trimestre de 2026)</a>
        <a href="/dynt3/inebase/index.htm?capsel=3">Las TIC en las empresas con 10 o más empleados
        (2025 o primer trimestre de 2026) por sectores de actividad (CNAE-25)</a>
        <a href="/dynt3/inebase/index.htm?capsel=4">Errores de muestreo</a>
        """
        anio, capitulos = empresas.capitulos(pagina)
        self.assertEqual(anio, 2026)
        self.assertEqual(set(capitulos), {"sectores", "menos_de_10", "comunidades", "errores"})

    def test_vigencia_de_eurostat_conserva_su_propio_anio(self) -> None:
        """INE 2026 y Eurostat 2025 pueden coexistir sin atribuir los datos viejos al año nuevo."""
        edicion = {
            "anio": 2026,
            "nombre": "2025–1T2026",
            "eurostat": {"anio": 2025, "actualizado": "2026-06-15", "consulta": "22/10/2026"},
        }
        vigencias = cifras_empresas._vigencias(edicion)
        self.assertEqual(vigencias["ine"]["periodo"], "2026-T1")
        self.assertEqual(vigencias["eurostat"]["periodo"], "2025")
        self.assertEqual(vigencias["eurostat"]["publicado"], "2026-06-15")


def tabla_eurostat(territorio: str = "ES", anios: tuple[int, ...] = (2025,)) -> dict:
    """Documento JSON-stat mínimo con total y construcción, independiente de datos operativos.

    Returns:
        Tabla de prueba con las siete dimensiones y sus etiquetas contractuales.
    """
    dimensiones = {
        "freq": {"A": "Annual"},
        "size_emp": {"GE10": "10 persons employed or more"},
        "nace_r2": {"C10-S951_X_K": "Total", "F": "Construction"},
        "indic_is": {
            constantes_empresas.ETIQUETAS_EUROSTAT["indic_is"][0]: constantes_empresas.ETIQUETAS_EUROSTAT["indic_is"][1]
        },
        "unit": {"PC_ENT": "Percentage of enterprises"},
        "geo": {territorio: territorio},
        "time": {str(a): str(a) for a in anios},
    }
    tabla = {
        "class": "dataset",
        "id": list(dimensiones),
        "size": [len(v) for v in dimensiones.values()],
        "dimension": {
            k: {"label": k, "category": {"index": {c: i for i, c in enumerate(v)}, "label": v}}
            for k, v in dimensiones.items()
        },
        "value": [20.0] * len(anios) + [10.0] * len(anios),
        "updated": "2026-06-15T00:00:00Z",
    }
    tabla["dimension"]["nace_r2"]["label"] = constantes_empresas.CLASIFICACION_EUROSTAT
    return tabla


class PruebaContinuidadEurostat(unittest.TestCase):
    """La continuidad requiere un original íntegro, contrato válido y cifras ya admitidas."""

    def contexto(self) -> tuple[dict, dict]:
        """Prueba sintética de admisión de un documento anterior.

        Returns:
            Tabla y contexto de continuidad, sin escribir ni acceder a var.
        """
        tabla = tabla_eurostat()
        descriptor = empresas.archivo_de_eurostat(2025)
        cuerpo = json.dumps(tabla).encode()
        registro = {
            **descriptor,
            "url_final": descriptor["url"],
            "descargado_utc": "2026-10-06T14:52:09+00:00",
            "sha256": hashlib.sha256(cuerpo).hexdigest(),
            "bytes": len(cuerpo),
            "content_type": "application/json",
        }
        prueba = {
            "edicion": "2024–1T2025",
            "validacion": {
                "estado": "Admitido",
                "cobertura": {"edicion": "2024–1T2025"},
                "controles": [{"control": f"huella de {registro['archivo']}", "resultado": "correcto"}],
            },
            "registro": registro,
            "actualizacion": {"actualizado": "2026-06-15", "consulta": "06/10/2026"},
            "publicado": {
                "vigencia": {
                    "periodo": "2025",
                    "publicado": "2026-06-15",
                    "fuente": "Eurostat, consultada el 06/10/2026",
                },
                "agregados": {"F": {"pct": 10.0}},
            },
        }
        return tabla, prueba

    def test_html_vacio_y_json_ilegible_son_fallos_de_consulta(self) -> None:
        """Las respuestas no JSON no se convierten en ausencia de un año publicado."""
        url = empresas.archivo_de_eurostat_disponible(False)["url"]
        for cuerpo, tipo in [
            (b"", "application/json"),
            (b"<html>unavailable</html>", "text/html"),
            (b"{", "application/json"),
        ]:
            with self.subTest(tipo=tipo, cuerpo=cuerpo), self.assertRaises(periodos_empresas.ConsultaEurostatFallida):
                periodos_empresas.leer_respuesta(Descarga(cuerpo, url, tipo), url)

    def test_claves_repetidas_redireccion_y_nace_distinta_no_se_recuperan(self) -> None:
        """Los cambios semánticos o de identidad detienen la actualización, sin usar la continuidad."""
        url = empresas.archivo_de_eurostat_disponible(False)["url"]
        tabla = tabla_eurostat()
        tabla["dimension"]["nace_r2"]["label"] = "NACE Rev. 2.1"
        casos = [
            Descarga(b'{"value":{},"value":{}}', url, "application/json"),
            Descarga(json.dumps(tabla).encode(), url, "application/json"),
            Descarga(b"<html>", "https://ajeno.test/", "text/html"),
        ]
        for descarga in casos:
            with (
                self.subTest(descarga=descarga.url_final),
                mock.patch.object(empresas, "descargar_url", return_value=descarga),
                mock.patch.object(empresas, "_continuar_eurostat") as continuar,
                self.assertRaises(FormatoInesperado),
            ):
                empresas._eurostat_independiente(False, {}, True)
            continuar.assert_not_called()

    def test_ventana_incompleta_y_total_sin_cifra_firme_fallan(self) -> None:
        """Ni dos años regionales ni un periodo cuyo total no se publica constituyen una ventana completa."""
        incompleta = tabla_eurostat("ES51", (2023, 2025))
        sin_total = tabla_eurostat()
        sin_total["value"][0] = None
        for tabla, territorio in [(incompleta, "ES51"), (sin_total, "ES")]:
            with self.subTest(territorio=territorio), self.assertRaises(FormatoInesperado):
                periodos_empresas.filas_publicadas(tabla, territorio)

    def test_continuidad_reproduce_fechas_y_datos_admitidos(self) -> None:
        """Un original conocido conserva 2025 y su consulta de octubre, aunque INE avance a 2026."""
        tabla, prueba = self.contexto()
        self.assertEqual(periodos_empresas.comprobar_continuidad(tabla, prueba, False), [2025])
        for campo, valor in [("consulta", "22/10/2026"), ("actualizado", "2026-10-22")]:
            alterada = copy.deepcopy(prueba)
            alterada["actualizacion"][campo] = valor
            with self.subTest(campo=campo), self.assertRaises(FormatoInesperado):
                periodos_empresas.comprobar_continuidad(tabla, alterada, False)
        prueba["publicado"]["agregados"]["F"]["pct"] = 99.0
        with self.assertRaises(FormatoInesperado):
            periodos_empresas.comprobar_continuidad(tabla, prueba, False)

    def test_no_admitido_no_habilita_continuidad(self) -> None:
        """El contenido sintácticamente correcto no sustituye la admisión anterior."""
        tabla, prueba = self.contexto()
        for cambio in [{"estado": "Con errores"}, {"controles": []}]:
            alterada = copy.deepcopy(prueba)
            alterada["validacion"].update(cambio)
            with self.subTest(cambio=cambio), self.assertRaises(FormatoInesperado):
                periodos_empresas.comprobar_continuidad(tabla, alterada, False)

    def test_fallo_actual_reutiliza_solo_registro_y_cifras_verificados(self) -> None:
        """Se crea una prueba local transportable sin inventar una descarga histórica completa."""
        tabla, prueba = self.contexto()
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            registro = prueba["registro"]
            (carpeta / registro["archivo"]).write_bytes(json.dumps(tabla).encode())
            anterior = carpeta / "conjunto.json"
            anterior.write_text(json.dumps({"eurostat": prueba["publicado"]}))
            procedencia = {
                "edicion": {"anio": 2025, "nombre": prueba["edicion"]},
                "eurostat": prueba["actualizacion"],
                "archivos": [registro],
            }
            url = empresas.archivo_de_eurostat_disponible(False)["url"]
            with (
                mock.patch.object(empresas, "ORIGINAL", carpeta),
                mock.patch.object(empresas, "exigir_admitido", return_value=prueba["validacion"]),
                mock.patch.object(empresas, "ruta_del_conjunto", return_value=anterior),
                mock.patch.object(empresas, "descargar_url", return_value=Descarga(b"<html>", url, "text/html")),
            ):
                reutilizado, meta = empresas._eurostat_independiente(False, procedencia, True)
                self.assertEqual(reutilizado, registro)
                self.assertEqual(meta["consulta"], "06/10/2026")
                self.assertEqual(meta["anio"], 2025)
                self.assertEqual(meta["consulta_actual"]["estado"], "fallo_consulta")
                self.assertEqual(reutilizado["url"], empresas.archivo_de_eurostat(2025)["url"])
                self.assertTrue((carpeta / meta["continuidad"]["archivo"]).is_file())
                (carpeta / registro["archivo"]).write_bytes(b"alterado")
                with self.assertRaises(FormatoInesperado):
                    empresas._eurostat_independiente(False, procedencia, True)

    def test_notas_cambiadas_ausentes_y_duplicadas_rechazadas(self) -> None:
        """Una firma JSON idéntica no permite cambiar el denominador en el HTML."""
        notas = contrato_eticce.contrato()["partes"]["sectores"]["notas"]
        pagina = f'<ul id="capaListadoNotas"><li>{notas}</li></ul>'
        contrato_eticce.comprobar_notas("sectores", pagina)
        for alterada in [pagina.replace("con conexión a Internet", "totales"), pagina * 2, "sin notas"]:
            with self.subTest(alterada=alterada[:30]), self.assertRaises(FormatoInesperado):
                contrato_eticce.comprobar_notas("sectores", alterada)


def cuerpos_del_transporte() -> dict[str, bytes]:
    """Construye las respuestas sintéticas del índice, tablas y notas oficiales.

    Returns:
        Cuerpos por URL para comprobar el transporte sin consultas externas.
    """
    titulos = [
        "Las TIC en las empresas (2025 o primer trimestre de 2026) por agrupación de actividad",
        "Las TIC en las empresas (2025 o primer trimestre de 2026)",
        "Las TIC en las empresas con 10 o más empleados (2025 o primer trimestre de 2026) por sectores de actividad",
        "Errores de muestreo",
    ]
    indice = "".join(f'<a href="/capitulo?capsel={i}">{t}</a>' for i, t in enumerate(titulos))
    anio, direcciones = empresas.capitulos(indice)
    cuerpos = {empresas.RESULTADOS: indice.encode()}
    tablas = {}
    for i, (parte, url) in enumerate(direcciones.items(), 100):
        tablas[parte] = str(i)
        cuerpos[url] = f'<a href="/jaxi/Tabla.htm?tpx={i}">{empresas.CAPITULOS[parte][1]}</a>'.encode()
    edicion = {"anio": anio, "nombre": "2025–1T2026", "tablas": tablas}
    for descriptor in empresas.archivos_del_ine(edicion):
        cuerpos[descriptor["url"]] = json.dumps(
            [{"MetaData": [{"T3_Variable": "Pregunta", "Nombre": "D.1 IA"}], "Data": [{"Valor": 20}]}]
        ).encode()
    for parte in tablas:
        cuerpos[empresas.archivo_de_notas(parte, edicion)["url"]] = (
            b'<ul id="capaListadoNotas"><li>Notas propias</li></ul>'
        )
    for regional in (False, True):
        tabla = tabla_eurostat("ES51", (2023, 2024, 2025)) if regional else tabla_eurostat()
        cuerpos[empresas.archivo_de_eurostat_disponible(regional)["url"]] = json.dumps(tabla).encode()
    cuerpos[calendario_ine.URL] = ayuda_calendario.CUERPO
    return cuerpos


class PruebaTransporteContratoRevisado(unittest.TestCase):
    """Cada cuerpo se vincula antes del siguiente GET, incluidas las cuatro notas nuevas."""

    def setUp(self) -> None:
        """Usa una identidad genérica propia sin leer la configuración del operador."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        hogar = Path(temporal.name)
        self.agente = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        )
        (hogar / ".curlrc").write_text(f'user-agent = "{self.agente}"\n', encoding="utf-8")
        parche = mock.patch.object(Path, "home", return_value=hogar)
        parche.start()
        self.addCleanup(parche.stop)

    def test_dieciseis_get_vinculados_y_cada_recurso_necesario(self) -> None:
        """La regresión usa el transporte y el verificador reales con respuestas propias de tamaño pequeño."""
        cuerpos = cuerpos_del_transporte()
        reloj = RelojVirtual()
        inicios: list[float] = []

        def abrir(peticion: Request, timeout: float) -> HTTPResponse:
            inicios.append(reloj.leer())
            self.assertEqual(peticion.get_method(), "GET")
            self.assertEqual(peticion.get_header("User-agent"), self.agente)
            cuerpo = cuerpos[peticion.full_url]
            tipo = (
                ayuda_calendario.CABECERA
                if peticion.full_url == calendario_ine.URL
                else "Content-Type: application/json\r\n"
            )
            respuesta = respuesta_http(f"Content-Length: {len(cuerpo)}\r\n{tipo}".encode(), cuerpo)
            respuesta.url = peticion.full_url.replace("/js/", "/jsCache/", 1)
            return respuesta

        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpeta = raiz / "var/actualizacion/originales/empresas"
            recibo = raiz / "recibo.json"
            config = json.dumps({"ruta": str(recibo), "fuente": "empresas", "intento": "quince"})
            with (
                mock.patch.multiple(empresas, ORIGINAL=carpeta, PROCEDENCIA=carpeta / "procedencia.json"),
                mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                mock.patch.object(red, "PAUSAS", red.PausasPorDominio(reloj.leer, reloj.dormir)),
                mock.patch.object(contrato_eticce, "definicion_conocida", return_value=True),
                mock.patch.object(contrato_eticce, "comprobar_notas"),
                mock.patch.dict(os.environ, {observacion.VARIABLE_RECEPCION: config}),
                observacion.contexto_descarga(),
                redirect_stdout(io.StringIO()),
            ):
                empresas.descargar(True)
            evidencia = observacion.leer_recepcion(recibo, "empresas", "quince")
            self.assertEqual(len(evidencia["peticiones"]), 16)
            # Índice/capítulos del INE, tablas/notas alternas, las dos consultas Eurostat y el calendario del INE.
            turnos = [0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]
            self.assertEqual(inicios, [turno * red.PAUSA_ENTRE_PETICIONES_S for turno in turnos])
            self.assertEqual(reloj.esperas, [red.PAUSA_ENTRE_PETICIONES_S] * turnos[-1])
            self.assertTrue(all(p["original_sha256"] == p["respuesta_sha256"] for p in evidencia["peticiones"]))
            with (
                mock.patch.object(contrato_eticce, "definicion_conocida", return_value=True),
                mock.patch.object(contrato_eticce, "comprobar_notas"),
            ):
                self.assertTrue(cobertura_empresas.comprobada(raiz, evidencia))
                for i in range(len(evidencia["peticiones"])):
                    alterada = copy.deepcopy(evidencia)
                    alterada["peticiones"].pop(i)
                    with self.subTest(omitida=i):
                        self.assertFalse(cobertura_empresas.comprobada(raiz, alterada))


class PruebaSemanticaPublicacion(unittest.TestCase):
    """La consulta fallida y un año posterior no acreditan ausencia del año del INE."""

    def test_disponibilidad_fallida_no_declara_periodo_pendiente(self) -> None:
        """Una lectura antigua puede seguir admitida sin fingir que se comprobó el catálogo actual."""
        edicion = {
            "anio": 2026,
            "eurostat": {"anio": 2025, "anios_disponibles": [2025], "consulta_actual": {"estado": "fallo_consulta"}},
        }
        contraste = periodos_empresas.contraste_pendiente(edicion, "eurostat")
        self.assertEqual(contraste["disponibilidad"], "no_comprobada")
        self.assertEqual(contraste["ultimo_periodo_admitido"], "2025")
        self.assertEqual(contraste["estado"], "no_comparable")

    def test_anio_posterior_distingue_periodo_presente_y_no_observado(self) -> None:
        """Seleccionar 2027 no implica que falte 2026 ni autoriza a igualar sus periodos."""
        for publicados, esperado in [
            ([2025, 2026, 2027], "periodo_ine_publicado"),
            ([2025, 2027], "periodo_ine_no_observado_en_original"),
        ]:
            edicion = {
                "anio": 2026,
                "eurostat": {
                    "anio": 2027,
                    "anios_disponibles": publicados,
                    "consulta_actual": {"estado": "correcta"},
                },
            }
            with self.subTest(publicados=publicados):
                contraste = periodos_empresas.contraste_pendiente(edicion, "eurostat")
                self.assertEqual(contraste["disponibilidad"], esperado)
                self.assertEqual(contraste["periodo_eurostat"], "2027")
                self.assertEqual(contraste["estado"], "no_comparable")

    def test_ambito_ine_y_divisiones_del_paso_tienen_clasificacion_distinta(self) -> None:
        """45 puede conservar contexto Eurostat de 2009 sin atribuirlo al ámbito INE de 2025."""
        edicion = {"anio": 2026, "nombre": "2025–1T2026", "contrato_ine": contrato_eticce.IDENTIFICADOR}
        europa = [{"nace": "G45", "valor": 10.0, "marca": None}]
        with mock.patch.object(cifras_empresas, "cobertura_de_los_grupos", return_value={}):
            datos = cifras_empresas.conjunto(filas_de_prueba(), europa, [], edicion, {45, 56})
        self.assertNotIn("divisiones_que_mide", datos["encuesta"])
        self.assertIn("45", datos["encuesta"]["divisiones_del_paso_cnae2009"])
        self.assertEqual(datos["encuesta"]["ambito_ine_cnae2025"]["grupo_adicional"], "95.1")
        self.assertIsNone(datos["paso"]["45"]["ine"])
        self.assertEqual(datos["paso"]["45"]["eurostat"], "G45")
        controles = Controles()
        controles_empresas.comprobar_paso(controles, datos, {45, 56})
        self.assertIn("CNAE-2009", controles.lista[0]["control"])
        self.assertIn("no representa el ámbito CNAE-2025", controles.lista[0]["control"])


if __name__ == "__main__":
    unittest.main()
