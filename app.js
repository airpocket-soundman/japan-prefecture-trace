(async function () {
  'use strict';

  const W = 900;
  const H = 700;
  const PAD = 16;

  const INSET_W = 170;
  const INSET_H = 120;
  const INSET_X = PAD;
  const INSET_Y = PAD;

  const OKINAWA_ID = 47;

  const MAIN_BBOX = {
    type: 'Polygon',
    coordinates: [[[128.5, 30.3], [146.5, 30.3], [146.5, 46], [128.5, 46], [128.5, 30.3]]]
  };
  const OKI_BBOX = {
    type: 'Polygon',
    coordinates: [[[122, 24], [129.5, 24], [129.5, 27.5], [122, 27.5], [122, 24]]]
  };

  const SAMPLE_STEP = 4;
  const SCORE_THRESHOLD_PX = 60;
  const MIN_DRAW_DIST = 2;

  const svg = d3.select('#map');
  const layerBase = svg.select('#layer-base');
  const layerAnswer = svg.select('#layer-answer');
  const layerUser = svg.select('#layer-user');
  const layerLabels = svg.select('#layer-labels');

  const elPrefName = document.getElementById('prefName');
  const elMessage = document.getElementById('message');
  const elScore = document.getElementById('score');
  const btnUndo = document.getElementById('btn-undo');
  const btnClear = document.getElementById('btn-clear');
  const btnSubmit = document.getElementById('btn-submit');
  const btnNext = document.getElementById('btn-next');

  let topo, features, mainFeatures, okinawaFeature;
  let projMain, projOki;
  let pathMain, pathOki;
  let validTargets = [];

  let target = null;
  let strokes = [];
  let currentStroke = null;
  let submitted = false;
  let recentIds = [];

  try {
    topo = await d3.json('data/japan.topojson');
  } catch (err) {
    elMessage.textContent = '地図データの読み込みに失敗しました。';
    console.error(err);
    return;
  }

  const fc = topojson.feature(topo, topo.objects.japan);
  features = fc.features;
  okinawaFeature = features.find(f => f.properties.id === OKINAWA_ID);
  mainFeatures = features.filter(f => f.properties.id !== OKINAWA_ID);

  projMain = d3.geoMercator().fitExtent(
    [[PAD, PAD], [W - PAD, H - PAD]],
    MAIN_BBOX
  );
  pathMain = d3.geoPath(projMain);

  projOki = d3.geoMercator().fitExtent(
    [[INSET_X, INSET_Y], [INSET_X + INSET_W, INSET_Y + INSET_H]],
    OKI_BBOX
  );
  pathOki = d3.geoPath(projOki);

  renderBase();
  renderLabels();

  validTargets = mainFeatures.filter(f => {
    const m = innerMeshOf(f.properties.id);
    return m.coordinates.length > 0;
  });

  pickTarget();
  attachHandlers();

  function innerMeshOf(prefId) {
    return topojson.mesh(topo, topo.objects.japan, (a, b) =>
      a !== b && (a.properties.id === prefId || b.properties.id === prefId)
    );
  }

  function renderBase() {
    const mainGeoms = topo.objects.japan.geometries.filter(g => g.properties.id !== OKINAWA_ID);
    const okiGeoms = topo.objects.japan.geometries.filter(g => g.properties.id === OKINAWA_ID);
    const landMain = topojson.merge(topo, mainGeoms);
    const landOki = topojson.merge(topo, okiGeoms);

    layerBase.append('path')
      .attr('class', 'land')
      .attr('d', pathMain(landMain));

    layerBase.append('rect')
      .attr('class', 'inset-bg')
      .attr('x', INSET_X - 6)
      .attr('y', INSET_Y - 6)
      .attr('width', INSET_W + 12)
      .attr('height', INSET_H + 12);

    layerBase.append('rect')
      .attr('class', 'inset-frame')
      .attr('x', INSET_X - 6)
      .attr('y', INSET_Y - 6)
      .attr('width', INSET_W + 12)
      .attr('height', INSET_H + 12);

    layerBase.append('path')
      .attr('class', 'land')
      .attr('d', pathOki(landOki));

    layerBase.append('text')
      .attr('class', 'inset-label')
      .attr('x', INSET_X)
      .attr('y', INSET_Y + INSET_H + 8)
      .text('沖縄県');
  }

  function renderLabels() {
    layerLabels.selectAll('text')
      .data(features)
      .enter().append('text')
      .attr('class', 'pref-label')
      .attr('data-id', d => d.properties.id)
      .attr('transform', d => {
        const proj = d.properties.id === OKINAWA_ID ? projOki : projMain;
        const c = labelPosition(d, proj);
        return `translate(${c[0]}, ${c[1]})`;
      })
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => shortName(d.properties.nam_ja));
  }

  function shortName(name) {
    return name.replace(/(都|道|府|県)$/, '');
  }

  function labelPosition(feature, proj) {
    const pathFn = d3.geoPath(proj);
    if (feature.geometry.type === 'MultiPolygon') {
      let maxArea = -Infinity;
      let bestPoly = feature.geometry.coordinates[0];
      for (const poly of feature.geometry.coordinates) {
        const a = d3.geoArea({ type: 'Polygon', coordinates: poly });
        if (a > maxArea) {
          maxArea = a;
          bestPoly = poly;
        }
      }
      return pathFn.centroid({ type: 'Polygon', coordinates: bestPoly });
    }
    return pathFn.centroid(feature);
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
      .map(line => line.map(c => projMain(c)).filter(p => p && isFinite(p[0]) && isFinite(p[1])))
      .filter(line => line.length >= 2);

    target.innerSamples = [];
    for (const line of target.innerProjected) {
      sampleLine(line, SAMPLE_STEP, target.innerSamples);
    }

    elPrefName.textContent = target.properties.nam_ja;
    elMessage.textContent = '';

    layerLabels.selectAll('text').classed('target', false);
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

  function getSvgPoint(evt) {
    const rect = svg.node().getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (W / rect.width);
    const y = (evt.clientY - rect.top) * (H / rect.height);
    return [x, y];
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
    layerLabels.select(`text[data-id="${target.properties.id}"]`).classed('target', true);
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

  function attachHandlers() {
    const node = svg.node();

    node.addEventListener('pointerdown', evt => {
      if (submitted) return;
      evt.preventDefault();
      try { node.setPointerCapture(evt.pointerId); } catch (_) {}
      const p = getSvgPoint(evt);
      currentStroke = [p];
      strokes.push(currentStroke);
      redrawUserStrokes();
    });

    node.addEventListener('pointermove', evt => {
      if (!currentStroke || submitted) return;
      const p = getSvgPoint(evt);
      const last = currentStroke[currentStroke.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_DRAW_DIST) {
        currentStroke.push(p);
        redrawUserStrokes();
      }
    });

    const endStroke = () => { currentStroke = null; };
    node.addEventListener('pointerup', endStroke);
    node.addEventListener('pointercancel', endStroke);
    node.addEventListener('pointerleave', endStroke);

    btnUndo.addEventListener('click', () => {
      if (submitted) return;
      strokes.pop();
      redrawUserStrokes();
    });

    btnClear.addEventListener('click', () => {
      if (submitted) return;
      clearUserDrawing();
    });

    btnSubmit.addEventListener('click', () => {
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
    });

    btnNext.addEventListener('click', () => {
      submitted = false;
      clearUserDrawing();
      layerAnswer.selectAll('*').remove();
      elScore.hidden = true;
      btnSubmit.hidden = false;
      btnUndo.hidden = false;
      btnClear.hidden = false;
      btnNext.hidden = true;
      pickTarget();
    });

    document.addEventListener('keydown', evt => {
      if (evt.target && (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA')) return;
      if (evt.key === 'z' || evt.key === 'Z' || evt.key === 'Backspace') {
        if (!submitted) {
          strokes.pop();
          redrawUserStrokes();
        }
      } else if (evt.key === 'Enter') {
        if (!submitted) btnSubmit.click();
        else btnNext.click();
      } else if (evt.key === 'c' || evt.key === 'C') {
        if (!submitted) clearUserDrawing();
      }
    });
  }
})();
