-- ============================================================
-- bar-kanri スキーマ（CLAUDE.md §5 準拠 / 伝票単位リニューアル版）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行する。
-- 認証は使わず anon 全許可（§4）。再実行してもおおむね安全なよう記述。
--
-- 【この版の変更点】記録の削除（§7.3）に対応。
--   ・daily_expenses.related_slip_id のFKを on delete cascade に張り替え
--     （伝票を1文で消せば明細＋集約バック行も同時に消える＝中途半端な状態が起きない）
--   ・sales_slips に sales_rate / drink_unit のスナップショット列を追加
--     （編集時のバック再計算を「登録時点の設定」で行うため・§12）
--
-- 【前版の変更点】実売上（§7.2）用に drink_price を追加。
--   ・app_settings.drink_price = ドリンク販売単価の設定値（既定800円・設定画面から変更可）
--   ・sales_slips.drink_price  = 登録時点のスナップショット（back_amount と同じ思想）
--   既存DBには後段の alter ... add column if not exists で追加される（既存行は800で埋まる）。
--
-- 【前版の変更点】売上を「担当別1行（daily_sales）」から
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
  -- 登録時点の設定スナップショット（§12）。編集時のバック再計算はこの値で行う。
  sales_rate numeric not null default 0.10,                    -- 売上バック率（§6）
  drink_unit int not null default 300,                         -- ドリンクバック単価（§6）
  drink_price int not null default 800,                        -- ドリンク販売単価（実売上の計算に使用・§7.2）
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
  -- 伝票を削除したら集約バック行も一緒に消える（§7.3）。
  -- アプリ側で2文に分けて消すと、片方だけ失敗して「バックだけ消えて売上が残る」ズレが起きうる。
  related_slip_id uuid references sales_slips(id) on delete cascade,
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

END $$;

-- ---------- 集約バック行のFK（on delete cascade・冪等） ----------
-- 伝票削除で明細（slip_id の cascade）と集約バック行が同時に消えるようにする（§7.3）。
-- cascade が無いと、バック行が参照している伝票は FK 違反で削除できない。
-- drop → add なので、旧 cascade なしのFKが残っているDBでも通しで実行すれば張り替わる。
alter table daily_expenses drop constraint if exists daily_expenses_related_slip_id_fkey;
alter table daily_expenses
  add constraint daily_expenses_related_slip_id_fkey
  foreign key (related_slip_id) references sales_slips(id) on delete cascade;

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

-- バック・単価設定・単一行（§5.7）
create table if not exists app_settings (
  id int primary key default 1,
  sales_rate numeric not null default 0.10,  -- 売上バック率
  drink_unit int not null default 300,       -- ドリンクバック単価（スタッフへ払う額）
  drink_price int not null default 800       -- ドリンク販売単価（店頭価格・実売上の計算に使用）
);

-- ---------- drink_price 列の追加（既存DB向け・冪等） ----------
-- 実売上（§7.2）= 主担当の伝票総額 − 他担当ドリンク数 × drink_price。
-- 既存行は default 800 で自動的に埋まる（= 現行の店頭価格）。
alter table app_settings add column if not exists drink_price int not null default 800;
alter table sales_slips  add column if not exists drink_price int not null default 800;

-- ---------- sales_rate / drink_unit のスナップショット列（既存DB向け・冪等） ----------
-- 伝票の編集時、バックは「登録時点の設定」で再計算する必要がある（§12）。
-- back_amount（結果）だけでは率・単価を逆算できない（floor で情報が落ちる／0杯の担当からは単価を割り出せない）ため、
-- 率と単価そのものを伝票に持たせる。drink_price と同じ扱い。
--
-- ここで DO ブロックが要るのは、既存伝票のバックフィルに update が必要なため。
-- 無条件の update だと schema.sql を再実行するたびに全伝票のスナップショットが
-- 現在の設定値で上書きされて壊れる。「列が無いときだけ実行」で冪等性を守る。
DO $$
BEGIN
  if not exists (select 1 from information_schema.columns
                 where table_name = 'sales_slips' and column_name = 'sales_rate') then
    alter table sales_slips add column sales_rate numeric;
    alter table sales_slips add column drink_unit int;

    -- 既存伝票には「現在の設定値」を埋める（ハードコードの既定値より実態に近い）
    update sales_slips s
      set sales_rate = a.sales_rate, drink_unit = a.drink_unit
      from app_settings a where a.id = 1;
    -- app_settings が未投入だった場合の保険
    update sales_slips set sales_rate = 0.10 where sales_rate is null;
    update sales_slips set drink_unit = 300  where drink_unit is null;

    alter table sales_slips alter column sales_rate set not null;
    alter table sales_slips alter column sales_rate set default 0.10;
    alter table sales_slips alter column drink_unit set not null;
    alter table sales_slips alter column drink_unit set default 300;
  end if;
END $$;

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

-- バック・単価設定（既定 10% / バック¥300 / 販売¥800）
insert into app_settings (id, sales_rate, drink_unit, drink_price)
values (1, 0.10, 300, 800)
on conflict (id) do nothing;

-- 「フリー」枠（§5.5・削除不可/バック対象外）。重複防止のため未存在時のみ。
insert into staff_members (name, is_free, sort_order)
select 'フリー', true, 0
where not exists (select 1 from staff_members where is_free = true);
