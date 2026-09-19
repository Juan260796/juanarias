# JUAN CUENTAS v21

Cambios principales sobre v20:

- `Generar nuevo pedido` concentra el flujo de venta y entrega:
  - búsqueda de cliente;
  - búsqueda de servicio;
  - selección de cuenta/grupo disponible;
  - selección de perfil/cupo;
  - Gmail del cliente para Gemini;
  - fecha de inicio y vencimiento automático;
  - creación del pedido;
  - asignación del inventario;
  - generación y envío del mensaje por WhatsApp.
- Se eliminó la pestaña separada `Generar entrega` del inventario.
- El mensaje generado incluye una `×` para cerrarlo.
- Fechas corregidas y unificadas:
  - 09/09 + 1 mes = 09/10;
  - 03/09 + 1 mes = 03/10;
  - 12/07 + 30 días = 11/08.
- En `Stock disponible` se quitó el texto total `perfiles/cupos disponibles` del encabezado.
- Las garantías continúan en `Cuentas Streaming` y su mensaje también puede cerrarse.

No requiere una migración SQL nueva respecto a v20/v19.
