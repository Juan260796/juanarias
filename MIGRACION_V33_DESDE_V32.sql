-- JUAN CUENTAS v33
-- Programa de fidelidad: un premio por cada 10 pedidos históricos.

create table if not exists public.premios_fidelidad (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  ciclo_numero integer not null check (ciclo_numero > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','entregado')),
  created_at timestamptz not null default now(),
  entregado_at timestamptz null,
  constraint premios_fidelidad_cliente_ciclo_key unique (cliente_id, ciclo_numero)
);

create index if not exists premios_fidelidad_cliente_idx on public.premios_fidelidad(cliente_id);
create index if not exists premios_fidelidad_estado_idx on public.premios_fidelidad(estado);

alter table public.premios_fidelidad enable row level security;

-- El panel accede a esta tabla únicamente por rutas seguras del servidor con la clave privada.
notify pgrst, 'reload schema';
