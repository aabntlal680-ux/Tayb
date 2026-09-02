-- ================================================================
-- WhatsApp-style PWA - Final Supabase fix for FCM + Realtime + RLS
-- ================================================================

-- 1) Ensure required extensions
create extension if not exists pgcrypto;

-- 2) FCM tokens table
create table if not exists public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  token text not null unique,
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fcm_tokens_user_id_idx on public.fcm_tokens(user_id);

-- 3) Typing status table
create table if not exists public.typing_status (
  conversation_id uuid not null,
  user_id uuid not null,
  is_typing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists typing_status_conversation_idx on public.typing_status(conversation_id);

-- 4) Support table for conversations/messages if missing
-- These are expected by the app, but if they already exist they are left alone.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  admin_id uuid not null,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid not null,
  content text,
  attachment_url text,
  attachment_type text,
  reply_to_id uuid,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

-- Optional if not already created
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now()
);

-- 5) Helpful trigger to update `updated_at`
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fcm_tokens_updated on public.fcm_tokens;
create trigger trg_fcm_tokens_updated
before update on public.fcm_tokens
for each row execute function public.set_updated_at();

drop trigger if exists trg_typing_status_updated on public.typing_status;
create trigger trg_typing_status_updated
before update on public.typing_status
for each row execute function public.set_updated_at();

-- 6) Enable RLS
alter table public.fcm_tokens enable row level security;
alter table public.typing_status enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

-- 7) RLS Policies for fcm_tokens
-- Users can manage only their own token row
create policy if not exists "Users can read own fcm token"
  on public.fcm_tokens
  for select
  using (auth.uid() = user_id or user_id is null);

create policy if not exists "Users can upsert own fcm token"
  on public.fcm_tokens
  for insert
  with check (auth.uid() = user_id or user_id is null);

create policy if not exists "Users can update own fcm token"
  on public.fcm_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "Users can delete own fcm token"
  on public.fcm_tokens
  for delete
  using (auth.uid() = user_id);

-- 8) RLS Policies for typing_status
drop policy if exists "Users can read typing status in conversation they belong to" on public.typing_status;
drop policy if exists "Users can upsert their own typing status" on public.typing_status;
drop policy if exists "Users can update their own typing status" on public.typing_status;
drop policy if exists "Users can delete their own typing status" on public.typing_status;

create policy if not exists "Users can read typing status in conversation they belong to"
  on public.typing_status
  for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = typing_status.conversation_id
        and (
          c.user_id = auth.uid() or c.admin_id = auth.uid()
        )
    )
  );

create policy if not exists "Users can upsert their own typing status"
  on public.typing_status
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = typing_status.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

create policy if not exists "Users can update their own typing status"
  on public.typing_status
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = typing_status.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = typing_status.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

create policy if not exists "Users can delete their own typing status"
  on public.typing_status
  for delete
  using (auth.uid() = user_id);

-- 9) RLS Policies for conversations
create policy if not exists "Users can read their conversations"
  on public.conversations
  for select
  using (auth.uid() = user_id or auth.uid() = admin_id);

create policy if not exists "Users can insert own conversation row"
  on public.conversations
  for insert
  with check (auth.uid() = user_id or auth.uid() = admin_id);

create policy if not exists "Users can update their own conversation"
  on public.conversations
  for update
  using (auth.uid() = user_id or auth.uid() = admin_id)
  with check (auth.uid() = user_id or auth.uid() = admin_id);

-- 10) RLS Policies for messages
create policy if not exists "Users can read messages from their conversations"
  on public.messages
  for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

create policy if not exists "Users can insert messages in their conversations"
  on public.messages
  for insert
  with check (
    auth.uid() = sender_id and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

create policy if not exists "Users can update message status in their conversations"
  on public.messages
  for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

-- 11) Reaction policy
create policy if not exists "Users can read reactions for their conversations"
  on public.message_reactions
  for select
  using (
    exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_reactions.message_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

create policy if not exists "Users can insert reactions to their own messages or conversation messages"
  on public.message_reactions
  for insert
  with check (
    auth.uid() = user_id and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_reactions.message_id
        and (c.user_id = auth.uid() or c.admin_id = auth.uid())
    )
  );

-- 12) Optional helper for admin visibility if needed
-- If you want a superadmin to see all rows universally, add this policy manually.
-- Example:
-- create policy "Superadmins can see all typing statuses" on public.typing_status for all using (
--   exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin = true)
-- );

-- ================================================================
-- End of SQL
-- ================================================================
