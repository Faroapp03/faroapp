"""Abandonar una intención que no puede terminar: a mano tras volver atrás, o sola ante un rechazo sin efecto."""

import copy
import json
import unittest
from dataclasses import replace
from unittest.mock import patch

from plataforma_datos.orquestacion import activacion as modulo
from plataforma_datos.orquestacion import adaptador_versiones
from plataforma_datos.orquestacion.contrato_activacion import ConfiguracionNoAdmitida, RechazoSinEfecto
from plataforma_datos.orquestacion.pruebas import test_activacion as base
from plataforma_datos.orquestacion.pruebas import test_activacion_dos_servicios as dos
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import OTRA

ANTERIOR = {"versionId": dos.ANTERIOR, "deploymentId": dos.ANTERIOR}
ANTERIOR_CURSOS = {"versionId": dos.ANTERIOR_CURSOS, "deploymentId": dos.DEPLOYMENT_ANTERIOR_CURSOS}
VUELTA_ATRAS = "00000000-0000-0000-0000-000000000021"


class _Abandono:
    """Casos comunes a las dos formas; el proveedor simulado guarda lo que sirve cada Worker."""

    DOS = True

    setUp = dos.DosServiciosTest.setUp
    proveedor = dos.DosServiciosTest.proveedor
    reiniciar = dos.DosServiciosTest.reiniciar
    fase = dos.DosServiciosTest.fase
    ejecutar = dos.DosServiciosTest.ejecutar
    recuperar = dos.DosServiciosTest.recuperar

    def preparar_forma(self) -> None:
        """Ajusta la reserva a la forma del caso."""
        self.cliente.dos_servicios = self.DOS

    def primero(self) -> str:
        """Servicio que se publica primero.

        Returns:
            `cursos` en la forma de dos servicios, `principal` en la de uno.
        """
        return "cursos" if self.DOS else "principal"

    def subiendo(self) -> str:
        """Fase del primer efecto.

        Returns:
            Nombre de la fase.
        """
        return "subiendo-cursos" if self.DOS else "subiendo"

    def anterior(self) -> dict:
        """Lo que servían los Workers antes de la intención, con la forma de la evidencia.

        Returns:
            Versión y despliegue de cada Worker.
        """
        return {"principal": ANTERIOR, "cursos": ANTERIOR_CURSOS} if self.DOS else ANTERIOR

    def abandonar(self) -> str:
        """Pide el cierre desde el panel y lo cumple la ejecución que el servidor despacha para ello.

        Returns:
            Fase de la intención después.
        """
        actual = self.cliente.estado["ultimaActivacion"]
        actual["cierre"] = {
            "trabajo": {"solicitudId": OTRA, "revisionReserva": 2},
            "revisionActivacion": self.cliente.estado["revision"],
            "caducaEn": 2**40,
            "estado": "solicitado",
            "observado": None,
        }
        ejecucion = replace(
            self.config.ejecucion, solicitud_id=OTRA, revision_reserva=2, run_id="124", accion="reintentar-pendientes"
        )
        indice = {"version": 2, "revisionCodigo": base.CODIGO, "accion": "reintentar-pendientes"}
        sin_pendientes = (indice, b'{"resultado":"sin-pendientes"}')
        with patch.object(modulo, "recuperar_trabajo", return_value=sin_pendientes):
            self.resumen = modulo.activar_trabajo(replace(self.config, ejecucion=ejecucion), self.cliente, self.almacen)
        return self.fase()

    def test_un_cierre_que_ya_no_es_para_esta_ejecucion_no_detiene_su_activacion(self) -> None:
        """Si se volvió a pedir el cierre, el servidor responde conflicto: la ejecución sigue y su resumen lo dice."""
        self.parada_en_la_subida()
        original = self.cliente.activacion

        def vuelto_a_pedir(operacion: str, solicitud: dict | None = None) -> dict:
            if operacion == "cerrar-solicitado":
                return {"estado": "conflicto", "activacion": copy.deepcopy(self.cliente.estado)}
            return original(operacion, solicitud)

        pasos = list(self.cliente.pasos)
        with patch.object(self.cliente, "activacion", side_effect=vuelto_a_pedir):
            self.assertEqual(self.abandonar(), self.subiendo())
        self.assertEqual((self.resumen["fase"], self.resumen["cierre"]), ("omitida", "ya-no-vigente"))
        self.assertEqual(self.cliente.pasos, pasos)
        self.assertEqual(self.efectos, [])

    def con_rechazo(self, operacion: str, servicio: str, rechazo: Exception) -> None:
        """Hace que el proveedor rechace una vez la operación indicada, sin efecto."""
        original = self.proveedor

        def proveedor(adaptador: modulo.AdaptadorVersiones, op: str, **campos: object) -> dict:
            if (op, campos["servicio"]) == (operacion, servicio) and not hechos:
                hechos.append(op)
                raise rechazo
            return original(adaptador, op, **campos)

        hechos: list[str] = []
        self.enterContext(patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor))

    def parada_en_la_subida(self) -> None:
        """Deja la intención en la fase de la primera subida sin versión subida (acuse perdido antes de subir)."""
        self.preparar_forma()
        self.cliente.perder = self.subiendo()
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()

    def test_si_no_se_puede_observar_lo_servido_se_anota_sin_observacion(self) -> None:
        """Con un despliegue repartido no se sabe qué se sirve: queda en su fase, anotada sin observación."""
        self.preparar_forma()
        self.con_rechazo("subir", self.primero(), RechazoSinEfecto("rechazo-previo"))
        rechazando = modulo.AdaptadorVersiones.operar

        def repartido(adaptador: modulo.AdaptadorVersiones, op: str, **campos: object) -> dict:
            if op == "estado" and self.fase() == self.subiendo():
                versiones = [
                    {"versionId": dos.ANTERIOR, "porcentaje": 50},
                    {"versionId": VUELTA_ATRAS, "porcentaje": 50},
                ]
                return {"deploymentId": VUELTA_ATRAS, "versiones": versiones}
            return rechazando(adaptador, op, **campos)

        self.enterContext(patch.object(modulo.AdaptadorVersiones, "operar", new=repartido))
        with self.assertRaises(RechazoSinEfecto):
            self.ejecutar()
        self.assertEqual(self.fase(), self.subiendo())
        detenida = self.cliente.estado["ultimaActivacion"]["detenida"]
        self.assertEqual(detenida, {"motivo": "rechazo-previo", "observado": None})
        self.assertNotIn("abandonar", self.cliente.pasos)
        self.assertEqual(self.efectos, [])

    def test_el_cierre_pedido_con_lo_anterior_servido_cierra_sin_efectos(self) -> None:
        """La intención sin salida se cierra con lo observado y el motivo; ninguna subida ni despliegue."""
        self.parada_en_la_subida()
        self.assertEqual(self.fase(), self.subiendo())
        self.assertEqual(self.abandonar(), "abandonada")
        actual = self.cliente.estado["ultimaActivacion"]
        self.assertEqual(actual["abandono"], {"motivo": "a-mano", "observado": self.anterior()})
        self.assertNotIn("cierre", actual)
        self.assertEqual(self.cliente.pasos[-1], "cerrar-solicitado")
        self.assertEqual(self.efectos, [])
        # La solicitud es de un solo uso: la ejecución que la cumplió ya no encuentra nada que cerrar.
        pasos = list(self.cliente.pasos)
        ejecucion = replace(
            self.config.ejecucion, solicitud_id=OTRA, revision_reserva=2, run_id="124", accion="reintentar-pendientes"
        )
        sin_pendientes = (
            {"version": 2, "revisionCodigo": base.CODIGO, "accion": "reintentar-pendientes"},
            b'{"resultado":"sin-pendientes"}',
        )
        with patch.object(modulo, "recuperar_trabajo", return_value=sin_pendientes):
            modulo.activar_trabajo(replace(self.config, ejecucion=ejecucion), self.cliente, self.almacen)
        self.assertEqual(self.cliente.pasos, pasos)
        self.assertEqual(self.recuperar("5")["fase"], "abandonada")
        self.assertEqual(self.efectos, [])

    def test_abandonar_a_mano_se_rechaza_si_algun_worker_sirve_otra_cosa(self) -> None:
        """Con una versión de la intención en servicio, nada cambia: ni relevo ni paso."""
        self.preparar_forma()
        self.perder_efecto = ("desplegar", self.primero())
        with self.assertRaises(OSError):
            self.ejecutar()
        self.perder_efecto = None
        previo = copy.deepcopy(self.cliente.estado)
        # La web ya no sirve lo anterior: no se cierra, y la solicitud queda usada con lo observado.
        self.assertEqual(self.abandonar(), previo["ultimaActivacion"]["fase"])
        cierre = self.cliente.estado["ultimaActivacion"]["cierre"]
        self.assertEqual(cierre["estado"], "web-cambiada")
        # Tras volver atrás a mano, con otro despliegue de la misma versión anterior, un cierre nuevo sí cierra.
        self.servido[self.primero()] = {**self.anterior_de(self.primero()), "deploymentId": VUELTA_ATRAS}
        self.assertEqual(self.abandonar(), "abandonada")
        observado = self.cliente.estado["ultimaActivacion"]["abandono"]["observado"]
        self.assertEqual((observado[self.primero()] if self.DOS else observado)["deploymentId"], VUELTA_ATRAS)

    def test_abandonar_con_un_despliegue_repartido_se_rechaza(self) -> None:
        """Un Worker que reparte el tráfico entre su versión anterior y otra no sirve lo anterior: nada cambia."""
        self.parada_en_la_subida()
        original = self.proveedor

        def proveedor(adaptador: modulo.AdaptadorVersiones, op: str, **campos: object) -> dict:
            if op == "estado" and campos["servicio"] == "principal":
                return {
                    "deploymentId": VUELTA_ATRAS,
                    "versiones": [
                        {"versionId": dos.ANTERIOR, "porcentaje": 50},
                        {"versionId": dos.NUEVA, "porcentaje": 50},
                    ],
                }
            return original(adaptador, op, **campos)

        pasos = list(self.cliente.pasos)
        with (
            patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
            self.assertRaises(modulo.ErrorActivacion),
        ):
            self.abandonar()
        # Sin observación clara no se pide nada: la solicitud sigue sin usar y la intención en su fase.
        self.assertEqual(self.cliente.pasos, pasos)
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["cierre"]["estado"], "solicitado")

    def test_publicada_a_mano_con_su_etiqueta_se_reconcilia_y_confirma_sin_desplegar(self) -> None:
        """Publicada a mano con la etiqueta de la intención, se reconcilia y se confirma por lo observado."""
        self.parada_en_la_subida()
        servicio = self.primero()
        nueva = dos.NUEVA_CURSOS if servicio == "cursos" else dos.NUEVA
        sha256 = self.artefacto["sha256Artefacto"]
        self.subidas[servicio].append({"versionId": nueva, "tag": dos.SOLICITUD, "message": sha256})
        self.servido[servicio] = {"versionId": nueva, "deploymentId": VUELTA_ATRAS}
        # La recuperación reconcilia la subida por su etiqueta y confirma la versión que ya se sirve.
        self.assertEqual(self.recuperar("3")["fase"], "confirmada")
        self.assertIn("cursos-subida" if self.DOS else "subida", self.cliente.pasos)
        self.assertNotIn(f"desplegar-{servicio}", self.efectos)
        self.assertNotIn(f"subir-{servicio}", self.efectos)

    def anterior_de(self, servicio: str) -> dict:
        """Lo que servía antes el Worker indicado.

        Returns:
            Versión y despliegue anteriores.
        """
        return ANTERIOR_CURSOS if servicio == "cursos" else ANTERIOR

    def test_abandonar_a_mano_sin_el_artefacto_conservado(self) -> None:
        """Con la retención del artefacto vencida, la observación no lo necesita y la intención se cierra."""
        self.parada_en_la_subida()
        # Sin el artefacto ni el trabajo conservado: su retención ha vencido.
        for clave in [c for c in self.almacen.objetos if c.startswith(("artefactos/", "blobs/", "trabajos/"))]:
            del self.almacen.objetos[clave]
        with patch.object(modulo, "recuperar_artefacto", side_effect=AssertionError("no debe descargar")):
            self.assertEqual(self.abandonar(), "abandonada")
        self.assertEqual(self.efectos, [])

    def test_acuse_perdido_de_abandonar_no_deja_la_intencion_a_medias(self) -> None:
        """Si el servidor aplicó el abandono sin acuse, el intento siguiente lo encuentra cerrado y no actúa."""
        self.parada_en_la_subida()
        self.cliente.perder = "cerrar-solicitado"
        with self.assertRaises(OSError):
            self.abandonar()
        self.cliente.perder = None
        self.assertEqual(self.fase(), "abandonada")
        self.assertEqual(self.ejecutar()["fase"], "abandonada")
        self.assertEqual(self.efectos, [])

    def test_rechazo_sin_efecto_al_subir_abandona_sola(self) -> None:
        """Un rechazo previo del adaptador o explícito del proveedor cierra sola la intención, sin efectos."""
        for motivo in ("rechazo-previo", "rechazo-proveedor"):
            with self.subTest(motivo=motivo):
                self.reiniciar()
                self.preparar_forma()
                self.con_rechazo("subir", self.primero(), RechazoSinEfecto(motivo))
                self.assertEqual(self.ejecutar()["fase"], "abandonada")
                actual = self.cliente.estado["ultimaActivacion"]
                self.assertEqual(actual["abandono"], {"motivo": motivo, "observado": self.anterior()})
                self.assertEqual(self.efectos, [])
                # El ciclo siguiente con el mismo trabajo no vuelve a intentarlo.
                self.assertEqual(self.ejecutar()["fase"], "abandonada")
                self.assertEqual(self.efectos, [])

    def test_rechazo_sin_efecto_al_desplegar_abandona_con_la_version_subida_sin_desplegar(self) -> None:
        """Una versión subida y nunca desplegada no impide abandonar; no se repite su subida."""
        self.preparar_forma()
        self.con_rechazo("desplegar", self.primero(), RechazoSinEfecto("rechazo-previo"))
        self.assertEqual(self.ejecutar()["fase"], "abandonada")
        self.assertEqual(self.efectos, [f"subir-{self.primero()}"])

    def test_fallo_incierto_nunca_abandona(self) -> None:
        """Sin prueba de que el efecto no se hizo, la intención queda en su fase para reconciliarla."""
        for operacion in ("subir", "desplegar"):
            with self.subTest(operacion=operacion):
                self.reiniciar()
                self.preparar_forma()
                self.con_rechazo(operacion, self.primero(), modulo.ErrorActivacion(modulo.ERROR))
                with self.assertRaises(modulo.ErrorActivacion):
                    self.ejecutar()
                self.assertNotIn("abandonar", self.cliente.pasos)
                self.assertNotEqual(self.fase(), "abandonada")


class ClasificacionDeRechazosTest(unittest.TestCase):
    """Solo un rechazo previo del adaptador o explícito de Cloudflare demuestra que no hubo efecto."""

    def test_cada_salida_de_error_del_adaptador_se_clasifica(self) -> None:
        """Ante la duda, incierto: una salida ilegible, otro efecto o una lectura fallida no prueban nada."""
        casos = (
            ("subir", {"error": "configuracion-incompatible", "efecto": "ninguno"}, "rechazo-previo"),
            ("desplegar", {"error": "deployment-distinto", "efecto": "ninguno"}, "rechazo-previo"),
            ("desplegar", {"error": "artefacto-invalido", "efecto": "ninguno"}, "rechazo-previo"),
            ("subir", {"error": "configuracion-incompatible", "efecto": "rechazado"}, "rechazo-proveedor"),
            ("subir", {"error": "wrangler-incierto", "efecto": "incierto"}, None),
            ("desplegar", {"error": "resultado-invalido", "efecto": "incierto"}, None),
            ("desplegar", {"error": "wrangler-incierto", "efecto": "ninguno"}, None),
            ("subir", {"error": "artefacto-invalido", "efecto": "incierto"}, None),
        )
        for operacion, error, motivo in casos:
            with self.subTest(operacion=operacion, error=error):
                salida = json.dumps({"version": 1, **error})
                if motivo is None:
                    adaptador_versiones._rechazo(operacion, salida)
                else:
                    with self.assertRaises(RechazoSinEfecto) as rechazo:
                        adaptador_versiones._rechazo(operacion, salida)
                    self.assertEqual(rechazo.exception.motivo, motivo)
        for salida in ("no es JSON", json.dumps({"version": 1, "error": "configuracion-incompatible"})):
            adaptador_versiones._rechazo("subir", salida)
        with self.assertRaises(ConfiguracionNoAdmitida):
            adaptador_versiones._rechazo(
                "estado", json.dumps({"version": 1, "error": "configuracion-incompatible", "efecto": "ninguno"})
            )


class AbandonoDosServiciosTest(_Abandono, unittest.TestCase):
    """Forma de dos servicios: Cursos y después el principal."""

    def test_tras_cursos_confirmado_un_rechazo_del_principal_no_abandona_solo(self) -> None:
        """Con Cursos ya publicado no se abandona sola; tras volver atrás Cursos a mano, el abandono a mano cierra."""
        self.preparar_forma()
        self.con_rechazo("subir", "principal", RechazoSinEfecto("rechazo-proveedor"))
        with self.assertRaises(RechazoSinEfecto) as error:
            self.ejecutar()
        self.assertIn("rechazo-proveedor", str(error.exception))
        self.assertEqual(self.fase(), "subiendo")
        self.assertNotIn("abandonar", self.cliente.pasos)
        # El motivo queda anotado en el servidor, sin cambiar de fase.
        # Con lo observado: Cursos nuevo y el principal anterior, que el panel dice como formación no disponible.
        observado = {
            "principal": ANTERIOR,
            "cursos": {"versionId": dos.NUEVA_CURSOS, "deploymentId": dos.DEPLOYMENT_CURSOS},
        }
        self.assertEqual(
            self.cliente.estado["ultimaActivacion"]["detenida"], {"motivo": "rechazo-proveedor", "observado": observado}
        )
        self.assertEqual(self.cliente.pasos[-1], "anotar-rechazo")
        self.assertEqual(self.efectos, ["subir-cursos", "desplegar-cursos"])
        self.assertEqual(self.abandonar(), "subiendo")
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["cierre"]["estado"], "web-cambiada")
        self.servido["cursos"] = {**ANTERIOR_CURSOS, "deploymentId": VUELTA_ATRAS}
        self.assertEqual(self.abandonar(), "abandonada")
        self.assertEqual(self.efectos, ["subir-cursos", "desplegar-cursos"])

    def test_la_anotacion_de_detenida_se_borra_al_avanzar(self) -> None:
        """Si se sube a mano la versión de la intención y se reconcilia, la intención avanza sin el motivo."""
        self.preparar_forma()
        self.con_rechazo("subir", "principal", RechazoSinEfecto("rechazo-previo"))
        with self.assertRaises(RechazoSinEfecto):
            self.ejecutar()
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["detenida"]["motivo"], "rechazo-previo")
        sha256 = self.artefacto["sha256Artefacto"]
        self.subidas["principal"].append({"versionId": dos.NUEVA, "tag": dos.SOLICITUD, "message": sha256})
        self.assertEqual(self.ejecutar(reconciliar=True)["fase"], "subida")
        self.assertNotIn("detenida", self.cliente.estado["ultimaActivacion"])
        self.assertEqual(self.ejecutar()["fase"], "confirmada")


class AbandonoUnServicioTest(_Abandono, unittest.TestCase):
    """Forma de un servicio: solo el principal, como la guarda un servidor que publica solo el principal."""

    DOS = False


if __name__ == "__main__":
    unittest.main()
