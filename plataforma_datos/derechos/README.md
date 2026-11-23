# Derechos

El lector `fuentes/derechos/lector.py` comprueba citas de formación y tecnología contra los originales conservados del BOE y del Consell de Relacions Laborals. La extracción por páginas del PDF permanece vinculada a su procedencia; el traslado no genera otra extracción ni acredita vigencia jurídica posterior.

Los originales, la preparación y la validación conservan sus casas en `var/actualizacion/`. `fuentes/derechos/exportacion.py` compone `derechos.json` únicamente desde entradas admitidas; la publicación sigue perteneciendo al exportador común.

`fuente.json` declara la política existente y su README se genera con `python -m plataforma_datos.contratos.fuentes --tema derechos`. El lector se invoca desde la raíz con `python -m plataforma_datos.derechos.fuentes.derechos.lector`. Las pruebas están en `pruebas/`; no requieren originales reales ni red.
