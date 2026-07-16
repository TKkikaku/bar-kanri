-- ============================================================
-- bar-kanri ダッシュボード確認用シードの削除（本番前クリーンアップ）
-- seed_dashboard_demo.sql で投入したデータのみを削除する。
-- Supabase ダッシュボード → SQL Editor で実行する。
--
-- ※ FK 順：daily_expenses.related_slip_id → sales_slips のため、
--    先に（あれば）バック支出を消し、次に伝票を消す。
--    明細（sales_slip_details）は sales_slips の on delete cascade で自動削除。
-- ※ 実在の「フリー」は sort_order が 0/NULL のため削除されない（再利用しただけ）。
--    削除対象はこのシードが作った sort_order=900 のスタッフのみ。
-- ============================================================

-- 1) このシードの伝票に紐づくバック支出（本デモは作らないが防御的に）を削除
delete from daily_expenses
where related_slip_id in (select id from sales_slips where memo = 'DASH_DEMO');

-- 2) このシードの伝票（マーカー付き）を削除（明細は cascade）
delete from sales_slips where memo = 'DASH_DEMO';

-- 3) このシードが作ったデモスタッフ（sort_order=900）を削除
delete from staff_members where sort_order = 900;

-- 確認：残っていないこと（0 件になればOK）
-- select count(*) from sales_slips    where memo = 'DASH_DEMO';
-- select count(*) from staff_members  where sort_order = 900;
