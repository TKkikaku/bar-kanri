import { supabase } from './supabase.js'
import { getStore } from './store.js'
import { AUTO_BACK_CATEGORY } from './constants.js'

// スタッフ一覧（フリーを先頭、その後 sort_order / 作成順）
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff_members')
    .select('*')
    .order('is_free', { ascending: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// バック設定（単一行）
export async function fetchSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data
}

// バック自動計算（§6）。フリーは対象外。
export function calcBack(amount, nominatedDrinks, settings) {
  const salesBack = Math.floor(Number(amount) * Number(settings.sales_rate))
  const drinkBack = Number(nominatedDrinks) * Number(settings.drink_unit)
  return { salesBack, drinkBack, total: salesBack + drinkBack }
}

// 売上を登録（§7.1）＋ バック自動計上を daily_expenses に記録（§6）
export async function addSale(sale) {
  const store = getStore()

  const { data: inserted, error } = await supabase
    .from('daily_sales')
    .insert({
      store,
      date: sale.date,
      staff_member_id: sale.staff_member_id,
      amount: sale.amount,
      groups: sale.groups,
      ages: sale.ages && sale.ages.length ? sale.ages : null,
      nominated_drinks: sale.nominated_drinks,
      memo: sale.memo || null,
    })
    .select()
    .single()
  if (error) throw error

  // フリー以外なら自動バックを支出に計上
  let back = null
  if (!sale.isFree) {
    const settings = await fetchSettings()
    const b = calcBack(sale.amount, sale.nominated_drinks, settings)
    if (b.total > 0) {
      const { error: backErr } = await supabase.from('daily_expenses').insert({
        store,
        date: sale.date,
        amount: b.total,
        category: AUTO_BACK_CATEGORY,
        is_auto_back: true,
        related_sale_id: inserted.id,
        memo: null,
      })
      if (backErr) throw backErr
      back = b
    }
  }

  return { sale: inserted, back }
}

// 支出を登録（§7.2）
export async function addExpense(exp) {
  const store = getStore()
  const { error } = await supabase.from('daily_expenses').insert({
    store,
    date: exp.date,
    amount: exp.amount,
    category: exp.category,
    is_auto_back: false,
    memo: exp.memo || null,
  })
  if (error) throw error
}
