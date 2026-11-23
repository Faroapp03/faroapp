"""El contrato `lectura-fuente`: lo que se construye es lo que se valida, y la lectura estricta rechaza lo ajeno."""

import copy
import json
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas import contrato_lectura as contrato
from plataforma_datos.cursos.lecturas.contrato_lectura import ErrorLectura, HuellaForma, Salida, ValorNuevo
from plataforma_datos.cursos.lecturas.pruebas import ejemplos

ESQUEMA = Path(contrato.__file__).with_name("lectura_fuente.json")


def con_identificador(dato: dict) -> dict:
    """Recalcula el identificador para que la prueba ejercite la regla que quiere y no la huella.

    Returns:
        La lectura con `lectura_id` coherente con lo observado.
    """
    dato["lectura_id"] = contrato.identificador_de(dato)
    return dato


class ContratoLecturaPruebas(unittest.TestCase):
    """Construcción, serialización canónica y rechazos con un mensaje que dice qué falla."""

    def rechaza(self, dato: dict, mensaje: str) -> None:
        """Comprueba que la lectura estricta rechaza esos bytes con ese mensaje."""
        with self.assertRaisesRegex(ErrorLectura, mensaje):
            contrato.leer_lectura(contrato.bytes_de(dato))

    def test_lectura_construida_se_lee_igual_desde_sus_bytes(self) -> None:
        """Los bytes canónicos de una lectura construida vuelven a dar la misma lectura."""
        for lectura in (ejemplos.primera(), ejemplos.segunda()):
            dato = lectura.a_json()
            self.assertEqual(contrato.leer_lectura(contrato.bytes_de(dato)), dato)
            self.assertEqual(list(dato), ["lectura_id", *(c for c in contrato.CAMPOS if c != "lectura_id")])

    def test_identificador_es_la_huella_de_lo_observado(self) -> None:
        """El veredicto no cambia el identificador; cualquier dato observado sí."""
        base = ejemplos.segunda().a_json()["lectura_id"]
        anomala = ejemplos.segunda(estado="anomala", motivos=("forma_cambiada",))
        self.assertEqual(anomala.a_json()["lectura_id"], base)
        self.assertNotEqual(ejemplos.segunda(recuento_vigente=3).a_json()["lectura_id"], base)
        dato = ejemplos.segunda().a_json()
        dato["recuento_vigente"] = 3
        self.rechaza(dato, "lectura_id no es la huella")

    def test_construccion_ordena_y_valida(self) -> None:
        """El orden de los datos no cambia la lectura; un repetido no se borra, se rechaza."""
        desordenada = ejemplos.primera(entradas=tuple(reversed(ejemplos.PRIMER_CENSO)))
        self.assertEqual(desordenada.a_json(), ejemplos.primera().a_json())
        with self.assertRaisesRegex(ErrorLectura, "entradas: elementos repetidos"):
            ejemplos.segunda(entradas=("cibernarium:edicion:40311", "cibernarium:edicion:40311"))

    def test_campo_de_mas_o_de_menos_se_rechaza(self) -> None:
        """El contrato es cerrado en la lectura, en cada salida y en la huella de la forma."""
        dato = ejemplos.segunda().a_json()
        self.rechaza({**dato, "notas": "x"}, "campo no admitido «notas»")
        sin_estado = {k: v for k, v in dato.items() if k != "estado"}
        self.rechaza(sin_estado, "falta el campo «estado»")
        forma = copy.deepcopy(dato)
        forma["huella_forma"]["extra"] = []
        self.rechaza(con_identificador(forma), "huella_forma: campo no admitido «extra»")

    def test_estado_fuera_de_la_lista_se_rechaza(self) -> None:
        """Solo hay cuatro estados y cuatro motivos."""
        dato = ejemplos.segunda().a_json()
        self.rechaza({**dato, "estado": "dudosa"}, "estado no admitido")
        self.rechaza({**dato, "estado": "anomala", "motivos": ["caida_brusca"]}, "motivo no admitido")

    def test_salida_sin_su_explicacion_se_rechaza(self) -> None:
        """Cada salida dice qué la explica, aunque sea que nada (`null`); una explicación ajena no vale."""
        dato = ejemplos.segunda().a_json()
        dato["salidas"] = [{"id": "cibernarium:edicion:40112"}]
        self.rechaza(con_identificador(dato), "salida: falta el campo «explicada_por»")
        dato["salidas"] = [{"id": "cibernarium:edicion:40112", "explicada_por": "ausencia"}]
        self.rechaza(con_identificador(dato), "salida: explicación no admitida")
        sin_explicacion = Salida(id="cibernarium:edicion:40112", explicada_por=None)
        self.assertIsNone(ejemplos.segunda(salidas=(sin_explicacion,)).a_json()["salidas"][0]["explicada_por"])

    def test_estado_coherente_con_lo_observado(self) -> None:
        """Sana sin motivos, anómala con motivos, incompleta sin censo completo; cada motivo, con su hecho."""
        casos = [
            ({"estado": "sana", "motivos": ("forma_cambiada",)}, "una lectura sana"),
            ({"estado": "anomala"}, "una lectura anómala"),
            ({"estado": "incompleta"}, "una lectura incompleta"),
            ({"completa": False}, "necesita un motivo_incompleta"),
            ({"motivo_incompleta": "sin_censo"}, "un censo completo no lleva motivo_incompleta"),
            ({"estado": "anomala", "motivos": ("total_declarado_distinto",)}, "total_declarado_distinto necesita"),
            ({"estado": "anomala", "motivos": ("salidas_no_explicadas_en_bloque",)}, "salidas sin explicación"),
            ({"estado": "anomala", "motivos": ("valor_desconocido",)}, "valor_desconocido va siempre"),
            ({"recuento_vigente": 4}, "recuento_vigente mayor"),
            ({"recuento_bruto": True}, "recuento_bruto: recuento no válido"),
            ({"observado_utc": "2026-11-18T05:09:03+00:00"}, "observado_utc: hora UTC no válida"),
            ({"observado_utc": "2026-02-30T05:09:03Z"}, "fecha inexistente"),
        ]
        for cambios, mensaje in casos:
            with self.subTest(cambios=cambios), self.assertRaisesRegex(ErrorLectura, mensaje):
                ejemplos.segunda(**cambios)
        incompleta = ejemplos.segunda(completa=False, motivo_incompleta="consulta_fallida", estado="incompleta")
        self.assertEqual(incompleta.a_json()["motivo_incompleta"], "consulta_fallida")
        nuevo = ValorNuevo(campo="edicion.modalidad", valor="híbrida")
        con_valor = HuellaForma(
            campos_sha256=ejemplos.forma().campos_sha256, niveles=("edicion",), valores_nuevos=(nuevo,)
        )
        anomala = ejemplos.segunda(huella_forma=con_valor, estado="anomala", motivos=("valor_desconocido",))
        self.assertEqual(anomala.a_json()["huella_forma"]["valores_nuevos"], [nuevo.a_json()])

    def test_entradas_y_salidas_respecto_a_la_anterior(self) -> None:
        """La primera lectura lista todo su censo y no tiene salidas; ningún curso entra y sale a la vez."""
        with self.assertRaisesRegex(ErrorLectura, "la primera lectura no lista su censo"):
            ejemplos.primera(entradas=ejemplos.PRIMER_CENSO[:2])
        salida = Salida(id="cibernarium:edicion:39998", explicada_por=None)
        with self.assertRaisesRegex(ErrorLectura, "la primera lectura no tiene salidas"):
            ejemplos.primera(salidas=(salida,))
        with self.assertRaisesRegex(ErrorLectura, "entrar y salir"):
            ejemplos.segunda(entradas=("cibernarium:edicion:40112",))

    def test_bytes_no_canonicos_o_json_ajeno_se_rechazan(self) -> None:
        """Una lectura válida escrita de otra forma, con claves repetidas o con NaN no se acepta."""
        dato = ejemplos.segunda().a_json()
        legible = json.dumps(dato, ensure_ascii=False, indent=2).encode()
        with self.assertRaisesRegex(ErrorLectura, "forma canónica"):
            contrato.leer_lectura(legible)
        canonico = contrato.bytes_de(dato)
        with self.assertRaisesRegex(ErrorLectura, "clave repetida «version»"):
            contrato.leer_lectura(b'{"version":1,' + canonico[1:])
        with self.assertRaisesRegex(ErrorLectura, "número no finito"):
            contrato.leer_lectura(canonico.replace(b'"recuento_bruto":3', b'"recuento_bruto":NaN'))
        with self.assertRaisesRegex(ErrorLectura, "UTF-8"):
            contrato.leer_lectura(b"\xff")

    def test_esquema_coincide_con_campos_y_vocabularios_ejecutados(self) -> None:
        """El esquema publicado describe exactamente los campos y las listas cerradas que exige el código."""
        esquema = json.loads(ESQUEMA.read_text(encoding="utf-8"))
        propiedades, definiciones = esquema["properties"], esquema["$defs"]
        self.assertEqual(esquema["required"], list(contrato.CAMPOS))
        self.assertFalse(esquema["additionalProperties"])
        self.assertEqual(propiedades["version"]["const"], contrato.VERSION)
        self.assertEqual(propiedades["estado"]["enum"], list(contrato.ESTADOS))
        self.assertEqual(propiedades["motivos"]["items"]["enum"], list(contrato.MOTIVOS))
        self.assertEqual(propiedades["motivo_incompleta"]["oneOf"][0]["enum"], list(contrato.MOTIVOS_INCOMPLETA))
        for nombre, campos in [
            ("salida", contrato.CAMPOS_SALIDA),
            ("huella_forma", contrato.CAMPOS_FORMA),
            ("valor_nuevo", contrato.CAMPOS_VALOR_NUEVO),
            ("regla", ("id", "version", "sha256")),
        ]:
            with self.subTest(nombre=nombre):
                self.assertEqual(definiciones[nombre]["required"], list(campos))
                self.assertFalse(definiciones[nombre]["additionalProperties"])
        explicaciones = definiciones["salida"]["properties"]["explicada_por"]["oneOf"][0]["enum"]
        self.assertEqual(explicaciones, list(contrato.EXPLICACIONES_DE_SALIDA))
        self.assertEqual(definiciones["huella_forma"]["properties"]["niveles"]["items"]["enum"], list(contrato.NIVELES))


if __name__ == "__main__":
    unittest.main()
