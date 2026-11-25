"""Candidatos pequeños con el motor real y órdenes dobles, sin red ni despliegues."""

import hashlib
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import instante_del_ciclo
from plataforma_datos.orquestacion import actualizar, candidato, comprobaciones_remotas, sustitucion
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe_fechado
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.estado_de_la_actualizacion import (
    SIN_INTENTO,
    VERSION_REGISTRO,
    pendientes,
)
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS, Plan, planificar
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos, montar
from plataforma_datos.orquestacion.pruebas.test_contrato_recibo_mantenimiento import leer_en_typescript

CIFRAS_VERSION = 16
INDICE_MODULO = 2


class EjecutorCandidato(EjecutorDeModulos):
    """Dobla solo los procesos externos; el coordinador/estado/publicación son reales."""

    def __init__(self, fallos: dict[str, str] | None = None, artefacto_valido: bool = True) -> None:
        super().__init__(fallos)
        self.artefacto_valido = artefacto_valido

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Responde al cotejo y al import del contrato real de versión.

        Returns:
            Resultado sintético de la orden fija solicitada.
        """
        if tuple(orden) == candidato.ORDEN_IDENTIDAD:
            self.ordenes.append(list(orden))
            version = hashlib.sha256((area / "datos" / "manifiesto.json").read_bytes()).hexdigest()[:CIFRAS_VERSION]
            return actualizar.Resultado(0, json.dumps({"version": version}))
        if tuple(orden) == actualizar.COTEJO_DE_ARTEFACTOS.orden and not self.artefacto_valido:
            return actualizar.Resultado(1, "privado/secreto")
        return super().__call__(list(orden), area)


def preparar(raiz: Path) -> None:
    """Monta una generación operativa mínima y una colección abierta vacía."""
    montar(raiz)
    fichas = raiz / "var" / "actualizacion" / "preparados" / "abierta" / "fichas.json"
    fichas.parent.mkdir(parents=True)
    fichas.write_text('{"fichas":[],"plataformas":{}}', encoding="utf-8")


class EjecutorQueNoVerifica(EjecutorCandidato):
    """Como EjecutorCandidato, pero las comprobaciones del producto fallan: el paquete no queda en verde."""

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Falla en «npm run verificar:datos» y responde como EjecutorCandidato al resto.

        Returns:
            El resultado simulado de la orden.
        """
        if tuple(orden) == tuple(actualizar.COMPROBACIONES[0].orden):
            self.ordenes.append(orden)
            return actualizar.Resultado(1, "fallo simulado")
        return super().__call__(orden, area)


class EjecutorSinNovedad(EjecutorCandidato):
    """Como EjecutorCandidato, pero el paquete exportado es idéntico al publicado: la ronda no trae nada nuevo."""

    def __init__(self, raiz: Path, fallos: dict[str, str]) -> None:
        super().__init__(fallos)
        self.raiz = raiz

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Exporta una copia de lo publicado y responde como EjecutorCandidato al resto.

        Returns:
            El resultado simulado de la orden.
        """
        resultado = super().__call__(orden, area)
        if "plataforma_datos.orquestacion.exportar_paquete" in orden:
            shutil.rmtree(area / "datos")
            shutil.copytree(self.raiz / "datos", area / "datos")
        return resultado


class PruebaCandidato(unittest.TestCase):
    """Recibo de candidato y compatibilidad del coordinador público anterior."""

    def setUp(self) -> None:
        """Prepara raíz propia con nombres portátiles y sin pausas reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.raiz = self.temporal / "Mis documentos" / "Año 2026"
        preparar(self.raiz)
        parche = mock.patch.object(actualizar.time, "sleep")
        parche.start()
        self.addCleanup(parche.stop)
        ambiente = mock.patch.dict(os.environ, {"FARO_AVISO": ""})
        ambiente.start()
        self.addCleanup(ambiente.stop)

    def test_nominal_recibo_y_version_publica_actual(self) -> None:
        """La versión corresponde al manifiesto; el recibo no afirma activación."""
        ejecutor = EjecutorCandidato()
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(recibo["veredicto"], "verde")
        esperada = hashlib.sha256((self.raiz / "datos" / "manifiesto.json").read_bytes()).hexdigest()[:CIFRAS_VERSION]
        self.assertEqual(recibo["huellaPaquete"], esperada)
        self.assertEqual(
            set(recibo),
            {
                "version",
                "catalogo",
                "accion",
                "resultado",
                "veredicto",
                "terminadoEn",
                "estado",
                "huellaPaquete",
                "error",
                "conservados",
            },
        )
        self.assertEqual(recibo["version"], 4)
        self.assertEqual(recibo["conservados"], [])
        self.assertNotIn("activa", recibo)
        self.assertEqual([m["id"] for m in recibo["estado"]["modulos"]], list(IDS))
        self.assertEqual(sum(tuple(o) == candidato.ORDEN_IDENTIDAD for o in ejecutor.ordenes), 1)

    def test_accion_ajena_no_ejecuta_ni_admite_argumentos(self) -> None:
        """El contrato rechaza entradas arbitrarias antes de invocar el motor."""
        ejecutor = mock.Mock()
        with self.assertRaises(ValueError):
            candidato.ejecutar_candidato(self.raiz, "actualizar-datos; echo secreto", ejecutor)
        ejecutor.assert_not_called()

    def test_actualizar_a_demanda_fuerza_consultas_del_plan_real(self) -> None:
        """Consulta todas las fuentes automáticas incluso recientes, sin descargar entradas locales."""
        ahora = datetime.now(UTC)
        recientes = {conjunto.id: ahora for conjunto in CONJUNTOS if conjunto.operacion == "descargar"}
        self.assertEqual(planificar(ahora, recientes).fuentes, ())
        plan = planificar(ahora, recientes, forzar=True)
        esperadas = {conjunto.fuente for conjunto in CONJUNTOS if conjunto.operacion == "descargar"}
        self.assertTrue(esperadas)
        self.assertEqual(set(plan.fuentes), esperadas)
        self.assertTrue(plan.modulos)
        ejecutor = EjecutorCandidato()
        real = actualizar.actualizar_con_resultado
        with mock.patch.object(actualizar, "actualizar_con_resultado", wraps=real) as ejecutar:
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(ejecutar.call_args.args[1], actualizar.Opciones(forzar_comprobaciones=True))
        self.assertTrue(all(modulo["veredicto"] == "verde" for modulo in recibo["estado"]["modulos"]))
        descargadas = {
            etapa[0]
            for orden in ejecutor.ordenes
            if (etapa := etapa_de_fuente(orden)) is not None and etapa[1] == "descargar"
        }
        self.assertEqual(descargadas, esperadas)

    def test_ensayo_con_datos_grabados_valida_sin_descargar_y_con_un_solo_instante(self) -> None:
        """Con todas las fuentes sin descargar, el ciclo entero valida sin ninguna orden de descarga.

        Como en el ensayo, el instante es su comienzo, ya pasado. El comienzo del intento, el seguimiento de las
        comprobaciones, el estado del panel y el catálogo del recibo llevan ese instante, no la hora en que ocurren:
        si el intento anotara la hora real, el panel lo vería después de su instante y no validaría.
        """
        ejecutor = EjecutorCandidato()
        momento = (datetime.now(UTC) - timedelta(hours=1)).replace(microsecond=0)
        instante = momento.isoformat().replace("+00:00", "Z")
        with (
            mock.patch.dict(os.environ, {"FARO_INSTANTE": instante}),
            mock.patch("plataforma_datos.cursos.panel_catalogo.crear", return_value=None) as crear,
            mock.patch.object(candidato, "estado_panel", wraps=candidato.estado_panel) as panel,
        ):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor, sin_descargar=tuple(FUENTES))
        self.assertEqual(recibo["resultado"], "validado")
        etapas = {etapa[1] for orden in ejecutor.ordenes if (etapa := etapa_de_fuente(orden)) is not None}
        self.assertTrue(etapas)
        self.assertNotIn("descargar", etapas)
        self.assertEqual(crear.call_args.kwargs["corte_utc"], instante)
        # La comprobación de entrada (con el comienzo del intento) y el estado del recibo, con el instante fijado.
        self.assertEqual({llamada.args[1] for llamada in panel.call_args_list}, {momento})
        self.assertEqual(recibo["estado"]["observadoEn"], instante)
        self.assertEqual({modulo["ultimoIntento"] for modulo in recibo["estado"]["modulos"]}, {instante})
        registro = comprobaciones_remotas.leer_registro(self.raiz)
        ciclo = registro["ultimo_ciclo"]
        self.assertEqual((registro["reloj_utc"], ciclo["inicio_utc"], ciclo["fin_utc"]), (instante,) * 3)
        self.assertEqual({fila["fin_utc"] for fila in registro["fuentes"].values()}, {instante})

    def test_sin_instante_fijado_el_intento_anota_la_hora_real(self) -> None:
        """En producción no hay instante fijado: el comienzo del intento y su seguimiento llevan la hora real."""
        self.assertNotIn("FARO_INSTANTE", os.environ)
        antes = datetime.now(UTC).replace(microsecond=0)
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        despues = datetime.now(UTC)
        self.assertEqual(recibo["resultado"], "validado")
        registro = comprobaciones_remotas.leer_registro(self.raiz)
        anotados = [
            registro["ultimo_ciclo"]["inicio_utc"],
            registro["ultimo_ciclo"]["fin_utc"],
            *(modulo["ultimoIntento"] for modulo in recibo["estado"]["modulos"]),
        ]
        for anotado in anotados:
            self.assertTrue(antes <= datetime.fromisoformat(anotado.replace("Z", "+00:00")) <= despues, anotado)

    def test_ensayo_que_reutiliza_un_validado_no_lo_prepara_y_valida(self) -> None:
        """Una fuente sin originales en la base solo valida su versión vigente, y el ciclo sigue validando."""
        preparadas = {
            etapa[0]
            for orden in self._ensayo(EjecutorCandidato(), ())[1].ordenes
            if (etapa := etapa_de_fuente(orden)) is not None and etapa[1] == "preparar"
        }
        fuente = sorted(preparadas)[0]
        recibo, ejecutor = self._ensayo(EjecutorCandidato(), (fuente,))
        self.assertEqual(recibo["resultado"], "validado")
        etapas = [e[1] for orden in ejecutor.ordenes if (e := etapa_de_fuente(orden)) is not None and e[0] == fuente]
        self.assertEqual(etapas, ["validar"])

    def _ensayo(self, ejecutor: EjecutorCandidato, reutilizar: tuple[str, ...]) -> tuple[dict, EjecutorCandidato]:
        recibo = candidato.ejecutar_candidato(
            self.raiz, "actualizar-datos", ejecutor, sin_descargar=tuple(FUENTES), reutilizar_validado=reutilizar
        )
        return recibo, ejecutor

    def test_demanda_recompone_pendiente_local_sin_descargar(self) -> None:
        """Reintenta una entrada manual desde su copia conservada, sin conceder descarga remota."""
        comienzo = (datetime.now(UTC) - timedelta(days=2)).replace(microsecond=0).isoformat()
        siguiente = (datetime.fromisoformat(comienzo) + timedelta(days=1)).isoformat()
        modulos = {nombre: dict(SIN_INTENTO) for nombre in IDS}
        modulos["memoria"].update(
            ultimo_intento_utc=comienzo,
            veredicto="ámbar",
            fallos_seguidos=1,
            proximo_reintento_utc=siguiente,
        )
        carpeta = self.raiz / CARPETA_DE_INFORMES
        carpeta.mkdir()
        ruta = carpeta / "estado.json"
        ruta.write_text(
            json.dumps(
                {
                    "version": VERSION_REGISTRO,
                    "origen_migracion": None,
                    "actualizacion": {
                        "comienzo_utc": comienzo,
                        "veredicto": "ámbar",
                        "informe": "privado",
                        "huella_resultados": "b" * 64,
                        "integridad_resultados": "huella_conservada",
                    },
                    "modulos": modulos,
                }
            ),
            encoding="utf-8",
        )
        self.assertIn("memoria", pendientes(self.raiz, datetime.now(UTC)))
        ejecutor = EjecutorCandidato()
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        self.assertEqual(recibo["resultado"], "validado")
        memoria = json.loads(ruta.read_text())["modulos"]["memoria"]
        self.assertEqual(memoria["veredicto"], "verde")
        self.assertEqual(memoria["fallos_seguidos"], 0)
        self.assertNotIn("memoria", pendientes(self.raiz, datetime.now(UTC)))
        self.assertEqual(
            [
                etapa[1]
                for orden in ejecutor.ordenes
                if (etapa := etapa_de_fuente(orden)) is not None and etapa[0] == "memoria"
            ],
            ["preparar", "validar"],
        )

    def test_plan_no_admite_otra_seleccion_externa(self) -> None:
        """Separar validaciones internas no autoriza combinar modos y módulos en la entrada pública.

        La búsqueda forzada sí se acota a módulos del registro: test_acciones_del_motor prueba esa combinación.
        """
        for opciones in (
            actualizar.Opciones(solo=("memoria",), programada=True),
            actualizar.Opciones(programada=True, forzar_comprobaciones=True),
            actualizar.Opciones(reintentar_pendientes=True, solo=()),
            actualizar.Opciones(reintentar_pendientes=True, programada=True),
            actualizar.Opciones(reintentar_pendientes=True, forzar_comprobaciones=True),
        ):
            with self.subTest(opciones=opciones), self.assertRaises(ValueError):
                actualizar.actualizar_con_resultado(self.raiz, opciones, mock.Mock())
        self.assertFalse((self.raiz / CARPETA_DE_INFORMES).exists())

    def test_sin_pendientes_no_ejecuta_ni_inventa_informe(self) -> None:
        """Código nominal de no trabajo no se confunde con un candidato nuevo."""
        ejecutor = mock.Mock(side_effect=AssertionError("no debe ejecutar procesos"))
        real = actualizar.actualizar_con_resultado
        with mock.patch.object(actualizar, "actualizar_con_resultado", wraps=real) as ejecutar:
            recibo = candidato.ejecutar_candidato(self.raiz, "reintentar-pendientes", ejecutor)
        ejecutar.assert_called_once()
        self.assertTrue(ejecutar.call_args.args[1].reintentar_pendientes)
        ejecutor.assert_not_called()
        self.assertEqual(recibo["resultado"], "sin-pendientes")
        self.assertIsNone(recibo["huellaPaquete"])
        self.assertIsNone(recibo["veredicto"])
        informes = self.raiz / CARPETA_DE_INFORMES
        self.assertEqual(list(informes.iterdir()), [informes / ".cerrojo"])

    def test_recibo_sin_activar_se_revalida_con_la_misma_huella_y_sin_consultas(self) -> None:
        """El relevo puede recuperar un paquete intacto aunque el plan de fuentes esté vacío."""
        primero = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(primero["resultado"], "validado")
        anterior = comprobaciones_remotas.leer_registro(self.raiz)["fuentes"]
        ejecutor = EjecutorSinNovedad(self.raiz, {})
        with mock.patch.object(actualizar, "plan_desde_registro", return_value=Plan((), (), ())):
            siguiente = candidato.ejecutar_candidato(
                self.raiz, "comprobar-programada", ejecutor, revisar_paquete_pendiente=True
            )
        self.assertEqual(siguiente["resultado"], "validado")
        self.assertEqual(siguiente["huellaPaquete"], primero["huellaPaquete"])
        self.assertEqual(anterior, comprobaciones_remotas.leer_registro(self.raiz)["fuentes"])
        self.assertIn(list(actualizar.COTEJO_DE_ARTEFACTOS.orden), ejecutor.ordenes)
        with mock.patch.object(actualizar, "plan_desde_registro", return_value=Plan((), (), ())):
            rechazado = candidato.ejecutar_candidato(
                self.raiz, "comprobar-programada", EjecutorQueNoVerifica(), revisar_paquete_pendiente=True
            )
        self.assertEqual(rechazado["resultado"], "rechazado")
        self.assertIsNone(rechazado["huellaPaquete"])

    def test_pendientes_reutiliza_estado_y_recompone_dependientes_sin_red(self) -> None:
        """Solo tich descarga; sus consumidores recompuestos y el paquete quedan reflejados en el recibo."""
        comienzo = (datetime.now(UTC) - timedelta(days=2)).replace(microsecond=0).isoformat()
        siguiente = (datetime.fromisoformat(comienzo) + timedelta(days=1)).isoformat()
        modulos = {nombre: dict(SIN_INTENTO) for nombre in IDS}
        modulos["tich"] = {
            **SIN_INTENTO,
            "ultimo_intento_utc": comienzo,
            "veredicto": "ámbar",
            "fallos_seguidos": 1,
            "proximo_reintento_utc": siguiente,
        }
        carpeta = self.raiz / CARPETA_DE_INFORMES
        carpeta.mkdir()
        (carpeta / "estado.json").write_text(
            json.dumps(
                {
                    "version": VERSION_REGISTRO,
                    "origen_migracion": None,
                    "actualizacion": {
                        "comienzo_utc": comienzo,
                        "veredicto": "ámbar",
                        "informe": "privado",
                        "huella_resultados": "b" * 64,
                        "integridad_resultados": "huella_conservada",
                    },
                    "modulos": modulos,
                }
            ),
            encoding="utf-8",
        )
        # Su consulta remota falló: solo el registro de comprobaciones concede volver a descargarla.
        instante = datetime.fromisoformat(comienzo)
        ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, instante, "programada")
        conjuntos = tuple(conjunto.id for conjunto in CONJUNTOS if conjunto.fuente == "tich")
        comprobaciones_remotas.iniciar_fuente(self.raiz, ciclo, "tich", conjuntos, instante, remoto=True)
        comprobaciones_remotas.terminar_fuente(self.raiz, ciclo, "tich", instante, resultado="fallo", evidencia=None)
        comprobaciones_remotas.cerrar_ciclo(self.raiz, ciclo, instante, resultado="fallo", paquete_preparado=False)
        validados = self.raiz / "var" / "actualizacion" / "validados"
        antes = sustitucion.huellas_del_arbol(validados)
        ejecutor = EjecutorCandidato()
        recibo = candidato.ejecutar_candidato(self.raiz, "reintentar-pendientes", ejecutor)
        self.assertEqual(recibo["resultado"], "validado")
        etapas = [etapa for orden in ejecutor.ordenes if (etapa := etapa_de_fuente(orden)) is not None]
        dependientes = ("mundo_eurostat", "ilostat", "tic_llars", "datos_globales")
        self.assertEqual(
            etapas,
            [("tich", "descargar"), ("tich", "preparar"), ("tich", "validar")]
            + [(nombre, etapa) for nombre in dependientes for etapa in ("preparar", "validar")],
        )
        despues = sustitucion.huellas_del_arbol(validados)
        self.assertEqual(
            {ruta for ruta in antes if antes[ruta] != despues[ruta]},
            {"tich/v.json", "mundo-eurostat/v.json", "ilostat/v.json", "tic-llars/v.json", "datos-globales/v.json"},
        )
        self.assertEqual(set(antes), set(despues))
        modulos_recibo = {m["id"]: m for m in recibo["estado"]["modulos"]}
        ejecutados = {"tich", *dependientes, "paquete"}
        self.assertEqual({nombre for nombre, m in modulos_recibo.items() if m["veredicto"] == "verde"}, ejecutados)
        self.assertTrue(
            all(m["ultimoIntento"] is None for nombre, m in modulos_recibo.items() if nombre not in ejecutados)
        )
        posterior = candidato.estado_panel(self.raiz, datetime.now(UTC))
        self.assertEqual(posterior["modulos"], recibo["estado"]["modulos"])
        self.assertNotIn("activa", recibo)

    def test_ambar_con_paquete_en_verde_se_valida_y_dice_que_conserva(self) -> None:
        """Una fuente que falla no frena al resto: se valida y el recibo dice qué versión anterior se conserva."""
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato({"citilab": "codigo"}))
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(recibo["veredicto"], "ámbar")
        self.assertIsNotNone(recibo["huellaPaquete"])
        citilab = next(m for m in recibo["estado"]["modulos"] if m["id"] == "citilab")
        self.assertEqual((citilab["veredicto"], citilab["fallos"]), ("ámbar", 1))
        fecha = (citilab["ultimaVersionBuena"] or {}).get("fecha")
        self.assertEqual(recibo["conservados"], [{"id": "citilab", "fecha": fecha}])
        self.assertEqual(next(m for m in recibo["estado"]["modulos"] if m["id"] == "paquete")["veredicto"], "verde")
        completo = {**recibo, "solicitudId": "00000000-1234-4234-8234-123456789abc", "revisionReserva": 1}
        v3 = {k: v for k, v in completo.items() if k != "conservados"}
        con_rojo = deepcopy(completo)
        next(m for m in con_rojo["estado"]["modulos"] if m["id"] == "citilab")["veredicto"] = "rojo"
        con_rojo.update(veredicto="verde", conservados=[])
        casos = [
            completo,
            {**v3, "version": trabajos.VERSION_RECIBO_CATALOGO},
            {**completo, "conservados": []},
            {**completo, "conservados": [{"id": "citilab", "fecha": "2000-01-01T00:00:00Z"}]},
            # Un módulo en rojo impide validar en los dos lenguajes, aunque el paquete esté en verde.
            con_rojo,
        ]
        python = []
        for caso in casos:
            try:
                trabajos._recibo(json.dumps(caso, ensure_ascii=False).encode())
            except ValueError:
                python.append(False)
            else:
                python.append(True)
        # Solo la v4 valida en ámbar, y solo si «conservados» coincide con el estado.
        self.assertEqual(python, [True, False, False, False, False])
        self.assertEqual(leer_en_typescript(casos), python)

    def test_ambar_sin_paquete_nuevo_se_rechaza_y_dice_que_conserva(self) -> None:
        """Si ningún cambio llega al paquete, no hay candidato nuevo; el recibo dice qué quedó en ámbar."""
        recibo = candidato.ejecutar_candidato(
            self.raiz, "actualizar-datos", EjecutorSinNovedad(self.raiz, {"citilab": "codigo"})
        )
        paquete = next(m for m in recibo["estado"]["modulos"] if m["id"] == "paquete")
        self.assertEqual(paquete["veredicto"], "verde")
        self.assertEqual((recibo["resultado"], recibo["error"]), ("rechazado", "actualizacion_no_admitida"))
        self.assertEqual(recibo["veredicto"], "ámbar")
        self.assertEqual([fila["id"] for fila in recibo["conservados"]], ["citilab"])

    def test_ambar_con_el_paquete_sin_publicar_sigue_rechazado(self) -> None:
        """Si el paquete no queda en verde no hay versión nueva que validar."""
        recibo = candidato.ejecutar_candidato(
            self.raiz, "actualizar-datos", EjecutorQueNoVerifica({"citilab": "codigo"})
        )
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertEqual(recibo["error"], "actualizacion_no_admitida")
        self.assertIsNone(recibo["huellaPaquete"])

    def test_estado_corrupto_antes_del_intento_no_se_ejecuta(self) -> None:
        """No se convierte una generación incompleta en ausencia de planificación."""
        carpeta = self.raiz / CARPETA_DE_INFORMES
        carpeta.mkdir()
        (carpeta / "estado.json").write_text("null", encoding="utf-8")
        ejecutor = mock.Mock()
        with (
            mock.patch.object(actualizar, "_actualizar") as ejecutar,
            mock.patch.object(comprobaciones_remotas, "iniciar_ciclo") as ciclo,
        ):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        ejecutar.assert_not_called()
        ciclo.assert_not_called()
        ejecutor.assert_not_called()
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertIsNone(recibo["estado"])

    def test_estado_modificado_y_reporte_viejo_no_validan(self) -> None:
        """El resultado estructurado se contrasta con el estado y reporte del mismo intento."""
        real = actualizar.actualizar_con_resultado

        def desfasado(*args: object, **opciones: object) -> actualizar.ResultadoActualizacion:
            intento = real(*args, **opciones)
            (self.raiz / CARPETA_DE_INFORMES / "estado.json").write_text("{}", encoding="utf-8")
            return intento

        with mock.patch.object(actualizar, "actualizar_con_resultado", side_effect=desfasado):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertIsNone(recibo["huellaPaquete"])

    def test_cotejo_de_artefactos_fallido_rechaza(self) -> None:
        """Una web que no se construye o no supera sus comprobaciones deja el paquete sin validar."""
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato(artefacto_valido=False))
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertIsNone(recibo["huellaPaquete"])

    def test_un_ciclo_validado_construye_la_web_una_sola_vez(self) -> None:
        """La web se construye en el área, antes de publicar; el recibo no la vuelve a construir en la raíz."""
        ejecutor = EjecutorCandidato()
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        self.assertEqual(recibo["resultado"], "validado")
        cotejos = [orden for orden in ejecutor.ordenes if tuple(orden) == actualizar.COTEJO_DE_ARTEFACTOS.orden]
        self.assertEqual(len(cotejos), 1)

    def test_api_entera_y_estructurada_conservan_ordenes_y_paquete(self) -> None:
        """La API histórica ejecuta una sola vez el mismo motor, con los mismos bytes finales."""
        otra = self.temporal / "otra"
        preparar(otra)
        uno, dos = EjecutorDeModulos(), EjecutorDeModulos()
        opciones = actualizar.Opciones(pausa=0, reintento=0)
        with mock.patch("builtins.print"):
            codigo = actualizar.actualizar(self.raiz, opciones, uno)
            resultado = actualizar.actualizar_con_resultado(otra, opciones, dos)
        self.assertEqual(codigo, resultado.codigo)
        self.assertEqual(uno.ordenes, dos.ordenes)
        self.assertEqual(actualizar.huella(self.raiz, ("datos",)), actualizar.huella(otra, ("datos",)))
        self.assertIsNotNone(resultado.comienzo)
        self.assertTrue(resultado.informe.is_file())
        self.assertEqual(resultado.resultados["paquete"].veredicto, "verde")

    def test_informe_del_resultado_debe_ser_fresco(self) -> None:
        """No basta conservar un reporte verde de una fecha anterior."""
        real = actualizar.actualizar_con_resultado

        def envejecer(*args: object, **opciones: object) -> actualizar.ResultadoActualizacion:
            intento = real(*args, **opciones)
            ruta = intento.informe.with_suffix(".json")
            informe = json.loads(ruta.read_text())
            informe["utc"] = "2000-01-01T00:00:00+00:00"
            ruta.write_text(json.dumps(informe), encoding="utf-8")
            return intento

        with mock.patch.object(actualizar, "actualizar_con_resultado", side_effect=envejecer):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertIsNone(recibo["huellaPaquete"])

    def test_dos_intentos_verdes_del_mismo_segundo_conservan_recibo(self) -> None:
        """La colisión del nombre no convierte el segundo informe en un futuro falso."""
        momento = datetime.now(UTC).replace(microsecond=0)
        with (
            mock.patch.object(actualizar, "datetime", wraps=datetime) as reloj_motor,
            mock.patch.object(informe_fechado, "datetime", wraps=datetime) as reloj_informe,
            mock.patch.object(candidato, "datetime", wraps=datetime) as reloj_recibo,
            mock.patch.object(instante_del_ciclo, "datetime", wraps=datetime) as reloj_del_ciclo,
        ):
            for reloj in (reloj_motor, reloj_informe, reloj_recibo, reloj_del_ciclo):
                reloj.now.return_value = momento
            primero = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
            registro_primero = comprobaciones_remotas.leer_registro(self.raiz)
            datos_primero = actualizar.huella(self.raiz, ("datos",))
            segundo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
            registro_segundo = comprobaciones_remotas.leer_registro(self.raiz)
        self.assertEqual(primero["resultado"], "validado")
        self.assertEqual(segundo["resultado"], "validado")
        self.assertEqual(actualizar.huella(self.raiz, ("datos",)), datos_primero)
        ciclo_primero = registro_primero["ultimo_ciclo"]["id"]
        ciclo_segundo = registro_segundo["ultimo_ciclo"]["id"]
        self.assertNotEqual(ciclo_primero, ciclo_segundo)
        for recibo, registro in ((primero, registro_primero), (segundo, registro_segundo)):
            ciclo = registro["ultimo_ciclo"]
            self.assertEqual(ciclo["resultado"], "preparado")
            self.assertTrue(ciclo["paquete_preparado"])
            operaciones = [fuente for fuente in recibo["estado"]["fuentes"] if fuente["ultimaOperacion"] is not None]
            self.assertTrue(operaciones)
            for fuente in operaciones:
                self.assertEqual(fuente["ultimaOperacion"]["ciclo"], ciclo["id"])
                self.assertEqual(fuente["ultimaOperacion"]["ciclo"], registro["fuentes"][fuente["id"]]["ciclo"])
            intentos = [
                fuente["ultimoIntento"]
                for fuente in recibo["estado"]["seguimientoRemoto"]
                if fuente["ultimoIntento"] is not None
            ]
            self.assertTrue(intentos)
            for intento in intentos:
                self.assertEqual(intento["ciclo"], ciclo["id"])
        # El doble no aporta recepción HTTP: solo cambia la identidad de la operación, aun en el mismo segundo.
        esperado = deepcopy(primero)
        for fuente in esperado["estado"]["fuentes"]:
            if fuente["ultimaOperacion"] is not None:
                fuente["ultimaOperacion"]["ciclo"] = ciclo_segundo
        for fuente in esperado["estado"]["seguimientoRemoto"]:
            if fuente["ultimoIntento"] is not None:
                self.assertEqual(fuente["ultimoIntento"]["ciclo"], ciclo_primero)
                fuente["ultimoIntento"]["ciclo"] = ciclo_segundo
        self.assertEqual(segundo, esperado)
        informes = sorted((self.raiz / CARPETA_DE_INFORMES).glob("*.md"))
        self.assertEqual(len(informes), 2)
        self.assertNotEqual(informes[0].name, informes[1].name)

    def test_informe_futuro_arbitrario_sigue_rechazado(self) -> None:
        """La reparación de nombres no relaja el límite superior de frescura."""
        real = actualizar.actualizar_con_resultado

        def adelantar(*args: object, **opciones: object) -> actualizar.ResultadoActualizacion:
            intento = real(*args, **opciones)
            ruta = intento.informe.with_suffix(".json")
            informe = json.loads(ruta.read_text())
            informe["utc"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
            ruta.write_text(json.dumps(informe), encoding="utf-8")
            return intento

        with mock.patch.object(actualizar, "actualizar_con_resultado", side_effect=adelantar):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(recibo["resultado"], "rechazado")
        self.assertIsNone(recibo["huellaPaquete"])

    def test_diagnostico_libre_no_sale_por_consola_ni_recibo(self) -> None:
        """Los detalles del motor no se convierten en salida pública del runner."""
        real = actualizar.actualizar_con_resultado

        def con_diagnostico(*args: object, **opciones: object) -> actualizar.ResultadoActualizacion:
            print("privado/secreto")
            print("privado/secreto", file=candidato.sys.stderr)
            return real(*args, **opciones)

        with (
            mock.patch.object(actualizar, "actualizar_con_resultado", side_effect=con_diagnostico),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(salida.getvalue() + errores.getvalue(), "")
        self.assertNotIn("privado/secreto", json.dumps(recibo))

    def test_candidato_copiado_no_modifica_instalacion_de_origen(self) -> None:
        """El checkout candidato es independiente; los bytes de origen no cambian."""
        destino = self.temporal / "candidato"
        antes = sustitucion.huellas_del_arbol(self.raiz)
        actualizar.preparar_area(self.raiz, destino)
        recibo = candidato.ejecutar_candidato(destino, "actualizar-datos", EjecutorCandidato())
        self.assertEqual(recibo["resultado"], "validado")
        self.assertEqual(antes, sustitucion.huellas_del_arbol(self.raiz))

    def test_cli_reserva_recibo_externo_y_no_imprime_diagnostico(self) -> None:
        """El JSON se guarda fuera del candidato y un destino ocupado no provoca ejecución."""
        recibo = self.temporal / "recibo.json"
        valor = {**candidato._recibo("actualizar-datos", "rechazado", None), "error": "candidato_no_verificable"}

        def ejecutar(*_args: object, **_opciones: object) -> dict:
            return valor

        with (
            mock.patch.object(candidato, "ejecutar_candidato", side_effect=ejecutar) as ejecutar_mock,
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            self.assertEqual(candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)]), 1)
            self.assertEqual(candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)]), 1)
        ejecutar_mock.assert_called_once()
        self.assertEqual(json.loads(recibo.read_text()), valor)
        self.assertNotIn(str(self.raiz), salida.getvalue() + errores.getvalue())

    def test_cli_fallo_de_escritura_no_deja_recibo_parcial(self) -> None:
        """Una escritura que falla tras sus primeros bytes no publica un recibo final."""
        recibo = self.temporal / "recibo.json"
        antes = set(self.temporal.iterdir())

        def fallar(_valor: object, archivo: io.TextIOBase, **_opciones: object) -> None:
            archivo.write('{"version":')
            raise OSError("fallo sintético de escritura")

        with (
            mock.patch.object(candidato, "ejecutar_candidato", return_value={"resultado": "validado"}),
            mock.patch.object(candidato.json, "dump", side_effect=fallar),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            codigo = candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)])
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), "No se pudo preparar el recibo del candidato.\n")
        self.assertFalse(recibo.exists())
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_cli_interrupcion_del_motor_no_crea_recibo_final(self) -> None:
        """La interrupción se propaga y no deja un JSON final vacío ni incompleto."""
        recibo = self.temporal / "recibo.json"
        antes = set(self.temporal.iterdir())
        with (
            mock.patch.object(candidato, "ejecutar_candidato", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)])
        self.assertFalse(recibo.exists())
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_cli_nominal_conserva_bytes_salida_y_codigo(self) -> None:
        """La promoción no cambia serialización UTF8, salto final ni semántica de los tres resultados."""
        for resultado in ("validado", "sin-pendientes", "rechazado"):
            with self.subTest(resultado=resultado):
                recibo = self.temporal / f"{resultado}.json"
                valor = {"resultado": resultado, "veredicto": "ámbar", "detalle": "Año 2026"}
                with (
                    mock.patch.object(candidato, "ejecutar_candidato", return_value=valor),
                    redirect_stdout(io.StringIO()) as salida,
                    redirect_stderr(io.StringIO()) as errores,
                ):
                    codigo = candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)])
                self.assertEqual(codigo, 1 if resultado == "rechazado" else 0)
                self.assertEqual(salida.getvalue(), f"Candidato: {resultado}.\n")
                self.assertEqual(errores.getvalue(), "")
                self.assertEqual(
                    recibo.read_bytes(),
                    (json.dumps(valor, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"),
                )

    def test_cli_enlaces_existentes_no_se_siguen_ni_ejecutan(self) -> None:
        """Ni un destino normal ni un enlace colgante permiten tomar una salida ocupada."""
        destino = self.temporal / "conservar.json"
        destino.write_bytes(b"contenido anterior")
        for existente in (True, False):
            with self.subTest(existente=existente):
                recibo = self.temporal / f"enlace-{existente}.json"
                recibo.symlink_to(destino if existente else self.temporal / "ausente.json")
                with mock.patch.object(candidato, "ejecutar_candidato") as ejecutar, redirect_stderr(io.StringIO()):
                    self.assertEqual(candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)]), 1)
                ejecutar.assert_not_called()
                self.assertTrue(recibo.is_symlink())
                self.assertEqual(destino.read_bytes(), b"contenido anterior")

    def test_cli_salida_creada_durante_ejecucion_no_se_sobrescribe(self) -> None:
        """La comprobación final es no-clobber, también si otro escritor gana durante el motor."""
        recibo = self.temporal / "recibo.json"

        def otro_escritor(*_args: object, **_opciones: object) -> dict:
            recibo.write_bytes(b"otra salida")
            return {"resultado": "validado"}

        with (
            mock.patch.object(candidato, "ejecutar_candidato", side_effect=otro_escritor),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)]), 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(recibo.read_bytes(), b"otra salida")

    def test_cli_directorio_de_salida_ausente_no_ejecuta(self) -> None:
        """La reserva temporal conserva el rechazo de salida inválida antes del motor."""
        recibo = self.temporal / "no existe" / "recibo.json"
        with (
            mock.patch.object(candidato, "ejecutar_candidato", return_value={"resultado": "validado"}) as ejecutar,
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(candidato.main(["actualizar-datos", str(self.raiz), "--recibo", str(recibo)]), 1)
        ejecutar.assert_not_called()
        self.assertFalse(recibo.exists())


if __name__ == "__main__":
    unittest.main()
