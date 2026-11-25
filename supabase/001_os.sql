-- Run in a staging Supabase project first. Namespaced tables; no public grants.
create table if not exists public.af_os_jobs (
 id uuid primary key default gen_random_uuid(), client text not null, role text not null,
 brief text not null, output text, status text not null default 'pending' check(status in ('pending','running','review','approved','rejected','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 usage jsonb, error text
);
create table if not exists public.af_os_ledger (
 id uuid primary key default gen_random_uuid(), client text not null, day date not null,
 revenue_eur numeric(12,2) not null check(revenue_eur>=0), cost_eur numeric(12,2) not null check(cost_eur>=0),
 hours numeric(10,2) not null check(hours>=0), note text not null default '', created_at timestamptz default now()
);
create table if not exists public.af_os_daily (day date primary key, calls integer not null default 0);
create table if not exists public.af_os_metrics (
 id uuid primary key default gen_random_uuid(), client text not null, day date not null,
 channel text not null, visits integer check(visits>=0), qualified_leads integer check(qualified_leads>=0), calls integer check(calls>=0), sales integer check(sales>=0), note text not null default '', created_at timestamptz default now(), unique(client,day,channel)
);
alter table public.af_os_jobs enable row level security;
alter table public.af_os_ledger enable row level security;
alter table public.af_os_daily enable row level security;
alter table public.af_os_metrics enable row level security;
revoke all on public.af_os_jobs,public.af_os_ledger,public.af_os_daily,public.af_os_metrics from anon,authenticated;
grant select,insert,update on public.af_os_jobs,public.af_os_ledger,public.af_os_daily,public.af_os_metrics to service_role;
create or replace function public.af_os_reserve_call(p_limit integer) returns boolean language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
 if p_limit < 1 or p_limit > 30 then return false; end if;
 insert into public.af_os_daily(day,calls) values ((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set calls=af_os_daily.calls+1 where af_os_daily.calls < p_limit returning calls into n;
 return n is not null;
end; $$;
revoke all on function public.af_os_reserve_call(integer) from public,anon,authenticated;
grant execute on function public.af_os_reserve_call(integer) to service_role;
