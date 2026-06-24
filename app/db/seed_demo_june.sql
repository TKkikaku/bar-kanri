-- ============================================================
-- bar-kanri 6月デモデータ投入（本番稼働は7月から / 6月はデモ用）
-- Supabase ダッシュボード → SQL Editor で実行する。
-- ※ 売上はランダム生成のため「1回だけ」実行すること（再実行すると二重投入）。
-- ※ 既存の「あや」のテスト売上はこのSQLでは触らない。削除は reset_demo.sql。
--
-- 【修正版】担当・客層が全行同一になる不具合を修正。
--   原因: cross join lateral(... order by random() limit 1) が
--         店舗ごとに1回しか評価されず全行に同じ値が入っていた。
--   対策: PL/pgSQL の DO ブロックでループし、行ごとに random() を独立評価。
-- ============================================================

-- ---------- 1) スタッフ追加（7人 / 全員 is_free=false）----------
insert into staff_members (name, is_free, sort_order)
select v.name, false, v.so
from (values
  ('みき', 3), ('なな', 4), ('れん', 5), ('つばき', 6),
  ('りお', 7), ('ひな', 8), ('さくら', 9)
) as v(name, so)
where not exists (select 1 from staff_members sm where sm.name = v.name);

-- ---------- 2) 6月のデモ売上＋バック自動計上（行ごとにランダム）----------
DO $$
DECLARE
  v_age_tags text[] := array['20代','30代','40代','50代','60代以上'];
  v_rate numeric;
  v_unit int;
  s record;          -- 店舗 (store, lo, hi)
  v_day date;
  v_count int;
  i int;
  v_staff_id uuid;
  v_is_free boolean;
  v_amount int;
  v_groups int;
  v_drinks int;
  v_nages int;
  v_ages text[];
  v_sale_id uuid;
  v_back int;
BEGIN
  select sales_rate, drink_unit into v_rate, v_unit from app_settings where id = 1;

  FOR s IN
    SELECT * FROM (VALUES ('スタンド', 2, 5), ('サンライズ', 1, 4)) AS t(store, lo, hi)
  LOOP
    v_day := date '2026-06-01';
    WHILE v_day <= date '2026-06-24' LOOP
      -- その日の件数（スタンド 2〜5 / サンライズ 1〜4）
      v_count := s.lo + floor(random() * (s.hi - s.lo + 1))::int;

      FOR i IN 1..v_count LOOP
        -- 担当をランダムに1人（フリー含む）※毎回評価される
        SELECT id, is_free INTO v_staff_id, v_is_free
        FROM staff_members ORDER BY random() LIMIT 1;

        v_amount := 15000 + floor(random() * 65001)::int;   -- 15,000〜80,000
        v_groups := 1 + floor(random() * 5)::int;            -- 1〜5
        v_drinks := floor(random() * 16)::int;               -- 0〜15

        -- 客層 1〜3個をランダム選択
        v_nages := 1 + floor(random() * 3)::int;
        SELECT array_agg(tag) INTO v_ages
        FROM (
          SELECT unnest(v_age_tags) AS tag ORDER BY random() LIMIT v_nages
        ) sub;

        INSERT INTO daily_sales (store, date, staff_member_id, amount, groups, ages, nominated_drinks, memo)
        VALUES (s.store, v_day, v_staff_id, v_amount, v_groups, v_ages, v_drinks, 'demo')
        RETURNING id INTO v_sale_id;

        -- バック自動計上（フリーは対象外・§6）
        IF NOT v_is_free THEN
          v_back := floor(v_amount * v_rate)::int + v_drinks * v_unit;
          IF v_back > 0 THEN
            INSERT INTO daily_expenses (store, date, amount, category, is_auto_back, related_sale_id, memo)
            VALUES (s.store, v_day, v_back, 'バック自動計上', true, v_sale_id, null);
          END IF;
        END IF;
      END LOOP;

      v_day := v_day + 1;
    END LOOP;
  END LOOP;
END $$;

-- ---------- 3) 6月の支出（手入力分・数件）----------
insert into daily_expenses (store, date, amount, category, is_auto_back, memo) values
  -- スタンド
  ('スタンド', '2026-06-01', 120000, '家賃',     false, 'demo'),
  ('スタンド', '2026-06-08',  42800, '電気',     false, 'demo'),
  ('スタンド', '2026-06-03',  40500, '酒代',     false, 'demo'),
  ('スタンド', '2026-06-17',  38200, '酒代',     false, 'demo'),
  ('スタンド', '2026-06-11',   9800, '消耗品費', false, 'demo'),
  ('スタンド', '2026-06-05',   6600, 'Wi-Fi',    false, 'demo'),
  ('スタンド', '2026-06-01',   5000, '通り会費', false, 'demo'),
  -- サンライズ
  ('サンライズ', '2026-06-01', 120000, '家賃',     false, 'demo'),
  ('サンライズ', '2026-06-08',  42800, '電気',     false, 'demo'),
  ('サンライズ', '2026-06-04',  40500, '酒代',     false, 'demo'),
  ('サンライズ', '2026-06-12',   7200, '消耗品費', false, 'demo'),
  ('サンライズ', '2026-06-06',   8000, 'カラオケ代', false, 'demo'),
  ('サンライズ', '2026-06-20',   4300, '雑費',     false, 'demo');

-- ---------- 4) 6月の月次目標（デモ表示用）----------
insert into monthly_goals (store, month, target) values
  ('スタンド',   '2026-06', 1500000),
  ('サンライズ', '2026-06', 1000000)
on conflict (store, month) do nothing;
