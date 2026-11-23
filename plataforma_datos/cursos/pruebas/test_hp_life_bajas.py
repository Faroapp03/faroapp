"""Bajas de HP LIFE por evidencia: el listado completo afirma la retirada y la ficha la corrobora o la contradice."""

import json
import unittest
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.nucleo import ValidacionFallida
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import politicas_vigencia, retirada_proveedor
from plataforma_datos.cursos.fuentes.hp_life import bajas, extraccion, indice
from plataforma_datos.cursos.fuentes.hp_life import observaciones_vigencia as puente
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_hp_life_altas as altas
from plataforma_datos.cursos.pruebas import test_hp_life_fallos_por_unidad as base
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures
from plataforma_datos.cursos.pruebas.ayuda_panel_copia import InstalacionConPanel
from plataforma_datos.cursos.vigencia import evaluar_vigencia
from plataforma_datos.orquestacion.estado_panel import salida_parcial

PAGINA_DE_ERROR = (Path(__file__).with_name("capturas_hp_life_indice") / "ficha-inexistente.html").read_bytes()
SIN_FICHA = (HTTPStatus.INTERNAL_SERVER_ERROR, PAGINA_DE_ERROR)
PRIMERA, SEGUNDA = base.UNIDADES
URL_PRIMERA, URL_SEGUNDA = (url for url, _n in base.UNIDADES.values())
CORTE = "2026-10-23T04:30:00Z"
RETIRADO = "no-disponible-publicamente"


class BajasHpPruebas(InstalacionConPanel, unittest.TestCase):
    """Parte de dos cursos instalados; el listado solo incluye al primero."""

    TIPO_OBSERVADO = "recurso"
    setUp = base.FallosPorUnidadHpPruebas.setUp
    componer = base.FallosPorUnidadHpPruebas.componer
    ofertas = staticmethod(base.FallosPorUnidadHpPruebas.ofertas)
    consultar = altas.AltasHpPruebas.consultar

    def listado_sin_el_segundo(self) -> dict[int, bytes]:
        """Páginas del listado con solo el primer curso.

        Returns:
            Número de página y HTML.
        """
        return indice_hp.paginas([base.UNIDADES[PRIMERA][1]])

    def numero(self, id: str) -> int:
        """Número nativo de una unidad.

        Returns:
            El identificador numérico de HP LIFE.
        """
        return base.UNIDADES[id][1]

    def ofrecidas(self, corte: str = CORTE) -> set[str]:
        """Direcciones que se ofrecen tras componer.

        Returns:
            URL de cada oferta publicada.
        """
        return set(self.ofertas(self.componer(corte)))

    def estado(self, id: str, corte: str = CORTE) -> dict:
        """Decisión del panel de una unidad.

        Returns:
            Fila de la unidad.
        """
        return self.panel(corte)[id]

    def retirar(self, ficha: object) -> None:
        """Ciclo en el que el listado no incluye al segundo curso y su ficha responde `ficha`."""
        self.assertTrue(self.consultar("04:00", self.listado_sin_el_segundo(), {self.numero(SEGUNDA): ficha}))
        self.componer(CORTE)

    def test_ausente_con_ficha_de_error_real_se_retira_con_fecha_y_evidencia(self) -> None:
        """La página de error 500 de la aplicación, con otra ficha respondiendo bien, retira el curso."""
        self.retirar(SIN_FICHA)
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(
            conjunto["bajas"]["retiradas"],
            {SEGUNDA: {"http": HTTPStatus.INTERNAL_SERVER_ERROR, "pagina_de_error": True}},
        )
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA})
        fila = self.estado(SEGUNDA)
        self.assertEqual(fila["decision"], RETIRADO)
        retiro = [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"]
        self.assertEqual(len(retiro), 1)
        self.assertEqual(retiro[0]["detalle"]["presente"], False)
        self.assertTrue(retiro[0]["detalle"]["lectura_completa"])
        self.assertEqual(retiro[0]["terminado_el"], "2026-10-23T04:00:01+00:00")
        self.assertEqual({e["alcance"] for e in retiro[0]["evidencias"]}, {"catalogo"})
        self.assertEqual(self.estado(PRIMERA)["decision"], "disponible-publicamente")

    def comprobar_retirada(self, ficha: object) -> None:
        """Ciclo de retirada con la respuesta dada: el segundo curso deja de ofrecerse."""
        self.retirar(ficha)
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA})
        self.assertEqual(self.estado(SEGUNDA)["decision"], RETIRADO)

    def test_ausente_con_ficha_404_se_retira(self) -> None:
        """Una respuesta que dice que la página no existe corrobora el listado."""
        self.comprobar_retirada(HTTPStatus.NOT_FOUND)

    def test_ausente_con_ficha_410_se_retira(self) -> None:
        """Una página retirada de forma expresa también lo corrobora."""
        self.comprobar_retirada(HTTPStatus.GONE)

    def test_ausente_con_ficha_integra_es_contradiccion_y_sigue_vigente(self) -> None:
        """Si la ficha existe, el listado no basta: el curso se mantiene y la discrepancia queda anotada."""
        self.retirar("Published")
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(conjunto["bajas"]["contradicciones"], [SEGUNDA])
        self.assertEqual(conjunto["bajas"]["retiradas"], {})
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA, URL_SEGUNDA})

    def test_sin_ninguna_ficha_buena_la_fuente_cae_a_fallo_y_no_se_toca_nada(self) -> None:
        """Si todas las fichas dan error, el fallo puede ser del servidor: la consulta no se admite y nada cambia."""
        antes = self.inventario()
        with self.assertRaises(ValidacionFallida):
            self.consultar(
                "04:00",
                self.listado_sin_el_segundo(),
                {self.numero(PRIMERA): SIN_FICHA, self.numero(SEGUNDA): SIN_FICHA},
            )
        self.assertEqual(self.inventario(), antes)

    def test_todas_las_fichas_ilegibles_tampoco_se_admiten(self) -> None:
        """Un cambio de formato que deja ilegibles las fichas 200 no se admite como consulta parcial."""
        ilegible, antes = b"<html>sin datos</html>", self.inventario()
        with self.assertRaises(ValidacionFallida):
            self.consultar(
                "04:00",
                indice_hp.paginas([n for _u, n in base.UNIDADES.values()]),
                {self.numero(PRIMERA): ilegible, self.numero(SEGUNDA): ilegible},
            )
        self.assertEqual(self.inventario(), antes)

    def comprobar_sin_cambio(self, ficha: object) -> None:
        """Ciclo con el listado sin el segundo curso y una respuesta que no lo corrobora: todo sigue igual."""
        self.retirar(ficha)
        self.assertEqual(fuente.leer_validado("hp_life", self.raiz)["bajas"]["retiradas"], {})
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA, URL_SEGUNDA})

    def test_ficha_503_no_retira(self) -> None:
        """Un servidor que no puede responder no dice nada del curso."""
        self.comprobar_sin_cambio(HTTPStatus.SERVICE_UNAVAILABLE)

    def test_ficha_con_corte_no_retira(self) -> None:
        """Sin respuesta no hay corroboración."""
        self.comprobar_sin_cambio(None)

    def test_error_500_generico_no_retira(self) -> None:
        """Un 500 que no es la página de error de la aplicación puede ser cualquier fallo."""
        self.comprobar_sin_cambio((HTTPStatus.INTERNAL_SERVER_ERROR, b"<html>Error</html>"))

    def test_error_500_de_otra_pagina_no_retira(self) -> None:
        """Solo la ruta interna de error con su código se reconoce."""
        self.comprobar_sin_cambio((HTTPStatus.INTERNAL_SERVER_ERROR, PAGINA_DE_ERROR.replace(b"/_error", b"/otra")))

    def comprobar_censo_parcial(self, paginas: dict[int, bytes]) -> None:
        """Ciclo con un censo parcial y la ficha del segundo curso en error: ninguna baja."""
        self.consultar("04:00", paginas, {self.numero(SEGUNDA): SIN_FICHA})
        self.componer(CORTE)
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertFalse(conjunto["indice"]["completo"])
        self.assertEqual(conjunto["bajas"], {"retiradas": {}, "contradicciones": [], "sin_noticia": []})
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA, URL_SEGUNDA})

    def test_pagina_caida_no_da_bajas(self) -> None:
        """Sin la página del listado no hay censo."""
        self.comprobar_censo_parcial({})

    def test_suma_que_no_cuadra_no_da_bajas(self) -> None:
        """Un total mayor que lo recibido deja el censo parcial."""
        paginas = {
            n: c.replace(b'"totalCourses": 1', b'"totalCourses": 40') for n, c in self.listado_sin_el_segundo().items()
        }
        self.comprobar_censo_parcial(paginas)

    def test_listado_vacio_no_da_bajas(self) -> None:
        """Un listado que declara cero cursos no puede dar por ausente a todo el catálogo."""
        paginas = {
            n: c.replace(b'"totalCourses": 1', b'"totalCourses": 0') for n, c in self.listado_sin_el_segundo().items()
        }
        self.comprobar_censo_parcial(paginas)

    def test_el_listado_parcial_y_la_contradiccion_llegan_al_panel(self) -> None:
        """La consulta admitida entrega al panel un motivo cerrado por cada cosa que no se pudo cerrar."""
        self.consultar("04:00", {}, {})
        self.assertEqual(salida_parcial(self.raiz, "hp_life")["motivos"], ["indice-de-hp-life-sin-completar"])
        self.consultar("05:00", self.listado_sin_el_segundo(), {self.numero(SEGUNDA): "Published"})
        self.assertEqual(salida_parcial(self.raiz, "hp_life")["motivos"], ["ficha-integra-fuera-del-listado"])
        self.consultar("06:00", self.listado_sin_el_segundo(), {self.numero(SEGUNDA): HTTPStatus.SERVICE_UNAVAILABLE})
        self.assertEqual(salida_parcial(self.raiz, "hp_life")["motivos"], ["ausente-del-listado-sin-confirmar"])

    def test_un_retirado_que_vuelve_a_aparecer_se_ofrece_de_nuevo_sin_intervencion(self) -> None:
        """Con el curso otra vez en el listado y su ficha íntegra, la oferta vuelve con su historial intacto."""
        self.retirar(SIN_FICHA)
        self.assertEqual(self.ofrecidas(), {URL_PRIMERA})
        completo = indice_hp.paginas([n for _u, n in base.UNIDADES.values()])
        self.assertTrue(self.consultar("05:00", completo))
        self.componer("2026-10-23T05:30:00Z")
        self.assertEqual(self.ofrecidas("2026-10-23T05:30:00Z"), {URL_PRIMERA, URL_SEGUNDA})
        self.assertEqual(self.estado(SEGUNDA, "2026-10-23T05:30:00Z")["decision"], "disponible-publicamente")
        retiro = [o for o in self.observaciones(SEGUNDA) if o["tipo"] == "catalogo"]
        self.assertEqual(len(retiro), 1)


class DecisionDeBajasPruebas(unittest.TestCase):
    """La regla sin ciclo: sin tope de proporción y sin conclusiones con un censo parcial."""

    @staticmethod
    def fila(id: str, **lectura: object) -> dict:
        """Fila de recepción con la lectura dada.

        Returns:
            Fila con los campos que lee la regla.
        """
        base = {"ids": [], "http": 500, "completo": True}
        return {"id": id, "lectura": {**base, **lectura}}

    def test_cincuenta_ausentes_con_su_ficha_en_error_se_retiran_los_cincuenta(self) -> None:
        """No hay tope de proporción: lo que el proveedor quita, se retira."""
        ausentes = [f"hp-life:{n}:es" for n in range(1000, 1050)]
        vivos = [f"hp-life:{n}:es" for n in range(1, 4)]
        censo = {"completo": True, "cursos": dict.fromkeys(vivos, 1)}
        filas = [self.fila(id, pagina_de_error=True) for id in ausentes]
        filas += [self.fila(id, ids=[id], http=200) for id in vivos]
        resultado = bajas.decidir(censo, filas)
        self.assertEqual(sorted(resultado["retiradas"]), sorted(ausentes))
        self.assertEqual(resultado["contradicciones"], [])

    def test_sin_censo_completo_no_hay_resultado(self) -> None:
        """Un censo parcial no da bajas ni contradicciones."""
        censo = {"completo": False, "cursos": {"hp-life:1:es": 1}}
        filas = [
            self.fila("hp-life:2:es", pagina_de_error=True),
            self.fila("hp-life:1:es", ids=["hp-life:1:es"], http=200),
        ]
        self.assertEqual(bajas.decidir(censo, filas), {"retiradas": {}, "contradicciones": [], "sin_noticia": []})

    def test_la_pagina_de_error_exige_la_forma_exacta(self) -> None:
        """Solo `/_error` con `statusCode` 500 y sin ficha se reconoce."""
        self.assertTrue(extraccion.pagina_de_error(PAGINA_DE_ERROR))
        for cuerpo in (
            b"",
            b"<html></html>",
            PAGINA_DE_ERROR.replace(b'"statusCode": 500', b'"statusCode": 502'),
            PAGINA_DE_ERROR.replace(b'"statusCode":500', b'"statusCode":404'),
        ):
            if cuerpo != PAGINA_DE_ERROR:
                self.assertFalse(extraccion.pagina_de_error(cuerpo))


class ServidorSanoPruebas(unittest.TestCase):
    """Solo se retira si responde bien más de la mitad de las fichas de los cursos que el listado incluye."""

    @staticmethod
    def retiradas(listados: int, buenas: int) -> dict:
        """Un curso ausente con la página de error y `listados` cursos listados, `buenas` de ellos con ficha íntegra.

        Returns:
            Las retiradas que decide la regla.
        """
        ids = [f"hp-life:{n}:es" for n in range(1, listados + 1)]
        censo = {"completo": True, "cursos": dict.fromkeys(ids, 1)}
        filas = [DecisionDeBajasPruebas.fila("hp-life:900:es", pagina_de_error=True)]
        for n, id in enumerate(ids):
            filas.append(
                DecisionDeBajasPruebas.fila(id, ids=[id], http=200) if n < buenas else DecisionDeBajasPruebas.fila(id)
            )
        return bajas.decidir(censo, filas)["retiradas"]

    def test_diez_listados_con_seis_fichas_buenas_se_retira(self) -> None:
        """Más de la mitad: el servidor se da por sano."""
        self.assertEqual(list(self.retiradas(10, 6)), ["hp-life:900:es"])

    def test_diez_listados_con_cinco_fichas_buenas_no_cambia_nada(self) -> None:
        """La mitad exacta no basta."""
        self.assertEqual(self.retiradas(10, 5), {})

    def test_un_listado_con_su_ficha_buena_se_retira(self) -> None:
        """Un único curso listado, con su ficha buena, es mayoría."""
        self.assertEqual(list(self.retiradas(1, 1)), ["hp-life:900:es"])

    def test_un_ausente_sin_comprobar_avisa_en_el_panel(self) -> None:
        """Ausente del listado cuya página no se pudo comprobar: queda sin noticia y el panel lo sabe."""
        resultado = bajas.decidir(
            {"completo": True, "cursos": {"hp-life:1:es": 1}},
            [
                DecisionDeBajasPruebas.fila("hp-life:1:es", ids=["hp-life:1:es"], http=200),
                DecisionDeBajasPruebas.fila("hp-life:2:es", http=503),
            ],
        )
        self.assertEqual(resultado["sin_noticia"], ["hp-life:2:es"])
        conjunto = {"indice": {"completo": True}, "bajas": resultado}
        self.assertEqual(bajas.avisos(conjunto), [{"motivo": "ausente-del-listado-sin-confirmar"}])


class OrdenTemporalPruebas(unittest.TestCase):
    """La ausencia y la ficha se ordenan como instantes, con o sin fracción de segundo, y un empate lo gana la ficha."""

    @staticmethod
    def ausencia(fin: str) -> dict:
        """Observación de ausencia del listado terminada en `fin`.

        Returns:
            Observación de catálogo con la lectura completa y sin el curso.
        """
        return {
            "id": "ausencia-" + fin,
            "tipo": "catalogo",
            "intentado_el": "2026-10-23T02:07:00Z",
            "terminado_el": fin,
            "resultado": "correcta",
            "url_consultada": indice.INDICE,
            "detalle": {
                "url_final": indice.INDICE,
                "codigo_http": 200,
                "tipo_destino": "catalogo",
                "identidad_buscada": fixtures.OFERTA["id"],
                "lectura_completa": True,
                "presente": False,
            },
            "evidencias": [
                {
                    "alcance": "catalogo",
                    "url": indice.INDICE,
                    "capturado_utc": fin,
                    "sha256": "a" * 64,
                    "localizador": {"tipo": "pagina", "valor": "page=1"},
                }
            ],
        }

    def estado(self, fichas_el: str, ausencia_el: str) -> str:
        """Estado de la oferta con una ficha íntegra y una ausencia en esos instantes.

        Returns:
            El estado que decide el evaluador con la política 3.
        """
        ficha = puente.construir_observacion(
            leer_recepcion(*fixtures.recepcion(recibido_utc=fichas_el)), oferta=fixtures.OFERTA
        )
        politica = politicas_vigencia.leer_politica(retirada_proveedor.FUENTE, retirada_proveedor.VERSION_POLITICA)
        resultado = evaluar_vigencia(
            fixtures.OFERTA, [ficha, self.ausencia(ausencia_el)], politica, ahora=fixtures.AHORA
        )
        return resultado["estado"]

    def test_una_ausencia_con_fraccion_posterior_a_una_ficha_sin_fraccion_retira(self) -> None:
        """«…:20.5Z» es posterior a «…:20Z» aunque como texto sea anterior."""
        self.assertEqual(self.estado("2026-10-23T02:07:20Z", "2026-10-23T02:07:20.5Z"), RETIRADO)

    def test_una_ficha_posterior_con_fraccion_mantiene_el_curso(self) -> None:
        """La ficha más reciente contradice la ausencia."""
        self.assertEqual(self.estado("2026-10-23T02:07:20.5+00:00", "2026-10-23T02:07:20Z"), "disponible-publicamente")

    def test_un_empate_exacto_lo_gana_la_ficha_integra(self) -> None:
        """Con el mismo instante el curso sigue vigente."""
        self.assertEqual(self.estado("2026-10-23T02:07:20Z", "2026-10-23T02:07:20Z"), "disponible-publicamente")
        self.assertEqual(self.estado("2026-10-23T02:07:20.0Z", "2026-10-23T02:07:20+00:00"), "disponible-publicamente")


class ConstantesDeLaPoliticaPruebas(unittest.TestCase):
    """El JSON de la política 3 dice lo mismo que las constantes del código."""

    def test_la_politica_3_declara_la_regla_y_la_version_del_codigo(self) -> None:
        """Método, fuente y versión del JSON son los de `retirada_proveedor`."""
        ruta = Path(indice.__file__).with_name("politica_vigencia_v3.json")
        documento = json.loads(ruta.read_text(encoding="utf-8"))
        self.assertEqual(documento["criterios"]["regla_disponibilidad"], retirada_proveedor.METODO)
        self.assertEqual(documento["version"], retirada_proveedor.VERSION_POLITICA)
        self.assertEqual(documento["fuente_id"], retirada_proveedor.FUENTE)
        self.assertTrue(retirada_proveedor.regla_valida(politicas_vigencia.leer_politica("hp_life", "3")))
