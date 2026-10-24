/* =========================================================
   交流ジョブ診断 — 画面とロジック
   内容はすべて data.js（window.JOB_QUIZ）から読みます。
   流れ：タイトル → 性別 → 前半8問（採点）→ 後半5問（採点しない）→ お名前・送信 → 解析 → 結果
   ========================================================= */
(() => {
  'use strict';

  const D = window.JOB_QUIZ;
  const JOBS = D.jobs;
  const JOB = Object.fromEntries(JOBS.map(j => [j.id, j]));
  const GENDER = Object.fromEntries(D.genders.map(g => [g.id, g]));
  const SQ = D.questions;          // 前半：交流スタイル（採点する）
  const PQ = D.profileQuestions;   // 後半：仕事・人脈（採点しない）
  const STEPS = [...SQ.map(q => ({ part: 'style', q })), ...PQ.map(q => ({ part: 'profile', q }))];
  const TOTAL = STEPS.length;
  const charaSrc = (gender, no) => `images/chara/${GENDER[gender].dir}/${no}.jpg`;
  const LETTERS = 'ABCDEFGHIJKLMNOP';
  const STORE_KEY = 'koryu-job:v2';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = s => esc(s).replace(/\n/g, '<br>');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // 「調和の風水士」→ ['調和の', '風水士']
  const crown = name => { const k = name.indexOf('の'); return k < 0 ? ['', name] : [name.slice(0, k + 1), name.slice(k + 1)]; };
  const emblem = (job, cls = '') =>
    `<svg class="emblem ${cls}" viewBox="0 0 48 48" aria-hidden="true" style="--c:${job.color};--ink:${job.ink}"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${job.emblem}</g></svg>`;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  /* ---------- state ---------- */
  const emptyProfile = () => Object.fromEntries(PQ.map(q => [q.id, { choices: [], fields: {} }]));
  const state = {
    gender: null, i: 0, locked: false,
    style: Array(SQ.length).fill(null),   // 前半：選んだ選択肢の番号（data.js の並び）
    profile: emptyProfile(),               // 後半：{ choices: [選択肢ID], fields: { 入力欄ID: 文字 } }
    order: [], name: '', email: '',
    responseId: null, record: null, save: 'idle', sending: false, result: null
  };

  function setGender(id) { state.gender = id; }

  function shuffled(n) {
    const a = [...Array(n).keys()];
    if (!D.shuffleChoices) return a;
    for (let k = n - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [a[k], a[r]] = [a[r], a[k]]; }
    return a;
  }

  /* ---------- scoring（前半8問だけ） ----------
     同点のときの決め方はここだけで定義し、保存データにも記録します。
       1) 点数が高い順
       2) 同点なら、そのタイプを最初に選んだ質問が早い順（一度も選ばれていなければ後ろ）
       3) それでも同点なら data.js の jobs の並び順                                     */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const TIE_BREAK_RULE = 'score_desc > earliest_answered_question > jobs_order';

  function compute(types, gender) {
    const counts = Object.fromEntries(JOBS.map(j => [j.id, 0]));
    const firstAt = Object.fromEntries(JOBS.map(j => [j.id, Infinity]));
    types.forEach((t, qi) => { if (t && t in counts) { counts[t]++; if (firstAt[t] === Infinity) firstAt[t] = qi; } });
    const total = types.filter(Boolean).length || 1;

    const ranked = JOBS.map((job, order) => ({ job, order, count: counts[job.id] }))
      .sort((a, b) => b.count - a.count || firstAt[a.job.id] - firstAt[b.job.id] || a.order - b.order)
      .map(r => ({ ...r, pct: Math.round(r.count / total * 100), stat: D.scoring.stat(r.count, total) }));

    const main = ranked[0].job, sub = ranked[1].job;
    const tieApplied = ranked[0].count === ranked[1].count || ranked[1].count === ranked[2].count;
    const t = D.titles[main.id][sub.id];
    const title = { no: t.no, name: t.name, kana: t.kana, ...t[gender], img: charaSrc(gender, t.no) };
    return { ranked, counts, main, sub, tieApplied, low: ranked[ranked.length - 1].job, title };
  }

  const styleTypes = () => state.style.map((ci, k) => (ci == null ? null : SQ[k].choices[ci].job));

  /* ---------- 保存する1件分のデータ ----------
     交流スタイル（style）と、仕事・人脈の情報（profile）は分けて持ちます。
     将来のマッチングは、この record を読む別のロジックとして追加できます。          */
  function buildRecord(r) {
    const profile = {};
    PQ.forEach(q => {
      const a = state.profile[q.id];
      const pick = a.choices.map(id => q.choices.find(c => c.id === id)).filter(Boolean);
      const entry = q.type === 'multi'
        ? { choiceIds: pick.map(c => c.id), labels: pick.map(c => c.text) }
        : { choiceId: pick[0] ? pick[0].id : null, label: pick[0] ? pick[0].text : null };
      (q.fields || []).forEach(f => {
        const visible = !f.showIf || a.choices.includes(f.showIf);
        entry[f.id] = visible ? (a.fields[f.id] || '').trim().slice(0, f.max || 400) : '';
      });
      profile[q.id] = entry;
    });
    return {
      schemaVersion: D.submit.schemaVersion,
      responseId: state.responseId,
      submittedAt: new Date().toISOString(),
      name: state.name,
      email: state.email,
      gender: state.gender,
      style: {
        answers: SQ.map((q, k) => {
          const c = q.choices[state.style[k]];
          return { questionId: q.id, choiceId: c.job, label: c.text };
        }),
        scores: r.counts,
        mainType: r.main.id,
        subType: r.sub.id,
        title: r.title.name,
        tieBreakRule: TIE_BREAK_RULE,
        tieApplied: r.tieApplied
      },
      profile
    };
  }

  /* ---------- 送信（Google Apps Script のウェブアプリ） ---------- */
  async function sendRecord(record) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(D.submit.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // プリフライトを起こさない形
        body: JSON.stringify(record),
        signal: ctrl.signal
      });
      const body = await res.json().catch(() => null);
      return !!(res.ok && body && body.ok);
    } catch { return false; }
    finally { clearTimeout(timer); }
  }

  /* ---------- screens ---------- */
  const SCENE = { title: 'title', gender: 'title', quiz: 'quiz', submit: 'quiz', analyze: 'analyze', result: 'result' };
  function show(name, focusSel) {
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === `screen-${name}`));
    document.body.dataset.scene = SCENE[name];
    window.scrollTo(0, 0);
    if (focusSel) { const el = $(focusSel); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------- title ---------- */
  function renderTitle() {
    $$('[data-slot="disclaimer"]').forEach(el => { el.textContent = D.meta.disclaimer; });
    $$('[data-slot="lv"]').forEach(el => { el.textContent = D.meta.level.lv; });
    $$('[data-slot="total"]').forEach(el => { el.textContent = TOTAL; });
    $('#partyRoll').innerHTML = JOBS.map(j => `
      <li style="--c:${j.color}">
        ${emblem(j)}
        <span class="party-roll__ja">${esc(j.intro)}</span>
        <span class="party-roll__en en">${esc(j.id)}</span>
      </li>`).join('');
    $('#genderPick').innerHTML = D.genders.map(g => `
      <li><button class="gcard" type="button" data-gender="${g.id}">
        <span class="gcard__img"><img src="${charaSrc(g.id, g.preview)}" alt="" width="640" height="853" loading="lazy"></span>
        <span class="gcard__en en">${esc(g.en)}</span>
        <span class="gcard__ja">${esc(g.label)}</span>
      </button></li>`).join('');
    $('#nameInput').maxLength = D.submit.nameMax;
    $('#emailInput').maxLength = D.submit.emailMax;
    $('#submitNotice').textContent = D.submit.notice;
    const last = store.get();
    $('#resumeBtn').hidden = !(last && last.record && GENDER[last.record.gender]);
  }

  function start() {
    state.i = 0;
    state.style = Array(SQ.length).fill(null);
    state.profile = emptyProfile();
    state.order = SQ.map(q => shuffled(q.choices.length));
    state.responseId = null; state.record = null; state.save = 'idle';
    $('#pips').innerHTML = '';
    renderQuestion('fwd');
    show('quiz', '#qText');
  }

  /* ---------- quiz ---------- */
  const isAnswered = k => {
    const s = STEPS[k];
    if (s.part === 'style') return state.style[k] != null;
    return state.profile[s.q.id].choices.length > 0;
  };

  function renderPips() {
    const pips = $('#pips');
    if (!pips.children.length) {
      pips.style.setProperty('--n', TOTAL);
      pips.innerHTML = STEPS.map(s => `<span class="pip${s.part === 'profile' ? ' pip--profile' : ''}"></span>`).join('');
    }
    [...pips.children].forEach((p, k) => {
      p.classList.toggle('is-done', isAnswered(k) && k !== state.i);
      p.classList.toggle('is-current', k === state.i);
    });
    pips.setAttribute('aria-valuemax', String(TOTAL));
    pips.setAttribute('aria-valuenow', String(STEPS.filter((_, k) => isAnswered(k)).length));
  }

  function renderQuestion(dir) {
    const step = STEPS[state.i], q = step.q;
    const profile = step.part === 'profile';
    $('#hudCount').innerHTML = `QUESTION <b>${pad(state.i + 1)}</b> <span>/ ${pad(TOTAL)}</span>`;
    $('#qLabel').innerHTML = `QUESTION ${pad(state.i + 1)}${profile ? '<span class="qcard__part">仕事・人脈について</span>' : ''}`;
    $('#qText').innerHTML = lines(q.text);
    $('#qHint').innerHTML = profile
      ? `${q.hint ? esc(q.hint) + '<br>' : (q.type === 'single' ? '1つ選んでください<br>' : '')}<small>この質問は診断の点数には入りません</small>`
      : '';
    $('#qHint').hidden = !profile;

    if (profile) {
      const a = state.profile[q.id];
      $('#choices').innerHTML = q.choices.map((c, pos) => {
        const on = a.choices.includes(c.id);
        return `<li><button class="choice choice--${q.type}${on ? ' is-selected' : ''}" type="button" data-cid="${esc(c.id)}" aria-pressed="${on}">
          <span class="choice__mark en">${q.type === 'multi' ? '' : LETTERS[pos]}</span>
          <span class="choice__text">${esc(c.text)}</span>
        </button></li>`;
      }).join('');
      $('#pfields').innerHTML = (q.fields || []).map(f => {
        const v = esc(a.fields[f.id] || '');
        const input = f.type === 'textarea'
          ? `<textarea id="pf-${f.id}" data-fid="${f.id}" maxlength="${f.max || 400}" rows="3" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`
          : `<input id="pf-${f.id}" data-fid="${f.id}" type="text" maxlength="${f.max || 100}" value="${v}" placeholder="${esc(f.placeholder || '')}">`;
        return `<div class="pfield" data-show-if="${esc(f.showIf || '')}"><label for="pf-${f.id}">${esc(f.label)}<span>任意</span></label>${input}</div>`;
      }).join('');
      syncProfileUI();
    } else {
      $('#choices').innerHTML = state.order[state.i].map((ci, pos) => {
        const on = state.style[state.i] === ci;
        return `<li><button class="choice${on ? ' is-selected' : ''}" type="button" data-ci="${ci}" aria-pressed="${on}">
          <span class="choice__mark en">${LETTERS[pos]}</span>
          <span class="choice__text">${esc(q.choices[ci].text)}</span>
        </button></li>`;
      }).join('');
      $('#pfields').innerHTML = '';
    }
    $('#pfields').hidden = !profile;
    $('#qNext').hidden = !profile;
    $('#qErr').textContent = '';
    $('.quiz__hint').hidden = profile;
    renderPips();

    const box = $('#qbox');
    box.classList.remove('enter-fwd', 'enter-back');
    void box.offsetWidth;
    box.classList.add(dir === 'back' ? 'enter-back' : 'enter-fwd');
  }

  // 後半：選択状態・「その他」入力欄の表示・次へボタンを揃える
  function syncProfileUI() {
    const q = STEPS[state.i].q, a = state.profile[q.id];
    $$('#choices .choice').forEach(b => {
      const on = a.choices.includes(b.dataset.cid);
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('#pfields .pfield').forEach(el => { el.hidden = !!el.dataset.showIf && !a.choices.includes(el.dataset.showIf); });
    $('#nextBtn').textContent = state.i === TOTAL - 1 ? '次へ（最後にお名前）' : '次へ';
    $('#nextBtn').setAttribute('aria-disabled', String(!a.choices.length));
    if (a.choices.length) $('#qErr').textContent = '';
    renderPips();
  }

  function toggleProfile(cid) {
    const q = STEPS[state.i].q, a = state.profile[q.id];
    const c = q.choices.find(x => x.id === cid); if (!c) return;
    if (q.type === 'single') a.choices = [cid];
    else if (a.choices.includes(cid)) a.choices = a.choices.filter(x => x !== cid);
    else if (c.exclusive) a.choices = [cid];   // 「特になし」は単独で
    else a.choices = [...a.choices.filter(x => !(q.choices.find(y => y.id === x) || {}).exclusive), cid];
    syncProfileUI();
  }

  function next() {
    const q = STEPS[state.i].q;
    if (!state.profile[q.id].choices.length) {
      $('#qErr').textContent = q.type === 'multi' ? '1つ以上選んでください。' : '1つ選んでください。';
      return;
    }
    if (state.i < TOTAL - 1) { state.i++; renderQuestion('fwd'); $('#qText').focus({ preventScroll: true }); }
    else openSubmit();
  }

  async function choose(ci) {
    if (state.locked) return;
    state.locked = true;
    state.style[state.i] = ci;
    $$('#choices .choice').forEach(b => {
      const on = Number(b.dataset.ci) === ci;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderPips();
    await wait(reduce ? 120 : 380);
    state.i++;
    renderQuestion('fwd');
    $('#qText').focus({ preventScroll: true });
    state.locked = false;
  }

  function back() {
    if (state.locked) return;
    if (state.i === 0) { show('gender', '#genderHeading'); return; }
    state.i--;
    renderQuestion('back');
    $('#qText').focus({ preventScroll: true });
  }

  /* ---------- お名前と送信 ---------- */
  function openSubmit() {
    $('#nameInput').value = state.name;
    $('#emailInput').value = state.email;
    setSubmitStatus(state.save === 'failed' ? 'failed' : 'idle');
    show('submit', '#submitHeading');
  }

  function setSubmitStatus(s, msg) {
    const el = $('#submitStatus');
    el.dataset.state = s;
    el.textContent = msg || {
      idle: '',
      sending: '送信しています……（数秒かかることがあります）',
      failed: '回答を送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。入力した内容は残っています。'
    }[s] || '';
    $('#submitBtn').disabled = s === 'sending';
    $('#submitBtn .btn__ja').textContent = s === 'sending' ? '送信中……' : s === 'failed' ? 'もう一度送信する' : '送信して結果を見る';
    $('#skipSendBtn').hidden = s !== 'failed';
  }

  async function submit() {
    if (state.sending) return;   // 二重送信を防ぐ
    const name = $('#nameInput').value.trim();
    state.name = name;
    if (!name) { setSubmitStatus('idle', 'お名前を入力してください。'); $('#nameInput').focus(); return; }
    // 全角の＠や英数字は半角にそろえる
    const email = $('#emailInput').value.normalize('NFKC').replace(/\s+/g, '');
    $('#emailInput').value = email;
    state.email = email;
    if (!email) { setSubmitStatus('idle', 'メールアドレスを入力してください。'); $('#emailInput').focus(); return; }
    if (!EMAIL_RE.test(email)) { setSubmitStatus('idle', 'メールアドレスの形式をご確認ください（例：hanako@example.com）。'); $('#emailInput').focus(); return; }

    const r = compute(styleTypes(), state.gender);
    if (!state.responseId) state.responseId = uuid();   // 再送しても同じIDで1件として扱う
    state.record = buildRecord(r);

    if (!D.submit.endpoint) { state.save = 'unconfigured'; return analyze(r); }

    state.sending = true;
    setSubmitStatus('sending');
    const ok = await sendRecord(state.record);
    state.sending = false;
    state.save = ok ? 'saved' : 'failed';
    if (ok) { setSubmitStatus('idle'); return analyze(r); }
    setSubmitStatus('failed');
    persist();
  }

  async function resend() {
    if (state.sending || !state.record || !D.submit.endpoint) return;
    state.sending = true;
    renderSaveNote('sending');
    const ok = await sendRecord(state.record);
    state.sending = false;
    state.save = ok ? 'saved' : 'failed';
    renderSaveNote(state.save);
    persist();
  }

  function persist() { store.set({ record: state.record, save: state.save }); }

  /* ---------- analyze（1〜2秒） ---------- */
  async function analyze(r) {
    state.result = r;
    persist();
    new Image().src = r.title.img;   // 解析演出のあいだに読み込んでおく

    const steps = [
      '交流ジョブを解析中……',
      'あなたの能力値を分析',
      `MAIN JOB 解放 — <b class="en">${esc(r.main.id)}</b>`,
      `SUB JOB 解放 — <b class="en">${esc(r.sub.id)}</b>`
    ];
    $('#anLines').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    show('analyze');
    const dt = reduce ? 60 : 330;
    for (const li of $$('#anLines li')) { li.classList.add('is-on'); await wait(dt); }
    await wait(reduce ? 80 : 420);

    renderResult(r);
    show('result', '#resultHeading');
  }

  // 結果画面の上に出す、保存の状態
  function renderSaveNote(s) {
    const el = $('#saveNote'); if (!el) return;
    el.dataset.state = s;
    el.innerHTML = {
      saved: '回答を運営事務局へ送信しました。',
      sending: '回答を送信しています……',
      failed: '回答を送信できませんでした。<button class="btn btn--ghost btn--sm" type="button" data-act="resend">もう一度送信する</button>',
      unconfigured: '回答の送信先が設定されていないため、この回答は保存されていません。'
    }[s] || '';
    el.hidden = !el.innerHTML;
  }

  /* ---------- result ---------- */
  const STARS = '★★★★★★★★★★';
  function statusRows(r, highlight = true) {
    return r.ranked.map((row, k) => `
      <li class="stat${highlight && row.job === r.main ? ' is-main' : ''}${highlight && row.job === r.sub ? ' is-sub' : ''}" style="--c:${row.job.color};--ink:${row.job.ink};--v:${row.stat};--d:${k * 90}ms">
        ${emblem(row.job, 'emblem--sm')}
        <span class="stat__name"><b class="en">${esc(row.job.id)}</b><small>${esc(row.job.ja)}</small></span>
        <span class="stars" aria-hidden="true"><span class="stars__base">${STARS}</span><span class="stars__fill">${STARS}</span></span>
        <span class="stat__val en" aria-label="能力値 ${row.stat}">${row.stat}</span>
        <span class="stat__pct">傾向値 <b class="en">${row.pct}%</b></span>
      </li>`).join('');
  }

  function jobPlate(job, kind, power) {
    return `
      <div class="plate plate--${kind.toLowerCase()}" style="--c:${job.color};--ink:${job.ink}">
        <p class="plate__kind en">${kind} JOB</p>
        <div class="plate__emblem">${emblem(job)}</div>
        <p class="plate__name en">${esc(job.id)}</p>
        <p class="plate__ja">${esc(job.ja)} <span>/ ${esc(job.cls)}</span></p>
        <p class="plate__power">「${esc(power)}」</p>
      </div>`;
  }

  function renderResult(r) {
    const { main, sub, title, low } = r;
    const pq = D.partyQuest;

    $('#result').innerHTML = `
      <header class="unlock reveal" style="--d:0ms">
        <p class="unlock__en en">QUEST CLEAR</p>
        <p class="unlock__ja" id="resultHeading" tabindex="-1">交流ジョブが解放されました！</p>
      </header>
      <p class="save-note" id="saveNote" role="status" hidden></p>

      <article class="sheet reveal" style="--d:120ms" aria-label="ステータス">
        <div class="sheet__top">
          <p class="sheet__kicker en">YOUR STATUS<span>NETWORK PLAYER</span></p>
          <p class="sheet__lv"><b class="en">${esc(D.meta.level.lv)}</b>${esc(D.meta.level.name)}</p>
        </div>

        <div class="epithet">
          <p class="epithet__label">二つ名</p>
          <h2 class="epithet__name" style="--len:${crown(title.name)[1].length}"><span class="epithet__crown">${esc(crown(title.name)[0])}</span><span class="epithet__core">${esc(crown(title.name)[1])}</span></h2>
          ${title.kana ? `<p class="epithet__kana">（${esc(title.kana)}）</p>` : ''}
          <figure class="chara"><img src="${esc(title.img)}" alt="${esc(title.name)}のキャラクター" width="640" height="853"></figure>
          <p class="epithet__copy">${esc(title.copy)}</p>
        </div>

        <div class="plates">
          ${jobPlate(main, 'MAIN', main.power)}
          ${jobPlate(sub, 'SUB', sub.subPower)}
        </div>

        <div class="status">
          <p class="status__h en">STATUS</p>
          <ol class="stats">${statusRows(r)}</ol>
          <p class="status__note">数値は「今回の回答における傾向値」です。あなたの人格や能力の優劣を表すものではありません。</p>
        </div>

        <p class="sheet__foot">${esc(D.meta.event)}</p>
      </article>

      <div class="actions reveal" style="--d:240ms">
        <button class="btn btn--primary" type="button" data-act="share">
          <span class="btn__ja">診断結果を保存・シェア</span>
        </button>
        <p class="actions__hint">会場で、この画面を見せ合ってみてください。</p>
      </div>

      <section class="block" aria-labelledby="h-trait">
        <p class="block__en en">PROFILE</p>
        <h3 class="block__h" id="h-trait">あなたの特徴</h3>
        <div class="trait"><p class="trait__k">${esc(title.name)}の特性</p><p class="trait__p">${esc(title.trait)}</p></div>
        <p class="block__p">${esc(main.desc)}</p>
        <p class="block__p block__p--sub">さらに SUB JOB の <b class="en" style="color:${sub.color}">${esc(sub.id)}</b> として、「${esc(sub.subPower)}」も使いやすいタイプです。</p>
      </section>

      <section class="block" aria-labelledby="h-skill">
        <p class="block__en en">SPECIAL SKILL</p>
        <h3 class="block__h" id="h-skill">あなたの特殊能力</h3>
        <div class="skill" style="--c:${main.color}">
          ${emblem(main)}
          <div><p class="skill__name">${esc(main.skill.name)}</p><p class="skill__text">${esc(main.skill.text)}</p></div>
        </div>
        <div class="skill skill--sub" style="--c:${sub.color}">
          ${emblem(sub)}
          <div><p class="skill__kind en">SUB SKILL</p><p class="skill__name">${esc(sub.skill.name)}</p><p class="skill__text">${esc(sub.skill.text)}</p></div>
        </div>
      </section>

      <section class="block" aria-labelledby="h-play">
        <p class="block__en en">HOW TO PLAY</p>
        <h3 class="block__h" id="h-play">交流会での役立ち方</h3>
        <p class="block__p">${esc(title.play)}</p>
      </section>

      <section class="block quest" aria-labelledby="h-quest">
        <p class="block__en en">QUEST</p>
        <h3 class="block__h" id="h-quest">今日の交流ミッション</h3>
        <ol class="quest__list">
          <li><span class="quest__tag en">MAIN QUEST</span><p>${esc(main.quest)}</p></li>
          <li><span class="quest__tag en">PARTY QUEST</span><p>${esc(pq.text)}</p>
            <p class="quest__hint">${esc(pq.hint).replace('{low}', `<b class="en" style="color:${low.color}">${esc(low.id)}</b>`)}</p></li>
        </ol>
      </section>

      <section class="block party" aria-labelledby="h-party">
        <p class="block__en en">THE PARTY</p>
        <h3 class="block__h" id="h-party">5つのジョブが揃って、<br class="sp">はじめて強いパーティーになる。</h3>
        <p class="block__p">どのジョブが優れている、ということはありません。会場で、ほかの人のジョブを聞いてみてください。同じジョブの人とは「わかる！」が、違うジョブの人とは「なるほど」が生まれます。</p>
        <ul class="party__grid">
          ${JOBS.map(j => {
            const tag = j === main ? 'YOU · MAIN' : j === sub ? 'YOU · SUB' : 'FIND';
            return `<li class="pcard${j === main || j === sub ? ' is-you' : ''}" style="--c:${j.color}">
              <div class="pcard__head">${emblem(j)}<div><p class="pcard__name en">${esc(j.id)}</p><p class="pcard__ja">${esc(j.ja)} / ${esc(j.cls)}</p></div><span class="pcard__tag en">${tag}</span></div>
              <p class="pcard__party">${esc(j.party)}</p>
              <p class="pcard__meet">${j === main || j === sub ? 'あなたの力' : 'この人と話すと'}：${esc(j === main || j === sub ? (j === main ? j.power : j.subPower) + '。' : j.meet)}</p>
            </li>`;
          }).join('')}
        </ul>
      </section>

      <section class="cta">
        <p class="cta__concept">${esc(D.meta.concept)}</p>
        <p class="cta__lead">${esc(D.cta.lead)}</p>
        <a class="btn btn--primary btn--wide" href="${esc(D.cta.href)}"${/^https?:/.test(D.cta.href) ? ' target="_blank" rel="noopener"' : ''}>
          <span class="btn__ja">${esc(D.cta.label)}</span>
        </a>
        <div class="cta__sub">
          <button class="btn btn--ghost btn--sm" type="button" data-act="share">結果カードを保存</button>
          <button class="btn btn--text btn--sm" type="button" data-act="retry">もう一度診断する</button>
        </div>
        <p class="note">${esc(D.meta.disclaimer)}</p>
      </section>`;

    renderSaveNote(state.save);
    if (!reduce) requestAnimationFrame(() => $('#result').classList.add('is-in'));
    else $('#result').classList.add('is-in');
  }

  /* =========================================================
     結果カード（1080×1920 の縦長画像）
     ========================================================= */
  const IMG = {};
  function loadImg(key, src) {
    if (IMG[key]) return IMG[key];
    IMG[key] = new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    return IMG[key];
  }
  function emblemImg(job, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="192" height="192"><g fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${job.emblem}</g></svg>`;
    return loadImg(`em-${job.id}-${color}`, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }
  // 羊皮紙の飾り枠を崩さずに伸ばす（9分割）
  function nine(ctx, img, x, y, w, h, s, d) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sx = [0, s, iw - s, iw], sy = [0, s, ih - s, ih];
    const dx = [x, x + d, x + w - d, x + w], dy = [y, y + d, y + h - d, y + h];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      ctx.drawImage(img, sx[c], sy[r], sx[c + 1] - sx[c], sy[r + 1] - sy[r], dx[c], dy[r], dx[c + 1] - dx[c], dy[r + 1] - dy[r]);
  }
  function fitFont(ctx, text, weight, family, size, maxW) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 20);
  }
  function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

  async function drawCard(r) {
    const W = 1080, H = 1920;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const MIN = '"Shippori Mincho", "Yu Mincho", serif';
    const SANS = '"Noto Sans JP", sans-serif';
    const EN = 'Cinzel, serif';
    const { main, sub, title } = r;

    const allText = [D.meta.event, title.name, title.kana, title.copy, main.ja, sub.ja, main.cls, sub.cls, D.meta.level.name, D.meta.concept, '傾向値二つ名今回の回答における', ...r.ranked.map(x => x.job.ja)].join('');
    await Promise.all([
      document.fonts.load(`700 80px ${MIN}`, allText), document.fonts.load(`500 30px ${MIN}`, allText),
      document.fonts.load(`500 28px ${SANS}`, allText), document.fonts.load(`700 40px ${EN}`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.·%')
    ]).catch(() => {});
    const [tome, parch, chara, ...ems] = await Promise.all([
      loadImg('tome', 'images/tome.jpg'), loadImg('parch', 'images/parchment.jpg'), loadImg(title.img, title.img),
      ...r.ranked.map(x => emblemImg(x.job, x.job.ink))
    ]);

    // 背景
    ctx.fillStyle = '#0b0907'; ctx.fillRect(0, 0, W, H);
    const sc = Math.max(W / tome.naturalWidth, H / tome.naturalHeight);
    ctx.globalAlpha = .5;
    ctx.drawImage(tome, (W - tome.naturalWidth * sc) / 2, (H - tome.naturalHeight * sc) / 2, tome.naturalWidth * sc, tome.naturalHeight * sc);
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(11,9,7,.55)'); g.addColorStop(.5, 'rgba(11,9,7,.2)'); g.addColorStop(1, 'rgba(11,9,7,.8)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // ヘッダー
    ctx.fillStyle = '#cfae6b'; spaced(ctx, 10); ctx.font = `600 26px ${EN}`;
    ctx.fillText('NETWORKING JOB QUEST', W / 2, 108);
    spaced(ctx, 4); ctx.fillStyle = '#efe6d4'; ctx.font = `600 38px ${MIN}`;
    ctx.fillText(D.meta.event, W / 2, 166);

    // 羊皮紙
    const px = 56, py = 210, pw = W - px * 2, ph = 1560;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#c9a77a'; ctx.fillRect(px + 20, py + 20, pw - 40, ph - 40); ctx.restore();
    nine(ctx, parch, px, py, pw, ph, 150, 120);

    const INK = '#2b2117', INK2 = '#5d4c38', INK3 = '#87735a';
    spaced(ctx, 8); ctx.fillStyle = INK2; ctx.font = `600 22px ${EN}`;
    ctx.fillText('YOUR STATUS  ·  NETWORK PLAYER', W / 2, 330);
    spaced(ctx, 2); ctx.font = `500 24px ${MIN}`; ctx.fillStyle = INK3;
    ctx.fillText(`${D.meta.level.lv}  ${D.meta.level.name}`, W / 2, 370);

    // 二つ名
    const [crw, core] = crown(title.name);
    spaced(ctx, 6); ctx.fillStyle = INK2; ctx.font = `600 32px ${MIN}`; ctx.fillText(crw, W / 2, 432);
    spaced(ctx, 4); ctx.fillStyle = INK; fitFont(ctx, core, 700, MIN, 76, pw - 200);
    ctx.fillText(core, W / 2, 516);
    if (title.kana) { spaced(ctx, 4); ctx.fillStyle = INK3; ctx.font = `500 24px ${MIN}`; ctx.fillText(`（${title.kana}）`, W / 2, 558); }

    // キャラクター（白地を羊皮紙になじませる）
    const ch = 440, cw = ch * chara.naturalWidth / chara.naturalHeight;
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(chara, (W - cw) / 2, 578, cw, ch);
    ctx.restore();

    spaced(ctx, 2); ctx.fillStyle = INK2; fitFont(ctx, title.copy, 500, MIN, 32, pw - 220);
    ctx.fillText(title.copy, W / 2, 1066);

    // 区切り
    ctx.strokeStyle = 'rgba(60,44,28,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px + 150, 1100); ctx.lineTo(W - px - 150, 1100); ctx.stroke();

    // MAIN / SUB
    const colX = [W / 2 - 205, W / 2 + 205];
    [[main, 'MAIN JOB'], [sub, 'SUB JOB']].forEach(([job, kind], k) => {
      const cx = colX[k];
      spaced(ctx, 6); ctx.fillStyle = INK3; ctx.font = `600 20px ${EN}`; ctx.fillText(kind, cx, 1144);
      spaced(ctx, 3); ctx.fillStyle = job.ink; ctx.font = `700 ${k ? 40 : 44}px ${EN}`; ctx.fillText(job.id, cx, 1194);
      spaced(ctx, 1); ctx.fillStyle = INK2; ctx.font = `500 25px ${MIN}`; ctx.fillText(`${job.ja} / ${job.cls}`, cx, 1232);
    });
    ctx.beginPath(); ctx.moveTo(W / 2, 1122); ctx.lineTo(W / 2, 1240); ctx.stroke();

    // STATUS（1行ずつ）
    spaced(ctx, 10); ctx.fillStyle = INK2; ctx.font = `600 24px ${EN}`; ctx.fillText('STATUS', W / 2, 1294);
    const left = px + 130, right = W - px - 130;
    r.ranked.forEach((row, k) => {
      const ry = 1350 + k * 62;
      ctx.drawImage(ems[k], left, ry - 32, 40, 40);
      ctx.textAlign = 'left'; spaced(ctx, 2);
      ctx.fillStyle = row.job.ink; ctx.font = `700 26px ${EN}`; ctx.fillText(row.job.id, left + 54, ry);
      const nw = ctx.measureText(row.job.id).width;
      spaced(ctx, 0); ctx.fillStyle = INK3; ctx.font = `500 19px ${SANS}`; ctx.fillText(`${row.pct}%`, left + 64 + nw, ry);
      // 星
      const sx = left + 400, sw = 26;
      ctx.font = `26px ${SANS}`;
      for (let s = 0; s < 10; s++) {
        const fill = Math.max(0, Math.min(1, row.stat / 10 - s));
        ctx.fillStyle = 'rgba(60,44,28,.18)'; ctx.fillText('★', sx + s * sw, ry + 2);
        if (fill > 0) {
          ctx.save(); ctx.beginPath(); ctx.rect(sx + s * sw, ry - 30, sw * fill, 40); ctx.clip();
          ctx.fillStyle = row.job.ink; ctx.fillText('★', sx + s * sw, ry + 2); ctx.restore();
        }
      }
      ctx.textAlign = 'right'; ctx.fillStyle = INK; ctx.font = `700 32px ${EN}`; ctx.fillText(String(row.stat), right, ry + 4);
      ctx.textAlign = 'center';
    });

    ctx.fillStyle = INK3; ctx.font = `500 19px ${SANS}`; spaced(ctx, 1);
    ctx.fillText('※数値は今回の回答における傾向値です', W / 2, 1668);

    // フッター
    spaced(ctx, 6); ctx.fillStyle = '#efe6d4'; ctx.font = `600 40px ${MIN}`;
    ctx.fillText(D.meta.concept, W / 2, 1834);
    spaced(ctx, 4); ctx.fillStyle = '#cfae6b'; ctx.font = `500 26px ${SANS}`;
    ctx.fillText(D.meta.hashtag, W / 2, 1884);
    return cv;
  }

  let cardUrl = null, cardBlob = null;
  async function openShare() {
    const dlg = $('#shareDialog');
    $('#shareImg').removeAttribute('src');
    $('#shareHint').textContent = 'カードを作成しています……';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    try {
      const cv = await drawCard(state.result);
      cardBlob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (cardUrl) URL.revokeObjectURL(cardUrl);
      cardUrl = URL.createObjectURL(cardBlob);
      $('#shareImg').src = cardUrl;
      $('#shareSave').href = cardUrl;
      $('#shareHint').textContent = '画像を長押し、または下のボタンから保存できます。';
      const file = new File([cardBlob], 'koryu-job.png', { type: 'image/png' });
      $('#shareNative').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) {
      console.error(e);
      $('#shareHint').textContent = 'カードを作成できませんでした。この画面のスクリーンショットをご利用ください。';
    }
  }
  async function nativeShare() {
    if (!cardBlob) return;
    const r = state.result;
    const file = new File([cardBlob], 'koryu-job.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], text: `私の交流ジョブは「${r.title.name}」（MAIN ${r.main.id} × SUB ${r.sub.id}）でした。 ${D.meta.hashtag}` });
    } catch { /* 閉じただけ */ }
  }
  function closeShare() { const dlg = $('#shareDialog'); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

  /* ---------- events ---------- */
  function bind() {
    $('#startBtn').addEventListener('click', () => show('gender', '#genderHeading'));
    $('#genderPick').addEventListener('click', e => {
      const b = e.target.closest('[data-gender]'); if (!b) return;
      setGender(b.dataset.gender);
      start();
    });
    $('#genderBack').addEventListener('click', () => show('title', '#titleHeading'));
    $('#resumeBtn').addEventListener('click', () => {
      const last = store.get(); if (!last || !last.record || !GENDER[last.record.gender]) return;
      const rec = last.record;
      setGender(rec.gender);
      const byId = Object.fromEntries((rec.style.answers || []).map(a => [a.questionId, a.choiceId]));
      state.record = rec; state.responseId = rec.responseId; state.name = rec.name; state.email = rec.email || ''; state.save = last.save || 'idle';
      state.result = compute(SQ.map(q => byId[q.id] || null), rec.gender);
      renderResult(state.result);
      show('result', '#resultHeading');
    });
    $('#choices').addEventListener('click', e => {
      const b = e.target.closest('.choice'); if (!b) return;
      if (b.dataset.cid != null) toggleProfile(b.dataset.cid);
      else choose(Number(b.dataset.ci));
    });
    $('#pfields').addEventListener('input', e => {
      const f = e.target.closest('[data-fid]'); if (!f) return;
      state.profile[STEPS[state.i].q.id].fields[f.dataset.fid] = f.value;
    });
    $('#nextBtn').addEventListener('click', next);
    $('#backBtn').addEventListener('click', back);
    $('#submitBack').addEventListener('click', () => { if (state.sending) return; state.name = $('#nameInput').value; state.email = $('#emailInput').value; state.i = TOTAL - 1; renderQuestion('back'); show('quiz', '#qText'); });
    $('#submitForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
    $('#skipSendBtn').addEventListener('click', () => { if (!state.sending && state.record) analyze(compute(styleTypes(), state.gender)); });
    $('#result').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'share') openShare();
      if (act === 'resend') resend();
      if (act === 'retry') { $('#result').classList.remove('is-in'); state.name = ''; state.email = ''; show('gender', '#genderHeading'); }
    });
    $('#shareClose').addEventListener('click', closeShare);
    $('#shareNative').addEventListener('click', nativeShare);
    $('#shareDialog').addEventListener('click', e => { if (e.target.id === 'shareDialog') closeShare(); });

    // キーボード：前半の質問だけ A〜E / 1〜5 で選択、← で戻る（入力欄に打っているときは何もしない）
    document.addEventListener('keydown', e => {
      if (!$('#screen-quiz').classList.contains('is-active') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.closest('input, textarea') || STEPS[state.i].part !== 'style') return;
      const k = e.key.toUpperCase();
      let pos = LETTERS.indexOf(k);
      if (pos < 0 && /^[1-9]$/.test(k)) pos = Number(k) - 1;
      const order = state.order[state.i];
      if (pos >= 0 && pos < order.length && k.length === 1) { e.preventDefault(); choose(order[pos]); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    });
  }

  renderTitle();
  bind();
})();
