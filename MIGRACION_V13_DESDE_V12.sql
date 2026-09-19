-- JUAN CUENTAS v13
-- Proveedores, tipos de entrega, cupos/perfiles y garantías con historial.
-- Ejecutar una sola vez después de las migraciones anteriores.

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  iniciales text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists proveedores_iniciales_unique_ci
  on public.proveedores (upper(iniciales));

alter table public.proveedores
  drop constraint if exists proveedores_iniciales_formato;
alter table public.proveedores
  add constraint proveedores_iniciales_formato check (
    iniciales ~ '^[A-Za-z0-9]{1,8}$'
  );

alter table public.servicios
  add column if not exists tipo_entrega text not null default 'estandar';

alter table public.servicios
  drop constraint if exists servicios_tipo_entrega_valido;
alter table public.servicios
  add constraint servicios_tipo_entrega_valido check (
    tipo_entrega in ('estandar','chatgpt','gemini','manual')
  );

alter table public.inventario_cuentas
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null,
  add column if not exists pin text,
  add column if not exists grupo text,
  add column if not exists cupos_total integer not null default 1,
  add column if not exists duracion_tipo text not null default 'dias',
  add column if not exists duracion_cantidad integer not null default 30;

-- Gemini no necesita contraseña guardada; por eso pasa a ser opcional.
alter table public.inventario_cuentas alter column clave drop not null;

drop index if exists public.inventario_una_cuenta_por_suscripcion;

alter table public.inventario_cuentas
  drop constraint if exists inventario_estado_valido;

-- Convertir el estado anterior antes de validar la nueva lista de estados.
update public.inventario_cuentas
set estado = 'agotada'
where estado = 'asignada';

alter table public.inventario_cuentas
  add constraint inventario_estado_valido check (
    estado in ('disponible','agotada','fallida','reemplazada')
  );

alter table public.inventario_cuentas
  drop constraint if exists inventario_cupos_validos;
alter table public.inventario_cuentas
  add constraint inventario_cupos_validos check (cupos_total between 1 and 50);

alter table public.inventario_cuentas
  drop constraint if exists inventario_duracion_valida;
alter table public.inventario_cuentas
  add constraint inventario_duracion_valida check (
    (duracion_tipo = 'dias' and duracion_cantidad between 1 and 30)
    or (duracion_tipo = 'meses' and duracion_cantidad between 1 and 12)
  );

-- Ajustar registros anteriores para que sus perfiles/cupos sigan siendo válidos.
update public.inventario_cuentas
set cupos_total = greatest(
  cupos_total,
  coalesce(nullif(regexp_replace(coalesce(perfil,''), '[^0-9]', '', 'g'), '')::integer, 1)
);

create table if not exists public.inventario_asignaciones (
  id uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references public.inventario_cuentas(id) on delete cascade,
  suscripcion_id uuid not null references public.suscripciones(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  cupo_numero integer not null default 1,
  correo_cliente text,
  activo boolean not null default true,
  es_reemplazo boolean not null default false,
  reemplaza_asignacion_id uuid references public.inventario_asignaciones(id) on delete set null,
  fecha_asignacion timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventario_asignacion_cupo_positivo check (cupo_numero >= 1)
);

create unique index if not exists inventario_asignacion_activa_por_pedido
  on public.inventario_asignaciones(suscripcion_id)
  where activo = true;

create unique index if not exists inventario_cupo_activo_unico
  on public.inventario_asignaciones(inventario_id, cupo_numero)
  where activo = true;

create index if not exists inventario_asignaciones_cliente_idx
  on public.inventario_asignaciones(cliente_id, activo);
create index if not exists inventario_asignaciones_inventario_idx
  on public.inventario_asignaciones(inventario_id, activo);

-- Migrar asignaciones de v12, si existen.
insert into public.inventario_asignaciones (
  inventario_id, suscripcion_id, cliente_id, cupo_numero, activo, fecha_asignacion
)
select
  i.id,
  i.suscripcion_id,
  i.cliente_id,
  greatest(coalesce(nullif(regexp_replace(coalesce(i.perfil,''), '[^0-9]', '', 'g'), '')::integer, 1), 1),
  true,
  coalesce(i.fecha_asignacion, i.created_at, now())
from public.inventario_cuentas i
where i.suscripcion_id is not null
  and i.cliente_id is not null
  and not exists (
    select 1 from public.inventario_asignaciones a
    where a.suscripcion_id = i.suscripcion_id and a.activo = true
  );

alter table public.proveedores enable row level security;
alter table public.inventario_asignaciones enable row level security;

-- Proveedores: el cliente solo necesita leer las iniciales del proveedor de su cuenta.
grant select on public.proveedores to authenticated;
drop policy if exists "usuarios ven proveedores" on public.proveedores;
create policy "usuarios ven proveedores"
on public.proveedores for select to authenticated
using (activo = true);

-- Asignaciones: cada cliente solo ve sus propias asignaciones activas.
grant select on public.inventario_asignaciones to authenticated;
drop policy if exists "cliente ve sus asignaciones" on public.inventario_asignaciones;
create policy "cliente ve sus asignaciones"
on public.inventario_asignaciones for select to authenticated
using (
  activo = true
  and exists (
    select 1 from public.clientes c
    where c.id = inventario_asignaciones.cliente_id
      and c.auth_user_id = auth.uid()
  )
);

-- Actualizar política del inventario para el nuevo modelo de cupos.
drop policy if exists "cliente ve sus cuentas asignadas" on public.inventario_cuentas;
create policy "cliente ve sus cuentas asignadas"
on public.inventario_cuentas for select to authenticated
using (
  exists (
    select 1
    from public.inventario_asignaciones a
    join public.clientes c on c.id = a.cliente_id
    where a.inventario_id = inventario_cuentas.id
      and a.activo = true
      and c.auth_user_id = auth.uid()
  )
);

-- Acceso administrativo desde el servidor.
grant select, insert, update, delete on public.proveedores to service_role;
grant select, insert, update, delete on public.inventario_asignaciones to service_role;
grant select, insert, update, delete on public.inventario_cuentas to service_role;
grant select, insert, update, delete on public.servicios to service_role;
