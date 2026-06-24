import {
  fetchStaff,
  fetchSettings,
  fetchGoal,
  addStaff,
  updateStaff,
  deleteStaff,
  updateSettings,
  upsertGoal,
} from './db.js'
import { reloadInputMasters } from './input.js'

const $ = (sel, root = document) => root.querySelector(sel)

let inited = false

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

function showMsg(el, text, kind) {
  el.textContent = text
  el.className = 'form-msg ' + (kind || '')
  el.hidden = false
  if (kind === 'ok') setTimeout(() => (el.hidden = true), 2500)
}

const curMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---------- スタッフ管理 ----------
async function renderStaffList() {
  const box = $('#staff-list')
  try {
    const staff = await fetchStaff()
    box.innerHTML = staff
      .map(
        (s) => `
      <div class="staff-row" data-id="${s.id}">
        <input class="staff-name" type="text" value="${esc(s.name)}" ${s.is_free ? 'data-free="1"' : ''}>
        ${s.is_free ? '<span class="badge auto">フリー</span>' : ''}
        <button type="button" class="btn-mini staff-save">保存</button>
        ${s.is_free ? '' : '<button type="button" class="btn-mini danger staff-del">削除</button>'}
      </div>`
      )
      .join('')
  } catch (err) {
    console.error(err)
    box.innerHTML = `<p class="form-msg err">スタッフの取得に失敗しました: ${esc(err.message || err)}</p>`
  }
}

async function handleStaffAdd() {
  const input = $('#staff-new')
  const msg = $('#staff-msg')
  const name = input.value.trim()
  if (!name) return showMsg(msg, 'スタッフ名を入力してください', 'err')
  try {
    await addStaff(name)
    input.value = ''
    await renderStaffList()
    await reloadInputMasters()
    showMsg(msg, '追加しました', 'ok')
  } catch (err) {
    console.error(err)
    showMsg(msg, '追加に失敗しました: ' + (err.message || err), 'err')
  }
}

async function handleStaffListClick(e) {
  const row = e.target.closest('.staff-row')
  if (!row) return
  const id = row.dataset.id
  const msg = $('#staff-msg')

  if (e.target.classList.contains('staff-save')) {
    const name = row.querySelector('.staff-name').value.trim()
    if (!name) return showMsg(msg, '名前を入力してください', 'err')
    try {
      await updateStaff(id, name)
      await reloadInputMasters()
      showMsg(msg, '保存しました', 'ok')
    } catch (err) {
      console.error(err)
      showMsg(msg, '保存に失敗しました: ' + (err.message || err), 'err')
    }
  }

  if (e.target.classList.contains('staff-del')) {
    const name = row.querySelector('.staff-name').value
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    try {
      await deleteStaff(id)
      await renderStaffList()
      await reloadInputMasters()
      showMsg(msg, '削除しました', 'ok')
    } catch (err) {
      console.error(err)
      // FK制約（売上参照あり）等
      showMsg(msg, '削除できません（売上記録がある担当は削除不可）', 'err')
    }
  }
}

// ---------- バック設定 ----------
async function loadBackSettings() {
  try {
    const s = await fetchSettings()
    $('#set-rate').value = Math.round(Number(s.sales_rate) * 1000) / 10 // 0.10 -> 10
    $('#set-unit').value = s.drink_unit
  } catch (err) {
    console.error(err)
  }
}

async function handleSettingsSave() {
  const msg = $('#set-msg')
  const ratePct = Number($('#set-rate').value)
  const unit = Number($('#set-unit').value)
  if (isNaN(ratePct) || ratePct < 0 || ratePct > 100) return showMsg(msg, '率は0〜100で入力してください', 'err')
  if (isNaN(unit) || unit < 0) return showMsg(msg, '単価を入力してください', 'err')
  try {
    await updateSettings({ sales_rate: ratePct / 100, drink_unit: unit })
    await reloadInputMasters()
    showMsg(msg, '保存しました', 'ok')
  } catch (err) {
    console.error(err)
    showMsg(msg, '保存に失敗しました: ' + (err.message || err), 'err')
  }
}

// ---------- 月次目標 ----------
export async function loadGoalField() {
  const month = $('#goal-month').value || curMonth()
  try {
    const goal = await fetchGoal(month)
    $('#goal-target').value = goal ? goal.target : ''
  } catch (err) {
    console.error(err)
  }
}

async function handleGoalSave() {
  const msg = $('#goal-msg')
  const month = $('#goal-month').value || curMonth()
  const target = Number($('#goal-target').value)
  if (isNaN(target) || target < 0) return showMsg(msg, '目標売上を入力してください', 'err')
  try {
    await upsertGoal(month, target)
    showMsg(msg, '保存しました', 'ok')
  } catch (err) {
    console.error(err)
    showMsg(msg, '保存に失敗しました: ' + (err.message || err), 'err')
  }
}

export async function loadSettings() {
  if (!inited) return
  await Promise.all([renderStaffList(), loadBackSettings(), loadGoalField()])
}

export function initSettings() {
  if (inited) return
  inited = true

  $('#goal-month').value = curMonth()

  $('#staff-add-btn').addEventListener('click', handleStaffAdd)
  $('#staff-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleStaffAdd()
    }
  })
  $('#staff-list').addEventListener('click', handleStaffListClick)
  $('#set-save').addEventListener('click', handleSettingsSave)
  $('#goal-save').addEventListener('click', handleGoalSave)
  $('#goal-month').addEventListener('change', loadGoalField)
}
