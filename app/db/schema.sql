-- ============================================================
-- bar-kanri スキーマ（CLAUDE.md §5 準拠）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行する。
-- 認証は使わず anon 全許可（§4）。再実行してもおおむね安全なよう記述。
-- ============================================================

-- ---------- テーブル ----------

-- スタッフ（全店共通・§5.5）
create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_free boolean not null default false,
  sort_order int,
  created_at timestamptz default now()
);

-- 売上（シンプル構成・§5.3）。カテゴリ・支払い方法は持たない。
create table if not exists daily_sales (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  date date not null,
  staff_member_id uuid not null references staff_members(id),
  amount int not null,
  groups int not null,
  ages text[],
  nominated_drinks int not null default 0,
  memo text,
  created_at timestamptz default now()
);

-- 支出 ＋ バック自動計上（§5.4）
create table if not exists daily_expenses (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  date date not null,
  amount int not null,
  category text not null,
  memo text,
  is_auto_back boolean not null default false,
  related_sale_id uuid references daily_sales(id),
  created_at timestamptz default now()
);

-- 月次目標（§5.6）
create table if not exists monthly_goals (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  month text not null,
  target int not null,
  unique (store, month)
);

-- バック設定・単一行（§5.7）
create table if not exists app_settings (
  id int primary key default 1,
  sales_rate numeric not null default 0.10,
  drink_unit int not null default 300
);

-- ---------- RLS（全テーブル anon 全許可・§4） ----------
alter table staff_members  enable row level security;
alter table daily_sales    enable row level security;
alter table daily_expenses enable row level security;
alter table monthly_goals  enable row level security;
alter table app_settings   enable row level security;

drop policy if exists "anon_all_staff_members"  on staff_members;
drop policy if exists "anon_all_daily_sales"    on daily_sales;
drop policy if exists "anon_all_daily_expenses" on daily_expenses;
drop policy if exists "anon_all_monthly_goals"  on monthly_goals;
drop policy if exists "anon_all_app_settings"   on app_settings;

create policy "anon_all_staff_members"  on staff_members  for all to anon using (true) with check (true);
create policy "anon_all_daily_sales"    on daily_sales    for all to anon using (true) with check (true);
create policy "anon_all_daily_expenses" on daily_expenses for all to anon using (true) with check (true);
create policy "anon_all_monthly_goals"  on monthly_goals  for all to anon using (true) with check (true);
create policy "anon_all_app_settings"   on app_settings   for all to anon using (true) with check (true);

-- ---------- 初期データ ----------

-- バック設定（既定 10% / ¥300）
insert into app_settings (id, sales_rate, drink_unit)
values (1, 0.10, 300)
on conflict (id) do nothing;

-- 「フリー」枠（§5.5・削除不可/バック対象外）。重複防止のため未存在時のみ。
insert into staff_members (name, is_free, sort_order)
select 'フリー', true, 0
where not exists (select 1 from staff_members where is_free = true);

-- （テスト用・任意）バック計算を試すためのサンプルスタッフ。本番では削除可。
-- 重複防止のため同名が無いときだけ投入。
insert into staff_members (name, is_free, sort_order)
select v.name, false, v.so
from (values ('あや', 1), ('みお', 2)) as v(name, so)
where not exists (select 1 from staff_members where staff_members.name = v.name);
