"""La medida del error de retirada: qué cuenta como error, qué es comprobable y qué se dice con ello."""

import random
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.decisiones_retirada import construir_registro, guardar_registro
from plataforma_datos.cursos.error_de_retirada import GRUPOS, NATURALEZA, ErrorDeMedida, medir_error
from plataforma_datos.cursos.intervalo_de_jeffreys import intervalo_de_jeffreys
from plataforma_datos.cursos.lectura_error_de_retirada import fuentes_con_lecturas, medir_error_guardado
from plataforma_datos.cursos.lecturas.almacen_lecturas import carpeta_de_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.pruebas.ejemplos_retirada import CURSO, cadena, huella
from plataforma_datos.cursos.retirada_por_evidencia import (
    ComprobacionPagina,
    Curso,
    Declaracion,
    decidir,
    regla_de_retirada,
)

HORAS = tuple(f"2026-11-{dia:02d}T05:00:00Z" for dia in range(10, 18))
SIN_PAGINA = ("formacion", "formacion:oferta")
OTRO_AMBITO = ("formacion", "formacion:otra")
CON_PAGINA = ("barcelonactiva", "cibernarium:edicion")


def lecturas_de(patron: str, ambito: tuple[str, str] = SIN_PAGINA, **opciones: object) -> list[dict]:
    """La cadena de lecturas de un curso con ese patrón de presencia, en días consecutivos.

    Returns:
        Las lecturas tal como las guarda el almacén.
    """
    return cadena(patron, ambito=ambito, horas=HORAS, **opciones)


def registros_de(
    lecturas: list[dict], comprobaciones: tuple[ComprobacionPagina, ...] = (), *, desde: int = 0
) -> list[dict]:
    """Los registros de decisiones que la regla real habría guardado tras cada lectura, desde la posición `desde`.

    Returns:
        Un registro por lectura, con el curso decidido con lo que se sabía hasta entonces.
    """
    ambito = lecturas[0]["ambito"]
    curso = Curso(id=CURSO, fuente=lecturas[0]["fuente"], ambito=ambito)
    return [
        construir_registro(
            lecturas[posicion],
            regla_de_retirada(),
            [decidir(curso, lecturas[: posicion + 1], comprobaciones)],
        )
        for posicion in range(desde, len(lecturas))
    ]


def medir(patron: str, **opciones: object) -> dict:
    """Mide un solo curso con ese patrón de presencia en una fuente sin canal de página.

    Returns:
        La fila de su fuente.
    """
    lecturas = lecturas_de(patron, **opciones)
    (fila,) = medir_error(registros_de(lecturas), lecturas)
    return fila


def grupo(fila: dict, nombre: str) -> dict:
    """La parte de una fila que corresponde a un grupo.

    Returns:
        Los recuentos de ese grupo.
    """
    return next(parte for parte in fila["por_grupo"] if parte["grupo"] == nombre)


class QueEsUnError(unittest.TestCase):
    """Reaparecer en una lectura sana posterior es un error; lo demás, no."""

    def test_retirado_que_reaparece_en_la_lectura_sana_siguiente_es_un_error(self) -> None:
        """Dos ausencias sanas retiran y la lectura siguiente lo trae de vuelta: un error de uno comprobado."""
        fila = medir("11001")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (1, 1, 1))
        self.assertEqual(fila["tasa"], 1.0)
        self.assertEqual(fila["cota95"], intervalo_de_jeffreys(1, 1)[1])

    def test_reaparece_solo_en_una_lectura_anomala_no_cuenta(self) -> None:
        """Una presencia en una lectura anómala no es una observación: no hay error ni lectura posterior sana."""
        fila = medir("11001", estados="ssssa")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (1, 0, 0))
        self.assertIsNone(fila["tasa"])
        self.assertIsNone(fila["cota95"])

    def test_reaparece_solo_en_una_lectura_incompleta_o_reconstruida_no_cuenta(self) -> None:
        """Ni una lectura incompleta ni una reconstruida sirven de observación."""
        for letra in "ir":
            with self.subTest(estado=letra):
                fila = medir("11001", estados="ssss" + letra)
                self.assertEqual((fila["con_lectura_posterior"], fila["reaparecidas"]), (0, 0))

    def test_una_lectura_sana_posterior_sin_el_curso_lo_hace_comprobable_sin_error(self) -> None:
        """Si el curso reaparece solo en una lectura anómala y luego falta en una sana, es comprobable y no es error."""
        fila = medir("110010", estados="ssssas")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (1, 1, 0))

    def test_sin_lectura_posterior_no_es_comprobable(self) -> None:
        """Retirado en la última lectura: cuenta como retirada pero no hay con qué comprobarlo."""
        fila = medir("1100")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (1, 0, 0))
        self.assertIsNone(fila["tasa"])
        self.assertIsNone(fila["cota95"])

    def test_la_ausencia_repetida_cuenta_una_sola_retirada(self) -> None:
        """Las decisiones de los días siguientes, con el curso aún ausente, son la misma retirada."""
        fila = medir("110000")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (1, 1, 0))

    def test_retirado_que_vuelve_y_se_retira_de_nuevo_son_dos_retiradas(self) -> None:
        """El error de la primera no oculta la segunda, que aún no es comprobable."""
        fila = medir("1100100")
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (2, 1, 1))

    def test_retirar_en_lecturas_seguidas_con_el_curso_listado_es_una_sola_retirada(self) -> None:
        """La fuente sigue listando un curso con su fin pasado: tres registros dicen retirar y es una sola retirada."""
        lecturas = lecturas_de("111")
        registros = []
        for posicion, lectura in enumerate(lecturas):
            fin = Declaracion(
                lectura_id=lectura["lectura_id"], canal="fin_publicado", sha256=huella("fin"), cierra_el=HORAS[0]
            )
            curso = Curso(id=CURSO, fuente=lectura["fuente"], ambito=lectura["ambito"], declaraciones=(fin,))
            decision = decidir(curso, lecturas[: posicion + 1])
            self.assertEqual(decision.decision, "retirar")
            registros.append(construir_registro(lectura, regla_de_retirada(), [decision]))
        (fila,) = medir_error(registros, lecturas)
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"]), (1, 1))


class QueSeDice(unittest.TestCase):
    """Con cero errores se da la cota, no un cero; sin comprobables, nada."""

    def test_cero_errores_da_la_cota_y_no_un_cero_por_ciento(self) -> None:
        """Una retirada comprobada sin error: la tasa no se da y la cota es la de Jeffreys de 0 en 1."""
        fila = medir("110000")
        self.assertIsNone(fila["tasa"])
        self.assertEqual(fila["cota95"], intervalo_de_jeffreys(0, 1)[1])
        self.assertGreater(fila["cota95"], 0.5)

    def test_es_un_limite_inferior(self) -> None:
        """Cada fila lo declara."""
        self.assertEqual(medir("110000")["naturaleza"], NATURALEZA)
        self.assertEqual(NATURALEZA, "limite_inferior")

    def test_fuente_sin_retiradas_no_tiene_tasa(self) -> None:
        """Una fuente sin retiradas sale con ceros, sin tasa y sin cota: nunca un 0 %."""
        lecturas = lecturas_de("11111")
        (fila,) = medir_error(registros_de(lecturas), lecturas)
        self.assertEqual((fila["retiradas"], fila["con_lectura_posterior"], fila["reaparecidas"]), (0, 0, 0))
        self.assertIsNone(fila["tasa"])
        self.assertIsNone(fila["cota95"])

    def test_fuente_sin_registros_sale_igual(self) -> None:
        """Con lecturas y sin ningún registro de decisiones la fuente aparece, sin retiradas."""
        (fila,) = medir_error([], lecturas_de("11001"))
        self.assertEqual((fila["fuente"], fila["retiradas"]), ("formacion", 0))


class PorGrupo(unittest.TestCase):
    """Cada grupo que decide una retirada tiene su propia cuenta."""

    def test_cada_retirada_va_a_su_grupo(self) -> None:
        """Una retirada por fin publicado (con error), una por dos ausencias (sin error) y otra por censo y página."""
        por_fuente = lecturas_de("11101", explicaciones={3: "fin_publicado"})
        por_censo = lecturas_de("110000", ambito=OTRO_AMBITO)
        pagina = (ComprobacionPagina(veredicto="no_existe", pedido_utc="2026-11-13T09:00:00Z", sha256=huella("f")),)
        con_pagina = lecturas_de("1110", ambito=CON_PAGINA)
        registros = [
            *registros_de(por_fuente),
            *registros_de(por_censo),
            *registros_de(con_pagina, pagina),
        ]
        filas = medir_error(registros, [*por_fuente, *por_censo, *con_pagina])
        self.assertEqual([fila["fuente"] for fila in filas], ["barcelonactiva", "formacion"])
        formacion = next(fila for fila in filas if fila["fuente"] == "formacion")
        self.assertEqual(
            [(grupo(formacion, g)["retiradas"], grupo(formacion, g)["reaparecidas"]) for g in GRUPOS],
            [(1, 1), (0, 0), (1, 0)],
        )
        self.assertEqual((formacion["retiradas"], formacion["reaparecidas"]), (2, 1))
        self.assertEqual(grupo(formacion, "fuente")["tasa"], 1.0)
        self.assertIsNone(grupo(formacion, "censo_repetido")["tasa"])
        self.assertEqual(grupo(formacion, "censo_repetido")["cota95"], intervalo_de_jeffreys(0, 1)[1])
        self.assertIsNone(grupo(formacion, "censo_y_pagina")["cota95"])
        ciber = next(fila for fila in filas if fila["fuente"] == "barcelonactiva")
        self.assertEqual(grupo(ciber, "censo_y_pagina")["retiradas"], 1)
        self.assertEqual(grupo(ciber, "censo_y_pagina")["con_lectura_posterior"], 0)

    def test_los_grupos_suman_la_fuente(self) -> None:
        """Los recuentos por grupo suman los de la fuente."""
        fila = medir("1100100")
        for campo in ("retiradas", "con_lectura_posterior", "reaparecidas"):
            self.assertEqual(sum(parte[campo] for parte in fila["por_grupo"]), fila[campo])


class DatosQueNoCuadran(unittest.TestCase):
    """Lo que no se puede comprobar no se usa y se dice; lo que se contradice se rechaza."""

    def test_una_lectura_que_falta_deja_sin_censo_a_las_que_cuelgan_de_ella(self) -> None:
        """Sin la lectura intermedia no se rehace el censo: nada se mide con él y se cuenta aparte."""
        lecturas = lecturas_de("11001")
        perdida = lecturas[2]["lectura_id"]
        registros = [r for r in registros_de(lecturas) if r["lectura_id"] != perdida]
        (fila,) = medir_error(registros, [lectura for lectura in lecturas if lectura["lectura_id"] != perdida])
        self.assertEqual((fila["con_lectura_posterior"], fila["reaparecidas"]), (0, 0))
        self.assertEqual(fila["lecturas_sin_censo"], 2)

    def test_un_registro_de_una_lectura_que_no_esta_se_rechaza(self) -> None:
        """Una decisión que cita una lectura ausente no tiene dónde ponerse."""
        lecturas = lecturas_de("11001")
        with self.assertRaises(ErrorDeMedida):
            medir_error(registros_de(lecturas), lecturas[:3])

    def test_un_registro_de_otro_ambito_se_rechaza(self) -> None:
        """El registro debe ser de la fuente y el ámbito de su lectura."""
        lecturas = lecturas_de("11001")
        registro = registros_de(lecturas)[3]
        with self.assertRaises(ErrorDeMedida):
            medir_error([{**registro, "ambito": "formacion:otra"}], lecturas)


class Determinismo(unittest.TestCase):
    """El resultado no depende del orden en que llegan las lecturas ni los registros."""

    def test_el_orden_de_entrada_no_cambia_la_medida(self) -> None:
        """Mezclar lecturas y registros da la misma fila."""
        lecturas = lecturas_de("1100100")
        registros = registros_de(lecturas)
        esperado = medir_error(registros, lecturas)
        azar = random.Random(7)
        for _ in range(10):
            azar.shuffle(lecturas)
            azar.shuffle(registros)
            self.assertEqual(medir_error(registros, lecturas), esperado)


class LecturaDelAlmacen(unittest.TestCase):
    """La función de acceso lee el almacén sin escribir nada y da lo mismo que la función pura."""

    def preparar(self, raiz: Path, lecturas: list[dict], registros: list[dict]) -> None:
        """Deja las lecturas y los registros en el almacén de una instalación de prueba."""
        for lectura in lecturas:
            carpeta = carpeta_de_lecturas(raiz, lectura["fuente"])
            carpeta.mkdir(parents=True, exist_ok=True)
            (carpeta / f"{lectura['lectura_id']}.json").write_bytes(bytes_de(lectura))
        for registro in registros:
            guardar_registro(raiz, registro)

    def test_da_lo_mismo_que_la_funcion_pura_y_no_escribe(self) -> None:
        """Mide lo guardado, ignora las lecturas sin registro y deja el almacén como estaba."""
        lecturas = lecturas_de("11001")
        registros = registros_de(lecturas, desde=2)
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            self.preparar(raiz, lecturas, registros)
            antes = sorted((ruta.relative_to(raiz), ruta.read_bytes()) for ruta in raiz.rglob("*") if ruta.is_file())
            self.assertEqual(fuentes_con_lecturas(raiz), ["formacion"])
            self.assertEqual(medir_error_guardado(raiz), medir_error(registros, lecturas))
            despues = sorted((ruta.relative_to(raiz), ruta.read_bytes()) for ruta in raiz.rglob("*") if ruta.is_file())
            self.assertEqual(antes, despues)

    def test_una_instalacion_vacia_no_da_filas(self) -> None:
        """Sin carpeta de lecturas no hay nada que medir."""
        with tempfile.TemporaryDirectory() as carpeta:
            self.assertEqual(medir_error_guardado(Path(carpeta)), [])


if __name__ == "__main__":
    unittest.main()
