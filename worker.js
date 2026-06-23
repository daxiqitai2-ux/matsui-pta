export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/nisshi')) {
      return handleNisshi(request, env, url);
    }
    if (url.pathname === '/nisshi/input') {
      return new Response(NISSHI_INPUT_HTML, {
        headers: {'Content-Type': 'text/html;charset=utf-8'},
      });
    }
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleNisshi(request, env, url) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const KV_KEY = 'nisshi_records';

  try {
    // GET /api/nisshi/records
    if (url.pathname === '/api/nisshi/records' && request.method === 'GET') {
      const records = await env.HAIYO_KV.get(KV_KEY, 'json') || [];
      return new Response(JSON.stringify(records), { headers });
    }

    // POST /api/nisshi/records
    if (url.pathname === '/api/nisshi/records' && request.method === 'POST') {
      const record = await request.json();
      const records = await env.HAIYO_KV.get(KV_KEY, 'json') || [];
      records.push(record);
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(records));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // PUT /api/nisshi/records/:id
    if (url.pathname.match(/^\/api\/nisshi\/records\/[^/]+$/) && request.method === 'PUT') {
      const recId = decodeURIComponent(url.pathname.split('/').pop());
      const updated = await request.json();
      const records = await env.HAIYO_KV.get(KV_KEY, 'json') || [];
      const idx = records.findIndex((r, i) => (r._id || String(i)) === recId);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: 'record not found' }), { status: 404, headers });
      }
      records[idx] = { ...records[idx], ...updated };
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(records));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

        // DELETE /api/nisshi/records/:id
    if (url.pathname.match(/^\/api\/nisshi\/records\/[^/]+$/) && request.method === 'DELETE') {
      const recId = decodeURIComponent(url.pathname.split('/').pop());
      const records = await env.HAIYO_KV.get(KV_KEY, 'json') || [];
      const idx = records.findIndex((r, i) => (r._id || String(i)) === recId);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: 'record not found' }), { status: 404, headers });
      }
      records.splice(idx, 1);
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(records));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

async function handleAPI(request, env, url) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const isSupport = url.pathname.startsWith('/api/support/');
  const isSeibu = url.pathname.startsWith('/api/seibu/');
  const KV_KEY = isSeibu ? 'seibu_events' : isSupport ? 'support_meetings' : 'meetings';
  const basePath = isSeibu ? '/api/seibu' : isSupport ? '/api/support' : '/api';
  const meetingsPath = basePath + (isSeibu ? '/events' : '/meetings');

  try {
    // GET /meetings - 全取得
    if (url.pathname === meetingsPath && request.method === 'GET') {
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      return new Response(JSON.stringify(data), { headers });
    }

    // GET /meetings/:id
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'GET') {
      const parts = url.pathname.replace(meetingsPath + '/', '').split('/');
      const id = parts[0];
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

    // POST /meetings/:id/records - 1件追記（競合防止）
    if (url.pathname.match(new RegExp(`^${meetingsPath}/[^/]+/records$`)) && request.method === 'POST') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const record = await request.json();
      // リトライ付きで追記
      for (let i = 0; i < 3; i++) {
        const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
        if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
        // 二重登録チェック（サーバーサイド）
        const records = data[id].records || [];
        const dup = isSeibu
          ? records.find(r => r.studentName === record.studentName && r.parent === record.parent)
          : records.find(r => r.name === record.name && r.childName === record.childName);
        if (dup) {
          // 既存レコードを上書き（日程の修正に対応）
          const idx = records.indexOf(dup);
          records[idx] = record;
        } else {
          records.push(record);
        }
        data[id].records = records;
        // attendeesも更新
        if (record.status === '出席' && record.cls && record.cls !== 'なし') {
          data[id].attendees = data[id].attendees || {};
          const cls = record.cls.split('・')[0];
          data[id].attendees[cls] = (data[id].attendees[cls] || 0) + 1;
        }
        try {
          await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
          return new Response(JSON.stringify({ ok: true, record }), { headers });
        } catch (e) {
          if (i === 2) throw e;
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // PUT /meetings/:id/records/:idx - 1件修正
    if (url.pathname.match(new RegExp(`^${meetingsPath}/[^/]+/records/\\d+$`)) && request.method === 'PUT') {
      const parts = url.pathname.replace(meetingsPath + '/', '').split('/');
      const id = parts[0];
      const idx = parseInt(parts[2]);
      const update = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      const records = data[id].records || [];
      if (idx < 0 || idx >= records.length) return new Response(JSON.stringify({ error: 'index out of range' }), { status: 400, headers });
      records[idx] = { ...records[idx], ...update };
      data[id].records = records;
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // DELETE /meetings/:id/records/:idx - 1件削除
    if (url.pathname.match(new RegExp(`^${meetingsPath}/[^/]+/records/\\d+$`)) && request.method === 'DELETE') {
      const parts = url.pathname.replace(meetingsPath + '/', '').split('/');
      const id = parts[0];
      const idx = parseInt(parts[2]);
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      const records = data[id].records || [];
      if (idx < 0 || idx >= records.length) return new Response(JSON.stringify({ error: 'index out of range' }), { status: 400, headers });
      records.splice(idx, 1);
      data[id].records = records;
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // PUT /meetings/:id - メタ情報更新（memo, date, title等）
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'PUT') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const update = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      // recordsの上書きは受け付けない（追記エンドポイントを使う）
      const { records, ...safeUpdate } = update;
      data[id] = { ...data[id], ...safeUpdate };
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

    // GET /api/seibu/manual/:eventId - 手動入力データ取得
    if (url.pathname.match(new RegExp(`^${basePath}/manual/[^/]+$`)) && request.method === 'GET' && isSeibu) {
      const eventId = url.pathname.split('/').pop();
      const manualKey = 'seibu_manual_' + eventId;
      const data = await env.HAIYO_KV.get(manualKey, 'json') || {};
      return new Response(JSON.stringify(data), { headers });
    }

    // POST /api/seibu/manual/:eventId - 手動入力データ保存
    if (url.pathname.match(new RegExp(`^${basePath}/manual/[^/]+$`)) && request.method === 'POST' && isSeibu) {
      const eventId = url.pathname.split('/').pop();
      const manualKey = 'seibu_manual_' + eventId;
      const body = await request.json();
      await env.HAIYO_KV.put(manualKey, JSON.stringify(body));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

const NISSHI_INPUT_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PTA 業務日誌 - 記録する</title>
<style>
:root{
  --green:#2d6a4f;--forest:#1b4332;--lime:#d8f3dc;
  --amber:#f4a261;--amber-light:#fff3e0;
  --ink:#1a1a1a;--muted:#6b7280;--bg:#f9fafb;--card:#fff;
  --radius:14px;--shadow:0 2px 12px rgba(0,0,0,.08);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;}
.topbar{background:var(--forest);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;}
.topbar h1{font-size:1.05rem;font-weight:700;letter-spacing:.03em;}
.pill{background:rgba(255,255,255,.18);border-radius:20px;padding:3px 10px;font-size:.72rem;}
.pane{padding:16px;max-width:540px;margin:0 auto;}
.card{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px;margin-bottom:14px;}
.card-head{font-weight:700;font-size:.92rem;margin-bottom:14px;color:var(--forest);}
.step-label{font-size:.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}
.inp,.sel,.textarea{width:100%;border:1.5px solid #e5e7eb;border-radius:10px;padding:11px 14px;font-size:.92rem;font-family:inherit;background:#fff;color:var(--ink);outline:none;transition:border .2s;}
.inp:focus,.sel:focus,.textarea:focus{border-color:var(--green);}
.textarea{resize:vertical;min-height:80px;}
.btn{border:none;border-radius:10px;padding:12px 20px;font-size:.9rem;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit;}
.btn-green{background:var(--green);color:#fff;}
.btn-green:hover{background:var(--forest);}
.btn-ghost{background:#f3f4f6;color:var(--ink);}
.btn-ghost:hover{background:#e5e7eb;}
.btn-sm{padding:6px 12px;font-size:.78rem;}
.w100{width:100%;}
.mb10{margin-bottom:10px;}
.mb14{margin-bottom:14px;}
.mb16{margin-bottom:16px;}
.steps{display:flex;justify-content:center;gap:6px;margin-bottom:20px;}
.step{width:28px;height:6px;border-radius:3px;background:#e5e7eb;transition:background .3s;}
.step.done{background:var(--green);}
.step.active{background:var(--amber);}
.role-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;}
.role-btn{border:2px solid #e5e7eb;border-radius:10px;padding:10px 8px;font-size:.82rem;font-weight:600;background:#fff;color:var(--ink);cursor:pointer;text-align:center;transition:all .15s;}
.role-btn:hover{border-color:var(--green);background:var(--lime);}
.role-btn.selected{border-color:var(--green);background:var(--lime);color:var(--forest);}
.sub-list{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
.sub-btn{border:1.5px solid #e5e7eb;border-radius:8px;padding:9px 12px;font-size:.82rem;background:#fff;cursor:pointer;text-align:left;transition:all .15s;}
.sub-btn:hover{border-color:var(--green);background:var(--lime);}
.sub-btn.selected{border-color:var(--green);background:var(--lime);color:var(--forest);font-weight:600;}
.cls-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.cls-btn{border:1.5px solid #e5e7eb;border-radius:8px;padding:8px 4px;font-size:.8rem;background:#fff;cursor:pointer;text-align:center;transition:all .15s;}
.cls-btn:hover,.cls-btn.selected{border-color:var(--green);background:var(--lime);color:var(--forest);font-weight:600;}
.confirm-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:.86rem;}
.confirm-label{color:var(--muted);font-size:.78rem;}
.confirm-val{font-weight:600;}
</style>
</head>
<body>

<div class="topbar">
  <h1>📝 PTA 業務日誌</h1>
  <span class="pill">記録する</span>
</div>

<div class="pane">
  <div id="step-area"></div>
</div>

<script>
const API='/api/nisshi';
function $(id){return document.getElementById(id);}
const api={
  async post(path,body){const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
};

const ROLES=[
  {name:'会長',sub:[]},
  {name:'副会長',sub:[]},
  {name:'監事',sub:[]},
  {name:'会計幹事',sub:[]},
  {name:'幹事',sub:['110番','人権','人権・給食','広報','サポート']},
  {name:'地区委員',sub:['箭弓町','松山A','松山B','松葉1','松葉2','松葉3','日吉','材木A','材木B','本町1','本町2']},
  {name:'学年委員',sub:['1年','6年']},
  {name:'市子連',sub:[]},
];

const CLASSES=['1-1','1-2','2-1','2-2','3-1','3-2','4-1','4-2','5-1','5-2','6-1','6-2','6-3','なかよし'];

let state={role:'',sub:'',childName:'',cls:'',parentName:'',date:'',time:'',work:'',note:''};
let step=0;
const STEPS=['role','child','parent','datetime','work','note'];

function renderStepBar(){
  return '<div class="steps">'+STEPS.map((_,i)=>\`<div class="step\${i<step?' done':i===step?' active':''}"></div>\`).join('')+'</div>';
}

function renderStep(){
  const area=$('step-area');
  if(step===0) area.innerHTML=renderStepBar()+renderRole();
  else if(step===1) area.innerHTML=renderStepBar()+renderChild();
  else if(step===2) area.innerHTML=renderStepBar()+renderParent();
  else if(step===3) area.innerHTML=renderStepBar()+renderDatetime();
  else if(step===4) area.innerHTML=renderStepBar()+renderWork();
  else if(step===5) area.innerHTML=renderStepBar()+renderNote();
  else if(step===6) area.innerHTML=renderConfirm();
  window.scrollTo(0,0);
}

function renderRole(){
  return \`<div class="card">
    <div class="card-head">👋 役職を選んでください</div>
    <div class="role-grid">\${ROLES.map(r=>\`<button class="role-btn\${state.role===r.name?' selected':''}" onclick="selectRole('\${r.name}',\${r.sub.length>0})">\${r.name}</button>\`).join('')}</div>
    \${state.role&&ROLES.find(r=>r.name===state.role)?.sub.length?\`
    <div class="sub-list">\${ROLES.find(r=>r.name===state.role).sub.map(s=>\`<button class="sub-btn\${state.sub===s?' selected':''}" onclick="selectSub('\${s}')">\${s}</button>\`).join('')}</div>\`:''}
  </div>\`;
}
function selectRole(name,hasSub){state.role=name;state.sub=hasSub?'':'';renderStep();if(!hasSub){step++;renderStep();}}
function selectSub(s){state.sub=s;step++;renderStep();}

function renderChild(){
  return \`<div class="card">
    <div class="card-head">👶 お子さんの情報</div>
    <div class="step-label mb10">お子さんの名前</div>
    <input class="inp mb14" id="childInp" value="\${state.childName}" placeholder="例：松山 花子" oninput="state.childName=this.value;checkChildNext()"/>
    <div class="step-label mb10">クラス</div>
    <div class="cls-grid mb16">\${CLASSES.map(c=>\`<button class="cls-btn\${state.cls===c?' selected':''}" onclick="selectCls('\${c}')">\${c}</button>\`).join('')}</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="step--;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" id="nextChild" onclick="goNext()" \${state.childName&&state.cls?'':'disabled'}>次へ →</button>
    </div>
  </div>\`;
}
function selectCls(c){state.cls=c;renderStep();}
function checkChildNext(){$('nextChild')&&($('nextChild').disabled=!(state.childName.trim()&&state.cls));}

function renderParent(){
  return \`<div class="card">
    <div class="card-head">🙋 保護者のお名前</div>
    <div class="step-label mb10">保護者名</div>
    <input class="inp mb16" id="parentInp" value="\${state.parentName}" placeholder="例：松山 太郎" oninput="state.parentName=this.value;checkParentNext()"/>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="step--;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" id="nextParent" onclick="goNext()" \${state.parentName?'':'disabled'}>次へ →</button>
    </div>
  </div>\`;
}
function checkParentNext(){$('nextParent')&&($('nextParent').disabled=!state.parentName.trim());}

function renderDatetime(){
  const now=new Date();
  const defDate=state.date||(()=>{const d=now;return \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}-\${String(d.getDate()).padStart(2,'0')}\`})();
  const defTime=state.time||(()=>{return \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}\`})();
  if(!state.date)state.date=defDate;
  if(!state.time)state.time=defTime;
  return \`<div class="card">
    <div class="card-head">📅 日付と時間</div>
    <div class="step-label mb10">日付</div>
    <input class="inp mb14" type="date" id="dateInp" value="\${state.date}" onchange="state.date=this.value"/>
    <div class="step-label mb10">時間</div>
    <input class="inp mb16" type="time" id="timeInp" value="\${state.time}" onchange="state.time=this.value"/>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="step--;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" onclick="goNext()">次へ →</button>
    </div>
  </div>\`;
}

function renderWork(){
  return \`<div class="card">
    <div class="card-head">📌 どんなことをしましたか？</div>
    <div class="step-label mb10">活動内容（簡潔に）</div>
    <textarea class="textarea mb16" id="workInp" placeholder="例：6月の運営委員会の資料作成、配布" oninput="state.work=this.value;checkWorkNext()">\${state.work}</textarea>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="step--;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" id="nextWork" onclick="goNext()" \${state.work?'':'disabled'}>次へ →</button>
    </div>
  </div>\`;
}
function checkWorkNext(){$('nextWork')&&($('nextWork').disabled=!state.work.trim());}

function renderNote(){
  return \`<div class="card">
    <div class="card-head">💡 気づき・引き継ぎメモ <span style="font-size:.75rem;color:var(--muted);font-weight:400">（任意）</span></div>
    <div class="step-label mb10">次回の協議・相談事項や引き継ぎ事項があれば</div>
    <textarea class="textarea mb16" id="noteInp" placeholder="例：配布物の数が足りなくなりそう。次回は早めに確認を。" oninput="state.note=this.value">\${state.note}</textarea>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" onclick="step--;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" onclick="goConfirm()">確認画面へ →</button>
    </div>
  </div>\`;
}

function goNext(){step++;renderStep();}
function goConfirm(){step=6;renderStep();}

function renderConfirm(){
  const roleLabel=state.sub?\`\${state.role} / \${state.sub}\`:state.role;
  return \`<div class="card">
    <div class="card-head">✅ 確認してください</div>
    <div class="confirm-row"><span class="confirm-label">役職</span><span class="confirm-val">\${roleLabel}</span></div>
    <div class="confirm-row"><span class="confirm-label">お子さん</span><span class="confirm-val">\${state.childName} (\${state.cls})</span></div>
    <div class="confirm-row"><span class="confirm-label">保護者名</span><span class="confirm-val">\${state.parentName}</span></div>
    <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-val">\${state.date} \${state.time}</span></div>
    <div class="confirm-row"><span class="confirm-label">活動内容</span><span class="confirm-val" style="max-width:200px;text-align:right;white-space:pre-wrap">\${state.work}</span></div>
    \${state.note?\`<div class="confirm-row"><span class="confirm-label">気づき</span><span class="confirm-val" style="max-width:200px;text-align:right;white-space:pre-wrap">\${state.note}</span></div>\`:''}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-ghost" onclick="step=5;renderStep()">← 戻る</button>
      <button class="btn btn-green w100" onclick="submitRecord()">💾 送信する</button>
    </div>
  </div>\`;
}

async function submitRecord(){
  const record={
    _id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    role:state.sub?\`\${state.role} / \${state.sub}\`:state.role,
    childName:state.childName,
    cls:state.cls,
    parentName:state.parentName,
    date:state.date,
    time:state.time,
    work:state.work,
    note:state.note,
    createdAt:new Date().toISOString(),
  };
  try{
    const res=await api.post('/records',record);
    if(res.ok){
      state={role:'',sub:'',childName:'',cls:'',parentName:'',date:'',time:'',work:'',note:''};
      step=0;
      $('step-area').innerHTML=\`<div class="card" style="text-align:center;padding:36px 20px">
        <div style="font-size:2.5rem;margin-bottom:12px">✅</div>
        <div style="font-size:1rem;font-weight:700;color:var(--forest);margin-bottom:8px">記録しました！</div>
        <div style="font-size:.84rem;color:var(--muted);margin-bottom:20px">ありがとうございました</div>
        <button class="btn btn-green" onclick="step=0;renderStep()">続けて記録する</button>
      </div>\`;
    }else{alert('送信に失敗しました');}
  }catch(e){alert('通信エラー: '+e.message);}
}

window.onload=()=>renderStep();
</script>
</body>
</html>
`;
