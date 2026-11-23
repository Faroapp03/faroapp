"""Ciclo local con recibos sintéticos, SQLite real y evaluador real de preinscripción FUNDAE."""

import hashlib
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import ADMITIDO, CORRECTO
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.fundae import (
    adquisicion,
    auditoria_preinscripcion,
    ediciones,
    hechos,
    preinscripcion,
    tramite,
)
from plataforma_datos.cursos.pruebas import test_componer_catalogo as base_admitida
from plataforma_datos.cursos.pruebas import test_fundae as datos
from plataforma_datos.cursos.pruebas import test_fundae_ediciones as indice


def conservar(carpeta: Path, url: str, dato: object, fecha: str, http: int = 200) -> dict:
    """Archiva un cuerpo de prueba y un recibo íntegro de formato histórico.

    Returns:
        Referencias reproducibles a los archivos.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    cuerpo = dato if isinstance(dato, bytes) else comun.json_bytes(dato)
    sha = hashlib.sha256(cuerpo).hexdigest()
    meta = {
        "url": url,
        "url_final": url,
        "http": http,
        "completo": True,
        "inicio_utc": fecha + "T09:00:00Z",
        "fin_utc": fecha + "T09:00:01Z",
        "cuerpo_sha256": sha,
        "bytes": len(cuerpo),
    }
    recibo = comun.json_bytes(meta)
    huella = hashlib.sha256(recibo).hexdigest()
    (carpeta / (sha + ".body")).write_bytes(cuerpo)
    (carpeta / (huella + ".json")).write_bytes(recibo)
    return {
        "cuerpo": {"archivo": sha + ".body", "sha256": sha},
        "recibo": {"archivo": huella + ".json", "sha256": huella},
    }


class EdicionesEnSqlite(unittest.TestCase):
    """Una difusión sintética recorre admisión, negocio, vigencia y comprobaciones sucesivas."""

    def setUp(self) -> None:
        """Prepara y admite la edición con plazo hasta el 30 de noviembre."""
        base = base_admitida.ComponerCatalogoPruebas()
        base.setUp()
        self.addCleanup(base.doCleanups)
        self.raiz = base.raiz
        self.base = self.raiz / almacen.RUTA
        self.canal, _, self.validado = comun.rutas_de_la_fuente("fundae", self.raiz)
        self.ediciones = self.canal.parent / "ediciones"
        self.codigo, self.ident = "IFCT0049", "3177"
        self.url = ediciones.url_difusiones(self.codigo)
        self.control = {"estado": ADMITIDO, "controles": [{"control": "prueba sintética", "resultado": CORRECTO}]}
        self.web = self.canal.parent / "tramite"
        self.enterContext(patch.object(tramite, "metodo", lambda cuerpo: cuerpo == b"modulo de prueba"))
        self.interfaz()
        self.recibir("2026-11-15")
        self.primera = self.aplicar(self.base, "primera", "2026-11-15")
        self.assertEqual(self.decision(self.primera), "disponible-publicamente")

    def interfaz(self, modulo: bytes = b"modulo de prueba", dia: str = "2026-11-15", http: int = 200) -> None:
        """Conserva el recorrido de prueba del proveedor."""
        cuerpos = iter(
            (
                b'<script src="main-FAKE.js">',
                b'path:x.fichaCurso,loadChildren:()=>import("./chunk-FAKE.js").then(v=>v.FichasModule)',
                modulo,
            )
        )
        tramite.descargar(
            self.web, self.codigo, recibir=lambda url, carpeta: conservar(carpeta, url, next(cuerpos), dia, http)
        )

    def recibir(  # noqa: PLR0913 - Variables independientes de las respuestas simuladas.
        self,
        fecha: str,
        *,
        inicio: str = "2026-11-01",
        fin: str = "2026-11-30",
        http: int = 200,
        precio: str = auditoria_preinscripcion.GRATUIDAD,
        precio_http: int = 200,
        condicion: bool = False,
    ) -> None:
        """Escribe las cuatro recepciones y el resultado del canal para una fecha."""
        indice_bruto = indice.indice(self.codigo)
        indice_bruto["respuesta"][0]["duracion"] = 60
        cap = conservar(self.canal, adquisicion.URLS["subvencionada"], indice_bruto, fecha)
        precios = [{"idCatalogo": 3, "descripcionCatalogo": "Oferta", "descripcionCard": precio}]
        general = conservar(self.canal, adquisicion.URLS["catalogos"], precios, fecha, precio_http)
        canal = {"auxiliares": {"catalogos": general, "subvencionada": cap}}
        guardar_json(self.validado / "fundae.json", canal)
        guardar_json(
            self.validado / "validacion.json",
            self.control | {"conjunto_sha256": hashlib.sha256(comun.json_bytes(canal)).hexdigest()},
        )
        fila = datos.fila() | {
            "idCentro": 10,
            "idAccionFormativa": 20,
            "ejercicioDifusion": 2026,
            "idConvocatoria": 1,
            "emailContactoDifusion": "prueba@example.invalid",
            "centro": "Entidad SL",
            "fechaPreinscripcionInicio": inicio + "T00:00:00",
            "fechaPreinscripcionFin": fin + "T00:00:00",
        }
        if condicion:
            fila["estadoPreinscripcion"] = "por consultar"
        curso = datos.centro()["curso"] | {"idCatalogo": 3}
        ficha = {"curso": curso, "centrosRFO": [fila]}
        grupo = conservar(self.ediciones, self.url, ficha, fecha, http)
        centro = conservar(self.ediciones, ediciones.url_centro(self.codigo, fila["cifEntidadFormadora"]), ficha, fecha)
        colectivos = conservar(self.ediciones, ediciones.url_colectivos(int(self.ident)), datos.COLECTIVOS, fecha)
        guardar_json(
            self.ediciones / "procedencia.json",
            {
                "schema_version": 1,
                "fuente_id": "fundae",
                "indice": cap,
                "especialidades": [{"codigo": self.codigo, "difusiones": grupo}],
            },
        )
        propias, pruebas = [], {}
        if inicio <= fecha <= fin and http == HTTPStatus.OK:
            propias.append(hechos.edicion(self.codigo, int(self.ident), ficha, ficha, datos.COLECTIVOS))
            pruebas[self.ident] = {
                nombre: ediciones.evidencia(ref, comun.leer_recibo(ruta, ref))
                for nombre, ruta, ref in (
                    ("indice", self.canal, cap),
                    ("difusiones", self.ediciones, grupo),
                    ("centro", self.ediciones, centro),
                    ("colectivos", self.ediciones, colectivos),
                )
            }
        guardar_json(self.validado.parent / "fundae.json", {"ediciones": propias})
        guardar_json(self.validado.parent / "validacion.json", self.control | {"evidencias": pruebas})

    def aplicar(self, base: Path, destino: str, dia: str) -> Path:
        """Aplica el productor real.

        Returns:
            La instantánea que usaría la siguiente vuelta.
        """
        return preinscripcion.aplicar_si_cambia(self.raiz, base, self.raiz / destino, dia + "T13:00:00Z")

    def decision(self, base: Path) -> str:
        """Lee la decisión que quedó en SQLite.

        Returns:
            Código de vigencia registrado para la edición.
        """
        fila = registro.consultar_edicion(base / "catalogo.sqlite3", preinscripcion.PREFIJO + self.ident)
        return fila["evaluacion"]["resultado"]["estado"]

    def test_cierre_y_apertura_futura_sin_candidatas(self) -> None:
        """Actualiza únicamente el calendario verificado y repetir no renueva la fuente."""
        for inicio, fin, nombre, esperado in (
            ("2026-11-01", "2026-11-19", "cierre", "no-disponible-publicamente"),
            ("2026-11-23", "2026-11-30", "futura", "apertura-futura"),
        ):
            self.recibir("2026-11-20", inicio=inicio, fin=fin)
            nueva = self.aplicar(self.primera, nombre, "2026-11-20")
            self.assertNotEqual(nueva, self.primera)
            self.assertEqual(self.decision(nueva), esperado)
            self.assertEqual(
                preinscripcion._ediciones_previas(nueva / "catalogo.sqlite3")[self.ident]["preinscripcion"],
                {"inicio": inicio, "fin": fin},
            )
            self.assertEqual(self.aplicar(nueva, nombre + "-repetido", "2026-11-21"), nueva)

    def test_un_503_no_cierra_ni_renueva_y_el_precio_contrario_retira(self) -> None:
        """El servicio temporal y la retirada de gratuidad tienen efectos independientes."""
        self.recibir("2026-11-20", http=503, precio_http=503)
        self.assertEqual(self.aplicar(self.primera, "fallo", "2026-11-20"), self.primera)
        self.recibir("2026-11-20", http=503, precio=auditoria_preinscripcion.GRATUIDAD + ", salvo cursos de pago.")
        retirada = self.aplicar(self.primera, "cuota", "2026-11-20")
        ficha = preinscripcion._ediciones_previas(retirada / "catalogo.sqlite3")[self.ident]
        self.assertIs(ficha["gratuidad_subvencionada_acreditada"], False)
        self.assertNotIn("coste_formacion", ficha)
        self.assertEqual(self.decision(retirada), "disponible-publicamente")
        self.recibir("2026-11-21")
        recuperada = self.aplicar(retirada, "sin-cuota", "2026-11-21")
        self.assertIs(
            preinscripcion._ediciones_previas(recuperada / "catalogo.sqlite3")[self.ident][
                "gratuidad_subvencionada_acreditada"
            ],
            True,
        )

    def test_una_condicion_nueva_o_un_tramite_cambiado_quedan_en_revision(self) -> None:
        """Una condición nueva recibida con éxito es distinta del intento que falló."""
        self.recibir("2026-11-20", condicion=True)
        nueva = self.aplicar(self.primera, "condicion", "2026-11-20")
        self.assertIs(
            preinscripcion._ediciones_previas(nueva / "catalogo.sqlite3")[self.ident][
                "tramite_preinscripcion_acreditado"
            ],
            False,
        )
        self.interfaz(dia="2026-11-20", http=503)
        self.recibir("2026-11-20")
        self.assertEqual(self.aplicar(self.primera, "preservada", "2026-11-20"), self.primera)
        self.interfaz(b"otra forma de acceso", "2026-11-20")
        nueva = self.aplicar(self.primera, "canal", "2026-11-20")
        self.assertIs(
            preinscripcion._ediciones_previas(nueva / "catalogo.sqlite3")[self.ident][
                "tramite_preinscripcion_acreditado"
            ],
            False,
        )

    def test_migra_edicion_sin_indicadores_aunque_el_recibo_ya_coincida(self) -> None:
        """Reproduce una edición heredada en un almacén con las mismas recepciones que el ciclo actual."""
        sqlite = self.primera / "catalogo.sqlite3"
        fila = preinscripcion._ediciones_previas(sqlite)[self.ident]
        fila.pop("gratuidad_subvencionada_acreditada")
        fila.pop("tramite_preinscripcion_acreditado")
        control = leer_json(self.primera / almacen.CONTROL)
        cap = leer_json(self.ediciones / "procedencia.json")["especialidades"][0]["difusiones"]
        sha = cap["cuerpo"]["sha256"]
        ruta = next(r["archivo"] for r in control["archivos_conservados"] if r["sha256"] == sha)
        observada = "2026-11-15T09:00:01Z"
        prueba = {"url": self.url, "capturado_utc": observada, "sha256": sha, "archivo": ruta}
        edicion = {
            "id": preinscripcion.PREFIJO + self.ident,
            "programa_id": preinscripcion.PADRE + self.codigo,
            "datos": fila,
            "evidencias": [prueba],
        }
        lote = {
            "schema_version": 1,
            "fuente_lote": "legado-sintetico",
            "observado_utc": observada,
            "proveedores": [],
            "programas": [],
            "ediciones": [edicion],
        }
        catalogo.cargar_lote(sqlite, lote, True, self.primera)
        control["snapshot_sha256"] = preinscripcion._sha(sqlite)
        guardar_json(self.primera / almacen.CONTROL, control)
        admision.admitir_snapshot(almacen.solicitud(self.primera))
        migrada = self.aplicar(self.primera, "migrada", "2026-11-16")
        self.assertNotEqual(migrada, self.primera)
        nativa = preinscripcion._ediciones_previas(migrada / "catalogo.sqlite3")[self.ident]
        self.assertIs(nativa["gratuidad_subvencionada_acreditada"], True)
        self.assertIs(nativa["tramite_preinscripcion_acreditado"], True)
        self.assertEqual(self.aplicar(migrada, "migrada-otra-vez", "2026-11-17"), migrada)
