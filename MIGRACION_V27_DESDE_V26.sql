-- JUAN CUENTAS v27
-- Evita duplicados de servicios, clientes y proveedores.
-- No borra ni modifica los registros existentes.

-- =====================================================
-- 1) SERVICIOS: mismo nombre + mismo tiempo no se repite
--    Equivalencias: 30 días = 1 mes; 12 meses = 1 año.
-- =====================================================
create or replace function public.jc_duration_key(p_tipo text, p_cantidad integer)
returns text
language sql
immutable
as $$
  select case
    when p_tipo = 'dias' and coalesce(p_cantidad, 1) = 30 then 'M1'
    when p_tipo = 'dias' then 'D' || coalesce(p_cantidad, 1)::text
    when p_tipo = 'anios' then 'M12'
    else 'M' || coalesce(p_cantidad, 1)::text
  end;
$$;

create or replace function public.jc_prevent_duplicate_service()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.servicios s
    where s.id is distinct from new.id
      and lower(btrim(s.nombre)) = lower(btrim(new.nombre))
      and public.jc_duration_key(s.duracion_tipo, s.duracion_cantidad)
          = public.jc_duration_key(new.duracion_tipo, new.duracion_cantidad)
  ) then
    raise exception using
      errcode = '23505',
      message = 'DUPLICATE_SERVICE_DURATION';
  end if;
  return new;
end;
$$;

drop trigger if exists jc_no_duplicate_service on public.servicios;
create trigger jc_no_duplicate_service
before insert or update of nombre, duracion_tipo, duracion_cantidad
on public.servicios
for each row execute function public.jc_prevent_duplicate_service();

-- =====================================================
-- 2) CLIENTES: no repetir nombre, usuario ni celular.
--    El celular se compara ignorando espacios, +, guiones, etc.
-- =====================================================
create or replace function public.jc_prevent_duplicate_client()
returns trigger
language plpgsql
as $$
declare
  phone_digits text;
begin
  phone_digits := regexp_replace(coalesce(new.telefono, ''), '[^0-9]', '', 'g');
  if length(phone_digits) = 12 and left(phone_digits, 2) = '57' then
    phone_digits := substring(phone_digits from 3);
  elsif length(phone_digits) = 14 and left(phone_digits, 4) = '0057' then
    phone_digits := substring(phone_digits from 5);
  end if;

  if exists (
    select 1 from public.clientes c
    where c.id is distinct from new.id
      and lower(btrim(c.nombre)) = lower(btrim(new.nombre))
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_CLIENT_NAME';
  end if;

  if nullif(btrim(coalesce(new.username, '')), '') is not null and exists (
    select 1 from public.clientes c
    where c.id is distinct from new.id
      and lower(btrim(coalesce(c.username, ''))) = lower(btrim(new.username))
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_CLIENT_USERNAME';
  end if;

  if phone_digits <> '' and exists (
    select 1 from public.clientes c
    where c.id is distinct from new.id
      and (
        case
          when length(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g')) = 12
               and left(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g'), 2) = '57'
            then substring(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g') from 3)
          when length(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g')) = 14
               and left(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g'), 4) = '0057'
            then substring(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g') from 5)
          else regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g')
        end
      ) = phone_digits
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_CLIENT_PHONE';
  end if;

  return new;
end;
$$;

drop trigger if exists jc_no_duplicate_client on public.clientes;
create trigger jc_no_duplicate_client
before insert or update of nombre, username, telefono
on public.clientes
for each row execute function public.jc_prevent_duplicate_client();

-- =====================================================
-- 3) PROVEEDORES: mismas iniciales no se pueden repetir.
--    Incluye proveedores archivados/inactivos.
-- =====================================================
create or replace function public.jc_prevent_duplicate_provider()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.proveedores p
    where p.id is distinct from new.id
      and upper(btrim(p.iniciales)) = upper(btrim(new.iniciales))
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_PROVIDER';
  end if;
  return new;
end;
$$;

drop trigger if exists jc_no_duplicate_provider on public.proveedores;
create trigger jc_no_duplicate_provider
before insert or update of iniciales
on public.proveedores
for each row execute function public.jc_prevent_duplicate_provider();

notify pgrst, 'reload schema';
