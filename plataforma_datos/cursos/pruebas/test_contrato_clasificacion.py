"""El contrato de la clasificación que viaja en cada oferta, y su lugar en la entrega pública del catálogo."""

import copy
import json
import unittest
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.clasificacion import contrato as clasificacion
from plataforma_datos.cursos.entrega_catalogo import ESQUEMA

RAIZ = Path(__file__).resolve().parents[3]
EJEMPLOS = json.loads((RAIZ / "pruebas/fixtures/clasificacion-catalogo-ejemplos.json").read_text(encoding="utf-8"))
# La entrega que sirve hoy la web cambia con cada ciclo, en la 6 o en la 7: solo se comprueba que cumple el contrato.
ENTREGA_VIGENTE = sorted((RAIZ / "web/datos/catalogo-cursos").glob("*.json"))
# Una entrega 6 fija, sacada de la publicada el 18/11 (una oferta de cada proveedor): los casos construidos parten de
# ella para que lo que comprueban no dependa de la versión ni de las ofertas de la entrega del día.
BASE_V6 = RAIZ / "pruebas/fixtures/catalogo-cursos-v6.utf8"


def entrega_vigente() -> dict:
    """La entrega que hoy publica la web, tal como está en el repositorio.

    Returns:
        La entrega leída del único archivo publicado.
    """
    (ruta,) = ENTREGA_VIGENTE
    return json.loads(ruta.read_text(encoding="utf-8"))


def entrega_v6() -> dict:
    """La entrega 6 fija de las pruebas, sin ningún bloque de clasificación.

    Returns:
        Una copia nueva en cada llamada.
    """
    return json.loads(BASE_V6.read_text(encoding="utf-8"))


def con_clasificacion(entrega: dict, version: int, bloque: dict) -> dict:
    """Copia la entrega con la versión dada y el bloque en su primera oferta, con la revisión recalculada.

    Returns:
        La entrega modificada.
    """
    dato = copy.deepcopy(entrega)
    dato["schema_version"] = version
    dato["ofertas"][0]["clasificacion"] = copy.deepcopy(bloque)
    dato["revision"] = sha256_json({k: v for k, v in dato.items() if k != "revision"})
    return dato


class ReglasDelBloque(unittest.TestCase):
    """Cada regla del contrato rechaza el caso que la incumple y admite un ejemplo de cada estado."""

    def test_admite_un_ejemplo_completo_de_cada_estado(self) -> None:
        """Fuente, orientación de Faro y por confirmar, solos y juntos en un mismo bloque."""
        for nombre, bloque in EJEMPLOS["validos"].items():
            with self.subTest(nombre):
                clasificacion.validar_bloque(bloque, corte="2026-11-18T18:44:35Z")

    def test_rechaza_cada_incumplimiento(self) -> None:
        """Motivo ausente o con otro estado, valor sin apoyo, vocabulario o estado desconocidos y texto libre."""
        for caso in EJEMPLOS["invalidos"]:
            with self.subTest(caso["caso"]), self.assertRaises(ValueError):
                clasificacion.validar_bloque(caso["bloque"], corte=None)

    def test_rechaza_una_evidencia_posterior_al_corte(self) -> None:
        """Lo que decide el productor se apoya en capturas que ya existían en el corte."""
        bloque = copy.deepcopy(EJEMPLOS["validos"]["fuente"])
        bloque["idioma"]["evidencias"][0]["capturado_utc"] = EJEMPLOS["captura_posterior_al_corte"]
        clasificacion.validar_bloque(bloque, corte=None)
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            clasificacion.validar_bloque(bloque, corte="2026-11-18T18:44:35Z")


class RepresentacionEnPython(unittest.TestCase):
    """Las fuentes construyen la clasificación con tipos que ya cumplen el contrato."""

    def test_construye_el_mismo_bloque_que_el_ejemplo_completo(self) -> None:
        """Los tipos dan exactamente el JSON del ejemplo, con el valor del nivel en su campo propio."""
        agora = "https://agora.fundae.es/Oferta/RecuperarDifusionesRFO?codigoTitulacion=IFCD0112"
        normas = "https://cibernarium.barcelonactiva.cat/ca/normesfaqs"
        captura = "2026-11-18T08:00:00Z"
        resultado = clasificacion.Clasificacion(
            idioma=clasificacion.DatoClasificado(
                valores=("es", "ca"),
                estado="fuente",
                alcance="norma-general",
                certeza="alta",
                evidencias=(
                    clasificacion.Evidencia(url=normas, sha256="d" * 64, capturado_utc=captura, localizador="#NU11"),
                ),
            ),
            nivel=clasificacion.DatoClasificado(
                estado="por-confirmar",
                motivo_por_confirmar="conflicto_evidencias",
                evidencias=(
                    clasificacion.Evidencia(url=normas, sha256="f" * 64, capturado_utc=captura, localizador="#nivell"),
                    clasificacion.Evidencia(
                        url=agora, sha256="c" * 64, capturado_utc=captura, localizador="/curso/nivel"
                    ),
                ),
            ),
            materia=clasificacion.DatoClasificado(
                valores=("datos", "ia"),
                estado="orientacion-faro",
                alcance="actividad",
                certeza="baja",
                regla=clasificacion.Regla(id="materia-titulo", version=2, sha256="e" * 64),
            ),
        )
        self.assertEqual(resultado.a_json(), EJEMPLOS["validos"]["completo"])

    def test_no_se_puede_construir_un_dato_por_confirmar_sin_motivo(self) -> None:
        """La regla se cumple al construir, no solo al publicar."""
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            clasificacion.Clasificacion(nivel=clasificacion.DatoClasificado(estado="por-confirmar"))

    def test_una_fuente_que_no_clasifica_deja_el_dato_ausente(self) -> None:
        """Un dato ausente no es «por confirmar»: es uno que su fuente todavía no clasifica en el productor."""
        resultado = clasificacion.Clasificacion(
            materia=clasificacion.DatoClasificado(estado="por-confirmar", motivo_por_confirmar="sin_captura")
        )
        self.assertEqual(set(resultado.a_json()), {"materia"})


class LugarEnLaEntrega(unittest.TestCase):
    """La 6 se sigue leyendo, la entrega servida cumple el contrato y el bloque solo entra en la 7."""

    def test_una_entrega_6_se_sigue_leyendo(self) -> None:
        """Una entrega en la versión 6, sin ningún bloque de clasificación, cumple el contrato."""
        entrega = entrega_v6()
        self.assertEqual(entrega["schema_version"], contrato.VERSION_BASE)
        self.assertTrue(entrega["ofertas"])
        self.assertFalse(any("clasificacion" in oferta for oferta in entrega["ofertas"]))
        contrato.validar_publico(entrega)

    def test_la_entrega_servida_cumple_el_contrato_en_su_version(self) -> None:
        """La que publica la web hoy, sea la 6 o la 7 que emite el productor."""
        entrega = entrega_vigente()
        self.assertIn(entrega["schema_version"], (contrato.VERSION_BASE, contrato.VERSION))
        contrato.validar_publico(entrega)

    def test_la_version_7_admite_el_bloque_y_la_6_lo_rechaza(self) -> None:
        """Un lector de la 6 no conoce el campo: por eso la entrega que lo lleva cambia de versión."""
        entrega = entrega_v6()
        bloque = EJEMPLOS["validos"]["completo"]
        contrato.validar_publico(con_clasificacion(entrega, contrato.VERSION, bloque))
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            contrato.validar_publico(con_clasificacion(entrega, contrato.VERSION_BASE, bloque))

    def test_la_version_7_sin_bloques_es_la_6(self) -> None:
        """El bloque es opcional: una entrega 7 sin él admite exactamente las mismas ofertas."""
        dato = entrega_v6()
        dato["schema_version"] = contrato.VERSION
        dato["revision"] = sha256_json({k: v for k, v in dato.items() if k != "revision"})
        contrato.validar_publico(dato)

    def test_la_entrega_rechaza_un_bloque_que_incumple_el_contrato(self) -> None:
        """La validación de la entrega aplica todas las reglas del bloque."""
        entrega = entrega_v6()
        for caso in EJEMPLOS["invalidos"][:3]:
            with self.subTest(caso["caso"]), self.assertRaises(ValueError):
                contrato.validar_publico(con_clasificacion(entrega, contrato.VERSION, caso["bloque"]))

    def test_el_esquema_publico_declara_los_mismos_vocabularios(self) -> None:
        """El esquema documentado y la validación usan las mismas listas cerradas."""
        esquema = json.loads(ESQUEMA.read_bytes())
        definiciones = esquema["$defs"]
        self.assertEqual(esquema["properties"]["schema_version"]["enum"], [4, 5, 6, 7])
        self.assertEqual(set(definiciones["clasificacion"]["properties"]), set(clasificacion.VOCABULARIOS))
        for nombre, vocabulario in clasificacion.VOCABULARIOS.items():
            dato = definiciones["dato_" + nombre]
            campo = clasificacion.campo_de_valor(nombre)
            self.assertEqual(set(dato["required"]), {campo, *clasificacion.CAMPOS_DATO})
            admitido = dato["properties"][campo]["anyOf"][1]
            self.assertEqual(admitido.get("enum") or admitido["items"]["enum"], list(vocabulario))
            propiedades = dato["properties"]
            self.assertEqual(propiedades["estado"]["enum"], list(clasificacion.ESTADOS))
            self.assertEqual(propiedades["alcance"]["enum"], [None, *clasificacion.ALCANCES])
            self.assertEqual(propiedades["certeza"]["enum"], [None, *clasificacion.CERTEZAS])
            self.assertEqual(propiedades["motivo_por_confirmar"]["enum"], [None, *clasificacion.MOTIVOS_POR_CONFIRMAR])
        evidencia = definiciones["evidencia_clasificacion"]
        self.assertEqual(evidencia["required"], list(clasificacion.CAMPOS_EVIDENCIA))
        self.assertEqual(definiciones["regla_clasificacion"]["required"], list(clasificacion.CAMPOS_REGLA))


if __name__ == "__main__":
    unittest.main()
