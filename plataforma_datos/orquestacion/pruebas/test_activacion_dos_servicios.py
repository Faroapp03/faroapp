"""Activación de dos servicios: primero el Worker de Cursos y después el principal, sin repetir ningún efecto."""

import copy
import json
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.orquestacion import activacion as modulo
from plataforma_datos.orquestacion import contrato_activacion as contrato
from plataforma_datos.orquestacion import lectura_activacion
from plataforma_datos.orquestacion.almacen_trabajos import conservar_trabajo, leer_referencia
from plataforma_datos.orquestacion.pruebas import test_activacion as base
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import SOLICITUD as SOLICITUD

ANTERIOR, DEPLOYMENT, NUEVA = base.ANTERIOR, base.DEPLOYMENT, base.NUEVA

ANTERIOR_CURSOS = "00000000-0000-0000-0000-000000000011"
DEPLOYMENT_ANTERIOR_CURSOS = "00000000-0000-0000-0000-000000000012"
NUEVA_CURSOS = "00000000-0000-0000-0000-000000000013"
DEPLOYMENT_CURSOS = "00000000-0000-0000-0000-000000000014"
FASE_DEL_EFECTO = {
    ("subir", "cursos"): "subiendo-cursos",
    ("desplegar", "cursos"): "promoviendo-cursos",
    ("subir", "principal"): "subiendo",
    ("desplegar", "principal"): "promoviendo",
}
RECORRIDO = [
    "reservar",
    "preparar",
    "subiendo-cursos",
    "cursos-subida",
    "promoviendo-cursos",
    "cursos-confirmado",
    "subiendo",
    "subida",
    "promoviendo",
    "confirmada",
]
EFECTOS = ["subir-cursos", "desplegar-cursos", "subir-principal", "desplegar-principal"]
# Fases que se conservan antes de su efecto: con el acuse perdido no se sabe si el efecto llegó a lanzarse.
ANTES_DEL_EFECTO = {
    "subiendo-cursos": [],
    "promoviendo-cursos": EFECTOS[:1],
    "subiendo": EFECTOS[:2],
    "promoviendo": EFECTOS[:3],
}


class DosServiciosTest(unittest.TestCase):
    """El proveedor simulado guarda lo que sirve cada Worker; cada efecto exige su fase y se cuenta."""

    def setUp(self) -> None:
        """Reutiliza el artefacto real y la autoridad simulada; la reserva lleva los campos de Cursos."""
        base.ActivacionTest.setUp(self)
        self.cliente.dos_servicios = True
        self.servido = {
            "principal": {"versionId": ANTERIOR, "deploymentId": ANTERIOR},
            "cursos": {"versionId": ANTERIOR_CURSOS, "deploymentId": DEPLOYMENT_ANTERIOR_CURSOS},
        }
        self.subidas: dict[str, list[dict]] = {"principal": [], "cursos": []}
        self.perder_efecto: tuple[str, str] | None = None

    ejecutar = base.ActivacionTest.ejecutar
    recuperar = base.ActivacionTest.recuperar

    def proveedor(
        self, adaptador: modulo.AdaptadorVersiones, operacion: str, *, servicio: str, **campos: object
    ) -> dict:
        """Simula los dos Workers por separado: lo que sirven, sus versiones subidas y cada efecto.

        Returns:
            Respuesta del proveedor para ese Worker.

        Raises:
            OSError: Respuesta perdida tras un efecto que sí se hizo.
        """
        if operacion == "estado":
            servido = self.servido[servicio]
            return {
                "deploymentId": servido["deploymentId"],
                "versiones": [{"versionId": servido["versionId"], "porcentaje": 100}],
            }
        if operacion == "versiones":
            return {"versiones": self.subidas[servicio]}
        assert self.cliente.estado["ultimaActivacion"]["fase"] == FASE_DEL_EFECTO[operacion, servicio]
        assert Path(adaptador.artefacto["ruta"]).is_dir()
        nueva = NUEVA_CURSOS if servicio == "cursos" else NUEVA
        self.efectos.append(f"{operacion}-{servicio}")
        if operacion == "subir":
            sha256 = self.artefacto["sha256Artefacto"]
            self.subidas[servicio].append(
                {"versionId": nueva, "tag": self.cliente.trabajo["solicitudId"], "message": sha256}
            )
        else:
            assert campos == {"versionId": nueva, "anteriorDeploymentId": self.servido[servicio]["deploymentId"]}
            deployment = DEPLOYMENT_CURSOS if servicio == "cursos" else DEPLOYMENT
            self.servido[servicio] = {"versionId": nueva, "deploymentId": deployment}
        if self.perder_efecto == (operacion, servicio):
            raise OSError("resultado perdido")
        return {"versionId": nueva} if operacion == "subir" else {}

    def reiniciar(self) -> None:
        """Deshace la preparación anterior y prepara una activación nueva para el caso siguiente."""
        self.doCleanups()
        self.setUp()

    def fase(self) -> str:
        """Fase durable en la autoridad simulada.

        Returns:
            Nombre de la fase.
        """
        return self.cliente.estado["ultimaActivacion"]["fase"]

    def test_recorrido_completo_publica_primero_cursos_y_confirma_los_dos(self) -> None:
        """Cada Worker se sube y se despliega una sola vez, Cursos antes, y la evidencia guarda los dos anteriores."""
        resultado = self.ejecutar()
        self.assertEqual(resultado["fase"], "confirmada")
        self.assertEqual(self.cliente.pasos, RECORRIDO)
        self.assertEqual(self.efectos, EFECTOS)
        actual = self.cliente.estado["ultimaActivacion"]
        self.assertEqual(
            actual["evidencia"]["anterior"],
            {
                "principal": {"versionId": ANTERIOR, "deploymentId": ANTERIOR},
                "cursos": {"versionId": ANTERIOR_CURSOS, "deploymentId": DEPLOYMENT_ANTERIOR_CURSOS},
            },
        )
        self.assertEqual((actual["versionIdCursos"], actual["deploymentIdCursos"]), (NUEVA_CURSOS, DEPLOYMENT_CURSOS))
        self.assertEqual((actual["versionId"], actual["deploymentId"]), (NUEVA, DEPLOYMENT))
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.efectos, EFECTOS)

    def test_relevo_del_dia_siguiente_publica_la_misma_huella_pendiente(self) -> None:
        """La generación ya validada por A conserva su paquete al revalidarla B bajo una nueva reserva."""
        anterior = copy.deepcopy(self.servido)
        self.assertIsNone(self.cliente.estado["ultimaActivacion"])
        nueva = replace(
            self.config.ejecucion,
            solicitud_id="12121212-1212-4121-8121-121212121212",
            revision_reserva=4,
            run_id="124",
            accion="comprobar-programada",
            revisar_paquete_pendiente=True,
        )
        self.config = replace(self.config, ejecucion=nueva)
        datos = json.loads(self.recibo) | {
            "solicitudId": nueva.solicitud_id,
            "revisionReserva": nueva.revision_reserva,
            "accion": nueva.accion,
        }
        recibo_relevo = base.serializar(datos)
        referencia = leer_referencia(self.almacen)
        conservar_trabajo(
            recibo_relevo,
            nueva.run_id,
            nueva.revision_codigo,
            referencia,
            referencia["baseOperativa"],
            artefacto=self.artefacto,
            almacen=self.almacen,
        )
        self.cliente.trabajo |= {
            "solicitudId": nueva.solicitud_id,
            "revisionReserva": nueva.revision_reserva,
            "runId": nueva.run_id,
            "accion": nueva.accion,
            "huellaRecibo": base.sha(recibo_relevo),
        }
        self.assertEqual(self.servido, anterior)
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        publicado = self.cliente.estado["ultimaActivacion"]
        self.assertEqual(publicado["evidencia"]["anterior"], anterior)
        self.assertEqual(publicado["evidencia"]["artefacto"]["huellaPaquete"], json.loads(self.recibo)["huellaPaquete"])
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.efectos, EFECTOS)

    def test_resultado_perdido_de_cada_efecto_se_reconcilia_sin_repetirlo(self) -> None:
        """Con la respuesta del proveedor perdida, la fase queda incierta y solo la observación la cierra."""
        casos = (
            (("subir", "cursos"), "subiendo-cursos", "cursos-subida"),
            (("desplegar", "cursos"), "promoviendo-cursos", "cursos-confirmado"),
            (("subir", "principal"), "subiendo", "subida"),
            (("desplegar", "principal"), "promoviendo", "confirmada"),
        )
        for efecto, incierta, cerrada in casos:
            with self.subTest(efecto=efecto):
                self.reiniciar()
                self.perder_efecto = efecto
                with self.assertRaises(OSError):
                    self.ejecutar()
                self.perder_efecto = None
                hechos = list(self.efectos)
                self.assertEqual(self.fase(), incierta)
                with self.assertRaises(modulo.ErrorActivacion):
                    self.ejecutar()
                self.assertEqual(self.ejecutar(reconciliar=True)["fase"], cerrada)
                self.assertEqual(self.efectos, hechos)
                self.assertEqual(self.ejecutar()["fase"], "confirmada")
                self.assertEqual(self.efectos, EFECTOS)

    def test_acuse_perdido_de_cada_fase_nunca_repite_efectos(self) -> None:
        """Tras un acuse perdido, la recuperación sigue si la fase es segura y nunca relanza un efecto incierto."""
        for paso in RECORRIDO[1:]:
            with self.subTest(paso=paso):
                self.reiniciar()
                self.cliente.perder = paso
                with self.assertRaises(OSError):
                    self.ejecutar()
                self.cliente.perder = None
                fase = paso if paso != "preparar" else "preparada"
                self.assertEqual(self.fase(), fase)
                if paso in ANTES_DEL_EFECTO:
                    with self.assertRaises(modulo.ErrorActivacion):
                        self.recuperar()
                    self.assertEqual(self.fase(), fase)
                    self.assertEqual(self.efectos, ANTES_DEL_EFECTO[paso])
                    continue
                self.assertEqual(self.recuperar()["fase"], "confirmada")
                self.assertEqual(self.efectos, EFECTOS)
                self.assertEqual(self.recuperar("3")["fase"], "confirmada")
                self.assertEqual(self.efectos, EFECTOS)

    def test_fallo_entre_las_dos_publicaciones_deja_fase_explicita_y_nunca_confirmada(self) -> None:
        """Cursos publicado y el principal sin subir: la fase lo dice y la recuperación termina sin repetir Cursos."""

        def proveedor(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            if operacion == "subir" and campos["servicio"] == "principal":
                raise modulo.ErrorActivacion(modulo.ERROR)
            return self.proveedor(adaptador, operacion, **campos)

        with (
            patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
            self.assertRaises(modulo.ErrorActivacion),
        ):
            self.ejecutar()
        self.assertEqual(self.fase(), "subiendo")
        self.assertEqual(self.efectos, ["subir-cursos", "desplegar-cursos"])
        self.assertIsNone(self.cliente.estado["ultimaActivacion"]["deploymentId"])
        # El intento de subida sin acuse es incierto: sin versión observada, ni se repite ni se confirma.
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()
        self.assertEqual(self.fase(), "subiendo")
        self.reiniciar()
        self.cliente.perder = "cursos-confirmado"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        self.assertEqual(self.fase(), "cursos-confirmado")
        self.assertEqual(self.recuperar()["fase"], "confirmada")
        self.assertEqual(self.efectos, EFECTOS)

    def test_cursos_cambiado_por_otro_impide_confirmar(self) -> None:
        """Si Cursos ya no sirve la versión de la intención, el principal desplegado no se da por confirmado."""
        self.perder_efecto = ("desplegar", "principal")
        with self.assertRaises(OSError):
            self.ejecutar()
        self.servido["cursos"] = {"versionId": ANTERIOR_CURSOS, "deploymentId": DEPLOYMENT_ANTERIOR_CURSOS}
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar(reconciliar=True)
        self.assertEqual(self.fase(), "promoviendo")
        self.servido["cursos"] = {"versionId": NUEVA_CURSOS, "deploymentId": DEPLOYMENT_CURSOS}
        self.assertEqual(self.ejecutar(reconciliar=True)["fase"], "confirmada")
        self.assertEqual(self.efectos, EFECTOS)

    def test_cursos_vuelto_a_desplegar_a_mano_con_otro_despliegue_confirma(self) -> None:
        """Tras volver atrás y redesplegar a mano la versión de la intención, el despliegue es otro y se confirma."""
        self.perder_efecto = ("desplegar", "principal")
        with self.assertRaises(OSError):
            self.ejecutar()
        # Cada despliegue de Cloudflare tiene su identificador: el redespliegue a mano no repite el anotado.
        otro = "00000000-0000-0000-0000-000000000015"
        self.servido["cursos"] = {"versionId": NUEVA_CURSOS, "deploymentId": otro}
        self.assertEqual(self.ejecutar(reconciliar=True)["fase"], "confirmada")
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["deploymentIdCursos"], DEPLOYMENT_CURSOS)
        self.assertEqual(self.efectos, EFECTOS)

    def test_recuperar_preparada_exige_que_los_dos_workers_sigan_como_estaban(self) -> None:
        """Un despliegue ajeno en Cursos antes del primer efecto detiene la recuperación sin relevo ni efectos."""
        self.cliente.perder = "preparar"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        previo = copy.deepcopy(self.cliente.estado)
        self.servido["cursos"] = {"versionId": NUEVA_CURSOS, "deploymentId": DEPLOYMENT_CURSOS}
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()
        self.assertEqual(self.cliente.estado, previo)
        self.assertEqual(self.efectos, [])
        self.servido["cursos"] = {"versionId": ANTERIOR_CURSOS, "deploymentId": DEPLOYMENT_ANTERIOR_CURSOS}
        self.assertEqual(self.recuperar()["fase"], "confirmada")
        self.assertEqual(self.efectos, EFECTOS)

    def test_configuracion_de_cursos_rechazada_cierra_sin_efectos(self) -> None:
        """Un perfil de Cursos que el adaptador no admite rechaza la intención antes de subir nada."""

        def proveedor(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            if operacion == "estado" and campos["servicio"] == "cursos":
                raise contrato.ConfiguracionNoAdmitida(modulo.ERROR)
            return self.proveedor(adaptador, operacion, **campos)

        with (
            patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
            self.assertRaises(contrato.ConfiguracionNoAdmitida),
        ):
            self.ejecutar()
        self.assertEqual(self.fase(), "rechazada")
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["error"], "despliegue_no_admitido")
        self.assertEqual(self.efectos, [])

    def test_lectura_de_las_dos_formas_y_sus_invariantes(self) -> None:
        """La forma de un servicio se sigue leyendo; las fases de Cursos solo existen en la de dos servicios."""
        self.ejecutar()
        dos = copy.deepcopy(self.cliente.estado)
        self.assertTrue(lectura_activacion.dos_servicios(dos["ultimaActivacion"]))
        lectura_activacion.leer_estado({"activacion": dos})
        uno = copy.deepcopy(dos)
        actual = uno["ultimaActivacion"]
        del actual["versionIdCursos"], actual["deploymentIdCursos"]
        actual["evidencia"]["anterior"] = actual["evidencia"]["anterior"]["principal"]
        lectura_activacion.leer_estado({"activacion": uno})
        self.assertFalse(lectura_activacion.dos_servicios(actual))
        roturas = (
            (uno, {"fase": "cursos-confirmado", "versionId": None, "deploymentId": None}),
            (dos, {"versionIdCursos": None}),
            (dos, {"fase": "cursos-subida", "versionId": None, "deploymentId": None}),
            (dos, {"evidencia": uno["ultimaActivacion"]["evidencia"]}),
        )
        for partida, cambio in roturas:
            with self.subTest(cambio=sorted(cambio)):
                roto = copy.deepcopy(partida)
                roto["ultimaActivacion"] |= cambio
                with self.assertRaises(modulo.ErrorActivacion):
                    lectura_activacion.leer_estado({"activacion": roto})


if __name__ == "__main__":
    unittest.main()
