# Control fijado del clasificador

control.json conserva los 305 casos exactos de la exportación original. huellas.json vincula sus bytes con los del modelo admitido de datos/clasificador-movil.json; no se duplica el modelo. La herramienta comprueba esta vinculación y la paridad de las predicciones en ambos modos.

El productor histórico es recorrido-v2/clasificador/faro_clasificador_export.py y los artefactos proceden de clasificador/export. El control contiene 200 frases de bancos de desarrollo, 100 de entrenamiento y cinco casos técnicos. Acredita paridad de implementación, no precisión independiente. Las probabilidades esperadas proceden de la exportación Python del modelo podado y cuantizado; no deben regenerarse con el consumidor TypeScript.
