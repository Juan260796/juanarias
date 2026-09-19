# JUAN CUENTAS v19

Cambios principales:
- Cuentas activas: mantiene renovación individual por pedido/perfil y muestra el perfil/cupo asignado.
- Cuentas Streaming: la renovación es de la cuenta completa del inventario, independiente de los perfiles/cupos de clientes.
- Cada cuenta Streaming tiene vencimiento propio y días restantes.
- Al borrar un pedido de Cuentas activas se eliminan sus asignaciones para liberar inmediatamente el perfil/cupo.
- Limpieza automática de asignaciones antiguas que quedaron huérfanas o ligadas a pedidos inactivos.
- Las cuentas Streaming con 5 días vencidas se archivan del panel y liberan sus perfiles/cupos.
- Stock disponible ahora tiene una pestaña separada con tarjetas compactas.
- Lista de clientes simplificada, con botón (+) Agregar cliente y formulario rápido que incluye contraseña.
- Todos los borrados conservan confirmación antes de ejecutarse.

## Actualización necesaria en Supabase
Ejecuta `MIGRACION_V19_DESDE_V18.sql` una sola vez en SQL Editor antes de usar v19.

## Variables de Vercel
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SECRET_KEY

## v21

La venta y la entrega se unifican en **Generar nuevo pedido**. La pestaña separada de Generar entrega fue retirada. No requiere SQL adicional si v20/v19 ya está funcionando.

## v27 - Control de duplicados
Ejecuta `MIGRACION_V27_DESDE_V26.sql` una sola vez en Supabase. Esta versión impide repetir servicios con el mismo tiempo, clientes con nombre/usuario/celular repetidos y proveedores con las mismas iniciales.

## v34 — Google Sheets

La v34 agrega respaldo en tiempo real de clientes y de todos los pedidos cuyo proveedor sea `JU`. Configura `GOOGLE_SHEETS_WEBAPP_URL` y `GOOGLE_SHEETS_SYNC_TOKEN` en Vercel. En Clientes usa una vez `☁️ Sincronizar respaldo` para cargar al Sheet los datos existentes; después los cambios nuevos se sincronizan automáticamente.

## v35 — Edición de pedidos y borrado múltiple

- En Cuentas activas/vencidas se puede corregir fecha de inicio, servicio y perfil/cupo.
- La fecha final se recalcula al guardar cuando corresponde.
- Se valida que el perfil/cupo esté libre y que el servicio sea compatible con la cuenta de stock asignada.
- Se agregó selección múltiple para borrar pedidos, clientes, servicios, promociones, proveedores y cuentas de inventario.
- No requiere SQL adicional.
