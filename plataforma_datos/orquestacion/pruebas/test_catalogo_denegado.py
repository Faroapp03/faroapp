"""Una denegación nueva conserva el intento y nunca rejuvenece la última versión buena."""

import hashlib
import json
import shutil
import unittest
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.comun.nucleo import Carpetas, ValidacionFallida
from plataforma_datos.cursos import componer_catalogo, operacion_fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_componer_catalogo as fixtures
from plataforma_datos.cursos.pruebas.test_hp_life_observaciones import recepcion
from plataforma_datos.orquestacion import actualizar, admision, comprobaciones_remotas, modulos
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento
from plataforma_datos.orquestacion.sustitucion import cerrojo


def _transporte(
    codigo: int,
    inicio: datetime,
    fin: datetime,
    pedidas: list[transporte.RespuestaCatalogo],
    ayuda: bytes | None = None,
) -> Callable[..., transporte.RespuestaCatalogo]:
    """Responde como el sitio: el día bueno cada página es la suya y el denegado todas reciben lo mismo.

    Returns:
        Función que sustituye a la consulta y anota cada respuesta dada en `pedidas`.
    """
    indice_buena = indice_hp.paginas([431])

    def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
        if codigo != HTTPStatus.OK:
            cuerpo = b"<html>Acceso denegado</html>"
        elif url == gratuidad.URL_AYUDA:
            cuerpo = ayuda or indice_hp.cuerpo_de_ayuda()
        elif url.startswith(indice.INDICE):
            cuerpo = indice_buena[indice.numero_de_pagina(url)]
        else:
            cuerpo = recepcion()[0]
        pedida = transporte.RespuestaCatalogo(
            url=url,
            inicio_utc=inicio.isoformat(),
            fin_utc=fin.isoformat(),
            cuerpo=cuerpo,
            url_final=url,
            http=codigo,
            completo=True,
            content_type="text/html",
        )
        pedidas.append(pedida)
        return pedida

    return responder


def _peticion(pedida: transporte.RespuestaCatalogo, inicio: datetime) -> dict:
    """Describe una petición como la registra el seguimiento.

    Returns:
        La petición con las huellas de su respuesta.
    """
    sha = hashlib.sha256(pedida.cuerpo).hexdigest()
    return {
        "recurso_sha256": fixtures.identidad_recurso(pedida.url),
        "url_final_sha256": hashlib.sha256(pedida.url.encode()).hexdigest(),
        "respuesta_sha256": sha,
        "bytes": len(pedida.cuerpo),
        "completado_utc": (inicio + timedelta(seconds=1)).isoformat(),
        "original_sha256": sha,
        "original_bytes": len(pedida.cuerpo),
    }


class CatalogoDenegadoPruebas(unittest.TestCase):
    """Ejecuta etapas y admisión reales sobre un transporte sintético, sin red."""

    def setUp(self) -> None:
        """Reutiliza una SQLite pequeña y capturas propias con controles ejecutados."""
        self.caso = fixtures.ComponerCatalogoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.raiz
        self.modulo = next(m for m in modulos.MODULOS if m.id == "hp_life")
        (self.raiz / CARPETA_DE_INFORMES).mkdir(parents=True)

    def ciclo(self, codigo: int, comienzo: datetime, ayuda: bytes | None = None) -> tuple[dict, dict]:
        """Invoca el ejecutor común, su observador y el registro v5.

        Returns:
            Fuente del registro remoto y estado local tras cerrar el intento.
        """
        area = self.caso.raiz.parent / f"Candidata {codigo}-{comienzo.hour}"
        shutil.copytree(self.raiz, area)
        inicio, fin = comienzo + timedelta(seconds=1), comienzo + timedelta(seconds=3)
        pedidas: list[transporte.RespuestaCatalogo] = []
        responder = _transporte(codigo, inicio, fin, pedidas, ayuda)
        evidencia = {
            "version": 2,
            "fuente": "hp_life",
            "intento": f"sintetico-{codigo}",
            "comienzo_utc": inicio.isoformat(),
            "fin_utc": (fin + timedelta(seconds=1)).isoformat(),
            "peticiones": [],
        }

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*operacion_fuente.rutas_de_la_fuente(id, area))

        def ejecutar(orden: list[str], candidata: Path) -> actualizar.Resultado:
            etapa = orden[3]
            try:
                with (
                    patch.object(operacion_fuente, "RAIZ", area),
                    patch.object(admision, "carpetas", carpetas),
                    patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / f"{id}.json"),
                ):
                    if etapa == "descargar":
                        with patch.object(transporte, "consultar", side_effect=responder):
                            operacion_fuente.descargar("hp_life", raiz=area)
                        evidencia["peticiones"] = [_peticion(p, inicio) for p in pedidas]
                    elif etapa == "preparar":
                        operacion_fuente.preparar("hp_life", raiz=area)
                    else:
                        operacion_fuente.validar("hp_life", raiz=area)
            except ValidacionFallida as error:
                return actualizar.Resultado(1, str(error))
            return actualizar.Resultado(0, "", evidencia if etapa == "descargar" else None)

        with cerrojo(self.raiz):
            id_ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, comienzo, "manual")
            seguimiento = Seguimiento(
                self.raiz, id_ciclo, ejecutar, Mock(side_effect=[comienzo, comienzo + timedelta(seconds=5)])
            )
            _, resultado = actualizar.ejecutar_modulo(
                self.raiz, area, self.modulo, seguimiento.ejecutar, actualizar.Opciones(reintento=0, pausa=0)
            )
            seguimiento.terminar_modulo(self.modulo, resultado)
            comprobaciones_remotas.cerrar_ciclo(
                self.raiz,
                id_ciclo,
                comienzo + timedelta(seconds=6),
                resultado="sin-cambios" if resultado.veredicto == estado.VERDE else "fallo",
                paquete_preparado=False,
            )
            estado.registrar_estado(
                self.raiz,
                {"hp_life": resultado},
                estado.Intento(comienzo, resultado.veredicto, self.raiz / CARPETA_DE_INFORMES / f"intento-{codigo}.md"),
                aviso=lambda _raiz, _mensaje: None,
            )
        return comprobaciones_remotas.leer_registro(self.raiz), estado.leer_estado(self.raiz)

    def test_un_dia_con_la_declaracion_de_gratuidad_cambiada_no_acredita_la_fuente(self) -> None:
        """Todo responde 200, pero la ayuda ya no trae la declaración: el registro remoto queda en parcial."""
        comienzo = datetime(2026, 10, 23, 4, tzinfo=UTC)
        cambiada = indice_hp.cuerpo_de_ayuda(indice_hp.OTRAS_AYUDAS)
        remoto, _local = self.ciclo(HTTPStatus.OK, comienzo, cambiada)
        self.assertEqual(remoto["fuentes"]["hp_life"]["resultado"], "parcial")
        remoto, _local = self.ciclo(HTTPStatus.OK, comienzo + timedelta(hours=1))
        self.assertEqual(remoto["fuentes"]["hp_life"]["resultado"], "comprobada")

    def _secuencia(self, codigo: int) -> None:
        """La respuesta denegada queda en originales sin reemplazar la admisión 200."""
        comienzo = datetime(2026, 10, 23, 4, tzinfo=UTC)
        remoto_bueno, local_bueno = self.ciclo(HTTPStatus.OK, comienzo)
        self.assertEqual(remoto_bueno["fuentes"]["hp_life"]["resultado"], "comprobada")
        primera = componer_catalogo.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:07Z")
        original, _, validado = operacion_fuente.rutas_de_la_fuente("hp_life", self.raiz)
        informe_bueno = (validado / "validacion.json").read_bytes()
        procedencia_buena = (validado / "procedencia-admitida.json").read_bytes()
        conjunto_bueno = (validado / "hp_life.json").read_bytes()
        historial_bueno = json.loads((original / "procedencia.json").read_bytes())["historial"]
        remoto_malo, local_malo = self.ciclo(codigo, comienzo + timedelta(hours=1))
        self.assertEqual(local_malo["hp_life"]["veredicto"], estado.AMBAR)
        self.assertEqual(local_malo["hp_life"]["ultima_version_buena"], local_bueno["hp_life"]["ultima_version_buena"])
        self.assertNotEqual(local_malo["hp_life"]["ultimo_intento_utc"], local_bueno["hp_life"]["ultimo_intento_utc"])
        self.assertEqual(remoto_malo["conjuntos"]["hp_life"], remoto_bueno["conjuntos"]["hp_life"])
        self.assertEqual(remoto_malo["fuentes"]["hp_life"]["resultado"], "fallo")
        self.assertNotEqual(
            remoto_malo["fuentes"]["hp_life"]["ultimo_intento_remoto_utc"],
            remoto_bueno["fuentes"]["hp_life"]["ultimo_intento_remoto_utc"],
        )
        self.assertEqual((validado / "validacion.json").read_bytes(), informe_bueno)
        self.assertEqual((validado / "procedencia-admitida.json").read_bytes(), procedencia_buena)
        self.assertEqual((validado / "hp_life.json").read_bytes(), conjunto_bueno)
        despues = json.loads((original / "procedencia.json").read_bytes())
        self.assertTrue(all(ref in despues["historial"] for ref in historial_bueno))
        recibo_denegado = despues["capturas"][0]["recibo"]
        self.assertIn(recibo_denegado, despues["historial"])
        self.assertEqual(json.loads((original / recibo_denegado["archivo"]).read_bytes())["captura"]["http"], codigo)
        self.assertEqual(componer_catalogo.componer(raiz=self.raiz, corte_utc="2026-10-23T05:00:07Z"), primera)

    def test_200_a_403_conserva_comprobacion_version_y_oferta_sin_ocultar_intento(self) -> None:
        """Una denegación no rejuvenece la versión buena ni la comprobación remota."""
        self._secuencia(HTTPStatus.FORBIDDEN)

    def test_200_a_401_conserva_comprobacion_version_y_oferta(self) -> None:
        """La petición de autenticación conserva datos y se registra como intento fallido."""
        self._secuencia(HTTPStatus.UNAUTHORIZED)

    def test_200_a_302_conserva_comprobacion_version_y_oferta(self) -> None:
        """Una redirección no interpreta otro destino como evidencia de acceso."""
        self._secuencia(HTTPStatus.FOUND)

    def test_fallo_de_escritura_del_indice_admitido_recupera_y_permite_reintento(self) -> None:
        """Una escritura interrumpida no publica el conjunto nuevo ni destruye su antecedente."""
        comienzo = datetime(2026, 10, 23, 4, tzinfo=UTC)
        _, bueno = self.ciclo(HTTPStatus.OK, comienzo)
        _, _, validado = operacion_fuente.rutas_de_la_fuente("hp_life", self.raiz)
        anteriores = {p.name: p.read_bytes() for p in validado.iterdir() if p.is_file()}
        with patch.object(operacion_fuente, "escribir_atomico", side_effect=OSError("corte antes de promover índice")):
            remoto, fallido = self.ciclo(HTTPStatus.OK, comienzo + timedelta(hours=1))
        self.assertEqual(fallido["hp_life"]["ultima_version_buena"], bueno["hp_life"]["ultima_version_buena"])
        self.assertEqual(fallido["hp_life"]["veredicto"], estado.AMBAR)
        self.assertEqual(remoto["fuentes"]["hp_life"]["resultado"], "fallo")
        self.assertEqual({p.name: p.read_bytes() for p in validado.iterdir() if p.is_file()}, anteriores)
        _, recuperado = self.ciclo(HTTPStatus.OK, comienzo + timedelta(hours=2))
        self.assertEqual(recuperado["hp_life"]["veredicto"], estado.VERDE)
        self.assertIsNotNone(operacion_fuente.leer_validado("hp_life", self.raiz))
