# Atribución de campos a un canal actual

El cargador conserva su regla por defecto: una actualización compuesta con capturas repetidas y negocio distinto queda pendiente. La opción tipada permite actualizar campos cuyo productor dispone de una atribución revisada y explícita; no interpreta fuentes ni acredita por sí sola la verdad de sus hechos.

```python
contrato = ContratoCanal(
    id="fuente-curso",
    version=1,
    entidad="programa",
    campos=("/titulo", "/datos/cuerpo_html_publicado"),
)
canales = CanalesAtribuidos(
    canales_por_lote=(tuple(canales_del_lote),),
    contratos=(contrato,),
)
catalogo.cargar_lote(base, lote, True, raiz_evidencias, canales_temporales=canales)
```

`cargar_lotes` acepta el mismo objeto con un grupo de canales por lote. Las listas y firmas anteriores siguen admitidas. El objeto copia las estructuras JSON antes de utilizarlas; las definiciones y sus colecciones son inmutables. Un canal que utiliza el contrato declara `canal=contrato.clave`, sin otro nombre elegido por el llamador.

La clave `atribucion-campos:<id>:<version>:<SHA>` incluye la huella del documento canónico devuelto por `contrato.documento()`. Ese material contiene versión de forma, identidad, entidad y punteros exactos. El productor conserva el documento y su SHA de archivo como procedencia de la admisión de la instantánea. La clave queda en las tablas existentes de canales/pruebas; no cambia el esquema SQLite ni se ejecuta código indicado por un JSON.

El primer anclaje exige una entidad ya existente y negocio íntegro idéntico, incluidos los campos ajenos al mapa. Se aportan los canales históricos protegidos con sus evidencias exactas y la captura actual que el productor ha contrastado contra la proyección. Este paso no atribuye campos a documentos antiguos ni modifica sus fechas, decisiones o contenido. El cargador puede registrar la ejecución del anclaje sin crear una nueva versión de negocio; no debe confundirse con una adquisición remota nueva.

Después se compara el estado nativo real con su huella, los intervalos de cada canal y el diff de negocio dentro de la misma transacción. Un cambio exige captura estrictamente posterior en su canal. Una captura repetida solo permite conservar la misma proyección; todos los campos fuera del mapa permanecen exactos. Presencia, null, false y cero se distinguen mediante JSON canónico. Los canales históricos conservan sus evidencias: no se atribuye su fecha a los campos del canal actual.

Los punteros no admiten comodines ni solapes, no abarcan el objeto completo y no permiten cambiar la identidad. Las definiciones protegidas no se pueden omitir utilizando una API antigua. Cambiar mapa/versión, sustituir una clave o ampliar un ámbito requiere una transición explícita; este componente no implementa ni presupone esa transición. La regla conservadora anterior se mantiene si no hay contrato de campos.

El productor es responsable de comprobar la semántica campo→captura, la fecha real del recibo, identidad y cobertura del cuerpo, y de invalidar las derivadas afectadas. La atribución no convierte una fecha declarada sin soporte en consulta real, una respuesta legible en disponibilidad, ni un lote parcial en censo. Las funciones de preparación/admisión deben conservar el contrato y los originales y rechazar una preparación incompleta. Tampoco se añade otra autoridad de vigencia o publicación.
