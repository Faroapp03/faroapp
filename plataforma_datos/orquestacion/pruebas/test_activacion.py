"""Consumidor completo con almacén/artefacto reales, proveedor y autoridad interceptados sin red."""

import copy
import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import activacion as modulo
from plataforma_datos.orquestacion import adaptador_versiones, variante_del_artefacto
from plataforma_datos.orquestacion import contrato_activacion as contrato
from plataforma_datos.orquestacion.almacen_artefactos import guardar_artefacto
from plataforma_datos.orquestacion.almacen_trabajos import REFERENCIA, conservar_trabajo, inicializar_referencia
from plataforma_datos.orquestacion.ejecutor_operativo import ConfiguracionEjecutorOperativo
from plataforma_datos.orquestacion.lectura_activacion import sirve_lo_anterior
from plataforma_datos.orquestacion.pruebas.test_almacen_artefactos import contenidos, serializar, sha
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import CODIGO, SOLICITUD, Memoria, recibo

ANTERIOR = "00000000-0000-0000-0000-000000000001"
NUEVA = "00000000-0000-0000-0000-000000000002"
OPERAR_REAL = modulo.AdaptadorVersiones.operar
DEPLOYMENT = "00000000-0000-0000-0000-000000000003"


class Autoridad:
    """Doble CAS que conserva fase antes de permitir cada efecto remoto de la fixture."""

    def __init__(self, trabajo: dict) -> None:
        self.estado = {"version": 1, "revision": 0, "ultimaActivacion": None}
        self.trabajo = trabajo
        self.intento = "1"
        self.autorizar_recuperacion = True
        self.pasos: list[str] = []
        self.perder: str | None = None
        self.repetir: str | None = None
        # Un servidor que publica los dos Workers reserva con los campos de Cursos; uno anterior, sin ellos.
        self.dos_servicios = False
        self.observar_construccion = Mock(return_value=NUEVA)
        self.comprobar_manifiesto_web = Mock()

    def relevar(self, solicitud: dict) -> str:
        """Aplica la autoridad sintética monotónica del intento supervisor.

        Returns:
            Confirmación acotada de la concesión CAS.
        """
        actual = self.estado["ultimaActivacion"]
        relevo = actual.get("recuperacion") if actual is not None else None
        if (
            not self.autorizar_recuperacion
            or actual is None
            or (relevo is not None and int(self.intento) < int(relevo["intento"]))
        ):
            return "conflicto"
        if relevo is not None and relevo["intento"] == self.intento:
            assert solicitud["revisionEsperada"] == relevo["revisionBase"]
            return "repetido"
        assert solicitud["revisionEsperada"] == self.estado["revision"]
        actual["recuperacion"] = {
            "version": 1,
            "intento": self.intento,
            "revisionBase": self.estado["revision"],
            "anterior": {
                "estado": "completed",
                "runId": "123",
                "runAttempt": str(int(self.intento) - 1),
                "repositorioId": "1",
                "propietarioId": "2",
                "sha": CODIGO,
                "workflowPath": ".github/workflows/actualizar.yml",
                "evento": "workflow_dispatch",
                "conclusion": "failure",
            },
        }
        return "aplicado"

    def registrar_paso(self, operacion: str, solicitud: dict) -> str | None:
        """Aplica una fase solo desde el supervisor vigente.

        Returns:
            Tipo aplicado, o ausencia cuando el supervisor está cercado.
        """
        actual = self.estado["ultimaActivacion"]
        relevo = actual.get("recuperacion")
        if (operacion == "paso-recuperacion" and (relevo is None or relevo["intento"] != self.intento)) or (
            operacion == "paso" and relevo is not None
        ):
            return None
        assert solicitud["revisionEsperada"] == self.estado["revision"]
        paso = solicitud["paso"]
        tipo, actual = paso["tipo"], self.estado["ultimaActivacion"]
        if tipo == "anotar-rechazo":
            actual["detenida"] = {"motivo": paso["motivo"], "observado": paso["observado"]}
            return tipo
        actual.pop("detenida", None)
        actual["fase"] = {"preparar": "preparada", "rechazar": "rechazada", "abandonar": "abandonada"}.get(tipo, tipo)
        if tipo == "abandonar":
            actual["abandono"] = {"motivo": paso["motivo"], "observado": paso["observado"]}
        if tipo == "preparar":
            actual["evidencia"] = paso["evidencia"]
        if tipo == "rechazar":
            actual["error"] = paso["error"]
        for campo in ("versionId", "deploymentId", "versionIdCursos", "deploymentIdCursos"):
            if campo in paso:
                actual[campo] = paso[campo]
        return tipo

    def cerrar_solicitado(self, registro: dict) -> dict:
        """Cumple el cierre pedido: solo para su trabajo y su revisión; cierra si la web sirve lo anterior.

        Returns:
            Copia independiente del estado durable.

        Raises:
            OSError: Si se pierde el acuse del cierre ya conservado.
        """
        actual = self.estado["ultimaActivacion"]
        cierre = actual.get("cierre") if actual is not None else None
        referencia = {k: registro[k] for k in ("solicitudId", "revisionReserva")}
        if (
            cierre is None
            or cierre["estado"] != "solicitado"
            or cierre["trabajo"] != referencia
            or registro["revisionEsperada"] != self.estado["revision"]
        ):
            return {"estado": "conflicto", "activacion": copy.deepcopy(self.estado)}
        dos = "versionIdCursos" in actual
        evidencia = actual["evidencia"]
        if evidencia is not None and not sirve_lo_anterior(evidencia["anterior"], registro["observado"], dos):
            cierre |= {"estado": "web-cambiada", "observado": registro["observado"]}
        else:
            del actual["cierre"]
            actual.pop("detenida", None)
            actual["fase"] = "abandonada"
            actual["abandono"] = {"motivo": "a-mano", "observado": registro["observado"]}
        self.pasos.append("cerrar-solicitado")
        self.estado["revision"] += 1
        if self.perder == "cerrar-solicitado":
            raise OSError("acuse perdido")
        return {"estado": "aplicado", "activacion": copy.deepcopy(self.estado)}

    def activacion(self, operacion: str, solicitud: dict | None = None) -> dict:
        """Comprueba CAS y aplica la transición de fixture antes del acuse.

        Returns:
            Copia independiente del estado durable.

        Raises:
            OSError: Si se pierde el acuse de una fase ya conservada.
        """
        if operacion in ("leer", "leer-recuperacion"):
            return {"estado": "leido", "activacion": copy.deepcopy(self.estado)}
        if operacion == "cerrar-solicitado":
            return self.cerrar_solicitado(solicitud)
        assert solicitud["solicitudId"] == self.trabajo["solicitudId"]
        if operacion == "recuperar":
            confirmacion = self.relevar(solicitud)
            if confirmacion != "aplicado":
                return {"estado": confirmacion, "activacion": copy.deepcopy(self.estado)}
            tipo = "recuperar"
        elif operacion == "reservar":
            anterior = self.estado["ultimaActivacion"]
            if anterior is not None and anterior["trabajo"]["solicitudId"] == solicitud["solicitudId"]:
                assert solicitud["revisionEsperada"] == anterior["revisionBase"]
                return {"estado": "repetido", "activacion": copy.deepcopy(self.estado)}
            assert solicitud["revisionEsperada"] == self.estado["revision"]

            self.estado["ultimaActivacion"] = {
                "revisionBase": self.estado["revision"],
                "trabajo": copy.deepcopy(self.trabajo),
                "fase": "reservada",
                "creadoEn": 1,
                "actualizadoEn": 1,
                "evidencia": None,
                "versionId": None,
                "deploymentId": None,
                "error": None,
            }
            if self.dos_servicios:
                self.estado["ultimaActivacion"] |= {"versionIdCursos": None, "deploymentIdCursos": None}
            tipo = "reservar"
        else:
            tipo = self.registrar_paso(operacion, solicitud)
            if tipo is None:
                return {"estado": "conflicto", "activacion": copy.deepcopy(self.estado)}
        self.pasos.append(tipo)
        self.estado["revision"] += 1
        if tipo == self.perder:
            raise OSError("acuse perdido")
        estado = "repetido" if tipo == self.repetir else "aplicado"
        return {"estado": estado, "activacion": copy.deepcopy(self.estado)}


class ActivacionTest(unittest.TestCase):
    """Las expectativas y fases impiden activar bytes o identidades diferentes y repetir efectos."""

    def setUp(self) -> None:
        """Conserva artefacto pequeño real e índice v2; no construye ni abre conexiones."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="Activación Año "))).resolve()
        self.trabajos = self.raiz / "trabajos"
        self.trabajos.mkdir()
        self.configuracion = self.raiz / "entidad.json"
        self.configuracion.write_text("{}")
        self.configuracion_cursos = self.raiz / "cursos.json"
        self.configuracion_cursos.write_text("{}")
        self.config = modulo.ConfiguracionActivacion(
            ejecucion=ConfiguracionEjecutorOperativo(
                checkout=RAIZ,
                directorio_trabajo=self.trabajos,
                revision_codigo=CODIGO,
                solicitud_id=SOLICITUD,
                revision_reserva=1,
                run_id="123",
                run_attempt="1",
                accion="actualizar-datos",
                variante_cloudflare="oficial",
            ),
            configuracion_cloudflare=self.configuracion,
            configuracion_cloudflare_cursos=self.configuracion_cursos,
            origen_publico="https://publico.example",
        )
        archivos, paquete, manifiesto = contenidos()
        self.web_sha = sha(archivos["web/firmas/manifiesto.json"])
        origen = self.raiz / "original"
        origen.mkdir()
        for ruta, contenido in archivos.items():
            destino = origen / ruta
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(contenido)
        descriptor = serializar(
            {
                "version": 1,
                "destino": "oficial",
                "revisionCodigo": CODIGO,
                "huellaPaquete": paquete,
                "sha256ManifiestoPaquete": sha(manifiesto),
                "sha256ManifiestoDispositivo": self.web_sha,
                "archivos": [{"ruta": r, "bytes": len(c), "sha256": sha(c)} for r, c in sorted(archivos.items())],
            }
        )
        (origen / "artefacto.json").write_bytes(descriptor)
        self.almacen = Memoria()
        guardar_artefacto(origen, CODIGO, paquete, sha(descriptor), self.almacen)
        base = self.almacen.generacion("base", sha(manifiesto))
        nueva = self.almacen.generacion("nueva", sha(manifiesto))
        referencia = inicializar_referencia(base, self.almacen)
        cuerpo = json.loads(recibo())
        cuerpo["huellaPaquete"] = paquete
        self.recibo = serializar(cuerpo)
        self.artefacto = {"revisionCodigo": CODIGO, "huellaPaquete": paquete, "sha256Artefacto": sha(descriptor)}
        conservar_trabajo(self.recibo, "123", CODIGO, referencia, nueva, artefacto=self.artefacto, almacen=self.almacen)
        self.base_conservada = self.almacen.objetos[REFERENCIA]
        self.almacen.eventos.clear()
        self.cliente = Autoridad(
            {
                "solicitudId": SOLICITUD,
                "revisionReserva": 1,
                "runId": "123",
                "runAttempt": "1",
                "accion": "actualizar-datos",
                "confianza": {"sha": CODIGO},
                "huellaRecibo": sha(self.recibo),
                "resultado": {"resultado": "validado", "huellaPaquete": paquete},
            }
        )
        self.efectos: list[str] = []
        self.perder: str | None = None
        self.versiones: list[dict] = []
        self.estado_versiones = [{"versionId": NUEVA, "porcentaje": 100}]
        self.enterContext(patch.object(modulo.AdaptadorVersiones, "operar", autospec=True, side_effect=self.proveedor))

    def proveedor(self, adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
        """Exige que fase y recuperación íntegra precedan al efecto; la forma de un servicio solo usa el principal.

        Returns:
            Evidencia oficial sintética.

        Raises:
            OSError: Respuesta perdida tras un efecto remoto.
        """
        assert campos.pop("servicio") == "principal"
        actual = self.cliente.estado["ultimaActivacion"]
        if operacion == "estado":
            anterior = actual["fase"] in ("reservada", "preparada", "subida")
            return {
                "deploymentId": ANTERIOR if anterior else DEPLOYMENT,
                "versiones": [{"versionId": ANTERIOR, "porcentaje": 100}] if anterior else self.estado_versiones,
            }
        if operacion == "versiones":
            return {"versiones": self.versiones}
        assert actual["fase"] == {"subir": "subiendo", "desplegar": "promoviendo"}[operacion]
        assert Path(adaptador.artefacto["ruta"]).is_dir()
        if operacion == "desplegar":
            assert campos == {"versionId": NUEVA, "anteriorDeploymentId": ANTERIOR}
        self.efectos.append(operacion)
        if self.perder == operacion:
            raise OSError("resultado perdido")
        return {"versionId": NUEVA} if operacion == "subir" else {}

    def ejecutar(self, *, reconciliar: bool = False) -> dict:
        """Invoca el consumidor real sobre el almacén de fixture.

        Returns:
            Resumen de la fase confirmada.
        """
        return modulo.activar_trabajo(self.config, self.cliente, self.almacen, reconciliar=reconciliar)

    def recuperar(self, intento: str = "2") -> dict:
        """Mantiene la identidad actual real y la instantánea original del candidato, separada.

        Returns:
            Fase confirmada por el consumidor real.
        """
        self.cliente.intento = intento
        config = replace(
            self.config,
            ejecucion=replace(
                self.config.ejecucion,
                run_attempt=intento,
                recuperacion_activacion=True,
            ),
        )
        return modulo.activar_trabajo(config, self.cliente, self.almacen, recuperar=True)

    def test_recuperacion_otro_intento_observa_upload_y_completa_sin_duplicarlo(self) -> None:
        """El intento 2 recupera exactamente A; el 3 y la repetición no repiten efectos."""
        self.perder = "subir"
        with self.assertRaises(OSError):
            self.ejecutar()
        trabajo = copy.deepcopy(self.cliente.estado["ultimaActivacion"]["trabajo"])
        objetos = copy.deepcopy(self.almacen.objetos)
        self.versiones = [{"versionId": NUEVA, "tag": SOLICITUD, "message": self.artefacto["sha256Artefacto"]}]
        self.perder = None
        self.assertEqual(self.recuperar()["fase"], "confirmada")
        self.assertEqual(self.recuperar()["fase"], "confirmada")
        self.assertEqual(self.recuperar("3")["fase"], "confirmada")
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["trabajo"], trabajo)
        self.assertEqual(self.almacen.objetos, objetos)
        self.assertEqual(self.efectos, ["subir", "desplegar"])
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar("2")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_recuperacion_deploy_incierto_solo_confirma_observaciones_exactas(self) -> None:
        """Un nuevo intento nunca redespliega ni confirma una versión externa."""
        self.perder = "desplegar"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.observar_construccion.return_value = ANTERIOR
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()
        self.cliente.observar_construccion.return_value = NUEVA
        self.assertEqual(self.recuperar("3")["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_recuperacion_incierta_sin_coincidencia_o_multiple_no_sube(self) -> None:
        """Un acuse perdido antes del efecto sigue incierto y nunca habilita retry upload."""
        self.cliente.perder = "subiendo"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        exacta = {"versionId": NUEVA, "tag": SOLICITUD, "message": self.artefacto["sha256Artefacto"]}
        for intento, versiones in (("2", []), ("3", [exacta, exacta])):
            self.versiones = versiones
            with self.subTest(intento=intento), self.assertRaises(modulo.ErrorActivacion):
                self.recuperar(intento)
        self.assertEqual(self.efectos, [])
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], "subiendo")

    def test_recuperacion_preparada_exige_estado_anterior_antes_relevo_y_upload(self) -> None:
        """Un escritor externo detiene la recuperación antes del CAS y del primer efecto."""
        self.cliente.perder = "preparar"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        previo = copy.deepcopy(self.cliente.estado)
        externos = (
            {"deploymentId": DEPLOYMENT, "versiones": [{"versionId": ANTERIOR, "porcentaje": 100}]},
            {"deploymentId": ANTERIOR, "versiones": [{"versionId": NUEVA, "porcentaje": 100}]},
            {
                "deploymentId": ANTERIOR,
                "versiones": [
                    {"versionId": ANTERIOR, "porcentaje": 50},
                    {"versionId": NUEVA, "porcentaje": 50},
                ],
            },
        )
        for externo in externos:
            self.cliente.estado = copy.deepcopy(previo)

            def proveedor(
                adaptador: modulo.AdaptadorVersiones, operacion: str, *, externo: dict = externo, **campos: object
            ) -> dict:
                if operacion == "estado" and self.cliente.estado["ultimaActivacion"]["fase"] == "preparada":
                    return externo
                return self.proveedor(adaptador, operacion, **campos)

            with self.subTest(externo=externo), patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor):
                with self.assertRaises(modulo.ErrorActivacion):
                    self.recuperar()
                self.assertEqual(self.cliente.estado, previo)
                self.assertEqual(self.efectos, [])
        self.assertNotIn("recuperar", self.cliente.pasos)
        self.assertEqual(self.recuperar()["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_recuperacion_perdida_de_acuses_no_duplica_efectos(self) -> None:
        """El relevo y la fase de efecto sobreviven al acuse perdido y cercan el permiso."""
        self.cliente.perder = "preparar"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = "recuperar"
        with self.assertRaises(OSError):
            self.recuperar()
        self.assertEqual(self.efectos, [])
        self.cliente.perder = "subiendo"
        with self.assertRaises(OSError):
            self.recuperar()
        self.cliente.perder = None
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar("3")
        self.assertEqual(self.efectos, [])

    def test_recuperacion_exige_activacion_indice_recibo_y_permiso(self) -> None:
        """Ni una lectura ni un candidato huérfano autorizan construir o activar."""
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()
        self.assertEqual(self.cliente.pasos, [])
        self.cliente.perder = "preparar"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.cliente.perder = None
        self.cliente.autorizar_recuperacion = False
        with self.assertRaises(modulo.ErrorActivacion):
            self.recuperar()
        self.cliente.autorizar_recuperacion = True
        self.assertNotIn("recuperar", self.cliente.pasos)
        self.cliente.estado["ultimaActivacion"]["trabajo"]["huellaRecibo"] = "0" * 64
        with self.assertRaises(modulo.CandidatoNoVerificable):
            self.recuperar()
        # Sin efectos, la recuperación cierra el rechazo como la activación, con el relevo de este intento.
        self.assertEqual(self.cliente.pasos[-2:], ["recuperar", "rechazar"])
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["error"], "candidato_no_verificable")
        self.assertEqual(self.efectos, [])

    def test_recorrido_completo_artefacto_real_sin_reavanzar_base(self) -> None:
        """Toda mutación espera su fase y la publicación espera las tres observaciones."""
        resultado = self.ejecutar()
        self.assertEqual(resultado["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])
        self.assertEqual(
            self.cliente.pasos, ["reservar", "preparar", "subiendo", "subida", "promoviendo", "confirmada"]
        )
        self.cliente.comprobar_manifiesto_web.assert_called_once_with("https://publico.example", self.web_sha)
        self.assertEqual(self.almacen.objetos[REFERENCIA], self.base_conservada)
        self.assertFalse(any(evento[0] in ("control", "guardar") for evento in self.almacen.eventos))
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_nueva_reserva_sustituye_activacion_terminal_ajena(self) -> None:
        """La instantánea inmutable de una intención anterior permite reservar el siguiente trabajo."""
        self.ejecutar()
        anterior = self.cliente.estado["ultimaActivacion"]
        anterior["trabajo"]["solicitudId"] = "87654321-1234-4234-8234-123456789abc"
        anterior["trabajo"]["revisionReserva"] = 0
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar", "subir", "desplegar"])

    def test_upload_incierto_no_se_repite_y_solo_tag_y_sha_unicos_reconcilian(self) -> None:
        """Ausencia, tag ajeno y SHA distinto no convierten incertidumbre en permiso."""
        self.perder = "subir"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], "subiendo")
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar()
        for versiones in (
            [],
            [{"versionId": NUEVA, "tag": SOLICITUD, "message": "0" * 64}],
            [{"versionId": NUEVA, "tag": ANTERIOR, "message": self.artefacto["sha256Artefacto"]}],
        ):
            self.versiones = versiones
            with self.subTest(versiones=versiones), self.assertRaises(modulo.ErrorActivacion):
                self.ejecutar(reconciliar=True)
        exacta = {"versionId": NUEVA, "tag": SOLICITUD, "message": self.artefacto["sha256Artefacto"]}
        self.versiones = [exacta, exacta]
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar(reconciliar=True)
        self.versiones = [exacta]
        self.assertEqual(self.ejecutar(reconciliar=True)["fase"], "subida")
        self.assertEqual(self.efectos, ["subir"])
        self.perder = None
        self.assertEqual(self.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_deploy_incierto_solo_observacion_confirma_sin_repetir(self) -> None:
        """El efecto perdido se cierra mediante status, identidad servida y bytes públicos."""
        self.perder = "desplegar"
        with self.assertRaises(OSError):
            self.ejecutar()
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar()
        self.estado_versiones = [{"versionId": NUEVA, "porcentaje": 50}, {"versionId": ANTERIOR, "porcentaje": 50}]
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar(reconciliar=True)
        self.estado_versiones = [{"versionId": NUEVA, "porcentaje": 100}]
        self.cliente.observar_construccion.return_value = ANTERIOR
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar(reconciliar=True)
        self.cliente.observar_construccion.return_value = NUEVA
        self.cliente.comprobar_manifiesto_web.side_effect = ValueError("web distinta")
        with self.assertRaises(ValueError):
            self.ejecutar(reconciliar=True)
        self.cliente.comprobar_manifiesto_web.side_effect = None
        self.assertEqual(self.ejecutar(reconciliar=True)["fase"], "confirmada")
        self.assertEqual(self.efectos, ["subir", "desplegar"])

    def test_acuse_subiendo_perdido_y_repetido_nunca_suben(self) -> None:
        """El permiso exige aplicado observado, aunque la fase durable ya haya avanzado."""
        self.cliente.perder = "subiendo"
        with self.assertRaises(OSError):
            self.ejecutar()
        self.assertEqual(self.efectos, [])
        self.cliente.perder = None
        self.cliente.estado["ultimaActivacion"]["fase"] = "preparada"
        self.cliente.repetir = "subiendo"
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar()
        self.assertEqual(self.efectos, [])

    def test_snapshot_indice_recibo_y_payload_ajenos_no_llegan_al_proveedor(self) -> None:
        """La tupla exacta y los bytes conservados son obligatorios antes de la primera mutación."""
        self.cliente.trabajo["huellaRecibo"] = "0" * 64
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar()
        self.assertEqual(self.efectos, [])
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], "rechazada")
        self.cliente.trabajo["huellaRecibo"] = sha(self.recibo)
        self.cliente.estado = {"version": 1, "revision": 0, "ultimaActivacion": None}
        clave = f"trabajos/{SOLICITUD}/1/123.json"
        indice = json.loads(self.almacen.objetos[clave])
        indice["version"] = 1
        indice.pop("artefacto")
        self.almacen.objetos[clave] = serializar(indice)
        with self.assertRaises(modulo.ErrorActivacion):
            self.ejecutar()
        self.assertEqual(self.efectos, [])

    def test_fallo_temporal_no_rechaza_y_mismatch_demostrado_cierra_antes_efectos(self) -> None:
        """Solo una contradicción local explícita puede liberar una intención sin efectos."""
        with (
            patch.object(modulo, "recuperar_artefacto", side_effect=OSError("transporte incierto")),
            self.assertRaises(OSError),
        ):
            self.ejecutar()
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], "reservada")
        self.assertNotIn("rechazar", self.cliente.pasos)
        self.assertEqual(self.efectos, [])
        self.cliente.estado["ultimaActivacion"]["trabajo"]["huellaRecibo"] = "0" * 64
        with self.assertRaises(modulo.CandidatoNoVerificable):
            self.ejecutar()
        actual = self.cliente.estado["ultimaActivacion"]
        self.assertEqual(actual["fase"], "rechazada")
        self.assertEqual(actual["error"], "candidato_no_verificable")
        self.assertEqual(self.efectos, [])

    def test_configuracion_incompatible_en_lectura_rechaza_sin_subir(self) -> None:
        """El rechazo explícito del adaptador en estado precede a cualquier permiso de upload."""

        def proveedor(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            if operacion == "estado":
                raise contrato.ConfiguracionNoAdmitida(modulo.ERROR)
            return self.proveedor(adaptador, operacion, **campos)

        with (
            patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
            self.assertRaises(contrato.ConfiguracionNoAdmitida),
        ):
            self.ejecutar()
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], "rechazada")
        self.assertEqual(self.cliente.estado["ultimaActivacion"]["error"], "despliegue_no_admitido")
        self.assertEqual(self.efectos, [])

    def test_variante_distinta_o_ausente_rechaza_sin_tocar_el_proveedor(self) -> None:
        """Una construcción de otra variante, o que no declara la suya, nunca llega a Cloudflare ni se descarga."""
        operaciones: list[str] = []

        def proveedor(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            operaciones.append(operacion)
            return self.proveedor(adaptador, operacion, **campos)

        leer_real = variante_del_artefacto.leer_descriptor_artefacto

        def sin_variante(*argumentos: object) -> dict:
            descriptor = leer_real(*argumentos)
            del descriptor["destino"]
            return descriptor

        privada = replace(self.config, ejecucion=replace(self.config.ejecucion, variante_cloudflare="privado"))
        for config, descriptor in ((privada, leer_real), (self.config, sin_variante)):
            with self.subTest(variante=config.ejecucion.variante_cloudflare, descriptor=descriptor.__name__):
                self.cliente.estado = {"version": 1, "revision": 0, "ultimaActivacion": None}
                with (
                    patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
                    patch.object(variante_del_artefacto, "leer_descriptor_artefacto", side_effect=descriptor),
                    patch.object(modulo, "recuperar_artefacto", wraps=modulo.recuperar_artefacto) as descarga,
                    self.assertRaises(variante_del_artefacto.VarianteNoAdmitida) as error,
                ):
                    modulo.activar_trabajo(config, self.cliente, self.almacen)
                self.assertIn("No se ha subido nada", str(error.exception))
                actual = self.cliente.estado["ultimaActivacion"]
                self.assertEqual(actual["fase"], "rechazada")
                self.assertEqual(actual["error"], "despliegue_no_admitido")
                self.assertIsNone(actual["evidencia"])
                self.assertEqual(operaciones, [])
                self.assertEqual(self.efectos, [])
                descarga.assert_not_called()

    def test_recuperar_con_otra_variante_rechaza_antes_de_efectos_sin_tocar_el_proveedor(self) -> None:
        """La recuperación cierra como rechazada una activación sin efectos; con efectos, la deja en su fase."""
        operaciones: list[str] = []

        def proveedor(adaptador: modulo.AdaptadorVersiones, operacion: str, **campos: object) -> dict:
            operaciones.append(operacion)
            return self.proveedor(adaptador, operacion, **campos)

        oficial = self.config
        privada = replace(oficial, ejecucion=replace(oficial.ejecucion, variante_cloudflare="privado"))
        for perdido, fase in (("reservar", "reservada"), ("preparar", "preparada"), ("subiendo", "subiendo")):
            with self.subTest(fase=fase):
                self.config = oficial
                self.cliente.estado = {"version": 1, "revision": 0, "ultimaActivacion": None}
                self.cliente.pasos.clear()
                self.cliente.perder = perdido
                with self.assertRaises(OSError):
                    self.ejecutar()
                self.cliente.perder = None
                self.assertEqual(self.cliente.estado["ultimaActivacion"]["fase"], fase)
                operaciones.clear()
                self.config = privada
                with (
                    patch.object(modulo.AdaptadorVersiones, "operar", new=proveedor),
                    patch.object(modulo, "recuperar_artefacto", wraps=modulo.recuperar_artefacto) as descarga,
                    self.assertRaises(variante_del_artefacto.VarianteNoAdmitida),
                ):
                    self.recuperar()
                actual = self.cliente.estado["ultimaActivacion"]
                rechazada = fase != "subiendo"
                self.assertEqual(actual["fase"], "rechazada" if rechazada else fase)
                self.assertEqual(actual["error"], "despliegue_no_admitido" if rechazada else None)
                self.assertEqual(self.cliente.pasos[-2:] == ["recuperar", "rechazar"], rechazada)
                self.assertEqual(operaciones, [])
                self.assertEqual(self.efectos, [])
                descarga.assert_not_called()
        self.config = oficial

    def test_no_validado_se_omite_por_la_tupla_actual_sin_reservar(self) -> None:
        """Rechazo y ausencia de pendientes nunca activan otro trabajo validado anterior."""
        for resultado in ("rechazado", "sin-pendientes"):
            cuerpo = json.loads(self.recibo)
            cuerpo["resultado"] = resultado
            cuerpo["huellaPaquete"] = None
            indice = {"version": 2, "revisionCodigo": CODIGO, "accion": "actualizar-datos"}
            cliente = Mock()
            cliente.activacion.return_value = {"estado": "leido", "activacion": copy.deepcopy(self.cliente.estado)}
            with patch.object(modulo, "recuperar_trabajo", return_value=(indice, serializar(cuerpo))) as recuperar:
                resumen = modulo.activar_trabajo(self.config, cliente, self.almacen)
            self.assertEqual(resumen["fase"], "omitida")
            self.assertEqual(resumen["resultado"], resultado)
            recuperar.assert_called_once_with(SOLICITUD, 1, "123", self.almacen)
            # Solo se lee la activación, por si hay un cierre pedido o una abandonada que reintentar; nunca se reserva.
            llamadas = [c.args for c in cliente.activacion.call_args_list]
            self.assertEqual(llamadas, [("leer",)])
        self.assertEqual(self.efectos, [])

    def test_payload_roto_snapshot_ajeno_y_manifiesto_no_se_degradan(self) -> None:
        """Las fallas comprobadas previas conservan intención pendiente sin mutaciones remotas."""
        for cambio in ("runId", "sha", "payload"):
            with self.subTest(cambio=cambio):
                original = copy.deepcopy(self.cliente.trabajo)
                if cambio == "runId":
                    self.cliente.trabajo["runId"] = "456"
                elif cambio == "sha":
                    self.cliente.trabajo["confianza"]["sha"] = "b" * 40
                else:
                    clave = next(clave for clave in self.almacen.objetos if clave.startswith("blobs/"))
                    contenido = self.almacen.objetos[clave]
                    self.almacen.objetos[clave] = contenido + b"roto"
                self.cliente.estado = {"version": 1, "revision": 0, "ultimaActivacion": None}
                with self.assertRaises(ValueError):
                    self.ejecutar()
                self.cliente.trabajo = original
                if cambio == "payload":
                    self.almacen.objetos[clave] = contenido
                self.assertEqual(self.efectos, [])

    def test_entrada_adaptador_privada_y_entorno_sin_oidc_ni_bucket(self) -> None:
        """El bridge fija solicitud íntegra, omite secretos ajenos y comprueba correlación de salida."""
        adaptador = modulo.AdaptadorVersiones(self.config, self.trabajos)
        adaptador.artefacto = {"ruta": str(self.raiz / "recuperado"), **self.artefacto}

        def proceso(orden: list, cwd: Path, plazo: int, entorno: dict) -> subprocess.CompletedProcess:
            solicitud = json.loads(Path(orden[-1]).read_bytes())
            self.assertEqual(solicitud["artefacto"], adaptador.artefacto)
            self.assertEqual(solicitud["servicio"], "cursos")
            self.assertEqual(solicitud["configuracion"], str(self.configuracion.resolve()))
            self.assertEqual(solicitud["configuracionCursos"], str(self.configuracion_cursos.resolve()))
            self.assertEqual(Path(orden[-1]).stat().st_mode & 0o777, 0o600)
            self.assertEqual(set(entorno), {"PATH", "TMPDIR", "CLOUDFLARE_API_TOKEN"})
            respuesta = {
                "version": 1,
                "operacion": "subir",
                "servicio": solicitud["servicio"],
                "intencionId": SOLICITUD,
                "artefacto": self.artefacto,
                "resultado": {"versionId": NUEVA},
            }
            return subprocess.CompletedProcess(orden, 0, json.dumps(respuesta), "")

        with (
            patch.dict(
                os.environ,
                {
                    "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "OIDC",
                    "FARO_ALMACEN_SECRET_ACCESS_KEY": "S3",
                    "CLOUDFLARE_API_TOKEN": "CF",
                },
                clear=True,
            ),
            patch.object(adaptador_versiones, "ejecutar_con_plazo", side_effect=proceso),
            patch.object(adaptador_versiones.shutil, "which", return_value="/node"),
        ):
            self.assertEqual(OPERAR_REAL(adaptador, "subir", servicio="cursos"), {"versionId": NUEVA})
        # Sin artefacto, solo la lectura del estado: la solicitud y la respuesta lo llevan vacío.
        adaptador.artefacto = None

        def estado(orden: list, cwd: Path, plazo: int, entorno: dict) -> subprocess.CompletedProcess:
            solicitud = json.loads(Path(orden[-1]).read_bytes())
            self.assertIsNone(solicitud["artefacto"])
            respuesta = {
                "version": 1,
                "operacion": "estado",
                "servicio": "principal",
                "intencionId": SOLICITUD,
                "artefacto": None,
                "resultado": {"deploymentId": ANTERIOR, "versiones": []},
            }
            return subprocess.CompletedProcess(orden, 0, json.dumps(respuesta), "")

        with (
            patch.object(adaptador_versiones, "ejecutar_con_plazo", side_effect=estado),
            patch.object(adaptador_versiones.shutil, "which", return_value="/node"),
        ):
            self.assertEqual(OPERAR_REAL(adaptador, "estado", servicio="principal")["deploymentId"], ANTERIOR)
            with self.assertRaises(modulo.ErrorActivacion):
                OPERAR_REAL(adaptador, "subir", servicio="principal")


if __name__ == "__main__":
    unittest.main()
