-- ============================================================
-- bar-kanri ダッシュボード確認用シードの削除（本番前クリーンアップ）
-- seed_dashboard_demo.sql で投入したデータのみを削除する。
-- Supabase ダッシュボード → SQL Editor で実行する。
--
-- ※ FK（daily_sales.staff_member_id → staff_members）のため、
--    先に売上を消してからスタッフを消す。
-- ※ 実在の「フリー」は sort_order が NULL のため削除されない（再利用しただけ）。
--    削除対象はこのシードが作った sort_order=900 のスタッフのみ。
-- ============================================================

-- 1) このシードの売上（マーカー付き）を削除
delete from daily_sales where memo = 'DASH_DEMO';

-- 2) このシードが作ったデモスタッフ（sort_order=900）を削除
delete from staff_members where sort_order = 900;

-- 確認：残っていないこと（0 件になればOK）
-- select count(*) from daily_sales   where memo = 'DASH_DEMO';
-- select count(*) from staff_members where sort_order = 900;
