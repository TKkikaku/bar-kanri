-- ============================================================
-- bar-kanri ダッシュボード（スタッフ別ランキング）確認用シード ★検証専用★
-- 伝票モデル（sales_slips ＋ sales_slip_details）版。
-- 対象: 今日 ＋ 今月（複数日）の伝票／staff_members（5名＋フリー）
-- Supabase ダッシュボード → SQL Editor で実行する。
--
-- ⚠️ 本番DB（7月〜稼働中）に実行すると、当日/今月の実データにデモ行が混ざる。
--    UI表示の確認が目的。確認後は必ず seed_dashboard_demo_cleanup.sql で撤去すること。
--    （本スクリプトは冪等：先頭で DASH_DEMO 伝票を消してから入れ直す）
--
-- 目印（クリーンアップ用）:
--   ・スタッフ … 新規5名を sort_order = 900 で投入（既存と衝突しない名前）
--   ・伝票     … sales_slips.memo = 'DASH_DEMO'
--   ・フリー   … 既存の「フリー」を再利用（重複作成しない）
--
-- 【新モデルの検証ポイント】
--   ・売上 / 組数 … 主担当（primary_staff_id）として集計（1伝票 = 1組）
--   ・ドリンク    … 全伝票横断の明細合計（ヘルパーとして他人の席で出した分も加算）
--   → 各伝票に「主担当の明細行」＋一定確率で「ヘルパーの明細行」を作り、
--     ヘルパーがドリンク実績を積む様子を確認できるようにする。
--   ※ 本デモはバック検証は対象外（back_amount=0・バック支出行は作らない）。
--     バックの確認は入力画面のプレビュー／集計で実データを使うこと。
-- ============================================================

-- ---------- 0) 再実行対策：このシードの伝票だけ消してから入れ直す ----------
-- 明細は cascade で消える。関連バック支出は作らないが念のため掃除。
delete from daily_expenses
where related_slip_id in (select id from sales_slips where memo = 'DASH_DEMO');
delete from sales_slips where memo = 'DASH_DEMO';

-- ---------- 1) デモスタッフ（新規5名 / sort_order=900 を目印）----------
insert into staff_members (name, is_free, sort_order)
select v.name, false, 900
from (values ('ここ'), ('もも'), ('りん'), ('あん'), ('ちな')) as v(name)
where not exists (
  select 1 from staff_members sm where sm.name = v.name and sm.sort_order = 900
);

-- ---------- 2) 今日＋今月の伝票（主担当ごとに差 / 行ごとにランダム）----------
DO $$
DECLARE
  v_stores  text[] := array['スタンド', 'サンライズ'];
  v_ages    text[] := array['20代', '30代', '40代', '50代', '60代以上'];
  v_today   date := current_date;
  v_mstart  date := date_trunc('month', current_date)::date;
  v_span    int  := (current_date - date_trunc('month', current_date)::date); -- 今月の経過日数
  v_rows    int  := 5;   -- 主担当×店舗あたりの伝票数（1件目は今日・順位を明確化するため固定）
  v_free_id uuid;
  r         record;      -- (staff_id, base)
  v_store   text;
  v_day     date;
  v_slip_id uuid;
  v_helper  uuid;
  i         int;
BEGIN
  -- 既存「フリー」を再利用（無ければ作成し sort_order=900 で目印）
  select id into v_free_id from staff_members where is_free = true order by created_at limit 1;
  if v_free_id is null then
    insert into staff_members (name, is_free, sort_order) values ('フリー', true, 900)
    returning id into v_free_id;
  end if;

  -- 対象6名（新規5名＋フリー）と「伝票総額ベース」。ベース差で1位〜下位を明確に。
  for r in
    select sm.id as staff_id, x.base
    from (values
      ('ここ', 92000),   -- 1位相当
      ('もも', 74000),
      ('りん', 56000),
      ('あん', 32000),
      ('ちな', 20000)    -- 下位相当
    ) as x(name, base)
    join staff_members sm on sm.name = x.name and sm.sort_order = 900
    union all
    select v_free_id, 44000   -- フリー（中位に入る）
  loop
    foreach v_store in array v_stores loop
      for i in 1..v_rows loop
        -- 1件目は必ず「今日」、残りは今月の任意の日にばらす
        if i = 1 then
          v_day := v_today;
        else
          v_day := v_mstart + (floor(random() * (v_span + 1)))::int;
        end if;

        -- 伝票ヘッダー（1伝票 = 1組）
        insert into sales_slips (store, date, primary_staff_id, total_amount, ages, memo)
        values (
          v_store,
          v_day,
          r.staff_id,
          r.base + floor(random() * 6000)::int,             -- ベース＋ノイズ（順位は維持）
          array[ v_ages[1 + floor(random() * 5)::int] ],    -- 客層1件
          'DASH_DEMO'
        )
        returning id into v_slip_id;

        -- 主担当の明細行（ドリンク 0〜5 / back_amount は本デモでは 0）
        insert into sales_slip_details (slip_id, staff_member_id, drinks, back_amount)
        values (v_slip_id, r.staff_id, floor(random() * 6)::int, 0);

        -- 約40%の確率でヘルパー明細を1行追加（主担当以外の sort_order=900 スタッフから1人）
        if random() < 0.4 then
          select sm.id into v_helper
          from staff_members sm
          where sm.sort_order = 900 and sm.id <> r.staff_id
          order by random() limit 1;

          if v_helper is not null then
            insert into sales_slip_details (slip_id, staff_member_id, drinks, back_amount)
            values (v_slip_id, v_helper, 1 + floor(random() * 4)::int, 0);
          end if;
        end if;
      end loop;
    end loop;
  end loop;
END $$;

-- 確認クエリ（任意）：主担当としての売上ランキング（今月・店舗別）
-- select store, s.name, count(*) as 組数, sum(sl.total_amount) as 売上
-- from sales_slips sl join staff_members s on s.id = sl.primary_staff_id
-- where sl.memo = 'DASH_DEMO'
-- group by store, s.name order by store, 売上 desc;
--
-- 確認クエリ（任意）：ドリンク実績（全伝票横断・ヘルパー分も含む）
-- select s.name, sum(d.drinks) as ドリンク
-- from sales_slip_details d
-- join sales_slips sl on sl.id = d.slip_id and sl.memo = 'DASH_DEMO'
-- join staff_members s on s.id = d.staff_member_id
-- group by s.name order by ドリンク desc;
