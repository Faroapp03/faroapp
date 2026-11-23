"""Archivo de recibos: cada corte se conserva, el catálogo repetido ocupa una sola pieza."""

import copy
import hashlib
import json
import os
import unittest
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from itertools import count
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import panel_catalogo as panel
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as hp_fixtures
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion.pruebas import test_almacen_trabajos as fixtures

CICLOS = 32


def utc() -> str:
    """Fija un corte real del ensayo, no una consulta al proveedor.

    Returns:
        Momento UTC sin modificar capturas ni observaciones.
    """
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class RecibosCatalogoCompactos(unittest.TestCase):
    """SQLite y capturas del productor HP sintético; ningún acceso a datos oficiales o red."""

    def setUp(self) -> None:
        """Prepara una admisión de verdad dentro del fixture y el almacén privado real en memoria."""
        self.hp = hp_fixtures.ActualizacionHpLifePruebas()
        self.hp.setUp()
        self.addCleanup(self.hp.doCleanups)
        hp.preparar(self.hp.solicitud)
        inicio = datetime.fromisoformat(self.hp.solicitud.corte_utc.replace("Z", "+00:00"))
        segundos = count()
        reloj = patch(
            f"{__name__}.utc",
            side_effect=lambda: (inicio + timedelta(seconds=next(segundos))).isoformat().replace("+00:00", "Z"),
        )
        reloj.start()
        self.addCleanup(reloj.stop)
        self.solicitud = hp.solicitud_admision(self.hp.solicitud.area)
        self.modelo = panel.desde_admision(
            self.solicitud, self.hp.ref(self.solicitud.validacion_destino).sha256, corte_utc=utc()
        )
        self.almacen = fixtures.Memoria()
        self.base = self.almacen.generacion("base")
        self.inicial = trabajos.inicializar_referencia(self.base, self.almacen)
        self.almacen.eventos.clear()

    def cuerpo(self, numero: int = 1, modelo: dict | None = None) -> bytes:
        """Crea un nuevo trabajo sin cambios de fuente, con un corte real independiente.

        Returns:
            Bytes completos y comprobados; no rejuvenecen ninguna observación nativa.
        """
        catalogo = copy.deepcopy(modelo or self.modelo)
        catalogo["corteProyeccion"] = utc()
        catalogo["revision"] = sha256_json({k: v for k, v in catalogo.items() if k != "revision"})
        # Recibos v3 ya conservados: la forma compacta sigue leyéndolos sin «conservados».
        o = json.loads(fixtures.recibo(version=trabajos.VERSION_RECIBO_CATALOGO))
        o.update(
            version=trabajos.VERSION_RECIBO_CATALOGO,
            solicitudId=f"{numero:08d}-1234-4234-8234-123456789abc",
            revisionReserva=numero,
            accion="reintentar-pendientes",
            resultado="sin-pendientes",
            veredicto=None,
            huellaPaquete=None,
            error=None,
            catalogo=catalogo,
            terminadoEn=catalogo["corteProyeccion"],
        )
        contenido = json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode()
        trabajos._recibo(contenido)
        return contenido

    def conservar(self, contenido: bytes) -> dict:
        """Recorre contenido→índice→CAS con las mismas comprobaciones del ejecutor.

        Returns:
            Descriptor confirmado del nuevo trabajo o replay.
        """
        return trabajos.conservar_trabajo(
            contenido,
            "123",
            fixtures.CODIGO,
            trabajos.leer_referencia(self.almacen),
            self.base,
            almacen=self.almacen,
        )

    def recuperar(self, contenido: bytes) -> tuple[dict, bytes] | None:
        """Lee por la identidad del trabajo, sin adoptar un recibo parcial.

        Returns:
            Descriptor y bytes exactamente iguales a los autenticados.
        """
        o = json.loads(contenido)
        return trabajos.recuperar_trabajo(o["solicitudId"], o["revisionReserva"], "123", self.almacen)

    def pieza(self, descriptor: dict) -> str:
        """Obtiene la referencia de contenido existente.

        Returns:
            SHA de la pieza, no una ruta ni una autoridad distinta.
        """
        sobre = self.almacen.objetos[f"blobs/{descriptor['recibo']['composicion']['sha256']}"]
        return json.loads(sobre)["catalogo"]["sha256"]

    def test_32_cortes_distintos_reutilizan_pieza_y_reenvio_no_escribe(self) -> None:
        """Cada trabajo tiene su fecha/SHA, pero el catálogo idéntico se guarda una sola vez."""
        piezas, sobres, cuerpos, cortes = set(), set(), set(), set()
        comprobado = self.modelo["unidades"][0]["comprobadoEl"]
        for numero in range(1, CICLOS + 1):
            contenido = self.cuerpo(numero)
            d = self.conservar(contenido)
            self.assertEqual(d["version"], trabajos.VERSION_INDICE_COMPACTO)
            self.assertEqual(self.recuperar(contenido), (d, contenido))
            piezas.add(self.pieza(d))
            sobres.add(d["recibo"]["composicion"]["sha256"])
            cuerpos.add(d["recibo"]["sha256"])
            o = json.loads(contenido)
            cortes.add(o["catalogo"]["corteProyeccion"])
            self.assertEqual(o["catalogo"]["unidades"][0]["comprobadoEl"], comprobado)
            antes = dict(self.almacen.objetos)
            self.almacen.eventos.clear()
            self.assertEqual(self.conservar(contenido), d)
            self.assertEqual(self.almacen.objetos, antes)
            self.assertFalse(any(e[0] in {"guardar", "control"} for e in self.almacen.eventos))
        self.assertEqual(len(piezas), 1)
        self.assertEqual(len(sobres), CICLOS)
        self.assertEqual(len(cuerpos), CICLOS)
        self.assertEqual(len(cortes), CICLOS)
        self.assertFalse(any(f"blobs/{sha}" in self.almacen.objetos for sha in cuerpos))

    def test_cambio_de_contenido_admitido_crea_solo_otra_pieza_y_conserva_anterior(self) -> None:
        """Una nueva captura cambiada del productor conserva el negocio y el recibo anteriores."""
        antes = self.cuerpo()
        primera = self.conservar(antes)
        corte = utc()
        siguiente = replace(
            self.hp.solicitud,
            admision=self.solicitud,
            sha256_admision=self.hp.ref(self.solicitud.validacion_destino).sha256,
            raiz_evidencias=self.hp.solicitud.area / "evidencias",
            recepciones=(self.hp.guardar_recepcion(cambio=True, fecha=corte),),
            area=self.hp.raiz / "cambio-admitido",
            corte_utc=utc(),
        )
        hp.preparar(siguiente)
        s = hp.solicitud_admision(siguiente.area)
        modelo = panel.desde_admision(s, self.hp.ref(s.validacion_destino).sha256, corte_utc=utc())
        despues = self.cuerpo(2, modelo)
        segunda = self.conservar(despues)
        self.assertNotEqual(self.pieza(primera), self.pieza(segunda))
        self.assertNotEqual(json.loads(antes)["catalogo"]["unidades"][0]["titulo"], modelo["unidades"][0]["titulo"])
        self.assertEqual(self.recuperar(antes), (primera, antes))
        self.assertEqual(self.recuperar(despues), (segunda, despues))

    def test_espacios_unicode_escapado_y_orden_preservan_bytes_firmados(self) -> None:
        """No impone una canonicalización nueva: formato no reconstruible permanece literal."""
        o = json.loads(self.cuerpo())
        anidado = copy.deepcopy(o)
        anidado["catalogo"] = dict(reversed(list(anidado["catalogo"].items())))
        anidado["catalogo"]["unidades"] = [dict(reversed(list(f.items()))) for f in anidado["catalogo"]["unidades"]]
        variantes = [
            (json.dumps(o, ensure_ascii=False, indent=2).encode(), trabajos.VERSION_INDICE),
            (json.dumps(o, ensure_ascii=True, separators=(",", ":")).encode(), trabajos.VERSION_INDICE),
            (
                json.dumps(dict(reversed(list(o.items()))), ensure_ascii=False, separators=(",", ":")).encode(),
                trabajos.VERSION_INDICE_COMPACTO,
            ),
        ]
        variantes.append(
            (json.dumps(anidado, ensure_ascii=False, separators=(",", ":")).encode(), trabajos.VERSION_INDICE_COMPACTO)
        )
        for contenido, version in variantes:
            with self.subTest(version=version, sha=hashlib.sha256(contenido).hexdigest()):
                self.almacen = fixtures.Memoria()
                # El manifiesto requerido sigue presente en cada almacén independiente.
                self.almacen.generacion("base")
                trabajos.inicializar_referencia(self.base, self.almacen)
                d = self.conservar(contenido)
                self.assertEqual(d["version"], version)
                self.assertEqual(self.recuperar(contenido), (d, contenido))
                self.assertEqual(d["recibo"]["sha256"], hashlib.sha256(contenido).hexdigest())

    def test_interrupciones_entre_pieza_sobre_indice_y_cas_recuperan_sin_falso_exito(self) -> None:
        """Cada borde conserva bytes ya completos; no admite una referencia parcial."""
        contenido = self.cuerpo()
        for corte in (1, 2):
            with self.subTest(despues_de_blob=corte):
                self.almacen = fixtures.Memoria()
                self.almacen.generacion("base")
                inicial = trabajos.inicializar_referencia(self.base, self.almacen)
                real = self.almacen.guardar
                llamadas = 0

                def interrumpir(*args: object, guardar: Callable[..., None] = real, numero_corte: int = corte) -> None:
                    nonlocal llamadas
                    guardar(*args)
                    llamadas += 1
                    if llamadas == numero_corte:
                        raise OSError("corte después de guardar")

                with patch.object(self.almacen, "guardar", side_effect=interrumpir), self.assertRaises(OSError):
                    self.conservar(contenido)
                self.assertIsNone(self.recuperar(contenido))
                self.assertEqual(trabajos.leer_referencia(self.almacen), inicial)
                d = self.conservar(contenido)
                self.assertEqual(self.recuperar(contenido), (d, contenido))
                self.assertEqual(len([k for k in self.almacen.objetos if k.startswith("blobs/")]), 2)
        self.almacen = fixtures.Memoria()
        self.almacen.generacion("base")
        inicial = trabajos.inicializar_referencia(self.base, self.almacen)
        self.almacen.corte = (trabajos.REFERENCIA, "antes")
        with self.assertRaises(trabajos.ConflictoReferencia):
            self.conservar(contenido)
        recuperado = self.recuperar(contenido)
        self.assertIsNotNone(recuperado)
        self.assertEqual(recuperado[1], contenido)
        self.assertEqual(trabajos.leer_referencia(self.almacen), inicial)
        self.almacen.corte = None
        self.assertEqual(self.conservar(contenido), recuperado[0])

    def test_indice_sin_pieza_o_con_pieza_corrupta_no_autoriza_reenvio(self) -> None:
        """Un sobre íntegro no sustituye la pieza que su referencia SHA exige."""
        contenido = self.cuerpo()
        d = self.conservar(contenido)
        clave = f"blobs/{self.pieza(d)}"
        original = self.almacen.objetos.pop(clave)
        antes = trabajos.leer_referencia(self.almacen)
        with self.assertRaises(OSError):
            self.recuperar(contenido)
        with self.assertRaises(OSError):
            self.conservar(contenido)
        self.almacen.objetos[clave] = original + b"alterado"
        with self.assertRaises(ValueError):
            self.recuperar(contenido)
        self.assertEqual(trabajos.leer_referencia(self.almacen), antes)

    def test_enlaces_y_referencias_fuera_de_formato_se_rechazan_sin_tocar_ajenos(self) -> None:
        """Solo se leen archivos regulares exclusivos, SHA y cotas validados."""
        contenido = self.cuerpo()
        d = self.conservar(contenido)
        r = d["recibo"]["composicion"]
        origen = self.hp.raiz / "sobre-propio"
        origen.write_bytes(self.almacen.objetos[f"blobs/{r['sha256']}"])
        for simbolico in (True, False):
            with self.subTest(simbolico=simbolico):

                def enlazar(
                    _clave: str, destino: Path, _sha: str, _maximo: int, usar_simbolico: bool = simbolico
                ) -> None:
                    if usar_simbolico:
                        destino.symlink_to(origen)
                    else:
                        os.link(origen, destino)

                with (
                    patch.object(self.almacen, "recuperar", side_effect=enlazar),
                    self.assertRaises((OSError, ValueError)),
                ):
                    self.recuperar(contenido)
                self.assertEqual(origen.read_bytes(), self.almacen.objetos[f"blobs/{r['sha256']}"])
                self.assertEqual(origen.stat().st_nlink, 1)
        mal = copy.deepcopy(d)
        mal["recibo"]["composicion"]["sha256"] = "../ajeno"
        with self.assertRaises(ValueError):
            trabajos._descriptor(mal)
        mal = copy.deepcopy(d)
        mal["recibo"]["composicion"]["bytes"] = trabajos.MAX_SOBRE_RECIBO_BYTES + 1
        with self.assertRaises(ValueError):
            trabajos._descriptor(mal)

    def test_v3_conserva_guardas_de_generacion_y_artefacto_de_v2(self) -> None:
        """Factorizar no permite acreditar un validado sin su artefacto verificado."""
        o = json.loads(self.cuerpo())
        o.update(accion="actualizar-datos", resultado="validado", veredicto="verde", huellaPaquete="b" * 16)
        contenido = json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode()
        self.almacen.eventos.clear()
        with self.assertRaises(ValueError):
            trabajos.conservar_trabajo(contenido, "123", fixtures.CODIGO, self.inicial, self.base, almacen=self.almacen)
        self.assertFalse(any(e[0] in {"guardar", "control"} for e in self.almacen.eventos))
        artefacto = self.almacen.artefacto()
        d = trabajos.conservar_trabajo(
            contenido, "123", fixtures.CODIGO, self.inicial, self.base, artefacto=artefacto, almacen=self.almacen
        )
        self.assertEqual(d["version"], trabajos.VERSION_INDICE_COMPACTO)
        self.assertEqual(self.recuperar(contenido), (d, contenido))
        del self.almacen.objetos[f"artefactos/{artefacto['sha256Artefacto']}.json"]
        with self.assertRaises(ValueError):
            self.recuperar(contenido)

    def test_cruce_de_revision_interna_reutiliza_pieza_y_no_normaliza_corte_ni_comprobacion(self) -> None:
        """Pasada la revisión interna nada cambia para la persona: misma pieza, decisión y retención."""
        original = self.cuerpo()
        inicial = json.loads(original)["catalogo"]
        self.assertIsNone(inicial["unidades"][0]["motivoRetencion"])
        self.assertEqual(inicial["unidades"][0]["decision"], "disponible-publicamente")
        primera = self.conservar(original)
        vence = self.modelo["unidades"][0]["revisarEl"]
        vencida = panel.desde_admision(
            self.solicitud, self.hp.ref(self.solicitud.validacion_destino).sha256, corte_utc=vence
        )
        o = json.loads(self.cuerpo(2))
        o["catalogo"] = vencida
        o["terminadoEn"] = (
            datetime.fromisoformat(vence.replace("Z", "+00:00")).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
        contenido = json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode()
        segunda = self.conservar(contenido)
        self.assertEqual(self.pieza(primera), self.pieza(segunda))
        self.assertEqual(self.recuperar(original), (primera, original))
        self.assertEqual(self.recuperar(contenido), (segunda, contenido))
        self.assertEqual(vencida["corteProyeccion"], vence)
        self.assertEqual(vencida["unidades"][0]["comprobadoEl"], self.modelo["unidades"][0]["comprobadoEl"])
        self.assertEqual(vencida["unidades"][0]["decision"], self.modelo["unidades"][0]["decision"])
        self.assertIsNone(vencida["unidades"][0]["motivoRetencion"])
        self.assertEqual(vencida["unidades"][0]["revisarEl"], vence)
