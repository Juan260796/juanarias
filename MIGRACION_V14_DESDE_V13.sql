-- JUAN CUENTAS v14
-- 1) PIN individual por perfil.
-- 2) Corrige una sola vez las fechas antiguas que quedaron con 1 día extra.
-- Esta migración NO borra clientes, cuentas, pedidos ni garantías.

alter table public.inventario_cuentas
  add column if not exists perfiles_pins jsonb not null default '{}'::jsonb;

-- Si una cuenta antigua tenía un PIN general, lo conservamos como PIN de
-- todos sus perfiles para no perder la información existente.
update public.inventario_cuentas ic
set perfiles_pins = coalesce((
  select jsonb_object_agg(gs::text, ic.pin)
  from generate_series(1, greatest(coalesce(ic.cupos_total, 1), 1)) as gs
), '{}'::jsonb)
where ic.pin is not null
  and btrim(ic.pin) <> ''
  and coalesce(ic.perfiles_pins, '{}'::jsonb) = '{}'::jsonb;

-- Marcador para que la corrección de fechas no se ejecute dos veces aunque
-- vuelvas a correr accidentalmente este archivo.
create table if not exists public.jc_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.jc_migrations enable row level security;
revoke all on public.jc_migrations from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from public.jc_migrations where version = 'v14_fechas_inclusivas'
  ) then
    update public.suscripciones
    set fecha_vencimiento = fecha_vencimiento - 1
    where fecha_vencimiento is not null;

    insert into public.jc_migrations(version)
    values ('v14_fechas_inclusivas');
  end if;
end
$$;

grant select on public.inventario_cuentas to authenticated;
grant select, insert, update, delete on public.inventario_cuentas to service_role;

notify pgrst, 'reload schema';
