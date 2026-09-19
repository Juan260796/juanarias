# JUAN CUENTAS v24

Cambios de esta versión:

- Al copiar el mensaje de una entrega aparece un aviso compacto `Texto copiado ✓`.
- La pestaña `Cargar cuentas` ahora se llama `Añadir cuentas`.
- El formulario se llama `Añadir cuenta disponible`.
- Después de añadir una cuenta se limpian servicio, proveedor, tiempo, cantidad y número de perfiles, además de los datos de acceso.
- La contraseña sigue siendo opcional.
- `Reemplazar / garantía` ahora trabaja por **cuenta completa**: mueve en una sola acción todos los perfiles/cupos activos de la cuenta fallida hacia una nueva cuenta del mismo servicio.
- La cuenta nueva se muestra como `cuenta de garantía` y en la tabla indica `cambio por <cuenta fallida>`.
- Se generan mensajes de garantía para cada cliente afectado, conservando la fecha original de compra.

No requiere SQL nuevo sobre v23.
