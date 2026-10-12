-- Private bucket for receipt photos, one folder per user (folder name = user id). Already applied to the live project.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kharcha-receipts', 'kharcha-receipts', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "kharcha_receipts_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'kharcha-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kharcha_receipts_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'kharcha-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kharcha_receipts_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'kharcha-receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'kharcha-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kharcha_receipts_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'kharcha-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
