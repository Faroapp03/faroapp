"""El contrato `comprobacion-pagina`: cerrado, coherente, con su esquema y con la forma que espera la regla."""

import copy
import json
import unittest
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import retirada_por_evidencia as regla_de_retirada
from plataforma_datos.cursos.comprobacion_pagina import contrato
from plataforma_datos.cursos.comprobacion_pagina.contrato import Comprobacion, ErrorComprobacion
from plataforma_datos.cursos.comprobacion_pagina.para_la_regla import comprobacion_para_la_regla
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.regla import regla_de_comprobacion
from plataforma_datos.cursos.comprobacion_pagina.veredicto import comprobar_pagina

ESQUEMA = Path(contrato.__file__).with_name("comprobacion_pagina.json")


def disponible() -> dict:
    """Una comprobación válida con veredicto `disponible`.

    Returns:
        La comprobación tal como se guarda.
    """
    return comprobar_pagina(ej.curso(), ej.respuesta(ej.ficha_abierta()), ej.sonda(), pedido_utc=ej.HORA).a_json()


def cerrado() -> dict:
    """Una comprobación válida con veredicto `no_existe`.

    Returns:
        La comprobación tal como se guarda.
    """
    return comprobar_pagina(ej.curso(), ej.respuesta(http=404), ej.sonda(), pedido_utc=ej.HORA).a_json()


class ContratoComprobacionPruebas(unittest.TestCase):
    """Lo que se construye es lo que se valida; lo ajeno se rechaza con un mensaje que dice qué falla."""

    def rechaza(self, mensaje: str, base: dict | None = None, **cambios: object) -> None:
        """Comprueba que la validación rechaza la comprobación con esos cambios y ese mensaje."""
        dato = {**(disponible() if base is None else base), **cambios}
        with self.assertRaisesRegex(ErrorComprobacion, mensaje):
            contrato.validar_comprobacion(dato)

    def test_los_campos_son_los_del_contrato_y_en_su_orden(self) -> None:
        """Lo que sale de la función tiene exactamente los campos del contrato."""
        self.assertEqual(tuple(disponible()), contrato.CAMPOS)

    def test_campos_de_mas_o_de_menos(self) -> None:
        """El contrato es cerrado: un campo de más o de menos se rechaza."""
        dato = disponible()
        self.rechaza("campo no admitido «extra»", extra=1)
        del dato["motivo"]
        with self.assertRaisesRegex(ErrorComprobacion, "falta el campo «motivo»"):
            contrato.validar_comprobacion(dato)
        with self.assertRaisesRegex(ErrorComprobacion, "debe ser un objeto"):
            contrato.validar_comprobacion([])

    def test_veredicto_fuera_de_la_lista_y_motivo_ajeno(self) -> None:
        """Solo los cinco veredictos, y cada uno con sus motivos."""
        self.rechaza("veredicto no admitido", veredicto="abierto")
        self.rechaza("motivo no admitido para ese veredicto", motivo="senal_de_cierre")
        self.rechaza("motivo no admitido para ese veredicto", veredicto="cerrado", motivo="titulo_ausente")

    def test_cada_veredicto_de_la_lista_tiene_motivos(self) -> None:
        """La lista cerrada es la que espera la regla de retirada y ninguno queda sin motivo."""
        self.assertEqual(contrato.VEREDICTOS, regla_de_retirada.VEREDICTOS)
        self.assertEqual(set(contrato.MOTIVOS), set(contrato.VEREDICTOS))
        self.assertTrue(all(contrato.MOTIVOS[v] for v in contrato.VEREDICTOS))

    def test_coherencia_entre_el_veredicto_y_la_respuesta(self) -> None:
        """Sin estado HTTP solo hay `sin_respuesta`; `cerrado` y `disponible` no caben con un error del servidor."""
        self.rechaza("cerrado necesita una respuesta", veredicto="cerrado", motivo="senal_de_cierre", http=503)
        self.rechaza("sin_respuesta solo cabe", veredicto="sin_respuesta", motivo="error_de_red")
        self.rechaza(
            "sin_respuesta no lleva señales",
            veredicto="sin_respuesta",
            motivo="error_del_servidor",
            http=503,
            senales=["x"],
        )
        self.rechaza(
            "sin respuesta no lleva dirección final ni saltos",
            http=None,
            veredicto="sin_respuesta",
            motivo="error_de_red",
            senales=[],
        )

    def test_campos_mal_escritos(self) -> None:
        """Hora, huellas, direcciones, saltos y señales con su forma exacta."""
        casos = [
            ({"pedido_utc": "2026-11-22T10:00:00+01:00"}, "pedido_utc: hora UTC no válida"),
            ({"pedido_utc": "2026-02-30T10:00:00Z"}, "fecha inexistente"),
            ({"sha256_cuerpo": "abc"}, "sha256_cuerpo: huella SHA-256 no válida"),
            ({"sonda_sha256": "abc"}, "sonda_sha256: huella SHA-256 no válida"),
            ({"url": "ftp://cursos.ejemplo.test/a"}, "url: debe ser una dirección http o https"),
            ({"url_final": None}, "url_final: texto vacío"),
            ({"saltos": -1}, "saltos: número no válido"),
            ({"http": 99}, "http: estado no válido"),
            ({"http": True}, "http: estado no válido"),
            ({"longitud_texto": True}, "longitud_texto: entero no válido"),
            ({"titulo_presente": 1}, "titulo_presente debe ser verdadero o falso"),
            ({"senales": ["b", "a"]}, "senales: sin orden canónico"),
            ({"senales": ["a", "a"]}, "senales: sin orden canónico o con repetidos"),
            ({"curso": ""}, "curso: texto vacío"),
            ({"fuente": "Fuente Mala"}, "fuente no admitida"),
            ({"version": 2}, "versión no admitida"),
            ({"regla": {"id": "x", "version": 1}}, "regla: debe tener exactamente"),
            ({"regla": {"id": "X", "version": 1, "sha256": "a" * 64}}, "regla: identificador no admitido"),
        ]
        for cambios, mensaje in casos:
            with self.subTest(cambios=cambios):
                self.rechaza(mensaje, **cambios)

    def test_la_construccion_valida_y_ordena_las_senales(self) -> None:
        """Al construir una comprobación se valida lo que se guardará, con las señales ordenadas."""
        base = disponible()
        base.pop("version")
        base["regla"] = regla_de_comprobacion()
        construida = Comprobacion(**{**base, "senales": ("b", "a")})
        self.assertEqual(construida.a_json()["senales"], ["a", "b"])
        with self.assertRaises(ErrorComprobacion):
            Comprobacion(**{**base, "veredicto": "abierto"})

    def test_esquema_coincide_con_el_contrato_ejecutado(self) -> None:
        """El esquema publicado describe los campos y las listas cerradas que exige el código."""
        esquema = json.loads(ESQUEMA.read_text(encoding="utf-8"))
        propiedades = esquema["properties"]
        self.assertEqual(esquema["required"], list(contrato.CAMPOS))
        self.assertEqual(list(propiedades), list(contrato.CAMPOS))
        self.assertFalse(esquema["additionalProperties"])
        self.assertEqual(propiedades["version"]["const"], contrato.VERSION)
        self.assertEqual(propiedades["veredicto"]["enum"], list(contrato.VEREDICTOS))
        self.assertEqual(propiedades["motivo"]["enum"], sorted(m for ms in contrato.MOTIVOS.values() for m in ms))
        self.assertEqual(propiedades["senales"]["maxItems"], contrato.MAX_SENALES)
        self.assertEqual(propiedades["saltos"]["maximum"], contrato.MAX_SALTOS)
        self.assertEqual(esquema["$defs"]["texto"]["maxLength"], contrato.MAX_TEXTO)
        self.assertEqual(esquema["$defs"]["direccion"]["maxLength"], contrato.MAX_URL)
        self.assertEqual(sorted(esquema["$defs"]["regla"]["properties"]), sorted(("id", "version", "sha256")))

    def test_la_regla_es_estable_y_valida(self) -> None:
        """La regla que firma cada comprobación se identifica y su huella no cambia entre llamadas."""
        regla = regla_de_comprobacion()
        self.assertEqual((regla.id, regla.version), ("comprobacion-pagina", 1))
        self.assertEqual(regla, regla_de_comprobacion())
        self.assertEqual(disponible()["regla"], regla.a_json())


class ConversionParaLaReglaPruebas(unittest.TestCase):
    """La comprobación completa se resume en lo que `retirada_por_evidencia` necesita."""

    def test_conserva_el_veredicto_y_la_hora_y_la_huella_es_la_de_toda_la_comprobacion(self) -> None:
        """El veredicto y la hora pasan tal cual; la huella identifica la comprobación entera."""
        for comprobacion in (disponible(), cerrado()):
            with self.subTest(veredicto=comprobacion["veredicto"]):
                resumen = comprobacion_para_la_regla(comprobacion)
                self.assertIsInstance(resumen, regla_de_retirada.ComprobacionPagina)
                self.assertEqual(
                    (resumen.veredicto, resumen.pedido_utc, resumen.sha256),
                    (comprobacion["veredicto"], ej.HORA, sha256_json(comprobacion)),
                )

    def test_otra_observacion_otra_huella(self) -> None:
        """Dos comprobaciones distintas de la misma página no comparten huella."""
        otra = copy.deepcopy(cerrado())
        otra["pedido_utc"] = "2026-11-23T10:00:00Z"
        self.assertNotEqual(comprobacion_para_la_regla(otra).sha256, comprobacion_para_la_regla(cerrado()).sha256)

    def test_solo_cierre_y_no_existe_son_de_baja(self) -> None:
        """Cada veredicto de la lista llega a la regla, que solo cuenta `cerrado` y `no_existe` como baja."""
        for veredicto in contrato.VEREDICTOS:
            with self.subTest(veredicto=veredicto):
                resumen = regla_de_retirada.ComprobacionPagina(veredicto=veredicto, pedido_utc=ej.HORA, sha256="a" * 64)
                self.assertEqual(
                    resumen.veredicto in regla_de_retirada.VEREDICTOS_DE_BAJA, veredicto in ("cerrado", "no_existe")
                )

    def test_rechaza_una_comprobacion_que_no_cumple_el_contrato(self) -> None:
        """Una comprobación mal formada no llega a la regla como evidencia."""
        mala = {**cerrado(), "veredicto": "abierto"}
        with self.assertRaises(ErrorComprobacion):
            comprobacion_para_la_regla(mala)


if __name__ == "__main__":
    unittest.main()
