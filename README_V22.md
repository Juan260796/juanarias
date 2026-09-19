# JUAN CUENTAS v22

Corrección únicamente del cálculo comercial de fechas para planes de 30 días.

- 12 julio + 30 días => 11 agosto.
- 12 septiembre + 30 días => 12 octubre.
- 12 febrero + 30 días => 12 marzo.
- Los planes expresados en meses conservan el mismo día del mes cuando existe.
- Las duraciones distintas de 30 días se suman como días calendario exactos.

No requiere migración SQL nueva.
