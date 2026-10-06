/* =========================================================
   交流ジョブ診断 — 画面とロジック
   内容はすべて data.js（window.JOB_QUIZ）から読みます。
   ========================================================= */
(() => {
  'use strict';

  const D = window.JOB_QUIZ;
  const JOBS = D.jobs;
  const JOB = Object.fromEntries(JOBS.map(j => [j.id, j]));
  const Q = D.questions;
  const TOTAL = Q.length;
  const LETTERS = 'ABCDEFGH';
  const STORE_KEY = 'koryu-job:last';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = s => esc(s).replace(/\n/g, '<br>');
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const emblem = (job, cls = '') =>
    `<svg class="emblem ${cls}" viewBox="0 0 48 48" aria-hidden="true" style="--c:${job.color};--ink:${job.ink}"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${job.emblem}</g></svg>`;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  /* ---------- state ---------- */
  const state = { i: 0, answers: Array(TOTAL).fill(null), order: [], locked: false, result: null };

  function shuffled(n) {
    const a = [...Array(n).keys()];
    if (!D.shuffleChoices) return a;
    for (let k = n - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [a[k], a[r]] = [a[r], a[k]]; }
    return a;
  }

  /* ---------- scoring ---------- */
  function compute(answers) {
    const counts = Object.fromEntries(JOBS.map(j => [j.id, 0]));
    answers.forEach((ci, qi) => { if (ci != null) counts[Q[qi].choices[ci].job]++; });
    const total = answers.filter(a => a != null).length || 1;

    const pickOf = qid => { const qi = Q.findIndex(q => q.id === qid); const ci = answers[qi]; return ci == null ? null : Q[qi].choices[ci].job; };
    const tb = (D.scoring.tieBreak || []).map(pickOf);
    const tbRank = id => { const k = tb.indexOf(id); return k < 0 ? tb.length : k; };

    const ranked = JOBS.map((job, order) => ({ job, order, count: counts[job.id] }))
      .sort((a, b) => b.count - a.count || tbRank(a.job.id) - tbRank(b.job.id) || a.order - b.order)
      .map(r => ({ ...r, pct: Math.round(r.count / total * 100), stat: D.scoring.stat(r.count, total) }));

    const main = ranked[0].job, sub = ranked[1].job;
    const lensQ = Q.find(q => q.id === D.lens.question);
    const lensAns = answers[Q.indexOf(lensQ)];
    return { ranked, main, sub, low: ranked[ranked.length - 1].job, title: D.titles[main.id][sub.id], lensQ, lensAns };
  }

  /* ---------- screens ---------- */
  const SCENE = { title: 'title', quiz: 'quiz', analyze: 'analyze', result: 'result' };
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
    $('#partyRoll').innerHTML = JOBS.map(j => `
      <li style="--c:${j.color}">
        ${emblem(j)}
        <span class="party-roll__ja">${esc(j.intro)}</span>
        <span class="party-roll__en en">${esc(j.id)}</span>
      </li>`).join('');
    const last = store.get();
    $('#resumeBtn').hidden = !(last && Array.isArray(last.answers) && last.answers.length === TOTAL && last.answers.every(a => a != null));
  }

  function start() {
    state.i = 0;
    state.answers = Array(TOTAL).fill(null);
    state.order = Q.map(q => shuffled(q.choices.length));
    renderQuestion('fwd');
    show('quiz', '#qText');
  }

  /* ---------- quiz ---------- */
  function renderPips() {
    const pips = $('#pips');
    if (!pips.children.length) pips.innerHTML = Q.map(() => '<span class="pip"></span>').join('');
    [...pips.children].forEach((p, k) => {
      p.classList.toggle('is-done', state.answers[k] != null && k !== state.i);
      p.classList.toggle('is-current', k === state.i);
    });
    pips.setAttribute('aria-valuenow', String(state.answers.filter(a => a != null).length));
  }

  function renderQuestion(dir) {
    const q = Q[state.i];
    $('#hudCount').innerHTML = `QUESTION <b>${pad(state.i + 1)}</b> <span>/ ${pad(TOTAL)}</span>`;
    $('#qLabel').textContent = `QUESTION ${pad(state.i + 1)}`;
    $('#qText').innerHTML = lines(q.text);
    $('#choices').innerHTML = state.order[state.i].map((ci, pos) => {
      const on = state.answers[state.i] === ci;
      return `<li><button class="choice${on ? ' is-selected' : ''}" type="button" data-ci="${ci}" aria-pressed="${on}">
        <span class="choice__mark en">${LETTERS[pos]}</span>
        <span class="choice__text">${esc(q.choices[ci].text)}</span>
      </button></li>`;
    }).join('');
    renderPips();

    const box = $('#qbox');
    box.classList.remove('enter-fwd', 'enter-back');
    void box.offsetWidth;
    box.classList.add(dir === 'back' ? 'enter-back' : 'enter-fwd');
  }

  async function choose(ci) {
    if (state.locked) return;
    state.locked = true;
    state.answers[state.i] = ci;
    $$('#choices .choice').forEach(b => {
      const on = Number(b.dataset.ci) === ci;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderPips();
    await wait(reduce ? 120 : 380);
    if (state.i < TOTAL - 1) {
      state.i++;
      renderQuestion('fwd');
      $('#qText').focus({ preventScroll: true });
    } else {
      await analyze();
    }
    state.locked = false;
  }

  function back() {
    if (state.locked) return;
    if (state.i === 0) { show('title', '#titleHeading'); return; }
    state.i--;
    renderQuestion('back');
    $('#qText').focus({ preventScroll: true });
  }

  /* ---------- analyze（1〜2秒） ---------- */
  async function analyze() {
    const r = compute(state.answers);
    state.result = r;
    store.set({ answers: state.answers, at: Date.now() });

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
    const lensPick = r.lensAns != null ? r.lensQ.choices[r.lensAns] : null;
    const pq = D.partyQuest;

    $('#result').innerHTML = `
      <header class="unlock reveal" style="--d:0ms">
        <p class="unlock__en en">QUEST CLEAR</p>
        <p class="unlock__ja" id="resultHeading" tabindex="-1">交流ジョブが解放されました！</p>
      </header>

      <article class="sheet reveal" style="--d:120ms" aria-label="ステータス">
        <div class="sheet__top">
          <p class="sheet__kicker en">YOUR STATUS<span>NETWORK PLAYER</span></p>
          <p class="sheet__lv"><b class="en">${esc(D.meta.level.lv)}</b>${esc(D.meta.level.name)}</p>
        </div>

        <div class="epithet">
          <p class="epithet__label">二つ名</p>
          <h2 class="epithet__name">${esc(title.name)}</h2>
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
        <h3 class="block__h" id="h-play">交流会での活かし方</h3>
        <p class="block__p">${esc(sub.open)}</p>
        <p class="block__p">${esc(main.play)}</p>
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

      <section class="block lens" aria-labelledby="h-lens">
        <p class="block__en en">SAME FACT. DIFFERENT INTERPRETATION.</p>
        <h3 class="block__h" id="h-lens">同じ出来事でも、<br class="sp">人によって受け取り方は違う。</h3>
        <div class="lens__fact"><span class="lens__k">事実</span><p>${esc(D.lens.fact)}</p></div>
        <ul class="lens__list">
          ${r.lensQ.choices.map((c, ci) => `
            <li class="${ci === r.lensAns ? 'is-you' : ''}" style="--c:${JOB[c.job].color}">
              <span class="lens__who en">${esc(c.job)}</span><span class="lens__say">${esc(c.text)}</span>${ci === r.lensAns ? '<span class="lens__you">あなた</span>' : ''}
            </li>`).join('')}
          <li class="lens__extra"><span class="lens__who">ほかにも</span><span class="lens__say">${esc(D.lens.extra)}</span></li>
        </ul>
        ${lensPick ? `<p class="lens__mine">あなたは${esc(lensPick.text)}と受け取りました。でも、それは数ある解釈のひとつです。</p>` : ''}
        <ol class="flow" aria-label="${D.lens.steps.join('、')}">${D.lens.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        ${D.lens.body.map(p => `<p class="block__p">${esc(p)}</p>`).join('')}
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

    const allText = [D.meta.event, title.name, title.copy, main.ja, sub.ja, main.cls, sub.cls, D.meta.level.name, D.meta.concept, '傾向値二つ名今回の回答における', ...r.ranked.map(x => x.job.ja)].join('');
    await Promise.all([
      document.fonts.load(`700 80px ${MIN}`, allText), document.fonts.load(`500 30px ${MIN}`, allText),
      document.fonts.load(`500 28px ${SANS}`, allText), document.fonts.load(`700 40px ${EN}`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.·%')
    ]).catch(() => {});
    const [tome, parch, emM, emS, ...ems] = await Promise.all([
      loadImg('tome', 'images/tome.jpg'), loadImg('parch', 'images/parchment.jpg'),
      emblemImg(main, main.ink), emblemImg(sub, sub.ink), ...r.ranked.map(x => emblemImg(x.job, x.job.ink))
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
    let y = py + 132;
    spaced(ctx, 8); ctx.fillStyle = INK2; ctx.font = `600 24px ${EN}`;
    ctx.fillText('YOUR STATUS  ·  NETWORK PLAYER', W / 2, y);
    y += 46; spaced(ctx, 2); ctx.font = `500 26px ${MIN}`; ctx.fillStyle = INK3;
    ctx.fillText(`${D.meta.level.lv}  ${D.meta.level.name}`, W / 2, y);

    // 二つ名
    y += 84; ctx.fillStyle = INK3; spaced(ctx, 10); ctx.font = `500 26px ${MIN}`;
    ctx.fillText('— 二つ名 —', W / 2, y);
    y += 108; spaced(ctx, 6); ctx.fillStyle = INK; fitFont(ctx, title.name, 700, MIN, 92, pw - 220);
    ctx.fillText(title.name, W / 2, y);
    y += 70; spaced(ctx, 2); ctx.fillStyle = INK2; fitFont(ctx, title.copy, 500, MIN, 32, pw - 220);
    ctx.fillText(title.copy, W / 2, y);

    // 区切り
    y += 50; ctx.strokeStyle = 'rgba(60,44,28,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px + 150, y); ctx.lineTo(W - px - 150, y); ctx.stroke();

    // MAIN / SUB
    y += 40;
    const colX = [W / 2 - 205, W / 2 + 205];
    [[main, 'MAIN JOB', emM, main.power], [sub, 'SUB JOB', emS, sub.subPower]].forEach(([job, kind, em, pw2], k) => {
      const cx = colX[k];
      spaced(ctx, 6); ctx.fillStyle = INK3; ctx.font = `600 22px ${EN}`; ctx.fillText(kind, cx, y + 10);
      ctx.drawImage(em, cx - 60, y + 34, 120, 120);
      spaced(ctx, 3); ctx.fillStyle = job.ink; ctx.font = `700 ${k ? 42 : 46}px ${EN}`; ctx.fillText(job.id, cx, y + 210);
      spaced(ctx, 1); ctx.fillStyle = INK2; ctx.font = `500 27px ${MIN}`; ctx.fillText(`${job.ja} / ${job.cls}`, cx, y + 254);
      fitFont(ctx, `「${pw2}」`, 500, MIN, 25, 380); ctx.fillStyle = INK3; ctx.fillText(`「${pw2}」`, cx, y + 296);
    });
    ctx.beginPath(); ctx.moveTo(W / 2, y + 20); ctx.lineTo(W / 2, y + 290); ctx.stroke();

    // STATUS
    y += 380;
    spaced(ctx, 10); ctx.fillStyle = INK2; ctx.font = `600 26px ${EN}`; ctx.fillText('STATUS', W / 2, y);
    y += 36;
    const left = px + 130, right = W - px - 130;
    r.ranked.forEach((row, k) => {
      const ry = y + 34 + k * 94;
      ctx.drawImage(ems[k], left, ry - 36, 56, 56);
      ctx.textAlign = 'left'; spaced(ctx, 2);
      ctx.fillStyle = row.job.ink; ctx.font = `700 30px ${EN}`; ctx.fillText(row.job.id, left + 72, ry);
      ctx.fillStyle = INK3; ctx.font = `500 21px ${SANS}`; spaced(ctx, 0);
      ctx.fillText(`${row.job.ja}  傾向値 ${row.pct}%`, left + 72, ry + 30);
      // 星
      const sx = left + 400, sw = 26;
      ctx.font = `28px ${SANS}`;
      for (let s = 0; s < 10; s++) {
        const fill = Math.max(0, Math.min(1, row.stat / 10 - s));
        ctx.fillStyle = 'rgba(60,44,28,.18)'; ctx.fillText('★', sx + s * sw, ry + 6);
        if (fill > 0) {
          ctx.save(); ctx.beginPath(); ctx.rect(sx + s * sw, ry - 30, sw * fill, 44); ctx.clip();
          ctx.fillStyle = row.job.ink; ctx.fillText('★', sx + s * sw, ry + 6); ctx.restore();
        }
      }
      ctx.textAlign = 'right'; ctx.fillStyle = INK; ctx.font = `700 36px ${EN}`; ctx.fillText(String(row.stat), right, ry + 8);
      ctx.textAlign = 'center';
    });

    ctx.fillStyle = INK3; ctx.font = `500 20px ${SANS}`; spaced(ctx, 1);
    ctx.fillText('※数値は今回の回答における傾向値です', W / 2, py + ph - 100);

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
    $('#startBtn').addEventListener('click', start);
    $('#resumeBtn').addEventListener('click', () => {
      const last = store.get(); if (!last) return;
      state.answers = last.answers; state.order = Q.map(q => shuffled(q.choices.length)); state.i = TOTAL - 1;
      state.result = compute(state.answers);
      renderResult(state.result);
      show('result', '#resultHeading');
    });
    $('#choices').addEventListener('click', e => {
      const b = e.target.closest('.choice'); if (b) choose(Number(b.dataset.ci));
    });
    $('#backBtn').addEventListener('click', back);
    $('#result').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'share') openShare();
      if (act === 'retry') { $('#result').classList.remove('is-in'); start(); }
    });
    $('#shareClose').addEventListener('click', closeShare);
    $('#shareNative').addEventListener('click', nativeShare);
    $('#shareDialog').addEventListener('click', e => { if (e.target.id === 'shareDialog') closeShare(); });

    // キーボード：A〜E / 1〜5 で選択、← で戻る
    document.addEventListener('keydown', e => {
      if (document.body.dataset.scene !== 'quiz' || e.altKey || e.ctrlKey || e.metaKey) return;
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
