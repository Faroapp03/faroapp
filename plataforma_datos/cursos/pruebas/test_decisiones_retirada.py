"""El registro `decisiones-retirada`: un archivo inmutable por lectura, cerrado y leído de forma estricta."""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos import decisiones_retirada as registro_
from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.decisiones_retirada import (
    ErrorDecisiones,
    cargar_registro,
    construir_registro,
    guardar_registro,
    leer_registro,
    validar_registro,
)
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.pruebas.ejemplos_retirada import CURSO, cadena, huella
from plataforma_datos.cursos.retirada_por_evidencia import (
    ComprobacionPagina,
    Curso,
    Decision,
    decidir,
    regla_de_retirada,
)

FUENTE, AMBITO = "barcelonactiva", "cibernarium:edicion"


def decisiones_del_dia() -> tuple[dict, list[Decision]]:
    """Una lectura con un curso retirado, uno pendiente y uno que se mantiene.

    Returns:
        La última lectura de la cadena y las tres decisiones.
    """
    lecturas = cadena("1110")
    no_existe = ComprobacionPagina(veredicto="no_existe", pedido_utc="2026-11-15T09:00:00Z", sha256=huella("ficha"))
    retirado = decidir(Curso(id=CURSO, fuente=FUENTE, ambito=AMBITO), lecturas, [no_existe])
    pendiente = decidir(Curso(id=CURSO, fuente=FUENTE, ambito=AMBITO), lecturas)
    mantenido = decidir(Curso(id="cibernarium:edicion:40187", fuente=FUENTE, ambito=AMBITO), lecturas)
    pendiente = Decision(
        curso="cibernarium:edicion:40099", decision="pendiente", evidencias=pendiente.evidencias, regla=pendiente.regla
    )
    return lecturas[-1], [retirado, mantenido, pendiente]


class Construccion(unittest.TestCase):
    """Solo se registran las retiradas y los pendientes; los mantenidos se cuentan."""

    def test_registra_lo_que_no_se_mantiene_y_cuenta_lo_que_si(self) -> None:
        """Guarda el retirado y el pendiente, cuenta el mantenido y se lee igual desde sus bytes."""
        lectura, decisiones = decisiones_del_dia()
        registro = construir_registro(lectura, regla_de_retirada(), decisiones)
        self.assertEqual([d["curso"] for d in registro["decisiones"]], ["cibernarium:edicion:40099", CURSO])
        self.assertEqual([d["decision"] for d in registro["decisiones"]], ["pendiente", "retirar"])
        self.assertEqual(registro["mantenidas"], 1)
        self.assertEqual((registro["fuente"], registro["lectura_id"]), (FUENTE, lectura["lectura_id"]))
        self.assertEqual(leer_registro(bytes_de(registro)), registro)

    def test_una_decision_de_otra_regla_se_rechaza(self) -> None:
        """Todas las decisiones de un registro las firma la misma regla."""
        lectura, decisiones = decisiones_del_dia()
        otra = Regla(id="retirada-por-evidencia", version=1, sha256=huella("otra"))
        with self.assertRaises(ErrorDecisiones):
            construir_registro(lectura, otra, decisiones)

    def test_un_curso_repetido_se_rechaza(self) -> None:
        """Un curso no se decide dos veces en la misma lectura."""
        lectura, decisiones = decisiones_del_dia()
        with self.assertRaises(ErrorDecisiones):
            construir_registro(lectura, regla_de_retirada(), [*decisiones, decisiones[0]])


class LecturaEstricta(unittest.TestCase):
    """Un registro mal formado o incoherente no se lee como válido."""

    def setUp(self) -> None:
        """Prepara un registro válido para estropearlo en cada caso."""
        lectura, decisiones = decisiones_del_dia()
        self.registro = construir_registro(lectura, regla_de_retirada(), decisiones)

    def rechaza(self, registro: dict) -> None:
        """Comprueba que la validación rechaza el registro."""
        with self.assertRaises(ErrorDecisiones):
            validar_registro(registro)

    def test_campo_de_mas_y_mantener_registrado_se_rechazan(self) -> None:
        """El contrato es cerrado y no registra los mantenidos uno a uno."""
        self.rechaza({**self.registro, "notas": "x"})
        decision = {**self.registro["decisiones"][0], "decision": "mantener"}
        self.rechaza({**self.registro, "decisiones": [decision]})

    def test_decisiones_incoherentes_con_sus_evidencias_se_rechazan(self) -> None:
        """Un pendiente que bastaría para retirar o una retirada con una sola ausencia se rechazan."""
        retirada = self.registro["decisiones"][1]
        self.rechaza(
            {**self.registro, "decisiones": [self.registro["decisiones"][0], {**retirada, "decision": "pendiente"}]}
        )
        solo_censo = {**retirada, "evidencias": retirada["evidencias"][:1]}
        self.rechaza({**self.registro, "decisiones": [self.registro["decisiones"][0], solo_censo]})

    def test_evidencias_fuera_de_orden_o_de_su_grupo_se_rechazan(self) -> None:
        """Las evidencias van en orden canónico y con un canal de su grupo."""
        retirada = self.registro["decisiones"][1]
        al_reves = {**retirada, "evidencias": list(reversed(retirada["evidencias"]))}
        self.rechaza({**self.registro, "decisiones": [self.registro["decisiones"][0], al_reves]})
        fuera = {**retirada["evidencias"][0], "canal": "no_existe"}
        mal_canal = {**retirada, "evidencias": [fuera, retirada["evidencias"][1]]}
        self.rechaza({**self.registro, "decisiones": [self.registro["decisiones"][0], mal_canal]})

    def test_bytes_no_canonicos_clave_repetida_y_nan_se_rechazan(self) -> None:
        """Solo se leen los bytes canónicos exactos en UTF-8."""
        canonico = bytes_de(self.registro)
        with self.assertRaises(ErrorDecisiones):
            leer_registro(json.dumps(self.registro, indent=1).encode())
        with self.assertRaises(ErrorDecisiones):
            leer_registro(canonico.replace(b'{"ambito"', b'{"ambito":"otro","ambito"', 1))
        with self.assertRaises(ErrorDecisiones):
            leer_registro(canonico.replace(b'"mantenidas":1', b'"mantenidas":NaN', 1))
        with self.assertRaises(ErrorDecisiones):
            leer_registro(b"\xff")


class Almacen(unittest.TestCase):
    """Un archivo por lectura en `validados/<fuente>/decisiones/`; lo guardado no cambia."""

    def test_guardar_es_idempotente_y_otro_registro_para_la_misma_lectura_falla(self) -> None:
        """Guardar lo mismo no cambia nada y otro registro para la misma lectura no lo sustituye."""
        lectura, decisiones = decisiones_del_dia()
        registro = construir_registro(lectura, regla_de_retirada(), decisiones)
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            ruta = guardar_registro(raiz, registro)
            self.assertEqual(ruta.parent.name, registro_.CARPETA)
            self.assertEqual(ruta.parent.parent.name, FUENTE)
            self.assertEqual(ruta.name, f"{lectura['lectura_id']}.json")
            self.assertEqual(guardar_registro(raiz, registro), ruta)
            otro = construir_registro(lectura, regla_de_retirada(), decisiones[:1])
            with self.assertRaises(ErrorDecisiones):
                guardar_registro(raiz, otro)
            self.assertEqual(ruta.read_bytes(), bytes_de(registro))
            self.assertEqual(cargar_registro(raiz, FUENTE, lectura["lectura_id"]), registro)

    def test_cargar_un_registro_que_no_existe_falla(self) -> None:
        """Cargar el registro de una lectura sin decisiones guardadas es un error."""
        with tempfile.TemporaryDirectory() as carpeta, self.assertRaises(ErrorDecisiones):
            cargar_registro(Path(carpeta), FUENTE, huella("nada"))


if __name__ == "__main__":
    unittest.main()
