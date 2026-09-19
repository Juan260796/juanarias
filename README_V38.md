# JUAN CUENTAS v38

## Cambios de borrado
- Se eliminó el botón **Borrar** que aparecía encima de las tablas/listados.
- Las casillas de selección múltiple ya no permanecen visibles.
- Al pulsar **Borrar** o **Quitar** sobre un registro concreto, se activa el modo de selección y ese registro queda seleccionado automáticamente.
- En ese momento aparecen **Seleccionar todos**, **Borrar seleccionados** y **Cancelar selección**.
- El comportamiento se aplicó a pedidos, clientes, servicios, promociones, proveedores y cuentas de inventario.

## Ganancia por pedido
- Al crear un pedido ahora se solicita **Ganancia neta (COP)**.
- La ganancia se guarda en los tres flujos: cuenta de stock, cuenta externa y solo crear pedido.
- El sistema no calcula costos ni márgenes adicionales: usa exactamente el valor de ganancia ingresado.

## Nueva pestaña Ganancias
Incluye tres vistas:
- **Diaria**: total por cada fecha.
- **Semanal**: total por semana de lunes a domingo.
- **Mensual**: total por mes mostrando el nombre del mes y el año.

## Paso obligatorio en Supabase
Antes de usar esta versión, ejecutar en el SQL Editor:

`MIGRACION_V38_DESDE_V37.sql`

Los pedidos anteriores no se incluyen en los reportes de ganancias, porque esa información no existía previamente.
