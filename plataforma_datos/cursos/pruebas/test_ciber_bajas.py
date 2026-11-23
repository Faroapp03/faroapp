"""Bajas de Cibervoluntarios sin red: el censo completo las afirma y el destino registrado del material las corrobora.

Los ciclos recorren las piezas reales (recepción, procedencia, admisión, registro de vigencia, entrega y panel); las
respuestas del destino son recortes de las capturas reales de `capturas_ciber_bajas/` (véase su `PROCEDENCIA.md`).
"""

import email.message
import hashlib
import io
import json
import unittest
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import cobertura_catalogo
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, bajas, destinos, direcciones, lector
from plataforma_datos.cursos.pruebas.test_ciber_paginas_fallidas import (
    PRIMERA,
    SEGUNDA,
    InstalacionCiber,
    _cuerpo_pagina,
)

CAPTURAS = Path(__file__).with_name("capturas_ciber_bajas")
PAGINA_DE_ERROR = (CAPTURAS / "destino-inexistente.html").read_bytes()
REDIRECCION = (CAPTURAS / "destino-existente.html").read_bytes()


def _destino(url: str, inicio: str, fin: str, **datos: object) -> transporte.RespuestaCatalogo:
    por_defecto = {"cuerpo": None, "url_final": url, "http": None, "completo": False, "content_type": "text/html"}
    return transporte.RespuestaCatalogo(url=url, inicio_utc=inicio, fin_utc=fin, **{**por_defecto, **datos})


def no_existe(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """La plataforma responde 404 con su página de error, como con el curso 99999999.

    Returns:
        La respuesta del transporte.
    """
    return _destino(url, inicio, fin, cuerpo=PAGINA_DE_ERROR, http=HTTPStatus.NOT_FOUND, completo=True)


def existe(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """La plataforma responde 303 al inicio de sesión, como con el curso 485.

    Returns:
        La respuesta del transporte.
    """
    return _destino(
        url,
        inicio,
        fin,
        cuerpo=REDIRECCION,
        http=HTTPStatus.SEE_OTHER,
        completo=True,
        redireccion=direcciones.INICIO_DE_SESION,
    )


def caido(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """La consulta no obtiene respuesta.

    Returns:
        La respuesta del transporte.
    """
    return _destino(url, inicio, fin, error="timeout")


def sin_servicio(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """El servidor responde 503.

    Returns:
        La respuesta del transporte.
    """
    return _destino(
        url, inicio, fin, cuerpo=b"Servicio no disponible", http=HTTPStatus.SERVICE_UNAVAILABLE, completo=True
    )


def error_de_otra_forma(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """Responde 404, pero con un cuerpo que no es la página de error de la plataforma.

    Returns:
        La respuesta del transporte.
    """
    return _destino(url, inicio, fin, cuerpo=b"<html><title>Not Found</title></html>", http=404, completo=True)


def titulo_sin_mensaje(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """Responde 404 con el título de error, pero sin el mensaje de registro no encontrado.

    Returns:
        La respuesta del transporte.
    """
    cuerpo = PAGINA_DE_ERROR.replace(bajas.MENSAJE_DE_ERROR.encode(), b"Otro mensaje")
    return _destino(url, inicio, fin, cuerpo=cuerpo, http=404, completo=True)


def otro_destino(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """Responde 303, pero hacia una página que no es el inicio de sesión.

    Returns:
        La respuesta del transporte.
    """
    return _destino(
        url,
        inicio,
        fin,
        cuerpo=REDIRECCION,
        http=HTTPStatus.SEE_OTHER,
        completo=True,
        redireccion="https://e-learning.cibervoluntarios.org/otra/pagina.php",
    )


def ok_inesperado(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """Responde 200 con una página cualquiera.

    Returns:
        La respuesta del transporte.
    """
    return _destino(url, inicio, fin, cuerpo=b"<html></html>", http=200, completo=True)


def sin_destinos(url: str, inicio: str, fin: str) -> transporte.RespuestaCatalogo:
    """Ninguna prueba que use esto debe consultar un destino.

    Raises:
        AssertionError: Siempre.
    """
    raise AssertionError("Se ha consultado un destino que no debía: " + url)


class BajasCiberPruebas(InstalacionCiber):
    """Cada prueba parte de dos materiales admitidos y de un censo completo en el que falta el segundo."""

    def ofrecidos(self, corte: str) -> set[str]:
        """Compone el catálogo y devuelve las ofertas públicas.

        Returns:
            Direcciones de las ofertas públicas.
        """
        return set(self.componer(corte))

    def aviso(self) -> list[str]:
        """Lee los motivos de aviso de la última validación admitida.

        Returns:
            Códigos de los avisos del informe.
        """
        _, _, validado = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        informe = json.loads((validado / "validacion.json").read_bytes())
        return [a["motivo"] for a in informe.get("avisos", [])]

    def faltante(self, respuesta: Callable[[str, str, str], transporte.RespuestaCatalogo], hora: str = "20:00") -> None:
        """Consulta un censo completo de una sola página, en el que falta el segundo material."""
        self.assertTrue(self.consultar_fuente(hora, {1: "normal"}, total=1, destinos=respuesta))

    def comenzar(self) -> None:
        """Admite los dos materiales y los compone."""
        self.assertTrue(self.consultar_fuente("19:00", {1: "normal", 2: "normal"}))
        self.assertEqual(len(self.ofrecidos("2026-10-23T19:30:00Z")), 2)

    def retirada(self) -> dict:
        """Lee la observación de retirada del segundo material.

        Returns:
            La observación de catálogo con la presencia en falso.
        """
        retiradas = [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"]
        self.assertEqual(len(retiradas), 1)
        return retiradas[0]

    # -- Ausente del censo completo ---------------------------------------------------------------------------------

    def test_ausente_con_el_destino_404_de_la_plataforma_se_retira_con_su_evidencia(self) -> None:
        """Falta del censo completo y 404 con la página de error: retirado, con fecha, y deja de proyectarse."""
        self.comenzar()
        self.faltante(no_existe)
        self.assertEqual([url for url, _ in self.destinos_pedidos], [direcciones_de(SEGUNDA)])
        self.assertFalse(self.destinos_pedidos[0][1]["seguir_redirecciones"])
        self.assertEqual(self.aviso(), [])
        ofertas = self.ofrecidos("2026-10-23T20:30:00Z")
        self.assertEqual(ofertas, {self.url(PRIMERA)})
        fila = self.panel("2026-10-23T20:30:00Z")[SEGUNDA]
        self.assertEqual(fila["decision"], "no-disponible-publicamente")
        self.assertEqual(self.panel("2026-10-23T20:30:00Z")[PRIMERA]["decision"], "disponible-publicamente")
        retirada = self.retirada()
        self.assertFalse(retirada["detalle"]["presente"])
        self.assertTrue(retirada["detalle"]["lectura_completa"])
        self.assertEqual(retirada["terminado_el"], "2026-10-23T20:00:01+00:00")
        destino = [e for e in retirada["evidencias"] if e["alcance"] == "diagnostico"]
        self.assertEqual(len(destino), 1)
        self.assertEqual(destino[0]["sha256"], hashlib.sha256(PAGINA_DE_ERROR).hexdigest())
        self.assertEqual(destino[0]["capturado_utc"], "2026-10-23T20:00:01+00:00")
        self.assertEqual(destino[0]["localizador"]["valor"], f"destino:{direcciones_de(SEGUNDA)}:404")
        paginas = [e for e in retirada["evidencias"] if e["alcance"] == "catalogo"]
        self.assertEqual([e["localizador"]["valor"] for e in paginas], ["page=1"])

    def test_ausente_con_el_destino_303_al_inicio_de_sesion_sigue_vigente_con_su_motivo(self) -> None:
        """El curso existe aunque el censo no lo traiga: no se retira y el panel recibe la contradicción."""
        self.comenzar()
        self.faltante(existe)
        self.assertEqual(self.aviso(), [bajas.AVISO_CURSO_ACTIVO])
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.panel("2026-10-23T20:30:00Z")[SEGUNDA]["decision"], "disponible-publicamente")
        self.assertEqual([o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"], [])

    def test_ausente_sin_confirmar_no_cambia_nada_y_avisa(self) -> None:
        """Corte, 5xx, 200, otro destino u otro cuerpo: sin cambio y con su aviso."""
        self.comenzar()
        casos = (caido, sin_servicio, ok_inesperado, otro_destino, error_de_otra_forma, titulo_sin_mensaje)
        for hora, respuesta in zip(("20:00", "21:00", "22:00", "23:00", "23:10", "23:20"), casos, strict=True):
            with self.subTest(respuesta=respuesta.__name__):
                self.faltante(respuesta, hora)
                self.assertEqual(self.aviso(), [bajas.AVISO_SIN_CONFIRMAR])
                self.assertEqual(len(self.destinos_pedidos), 1)
                corte = f"2026-10-23T{hora}:30Z"
                self.assertEqual(self.ofrecidos(corte), {self.url(PRIMERA), self.url(SEGUNDA)})
                self.assertEqual([o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"], [])

    def test_sin_destino_registrado_queda_sin_confirmar(self) -> None:
        """Un material ausente cuyo destino no se conserva no se retira: avisa."""
        self.comenzar()
        conjunto = {
            "censo_completo": True,
            "censo": {"materiales": ["a"], "disponibles": 1, "conocidos_ausentes": ["b"]},
        }
        self.assertEqual(bajas.decidir(conjunto), {"b": bajas.SIN_NOTICIA})
        self.assertEqual(bajas.avisos(conjunto), [{"motivo": bajas.AVISO_SIN_CONFIRMAR}])

    # -- Borrado declarado por el proveedor -------------------------------------------------------------------------

    def test_material_o_actividad_borrados_en_el_censo_completo_se_retiran_sin_consultar_el_destino(self) -> None:
        """`erased` verdadero en el material o en su actividad: retirado, con el censo como evidencia."""
        self.comenzar()
        for hora, estado in (("20:00", "borrado"), ("22:00", "actividad-borrada")):
            with self.subTest(estado=estado):
                self.assertTrue(self.consultar_fuente(hora, {1: "normal", 2: estado}, destinos=sin_destinos))
                self.assertEqual(self.destinos_pedidos, [])
                self.assertEqual(self.ofrecidos(f"2026-10-23T{hora[:2]}:30:00Z"), {self.url(PRIMERA)})
                self.assertEqual(
                    self.panel(f"2026-10-23T{hora[:2]}:30:00Z")[SEGUNDA]["decision"], "no-disponible-publicamente"
                )
                retirada = [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"][-1]
                campos = [
                    e["localizador"]["valor"] for e in retirada["evidencias"] if e["localizador"]["tipo"] == "campo"
                ]
                esperado = (
                    "/hydra:member/0/" + ("activityCatalogMaterials/0/" if estado == "borrado" else "") + "erased"
                )
                self.assertEqual(campos, [esperado])
                self.assertEqual(self.aviso(), [])
            vuelve = f"{int(hora[:2]) + 1}:00"
            self.assertTrue(self.consultar_fuente(vuelve, {1: "normal", 2: "normal"}))
            self.assertEqual(len(self.ofrecidos(f"2026-10-23T{vuelve[:2]}:30:00Z")), 2)

    def test_un_material_que_deja_de_estar_disponible_se_retira_sin_consultar_el_destino(self) -> None:
        """Descatalogado, pendiente u otro estado, en el material o en su actividad: retirado, con el estado literal."""
        self.comenzar()
        casos = (
            ("descatalogado", "baja:descatalogado:Descatalogado", "activityCatalogMaterials/0/status"),
            ("pendiente", "baja:otro-estado:Pendiente", "activityCatalogMaterials/0/status"),
            ("actividad-descatalogada", "baja:descatalogado:Descatalogado", "status"),
        )
        for (hora, vuelve), (estado, literal, campo) in zip(
            (("20:00", "21:00"), ("22:00", "23:00"), ("23:10", "23:40")), casos, strict=True
        ):
            with self.subTest(estado=estado):
                self.assertTrue(self.consultar_fuente(hora, {1: "normal", 2: estado}, destinos=sin_destinos))
                self.assertEqual(self.destinos_pedidos, [])
                corte = f"2026-10-23T{hora}:30Z"
                self.assertEqual(self.ofrecidos(corte), {self.url(PRIMERA)})
                self.assertEqual(self.panel(corte)[SEGUNDA]["decision"], "no-disponible-publicamente")
                retirada = [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"][-1]
                valores = [e["localizador"]["valor"] for e in retirada["evidencias"]]
                self.assertIn(literal, valores)
                self.assertIn(f"/hydra:member/0/{campo}", valores)
                self.assertEqual(self.aviso(), [])
            self.assertTrue(self.consultar_fuente(vuelve, {1: "normal", 2: "normal"}))
            self.assertEqual(len(self.ofrecidos(f"2026-10-23T{vuelve}:30Z")), 2)

    def test_un_material_nuevo_que_no_esta_disponible_no_entra_ni_se_renueva(self) -> None:
        """Descatalogado, pendiente, borrado o con la actividad descatalogada: ni se selecciona ni da de alta."""

        def leer(cuerpo: bytes) -> lector.MaterialCiber:
            captura = lector.CapturaCiber(
                url=adquisicion.url_pagina(1),
                sha256=hashlib.sha256(cuerpo).hexdigest(),
                bytes_cuerpo=len(cuerpo),
                inicio_utc="2026-10-23T20:00:00+00:00",
                recibido_utc="2026-10-23T20:00:01+00:00",
                http=200,
                completo=True,
                localizador="/hydra:member",
            )
            (material,) = lector.extraer_materiales(cuerpo, captura)
            return material

        for borrado in ("descatalogado", "pendiente", "material", "actividad", "actividad-descatalogada"):
            with self.subTest(borrado=borrado):
                material = leer(_cuerpo_pagina(1, borrado=borrado))
                self.assertFalse(material.disponible)
                self.assertIsNotNone(material.baja_declarada)
                self.assertIsNotNone(ciber._motivo_alta(material, False))
        disponible = leer(_cuerpo_pagina(1))
        self.assertTrue(disponible.disponible)
        self.assertIsNone(disponible.baja_declarada)

    def test_un_retirado_que_sigue_ausente_deja_la_fuente_aplicada(self) -> None:
        """La composición fija `aplicados_por_fuente` y no vuelve a aplicar la misma consulta."""
        self.comenzar()
        self.faltante(no_existe, "20:00")
        self.ofrecidos("2026-10-23T20:30:00Z")
        self.faltante(sin_destinos, "21:00")
        self.ofrecidos("2026-10-23T21:30:00Z")
        control = json.loads((self.raiz / almacen.RUTA / almacen.CONTROL).read_bytes())
        conjunto = fuente.leer_validado("cibervoluntarios", self.raiz)
        self.assertEqual(control["aplicados_por_fuente"]["cibervoluntarios"], ciber.firma(conjunto))
        with patch.object(ciber, "aplicar", side_effect=AssertionError("ya aplicada")):
            self.ofrecidos("2026-10-23T22:00:00Z")

    # -- Cobertura del día --------------------------------------------------------------------------------------------

    def acreditada(self) -> bool:
        """Dice si la consulta admitida acredita la fuente entera, como la mira el seguimiento.

        Returns:
            El resultado de `cobertura_catalogo.comprobada` con una petición por cada recepción de la consulta.
        """
        original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        conjunto = fuente.leer_validado("cibervoluntarios", self.raiz)
        filas = [*conjunto["recepciones"], *conjunto["auxiliares"].values(), *conjunto.get(bajas.FICHAS, {}).values()]
        peticiones = []
        for fila in filas:
            try:
                rx = cobertura_catalogo._recepcion("cibervoluntarios", original, fila)
            except ErrorFuente:
                meta = fuente.leer_recibo(original, fila)
                peticiones.append({"recurso_sha256": identidad_recurso(meta["url"]), "respuesta_sha256": None})
                continue
            peticiones.append(
                {
                    "recurso_sha256": identidad_recurso(rx["url"]),
                    "url_final_sha256": hashlib.sha256(rx["url_final"].encode()).hexdigest(),
                    "respuesta_sha256": rx["sha256"],
                    "original_sha256": rx["sha256"],
                    "bytes": rx["bytes"],
                    "original_bytes": rx["bytes"],
                    "completado_utc": rx["fin_utc"],
                }
            )
        evidencia = {
            "version": cobertura_catalogo.VERSION_RECEPCION,
            "fuente": "cibervoluntarios",
            "comienzo_utc": "2026-10-23T00:00:00Z",
            "fin_utc": "2026-10-23T23:59:00Z",
            "peticiones": peticiones,
        }
        return cobertura_catalogo.comprobada(self.raiz, evidencia)

    def test_el_dia_de_una_retirada_corroborada_o_contradicha_se_acredita(self) -> None:
        """Cada destino pedido es un recurso esperado con su recibo; el 404 y el 303 reconocidos cuadran."""
        self.comenzar()
        self.assertTrue(self.acreditada())
        self.faltante(no_existe, "20:00")
        self.assertEqual(len(self.destinos_pedidos), 1)
        self.assertTrue(self.acreditada())
        self.ofrecidos("2026-10-23T20:30:00Z")
        # Retirado y todavía ausente: no se pide su destino y el día se acredita.
        self.faltante(sin_destinos, "21:00")
        self.assertTrue(self.acreditada())
        self.faltante(existe, "22:00")
        self.assertTrue(self.acreditada())

    def test_un_dia_con_un_destino_sin_confirmar_o_sin_pedir_no_se_acredita(self) -> None:
        """Corte, 5xx, otro cuerpo u otro destino: no se acredita; tampoco un ausente cuyo destino no se pidió."""
        self.comenzar()
        casos = (caido, sin_servicio, ok_inesperado, otro_destino, error_de_otra_forma, titulo_sin_mensaje)
        for hora, respuesta in zip(("20:00", "21:00", "22:00", "23:00", "23:10", "23:20"), casos, strict=True):
            with self.subTest(respuesta=respuesta.__name__):
                self.faltante(respuesta, hora)
                self.assertFalse(self.acreditada())
        # Un estado desconocido ese día impide pedir el destino del ausente: tampoco se acredita.
        self.assertTrue(self.consultar_fuente("23:30", {1: "archivado"}, total=1, destinos=sin_destinos))
        self.assertFalse(self.acreditada())

    # -- Estados que Faro no conoce ---------------------------------------------------------------------------------

    def retiradas(self) -> list[dict]:
        """Observaciones de retirada del segundo material.

        Returns:
            Las observaciones de catálogo registradas.
        """
        return [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"]

    def test_un_estado_desconocido_en_todo_el_catalogo_no_da_ninguna_baja_y_avisa(self) -> None:
        """«disponible» en minúsculas en todos los materiales: ninguna baja, la oferta se mantiene y el panel avisa."""
        self.comenzar()
        self.assertTrue(self.consultar_fuente("20:00", {1: "minuscula", 2: "minuscula"}, destinos=sin_destinos))
        self.assertEqual(self.aviso(), [bajas.AVISO_ESTADO_DESCONOCIDO])
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.retiradas(), [])
        # Ni siquiera la ausencia da baja ese día: no se pide ningún destino.
        self.assertTrue(self.consultar_fuente("21:00", {1: "minuscula"}, total=1, destinos=sin_destinos))
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.retiradas(), [])

    def test_un_solo_material_con_un_estado_desconocido_frena_las_bajas_ese_dia(self) -> None:
        """«Archivado» en un material: ninguna baja, pero lo que viene «Disponible» se sigue renovando."""
        self.comenzar()
        self.assertTrue(self.consultar_fuente("20:00", {1: "normal", 2: "archivado"}, destinos=sin_destinos))
        self.assertEqual(self.aviso(), [bajas.AVISO_ESTADO_DESCONOCIDO])
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.retiradas(), [])
        self.assertEqual(self.panel("2026-10-23T20:30:00Z")[PRIMERA]["comprobadoEl"], "2026-10-23T20:00:01Z")
        # Un material que falta del censo tampoco se retira ese día.
        self.assertTrue(self.consultar_fuente("21:00", {1: "archivado"}, total=1, destinos=sin_destinos))
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.retiradas(), [])
        # Con los estados otra vez conocidos, el aviso desaparece.
        self.assertTrue(self.consultar_fuente("22:00", {1: "normal", 2: "descatalogado"}, destinos=sin_destinos))
        self.assertEqual(self.aviso(), [])
        self.assertEqual(self.ofrecidos("2026-10-23T22:30:00Z"), {self.url(PRIMERA)})

    def test_un_censo_sin_ningun_material_disponible_no_da_bajas(self) -> None:
        """Completo y con materiales, pero ninguno «Disponible»: no hay censo del que fiarse."""
        self.comenzar()
        self.assertTrue(self.consultar_fuente("20:00", {1: "descatalogado", 2: "pendiente"}, destinos=sin_destinos))
        self.assertEqual(self.aviso(), [])
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.retiradas(), [])

    # -- Retirado que sigue ausente ---------------------------------------------------------------------------------

    def test_un_retirado_que_sigue_ausente_no_se_vuelve_a_consultar_y_uno_sin_confirmar_si(self) -> None:
        """El destino se pide el día de la ausencia; retirado, no se repite; sin confirmar, se pide cada día."""
        self.comenzar()
        self.faltante(sin_servicio, "20:00")
        self.ofrecidos("2026-10-23T20:30:00Z")
        self.faltante(sin_servicio, "21:00")
        self.assertEqual(len(self.destinos_pedidos), 1)
        self.ofrecidos("2026-10-23T21:30:00Z")
        self.faltante(no_existe, "22:00")
        self.assertEqual(len(self.destinos_pedidos), 1)
        self.assertEqual(self.ofrecidos("2026-10-23T22:30:00Z"), {self.url(PRIMERA)})
        self.faltante(sin_destinos, "23:00")
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.aviso(), [])
        self.assertEqual(self.ofrecidos("2026-10-23T23:30:00Z"), {self.url(PRIMERA)})
        self.assertEqual(self.panel("2026-10-23T23:30:00Z")[SEGUNDA]["decision"], "no-disponible-publicamente")

    def test_el_registro_dice_si_un_material_ya_esta_retirado(self) -> None:
        """La última retirada más reciente que cualquier lectura correcta del material."""

        def obs(tipo: str, hora: str, **detalle: object) -> dict:
            return {
                "tipo": tipo,
                "resultado": "correcta",
                "terminado_el": f"2026-10-23T{hora}:00+00:00",
                "detalle": detalle,
            }

        retirada = obs("catalogo", "20:00", presente=False, lectura_completa=True)
        self.assertFalse(destinos.esta_retirado([obs("ficha", "19:00")]))
        self.assertTrue(destinos.esta_retirado([obs("ficha", "19:00"), retirada]))
        self.assertFalse(destinos.esta_retirado([retirada, obs("ficha", "21:00")]))
        self.assertFalse(destinos.esta_retirado([retirada, obs("ficha", "20:00")]))
        fallo = {**obs("ficha", "21:00"), "resultado": "fallo"}
        self.assertTrue(destinos.esta_retirado([retirada, fallo]))

    # -- Censo parcial ----------------------------------------------------------------------------------------------

    def test_censo_parcial_no_da_ninguna_baja_ni_consulta_destinos(self) -> None:
        """Una página caída, o un material borrado leído en un censo a medias, no retiran nada."""
        self.comenzar()
        self.assertTrue(self.consultar_fuente("20:00", {1: "normal", 2: None}, destinos=sin_destinos))
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.aviso(), [])
        self.assertTrue(self.consultar_fuente("21:00", {1: "borrado", 2: None}, destinos=sin_destinos))
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.ofrecidos("2026-10-23T21:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.panel("2026-10-23T21:30:00Z")[PRIMERA]["decision"], "disponible-publicamente")

    # -- Regreso ----------------------------------------------------------------------------------------------------

    def test_un_material_retirado_que_vuelve_al_censo_completo_se_ofrece_otra_vez(self) -> None:
        """Sin intervención de nadie: la lectura posterior contradice la retirada."""
        self.comenzar()
        self.faltante(no_existe)
        self.assertEqual(self.ofrecidos("2026-10-23T20:30:00Z"), {self.url(PRIMERA)})
        self.assertTrue(self.consultar_fuente("21:00", {1: "normal", 2: "normal"}))
        self.assertEqual(self.destinos_pedidos, [])
        self.assertEqual(self.ofrecidos("2026-10-23T21:30:00Z"), {self.url(PRIMERA), self.url(SEGUNDA)})
        self.assertEqual(self.panel("2026-10-23T21:30:00Z")[SEGUNDA]["decision"], "disponible-publicamente")
        self.faltante(no_existe, "22:00")
        self.assertEqual(self.ofrecidos("2026-10-23T22:30:00Z"), {self.url(PRIMERA)})

    def test_repetir_la_consulta_sin_red_no_duplica_la_retirada(self) -> None:
        """Readmitir y recomponer lo mismo conserva una sola observación de retirada."""
        self.comenzar()
        self.faltante(no_existe)
        self.ofrecidos("2026-10-23T20:30:00Z")
        self.ofrecidos("2026-10-23T23:00:00Z")
        self.retirada()

    # -- Regla pura -------------------------------------------------------------------------------------------------

    def test_cincuenta_ausentes_con_el_destino_404_se_retiran_los_cincuenta(self) -> None:
        """Cada ausente corroborado se retira por sí solo; el resto sigue su camino."""
        ausentes = [f"cibervoluntarios:material:{n}" for n in range(1000, 1050)]
        lecturas = {
            id: {"lectura": {"completo": True, "http": 404, "pagina_de_error": True, "redireccion": None}}
            for id in ausentes
        }
        conjunto = {
            "censo_completo": True,
            "censo": {"materiales": ["cibervoluntarios:material:1"], "disponibles": 1, "conocidos_ausentes": ausentes},
            bajas.FICHAS: lecturas,
        }
        self.assertEqual(bajas.decidir(conjunto), dict.fromkeys(ausentes, bajas.RETIRADO))
        self.assertEqual(bajas.avisos(conjunto), [])

    def test_un_censo_sin_materiales_no_da_bajas(self) -> None:
        """Completo pero sin ningún material no es un censo del que se pueda fiar una baja."""
        conjunto = {"censo_completo": True, "censo": {"materiales": [], "conocidos_ausentes": ["a"]}}
        self.assertEqual(bajas.decidir(conjunto), {})
        self.assertEqual(bajas.avisos(conjunto), [])
        sin_disponibles = {
            "censo_completo": True,
            "censo": {"materiales": ["x"], "disponibles": 0, "conocidos_ausentes": ["a"]},
        }
        self.assertEqual(bajas.decidir(sin_disponibles), {})
        parcial = {"censo_completo": False, "censo": {"materiales": ["x"]}}
        self.assertEqual(bajas.decidir(parcial), {})

    def test_la_pagina_de_error_se_reconoce_por_su_contenido(self) -> None:
        """Solo la página «Error | Cibervoluntarios» con el mensaje de registro no encontrado."""
        self.assertTrue(bajas.pagina_de_error(PAGINA_DE_ERROR))
        for cuerpo in (b"", b"No se puede encontrar el registro", REDIRECCION, PAGINA_DE_ERROR[:100], b"\xff\xfe"):
            self.assertFalse(bajas.pagina_de_error(cuerpo))

    def test_el_destino_registrado_es_solo_la_pagina_de_un_curso_de_su_servidor(self) -> None:
        """Se pide sin la sección; cualquier otra dirección no es un destino."""
        base = "https://e-learning.cibervoluntarios.org/course/view.php?id="
        self.assertEqual(direcciones.destino_del_material(base + "485#section-2"), base + "485")
        for valor in (
            None,
            3,
            base + "0",
            base + "4x",
            base + "485&otro=1",
            base + "485#otra",
            "http://e-learning.cibervoluntarios.org/course/view.php?id=485",
            "https://otro.cibervoluntarios.org/course/view.php?id=485",
            "https://e-learning.cibervoluntarios.org/login/index.php?id=485",
        ):
            self.assertIsNone(direcciones.destino_del_material(valor))


class TransporteSinRedireccionesPruebas(unittest.TestCase):
    """Sin seguir redirecciones, una 303 es la respuesta y conserva el destino al que apunta."""

    URL = "https://e-learning.cibervoluntarios.org/course/view.php?id=485"

    def _redireccion(self) -> HTTPError:
        cabeceras = email.message.Message()
        cabeceras["Location"] = direcciones.INICIO_DE_SESION
        cabeceras["Content-Type"] = "text/html; charset=utf-8"
        return HTTPError(self.URL, 303, "See Other", cabeceras, io.BytesIO(REDIRECCION))

    def test_la_respuesta_303_llega_con_su_destino_y_su_cuerpo(self) -> None:
        """El transporte pide sin seguir redirecciones y devuelve el código, el cuerpo y el `location`."""
        with patch.object(red, "abrir_peticion", side_effect=self._redireccion()) as abrir:
            respuesta = transporte.consultar(self.URL, perfil="pagina", seguir_redirecciones=False)
        self.assertIs(abrir.call_args.kwargs["seguir_redirecciones"], False)
        self.assertEqual(respuesta.http, HTTPStatus.SEE_OTHER)
        self.assertEqual(respuesta.redireccion, direcciones.INICIO_DE_SESION)
        self.assertEqual(respuesta.cuerpo, REDIRECCION)
        self.assertTrue(respuesta.completo)

    def test_por_defecto_el_transporte_no_cambia_su_conducta(self) -> None:
        """Sin la opción no se pasa ningún argumento nuevo y el recibo no lleva campo de redirección."""
        with patch.object(red, "abrir_peticion", side_effect=self._redireccion()) as abrir:
            respuesta = transporte.consultar(self.URL, perfil="pagina")
        self.assertNotIn("seguir_redirecciones", abrir.call_args.kwargs)
        self.assertIsNone(respuesta.redireccion)

    def test_el_gestor_no_genera_peticion_nueva(self) -> None:
        """Urllib entrega la redirección como error cuando el gestor devuelve None."""
        self.assertIsNone(red._SinRedirecciones().redirect_request())


def direcciones_de(url_de_programa: str) -> str:
    """Destino registrado del material de un programa de la instalación de prueba.

    Returns:
        Dirección del curso en la plataforma de cursos.
    """
    return "https://e-learning.cibervoluntarios.org/course/view.php?id=" + url_de_programa.rsplit(":", 1)[1]


if __name__ == "__main__":
    unittest.main()
