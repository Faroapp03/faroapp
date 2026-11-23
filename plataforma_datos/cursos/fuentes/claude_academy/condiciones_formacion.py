"""Inscripción y modalidad publicadas, separadas de lectura, práctica y acreditación."""

import hashlib
import json
from urllib.parse import parse_qs, urljoin, urlsplit

from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas as comercio
from plataforma_datos.cursos.fuentes.claude_academy import lector

FAQ = acceso.ORIGEN + "/help/faq"
REGLA = "academy-inscripcion-progreso:1"
HUELLA_SECCION = "e571e0d8f2f551a4feec003fca3588ca03a4f7a1cb09e0de9f349612b4579e4a"
HUELLA_PARRAFO = "ee33c99cfac636008484cd2922a6e068a096323109cc4decae5b76c67e90d5e8"
FRAGMENTO = "signing in with a free Claude account is what saves your progress and lets you earn completion badges"


def declaracion_inscripcion(cuerpo: bytes, meta: dict) -> lector.EvidenciaTexto | None:
    """Reconoce la sección completa revisada, no una frase aislada de otra finalidad.

    Returns:
        Declaración original con localizador, o incertidumbre si cambia el contexto.
    """
    pagina, _ = acceso._documento(cuerpo, meta, FAQ)
    lector._exigir(
        pagina.titulos == ["FAQ · Claude Academy"] and acceso._titulo(pagina) == "Frequently asked questions",
        "FAQ Academy de identidad distinta",
    )
    ambitos = comercio._Metadatos(FAQ)
    ambitos.feed(cuerpo.decode("utf-8"))
    ambitos.close()
    dentro, seccion, candidatas = False, [], []
    for bloque in sorted(pagina.bloques, key=lambda b: (b.inicio, -b.fin)):
        texto = lector._plano("".join(pagina.fragmentos[bloque.inicio : bloque.fin]))
        if bloque.tag == "h2":
            dentro = texto == "Sign-in and access"
        if dentro and bloque.tag in {"h2", "h3", "p"}:
            if "/blockquote[" in bloque.ruta or not ambitos.bloque_propio(lector._evidencia(texto, bloque)):
                return None
            seccion.append([bloque.tag, texto])
            if bloque.tag == "p" and hashlib.sha256(texto.encode()).hexdigest() == HUELLA_PARRAFO:
                candidatas.append(lector._evidencia(texto, bloque))
    huella = hashlib.sha256(json.dumps(seccion, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return candidatas[0] if huella == HUELLA_SECCION and len(candidatas) == 1 else None


def enlace_inscripcion(ficha: lector.FichaAcademy) -> lector.EnlaceAcademy | None:
    """Exige el enlace propio de guardar progreso; no lo abre ni crea una sesión.

    Returns:
        Enlace al login de Academy con retorno exacto a esta ficha, o None.
    """
    enlaces = []
    for enlace in ficha.enlaces:
        if enlace.texto != "Sign in to save progress":
            continue
        try:
            partes = urlsplit(urljoin(ficha.url, enlace.href))
        except ValueError:
            return None
        consulta = parse_qs(partes.query, keep_blank_values=True)
        if (
            enlace.texto == "Sign in to save progress"
            and partes.scheme == "https"
            and partes.netloc == lector.HOST_ACADEMY
            and partes.path == "/login"
            and not partes.fragment
            and consulta == {"returnTo": [urlsplit(ficha.url).path]}
        ):
            enlaces.append(enlace)
    return enlaces[0] if len(enlaces) == 1 else None


def modalidad(cuerpo: bytes, ficha: lector.FichaAcademy) -> dict | None:
    """Lee CourseInstance propio; un curso/producto ajeno no presta su modalidad.

    Returns:
        Modalidad Online con localizador literal, o None si falta o discrepa.
    """
    pagina = comercio._Metadatos(ficha.url)
    pagina.feed(cuerpo.decode("utf-8"))
    pagina.close()
    candidatas = []
    for numero, texto in enumerate(pagina.jsonld, 1):
        try:
            dato = recibos_compartidos.leer_json(texto.encode())
        except ValueError:
            return None
        elementos = dato if isinstance(dato, list) else [dato] if isinstance(dato, dict) else []
        if isinstance(dato, dict) and isinstance(dato.get("@graph"), list):
            elementos = dato["@graph"]
        for curso in elementos:
            if not isinstance(curso, dict) or curso.get("@type") != "Course" or curso.get("url") != ficha.url:
                continue
            if curso.get("name") != ficha.titulo:
                return None
            instancias = curso.get("hasCourseInstance")
            if (
                not isinstance(instancias, list)
                or not instancias
                or any(
                    not isinstance(i, dict) or i.get("@type") != "CourseInstance" or i.get("courseMode") != "Online"
                    for i in instancias
                )
            ):
                return None
            candidatas.append(
                {
                    "valor": "en-linea",
                    "literal": "Online",
                    "localizador": f'script[type="application/ld+json"] número {numero}/hasCourseInstance/courseMode',
                }
            )
    return candidatas[0] if len(candidatas) == 1 else None
