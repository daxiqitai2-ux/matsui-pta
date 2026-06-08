export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }

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

  // PTAアプリ: /api/meetings/...
  // サポートアプリ: /api/support/meetings/...
  const isSupport = url.pathname.startsWith('/api/support/');
  const KV_KEY = isSupport ? 'support_meetings' : 'meetings';
  const basePath = isSupport ? '/api/support' : '/api';

  try {
    const meetingsPath = basePath + '/meetings';

    // GET /meetings - 全取得
    if (url.pathname === meetingsPath && request.method === 'GET') {
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      return new Response(JSON.stringify(data), { headers });
    }

    // GET /meetings/:id
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'GET') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      const meeting = data[id];
      if (!meeting) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      return new Response(JSON.stringify(meeting), { headers });
    }

    // POST /meetings - 作成
    if (url.pathname === meetingsPath && request.method === 'POST') {
      const meeting = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      data[meeting.id] = meeting;
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // PUT /meetings/:id - 更新
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'PUT') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const update = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      data[id] = { ...data[id], ...update };
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // DELETE /meetings/:id
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'DELETE') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      delete data[id];
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
