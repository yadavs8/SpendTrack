-- Tests for kharcha_trip_v2_hardening.sql. Run against a LOCAL database after the trip scripts (rolled back at the end).
begin;
insert into auth.users (id, email, instance_id, aud, role) values ('00000000-0000-0000-0000-0000000000f1','owner@x.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated') on conflict do nothing;
insert into public.trips (id, owner_user_id, name, invite_token, invite_enabled, allow_guest_adds, owner_name, owner_upi)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','Goa','tok123',true,true,'Sanjeev Yadav','sanjeev@okhdfc');
set local role anon;
do $$
declare r record; g text; ok boolean;
begin
  select * into r from public.trip_join('tok123','Rahul'); g := r.guest_token;
  -- duplicate name / owner names refused
  begin perform public.trip_join('tok123','rahul '); raise exception 'dup accepted'; exception when others then if sqlerrm like 'dup accepted%' then raise; end if; end;
  begin perform public.trip_join('tok123','Sanjeev Yadav'); raise exception 'owner name accepted'; exception when others then if sqlerrm like 'owner name accepted%' then raise; end if; end;
  begin perform public.trip_join('tok123','Me'); raise exception 'me accepted'; exception when others then if sqlerrm like 'me accepted%' then raise; end if; end;
  -- rejoin with own token still works
  select * into r from public.trip_join('tok123', null, g); assert r.display_name = 'Rahul', 'rejoin';
  -- strict UPI
  begin perform public.trip_set_my_upi('tok123', g, 'rahul@'); raise exception 'bad upi accepted'; exception when others then if sqlerrm like 'bad upi accepted%' then raise; end if; end;
  assert public.trip_set_my_upi('tok123', g, 'Rahul.K@OkAxis') = 'rahul.k@okaxis', 'upi saved lowercased';
  -- owner row comes from the trip, not from guests
  select count(*) filter (where is_owner and upi = 'sanjeev@okhdfc') = 1 and count(*) = 2 into ok from public.trip_member_upis('tok123');
  assert ok, 'owner + member upis';
  -- expenses: NaN, infinity date, bad split refused; good one accepted
  begin perform public.trip_add_expense('tok123', g, 'NaN'::numeric, 'x'); raise exception 'nan accepted'; exception when others then if sqlerrm like 'nan accepted%' then raise; end if; end;
  begin perform public.trip_add_expense('tok123', g, 100, 'x', 'infinity'::timestamptz); raise exception 'inf date accepted'; exception when others then if sqlerrm like 'inf date accepted%' then raise; end if; end;
  begin perform public.trip_add_expense('tok123', g, 100, 'x', now(), '{"a":1}'::jsonb); raise exception 'bad split accepted'; exception when others then if sqlerrm like 'bad split accepted%' then raise; end if; end;
  perform public.trip_add_expense('tok123', g, 450.50, 'Dinner', now(), '["Rahul","Sanjeev Yadav"]'::jsonb);
  assert (select total from public.trip_summary('tok123')) = 450.50, 'summary total';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.trip_get_or_create(text)', 'execute'), 'owner fn not for anon';
end $$;
rollback;
