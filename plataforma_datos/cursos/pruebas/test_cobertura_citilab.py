"""Cobertura de las tres colecciones públicas de Citilab, sin red real."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from datetime import date
from email.message import Message
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.request import Request

import plataforma_datos.cursos.fuentes.citilab.lector as citilab
from plataforma_datos.comun import observacion_remota, red
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fuentes.citilab import paginacion

DIA = "2026-10-17"


def cabeceras(total: str = "1", paginas: str = "1") -> Message:
    """Cabeceras sintéticas: nunca se presentan como observadas en Citilab.

    Returns:
        Dos totales de prueba.
    """
    resultado = Message()
    resultado["X-WP-Total"] = total
    resultado["X-WP-TotalPages"] = paginas
    return resultado


class PruebaContratoWordPress(unittest.TestCase):
    """Un cuerpo corto solo es completo si concuerda con los totales declarados."""

    def test_lista_completa_y_vacia(self) -> None:
        """Una colección vacía declara cero páginas; una no vacía debe caber entera en una."""
        paginacion.totales_de_pagina(b"[{}]", cabeceras(), 1)
        paginacion.totales_de_pagina(b"[]", cabeceras("0", "0"), 1)

    def test_rechaza_pagina_parcial_aunque_contenga_menos_de_cien(self) -> None:
        """Un total mayor que el cuerpo revela registros omitidos aunque la página sea corta."""
        with self.assertRaises(FormatoInesperado):
            paginacion.totales_de_pagina(b"[{}]", cabeceras("2", "1"), 1)

    def test_rechaza_paginas_que_no_cuadran_con_sus_totales(self) -> None:
        """El número de páginas y el tamaño de cada una salen de los totales declarados."""
        cien = json.dumps([{}] * 100).encode()
        for cuerpo, total, paginas, numero in (
            (b"[{}]", "1", "2", 1),
            (cien, "100", "2", 1),
            (cien, "150", "1", 1),
            (b"[{}]", "150", "2", 2),
            (b"[{}]", "1", "1", 2),
        ):
            with self.subTest(total=total, paginas=paginas, numero=numero), self.assertRaises(FormatoInesperado):
                paginacion.totales_de_pagina(cuerpo, cabeceras(total, paginas), numero)

    def test_una_coleccion_de_mas_paginas_que_el_maximo_no_se_pide(self) -> None:
        """Pasar de MAX_PAGINAS se detiene con un error claro, antes de pedir la página siguiente."""
        cien = json.dumps([{}] * 100).encode()
        total = str(paginacion.POR_PAGINA * (paginacion.MAX_PAGINAS + 1))
        with self.assertRaisesRegex(FormatoInesperado, "máximo admitido"):
            paginacion.totales_de_pagina(cien, cabeceras(total, str(paginacion.MAX_PAGINAS + 1)), 1)
        limite = str(paginacion.POR_PAGINA * paginacion.MAX_PAGINAS)
        self.assertEqual(
            paginacion.totales_de_pagina(cien, cabeceras(limite, str(paginacion.MAX_PAGINAS)), 1),
            (int(limite), paginacion.MAX_PAGINAS),
        )

    def test_admite_cien_fichas_y_cada_pagina_completa(self) -> None:
        """Llegar a cien fichas ya no impide la copia: cada página trae lo que le toca."""
        cien = json.dumps([{}] * 100).encode()
        self.assertEqual(paginacion.totales_de_pagina(cien, cabeceras("100", "1"), 1), (100, 1))
        self.assertEqual(paginacion.totales_de_pagina(cien, cabeceras("150", "2"), 1), (150, 2))
        cincuenta = json.dumps([{}] * 50).encode()
        self.assertEqual(paginacion.totales_de_pagina(cincuenta, cabeceras("150", "2"), 2), (150, 2))

    def test_totales_obligatorios_enteros_estrictos_y_no_duplicados(self) -> None:
        """Un total ambiguo o ausente no permite afirmar que se recibió toda la colección."""
        for valor in ("", " 1", "1 ", "+1", "-1", "1.0", "1, 1", "01", "١", "9" * 100):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                paginacion.totales_de_pagina(b"[{}]", cabeceras(valor), 1)
        for nombre in ("X-WP-Total", "X-WP-TotalPages"):
            headers = cabeceras()
            del headers[nombre]
            with self.subTest(ausente=nombre), self.assertRaises(FormatoInesperado):
                paginacion.totales_de_pagina(b"[{}]", headers, 1)
            headers = cabeceras()
            headers[nombre.lower()] = "1"
            with self.subTest(duplicado=nombre), self.assertRaises(FormatoInesperado):
                paginacion.totales_de_pagina(b"[{}]", headers, 1)

    def test_rechaza_json_roto_y_forma_distinta(self) -> None:
        """Un error HTTP serializado como objeto tampoco representa una colección consultada."""
        for cuerpo in (b"[", b"{}", b"null", b'"texto"', b"\xff"):
            with self.subTest(cuerpo=cuerpo), self.assertRaises(FormatoInesperado):
                paginacion.totales_de_pagina(cuerpo, cabeceras(), 1)


class PruebaCoberturaCitilab(unittest.TestCase):
    """El recibo actual debe corresponder a los tres originales realmente admitidos."""

    def setUp(self) -> None:
        """Prepara originales y recepción independientes."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.carpeta = self.raiz / "var/actualizacion/originales/citilab"
        self.carpeta.mkdir(parents=True)
        self.archivos = paginacion.archivos_de_la_copia(DIA)
        self.registros = []
        self.evidencia = {
            "version": 2,
            "fuente": "citilab",
            "intento": "intento_1",
            "comienzo_utc": "2026-10-17T08:00:00+00:00",
            "fin_utc": "2026-10-17T08:01:00+00:00",
            "peticiones": [],
        }
        for numero, archivo in enumerate(self.archivos):
            datos = json.dumps([{"id": numero + 1}]).encode()
            (self.carpeta / archivo["archivo"]).write_bytes(datos)
            sha = hashlib.sha256(datos).hexdigest()
            self.registros.append(
                {
                    **archivo,
                    "url_final": archivo["url"],
                    "bytes": len(datos),
                    "sha256": sha,
                    "descargado_utc": "2026-10-06T08:00:00+00:00",
                }
            )
            self.evidencia["peticiones"].append(
                {
                    "recurso_sha256": observacion_remota.identidad_recurso(archivo["url"]),
                    "url_final_sha256": hashlib.sha256(archivo["url"].encode()).hexdigest(),
                    "respuesta_sha256": sha,
                    "bytes": len(datos),
                    "original_sha256": sha,
                    "original_bytes": len(datos),
                    "completado_utc": "2026-10-17T08:00:10+00:00",
                }
            )
        self.guardar()

    def guardar(self) -> None:
        """Escribe únicamente la procedencia de prueba."""
        (self.carpeta / "procedencia.json").write_text(json.dumps({"copia": DIA, "archivos": self.registros}))

    def comprobar(self) -> bool:
        """Consulta el contrato público.

        Returns:
            Cobertura de esta copia y recepción.
        """
        from plataforma_datos.cursos.fuentes.citilab.cobertura import comprobada

        return comprobada(self.raiz, self.evidencia)

    def test_tres_recursos_exactos_y_mismos_originales(self) -> None:
        """Solo la igualdad de tres respuestas completas con los originales acredita el conjunto."""
        self.assertTrue(self.comprobar())

    def test_orden_de_peticiones_no_importa(self) -> None:
        """El contrato identifica recursos por su consulta, sin depender del orden del transporte."""
        self.evidencia["peticiones"].reverse()
        self.assertTrue(self.comprobar())

    def test_reconstruir_copia_sin_http_no_renueva(self) -> None:
        """La admisión de archivos locales no demuestra que se haya consultado el servidor."""
        self.evidencia["peticiones"] = []
        self.assertFalse(self.comprobar())

    def test_no_basta_consultar_dos_recursos_o_repetir_uno(self) -> None:
        """Ambos vocabularios son necesarios; repetir fichas no cubre el recurso omitido."""
        original = copy.deepcopy(self.evidencia)
        self.evidencia["peticiones"].pop()
        self.assertFalse(self.comprobar())
        self.evidencia = original
        self.evidencia["peticiones"][2] = self.evidencia["peticiones"][0]
        self.assertFalse(self.comprobar())

    def test_otro_recurso_redireccion_y_respuesta_no_admitida(self) -> None:
        """Una respuesta ajena o no conservada no acredita el original utilizado por el módulo."""
        for campo, valor in (
            ("recurso_sha256", "0" * 64),
            ("url_final_sha256", "0" * 64),
            ("respuesta_sha256", "0" * 64),
            ("bytes", 999),
            ("original_sha256", None),
            ("original_bytes", None),
        ):
            evidencia = copy.deepcopy(self.evidencia)
            self.evidencia["peticiones"][0][campo] = valor
            with self.subTest(campo=campo):
                self.assertFalse(self.comprobar())
            self.evidencia = evidencia

    def test_archivo_cambiado_ausente_y_enlace_no_acreditan(self) -> None:
        """La recepción no autoriza usar bytes distintos ni resolver otro archivo mediante un enlace."""
        ruta = self.carpeta / self.archivos[0]["archivo"]
        datos = ruta.read_bytes()
        ruta.write_bytes(b"[]")
        self.assertFalse(self.comprobar())
        ruta.unlink()
        self.assertFalse(self.comprobar())
        destino = self.raiz / "otro.json"
        destino.write_bytes(datos)
        ruta.symlink_to(destino)
        self.assertFalse(self.comprobar())

    def test_procedencia_duplicada_otro_nombre_o_hash_no_acredita(self) -> None:
        """Los nombres son los tres canónicos; una procedencia alterada rompe el vínculo de bytes."""
        for cambio in ("duplicado", "ruta", "hash"):
            registros = copy.deepcopy(self.registros)
            if cambio == "duplicado":
                self.registros[2] = self.registros[0]
            elif cambio == "ruta":
                self.registros[0]["archivo"] = "../../otro.json"
            else:
                self.registros[0]["sha256"] = "0" * 64
            self.guardar()
            with self.subTest(cambio=cambio):
                self.assertFalse(self.comprobar())
            self.registros = registros

    def test_recepcion_v1_no_vincula_originales(self) -> None:
        """La primera versión solo acredita transporte y no prueba qué bytes se conservaron."""
        self.evidencia["version"] = 1
        self.assertFalse(self.comprobar())

    def test_procedencia_ausente_o_rota_no_acredita(self) -> None:
        """El lector común convierte estos fallos en ErrorFuente; la cobertura debe responder False."""
        ruta = self.carpeta / "procedencia.json"
        ruta.unlink()
        self.assertFalse(self.comprobar())
        ruta.write_text("{")
        self.assertFalse(self.comprobar())


class PruebaDescargaConHTTPEnMemoria(unittest.TestCase):
    """La fuente usa el transporte común, con identidad genérica validada y control antes de conservar."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    def test_descarga_completa_vincula_originales_y_conserva_datareader(self) -> None:
        """La llamada de retorno se integra con el transporte común y sus tres observaciones vinculadas."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "originales"
            recibo = Path(temporal) / "recepcion.json"
            peticiones = []

            def abrir(peticion: Request, **_opciones: object) -> HTTPResponse:
                peticiones.append(peticion)
                conexion = mock.Mock()
                conexion.makefile.return_value = io.BytesIO(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nX-WP-Total: 1\r\nX-WP-TotalPages: 1\r\n\r\n[{}]"
                )
                respuesta = HTTPResponse(conexion)
                respuesta.begin()
                respuesta.url = peticion.full_url
                return respuesta

            configuracion = {
                observacion_remota.VARIABLE_RECEPCION: json.dumps(
                    {"ruta": str(recibo), "fuente": "citilab", "intento": "intento_1"}
                )
            }
            with (
                mock.patch.dict(os.environ, configuracion),
                mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                mock.patch.object(citilab, "ORIGINAL", carpeta),
                mock.patch.object(citilab, "PROCEDENCIA", carpeta / "procedencia.json"),
                mock.patch.object(paginacion.time, "sleep"),
                observacion_remota.contexto_descarga(),
            ):
                citilab.descargar(hoy=date.fromisoformat(DIA))
            evidencia = observacion_remota.leer_recepcion(recibo, "citilab", "intento_1")
            self.assertEqual(len(evidencia["peticiones"]), 3)
            self.assertTrue(all(p.get_header("User-agent") == red.agente_de_usuario() for p in peticiones))
            self.assertTrue(all(p["original_sha256"] == p["respuesta_sha256"] for p in evidencia["peticiones"]))

    def test_pagina_parcial_no_se_conserva_ni_emite_recepcion(self) -> None:
        """El límite de cien no detectaba una lista corta cuyo total declaraba más registros."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "originales"
            recibo = Path(temporal) / "recepcion.json"

            def abrir(peticion: Request, **_opciones: object) -> HTTPResponse:
                conexion = mock.Mock()
                conexion.makefile.return_value = io.BytesIO(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nX-WP-Total: 2\r\nX-WP-TotalPages: 1\r\n\r\n[{}]"
                )
                respuesta = HTTPResponse(conexion)
                respuesta.begin()
                respuesta.url = peticion.full_url
                return respuesta

            configuracion = {
                observacion_remota.VARIABLE_RECEPCION: json.dumps(
                    {"ruta": str(recibo), "fuente": "citilab", "intento": "intento_1"}
                )
            }
            with (
                mock.patch.dict(os.environ, configuracion),
                mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                mock.patch.object(citilab, "ORIGINAL", carpeta),
                mock.patch.object(citilab, "PROCEDENCIA", carpeta / "procedencia.json"),
                mock.patch.object(paginacion.time, "sleep"),
                self.assertRaises(FormatoInesperado),
                observacion_remota.contexto_descarga(),
            ):
                citilab.descargar(hoy=date.fromisoformat(DIA))
            self.assertFalse(recibo.exists())
            self.assertFalse(carpeta.exists())

    @staticmethod
    def _respuesta_paginada(peticion: Request, **_opciones: object) -> HTTPResponse:
        """Fichas en dos páginas (150) y vocabularios de una; cuerpos y totales sintéticos.

        Returns:
            La respuesta HTTP en memoria de la página pedida.
        """
        segunda = peticion.full_url.endswith("&page=2")
        if "/formacio?" in peticion.full_url:
            cuerpo = json.dumps([{"id": n} for n in range(101, 151)] if segunda else [{"id": n} for n in range(1, 101)])
            total, paginas = "150", "2"
        else:
            cuerpo, total, paginas = "[{}]", "1", "1"
        datos = cuerpo.encode()
        conexion = mock.Mock()
        conexion.makefile.return_value = io.BytesIO(
            f"HTTP/1.1 200 OK\r\nContent-Length: {len(datos)}\r\nX-WP-Total: {total}\r\n"
            f"X-WP-TotalPages: {paginas}\r\n\r\n".encode()
            + datos
        )
        respuesta = HTTPResponse(conexion)
        respuesta.begin()
        respuesta.url = peticion.full_url
        return respuesta

    def test_coleccion_de_varias_paginas_se_conserva_entera_y_se_acredita(self) -> None:
        """Al pasar de cien fichas se piden todas las páginas, se registran sus totales y la copia cuadra."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpeta = raiz / "var/actualizacion/originales/citilab"
            recibo = raiz / "recepcion.json"
            configuracion = {
                observacion_remota.VARIABLE_RECEPCION: json.dumps(
                    {"ruta": str(recibo), "fuente": "citilab", "intento": "intento_1"}
                )
            }
            with (
                mock.patch.dict(os.environ, configuracion),
                mock.patch.object(red, "abrir_peticion", side_effect=self._respuesta_paginada),
                mock.patch.object(citilab, "ORIGINAL", carpeta),
                mock.patch.object(citilab, "PROCEDENCIA", carpeta / "procedencia.json"),
                mock.patch.object(paginacion.time, "sleep"),
                observacion_remota.contexto_descarga(),
            ):
                citilab.descargar(hoy=date.fromisoformat(DIA))
            registrada = json.loads((carpeta / "procedencia.json").read_text())
            self.assertEqual(registrada["totales"]["formacio"], {"total": 150, "paginas": 2})
            self.assertEqual(
                [r["archivo"] for r in registrada["archivos"]],
                [
                    f"formacio-{DIA}.json",
                    f"formacio-{DIA}-pagina-2.json",
                    f"public-{DIA}.json",
                    f"tipus-formacio-{DIA}.json",
                ],
            )
            with mock.patch.object(
                paginacion, "ultimo_original", side_effect=lambda _f, patron: carpeta / patron.replace("\\", "")
            ):
                fichas = paginacion.leer_coleccion(registrada, "formacio")
            self.assertEqual([f["id"] for f in fichas], list(range(1, 151)))
            evidencia = observacion_remota.leer_recepcion(recibo, "citilab", "intento_1")
            from plataforma_datos.cursos.fuentes.citilab.cobertura import comprobada

            self.assertTrue(comprobada(raiz, evidencia))
            evidencia["peticiones"] = [
                p
                for p in evidencia["peticiones"]
                if p["recurso_sha256"]
                != observacion_remota.identidad_recurso(paginacion.archivos_de_la_copia(DIA, {"formacio": 2})[1]["url"])
            ]
            self.assertFalse(comprobada(raiz, evidencia))

    def test_totales_que_cambian_entre_paginas_no_se_admiten(self) -> None:
        """Si la segunda página declara otro total, la colección cambió durante la descarga: no se registra la copia."""

        def abrir(peticion: Request, **_opciones: object) -> HTTPResponse:
            segunda = peticion.full_url.endswith("&page=2")
            filas = [{"id": n} for n in (range(101, 152) if segunda else range(1, 101))]
            total = "151" if segunda else "150"
            datos = json.dumps(filas).encode()
            conexion = mock.Mock()
            conexion.makefile.return_value = io.BytesIO(
                f"HTTP/1.1 200 OK\r\nContent-Length: {len(datos)}\r\nX-WP-Total: {total}\r\n"
                "X-WP-TotalPages: 2\r\n\r\n".encode()
                + datos
            )
            respuesta = HTTPResponse(conexion)
            respuesta.begin()
            respuesta.url = peticion.full_url
            return respuesta

        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "originales"
            with (
                mock.patch.object(red, "abrir_peticion", side_effect=abrir),
                mock.patch.object(citilab, "ORIGINAL", carpeta),
                mock.patch.object(citilab, "PROCEDENCIA", carpeta / "procedencia.json"),
                mock.patch.object(paginacion.time, "sleep"),
                self.assertRaisesRegex(FormatoInesperado, "cambian entre páginas"),
            ):
                citilab.descargar(hoy=date.fromisoformat(DIA))
            self.assertFalse((carpeta / "procedencia.json").exists())

    def test_copia_con_paginas_que_no_suman_el_total_no_se_lee(self) -> None:
        """Una página que falta o sobra en la procedencia no se lee como colección completa."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            (carpeta / f"formacio-{DIA}.json").write_text(json.dumps([{"id": 1}] * 100))
            registrada = {"copia": DIA, "totales": {"formacio": {"total": 150, "paginas": 1}}}
            with (
                mock.patch.object(
                    paginacion, "ultimo_original", side_effect=lambda _f, patron: carpeta / patron.replace("\\", "")
                ),
                self.assertRaisesRegex(FormatoInesperado, "150"),
            ):
                paginacion.leer_coleccion(registrada, "formacio")


if __name__ == "__main__":
    unittest.main()
