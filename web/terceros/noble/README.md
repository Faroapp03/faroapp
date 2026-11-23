# Noble

Código de `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0 y `@noble/post-quantum` 0.7.1,
con licencia MIT. Cada carpeta conserva su `LICENSE` y los avisos del proveedor.
`procedencia.json` registra la integridad del paquete npm y las SHA-256 del original y de la copia.

Las firmas del navegador importan Ed25519, SHA-256, ML-DSA-65 y SLH-DSA-SHAKE-192s.
Se conserva su cierre de importaciones estáticas, incluidos los módulos que estos archivos importan
para otras exportaciones y los tipos transitivos. No se han podado exportaciones ni modificado algoritmos.

Respecto al paquete npm, las copias de procedencia cambian los imports por nombre de paquete a rutas
relativas y retiran la referencia al mapa de fuentes. Los archivos de biblioteca se conservan íntegros
con las huellas registradas; el formato y las reglas de estilo del código propio no se aplican al proveedor.
