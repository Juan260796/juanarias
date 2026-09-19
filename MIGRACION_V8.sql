-- JUAN CUENTAS v8
-- Ejecutar UNA SOLA VEZ en Supabase > SQL Editor > New query > Run.
-- Es segura si ya ejecutaste migraciones anteriores: usa IF NOT EXISTS cuando corresponde.

-- 1) Acceso de clientes por USUARIO (ej. Alejandra45), sin pedir correo visible.
alter table public.clientes
  add column if not exists username text;

create unique index if not exists clientes_username_unique_ci
  on public.clientes (lower(username))
  where username is not null;

alter table public.clientes
  drop constraint if exists clientes_username_formato;

alter table public.clientes
  add constraint clientes_username_formato check (
    username is null
    or username ~ '^[A-Za-z0-9._-]{3,30}$'
  );

-- 2) Duración de servicios (si todavía no existía de v6).
alter table public.servicios
  add column if not exists duracion_tipo text;

alter table public.servicios
  add column if not exists duracion_cantidad integer;

update public.servicios
set duracion_tipo = coalesce(duracion_tipo, 'meses'),
    duracion_cantidad = coalesce(duracion_cantidad, 1)
where duracion_tipo is null or duracion_cantidad is null;

alter table public.servicios
  alter column duracion_tipo set default 'meses',
  alter column duracion_cantidad set default 1;

alter table public.servicios
  alter column duracion_tipo set not null,
  alter column duracion_cantidad set not null;

alter table public.servicios
  alter column descripcion drop not null;

alter table public.servicios
  drop constraint if exists servicios_duracion_valida;

alter table public.servicios
  add constraint servicios_duracion_valida check (
    (duracion_tipo = 'dias' and duracion_cantidad between 1 and 30)
    or (duracion_tipo = 'meses' and duracion_cantidad between 1 and 12)
    or (duracion_tipo = 'anios' and duracion_cantidad = 1)
  );

-- 3) Permisos del servidor administrador.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.clientes to service_role;
grant select, insert, update, delete on public.servicios to service_role;
grant select, insert, update, delete on public.suscripciones to service_role;
grant select, insert, update, delete on public.admins to service_role;
grant usage, select on all sequences in schema public to service_role;
