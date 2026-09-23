// =====================================================================
// 腕章 貸出・返却 API（worker.js に追加）
//
// ① export default { async fetch(request, env) { ... } } の中、
//    const url = new URL(request.url); の直後あたりに1行追加：
//
//    if (url.pathname === '/armband/records') return handleArmband(request, env, url);
//
// ② この関数をファイルの末尾（export default の外）に貼り付け
// =====================================================================

async function handleArmband(request, env, url) {
  const KV = env.HAIYO_KV;
  const event = (url.searchParams.get('event') || 'undokai').replace(/[^\w-]/g, '').slice(0, 40) || 'undokai';
  const prefix = `armband:${event}:`;
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  // 一覧取得：1件＝1キー、中身はメタデータに保存（同時書き込みでも消えない）
  if (request.method === 'GET') {
    const out = [];
    let cursor;
    do {
      const res = await KV.list({ prefix, cursor });
      for (const k of res.keys) if (k.metadata) out.push(k.metadata);
      cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
    out.sort((a, b) => a.ts - b.ts);
    return json(out);
  }

  // 登録（idは端末側で発行 → 再送しても二重登録にならない）
  if (request.method === 'POST') {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const s = (v, n) => String(v ?? '').trim().slice(0, n);
    const rec = {
      id: s(b.id, 30).replace(/[^\w-]/g, ''),
      type: b.type === 'return' ? 'return' : 'lend',
      role: s(b.role, 30),
      cls: s(b.cls, 10),
      name: s(b.name, 40),
      ts: Number(b.ts) || Date.now(),
    };
    if (!rec.id || !rec.role || !rec.name) return json({ error: 'missing fields' }, 400);
    await KV.put(prefix + rec.id, '1', { metadata: rec });
    return json(rec, 201);
  }

  // 削除（管理画面の「削除」ボタン）
  if (request.method === 'DELETE') {
    const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, '');
    if (!id) return json({ error: 'missing id' }, 400);
    await KV.delete(prefix + id);
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, 405);
}
