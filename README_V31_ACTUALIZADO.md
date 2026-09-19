# JUAN CUENTAS v31 actualizado

Incluye todos los cambios de v31 y corrige la prioridad del stock.

## Orden de prioridad del inventario

1. Primero las cuentas con MENOS perfiles/cupos libres.
2. Si dos cuentas tienen la misma cantidad libre, primero la cuenta con fecha de creación MÁS ANTIGUA.
3. Las cuentas fallidas se muestran al final en Cuentas Streaming.

La misma prioridad se usa al seleccionar una cuenta de stock al crear un nuevo pedido y en la tabla Cuentas Streaming.

No requiere SQL nuevo.
