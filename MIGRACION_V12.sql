-- JUAN CUENTAS v12
-- Promociones diarias + inventario seguro de cuentas de streaming.

create table if not exists public.promociones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  precio text,
  fecha_inicio date not null default current_date,
  fecha_fin date not null default current_date,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint promociones_fechas_validas check (fecha_fin >= fecha_inicio)
);

create table if not exists public.inventario_cuentas (
  id uuid primary key default gen_random_uuid(),
  servicio_id uuid not null references public.servicios(id) on delete cascade,
  correo text not null,
  clave text not null,
  perfil text,
  etiqueta text,
  notas text,
  estado text not null default 'disponible',
  cliente_id uuid references public.clientes(id) on delete set null,
  suscripcion_id uuid references public.suscripciones(id) on delete set null,
  fecha_carga date not null default current_date,
  fecha_asignacion timestamptz,
  created_at timestamptz not null default now(),
  constraint inventario_estado_valido check (estado in ('disponible','asignada'))
);

create index if not exists inventario_servicio_estado_idx
  on public.inventario_cuentas(servicio_id, estado);

create unique index if not exists inventario_una_cuenta_por_suscripcion
  on public.inventario_cuentas(suscripcion_id)
  where estado = 'asignada' and suscripcion_id is not null;

alter table public.promociones enable row level security;
alter table public.inventario_cuentas enable row level security;

grant usage on schema public to authenticated;
grant select on public.promociones to authenticated;
grant select on public.inventario_cuentas to authenticated;

drop policy if exists "clientes ven promociones activas" on public.promociones;
create policy "clientes ven promociones activas"
on public.promociones
for select
to authenticated
using (activo = true);

drop policy if exists "cliente ve sus cuentas asignadas" on public.inventario_cuentas;
create policy "cliente ve sus cuentas asignadas"
on public.inventario_cuentas
for select
to authenticated
using (
  estado = 'asignada'
  and exists (
    select 1
    from public.clientes c
    where c.id = inventario_cuentas.cliente_id
      and c.auth_user_id = auth.uid()
  )
);

-- Acceso administrativo únicamente desde el servidor con la secret key.
grant select, insert, update, delete on public.promociones to service_role;
grant select, insert, update, delete on public.inventario_cuentas to service_role;
