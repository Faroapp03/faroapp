"""Resumen del diario: ciclos reales del diario, recorte por tamaño, archivo independiente y guardia de privacidad."""

import contextlib
import json
import re
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from typing import Any

from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.pruebas.ejemplos_retirada import cadena
from plataforma_datos.orquestacion import archivo_diario, resumen_diario
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.almacen_de_ensayo import AlmacenDeEnsayo
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos
from plataforma_datos.orquestacion.cliente_mantenimiento import ErrorMantenimiento
from plataforma_datos.orquestacion.formas_del_diario import es_salud_valida
from plataforma_datos.orquestacion.movimientos_de_cursos import comparar
from plataforma_datos.orquestacion.salud_mantenimiento import diagnostico

IDENTIDAD = {"operacion": "ejecutar", "run": "19581234567", "intento": "1", "revisionCodigo": "6" * 40, "reserva": "41"}
RUN, INTENTO = IDENTIDAD["run"], IDENTIDAD["intento"]
EJECUCION = archivo_diario.Ejecucion(RUN, INTENTO, "ejecutar")
UTC = "2026-11-21T06:00:00+00:00"
# Formas que nunca pueden aparecer en el resumen: dirección, ruta, credencial o correo.
PROHIBIDAS = (
    re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE),
    re.compile(r"(?:^|[\s\"'])(?:/|~/|\./|\.\./)"),
    re.compile(r"[A-Za-z]:\\|\\"),
    re.compile(r"[^/\s]+/[^/\s]+/"),
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+"),
    re.compile(r"\bBearer\b|\beyJ[A-Za-z0-9_-]+|[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    re.compile(r"\bwww\.|\b[a-z0-9-]+\.(?:com|org|es|cat|net|dev|io|test)\b", re.IGNORECASE),
)

MUESTRAS_PROHIBIDAS = (
    "https://a.test",
    "/home/x",
    "C:\\temp",
    "a@b.cat",
    "Bearer x",
    "aaaaaaaa.bbbbbbbb.cccccccc",
    "www.faroapp.org",
    "a/b/c",
)


class _AlmacenEnMemoria:
    """Almacén privado mínimo: objetos por huella y controles que solo se crean una vez."""

    def __init__(self, *, fallo_objetos: bool = False, rechaza_resumen: bool = False) -> None:
        self.objetos: dict[str, bytes] = {}
        self.controles: dict[str, bytes] = {}
        self.fallo_objetos = fallo_objetos
        self.rechaza_resumen = rechaza_resumen

    def guardar(self, clave: str, origen: Path, sha256: str, bytes_esperados: int) -> None:
        if self.fallo_objetos:
            raise OSError("almacén caído")
        self.objetos[clave] = origen.read_bytes()

    def recuperar(self, clave: str, destino: Path, sha256: str, bytes_maximos: int) -> None:
        destino.write_bytes(self.objetos[clave])

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        valor = self.controles.get(clave)
        return None if valor is None else (valor, '"etag"')

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        if self.rechaza_resumen and clave.startswith("diarios-resumen/"):
            raise ValueError("clave de control no admitida")
        if clave in self.controles:
            return False
        self.controles[clave] = contenido
        return True


def _rechazo_de_la_autoridad() -> None:
    """Termina el permiso de inicio igual que el cliente cuando la autoridad no confirma.

    Raises:
        ErrorMantenimiento: Siempre, con el mismo mensaje genérico del cliente.
    """
    raise ErrorMantenimiento("No se ha confirmado la operación de mantenimiento.")


def _cadenas(valor: object) -> list[str]:
    if isinstance(valor, str):
        return [valor]
    if isinstance(valor, dict):
        return [c for clave, v in valor.items() for c in (clave, *_cadenas(v))]
    if isinstance(valor, list):
        return [c for v in valor for c in _cadenas(v)]
    return []


class ResumenDiarioPruebas(unittest.TestCase):
    """Escribe diarios con las mismas funciones que el supervisor y lee el resumen archivado."""

    def setUp(self) -> None:
        """Prepara un diario privado y un almacén en memoria."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.resumenes: list[dict[str, Any]] = []
        self._nuevo()

    def _nuevo(self) -> None:
        """Empieza otra ejecución con su propia carpeta, su diario y su almacén."""
        self.carpeta = Path(tempfile.mkdtemp(dir=self.raiz))
        self.ruta = self.carpeta / "diario.jsonl"
        self.almacen = _AlmacenEnMemoria()

    def _abrir(self) -> contextlib.AbstractContextManager[None]:
        return diario.abrir(self.ruta, IDENTIDAD, consola=False)

    def _archivar(self, almacen: AlmacenTrabajos | None = None) -> dict[str, Any]:
        with self._abrir():
            archivo_diario.archivar(self.ruta, almacen or self.almacen, EJECUCION)
        clave = archivo_diario.clave_resumen(RUN, INTENTO, "ejecutar")
        resumen = json.loads(self.almacen.controles[clave])
        self.resumenes.append(resumen)
        return resumen

    def _intento(self, fuente: str, etapa: str, estado: str, codigo: int, causa: str | None) -> None:
        identificador = str(uuid.uuid4())
        ruta = self.carpeta / "candidato/var/actualizacion/ejecuciones/intentos" / identificador / "intento.json"
        ruta.parent.mkdir(parents=True)
        dato = {"id": identificador, "fuente": fuente, "etapa": etapa, "estado": estado, "codigo": codigo}
        dato |= {"inicio_utc": UTC, "fin_utc": "2026-11-21T06:00:09.250000+00:00", "causa": causa}
        ruta.write_text(json.dumps(dato))

    def _ciclo(self, antes: dict, despues: dict) -> None:
        recibo = {
            "resultado": "validado",
            "huellaPaquete": "a" * 16,
            "estado": {
                "modulos": [
                    {"id": "formacion", "veredicto": "verde", "ultimoIntento": UTC, "proximoReintento": None},
                    {
                        "id": "fundae",
                        "veredicto": "ámbar",
                        "ultimoIntento": "2026-11-21T06:00:00Z",
                        "proximoReintento": "2026-11-22T06:00:00Z",
                    },
                ]
            },
        }
        self._intento("formacion", "descargar", "terminado", 0, None)
        with self._abrir(), diario.paso("configuracion"), diario.paso("supervisor"):
            diario.anotar("base", "seleccionada", revisionBase="5" * 40, sha256Manifiesto="c" * 64)
            with diario.paso("motor"):
                diario.registrar_intentos(self.carpeta / "candidato")
                comparar(antes, despues)
                diario.registrar_recibo(recibo)
            diario.anotar("operacion", "resultado", resultado="validado", faseFinal=None)

    def test_ciclo_completo_con_cambios(self) -> None:
        """Identidad, fases, fuentes, módulos y cursos con su muestra salen del diario real del ciclo."""
        filtros = ["ia", "basico", "es", "en-linea", "f" * 64]
        cambiado = ["ia", "avanzado", "es", "en-linea", "e" * 64]
        self._ciclo(
            {"edicion/soc:100": filtros, "edicion/soc:101": filtros},
            {"edicion/soc:101": cambiado, "recurso/" + "b" * 64: filtros},
        )
        resumen = self._archivar()
        self.assertEqual(resumen["identidad"], IDENTIDAD)
        self.assertEqual(
            resumen["resultado"],
            {"estado": "terminado", "operacion": "validado", "faseFinal": None, "candidato": "validado"},
        )
        self.assertEqual(
            [(f["fase"], f["estado"]) for f in resumen["fases"]],
            [
                ("configuracion", "confirmado"),
                ("supervisor", "confirmado"),
                ("base", "seleccionada"),
                ("motor", "confirmado"),
            ],
        )
        self.assertEqual(
            [(f["fuente"], f["etapa"], f["codigo"]) for f in resumen["fuentes"]], [("formacion", "descargar", 0)]
        )
        self.assertEqual(resumen["modulos"][1]["proximoReintento"], "2026-11-22T06:00:00Z")
        cursos = resumen["cursos"]
        self.assertEqual((cursos["altas"], cursos["retiradas"], cursos["modificaciones"]), (1, 1, 1))
        self.assertEqual(
            [(m["curso"], m["cambio"], m["campos"]) for m in cursos["muestra"]],
            [
                ("edicion/soc:100", "retirada", []),
                ("edicion/soc:101", "modificacion", ["nivel", "ficha"]),
                ("recurso/" + "b" * 64, "alta", []),
            ],
        )
        self.assertFalse(resumen["recorte"]["aplicado"])
        self.assertIsNone(resumen["identidadOidc"])

    def test_ciclo_sin_cambios(self) -> None:
        """Un ciclo comparado sin movimientos da recuentos a cero y ninguna muestra."""
        inventario = {"edicion/soc:100": ["ia", "basico", "es", "en-linea", "f" * 64]}
        self._ciclo(inventario, dict(inventario))
        cursos = self._archivar()["cursos"]
        self.assertEqual(
            cursos,
            {
                "comparacion": "comparado",
                "antes": 1,
                "despues": 1,
                "altas": 0,
                "retiradas": 0,
                "modificaciones": 0,
                "muestra": [],
            },
        )

    def test_inicio_rechazado_por_la_autoridad_con_401(self) -> None:
        """El ciclo que no llega a empezar deja su resumen: la autoridad respondió 401 y el permiso falló."""
        with self._abrir(), contextlib.suppress(ErrorMantenimiento):
            with diario.paso("configuracion"):
                pass
            with diario.paso("supervisor"), diario.paso("permiso-inicio"):
                with diario.paso("identidad-oidc"):
                    diario.anotar(
                        "identidad-oidc",
                        "metadatos",
                        audienciaEsperada=True,
                        referenciaDeJob="coincide",
                        revisionDeJob="distinto",
                    )
                diario.anotar(
                    "respuesta-http",
                    "rechazada",
                    servicio="autoridad",
                    http=401,
                    tipoJsonAdmitido=True,
                    sinCompresion=True,
                )
                _rechazo_de_la_autoridad()
        resumen = self._archivar()
        self.assertEqual(resumen["resultado"]["estado"], "fallido")
        self.assertEqual(resumen["respuestasRechazadas"], [{"servicio": "autoridad", "http": 401}])
        self.assertEqual(
            [(f["fase"], f["estado"], f["causa"]) for f in resumen["fases"]],
            [
                ("configuracion", "confirmado", None),
                ("supervisor", "error", "comprobacion-fallida"),
                ("permiso-inicio", "error", "comprobacion-fallida"),
                ("identidad-oidc", "confirmado", None),
            ],
        )
        self.assertEqual(
            resumen["identidadOidc"],
            {"audienciaEsperada": True, "referenciaDeJob": "coincide", "revisionDeJob": "distinto"},
        )
        self.assertEqual(resumen["cursos"]["comparacion"], "ausente")

    def test_fuente_que_falla_y_se_reintenta(self) -> None:
        """Cada intento de la fuente conserva su código de salida y su causa cerrada."""
        self._intento("fundae", "descargar", "excepcion", 1, "http-503")
        self._intento("fundae", "descargar", "terminado", 0, None)
        with self._abrir(), diario.paso("motor"):
            diario.registrar_intentos(self.carpeta / "candidato")
        fuentes = self._archivar()["fuentes"]
        self.assertEqual(
            sorted((f["estado"], f["codigo"], f["causa"]) for f in fuentes),
            [("excepcion", 1, "http-503"), ("terminado", 0, None)],
        )
        self.assertEqual(len({f["intentoFuente"] for f in fuentes}), 2)

    def test_recorte_por_tamano_es_determinista_y_lo_dice(self) -> None:
        """Un diario enorme da un resumen dentro del límite que conserva el final y cuenta lo omitido."""
        # Se escriben las líneas directamente para no forzar miles de sincronizaciones del disco.
        base = {"version": 1, "utc": UTC, **IDENTIDAD}
        lineas = [json.dumps(base | {"fase": f"fase-{numero:04d}", "estado": "confirmado"}) for numero in range(3000)]
        lineas.append(json.dumps(base | {"fase": "supervisor", "estado": "error", "causa": "almacen-no-disponible"}))
        contenido = resumen_diario.componer(lineas, "ejecutar", RUN, INTENTO)
        self.assertEqual(resumen_diario.componer(lineas, "ejecutar", RUN, INTENTO), contenido)
        self.assertLessEqual(len(contenido), resumen_diario.MAX_RESUMEN)
        resumen = json.loads(contenido)
        omitidas = resumen["recorte"]["omitidos"]["fases"]
        self.assertTrue(resumen["recorte"]["aplicado"])
        self.assertEqual(omitidas + len(resumen["fases"]), 3001)
        self.assertEqual(resumen["fases"][-1]["causa"], "almacen-no-disponible")
        self.resumenes.append(resumen)

    def test_un_fallo_del_resumen_no_impide_el_diario_ni_al_reves(self) -> None:
        """Cada pieza se guarda por su lado y el fallo del resumen queda anotado en el diario archivado."""
        conexion = sqlite3.connect(self.carpeta / "control.sqlite")
        self.addCleanup(conexion.close)
        ensayo = AlmacenDeEnsayo(self.carpeta / "objetos", conexion)
        with self._abrir(), diario.paso("configuracion"):
            pass
        with self._abrir():
            archivo_diario.archivar(self.ruta, ensayo, EJECUCION)
        guardado = ensayo.leer_control(archivo_diario.clave_resumen(RUN, INTENTO, "ejecutar"), 64 * 1024)
        self.assertEqual(json.loads(guardado[0])["fases"][0]["fase"], "configuracion")
        self.assertNotIn("archivo-resumen", archivo_diario.leer(ensayo, RUN, INTENTO, "ejecutar"))
        rechaza = _AlmacenEnMemoria(rechaza_resumen=True)
        with self._abrir():
            archivo_diario.archivar(self.ruta, rechaza, EJECUCION, self.carpeta / "candidato")
        ultima = json.loads(archivo_diario.leer(rechaza, RUN, INTENTO, "ejecutar").splitlines()[-1])
        self.assertEqual(
            (ultima["fase"], ultima["estado"], ultima["causa"]),
            ("archivo-resumen", "pendiente", "almacen-no-confirmado"),
        )
        caido = _AlmacenEnMemoria(fallo_objetos=True)
        with self._abrir(), self.assertRaises(OSError):
            archivo_diario.archivar(self.ruta, caido, EJECUCION)
        self.assertEqual(list(caido.controles), [archivo_diario.clave_resumen(RUN, INTENTO, "ejecutar")])
        self.ruta.write_text('{"version":1,"fase":"https://otro.test/robar","estado":"x"}\n')
        with self._abrir():
            archivo_diario.archivar(self.ruta, self.almacen, EJECUCION)
        self.assertNotIn(archivo_diario.clave_resumen(RUN, INTENTO, "ejecutar"), self.almacen.controles)
        self.assertIn("diario-no-resumible", self.ruta.read_text())

    def test_el_diagnostico_dice_que_falta_el_resumen_sin_cambiar_la_accion(self) -> None:
        """Sin resumen, el ciclo conserva su estado y su acción; solo se informa de que el panel no lo tendrá."""
        with self._abrir(), diario.paso("supervisor"):
            pass
        sin_resumen = diagnostico(self.ruta.read_text().splitlines())
        with self._abrir():
            archivo_diario.archivar(self.ruta, _AlmacenEnMemoria(rechaza_resumen=True), EJECUCION)
        con_aviso = diagnostico(self.ruta.read_text().splitlines())
        self.assertEqual(con_aviso, {**sin_resumen, "resumenNoArchivado": "almacen-no-confirmado"})
        self.assertEqual((con_aviso["estado"], con_aviso["accion"]), ("confirmado", "ninguna"))

    def test_clave_ordenable_por_ejecucion(self) -> None:
        """La ejecución lleva 16 cifras para que el orden de las claves sea el de las ejecuciones."""
        self.assertEqual(
            archivo_diario.clave_resumen("123", "2", "activar"), "diarios-resumen/0000000000000123/2/activar.json"
        )
        with self.assertRaises(ValueError):
            archivo_diario.clave_resumen("0123", "1", "ejecutar")

    def test_guardia_sin_direcciones_rutas_credenciales_ni_correos(self) -> None:
        """Los campos ajenos al contrato no pasan, y ningún texto del resumen tiene forma prohibida."""
        with self._abrir(), contextlib.suppress(ErrorMantenimiento), diario.paso("permiso-inicio"):
            diario.anotar(
                "respuesta-http",
                "rechazada",
                servicio="autoridad",
                http=401,
                url="https://faro.example.test/mantenimiento/inicio",
                cuerpo='{"error":"no"}',
                token="cabecera_uno.cuerpo_uno.firma_uno",
                correo="persona@example.test",
                ruta="/home/runner/work/faro/diario.jsonl",
            )
            _rechazo_de_la_autoridad()
        self._archivar()
        self._nuevo()
        self.test_ciclo_completo_con_cambios()
        self._nuevo()
        self.test_inicio_rechazado_por_la_autoridad_con_401()
        self.test_recorte_por_tamano_es_determinista_y_lo_dice()
        for patron in PROHIBIDAS:
            for prohibido in MUESTRAS_PROHIBIDAS:
                if patron.search(prohibido):
                    break
            else:
                self.fail(f"La guardia no reconoce ninguna muestra con {patron.pattern}")
        self.assertGreaterEqual(len(self.resumenes), 4)
        for resumen in self.resumenes:
            for texto in _cadenas(resumen):
                for patron in PROHIBIDAS:
                    self.assertIsNone(patron.search(texto), (texto, patron.pattern))


class ParteDeSaludAlArchivar(unittest.TestCase):
    """Archivar el diario con la instalación del ciclo deja un resumen v2 con el parte de salud."""

    def setUp(self) -> None:
        """Prepara una instalación vacía, un diario y un almacén en memoria."""
        self.carpeta = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.raiz = self.carpeta / "candidato"
        self.ruta = self.carpeta / "diario.jsonl"
        self.almacen = _AlmacenEnMemoria()

    def _guardar_lecturas(self) -> None:
        horas = ("2026-11-12T05:00:00Z", "2026-11-12T05:00:30Z")
        for lectura in cadena("11", ambito=("fundae", "fundae:digitalizate"), horas=horas):
            carpeta = carpeta_de_lecturas(self.raiz, lectura["fuente"])
            carpeta.mkdir(parents=True, exist_ok=True)
            (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))

    def _diario_del_ciclo(self) -> None:
        base = {"version": 1, **IDENTIDAD}
        etapa = {"fase": "etapa-fuente", "fuente": "fundae", "etapa": "descargar", "estado": "terminado"}
        etapa |= {"intentoFuente": str(uuid.uuid4()), "inicio": "2026-11-12T05:00:00+00:00", "codigo": 0}
        etapa |= {"fin": "2026-11-12T05:01:00+00:00", "causa": None}
        eventos = [
            {"utc": "2026-11-12T04:59:00+00:00", "fase": "configuracion", "estado": "inicio"},
            {"utc": "2026-11-12T05:01:00+00:00", **etapa},
            {"utc": "2026-11-12T05:02:00+00:00", "fase": "configuracion", "estado": "confirmado"},
        ]
        self.ruta.write_text("".join(json.dumps({**base, **evento}) + "\n" for evento in eventos))

    def _resumen(self) -> dict[str, Any]:
        return json.loads(self.almacen.controles[archivo_diario.clave_resumen(RUN, INTENTO, "ejecutar")])

    def test_el_resumen_archivado_lleva_el_parte_de_las_lecturas_del_ciclo(self) -> None:
        """Con lecturas guardadas, el resumen es v2, su `salud` valida su forma y refleja la lectura."""
        self._guardar_lecturas()
        self._diario_del_ciclo()
        archivo_diario.archivar(self.ruta, self.almacen, EJECUCION, self.raiz)
        resumen = self._resumen()
        self.assertEqual(resumen["version"], 2)
        self.assertTrue(es_salud_valida(resumen["salud"]))
        (fundae,) = (f for f in resumen["salud"]["fuentes"] if f["fuente"] == "fundae")
        self.assertEqual((fundae["registro"], fundae["estado"]), ("lee", "sana"))
        self.assertEqual(fundae["lecturas"][0]["bruto"], 3)
        self.assertEqual(fundae["descarga"], {"estado": "terminado", "causa": None})
        self.assertNotIn("pendiente", archivo_diario.leer(self.almacen, RUN, INTENTO, "ejecutar"))

    def test_con_el_almacen_de_lecturas_corrupto_se_archiva_igual_y_lo_dice(self) -> None:
        """Una lectura que no cumple el contrato deja el parte en `no-calculado`; el resumen y el diario se guardan."""
        self._guardar_lecturas()
        carpeta = carpeta_de_lecturas(self.raiz, "fundae")
        (carpeta / f"{'a' * 64}.json").write_text("no es una lectura")
        with diario.abrir(self.ruta, IDENTIDAD, consola=False), diario.paso("configuracion"):
            archivo_diario.archivar(self.ruta, self.almacen, EJECUCION, self.raiz)
        salud = self._resumen()["salud"]
        self.assertEqual(
            (salud["veredicto"], salud["motivo"], salud["fuentes"]), ("no-calculado", "almacen-ilegible", [])
        )
        self.assertTrue(es_salud_valida(salud))
        archivado = [
            json.loads(linea) for linea in archivo_diario.leer(self.almacen, RUN, INTENTO, "ejecutar").splitlines()
        ]
        anotacion = next(hecho for hecho in archivado if hecho["fase"] == "parte-de-salud")
        self.assertEqual((anotacion["estado"], anotacion["causa"]), ("no-calculado", "almacen-ilegible"))

    def test_una_instalacion_sin_lecturas_dice_que_no_hubo_lecturas(self) -> None:
        """Una orden que no lee fuentes no deja lecturas: el parte dice «sin-observaciones», no que todo está sano."""
        with diario.abrir(self.ruta, IDENTIDAD, consola=False), diario.paso("configuracion"):
            archivo_diario.archivar(self.ruta, self.almacen, EJECUCION, self.raiz)
        salud = self._resumen()["salud"]
        self.assertEqual((salud["veredicto"], salud["motivo"]), ("sin-observaciones", None))
        self.assertEqual({f["registro"] for f in salud["fuentes"]}, {"no-leida"})

    def test_sin_instalacion_el_resumen_se_archiva_y_el_diario_anota_que_no_se_calculo(self) -> None:
        """Sin raíz el parte es «no-calculado» con su motivo y nunca impide archivar."""
        with diario.abrir(self.ruta, IDENTIDAD, consola=False), diario.paso("configuracion"):
            archivo_diario.archivar(self.ruta, self.almacen, EJECUCION)
        self.assertEqual(self._resumen()["salud"]["motivo"], "sin-almacen")
        self.assertIn("parte-de-salud", archivo_diario.leer(self.almacen, RUN, INTENTO, "ejecutar"))


if __name__ == "__main__":
    unittest.main()
