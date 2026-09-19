# JUAN CUENTAS v23

Corrección del cálculo de duración por días.

- Los servicios definidos en días suman exactamente la cantidad de días calendario indicada.
- 31/01 + 30 días = 02/03 en año no bisiesto.
- 12/07 + 30 días = 11/08.
- 12/09 + 30 días = 12/10.
- Las duraciones en meses siguen conservando el mismo número de día cuando existe.
- No requiere migración SQL nueva.
