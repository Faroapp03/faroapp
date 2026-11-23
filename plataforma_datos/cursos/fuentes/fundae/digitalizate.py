"""Digitalízate offline: recursos tipo Curso como programas candidatos, sin ediciones.

La identidad es FUNDAE/idCatalogo/idRecursoFormativo, nunca título o URL.
El catálogo 1 se acredita en el índice oficial y en cada recurso; no es una
página ni una categoría. La cobertura de proveedores puede ser parcial respecto
al buscador. Importar nunca concilia pertenencias ni retira ausentes.
No descarga ni copia descripciones protegidas: conserva sus huellas/localizadores.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from collections.abc import Callable
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import NoReturn
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.cursos.catalogo import ErrorCatalogo, cargar_lotes, exigir_url_publica, validar_lote
from plataforma_datos.cursos.contrato_fichas import validar_lote_fichas
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

PRIMER_ASCII_IMPRIMIBLE = 32
ASCII_SUPRIMIR = 127

type RecursoCapturado = tuple[ObjetoJson, ObjetoJson, ObjetoJson, ObjetoJson, str]

PUBLICADOR_ID = "fundae:publicador:catalogo:1"
PROVEEDOR_PUBLICADOR = {
    "id": PUBLICADOR_ID,
    "nombre": "FUNDAE · publicador agregador de Digitalízate",
    "territorio": None,
    "naturaleza": None,
}
VERSION_ADAPTADOR = 2


class ErrorAdaptador(ValueError):
    """La captura no permite identificar y convertir fielmente sus recursos."""


def _exigir(condicion: object, mensaje: str) -> None:
    if not condicion:
        raise ErrorAdaptador(mensaje)


def _canonico(valor: ValorJson) -> str:
    return json.dumps(
        valor,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _sha(contenido: bytes) -> str:
    return hashlib.sha256(contenido).hexdigest()


def _pares(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    salida = {}
    for clave, valor in pares:
        _exigir(clave not in salida, "Clave JSON repetida: " + clave)
        salida[clave] = valor
    return salida


def _constante(valor: str) -> NoReturn:
    raise ErrorAdaptador("Constante JSON no finita: " + valor)


def _leer(raiz: Path, relativa: str) -> tuple[ValorJson, str]:
    _exigir(isinstance(relativa, str) and relativa, "Falta ruta de captura")
    ruta = Path(relativa)
    _exigir(not ruta.is_absolute() and ".." not in ruta.parts, "Ruta ajena a la captura")
    destino = (raiz / ruta).resolve()
    _exigir(
        destino.is_relative_to(raiz) and destino.is_file(),
        "Captura ausente o fuera de raíz",
    )
    cuerpo = destino.read_bytes()
    return json.loads(cuerpo, object_pairs_hook=_pares, parse_constant=_constante), _sha(cuerpo)


def _indice(filas: ValorJson, campo: str) -> dict[str | int, ObjetoJson]:
    _exigir(isinstance(filas, list), "Se esperaba una lista: " + campo)
    salida = {}
    for fila in filas:
        _exigir(isinstance(fila, dict), "Registro no identificado: " + campo)
        clave = fila[campo]
        _exigir(type(clave) in (str, int), "Identidad inválida: " + campo)
        _exigir(clave not in salida, "Identidad duplicada: " + str(clave))
        salida[clave] = fila
    return salida


def _utc(valor: str) -> datetime:
    _exigir(isinstance(valor, str) and "T" in valor, "Falta instante UTC observado")
    fecha = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    _exigir(
        fecha.utcoffset() is not None and fecha.utcoffset().total_seconds() == 0,
        "Fecha no UTC",
    )
    return fecha


def _consulta(registro: ObjetoJson, camino: str, parametros: dict[str, list[str]]) -> None:
    solicitada = urlsplit(registro["url_solicitada"])
    _exigir(
        solicitada.scheme == "https"
        and solicitada.netloc == "agora.fundae.es"
        and solicitada.path == camino
        and parse_qs(solicitada.query) == parametros
        and not solicitada.fragment
        and registro["url_final"] == registro["url_solicitada"],
        "Consulta ajena al catálogo o identidad prevista",
    )


def _destino(publicada: ValorJson) -> tuple[str | None, ObjetoJson | None]:
    """Recorta solo blancos externos; el validador del núcleo decide la URL.

    Controles e interior se conservan sin reparar. Un destino incompatible se
    devuelve como incidencia individual; nunca se sustituye por una URL de API.

    Returns:
        URL validada o None y, cuando procede, incidencia o registro de recorte.

    Raises:
        ErrorCatalogo: Si los datos o la operación local no cumplen el contrato declarado.
    """
    try:
        if isinstance(publicada, str) and any(
            ord(c) < PRIMER_ASCII_IMPRIMIBLE or ord(c) == ASCII_SUPRIMIR for c in publicada
        ):
            raise ErrorCatalogo("URL con caracteres de control")
        normalizada = publicada.strip() if isinstance(publicada, str) else publicada
        exigir_url_publica(normalizada, "urlCurso")
    except ErrorCatalogo as error:
        return None, {"original": publicada, "motivo": str(error)}
    cambio = (
        None
        if normalizada == publicada
        else {
            "original": publicada,
            "resultado": normalizada,
            "transformacion": "Recortar exclusivamente blancos exteriores, sin alterar interior.",
            "motivo": "El contrato de URL pública no admite blancos; valor original conservado.",
        }
    )
    return normalizada, cambio


def preparar_importacion(raiz_captura: str | Path) -> ObjetoJson:
    """Devuelve lotes/control deterministas; cada entidad conserva su fecha real.

    Solo usa manifest.json, fundae-proveedores.json, fundae-recursos.json y los
    cuerpos API referidos. Integridad local no equivale a autenticidad del origen.
    No usa el reloj de importación ni sustituye fechas observadas.

    Returns:
        Lotes por captura y control de identidades, exclusiones e incidencias.

    Raises:
        ErrorAdaptador: Si los datos o la operación local no cumplen el contrato declarado.
    """
    try:
        return _preparar(Path(raiz_captura).resolve())
    except (KeyError, TypeError, AttributeError) as error:
        raise ErrorAdaptador("Estructura de captura incompleta o incompatible") from error


def _lector_originales(
    raiz: Path, manifest: dict[str | int, ObjetoJson], usados: dict[str, ObjetoJson], originales: dict[str, ValorJson]
) -> Callable[[ObjetoJson], ValorJson]:

    def original(registro: ObjetoJson) -> ValorJson:
        """Prepara los datos locales de original.

        Returns:
            Resultado de la operación con los valores y el orden de la fuente.
        """
        _exigir(registro == manifest.get(registro["id"]), "Procedencia discrepante con manifest")
        identidad = registro["id"]
        if identidad not in originales:
            objeto, huella = _leer(raiz, registro["archivo"])
            _exigir(huella == registro["sha256"], "Huella de captura incorrecta: " + identidad)
            _exigir(
                type(registro["http"]) is int and registro["http"] == HTTPStatus.OK, "Captura HTTP no satisfactoria"
            )
            _exigir(_utc(registro["utc_inicio"]) <= _utc(registro["utc_fin"]), "Intervalo de captura invertido")
            originales[identidad] = objeto
            usados[identidad] = {
                "url": registro["url_final"],
                "capturado_utc": registro["utc_fin"],
                "sha256": huella,
                "archivo": registro["archivo"],
            }
        return originales[identidad]

    return original


def _recursos_de_proveedores(
    proveedores: dict[str | int, ObjetoJson],
    manifest: dict[str | int, ObjetoJson],
    original: Callable[[ObjetoJson], ValorJson],
) -> dict[int, RecursoCapturado]:
    fuentes_proveedor = {p["fuente"]["id"] for p in proveedores.values()}
    _exigir(
        fuentes_proveedor == {k for k in manifest if re.fullmatch("fundae_empresa[0-9]+", k)},
        "El índice de proveedores omite o añade una captura declarada",
    )
    raw = {}
    for pid, proveedor in sorted(proveedores.items()):
        _exigir(type(pid) is int and pid > 0, "Identidad de proveedor inválida")
        registro = proveedor["fuente"]
        _consulta(
            registro,
            "/Digitalizate/RecuperaDetalleEmpresaDigitalizate",
            {"baja": ["false"], "idCatalogo": ["1"], "idEmpresaDigitalizate": [str(pid)]},
        )
        padre = original(registro)["respuesta"]
        _exigir(
            padre["idEmpresaDigitalizate"] == pid and padre["nombre"] == proveedor["nombre"], "Proveedor discrepante"
        )
        for ci, categoria in enumerate(padre["digitalizateCategoria"]):
            for ri, recurso in enumerate(categoria["digitalizateRecursoFormativo"]):
                membresias = _indice(recurso["catalogos"], "idCatalogo")
                if 1 not in membresias:
                    continue
                _exigir(membresias[1]["descripcionCatalogo"] == "Digitalizate", "Membresía de catálogo incompatible")
                rid = recurso["idRecursoFormativo"]
                _exigir(type(rid) is int and rid > 0 and (rid not in raw), "Identidad de recurso duplicada o inválida")
                localizador = f"respuesta.digitalizateCategoria[{ci}].digitalizateRecursoFormativo[{ri}]"
                raw[rid] = (recurso, padre, categoria, registro, localizador)
    return raw


def _convertir_recursos(
    raw: dict[int, RecursoCapturado],
    derivados: dict[str | int, ObjetoJson],
    catalogo: ObjetoJson,
    catalogos: ObjetoJson,
    usados: dict[str, ObjetoJson],
) -> tuple[
    list[ObjetoJson], dict[str, list[ObjetoJson]], Counter[str], list[str], list[ObjetoJson], list[ObjetoJson], int
]:
    programas = []
    por_captura = {}
    excluidos = Counter()
    ids_excluidos = []
    incidencias = []
    normalizaciones_url = []
    cursos_capturados = 0
    for rid, (recurso, padre, categoria, registro, localizador) in sorted(raw.items()):
        r = derivados[rid]
        identidad = f"fundae:1:{rid}"
        _exigir(
            r["id"] == identidad and type(r["id_catalogo"]) is int and (r["id_catalogo"] == 1),
            "Identidad de índice incompatible",
        )
        esperados = {
            "id_proveedor": padre["idEmpresaDigitalizate"],
            "proveedor": padre["nombre"],
            "fuente": registro,
            "categoria_proveedor": categoria["categoria"],
            **{
                k: recurso[v]
                for k, v in {
                    "titulo": "denominacion",
                    "url_destino": "urlCurso",
                    "tipo_recurso_fuente": "tipoRecurso",
                    "idioma": "descripcionIdioma",
                    "modalidad_fuente": "modalidad",
                    "duracion_fuente": "duracion",
                    "edicion_fuente": "edicion",
                    "matricula_inicio": "periodoInscripcionInicio",
                    "matricula_fin": "periodoInscripcionFin",
                    "baja_fuente": "baja",
                    "boton_solicitud_fuente": "botonSolicitud",
                    "temas": "areasInteres",
                    "etiquetas": "etiquetas",
                    "digital_fuente": "digital",
                    "descripcion_fuente_privada": "descripcion",
                }.items()
            },
        }
        _exigir(
            all((_canonico(r[k]) == _canonico(v) for k, v in esperados.items())),
            "Metadatos derivados discrepantes: " + identidad,
        )
        _exigir(
            r.get("coste_certificado") is None and r.get("coste_formacion") is None, "Coste individual no respaldado"
        )
        tipo = recurso["tipoRecurso"]
        _exigir(isinstance(tipo, str) and tipo, "Tipo de recurso ausente")
        if tipo != "Curso":
            excluidos[tipo] += 1
            ids_excluidos.append(identidad)
            continue
        cursos_capturados += 1
        destino, cambio_url = _destino(recurso["urlCurso"])
        if destino is None:
            incidencias.append(
                {
                    "id": identidad,
                    "estado": "cuarentena_destino_invalido",
                    "motivo": cambio_url["motivo"],
                    "registro_original": recurso,
                    "registro_indice": r,
                    "evidencia": usados[registro["id"]],
                    "localizador": localizador,
                    "recurso_sha256": _sha(_canonico(recurso).encode("utf-8")),
                }
            )
            continue
        if cambio_url is not None:
            normalizaciones_url.append({"id": identidad, **cambio_url})
        descripcion = recurso["descripcion"]
        _exigir(descripcion is None or isinstance(descripcion, str), "Descripción incompatible")
        contenido = {"titulo": recurso["denominacion"], "descripcion_catalogo": descripcion}
        programas.append(
            {
                "id": identidad,
                "proveedor_id": PUBLICADOR_ID,
                "titulo": recurso["denominacion"],
                "url": destino,
                "tipo_unidad": "recurso_catalogo_tipo_curso",
                "datos": {
                    "adaptador": "digitalizate",
                    "version_adaptador": VERSION_ADAPTADOR,
                    "id_catalogo_fuente": 1,
                    "id_recurso_fuente": rid,
                    "url_destino_publicada": recurso["urlCurso"],
                    "normalizacion_url": cambio_url,
                    "rol_proveedor_principal": "publicador_agregador_no_impartidor",
                    "entidad_publicada": {
                        "id": padre["idEmpresaDigitalizate"],
                        "nombre": padre["nombre"],
                        "marca": padre.get("marcaComercial"),
                        "url": padre.get("url"),
                        "rol": "proveedor_del_recurso_publicado_por_agregador; imparticion_no_acreditada",
                    },
                    "metadatos_fuente": {
                        k: recurso.get(k)
                        for k in (
                            "tipoRecurso",
                            "idTipoRecurso",
                            "descripcionIdioma",
                            "idIdioma",
                            "modalidad",
                            "idModalidad",
                            "duracion",
                            "digital",
                            "areasInteres",
                            "etiquetas",
                            "nivelDigitalizacion",
                            "idNivelDigitalizacion",
                            "edicion",
                            "periodoInscripcionInicio",
                            "periodoInscripcionFin",
                            "baja",
                            "botonSolicitud",
                        )
                    },
                    "categoria_publicada": {"id": categoria["idCategoria"], "nombre": categoria["categoria"]},
                    "contenido_huella": _sha(_canonico(contenido).encode("utf-8")),
                    "contenido_huella_alcance": (
                        "Título y descripción de catálogo; no temario completo ni contenido del destino."
                    ),
                    "descripcion_catalogo": {
                        "observada": descripcion is not None,
                        "sha256_texto_utf8": _sha(descripcion.encode("utf-8")) if descripcion is not None else None,
                        "localizador": localizador + ".descripcion",
                        "evidencia_sha256": registro["sha256"],
                    },
                    "fuente_por_campos": {
                        "recurso": localizador,
                        "entidad_publicada": "respuesta.idEmpresaDigitalizate/nombre",
                        "tipo_idioma_modalidad_horas_marcas": localizador,
                        "declaracion_catalogo": "idCatalogo=1.descripcionCard",
                    },
                    "declaracion_general_gratuidad_publicada": catalogo.get("descripcionCard"),
                    "nivel_faro": None,
                    "nivel_publicado": None,
                    "capacidades_revisadas": None,
                    "temario_huella": None,
                    "coste_formacion": None,
                    "coste_certificado": None,
                    "gratuidad_individual": None,
                    "sincronia": None,
                    "estado_inscripcion": None,
                    "estado_edicion": None,
                    "restricciones_residencia": None,
                    "restricciones_colectivo": None,
                    "restricciones_edad": None,
                    "requisitos_publicados": None,
                    "plaza_confirmada_persona": None,
                    "admisibilidad_persona": None,
                    "cobertura": "captura_parcial_sin_conciliacion_ni_retiros",
                },
                "evidencias": [usados[registro["id"]], usados[catalogos["id"]]],
                "etiquetas": [],
            }
        )
        por_captura.setdefault(registro["id"], []).append(programas[-1])
    return (programas, por_captura, excluidos, ids_excluidos, incidencias, normalizaciones_url, cursos_capturados)


def _lotes_observados(
    por_captura: dict[str, list[ObjetoJson]],
    manifest: dict[str | int, ObjetoJson],
    fuente_lote: str,
    catalogos: ObjetoJson,
    usados: dict[str, ObjetoJson],
) -> tuple[list[ObjetoJson], list[ObjetoJson]]:
    lotes = [
        {
            "schema_version": 1,
            "observado_utc": catalogos["utc_fin"],
            "fuente_lote": fuente_lote + ":publicador",
            "proveedores": [PROVEEDOR_PUBLICADOR],
            "programas": [],
            "ediciones": [],
        }
    ]
    observaciones = []
    for identidad in sorted(por_captura, key=lambda i: (_utc(manifest[i]["utc_fin"]), i)):
        detalle = manifest[identidad]
        lotes.append(
            {
                "schema_version": 1,
                "observado_utc": detalle["utc_fin"],
                "fuente_lote": fuente_lote + ":detalle:" + identidad,
                "proveedores": [],
                "programas": por_captura[identidad],
                "ediciones": [],
            }
        )
        observaciones.append(
            {
                "captura": identidad,
                "observado_utc": detalle["utc_fin"],
                "evidencia": usados[identidad],
                "programas": [p["id"] for p in por_captura[identidad]],
            }
        )
    return (lotes, observaciones)


def _preparar(raiz: Path) -> ObjetoJson:
    entradas = {}

    def leer(nombre: str) -> ValorJson:
        """Lee una captura de la ejecución con su procedencia comprobada.

        Returns:
            Bytes y evidencia de captura, o dos None si falta una captura opcional.
        """
        valor, huella = _leer(raiz, nombre)
        entradas[nombre] = huella
        return valor

    manifest = _indice(leer("manifest.json"), "id")
    derivados = _indice(leer("fundae-recursos.json"), "id_recurso_fuente")
    proveedores = _indice(leer("fundae-proveedores.json"), "id")
    usados = {}
    originales = {}
    original = _lector_originales(raiz, manifest, usados, originales)
    catalogos = manifest["fundae_catalogos"]
    _consulta(catalogos, "/Buscador/RecuperarCatalogosEspacioPlataforma", {"idEspacioPlataforma": ["1"]})
    catalogo = _indice(original(catalogos), "idCatalogo")[1]
    _exigir(catalogo["descripcionCatalogo"] == "Digitalizate", "El catálogo 1 ya no identifica Digitalízate")
    buscador = manifest["fundae_catalogo"]
    _consulta(buscador, "/Buscador/BuscarRecursosFormativosFundaeSEB", {"idCatalogo": ["1"]})
    buscados = _indice(original(buscador)["respuesta"], "idRecursoFormativo")
    _exigir(all(r["idCatalogo"] == 1 for r in buscados.values()), "Buscador mezcla catálogos")
    tarjetas = manifest["fundae_recursos1"]
    _consulta(tarjetas, "/Digitalizate/RecuperarRecursosFormativosPorCatalogo", {"idCatalogo": ["1"]})
    tarjetas_ids = set(_indice(original(tarjetas), "idRecursoFormativo"))
    raw = _recursos_de_proveedores(proveedores, manifest, original)
    _exigir(set(raw) == set(derivados) == tarjetas_ids, "Detalle, índice y tarjetas no conservan los mismos recursos")
    _exigir(set(raw) <= set(buscados), "Recurso ajeno al buscador capturado")
    programas, por_captura, excluidos, ids_excluidos, incidencias, normalizaciones_url, cursos_capturados = (
        _convertir_recursos(raw, derivados, catalogo, catalogos, usados)
    )
    _exigir(cursos_capturados, "Captura sin recursos de tipo Curso")
    fuente_lote = "FUNDAE:catalogo-1:offline:" + entradas["manifest.json"]
    lotes, observaciones = _lotes_observados(por_captura, manifest, fuente_lote, catalogos, usados)
    for lote in lotes:
        validar_lote(lote, comprobar_capturas=True, raiz_evidencias=raiz)
        validar_lote_fichas(lote)
    return {
        "lotes": lotes,
        "control": {
            "version_adaptador": VERSION_ADAPTADOR,
            "semantica_temporal": (
                "Lote de agregador con fecha de su catálogo; un lote por captura "
                "de detalle con su utc_fin exacto. No máximo ni mínimo global."
            ),
            "lotes": len(lotes),
            "observaciones_detalle": observaciones,
            "entradas_sha256": entradas,
            "identidad_catalogo": {
                "idCatalogo": 1,
                "descripcionCatalogo": catalogo["descripcionCatalogo"],
                "alcance": (
                    "Identificador del catálogo en RecuperarCatalogosEspacioPlataform"
                    "a y en cada recurso; no paginación/categoría."
                ),
            },
            "capturas_comprobadas": len(usados),
            "evidencias_control": list(usados.values()),
            "recursos_detallados": len(raw),
            "recursos_buscador": len(buscados),
            "ids_solo_buscador": sorted(set(buscados) - set(raw)),
            "programas": len(programas),
            "cursos_capturados": cursos_capturados,
            "cursos_pendientes": len(incidencias),
            "incidencias": incidencias,
            "normalizaciones_url": normalizaciones_url,
            "ediciones": 0,
            "excluidos_por_tipo": dict(excluidos),
            "ids_excluidos": ids_excluidos,
            "conciliacion": False,
            "cobertura_completa": False,
            "limitaciones": [
                "No acredita gratuidad íntegra, matrícula, plazas ni disponibilidad actual.",
                "Marcas y nivel de digitalización publicados no son clasificación ni nivel Faro.",
                "Los recursos excluidos de curso permanecen contabilizados para su tratamiento separado.",
            ],
        },
    }


def construir_lotes(raiz_captura: str | Path) -> list[ObjetoJson]:
    """Devuelve lotes con observaciones fieles por captura, sin una fecha global.

    Returns:
        Lotes por captura, ordenados por observación y precedidos del publicador.
    """
    return preparar_importacion(raiz_captura)["lotes"]


def importar_captura(base: str | Path, raiz_captura: str | Path) -> ObjetoJson:
    """Importa todos los lotes en una transacción pública, sin conciliar ausentes.

    Returns:
        Resultados de la transacción pública y control de la captura importada.
    """
    preparado = preparar_importacion(raiz_captura)
    resultados = cargar_lotes(base, preparado["lotes"], comprobar_capturas=True, raiz_evidencias=raiz_captura)
    return {"importaciones": resultados, "control": preparado["control"]}


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de conversión o importación local.

    Returns:
        Cero si la operación concluye; dos si falla la conversión o conciliación.
    """
    parser = argparse.ArgumentParser(description="Convertir captura Digitalízate local, sin red")
    parser.add_argument("--captura", required=True)
    parser.add_argument("--base", help="Destino; sin base solo emite lotes y control")
    args = parser.parse_args(argv)
    try:
        resultado = importar_captura(args.base, args.captura) if args.base else preparar_importacion(args.captura)
        print(json.dumps(resultado, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
