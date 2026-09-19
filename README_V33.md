# JUAN CUENTAS v33

## Programa de fidelidad
- El contador del cliente se reinicia cada 10 pedidos.
- Al completar exactamente 10, 20, 30... pedidos se mantiene el mensaje de GANADOR hasta que entra un pedido nuevo.
- Los premios pendientes siguen visibles debajo del contador aunque el ciclo ya se haya reiniciado.
- En Administrador > Promociones aparece la pestaña **Premios** con pendientes y redimidos.
- El botón **Marcar entregado** mueve el premio a Redimidos.
- Los redimidos dejan de mostrarse 2 días después, aunque su registro interno se conserva para impedir que se regenere el mismo premio.

## Importante
Ejecutar una vez `MIGRACION_V33_DESDE_V32.sql` en Supabase antes de desplegar esta versión.
