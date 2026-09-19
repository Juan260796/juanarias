-- JUAN CUENTAS v19
-- Agrega vencimiento propio a cada cuenta Streaming del inventario.
-- No borra clientes, pedidos ni servicios.

alter table public.inventario_cuentas
  add column if not exists fecha_vencimiento date;

-- Completa el vencimiento de cuentas antiguas usando su fecha de carga
-- y la duración que ya estaba guardada.
update public.inventario_cuentas
set fecha_vencimiento = case
  when coalesce(duracion_tipo, 'dias') = 'meses'
    then (coalesce(fecha_carga, current_date) + make_interval(months => greatest(1, coalesce(duracion_cantidad, 1))))::date
  else (coalesce(fecha_carga, current_date) + greatest(1, coalesce(duracion_cantidad, 1)))::date
end
where fecha_vencimiento is null;

create index if not exists inventario_cuentas_fecha_vencimiento_idx
  on public.inventario_cuentas(fecha_vencimiento);

grant select on public.inventario_cuentas to authenticated;
grant select, insert, update, delete on public.inventario_cuentas to service_role;

notify pgrst, 'reload schema';
