/* Baobab Digital Academy — Assessment Centre
 * Static front end. Every rule (who sees what, deadlines, locks, devices) is enforced in Supabase
 * by row level security and exam_* functions; this file presents them and reports integrity signals.
 * No inline handlers: all events go through the delegated listeners at the bottom (strict CSP).
 */
'use strict';
(() => {
const CFG = window.EXAM_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});
const LOGO = 'assets/logo-tree.webp', LOGO_FULL = 'assets/logo-full.webp';

const S = {
  view: 'loading', me: null, offset: 0, dash: null, exam: null, intro: null,
  tab: 'live', papers: [], series: [], subjects: [], live: null, results: null, resultsPaper: null, marking: null, preview: null,
  students: null, studentYear: '', events: null, settings: null, filters: { series: '', year: '', subject: '' },
  timers: {}, photoUrls: {}, lastActive: Date.now(), signalAt: {}
};

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
function mins(m) { const h = Math.floor(m / 60), r = m % 60; return (h ? h + ' hour' + (h > 1 ? 's' : '') : '') + (h && r ? ' ' : '') + (r ? r + ' minutes' : '') || '0 minutes'; }
function clock(ms) { ms = Math.max(0, ms); const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0'); }
const when = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const day = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const now = () => Date.now() + S.offset;
const errText = e => (e && (e.message || e.error_description)) || 'Something went wrong. Try again.';
const isStaff = () => S.me && (S.me.role === 'admin' || S.me.role === 'tutor');
const isAdmin = () => S.me && S.me.role === 'admin';
const colour = s => CFG.subjectColours[s] || CFG.defaultColour;
const firstName = n => String(n || '').trim().split(/\s+/)[0];
function every(name, ms, fn) { clearInterval(S.timers[name]); S.timers[name] = setInterval(fn, ms); }
function stop(name) { clearInterval(S.timers[name]); delete S.timers[name]; }
function stopAll() { Object.keys(S.timers).forEach(stop); }
function toast(t, ms = 4500) { const o = document.createElement('div'); o.className = 'toast'; o.setAttribute('role', 'status'); o.textContent = t; document.body.appendChild(o); setTimeout(() => o.remove(), ms); }
function dialog(html, wide) { $('#overlay').innerHTML = `<div class="scrim"><div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('#overlay input, #overlay textarea, #overlay button'); if (f) f.focus(); }
function closeDialog() { $('#overlay').innerHTML = ''; }
function partsOf(content) { const out = []; ((content || {}).questions || []).forEach(q => (q.parts || []).forEach(pt => out.push({ q, pt }))); return out; }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function qTable(q) { return q.table ? `<table class="qtable"><tr>${q.table.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${q.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''; }
function paperLabel(p) { return [p.qualification, p.board, p.tier ? p.tier + ' tier' : ''].filter(Boolean).join(', '); }

function header() {
  const who = S.me && S.me.role ? `<div class="who"><strong>${esc(S.me.name || '')}</strong>${S.me.role === 'student' ? esc(S.me.year || '') : S.me.role === 'admin' ? 'Admin' : 'Tutor'}</div><button class="btn quiet sm" data-act="signout">Sign out</button>` : '';
  return `<header class="topbar"><div class="topbar-in"><img src="${LOGO}" alt=""><div class="wordmark"><b>BAOBAB <span>DIGITAL ACADEMY</span></b><small>Assessment Centre</small></div><div class="spacer"></div>${who}</div></header>`;
}
function fail(title, msg, canSignOut) {
  S.view = 'error'; $('#app').innerHTML = header() + `<main class="wrap" style="max-width:640px"><div class="panel"><h2>${esc(title)}</h2><p>${esc(msg)}</p>${canSignOut ? '<button class="btn" data-act="signout">Sign out and try another account</button>' : '<button class="btn" data-act="reload">Try again</button>'}</div></main>`;
}
function render() {
  const v = S.view;
  if (v === 'loading') $('#app').innerHTML = header() + `<main class="wrap"><p class="muted">Loading the assessment centre…</p></main>`;
  else if (v === 'login') renderLogin();
  else if (v === 'mfa') renderMfa();
  else if (v === 'home') renderHome();
  else if (v === 'intro') renderIntro();
  else if (v === 'exam') renderExam();
  else if (v === 'done') renderDone();
  else if (v === 'phone') renderPhone();
  else if (v === 'staff') renderStaff();
  else if (v === 'marking') renderMarking();
  else if (v === 'preview') renderPreview();
  else if (v === 'other') renderOtherDevice();
}

/* ---------------- sign in ---------------- */
const BRANCHES = `<svg viewBox="0 0 520 420" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-width="10">
  <path d="M260 420 V250 Q260 210 220 180 L150 120" stroke="#472D1A"/><path d="M260 250 Q262 200 300 170 L380 110" stroke="#2E7D5B"/>
  <path d="M260 300 Q300 270 340 268 L450 250" stroke="#EEAC44"/><path d="M220 180 L210 70" stroke="#472D1A"/><path d="M300 170 L320 60" stroke="#2E7D5B"/></g>
  <g stroke-width="5" fill="#123D2B"><circle cx="150" cy="120" r="18" stroke="#EEAC44"/><circle cx="210" cy="64" r="14" stroke="#F6C977"/><circle cx="380" cy="108" r="18" stroke="#EEAC44"/><circle cx="322" cy="54" r="14" stroke="#CFE3D7"/><circle cx="452" cy="250" r="16" stroke="#F6C977"/></g></svg>`;
const GLOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
function renderLogin() {
  $('#app').innerHTML = header() + `<main class="signin">
  <section class="signin-art">${BRANCHES}<h1>Show what you know.</h1><p>Timed assessments every two months for every year group, and GCSE mocks for each exam board. Sign in to see the papers waiting for you.</p></section>
  <section class="signin-forms">
    <div class="panel"><h2>Students</h2><p>Sign in with your school Google account, the one you use for Google Meet. It ends in <strong>@${esc(CFG.studentEmailDomain)}</strong>.</p>
      <button class="btn gold gbtn" data-act="google">${GLOGO}Sign in with Google</button></div>
    <div class="panel"><h2>Tutors and admins</h2><p class="muted small">Use the email and password you use for the tutor or admin portal.</p>
      <form data-submit="staffSignIn" autocomplete="on"><label class="f" for="em">Email</label><input type="email" id="em" autocomplete="username" required maxlength="200">
      <label class="f" for="pw">Password</label><input type="password" id="pw" autocomplete="current-password" required maxlength="200">
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">Sign in</button><span id="le" class="err" role="alert"></span></div></form></div>
  </section></main>`;
}
let failedLogins = 0;
async function staffSignIn() {
  const email = $('#em').value.trim(), password = $('#pw').value;
  if (failedLogins >= 5) { $('#le').textContent = 'Too many attempts. Wait a minute, then try again.'; return; }
  $('#le').textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { failedLogins++; if (failedLogins >= 5) setTimeout(() => { failedLogins = 0; }, 60000); $('#le').textContent = 'That email and password don\'t match. Check them and try again.'; return; }
  failedLogins = 0; await afterSignIn();
}
async function googleSignIn() {
  try { sessionStorage.setItem('afterLogin', location.hash === '#upload' ? 'phone' : ''); } catch (e) {}
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { hd: CFG.studentEmailDomain, prompt: 'select_account' } } });
  if (error) toast('Google sign-in is not available: ' + errText(error));
}
async function signOut() { stopAll(); closeDialog(); try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) {} await sb.auth.signOut(); S.me = null; S.exam = null; S.view = 'login'; render(); }

async function afterSignIn() {
  S.view = 'loading'; render();
  const { data, error } = await sb.rpc('exam_whoami');
  if (error) return fail('The assessment centre can\'t load', errText(error));
  S.me = data; S.offset = Date.parse(data.server_now) - Date.now();
  if (!data.role) {
    const { data: u } = await sb.auth.getUser();
    return fail('This account isn\'t linked to the assessment centre', `You're signed in as ${u && u.user ? u.user.email : 'an unknown account'}. Students sign in with their @${CFG.studentEmailDomain} Google account. Tutors and admins use their portal email and password. If this is the right account, contact the academy office.`, true);
  }
  let after = ''; try { after = sessionStorage.getItem('afterLogin') || ''; sessionStorage.removeItem('afterLogin'); } catch (e) {}
  if (isStaff()) {
    if (data.mfa_needed) { S.view = 'mfa'; return render(); }
    S.view = 'staff'; render(); await loadStaff(); watchIdle();
  } else {
    await loadDash(); S.view = after === 'phone' || location.hash === '#upload' ? 'phone' : 'home'; render();
    every('dash', 15000, async () => { if (S.view === 'home' || S.view === 'phone') { await loadDash(); render(); } });
  }
}

/* ---------------- two-step sign-in for staff ---------------- */
async function renderMfa(fromAccount) {
  const { data } = await sb.auth.mfa.listFactors();
  const verified = ((data && data.totp) || []).find(f => f.status === 'verified');
  const back = fromAccount ? '<button class="btn quiet" data-act="tab" data-tab="account">Back</button>' : '';
  if (verified) {
    $('#app').innerHTML = header() + `<main class="wrap" style="max-width:520px"><div class="panel"><h2>Enter your 6-digit code</h2><p>Open your authenticator app and type the code for Baobab Assessment Centre.</p>
      <form data-submit="mfaVerify" data-factor="${esc(verified.id)}"><input type="text" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Verify</button>${back}<span id="me" class="err" role="alert"></span></div></form></div></main>`;
    return;
  }
  for (const f of ((data && data.all) || []).filter(f => f.status !== 'verified')) { try { await sb.auth.mfa.unenroll({ factorId: f.id }); } catch (e) {} }
  const { data: en, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Baobab Assessment Centre ' + new Date().toISOString().slice(0, 16) });
  if (error) return fail('Two-step sign-in could not be set up', errText(error), true);
  $('#app').innerHTML = header() + `<main class="wrap" style="max-width:620px"><div class="panel"><h2>Set up two-step sign-in</h2>
    <p>Scan this code with an authenticator app such as Google Authenticator or Microsoft Authenticator. Then type the 6-digit code it shows.</p>
    <div class="row" style="align-items:flex-start;gap:24px"><div class="qr"><img src="${esc(en.totp.qr_code)}" alt="QR code for your authenticator app"></div>
    <div style="flex:1;min-width:220px"><p class="small muted">Can't scan? Enter this key instead:</p><code class="secret">${esc(en.totp.secret)}</code>
    <form data-submit="mfaVerify" data-factor="${esc(en.id)}"><label class="f" for="code">6-digit code</label><input type="text" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
    <div class="row" style="margin-top:14px"><button class="btn" type="submit">Turn on two-step sign-in</button>${back}</div><p id="me" class="err" role="alert"></p></form></div></div></div></main>`;
}
async function mfaVerify(form) {
  const factorId = form.dataset.factor, code = $('#code').value.trim();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) { $('#me').textContent = 'That code didn\'t work. Check the time on your phone and try the next code.'; return; }
  toast('Two-step sign-in is on.'); await afterSignIn();
}

/* idle sign-out for staff */
function watchIdle() {
  const limit = ((S.me.settings && S.me.settings.staff_idle_minutes) || 30) * 60000;
  every('idle', 30000, () => { if (Date.now() - S.lastActive > limit) { signOut().then(() => toast('You were signed out after a period of inactivity.', 6000)); } });
}

/* ---------------- student dashboard ---------------- */
async function loadDash() {
  const { data, error } = await sb.rpc('exam_my_dashboard');
  if (error) { toast('Could not refresh your papers: ' + errText(error)); return; }
  S.dash = data; S.offset = Date.parse(data.server_now) - Date.now();
}
function uploadOpen(p) {
  const a = p.attempt; if (!a) return false; const r = p.rules || {};
  if (a.status === 'in_progress') return now() <= Date.parse(a.deadline) + (r.save_grace_seconds || 120) * 1000;
  return now() <= Date.parse(a.submitted_at) + (r.upload_grace_minutes || 10) * 60000;
}
function currentCycle(series, papers) {
  const today = new Date(now()).toISOString().slice(0, 10);
  const inWin = series.find(s => s.starts_on && s.ends_on && today >= s.starts_on && today <= s.ends_on);
  if (inWin) return inWin.cycle;
  const open = papers.find(p => p.series_kind === 'assessment'); if (open) { const s = series.find(x => x.name === open.series); if (s) return s.cycle; }
  const next = series.find(s => s.starts_on && s.starts_on >= today); return next ? next.cycle : null;
}
function yearPath(series, cur) {
  if (!series.length) return '';
  const W = 640, pad = 62, xs = series.map((_, i) => pad + i * (W - 2 * pad) / Math.max(1, series.length - 1));
  const y = i => 92 - Math.sin((i / (series.length - 1)) * Math.PI) * 34;
  const today = new Date(now()).toISOString().slice(0, 10);
  let d = `M${xs[0] - 40} ${y(0) + 22} Q ${xs[0] - 18} ${y(0) + 2}, ${xs[0]} ${y(0)}`;
  for (let i = 1; i < xs.length; i++) d += ` S ${xs[i] - 40} ${y(i)}, ${xs[i]} ${y(i)}`;
  const nodes = series.map((s, i) => {
    const past = s.ends_on && s.ends_on < today, isCur = s.cycle === cur;
    const fill = isCur ? '#EEAC44' : past ? '#CFE3D7' : '#123D2B', stroke = isCur ? '#FBEFD6' : past ? '#CFE3D7' : '#CFE3D7';
    const when = s.starts_on ? day(s.starts_on) + (s.ends_on ? '–' + day(s.ends_on) : '') : '';
    return `<g>${isCur ? `<circle cx="${xs[i]}" cy="${y(i)}" r="22" fill="#EEAC44" opacity=".25"/>` : ''}<line x1="${xs[i]}" y1="${y(i)}" x2="${xs[i]}" y2="${y(i) - 26}" stroke="#2E7D5B" stroke-width="3" stroke-linecap="round"/><circle cx="${xs[i]}" cy="${y(i) - 30}" r="4" fill="#2E7D5B"/>
      <circle cx="${xs[i]}" cy="${y(i)}" r="${isCur ? 13 : 9}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
      <text x="${xs[i]}" y="${y(i) + 34}" text-anchor="middle" font-size="13" font-weight="${isCur ? 800 : 600}" fill="${isCur ? '#F6C977' : '#DCEBE1'}">${esc(s.name)}</text>
      ${when ? `<text x="${xs[i]}" y="${y(i) + 50}" text-anchor="middle" font-size="11.5" fill="#A9C8B6">${esc(when)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="path" viewBox="0 0 ${W} 160" role="img" aria-label="This year's six assessments${cur ? ', assessment ' + cur + ' is now' : ''}"><path d="${d}" fill="none" stroke="#472D1A" stroke-width="7" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#EEAC44" stroke-width="1.5" stroke-dasharray="2 8" stroke-linecap="round"/>${nodes}</svg>`;
}
function renderHome() {
  const me = S.me, d = S.dash || { series: [], papers: [], results: [] };
  const cur = currentCycle(d.series, d.papers);
  const groups = {}; d.papers.forEach(p => { (groups[p.series || 'Other papers'] = groups[p.series || 'Other papers'] || []).push(p); });
  const rows = Object.keys(groups).map(g => `<div class="group-title">${esc(g)}</div><div class="papers">${groups[g].map(p => {
    const a = p.attempt, extra = me.extra_time_pct ? Math.round(p.minutes * (100 + me.extra_time_pct) / 100) : p.minutes;
    let status = '<span class="pill live">Open now</span>', btn = `<button class="btn" data-act="intro" data-id="${esc(p.id)}">Start</button>`;
    if (a && a.status === 'submitted') { status = '<span class="pill bark">Handed in</span>'; btn = `<span class="small muted">${esc(when(a.submitted_at))}</span>`; }
    else if (a) { status = a.locked ? '<span class="pill red">Locked</span>' : '<span class="pill gold">In progress</span>'; btn = `<button class="btn gold" data-act="resume" data-id="${esc(a.id)}">Carry on</button>`; }
    return `<article class="paper-row"><div class="spine" style="background:${esc(colour(p.subject))}"></div><div class="body"><h3>${esc(p.subject)}: ${esc(p.title)}</h3>
      <div class="facts"><span>${esc(mins(extra))}${me.extra_time_pct ? ' with extra time' : ''}</span><span>${esc(p.total_marks)} marks</span><span>${p.calculator ? 'Calculator allowed' : 'No calculator'}</span>${paperLabel(p) ? `<span>${esc(paperLabel(p))}</span>` : ''}</div></div>
      <div class="act">${status}${btn}</div></article>`;
  }).join('')}</div>`).join('');
  const uploadable = d.papers.filter(uploadOpen);
  $('#app').innerHTML = header() + `<section class="hero"><div class="hero-in"><div><h1>${esc(greeting())}, ${esc(firstName(me.name))}.</h1>
    <p>${esc(me.year || '')}${me.candidate_number ? ', candidate number ' + esc(me.candidate_number) : ''}. Join your invigilator's Google Meet before you start a paper.</p></div>
    <div>${yearPath(d.series, cur)}</div></div></section>
  <main class="wrap">
    ${uploadable.length ? `<div class="note row" style="margin-bottom:22px"><div style="flex:1"><strong>Photos of your rough working.</strong> You can add them from your phone: open this page there, sign in, and choose Add photos.</div><button class="btn gold sm" data-act="phone">Add photos</button></div>` : ''}
    <div class="section-head"><h2>Your papers</h2><span class="muted small">Updates by itself every 15 seconds</span></div>
    ${d.papers.length ? rows : `<div class="empty"><h3>Nothing to sit right now</h3><p class="muted" style="margin:0">Your tutor opens each paper at its start time. When it opens, it appears here by itself. Keep this page open.</p></div>`}
    ${d.results.length ? `<div class="section-head" style="margin-top:36px"><h2>Your results</h2></div><div class="results">${d.results.map(r => `<div class="result"><div class="small muted">${esc(r.series)}</div><h3 style="margin:2px 0 6px">${esc(r.subject)}: ${esc(r.title)}</h3><div class="score">${esc(r.total)}<small> / ${esc(r.max)}</small></div><div class="bar"><i style="width:${Math.round(100 * r.total / r.max)}%"></i></div>${r.feedback ? `<p class="small" style="white-space:pre-wrap;margin:0">${esc(r.feedback)}</p>` : ''}</div>`).join('')}</div>` : ''}
  </main>`;
}

/* ---------------- before the exam ---------------- */
function renderIntro() {
  const p = S.intro, me = S.me, r = p.rules || {};
  const total = Math.round(p.minutes * (100 + (me.extra_time_pct || 0)) / 100);
  $('#app').innerHTML = header() + `<main class="wrap"><div class="cover">
  <div class="cover-head"><div class="small muted">${esc(p.series || '')}${paperLabel(p) ? ', ' + esc(paperLabel(p)) : ''}</div><h1 style="margin:6px 0 2px">${esc(p.subject)}</h1><h2 style="color:var(--forest)">${esc(p.title)}</h2>
    <div class="facts-grid"><div class="fact"><b>${esc(mins(total))}</b><span>${me.extra_time_pct ? 'Includes ' + me.extra_time_pct + '% extra time' : 'Time allowed'}</span></div><div class="fact"><b>${esc(p.total_marks)}</b><span>Marks</span></div><div class="fact"><b>${p.calculator ? 'Allowed' : 'Not allowed'}</b><span>Calculator</span></div><div class="fact"><b>${esc(me.candidate_number || 'Given on start')}</b><span>Candidate number</span></div></div></div>
  <div class="cover-body">
    <h3>Before you start</h3>
    <ul><li>Answer all the questions. Type your working and your answer in the boxes.</li><li>Show your working: you can get marks for it even if your answer is wrong.</li><li>${p.calculator ? 'You may use a calculator.' : 'You may not use a calculator.'}</li><li>Use rough paper for diagrams and long working, then photograph it with Add photo.</li></ul>
    <div class="note">The timer starts when you press Start the paper and keeps going if you close the page. Your answers save as you type. When time runs out, your paper is handed in for you.</div>
    <div class="note warn" style="margin-top:10px"><strong>Exam rules are on.</strong> ${r.fullscreen ? 'The paper opens in full screen. ' : ''}Leaving it, by switching tabs, apps or windows${r.fullscreen ? ' or leaving full screen' : ''}, is recorded and your tutor sees it. You get ${Math.max(0, (r.lock_after || 3) - 1)} warning${(r.lock_after || 3) - 1 === 1 ? '' : 's'}, then the paper locks until your invigilator unlocks it. Copying and pasting are turned off. The paper can only be open on one device.</div>
    <label class="check" style="margin-top:18px"><input type="checkbox" id="ok"><span>I am working alone with my camera on in the invigilator's Google Meet. I won't use notes, other websites, AI tools or anyone's help.</span></label>
    <div class="row" style="margin-top:20px"><button class="btn gold" data-act="start">Start the paper</button><button class="btn quiet" data-act="home">Back to my papers</button><span id="ie" class="err" role="alert"></span></div>
  </div></div></main>`;
}
async function startPaper() {
  if (!$('#ok').checked) { $('#ie').textContent = 'Tick the box to confirm the exam rules.'; return; }
  if ((S.intro.rules || {}).fullscreen) goFullscreen();
  $('#ie').textContent = 'Starting…';
  const { data, error } = await sb.rpc('exam_start', { p_paper: S.intro.id });
  if (error) { $('#ie').textContent = errText(error); return; }
  await openAttempt(data.id);
}
async function openAttempt(id) {
  const { data, error } = await sb.rpc('exam_open_attempt', { p_attempt: id });
  if (error) { toast('The paper could not be opened: ' + errText(error)); return; }
  if (data.status !== 'in_progress') { S.exam = { done: data, paper: S.intro || {} }; S.view = 'done'; S.submitOk = true; return render(); }
  S.offset = Date.parse(data.server_now) - Date.now();
  const a = data.attempt; a.answers = a.answers || {}; a.flags = a.flags || {};
  S.exam = { paper: data.paper, attempt: a, rules: data.rules || {}, idx: 0, saving: false, pending: false, warned: {}, saveState: 'All answers saved', photos: [] };
  stop('dash'); S.view = 'exam'; render(); window.scrollTo(0, 0);
  every('tick', 1000, tick); tick();
  every('beat', 20000, heartbeat); heartbeat();
  loadPhotos(); checkScreens();
  if (a.locked) showLock('');
}

/* ---------------- the exam ---------------- */
const remaining = () => Date.parse(S.exam.attempt.deadline) - now();
function tick() {
  if (!S.exam || S.view !== 'exam') return;
  const r = remaining(), el = $('#timer');
  if (el) { el.textContent = clock(r); el.className = 'timer' + (r <= 5 * 60000 ? ' crit' : r <= 30 * 60000 ? ' warn' : ''); }
  const lc = $('#lockclock'); if (lc) lc.textContent = clock(r);
  if (r <= 30 * 60000 && r > 29 * 60000 && !S.exam.warned[30]) { S.exam.warned[30] = 1; toast('30 minutes left.'); }
  if (r <= 5 * 60000 && r > 0 && !S.exam.warned[5]) { S.exam.warned[5] = 1; toast('5 minutes left. Check your answers.'); }
  if (r <= 0) handIn(true);
}
function filled(q) { const A = S.exam.attempt.answers; return (q.parts || []).some(pt => { const a = A[pt.id]; return a && ((a.a || '').trim() || (a.w || '').trim() || (a.t || '').trim()); }); }
function watermark() {
  const t = esc(`${S.me.name} ${S.me.candidate_number || ''}`.trim());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="180"><text x="20" y="110" transform="rotate(-18 170 90)" font-family="sans-serif" font-size="15" fill="rgba(18,61,43,0.07)">${t}</text></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
function field(pt, k, a, rows) {
  const common = `data-ans="1" data-pid="${esc(pt.id)}" data-k="${k}" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" aria-label="${k === 'w' ? 'Working' : 'Answer'} for ${esc(pt.label || 'this question')}"`;
  return rows ? `<textarea rows="${rows}" ${common}>${esc(a[k] || '')}</textarea>` : `<input type="text" ${common} value="${esc(a[k] || '')}" maxlength="500">`;
}
function renderExam() {
  const { paper, attempt, idx } = S.exam, qs = paper.content.questions, q = qs[idx];
  const nav = qs.map((qq, n) => `<button class="${filled(qq) ? 'done' : ''} ${n === idx ? 'cur' : ''} ${attempt.flags[qq.n] ? 'flag' : ''}" data-act="go" data-n="${n}" aria-label="Question ${esc(qq.n)}">${esc(qq.n)}</button>`).join('');
  const parts = (q.parts || []).map(pt => {
    const a = attempt.answers[pt.id] || {};
    const body = pt.type === 'long' ? `<div class="alabel">Your answer</div>${field(pt, 't', a, pt.rows || 14)}<div class="small muted" id="wc-${esc(pt.id)}">${wc(a.t)} words</div>`
      : pt.type === 'short' ? `<div class="alabel">Answer</div>${field(pt, 'a', a)}`
      : `<div class="alabel">Working</div>${field(pt, 'w', a, 4)}<div class="alabel">Answer</div>${field(pt, 'a', a)}`;
    return `<div class="part"><div class="stem"><div>${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="m">(${esc(pt.marks)})</span></div>${body}</div>`;
  }).join('');
  const total = (q.parts || []).reduce((s, pt) => s + (+pt.marks || 0), 0);
  $('#app').innerHTML = `<div class="exambar"><div class="exambar-in"><img src="${LOGO}" alt=""><div class="ttl">${esc(paper.subject)}: ${esc(paper.title)}<small>${esc(S.me.name)}${S.me.candidate_number ? ', ' + esc(S.me.candidate_number) : ''}${attempt.extra_time_pct ? ', ' + attempt.extra_time_pct + '% extra time' : ''}</small></div><div class="spacer"></div><span class="save" id="save" role="status">${esc(S.exam.saveState)}</span><div class="timer" id="timer" aria-label="Time left">--:--</div><button class="btn gold sm" data-act="askHandIn">Hand in</button></div></div>
  <div class="exam"><aside class="qnav" aria-label="Questions"><h3 style="margin:0">Questions</h3><div class="qgrid">${nav}</div>
    <div class="key"><div><i style="background:var(--sage);border:1px solid var(--sage-2)"></i>Answered</div><div><i style="background:#fff;border:1px solid var(--line)"></i>Not answered</div><div><i style="background:var(--gold);border-radius:50%"></i>Flagged to check</div></div>
    ${paper.calculator ? '' : '<p class="note small" style="margin-top:12px">No calculator for this paper.</p>'}</aside>
  <main class="sheet"><div class="wm" style="background-image:${watermark()}"></div>
    <div class="q"><div class="num">${esc(q.n)}</div><div class="content"><div class="qtop"><span>Question ${idx + 1} of ${qs.length}</span><div class="spacer"></div><button class="btn quiet sm" data-act="flag">${attempt.flags[q.n] ? 'Flagged to check' : 'Flag to check later'}</button></div>
    ${q.intro ? `<div>${fmt(q.intro)}</div>` : ''}${qTable(q)}${q.after ? `<div>${fmt(q.after)}</div>` : ''}${parts}
    <div class="qtotal">(Total for question ${esc(q.n)} is ${total} mark${total > 1 ? 's' : ''})</div></div></div>
    <div id="photos-box">${photoBlock(q.n, true)}</div>
    <div class="qfoot"><button class="btn quiet" data-act="go" data-n="${idx - 1}" ${idx === 0 ? 'disabled' : ''}>Previous</button>${idx < qs.length - 1 ? `<button class="btn" data-act="go" data-n="${idx + 1}">Next question</button>` : `<button class="btn gold" data-act="askHandIn">Check and hand in</button>`}</div>
  </main></div>`;
  tick();
}
const wc = t => (t || '').trim() ? (t || '').trim().split(/\s+/).length : 0;
function go(n) { if (n < 0 || n >= S.exam.paper.content.questions.length) return; S.exam.idx = n; render(); window.scrollTo(0, 0); }
function flag() { const q = S.exam.paper.content.questions[S.exam.idx]; const f = S.exam.attempt.flags; f[q.n] = !f[q.n]; queueSave(); render(); }
function onAnswer(el) {
  const pid = el.dataset.pid, k = el.dataset.k, A = S.exam.attempt.answers;
  A[pid] = Object.assign({}, A[pid], { [k]: el.value.slice(0, 20000) });
  if (k === 't') { const w = document.getElementById('wc-' + pid); if (w) w.textContent = wc(el.value) + ' words'; }
  queueSave();
}
function setSave(t) { if (!S.exam) return; S.exam.saveState = t; const e = $('#save'); if (e) e.textContent = t; }
function queueSave() { setSave('Saving…'); clearTimeout(S.exam.dirty); S.exam.dirty = setTimeout(saveNow, 1200); }
async function saveNow() {
  const ex = S.exam; if (!ex || !ex.attempt || ex.attempt.status === 'submitted') return;
  if (ex.saving) { ex.pending = true; return; }
  ex.saving = true;
  try {
    const { data, error } = await sb.rpc('exam_save', { p_attempt: ex.attempt.id, p_answers: ex.attempt.answers, p_flags: ex.attempt.flags });
    if (error) throw error;
    if (data.ok) { setSave('All answers saved'); S.offset = Date.parse(data.server_now) - Date.now(); }
    else if (data.reason === 'other_device') otherDevice();
    else if (data.status === 'submitted') finishLocally(true);
    else if (data.reason === 'locked') setSave('Paper locked');
  } catch (e) { setSave('Not saved yet. Check your internet.'); setTimeout(queueSave, 4000); }
  finally { ex.saving = false; if (ex.pending) { ex.pending = false; saveNow(); } }
}
async function heartbeat() {
  const ex = S.exam; if (!ex || S.view !== 'exam') return;
  const client = { w: innerWidth, h: innerHeight, sw: screen.width, sh: screen.height, ext: !!screen.isExtended, fs: !!document.fullscreenElement, vis: document.visibilityState };
  const { data, error } = await sb.rpc('exam_heartbeat', { p_attempt: ex.attempt.id, p_client: client });
  if (error || !data) return;
  S.offset = Date.parse(data.server_now) - Date.now();
  if (data.other_device) return otherDevice();
  if (data.status === 'submitted') return finishLocally(true);
  if (data.deadline && data.deadline !== ex.attempt.deadline) { if (Date.parse(data.deadline) > Date.parse(ex.attempt.deadline)) toast('Your invigilator has given you extra time.'); ex.attempt.deadline = data.deadline; }
  if (data.locked && !ex.attempt.locked) { ex.attempt.locked = true; showLock(''); }
  if (!data.locked && ex.attempt.locked) { ex.attempt.locked = false; every('beat', 20000, heartbeat); dialog(`<h2>Your paper is unlocked</h2><p>Your invigilator has unlocked it. The timer kept going while it was locked.</p><button class="btn gold" data-act="backToExam">Back to the paper</button>`); }
}
function askHandIn() {
  const { paper, attempt } = S.exam;
  const blank = partsOf(paper.content).filter(({ pt }) => { const a = attempt.answers[pt.id]; return !(a && ((a.a || '').trim() || (a.w || '').trim() || (a.t || '').trim())); }).length;
  const flagged = Object.values(attempt.flags).filter(Boolean).length;
  dialog(`<h2>Hand in your paper?</h2><p>You have <strong>${clock(remaining())}</strong> left.</p>${blank ? `<p class="note">${blank} part${blank > 1 ? 's are' : ' is'} still blank.</p>` : ''}${flagged ? `<p class="muted">${flagged} question${flagged > 1 ? 's are' : ' is'} flagged to check.</p>` : ''}<p>After you hand in, you can't change your answers.</p><div class="row"><button class="btn gold" data-act="handIn">Hand in my paper</button><button class="btn quiet" data-act="close">Keep working</button></div>`);
}
function finishLocally(auto) {
  const ex = S.exam; if (!ex) return; stop('tick'); stop('beat'); clearTimeout(ex.dirty); closeDialog();
  ex.attempt.status = 'submitted'; ex.attempt.submitted_at = ex.attempt.submitted_at || new Date(now()).toISOString(); ex.attempt.auto = !!auto;
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
  S.view = 'done'; render();
}
async function handIn(auto) {
  const ex = S.exam; if (!ex || ex.attempt.status === 'submitted' || ex.submitting) return;
  ex.submitting = true; S.submitOk = false; finishLocally(auto);
  for (let i = 0; i < 6; i++) {
    const { data, error } = await sb.rpc('exam_submit', { p_attempt: ex.attempt.id, p_answers: ex.attempt.answers, p_flags: ex.attempt.flags, p_auto: !!auto });
    if (!error && data.ok) { ex.attempt.submitted_at = data.submitted_at; S.submitOk = true; break; }
    if (!error && data.reason === 'other_device') { S.submitOk = false; break; }
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
  }
  if (S.view === 'done') render();
}
function renderDone() {
  const ex = S.exam, a = ex.attempt || {}, ok = S.submitOk;
  $('#app').innerHTML = header() + `<main class="wrap" style="max-width:640px;text-align:center"><img src="${LOGO_FULL}" alt="Baobab Digital Academy" style="width:180px;margin:20px auto 10px;display:block">
  <h1>${a.auto ? 'Time is up.' : 'Paper handed in.'}</h1><p>${esc(ex.paper.subject || '')}${ex.paper.title ? ': ' + esc(ex.paper.title) : ''}${a.submitted_at ? ', handed in at ' + esc(when(a.submitted_at)) : ''}.</p>
  <p class="muted">${ok ? 'Your answers are saved. Your tutor will share your marks after marking.' : 'Saving your final answers. Keep this page open.'}</p>
  <div class="note" style="text-align:left;margin:18px 0">You can still add photos of rough working for ${esc((ex.rules && ex.rules.upload_grace_minutes) || 10)} minutes. Choose Add photos on your papers page, on this device or your phone.</div>
  <p class="small muted">Stay in the Google Meet until your invigilator lets you go.</p><button class="btn" data-act="home">Back to my papers</button></main>`;
}
function otherDevice() { stop('tick'); stop('beat'); closeDialog(); S.view = 'other'; render(); }
function renderOtherDevice() {
  $('#app').innerHTML = header() + `<main class="wrap" style="max-width:600px"><div class="panel"><h2>This paper is open somewhere else</h2><p>Your paper was opened on another device or browser, so it has stopped saving here. It is locked until your invigilator checks with you.</p><p>Tell your invigilator in Google Meet, then carry on from the device they tell you to use.</p><button class="btn" data-act="home">Back to my papers</button></div></main>`;
}

/* ---------------- exam rules in the browser ---------------- */
function goFullscreen() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => { if (S.exam) S.exam.fsOn = true; }).catch(() => {}); } catch (e) {} }
const inExam = () => S.exam && S.view === 'exam' && S.exam.attempt && S.exam.attempt.status === 'in_progress';
async function violation(type) {
  const ex = S.exam; if (!inExam() || ex.ignoreBlur) return;
  const t = Date.now(); if (ex.lastV && t - ex.lastV < 2500) return; ex.lastV = t;
  queueSave();
  const { data, error } = await sb.rpc('exam_report_exit', { p_attempt: ex.attempt.id, p_type: type });
  if (error || !data) return;
  ex.attempt.strikes = data.strikes;
  if (data.locked) { ex.attempt.locked = true; showLock(type); } else showWarning(type, data.strikes, data.lock_after);
}
function signal(kind, detail) {
  if (!inExam()) return; const k = kind + JSON.stringify(detail || {});
  if (S.signalAt[k] && Date.now() - S.signalAt[k] < 15000) return; S.signalAt[k] = Date.now();
  sb.rpc('exam_report_signal', { p_attempt: S.exam.attempt.id, p_kind: kind, p_detail: detail || {} }).then(() => {}, () => {});
}
function showWarning(type, strikes, lockAfter) {
  const left = lockAfter - strikes;
  $('#overlay').innerHTML = `<div class="lockscreen"><div class="lockcard warn" role="alertdialog" aria-labelledby="wt"><h2 id="wt">You left the paper</h2><p>${esc(type)}. This has been recorded and your tutor can see it.</p><div class="strikes" aria-label="${strikes} of ${lockAfter}">${Array.from({ length: lockAfter }, (_, i) => `<i class="${i < strikes ? 'on' : ''}"></i>`).join('')}</div><p><strong>${left <= 1 ? 'If you leave again, your paper will lock.' : 'You have ' + (left - 1) + ' more warning' + (left - 1 === 1 ? '' : 's') + ' before your paper locks.'}</strong></p><button class="btn gold" data-act="backToExam">Back to the paper</button></div></div>`;
}
function showLock(type) {
  $('#overlay').innerHTML = `<div class="lockscreen"><div class="lockcard locked" role="alertdialog" aria-labelledby="lt"><img src="${LOGO}" style="height:56px" alt=""><h2 id="lt">Your paper is locked</h2><p>${type ? esc(type) + '. ' : ''}Your tutor has been told.</p><p><strong>Tell your invigilator in Google Meet.</strong> Only they can unlock it. The timer is still running: <span id="lockclock" class="pill red">${clock(remaining())}</span></p><p class="small muted">This screen opens by itself when you're unlocked.</p></div></div>`;
  every('beat', 5000, heartbeat);
}
function backToExam() { closeDialog(); if (S.exam && (S.exam.rules || {}).fullscreen) goFullscreen(); }
function checkScreens() {
  try { if (screen.isExtended) signal('second_screen', { screens: 'extended' }); } catch (e) {}
  try { if (screen.addEventListener) screen.addEventListener('change', () => { if (screen.isExtended) signal('second_screen', { screens: 'extended' }); }); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.hidden) violation('Switched to another tab or app'); });
window.addEventListener('blur', () => { if (inExam() && !document.hidden) setTimeout(() => { if (!document.hasFocus()) violation('Left the exam window'); }, 200); });
document.addEventListener('fullscreenchange', () => {
  if (!inExam()) return;
  if (document.fullscreenElement) S.exam.fsOn = true;
  else if (S.exam.fsOn && S.exam.rules.fullscreen) violation('Left full screen');
});
document.addEventListener('paste', e => { if (inExam() && S.exam.rules.block_paste !== false) { e.preventDefault(); toast('Pasting is turned off during the paper.'); signal('paste_blocked', { length: ((e.clipboardData && e.clipboardData.getData('text')) || '').length }); } }, true);
['copy', 'cut'].forEach(t => document.addEventListener(t, e => { if (inExam()) { e.preventDefault(); signal('copy_blocked'); } }, true));
document.addEventListener('contextmenu', e => { if (inExam()) e.preventDefault(); }, true);
['dragstart', 'drop'].forEach(t => document.addEventListener(t, e => { if (inExam()) e.preventDefault(); }, true));
document.addEventListener('keydown', e => {
  S.lastActive = Date.now();
  if (!inExam()) return;
  const k = (e.key || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(k)) { e.preventDefault(); signal(k === 'p' ? 'print_blocked' : 'shortcut_blocked', { key: k }); }
}, true);
document.addEventListener('keyup', e => { if (inExam() && e.key === 'PrintScreen') signal('shortcut_blocked', { key: 'PrintScreen' }); });
window.addEventListener('beforeprint', () => signal('print_blocked'));
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (inExam() && innerWidth < screen.availWidth * 0.7) signal('split_screen', { w: innerWidth, sw: screen.availWidth }); }, 800); });
let offlineAt = 0; window.addEventListener('offline', () => { offlineAt = Date.now(); if (inExam()) setSave('Offline. Your answers will save when you reconnect.'); });
window.addEventListener('online', () => { if (inExam()) { signal('connection_back', { seconds: Math.round((Date.now() - offlineAt) / 1000) }); queueSave(); } });
['mousemove', 'pointerdown', 'scroll'].forEach(t => window.addEventListener(t, () => { S.lastActive = Date.now(); }, { passive: true }));

/* ---------------- photos of working ---------------- */
async function signUrls(paths) {
  const need = paths.filter(p => !S.photoUrls[p]); if (!need.length) return;
  const { data } = await sb.storage.from(CFG.photoBucket).createSignedUrls(need, 600);
  (data || []).forEach(u => { if (u.signedUrl) S.photoUrls[u.path] = u.signedUrl; });
}
async function loadPhotos(attemptId) {
  const id = attemptId || (S.exam && S.exam.attempt && S.exam.attempt.id); if (!id) return [];
  const { data } = await sb.rpc('exam_my_photos', { p_attempt: id });
  const list = data || []; await signUrls(list.map(p => p.storage_path));
  if (S.exam && S.exam.attempt && S.exam.attempt.id === id) { S.exam.photos = list; refreshPhotos(); }
  return list;
}
function photoBlock(qn, editable, list, attemptId, canAdd) {
  list = list || (S.exam ? S.exam.photos : []); attemptId = attemptId || (S.exam && S.exam.attempt && S.exam.attempt.id);
  const mine = list.filter(p => String(p.question_n) === String(qn));
  const can = editable && (canAdd !== undefined ? canAdd : inExam());
  if (!editable && !mine.length) return '';
  return `<div class="photos${editable && S.view === 'exam' ? '' : ' flat'}"><div class="row"><div style="flex:1"><strong class="small">${editable ? 'Photos of your working for question ' + esc(qn) : 'Photos of working (' + mine.length + ')'}</strong>${editable ? '<div class="small muted">Optional. Write the question number at the top of the page, then take a clear photo.</div>' : ''}</div>${can ? `<button class="btn quiet sm" data-act="pickPhoto" data-att="${esc(attemptId)}" data-q="${esc(qn)}">Add photo</button>` : ''}</div>
   <div class="thumbs">${mine.map(p => `<button class="thumb" data-act="zoom" data-path="${esc(p.storage_path)}" aria-label="Open photo">${S.photoUrls[p.storage_path] ? `<img src="${esc(S.photoUrls[p.storage_path])}" alt="">` : ''}${can ? `<span class="x" role="button" tabindex="0" data-act="removePhoto" data-photo="${esc(p.id)}" data-att="${esc(attemptId)}" aria-label="Remove photo">×</span>` : ''}</button>`).join('')}<span class="small muted" id="pst-${esc(qn)}"></span></div></div>`;
}
function refreshPhotos() {
  if (S.view === 'exam') { const q = S.exam.paper.content.questions[S.exam.idx]; const el = $('#photos-box'); if (el) el.innerHTML = photoBlock(q.n, true); }
  if (S.view === 'phone') render();
}
function pickPhoto(attemptId, qn) {
  if (S.exam) S.exam.ignoreBlur = true;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp,image/heic,image/*'; inp.multiple = true;
  const release = () => setTimeout(() => { if (S.exam) S.exam.ignoreBlur = false; }, 1500);
  window.addEventListener('focus', release, { once: true });
  inp.addEventListener('change', () => { release(); addPhotos(attemptId, qn, [...inp.files]); });
  inp.click();
}
async function compress(file) {
  // Re-encoding strips metadata (location, device) and anything hidden in the file.
  const bmp = await createImageBitmap(file); const max = 1800, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not read the photo')), 'image/jpeg', 0.82));
}
async function addPhotos(attemptId, qn, files) {
  files = files.filter(f => /^image\//.test(f.type) && f.size < 25 * 1024 * 1024); if (!files.length) { toast('Choose a photo (JPEG, PNG or HEIC under 25 MB).'); return; }
  const st = () => document.getElementById('pst-' + qn);
  for (let i = 0; i < files.length; i++) {
    if (st()) st().textContent = `Uploading photo ${i + 1} of ${files.length}…`;
    try {
      const blob = await compress(files[i]);
      const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
      const path = `${S.me.child_id}/${attemptId}/q${String(qn).replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}-${Date.now()}-${rand}.jpg`;
      const up = await sb.storage.from(CFG.photoBucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.rpc('exam_add_photo', { p_attempt: attemptId, p_question: String(qn).slice(0, 10), p_path: path });
      if (error) { await sb.storage.from(CFG.photoBucket).remove([path]); throw error; }
    } catch (e) { toast('A photo could not be added: ' + errText(e)); }
  }
  if (st()) st().textContent = '';
  const list = await loadPhotos(attemptId); if (S.view === 'phone') { S.phonePhotos = list; render(); }
}
async function removePhoto(photoId, attemptId) {
  const { data: path, error } = await sb.rpc('exam_remove_photo', { p_photo: photoId });
  if (error) { toast('Could not remove the photo: ' + errText(error)); return; }
  await sb.storage.from(CFG.photoBucket).remove([path]);
  const list = await loadPhotos(attemptId); if (S.view === 'phone') { S.phonePhotos = list; render(); }
}
function zoom(path) { const u = S.photoUrls[path]; if (!u) return; const d = document.createElement('div'); d.className = 'lightbox'; d.innerHTML = `<img src="${esc(u)}" alt="Photo of working">`; d.addEventListener('click', () => d.remove()); document.body.appendChild(d); }

/* phone: add photos without opening the paper (opening it on a second device would lock it) */
function renderPhone() {
  const list = ((S.dash && S.dash.papers) || []).filter(uploadOpen);
  if (S.phonePaper && !list.find(p => p.id === S.phonePaper)) S.phonePaper = null;
  if (!S.phonePaper && list.length === 1) { S.phonePaper = list[0].id; loadPhonePhotos(); }
  const p = list.find(x => x.id === S.phonePaper);
  let body;
  if (!list.length) body = `<div class="empty"><h3>Nothing to add photos to</h3><p class="muted">You can add photos while you're sitting a paper and for a few minutes after you hand it in.</p><button class="btn quiet" data-act="home">Back to my papers</button></div>`;
  else if (!p) body = `<div class="panel"><h2>Which paper?</h2><div class="stack">${list.map(x => `<button class="btn" data-act="phonePaper" data-id="${esc(x.id)}">${esc(x.subject)}: ${esc(x.title)}</button>`).join('')}</div></div>`;
  else {
    const photos = S.phonePhotos || [], qns = [...new Set(photos.map(x => x.question_n))];
    body = `<div class="panel"><div class="small muted">${esc(p.subject)}: ${esc(p.title)}</div><h2>Add photos of your working</h2><p class="small">Type the question number, then take or choose a photo. It appears in your paper straight away.</p>
      <label class="f" for="pq">Question number</label><div class="row"><input type="text" id="pq" inputmode="numeric" maxlength="10" style="max-width:140px"><button class="btn gold" data-act="phoneAdd" data-att="${esc(p.attempt.id)}">Take or choose photo</button></div></div>
      ${qns.map(n => `<div style="margin-top:12px">${photoBlock(n, true, photos, p.attempt.id, true)}</div>`).join('')}`;
  }
  $('#app').innerHTML = header() + `<main class="wrap" style="max-width:680px">${body}</main>`;
}
async function loadPhonePhotos() { const p = (S.dash.papers || []).find(x => x.id === S.phonePaper); if (!p) return; S.phonePhotos = await loadPhotos(p.attempt.id); render(); }

/* ---------------- staff ---------------- */
async function loadStaff() {
  const [p, s, sub, st] = await Promise.all([
    sb.from('exam_papers').select('id,code,subject,title,tier,board,qualification,year_groups,minutes,total_marks,calculator,sort,is_open,opened_at,series_id,lock_after,fullscreen').order('sort').order('code'),
    sb.from('exam_series').select('*').order('academic_year', { ascending: false }).order('kind').order('cycle'),
    sb.from('subjects').select('name').eq('is_active', true).order('name'),
    sb.from('exam_settings').select('*').single()]);
  if (p.error) return fail('Could not load papers', errText(p.error), true);
  S.papers = p.data || []; S.series = s.data || []; S.subjects = (sub.data || []).map(x => x.name); S.settings = st.data || {};
  if (!S.resultsPaper && S.papers[0]) S.resultsPaper = S.papers[0].id;
  render(); loadTab();
  every('staffPoll', 12000, () => { if (S.view === 'staff' && (S.tab === 'live' || S.tab === 'results') && !$('#overlay .scrim')) loadTab(); });
}
function loadTab() { if (S.tab === 'live') loadLive(); else if (S.tab === 'results') loadResults(); else if (S.tab === 'students') loadStudents(); else if (S.tab === 'activity') loadEvents(); }
function seriesName(id) { const s = S.series.find(x => x.id === id); return s ? s.name + (s.kind === 'assessment' ? ' ' + s.academic_year : '') : 'No series'; }
const TABS = [['live', 'Live now'], ['papers', 'Papers'], ['results', 'Results and marking'], ['students', 'Students', 1], ['series', 'Assessment calendar', 1], ['activity', 'Activity log'], ['settings', 'Settings', 1], ['account', 'My sign-in']];
function renderStaff() {
  const locked = S.live ? S.live.rows.filter(r => r.a.status === 'in_progress' && r.a.locked).length : 0;
  const nav = TABS.filter(t => !t[2] || isAdmin()).map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}${k === 'live' && locked ? `<span class="count">${locked}</span>` : ''}</button>`).join('');
  const views = { live: liveView, papers: papersView, results: resultsView, students: studentsView, series: seriesView, activity: eventsView, settings: settingsView, account: accountView };
  $('#app').innerHTML = header() + `<div class="staff"><nav class="side" aria-label="Sections"><div class="role">${isAdmin() ? 'Admin' : 'Tutor'}</div>${nav}</nav><main class="main">${views[S.tab]()}</main></div>`;
}
function setTab(t) { S.tab = t; render(); loadTab(); }

/* live */
async function loadLive() {
  const open = S.papers.filter(p => p.is_open).map(p => p.id);
  const since = new Date(now() - 3 * 3600 * 1000).toISOString();
  let q = sb.from('exam_attempts').select('id,paper_id,child_id,status,started_at,deadline,submitted_at,locked,strikes,violations,last_seen_at,extra_time_pct,auto_submitted,client,children(name,grade_level)');
  q = open.length ? q.or(`status.eq.in_progress,paper_id.in.(${open.map(x => '"' + x + '"').join(',')})`) : q.eq('status', 'in_progress');
  const { data, error } = await q.gte('started_at', since).order('started_at', { ascending: false });
  if (error) { S.live = { rows: [], err: errText(error) }; }
  else {
    const ids = (data || []).map(a => a.id); let sig = {};
    if (ids.length) { const { data: ev } = await sb.from('exam_events').select('attempt_id,kind').in('attempt_id', ids).like('kind', 'signal.%'); (ev || []).forEach(e => { (sig[e.attempt_id] = sig[e.attempt_id] || {})[e.kind] = ((sig[e.attempt_id] || {})[e.kind] || 0) + 1; }); }
    S.live = { rows: (data || []).map(a => ({ a, sig: sig[a.id] || {} })) };
  }
  if (S.view === 'staff' && S.tab === 'live') render();
}
function liveState(a) {
  if (a.status === 'submitted') return a.auto_submitted ? '<span class="pill gold">Time ran out</span>' : '<span class="pill bark">Handed in</span>';
  if (a.locked) return '<span class="pill red">Locked</span>';
  const seen = a.last_seen_at ? now() - Date.parse(a.last_seen_at) : 1e9;
  return seen < 70000 ? '<span class="pill live">Writing</span>' : `<span class="pill red">Not seen for ${Math.round(seen / 60000)} min</span>`;
}
function liveView() {
  const L = S.live; const open = S.papers.filter(p => p.is_open);
  const sigLabel = { 'signal.paste_blocked': 'paste', 'signal.copy_blocked': 'copy', 'signal.second_screen': 'second screen', 'signal.split_screen': 'split screen', 'signal.print_blocked': 'print', 'signal.shortcut_blocked': 'shortcut', 'signal.connection_back': 'reconnected' };
  return `<div class="main-head"><h1>Live now</h1><span class="muted small">Refreshes every 12 seconds</span></div>
  ${open.length ? `<p>${open.length} paper${open.length > 1 ? 's are' : ' is'} open: ${open.map(p => esc(p.code + ' ' + p.subject)).join(', ')}.</p>` : '<p class="muted">No papers are open. Open one from Papers when it is time to start.</p>'}
  ${!L ? '<p class="muted">Loading…</p>' : L.err ? `<p class="err">${esc(L.err)}</p>` : !L.rows.length ? '<div class="empty"><h3>No one is sitting a paper yet</h3><p class="muted" style="margin:0">Students appear here as soon as they start.</p></div>' : `<div class="tablebox"><table class="t"><thead><tr><th>Student</th><th>Paper</th><th>Status</th><th>Time left</th><th>Exits</th><th>Other signals</th><th></th></tr></thead><tbody>${L.rows.map(({ a, sig }) => {
    const p = S.papers.find(x => x.id === a.paper_id) || {}; const ex = (a.violations || []).filter(v => !/Unlocked/.test(v.type));
    const left = a.status === 'in_progress' ? clock(Date.parse(a.deadline) - now()) : '—';
    const sigs = Object.keys(sig).map(k => `${sigLabel[k] || k.replace('signal.', '')} ×${sig[k]}`).join(', ');
    return `<tr><td><strong>${esc(a.children ? a.children.name : '')}</strong><div class="small muted">${esc(a.children ? a.children.grade_level : '')}${a.extra_time_pct ? ', +' + a.extra_time_pct + '% time' : ''}</div></td><td>${esc(p.code || a.paper_id)}<div class="small muted">${esc(p.subject || '')}</div></td><td>${liveState(a)}</td><td style="font-variant-numeric:tabular-nums">${left}</td>
      <td>${ex.length ? `<span class="pill ${a.locked ? 'red' : 'gold'}">${ex.length}</span>` : '0'}</td><td class="small">${esc(sigs) || '<span class="muted">None</span>'}</td>
      <td style="white-space:nowrap;text-align:right">${a.status === 'in_progress' && a.locked ? `<button class="btn danger sm" data-act="unlock" data-id="${esc(a.id)}">Unlock</button> ` : ''}${a.status === 'in_progress' ? `<button class="btn quiet sm" data-act="extend" data-id="${esc(a.id)}">Add time</button> ` : ''}<button class="btn quiet sm" data-act="log" data-id="${esc(a.id)}">History</button></td></tr>`;
  }).join('')}</tbody></table></div>`}`;
}
function unlockAsk(id) {
  const r = S.live && S.live.rows.find(x => x.a.id === id); const a = r ? r.a : null;
  dialog(`<h2>Unlock ${esc(a && a.children ? a.children.name : 'this paper')}?</h2><p>Unlock only after you've checked the student on camera and they're ready to carry on. The timer kept running while it was locked.</p>${a ? `<p class="small muted">${(a.violations || []).map(v => esc(new Date(v.at).toLocaleTimeString('en-GB') + ': ' + v.type)).join('<br>')}</p>` : ''}<div class="row"><button class="btn danger" data-act="doUnlock" data-id="${esc(id)}">Unlock the paper</button><button class="btn quiet" data-act="close">Cancel</button></div>`);
}
async function doUnlock(id) { closeDialog(); const { error } = await sb.rpc('exam_unlock', { p_attempt: id }); toast(error ? 'Could not unlock: ' + errText(error) : 'Unlocked.', 3000); loadTab(); }
function extendAsk(id) {
  dialog(`<h2>Add time</h2><p>Use this for lost connection or technical problems. The reason is saved in the activity log.</p><form data-submit="doExtend" data-id="${esc(id)}"><label class="f" for="xm">Minutes to add</label><input type="number" id="xm" min="1" max="60" value="5" required style="max-width:120px"><label class="f" for="xr">Reason</label><input type="text" id="xr" maxlength="200" required placeholder="For example: internet dropped for 4 minutes"><div class="row" style="margin-top:16px"><button class="btn" type="submit">Add time</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div></form>`);
}
async function doExtend(form) { const { error } = await sb.rpc('exam_extend_time', { p_attempt: form.dataset.id, p_minutes: +$('#xm').value, p_reason: $('#xr').value.trim() }); closeDialog(); toast(error ? 'Could not add time: ' + errText(error) : 'Time added. The student sees it within 20 seconds.', 4000); loadTab(); }
const EV = { 'attempt.start': 'Started the paper', 'attempt.exit': 'Left the paper', 'attempt.locked': 'Paper locked', 'attempt.unlock': 'Unlocked by staff', 'attempt.other_device': 'Opened on another device', 'attempt.submit': 'Handed in', 'attempt.auto_submit': 'Handed in automatically', 'attempt.extend': 'Time added', 'attempt.reset': 'Sitting reset', 'photo.add': 'Photo added', 'photo.remove': 'Photo removed', 'save.other_device_refused': 'Save from another device refused', 'submit.other_device_refused': 'Hand-in from another device refused', 'signal.paste_blocked': 'Paste blocked', 'signal.copy_blocked': 'Copy blocked', 'signal.second_screen': 'Second screen detected', 'signal.split_screen': 'Split screen detected', 'signal.print_blocked': 'Print blocked', 'signal.shortcut_blocked': 'Shortcut blocked', 'signal.connection_back': 'Reconnected', 'exam_marks.insert': 'Marks saved', 'exam_marks.update': 'Marks changed', 'exam_papers.update': 'Paper changed', 'exam_papers.insert': 'Paper added', 'exam_entries.insert': 'Entry added', 'exam_entries.update': 'Entry changed', 'exam_entries.delete': 'Entry removed', 'exam_candidates.insert': 'Candidate added', 'exam_candidates.update': 'Candidate changed', 'exam_settings.update': 'Settings changed', 'exam_series.update': 'Calendar changed', 'exam_series.insert': 'Series added' };
function evDetail(e) { const d = e.detail || {}; if (e.kind === 'attempt.exit' || e.kind === 'attempt.locked') return d.type || ''; if (e.kind === 'attempt.extend') return `${d.minutes} min: ${d.reason || ''}`; if (e.kind === 'attempt.reset') return d.reason || ''; if (e.kind.startsWith('exam_marks')) return d.total != null ? 'Total ' + d.total : ''; if (e.kind === 'exam_papers.update') return d.is_open === true ? 'Opened' : d.is_open === false ? 'Closed' : ''; if (e.kind === 'photo.add') return 'Question ' + (d.question || ''); if (d.key) return d.key; return ''; }
async function showLog(id) {
  const { data } = await sb.from('exam_events').select('at,kind,detail,ip,user_agent').eq('attempt_id', id).order('at');
  dialog(`<h2>History of this sitting</h2><div class="tablebox"><table class="t"><thead><tr><th>Time</th><th>What happened</th><th>Detail</th><th>Network</th></tr></thead><tbody>${(data || []).map(e => `<tr><td>${esc(new Date(e.at).toLocaleTimeString('en-GB'))}</td><td>${esc(EV[e.kind] || e.kind)}</td><td class="small">${esc(evDetail(e))}</td><td class="small muted" title="${esc(e.user_agent || '')}">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table></div><div class="row" style="margin-top:14px"><button class="btn" data-act="close">Close</button></div>`, true);
}

/* papers */
function filteredPapers() { const f = S.filters; return S.papers.filter(p => (!f.series || p.series_id === f.series) && (!f.year || (p.year_groups || []).includes(f.year)) && (!f.subject || p.subject === f.subject)); }
function papersView() {
  const f = S.filters, list = filteredPapers(); const groups = {};
  list.forEach(p => { (groups[p.series_id || ''] = groups[p.series_id || ''] || []).push(p); });
  return `<div class="main-head"><h1>Papers</h1><div class="spacer"></div>${isAdmin() ? '<button class="btn gold" data-act="paperForm">Add a paper</button>' : ''}</div>
  <div class="toolbar"><select data-change="filter" data-key="series" aria-label="Series"><option value="">All series</option>${S.series.map(s => `<option value="${esc(s.id)}" ${f.series === s.id ? 'selected' : ''}>${esc(seriesName(s.id))}</option>`).join('')}</select>
    <select data-change="filter" data-key="year" aria-label="Year group"><option value="">All years</option>${CFG.yearGroups.map(y => `<option ${f.year === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>
    <select data-change="filter" data-key="subject" aria-label="Subject"><option value="">All subjects</option>${[...new Set(S.papers.map(p => p.subject))].sort().map(s => `<option ${f.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
  ${!list.length ? '<div class="empty"><h3>No papers match</h3><p class="muted" style="margin:0">Change the filters, or add a paper.</p></div>' : Object.keys(groups).map(g => `<div class="group-title">${esc(g ? seriesName(g) : 'Not in a series')}</div><div class="tablebox"><table class="t"><thead><tr><th>Paper</th><th>For</th><th>Time</th><th>Status</th><th></th></tr></thead><tbody>${groups[g].map(p => `<tr>
    <td><strong>${esc(p.subject)}: ${esc(p.title)}</strong><div class="small muted">${esc(p.code)}${paperLabel(p) ? ', ' + esc(paperLabel(p)) : ''}</div></td>
    <td class="small">${esc((p.year_groups || []).join(', ') || 'No year groups yet')}</td><td class="small">${esc(mins(p.minutes))}, ${esc(p.total_marks)} marks</td>
    <td>${p.is_open ? `<span class="pill live">Open since ${esc(when(p.opened_at))}</span>` : '<span class="pill bark">Closed</span>'}</td>
    <td style="white-space:nowrap;text-align:right"><button class="btn quiet sm" data-act="preview" data-id="${esc(p.id)}">Preview</button> ${isAdmin() ? `<button class="btn quiet sm" data-act="paperForm" data-id="${esc(p.id)}">Edit</button> ` : ''}${p.is_open ? `<button class="btn danger sm" data-act="closeAsk" data-id="${esc(p.id)}">Close</button>` : `<button class="btn sm" data-act="openAsk" data-id="${esc(p.id)}" ${(p.year_groups || []).length ? '' : 'disabled title="Choose year groups first"'}>Open</button>`}</td></tr>`).join('')}</tbody></table></div>`).join('')}
  <p class="muted small" style="margin-top:16px">A paper reaches students in its year groups who are taught its subject. Papers with an exam board or tier only reach students entered for that board and tier on the Students page.</p>`;
}
function openAsk(id) { const p = S.papers.find(x => x.id === id); dialog(`<h2>Open ${esc(p.code)}?</h2><p>${esc(p.subject)}: ${esc(p.title)}. Students in ${esc((p.year_groups || []).join(', '))}${p.board || p.tier ? ' entered for ' + esc(paperLabel(p)) : ' taught ' + esc(p.subject)} can start it now.</p><div class="row"><button class="btn" data-act="setOpen" data-id="${esc(id)}" data-open="1">Open the paper</button><button class="btn quiet" data-act="close">Cancel</button></div>`); }
function closeAsk(id) { dialog(`<h2>Close this paper?</h2><p>Students who haven't started can no longer begin it. Students still writing can carry on until their time runs out.</p><div class="row"><button class="btn danger" data-act="setOpen" data-id="${esc(id)}" data-open="0">Close the paper</button><button class="btn quiet" data-act="close">Cancel</button></div>`); }
async function setOpen(id, open) { closeDialog(); const { error } = await sb.rpc('exam_set_open', { p_paper: id, p_open: open }); if (error) return toast('Could not change the paper: ' + errText(error)); toast(open ? 'Paper opened.' : 'Paper closed.', 2500); await loadStaff(); }
async function preview(id) { const { data } = await sb.from('exam_papers').select('*').eq('id', id).single(); if (!data) return; S.preview = data; S.view = 'preview'; render(); window.scrollTo(0, 0); }
function renderPreview() {
  const p = S.preview, c = p.content || { questions: [] };
  $('#app').innerHTML = header() + `<main class="wrap" style="max-width:920px"><div class="row" style="margin-bottom:14px"><button class="btn quiet" data-act="backStaff">Back to papers</button></div><div class="sheet" style="padding-right:36px">
  <div class="q"><div class="num"></div><div class="content"><div class="small muted">${esc(p.code)}${paperLabel(p) ? ', ' + esc(paperLabel(p)) : ''}</div><h1>${esc(p.subject)}: ${esc(p.title)}</h1><p class="muted">${esc(mins(p.minutes))}, ${esc(p.total_marks)} marks, ${p.calculator ? 'calculator allowed' : 'no calculator'}</p></div></div>
  ${c.questions.map(q => `<div class="q" style="margin-top:18px"><div class="num">${esc(q.n)}</div><div class="content">${q.intro ? `<div>${fmt(q.intro)}</div>` : ''}${qTable(q)}${q.after ? `<div>${fmt(q.after)}</div>` : ''}${(q.parts || []).map(pt => `<div class="part"><div class="stem"><div>${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="m">(${esc(pt.marks)})</span></div></div>`).join('')}</div></div>`).join('')}</div></main>`;
}
function paperForm(id) {
  const p = id ? S.papers.find(x => x.id === id) : { year_groups: [], calculator: true, minutes: 60 };
  dialog(`<h2>${id ? 'Edit ' + esc(p.code) : 'Add a paper'}</h2><form data-submit="savePaper" data-id="${esc(id || '')}">
  <div class="grid-form">
    ${id ? '' : `<div><label class="f" for="pf-id">Paper ID</label><input type="text" id="pf-id" required pattern="[A-Za-z0-9-]+" maxlength="40" placeholder="Y7-MATH-A2"></div>`}
    <div><label class="f" for="pf-code">Paper code shown to students</label><input type="text" id="pf-code" required maxlength="40" value="${esc(p.code || '')}"></div>
    <div><label class="f" for="pf-subject">Subject</label><select id="pf-subject" required>${S.subjects.map(s => `<option ${p.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}${p.subject && !S.subjects.includes(p.subject) ? `<option selected>${esc(p.subject)}</option>` : ''}</select></div>
    <div><label class="f" for="pf-title">Title</label><input type="text" id="pf-title" required maxlength="120" value="${esc(p.title || '')}" placeholder="Paper 1 (Non-Calculator)"></div>
    <div><label class="f" for="pf-series">Series</label><select id="pf-series" required>${S.series.map(s => `<option value="${esc(s.id)}" ${p.series_id === s.id ? 'selected' : ''}>${esc(seriesName(s.id))}</option>`).join('')}</select></div>
    <div><label class="f" for="pf-q">Qualification</label><select id="pf-q"><option value="">None</option>${CFG.qualifications.map(q => `<option ${p.qualification === q ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select></div>
    <div><label class="f" for="pf-board">Exam board</label><select id="pf-board"><option value="">None (regular assessment)</option>${CFG.boards.map(b => `<option ${p.board === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
    <div><label class="f" for="pf-tier">Tier</label><select id="pf-tier"><option value="">Untiered</option><option ${p.tier === 'Higher' ? 'selected' : ''}>Higher</option><option ${p.tier === 'Foundation' ? 'selected' : ''}>Foundation</option></select></div>
    <div><label class="f" for="pf-min">Minutes</label><input type="number" id="pf-min" min="1" max="300" required value="${esc(p.minutes || 60)}"></div>
    <div><label class="f" for="pf-calc">Calculator</label><select id="pf-calc"><option value="1" ${p.calculator ? 'selected' : ''}>Allowed</option><option value="0" ${p.calculator ? '' : 'selected'}>Not allowed</option></select></div>
    <div><label class="f" for="pf-lock">Lock on exit number</label><select id="pf-lock"><option value="">Use the default</option>${[1, 2, 3, 4, 5, 6].map(n => `<option ${p.lock_after === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div><label class="f" for="pf-fs">Full screen</label><select id="pf-fs"><option value="">Use the default</option><option value="1" ${p.fullscreen === true ? 'selected' : ''}>On</option><option value="0" ${p.fullscreen === false ? 'selected' : ''}>Off (for young children)</option></select></div>
  </div>
  <label class="f">Year groups</label><div class="yearchips">${CFG.yearGroups.map(y => `<label><input type="checkbox" name="yg" value="${esc(y)}" ${(p.year_groups || []).includes(y) ? 'checked' : ''}>${esc(y)}</label>`).join('')}</div>
  <label class="f" for="pf-file">${id ? 'Replace questions and mark scheme (optional)' : 'Questions and mark scheme'}</label><input type="file" id="pf-file" accept="application/json,.json" ${id ? '' : 'required'}>
  <p class="small muted">A JSON file with "questions" and "scheme", in the same format as the files in the papers folder of the repository. The total marks are worked out from the questions.</p>
  <p id="pf-err" class="err" role="alert"></p>
  <div class="row" style="margin-top:8px"><button class="btn" type="submit">${id ? 'Save changes' : 'Add the paper'}</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div></form>`, true);
}
function validatePaperJson(j) {
  if (!j || !Array.isArray(j.questions) || !j.questions.length) throw new Error('The file has no "questions" list.');
  const ids = new Set(); let total = 0;
  j.questions.forEach((q, i) => {
    if (!q.n || !Array.isArray(q.parts) || !q.parts.length) throw new Error(`Question ${i + 1} needs "n" and a "parts" list.`);
    q.parts.forEach(pt => { if (!pt.id || ids.has(pt.id)) throw new Error(`Each part needs a unique "id" (problem in question ${q.n}).`); ids.add(pt.id);
      if (!(pt.marks > 0 && pt.marks <= 60)) throw new Error(`Part ${pt.id} needs a mark between 1 and 60.`);
      if (pt.type && !['maths', 'short', 'long'].includes(pt.type)) throw new Error(`Part ${pt.id} has an unknown type.`); total += pt.marks; });
  });
  const scheme = Array.isArray(j.scheme) ? j.scheme : (j.scheme && j.scheme.items) || [];
  scheme.forEach(s => { if (!ids.has(s.part)) throw new Error(`The mark scheme mentions part "${s.part}", which isn't in the questions.`); });
  if (JSON.stringify(j).length > 600000) throw new Error('The file is too large.');
  return { content: { equipment: j.equipment || '', instructions: j.instructions || [], information: j.information || [], questions: j.questions }, scheme, total };
}
async function savePaper(form) {
  const id = form.dataset.id, err = $('#pf-err'); err.textContent = '';
  const v = id => ($('#' + id) || {}).value;
  const years = [...document.querySelectorAll('input[name=yg]:checked')].map(x => x.value);
  const row = { code: v('pf-code').trim(), subject: v('pf-subject'), title: v('pf-title').trim(), series_id: v('pf-series'), qualification: v('pf-q') || null, board: v('pf-board') || null,
    tier: v('pf-tier') || null, minutes: +v('pf-min'), calculator: v('pf-calc') === '1', lock_after: v('pf-lock') ? +v('pf-lock') : null,
    fullscreen: v('pf-fs') === '' ? null : v('pf-fs') === '1', year_groups: years, updated_at: new Date().toISOString() };
  let parsed = null; const file = $('#pf-file').files[0];
  try { if (file) { if (file.size > 800000) throw new Error('The file is too large.'); parsed = validatePaperJson(JSON.parse(await file.text())); row.content = parsed.content; row.total_marks = parsed.total; } }
  catch (e) { err.textContent = 'That file can\'t be used: ' + errText(e); return; }
  let error;
  if (id) ({ error } = await sb.from('exam_papers').update(row).eq('id', id));
  else { row.id = v('pf-id').trim(); row.sort = S.papers.length * 10 + 10; ({ error } = await sb.from('exam_papers').insert(row)); }
  if (!error && parsed) ({ error } = await sb.from('exam_schemes').upsert({ paper_id: id || row.id, items: parsed.scheme, updated_at: new Date().toISOString() }, { onConflict: 'paper_id' }));
  if (error) { err.textContent = 'Could not save: ' + errText(error); return; }
  closeDialog(); toast(id ? 'Paper saved.' : 'Paper added.', 2500); await loadStaff();
}

/* results and marking */
async function loadResults() {
  const pid = S.resultsPaper; if (!pid) { S.results = { pid, rows: [] }; return render(); }
  const paper = S.papers.find(p => p.id === pid);
  const { data: at, error } = await sb.from('exam_attempts').select('id,child_id,status,started_at,submitted_at,auto_submitted,extra_time_pct,locked,violations,children(name,grade_level)').eq('paper_id', pid);
  if (error) S.results = { pid, paper, rows: [], err: errText(error) };
  else {
    const ids = (at || []).map(a => a.id), kids = (at || []).map(a => a.child_id);
    const [m, c] = await Promise.all([ids.length ? sb.from('exam_marks').select('attempt_id,total,complete').in('attempt_id', ids) : { data: [] }, kids.length ? sb.from('exam_candidates').select('child_id,candidate_number').in('child_id', kids) : { data: [] }]);
    const mk = {}; (m.data || []).forEach(x => mk[x.attempt_id] = x); const cn = {}; (c.data || []).forEach(x => cn[x.child_id] = x.candidate_number);
    S.results = { pid, paper, rows: (at || []).map(a => ({ a, name: a.children ? a.children.name : 'Student', year: a.children ? a.children.grade_level : '', cand: cn[a.child_id] || '', marks: mk[a.id] || null })).sort((x, y) => x.name.localeCompare(y.name)) };
  }
  if (S.view === 'staff' && S.tab === 'results') render();
}
function resultsView() {
  const R = S.results, tot = R && R.paper ? R.paper.total_marks : 0;
  const marked = R && R.rows ? R.rows.filter(r => r.marks && r.marks.complete) : [];
  const avg = marked.length ? Math.round(marked.reduce((s, r) => s + 100 * r.marks.total / tot, 0) / marked.length) : null;
  return `<div class="main-head"><h1>Results and marking</h1></div>
  <div class="toolbar"><select data-change="resultsPaper" aria-label="Paper" style="min-width:320px">${S.series.map(s => { const ps = S.papers.filter(p => p.series_id === s.id); return ps.length ? `<optgroup label="${esc(seriesName(s.id))}">${ps.map(p => `<option value="${esc(p.id)}" ${p.id === S.resultsPaper ? 'selected' : ''}>${esc(p.code)}: ${esc(p.subject)} ${esc(p.title)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select>
    <button class="btn quiet sm" data-act="copyCsv">Copy results for a spreadsheet</button>${avg != null ? `<span class="muted small">${marked.length} marked, average ${avg}%</span>` : ''}</div>
  ${!R || R.pid !== S.resultsPaper ? '<p class="muted">Loading scripts…</p>' : R.err ? `<p class="err">${esc(R.err)}</p>` : !R.rows.length ? '<div class="empty"><h3>No scripts yet</h3><p class="muted" style="margin:0">Scripts appear here when students start this paper.</p></div>'
  : `<div class="tablebox"><table class="t"><thead><tr><th>Student</th><th>Candidate</th><th>Status</th><th>Handed in</th><th>Exits</th><th>Mark</th><th></th></tr></thead><tbody>${R.rows.map(r => { const a = r.a, ex = (a.violations || []).filter(v => !/Unlocked/.test(v.type)).length;
    return `<tr><td><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.year)}${a.extra_time_pct ? ', +' + a.extra_time_pct + '% time' : ''}</div></td><td>${esc(r.cand)}</td><td>${liveState(a)}</td><td class="small">${esc(when(a.submitted_at))}</td><td>${ex ? `<span class="pill gold">${ex}</span>` : '0'}</td>
      <td>${r.marks ? `<strong>${esc(r.marks.total)}</strong> / ${esc(tot)} (${Math.round(100 * r.marks.total / tot)}%)${r.marks.complete ? '' : ' <span class="pill gold">Part marked</span>'}` : '<span class="muted">Not marked</span>'}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm ${r.marks ? 'quiet' : ''}" data-act="mark" data-id="${esc(a.id)}">${r.marks ? 'Review' : 'Mark'}</button> <button class="btn quiet sm" data-act="log" data-id="${esc(a.id)}">History</button>${isAdmin() ? ` <button class="btn quiet sm" data-act="resetAsk" data-id="${esc(a.id)}">Reset</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`}`;
}
function copyCsv() {
  const R = S.results; if (!R || !R.rows.length) return toast('No results to copy yet.', 2500);
  const q = s => { s = String(s == null ? '' : s); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };   // blocks spreadsheet formula injection
  const lines = [['Name', 'Year', 'Candidate', 'Paper', 'Status', 'Handed in', 'Exits', 'Mark', 'Out of', 'Percent'].map(q).join(',')].concat(R.rows.map(r => [r.name, r.year, r.cand, R.paper.code, r.a.status, r.a.submitted_at || '', (r.a.violations || []).filter(v => !/Unlocked/.test(v.type)).length, r.marks ? r.marks.total : '', R.paper.total_marks, r.marks ? Math.round(100 * r.marks.total / R.paper.total_marks) : ''].map(q).join(',')));
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Copied. Paste into your spreadsheet.', 3000), () => toast('Your browser blocked copying.', 3000));
}
function resetAsk(id) { dialog(`<h2>Reset this sitting?</h2><p>The student's answers are deleted so they can sit the paper again. A copy is kept in the activity log.</p><form data-submit="doReset" data-id="${esc(id)}"><label class="f" for="rr">Reason</label><input type="text" id="rr" required maxlength="300" placeholder="For example: power cut, agreed resit"><div class="row" style="margin-top:16px"><button class="btn danger" type="submit">Reset the sitting</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div></form>`); }
async function doReset(form) { const { error } = await sb.rpc('exam_reset_attempt', { p_attempt: form.dataset.id, p_reason: $('#rr').value.trim() }); closeDialog(); toast(error ? 'Could not reset: ' + errText(error) : 'Sitting reset.', 3000); loadTab(); }
async function openMarking(id) {
  S.view = 'loading'; render();
  const { data: a, error } = await sb.from('exam_attempts').select('*, children(name,grade_level)').eq('id', id).single();
  if (error) return fail('Could not open the script', errText(error), true);
  const [paper, scheme, marks, ph, cand] = await Promise.all([sb.from('exam_papers').select('*').eq('id', a.paper_id).single(), sb.from('exam_schemes').select('items').eq('paper_id', a.paper_id).maybeSingle(), sb.from('exam_marks').select('*').eq('attempt_id', id).maybeSingle(), sb.from('exam_photos').select('*').eq('attempt_id', id).order('created_at'), sb.from('exam_candidates').select('candidate_number').eq('child_id', a.child_id).maybeSingle()]);
  if (paper.error) return fail('Could not open the paper', errText(paper.error), true);
  await signUrls((ph.data || []).map(p => p.storage_path));
  S.marking = { a, paper: paper.data, scheme: (scheme.data && scheme.data.items) || [], photos: ph.data || [], cand: cand.data ? cand.data.candidate_number : '', awarded: Object.assign({}, marks.data && marks.data.awarded), feedback: (marks.data && marks.data.feedback) || '' };
  S.view = 'marking'; render(); window.scrollTo(0, 0);
}
const markTotal = () => partsOf(S.marking.paper.content).reduce((s, { pt }) => s + (+S.marking.awarded[pt.id] || 0), 0);
function renderMarking() {
  const { a, paper, scheme, awarded } = S.marking; const sm = {}; scheme.forEach(it => sm[it.part] = it);
  const ex = (a.violations || []);
  const qs = paper.content.questions.map(q => `<section class="mq"><div class="q"><div class="num">${esc(q.n)}</div><div class="content" style="user-select:text">${q.intro ? `<div class="small">${fmt(q.intro)}</div>` : ''}${qTable(q)}${photoBlock(q.n, false, S.marking.photos, a.id)}${(q.parts || []).map(pt => {
    const x = (a.answers || {})[pt.id] || {}, s = sm[pt.id] || {};
    const stu = pt.type === 'long' ? `<div class="box">${esc(x.t || '') || '<span class="muted">No answer</span>'}</div><div class="small muted">${wc(x.t)} words</div>` : `${pt.type === 'short' ? '' : `<div class="alabel">Working</div><div class="box">${esc(x.w || '') || '<span class="muted">None</span>'}</div>`}<div class="alabel">Answer</div><div class="box"><strong>${esc(x.a || '') || '<span class="muted">No answer</span>'}</strong></div>`;
    return `<div class="part"><div class="stem"><div class="small">${pt.label ? '<strong>' + esc(pt.label) + '</strong> ' : ''}${fmt(pt.text || '')}</div><span class="m">(${esc(pt.marks)})</span></div>
      <div class="split"><div><div class="alabel">Student's answer</div>${stu}</div><div><div class="alabel">Mark scheme</div><div class="box scheme">${s.working ? esc(s.working) + '\n' : ''}<strong>${esc(s.answer || 'No mark scheme for this part')}</strong>${s.codes ? '  ' + esc(s.codes) : ''}${s.notes ? '\n' + esc(s.notes) : ''}</div>
      <div class="row" style="margin-top:10px"><label class="small" for="aw-${esc(pt.id)}"><strong>Marks</strong></label><input type="number" id="aw-${esc(pt.id)}" min="0" max="${esc(pt.marks)}" step="1" style="width:90px" value="${awarded[pt.id] != null ? esc(awarded[pt.id]) : ''}" data-award="1" data-pid="${esc(pt.id)}" data-max="${esc(pt.marks)}"><span class="muted small">out of ${esc(pt.marks)}</span></div></div></div></div>`;
  }).join('')}</div></div></section>`).join('');
  $('#app').innerHTML = header() + `<main class="wrap"><div class="markbar"><button class="btn quiet sm" data-act="backStaff">Back</button><div><h2 style="margin:0">${esc(a.children ? a.children.name : '')} <span class="muted small">${esc(S.marking.cand)}</span></h2><div class="small muted">${esc(paper.code)}: ${esc(paper.subject)} ${esc(paper.title)}. ${a.status === 'submitted' ? 'Handed in ' + esc(when(a.submitted_at)) + (a.auto_submitted ? ' when time ran out' : '') : 'Still writing'}. ${ex.length ? ex.length + ' exits and events' : 'No exits'}.</div></div><div class="spacer"></div><div class="score-chip" id="mt">${markTotal()} / ${esc(paper.total_marks)}</div><button class="btn gold" data-act="saveMarks">Save marks</button><span id="ms" class="small muted" role="status"></span></div>
   ${qs}<section class="mq"><h3>Feedback for the student</h3><p class="muted small">Three next steps work well. Students see this when you release results for the series.</p><textarea id="fb" rows="5" maxlength="4000" data-feedback="1">${esc(S.marking.feedback)}</textarea><div class="row" style="margin-top:12px"><button class="btn gold" data-act="saveMarks">Save marks</button></div></section></main>`;
}
function onAward(el) { const max = +el.dataset.max, v = el.value; const n = v === '' ? null : Math.max(0, Math.min(max, Math.round(+v))); if (n === null) delete S.marking.awarded[el.dataset.pid]; else S.marking.awarded[el.dataset.pid] = n; $('#mt').textContent = markTotal() + ' / ' + S.marking.paper.total_marks; }
async function saveMarks() {
  const M = S.marking, total = markTotal(), left = partsOf(M.paper.content).filter(({ pt }) => M.awarded[pt.id] == null).length;
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from('exam_marks').upsert({ attempt_id: M.a.id, awarded: M.awarded, feedback: M.feedback.slice(0, 4000), total, max: M.paper.total_marks, complete: left === 0, marked_by: u.user.id, marked_at: new Date().toISOString() }, { onConflict: 'attempt_id' });
  if (error) return toast('Could not save the marks: ' + errText(error));
  document.querySelectorAll('#ms').forEach(e => e.textContent = left ? `Saved. ${left} part${left > 1 ? 's' : ''} still to mark.` : 'Saved. Marking complete.');
}

/* students and entries (admin) */
async function loadStudents() {
  const [kids, cands, entries] = await Promise.all([
    sb.from('children').select('id,name,grade_level,meet_email,status,is_test').eq('status', 'active').eq('is_test', false).order('name'),
    sb.from('exam_candidates').select('*'), sb.from('exam_entries').select('*')]);
  if (kids.error) S.students = { err: errText(kids.error) };
  else { const cm = {}; (cands.data || []).forEach(c => cm[c.child_id] = c); const em = {}; (entries.data || []).forEach(e => { (em[e.child_id] = em[e.child_id] || []).push(e); });
    S.students = { rows: (kids.data || []).map(k => ({ k, c: cm[k.id] || null, e: em[k.id] || [] })).sort((x, y) => CFG.yearGroups.indexOf(x.k.grade_level) - CFG.yearGroups.indexOf(y.k.grade_level) || x.k.name.localeCompare(y.k.name)) }; }
  if (S.view === 'staff' && S.tab === 'students') render();
}
function studentsView() {
  const D = S.students; const y = S.studentYear;
  const rows = D && D.rows ? D.rows.filter(r => !y || r.k.grade_level === y) : [];
  return `<div class="main-head"><h1>Students</h1></div>
  <p class="muted">Students sit regular assessments for the subjects their tutors teach them, with no setting up needed. Use this page for candidate numbers, extra time, and mock exam entries (exam board and tier).</p>
  <div class="toolbar"><select data-change="studentYear" aria-label="Year group"><option value="">All years</option>${CFG.yearGroups.map(g => `<option ${y === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
  ${!D ? '<p class="muted">Loading…</p>' : D.err ? `<p class="err">${esc(D.err)}</p>` : `<div class="tablebox"><table class="t"><thead><tr><th>Student</th><th>Google account</th><th>Candidate</th><th>Extra time</th><th>Mock entries</th><th></th></tr></thead><tbody>${rows.map(({ k, c, e }) => `<tr>
    <td><strong>${esc(k.name)}</strong><div class="small muted">${esc(k.grade_level)}</div></td><td class="small">${k.meet_email ? esc(k.meet_email) : '<span class="pill red">Missing</span>'}</td>
    <td>${c ? esc(c.candidate_number) : '<span class="muted small">Given on first paper</span>'}</td>
    <td><select data-change="extra" data-id="${esc(k.id)}" aria-label="Extra time for ${esc(k.name)}" style="min-width:100px">${[0, 10, 25, 50].map(v => `<option value="${v}" ${(c ? c.extra_time_pct : 0) === v ? 'selected' : ''}>${v ? '+' + v + '%' : 'None'}</option>`).join('')}</select></td>
    <td class="small">${e.length ? e.map(x => esc(x.subject + (x.board ? ', ' + x.board : '') + (x.tier ? ', ' + x.tier : ''))).join('<br>') : '<span class="muted">None</span>'}</td>
    <td><button class="btn quiet sm" data-act="entries" data-id="${esc(k.id)}">Mock entries</button></td></tr>`).join('')}</tbody></table></div>`}`;
}
async function ensureCandidate(childId) { const r = S.students.rows.find(x => x.k.id === childId); if (r && r.c) return true; const { error } = await sb.rpc('exam_enrol', { p_child: childId }); if (error) { toast('Could not create a candidate number: ' + errText(error)); return false; } return true; }
async function setExtra(childId, v) { if (!(await ensureCandidate(childId))) return; const { error } = await sb.from('exam_candidates').update({ extra_time_pct: +v, updated_at: new Date().toISOString() }).eq('child_id', childId); toast(error ? 'Could not save: ' + errText(error) : 'Extra time saved. It applies to papers started from now.', 3000); loadStudents(); }
function entriesForm(childId) {
  const r = S.students.rows.find(x => x.k.id === childId); const em = {}; r.e.forEach(x => em[x.subject] = x);
  dialog(`<h2>Mock entries for ${esc(r.k.name)}</h2><p class="muted small">Choose the exam board and tier for each subject this student sits as a mock. Leave a subject as Not entered if they don't sit it.</p>
  <form data-submit="saveEntries" data-id="${esc(childId)}"><div class="tablebox"><table class="t"><thead><tr><th>Subject</th><th>Exam board</th><th>Tier</th></tr></thead><tbody>${S.subjects.map(s => { const x = em[s] || {}; return `<tr><td>${esc(s)}</td>
    <td><select name="board" data-subject="${esc(s)}"><option value="">Not entered</option>${CFG.boards.map(b => `<option ${x.board === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}${em[s] && !x.board ? '<option value="-" selected>Entered, no board</option>' : '<option value="-">Entered, no board</option>'}</select></td>
    <td><select name="tier" data-subject="${esc(s)}"><option value="">Untiered</option><option ${x.tier === 'Higher' ? 'selected' : ''}>Higher</option><option ${x.tier === 'Foundation' ? 'selected' : ''}>Foundation</option></select></td></tr>`; }).join('')}</tbody></table></div>
  <div class="row" style="margin-top:16px"><button class="btn" type="submit">Save entries</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div></form>`, true);
}
async function saveEntries(form) {
  const childId = form.dataset.id; if (!(await ensureCandidate(childId))) return;
  const rows = []; const del = [];
  form.querySelectorAll('select[name=board]').forEach(sel => { const s = sel.dataset.subject; const tier = form.querySelector(`select[name=tier][data-subject="${CSS.escape(s)}"]`).value;
    if (sel.value) rows.push({ child_id: childId, subject: s, board: sel.value === '-' ? null : sel.value, tier: tier || null }); else del.push(s); });
  let error = null;
  if (rows.length) ({ error } = await sb.from('exam_entries').upsert(rows, { onConflict: 'child_id,subject' }));
  if (!error && del.length) ({ error } = await sb.from('exam_entries').delete().eq('child_id', childId).in('subject', del));
  closeDialog(); toast(error ? 'Could not save: ' + errText(error) : 'Entries saved.', 2500); loadStudents();
}

/* assessment calendar (admin) */
function seriesView() {
  const years = [...new Set(S.series.map(s => s.academic_year))];
  const nextYear = (() => { const y = years[0] || '2026/27'; const a = +y.slice(0, 4) + 1; return a + '/' + String(a + 1).slice(2); })();
  return `<div class="main-head"><h1>Assessment calendar</h1><div class="spacer"></div><button class="btn quiet" data-act="addMock">Add a mock series</button><button class="btn quiet" data-act="addYear" data-year="${esc(nextYear)}">Add ${esc(nextYear)} assessments</button></div>
  <p class="muted">Six assessments a year, one every two months, plus mock series. Dates show on students' pages. Release results when marking is finished so students can see their marks and feedback.</p>
  ${years.map(y => `<div class="group-title">${esc(y)}</div><div class="tablebox"><table class="t"><thead><tr><th>Series</th><th>Starts</th><th>Ends</th><th>Papers</th><th>Results</th><th></th></tr></thead><tbody>${S.series.filter(s => s.academic_year === y).map(s => `<tr>
    <td><input type="text" value="${esc(s.name)}" maxlength="80" data-series="${esc(s.id)}" data-field="name" aria-label="Name"><div class="small muted">${s.kind === 'mock' ? 'Mock series' : 'Assessment ' + s.cycle + ' of 6'}</div></td>
    <td><input type="date" value="${esc(s.starts_on || '')}" data-series="${esc(s.id)}" data-field="starts_on" aria-label="Start date"></td><td><input type="date" value="${esc(s.ends_on || '')}" data-series="${esc(s.id)}" data-field="ends_on" aria-label="End date"></td>
    <td>${S.papers.filter(p => p.series_id === s.id).length}</td><td>${s.results_released ? '<span class="pill live">Released</span>' : '<span class="pill bark">Not released</span>'}</td>
    <td style="white-space:nowrap;text-align:right"><button class="btn quiet sm" data-act="saveSeries" data-id="${esc(s.id)}">Save</button> <button class="btn sm ${s.results_released ? 'quiet' : 'gold'}" data-act="release" data-id="${esc(s.id)}" data-v="${s.results_released ? 0 : 1}">${s.results_released ? 'Hide results' : 'Release results'}</button></td></tr>`).join('')}</tbody></table></div>`).join('')}`;
}
async function saveSeries(id) {
  const get = f => (document.querySelector(`[data-series="${CSS.escape(id)}"][data-field="${f}"]`) || {}).value;
  const { error } = await sb.from('exam_series').update({ name: get('name').trim().slice(0, 80), starts_on: get('starts_on') || null, ends_on: get('ends_on') || null, updated_at: new Date().toISOString() }).eq('id', id);
  toast(error ? 'Could not save: ' + errText(error) : 'Saved.', 2500); if (!error) loadStaff();
}
async function release(id, v) { const { error } = await sb.from('exam_series').update({ results_released: v, updated_at: new Date().toISOString() }).eq('id', id); toast(error ? 'Could not change: ' + errText(error) : v ? 'Results released. Students see fully marked papers now.' : 'Results hidden.', 3500); loadStaff(); }
async function addYear(y) { const rows = [1, 2, 3, 4, 5, 6].map(c => ({ name: 'Assessment ' + c, kind: 'assessment', academic_year: y, cycle: c })); const { error } = await sb.from('exam_series').insert(rows); toast(error ? 'Could not add: ' + errText(error) : `${y} assessments added. Set their dates.`, 3500); loadStaff(); }
function addMock() { dialog(`<h2>Add a mock series</h2><form data-submit="saveMock"><label class="f" for="mn">Name</label><input type="text" id="mn" required maxlength="80" placeholder="GCSE Mocks, AQA, March 2027"><label class="f" for="my">Academic year</label><input type="text" id="my" required pattern="\\d{4}/\\d{2}" value="${esc((S.series[0] || {}).academic_year || '2026/27')}"><div class="row" style="margin-top:16px"><button class="btn" type="submit">Add the series</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div></form>`); }
async function saveMock() { const { error } = await sb.from('exam_series').insert({ name: $('#mn').value.trim(), kind: 'mock', academic_year: $('#my').value.trim() }); closeDialog(); toast(error ? 'Could not add: ' + errText(error) : 'Mock series added.', 2500); loadStaff(); }

/* activity log */
async function loadEvents() {
  const { data, error } = await sb.from('exam_events').select('at,kind,detail,ip,paper_id,children(name)').order('at', { ascending: false }).limit(300);
  S.events = error ? { err: errText(error) } : { rows: data || [] };
  if (S.view === 'staff' && S.tab === 'activity') render();
}
function eventsView() {
  const E = S.events;
  return `<div class="main-head"><h1>Activity log</h1><span class="muted small">The latest 300 events. Nobody can edit or delete these.</span></div>
  ${!E ? '<p class="muted">Loading…</p>' : E.err ? `<p class="err">${esc(E.err)}</p>` : `<div class="tablebox"><table class="t"><thead><tr><th>When</th><th>What happened</th><th>Student</th><th>Paper</th><th>Detail</th><th>Network</th></tr></thead><tbody>${E.rows.map(e => `<tr><td class="small">${esc(when(e.at))}</td><td>${esc(EV[e.kind] || e.kind)}</td><td>${esc(e.children ? e.children.name : '')}</td><td class="small">${esc(e.paper_id || '')}</td><td class="small">${esc(evDetail(e))}</td><td class="small muted">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table></div>`}`;
}

/* settings (admin) and account */
function settingsView() {
  const s = S.settings || {};
  return `<div class="main-head"><h1>Settings</h1></div><form class="panel" data-submit="saveSettings" style="max-width:720px">
  <h3>Exam rules</h3>
  <label class="check"><input type="checkbox" id="st-fs" ${s.fullscreen ? 'checked' : ''}><span>Open papers in full screen, and count leaving full screen as an exit</span></label>
  <label class="check" style="margin-top:8px"><input type="checkbox" id="st-paste" ${s.block_paste ? 'checked' : ''}><span>Turn off copying and pasting during papers</span></label>
  <div class="grid-form"><div><label class="f" for="st-lock">Lock a paper on exit number</label><input type="number" id="st-lock" min="1" max="10" value="${esc(s.lock_after)}"></div>
  <div><label class="f" for="st-up">Minutes to add photos after handing in</label><input type="number" id="st-up" min="0" max="60" value="${esc(s.upload_grace_minutes)}"></div>
  <div><label class="f" for="st-max">Most photos per paper</label><input type="number" id="st-max" min="0" max="200" value="${esc(s.max_photos)}"></div></div>
  <p class="small muted">Each paper can change the full screen and lock settings for itself, for example for young children.</p>
  <h3 style="margin-top:22px">Staff sign-in</h3>
  <div class="grid-form"><div><label class="f" for="st-idle">Sign staff out after this many idle minutes</label><input type="number" id="st-idle" min="5" max="240" value="${esc(s.staff_idle_minutes)}"></div></div>
  <label class="check" style="margin-top:12px"><input type="checkbox" id="st-mfa" ${s.require_staff_mfa ? 'checked' : ''}><span>Require two-step sign-in for all tutors and admins. Set it up for yourself first under My sign-in, or you'll be asked for it straight away.</span></label>
  <p id="st-err" class="err" role="alert"></p><div class="row" style="margin-top:14px"><button class="btn" type="submit">Save settings</button></div></form>`;
}
async function saveSettings() {
  const n = id => +$('#' + id).value;
  const v = { fullscreen: $('#st-fs').checked, block_paste: $('#st-paste').checked, lock_after: Math.min(10, Math.max(1, n('st-lock'))), upload_grace_minutes: Math.min(60, Math.max(0, n('st-up'))), max_photos: Math.min(200, Math.max(0, n('st-max'))), staff_idle_minutes: Math.min(240, Math.max(5, n('st-idle'))), require_staff_mfa: $('#st-mfa').checked, updated_at: new Date().toISOString() };
  if (v.require_staff_mfa && !S.settings.require_staff_mfa) {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!data || data.currentLevel !== 'aal2') { $('#st-err').textContent = 'Set up two-step sign-in for yourself under My sign-in first.'; return; }
  }
  const { error } = await sb.from('exam_settings').update(v).eq('id', true);
  if (error) { $('#st-err').textContent = 'Could not save: ' + errText(error); return; }
  Object.assign(S.settings, v); toast('Settings saved.', 2500);
}
function accountView() {
  return `<div class="main-head"><h1>My sign-in</h1></div><div class="panel" style="max-width:640px"><h3>Two-step sign-in</h3><p>Two-step sign-in asks for a code from an app on your phone each time you sign in, so a stolen password isn't enough to get in. ${S.settings && S.settings.require_staff_mfa ? 'It is required for all staff.' : 'An admin can make it required for all staff.'}</p><button class="btn" data-act="setupMfa">Set up or check two-step sign-in</button></div>`;
}

/* ---------------- event wiring (no inline handlers) ---------------- */
const ACT = {
  signout: () => signOut(), reload: () => location.reload(), google: () => googleSignIn(), close: () => closeDialog(),
  home: async () => { stop('tick'); stop('beat'); S.exam = null; S.view = 'home'; await loadDash(); render(); every('dash', 15000, async () => { if (S.view === 'home' || S.view === 'phone') { await loadDash(); render(); } }); },
  intro: el => { S.intro = S.dash.papers.find(p => p.id === el.dataset.id); if (S.intro) { S.view = 'intro'; render(); window.scrollTo(0, 0); } },
  resume: el => { const p = S.dash.papers.find(x => x.attempt && x.attempt.id === el.dataset.id); S.intro = p; if (p && (p.rules || {}).fullscreen) goFullscreen(); openAttempt(el.dataset.id); },
  start: () => startPaper(), go: el => go(+el.dataset.n), flag: () => flag(), askHandIn: () => askHandIn(), handIn: () => { closeDialog(); handIn(false); }, backToExam: () => backToExam(),
  phone: () => { S.view = 'phone'; render(); }, phonePaper: el => { S.phonePaper = el.dataset.id; loadPhonePhotos(); },
  phoneAdd: el => { const q = ($('#pq').value || '').trim(); if (!q) { toast('Type the question number first.'); return; } pickPhoto(el.dataset.att, q); },
  pickPhoto: el => pickPhoto(el.dataset.att, el.dataset.q), removePhoto: (el, e) => { e.stopPropagation(); removePhoto(el.dataset.photo, el.dataset.att); }, zoom: el => zoom(el.dataset.path),
  tab: el => { if (S.view !== 'staff') { S.view = 'staff'; } setTab(el.dataset.tab); }, backStaff: () => { S.view = 'staff'; render(); loadTab(); },
  unlock: el => unlockAsk(el.dataset.id), doUnlock: el => doUnlock(el.dataset.id), extend: el => extendAsk(el.dataset.id), log: el => showLog(el.dataset.id),
  openAsk: el => openAsk(el.dataset.id), closeAsk: el => closeAsk(el.dataset.id), setOpen: el => setOpen(el.dataset.id, el.dataset.open === '1'), preview: el => preview(el.dataset.id), paperForm: el => paperForm(el.dataset.id),
  mark: el => openMarking(el.dataset.id), saveMarks: () => saveMarks(), copyCsv: () => copyCsv(), resetAsk: el => resetAsk(el.dataset.id),
  entries: el => entriesForm(el.dataset.id), saveSeries: el => saveSeries(el.dataset.id), release: el => release(el.dataset.id, el.dataset.v === '1'), addYear: el => addYear(el.dataset.year), addMock: () => addMock(),
  setupMfa: () => { S.view = 'mfa'; renderMfa(true); }
};
const SUBMIT = { staffSignIn, mfaVerify, doExtend, savePaper, doReset, saveEntries, saveMock, saveSettings };
const CHANGE = {
  filter: el => { S.filters[el.dataset.key] = el.value; render(); }, resultsPaper: el => { S.resultsPaper = el.value; S.results = null; render(); loadResults(); },
  studentYear: el => { S.studentYear = el.value; render(); }, extra: el => setExtra(el.dataset.id, el.value)
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); f(el, e); } });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('span[data-act]')) { e.preventDefault(); e.target.click(); } if (e.key === 'Escape' && $('#overlay .scrim')) closeDialog(); });
document.addEventListener('submit', e => { const f = SUBMIT[e.target.dataset.submit]; if (f) { e.preventDefault(); f(e.target); } });
document.addEventListener('input', e => { const t = e.target; if (t.dataset.ans && S.exam) onAnswer(t); else if (t.dataset.award && S.marking) onAward(t); else if (t.dataset.feedback && S.marking) S.marking.feedback = t.value; });
document.addEventListener('change', e => { const f = CHANGE[e.target.dataset.change]; if (f) f(e.target); });
sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT' && S.view !== 'login') { stopAll(); S.me = null; S.exam = null; S.view = 'login'; render(); } });

(async function boot() {
  render();
  const { data } = await sb.auth.getSession();
  if (!data.session) { S.view = 'login'; return render(); }
  await afterSignIn();
})();
})();
