# JUAN CUENTAS v25

Corrección y mejora del flujo **Reemplazar cuenta / garantía**.

- El botón abre un formulario para crear una cuenta de garantía nueva desde cero.
- El servicio queda fijado al mismo de la cuenta fallida.
- Permite proveedor, tiempo, correo/grupo, contraseña opcional, perfiles y PIN por perfil según el tipo de servicio.
- Al guardar, crea la cuenta nueva y mueve de una sola vez todos los perfiles/cupos activos.
- La cuenta nueva se muestra como **Cuenta de garantía** y muestra `cambio por <correo/grupo de la cuenta fallida>`.
- Conserva los pedidos y las fechas originales de compra de los clientes.
- Si el traslado falla, intenta borrar automáticamente la cuenta nueva incompleta para no ensuciar el inventario.

No requiere SQL nuevo si v24 ya funciona.
