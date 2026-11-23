# Entradas fijadas de la hoja de ruta

Estas cuatro entradas operativas permiten reconstruir comarcas.json y temarios.json sin red ni carpetas externas de trabajo. Sus huellas se comprueban antes de transformar y se registran en datos/manifiesto.json. No deben reformatearse.

La lista de municipios procede del Idescat, consulta del 21/10/2026: https://www.idescat.cat/codis/?id=50&n=9&f=ssv. Los extractos corresponden a las fichas oficiales SEPE, Consorci y FUNDAE identificadas en textos.jsonl; procedencia.json conserva la fecha y el registro de descarga. Las condiciones de cada fuente se conservan en temarios.json y datos/README.md.

Comprobación sin escritura: `.venv/bin/python -m plataforma_datos.cursos.fuentes.hoja_de_ruta.lector todo --comprobar`.
