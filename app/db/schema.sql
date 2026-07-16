-- ============================================================
-- bar-kanri スキーマ（CLAUDE.md §5 準拠 / 伝票単位リニューアル版）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行する。
-- 認証は使わず anon 全許可（§4）。再実行してもおおむね安全なよう記述。
--
-- 【この版の変更点】売上を「担当別1行（daily_sales）」から
--   「伝票ヘッダー（sales_slips）＋明細（sales_slip_details）」の2テーブルへ。
--   ・1伝票 = 1組（組数は伝票件数でカウント。組数カラムは持たない）
--   ・明細 = 担当 × ドリンク数。主担当も明細に1行含める（drinks=0可）。
--   ・バックは明細 sales_slip_details.back_amount にスナップショット保存し、
--     daily_expenses には「伝票ごとに1本の集約バック行」を計上する。
--   ・daily_expenses.related_sale_id → related_slip_id に移行。
--
-- 【本番安全性】staff_members / daily_expenses / monthly_goals / app_settings
--   のデータは保持する。売上系（daily_sales）は空のため作り直す。
--   daily_expenses は列のみ移行（データは残す）。
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

-- 伝票ヘッダー（§5.3）。1伝票 = 1組。カテゴリ・支払い方法・組数カラムは持たない。
create table if not exists sales_slips (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  date date not null,
  primary_staff_id uuid not null references staff_members(id), -- 主担当（席担当）
  total_amount int not null,                                   -- 伝票総額
  ages text[],                                                 -- 客層（伝票=1組の属性）
  memo text,
  created_at timestamptz default now()
);

-- 伝票明細（§5.3）。担当 × ドリンク数。主担当も1行含める（drinks=0可）。
-- back_amount は登録時点のバック確定額スナップショット（§6）。
create table if not exists sales_slip_details (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references sales_slips(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  drinks int not null default 0,
  back_amount int not null default 0,
  created_at timestamptz default now()
);

-- 同一伝票内で担当の重複を禁止（1担当1明細行・判断事項④）
create unique index if not exists uq_slip_details_slip_staff
  on sales_slip_details (slip_id, staff_member_id);

-- 明細の集計・全件取得を軽くするためのインデックス
create index if not exists idx_slip_details_slip on sales_slip_details (slip_id);
create index if not exists idx_slip_details_staff on sales_slip_details (staff_member_id);
create index if not exists idx_sales_slips_store_date on sales_slips (store, date);

-- 支出 ＋ バック自動計上（§5.4）
-- 新規DBではこの形（related_slip_id）で作成。既存DBは後段の移行ブロックで列を差し替える。
create table if not exists daily_expenses (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  date date not null,
  amount int not null,
  category text not null,
  memo text,
  is_auto_back boolean not null default false,
  related_slip_id uuid references sales_slips(id),
  created_at timestamptz default now()
);

-- ---------- daily_expenses 列移行（既存DB向け・冪等） ----------
-- 旧: related_sale_id (→ daily_sales) を撤去し related_slip_id (→ sales_slips) へ。
DO $$
BEGIN
  -- 旧 daily_sales を参照していた自動バック行は参照先が消えるため掃除（空のはずだが防御的に）
  if exists (select 1 from information_schema.columns
             where table_name = 'daily_expenses' and column_name = 'related_sale_id') then
    delete from daily_expenses where is_auto_back = true;
  end if;

  -- 旧列と旧FK制約を削除
  alter table daily_expenses drop constraint if exists daily_expenses_related_sale_id_fkey;
  alter table daily_expenses drop column if exists related_sale_id;

  -- 新列を追加（無ければ）
  if not exists (select 1 from information_schema.columns
                 where table_name = 'daily_expenses' and column_name = 'related_slip_id') then
    alter table daily_expenses add column related_slip_id uuid;
  end if;

  -- 新FK（無ければ付与）
  if not exists (select 1 from information_schema.table_constraints
                 where table_name = 'daily_expenses'
                   and constraint_name = 'daily_expenses_related_slip_id_fkey') then
    alter table daily_expenses
      add constraint daily_expenses_related_slip_id_fkey
      foreign key (related_slip_id) references sales_slips(id);
  end if;
END $$;

-- ---------- 旧 daily_sales の撤去 ----------
-- daily_expenses から参照FKを外した後なら安全に削除できる（データは空・§13）。
drop table if exists daily_sales;

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
alter table staff_members       enable row level security;
alter table sales_slips         enable row level security;
alter table sales_slip_details  enable row level security;
alter table daily_expenses      enable row level security;
alter table monthly_goals       enable row level security;
alter table app_settings        enable row level security;

drop policy if exists "anon_all_staff_members"       on staff_members;
drop policy if exists "anon_all_sales_slips"         on sales_slips;
drop policy if exists "anon_all_sales_slip_details"  on sales_slip_details;
drop policy if exists "anon_all_daily_expenses"      on daily_expenses;
drop policy if exists "anon_all_monthly_goals"       on monthly_goals;
drop policy if exists "anon_all_app_settings"        on app_settings;

create policy "anon_all_staff_members"      on staff_members      for all to anon using (true) with check (true);
create policy "anon_all_sales_slips"        on sales_slips        for all to anon using (true) with check (true);
create policy "anon_all_sales_slip_details" on sales_slip_details for all to anon using (true) with check (true);
create policy "anon_all_daily_expenses"     on daily_expenses     for all to anon using (true) with check (true);
create policy "anon_all_monthly_goals"      on monthly_goals      for all to anon using (true) with check (true);
create policy "anon_all_app_settings"       on app_settings       for all to anon using (true) with check (true);

-- ---------- 初期データ（本番セットアップに必要な最小限のみ） ----------

-- バック設定（既定 10% / ¥300）
insert into app_settings (id, sales_rate, drink_unit)
values (1, 0.10, 300)
on conflict (id) do nothing;

-- 「フリー」枠（§5.5・削除不可/バック対象外）。重複防止のため未存在時のみ。
insert into staff_members (name, is_free, sort_order)
select 'フリー', true, 0
where not exists (select 1 from staff_members where is_free = true);
