"""Compara los bloques y citas de mercado con los recortes de las fuentes de esta prueba."""

import datetime
import json
import re
import unittest
import zipfile
from decimal import ROUND_HALF_UP, Decimal
from unittest import mock
from xml.etree import ElementTree

import plataforma_datos.mercado.fuentes.eaes.lector as eaes
import plataforma_datos.mercado.fuentes.epa.lector as epa
import plataforma_datos.mercado.fuentes.ofertas.lector as ofertas
from plataforma_datos.mercado.pruebas import test_productor_eaes, test_productor_epa, test_productor_ofertas
from plataforma_datos.mercado.pruebas.ayuda_productores import RECORTES, ConDatosAislados, Respuesta, recorte
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion import mercado

ESPACIO_XML = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
TRIMESTRES = ["2025T3", "2025T4", "2026T1", "2026T2"]
ANTERIORES = ["2024T3", "2024T4", "2025T1", "2025T2"]
PERIODOS_INE = {19: 1, 20: 2, 21: 3, 22: 4}
CITA_EPA = (
    "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (Encuesta de Población Activa, "
    "tabla 65314; última publicación: trimestre 2/2026)."
)
CITA_EAES = (
    "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (Encuesta Anual de Estructura "
    "Salarial, tabla 28186; Definitivos 2024)."
)
CITA_OFERTAS = (
    "Font: Observatori del Treball i Model Productiu, Generalitat de Catalunya. Estadística d'ofertes de llocs de "
    "treball (SOC i Feina Activa), gener-setembre de 2026"
)


def redondear(valor: Decimal, unidad: str) -> Decimal:
    """Redondea al múltiplo indicado, con las mitades hacia arriba.

    Returns:
        El valor redondeado.
    """
    paso = Decimal(unidad)
    return (valor / paso).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * paso


def empleo_del_recorte() -> dict:
    """Calcula las medias de los trimestres fijados a partir de las series originales del INE.

    Returns:
        El bloque completo de empleo.
    """
    series = json.loads(test_productor_epa.TABLA, parse_float=Decimal)
    codigos = {v["Nombre"]: v["Codigo"] or "total" for v in json.loads(test_productor_epa.CODIGOS)}
    salida = {}
    for serie in series:
        nombre = serie["Nombre"].strip()
        prefijo = "Ocupados. Ambos sexos. Cataluña. "
        sufijo = ". Valor absoluto."
        if not nombre.startswith(prefijo) or not nombre.endswith(sufijo):
            continue
        nombre = nombre[len(prefijo) : -len(sufijo)]
        cifras = {f"{dato['Anyo']}T{PERIODOS_INE[dato['FK_Periodo']]}": dato["Valor"] for dato in serie["Data"]}

        def media(datos: dict, periodos: list[str]) -> Decimal | None:
            valores = [datos[p] for p in periodos]
            if any(valor is None for valor in valores):
                return None
            return sum(Decimal(valor) for valor in valores) / len(valores)

        actual, anterior = media(cifras, TRIMESTRES), media(cifras, ANTERIORES)
        salida[codigos[nombre]] = {
            "nombre": nombre,
            "personas": None if actual is None else int(redondear(actual * 1000, "100")),
            "anterior": None if anterior is None else int(redondear(anterior * 1000, "100")),
            "variacion_pct": None
            if actual is None or anterior is None
            else float(redondear((actual / anterior - 1) * 100, "0.1")),
        }
    return {"trimestres": TRIMESTRES, "anteriores": ANTERIORES, "grandes_grupos": salida}


def salarios_del_recorte() -> dict:
    """Reúne las cifras por sexo y grupo y los subgrupos de la jerarquía del INE.

    Returns:
        El bloque completo de salarios.
    """
    grupos = {v["Nombre"]: v["Codigo"] for v in json.loads(test_productor_eaes.GRUPOS)}
    sexos = {"Ambos sexos": "total", "Mujeres": "mujeres", "Hombres": "hombres"}
    salida: dict[str, dict] = {}
    for serie in json.loads(test_productor_eaes.TABLA, parse_float=Decimal):
        texto = serie["Nombre"].strip().removesuffix(". Salario medio bruto. Total Nacional. Dato base.")
        nombre, sexo = texto.rsplit(". ", 1)
        letra = grupos[nombre]
        entrada = salida.setdefault(letra, {"nombre": nombre, "gran_variabilidad": []})
        if letra and "cno2" not in entrada:
            hijos = json.loads(recorte(f"eaes/ine-eaes-cno11-{letra}.json"))
            entrada["cno2"] = [hijo["Codigo"] for hijo in hijos]
        valores = {dato["Anyo"]: dato["Valor"] for dato in serie["Data"]}
        campo = sexos[sexo]
        campos = [(campo, 2024)]
        if campo == "total":
            campos.append(("anterior", 2023))
        for clave, anio in campos:
            valor = valores[anio]
            if valor is not None and valor < 0:
                entrada["gran_variabilidad"].append(clave)
            entrada[clave] = None if valor is None else int(redondear(abs(Decimal(valor)), "1"))
    for entrada in salida.values():
        if not entrada["gran_variabilidad"]:
            del entrada["gran_variabilidad"]
    todas = salida.pop("")
    del todas["nombre"]
    return {"anio": 2024, "anio_anterior": 2023, "grupos": salida, "todas": todas}


def filas_del_excel(nombre: str, hoja: int) -> list[dict[str, str]]:
    """Lee las celdas de texto de una hoja de los libros recortados.

    Returns:
        Las filas con su texto por columna.
    """
    with zipfile.ZipFile(RECORTES / nombre) as libro:
        raiz = ElementTree.fromstring(libro.read(f"xl/worksheets/sheet{hoja}.xml"))
    filas = []
    for fila in raiz.findall(".//x:sheetData/x:row", ESPACIO_XML):
        celdas = {}
        for celda in fila.findall("x:c", ESPACIO_XML):
            columna = re.match(r"[A-Z]+", celda.attrib["r"])
            texto = celda.find("x:is/x:t", ESPACIO_XML)
            if columna is not None and texto is not None:
                celdas[columna.group()] = texto.text or ""
        filas.append(celdas)
    return filas


def libro_de_ofertas(nombre: str) -> dict:
    """Extrae el total y todas las filas de los tres niveles publicados del recorte.

    Returns:
        El total y los puestos por código de ocupación.
    """
    ocupaciones = {}
    for fila in filas_del_excel(nombre, 1):
        codigo = fila.get("A", "").strip()
        if re.fullmatch(r"\d{4}", codigo):
            ocupaciones[codigo] = (int(fila["C"]), len(ocupaciones) + 1)
    niveles: dict[str, dict] = {"cno1": {}, "cno2": {}}
    total = None
    for fila in filas_del_excel(nombre, 2):
        etiqueta = fila.get("A", "").strip()
        if etiqueta == "Total":
            total = int(fila["G"])
        elif coincidencia := re.fullmatch(r"(\d{1,2}) .+", etiqueta):
            codigo = coincidencia.group(1)
            niveles[f"cno{len(codigo)}"][codigo] = int(fila["G"])
    return {"total": total, "cno4": ocupaciones, **niveles}


def ofertas_de_los_recortes() -> dict:
    """Compara todos los puestos de los libros de septiembre de 2026 y 2025.

    Returns:
        El bloque completo de ofertas.
    """
    actual = libro_de_ofertas("Ofertes_202609.xlsx")
    anterior = libro_de_ofertas("Ofertes_202509.xlsx")
    niveles = {
        nivel: {
            codigo: {"puestos": puestos, "anterior": anterior[nivel].get(codigo)}
            for codigo, puestos in actual[nivel].items()
        }
        for nivel in ("cno1", "cno2")
    }
    return {
        "periodo": "enero-septiembre de 2026",
        "periodo_anterior": "enero-septiembre de 2025",
        "total": actual["total"],
        "total_anterior": anterior["total"],
        "cno4": {
            codigo: {"puestos": puestos, "anterior": anterior["cno4"].get(codigo, (None,))[0], "puesto": puesto}
            for codigo, (puestos, puesto) in actual["cno4"].items()
        },
        **niveles,
    }


class PruebaProductoresEnLaExportacion(ConDatosAislados):
    """Los bloques y las citas corresponden a los recortes de EPA, EAES y ofertas."""

    def setUp(self) -> None:
        """Ejecuta los tres productores sobre los recortes, con un doble de la red."""
        super().setUp()
        respuestas = {
            test_productor_epa.URL_TABLA: Respuesta(test_productor_epa.TABLA),
            test_productor_epa.URL_CODIGOS: Respuesta(test_productor_epa.CODIGOS),
            **test_productor_eaes.respuestas(),
            **test_productor_ofertas.PUBLICADOS,
        }
        with self.con_red(respuestas), mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 10, 21)):
            for productor in (epa, eaes, ofertas):
                productor.descargar(False)
                productor.preparar()
                productor.validar()

    def test_mismas_cifras_que_las_publicadas(self) -> None:
        """Empleo, salarios y ofertas reproducen las cifras completas de los recortes."""
        self.assertEqual(mercado._empleo(leer_validado("epa")), empleo_del_recorte())
        self.assertEqual(mercado._salarios(leer_validado("eaes")), salarios_del_recorte())
        self.assertEqual(mercado._ofertas(leer_validado("ofertas")), ofertas_de_los_recortes())

    def test_citas_generadas_desde_el_periodo_leido(self) -> None:
        """Las citas identifican los periodos contenidos en las capturas."""
        self.assertEqual(leer_validado("epa")["cita"], CITA_EPA)
        self.assertEqual(leer_validado("eaes")["cita"], CITA_EAES)
        self.assertEqual(leer_validado("ofertas")["cita"], CITA_OFERTAS)


if __name__ == "__main__":
    unittest.main()
