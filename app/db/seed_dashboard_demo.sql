-- ============================================================
-- bar-kanri ダッシュボード（売上ランキング）確認用シードデータ ★検証専用★
-- 対象: 今日 ＋ 今月（複数日）の daily_sales / staff_members（5名＋フリー）
-- Supabase ダッシュボード → SQL Editor で実行する。
--
-- ⚠️ 本番DB（7月〜稼働中）に実行すると、当日/今月の実データにデモ行が混ざる。
--    UI表示の確認が目的。確認後は必ず seed_dashboard_demo_cleanup.sql で撤去すること。
--    （本スクリプトは冪等：先頭で DASH_DEMO 行を消してから入れ直す）
--
-- 目印（クリーンアップ用）:
--   ・スタッフ … 新規5名を sort_order = 900 で投入（既存と衝突しない名前）
--   ・売上     … daily_sales.memo = 'DASH_DEMO'
--   ・フリー   … 既存の「フリー」を再利用（重複作成しない）
--
-- ※ 売上は行ごとにランダム化。再実行しても二重にならないよう、
--    先頭で自分のマーカー付き売上だけを消してから入れ直す（冪等）。
-- ※ 行ごとのランダム化は cross join lateral ではなく
--    PL/pgSQL の DO ブロック内ループで実装（行ごとに random() を独立評価）。
-- ============================================================

-- ---------- 0) 再実行対策：このシードの売上だけ消してから入れ直す ----------
delete from daily_sales where memo = 'DASH_DEMO';

-- ---------- 1) デモスタッフ（新規5名 / sort_order=900 を目印）----------
insert into staff_members (name, is_free, sort_order)
select v.name, false, 900
from (values ('ここ'), ('もも'), ('りん'), ('あん'), ('ちな')) as v(name)
where not exists (
  select 1 from staff_members sm where sm.name = v.name and sm.sort_order = 900
);

-- ---------- 2) 今日＋今月の売上（担当ごとに差 / 行ごとにランダム）----------
DO $$
DECLARE
  v_stores  text[] := array['スタンド', 'サンライズ'];
  v_ages    text[] := array['20代', '30代', '40代', '50代', '60代以上'];
  v_today   date := current_date;
  v_mstart  date := date_trunc('month', current_date)::date;
  v_span    int  := (current_date - date_trunc('month', current_date)::date); -- 今月の経過日数
  v_rows    int  := 5;   -- スタッフ×店舗あたりの売上行数（1件目は今日・順位を明確化するため固定）
  v_free_id uuid;
  r         record;      -- (staff_id, base)
  v_store   text;
  v_day     date;
  i         int;
BEGIN
  -- 既存「フリー」を再利用（無ければ作成し sort_order=900 で目印）
  select id into v_free_id from staff_members where is_free = true order by created_at limit 1;
  if v_free_id is null then
    insert into staff_members (name, is_free, sort_order) values ('フリー', true, 900)
    returning id into v_free_id;
  end if;

  -- 対象6名（新規5名＋フリー）と「1件あたり売上ベース」。ベース差で1位〜下位を明確に。
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

        insert into daily_sales
          (store, date, staff_member_id, amount, groups, ages, nominated_drinks, memo)
        values (
          v_store,
          v_day,
          r.staff_id,
          r.base + floor(random() * 6000)::int,            -- ベース＋ノイズ（順位は維持）
          1 + floor(random() * 5)::int,                    -- 組数 1〜5
          array[ v_ages[1 + floor(random() * 5)::int] ],   -- 客層1件（任意・ランキングでは非表示）
          floor(random() * 8)::int,                        -- 指名ドリンク 0〜7
          'DASH_DEMO'                                       -- クリーンアップ用マーカー
        );
      end loop;
    end loop;
  end loop;
END $$;

-- 確認クエリ（任意）：店舗別の担当ランキング（今月）
-- select store, s.name, sum(d.amount) as sales
-- from daily_sales d join staff_members s on s.id = d.staff_member_id
-- where d.memo = 'DASH_DEMO'
-- group by store, s.name order by store, sales desc;
