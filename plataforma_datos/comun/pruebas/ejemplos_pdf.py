"""PDF sintéticos compartidos, sin dependencias de las clases de prueba."""

import zlib

CMAP = b"""/CIDInit /ProcSet findresource begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <0043> <0002> <00F3> endbfchar
2 beginbfrange <0003> <0003> <0064> <0004> <0006> [<0069> <0067> <006F>] endbfrange
endcmap end"""


def _pdf(objetos: list[bytes], raiz: int = 1) -> bytes:
    """Un PDF con estos objetos (el primero es el 1), su tabla de referencias y su trailer.

    Returns:
        Bytes del PDF.
    """
    salida = bytearray(b"%PDF-1.4\n")
    desplazamientos = []
    for numero, objeto in enumerate(objetos, start=1):
        desplazamientos.append(len(salida))
        salida += f"{numero} 0 obj\n".encode() + objeto + b"\nendobj\n"
    tabla = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n0000000000 65535 f \n".encode()
    for desplazamiento in desplazamientos:
        salida += f"{desplazamiento:010d} 00000 n \n".encode()
    salida += f"trailer\n<< /Size {len(objetos) + 1} /Root {raiz} 0 R >>\nstartxref\n{tabla}\n%%EOF\n".encode()
    return bytes(salida)


def _flujo(contenido: bytes, comprimido: bool = True) -> bytes:
    """Un objeto flujo con su longitud; comprimido con FlateDecode o tal cual.

    Returns:
        Bytes del objeto flujo.
    """
    datos = zlib.compress(contenido) if comprimido else contenido
    filtro = b" /Filter /FlateDecode" if comprimido else b""
    return b"<< /Length " + str(len(datos)).encode() + filtro + b" >>\nstream\n" + datos + b"\nendstream"


def pdf_de_prueba() -> bytes:
    """Dos páginas: una normal (fuente simple con diferencias y una compuesta con ToUnicode) y otra apaisada.

    Returns:
        Bytes del PDF de dos páginas.
    """
    pagina_1 = (
        b"BT /F1 10 Tf 1 0 0 1 50 700 Tm (Denominaci\xf3n: Atenci\\363n) Tj 0 -12 Td [(Ocupa) -10 (ciones) -400 (y)] TJ"
        b" 0 -12 Td /F2 10 Tf <000100020003000400050006> Tj ET"
    )
    girada = b"BT /F1 10 Tf 0 10 -10 0 100 50 Tm (Primera) Tj 0 -1.2 Td (Segunda) Tj ET"
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /Contents [7 0 R 8 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 9 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [243 /oacute] >> >>",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /F /Encoding /Identity-H /ToUnicode 10 0 R >>",
        # El contenido de la página, partido en dos flujos entre dos piezas, como lo permite el formato.
        _flujo(pagina_1[: pagina_1.index(b" Tm") + 3]),
        _flujo(pagina_1[pagina_1.index(b" Tm") + 3 :], comprimido=False),
        _flujo(girada),
        _flujo(CMAP),
    ]
    return _pdf(objetos)
