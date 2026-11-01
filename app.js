/* Baobab Digital Academy — GCSE Mock Exam Centre
 * Static front end. All rules (deadlines, locks, who sees what) are enforced in Supabase
 * by row level security and the exam_* functions; this file only presents them.
 */
'use strict';

const CFG = window.EXAM_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const LOGO = 'assets/logo-tree.webp';
const LOGO_FULL = 'assets/logo-full.webp';

const S = {
  view: 'loading', me: null, offset: 0, settings: { lock_after: 3, fullscreen: true, upload_grace_minutes: 10, save_grace_seconds: 120 },
  papers: [], attempts: {}, exam: null, msg: '',
  tab: 'papers', staffPapers: [], resultsPaper: null, results: null, marking: null, preview: null,
  candidates: null, phonePaper: null, phonePhotos: [], timers: {}
};

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>'); }
function mins(m) { const h = Math.floor(m / 60), r = m % 60; return (h ? h + ' hour' + (h > 1 ? 's' : '') : '') + (h && r ? ' ' : '') + (r ? r + ' minutes' : ''); }
function clock(ms) { ms = Math.max(0, ms); const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0'); }
function when(ts) { if (!ts) return '—'; return new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function now() { return Date.now() + S.offset; }               // server-aligned clock
function toast(t, ms = 5000) { const o = document.createElement('div'); o.className = 'toast'; o.textContent = t; document.body.appendChild(o); setTimeout(() => o.remove(), ms); }
function modal(html) { $('#overlay').innerHTML = '<div class="modal-bg"><div class="modal">' + html + '</div></div>'; }
function closeModal() { $('#overlay').innerHTML = ''; }
function partsOf(p) { const out = []; ((p.content || p).questions || []).forEach(q => (q.parts || []).forEach(pt => out.push({ q, pt }))); return out; }
function isStaff() { return S.me && (S.me.role === 'admin' || S.me.role === 'tutor'); }
function isAdmin() { return S.me && S.me.role === 'admin'; }
function errText(e) { return (e && (e.message || e.error_description)) || 'Something went wrong.'; }
function every(name, ms, fn) { clearInterval(S.timers[name]); S.timers[name] = setInterval(fn, ms); }
function stop(name) { clearInterval(S.timers[name]); delete S.timers[name]; }
function header(right = '') {
  const who = S.me && S.me.name ? `<span class="small muted" style="margin-right:6px">${esc(S.me.name)}</span>` : '';
  return `<div class="topbar"><div class="topbar-in"><img src="${LOGO}" alt=""><div class="brand"><b>BAOBAB <span>DIGITAL ACADEMY</span></b><small>GCSE Mock Examination Centre</small></div><div class="spacer"></div>${right}${S.me ? who + '<button class="btn ghost sm" onclick="signOut()">Sign out</button>' : ''}</div></div>`;
}
function qTable(q) { return q.table ? `<table class="qtable"><tr>${q.table.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${q.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''; }

function render() {
  const v = S.view;
  if (v === 'loading') $('#app').innerHTML = header() + `<div class="wrap"><div class="card center muted">Loading the exam centre…</div></div>`;
  else if (v === 'error') $('#app').innerHTML = header() + `<div class="wrap" style="max-width:640px"><div class="card"><h2>${esc(S.msgTitle || 'Something went wrong')}</h2><p>${esc(S.msg)}</p>${S.me ? '' : '<button class="btn" onclick="location.reload()">Try again</button>'}</div></div>`;
  else if (v === 'login') renderLogin();
  else if (v === 'home') renderHome();
  else if (v === 'intro') renderIntro();
  else if (v === 'exam') renderExam();
  else if (v === 'submitted') renderSubmitted();
  else if (v === 'phone') renderPhone();
  else if (v === 'teacher') renderTeacher();
  else if (v === 'marking') renderMarking();
  else if (v === 'preview') renderPreview();
}
function fail(title, msg) { S.msgTitle = title; S.msg = msg; S.view = 'error'; render(); }

/* ---------------- sign in ---------------- */
async function boot() {
  render();
  if (location.hash === '#upload') { try { sessionStorage.setItem('afterLogin', 'phone'); } catch (e) {} }
  const { data } = await sb.auth.getSession();
  if (!data.session) { S.view = 'login'; return render(); }
  await afterSignIn();
}
sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') { S.me = null; S.view = 'login'; render(); } });

function renderLogin() {
  $('#app').innerHTML = header() + `<div class="wrap" style="max-width:920px">
  <div class="hero"><img src="${LOGO}" alt="" style="height:86px;background:#fff;border-radius:14px;padding:8px"><div><h1>GCSE Mock Examinations</h1><p>Pearson Edexcel-style timed papers for Baobab Digital Academy students.</p></div></div>
  <div class="split">
    <div class="card"><h2>Students</h2><p>Sign in with your Baobab school Google account, the same one you use for Google Meet.</p>
      <button class="btn gold" onclick="googleSignIn()">Sign in with Google</button>
      <p class="small muted" style="margin-top:12px">Use your <strong>@${esc(CFG.studentEmailDomain)}</strong> address.</p></div>
    <div class="card"><h2>Teachers and admins</h2><p class="small muted" style="margin-top:0">Use the email and password you use for the tutor or admin portal.</p>
      <form onsubmit="event.preventDefault();staffSignIn()"><label class="f">Email</label><input type="text" id="em" autocomplete="username">
      <label class="f">Password</label><input type="password" id="pw" autocomplete="current-password" style="width:100%;font:inherit;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Sign in</button><span id="le" class="small" style="color:var(--danger)"></span></div></form></div>
  </div><p class="footer">Original practice papers in the style of Pearson Edexcel GCSE (9–1). Not official Pearson papers.</p></div>`;
}
async function googleSignIn() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: location.origin + location.pathname, queryParams: { hd: CFG.studentEmailDomain, prompt: 'select_account' } } });
  if (error) toast('Google sign-in is not available yet: ' + errText(error));
}
async function staffSignIn() {
  const email = $('#em').value.trim(), password = $('#pw').value;
  if (!email || !password) { $('#le').textContent = 'Enter your email and password.'; return; }
  $('#le').textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { $('#le').textContent = errText(error); return; }
  await afterSignIn();
}
async function signOut() { Object.keys(S.timers).forEach(stop); await sb.auth.signOut(); }

async function afterSignIn() {
  S.view = 'loading'; render();
  const { data, error } = await sb.rpc('exam_whoami');
  if (error) return fail('The exam centre can\'t load', errText(error));
  S.me = data; S.offset = Date.parse(data.server_now) - Date.now();
  if (data.settings) S.settings = data.settings;
  if (!data.role) {
    return fail('This account is not linked to the exam centre', `You are signed in as ${data.email || 'an unknown account'}. Students must use their @${CFG.studentEmailDomain} Google account. Teachers should use their tutor or admin portal login. If you think this is wrong, contact the academy office.`);
  }
  let after = null; try { after = sessionStorage.getItem('afterLogin'); sessionStorage.removeItem('afterLogin'); } catch (e) {}
  if (isStaff()) { S.view = 'teacher'; render(); loadStaffPapers(); }
  else { S.view = after === 'phone' ? 'phone' : 'home'; await loadStudent(); render(); every('studentPoll', 15000, async () => { if (S.view === 'home' || S.view === 'phone') { await loadStudent(); render(); } }); }
}

/* ---------------- student ---------------- */
async function loadStudent() {
  const [p, a] = await Promise.all([
    sb.from('exam_papers').select('id,code,subject,title,tier,minutes,total_marks,calculator,sort,is_open').order('sort'),
    sb.from('exam_attempts').select('id,paper_id,status,started_at,deadline,submitted_at,locked')
  ]);
  if (!p.error) S.papers = p.data || [];
  if (!a.error) { S.attempts = {}; (a.data || []).forEach(x => S.attempts[x.paper_id] = x); }
}
function uploadOpen(at) {
  if (!at) return false;
  if (at.status === 'in_progress') return now() <= Date.parse(at.deadline) + S.settings.save_grace_seconds * 1000;
  return now() <= Date.parse(at.submitted_at) + S.settings.upload_grace_minutes * 60000;
}
function renderHome() {
  const me = S.me;
  const uploadable = Object.values(S.attempts).filter(uploadOpen);
  const cards = S.papers.length ? S.papers.map(p => {
    const a = S.attempts[p.id];
    let status = '<span class="chip">Open now</span>', btn = `<button class="btn" onclick="openIntro('${esc(p.id)}')">Start paper</button>`;
    if (a && a.status === 'submitted') { status = '<span class="chip brown">Submitted</span>'; btn = `<span class="muted small">Submitted ${esc(when(a.submitted_at))}</span>`; }
    else if (a) { status = a.locked ? '<span class="chip red">Locked</span>' : '<span class="chip gold">In progress</span>'; btn = `<button class="btn gold" onclick="resume('${esc(p.id)}')">Resume paper</button>`; }
    return `<div class="card paper-card">${status}<h3>${esc(p.subject)} — ${esc(p.title)}</h3><div class="muted small">${p.tier ? esc(p.tier) + ' tier · ' : ''}Paper ${esc(p.code)}</div>
      <div class="meta"><span>⏱ ${esc(mins(p.minutes))}${me.extra_time_pct ? ' + ' + me.extra_time_pct + '%' : ''}</span><span>✎ ${esc(p.total_marks)} marks</span><span>${p.calculator ? 'Calculator allowed' : 'No calculator'}</span></div>${btn}</div>`;
  }).join('') : `<div class="card"><h3>No paper is open for you right now</h3><p class="muted">Your teacher opens each paper at its start time on the mock timetable. This page checks every 15 seconds, so the paper will appear here by itself.</p></div>`;
  const notEntered = !me.candidate_number ? `<div class="notice" style="margin-bottom:16px">You haven't been entered for the mock series yet. If you should be, tell the academy office.</div>` : '';
  $('#app').innerHTML = header() + `<div class="wrap">
    <div class="hero"><img src="${LOGO}" alt="" style="height:86px;background:#fff;border-radius:14px;padding:8px"><div><h1>Welcome, ${esc((me.name || '').split(' ')[0])}</h1><p>${me.candidate_number ? 'Candidate number ' + esc(me.candidate_number) + ' · ' : ''}Join your invigilator's Google Meet before you start a paper.</p></div></div>
    ${notEntered}
    ${uploadable.length ? `<div class="card row" style="margin-bottom:18px;border-color:#F1D29C;background:var(--gold-soft)"><div style="flex:1"><h3 style="margin:0">Photos of your rough working</h3><div class="small muted">On your phone, open this page, sign in, and tap the button to photograph your working. It is added to your exam straight away.</div></div><button class="btn gold" onclick="S.view='phone';render()">Upload photos of my working</button></div>` : ''}
    <h2>Your papers</h2><div class="grid">${cards}</div>
    <p class="footer">Original practice papers in the style of Pearson Edexcel GCSE (9–1). Not official Pearson papers.</p></div>`;
}

let introPaper = null;
function openIntro(id) { introPaper = S.papers.find(p => p.id === id); if (introPaper) { S.view = 'intro'; render(); } }
async function renderIntro() {
  const p = introPaper, me = S.me, st = S.settings;
  if (!p.content) { const { data } = await sb.from('exam_papers').select('*').eq('id', p.id).single(); if (data) Object.assign(p, data); }
  const c = p.content || {};
  const total = Math.round(p.minutes * (100 + (me.extra_time_pct || 0)) / 100);
  $('#app').innerHTML = header(`<button class="btn ghost sm" onclick="S.view='home';render()">Back</button>`) + `<div class="wrap" style="max-width:820px"><div class="card">
    <span class="chip">${esc(p.code)}</span>
    <h1 style="margin-top:8px">${esc(p.subject)}</h1><h2>${esc(p.title)}${p.tier ? ' — ' + esc(p.tier) + ' Tier' : ''}</h2>
    <div class="row" style="margin:6px 0 14px"><span class="chip gold">Time: ${esc(mins(total))}${me.extra_time_pct ? ' (includes ' + me.extra_time_pct + '% extra time)' : ''}</span><span class="chip brown">Total: ${esc(p.total_marks)} marks</span><span class="chip ${p.calculator ? '' : 'red'}">${p.calculator ? 'Calculator allowed' : 'No calculator'}</span></div>
    <table class="t" style="margin-bottom:12px"><tr><th>Candidate</th><th>Candidate number</th></tr><tr><td>${esc(me.name)}</td><td>${esc(me.candidate_number || '—')}</td></tr></table>
    ${c.equipment ? `<p><strong>You must have:</strong> ${fmt(c.equipment)}</p>` : ''}
    <h3>Instructions</h3><ul>${(c.instructions || []).map(i => `<li>${fmt(i)}</li>`).join('')}</ul>
    <h3>Information</h3><ul>${(c.information || []).map(i => `<li>${fmt(i)}</li>`).join('')}</ul>
    <div class="notice">The timer starts when you press <strong>Start exam</strong> and keeps running if you close the page. Your answers save automatically. When time runs out, your paper is submitted automatically.</div>
    <div class="notice" style="margin-top:10px;background:var(--danger-soft);border-color:#EBC2BC"><strong>Strict exam mode.</strong> The exam opens in full screen. Leaving it, by switching tabs or windows${st.fullscreen ? ' or exiting full screen' : ''}, is recorded and reported to your teacher. You get ${st.lock_after - 1} warning${st.lock_after - 1 === 1 ? '' : 's'}. ${st.lock_after === 1 ? 'The first time' : 'After that'}, your paper locks until your invigilator unlocks it, and the timer keeps running while it is locked.</div>
    <label class="row small" style="margin-top:14px;gap:8px;align-items:flex-start;flex-wrap:nowrap"><input type="checkbox" id="ok" style="margin-top:4px"> <span>I am alone, my camera is on in the invigilator's Google Meet, and I won't use notes, other websites, AI tools or anyone's help during this exam.</span></label>
    <div class="row" style="margin-top:18px"><button class="btn gold" onclick="startExam()">Start exam</button><span id="ie" class="small" style="color:var(--danger)"></span></div>
  </div></div>`;
}
async function startExam() {
  if (!$('#ok').checked) { $('#ie').textContent = 'Tick the declaration to start.'; return; }
  if (S.settings.fullscreen) goFullscreen();
  $('#ie').textContent = 'Starting…';
  const { data, error } = await sb.rpc('exam_start', { p_paper: introPaper.id });
  if (error) { $('#ie').textContent = errText(error); return; }
  enterExam(introPaper, data);
}
async function resume(id) {
  const p = S.papers.find(x => x.id === id); if (!p) return;
  if (S.settings.fullscreen) goFullscreen();
  const [{ data: full }, { data: at }] = await Promise.all([
    sb.from('exam_papers').select('*').eq('id', id).single(),
    sb.from('exam_attempts').select('*').eq('paper_id', id).single()]);
  if (!full || !at) { toast('This paper could not be loaded. It may have been closed.'); return; }
  enterExam(full, at);
}

/* ---------------- exam ---------------- */
async function enterExam(paper, attempt) {
  if (!paper.content) { const { data } = await sb.from('exam_papers').select('*').eq('id', paper.id).single(); if (data) paper = data; }
  if (attempt.status === 'submitted') { S.exam = { paper, attempt }; S.view = 'submitted'; S.submitOk = true; return render(); }
  attempt.answers = attempt.answers || {}; attempt.flags = attempt.flags || {};
  S.exam = { paper, attempt, idx: 0, saving: false, pending: false, dirtyTimer: null, warned: {}, saveState: 'All answers saved', photos: [], urls: {} };
  S.view = 'exam'; stop('studentPoll'); render();
  every('tick', 1000, tick); tick();
  loadPhotos();
  if (attempt.locked) showLock('');
}
function remaining() { return Date.parse(S.exam.attempt.deadline) - now(); }
function tick() {
  if (!S.exam || S.view !== 'exam') return;
  const r = remaining(), el = $('#timer');
  if (el) { el.textContent = clock(r); el.className = 'timer' + (r <= 5 * 60000 ? ' crit' : r <= 30 * 60000 ? ' warn' : ''); }
  const lc = $('#lockclock'); if (lc) lc.textContent = clock(r);
  if (r <= 30 * 60000 && r > 29 * 60000 && !S.exam.warned[30]) { S.exam.warned[30] = 1; toast('30 minutes left. Start wrapping up your longest answers.'); }
  if (r <= 5 * 60000 && r > 0 && !S.exam.warned[5]) { S.exam.warned[5] = 1; toast('5 minutes left. Check your answers now.'); }
  if (r <= 0) submit(true);
}
function answered(q) { const A = S.exam.attempt.answers; return (q.parts || []).some(pt => { const a = A[pt.id]; return a && ((a.a || '').trim() || (a.w || '').trim() || (a.t || '').trim()); }); }
function renderExam() {
  const { paper, attempt, idx } = S.exam; const qs = paper.content.questions; const q = qs[idx];
  const nav = qs.map((qq, n) => `<button class="${answered(qq) ? 'done' : ''} ${n === idx ? 'cur' : ''} ${attempt.flags[qq.n] ? 'flag' : ''}" onclick="go(${n})">${esc(qq.n)}</button>`).join('');
  const parts = (q.parts || []).map(pt => {
    const a = attempt.answers[pt.id] || {};
    const body = pt.type === 'long'
      ? `<div class="ans-label">Your answer</div><textarea rows="${pt.rows || 12}" data-pid="${esc(pt.id)}" data-k="t" oninput="ans(this)">${esc(a.t || '')}</textarea><div class="small muted" id="wc-${esc(pt.id)}">${wc(a.t)} words</div>`
      : pt.type === 'short'
        ? `<div class="ans-label">Answer</div><input type="text" data-pid="${esc(pt.id)}" data-k="a" oninput="ans(this)" value="${esc(a.a || '')}">`
        : `<div class="ans-label">Working</div><textarea rows="4" data-pid="${esc(pt.id)}" data-k="w" oninput="ans(this)" placeholder="Show all your working">${esc(a.w || '')}</textarea>
           <div class="ans-label">Answer</div><input type="text" data-pid="${esc(pt.id)}" data-k="a" oninput="ans(this)" value="${esc(a.a || '')}">`;
    return `<div class="part"><div class="pt"><div class="qtext">${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="marks">(${esc(pt.marks)} mark${pt.marks > 1 ? 's' : ''})</span></div>${body}</div>`;
  }).join('');
  const total = (q.parts || []).reduce((s, pt) => s + (+pt.marks || 0), 0);
  $('#app').innerHTML = `<div class="exambar"><div class="exambar-in"><img src="${LOGO}" alt=""><div class="ttl">${esc(paper.subject)} · ${esc(paper.code)}<small>${esc(S.me.name || '')} · ${esc(S.me.candidate_number || '')}${attempt.extra_time_pct ? ' · ' + attempt.extra_time_pct + '% extra time' : ''}</small></div><div class="spacer"></div><span class="save" id="save">${esc(S.exam.saveState)}</span><div class="timer" id="timer">--:--</div><button class="btn gold sm" onclick="askSubmit()">Finish exam</button></div></div>
  <div class="exam"><aside class="nav card"><h3 style="margin:0">Questions</h3><div class="navgrid">${nav}</div>
    <div class="legend"><div><i style="background:var(--green-soft);border:1px solid #9CC3AE"></i>Answered</div><div><i style="background:#fff;border:1px solid var(--line)"></i>Not answered</div><div><i style="background:var(--gold);border-radius:50%"></i>Flagged for review</div></div>
    ${paper.calculator ? '' : '<div class="notice small" style="margin-top:12px">Calculators may <strong>not</strong> be used.</div>'}</aside>
  <main class="card"><div class="qhead"><span class="qnum">${esc(q.n)}</span><span class="muted small">Question ${idx + 1} of ${qs.length}</span><div class="spacer"></div><button class="btn ghost sm" onclick="flag()">${attempt.flags[q.n] ? '★ Flagged' : '☆ Flag for review'}</button></div>
    ${q.intro ? `<div class="qtext">${fmt(q.intro)}</div>` : ''}${qTable(q)}${q.after ? `<div class="qtext">${fmt(q.after)}</div>` : ''}${parts}
    <div class="total">(Total for Question ${esc(q.n)} is ${total} mark${total > 1 ? 's' : ''})</div>
    <div id="photos-box">${photoBlock(q.n, true)}</div>
    <div class="qfoot"><button class="btn ghost" ${idx === 0 ? 'disabled' : ''} onclick="go(${idx - 1})">← Previous</button>${idx < qs.length - 1 ? `<button class="btn" onclick="go(${idx + 1})">Next question →</button>` : `<button class="btn gold" onclick="askSubmit()">Review and finish</button>`}</div>
  </main></div>`;
  tick();
}
function wc(t) { return (t || '').trim() ? (t || '').trim().split(/\s+/).length : 0; }
function go(n) { S.exam.idx = n; render(); window.scrollTo(0, 0); }
function flag() { const q = S.exam.paper.content.questions[S.exam.idx]; const f = S.exam.attempt.flags; f[q.n] = !f[q.n]; queueSave(); render(); }
function ans(el) {
  const pid = el.dataset.pid, k = el.dataset.k, A = S.exam.attempt.answers;
  A[pid] = Object.assign({}, A[pid], { [k]: el.value });
  if (k === 't') { const w = document.getElementById('wc-' + pid); if (w) w.textContent = wc(el.value) + ' words'; }
  queueSave();
}
function setSave(t) { if (!S.exam) return; S.exam.saveState = t; const e = $('#save'); if (e) e.textContent = t; }
function queueSave() { setSave('Saving…'); clearTimeout(S.exam.dirtyTimer); S.exam.dirtyTimer = setTimeout(saveNow, 1200); }
async function saveNow() {
  const ex = S.exam; if (!ex || ex.attempt.status !== 'in_progress') return;
  if (ex.saving) { ex.pending = true; return; }
  ex.saving = true;
  try {
    const { data, error } = await sb.rpc('exam_save', { p_attempt: ex.attempt.id, p_answers: ex.attempt.answers, p_flags: ex.attempt.flags });
    if (error) throw error;
    if (data && data.ok) { setSave('All answers saved'); if (data.server_now) S.offset = Date.parse(data.server_now) - Date.now(); }
    else if (data && data.status === 'submitted') { finishLocally(true); }
  } catch (e) { setSave('Not saved — check your connection'); setTimeout(queueSave, 4000); }
  finally { ex.saving = false; if (ex.pending) { ex.pending = false; saveNow(); } }
}
function askSubmit() {
  const { paper, attempt } = S.exam;
  const blank = partsOf(paper).filter(({ pt }) => { const a = attempt.answers[pt.id]; return !(a && ((a.a || '').trim() || (a.w || '').trim() || (a.t || '').trim())); }).length;
  const flagged = Object.values(attempt.flags).filter(Boolean).length;
  modal(`<h2>Finish the exam?</h2><p>You have <strong>${clock(remaining())}</strong> left.</p>${blank ? `<p class="notice">${blank} question part${blank > 1 ? 's are' : ' is'} still blank.</p>` : ''}${flagged ? `<p class="muted">${flagged} question${flagged > 1 ? 's are' : ' is'} flagged for review.</p>` : ''}<p>Once you submit, you can't change your answers.</p><div class="row"><button class="btn gold" onclick="closeModal();submit(false)">Submit my paper</button><button class="btn ghost" onclick="closeModal()">Keep working</button></div>`);
}
function finishLocally(auto) {
  const ex = S.exam; stop('tick'); stop('lockPoll'); clearTimeout(ex.dirtyTimer); closeModal();
  ex.attempt.status = 'submitted'; ex.attempt.submitted_at = ex.attempt.submitted_at || new Date(now()).toISOString(); ex.attempt.auto_submitted = !!auto;
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
  S.view = 'submitted'; render();
}
async function submit(auto) {
  const ex = S.exam; if (!ex || ex.attempt.status !== 'in_progress' || ex.submitting) return;
  ex.submitting = true; finishLocally(auto); S.submitOk = false; render();
  for (let i = 0; i < 6; i++) {
    const { data, error } = await sb.rpc('exam_submit', { p_attempt: ex.attempt.id, p_answers: ex.attempt.answers, p_flags: ex.attempt.flags, p_auto: !!auto });
    if (!error) { ex.attempt.submitted_at = data.submitted_at; S.submitOk = true; break; }
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
  }
  if (S.view === 'submitted') render();
}
function renderSubmitted() {
  const ex = S.exam, ok = S.submitOk;
  $('#app').innerHTML = header() + `<div class="wrap"><div class="card done-hero"><img src="${LOGO_FULL}" alt="Baobab Digital Academy">
  <h1>${ex.attempt.auto_submitted ? 'Time is up' : 'Paper submitted'}</h1><p>${esc(ex.paper.subject)} ${esc(ex.paper.code)} was submitted at ${esc(when(ex.attempt.submitted_at))}.</p>
  <p class="muted">${ok ? 'Your answers are safely saved. Your teacher will share your marks and feedback after marking.' : 'Saving your final answers… keep this page open.'}</p>
  <p class="muted small">Stay in the invigilator's Google Meet until you are dismissed.</p>
  <div class="notice" style="text-align:left;margin:16px 0">You have <strong>${S.settings.upload_grace_minutes} minutes</strong> to add any photos of your rough working that you haven't uploaded. Use <strong>Upload photos of my working</strong> on your papers page, on this device or your phone.</div>
  <button class="btn" onclick="backHome()">Back to my papers</button></div></div>`;
}
async function backHome() { S.exam = null; S.view = 'home'; await loadStudent(); render(); every('studentPoll', 15000, async () => { if (S.view === 'home' || S.view === 'phone') { await loadStudent(); render(); } }); }

/* ---------------- strict mode ---------------- */
function goFullscreen() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => { if (S.exam) S.exam.fsOn = true; }).catch(() => {}); } catch (e) {} }
async function violation(type) {
  const ex = S.exam; if (!ex || S.view !== 'exam' || ex.attempt.status !== 'in_progress' || ex.ignoreBlur) return;
  const t = Date.now(); if (ex.lastV && t - ex.lastV < 2500) return; ex.lastV = t;   // one exit fires several events: count it once
  queueSave();
  const { data, error } = await sb.rpc('exam_report_exit', { p_attempt: ex.attempt.id, p_type: type });
  if (error || !data) return;
  ex.attempt.strikes = data.strikes; ex.attempt.locked = data.locked;
  if (data.locked) showLock(type); else showWarning(type, data.strikes, data.lock_after);
}
function showWarning(type, strikes, lockAfter) {
  const left = lockAfter - strikes;
  $('#overlay').innerHTML = `<div class="lock-bg"><div class="lock warn"><h2>You left the exam</h2><p>${esc(type)}. This has been recorded and your teacher can see it.</p><p class="strike">${Array.from({ length: lockAfter }, (_, i) => `<i class="${i < strikes ? 'on' : ''}"></i>`).join('')}</p><p><strong>${left <= 1 ? 'If you leave again, your paper will lock.' : 'You have ' + (left - 1) + ' more warning' + (left - 1 === 1 ? '' : 's') + ' before your paper locks.'}</strong></p><button class="btn gold" onclick="backToExam()">Return to the exam</button></div></div>`;
}
function showLock(type) {
  $('#overlay').innerHTML = `<div class="lock-bg"><div class="lock"><img src="${LOGO}" style="height:60px" alt=""><h2>Your paper is locked</h2><p>You left the exam${type ? ' (' + esc(type.toLowerCase()) + ')' : ''} too many times. This has been reported to your teacher.</p><p><strong>Tell your invigilator in Google Meet.</strong> Only they can unlock your paper. The timer is still running: <span id="lockclock" class="timer crit" style="display:inline-block;font-size:1rem;min-width:0;padding:2px 10px">${clock(remaining())}</span></p><p class="small muted">This screen opens again by itself once you are unlocked.</p></div></div>`;
  every('lockPoll', 5000, async () => {
    if (!S.exam) return stop('lockPoll');
    const { data } = await sb.from('exam_attempts').select('locked,status').eq('id', S.exam.attempt.id).single();
    if (data && !data.locked) { S.exam.attempt.locked = false; stop('lockPoll'); closeModal(); toast('Your invigilator has unlocked your paper.', 4000); if (S.settings.fullscreen) { modal(`<h2>Unlocked</h2><p>Press the button to go back to your exam in full screen.</p><button class="btn gold" onclick="backToExam()">Back to the exam</button>`); } }
    if (data && data.status === 'submitted') finishLocally(true);
  });
}
function backToExam() { closeModal(); if (S.settings.fullscreen) goFullscreen(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) violation('Switched to another tab or app'); });
window.addEventListener('blur', () => { if (S.exam && !document.hidden) setTimeout(() => { if (!document.hasFocus()) violation('Left the exam window'); }, 150); });
document.addEventListener('fullscreenchange', () => {
  if (!S.exam || S.view !== 'exam') return;
  if (document.fullscreenElement) S.exam.fsOn = true;
  else if (S.exam.fsOn && S.settings.fullscreen) violation('Exited full screen');
});

/* ---------------- photos of working ---------------- */
async function loadPhotos(attemptId) {
  const id = attemptId || (S.exam && S.exam.attempt.id); if (!id) return [];
  const { data } = await sb.from('exam_photos').select('*').eq('attempt_id', id).order('created_at');
  const list = data || [];
  const need = list.filter(p => !photoUrls[p.storage_path]).map(p => p.storage_path);
  if (need.length) {
    const { data: urls } = await sb.storage.from(CFG.photoBucket).createSignedUrls(need, 3600);
    (urls || []).forEach(u => { if (u.signedUrl) photoUrls[u.path] = u.signedUrl; });
  }
  if (S.exam && S.exam.attempt.id === id) { S.exam.photos = list; refreshPhotos(); }
  return list;
}
const photoUrls = {};
function photoBlock(qn, editable, list, attempt) {
  list = list || (S.exam ? S.exam.photos : []);
  attempt = attempt || (S.exam && S.exam.attempt);
  const mine = list.filter(p => p.question_n === String(qn));
  const can = editable && attempt && uploadOpen(attempt);
  if (!editable && !mine.length) return '';
  return `<div class="photos"><div class="row" style="justify-content:space-between"><div><strong class="small">${editable ? 'Photos of your working for Question ' + esc(qn) : 'Photos of working (' + mine.length + ')'}</strong>${editable ? '<div class="small muted">Optional. Use them for diagrams, graphs or long working. Write the question number at the top of the page.</div>' : ''}</div>${can ? `<button class="btn ghost sm" onclick="pickPhoto('${esc(attempt.id)}','${esc(qn)}')">＋ Add photo</button>` : ''}</div>
   <div class="thumbs">${mine.map(p => `<div class="thumb" onclick="zoom('${esc(p.storage_path)}')">${photoUrls[p.storage_path] ? `<img src="${esc(photoUrls[p.storage_path])}" alt="Working for question ${esc(qn)}" loading="lazy">` : ''}${can ? `<button title="Remove photo" onclick="event.stopPropagation();removePhoto('${esc(p.id)}','${esc(attempt.id)}')">×</button>` : ''}</div>`).join('')}<span class="small muted" id="pst-${esc(qn)}"></span></div></div>`;
}
function refreshPhotos() {
  if (S.view === 'exam') { const q = S.exam.paper.content.questions[S.exam.idx]; const el = $('#photos-box'); if (el) el.innerHTML = photoBlock(q.n, true); }
  if (S.view === 'phone') render();
}
function pickPhoto(attemptId, qn) {
  if (S.exam) S.exam.ignoreBlur = true;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  const release = () => setTimeout(() => { if (S.exam) S.exam.ignoreBlur = false; }, 1200);
  window.addEventListener('focus', release, { once: true });
  inp.onchange = () => { release(); addPhotos(attemptId, qn, [...inp.files]); };
  inp.click();
}
async function compress(file) {
  try {
    const bmp = await createImageBitmap(file); const max = 1800; const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.82));
  } catch (e) { return file; }
}
async function addPhotos(attemptId, qn, files) {
  files = files.filter(f => /^image\//.test(f.type)); if (!files.length) return;
  const st = () => document.getElementById('pst-' + qn);
  for (let i = 0; i < files.length; i++) {
    if (st()) st().textContent = `Uploading photo ${i + 1} of ${files.length}…`;
    try {
      const blob = await compress(files[i]);
      const path = `${S.me.child_id}/${attemptId}/q${String(qn).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const up = await sb.storage.from(CFG.photoBucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.rpc('exam_add_photo', { p_attempt: attemptId, p_question: String(qn), p_path: path });
      if (error) { await sb.storage.from(CFG.photoBucket).remove([path]); throw error; }
    } catch (e) { toast('A photo could not be uploaded: ' + errText(e)); }
  }
  if (st()) st().textContent = '';
  await reloadPhotosFor(attemptId);
}
async function removePhoto(photoId, attemptId) {
  const { data: path, error } = await sb.rpc('exam_remove_photo', { p_photo: photoId });
  if (error) { toast('Could not remove the photo: ' + errText(error)); return; }
  await sb.storage.from(CFG.photoBucket).remove([path]);
  await reloadPhotosFor(attemptId);
}
async function reloadPhotosFor(attemptId) {
  const list = await loadPhotos(attemptId);
  if (S.view === 'phone') { S.phonePhotos = list; render(); }
}
function zoom(path) { const u = photoUrls[path]; if (!u) return; const d = document.createElement('div'); d.className = 'lightbox'; d.innerHTML = `<img src="${esc(u)}" alt="Photo of working">`; d.onclick = () => d.remove(); document.body.appendChild(d); }

/* phone upload view */
function renderPhone() {
  const list = Object.values(S.attempts).filter(uploadOpen);
  if (S.phonePaper && !list.find(a => a.paper_id === S.phonePaper)) S.phonePaper = null;
  if (!S.phonePaper && list.length === 1) { S.phonePaper = list[0].paper_id; loadPhonePhotos(); }
  const a = list.find(x => x.paper_id === S.phonePaper);
  const p = a && S.papers.find(x => x.id === a.paper_id);
  let body;
  if (!list.length) body = `<div class="card"><h3>Nothing to upload right now</h3><p class="muted">You can add photos while you're sitting a paper and for ${S.settings.upload_grace_minutes} minutes after you submit it.</p><button class="btn ghost" onclick="S.view='home';render()">Back to my papers</button></div>`;
  else if (!a) body = `<div class="card"><h3>Which paper?</h3>${list.map(x => { const pp = S.papers.find(y => y.id === x.paper_id); return `<p><button class="btn" onclick="S.phonePaper='${esc(x.paper_id)}';loadPhonePhotos()">${esc(pp ? pp.code + ' — ' + pp.subject : x.paper_id)}</button></p>`; }).join('')}</div>`;
  else {
    const qns = S.phoneQuestions || [];
    body = `<div class="card"><span class="chip">${esc(p ? p.code : a.paper_id)}</span><h2 style="margin-top:8px">Upload photos of your working</h2><p class="muted small">Write the question number at the top of each page. Choose the question below, then take or choose a photo. Your photos appear in your exam straight away.</p></div>
      ${qns.length ? qns.map(n => `<div style="margin-top:12px">${photoBlock(n, true, S.phonePhotos, a)}</div>`).join('')
        : `<div class="card" style="margin-top:12px"><label class="f">Question number</label><input type="text" id="pq" placeholder="e.g. 7" style="max-width:160px"><div style="margin-top:10px"><button class="btn" onclick="const v=$('#pq').value.trim();if(v)pickPhoto('${esc(a.id)}',v)">＋ Add photo</button></div></div>`}`;
  }
  $('#app').innerHTML = header(`<button class="btn ghost sm" onclick="S.view='home';render()">My papers</button>`) + `<div class="wrap" style="max-width:720px">${body}</div>`;
}
async function loadPhonePhotos() {
  const a = S.attempts[S.phonePaper]; if (!a) return;
  const { data } = await sb.from('exam_papers').select('content').eq('id', S.phonePaper).maybeSingle();
  S.phoneQuestions = data && data.content ? data.content.questions.map(q => q.n) : [];
  S.phonePhotos = await loadPhotos(a.id); render();
}

/* ---------------- teacher ---------------- */
async function loadStaffPapers() {
  const { data, error } = await sb.from('exam_papers').select('id,code,subject,title,tier,minutes,total_marks,calculator,sort,is_open,opened_at').order('sort');
  if (error) return fail('Could not load papers', errText(error));
  S.staffPapers = data || [];
  if (!S.resultsPaper && S.staffPapers[0]) S.resultsPaper = S.staffPapers[0].id;
  render();
  every('staffPoll', 15000, () => { if (S.view === 'teacher' && S.tab === 'results' && !document.querySelector('.modal-bg')) loadResults(); });
}
function renderTeacher() {
  const tabs = [['papers', 'Papers'], ['results', 'Results & marking']].concat(isAdmin() ? [['candidates', 'Candidates'], ['settings', 'Settings']] : []);
  let body = '';
  if (S.tab === 'papers') {
    body = S.staffPapers.length ? `<table class="t"><tr><th>Paper</th><th>Time</th><th>Marks</th><th>Status</th><th></th></tr>${S.staffPapers.map(p => `<tr><td><strong>${esc(p.subject)} — ${esc(p.title)}</strong><br><span class="muted small">${esc(p.code)}${p.tier ? ' · ' + esc(p.tier) + ' tier' : ''}</span></td><td>${esc(mins(p.minutes))}</td><td>${esc(p.total_marks)}</td><td>${p.is_open ? `<span class="chip">Open since ${esc(when(p.opened_at))}</span>` : '<span class="chip brown">Closed</span>'}</td><td style="text-align:right;white-space:nowrap"><button class="btn ghost sm" onclick="preview('${esc(p.id)}')">Preview</button> ${p.is_open ? `<button class="btn danger sm" onclick="closePaper('${esc(p.id)}')">Close</button>` : `<button class="btn sm" onclick="setOpen('${esc(p.id)}',true)">Open now</button>`}</td></tr>`).join('')}</table>
      <p class="muted small" style="margin-top:14px">Students see a paper's questions only while it is open, and only if they are entered for that subject and tier. Open it at the start time on the mock timetable. Close it once every student has submitted, including those with extra time. Papers whose time runs out are submitted automatically by the server.</p>`
      : '<p class="muted">No papers are loaded yet.</p>';
  } else if (S.tab === 'results') {
    body = `<div class="row"><select id="rp" style="max-width:420px" onchange="S.resultsPaper=this.value;S.results=null;render();loadResults()">${S.staffPapers.map(p => `<option value="${esc(p.id)}" ${p.id === S.resultsPaper ? 'selected' : ''}>${esc(p.code)} — ${esc(p.subject)} ${esc(p.title)}</option>`).join('')}</select><button class="btn ghost sm" onclick="loadResults()">Refresh</button><button class="btn ghost sm" onclick="copyCSV()">Copy results (CSV)</button></div><div id="res" style="margin-top:16px">${resultsTable()}</div>`;
    if (!S.results || S.results.pid !== S.resultsPaper) setTimeout(loadResults, 0);
  } else if (S.tab === 'candidates') {
    body = candidatesView();
    if (!S.candidates) setTimeout(loadCandidates, 0);
  } else {
    const st = S.settings;
    body = `<h3>Strict exam mode</h3>
      <label class="row small" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" id="sfs" ${st.fullscreen ? 'checked' : ''}> <span>Open papers in full screen, and count leaving full screen as an exit</span></label>
      <label class="f">Lock a paper on exit number</label><input type="number" id="sla" min="1" max="10" value="${st.lock_after}" style="max-width:120px">
      <p class="small muted">With 3, students get two warnings and the third exit locks their paper until a teacher unlocks it from Results &amp; marking.</p>
      <h3 style="margin-top:20px">Photos of working</h3>
      <label class="f">Minutes students may still upload photos after submitting</label><input type="number" id="sug" min="0" max="60" value="${st.upload_grace_minutes}" style="max-width:120px">
      <div class="row" style="margin-top:16px"><button class="btn" onclick="saveSettings()">Save settings</button><span id="xs" class="small muted"></span></div>`;
  }
  $('#app').innerHTML = header() + `<div class="wrap"><div class="hero"><div><h1>${isAdmin() ? 'Admin' : 'Teacher'} dashboard</h1><p>Open papers at their start time, watch students as they work, unlock locked papers, and mark scripts against the mark scheme.${isAdmin() ? '' : ' You see the students you teach.'}</p></div></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" onclick="S.tab='${k}';render()">${l}</button>`).join('')}</div><div class="card">${body}</div></div>`;
}
async function setOpen(id, open) {
  const { error } = await sb.rpc('exam_set_open', { p_paper: id, p_open: open });
  if (error) { toast('Could not change the paper: ' + errText(error)); return; }
  toast(open ? 'The paper is open to entered students.' : 'The paper is closed.', 3000); closeModal(); loadStaffPapers();
}
function closePaper(id) { modal(`<h2>Close this paper?</h2><p>Students who haven't started can no longer begin it. Students who are still writing can't reload the questions, so close it only after everyone has submitted.</p><div class="row"><button class="btn danger" onclick="setOpen('${esc(id)}',false)">Close paper</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`); }
async function saveSettings() {
  const v = { fullscreen: $('#sfs').checked, lock_after: Math.max(1, Math.min(10, Math.round(+$('#sla').value || 3))), upload_grace_minutes: Math.max(0, Math.min(60, Math.round(+$('#sug').value || 0))), updated_at: new Date().toISOString() };
  const { error } = await sb.from('exam_settings').update(v).eq('id', true);
  if (error) { $('#xs').textContent = 'Could not save: ' + errText(error); return; }
  Object.assign(S.settings, v); $('#xs').textContent = 'Saved.';
}

/* results and unlocking */
async function loadResults() {
  const pid = S.resultsPaper; if (!pid) return;
  const paper = S.staffPapers.find(p => p.id === pid);
  const { data: at, error } = await sb.from('exam_attempts').select('*, children(name)').eq('paper_id', pid);
  if (error) { S.results = { pid, paper, rows: [], err: true }; }
  else {
    const ids = (at || []).map(a => a.id), kids = (at || []).map(a => a.child_id);
    const [m, c] = await Promise.all([
      ids.length ? sb.from('exam_marks').select('attempt_id,total,complete').in('attempt_id', ids) : { data: [] },
      kids.length ? sb.from('exam_candidates').select('child_id,candidate_number').in('child_id', kids) : { data: [] }]);
    const mk = {}; (m.data || []).forEach(x => mk[x.attempt_id] = x);
    const cn = {}; (c.data || []).forEach(x => cn[x.child_id] = x.candidate_number);
    S.results = { pid, paper, rows: (at || []).map(a => ({ a, name: (a.children && a.children.name) || 'Student', cand: cn[a.child_id] || '', marks: mk[a.id] || null }))
      .sort((x, y) => x.name.localeCompare(y.name)) };
  }
  if (S.view === 'teacher' && S.tab === 'results') { const r = $('#res'); if (r) r.innerHTML = resultsTable(); }
}
function resultsTable() {
  const R = S.results; if (!R || R.pid !== S.resultsPaper) return '<p class="muted">Loading scripts…</p>';
  if (R.err) return '<p class="muted">Could not load scripts. Try Refresh.</p>';
  if (!R.rows.length) return '<p class="muted">No student has started this paper yet.</p>';
  const tot = R.paper ? R.paper.total_marks : '';
  const locked = R.rows.filter(r => r.a.status === 'in_progress' && r.a.locked);
  return `${locked.length ? `<div class="notice" style="background:var(--danger-soft);border-color:#EBC2BC;margin-bottom:12px"><strong>${locked.length} student${locked.length > 1 ? 's are' : ' is'} locked out:</strong> ${locked.map(r => esc(r.name)).join(', ')}. Check them on camera before you unlock.</div>` : ''}
  <table class="t"><tr><th>Student</th><th>Candidate</th><th>Status</th><th>Started</th><th>Time</th><th>Exits</th><th>Mark</th><th></th></tr>${R.rows.map((r, i) => {
    const a = r.a, end = a.submitted_at ? Date.parse(a.submitted_at) : now();
    const used = Math.round((end - Date.parse(a.started_at)) / 60000) + ' min' + (a.submitted_at ? '' : ' so far');
    const st = a.status === 'submitted' ? (a.auto_submitted ? '<span class="chip gold">Auto-submitted</span>' : '<span class="chip">Submitted</span>') : a.locked ? '<span class="chip red">Locked</span>' : '<span class="chip brown">Writing…</span>';
    const mk = r.marks ? `<strong>${esc(r.marks.total)}</strong> / ${esc(tot)} (${Math.round(100 * r.marks.total / tot)}%)${r.marks.complete ? '' : ' <span class="chip gold">part-marked</span>'}` : '<span class="muted">Not marked</span>';
    const ex = (a.violations || []).filter(v => v.type !== 'Unlocked by teacher'), nv = ex.length;
    const act = a.status === 'in_progress' && a.locked ? `<button class="btn danger sm" onclick="unlock(${i})">Unlock</button>` : `<button class="btn sm ${r.marks ? 'ghost' : ''}" onclick="openMarking(${i})">${r.marks ? 'Review' : 'Mark'}</button>`;
    return `<tr><td>${esc(r.name)}${a.extra_time_pct ? ` <span class="chip gold">+${a.extra_time_pct}%</span>` : ''}</td><td>${esc(r.cand)}</td><td>${st}</td><td>${esc(when(a.started_at))}</td><td>${used}</td><td>${nv ? `<span class="chip ${nv >= S.settings.lock_after ? 'red' : 'gold'}" title="${esc(ex.map(v => new Date(v.at).toLocaleTimeString() + ' ' + v.type).join('\n'))}">${nv}×</span>` : '0'}</td><td>${mk}</td><td style="white-space:nowrap">${act}</td></tr>`;
  }).join('')}</table>
  <p class="muted small" style="margin-top:10px">Refreshes every 15 seconds. "Exits" counts how often a student left the exam (switching tabs or windows, or exiting full screen); hover over the number for the times.</p>`;
}
function unlock(i) {
  const r = S.results.rows[i];
  modal(`<h2>Unlock ${esc(r.name)}?</h2><p>Unlock only once you've checked them on camera and they're ready to carry on. Their timer has kept running while they were locked.</p><p class="small muted">${(r.a.violations || []).map(v => esc(new Date(v.at).toLocaleTimeString() + ' – ' + v.type)).join('<br>')}</p><div class="row"><button class="btn danger" onclick="doUnlock(${i})">Unlock paper</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
}
async function doUnlock(i) {
  closeModal(); const r = S.results.rows[i];
  const { error } = await sb.rpc('exam_unlock', { p_attempt: r.a.id });
  if (error) { toast('Could not unlock: ' + errText(error)); return; }
  toast(r.name + ' has been unlocked.', 3000); loadResults();
}
function copyCSV() {
  const R = S.results; if (!R || !R.rows.length) { toast('No results to copy yet.', 2500); return; }
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = [['Name', 'Candidate', 'Paper', 'Status', 'Started', 'Submitted', 'Exits', 'Mark', 'Out of', 'Percent'].map(q).join(',')].concat(R.rows.map(r => [r.name, r.cand, R.paper.code, r.a.status, r.a.started_at, r.a.submitted_at || '', (r.a.violations || []).filter(v => v.type !== 'Unlocked by teacher').length, r.marks ? r.marks.total : '', R.paper.total_marks, r.marks ? Math.round(100 * r.marks.total / R.paper.total_marks) : ''].map(q).join(',')));
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Results copied. Paste them into your spreadsheet.', 3000), () => toast('Copy was blocked by the browser.', 3000));
}

/* marking */
async function openMarking(i) {
  const r = S.results.rows[i], pid = S.results.pid;
  S.view = 'loading'; render();
  const [paper, scheme, full, marks] = await Promise.all([
    sb.from('exam_papers').select('*').eq('id', pid).single(),
    sb.from('exam_schemes').select('items').eq('paper_id', pid).maybeSingle(),
    sb.from('exam_attempts').select('*').eq('id', r.a.id).single(),
    sb.from('exam_marks').select('*').eq('attempt_id', r.a.id).maybeSingle()]);
  if (paper.error || full.error) return fail('Could not open the script', errText(paper.error || full.error));
  const photos = await loadPhotos(r.a.id);
  S.marking = { r, paper: paper.data, scheme: (scheme.data && scheme.data.items) || [], a: full.data, photos,
    awarded: Object.assign({}, marks.data && marks.data.awarded), feedback: (marks.data && marks.data.feedback) || '' };
  S.view = 'marking'; render(); window.scrollTo(0, 0);
}
function markTotal() { return partsOf(S.marking.paper).reduce((s, { pt }) => s + (+S.marking.awarded[pt.id] || 0), 0); }
function renderMarking() {
  const { r, paper, scheme, a, awarded } = S.marking; const sm = {}; scheme.forEach(it => sm[it.part] = it);
  const exits = (a.violations || []);
  const qs = paper.content.questions.map(q => `<div class="card" style="margin-bottom:14px"><div class="qhead"><span class="qnum">${esc(q.n)}</span>${q.intro ? `<span class="small">${fmt(q.intro)}</span>` : ''}</div>${photoBlock(q.n, false, S.marking.photos, a)}${(q.parts || []).map(pt => {
    const x = (a.answers || {})[pt.id] || {}, s = sm[pt.id] || {};
    const studentAns = pt.type === 'long' ? `<div class="box">${esc(x.t || '') || '<span class="muted">No answer</span>'}</div>`
      : `${pt.type === 'short' ? '' : `<div class="ans-label">Working</div><div class="box">${esc(x.w || '') || '<span class="muted">None</span>'}</div>`}<div class="ans-label">Answer</div><div class="box"><strong>${esc(x.a || '') || '<span class="muted">No answer</span>'}</strong></div>`;
    return `<div class="part"><div class="pt"><div class="small">${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="marks">${esc(pt.marks)}</span></div>
    <div class="split"><div><div class="ans-label">Student</div>${studentAns}</div><div><div class="ans-label">Mark scheme</div><div class="box scheme">${s.working ? esc(s.working) + '\n' : ''}<strong>${esc(s.answer || '')}</strong>  ·  ${esc(s.codes || '')}${s.notes ? '\n' + esc(s.notes) : ''}</div>
    <div class="row" style="margin-top:8px"><label class="small" style="font-weight:700">Marks awarded</label><input type="number" min="0" max="${esc(pt.marks)}" step="1" style="width:90px" value="${awarded[pt.id] != null ? esc(awarded[pt.id]) : ''}" oninput="award('${esc(pt.id)}',this.value,${+pt.marks})"><span class="muted small">out of ${esc(pt.marks)}</span></div></div></div></div>`;
  }).join('')}</div>`).join('');
  $('#app').innerHTML = header(`<button class="btn ghost sm" onclick="S.view='teacher';render();loadResults()">Back to results</button>`) + `<div class="wrap">
   <div class="card" style="position:sticky;top:74px;z-index:10;margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div><h2 style="margin:0">${esc(r.name)} <span class="muted small">${esc(r.cand)}</span></h2><div class="small muted">${esc(paper.code)} · ${a.status === 'submitted' ? 'Submitted ' + esc(when(a.submitted_at)) + (a.auto_submitted ? ' (auto)' : '') : 'Still writing'}${a.extra_time_pct ? ' · ' + a.extra_time_pct + '% extra time' : ''} · ${exits.length ? exits.map(v => esc(new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + v.type.toLowerCase())).join('; ') : 'no exits'}</div></div><div class="spacer"></div><div class="timer" style="background:var(--green);color:#fff" id="mt">${markTotal()} / ${esc(paper.total_marks)}</div><button class="btn gold" onclick="saveMarks()">Save marks</button><span id="ms" class="small muted"></span></div>
   ${qs}
   <div class="card"><h3>Feedback for the student</h3><p class="muted small">Write three next steps for the feedback call.</p><textarea id="fb" rows="5" oninput="S.marking.feedback=this.value">${esc(S.marking.feedback)}</textarea><div class="row" style="margin-top:10px"><button class="btn gold" onclick="saveMarks()">Save marks</button></div></div></div>`;
}
function award(pid, v, max) {
  const n = v === '' ? null : Math.max(0, Math.min(max, Math.round(+v)));
  if (n === null) delete S.marking.awarded[pid]; else S.marking.awarded[pid] = n;
  $('#mt').textContent = markTotal() + ' / ' + S.marking.paper.total_marks;
}
async function saveMarks() {
  const M = S.marking, total = markTotal();
  const unmarked = partsOf(M.paper).filter(({ pt }) => M.awarded[pt.id] == null).length;
  const { error } = await sb.from('exam_marks').upsert({ attempt_id: M.a.id, awarded: M.awarded, feedback: M.feedback, total, max: M.paper.total_marks, complete: unmarked === 0, marked_by: (await sb.auth.getUser()).data.user.id, marked_at: new Date().toISOString() }, { onConflict: 'attempt_id' });
  if (error) { toast('Could not save the marks: ' + errText(error)); return; }
  document.querySelectorAll('#ms').forEach(e => e.textContent = unmarked ? `Saved · ${unmarked} part${unmarked > 1 ? 's' : ''} still to mark` : 'Saved · marking complete');
}

/* preview */
async function preview(id) {
  const { data } = await sb.from('exam_papers').select('*').eq('id', id).single(); if (!data) return;
  S.preview = data; S.view = 'preview'; render(); window.scrollTo(0, 0);
}
function renderPreview() {
  const p = S.preview, c = p.content;
  $('#app').innerHTML = header(`<button class="btn ghost sm" onclick="S.view='teacher';render()">Back</button>`) + `<div class="wrap" style="max-width:900px"><div class="card"><span class="chip">${esc(p.code)}</span><h1 style="margin-top:8px">${esc(p.subject)} — ${esc(p.title)}</h1><p class="muted">${esc(mins(p.minutes))} · ${esc(p.total_marks)} marks · ${p.calculator ? 'Calculator allowed' : 'No calculator'}</p>
  ${c.questions.map(q => `<div style="margin-top:20px"><div class="qhead"><span class="qnum">${esc(q.n)}</span></div>${q.intro ? `<div>${fmt(q.intro)}</div>` : ''}${qTable(q)}${q.after ? `<div>${fmt(q.after)}</div>` : ''}${(q.parts || []).map(pt => `<div class="part"><div class="pt"><div>${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="marks">(${esc(pt.marks)})</span></div></div>`).join('')}</div>`).join('')}</div></div>`;
}

/* candidates (admin) */
async function loadCandidates() {
  const [kids, cands, entries] = await Promise.all([
    sb.from('children').select('id,name,grade_level,meet_email,status,is_test').eq('status', 'active').in('grade_level', CFG.candidateYears).order('grade_level').order('name'),
    sb.from('exam_candidates').select('*'), sb.from('exam_entries').select('*')]);
  if (kids.error) { S.candidates = { err: errText(kids.error) }; }
  else {
    const cm = {}; (cands.data || []).forEach(c => cm[c.child_id] = c);
    const em = {}; (entries.data || []).forEach(e => { (em[e.child_id] = em[e.child_id] || {})[e.subject] = e; });
    S.candidates = { rows: (kids.data || []).filter(k => !k.is_test).map(k => ({ k, c: cm[k.id] || null, e: em[k.id] || {} })) };
  }
  if (S.view === 'teacher' && S.tab === 'candidates') render();
}
function candidatesView() {
  const C = S.candidates; if (!C) return '<p class="muted">Loading students…</p>';
  if (C.err) return `<p class="muted">Could not load students: ${esc(C.err)}</p>`;
  if (!C.rows.length) return `<p class="muted">No active students in ${esc(CFG.candidateYears.join(' or '))}.</p>`;
  const subj = CFG.subjects;
  return `<p>Enter students for the mock series, set extra time, and choose each student's subjects and tiers. A student sees a paper only if they are entered for its subject and tier.</p>
  <div style="overflow-x:auto"><table class="t"><tr><th>Student</th><th>Candidate</th><th>Extra time</th>${subj.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr>${C.rows.map(({ k, c, e }) => `<tr>
    <td><strong>${esc(k.name)}</strong><br><span class="small muted">${esc(k.grade_level)}</span>${k.meet_email ? '' : '<br><span class="chip red">No school Google account</span>'}</td>
    <td>${c ? esc(c.candidate_number) : `<button class="btn sm" onclick="enrol('${esc(k.id)}')">Enter for mocks</button>`}</td>
    <td>${c ? `<select onchange="setExtra('${esc(k.id)}',this.value)" style="min-width:90px">${[0, 10, 25, 50].map(v => `<option value="${v}" ${c.extra_time_pct === v ? 'selected' : ''}>${v ? '+' + v + '%' : 'None'}</option>`).join('')}</select>` : '—'}</td>
    ${subj.map(s => { if (!c) return '<td class="muted">—</td>'; const cur = e[s.name]; const val = cur ? (cur.tier || 'yes') : '';
      const opts = s.tiered ? [['', 'Not entered'], ['Higher', 'Higher'], ['Foundation', 'Foundation']] : [['', 'Not entered'], ['yes', 'Entered']];
      return `<td><select onchange="setEntry('${esc(k.id)}','${esc(s.name)}',this.value)" style="min-width:120px">${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`; }).join('')}
  </tr>`).join('')}</table></div>`;
}
async function enrol(childId) { const { error } = await sb.rpc('exam_enrol', { p_child: childId }); if (error) toast('Could not enter the student: ' + errText(error)); await loadCandidates(); }
async function setExtra(childId, v) { const { error } = await sb.from('exam_candidates').update({ extra_time_pct: +v, updated_at: new Date().toISOString() }).eq('child_id', childId); toast(error ? 'Could not save: ' + errText(error) : 'Extra time saved.', 2500); }
async function setEntry(childId, subject, v) {
  let error;
  if (!v) ({ error } = await sb.from('exam_entries').delete().eq('child_id', childId).eq('subject', subject));
  else ({ error } = await sb.from('exam_entries').upsert({ child_id: childId, subject, tier: v === 'yes' ? null : v }, { onConflict: 'child_id,subject' }));
  toast(error ? 'Could not save: ' + errText(error) : 'Entry saved.', 2000);
  if (error) loadCandidates();
}

boot();
