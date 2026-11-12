/* 狗系人格测试 · 交互逻辑 */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const LS = {
    history: 'dogtest.v1.history'
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pad2 = (n) => String(n).padStart(2, '0');
  const dogById = (id) => DOGS.find((d) => d.id === id);

  const state = { index: 0, answers: [], result: null };

  /* ---------------- 本地存储 ---------------- */
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略隐私模式报错 */ }
  }

  function getHistory() {
    const list = readJSON(LS.history, []);
    return Array.isArray(list) ? list : [];
  }
  function saveHistory(dogId, dims) {
    const list = getHistory().filter((item) => item && item.id !== dogId);
    list.unshift({ id: dogId, dims: dims, at: Date.now() });
    writeJSON(LS.history, list.slice(0, 8));
  }

  /* ---------------- 计分 ---------------- */
  const MAX_POSSIBLE = (() => {
    const max = {};
    DIMS.forEach((d) => { max[d.key] = 0; });
    QUESTIONS.forEach((q) => {
      DIMS.forEach((d) => {
        let best = 0;
        q.o.forEach((opt) => { best = Math.max(best, opt.w[d.key] || 0); });
        max[d.key] += best;
      });
    });
    return max;
  })();

  function calcDims(answers) {
    const raw = {};
    DIMS.forEach((d) => { raw[d.key] = 0; });
    answers.forEach((optIndex, qIndex) => {
      const opt = QUESTIONS[qIndex].o[optIndex];
      Object.keys(opt.w).forEach((k) => { raw[k] += opt.w[k]; });
    });

    const ratios = DIMS.map((d) => (MAX_POSSIBLE[d.key] ? raw[d.key] / MAX_POSSIBLE[d.key] : 0));
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ratios.length;
    const sd = Math.sqrt(variance) || 1e-6;

    const dims = {};
    DIMS.forEach((d, i) => {
      const z = (ratios[i] - mean) / sd;
      dims[d.key] = clamp(Math.round(50 + 22 * z), 5, 95);
    });
    return { raw, ratios, dims, sd };
  }

  /* 把每种狗的性格画像转成 z 向量，消除“整体偏高/偏低”的影响，只比形状 */
  const DOG_SHAPE = {};
  DOGS.forEach((dog) => {
    const values = DIMS.map((d) => dog.profile[d.key]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length) || 1e-6;
    DOG_SHAPE[dog.id] = values.map((v) => (v - mean) / sd);
  });

  function shapeDistance(z, dog) {
    let sum = 0;
    DIMS.forEach((d, i) => {
      const diff = z[i] - DOG_SHAPE[dog.id][i];
      sum += diff * diff;
    });
    return Math.sqrt(sum / DIMS.length);
  }

  function hitHiddenRule(dog, dims) {
    if (!dog.hiddenRule) return false;
    return dog.hiddenRule.every((r) => (r.min === undefined || dims[r.key] >= r.min)
      && (r.max === undefined || dims[r.key] <= r.max));
  }

  function matchDog(ratios, dims) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ratios.length) || 1e-6;
    const z = ratios.map((r) => (r - mean) / sd);

    let normal = null;
    DOGS.filter((dog) => !dog.hidden).forEach((dog) => {
      const dist = shapeDistance(z, dog);
      if (!normal || dist < normal.dist) normal = { dog, dist };
    });

    const hidden = DOGS
      .filter((dog) => hitHiddenRule(dog, dims))
      .map((dog) => ({ dog, dist: shapeDistance(z, dog) }))
      .sort((a, b) => a.dist - b.dist)[0];

    /* 隐藏款的判定：先满足稀有维度组合，形状也确实贴近，才顶掉普通结果 */
    if (hidden && hidden.dist <= normal.dist * 1.5) return hidden.dog;
    return normal.dog;
  }

  function computeResult(answers) {
    const { ratios, dims } = calcDims(answers);
    return { dog: matchDog(ratios, dims), dims, ratios };
  }

  /* ---------------- 双人合拍 ---------------- */
  const PAIR_INDEX = (() => {
    const list = [];
    for (let i = 0; i < DOGS.length; i += 1) {
      for (let j = i + 1; j < DOGS.length; j += 1) {
        list.push({ key: [DOGS[i].id, DOGS[j].id].sort().join('|'), dist: shapeDistance(DOG_SHAPE[DOGS[i].id], DOGS[j]) });
      }
    }
    const dists = list.map((p) => p.dist);
    const min = Math.min.apply(null, dists);
    const max = Math.max.apply(null, dists);
    const map = {};
    list.forEach((p) => {
      map[p.key] = Math.round(96 - ((p.dist - min) / (max - min || 1)) * 58);
    });
    return map;
  })();

  function pairScore(a, b) {
    if (a.id === b.id) return 99;
    return PAIR_INDEX[[a.id, b.id].sort().join('|')] || 50;
  }

  function pairCopy(a, b, score) {
    const band = PAIR_BANDS.find((item) => score >= item.min) || PAIR_BANDS[PAIR_BANDS.length - 1];
    let label = band.label;
    let line = band.line;

    const ab = a.best === b.id;
    const ba = b.best === a.id;
    if (ab && ba) {
      label = '双向奔赴';
      line = `${a.name}和${b.name}都把对方写进了“最合拍”，这种互相接住的关系不多见。`;
    } else if (a.worst === b.id && b.worst === a.id) {
      label = '天生对家';
      line = `${a.name}和${b.name}的默认反应刚好相反，误会几乎是自动发生的。`;
    } else if (ab || ba) {
      const from = ab ? a : b;
      const to = ab ? b : a;
      label = '一边更热络';
      line = `${from.name}天然会被${to.name}吸引，${to.name}未必察觉，但相处起来很顺。`;
    } else if (a.worst === b.id || b.worst === a.id) {
      const from = a.worst === b.id ? a : b;
      const to = a.worst === b.id ? b : a;
      label = '容易错位';
      line = `${from.name}最不适应${to.name}的那种方式，靠近之前最好先说清楚。`;
    }

    const shared = DIMS.filter((d) => a.profile[d.key] >= 68 && b.profile[d.key] >= 68).map((d) => d.name);
    let widest = DIMS[0].key;
    DIMS.forEach((d) => {
      if (Math.abs(a.profile[d.key] - b.profile[d.key]) > Math.abs(a.profile[widest] - b.profile[widest])) widest = d.key;
    });
    const widestName = DIMS.find((d) => d.key === widest).name;

    return {
      label,
      line,
      points: [
        { k: '共同点', v: shared.length ? `都很${shared.slice(0, 3).join('、')}，这一点不用互相解释。` : '你们的强项不太重叠，反而容易互相觉得新鲜。' },
        { k: '最大差异', v: `${widestName}上，${a.name}是 ${a.profile[widest]}，${b.name}是 ${b.profile[widest]}，分歧多半从这里来。` },
        { k: '相处建议', v: band.tip }
      ]
    };
  }

  /* ---------------- 雷达图 ---------------- */
  function radarSVG(dims) {
    const size = 320;
    const c = size / 2;
    const R = 100;
    const labelR = 127;
    const angles = DIMS.map((_, i) => (i * 45 - 90) * Math.PI / 180);
    const point = (angle, radius) => [c + Math.cos(angle) * radius, c + Math.sin(angle) * radius];
    const fmt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach((level) => {
      const pts = angles.map((a) => fmt(point(a, R * level))).join(' ');
      grid += `<polygon points="${pts}" fill="${level === 1 ? 'rgba(255,253,247,.7)' : 'none'}" stroke="rgba(58,42,32,${level === 1 ? '.28' : '.13'})" stroke-width="1"/>`;
    });

    let axes = '';
    angles.forEach((a) => {
      const p = point(a, R);
      axes += `<line x1="${c}" y1="${c}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="rgba(58,42,32,.13)" stroke-width="1"/>`;
    });

    const shape = DIMS.map((d, i) => fmt(point(angles[i], R * (dims[d.key] / 100)))).join(' ');
    const dots = DIMS.map((d, i) => {
      const p = point(angles[i], R * (dims[d.key] / 100));
      return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="#C94F26"/>`;
    }).join('');

    const labels = DIMS.map((d, i) => {
      const a = angles[i];
      const p = point(a, labelR);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
      const dy = sin > 0.6 ? 11 : sin < -0.6 ? 0 : 4;
      return `<text x="${p[0].toFixed(1)}" y="${(p[1] + dy).toFixed(1)}" text-anchor="${anchor}" font-size="11.5" font-weight="700" fill="#6E5A4B" font-family="var(--font)">${d.name}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="性格八维雷达图">
      ${grid}${axes}
      <polygon points="${shape}" fill="rgba(233,118,74,.3)" stroke="#E9764A" stroke-width="2.4" stroke-linejoin="round"/>
      ${dots}${labels}
    </svg>`;
  }

  /* ---------------- 屏幕 ---------------- */
  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
    window.scrollTo(0, 0);
  }

  /* ---------------- 答题 ---------------- */
  function startQuiz() {
    state.index = 0;
    state.answers = [];
    state.result = null;
    $('#qOptions').classList.remove('is-busy');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    showScreen('screen-quiz');
    renderQuestion();
  }

  function renderQuestion() {
    const q = QUESTIONS[state.index];
    const total = QUESTIONS.length;

    $('#qIndex').textContent = pad2(state.index + 1);
    $('#quizCount').textContent = `${pad2(state.index + 1)} / ${total}`;
    $('#quizBar').style.width = `${(state.index / total) * 100}%`;
    $('#qText').textContent = q.t;

    const options = $('#qOptions');
    options.innerHTML = q.o.map((opt, i) => `
      <button class="option" type="button" data-index="${i}">
        <span class="idx">${String.fromCharCode(65 + i)}</span>
        <span>${opt.t}</span>
      </button>
    `).join('');

    $$('.option', options).forEach((btn) => {
      btn.addEventListener('click', () => pickOption(Number(btn.dataset.index)));
    });

    $('#btnBack').style.opacity = state.index === 0 ? '.4' : '1';
  }

  function pickOption(optIndex) {
    if ($('#qOptions').classList.contains('is-busy')) return;
    $('#qOptions').classList.add('is-busy');

    const buttons = $$('.option', $('#qOptions'));
    buttons.forEach((b, i) => {
      b.style.pointerEvents = 'none';
      if (i === optIndex) b.classList.add('is-picked');
    });

    state.answers[state.index] = optIndex;

    window.setTimeout(() => {
      if (state.index >= QUESTIONS.length - 1) {
        finish();
      } else {
        state.index += 1;
        $('#qOptions').classList.remove('is-busy');
        renderQuestion();
      }
    }, 190);
  }

  const LOADING_LINES = [
    '正在闻一闻你的性格…',
    '正在摇着尾巴匹配…',
    '正在和 10 只狗对暗号…'
  ];

  function finish() {
    $('#quizBar').style.width = '100%';
    showScreen('screen-loading');

    let step = 0;
    $('#loadingText').textContent = LOADING_LINES[0];
    const timer = window.setInterval(() => {
      step += 1;
      $('#loadingText').textContent = LOADING_LINES[step % LOADING_LINES.length];
    }, 720);

    window.setTimeout(() => {
      window.clearInterval(timer);
      const result = computeResult(state.answers);
      state.result = result;
      renderResult(result);
      showScreen('screen-result');
      toast(`${result.dog.name} 已加入你的图鉴`);
    }, 1500);
  }

  /* ---------------- 结果页 ---------------- */
  function renderResult(result) {
    const { dog, dims } = result;

    $('#resImg').src = `assets/dogs/${dog.id}.jpg`;
    $('#resImg').alt = `${dog.name}插画`;
    $('#resNo').textContent = `NO.${dog.no}`;
    $('#resName').textContent = dog.name;
    $('#resTitle').textContent = dog.title;
    $('#resTags').innerHTML = dog.tags.map((t) => `<span>${t}</span>`).join('');
    $('#resDesc').textContent = dog.desc;
    $('#resTraits').innerHTML = dog.traits.map((t) => `<li>${t}</li>`).join('');
    $('#resMisread').innerHTML = dog.misread.map((t) => `<li>${t}</li>`).join('');

    const ribbon = $('#resRibbon');
    ribbon.textContent = dog.hidden ? '隐藏款 · 你的狗系人格' : '你的狗系人格';
    ribbon.classList.toggle('is-hidden', Boolean(dog.hidden));

    $('#resRadar').innerHTML = radarSVG(dims);

    $('#resDims').innerHTML = DIMS.map((d) => `
      <div class="dim-row">
        <span class="dim-name">${d.name}</span>
        <span class="dim-track"><i data-value="${dims[d.key]}"></i></span>
        <span class="dim-val">${dims[d.key]}</span>
      </div>
    `).join('');

    renderDimNotes(dims);
    renderPairTeaser(dog);
    saveHistory(dog.id, dims);
    refreshGalleryCounts();

    window.requestAnimationFrame(() => {
      $$('#resDims .dim-track i').forEach((bar) => {
        bar.style.width = `${bar.dataset.value}%`;
      });
    });
  }

  /* 用你最高 / 最低的维度解释“为什么是这只狗” */
  function renderDimNotes(dims) {
    const ranked = DIMS.map((d) => ({ dim: d, value: dims[d.key] })).sort((a, b) => b.value - a.value);
    const top = ranked.slice(0, 2);
    const low = ranked[ranked.length - 1];
    const cards = top.map((item, i) => `
      <div class="note-card">
        <div class="note-head">
          <span class="note-tag">${i === 0 ? '最突出' : '次突出'}</span>
          <b>${item.dim.name} ${item.value}</b>
        </div>
        <p>${DIM_NOTES[item.dim.key].high}</p>
      </div>`).join('');
    const lowCard = `
      <div class="note-card is-low">
        <div class="note-head">
          <span class="note-tag">相对最低</span>
          <b>${low.dim.name} ${low.value}</b>
        </div>
        <p>${DIM_NOTES[low.dim.key].low}</p>
      </div>`;
    $('#resNotes').innerHTML = cards + lowCard;
  }

  function renderPairTeaser(dog) {
    const best = dogById(dog.best);
    const worst = dogById(dog.worst);
    $('#pairBestImg').src = `assets/dogs/${best.id}.jpg`;
    $('#pairBestImg').alt = best.name;
    $('#pairBestName').textContent = `${best.name} · ${best.title}`;
    $('#pairBestWhy').textContent = dog.bestWhy;

    $('#pairWorstImg').src = `assets/dogs/${worst.id}.jpg`;
    $('#pairWorstImg').alt = worst.name;
    $('#pairWorstName').textContent = `${worst.name} · ${worst.title}`;
    $('#pairWorstWhy').textContent = dog.worstWhy;
  }

  /* ---------------- 分享 ---------------- */
  function encodeState(dogId, dims) {
    const payload = JSON.stringify({ t: dogId, d: DIMS.map((d) => dims[d.key]) });
    const bytes = new TextEncoder().encode(payload);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(token) {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || !dogById(data.t) || !Array.isArray(data.d) || data.d.length !== DIMS.length) return null;
      const dims = {};
      DIMS.forEach((d, i) => { dims[d.key] = clamp(Number(data.d[i]) || 50, 1, 100); });
      return { dog: dogById(data.t), dims };
    } catch (e) {
      return null;
    }
  }

  function buildShareUrl() {
    if (!state.result) return location.href;
    const encoded = encodeState(state.result.dog.id, state.result.dims);
    const base = location.href.split('#')[0];
    return `${base}#r=${encoded}`;
  }

  async function shareResult() {
    if (!state.result) return;
    const url = buildShareUrl();
    const text = `我是${state.result.dog.name}·${state.result.dog.title}，你是哪种小狗？`;

    if (navigator.share) {
      try {
        await navigator.share({ title: '测测你是哪种小狗', text: text, url: url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyText(url, '链接已复制，去发给朋友看看');
  }

  function copyText(text, okMessage) {
    const done = () => toast(okMessage);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动复制地址栏链接'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 双人合拍 ---------------- */
  const pairState = { a: null, b: null, pickTarget: 'a' };

  function renderPairSlots() {
    [['a', '#slotAImg', '#slotAName', '#slotA'], ['b', '#slotBImg', '#slotBName', '#slotB']].forEach((keys) => {
      const dog = pairState[keys[0]];
      const img = $(keys[1]);
      const btn = $(keys[3]);
      if (dog) {
        img.src = `assets/dogs/${dog.id}.jpg`;
        img.alt = dog.name;
        img.hidden = false;
        $(keys[2]).textContent = dog.name;
        btn.classList.add('is-filled');
      } else {
        img.removeAttribute('src');
        img.alt = '';
        img.hidden = true;
        $(keys[2]).textContent = '选一只';
        btn.classList.remove('is-filled');
      }
    });
  }

  function renderPairResult() {
    const a = pairState.a;
    const b = pairState.b;
    if (!a || !b) {
      $('#pairResult').hidden = true;
      $('#btnPairShare').hidden = true;
      return;
    }
    const score = pairScore(a, b);
    const copy = pairCopy(a, b, score);
    $('#pairScore').textContent = String(score);
    $('#pairBand').textContent = copy.label;
    $('#pairLine').textContent = a.id === b.id ? '同一只狗的两份样本，默契当然是满分。' : copy.line;
    $('#pairPoints').innerHTML = copy.points
      .map((p) => `<li><b>${p.k}</b><span>${p.v}</span></li>`)
      .join('');
    $('#pairResult').hidden = false;
    $('#btnPairShare').hidden = false;
  }

  function choosePairDog(dog) {
    if (pairState.pickTarget === 'a') pairState.a = dog;
    else pairState.b = dog;
    closeSheet($('#pickSheet'));
    renderPairSlots();
    renderPairResult();
  }

  function openPicker(target) {
    pairState.pickTarget = target;
    const unlocked = new Set(getHistory().map((item) => item.id));
    const selectable = (dog) => !dog.hidden || unlocked.has(dog.id);

    $('#pickGrid').innerHTML = DOGS.map((dog) => {
      const ok = selectable(dog);
      return `<button class="pick-card ${ok ? '' : 'is-locked'}" type="button" data-dog="${dog.id}">
        ${ok ? `<img src="assets/dogs/${dog.id}.jpg" alt="${dog.name}" loading="lazy">` : '<span class="pick-lock">隐藏款</span>'}
        <b>${ok ? dog.name : '？？？'}</b>
      </button>`;
    }).join('');

    $$('#pickGrid .pick-card').forEach((card) => {
      card.addEventListener('click', () => {
        const dog = dogById(card.dataset.dog);
        if (!selectable(dog)) {
          toast(`隐藏款：${dog.unlockAt.replace('隐藏款 · ', '')}，测出来才能选`);
          return;
        }
        choosePairDog(dog);
      });
    });
    openSheet('#pickSheet');
  }

  function pairUrl(a, b) {
    return `${location.href.split('#')[0]}#p=${a.id}-${b.id}`;
  }

  async function sharePair() {
    const a = pairState.a;
    const b = pairState.b;
    if (!a || !b) return;
    const text = `${a.name} × ${b.name}，合拍指数 ${pairScore(a, b)}。你们俩呢？`;
    const url = pairUrl(a, b);
    if (navigator.share) {
      try {
        await navigator.share({ title: '双人合拍', text: text, url: url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyText(url, '合拍链接已复制，发给对方看看');
  }

  /* ---------------- 结果海报 ---------------- */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawPill(g, text, x, y, font) {
    g.font = font;
    const w = g.measureText(text).width + 34;
    roundRect(g, x, y, w, 44, 22);
    g.fillStyle = '#FFF8EA';
    g.fill();
    g.strokeStyle = 'rgba(58,42,32,.45)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#3A2A20';
    g.textAlign = 'center';
    g.fillText(text, x + w / 2, y + 29);
    return w;
  }

  async function savePoster() {
    const result = state.result;
    if (!result) return;
    const dog = result.dog;
    const dims = result.dims;
    const W = 750;
    const H = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const font = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';

    g.fillStyle = '#FBF3E5';
    g.fillRect(0, 0, W, H);
    [[130, 100, 430, 'rgba(233,118,74,.20)'], [660, 300, 380, 'rgba(143,174,150,.26)'], [375, 1210, 520, 'rgba(243,201,105,.34)']]
      .forEach((item) => {
        const grad = g.createRadialGradient(item[0], item[1], 0, item[0], item[1], item[2]);
        grad.addColorStop(0, item[3]);
        grad.addColorStop(1, 'rgba(251,243,229,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
      });

    g.textAlign = 'center';
    g.fillStyle = '#C94F26';
    g.font = `700 22px ${font}`;
    g.fillText(dog.hidden ? 'HIDDEN DOG TYPE · 隐藏款' : 'DOG TYPE TEST · 狗系人格', W / 2, 76);

    const img = await loadImage(`assets/dogs/${dog.id}.jpg`);
    const r = 168;
    const cx = W / 2;
    const cy = 330;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r + 12, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.beginPath();
    g.arc(cx, cy, r + 12, 0, Math.PI * 2);
    g.lineWidth = 4;
    g.strokeStyle = '#3A2A20';
    g.stroke();

    g.beginPath();
    g.arc(cx + 138, cy + 128, 44, 0, Math.PI * 2);
    g.fillStyle = '#F3C969';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#3A2A20';
    g.stroke();
    g.fillStyle = '#3A2A20';
    g.font = `700 24px ${font}`;
    g.fillText(`NO.${dog.no}`, cx + 138, cy + 137);

    g.fillStyle = '#3A2A20';
    g.font = `800 74px ${font}`;
    g.fillText(dog.name, W / 2, 600);
    g.fillStyle = '#C94F26';
    g.font = `700 28px ${font}`;
    g.fillText(dog.title, W / 2, 652);

    const tagFont = `600 24px ${font}`;
    g.font = tagFont;
    const widths = dog.tags.map((t) => g.measureText(t).width + 34);
    let tx = (W - (widths.reduce((a, b) => a + b, 0) + (dog.tags.length - 1) * 14)) / 2;
    dog.tags.forEach((tag, i) => {
      drawPill(g, tag, tx, 688, tagFont);
      tx += widths[i] + 14;
    });

    const ranked = DIMS.map((d) => ({ name: d.name, value: dims[d.key] })).sort((a, b) => b.value - a.value).slice(0, 3);
    const barX = 120;
    const barW = W - barX * 2;
    ranked.forEach((item, i) => {
      const y = 810 + i * 86;
      g.textAlign = 'left';
      g.fillStyle = '#6E5A4B';
      g.font = `700 24px ${font}`;
      g.fillText(item.name, barX, y);
      g.textAlign = 'right';
      g.fillStyle = '#3A2A20';
      g.font = `700 26px ${font}`;
      g.fillText(String(item.value), barX + barW, y);
      roundRect(g, barX, y + 16, barW, 14, 7);
      g.fillStyle = 'rgba(58,42,32,.12)';
      g.fill();
      roundRect(g, barX, y + 16, Math.max(14, barW * item.value / 100), 14, 7);
      g.fillStyle = '#E9764A';
      g.fill();
    });

    g.textAlign = 'center';
    g.fillStyle = '#6E5A4B';
    g.font = `500 24px ${font}`;
    g.fillText('24 个生活场景 · 10 种狗系人格', W / 2, 1092);
    g.fillStyle = 'rgba(58,42,32,.45)';
    g.font = `500 22px ${font}`;
    g.fillText(location.host, W / 2, 1136);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (!dataUrl || dataUrl.length < 1000) throw new Error('poster data url empty');
    $('#posterPreview').src = dataUrl;
    const saveLink = $('#btnPosterSave');
    saveLink.href = dataUrl;
    saveLink.download = `狗系人格-${dog.name}.jpg`;
    openSheet('#posterSheet');
  }

  /* ---------------- 朋友的结果 ---------------- */
  function renderFriend(result) {
    const { dog, dims } = result;
    $('#fImg').src = `assets/dogs/${dog.id}.jpg`;
    $('#fImg').alt = `${dog.name}插画`;
    $('#fNo').textContent = `NO.${dog.no}`;
    $('#fName').textContent = dog.name;
    $('#fTitle').textContent = dog.hidden ? `隐藏款 · ${dog.title}` : dog.title;
    $('#fTags').innerHTML = dog.tags.map((t) => `<span>${t}</span>`).join('');
    $('#fDesc').textContent = dog.desc;
    $('#fRadar').innerHTML = radarSVG(dims);
  }

  /* ---------------- 图鉴 ---------------- */
  function refreshGalleryCounts() {
    const count = getHistory().length;
    $('#galleryCount').textContent = String(count);
    $('#introGalleryCount').textContent = `${count} / ${DOGS.length}`;
    $('#resGalleryCount').textContent = `${count} / ${DOGS.length}`;
  }

  function renderGallery() {
    const history = getHistory();
    const unlocked = new Set(history.map((item) => item.id));

    $('#galleryGrid').innerHTML = DOGS.map((dog) => {
      const isOpen = unlocked.has(dog.id);
      const visual = isOpen
        ? `<img src="assets/dogs/${dog.id}.jpg" alt="${dog.name}" loading="lazy">`
        : `<span class="g-lock" aria-hidden="true">
             <svg viewBox="0 0 64 64"><ellipse cx="18" cy="21" rx="7" ry="9"/><ellipse cx="32" cy="14" rx="7" ry="9"/><ellipse cx="46" cy="21" rx="7" ry="9"/><ellipse cx="32" cy="43" rx="14" ry="11"/></svg>
           </span>`;
      const name = isOpen ? dog.name : (dog.hidden ? '隐藏款' : '？？？');
      const sub = isOpen ? dog.title : (dog.hidden ? '条件很挑' : '还没解锁');
      return `
        <button class="g-card ${isOpen ? '' : 'is-locked'} ${dog.hidden && isOpen ? 'is-rare' : ''}" type="button" data-dog="${dog.id}">
          ${visual}
          ${isOpen && dog.hidden ? '<em class="g-badge">HIDDEN</em>' : ''}
          <b>${name}</b>
          <span>${sub}</span>
        </button>`;
    }).join('');

    $$('#galleryGrid .g-card').forEach((card) => {
      card.addEventListener('click', () => {
        const dog = dogById(card.dataset.dog);
        if (!unlocked.has(dog.id)) {
          toast(dog.hidden ? `隐藏款触发条件：${dog.unlockAt.replace('隐藏款 · ', '')}` : '还没解锁，测出它就会亮起来');
          return;
        }
        openDogSheet(dog);
      });
    });
  }

  function openDogSheet(dog) {
    const best = dogById(dog.best);
    const worst = dogById(dog.worst);
    $('#dogSheetName').textContent = `${dog.name} · ${dog.title}`;
    $('#dogSheetBody').innerHTML = `
      <div class="dog-sheet-top">
        <img src="assets/dogs/${dog.id}.jpg" alt="${dog.name}">
        <div>
          <p>${dog.en}</p>
          <div class="dog-sheet-tags">${dog.tags.map((t) => `<span>${t}</span>`).join('')}</div>
        </div>
      </div>
      <p class="dog-sheet-desc">${dog.desc}</p>
      <div class="section-head"><h3>日常表现</h3></div>
      <ul class="traits">${dog.traits.map((t) => `<li>${t}</li>`).join('')}</ul>
      <div class="section-head"><h3>别人容易误会你</h3></div>
      <ul class="traits is-misread">${dog.misread.map((t) => `<li>${t}</li>`).join('')}</ul>
      <div class="section-head"><h3>狗际关系</h3></div>
      <div class="pair-grid">
        <div class="pair-card is-best">
          <span class="pair-label">最合拍</span>
          <img src="assets/dogs/${best.id}.jpg" alt="">
          <b>${best.name} · ${best.title}</b>
          <p>${dog.bestWhy}</p>
        </div>
        <div class="pair-card is-worst">
          <span class="pair-label">容易互相看不懂</span>
          <img src="assets/dogs/${worst.id}.jpg" alt="">
          <b>${worst.name} · ${worst.title}</b>
          <p>${dog.worstWhy}</p>
        </div>
      </div>`;
    openSheet('#dogSheet');
  }

  /* ---------------- 弹层 ---------------- */
  let lastFocused = null;

  function openSheet(sel) {
    lastFocused = document.activeElement;
    const sheet = $(sel);
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const closeBtn = $('.icon-btn', sheet);
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeSheet(sheet) {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
  }

  function closeAllSheets() {
    $$('.sheet.is-open').forEach(closeSheet);
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('is-show'), 2200);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#btnStart').addEventListener('click', startQuiz);
    $('#btnRetry').addEventListener('click', startQuiz);
    $('#btnFriendStart').addEventListener('click', startQuiz);

    $('#btnShare').addEventListener('click', shareResult);
    $('#btnHome').addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      showScreen('screen-intro');
    });
    $('#btnPoster').addEventListener('click', () => {
      savePoster().catch((e) => {
        console.error('poster failed', e);
        toast('保存失败，可以长按或右键截图');
      });
    });

    const goPair = () => {
      showScreen('screen-pair');
      renderPairSlots();
      renderPairResult();
      if (location.hash !== '#pair') history.replaceState(null, '', `${location.pathname}${location.search}#pair`);
    };
    $('#btnPairIntro').addEventListener('click', goPair);
    $('#btnPairFromResult').addEventListener('click', goPair);
    $('#btnPairHome').addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      pairState.a = null;
      pairState.b = null;
      showScreen('screen-intro');
    });
    $('#btnPairShare').addEventListener('click', sharePair);
    $('#btnPairMine').addEventListener('click', startQuiz);
    $('#slotA').addEventListener('click', () => openPicker('a'));
    $('#slotB').addEventListener('click', () => openPicker('b'));
    $('#btnClosePick').addEventListener('click', () => closeSheet($('#pickSheet')));
    $('#btnClosePoster').addEventListener('click', () => closeSheet($('#posterSheet')));

    $('#btnBack').addEventListener('click', () => {
      if (state.index === 0) {
        showScreen('screen-intro');
        return;
      }
      state.index -= 1;
      state.answers = state.answers.slice(0, state.index);
      $('#qOptions').classList.remove('is-busy');
      renderQuestion();
    });

    const openGallery = () => {
      renderGallery();
      refreshGalleryCounts();
      openSheet('#gallerySheet');
    };
    $('#btnGalleryIntro').addEventListener('click', openGallery);
    $('#btnGalleryRes').addEventListener('click', openGallery);
    $('#btnFriendGallery').addEventListener('click', openGallery);
    $('#btnCloseGallery').addEventListener('click', () => closeSheet($('#gallerySheet')));
    $('#btnCloseDog').addEventListener('click', () => closeSheet($('#dogSheet')));

    $$('.sheet').forEach((sheet) => {
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) closeSheet(sheet);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllSheets();
      const onQuiz = $('#screen-quiz').classList.contains('is-active');
      if (!onQuiz) return;
      if (/^[1-4]$/.test(e.key)) {
        const btn = $$('.option', $('#qOptions'))[Number(e.key) - 1];
        if (btn) btn.click();
      }
    });

    window.addEventListener('hashchange', routeFromHash);
  }

  /* ---------------- 启动路由 ---------------- */
  function routeFromHash() {
    const match = location.hash.match(/^#r=(.+)$/);
    if (match) {
      const result = decodeState(match[1]);
      if (!result) {
        history.replaceState(null, '', location.pathname + location.search);
        return false;
      }
      closeAllSheets();
      renderFriend(result);
      showScreen('screen-friend');
      return true;
    }

    const pairMatch = location.hash.match(/^#p=([a-z]+)-([a-z]+)$/);
    if (pairMatch) {
      const a = dogById(pairMatch[1]);
      const b = dogById(pairMatch[2]);
      if (!a || !b) {
        history.replaceState(null, '', location.pathname + location.search);
        return false;
      }
      closeAllSheets();
      pairState.a = a;
      pairState.b = b;
      renderPairSlots();
      renderPairResult();
      showScreen('screen-pair');
      return true;
    }

    if (location.hash === '#pair') {
      closeAllSheets();
      renderPairSlots();
      renderPairResult();
      showScreen('screen-pair');
      return true;
    }

    if (location.hash === '#faq') {
      showScreen('screen-intro');
      return true;
    }

    return false;
  }

  function init() {
    bind();
    refreshGalleryCounts();
    if (!routeFromHash()) showScreen('screen-intro');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
