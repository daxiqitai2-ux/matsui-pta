export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }

    // Serve index.html for all other routes
    return env.ASSETS.fetch(request);
  }
};

async function handleAPI(request, env, url) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    // GET /api/meetings - 全会議取得
    if (url.pathname === '/api/meetings' && request.method === 'GET') {
      const data = await env.HAIYO_KV.get('meetings', 'json') || {};
      return new Response(JSON.stringify(data), { headers });
    }

    // GET /api/meetings/:id - 特定会議取得
    if (url.pathname.startsWith('/api/meetings/') && request.method === 'GET') {
      const id = url.pathname.split('/')[3];
      const data = await env.HAIYO_KV.get('meetings', 'json') || {};
      const meeting = data[id];
      if (!meeting) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      return new Response(JSON.stringify(meeting), { headers });
    }

    // POST /api/meetings - 会議作成
    if (url.pathname === '/api/meetings' && request.method === 'POST') {
      const meeting = await request.json();
      const data = await env.HAIYO_KV.get('meetings', 'json') || {};
      data[meeting.id] = meeting;
      await env.HAIYO_KV.put('meetings', JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // PUT /api/meetings/:id - 会議更新（出席記録など）
    if (url.pathname.startsWith('/api/meetings/') && request.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      const update = await request.json();
      const data = await env.HAIYO_KV.get('meetings', 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      data[id] = { ...data[id], ...update };
      await env.HAIYO_KV.put('meetings', JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // DELETE /api/meetings/:id - 会議削除
    if (url.pathname.startsWith('/api/meetings/') && request.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      const data = await env.HAIYO_KV.get('meetings', 'json') || {};
      delete data[id];
      await env.HAIYO_KV.put('meetings', JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
