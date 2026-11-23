"""Pruebas de los certificados que relacionan los perfiles de la oferta de empleo del SEPE (perfiles.py).

La selección se prueba con filas que copian la forma de las menciones del original; el conjunto y su cobertura, con
los preparados y validados versionados.
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.perfiles.lector as perfiles
from plataforma_datos.comun.nucleo import FormatoInesperado


def mencion(
    cno4: str, certificado: str, tipo: str = "directo", perfil: str = "Perfil", anio: str = "2020"
) -> dict[str, str]:
    """Una fila del original con lo que lee la selección.

    Args:
        cno4: El grupo CNO-11 a cuatro cifras.
        certificado: El código del certificado de profesionalidad.
        tipo: Cómo se nombra el certificado («directo», «rango», «directo-normalizado»).
        perfil: El nombre del perfil.
        anio: El año del perfil.

    Returns:
        La fila con los campos que lee la selección.
    """
    return {
        "perfil_id": perfil.lower(),
        "perfil": perfil,
        "anio": anio,
        "cno4": cno4,
        "certificado": certificado,
        "tipo": tipo,
        "pagina": "5",
        "linea_literal": f"{certificado} Nombre",
    }


class PruebaSeleccion(unittest.TestCase):
    """Qué menciones del SEPE se usan y con qué ocupaciones."""

    def test_los_rangos_y_los_perfiles_sin_grupo_no_entran(self) -> None:
        """Los rangos no se expanden ni se usan; sin grupo CNO-11 no hay relación."""
        filas = [mencion("4430", "COMM0111"), mencion("4430", "COMM0112", "rango"), mencion("", "COMM0113")]
        self.assertEqual([fila["certificado"] for fila in perfiles.relaciones_nombradas(filas)], ["COMM0111"])

    def test_una_mencion_directo_normalizado_cuenta_como_nombrada(self) -> None:
        """Una mención de tipo «directo-normalizado» cuenta como nombrada."""
        relaciones = perfiles.relaciones_nombradas([mencion("4430", "COMM0111", "directo-normalizado")])
        self.assertEqual(len(relaciones), 1)

    def test_se_cita_el_perfil_mas_reciente(self) -> None:
        """Si varios perfiles nombran el mismo certificado para el grupo, se cita el más reciente."""
        filas = [mencion("4430", "COMM0111", perfil="Viejo", anio="2017"), mencion("4430", "COMM0111", anio="2023")]
        (relacion,) = perfiles.relaciones_nombradas(filas)
        self.assertEqual((relacion["perfil"], relacion["anio"], relacion["perfiles"]), ("Perfil", 2023, 2))

    def test_sin_las_de_fuera_del_catalogo(self) -> None:
        """Solo certificados vigentes: los que no están en el catálogo se quitan."""
        relaciones = [{"cno4": "4430", "certificado": "COMM0111"}, {"cno4": "4430", "certificado": "XXXX0000"}]
        usadas = perfiles.en_el_catalogo(relaciones, {"COMM0111"})
        self.assertEqual(usadas, [{"cno4": "4430", "certificado": "COMM0111"}])

    def test_la_descartada_se_quita_solo_a_su_ocupacion(self) -> None:
        """Lo que la revisión descartó para una ocupación ESCO no se le enseña; a las demás del grupo, sí."""
        relaciones = [{"cno4": "4430", "certificado": "COMM0111"}]
        grupos = {"descartada": {"4430"}, "otra": {"4430"}}
        nuevas = perfiles.por_ocupacion(relaciones, grupos, comprobadas={}, descartadas={("descartada", "COMM0111")})
        self.assertEqual(sorted(nuevas), ["otra"])

    def test_solo_ocupaciones_de_un_grupo_y_sin_lo_comprobado(self) -> None:
        """Solo ocupaciones con un único grupo, y sin lo que Faro ya enseña comprobado."""
        relaciones = [{"cno4": "4430", "certificado": "COMM0111"}, {"cno4": "4430", "certificado": "COMM0112"}]
        grupos = {"una": {"4430"}, "dos": {"4430", "4500"}, "comprobada": {"4430"}}
        nuevas = perfiles.por_ocupacion(
            relaciones, grupos, comprobadas={"comprobada": {"COMM0111": "grupo"}}, descartadas=set()
        )
        self.assertEqual(sorted(nuevas), ["comprobada", "una"])
        self.assertEqual([fila["certificado"] for fila in nuevas["comprobada"]], ["COMM0112"])

    def test_las_descartadas_se_cuentan_con_la_misma_regla_de_un_grupo(self) -> None:
        """La cuenta de descartadas y el reparto usan la misma regla: solo ocupaciones de un único grupo."""
        relaciones = [{"cno4": "4430", "certificado": "COMM0111"}, {"cno4": "4500", "certificado": "COMM0111"}]
        grupos = {"una": {"4430"}, "dos": {"4430", "4500"}, "ninguno": set()}
        descartadas = {("una", "COMM0111"), ("dos", "COMM0111")}
        self.assertEqual(perfiles.ocupaciones_de_un_grupo(grupos), {"una": "4430"})
        self.assertEqual(perfiles.descartadas_por_la_revision(relaciones, grupos, descartadas), 1)


class PruebaEntradas(unittest.TestCase):
    """Una entrada manual defectuosa se rechaza con su contexto antes de escribir."""

    def preparar_con(self, contenido: bytes, motivo: str | None = None) -> None:
        """Prepara una copia temporal cuya huella ya se considera comprobada."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / perfiles.APARTADOS
            ruta.write_bytes(contenido)
            with (
                mock.patch.object(perfiles, "comprobar_originales", return_value=[ruta]),
                mock.patch.object(perfiles, "guardar_jsonl") as guardar,
            ):
                with self.assertRaisesRegex(FormatoInesperado, motivo or perfiles.APARTADOS):
                    perfiles.preparar()
                guardar.assert_not_called()

    def test_la_procedencia_registra_solo_el_original_de_los_apartados(self) -> None:
        """Ninguno, dos o un original con otro nombre son un error de fuente que lo nombra, no un ValueError."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / perfiles.APARTADOS
            ruta.write_bytes(self.tsv([mencion("4430", "COMM0111")]))
            for rutas in ([], [ruta, ruta], [Path(temporal) / "otro.tsv"]):
                with (
                    self.subTest(rutas=rutas),
                    mock.patch.object(perfiles, "comprobar_originales", return_value=rutas),
                    mock.patch.object(perfiles, "guardar_jsonl") as guardar,
                ):
                    with self.assertRaisesRegex(FormatoInesperado, rf"perfiles: .*{perfiles.APARTADOS}"):
                        perfiles.preparar()
                    guardar.assert_not_called()
            with (
                mock.patch.object(perfiles, "comprobar_originales", return_value=[ruta]),
                mock.patch.object(perfiles, "guardar_jsonl") as guardar,
            ):
                perfiles.preparar()
            guardar.assert_called_once()

    def test_cabecera_incompleta_duplicada_y_archivo_vacio(self) -> None:
        """Las columnas obligatorias se declaran una sola vez y hay menciones."""
        for contenido in (b"", b"tipo\tcno4\n", self.tsv([]).rstrip(b"\n") + b"\tperfil\n", self.tsv([])):
            with self.subTest(contenido=contenido):
                self.preparar_con(contenido)

    @staticmethod
    def tsv(filas: list[dict[str, str]]) -> bytes:
        """Compone una entrada con la cabecera y las filas nominales.

        Returns:
            El TSV codificado en UTF-8.
        """
        salida = io.StringIO()
        escritor = csv.DictWriter(
            salida, list(filas[0] if filas else mencion("4430", "COMM0111")), delimiter="\t", lineterminator="\n"
        )
        escritor.writeheader()
        escritor.writerows(filas)
        return salida.getvalue().encode("utf-8")

    def test_fila_con_celdas_de_mas_o_de_menos(self) -> None:
        """Una fila irregular no se interpreta perdiendo datos ni deja None como texto."""
        entrada = self.tsv([mencion("4430", "COMM0111")])
        for contenido in (entrada[:-1] + b"\textra\n", entrada.rsplit(b"\t", 1)[0] + b"\n"):
            with self.subTest(contenido=contenido):
                self.preparar_con(contenido)

    def test_anio_y_pagina_deben_ser_enteros_positivos(self) -> None:
        """La cita de una mención nombrada no admite años o páginas vacíos, ilegibles o cero."""
        for campo in ("anio", "pagina"):
            for valor in ("", "no-numero", "0", "-1"):
                with self.subTest(campo=campo, valor=valor):
                    fila = mencion("4430", "COMM0111")
                    fila[campo] = valor
                    self.preparar_con(self.tsv([fila]), rf"{perfiles.APARTADOS}, línea 2: {campo}")

    def test_la_codificacion_incorrecta_tiene_contexto(self) -> None:
        """Una entrada que no es UTF-8 produce un error de fuente, con su archivo."""
        self.preparar_con(self.tsv([mencion("4430", "COMM0111")]) + b"\xff")

    def test_comillas_sin_cerrar_no_alteran_el_literal(self) -> None:
        """Una comilla sin cierre no se consume como sintaxis que reescriba el literal."""
        contenido = self.tsv([]) + b'perfil\tPerfil\t2020\t4430\tCOMM0111\tdirecto\t5\t"literal sin cierre\n'
        self.preparar_con(contenido, rf"{perfiles.APARTADOS}.*TSV")

    def test_la_lectura_conserva_valores_orden_y_columnas_adicionales(self) -> None:
        """La lectura válida conserva los literales y no impone valores a las menciones que se excluyen."""
        filas = [mencion("4430", "COMM0111"), mencion("", "COMM0112", tipo="rango")]
        filas[0]["linea_literal"] = '  Certificado À · "literal"\nsegunda línea  '
        filas[1]["pagina"] = ""
        for fila in filas:
            fila["nota"] = "dato adicional"
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / perfiles.APARTADOS
            ruta.write_bytes(self.tsv(filas))
            self.assertEqual(perfiles.leer_apartados(ruta), filas)

    def test_no_se_valida_un_preparado_sin_relaciones(self) -> None:
        """Un preparado vacío no puede producir un conjunto admitido por controles vacíos."""
        controles = perfiles.Controles()
        hoy = perfiles.Relaciones({}, {})
        with (
            mock.patch.object(perfiles, "leer_validado", return_value={"cno11": {}}),
            self.assertRaisesRegex(FormatoInesperado, "relaciones"),
        ):
            perfiles._controles(controles, [], {}, set(), hoy)

    def test_no_hay_porcentajes_con_un_total_nulo_o_negativo(self) -> None:
        """La cobertura exige un denominador positivo antes de calcular porcentajes."""
        for total in (0, -1):
            with self.subTest(total=total), self.assertRaisesRegex(FormatoInesperado, "total"):
                perfiles.resumen_de_cobertura(
                    {"ocupaciones": {}, "personas": {"total": total, "cota_baja": 0, "estimacion": 0, "cota_alta": 0}}
                )


if __name__ == "__main__":
    unittest.main()
