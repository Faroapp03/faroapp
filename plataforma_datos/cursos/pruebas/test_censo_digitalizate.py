"""Censo de Digitalízate sin red: altas y bajas solo con un censo completo, con recortes de las respuestas reales.

`digitalizate-recorte.json` sale de dos respuestas públicas del 15/11/2026: `RecuperarEmpresasDigitalizate?baja=false&
idCatalogo=1` (sha256 b6cccfeb38b1b14b7ced75c9b171169b7685530a005e03c457e6e18b234b9624, solo el proveedor 78) y
`RecuperaDetalleEmpresaDigitalizate?baja=false&idCatalogo=1&idEmpresaDigitalizate=78` (sha256
cbd7d26083db4c40bf64faf4ee15eaac27d1b8392afcd8854543472540af7a66, solo los recursos 1880, «Curso», y 2743, «Vídeo
formativo»), con `numeroCursos` ajustado a los dos recursos del recorte.

`digitalizate-recorte-bajas.json` sale de tres respuestas públicas del 15/11/2026:
`RecuperarEmpresasDigitalizate?baja=true&idCatalogo=1` (sha256
e2b42bd578f4c5541205c94668619741acfdcc4c78ac2f2a00ddbe98d2747570, solo los proveedores 45, 46 y 39 de los 20),
`RecuperaDetalleEmpresaDigitalizate?baja=false&idCatalogo=1&idEmpresaDigitalizate=39` (sha256
2c8ae937f6e785a3690e1426ce3a99cca03122269a3602bbf9a672928ba82fe2, solo los recursos 3026, 3027 y 2531 de los 45) y la
misma con `idEmpresaDigitalizate=999999` (sha256 8da6661bbb16c201e5a81a957cb6e26158ce4429abe63ec23d177d65651b8a7c,
404 entero, sin recortar).
"""

import copy
import json
import sqlite3
import unittest
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any
from unittest.mock import patch

from plataforma_datos.cursos import componer_catalogo, operacion_fuente
from plataforma_datos.cursos.fuentes.fundae import actualizacion as fundae
from plataforma_datos.cursos.fuentes.fundae import adquisicion, censo_digitalizate, conocidos, estado_digitalizate
from plataforma_datos.cursos.pruebas import test_fundae_admision_catalogos as fixtures
from plataforma_datos.cursos.pruebas.test_fundae_ediciones import conservar

RECORTE = json.loads(Path(__file__).with_name("digitalizate-recorte.json").read_text(encoding="utf-8"))
BAJAS = json.loads(Path(__file__).with_name("digitalizate-recorte-bajas.json").read_text(encoding="utf-8"))
FIN = "2026-11-15T00:30:41Z"
CORTES = ("2026-11-15T01:00:00Z", "2026-11-15T02:00:00Z", "2026-11-15T03:00:00Z")
RETENIDO = "calculado-con-otras-identidades"
# Los dos recursos reales del recorte: un «Curso» y un «Vídeo formativo».
CURSO_REAL, VIDEO_REAL = 1880, 2743


def ficha(*recursos: dict[str, Any]) -> dict[str, Any]:
    """La ficha del proveedor 78 del recorte con esos recursos.

    Returns:
        La respuesta de la ficha.
    """
    dato = copy.deepcopy(RECORTE["empresa_78"])
    dato["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"] = list(recursos)
    return dato


def recurso(id: int, **cambios: object) -> dict[str, Any]:
    """Un recurso del recorte (el 1880, «Curso») con otra identidad y los cambios dados.

    Returns:
        El recurso.
    """
    base = copy.deepcopy(RECORTE["empresa_78"]["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"])
    return {**next(r for r in base if r["idRecursoFormativo"] == CURSO_REAL), "idRecursoFormativo": id, **cambios}


def video() -> dict[str, Any]:
    """El recurso 2743 del recorte, un «Vídeo formativo».

    Returns:
        El recurso.
    """
    base = RECORTE["empresa_78"]["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"]
    return copy.deepcopy(next(r for r in base if r["idRecursoFormativo"] == VIDEO_REAL))


class CensoDigitalizatePruebas(unittest.TestCase):
    """Sobre el almacén real de FUNDAE con dos recursos admitidos (fundae:1:1 y fundae:1:2)."""

    def setUp(self) -> None:
        """Almacén admitido, índices y una API simulada del censo."""
        self.caso = fixtures.AdmisionFundaePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.carpeta = self.caso.original

    def censo(  # noqa: PLR0913 - Cada caso del censo se arma con sus piezas explícitas.
        self,
        recursos: list[dict[str, Any]],
        *,
        publicados: int | None = None,
        ficha_http: int = 200,
        otros: list | None = None,
        siete: str | None = None,
        ficha_siete: tuple[int, object] | None = None,
    ) -> dict[str, Any]:
        """El documento del censo con las dos listas y las fichas conservadas como las recibe el canal.

        Args:
            recursos: Los recursos de la ficha del 78, que está en la lista activa.
            publicados: El `numeroCursos` del 78 (por omisión, los recursos de su ficha).
            ficha_http: El código de la ficha del 78.
            otros: Proveedores más en la lista activa, con su ficha caída.
            siete: Dónde está el proveedor 7 (el de las entidades admitidas): «activa» (0 cursos), «baja» o «ninguna».
            ficha_siete: (código, cuerpo) de la ficha del 7 si se pide.

        Returns:
            El documento del censo.
        """
        lista = copy.deepcopy(RECORTE["empresas"]) + (otros or [])
        lista[0]["numeroCursos"] = len(recursos) if publicados is None else publicados
        baja = copy.deepcopy(BAJAS["empresas_baja"])
        siete_en_lista = {**copy.deepcopy(RECORTE["empresas"][0]), "idEmpresaDigitalizate": 7, "numeroCursos": 0}
        if siete == "activa":
            lista.append(siete_en_lista)
        if siete == "baja":
            baja.append({**siete_en_lista, "baja": True})
        api = {
            censo_digitalizate.EMPRESAS: (200, lista),
            censo_digitalizate.EMPRESAS_BAJA: (200, baja),
            censo_digitalizate.url_detalle(78): (ficha_http, ficha(*recursos)),
        }
        for otro in otros or []:
            api[censo_digitalizate.url_detalle(otro["idEmpresaDigitalizate"])] = (503, {})
        if ficha_siete is not None:
            api[censo_digitalizate.url_detalle(7)] = ficha_siete
        self.pedidas: list[str] = []

        def recibir(url: str, carpeta: Path) -> dict[str, Any]:
            self.pedidas.append(url)
            http, dato = api[url]
            return conservar(carpeta, url, dato, http, FIN)

        return censo_digitalizate.consultar(self.carpeta, recibir, {7} if siete else set())

    def calcular(self, documento_censo: dict[str, Any], indice: tuple[int, ...] = (1,)) -> dict[str, Any]:
        """El conjunto del canal con el censo dado y el índice del catálogo 1 listando esos recursos.

        Returns:
            El conjunto calculado por el canal.
        """
        rx = self.caso.rx
        documento = copy.deepcopy(rx.documento)
        filas = [
            {"idRecursoFormativoBuscador": n + 1, "idRecursoFormativo": r, "idCatalogo": 1}
            for n, r in enumerate(indice)
        ]
        documento["auxiliares"]["digitalizate"] = rx.captura("digitalizate", {"respuesta": filas})
        documento["censo"] = documento_censo
        return adquisicion.calcular(self.carpeta, documento, conocidos.leer(self.caso.entrada))

    @staticmethod
    def presencia(conjunto: dict[str, Any], id: str) -> tuple[object, object]:
        """Lo que dice la observación de una entidad conocida.

        Returns:
            (lectura_completa, presente).
        """
        observacion = next(o["observacion"] for o in conjunto["observaciones_catalogo"] if o["id"] == id)
        return observacion["detalle"]["lectura_completa"], observacion["detalle"]["presente"]

    def test_censo_completo_alta_baja_y_lo_que_no_cumple_el_criterio(self) -> None:
        """El 1880 nuevo entra, el vídeo no; el 1 sigue, el 2 falta (baja) y uno con `baja: true` también se retira."""
        conjunto = self.calcular(self.censo([recurso(1880), video(), recurso(1), recurso(3, baja=True)]))
        self.assertTrue(conjunto["censo"]["completo"])
        self.assertEqual(conjunto["censo"]["altas"], [1880])
        self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))
        self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))
        # La fecha de la presencia es la de la consulta que la acredita, no la del día en que se aplica.
        observacion = next(o["observacion"] for o in conjunto["observaciones_catalogo"] if o["id"] == "fundae:1:2")
        self.assertEqual(observacion["terminado_el"], FIN)
        lectura = censo_digitalizate.leer(self.carpeta, conjunto["censo"]["documento"])
        self.assertEqual(estado_digitalizate.estado(lectura, 3, 78, True), (True, False, None))

    def test_censo_parcial_por_ficha_caida_o_recuento_ni_altas_ni_bajas(self) -> None:
        """Una ficha en 503 o un recuento que no cuadra: sin altas, y la ausencia queda sin noticia."""
        for documento, motivo in (
            (self.censo([recurso(1880)], ficha_http=503), censo_digitalizate.FICHAS_CAIDAS),
            (self.censo([recurso(1880), recurso(1)], publicados=5), censo_digitalizate.RECUENTO),
        ):
            conjunto = self.calcular(documento)
            with self.subTest(motivo):
                self.assertFalse(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], motivo)
                self.assertEqual(conjunto["censo"]["altas"], [])
                self.assertNotEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_proveedor_nuevo_con_su_ficha_caida_deja_el_censo_sin_completar(self) -> None:
        """Un proveedor nuevo de la lista activa con su ficha caída: censo sin completar."""
        otro = {**copy.deepcopy(RECORTE["empresas"][0]), "idEmpresaDigitalizate": 99, "numeroCursos": 1}
        parcial = self.calcular(self.censo([recurso(1880)], otros=[otro]))
        self.assertEqual(parcial["censo"]["motivo"], censo_digitalizate.FICHAS_CAIDAS)

    def test_el_alta_entra_en_el_almacen_con_su_destino_y_su_proveedor(self) -> None:
        """Aplicado al almacén, el 1880 queda como programa con su `urlCurso`, su proveedor y su presencia."""
        conjunto = self.calcular(self.censo([recurso(1880), recurso(1)]))
        destino = self.caso.raiz / "destino"
        fundae.aplicar(
            self.caso.entrada, conjunto=conjunto, original=self.carpeta, destino=destino, corte="2026-11-15T01:00:00Z"
        )
        with closing(sqlite3.connect(destino / "catalogo.sqlite3")) as conexion:
            fila = conexion.execute("SELECT url, datos FROM programas WHERE id='fundae:1:1880'").fetchone()
        self.assertIsNotNone(fila)
        self.assertEqual(fila[0], "https://www.youtube.com/watch?v=ayVZ96XnT5A")
        self.assertEqual(json.loads(fila[1])["entidad_publicada"]["nombre"], "Airbus")

    def test_un_recurso_sin_baja_leible_queda_sin_noticia_y_el_resto_sigue(self) -> None:
        """Sin el campo `baja` (o con otro valor), ese recurso no entra ni se retira, con su motivo; el resto sigue."""
        sin_baja = recurso(1880)
        del sin_baja["baja"]
        for caso in (sin_baja, recurso(1880, baja=None)):
            conjunto = self.calcular(self.censo([caso, recurso(1)]))
            with self.subTest(baja=caso.get("baja", "ausente")):
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [])
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))

    def test_proveedor_conocido_en_la_lista_de_baja(self) -> None:
        """Retirados con la lista de baja como evidencia, sin pedir su ficha; con el buscador listándolos, aviso."""
        conjunto = self.calcular(self.censo([recurso(1880), recurso(1)], siete="baja"), indice=(1,))
        self.assertNotIn(censo_digitalizate.url_detalle(7), self.pedidas)
        self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))
        observacion = next(o["observacion"] for o in conjunto["observaciones_catalogo"] if o["id"] == "fundae:1:2")
        self.assertEqual(observacion["url_consultada"], censo_digitalizate.EMPRESAS_BAJA)
        listado = self.calcular(self.censo([recurso(1880), recurso(1)], siete="baja"), indice=(1, 2))
        self.assertEqual(self.presencia(listado, "fundae:1:2"), (False, None))
        self.assertEqual(listado["censo"]["motivo"], censo_digitalizate.CONTRADICE)

    def test_proveedor_fuera_de_las_dos_listas_segun_su_ficha(self) -> None:
        """404 «ya no está disponible»: retirados; 200: sin noticia y aviso, sin presencia ni altas; 503: parcial."""
        no_existe = (404, BAJAS["empresa_inexistente"]["cuerpo"])
        retirado = self.calcular(self.censo([recurso(1880)], siete="ninguna", ficha_siete=no_existe), indice=(21,))
        self.assertIn(censo_digitalizate.url_detalle(7), self.pedidas)
        self.assertEqual(retirado["censo"]["no_disponibles"], [7])
        self.assertEqual(self.presencia(retirado, "fundae:1:1"), (True, False))
        con_recursos = ficha(recurso(1), recurso(3026))
        con_recursos["respuesta"]["idEmpresaDigitalizate"] = 7
        vivo = self.calcular(self.censo([recurso(1880)], siete="ninguna", ficha_siete=(200, con_recursos)), indice=(1,))
        self.assertEqual(self.presencia(vivo, "fundae:1:1"), (False, None))
        self.assertEqual(vivo["censo"]["motivo"], censo_digitalizate.CONTRADICE)
        self.assertNotIn(3026, vivo["censo"]["altas"])
        caido = self.calcular(self.censo([recurso(1880)], siete="ninguna", ficha_siete=(503, {})))
        self.assertEqual(caido["censo"]["motivo"], censo_digitalizate.FICHAS_CAIDAS)

    def evidencia_de_la_baja(self, conjunto: dict[str, Any], id: str) -> dict[str, Any]:
        """La evidencia que cita la observación de una entidad.

        Returns:
            Su `url_consultada` y la huella de la evidencia citada.
        """
        observacion = next(o["observacion"] for o in conjunto["observaciones_catalogo"] if o["id"] == id)
        return {"url": observacion["url_consultada"], "sha256": observacion["evidencias"][0]["sha256"]}

    def test_la_baja_cita_la_evidencia_que_la_afirma(self) -> None:
        """Por la lista de baja, cita esa lista; por el 404, su captura; por faltar de su ficha activa, esa ficha."""
        lista_baja = self.calcular(self.censo([recurso(1880), recurso(1)], siete="baja"))
        self.assertEqual(self.evidencia_de_la_baja(lista_baja, "fundae:1:2")["url"], censo_digitalizate.EMPRESAS_BAJA)
        no_existe = (404, BAJAS["empresa_inexistente"]["cuerpo"])
        documento = self.censo([recurso(1880)], siete="ninguna", ficha_siete=no_existe)
        retirado = self.calcular(documento, indice=(21,))
        cita = self.evidencia_de_la_baja(retirado, "fundae:1:1")
        self.assertEqual(cita["url"], censo_digitalizate.url_detalle(7))
        self.assertEqual(cita["sha256"], documento["fichas"]["7"]["cuerpo"]["sha256"])
        vacia = ficha()
        vacia["respuesta"]["idEmpresaDigitalizate"] = 7
        documento = self.censo([recurso(1880)], siete="activa", ficha_siete=(200, vacia))
        ficha_activa = self.calcular(documento, indice=(21,))
        cita = self.evidencia_de_la_baja(ficha_activa, "fundae:1:2")
        self.assertEqual(cita["url"], censo_digitalizate.url_detalle(7))
        self.assertEqual(cita["sha256"], documento["fichas"]["7"]["cuerpo"]["sha256"])

    def test_la_ficha_de_un_proveedor_dado_de_baja_no_se_pide_ni_da_altas(self) -> None:
        """Aunque la ficha de un proveedor dado de baja traiga sus recursos como activos (como la del 39), no cuenta."""
        como_la_39 = copy.deepcopy(BAJAS["empresa_39"])
        como_la_39["respuesta"]["idEmpresaDigitalizate"] = 7
        como_la_39["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"] += [recurso(1), recurso(2)]
        documento = self.censo([recurso(1880)], siete="baja", ficha_siete=(200, como_la_39))
        conjunto = self.calcular(documento, indice=(21,))
        self.assertNotIn(censo_digitalizate.url_detalle(7), self.pedidas)
        self.assertNotIn(censo_digitalizate.url_detalle(39), self.pedidas)
        self.assertEqual(conjunto["censo"]["altas"], [1880])
        self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, False))
        self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_activo_que_el_buscador_no_lista_sigue_presente_con_aviso(self) -> None:
        """La ficha de un proveedor activo lo trae: presente aunque el buscador no lo liste, con aviso."""
        conjunto = self.calcular(self.censo([recurso(1880), recurso(1)]), indice=(21,))
        self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))
        self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.CONTRADICE)
        self.assertEqual(conjunto["censo"]["contradicen"], ["fundae:1:1"])

    def test_un_proveedor_activo_a_cero_con_su_ficha_vacia_y_sin_buscador_se_retira(self) -> None:
        """El 7 sigue activo con 0 cursos, su ficha responde vacía y el buscador no lista sus recursos: baja."""
        vacia = ficha()
        vacia["respuesta"]["idEmpresaDigitalizate"] = 7
        conjunto = self.calcular(self.censo([recurso(1880)], siete="activa", ficha_siete=(200, vacia)), indice=(21,))
        self.assertTrue(conjunto["censo"]["completo"])
        self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_sin_indice_respondido_no_hay_bajas(self) -> None:
        """Con el buscador del catálogo 1 caído, lo que falta de las fichas queda sin noticia."""
        rx = self.caso.rx
        documento = copy.deepcopy(rx.documento)
        documento["auxiliares"]["digitalizate"] = rx.captura("digitalizate", {}, http=503)
        documento["censo"] = self.censo([recurso(1880), recurso(1)])
        conjunto = adquisicion.calcular(self.carpeta, documento, conocidos.leer(self.caso.entrada))
        self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (False, None))
        self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))

    def test_curso_renombrado_no_retira_nada(self) -> None:
        """Si la ficha llama «Curso online» al tipo 1, o «Curso» a otro número, ni altas ni bajas, con el motivo."""
        for numero, nombre in ((1, "Curso online"), (7, "Curso")):
            with self.subTest(numero=numero, nombre=nombre):
                self.renombrado(numero, nombre)

    def renombrado(self, numero: int, nombre: str) -> None:
        """Comprueba la ficha del 78 con el tipo «Curso» declarado como (`numero`, `nombre`)."""
        dato = ficha(
            recurso(1880, idTipoRecurso=numero, tipoRecurso=nombre),
            recurso(1, idTipoRecurso=numero, tipoRecurso=nombre),
        )
        for tipo in dato["filtros"]["tiposRecursos"]:
            if tipo["id"] == 1:
                tipo["id"], tipo["name"] = numero, nombre
        lista = copy.deepcopy(RECORTE["empresas"])
        lista[0]["numeroCursos"] = 2
        api = {
            censo_digitalizate.EMPRESAS: (200, lista),
            censo_digitalizate.EMPRESAS_BAJA: (200, BAJAS["empresas_baja"]),
            censo_digitalizate.url_detalle(78): (200, dato),
        }
        documento = censo_digitalizate.consultar(
            self.carpeta, lambda url, carpeta: conservar(carpeta, url, api[url][1], api[url][0], FIN), set()
        )
        conjunto = self.calcular(documento, indice=(21,))
        self.assertFalse(conjunto["censo"]["completo"])
        self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
        self.assertNotEqual(self.presencia(conjunto, "fundae:1:1"), (True, False))
        self.assertNotEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_tipos_fuera_de_lo_declarado(self) -> None:
        """Un par que la ficha no declara o un recurso sin tipo quedan sin noticia, con el motivo; el resto sigue."""
        sin_tipo = recurso(1)
        del sin_tipo["idTipoRecurso"]
        itinerario = recurso(1, idTipoRecurso=5, tipoRecurso="Itinerario formativo")
        for caso in (itinerario, sin_tipo):
            conjunto = self.calcular(self.censo([recurso(1880), caso, recurso(2)]), indice=(21,))
            with self.subTest(tipo=caso.get("idTipoRecurso", "ausente")):
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (False, None))
                self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, True))
                self.assertEqual(conjunto["censo"]["altas"], [1880])

    def censo_de_ficha(self, dato: object, otras: dict[int, object] | None = None) -> dict[str, Any]:
        """El documento del censo con esa ficha para el 78 (y las de otros proveedores activos, si se dan).

        Returns:
            El documento del censo.
        """
        lista = copy.deepcopy(RECORTE["empresas"])
        lista[0]["numeroCursos"] = 2
        for id in otras or {}:
            lista.append({**copy.deepcopy(RECORTE["empresas"][0]), "idEmpresaDigitalizate": id, "numeroCursos": 2})
        api = {
            censo_digitalizate.EMPRESAS: lista,
            censo_digitalizate.EMPRESAS_BAJA: BAJAS["empresas_baja"],
            censo_digitalizate.url_detalle(78): dato,
        }
        api.update({censo_digitalizate.url_detalle(id): otra for id, otra in (otras or {}).items()})
        return censo_digitalizate.consultar(
            self.carpeta, lambda url, carpeta: conservar(carpeta, url, api[url], 200, FIN), set()
        )

    def test_forma_inesperada_de_una_ficha_deja_el_censo_sin_completar_sin_fallar(self) -> None:
        """Ficha con otro tipo de dato: sin excepción, sin altas ni bajas, con el motivo de forma inesperada."""

        def con(cambio: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
            dato = ficha(recurso(1880), recurso(1))
            cambio(dato)
            return dato

        def categoria(dato: dict[str, Any]) -> dict[str, Any]:
            return dato["respuesta"]["digitalizateCategoria"][0]

        casos = {
            "filtros_lista": lambda d: d.update(filtros=[]),
            "filtros_texto": lambda d: d.update(filtros="x"),
            "tipo_id_texto": lambda d: d["filtros"]["tiposRecursos"].append({"id": "1", "name": "Curso"}),
            "tipo_id_logico": lambda d: d["filtros"]["tiposRecursos"].append({"id": True, "name": "Otro"}),
            "tipo_name_objeto": lambda d: d["filtros"]["tiposRecursos"].append({"id": 9, "name": {"a": 1}}),
            "tipo_name_lista": lambda d: d["filtros"]["tiposRecursos"].append({"id": 9, "name": ["a"]}),
            "categoria_texto": lambda d: d["respuesta"].update(digitalizateCategoria=["x"]),
            "categoria_lista": lambda d: d["respuesta"].update(digitalizateCategoria=[[]]),
            "categorias_objeto": lambda d: d["respuesta"].update(digitalizateCategoria={"a": 1}),
            "recursos_objeto": lambda d: categoria(d).update(digitalizateRecursoFormativo={"a": 1}),
            "recursos_texto": lambda d: categoria(d).update(digitalizateRecursoFormativo="x"),
            "recurso_texto": lambda d: categoria(d)["digitalizateRecursoFormativo"].append("x"),
            "recurso_lista": lambda d: categoria(d)["digitalizateRecursoFormativo"].append([1]),
        }
        for nombre, cambio in casos.items():
            with self.subTest(nombre):
                conjunto = self.calcular(self.censo_de_ficha(con(cambio)), indice=(21,))
                self.assertFalse(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [])
                self.assertNotEqual(self.presencia(conjunto, "fundae:1:1"), (True, False))
                self.assertNotEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_un_recurso_con_tipo_de_otro_dato_queda_sin_noticia_y_el_resto_sigue(self) -> None:
        """`tipoRecurso` o `idTipoRecurso` con otro tipo de dato: ese recurso sin noticia, sin excepción ni baja."""
        for nombre, cambio in (
            ("tipo_lista", {"tipoRecurso": ["Curso"]}),
            ("tipo_objeto", {"tipoRecurso": {"a": 1}}),
            ("tipo_numero", {"tipoRecurso": 1}),
            ("id_tipo_texto", {"idTipoRecurso": "1"}),
            ("id_tipo_lista", {"idTipoRecurso": [1]}),
            ("id_tipo_logico", {"idTipoRecurso": True}),
        ):
            with self.subTest(nombre):
                conjunto = self.calcular(self.censo([recurso(1880), recurso(1, **cambio), recurso(2)]), indice=(21,))
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (False, None))
                self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, True))
                self.assertEqual(conjunto["censo"]["altas"], [1880])

    def test_un_alta_sin_su_titulo_o_sin_el_nombre_de_su_proveedor_queda_sin_noticia(self) -> None:
        """Sin lo que lee el alta (falta, no es texto o está vacío): ese recurso sin noticia, sin excepción ni alta."""
        sin_titulo = recurso(1880)
        del sin_titulo["denominacion"]
        gratuidad = [{**c, "descripcionCard": 5} for c in recurso(1880)["catalogos"]]
        for nombre, caso in (
            ("titulo_ausente", sin_titulo),
            ("titulo_nulo", recurso(1880, denominacion=None)),
            ("titulo_vacio", recurso(1880, denominacion="  ")),
            ("titulo_numero", recurso(1880, denominacion=5)),
            ("titulo_lista", recurso(1880, denominacion=["x"])),
            ("gratuidad_numero", recurso(1880, catalogos=gratuidad)),
        ):
            with self.subTest(nombre):
                conjunto = self.calcular(self.censo([caso, recurso(3), recurso(1)]), indice=(1, 3, 1880))
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [3])
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))
        # Un recurso que no pertenece (un vídeo) sin título no estorba.
        sin_titulo_video = video()
        del sin_titulo_video["denominacion"]
        conjunto = self.calcular(self.censo([sin_titulo_video, recurso(3), recurso(1)]), indice=(1, 3))
        self.assertIsNone(conjunto["censo"]["motivo"])
        self.assertEqual(conjunto["censo"]["altas"], [3])

    def test_un_recurso_con_un_catalogo_que_no_es_un_objeto_queda_sin_noticia(self) -> None:
        """`catalogos` con un texto o un nulo entre sus elementos: sin excepción, sin alta y el resto sigue."""
        propio = recurso(1880)["catalogos"][0]
        for nombre, intruso in (("texto", "x"), ("nulo", None), ("lista", [propio])):
            with self.subTest(nombre):
                caso = recurso(1880, catalogos=[intruso, propio])
                conjunto = self.calcular(self.censo([caso, recurso(3), recurso(1)]), indice=(1, 3, 1880))
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [3])
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))

    def test_un_proveedor_sin_nombre_no_da_altas_pero_no_retira_nada(self) -> None:
        """Nombre, marca o dirección del proveedor con otra forma: sus recursos que pertenecen quedan sin noticia."""
        for nombre, cambio in (
            ("nombre_ausente", {"nombre": None}),
            ("nombre_vacio", {"nombre": ""}),
            ("nombre_numero", {"nombre": 5}),
            ("nombre_lista", {"nombre": ["x"]}),
            ("marca_numero", {"marcaComercial": 5}),
            ("url_objeto", {"url": {"a": 1}}),
        ):
            dato = ficha(recurso(1880), recurso(1))
            dato["respuesta"].update(cambio)
            with self.subTest(nombre):
                conjunto = self.calcular(self.censo_de_ficha(dato), indice=(1, 1880))
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [])
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (False, None))
                self.assertEqual(self.presencia(conjunto, "fundae:1:2"), (True, False))

    def test_el_mismo_recurso_en_dos_proveedores_activos(self) -> None:
        """Si las dos fichas coinciden en baja y tipo, cuenta una vez; si no, ese recurso queda sin noticia."""
        otra = ficha(recurso(1880), recurso(1))
        otra["respuesta"]["idEmpresaDigitalizate"] = 79
        igual = self.calcular(self.censo_de_ficha(ficha(recurso(1880), recurso(1)), {79: otra}), indice=(1880, 1))
        self.assertTrue(igual["censo"]["completo"])
        self.assertIsNone(igual["censo"]["motivo"])
        self.assertEqual(igual["censo"]["altas"], [1880])
        for cambio in ({"baja": True}, {"idTipoRecurso": 2, "tipoRecurso": "Vídeo formativo"}):
            discrepante = ficha(recurso(1880, **cambio), recurso(1))
            discrepante["respuesta"]["idEmpresaDigitalizate"] = 79
            conjunto = self.calcular(self.censo_de_ficha(ficha(recurso(1880), recurso(1)), {79: discrepante}))
            with self.subTest(cambio):
                self.assertTrue(conjunto["censo"]["completo"])
                self.assertEqual(conjunto["censo"]["motivo"], censo_digitalizate.FORMA)
                self.assertEqual(conjunto["censo"]["altas"], [])
                self.assertEqual(self.presencia(conjunto, "fundae:1:1"), (True, True))

    def test_repetidos_tope_y_cambio_de_tipo(self) -> None:
        """Repetidos, tope de proveedores y un conocido que deja de ser «Curso».

        Un repetido idéntico cuenta una vez y uno distinto es forma inesperada; más de 100 proveedores no paran la
        fuente; un conocido que deja de ser «Curso» se retira por esa lectura.
        """
        igual = self.calcular(self.censo([recurso(1880), recurso(1880), recurso(1)], publicados=2))
        self.assertTrue(igual["censo"]["completo"])
        distinto = self.calcular(self.censo([recurso(1880), recurso(1880, denominacion="Otro"), recurso(1)]))
        self.assertEqual(distinto["censo"]["motivo"], censo_digitalizate.FORMA)
        muchos = [{**copy.deepcopy(RECORTE["empresas"][0]), "idEmpresaDigitalizate": 1000 + n} for n in range(101)]
        tope = self.calcular(self.censo([recurso(1880)], otros=muchos))
        self.assertEqual(tope["censo"]["motivo"], censo_digitalizate.TOPE)
        video_ahora = self.calcular(self.censo([recurso(1, idTipoRecurso=2, tipoRecurso="Vídeo formativo")]))
        self.assertEqual(self.presencia(video_ahora, "fundae:1:1"), (True, False))

    def test_el_lote_de_altas_lleva_la_fecha_de_su_ficha(self) -> None:
        """La ejecución del lote de altas queda con la hora de la consulta que las acredita, no con la de aplicarlo."""
        conjunto = self.calcular(self.censo([recurso(1880), recurso(1)]))
        destino = self.caso.raiz / "destino"
        fundae.aplicar(
            self.caso.entrada, conjunto=conjunto, original=self.carpeta, destino=destino, corte="2026-11-15T01:00:00Z"
        )
        with closing(sqlite3.connect(destino / "catalogo.sqlite3")) as conexion:
            fila = conexion.execute(
                "SELECT observado_utc FROM ejecuciones WHERE fuente_lote='fundae:censo-digitalizate:1'"
            ).fetchone()
        self.assertEqual(fila[0], FIN)

    def test_dos_conjuntos_sobre_la_misma_base_se_aplican_aunque_el_primero_de_altas(self) -> None:
        """El segundo se compara con las identidades de partida y se vuelve a calcular sobre el almacén ya con altas."""
        base = self.caso.raiz / "base"
        sin_altas = self.calcular(self.censo([recurso(1), recurso(2)]), indice=(1, 2))
        fundae.aplicar(self.caso.entrada, conjunto=sin_altas, original=self.carpeta, destino=base, corte=CORTES[0])
        primero = self.calcular(self.censo([recurso(1880), recurso(1), recurso(2)]), indice=(1, 2, 1880, 3))
        segundo = self.calcular(self.censo([recurso(1880), recurso(3), recurso(1), recurso(2)]), indice=(1, 2, 1880, 3))
        self.assertEqual(primero["censo"]["altas"], [1880])
        self.assertEqual(segundo["censo"]["altas"], [3, 1880])
        con_altas, ambos = self.caso.raiz / "con-altas", self.caso.raiz / "ambos"
        with patch.object(operacion_fuente, "rutas_de_la_fuente", return_value=(self.carpeta, None, None)):
            with patch.object(conocidos, "leer", wraps=conocidos.leer) as lectura_original:
                repetido = componer_catalogo._aplicar_fundae(self.caso.raiz, base, con_altas, CORTES[0], sin_altas)
            self.assertEqual(repetido, base)
            lectura_original.assert_called_once()
            uno = componer_catalogo._aplicar_fundae(self.caso.raiz, base, con_altas, CORTES[1], primero, inicial=base)
            self.assertEqual(uno, con_altas)
            self.assertEqual(componer_catalogo.fundae_retenido(self.caso.raiz, uno, segundo), RETENIDO)
            self.assertIsNone(componer_catalogo.fundae_retenido(self.caso.raiz, uno, segundo, base))
            with patch.object(conocidos, "leer", wraps=conocidos.leer) as lecturas:
                dos = componer_catalogo._aplicar_fundae(self.caso.raiz, uno, ambos, CORTES[2], segundo, inicial=base)
        # Se comprueba la base, se reutilizan las identidades para recalcular y el aplicador valida su entrada.
        self.assertEqual([c.args[0].admision.snapshot.ruta.parent for c in lecturas.call_args_list], [base, uno, uno])
        self.assertEqual(dos, ambos)
        with closing(sqlite3.connect(ambos / "catalogo.sqlite3")) as conexion:
            ids = {f[0] for f in conexion.execute("SELECT id FROM programas WHERE id LIKE 'fundae:1:%'")}
        self.assertEqual(ids, {"fundae:1:1", "fundae:1:2", "fundae:1:3", "fundae:1:1880"})

    def test_un_conjunto_que_no_se_puede_recalcular_queda_retenido_y_la_composicion_sigue(self) -> None:
        """Sin sus capturas, el segundo conjunto no se recalcula: se conserva sin aplicar con su motivo propio."""
        base = self.caso.raiz / "base"
        sin_altas = self.calcular(self.censo([recurso(1), recurso(2)]), indice=(1, 2))
        fundae.aplicar(self.caso.entrada, conjunto=sin_altas, original=self.carpeta, destino=base, corte=CORTES[0])
        primero = self.calcular(self.censo([recurso(1880), recurso(1), recurso(2)]), indice=(1, 2, 1880, 3))
        segundo = self.calcular(self.censo([recurso(1880), recurso(3), recurso(1), recurso(2)]), indice=(1, 2, 1880, 3))
        con_altas, vacia = self.caso.raiz / "con-altas", self.caso.raiz / "sin-capturas"
        vacia.mkdir()
        retenidos: list[str] = []
        with patch.object(operacion_fuente, "rutas_de_la_fuente", return_value=(self.carpeta, None, None)):
            uno = componer_catalogo._aplicar_fundae(self.caso.raiz, base, con_altas, CORTES[1], primero, inicial=base)
        with patch.object(operacion_fuente, "rutas_de_la_fuente", return_value=(vacia, None, None)):
            dos = componer_catalogo._aplicar_fundae(
                self.caso.raiz, uno, self.caso.raiz / "ambos", CORTES[2], segundo, inicial=base, retenidos=retenidos
            )
        self.assertEqual(dos, uno)
        self.assertEqual(retenidos, [componer_catalogo.NO_RECALCULABLE])
        self.assertFalse((self.caso.raiz / "ambos").exists())

    def test_el_criterio_de_pertenencia(self) -> None:
        """Catálogo 1, tipo «Curso», sin baja y destino público; lo demás no entra."""
        self.assertTrue(censo_digitalizate.pertenece(recurso(1)))
        for caso in (
            video(),
            recurso(4, baja=True),
            recurso(5, urlCurso="no es una dirección"),
            recurso(6, catalogos=[]),
        ):
            with self.subTest(caso["idRecursoFormativo"]):
                self.assertFalse(censo_digitalizate.pertenece(caso))


if __name__ == "__main__":
    unittest.main()
