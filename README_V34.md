# JUAN CUENTAS v34 — Respaldo automático en Google Sheets

## Qué agrega

- Sincronización automática de clientes hacia la pestaña `Clientes` de Google Sheets.
- Al crear o editar un cliente se actualiza la misma fila por ID.
- Al borrar un cliente se marca como `Eliminado` en Google Sheets.
- Cualquier pedido cuyo proveedor sea `JU` se registra en `Pedidos JU`, sin importar el servicio.
- Renovaciones, cambios de cuenta/proveedor y garantías actualizan el respaldo.
- Al borrar un pedido JU se marca como `Eliminado`.
- Cuando un pedido se archiva por vencimiento queda como `Finalizado`.
- No se envían contraseñas ni PIN.
- Botón `☁️ Sincronizar respaldo` en Clientes para copiar los clientes y pedidos JU ya existentes.

## Variables requeridas en Vercel

```text
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/.../exec
GOOGLE_SHEETS_SYNC_TOKEN=el_mismo_token_del_apps_script
```

Además se conservan las variables de Supabase de las versiones anteriores.

## Base de datos

Esta versión no requiere SQL nuevo.
