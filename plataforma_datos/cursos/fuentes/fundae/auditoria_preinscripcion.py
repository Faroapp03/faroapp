"""Reproduce por difusión el plazo publicado, la especialidad, el centro y la gratuidad de la oferta estatal."""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.fundae import adquisicion, ediciones, hechos, salida
from plataforma_datos.orquestacion.admision import exigir_admitido

IDENTIFICADOR_FISCAL = re.compile(r"\b(?:[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]|[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])\b", re.I)
CATALOGO_OFERTA = 3
GRATUIDAD = "Se trata de cursos 100% gratuitos, financiados con fondos públicos"
FRASE_GRATUITA = re.compile(
    r"se trata de cursos 100\s*% gratuitos,? financiados con fondos públicos"
    r"(?:, diseñados para mejorar la empleabilidad de las personas trabajador[ae]s en toda españa)?"
)
CONDICION_PRECIO = re.compile(
    r"\b(?:no|excepto|exceptu\w*|excepci[oó]n\w*|salvo|solo|sólo|solamente|únicamente|algunos?|algunas?|"
    r"exclu\w*|limitad\w*|sujet[oa]s?|condici[oó]n\w*|si|antes|anteriormente|"
    r"pago\w*|pag[ao]\w*|cobro\w*|cobr[ao]\w*|cuota\w*|coste\w*|costo\w*|precio\w*|abon[ao]\w*|"
    r"tasas?|tarifa\w*|importe\w*|copago\w*|matr[ií]cula\w*|factur\w*|euros?|eur|"
    r"fals[oa]\w*|incorrect[oa]\w*|mentira\w*|err[oó]ne[oa]\w*)\b|[€$]",
    re.IGNORECASE,
)


class EvidenciaIncompleta(ValueError):
    """Motivo factual que se puede conservar sin datos de contacto."""


def _exigir(valor: object, motivo: str) -> None:
    if not valor:
        raise EvidenciaIncompleta(motivo)


def formacion_gratuita(catalogos: object) -> bool:
    """Identifica la declaración afirmativa de gratuidad de toda la formación en el catálogo 3.

    Returns:
        Si el texto completo y revisado acredita el precio de la formación.
    """
    if not isinstance(catalogos, list):
        return False
    filas = [f for f in catalogos if isinstance(f, dict) and f.get("idCatalogo") == CATALOGO_OFERTA]
    if len(filas) != 1 or filas[0].get("descripcionCatalogo") != "Oferta":
        return False
    texto = filas[0].get("descripcionCard")
    if not isinstance(texto, str):
        return False
    declaracion = " ".join(unicodedata.normalize("NFKC", texto).casefold().split())
    frases = [f.strip() for f in re.split(r"[.?!;…]+", declaracion)]
    return any(FRASE_GRATUITA.fullmatch(f) for f in frases) and not CONDICION_PRECIO.search(declaracion)


def _unica(filas: list, identificador: str) -> tuple[int, dict]:
    propias = [(i, f) for i, f in enumerate(filas) if str(f.get("idDifusionAccionFormativa")) == identificador]
    _exigir(len(propias) == 1, "identidad-de-difusion-ausente-o-duplicada")
    return propias[0]


def contrastar_difusion(identificador: str, todas: list, centro: list) -> dict:
    """Coteja la misma fila en las dos respuestas de la fuente. Devuelve solo datos sin contactos.

    Returns:
        Posición, plazo, presencia de contacto y condiciones que deben revisarse.
    """
    posicion, primera = _unica(todas, identificador)
    _, segunda = _unica(centro, identificador)
    campos = (
        "idCentro",
        "idAccionFormativa",
        "cifEntidadFormadora",
        "entidadFormadora",
        "fechaPreinscripcionInicio",
        "fechaPreinscripcionFin",
    )
    _exigir(all(primera.get(c) and primera[c] == segunda.get(c) for c in campos), "centro-accion-o-plazo-discrepantes")
    plazo = hechos.plazo(primera)
    _exigir(date.fromisoformat(plazo["inicio"]) <= date.fromisoformat(plazo["fin"]), "plazo-invertido")
    return {
        "posicion": posicion,
        "plazo": plazo,
        "hay_contacto_publicado": bool(
            primera.get("emailContactoDifusion")
            or primera.get("emailContactoEntidad")
            or primera.get("telefonoContacto")
        ),
        "campos_de_tramite_por_revisar": sorted(
            c
            for c in primera.keys() | segunda.keys()
            if re.fullmatch(
                r"(url|enlace|estado|boton|permite)(Solicitud|Inscripcion|Preinscripcion)", c, re.IGNORECASE
            )
        ),
    }


def condicion_economica(*partes: dict) -> bool:
    """Una tarifa nueva en la edición o su curso requiere cotejar su alcance con el catálogo.

    Returns:
        Si se observó un campo económico en el curso o la edición.
    """
    precio = re.compile(r"precio|tarifa|importe|coste|costos?|gratuit|gratuidad|copago|dePago", re.IGNORECASE)
    return any(precio.search(campo) and valor is not None for parte in partes for campo, valor in parte.items())


@dataclass
class Edicion:
    """Datos sin contactos, posición individual y cuatro recepciones que los acreditan."""

    datos: dict
    contraste: dict
    pruebas: dict


def _limite_individual(filas: list, ident: str, dia: str) -> tuple[int, dict] | None:
    try:
        posicion, fila = _unica(filas, ident)
        plazo = hechos.plazo(fila)
        desde, hasta = (date.fromisoformat(plazo[c]) for c in ("inicio", "fin"))
    except (EvidenciaIncompleta, FormatoInesperado, ValueError):
        return None
    if desde > hasta or plazo["inicio"] <= dia <= plazo["fin"]:
        return None
    return posicion, plazo


class Archivo:
    """Recupera también los recibos históricos de una edición conservada tras un fallo de consulta."""

    def __init__(self, original: Path, corte: str) -> None:
        self.original = original
        self.corte = vigencia.instante_utc(corte, "corte de preinscripción")
        self.registros = {}
        self.capturas = {}
        self.indices = {}
        self.condiciones_por_revisar = {}
        self.precios_por_revisar = {}

    def leer(self, nombre: str, prueba: dict, esperada: str) -> tuple[object, dict]:
        """Reproduce una captura identificada del archivo privado.

        Returns:
            Datos y metadatos verificados de la respuesta.
        """
        carpeta = self.original / ("catalogos" if nombre == "indice" else "ediciones")
        clave = (nombre, sha256_json(prueba), esperada)
        if clave not in self.registros:
            cap = {"cuerpo": prueba["cuerpo"], "recibo": prueba["recibo"]}
            evento = json.loads(comun.leer_conservado(carpeta, cap["recibo"]))
            if "formato_recibo" in evento:
                sha = evento["metadatos_sha256"]
                _exigir(re.fullmatch("[0-9a-f]{64}", sha), "metadatos-incompatibles")
                cap["metadatos"] = {"archivo": f"metadatos/{sha}.json", "sha256": sha}
            dato, meta = ediciones.respuesta(carpeta, cap, esperada)
            _exigir(
                dato is not None and ediciones.evidencia(cap, meta) == prueba, "recepcion-no-corresponde-a-validacion"
            )
            _exigir(
                vigencia.instante_utc(meta["fin_utc"], "fin de la ficha") <= self.corte, "recepcion-posterior-al-corte"
            )
            self.registros[clave] = dato, meta
            self.capturas[cap["recibo"]["sha256"]] = carpeta, cap
        return self.registros[clave]

    def individual(self, validada: dict, pruebas: dict) -> Edicion:
        """Coteja la edición y el catálogo a partir de las respuestas recibidas.

        Returns:
            Hechos reproducidos, fila y referencias.

        Raises:
            EvidenciaIncompleta: Si la propia edición introduce una condición económica por revisar.
        """
        identificador, codigo = validada["id"], validada["especialidad"]
        _exigir(
            re.fullmatch(r"[1-9][0-9]*", identificador) and re.fullmatch(r"[A-Z0-9_-]{1,40}", codigo),
            "identidad-no-admitida",
        )
        _exigir(salida.con_evidencia({identificador: pruebas}, identificador), "falta-alguna-de-las-cuatro-recepciones")
        indice, _ = self.leer("indice", pruebas["indice"], adquisicion.URLS["subvencionada"])
        sha = pruebas["indice"]["cuerpo"]["sha256"]
        if sha not in self.indices:
            self.indices[sha] = {
                f["codigoTitulacion"]: f
                for f in adquisicion._filas(indice, 3)
                if f["idModalidad"] == hechos.TELEFORMACION
            }
        especialidad = self.indices[sha].get(codigo, {})
        _exigir(
            especialidad.get("inscripcionAbierta") is True and ediciones.del_ambito(especialidad),
            "sin-especialidad-abierta-dentro-del-ambito",
        )
        general, _ = self.leer("difusiones", pruebas["difusiones"], ediciones.url_difusiones(codigo))
        todas = hechos.difusiones(general)
        _, propia = _unica(todas, identificador)
        _exigir(
            re.fullmatch(r"[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]", propia["cifEntidadFormadora"]),
            "entidad-juridica-pendiente-de-identificar",
        )
        _exigir(
            all(
                propia.get(k)
                for k in (
                    "idCentro",
                    "idAccionFormativa",
                    "ejercicioDifusion",
                    "idConvocatoria",
                    "emailContactoDifusion",
                    "centro",
                )
            ),
            "solicitud-sin-campos-de-la-difusion",
        )
        centro, _ = self.leer("centro", pruebas["centro"], ediciones.url_centro(codigo, propia["cifEntidadFormadora"]))
        colectivos, _ = self.leer("colectivos", pruebas["colectivos"], ediciones.url_colectivos(int(identificador)))
        contraste = contrastar_difusion(identificador, todas, hechos.difusiones(centro))
        _exigir(not contraste["campos_de_tramite_por_revisar"], "condicion-nueva-de-solicitud-por-revisar")
        curso, comun_curso = hechos.curso(centro, codigo), hechos.curso(general, codigo)
        _, de_entidad = _unica(hechos.difusiones(centro), identificador)
        if condicion_economica(propia, de_entidad, curso, comun_curso):
            self.precios_por_revisar[identificador] = pruebas["difusiones"]
            raise EvidenciaIncompleta("condicion-economica-propia-por-revisar")
        _exigir(
            curso["duracion"] == comun_curso["duracion"] == especialidad["duracion"]
            and curso.get("idCatalogo") == comun_curso.get("idCatalogo") == CATALOGO_OFERTA,
            "curso-de-otra-duracion-o-catalogo",
        )
        reconstruida = hechos.edicion(codigo, int(identificador), general, centro, colectivos)
        _exigir(reconstruida == validada, "resultado-admitido-no-reproducible")
        visibles = " ".join(reconstruida[k] for k in ("nombre", "entidad", "sector"))
        _exigir(
            not (hechos.CONTACTO.search(visibles) or IDENTIFICADOR_FISCAL.search(visibles)),
            "identificador-en-campo-visible",
        )
        contraste["equivalencia"] = sha256_json(
            [
                {k: v for k, v in propia.items() if k != "idDifusionAccionFormativa"},
                {k: v for k, v in validada.items() if k != "id"},
            ]
        )
        return Edicion(reconstruida, contraste, pruebas)

    def cierres_individuales(self, pendientes: dict[str, dict], indice_admitido: dict) -> dict:
        """Exige el ID de edición, especialidad y fechas en la última captura admitida de la API.

        Returns:
            Por edición, la captura y el plazo individual vigente en la última consulta.
        """
        ruta = self.original / "ediciones" / "procedencia.json"
        if not pendientes or not ruta.is_file():
            return {}
        documento = leer_json(ruta)
        if (documento.get("schema_version"), documento.get("fuente_id"), documento.get("indice")) != (
            1,
            "fundae",
            indice_admitido,
        ):
            return {}
        por_codigo = {}
        for identificador, edicion in pendientes.items():
            por_codigo.setdefault(edicion["especialidad"], set()).add(identificador)
        cierres = {}
        for entrada in documento["especialidades"]:
            codigo = entrada["codigo"]
            if codigo not in por_codigo:
                continue
            cap = entrada["difusiones"]
            dato, meta = ediciones.respuesta(ruta.parent, cap, ediciones.url_difusiones(codigo))
            if dato is None or vigencia.instante_utc(meta["fin_utc"], "ficha") > self.corte:
                continue
            try:
                hechos.curso(dato, codigo)
                filas = hechos.difusiones(dato)
            except FormatoInesperado:
                continue
            dia = hechos.dia_civil(meta["fin_utc"])
            for ident in por_codigo[codigo]:
                limite = _limite_individual(filas, ident, dia)
                if limite is None:
                    continue
                posicion, plazo = limite
                prueba = ediciones.evidencia(cap, meta)
                self.capturas[cap["recibo"]["sha256"]] = ruta.parent, cap
                cierres[ident] = {
                    "plazo": plazo,
                    "prueba": prueba,
                    "inicio_utc": meta["inicio_utc"],
                    "posicion": posicion,
                }
        return cierres


def candidatas(original: Path, validado: Path, corte: str) -> tuple[Archivo, list[Edicion], list[dict], dict]:
    """Contrasta cada edición admitida con sus propias capturas. Una discrepancia se registra solo para esa fila.

    Returns:
        Archivo de capturas, candidatas, motivos de retención y declaración de precio.
    """
    archivo = Archivo(original, corte)
    informe = exigir_admitido("fundae", ruta=validado / "validacion.json")
    canal = leer_json(validado / "catalogos" / "fundae.json")
    informe_catalogo = exigir_admitido("fundae", ruta=validado / "catalogos" / "validacion.json")
    _exigir(
        hashlib.sha256(comun.json_bytes(canal)).hexdigest() == informe_catalogo["conjunto_sha256"],
        "catalogo-validado-alterado",
    )
    cap = canal["auxiliares"]["catalogos"]
    catalogos, meta = adquisicion.pagina(original / "catalogos", cap, "catalogos")
    _exigir(vigencia.instante_utc(meta["fin_utc"], "catálogo") <= archivo.corte, "catalogo-posterior-al-corte")
    gratuita = formacion_gratuita(catalogos) if catalogos is not None else None
    archivo.capturas[cap["recibo"]["sha256"]] = original / "catalogos", cap
    documento = leer_json(validado / "fundae.json")
    if "conjunto_sha256" in informe:
        _exigir(
            hashlib.sha256(comun.json_bytes(documento)).hexdigest() == informe["conjunto_sha256"],
            "ediciones-validadas-alteradas",
        )
    conjunto = documento["ediciones"]
    ids = [e["id"] for e in conjunto]
    _exigir(
        len(ids) == len(set(ids)) and set(ids) == set(informe["evidencias"]),
        "identidades-duplicadas-o-distintas-de-la-validacion",
    )
    propuestas, retenidas = [], []
    for e in conjunto:
        try:
            propuestas.append(archivo.individual(e, informe["evidencias"][e["id"]]))
        except (EvidenciaIncompleta, FormatoInesperado, ValueError, KeyError, OSError) as error:
            motivo = (
                str(error)
                if isinstance(error, EvidenciaIncompleta)
                else "archivos-o-formato-de-la-edicion-no-verificables"
            )
            propios = informe["evidencias"].get(e["id"]) or {}
            recibos = {
                n: p["recibo"]["sha256"]
                for n, p in propios.items()
                if isinstance(p, dict) and (p.get("recibo") or {}).get("sha256") in archivo.capturas
            }
            retenidas.append({"id": e["id"], "especialidad": e["especialidad"], "motivo": motivo, "recibos": recibos})
            prueba = (informe["evidencias"].get(e["id"]) or {}).get("difusiones") or {}
            if (
                motivo
                in {
                    "condicion-nueva-de-solicitud-por-revisar",
                    "centro-accion-o-plazo-discrepantes",
                    "solicitud-sin-campos-de-la-difusion",
                    "entidad-juridica-pendiente-de-identificar",
                    "identificador-en-campo-visible",
                }
                and (prueba.get("recibo") or {}).get("sha256") in archivo.capturas
            ):
                archivo.condiciones_por_revisar[e["id"]] = prueba
    return archivo, propuestas, retenidas, {**ediciones.evidencia(cap, meta), "gratuita": gratuita}
