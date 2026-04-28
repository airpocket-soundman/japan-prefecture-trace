(async function () {
  'use strict';

  const W = 900;
  const H = 700;
  const PAD = 16;

  const MAIN_BBOX = {
    type: 'Polygon',
    coordinates: [[[122, 23.5], [146.5, 23.5], [146.5, 46], [122, 46], [122, 23.5]]]
  };

  const SAMPLE_STEP = 4;
  const SCORE_THRESHOLD_PX = 60;
  const MIN_DRAW_DIST = 2;

  const SCALE_MIN = 0.7;
  const SCALE_MAX = 40;
  const ZOOM_BTN_FACTOR = 1.5;

  const svg = d3.select('#map');
  const content = svg.select('#content');
  const layerBase = svg.select('#layer-base');
  const layerAnswer = svg.select('#layer-answer');
  const layerUser = svg.select('#layer-user');

  const elMap = svg.node();
  const elPrefName = document.getElementById('prefName');
  const elMessage = document.getElementById('message');
  const elScore = document.getElementById('score');
  const btnUndo = document.getElementById('btn-undo');
  const btnClear = document.getElementById('btn-clear');
  const btnSubmit = document.getElementById('btn-submit');
  const btnNext = document.getElementById('btn-next');
  const btnPen = document.getElementById('btn-pen');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  let topo, features;
  let projection, pathFn;
  let validTargets = [];

  let target = null;
  let strokes = [];
  let submitted = false;
  let recentIds = [];

  let penMode = true;
  const view = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let drawingPointerId = null;
  let panState = null;
  let pinchState = null;

  try {
    topo = await d3.json('data/japan.topojson');
  } catch (err) {
    elMessage.textContent = '地図データの読み込みに失敗しました。';
    console.error(err);
    return;
  }

  const fc = topojson.feature(topo, topo.objects.japan);
  features = fc.features;

  projection = d3.geoMercator().fitExtent([[PAD, PAD], [W - PAD, H - PAD]], MAIN_BBOX);
  pathFn = d3.geoPath(projection);

  renderBase();

  validTargets = features.filter(f => {
    const m = innerMeshOf(f.properties.id);
    return m.coordinates.length > 0;
  });

  applyTransform();
  setPenMode(true);
  pickTarget();
  attachHandlers();

  function innerMeshOf(prefId) {
    return topojson.mesh(topo, topo.objects.japan, (a, b) =>
      a !== b && (a.properties.id === prefId || b.properties.id === prefId)
    );
  }

  function renderBase() {
    const land = topojson.merge(topo, topo.objects.japan.geometries);
    layerBase.append('path')
      .attr('class', 'land')
      .attr('d', pathFn(land));
  }

  function pickTarget() {
    let pool = validTargets.filter(f => !recentIds.includes(f.properties.id));
    if (pool.length === 0) {
      recentIds = [];
      pool = validTargets;
    }
    target = pool[Math.floor(Math.random() * pool.length)];
    recentIds.push(target.properties.id);
    if (recentIds.length > 12) recentIds.shift();

    const innerMesh = innerMeshOf(target.properties.id);
    target.innerProjected = innerMesh.coordinates
      .map(line => line.map(c => projection(c)).filter(p => p && isFinite(p[0]) && isFinite(p[1])))
      .filter(line => line.length >= 2);

    target.innerSamples = [];
    for (const line of target.innerProjected) {
      sampleLine(line, SAMPLE_STEP, target.innerSamples);
    }

    elPrefName.textContent = target.properties.nam_ja;
    elMessage.textContent = '';
  }

  function sampleLine(line, step, output) {
    if (!line || line.length < 2) return;
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.ceil(len / step));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        output.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      }
    }
    output.push(line[line.length - 1]);
  }

  function minDist2(p, points) {
    let min = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = p[0] - points[i][0];
      const dy = p[1] - points[i][1];
      const d = dx * dx + dy * dy;
      if (d < min) min = d;
    }
    return min;
  }

  function scoreDrawing() {
    const userPts = [];
    for (const s of strokes) sampleLine(s, SAMPLE_STEP, userPts);

    if (userPts.length === 0 || target.innerSamples.length === 0) {
      return { score: 0, avg: 0, d1: 0, d2: 0 };
    }

    let s1 = 0;
    for (const p of userPts) s1 += Math.sqrt(minDist2(p, target.innerSamples));
    const d1 = s1 / userPts.length;

    let s2 = 0;
    for (const p of target.innerSamples) s2 += Math.sqrt(minDist2(p, userPts));
    const d2 = s2 / target.innerSamples.length;

    const avg = (d1 + d2) / 2;
    const score = Math.max(0, Math.min(100, 100 * (1 - avg / SCORE_THRESHOLD_PX)));
    return { score: Math.round(score), avg, d1, d2 };
  }

  function pointerToSvg(evt) {
    const rect = elMap.getBoundingClientRect();
    return [
      (evt.clientX - rect.left) * (W / rect.width),
      (evt.clientY - rect.top) * (H / rect.height)
    ];
  }

  function svgToContent([x, y]) {
    return [(x - view.x) / view.k, (y - view.y) / view.k];
  }

  function pointerToContent(evt) {
    return svgToContent(pointerToSvg(evt));
  }

  function applyTransform() {
    content.attr('transform', `translate(${view.x}, ${view.y}) scale(${view.k})`);
  }

  function clampScale(k) {
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, k));
  }

  function zoomAtSvg(svgX, svgY, factor) {
    const newK = clampScale(view.k * factor);
    const realFactor = newK / view.k;
    view.x = svgX - (svgX - view.x) * realFactor;
    view.y = svgY - (svgY - view.y) * realFactor;
    view.k = newK;
    applyTransform();
  }

  function resetView() {
    view.x = 0;
    view.y = 0;
    view.k = 1;
    applyTransform();
  }

  const lineGen = d3.line();

  function redrawUserStrokes() {
    layerUser.selectAll('path')
      .data(strokes)
      .join('path')
      .attr('class', 'user-stroke')
      .attr('d', d => lineGen(d));
  }

  function showAnswer() {
    layerAnswer.selectAll('*').remove();
    for (const line of target.innerProjected) {
      layerAnswer.append('path')
        .attr('class', 'answer-line')
        .attr('d', lineGen(line));
    }
  }

  function clearUserDrawing() {
    strokes = [];
    layerUser.selectAll('*').remove();
  }

  function gradeText(s) {
    if (s >= 92) return '★★★ パーフェクト！';
    if (s >= 80) return '★★☆ すばらしい！';
    if (s >= 65) return '★☆☆ よくできました';
    if (s >= 45) return 'もうひと息！';
    if (s >= 20) return '練習あるのみ';
    return 'ファイト！';
  }

  function setPenMode(on) {
    penMode = !!on;
    if (penMode) {
      btnPen.classList.remove('pen-off');
      btnPen.classList.add('pen-on');
      btnPen.querySelector('.pen-label').textContent = 'ペン ON';
      elMap.classList.remove('pen-off');
    } else {
      btnPen.classList.remove('pen-on');
      btnPen.classList.add('pen-off');
      btnPen.querySelector('.pen-label').textContent = 'ペン OFF';
      elMap.classList.add('pen-off');
      cancelInProgressDraw();
    }
  }

  function cancelInProgressDraw() {
    if (drawingPointerId !== null) {
      const last = strokes[strokes.length - 1];
      if (last && last.length < 2) strokes.pop();
      drawingPointerId = null;
      redrawUserStrokes();
    }
  }

  function startStroke(contentPt) {
    const stroke = [contentPt];
    strokes.push(stroke);
    redrawUserStrokes();
    return stroke;
  }

  function appendStroke(contentPt) {
    const stroke = strokes[strokes.length - 1];
    if (!stroke) return;
    const last = stroke[stroke.length - 1];
    const screenDist = Math.hypot(contentPt[0] - last[0], contentPt[1] - last[1]) * view.k;
    if (screenDist >= MIN_DRAW_DIST) {
      stroke.push(contentPt);
      redrawUserStrokes();
    }
  }

  function attachHandlers() {
    elMap.addEventListener('pointerdown', onPointerDown);
    elMap.addEventListener('pointermove', onPointerMove);
    elMap.addEventListener('pointerup', onPointerEnd);
    elMap.addEventListener('pointercancel', onPointerEnd);
    elMap.addEventListener('pointerleave', evt => {
      if (pointers.has(evt.pointerId)) onPointerEnd(evt);
    });

    elMap.addEventListener('wheel', onWheel, { passive: false });

    elMap.addEventListener('contextmenu', evt => evt.preventDefault());

    btnUndo.addEventListener('click', () => {
      if (submitted) return;
      strokes.pop();
      redrawUserStrokes();
    });

    btnClear.addEventListener('click', () => {
      if (submitted) return;
      clearUserDrawing();
    });

    btnSubmit.addEventListener('click', onSubmit);
    btnNext.addEventListener('click', onNext);

    btnPen.addEventListener('click', () => setPenMode(!penMode));

    btnZoomIn.addEventListener('click', () => zoomAtSvg(W / 2, H / 2, ZOOM_BTN_FACTOR));
    btnZoomOut.addEventListener('click', () => zoomAtSvg(W / 2, H / 2, 1 / ZOOM_BTN_FACTOR));
    btnZoomReset.addEventListener('click', resetView);

    document.addEventListener('keydown', evt => {
      if (evt.target && (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA')) return;
      if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
      const k = evt.key;
      if (k === 'z' || k === 'Z' || k === 'Backspace') {
        if (!submitted) {
          strokes.pop();
          redrawUserStrokes();
        }
      } else if (k === 'Enter') {
        if (!submitted) btnSubmit.click();
        else btnNext.click();
      } else if (k === 'c' || k === 'C') {
        if (!submitted) clearUserDrawing();
      } else if (k === 'p' || k === 'P') {
        setPenMode(!penMode);
      } else if (k === '0') {
        resetView();
      } else if (k === '+' || k === '=') {
        zoomAtSvg(W / 2, H / 2, ZOOM_BTN_FACTOR);
      } else if (k === '-' || k === '_') {
        zoomAtSvg(W / 2, H / 2, 1 / ZOOM_BTN_FACTOR);
      }
    });
  }

  function onPointerDown(evt) {
    if (evt.button && evt.button !== 0) return;
    evt.preventDefault();

    pointers.set(evt.pointerId, {
      clientX: evt.clientX,
      clientY: evt.clientY,
      type: evt.pointerType
    });

    if (pointers.size === 2) {
      cancelInProgressDraw();
      panState = null;
      const [a, b] = pointers.values();
      const midClient = [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
      const midSvg = clientToSvg(midClient[0], midClient[1]);
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchState = {
        midSvg,
        dist,
        view: { ...view }
      };
      return;
    }

    if (pointers.size > 2) return;

    if (penMode && !submitted) {
      try { elMap.setPointerCapture(evt.pointerId); } catch (_) {}
      drawingPointerId = evt.pointerId;
      const cp = pointerToContent(evt);
      startStroke(cp);
    } else {
      try { elMap.setPointerCapture(evt.pointerId); } catch (_) {}
      panState = {
        pointerId: evt.pointerId,
        startSvg: pointerToSvg(evt),
        view: { ...view }
      };
    }
  }

  function onPointerMove(evt) {
    if (!pointers.has(evt.pointerId)) return;
    const rec = pointers.get(evt.pointerId);
    rec.clientX = evt.clientX;
    rec.clientY = evt.clientY;

    if (pinchState && pointers.size >= 2) {
      const its = [...pointers.values()];
      const a = its[0], b = its[1];
      const midClient = [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
      const midSvg = clientToSvg(midClient[0], midClient[1]);
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchState.dist;
      const newK = clampScale(pinchState.view.k * ratio);
      const realRatio = newK / pinchState.view.k;
      const cInit = [
        (pinchState.midSvg[0] - pinchState.view.x) / pinchState.view.k,
        (pinchState.midSvg[1] - pinchState.view.y) / pinchState.view.k
      ];
      view.k = newK;
      view.x = midSvg[0] - cInit[0] * newK;
      view.y = midSvg[1] - cInit[1] * newK;
      applyTransform();
      return;
    }

    if (drawingPointerId === evt.pointerId) {
      const cp = pointerToContent(evt);
      appendStroke(cp);
      return;
    }

    if (panState && panState.pointerId === evt.pointerId) {
      const cur = pointerToSvg(evt);
      view.x = panState.view.x + (cur[0] - panState.startSvg[0]);
      view.y = panState.view.y + (cur[1] - panState.startSvg[1]);
      applyTransform();
    }
  }

  function onPointerEnd(evt) {
    if (!pointers.has(evt.pointerId)) return;
    pointers.delete(evt.pointerId);

    if (drawingPointerId === evt.pointerId) {
      drawingPointerId = null;
    }

    if (panState && panState.pointerId === evt.pointerId) {
      panState = null;
    }

    if (pinchState && pointers.size < 2) {
      pinchState = null;
      if (pointers.size === 1) {
        const [remaining] = pointers.values();
        const remainingId = [...pointers.keys()][0];
        const fakeEvt = { clientX: remaining.clientX, clientY: remaining.clientY };
        if (!penMode) {
          panState = {
            pointerId: remainingId,
            startSvg: clientToSvg(fakeEvt.clientX, fakeEvt.clientY),
            view: { ...view }
          };
        }
      }
    }
  }

  function clientToSvg(cx, cy) {
    const rect = elMap.getBoundingClientRect();
    return [(cx - rect.left) * (W / rect.width), (cy - rect.top) * (H / rect.height)];
  }

  function onWheel(evt) {
    evt.preventDefault();
    const [sx, sy] = pointerToSvg(evt);
    const factor = Math.pow(1.0015, -evt.deltaY);
    zoomAtSvg(sx, sy, factor);
  }

  function onSubmit() {
    if (submitted) return;
    if (strokes.length === 0 || strokes.every(s => s.length < 2)) {
      elMessage.textContent = '線を描いてから判定してください';
      return;
    }
    const result = scoreDrawing();
    submitted = true;
    showAnswer();

    elScore.hidden = false;
    elScore.innerHTML = `
      <div class="score-num"><strong>${result.score}</strong><span>点</span></div>
      <div class="score-grade">${gradeText(result.score)}</div>
      <div class="score-detail">平均誤差 ${result.avg.toFixed(1)} px</div>
    `;

    btnSubmit.hidden = true;
    btnUndo.hidden = true;
    btnClear.hidden = true;
    btnNext.hidden = false;
    elMessage.textContent = '';
  }

  function onNext() {
    submitted = false;
    clearUserDrawing();
    layerAnswer.selectAll('*').remove();
    elScore.hidden = true;
    btnSubmit.hidden = false;
    btnUndo.hidden = false;
    btnClear.hidden = false;
    btnNext.hidden = true;
    pickTarget();
  }
})();
