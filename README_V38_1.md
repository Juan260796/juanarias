# JUAN CUENTAS v38.1

Corrección de seguridad de carga:

- Si todavía no se ejecutó `MIGRACION_V38_DESDE_V37.sql`, el panel ya NO queda vacío.
- Clientes, servicios, inventario y pedidos continúan cargando con el esquema anterior.
- La pestaña Ganancias muestra un aviso indicando que falta ejecutar la migración.
- No se modificó ni se elimina información de la tabla `clientes` durante esta actualización.

Para habilitar el registro y reportes de ganancias, ejecutar una sola vez `MIGRACION_V38_DESDE_V37.sql` en el SQL Editor de Supabase.
