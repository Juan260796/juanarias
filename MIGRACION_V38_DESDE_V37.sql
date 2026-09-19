-- JUAN CUENTAS v38
-- Ejecutar una sola vez en el SQL Editor de Supabase antes de usar la nueva versión.
-- Agrega el valor exacto de ganancia neta por pedido y la fecha usada para los reportes.

alter table public.suscripciones
  add column if not exists ganancia_neta numeric(14,2);

alter table public.suscripciones
  add column if not exists fecha_ganancia date;

-- Los pedidos antiguos no tenían ganancia registrada. Se conservan con ganancia NULL
-- para que no se mezclen con los nuevos reportes. La fecha se completa por consistencia.
update public.suscripciones
set fecha_ganancia = coalesce(fecha_ganancia, fecha_inicio, current_date)
where fecha_ganancia is null;

alter table public.suscripciones
  alter column fecha_ganancia set default current_date;

alter table public.suscripciones
  alter column fecha_ganancia set not null;

create index if not exists suscripciones_fecha_ganancia_idx
  on public.suscripciones (fecha_ganancia desc);
