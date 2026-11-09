// api/status.js — đường link kiểm tra dữ liệu trên máy chủ
//   /api/status             → tóm tắt: kết nối, phiên bản, số lượng, 10 khoản chi gần nhất
//   /api/status?full=1      → toàn bộ file dữ liệu
//   /api/status?test=write  → thử ghi 3 lần liên tiếp + 1 lần ghi bằng ETag cũ (tốn 4 lượt ghi)
import { head, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { DATA_PATH, COLS, alive, readForWrite, explain, json } from './_store.js';

const TEST_PATH = 'burn-money/_healthcheck.json';

function authMode(request) {
  if (process.env.BLOB_STORE_ID && (process.env.VERCEL_OIDC_TOKEN || request.headers.get('x-vercel-oidc-token'))) return 'OIDC (không cần token)';
  if (process.env.BLOB_STORE_ID) return 'OIDC (có BLOB_STORE_ID)';
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'BLOB_READ_WRITE_TOKEN';
  return 'chưa có — hãy kết nối Blob store với project rồi Redeploy';
}

async function writeTest() {
  const steps = [];
  let etag = null;
  try { etag = (await head(TEST_PATH)).etag; } catch (e) { if (!(e instanceof BlobNotFoundError)) throw e; }
  for (let i = 1; i <= 3; i++) {
    const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
    if (etag) { opts.allowOverwrite = true; opts.ifMatch = etag; } else opts.allowOverwrite = false;
    const res = await put(TEST_PATH, JSON.stringify({ lan: i, luc: new Date().toISOString() }), opts);
    steps.push({ lan_ghi: i, ok: true, etag: res.etag });
    etag = res.etag;
  }
  // Ghi với ETag cũ phải bị từ chối (chứng minh chống ghi đè hoạt động)
  let staleRejected = false;
  try { await put(TEST_PATH, '{}', { access: 'private', allowOverwrite: true, ifMatch: steps[0].etag, addRandomSuffix: false }); }
  catch (e) { staleRejected = e instanceof BlobPreconditionFailedError; }
  return { steps, ghi_voi_etag_cu_bi_tu_choi: staleRejected };
}

export async function GET(request) {
  const url = new URL(request.url);
  const out = { app: 'Burn Money', thoi_gian: new Date().toISOString(), xac_thuc_blob: authMode(request), file: DATA_PATH };
  try {
    if (url.searchParams.get('test') === 'write') out.thu_ghi = await writeTest();
    const { etag, doc, info } = await readForWrite();
    if (!info) {
      out.trang_thai = 'Kết nối Blob OK. Chưa có dữ liệu (file được tạo ở lần ghi đầu tiên).';
    } else {
      const live = c => Object.entries(doc.recs[c]).filter(([, r]) => alive(r));
      const counts = {};
      for (const c of COLS) counts[c] = live(c).length;
      const dead = COLS.reduce((n, c) => n + Object.values(doc.recs[c]).filter(r => !alive(r)).length, 0);
      const months = {};
      for (const [, r] of live('e')) { const m = String(r.d.day || '').slice(0, 7); months[m] = (months[m] || 0) + (r.d.amount || 0); }
      out.trang_thai = 'Kết nối Blob OK';
      out.phien_ban = { rev: doc.rev, cap_nhat_luc: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null, etag_head: etag, etag_tai_file: info.downloadEtag, kich_thuoc_byte: info.size };
      out.so_luong = { ngan_sach_thang: counts.b, the_co_dinh: counts.t, khoan_chi: counts.e, bo_qua_hom_nay: counts.s, ban_ghi_da_xoa_cho_dong_bo: dead };
      out.ngan_sach = Object.fromEntries(live('b').map(([id, r]) => [id, r.d.v]));
      out.tong_chi_theo_thang = months;
      out.the_co_dinh = live('t').sort((a, b) => (a[1].d.c || 0) - (b[1].d.c || 0)).map(([, r]) => `${r.d.emoji || ''} ${r.d.name}: ${r.d.amount}`);
      out.khoan_chi_gan_nhat = live('e').sort((a, b) => (b[1].d.ts || 0) - (a[1].d.ts || 0)).slice(0, 10)
        .map(([id, r]) => ({ id, ngay: r.d.day, noi_dung: r.d.note, so_tien: r.d.amount, loai: r.d.kind === 'fixed' ? 'cố định' : 'phát sinh' }));
      if (url.searchParams.get('full') === '1') out.du_lieu_day_du = doc;
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
  } catch (e) {
    out.trang_thai = 'LỖI';
    out.loi = String((e && e.message) || e);
    out.goi_y = explain(e);
    return json(out, 500);
  }
}
