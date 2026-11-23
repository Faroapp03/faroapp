# Exportación del paquete

## Exportación del paquete

`exportar_paquete.py` reúne las proyecciones de `exportacion/`: lee fuentes admitidas en
`var/actualizacion/` y genera el paquete del motor con su `manifiesto.json`. El manifiesto registra
las huellas de los archivos exportados y de sus orígenes. ESCO se lee de la biblioteca SQLite validada,
en modo de solo lectura; no se reconstruye ni modifica durante la exportación.

Con el entorno `.venv` instalado y las entradas operativas preparadas y validadas, se puede generar
un candidato en otra carpeta sin sustituir el paquete oficial:

```sh
npm run datos:exportar -- --destino "var/paquete candidato"
```

Sin `--destino`, la orden escribe en `datos/`. Primero prepara los archivos, las copias opcionales y
el manifiesto fuera del destino. Ante un error durante la sustitución, intenta restaurar los archivos
anteriores; si tampoco puede restaurarlos, conserva el respaldo y explica dónde recuperarlo. Esta
recuperación no garantiza una sustitución indivisible ante un corte del sistema. Ejecutar sin otros
escritores y con las entradas estables. Una recuperación incompleta exige revisar el destino antes
de publicarlo de nuevo.

La exportación gestiona únicamente sus archivos: conserva `README.md`, `globales/`
y otros recursos ajenos. Exporta `lecturas.json` mediante su productor editorial,
con admisión y recuperación comunes, sin añadirlo al manifiesto ocupacional. Retira los opcionales que ya no exporta y los antiguos conjuntos excluidos.
Los vectores y los enlaces comprobados ya existentes se copian y registran; esta orden no llama a
modelos, consulta enlaces ni regenera esos recursos. Si faltan, lo indica como recurso opcional ausente.

La construcción de la web (`npm run web:preparar` o `npm run construir`) prepara después la copia para el
navegador, comprobando las huellas
del paquete oficial antes de escribirla. No despliega nada en Internet. Los datos globales se publican
por su orden específica, `npm run globales:generar`, desde `datos/globales/`; no forman parte del
manifiesto del motor.

