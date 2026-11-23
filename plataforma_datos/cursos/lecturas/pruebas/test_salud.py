"""La regla `salud-lectura`: califica cada lectura por lo que explica su cambio, con casos tomados del historial."""

import dataclasses
import unittest

from plataforma_datos.cursos.lecturas import contrato_lectura as contrato
from plataforma_datos.cursos.lecturas import salud
from plataforma_datos.cursos.lecturas.contrato_lectura import HuellaForma, Salida, ValorNuevo, huella_de_campos
from plataforma_datos.cursos.lecturas.salud import ErrorSalud, Observacion, UmbralDeSalidas, calificar

CAMPOS_FUNDAE = ("edicion.fin", "edicion.id", "edicion.inicio", "programa.id", "programa.titulo")
CAMPOS_FUNDAE_SIN_PROGRAMA = ("edicion.fin", "edicion.id", "edicion.inicio")


def identificadores(prefijo: str, cuantos: int, desde: int = 0) -> tuple[str, ...]:
    """Identificadores de prueba con la forma de los de la fuente.

    Returns:
        Los identificadores `prefijo:n`, del `desde` en adelante.
    """
    return tuple(f"{prefijo}:{n:05d}" for n in range(desde, desde + cuantos))


def forma(
    campos: tuple[str, ...] = CAMPOS_FUNDAE, niveles: tuple[str, ...] = ("edicion",), **cambios: object
) -> HuellaForma:
    """La forma de una captura.

    Returns:
        La huella de sus campos y sus niveles.
    """
    return HuellaForma(campos_sha256=huella_de_campos(campos), niveles=niveles, **cambios)


def primera(fuente: str, ambito: str, censo: tuple[str, ...], huella: HuellaForma, **cambios: object) -> Observacion:
    """La primera lectura de un ámbito: todo su censo entra.

    Returns:
        Lo observado, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": fuente,
        "ambito": ambito,
        "anterior": None,
        "observado_utc": "2026-10-25T05:10:00Z",
        "completa": True,
        "recuento_bruto": len(censo),
        "recuento_vigente": len(censo),
        "ids_sha256": contrato.huella_de_ids(censo),
        "entradas": censo,
        "huella_forma": huella,
    }
    return Observacion(**{**datos, **cambios})


def guardada(observacion: Observacion, ultima_sana: dict | None = None) -> dict:
    """La lectura calificada tal como la devuelve el almacén.

    Returns:
        La lectura en JSON, ya validada por el contrato.
    """
    return observacion.lectura(calificar(observacion, ultima_sana)).a_json()


def siguiente(referencia: dict, censo: tuple[str, ...], salidas: tuple[Salida, ...], **cambios: object) -> Observacion:
    """La lectura que sigue a otra del mismo ámbito, con su censo y sus salidas.

    Returns:
        Lo observado, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": referencia["fuente"],
        "ambito": referencia["ambito"],
        "anterior": referencia["lectura_id"],
        "observado_utc": "2026-11-15T05:10:00Z",
        "completa": True,
        "recuento_bruto": len(censo),
        "recuento_vigente": len(censo),
        "ids_sha256": contrato.huella_de_ids(censo),
        "huella_forma": forma(),
        "salidas": salidas,
    }
    return Observacion(**{**datos, **cambios})


def salen(ids: tuple[str, ...], explicada_por: str | None) -> tuple[Salida, ...]:
    """Las salidas de esos cursos, todas con la misma explicación.

    Returns:
        Una salida por curso.
    """
    return tuple(Salida(id=i, explicada_por=explicada_por) for i in ids)


class CitilabPruebas(unittest.TestCase):
    """Una fuente de 9 cursos: en una fuente pequeña se cuentan cursos, no porcentajes."""

    def setUp(self) -> None:
        """La última lectura sana, con sus 9 cursos."""
        self.cursos = identificadores("citilab:curso", 9)
        self.sana = guardada(primera("citilab", "citilab:curso", self.cursos, forma()))

    def test_pierde_dos_con_su_fin_publicado_y_sigue_sana(self) -> None:
        """Dos cursos que terminan no son un fallo de la lectura, aunque sean el 22 % del censo."""
        lectura = siguiente(self.sana, self.cursos[2:], salen(self.cursos[:2], "fin_publicado"))
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("sana", ()))

    def test_pierde_cuatro_sin_explicacion_y_es_anomala(self) -> None:
        """Cuatro salidas sin fin ni baja superan el mínimo de tres cursos."""
        lectura = siguiente(self.sana, self.cursos[4:], salen(self.cursos[:4], None))
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("anomala", ("salidas_no_explicadas_en_bloque",)))

    def test_tres_sin_explicacion_aun_se_admiten(self) -> None:
        """El umbral es «más de»: tres salidas sin explicación en 9 cursos se admiten."""
        lectura = siguiente(self.sana, self.cursos[3:], salen(self.cursos[:3], None))
        self.assertEqual(calificar(lectura, self.sana).estado, "sana")


class HistorialPruebas(unittest.TestCase):
    """Las lecturas reales de Cibernàrium (ediciones) y FUNDAE (preinscripción), con sus cifras."""

    def test_fundae_deja_de_emitir_el_nivel_de_programa(self) -> None:
        """18/11: las mismas 186 ediciones, sin el nivel de programa; el recuento no lo ve, la forma sí."""
        ediciones = identificadores("fundae:edicion", 186)
        sana = guardada(primera("fundae", "fundae:preinscripcion", ediciones, forma(niveles=("edicion", "programa"))))
        sin_programa = forma(CAMPOS_FUNDAE_SIN_PROGRAMA, niveles=("edicion",))
        lectura = siguiente(sana, ediciones, (), huella_forma=sin_programa, observado_utc="2026-11-18T05:10:00Z")
        veredicto = calificar(lectura, sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("anomala", ("forma_cambiada",)))
        solo_niveles = forma(niveles=("edicion",))
        self.assertEqual(calificar(dataclasses.replace(lectura, huella_forma=solo_niveles), sana).estado, "anomala")

    def test_cibernarium_15_11_sale_anomala_y_18_11_sana(self) -> None:
        """25/10 → 15/11: 190 salidas, 175 con fin publicado y 15 sin explicar (7 volvieron el 18/11) frente a 616.

        El umbral admite 13 y la lectura sale anómala. El 18/11 salen 34, 26 con fin y 8 sin explicar; la referencia
        sigue siendo la del 25/10, porque la del 15/11 no fue sana, y 8 no superan 13.
        """
        censo_25 = identificadores("cibernarium:edicion", 616)
        sana = guardada(primera("barcelonactiva", "cibernarium:edicion", censo_25, forma()))
        nuevas = identificadores("cibernarium:edicion", 50, desde=1000)
        censo_15 = censo_25[190:] + nuevas
        salidas = salen(censo_25[:175], "fin_publicado") + salen(censo_25[175:190], None)
        lectura_15 = siguiente(sana, censo_15, salidas, entradas=nuevas)
        veredicto_15 = calificar(lectura_15, sana)
        self.assertEqual((veredicto_15.estado, veredicto_15.motivos), ("anomala", ("salidas_no_explicadas_en_bloque",)))
        anomala = lectura_15.lectura(veredicto_15).a_json()
        vuelven = censo_25[183:190]
        censo_18 = censo_15[34:] + vuelven + identificadores("cibernarium:edicion", 24, desde=2000)
        salidas_18 = salen(censo_15[:26], "fin_publicado") + salen(censo_15[26:34], None)
        lectura_18 = siguiente(
            sana,
            censo_18,
            salidas_18,
            anterior=anomala["lectura_id"],
            observado_utc="2026-11-18T05:10:00Z",
            entradas=censo_18[-31:],
        )
        self.assertEqual(len(censo_18), 473)
        self.assertEqual(calificar(lectura_18, sana).estado, "sana")

    def test_la_caida_del_vigente_no_hace_anomala_la_lectura(self) -> None:
        """SOC, 858 → 867 registros brutos y 493 vigentes: la caída está en la vigencia, no en la fuente."""
        cursos = identificadores("soc:curs", 858)
        sana = guardada(primera("formacion", "soc:curs", cursos, forma(niveles=("actividad",))))
        censo = cursos + identificadores("soc:curs", 9, desde=5000)
        lectura = siguiente(
            sana, censo, (), entradas=censo[-9:], recuento_vigente=493, huella_forma=forma(niveles=("actividad",))
        )
        self.assertEqual(calificar(lectura, sana).estado, "sana")


class MotivosPruebas(unittest.TestCase):
    """Cada motivo sale de su hecho, y el veredicto construye una lectura que el contrato acepta."""

    def setUp(self) -> None:
        """Una lectura sana de 476 ediciones como referencia."""
        self.censo = identificadores("cibernarium:edicion", 476)
        self.sana = guardada(primera("barcelonactiva", "cibernarium:edicion", self.censo, forma()))

    def test_total_declarado_distinto(self) -> None:
        """La fuente dice tener 480 y la captura trae 476."""
        lectura = siguiente(self.sana, self.censo, (), total_declarado=480)
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("anomala", ("total_declarado_distinto",)))
        self.assertEqual(calificar(dataclasses.replace(lectura, total_declarado=476), self.sana).estado, "sana")

    def test_valor_nuevo_en_vocabulario_cerrado(self) -> None:
        """Un nivel «Experto» que el vocabulario de Cibervoluntarios no reconoce."""
        nuevo = forma(valores_nuevos=(ValorNuevo(campo="level", valor="Experto"),))
        lectura = siguiente(self.sana, self.censo, (), huella_forma=nuevo)
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("anomala", ("valor_desconocido",)))

    def test_censo_incompleto_no_se_juzga(self) -> None:
        """Un censo que no llegó entero es incompleto, sin motivos, aunque falten cursos y cambie la forma."""
        lectura = siguiente(
            self.sana,
            self.censo[100:],
            salen(self.censo[:100], None),
            completa=False,
            motivo_incompleta="consulta_fallida",
            total_declarado=476,
            huella_forma=forma(CAMPOS_FUNDAE_SIN_PROGRAMA),
        )
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("incompleta", ()))
        contrato.validar_lectura(lectura.lectura(veredicto).a_json())

    def test_censo_incompleto_con_valores_nuevos_los_declara(self) -> None:
        """El contrato ata `valor_desconocido` a sus valores nuevos: es el único motivo de un censo incompleto."""
        nuevo = forma(valores_nuevos=(ValorNuevo(campo="level", valor="Experto"),))
        lectura = siguiente(
            self.sana, self.censo, (), completa=False, motivo_incompleta="limite_alcanzado", huella_forma=nuevo
        )
        veredicto = calificar(lectura, self.sana)
        self.assertEqual((veredicto.estado, veredicto.motivos), ("incompleta", ("valor_desconocido",)))
        contrato.validar_lectura(lectura.lectura(veredicto).a_json())

    def test_veredicto_construye_una_lectura_valida(self) -> None:
        """Lo observado y el veredicto dan una lectura que se lee igual desde sus bytes, firmada por la regla."""
        lectura = siguiente(self.sana, self.censo, (), total_declarado=480)
        dato = lectura.lectura(calificar(lectura, self.sana)).a_json()
        self.assertEqual(contrato.leer_lectura(contrato.bytes_de(dato)), dato)
        self.assertEqual(dato["regla"], salud.regla_de_salud().a_json())
        self.assertEqual(dato["regla"]["id"], "salud-lectura")
        self.assertEqual(dato["regla"]["version"], 2)
        self.assertEqual(dato["calibracion"]["origen"], "suelo")


class ReglaPruebas(unittest.TestCase):
    """La regla firma su umbral y no se deja comparar con una referencia ajena."""

    def test_la_huella_cambia_si_cambia_el_parametro(self) -> None:
        """Otro mínimo u otro porcentaje es otra regla; el mismo umbral da la misma huella."""

        def huella(minimo: int, porcentaje: int) -> str:
            return salud.regla_de_salud(
                UmbralDeSalidas(minimo_de_cursos=minimo, porcentaje_del_bruto=porcentaje)
            ).sha256

        base = salud.regla_de_salud().sha256
        self.assertEqual(huella(3, 2), base)
        self.assertNotEqual(huella(4, 2), base)
        self.assertNotEqual(huella(3, 3), base)

    def test_umbral_redondea_hacia_arriba_y_respeta_el_minimo(self) -> None:
        """El 2 % de 616 son 12,32 y se admiten 13; en 9 cursos manda el mínimo de 3."""
        self.assertEqual(salud.UMBRAL.admitidas(616), 13)
        self.assertEqual(salud.UMBRAL.admitidas(476), 10)
        self.assertEqual(salud.UMBRAL.admitidas(9), 3)
        with self.assertRaisesRegex(ErrorSalud, "porcentaje no válido"):
            UmbralDeSalidas(minimo_de_cursos=3, porcentaje_del_bruto=150)

    def test_referencia_ajena_se_rechaza(self) -> None:
        """La referencia es una lectura sana, del mismo ámbito y anterior; una primera lectura no tiene referencia."""
        cursos = identificadores("citilab:curso", 9)
        sana = guardada(primera("citilab", "citilab:curso", cursos, forma()))
        lectura = siguiente(sana, cursos, ())
        with self.assertRaisesRegex(ErrorSalud, "otro ámbito"):
            calificar(dataclasses.replace(lectura, ambito="citilab:otro"), sana)
        with self.assertRaisesRegex(ErrorSalud, "no es una lectura sana"):
            calificar(lectura, guardada(primera("citilab", "citilab:curso", cursos, forma(), total_declarado=10)))
        with self.assertRaisesRegex(ErrorSalud, "no es anterior"):
            calificar(dataclasses.replace(lectura, observado_utc="2026-10-01T00:00:00Z"), sana)
        with self.assertRaisesRegex(ErrorSalud, "primera lectura"):
            calificar(primera("citilab", "citilab:curso", cursos, forma(), observado_utc="2026-11-15T05:10:00Z"), sana)

    def test_una_lectura_anomala_solo_vale_de_referencia_si_es_aceptada(self) -> None:
        """Aceptada por una persona, una lectura anómala de censo completo es referencia; una incompleta nunca."""
        cursos = identificadores("citilab:curso", 9)
        anomala = guardada(primera("citilab", "citilab:curso", cursos, forma(), total_declarado=10))
        lectura = siguiente(anomala, cursos, ())
        self.assertEqual(calificar(lectura, anomala, aceptada=True).estado, "sana")
        with self.assertRaisesRegex(ErrorSalud, "no es una lectura sana"):
            calificar(lectura, anomala)
        incompleta = guardada(
            primera("citilab", "citilab:curso", cursos, forma(), completa=False, motivo_incompleta="consulta_fallida")
        )
        with self.assertRaisesRegex(ErrorSalud, "ni una aceptada completa"):
            calificar(siguiente(incompleta, cursos, ()), incompleta, aceptada=True)


class InvariantePruebas(unittest.TestCase):
    """Una lectura anómala o incompleta solo puede impedir cambios, nunca provocarlos."""

    def setUp(self) -> None:
        """Una referencia sana de 9 cursos."""
        self.cursos = identificadores("citilab:curso", 9)
        self.sana = guardada(primera("citilab", "citilab:curso", self.cursos, forma()))

    def test_el_veredicto_no_dice_nada_de_ningun_curso(self) -> None:
        """La regla solo califica la lectura: su veredicto es el estado, los motivos, la regla y su calibración."""
        self.assertEqual(
            [c.name for c in dataclasses.fields(salud.Veredicto)], ["estado", "motivos", "regla", "calibracion"]
        )
        self.assertNotIn("id", contrato.CAMPOS_CALIBRACION)
        self.assertEqual(
            {c.name for c in dataclasses.fields(Observacion)} | {"estado", "motivos", "regla", "lectura_id", "version"},
            set(contrato.CAMPOS),
        )

    def test_mas_salidas_sin_explicar_nunca_devuelven_la_salud(self) -> None:
        """Explicar menos salidas puede quitar la salud a una lectura, nunca dársela; un censo incompleto no es sano."""
        estados = []
        for sin_explicar in range(10):
            salidas = salen(self.cursos[:sin_explicar], None) + salen(self.cursos[sin_explicar:9], "fin_publicado")
            lectura = siguiente(self.sana, (), salidas, recuento_bruto=0, recuento_vigente=0)
            estados.append(calificar(lectura, self.sana).estado)
            incompleta = dataclasses.replace(lectura, completa=False, motivo_incompleta="limite_alcanzado")
            self.assertEqual(calificar(incompleta, self.sana).estado, "incompleta")
        self.assertEqual(estados, ["sana"] * 4 + ["anomala"] * 6)

    def test_una_primera_lectura_no_es_anomala_por_comparacion(self) -> None:
        """Sin lectura sana anterior no hay forma con la que comparar."""
        lectura = primera("fundae", "fundae:preinscripcion", identificadores("fundae:edicion", 186), forma())
        self.assertEqual(calificar(lectura, None).estado, "sana")
        sin_programa = dataclasses.replace(lectura, huella_forma=forma(CAMPOS_FUNDAE_SIN_PROGRAMA))
        self.assertEqual(calificar(sin_programa, None).estado, "sana")


if __name__ == "__main__":
    unittest.main()
