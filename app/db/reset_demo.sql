-- ============================================================
-- bar-kanri デモデータ削除（7月の本番運用開始前に実行）
-- 6/30以前の売上・支出・月次目標を全削除する。
-- Supabase ダッシュボード → SQL Editor で実行する。
-- ※ FK（daily_expenses.related_sale_id → daily_sales）があるため、
--   先に支出（バック自動計上含む）を消してから売上を消す。
-- ※ スタッフ（staff_members）は日付を持たないため削除しない。
--   デモ用スタッフも消したい場合は末尾のコメントを外す。
-- ============================================================

-- 支出（手入力＋バック自動計上）を先に削除
delete from daily_expenses where date <= date '2026-06-30';

-- 売上を削除
delete from daily_sales where date <= date '2026-06-30';

-- 6月以前の月次目標を削除
delete from monthly_goals where month <= '2026-06';

-- ---------- （任意）デモ用スタッフも削除する場合 ----------
-- 売上を消した後なら FK 参照が無くなり削除できる。
-- 7人だけ消す（あや/みお/フリーは残す）場合:
-- delete from staff_members
--   where name in ('みき','なな','れん','つばき','りお','ひな','さくら')
--     and is_free = false;
