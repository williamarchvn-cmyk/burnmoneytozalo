// api/zalo.js — báo cáo tổng hợp cho bot Zalo
//   GET /api/zalo?kind=day|week|month|lastmonth|auto   header X-Key: <ZALO_REPORT_KEY>  (hoặc ?key=…)
//   → { ok, messages: [{ text, chart }] }  — bot Zalo tự vẽ biểu đồ và gửi.
// Không có khoá đúng thì không trả gì (số liệu chi tiêu là riêng tư, mà repo + link app đều công khai).
import { get } from '@vercel/blob';
import { DATA_PATH, emptyDoc, parseDoc, json, errorResponse } from './_store.js';
import { buildReports } from './_zalo.js';

export const config = { maxDuration: 20 };

export async function GET(request) {
  const url = new URL(request.url);
  const want = process.env.ZALO_REPORT_KEY;
  const key = request.headers.get('x-key') || url.searchParams.get('key');
  if (!want) return json({ ok: false, error: 'Chưa đặt biến ZALO_REPORT_KEY trên Vercel (rồi Redeploy)' }, 503);
  if (key !== want) return json({ ok: false, error: 'Sai khoá' }, 401);
  try {
    const kind = ['day', 'week', 'month', 'lastmonth', 'auto'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'day';
    const r = await get(DATA_PATH, { access: 'private', useCache: false });   // luôn lấy bản mới nhất
    const doc = r && r.statusCode === 200 ? parseDoc(await new Response(r.stream).text()) : emptyDoc();
    return json({ ok: true, kind, messages: buildReports(doc, kind) });
  } catch (e) {
    return errorResponse(e);
  }
}
