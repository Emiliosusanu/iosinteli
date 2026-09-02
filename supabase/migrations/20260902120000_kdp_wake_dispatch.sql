-- Fleet silent-push metronome for the iPhone KDP helper.
-- claim_kdp_wake_dispatch gates ~15-minute wakes so overlapping cron ticks
-- cannot fan out duplicate APNs storms.

create table if not exists public.kdp_wake_dispatch_lease (
  id            boolean primary key default true check (id),
  last_claimed  timestamptz,
  updated_at    timestamptz not null default now()
);

insert into public.kdp_wake_dispatch_lease (id, last_claimed)
values (true, null)
on conflict (id) do nothing;

alter table public.kdp_wake_dispatch_lease enable row level security;

-- No client policies — service role / Edge only.

create or replace function public.claim_kdp_wake_dispatch(minimum_interval_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  update public.kdp_wake_dispatch_lease
     set last_claimed = now(),
         updated_at = now()
   where id = true
     and (
       last_claimed is null
       or last_claimed <= now() - make_interval(secs => greatest(minimum_interval_seconds, 60))
     );
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

revoke all on function public.claim_kdp_wake_dispatch(integer) from public;
grant execute on function public.claim_kdp_wake_dispatch(integer) to service_role;
