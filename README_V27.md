# JUAN CUENTAS v27

Cambios de control de duplicados:

- Servicios streaming: no permite repetir el mismo nombre con el mismo tiempo.
- 30 días y 1 mes se consideran la misma duración para evitar duplicados.
- 12 meses y 1 año se consideran la misma duración.
- Clientes: no permite repetir nombre, usuario ni número de celular.
- Proveedores: no permite repetir las mismas iniciales, aunque exista como proveedor inactivo/archivado.
- Los controles aplican tanto al crear como al editar.
- La API muestra mensajes claros cuando se intenta duplicar información.

Antes de usar v27, ejecutar MIGRACION_V27_DESDE_V26.sql en Supabase SQL Editor.
