-- Thumbnail & Script System — run this ONCE in your Supabase project:
-- Dashboard → SQL Editor → paste → Run.

-- 1. Research library: every topic you search, saved forever with outlier scores.
create table if not exists thumb_library (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  video_id text not null,
  title text not null default '',
  channel text not null default '',
  channel_id text not null default '',
  views bigint not null default 0,
  published_at timestamptz,
  length_seconds int,
  thumbnail_url text not null default '',
  outlier_ratio numeric,
  scanned_at timestamptz not null default now(),
  unique (topic, video_id)
);
create index if not exists thumb_library_topic_idx on thumb_library (topic);

-- 2. Channel watchlist: competitors you track; uploads auto-scored via RSS.
create table if not exists watch_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  title text not null default '',
  added_at timestamptz not null default now(),
  last_scanned_at timestamptz
);
create table if not exists watch_videos (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  video_id text not null unique,
  title text not null default '',
  channel text not null default '',
  views bigint not null default 0,
  published_at timestamptz,
  thumbnail_url text not null default '',
  outlier_ratio numeric,
  scanned_at timestamptz not null default now()
);
create index if not exists watch_videos_channel_idx on watch_videos (channel_id);

-- 3. Avatars: photos per person; likeness bundle = extra angles of the SAME person.
create table if not exists avatars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  person text not null default 'me',
  image text not null,
  is_default boolean not null default false,
  use_for_likeness boolean not null default true,
  created_at timestamptz not null default now()
);

-- 4. Scripts: title, topic, hook, body + the raw voice-note transcript (your real voice).
create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null default '',
  hook text not null default '',
  content text not null default '',
  source text not null default 'manual',
  voice_transcript text not null default '',
  created_at timestamptz not null default now()
);

-- 5. Competitor hooks: first ~45s of a video's transcript, cached forever.
create table if not exists video_hooks (
  video_id text primary key,
  title text not null default '',
  channel text not null default '',
  hook_text text not null default '',
  fetched_at timestamptz not null default now()
);

-- 6. Generation history: every round — instructions, refs, outputs.
create table if not exists thumb_sessions (
  id uuid primary key default gen_random_uuid(),
  instructions text not null default '',
  ref_images jsonb not null default '[]',
  outputs jsonb not null default '[]',
  took_ms int,
  created_at timestamptz not null default now()
);
create index if not exists thumb_sessions_created_idx on thumb_sessions (created_at desc);
