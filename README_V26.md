# JUAN CUENTAS v26

Cambios principales:

- En las cuentas de garantía, cada cliente asignado tiene un botón **WhatsApp garantía**.
- El mensaje usa el formato solicitado con servicio, proveedor, correo, clave, perfil y PIN si existe.
- La garantía conserva el mismo número de perfil/cupo de la cuenta fallida.
- Al abrir el formulario de garantía, los PIN por perfil de la cuenta fallida se precargan para conservarlos por defecto.
- El panel conserva datos históricos de la cuenta fallida para poder reconstruir el mensaje de garantía aunque esa cuenta deje de mostrarse en el inventario principal.

No requiere una migración SQL nueva sobre v25.
