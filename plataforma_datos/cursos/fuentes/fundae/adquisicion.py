"""Consulta acotada de los catálogos FUNDAE 1 y 3, sin alta ni oferta implícita.

Los tres GET son públicos y usan transporte/identidad centrales. Una respuesta
correcta de un catálogo no acredita el otro; un fallo conserva su intento y no
se interpreta como censo vacío, baja o disponibilidad individual.
"""

import hashlib
import json
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.fundae import digitalizate, lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "fundae"
ORIGEN = "https://agora.fundae.es"
URLS = {
    "catalogos": ORIGEN + "/Buscador/RecuperarCatalogosEspacioPlataforma?idEspacioPlataforma=1",
    "digitalizate": ORIGEN + "/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=1",
    "subvencionada": ORIGEN + "/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=3",
}
MAX_FILAS = 20_000
METODO = "fundae-presencia-catalogo:1"
METODO_CENSO = "fundae-censo-digitalizate:1"


def pagina(original: Path, captura: dict, nombre: str) -> tuple[object | None, dict]:
    """Verifica recibo y cuerpo antes de interpretar una respuesta JSON.

    Returns:
        JSON identificado o None ante fallo remoto. La corrupción local y los
        errores de formato se propagan: no son una consulta fallida del proveedor.

    Raises:
        FormatoInesperado: Si cuerpo, identidad o estructura son incompatibles.
    """
    comun.exigir(nombre in URLS, "Canal FUNDAE desconocido", FormatoInesperado)
    meta = comun.leer_recibo(original, captura)
    comun.exigir(meta["url"] == URLS[nombre], "Consulta FUNDAE de otro canal", FormatoInesperado)
    inicio = vigencia.instante_utc(meta["inicio_utc"], "inicio FUNDAE")
    fin = vigencia.instante_utc(meta["fin_utc"], "fin FUNDAE")
    comun.exigir(inicio <= fin, "Recepción FUNDAE no causal", FormatoInesperado)
    cuerpo = None
    if captura.get("cuerpo") is not None:
        cuerpo = comun.leer_conservado(original, captura["cuerpo"])
        comun.exigir(
            meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
            "Recibo y cuerpo FUNDAE distintos",
            FormatoInesperado,
        )
    if meta["http"] != HTTPStatus.OK or meta["completo"] is not True or cuerpo is None:
        return None, meta
    comun.exigir(meta["url_final"] == URLS[nombre], "Redirección FUNDAE no acreditada", FormatoInesperado)
    try:
        dato = json.loads(
            cuerpo.decode("utf-8"), object_pairs_hook=digitalizate._pares, parse_constant=digitalizate._constante
        )
    except (UnicodeError, ValueError) as error:
        raise FormatoInesperado("Respuesta FUNDAE no es JSON íntegro") from error
    return dato, meta


def _filas(dato: object, catalogo: int) -> list[dict]:
    comun.exigir(isinstance(dato, dict), "Buscador FUNDAE sin objeto", FormatoInesperado)
    filas = dato.get("respuesta")
    comun.exigir(
        isinstance(filas, list) and 0 < len(filas) <= MAX_FILAS, "Buscador FUNDAE vacío o excesivo", FormatoInesperado
    )
    vistos, nativos = set(), set()
    for f in filas:
        comun.exigir(
            isinstance(f, dict) and type(f.get("idCatalogo")) is int and f["idCatalogo"] == catalogo,
            "Buscador FUNDAE mezcla catálogos",
            FormatoInesperado,
        )
        id = f.get("idRecursoFormativoBuscador")
        comun.exigir(
            type(id) is int and id > 0 and id not in vistos,
            "Identidad de buscador FUNDAE inválida o duplicada",
            FormatoInesperado,
        )
        vistos.add(id)
        if catalogo == 1:
            identidad = f.get("idRecursoFormativo")
            comun.exigir(type(identidad) is int and identidad > 0, "Material Digitalízate sin ID", FormatoInesperado)
        else:
            codigo, modalidad = f.get("codigoTitulacion"), f.get("idModalidad")
            comun.exigir(
                isinstance(codigo, str)
                and codigo.strip() == codigo
                and bool(codigo)
                and type(modalidad) is int
                and modalidad > 0,
                "Variante FUNDAE sin código/modalidad",
                FormatoInesperado,
            )
            identidad = (codigo, modalidad)
        comun.exigir(identidad not in nativos, "Identidad nativa FUNDAE repetida", FormatoInesperado)
        nativos.add(identidad)
    return filas


def observacion(programa: dict, meta: dict, localizador: str | None) -> dict:
    """Registra presencia, sin afirmar lectura completa del universo ni matrícula.

    Returns:
        Observación tipo catálogo compatible con vigencia. Nunca es ficha ni
        acredita por sí sola una oferta, un curso completo o una plaza personal.
    """
    presente = localizador is not None
    cuerpo = {
        "tipo": "catalogo",
        "intentado_el": meta["inicio_utc"],
        "terminado_el": meta["fin_utc"],
        "resultado": "correcta",
        "url_consultada": meta["url"],
        "detalle": {
            "url_final": meta["url_final"],
            "codigo_http": meta["http"],
            "tipo_destino": "catalogo",
            "identidad_buscada": programa["id"],
            "lectura_completa": False,
            "presente": True if presente else None,
        },
        "evidencias": [
            {
                "alcance": "catalogo",
                "url": meta["url"],
                "capturado_utc": meta["fin_utc"],
                "sha256": meta["cuerpo_sha256"],
                "localizador": {"tipo": "campo", "valor": localizador or "/respuesta"},
            }
        ],
    }
    firma = hashlib.sha256(
        json.dumps([programa["id"], cuerpo], sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    return {"id": METODO + ":" + firma, **cuerpo}


def observacion_fallo(programa: dict, meta: dict, captura: dict) -> dict:
    """Registra el fallo de consulta del índice de la unidad, sin leerlo como ausencia.

    Returns:
        Observación de catálogo con resultado de fallo y el recibo como diagnóstico.
    """
    cuerpo = {
        "tipo": "catalogo",
        "intentado_el": meta["inicio_utc"],
        "terminado_el": meta["fin_utc"],
        "resultado": "fallo",
        "url_consultada": meta["url"],
        "detalle": {"motivo": "consulta_fundae_sin_respuesta_valida"},
        "evidencias": [
            {
                "alcance": "diagnostico",
                "url": meta["url"],
                "capturado_utc": meta["fin_utc"],
                "sha256": captura["recibo"]["sha256"],
                "localizador": {"tipo": "campo", "valor": "/http"},
            }
        ],
    }
    firma = hashlib.sha256(
        json.dumps([programa["id"], cuerpo], sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    return {"id": METODO + ":fallo:" + firma, **cuerpo}


def observacion_censo(programa: dict, censo: dict, en_indice: bool | None) -> dict:
    """La presencia de un recurso conocido en un censo completo de Digitalízate, con la evidencia que la acredita.

    El estado lo decide `estado_digitalizate.estado`. La evidencia es la ficha que lo trae; si falta, la ficha de su
    proveedor activo o el 404 de su proveedor que ya no existe; si el proveedor está en la lista de baja, esa lista;
    si no, la lista activa.

    Returns:
        Observación de catálogo compatible con vigencia.
    """
    from plataforma_datos.cursos.fuentes.fundae import estado_digitalizate

    rid, proveedor = programa["datos"].get("id_recurso_fuente"), proveedor_de(programa)
    completa, presente, _ = estado_digitalizate.estado(censo, rid, proveedor, en_indice)
    visto = censo["recursos"].get(rid)
    baja = proveedor in censo["dados_de_baja"] and len(censo["evidencias"]) > 1
    prueba = visto["evidencia"] if visto else censo["pruebas_del_proveedor"].get(proveedor)
    prueba = prueba or censo["evidencias"][1 if baja else 0]
    cuerpo = {
        "tipo": "catalogo",
        "intentado_el": prueba["inicio_utc"],
        "terminado_el": prueba["consultado_utc"],
        "resultado": "correcta",
        "url_consultada": prueba["url"],
        "detalle": {
            "url_final": prueba["url"],
            "codigo_http": prueba["http"],
            "tipo_destino": "catalogo",
            "identidad_buscada": programa["id"],
            "lectura_completa": completa,
            "presente": presente,
        },
        "evidencias": [
            {
                "alcance": "catalogo",
                "url": prueba["url"],
                "capturado_utc": prueba["consultado_utc"],
                "sha256": prueba["cuerpo"]["sha256"],
                "localizador": {"tipo": "campo", "valor": visto["localizador"] if visto else "/"},
            }
        ],
    }
    firma = hashlib.sha256(
        json.dumps([programa["id"], cuerpo], sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    return {"id": METODO_CENSO + ":" + firma, **cuerpo}


def _observaciones(conocidos: dict, leidas: dict, caidos: dict, censo: dict | None) -> tuple[list, list, int]:
    """La observación de cada entidad conocida: por el censo completo, por su índice, o el fallo del índice caído.

    Returns:
        Las observaciones, las unidades con su índice caído y cuántas se esperaban.
    """
    observaciones, fallidas, esperadas = [], [], 0
    for nombre, catalogo in (("digitalizate", 1), ("subvencionada", 3)):
        propios = [p for p in conocidos["programas"] if p["proveedor_id"] == f"fundae:publicador:catalogo:{catalogo}"]
        esperadas += len(propios)
        if catalogo == 1 and censo is not None and censo["completo"]:
            # Una ausencia del censo solo retira si el índice del catálogo 1 respondido ese día tampoco la lista.
            indice = (
                {f["idRecursoFormativo"] for f in leidas["digitalizate"]["filas"]} if "digitalizate" in leidas else None
            )
            for p in propios:
                rid = p["datos"].get("id_recurso_fuente")
                en_indice = None if indice is None else rid in indice
                observaciones.append({"id": p["id"], "observacion": observacion_censo(p, censo, en_indice)})
            continue
        if nombre in caidos:
            # Un índice caído no prueba ausencia: cada unidad suya registra el fallo de la consulta.
            for p in propios:
                observaciones.append({"id": p["id"], "observacion": observacion_fallo(p, *caidos[nombre])})
                fallidas.append(p["id"])
            continue
        del_indice = leidas[nombre]
        indices = {
            f["idRecursoFormativo"] if catalogo == 1 else f["codigoTitulacion"]: "/respuesta/" + str(i)
            for i, f in enumerate(del_indice["filas"])
        }
        for p in propios:
            clave = p["datos"].get("id_recurso_fuente") if catalogo == 1 else p["datos"].get("codigo_especialidad")
            observaciones.append({"id": p["id"], "observacion": observacion(p, del_indice["meta"], indices.get(clave))})
    return observaciones, fallidas, esperadas


def _leer_censo(original: Path, documento: ObjetoJson) -> dict | None:
    from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate

    return censo_digitalizate.leer(original, documento["censo"]) if documento.get("censo") else None


def proveedor_de(programa: dict) -> int | None:
    """El proveedor de Digitalízate de una entidad conocida del catálogo 1.

    Returns:
        Su `idEmpresaDigitalizate`, o None si no consta.
    """
    entidad = programa["datos"].get("entidad_publicada")
    return entidad.get("id") if isinstance(entidad, dict) else None


def huella_de_identidades(conocidos: dict) -> str:
    """La huella de las identidades FUNDAE con las que se calcula un conjunto.

    El conjunto solo se aplica a un almacén con esas mismas identidades.

    Returns:
        SHA-256 de sus identificadores ordenados.
    """
    return hashlib.sha256(json.dumps(sorted(p["id"] for p in conocidos["programas"])).encode()).hexdigest()


def _resumen_del_censo(documento: dict, censo: dict, conocidos: dict, leidas: dict) -> dict:
    """Lo que el conjunto admitido conserva del censo: su documento, si es completo, sus altas y sus avisos.

    Returns:
        El resumen del censo, con las altas que cumplen el criterio de pertenencia.
    """
    from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate

    ya = {p["datos"].get("id_recurso_fuente") for p in conocidos["programas"]}
    from plataforma_datos.cursos.fuentes.fundae import estado_digitalizate

    indice = {f["idRecursoFormativo"] for f in leidas["digitalizate"]["filas"]} if "digitalizate" in leidas else None
    avisos = {}
    for p in conocidos["programas"]:
        if p["proveedor_id"] != "fundae:publicador:catalogo:1":
            continue
        rid = p["datos"].get("id_recurso_fuente")
        aviso = estado_digitalizate.estado(censo, rid, proveedor_de(p), None if indice is None else rid in indice)[2]
        if aviso:
            avisos.setdefault(aviso, []).append(p["id"])
    contradicen = sorted(avisos.get(censo_digitalizate.CONTRADICE, []))
    return {
        "documento": documento,
        "identidades_sha256": huella_de_identidades(conocidos),
        "completo": censo["completo"],
        "motivo": censo["motivo"] or (censo_digitalizate.CONTRADICE if contradicen else None),
        "sin_noticia": sorted(avisos.get(censo_digitalizate.FORMA, [])),
        "dados_de_baja": censo["dados_de_baja"],
        "no_disponibles": censo["no_disponibles"],
        "contradicen": contradicen,
        "proveedores": len(censo["proveedores"]),
        "recursos": len(censo["recursos"]),
        "fallidas": censo["fallidas"],
        "descuadres": censo["descuadres"],
        "altas": censo_digitalizate.altas(censo, ya),
    }


def calcular(original: Path, documento: ObjetoJson, conocidos: dict) -> dict:
    """Reproduce solo capturas identificadas y las cruza con entidades admitidas.

    Returns:
        Observaciones de catálogo y variantes observadas, nunca altas/ediciones
        fabricadas. El censo global y los destinos individuales siguen sin acreditar.
    """
    comun.exigir(
        documento.get("fuente_id") == FUENTE and documento.get("schema_version") == 1,
        "Procedencia FUNDAE ajena",
        FormatoInesperado,
    )
    aux = documento.get("auxiliares")
    comun.exigir(isinstance(aux, dict) and set(aux) == set(URLS), "Canales FUNDAE incompletos", FormatoInesperado)
    comun.exigir(
        conocidos.get("schema_version") == 1 and conocidos.get("fuente_id") == FUENTE,
        "Identidades FUNDAE de otro contrato",
        FormatoInesperado,
    )
    leidas, fallos, caidos = {}, [], {}
    for nombre, cap in aux.items():
        dato, meta = pagina(original, cap, nombre)
        if dato is None:
            fallos.append({"canal": nombre, "http": meta["http"], "fin_utc": meta["fin_utc"], "captura": cap})
            caidos[nombre] = (meta, cap)
            continue
        if nombre == "catalogos":
            comun.exigir(
                isinstance(dato, list) and all(isinstance(f, dict) and type(f.get("idCatalogo")) is int for f in dato),
                "Índice FUNDAE incompatible",
                FormatoInesperado,
            )
            ids = [f["idCatalogo"] for f in dato]
            comun.exigir(
                len(ids) == len(set(ids)) and {1, 3} <= set(ids),
                "Catálogos FUNDAE ausentes o duplicados",
                FormatoInesperado,
            )
            filas = dato
        else:
            filas = _filas(dato, 1 if nombre == "digitalizate" else 3)
        leidas[nombre] = {"filas": filas, "meta": meta}
    # El censo completo de Digitalízate acredita presencia y ausencia del catálogo 1; si no, manda el índice.
    censo = _leer_censo(original, documento)
    observaciones, fallidas, esperadas = _observaciones(conocidos, leidas, caidos, censo)
    resultado = {
        "schema_version": 1,
        "fuente_id": FUENTE,
        "metodo": METODO,
        "recepciones": documento.get("capturas", []),
        "auxiliares": aux,
        "fallos": fallos,
        "observaciones_catalogo": observaciones,
        "censo_completo": False,
        "cobertura": {n: len(v["filas"]) for n, v in leidas.items()},
        "limites": [
            "Presencia en agregador no acredita destino, disponibilidad individual, gratuidad individual ni edición."
        ],
    }
    if censo is not None:
        resultado["censo"] = _resumen_del_censo(documento["censo"], censo, conocidos, leidas)
    if fallos:
        resultado["consulta_parcial"] = {
            "canales_fallidos": sorted(caidos),
            "unidades_fallidas": sorted(fallidas),
            "unidades_esperadas": esperadas,
        }
    return resultado


def _recibir_dato(url: str, carpeta: Path) -> dict:
    return comun.recibir_url(url, carpeta, None, perfil="datos")


def descargar(conocidos: dict, original: Path, anterior: dict) -> lectura.Resultado:
    """Recibe tres índices en serie; ningún destino de terceros ni cuenta.

    Los intentos y fechas se conservan incluso ante respuesta fallida. Un error
    local de integridad/programación se propaga, sin reemplazar la versión admitida.
    Al final emite la lectura del censo; si no se puede emitir, el resultado lo dice y nada más cambia.

    Returns:
        La lectura emitida y los problemas que impidieron emitirla, si los hubo.
    """
    comun.exigir(conocidos.get("fuente_id") == FUENTE, "Identidades de otra fuente", FormatoInesperado)
    auxiliares, censo = {}, None
    try:
        for nombre, url in URLS.items():
            auxiliares[nombre] = comun.recibir_url(url, original, None, perfil="datos")
        # El censo de Digitalízate: la lista de proveedores y una ficha por proveedor con cursos.
        from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate

        # También se pide la ficha de cada proveedor con recursos ya conocidos, aunque falte de la lista.
        proveedores = {
            p["datos"]["entidad_publicada"]["id"]
            for p in conocidos.get("programas", [])
            if isinstance(p["datos"].get("entidad_publicada"), dict)
        }
        censo = censo_digitalizate.consultar(original, _recibir_dato, proveedores)
    finally:
        comun.guardar_capturas_de_fuente(original, FUENTE, [], anterior, auxiliares, censo=censo)
    return lectura.emitir(original, censo, anterior, _leer_censo)
