// api/sync.js — đồng bộ dữ liệu dùng chung của Burn Money
//   GET  /api/sync?tag=<phiên bản đang có>[&fresh=1]  → { same:true } hoặc { tag, doc }
//   POST /api/sync  body { changes:[{c,id,r}] }         → { doc, wrote }
import { get } from '@vercel/blob';
import { DATA_PATH, emptyDoc, cleanChanges, mergeAndSave, json, errorResponse } from './_store.js';
import { notifyChanges } from './_zalo.js';

export const config = { maxDuration: 20 };

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const fresh = url.searchParams.get('fresh') === '1';
    const tag = url.searchParams.get('tag') || undefined;
    // Lượt kiểm tra định kỳ dùng CDN cache (trúng cache thì không tốn lượt Simple Operation);
    // lúc mở app thì đọc thẳng bản mới nhất (fresh=1).
    const r = await get(DATA_PATH, { access: 'private', useCache: !fresh, ifNoneMatch: tag });
    if (!r) return json({ tag: null, doc: emptyDoc() });
    if (r.statusCode === 304) return json({ same: true, tag });
    const text = await new Response(r.stream).text();
    // Ghép chuỗi trực tiếp để khỏi phải parse rồi stringify lại
    return new Response(`{"tag":${JSON.stringify(r.blob.etag || null)},"doc":${text}}`, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request) {
  try {
    const text = await request.text();
    if (text.length > 4e6) return json({ ok: false, error: 'Gói dữ liệu quá lớn' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ ok: false, error: 'JSON không hợp lệ' }, 400); }
    const changes = cleanChanges(body && body.changes);
    if (!changes) return json({ ok: false, error: 'Thiếu danh sách thay đổi' }, 400);
    const res = await mergeAndSave(changes);
    // Báo sang Zalo — chỉ khi dữ liệu thật sự thay đổi (gửi lại lần 2 do mạng chập chờn thì không báo trùng).
    // Lỗi báo tin không được làm hỏng việc đồng bộ.
    if (res.wrote) await notifyChanges(changes, res.doc, body.zalo).catch(e => console.error('[zalo]', e));
    return json({ ok: true, wrote: res.wrote, attempts: res.attempts, accepted: changes.length, doc: res.doc });
  } catch (e) {
    return errorResponse(e);
  }
}
