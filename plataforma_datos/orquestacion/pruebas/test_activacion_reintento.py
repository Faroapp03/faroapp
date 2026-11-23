"""La ejecución siguiente, sin pendientes, reintenta una vez la abandonada por `rechazo-previo` y nada más."""

import copy
import json
import unittest
from dataclasses import replace
from unittest.mock import patch

from plataforma_datos.orquestacion import activacion as modulo
from plataforma_datos.orquestacion.pruebas import test_activacion as base
from plataforma_datos.orquestacion.pruebas.test_almacen_artefactos import serializar
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import CODIGO, OTRA, SOLICITUD

ANTERIOR = {"versionId": base.ANTERIOR, "deploymentId": base.ANTERIOR}
CLAVE_ABANDONADO = f"trabajos/{SOLICITUD}/1/123.json"


class AutoridadConReintento(base.Autoridad):
    """La autoridad de prueba, con el reintento que pide una ejecución posterior y los pasos que esta firma."""

    def activacion(self, operacion: str, solicitud: dict | None = None) -> dict:
        """Admite `reintentar` solo sobre una abandonada por `rechazo-previo` que no es ya un reintento.

        Returns:
            Copia independiente del estado durable.
        """
        if operacion != "reintentar":
            if solicitud is not None and solicitud["solicitudId"] == OTRA:
                # Los pasos del reintento los firma la ejecución que reintenta; el doble cuenta igual las fases.
                solicitud = {**solicitud, "solicitudId": SOLICITUD}
            return super().activacion(operacion, solicitud)
        previa = self.estado["ultimaActivacion"]
        de = {k: previa["trabajo"][k] for k in ("solicitudId", "revisionReserva", "runId", "huellaRecibo")}
        if (
            previa["fase"] != "abandonada"
            or previa["abandono"]["motivo"] != "rechazo-previo"
            or "reintento" in previa
            or "reintentoDescartado" in previa
            or solicitud["reintentoDe"] != de
        ):
            return {"estado": "conflicto", "activacion": copy.deepcopy(self.estado)}
        assert solicitud["revisionEsperada"] == self.estado["revision"]
        self.estado["revision"] += 1
        if "descartado" in solicitud:
            previa["reintentoDescartado"] = solicitud["descartado"]
            self.pasos.append("descartar")
            return {"estado": "aplicado", "activacion": copy.deepcopy(self.estado)}
        self.estado["ultimaActivacion"] = {
            "revisionBase": self.estado["revision"] - 1,
            "trabajo": copy.deepcopy(previa["trabajo"]),
            "fase": "reservada",
            "creadoEn": 2,
            "actualizadoEn": 2,
            "evidencia": None,
            "versionId": None,
            "deploymentId": None,
            "error": None,
            "revisionTrabajos": 9,
            "reintento": {
                "solicitudId": OTRA,
                "revisionReserva": 2,
                "runId": "124",
                "confianza": {"sha": CODIGO},
                "abandonadaEn": previa["actualizadoEn"],
                "observado": previa["abandono"]["observado"],
            },
        }
        self.pasos.append("reintentar")
        return {"estado": "aplicado", "activacion": copy.deepcopy(self.estado)}


class ReintentoTest(unittest.TestCase):
    """Un servicio, con el almacén, el artefacto y el proveedor simulados de las pruebas de la activación."""

    proveedor = base.ActivacionTest.proveedor

    def setUp(self) -> None:
        """Deja abandonada la intención del trabajo validado y prepara la ejecución siguiente sin pendientes."""
        base.ActivacionTest.setUp(self)
        trabajo = self.cliente.trabajo
        self.cliente = AutoridadConReintento(trabajo)
        self.cliente.estado = {"version": 1, "revision": 4, "ultimaActivacion": self.abandonada("rechazo-previo")}
        self.siguiente = replace(
            self.config,
            ejecucion=replace(
                self.config.ejecucion,
                solicitud_id=OTRA,
                revision_reserva=2,
                run_id="124",
                accion="reintentar-pendientes",
            ),
        )
        cuerpo = json.loads(self.recibo)
        cuerpo |= {"solicitudId": OTRA, "revisionReserva": 2, "accion": "reintentar-pendientes"}
        cuerpo |= {"resultado": "sin-pendientes", "huellaPaquete": None, "veredicto": None}
        indice = {"version": 2, "revisionCodigo": CODIGO, "accion": "reintentar-pendientes"}
        self.enterContext(patch.object(modulo, "recuperar_trabajo", return_value=(indice, serializar(cuerpo))))

    def abandonada(self, motivo: str) -> dict:
        """Una intención de un servicio cerrada sin publicar, con la revisión de trabajos al reservar.

        Returns:
            La activación abandonada.
        """
        return {
            "revisionBase": 0,
            "trabajo": copy.deepcopy(self.cliente.trabajo),
            "fase": "abandonada",
            "creadoEn": 1,
            "actualizadoEn": 1,
            "evidencia": None,
            "versionId": None,
            "deploymentId": None,
            "error": None,
            "revisionTrabajos": 3,
            "abandono": {"motivo": motivo, "observado": ANTERIOR},
        }

    def ejecutar_siguiente(self) -> dict:
        """Ejecuta la activación de la ejecución siguiente, que ha terminado sin pendientes.

        Returns:
            Resumen de la orden.
        """
        return modulo.activar_trabajo(self.siguiente, self.cliente, self.almacen)

    def test_reintenta_una_vez_el_mismo_trabajo_y_confirma(self) -> None:
        """Una intención nueva con el trabajo abandonado y su artefacto conservado; si pasa, queda confirmada."""
        resumen = self.ejecutar_siguiente()
        self.assertEqual((resumen["fase"], resumen["solicitudId"], resumen["runId"]), ("confirmada", OTRA, "124"))
        actual = self.cliente.estado["ultimaActivacion"]
        self.assertEqual(actual["trabajo"], self.cliente.trabajo)
        self.assertEqual(actual["reintento"]["runId"], "124")
        self.assertEqual(self.cliente.pasos[0], "reintentar")
        self.assertEqual(self.efectos, ["subir", "desplegar"])
        # Repetir la misma ejecución no reintenta otra vez ni repite efectos: lee su reintento ya confirmado.
        pasos = list(self.cliente.pasos)
        self.assertEqual(self.ejecutar_siguiente()["fase"], "confirmada")
        self.assertEqual((self.cliente.pasos, self.efectos), (pasos, ["subir", "desplegar"]))

    def test_no_reintenta_a_mano_rechazo_del_proveedor_ni_un_reintento(self) -> None:
        """Lo cerrado a propósito, lo rechazado por el alojamiento y un reintento no se vuelven a intentar solos."""
        reintento = {
            **self.abandonada("rechazo-previo"),
            "reintento": {
                "solicitudId": OTRA,
                "revisionReserva": 2,
                "runId": "120",
                "confianza": {"sha": CODIGO},
                "abandonadaEn": 1,
                "observado": ANTERIOR,
            },
        }
        for previa in (self.abandonada("a-mano"), self.abandonada("rechazo-proveedor"), reintento):
            with self.subTest(motivo=previa["abandono"]["motivo"], reintento="reintento" in previa):
                self.cliente.estado = {"version": 1, "revision": 4, "ultimaActivacion": previa}
                resumen = self.ejecutar_siguiente()
                self.assertEqual((resumen["fase"], resumen["resultado"]), ("omitida", "sin-pendientes"))
                self.assertNotIn("reintento", resumen)
        self.assertEqual(self.cliente.pasos, [])
        self.assertEqual(self.efectos, [])

    def test_sin_el_trabajo_o_el_artefacto_conservados_no_reintenta_y_lo_dice(self) -> None:
        """Si el índice del abandonado ya no se conserva, nada se reserva y el resumen lo dice."""
        self.assertIn(CLAVE_ABANDONADO, self.almacen.objetos)
        del self.almacen.objetos[CLAVE_ABANDONADO]
        resumen = self.ejecutar_siguiente()
        self.assertEqual((resumen["fase"], resumen["reintento"]), ("omitida", "sin-artefacto"))
        # Se anota en la abandonada que ya no se reintentará, para que el panel no lo prometa.
        self.assertEqual(self.cliente.pasos, ["descartar"])
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["reintentoDescartado"], "sin-artefacto")
        self.assertEqual(self.efectos, [])

    def test_una_abandonada_guardada_sin_revision_de_trabajos_no_se_reintenta(self) -> None:
        """Una activación anterior a esta forma se lee, pero no hay evidencia de que nada se cruzara después."""
        previa = self.abandonada("rechazo-previo")
        del previa["revisionTrabajos"]
        self.cliente.estado["ultimaActivacion"] = previa
        self.assertEqual(self.ejecutar_siguiente()["fase"], "omitida")
        self.assertEqual(self.cliente.pasos, [])

    def test_si_la_web_cambio_desde_el_abandono_el_reintento_se_rechaza_sin_efectos(self) -> None:
        """Una publicación a mano entre medias: el reintento no la deshace, se cierra como rechazada y lo dice."""
        publicada = "00000000-0000-0000-0000-000000000031"
        proveedor = self.proveedor

        def a_mano(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            if operacion == "estado":
                return {"deploymentId": publicada, "versiones": [{"versionId": publicada, "porcentaje": 100}]}
            return proveedor(adaptador, operacion, **campos)

        modulo.AdaptadorVersiones.operar.side_effect = a_mano
        with self.assertRaises(modulo.RechazoPrevioActivacion):
            self.ejecutar_siguiente()
        actual = self.cliente.estado["ultimaActivacion"]
        self.assertEqual((actual["fase"], actual["error"]), ("rechazada", "servido_distinto"))
        self.assertEqual(self.cliente.pasos, ["reintentar", "rechazar"])
        self.assertEqual(self.efectos, [])

    def test_un_relevo_pide_el_reintento_que_su_primer_intento_no_llego_a_pedir(self) -> None:
        """Si el primer intento no pudo leer la activación, «Re-run jobs» de esa ejecución hace el reintento."""
        self.cliente.intento = "2"
        relevo = replace(self.siguiente.ejecucion, run_attempt="2", recuperacion_activacion=True)
        with patch.object(self.cliente, "relevar", side_effect=self.relevar_reintento):
            resumen = modulo.activar_trabajo(
                replace(self.siguiente, ejecucion=relevo), self.cliente, self.almacen, recuperar=True
            )
        self.assertEqual(resumen["fase"], "confirmada")
        self.assertEqual(self.cliente.pasos[:2], ["reintentar", "recuperar"])
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def relevar_reintento(self, solicitud: dict) -> str:
        """El relevo del doble, con la evidencia del primer intento de la ejecución que reintenta.

        Returns:
            Confirmación acotada de la concesión.
        """
        confirmacion = base.Autoridad.relevar(self.cliente, solicitud)
        if confirmacion == "aplicado":
            self.cliente.estado["ultimaActivacion"]["recuperacion"]["anterior"]["runId"] = "124"
        return confirmacion
