# Biblioteca

La autoría editorial del catálogo vive en `fuentes/lecturas/catalogo.json`, versionada
junto con su procedencia. `datos/lecturas.json` sigue siendo la entrega que consumen
las páginas. La incorporación inicial conserva sus 75 lecturas byte a byte.
El formateador no reescribe ese archivo de autoría: sus bytes están firmados en
`procedencia.json` y se conservan al exportar. Los contratos de JSON, referencias
y contenido siguen comprobándose; la excepción de formato solo afecta a ese archivo.

El productor `fuentes/lecturas/lector.py` prepara y admite una copia local; no descarga
publicaciones, consulta enlaces ni comprueba vigencia remota. Requiere Python 3.12 y
Node local compatible con los módulos TypeScript del repositorio. El puente
`validar_catalogo.ts` llama a `comoRegistro` y `comprobarReferencias` existentes: no
mantiene reglas alternativas para idiomas, tipos, IDs o referencias.

```sh
python -m plataforma_datos.biblioteca.fuentes.lecturas.lector preparar
python -m plataforma_datos.biblioteca.fuentes.lecturas.lector validar
```

Las etapas usan la casa operativa `lecturas` en `var/actualizacion`; las pruebas y el
ensayo de incorporación la sustituyen por una carpeta temporal. La función
`exportar(destino: Path) -> Path` permite al exportador común entregar el archivo a un
destino explícito. Comprueba la admisión, las entradas y los contratos actuales, y la
huella del validado antes del reemplazo atómico. No reescribe un archivo idéntico.
El productor está conectado a los registros y al exportador común. Este prepara
la Biblioteca junto con los demás archivos antes de promover la entrega; si falla
la promoción, restaura también el catálogo anterior. El manifiesto ocupacional
conserva su alcance: no incorpora las lecturas editoriales.

La fecha `revisado` pertenece al registro editorial. `consultado`, `fecha`, idiomas,
licencias y enlaces de cada lectura se conservan sin transformación. Ejecutar una
etapa no renueva esas fechas. El informe fecha únicamente su comprobación local;
repetir con el mismo resultado conserva también esa fecha y los bytes del informe.
No se declara un plazo de vigencia editorial: queda explícitamente no acreditada y
la revisión pendiente. Una fecha editorial desconocida se conserva como desconocida.

Para una modificación editorial, revisar el catálogo y sus referencias y actualizar
su huella y revisión declarada en `procedencia.json`. La procedencia no atribuye la
fecha general a cada lectura ni presenta una copia local como nueva captura remota.
Los resúmenes son propios; las publicaciones conservan sus condiciones declaradas.
Un fallo de validación no autoriza retirar lecturas o exportar una admisión antigua.

La ficha operativa está en `fuentes/lecturas/fuente.json`; su README se genera con
`plataforma_datos.contratos.fuentes`. No contiene una segunda configuración de la
política ni activa consultas automáticas.

## Comprobación técnica de enlaces

`fuentes/enlaces_lecturas/` consulta los enlaces del catálogo y conserva capturas
con su fecha real, identidad y resultado. Está conectado al registro común, al
planificador semanal y al exportador. La entrega `datos/observaciones-lecturas.json`
se prepara y promueve junto con el catálogo; ambos recuperan sus bytes anteriores
si falla la promoción. No entra en el manifiesto del motor de ocupaciones.

La primera ejecución sin capturas entrega `sin_observacion`, con fecha vacía;
no presenta la fecha de instalación como comprobación. Una respuesta HTTP correcta
requiere además evidencia específica de identidad. Los estados desconocidos o
vencidos no cuentan como verificados. Los fallos conservan el historial y nunca
retiran ni rejuvenecen la lectura editorial. La conexión pública del resultado y
la primera consulta remota todavía requieren su comprobación de activación.

El historial se indexa temporalmente por URL e instante de captura. Solo se extraen
los contenidos candidatos a última observación o confirmación; cada operación
reutiliza diagnósticos por huella, MIME y versión del método. El índice y la caché
son acotados; los inventarios de procedencia conservan la lista completa de archivos
para mantener el contrato de integridad y recuperación.
