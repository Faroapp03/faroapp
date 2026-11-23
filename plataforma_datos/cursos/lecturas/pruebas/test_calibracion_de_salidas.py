"""Cuántas salidas sin explicar son normales lo dice la historia de cada fuente: regla `salud-lectura` versión 2."""

import dataclasses
import json
import math
import random
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas import contrato_lectura as contrato
from plataforma_datos.cursos.lecturas.calibracion_de_salidas import PARAMETROS, calibrar, techo_de
from plataforma_datos.cursos.lecturas.contrato_lectura import ErrorLectura
from plataforma_datos.cursos.lecturas.emision import Censo, emitir_lectura
from plataforma_datos.cursos.lecturas.historia_de_salidas import HistoriaDeSalidas, historia_de_salidas
from plataforma_datos.cursos.lecturas.pruebas import ejemplos
from plataforma_datos.cursos.lecturas.pruebas.historias import AMBITO, FUENTE, Historia, cursos, historia_diaria, hora
from plataforma_datos.cursos.lecturas.salud import Observacion, calificar
from plataforma_datos.cursos.pruebas.test_tasa_de_poisson import cola_por_suma, gamma_de_forma_semientera

DIA = 86_400
DIA_DE_LA_LECTURA_ROTA = 8
SEMILLA = 20261122
ESQUEMA = Path(contrato.__file__).with_name("lectura_fuente.json")


def poisson(azar: random.Random, media: float) -> int:
    """Un recuento de Poisson por el método de Knuth, con el generador dado.

    Returns:
        El recuento.
    """
    umbral, recuento, producto = math.exp(-media), 0, azar.random()
    while producto > umbral:
        recuento += 1
        producto *= azar.random()
    return recuento


class SueloPruebas(unittest.TestCase):
    """Sin historia suficiente vale el umbral fijo de siempre."""

    def test_historia_vacia_y_corta_vale_el_suelo(self) -> None:
        """Una primera lectura y una fuente con cinco días de lecturas usan el suelo y no estiman ritmo."""
        historia = Historia()
        primera = historia.leer(hora(1), cursos(0, 500))
        self.assertEqual(primera["calibracion"]["origen"], "suelo")
        self.assertEqual(primera["calibracion"]["limite"], 3)
        corta = historia_diaria(6)
        calibracion = corta.veredictos[-1].calibracion
        self.assertEqual((calibracion.origen, calibracion.limite, calibracion.cota), ("suelo", 10, None))

    def test_una_lectura_incompleta_no_lleva_calibracion(self) -> None:
        """Lo incompleto no se juzga: no hay límite que aplicar ni que guardar."""
        historia = historia_diaria(3)
        dato = historia.leer(hora(4), cursos(0, 100), completa=False)
        self.assertEqual(dato["estado"], "incompleta")
        self.assertNotIn("calibracion", dato)


class HistoriaPruebas(unittest.TestCase):
    """El límite sale de las salidas que la historia confirma, por su exposición."""

    def test_salidas_confirmadas_suben_el_limite_lo_justo(self) -> None:
        """Cinco salidas confirmadas al día en 500 cursos: el límite es el de la cota de Jeffreys, ni uno más."""
        historia = historia_diaria(15)
        resumen = historia_de_salidas(historia.lecturas)
        self.assertEqual((resumen.lecturas, resumen.confirmadas, resumen.desmentidas), (13, 65, 0))
        self.assertEqual(resumen.exposicion, 13 * DIA * 500)
        calibracion = historia.calificar(historia.observacion(hora(16), historia.censo)).calibracion
        self.assertEqual(calibracion.origen, "historia")
        cota = calibracion.cota / DIA
        self.assertAlmostEqual(gamma_de_forma_semientera(65, cota * resumen.exposicion), 0.975, places=9)
        media = cota * DIA * 500
        self.assertLessEqual(cola_por_suma(calibracion.limite, media), 0.001)
        self.assertGreater(cola_por_suma(calibracion.limite - 1, media), 0.001)
        self.assertGreater(calibracion.limite, 10)
        self.assertLess(calibracion.limite, techo_de(10, 500))

    def test_una_lectura_rota_y_desmentida_no_sube_el_limite(self) -> None:
        """Cien cursos que faltan un día y vuelven al siguiente se desmienten y no cambian el límite."""
        sana, rota = Historia(), Historia()
        censo, siguiente = cursos(0, 500), 500
        for dia in range(1, 16):
            if dia > 1:
                censo = (censo - set(sorted(censo)[:5])) | cursos(siguiente, 5)
                siguiente += 5
            sana.leer(hora(dia), censo)
            # Faltan cien cursos que ya estaban la víspera: la lectura los da por salidos y al día siguiente vuelven.
            rota.leer(hora(dia), censo - set(sorted(censo)[200:300]) if dia == DIA_DE_LA_LECTURA_ROTA else censo)
        self.assertEqual(rota.lecturas[7]["estado"], "anomala")
        resumen = historia_de_salidas(rota.lecturas)
        self.assertEqual((resumen.confirmadas, resumen.desmentidas), (65, 100))
        nueva = rota.observacion(hora(16), censo)
        self.assertEqual(
            rota.calificar(nueva).calibracion.limite,
            sana.calificar(sana.observacion(hora(16), censo)).calibracion.limite,
        )

    def test_el_techo_se_respeta(self) -> None:
        """Una fuente que pierde el 9 % cada día no enseña que eso es normal: el límite se queda en el 8 % del bruto."""
        historia = historia_diaria(15, salen_al_dia=45)
        censo = (historia.censo - set(sorted(historia.censo)[:45])) | cursos(10_000, 45)
        veredicto = historia.calificar(historia.observacion(hora(16), censo))
        self.assertEqual((veredicto.calibracion.origen, veredicto.calibracion.limite), ("techo", 40))
        self.assertEqual(veredicto.estado, "anomala")

    def test_la_exposicion_cuenta_el_tiempo_entre_lecturas(self) -> None:
        """Tres días sin lectura admiten más salidas que uno; leer cada dos días da el mismo ritmo por día."""
        historia = historia_diaria(15)
        un_dia = historia.calificar(historia.observacion(hora(16), historia.censo)).calibracion
        tres_dias = historia.calificar(historia.observacion(hora(18), historia.censo)).calibracion
        self.assertEqual(tres_dias.exposicion, 3 * un_dia.exposicion)
        self.assertGreater(tres_dias.limite, un_dia.limite)
        cada_dos = Historia()
        censo, siguiente = cursos(0, 500), 500
        for dia in range(1, 30, 2):
            if dia > 1:
                censo = (censo - set(sorted(censo)[:10])) | cursos(siguiente, 10)
                siguiente += 10
            cada_dos.leer(f"2026-10-{dia:02d}T06:00:00Z", censo)
        resumen = historia_de_salidas(cada_dos.lecturas)
        self.assertAlmostEqual(resumen.confirmadas / resumen.exposicion, 5 / (500 * DIA), places=15)

    def test_la_dispersion_entre_dias_ensancha_el_limite(self) -> None:
        """Mismas salidas en total, pero repartidas de forma desigual: el límite crece con la dispersión medida."""
        llana = HistoriaDeSalidas(
            lecturas=10, confirmadas=50, segundos=10 * DIA, exposicion=10 * DIA * 500, tramos=((5, DIA * 500),) * 10
        )
        desigual = dataclasses.replace(llana, tramos=((0, DIA * 500),) * 5 + ((10, DIA * 500),) * 5)
        comun = {"sin_explicar": 0, "suelo": 10, "techo": 40, "exposicion": DIA * 500}
        self.assertEqual(calibrar(historia=llana, **comun).dispersion, 1.0)
        self.assertGreater(calibrar(historia=desigual, **comun).dispersion, 1.0)
        self.assertGreater(calibrar(historia=desigual, **comun).limite, calibrar(historia=llana, **comun).limite)


class CibernariumPruebas(unittest.TestCase):
    """Las cifras reales de las ediciones de Cibernàrium: 25/10, 15/11 (la lectura mala) y 18/11."""

    def test_la_del_15_11_sigue_anomala_y_la_del_18_11_sana(self) -> None:
        """Con dos lecturas de historia no hay ritmo que estimar: vale el suelo de 13 y sale lo de siempre."""
        historia = Historia()
        inicial = cursos(0, 616)
        historia.leer("2026-10-25T05:10:00Z", inicial)
        salen = sorted(inicial)[:190]
        con_fin = frozenset(salen[:175])
        quince = (inicial - set(salen)) | cursos(1000, 40)
        mala = historia.leer("2026-11-15T05:10:00Z", quince, explicadas=con_fin)
        vuelven = set(salen[175:182])
        salen_18 = sorted(quince)[:34]
        dieciocho = (quince - set(salen_18)) | vuelven | cursos(2000, 34)
        buena = historia.leer("2026-11-18T05:10:00Z", dieciocho, explicadas=frozenset(salen_18[:26]))
        self.assertEqual((mala["estado"], mala["calibracion"]["sin_explicar"]), ("anomala", 15))
        self.assertEqual((buena["estado"], buena["calibracion"]["sin_explicar"]), ("sana", 8))
        self.assertEqual(len(dieciocho), 473)
        for dato in (mala, buena):
            self.assertEqual((dato["calibracion"]["origen"], dato["calibracion"]["limite"]), ("suelo", 13))


class VersionAnteriorPruebas(unittest.TestCase):
    """Una lectura guardada con la versión 1 sigue siendo legible y sirve de historia."""

    def test_la_version_anterior_se_lee_y_conserva_su_identificador(self) -> None:
        """La lectura v1 no lleva calibración, se lee de sus bytes y la misma observación conserva su identificador."""
        primera, segunda = ejemplos.primera().a_json(), ejemplos.segunda().a_json()
        self.assertNotIn("calibracion", segunda)
        self.assertEqual(contrato.leer_lectura(contrato.bytes_de(segunda)), segunda)
        observado = {
            campo.name: segunda[campo.name] for campo in dataclasses.fields(Observacion) if campo.name in segunda
        }
        observado["salidas"] = tuple(contrato.Salida(**s) for s in segunda["salidas"])
        observado["entradas"] = tuple(segunda["entradas"])
        observado["huella_forma"] = ejemplos.forma()
        observacion = Observacion(**observado)
        veredicto = calificar(observacion, primera, previas=[primera])
        dato = observacion.lectura(veredicto).a_json()
        self.assertEqual(dato["lectura_id"], segunda["lectura_id"])
        self.assertEqual((dato["regla"]["version"], dato["calibracion"]["origen"]), (2, "suelo"))


class ContratoPruebas(unittest.TestCase):
    """El contrato exige una calibración cerrada y coherente con las salidas y con el motivo."""

    def setUp(self) -> None:
        """Una lectura calibrada por la historia."""
        historia = historia_diaria(15)
        self.dato = historia.lecturas[-1]
        self.assertEqual(self.dato["calibracion"]["origen"], "historia")

    def test_una_calibracion_incoherente_se_rechaza(self) -> None:
        """Otro límite, otro recuento, un origen inventado o una dispersión menor que 1 no pasan."""
        for campo, valor, mensaje in (
            ("limite", 2, "motivo de salidas en bloque"),
            ("sin_explicar", 4, "no cuenta las salidas"),
            ("origen", "a_mano", "origen del límite"),
            ("dispersion", 0.5, "menor que la de Poisson"),
            ("techo", 1, "techo queda por debajo"),
        ):
            with self.subTest(campo=campo):
                cambiada = json.loads(json.dumps(self.dato))
                cambiada["calibracion"][campo] = valor
                with self.assertRaisesRegex(ErrorLectura, mensaje):
                    contrato.validar_lectura(cambiada)
        incompleta = {**self.dato, "completa": False, "motivo_incompleta": "consulta_fallida", "estado": "incompleta"}
        with self.assertRaises(ErrorLectura):
            contrato.validar_lectura(incompleta)

    def test_esquema_describe_la_calibracion(self) -> None:
        """El esquema publicado lista exactamente los campos de la calibración y no la exige."""
        esquema = json.loads(ESQUEMA.read_text(encoding="utf-8"))
        definicion = esquema["$defs"]["calibracion"]
        self.assertEqual(definicion["required"], list(contrato.CAMPOS_CALIBRACION))
        self.assertFalse(definicion["additionalProperties"])
        self.assertEqual(definicion["properties"]["origen"]["enum"], list(contrato.ORIGENES_DEL_LIMITE))
        self.assertNotIn("calibracion", esquema["required"])


class EmisionPruebas(unittest.TestCase):
    """La emisión pasa a la regla la historia del almacén: sin ella la calibración no saldría nunca del suelo."""

    def test_la_emision_calibra_con_las_lecturas_guardadas(self) -> None:
        """Once días de lecturas guardadas: la última lleva un límite que sale de la historia."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz, censo, siguiente = Path(carpeta), cursos(0, 300), 300
            for dia in range(1, 12):
                if dia > 1:
                    censo = (censo - set(sorted(censo)[:3])) | cursos(siguiente, 3)
                    siguiente += 3
                emision = emitir_lectura(
                    raiz,
                    Censo(
                        fuente=FUENTE,
                        ambito=AMBITO,
                        observado_utc=hora(dia),
                        completa=True,
                        ids=censo,
                        recuento_bruto=len(censo),
                        recuento_vigente=len(censo),
                        niveles=("edicion",),
                        rutas_de_campos=("edicion.fin", "edicion.id"),
                        explicar_salida=lambda _curso: None,
                    ),
                )
            self.assertEqual(emision.lectura["calibracion"]["origen"], "historia")
            self.assertEqual(emision.lectura["calibracion"]["confirmadas"], 3 * 8)


class SimulacionPruebas(unittest.TestCase):
    """Con un ritmo conocido, la regla no avisa más de lo declarado y no deja pasar una caída del 10 %."""

    def test_falsas_alarmas_por_debajo_de_lo_declarado_y_caida_del_diez_por_ciento(self) -> None:
        """5.000 fuentes simuladas de 500 cursos con un 1 % diario de salidas y dos semanas de historia."""
        azar, bruto, ritmo, ensayos = random.Random(SEMILLA), 500, 0.01, 5000
        suelo = 10
        alarmas = 0
        for _ in range(ensayos):
            tramos = tuple((poisson(azar, ritmo * bruto), DIA * bruto) for _ in range(14))
            historia = HistoriaDeSalidas(
                lecturas=14,
                confirmadas=sum(k for k, _ in tramos),
                segundos=14 * DIA,
                exposicion=14 * DIA * bruto,
                tramos=tramos,
            )
            hoy = poisson(azar, ritmo * bruto)
            comun = {"suelo": suelo, "techo": techo_de(suelo, bruto), "historia": historia, "exposicion": DIA * bruto}
            calibracion = calibrar(sin_explicar=hoy, **comun)
            alarmas += calibracion.sin_explicar > calibracion.limite
            caida = calibrar(sin_explicar=hoy + bruto // 10, **comun)
            self.assertGreater(caida.sin_explicar, caida.limite)
        self.assertLessEqual(alarmas / ensayos, PARAMETROS.probabilidad_de_falsa_alarma)


if __name__ == "__main__":
    unittest.main()
