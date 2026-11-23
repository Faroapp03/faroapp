# Comprobación de la cadena

## Comprobación

```sh
npm run verificar
```

Incluye Ruff, formato y las pruebas Python, además de los controles del resto de la aplicación.
Para ejecutar solamente las pruebas Python, desde la raíz del producto:

```sh
.venv/bin/python scripts/pruebas_python.py
```

Las pruebas utilizan temporales y respuestas de red simuladas; no actualizan las fuentes ni los datos
publicados. El control falla si una prueba falla o si no se ha ejecutado ningún caso efectivo.
Las pruebas por propiedades de los lectores PDF requieren Hypothesis, incluido en `requirements-dev.txt`;
usan ejemplos reproducibles y no conservan una base de casos en el producto.

`pruebas/test_ensayo_circuito.py` ensaya el circuito completo en ciclos encadenados, dentro de la batería: cada ronda
es un proceso real de actualización (`pruebas/capturas_controladas/orden.py`) sobre una instalación temporal con su
propia copia del código, y la web publicada se lee con el cargador real del catálogo (`cargarCatalogo`). Solo se
sustituyen las respuestas externas, en `red._abrir` (`pruebas/capturas_controladas/sitecustomize.py`, con la guardia
de red), y las órdenes de construcción y verificación del producto completo. Los ciclos son una actualización con
cambios, una repetición sin cambios, un cambio de una palabra en una ficha de más de 4 MiB, una respuesta parcial
(503 y cuerpo cortado), un fallo remoto seguido de una recomposición local que conserva el reintento, un cierre
declarado por la ficha, un corte real del proceso (SIGKILL) y su recuperación con `--pendientes`, el panel con las
marcas reales de consulta parcial de Cibernàrium y FUNDAE, y una ronda tras un cambio del código que admite el
catálogo. Ese cambio obliga a revalidarlo: el primer paso de cada actualización
(`python -m plataforma_datos.cursos.revalidar_catalogo`, sobre lo publicado y antes de copiar el área) repite su
auditoría completa con el código vigente, sin tocar la instantánea. Para ejecutarlo solo:

```sh
.venv/bin/python -m unittest plataforma_datos.orquestacion.pruebas.test_ensayo_circuito
```

