"""La consulta por API respeta la muestra y el tope compartido, y deja comprobaciones que el registro reconoce."""

import unittest
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos.comprobacion_api.consulta_por_api import comprobar_por_api
from plataforma_datos.cursos.comprobacion_api.contrato import validar_comprobacion_guardada
from plataforma_datos.cursos.comprobacion_api.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina import transporte
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import (
    CONFIRMA,
    CONTRADICE,
    NO_SE_SABE,
    PARAMETROS,
    SIN_TIEMPO,
    Consulta,
    Ficha,
)
from plataforma_datos.cursos.comprobacion_pagina.contrato import ErrorComprobacion
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.pruebas.test_lectura_soc import fila, ident, oferta


class Grabada:
    """Una API grabada: responde por dirección y su reloj avanza `paso` segundos con cada petición."""

    def __init__(self, respuestas: dict[str, Respuesta], paso: float = 1.0) -> None:
        """Guarda las respuestas por su dirección."""
        self.respuestas, self.paso, self.ahora = respuestas, paso, 0.0
        self.pedidas: list[str] = []

    def pedir(self, url: str, _hasta: float) -> Respuesta:
        """Devuelve la respuesta grabada de esa dirección.

        Returns:
            La respuesta.
        """
        self.pedidas.append(url)
        self.ahora += self.paso
        return self.respuestas[url]

    def consultar(self, fuente: str, retiradas: list[str], fichas: dict[str, Ficha] | None = None) -> Consulta:
        """Comprueba las retiradas con esta API y el tope de 60 s desde ahora.

        Returns:
            La consulta.
        """
        return comprobar_por_api(
            fuente,
            retiradas,
            fichas or {},
            semilla="ciclo",
            pedir=self.pedir,
            reloj=lambda: self.ahora,
            instante=lambda: ej.HORA,
            hasta=self.ahora + PARAMETROS.tope_s,
        )


def oferta_soc(abiertos: range, terminados: range) -> bytes:
    """Una oferta del SOC con unos cursos abiertos y otros ya terminados el día de las pruebas.

    Returns:
        La oferta en latin-1.
    """
    return oferta(*(fila(n, fin="12/31/2026") for n in abiertos), *(fila(n, fin="11/01/2026") for n in terminados))


class MuestraYTope(unittest.TestCase):
    """Pocas consultas y lentas: la muestra de cada fuente y el tope del ciclo, como la consulta de páginas."""

    def test_la_oferta_entera_responde_por_toda_la_muestra_con_una_peticion(self) -> None:
        """Diez retiradas del SOC: se comprueban cuatro con una sola petición y la cuenta separa lo que dicen."""
        retiradas = [ident(n) for n in range(1, 11)]
        abiertos, terminados = range(1, 4), range(4, 6)
        api = Grabada({ej.soc().url: ej.soc(oferta_soc(abiertos, terminados))})
        consulta = api.consultar("formacion", retiradas)
        self.assertEqual(len(api.pedidas), 1)
        self.assertEqual((len(consulta.comprobaciones), consulta.sin_comprobar, consulta.motivo), (4, 6, None))
        cuentas = {resultado: consulta.cuenta(resultado) for resultado in (CONFIRMA, CONTRADICE, NO_SE_SABE)}
        self.assertEqual(sum(cuentas.values()), PARAMETROS.muestra_por_fuente)
        for curso, veredicto in ((c["curso"], c["veredicto"]) for c in consulta.comprobaciones):
            numero = int(curso.rsplit("/", 1)[1])
            esperado = "disponible" if numero in abiertos else "cerrado" if numero in terminados else "no_existe"
            self.assertEqual(veredicto, esperado)

    def test_lo_que_no_cabe_en_el_tope_queda_sin_tiempo(self) -> None:
        """Cada ficha de Citilab tarda 30 s: caben dos de las cuatro y las demás quedan sin comprobar."""
        fichas = [str(n) for n in range(801, 811)]
        api = Grabada({ej.ficha_de_citilab().url.replace("812", f): ej.ficha_de_citilab() for f in fichas}, paso=30.0)
        consulta = api.consultar("citilab", fichas)
        self.assertEqual((len(api.pedidas), consulta.sin_comprobar, consulta.motivo), (2, 8, SIN_TIEMPO))

    def test_un_curso_del_que_la_api_no_responde_no_entra_en_la_muestra(self) -> None:
        """Sin la ficha servida de su especialidad, la edición de FUNDAE no se pregunta y queda sin comprobar."""
        api = Grabada({ej.difusiones().url: ej.difusiones(ej.difusion(fin="2026-11-01"))})
        consulta = api.consultar("fundae", [ej.EDICION_FUNDAE, "fundae:edicion:7", "fundae:1:3462"], ej.FICHAS_FUNDAE)
        self.assertEqual((consulta.cuenta(CONFIRMA), consulta.sin_comprobar, consulta.motivo), (1, 2, None))
        self.assertEqual(api.pedidas, [ej.difusiones().url])

    def test_sin_retiradas_no_se_pide_nada(self) -> None:
        """Una fuente sin retiradas no gasta ninguna petición."""
        api = Grabada({})
        self.assertEqual((api.consultar("citilab", []), api.pedidas), (Consulta(), []))


class Comprobaciones(unittest.TestCase):
    """Cada comprobación dice de dónde sale y el registro de la retirada la valida con su contrato."""

    def test_citilab_bloqueado_queda_sin_saber_con_su_motivo(self) -> None:
        """La página antirrobots no se rodea: la comprobación es `dudoso` y cuenta como «no se sabe»."""
        api = Grabada({ej.comprobacion_antirrobots().url: ej.comprobacion_antirrobots(403)})
        consulta = api.consultar("citilab", [ej.FICHA_CITILAB])
        (comprobacion,) = consulta.comprobaciones
        self.assertEqual((comprobacion["veredicto"], comprobacion["motivo"]), ("dudoso", "pagina_de_comprobacion"))
        self.assertEqual((consulta.cuenta(NO_SE_SABE), consulta.cuenta(CONFIRMA)), (1, 0))
        self.assertEqual(api.pedidas, [ej.comprobacion_antirrobots().url])

    def test_la_comprobacion_guardada_dice_su_origen_y_su_dato(self) -> None:
        """La regla es `comprobacion-api`, la dirección es la de la API y el dato es el literal de la fuente."""
        api = Grabada({ej.catalogo().url: ej.catalogo(ej.material(status="Descatalogado"))})
        (comprobacion,) = api.consultar("cibervoluntarios", [ej.MATERIAL_CIBER], ej.FICHAS_CIBER).comprobaciones
        validar_comprobacion_guardada(comprobacion)
        self.assertEqual(comprobacion["regla"]["id"], "comprobacion-api")
        self.assertEqual(
            {k: comprobacion[k] for k in ("url", "pedido_utc", "http", "dato", "veredicto")},
            {
                "url": ej.catalogo().url,
                "pedido_utc": ej.HORA,
                "http": 200,
                "dato": "material.status=Descatalogado",
                "veredicto": "cerrado",
            },
        )

    def test_una_comprobacion_que_no_cumple_su_contrato_se_rechaza(self) -> None:
        """Un motivo de otro veredicto, un campo de más o un veredicto sin respuesta del servidor no se admiten."""
        api = Grabada({ej.soc().url: ej.soc()})
        (buena,) = api.consultar("formacion", [ej.CURSO_SOC]).comprobaciones
        malas = (
            {**buena, "motivo": "fin_pasado"},
            {**buena, "senales": []},
            {**buena, "http": 503},
            {**buena, "regla": {**buena["regla"], "version": 2}},
        )
        for mala in malas:
            with self.subTest(mala=mala), self.assertRaises(ErrorComprobacion):
                validar_comprobacion_guardada(mala)


class TransporteDeDatos(unittest.TestCase):
    """El transporte real pide las API con el perfil de datos, sin salir a la red en la prueba."""

    def test_la_api_se_pide_con_el_perfil_de_datos(self) -> None:
        """Mismo transporte común que la página, con el perfil con que la fuente descarga su oferta."""

        def descargar(url: str, **opciones: object) -> Descarga:
            opciones["comprobar_cabeceras"](200, url, {})
            self.assertEqual((opciones["perfil"], opciones["hasta"]), ("datos", 10.0))
            return Descarga(b"[]", url, "application/json")

        with patch.object(transporte, "descargar_url", side_effect=descargar):
            respuesta = transporte.pedir_datos(ej.soc().url, 10.0)
        esperada = Respuesta(url=ej.soc().url, http=200, url_final=ej.soc().url, tipo="application/json", cuerpo=b"[]")
        self.assertEqual(respuesta, esperada)


if __name__ == "__main__":
    unittest.main()
