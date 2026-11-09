// api/_zalo.js — Burn Money báo tin sang bot Zalo (Cloudflare Worker) + dựng báo cáo tổng hợp.
// File bắt đầu bằng "_" nên Vercel KHÔNG biến nó thành đường dẫn /api.
//
// Biến môi trường trên Vercel (Settings → Environment Variables), KHÔNG ghi vào code vì repo công khai:
//   ZALO_NOTIFY_KEY  = NOTIFY_KEY trong CONFIG của bot Zalo  (thiếu → không báo thay đổi)
//   ZALO_REPORT_KEY  = BURN_SECRET trong CONFIG của bot Zalo (thiếu → /api/zalo từ chối mọi yêu cầu)
//   ZALO_NOTIFY_URL  = (không bắt buộc) link /notify của bot, mặc định như bên dưới
//   ZALO_BIG_AMOUNT  = (không bắt buộc) khoản chi từ mức này trở lên được đánh dấu 🔥, mặc định 500000
import { alive } from './_store.js';

const NOTIFY_URL = () => process.env.ZALO_NOTIFY_URL || 'https://zalochatbotchomne.william-archvn.workers.dev/notify';
const BIG = () => Number(process.env.ZALO_BIG_AMOUNT) || 500000;

/* ---------- Ngày giờ: giờ Việt Nam, "ngày chi tiêu" bắt đầu lúc 6:00 sáng (giống app) ---------- */
const TZ = 7 * 3600e3, DAY_START_H = 6;
const pad2 = n => String(n).padStart(2, '0');
const vnDate = ts => new Date(ts + TZ);                                  // đọc bằng getUTC*
const ymd = d => d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
export const dayKeyOf = ts => ymd(vnDate(ts - DAY_START_H * 3600e3));
const dkDate = dk => { const [y, m, d] = dk.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (dk, n) => { const d = dkDate(dk); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const daysInMonth = mk => { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const prevMonth = mk => { const [y, m] = mk.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; };
const WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const WDS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wdOf = dk => dkDate(dk).getUTCDay();
const dm = dk => dk.slice(8, 10) + '/' + dk.slice(5, 7);
const dkLabel = dk => `${WD[wdOf(dk)]}, ${dm(dk)}`;
const monthLabel = mk => `tháng ${Number(mk.slice(5, 7))}/${mk.slice(0, 4)}`;

/* ---------- Tiền ---------- */
const NF = new Intl.NumberFormat('vi-VN');
const money = v => (v < 0 ? '−' : '') + NF.format(Math.abs(Math.round(v))) + 'đ';
const short = v => {                                                     // 1,2tr · 350k
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + (Math.round(a / 1e5) / 10).toString().replace('.', ',') + 'tr';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'k';
  return s + Math.round(a) + 'đ';
};
const k1 = v => Math.round(v / 1000) * 1000;                             // làm tròn nghìn cho số ước tính
const sum = arr => arr.reduce((a, e) => a + e.amount, 0);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ---------- Dữ liệu: bản ghi trên Blob → dạng dễ tính (giống buildView trong index.html) ---------- */
export function viewOf(doc) {
  const live = c => Object.entries((doc && doc.recs && doc.recs[c]) || {}).filter(([, r]) => r && r.d && alive(r));
  const budgets = {};
  for (const [id, r] of live('b')) if (typeof r.d.v === 'number') budgets[id] = r.d.v;
  const expenses = live('e').filter(([, r]) => r.d.amount > 0 && r.d.day && r.d.ts)
    .map(([id, r]) => ({ id, amount: r.d.amount, note: r.d.note || '', kind: r.d.kind === 'fixed' ? 'fixed' : 'manual', ts: r.d.ts, day: r.d.day, emoji: r.d.emoji || '' }));
  const templates = live('t').filter(([, r]) => r.d.name && r.d.amount > 0).map(([id, r]) => ({ id, name: r.d.name, amount: r.d.amount, emoji: r.d.emoji || '🧾' }));
  return { budgets, expenses, templates };
}
function budgetFor(v, mk) {
  if (v.budgets[mk] != null) return v.budgets[mk];
  const keys = Object.keys(v.budgets).filter(k => k < mk).sort();
  return keys.length ? v.budgets[keys[keys.length - 1]] : 0;
}
const monthExp = (v, mk) => v.expenses.filter(e => e.day.slice(0, 7) === mk);
const dayExp = (v, dk) => v.expenses.filter(e => e.day === dk);
/* Mức được chi trong ngày = ngân sách tháng còn lại (tính đến đầu ngày) ÷ số ngày còn lại kể cả hôm đó — y như app */
function dayBudget(v, dk) {
  const mk = dk.slice(0, 7), B = budgetFor(v, mk);
  if (!B) return 0;
  const before = sum(v.expenses.filter(e => e.day.slice(0, 7) === mk && e.day < dk));
  const left = daysInMonth(mk) - Number(dk.slice(8, 10)) + 1;
  const x = (B - before) / left;
  if (x <= 0) return 0;
  return x >= 1000 ? Math.floor(x / 1000) * 1000 : Math.floor(x);
}
const label = e => `${e.emoji ? e.emoji + ' ' : ''}${clip(e.note || 'Khoản chi', 40)}`;
const groupKey = e => (e.note || 'Khoản chi').trim().toLowerCase();
function topGroups(list, n) {
  const m = new Map();
  for (const e of list) {
    const k = groupKey(e), g = m.get(k) || { name: label(e), amount: 0, count: 0 };
    g.amount += e.amount; g.count++; m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

/* Dòng tình hình chung: hôm nay + tháng này, kèm cảnh báo */
function statusLines(v, now = Date.now()) {
  const dk = dayKeyOf(now), mk = dk.slice(0, 7);
  const today = sum(dayExp(v, dk)), allow = dayBudget(v, dk);
  const month = sum(monthExp(v, mk)), B = budgetFor(v, mk);
  const out = [];
  out.push(`📅 Hôm nay: ${money(today)}${allow ? ` / được chi ${money(allow)}` : ''}`);
  out.push(`🗓 ${monthLabel(mk).replace(/^t/, 'T')}: ${money(month)}${B ? ` / ${money(B)} (${pct(month, B)}%)` : ''}`);
  const warn = [];
  if (allow && today > allow) warn.push(`⚠️ Vượt mức hôm nay ${money(today - allow)}`);
  if (B && month > B) warn.push(`🚨 Đã vượt ngân sách tháng ${money(month - B)}`);
  else if (B && month >= B * 0.8) warn.push(`⚠️ Đã dùng ${pct(month, B)}% ngân sách tháng`);
  return { lines: out, warn };
}

/* ---------- Gọi bot Zalo ---------- */
async function postNotify(payload) {
  const key = process.env.ZALO_NOTIFY_KEY;
  if (!key) { console.log('[zalo] Chưa đặt ZALO_NOTIFY_KEY → bỏ qua báo tin'); return false; }
  const r = await fetch(NOTIFY_URL(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-key': key, 'user-agent': 'Mozilla/5.0 (burn-money)' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3500),
  });
  if (!r.ok) console.log('[zalo] /notify trả lỗi', r.status, (await r.text().catch(() => '')).slice(0, 200));
  return r.ok;
}

/* ---------- 1. Báo thay đổi (gọi từ api/sync.js sau khi ghi thành công) ----------
   changes: danh sách đã lọc của /api/sync · doc: dữ liệu SAU khi gộp (nguồn đúng nhất)
   zalo: gợi ý từ máy gửi { device, mute, ops: {"e:id": "add"|"edit"|"del"} } */
export async function notifyChanges(changes, doc, zalo) {
  zalo = zalo && typeof zalo === 'object' ? zalo : {};
  if (zalo.mute === true) return false;
  const ops = zalo.ops && typeof zalo.ops === 'object' ? zalo.ops : {};
  const device = clip(typeof zalo.device === 'string' ? zalo.device : '', 24);
  const nowDK = dayKeyOf(Date.now());

  const adds = [], edits = [], dels = [], other = [];
  for (const ch of changes) {
    if (!['e', 'b', 't'].includes(ch.c)) continue;                        // "bỏ qua hôm nay" của thẻ cố định: không báo
    const r = (doc.recs[ch.c] && doc.recs[ch.c][ch.id]) || ch.r;
    if (!r || !r.d) continue;
    const isAlive = alive(r);
    let op = ops[`${ch.c}:${ch.id}`];
    if (!['add', 'edit', 'del'].includes(op)) op = !isAlive ? 'del' : (!r.t ? 'add' : 'edit');
    if (!isAlive) op = 'del';
    else if (op === 'del') op = 'edit';
    const d = r.d;
    if (ch.c === 'e') {
      if (!(d.amount > 0)) continue;
      const e = { amount: d.amount, note: d.note, emoji: d.emoji };
      const when = d.day && d.day !== nowDK ? ` (ngày ${dm(d.day)})` : '';
      const fire = d.amount >= BIG() ? ' 🔥' : '';
      const line = `${label(e)} ${money(d.amount)}${when}${fire}`;
      (op === 'add' ? adds : op === 'edit' ? edits : dels).push({ line, amount: d.amount });
    } else if (ch.c === 'b') {
      other.push(op === 'del' ? `💰 Bỏ ngân sách ${monthLabel(ch.id)}` : `💰 Ngân sách ${monthLabel(ch.id)}: ${money(d.v || 0)}`);
    } else if (ch.c === 't') {
      const nm = `${d.emoji || '🧾'} ${clip(d.name, 30)}${d.amount ? ' ' + money(d.amount) : ''}`;
      other.push(op === 'add' ? `🧾 Thêm thẻ cố định: ${nm}` : op === 'edit' ? `🧾 Sửa thẻ cố định: ${nm}` : `🧾 Xóa thẻ cố định: ${nm}`);
    }
  }
  if (!adds.length && !edits.length && !dels.length && !other.length) return false;

  const lines = [];
  const block = (arr, icon, word) => {
    if (!arr.length) return;
    if (arr.length > 10) {                                                // vd lần đầu chuyển dữ liệu cũ lên: gom lại cho gọn
      lines.push(`${icon} ${word} ${arr.length} khoản, tổng ${money(arr.reduce((a, x) => a + x.amount, 0))}`);
      for (const x of arr.slice(0, 5)) lines.push(`   • ${x.line}`);
      lines.push(`   • … và ${arr.length - 5} khoản nữa`);
    } else for (const x of arr) lines.push(`${icon} ${x.line}`);
  };
  block(adds, '➕', 'Thêm');
  block(edits, '✏️', 'Sửa');
  block(dels, '🗑', 'Xóa');
  lines.push(...other);

  const v = viewOf(doc);
  const st = statusLines(v);
  const head = `🔥 ${device ? device + ' vừa' : 'Vừa có người'} cập nhật Burn Money`;
  const text = [head, ...lines, '', ...st.lines, ...st.warn].join('\n');
  return postNotify({ src: 'Burn Money', text, cooldown: 0, level: st.warn.some(w => w.startsWith('🚨')) ? 'gap' : 'thuong' });
}

/* ---------- 2. Báo cáo tổng hợp (bot Zalo gọi /api/zalo lúc 21:00 hoặc khi gõ /burn) ----------
   Trả về danh sách tin: { text, chart?: { type, title, labels, datasets, unit } } — bot tự vẽ ảnh và gửi. */
function dayReport(v, dk) {
  const mk = dk.slice(0, 7), list = dayExp(v, dk), today = sum(list), allow = dayBudget(v, dk);
  const month = sum(monthExp(v, mk).filter(e => e.day <= dk)), B = budgetFor(v, mk);
  const dim = daysInMonth(mk), d = Number(dk.slice(8, 10)), left = dim - d;
  const t = [`📊 Burn Money · ${dkLabel(dk)}`, ''];
  t.push(`Hôm nay chi ${money(today)} (${list.length} khoản)`);
  if (allow) t.push(today <= allow ? `✅ Dưới mức được chi ${money(allow)}, dư ${money(allow - today)}` : `⚠️ Vượt mức được chi ${money(allow)} là ${money(today - allow)}`);
  if (list.length) {
    t.push('', 'Khoản lớn nhất:');
    for (const e of [...list].sort((a, b) => b.amount - a.amount).slice(0, 3)) t.push(`• ${label(e)} ${money(e.amount)}`);
  }
  t.push('', `${monthLabel(mk).replace(/^t/, 'T')}: đã chi ${money(month)}${B ? ` / ${money(B)} (${pct(month, B)}%)` : ''}`);
  if (B) {
    const remain = B - month;
    if (remain >= 0) t.push(`Còn ${money(remain)} cho ${left} ngày${left ? ` → khoảng ${money(Math.floor(remain / left / 1000) * 1000)}/ngày` : ''}`);
    else t.push(`🚨 Đã vượt ngân sách ${money(-remain)}`);
    const forecast = (month / d) * dim;
    t.push(`Cứ đà này cuối tháng ≈ ${money(k1(forecast))} (${forecast <= B ? 'trong' : 'vượt'} ngân sách)`);
  } else t.push('Chưa đặt ngân sách tháng — đặt trong ⚙ Cài đặt của app.');
  // Biểu đồ: 7 ngày gần nhất, cột = đã chi, đường = mức được chi
  const days = [...Array(7)].map((_, i) => addDays(dk, i - 6));
  const spent = days.map(x => Math.round(sum(dayExp(v, x)) / 1000));
  const allowArr = days.map(x => Math.round(dayBudget(v, x) / 1000));
  const datasets = [{ label: 'Đã chi', data: spent }];
  if (allowArr.some(Boolean)) datasets.push({ label: 'Được chi', data: allowArr, color: '#BAB0AC' });
  return { text: t.join('\n'), chart: { type: 'bar', title: '7 ngày gần nhất', labels: days.map(x => `${WDS[wdOf(x)]} ${dm(x)}`), datasets, unit: 'nghìn đồng' } };
}

function weekReport(v, dk) {
  const wd = (wdOf(dk) + 6) % 7;                                         // T2 = 0 … CN = 6
  const mon = addDays(dk, -wd), prevMon = addDays(mon, -7);
  const week = [...Array(7)].map((_, i) => addDays(mon, i)), prev = [...Array(7)].map((_, i) => addDays(prevMon, i));
  const a = week.map(x => (x <= dk ? sum(dayExp(v, x)) : 0)), b = prev.map(x => sum(dayExp(v, x)));
  const ta = a.reduce((s, x) => s + x, 0), tbSame = b.slice(0, wd + 1).reduce((s, x) => s + x, 0), tb = b.reduce((s, x) => s + x, 0);
  const list = v.expenses.filter(e => e.day >= mon && e.day <= dk);
  const maxI = a.indexOf(Math.max(...a));
  const t = [`📈 Tổng kết tuần ${dm(mon)} – ${dm(addDays(mon, 6))}`, ''];
  t.push(`Tuần này: ${money(ta)} (${list.length} khoản) · TB ${money(k1(ta / (wd + 1)))}/ngày`);
  if (tbSame) {
    const p = Math.round(((ta - tbSame) / tbSame) * 100);
    t.push(`So với cùng kỳ tuần trước (${money(tbSame)}): ${p >= 0 ? '▲ tăng' : '▼ giảm'} ${Math.abs(p)}%`);
  } else if (tb) t.push(`Tuần trước: ${money(tb)}`);
  if (ta) t.push(`Ngày chi nhiều nhất: ${WD[wdOf(week[maxI])]} (${money(a[maxI])})`);
  const fixed = sum(list.filter(e => e.kind === 'fixed'));
  if (ta) t.push(`Chi cố định ${money(fixed)} · phát sinh ${money(ta - fixed)}`);
  const top = topGroups(list, 5);
  if (top.length) { t.push('', 'Chi nhiều nhất theo nội dung:'); for (const g of top) t.push(`• ${g.name}: ${money(g.amount)}${g.count > 1 ? ` (${g.count} lần)` : ''}`); }
  return {
    text: t.join('\n'),
    chart: { type: 'bar', title: 'Tuần này so với tuần trước', labels: WDS.slice(1).concat('CN'), unit: 'nghìn đồng',
      datasets: [{ label: 'Tuần trước', data: b.map(x => Math.round(x / 1000)), color: '#BAB0AC' }, { label: 'Tuần này', data: a.map(x => Math.round(x / 1000)) }] },
  };
}

function monthReport(v, mk, uptoDK) {
  const dim = daysInMonth(mk), lastDK = `${mk}-${pad2(dim)}`, end = uptoDK && uptoDK < lastDK ? uptoDK : lastDK;
  const list = monthExp(v, mk).filter(e => e.day <= end), total = sum(list), B = budgetFor(v, mk);
  const nDays = Number(end.slice(8, 10));
  const pm = prevMonth(mk), prevTotal = sum(monthExp(v, pm));
  const days = [...Array(nDays)].map((_, i) => `${mk}-${pad2(i + 1)}`);
  const per = days.map(x => sum(dayExp(v, x)));
  const overDays = days.filter((x, i) => { const al = dayBudget(v, x); return al && per[i] > al; }).length;
  const fixed = sum(list.filter(e => e.kind === 'fixed'));
  const t = [`🗓 Tổng kết ${monthLabel(mk)}${end < lastDK ? ` (đến ${dm(end)})` : ''}`, ''];
  t.push(`Tổng chi: ${money(total)} (${list.length} khoản) · TB ${money(k1(total / (nDays || 1)))}/ngày`);
  if (B) t.push(total <= B ? `✅ Trong ngân sách ${money(B)} (${pct(total, B)}%), dư ${money(B - total)}` : `🚨 Vượt ngân sách ${money(B)} là ${money(total - B)} (${pct(total, B)}%)`);
  if (prevTotal) { const p = Math.round(((total - prevTotal) / prevTotal) * 100); t.push(`So với ${monthLabel(pm)} (${money(prevTotal)}): ${p >= 0 ? '▲ tăng' : '▼ giảm'} ${Math.abs(p)}%`); }
  if (B) t.push(`Số ngày vượt mức được chi: ${overDays}/${nDays}`);
  if (total) t.push(`Chi cố định ${money(fixed)} (${pct(fixed, total)}%) · phát sinh ${money(total - fixed)}`);
  const top = topGroups(list, 5);
  if (top.length) { t.push('', 'Chi nhiều nhất theo nội dung:'); for (const g of top) t.push(`• ${g.name}: ${money(g.amount)}${g.count > 1 ? ` (${g.count} lần)` : ''}`); }
  return { text: t.join('\n'), chart: { type: 'bar', title: `Chi tiêu từng ngày ${monthLabel(mk)}`, labels: days.map(x => String(Number(x.slice(8)))), datasets: [{ label: 'Đã chi', data: per.map(x => Math.round(x / 1000)) }], unit: 'nghìn đồng' } };
}

/* kind: day | week | month | lastmonth | auto (tối: báo cáo ngày; Chủ Nhật thêm tuần; ngày cuối tháng thêm tháng) */
export function buildReports(doc, kind = 'day', now = Date.now()) {
  const v = viewOf(doc), dk = dayKeyOf(now), mk = dk.slice(0, 7);
  if (kind === 'week') return [weekReport(v, dk)];
  if (kind === 'month') return [monthReport(v, mk, dk)];
  if (kind === 'lastmonth') return [monthReport(v, prevMonth(mk))];
  const out = [dayReport(v, dk)];
  if (kind === 'auto') {
    if (wdOf(dk) === 0) out.push(weekReport(v, dk));
    if (Number(dk.slice(8, 10)) === daysInMonth(mk)) out.push(monthReport(v, mk));
  }
  return out;
}
