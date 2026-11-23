"""Lectura del boletín coreano y conservación de su medida nacional de personas."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector as ia_nacional_kor
from plataforma_datos.comun.nucleo import FormatoInesperado

_CELDA = "<table:table-cell><text:p>{}</text:p></table:table-cell>"
_FILAS = (
    ("분야", "주요 내역", "‘23년", "‘24년", "‘25년", "증감 %p(전년대비)"),
    ("인터넷 이용", "인터넷 이용률", "94.0", "94.5", "95.0", "+0.5"),
    ("생성형AI", "생성형 AI 기반 서비스 경험률", "17.6", "33.3", "44.5", "+11.2"),
)
ODF = (
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body>'
    "<text:p>특히, 생성형 인공지능 서비스를 경험해 봤다는 응답은 2025년 44.5%로</text:p>"
    "<text:p>전국 22,671가구 및 만 3세 이상 가구원 <text:span>50,750명</text:span>을 대상으로</text:p><table:table>"
    + "".join(
        "<table:table-row>" + "".join(_CELDA.format(celda) for celda in fila) + "</table:table-row>" for fila in _FILAS
    )
    + "</table:table></office:body></office:document-content>"
)


def documento_con_filas(filas: tuple[tuple[str, ...], ...]) -> str:
    """Sustituye solo la tabla de la fixture, conservando pregunta y universo.

    Returns:
        Documento con las filas indicadas y el resto de la fixture intacto.
    """
    inicio, resto = ODF.split("<table:table>", 1)
    _, fin = resto.split("</table:table>", 1)
    tabla = "".join(
        "<table:table-row>" + "".join(_CELDA.format(c) for c in fila) + "</table:table-row>" for fila in filas
    )
    return inicio + "<table:table>" + tabla + "</table:table>" + fin


class Lectura(unittest.TestCase):
    """La fila y el año identifican una sola medida, con la columna de cambio al final."""

    def test_corea_del_sur(self) -> None:
        """La fila de la IA generativa, último año, con el universo y la pregunta literales; sin la fila, se para."""
        cifra = ia_nacional_kor.cifra_del_boletin(ODF.encode())
        self.assertEqual((cifra["valor"], cifra["anio"]), (44.5, 2025))
        self.assertEqual((cifra["universo"], cifra["pregunta"]), (ia_nacional_kor.UNIVERSO, ia_nacional_kor.PREGUNTA))
        with self.assertRaises(FormatoInesperado):
            ia_nacional_kor.cifra_del_boletin(ODF.replace("서비스 경험률", "서비스 이용률").encode())
        self.assertEqual(ia_nacional_kor.INDICADORES_NACIONALES["KOR"]["id"], "personas-ia-nacional-kor")

    def test_dos_tablas_con_indicador_se_rechazan(self) -> None:
        """No escoger silenciosamente la primera tabla, aunque las cifras coincidan."""
        tabla = "<table:table>" + ODF.split("<table:table>", 1)[1].split("</table:table>", 1)[0] + "</table:table>"
        for segunda in (tabla, tabla.replace("44.5", "40.0")):
            with self.subTest(segunda=segunda), self.assertRaisesRegex(FormatoInesperado, "MSIT:.*tablas"):
                ia_nacional_kor.cifra_del_boletin(ODF.replace("</office:body>", segunda + "</office:body>").encode())

    def test_cabeceras_y_filas_truncadas_se_diagnostican(self) -> None:
        """Los accesos a la última cifra requieren años y columna de cambio completos."""
        filas = (
            (("분야", "주요 내역"), ("생성형AI", ia_nacional_kor.FILA)),
            (("분야", "주요 내역", ia_nacional_kor.COLUMNA_DEL_CAMBIO), ("생성형AI", ia_nacional_kor.FILA, "+11.2")),
            (_FILAS[0], ("생성형AI", ia_nacional_kor.FILA, "17.6")),
        )
        for tabla in filas:
            with self.subTest(tabla=tabla), self.assertRaisesRegex(FormatoInesperado, "MSIT:"):
                ia_nacional_kor.cifra_del_boletin(documento_con_filas(tabla).encode())

    def test_anios_unicos_en_orden_y_cambio_unico(self) -> None:
        """No tratar la última cifra como último año cuando la cabecera es ambigua."""
        for cabecera in (
            ("분야", "주요 내역", "‘23년", "‘25년", "‘25년", ia_nacional_kor.COLUMNA_DEL_CAMBIO),
            ("분야", "주요 내역", "‘25년", "‘24년", "‘23년", ia_nacional_kor.COLUMNA_DEL_CAMBIO),
            (
                "분야",
                "주요 내역",
                "‘23년",
                ia_nacional_kor.COLUMNA_DEL_CAMBIO,
                "‘25년",
                ia_nacional_kor.COLUMNA_DEL_CAMBIO,
            ),
        ):
            with self.subTest(cabecera=cabecera), self.assertRaisesRegex(FormatoInesperado, "MSIT:"):
                ia_nacional_kor.cifra_del_boletin(documento_con_filas((cabecera, _FILAS[2])).encode())

    def test_numero_y_anio_ascii(self) -> None:
        """No convertir otras escrituras numéricas del texto coreano."""
        for antes, despues in (("44.5", "４４.５"), ("‘25년", "‘２５년")):
            with self.subTest(valor=despues), self.assertRaisesRegex(FormatoInesperado, "MSIT:"):
                ia_nacional_kor.cifra_del_boletin(ODF.replace(antes, despues).encode())

    def test_xml_ilegible_tiene_diagnostico(self) -> None:
        """Un contenedor con XML cortado debe fallar con el motivo de la fuente."""
        for xml in (b"", b"<documento>"):
            with self.subTest(xml=xml), self.assertRaisesRegex(FormatoInesperado, "MSIT: XML ilegible"):
                ia_nacional_kor.cifra_del_boletin(xml)


if __name__ == "__main__":
    unittest.main()
