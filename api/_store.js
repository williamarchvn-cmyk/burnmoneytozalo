// api/_store.js — logic dùng chung cho các Vercel Function.
// File bắt đầu bằng "_" nên Vercel KHÔNG biến nó thành một đường dẫn /api.
import {
  head, get, put,
  BlobNotFoundError, BlobPreconditionFailedError, BlobStoreNotFoundError,
  BlobStoreSuspendedError, BlobAccessError, BlobServiceRateLimited, BlobError,
} from '@vercel/blob';

export const DATA_PATH = 'burn-money/data.json';
export const COLS = ['b', 't', 'e', 's'];           // b: ngân sách, t: thẻ cố định, e: khoản chi, s: bỏ qua hôm nay
export const FIELDS = {
  b: ['v'],
  t: ['name', 'amount', 'emoji', 'c'],
  e: ['amount', 'note', 'kind', 'ts', 'day', 'emoji', 'tid'],
  s: ['day', 'tid'],
};
const TOMB_TTL = 120 * 864e5;                      // xóa hẳn "bia mộ" sau 120 ngày
const MAX_BODY = 4e6;

export const emptyDoc = () => ({ app: 'burn-money', v: 2, rev: 0, updatedAt: 0, recs: { b: {}, t: {}, e: {}, s: {} } });

/* ---------- Gộp dữ liệu theo từng trường (mỗi trường có dấu thời gian riêng) ----------
   Bản ghi: { d: {trường: giá trị}, u: thời điểm chung, t?: {trường: thời điểm riêng}, x?: thời điểm xóa }
   - 2 người sửa 2 trường khác nhau của cùng 1 khoản → giữ cả hai.
   - Cùng 1 trường → bản sửa sau cùng thắng.
   - Bản ghi còn "sống" nếu có trường được sửa sau thời điểm xóa.
   Hàm gộp có tính giao hoán + kết hợp + lũy đẳng → mọi máy hội tụ về cùng kết quả. */
const fu = (r, f) => (r.t && r.t[f] != null ? r.t[f] : r.u);
const maxU = r => { let m = r.u || 0; if (r.t) for (const k in r.t) if (r.t[k] > m) m = r.t[k]; return m; };
export const alive = r => !r.x || maxU(r) > r.x;
const sv = v => (v === undefined || v === null ? 'null' : JSON.stringify(v));
function normalize(col, d, us, x) {
  const cnt = new Map();
  for (const f of FIELDS[col]) cnt.set(us[f], (cnt.get(us[f]) || 0) + 1);
  let u = 0, best = -1;
  for (const [k, n] of cnt) if (n > best || (n === best && k > u)) { best = n; u = k; }
  const r = { d: {}, u };
  for (const f of FIELDS[col]) if (d[f] !== undefined && d[f] !== null) r.d[f] = d[f];
  const t = {}; let has = false;
  for (const f of FIELDS[col]) if (us[f] !== u) { t[f] = us[f]; has = true; }
  if (has) r.t = t;
  if (x) r.x = x;
  return r;
}
const usOf = (col, r) => Object.fromEntries(FIELDS[col].map(f => [f, fu(r, f)]));
export function mergeRec(col, a, b) {
  if (!a && !b) return null;
  if (!a) return normalize(col, b.d || {}, usOf(col, b), b.x || 0);
  if (!b) return normalize(col, a.d || {}, usOf(col, a), a.x || 0);
  const d = {}, us = {};
  for (const f of FIELDS[col]) {
    const ua = fu(a, f), ub = fu(b, f), va = a.d ? a.d[f] : undefined, vb = b.d ? b.d[f] : undefined;
    const takeA = ua > ub || (ua === ub && sv(va) >= sv(vb));
    d[f] = takeA ? va : vb; us[f] = takeA ? ua : ub;
  }
  return normalize(col, d, us, Math.max(a.x || 0, b.x || 0));
}
export function canon(col, r) {
  if (!r) return '';
  let s = '';
  for (const f of FIELDS[col]) s += sv(r.d && r.d[f]) + '\u0001' + fu(r, f) + '\u0002';
  return s + (r.x || 0);
}

/* ---------- Kiểm tra dữ liệu gửi lên (ai có link cũng gửi được, nên phải chặn dữ liệu hỏng) ---------- */
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const okU = v => isNum(v) && v > 1.5e12 && v < Date.now() + 366 * 864e5;
const okStr = (n, min = 0) => v => typeof v === 'string' && v.length <= n && v.trim().length >= min;
const VALID = {
  v: v => isNum(v) && v >= 0 && v < 1e13,
  name: okStr(40, 1), note: okStr(80), emoji: okStr(16), tid: okStr(64, 1),
  amount: v => isNum(v) && v > 0 && v < 1e13,
  c: isNum, ts: v => isNum(v) && v > 0,
  kind: v => v === 'fixed' || v === 'manual',
  day: v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
};
const ID_RE = /^[A-Za-z0-9_|.\-]{1,80}$/;
export function cleanRec(col, r) {
  if (!FIELDS[col] || !r || typeof r !== 'object' || !okU(r.u)) return null;
  const src = r.d && typeof r.d === 'object' ? r.d : {};
  const d = {};
  for (const f of FIELDS[col]) {
    const v = src[f];
    if (v === undefined || v === null) continue;
    if (!VALID[f](v)) return null;
    d[f] = v;
  }
  const out = { d, u: r.u };
  if (r.t && typeof r.t === 'object') {
    const t = {}; let has = false;
    for (const f of FIELDS[col]) if (r.t[f] != null) { if (!okU(r.t[f])) return null; t[f] = r.t[f]; has = true; }
    if (has) out.t = t;
  }
  if (r.x) { if (!okU(r.x)) return null; out.x = r.x; }
  return out;
}
export function cleanChanges(list) {
  if (!Array.isArray(list)) return null;
  if (list.length > 20000) return null;
  const out = [];
  for (const ch of list) {
    if (!ch || !FIELDS[ch.c] || typeof ch.id !== 'string' || !ID_RE.test(ch.id)) continue;
    const r = cleanRec(ch.c, ch.r);
    if (r) out.push({ c: ch.c, id: ch.id, r });
  }
  return out;
}
export function applyChanges(doc, changes, now = Date.now()) {
  let changed = 0;
  for (const { c, id, r } of changes) {
    const cur = doc.recs[c][id];
    const m = mergeRec(c, cur, r);
    if (!cur || canon(c, m) !== canon(c, cur)) { doc.recs[c][id] = m; changed++; }
  }
  if (changed) {
    for (const c of COLS) for (const id of Object.keys(doc.recs[c])) {
      const r = doc.recs[c][id];
      if (!alive(r) && r.x < now - TOMB_TTL) delete doc.recs[c][id];
    }
    doc.rev = (doc.rev || 0) + 1;
    doc.updatedAt = now;
  }
  return changed;
}
export function parseDoc(text) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || !o.recs) throw new Error('Dữ liệu trên Blob không đúng định dạng Burn Money');
  const doc = emptyDoc();
  doc.rev = o.rev || 0; doc.updatedAt = o.updatedAt || 0;
  for (const c of COLS) if (o.recs[c] && typeof o.recs[c] === 'object') doc.recs[c] = o.recs[c];
  return doc;
}

/* ---------- Đọc / ghi Vercel Blob ---------- */
// Đọc bản MỚI NHẤT để ghi: ETag lấy từ head() (đúng loại ETag dùng cho ifMatch),
// nội dung lấy với useCache:false (bỏ qua CDN cache ~60 giây). KHÔNG dùng ETag của lượt tải file.
export async function readForWrite() {
  let h;
  try { h = await head(DATA_PATH); }
  catch (e) { if (e instanceof BlobNotFoundError) return { etag: null, doc: emptyDoc(), info: null }; throw e; }
  const r = await get(h.url, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { etag: null, doc: emptyDoc(), info: null };
  const text = await new Response(r.stream).text();
  return { etag: h.etag, doc: parseDoc(text), info: { size: h.size, uploadedAt: h.uploadedAt, headEtag: h.etag, downloadEtag: r.blob.etag } };
}
export async function writeDoc(doc, etag) {
  const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
  if (etag) { opts.allowOverwrite = true; opts.ifMatch = etag; }   // chỉ ghi đè nếu chưa ai ghi xen vào
  else opts.allowOverwrite = false;                                 // lần ghi đầu tiên: không đè file người khác vừa tạo
  return put(DATA_PATH, JSON.stringify(doc), opts);
}
export const isConflict = (e, creating) => e instanceof BlobPreconditionFailedError || (creating && e instanceof BlobError && !(e instanceof BlobStoreSuspendedError) && !(e instanceof BlobAccessError) && !(e instanceof BlobStoreNotFoundError));

/* Gộp thay đổi vào file trên Blob, tự thử lại khi có người ghi xen vào giữa chừng */
export async function mergeAndSave(changes) {
  let creatingFails = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { etag, doc } = await readForWrite();
    const changed = applyChanges(doc, changes);
    if (!changed) return { doc, wrote: false, attempts: attempt + 1 };
    if (JSON.stringify(doc).length > MAX_BODY) throw new Error('Dữ liệu quá lớn (> 4 MB)');
    try {
      const res = await writeDoc(doc, etag);
      return { doc, wrote: true, attempts: attempt + 1, etag: res.etag };
    } catch (e) {
      if (!isConflict(e, !etag)) throw e;
      if (!etag && ++creatingFails > 3) throw e;
      await new Promise(r => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  const err = new Error('Quá nhiều người ghi cùng lúc, hãy thử lại'); err.status = 409; throw err;
}

/* ---------- Tiện ích phản hồi ---------- */
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...extra },
  });
}
export function explain(e) {
  const m = String((e && e.message) || e);
  if (/No blob credentials/i.test(m)) return 'Chưa kết nối Blob store với project, hoặc chưa Redeploy sau khi kết nối (biến BLOB_STORE_ID chỉ có hiệu lực ở lần deploy mới).';
  if (e instanceof BlobStoreSuspendedError) return 'Blob store đang bị tạm khóa, thường do vượt hạn mức miễn phí Hobby trong tháng.';
  if (e instanceof BlobStoreNotFoundError) return 'Không tìm thấy Blob store. Có thể store đã bị xóa hoặc chưa kết nối với project.';
  if (e instanceof BlobAccessError) return 'Không có quyền vào Blob store. Kiểm tra store đã kết nối với project và đã Redeploy.';
  if (e instanceof BlobServiceRateLimited) return 'Vercel Blob đang giới hạn tốc độ. Đợi một chút rồi thử lại.';
  if (/OIDC is enabled for this project, but not/i.test(m)) return 'Store chưa bật cho môi trường này (Production/Preview). Vào Storage → store → Projects để bật.';
  if (/access must be "private"|private store|public access/i.test(m)) return 'Loại store không khớp: app cần Blob store loại Private.';
  return 'Lỗi máy chủ Blob. Xem Logs của Function trên Vercel để biết chi tiết.';
}
export function errorResponse(e) {
  console.error('[burn-money]', e);
  return json({ ok: false, error: String((e && e.message) || e), hint: explain(e) }, e && e.status ? e.status : 500);
}
