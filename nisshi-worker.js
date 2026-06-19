export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/nisshi')) {
      return handleAPI(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleAPI(request, env, url) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const KV_KEY = 'nisshi_records';

  try {
    // GET /api/nisshi/records - 全件取得
    if (url.pathname === '/api/nisshi/records' && request.method === 'GET') {
      const records = await env.NISSHI_KV.get(KV_KEY, 'json') || [];
      return new Response(JSON.stringify(records), { headers });
    }

    // POST /api/nisshi/records - 1件追加
    if (url.pathname === '/api/nisshi/records' && request.method === 'POST') {
      const record = await request.json();
      const records = await env.NISSHI_KV.get(KV_KEY, 'json') || [];
      records.push(record);
      await env.NISSHI_KV.put(KV_KEY, JSON.stringify(records));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // DELETE /api/nisshi/records/:idx - 1件削除
    if (url.pathname.match(/^\/api\/nisshi\/records\/\d+$/) && request.method === 'DELETE') {
      const idx = parseInt(url.pathname.split('/').pop());
      const records = await env.NISSHI_KV.get(KV_KEY, 'json') || [];
      if (idx < 0 || idx >= records.length) {
        return new Response(JSON.stringify({ error: 'index out of range' }), { status: 400, headers });
      }
      records.splice(idx, 1);
      await env.NISSHI_KV.put(KV_KEY, JSON.stringify(records));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
