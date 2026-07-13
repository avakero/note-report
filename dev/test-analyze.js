/* noteAnalyze の煙テスト: スナップショット保存と前回比較の選択ロジック */
const fs = require('fs');
let src = fs.readFileSync(require('path').join(__dirname, '..', 'note-tool.js'), 'utf8');
src = src.replace(/window\.noteAnalyze\(\);\s*$/, '');
global.window = {};
global.location = { pathname: '/testuser' };
global.navigator = { userAgent: 'test' };
global.confirm = () => true;

// localStorage モック
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// note API モック
const HERO_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]); // ダミーJPEG
global.fetch = async (u) => {
  const json = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  if (u.includes('brand-collab.json')) {
    return { ok: true, json: async () => ({ enabled: true, hero: 'hero-collab.jpg', credit: '🤝 テストコラボ × あばけろ君' }) };
  }
  if (u.includes('hero-collab.jpg')) {
    return { ok: true, arrayBuffer: async () => HERO_BYTES.buffer, headers: { get: () => 'image/jpeg' } };
  }
  if (u.includes('notice')) return { ok: false, status: 404 };
  if (u.startsWith('/api/v1/stats/pv')) {
    return json({
      total_pv: 780, total_like: 47, total_comment: 4, last_calculate_at: '2026-07-12 06:00',
      last_page: true,
      note_stats: [
        { key: 'a1', read_count: 500, user: { urlname: 'testuser' } },
        { key: 'a2', read_count: 280 },
      ],
    });
  }
  if (u.includes('/contents')) {
    return json({
      isLastPage: true,
      contents: [
        { key: 'a1', name: '記事その1', publishAt: '2026-07-01T09:00:00+09:00', likeCount: 30, commentCount: 3, hashtags: [] },
        { key: 'a2', name: '記事その2', publishAt: '2026-07-10T21:00:00+09:00', likeCount: 17, commentCount: 1, hashtags: [] },
      ],
    });
  }
  if (u.includes('/followers')) {
    return json({ totalCount: 1, isLastPage: true, follows: [{ urlname: 'fan1' }] });
  }
  if (u.includes('/likes')) {
    if (u.includes('page=1')) {
      return json({ likes: [
        { created_at: '2026-07-11T21:10:00+09:00', user: { urlname: 'fan1', nickname: 'ファン1', follower_count: 5 } },
        { created_at: '2026-07-12T08:05:00+09:00', user: { urlname: 'fan2', nickname: 'ファン2', follower_count: 9 } },
      ] });
    }
    return json({ likes: [] });
  }
  // 売上なしアカウント: 明細は空（機能追加版では直近2か月の様子見だけで打ち切られる想定）
  if (u.startsWith('/api/v1/stats/purchasers')) {
    return json({ last_page: true, purchasers: [] });
  }
  throw new Error('unexpected url: ' + u);
};

let captured = null;
(async () => {
  eval(src);
  const realBuild = window.__noteBuildHtml;
  window.__noteBuildHtml = (d) => { captured = d; return realBuild(d); };

  // --- 実行1回目: スナップショットなし ---
  const r1 = await window.noteAnalyze({ download: false, delay: 0 });
  if (!r1 || r1.summary.user !== 'testuser') throw new Error('run1 failed: ' + JSON.stringify(r1));
  if (captured.prevSnap !== null) throw new Error('run1: prevSnap should be null');
  if (captured.snapSaved !== true) throw new Error('run1: snapshot not saved');
  let snaps = JSON.parse(store['noteReportSnaps_testuser']);
  if (snaps.length !== 1) throw new Error('run1: expected 1 snapshot, got ' + snaps.length);
  if (snaps[0].arts.a1[0] !== 500 || snaps[0].arts.a1[1] !== 30) throw new Error('run1: bad snapshot content');
  const dayTotal = Object.values(captured.dayC).reduce((s, v) => s + v, 0);
  if (dayTotal !== 4) throw new Error('run1: bad dayC ' + JSON.stringify(captured.dayC)); // 2記事×2スキ（日付はローカルTZ依存）
  console.log('run1 (初回・保存のみ) OK');

  // --- 実行2回目（同日）: prevSnap は出ず、今日の分が上書きされる ---
  localStorage.setItem('noteAnalyzeLastRun', '0'); // クールダウン回避
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.prevSnap !== null) throw new Error('run2: same-day snapshot must not be used as prev');
  snaps = JSON.parse(store['noteReportSnaps_testuser']);
  if (snaps.length !== 1) throw new Error('run2: same-day run should overwrite, got ' + snaps.length);
  console.log('run2 (同日再実行・上書き) OK');

  // --- 実行3回目: きのうのスナップショットを仕込む → prevSnap に選ばれる ---
  const yesterday = { at: Date.now() - 86400000, totPV: 700, totLike: 40, totCmt: 4, fol: 0, arts: { a1: [480, 28, 3], a2: [180, 10, 1] } };
  store['noteReportSnaps_testuser'] = JSON.stringify([yesterday, JSON.parse(store['noteReportSnaps_testuser'])[0]]);
  localStorage.setItem('noteAnalyzeLastRun', '0');
  const r3 = await window.noteAnalyze({ download: false, delay: 0 });
  if (!captured.prevSnap || captured.prevSnap.totPV !== 700) throw new Error('run3: yesterday snapshot not selected as prev');
  snaps = JSON.parse(store['noteReportSnaps_testuser']);
  if (snaps.length !== 2) throw new Error('run3: expected 2 snapshots (yesterday + today), got ' + snaps.length);
  if (!Array.isArray(captured.snapHist) || captured.snapHist.length !== 2) throw new Error('run3: snapHist should have 2 entries');
  const html = realBuild(captured);
  for (const needle of ['1日前', '+80', '伸びた記事', '1日ごとのPVの伸び', '1日ごとのスキの伸び']) {
    if (!html.includes(needle)) throw new Error('run3 html missing: ' + needle);
  }
  if (captured.sales != null) throw new Error('run3: sales should be null without paid articles');
  if (html.includes('有料noteの売上')) throw new Error('run3: sales section should be hidden');
  console.log('run3 (前日比較) OK');

  // --- 実行4回目: 402日ぶんの履歴を仕込む → 400日に収まり、明細は直近30件だけ残る ---
  const longHist = [];
  for (let i = 402; i >= 1; i--) {
    longHist.push({ at: Date.now() - i * 86400000, totPV: 100 + i, totLike: 10, totCmt: 1, fol: 5, arts: { a1: [100, 5, 1] } });
  }
  store['noteReportSnaps_testuser'] = JSON.stringify(longHist);
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  snaps = JSON.parse(store['noteReportSnaps_testuser']);
  if (snaps.length !== 400) throw new Error('run4: expected 400 snapshots, got ' + snaps.length);
  const withArts = snaps.filter((s) => s.arts).length;
  if (withArts !== 30) throw new Error('run4: expected arts on last 30 only, got ' + withArts);
  if (snaps[0].arts || !snaps[399].arts) throw new Error('run4: arts kept on wrong end');
  if (!captured.prevSnap || !captured.prevSnap.arts) throw new Error('run4: prevSnap should still have arts');
  const html4 = realBuild(captured);
  if (!html4.includes('1日ごとのPVの伸び')) throw new Error('run4: trend chart missing');
  // グラフは直近60日ぶんに制限される（バーの行数で確認）
  const pvChart = html4.split('1日ごとのPVの伸び')[1].split('</div>')[1] || '';
  const barCount = (html4.split('1日ごとのPVの伸び')[1].split('1日ごとのスキの伸び')[0].match(/bar-row/g) || []).length;
  if (barCount !== 60) throw new Error('run4: expected 60 bars, got ' + barCount);
  console.log('run4 (400日保持・明細30件・グラフ60日) OK');

  // --- 実行5回目: コラボ基本版（__NOTE_CHANNEL='collab'）→ liteMode、ただし記録は保存される ---
  window.__NOTE_CHANNEL = 'collab';
  localStorage.setItem('noteAnalyzeLastRun', '0');
  delete store['noteReportSnaps_testuser'];
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.liteMode !== true) throw new Error('run5: collab channel should set liteMode');
  if (captured.sales != null) throw new Error('run5: sales fetch must be skipped in lite mode');
  if (!store['noteReportSnaps_testuser']) throw new Error('run5: snapshot must still be saved in lite mode');
  const html5 = realBuild(captured);
  if (html5.includes('前回とくらべて') || html5.includes('日別スキの推移')) throw new Error('run5: new sections should be hidden');
  console.log('run5 (コラボ基本版: 非表示だが記録は継続) OK');

  // --- 実行6回目: コラボ機能追加版（__NOTE_PLUS=true）→ フル表示 ---
  window.__NOTE_PLUS = true;
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.liteMode !== false) throw new Error('run6: collab+plus should be full mode');
  const html6 = realBuild(captured);
  if (!html6.includes('前回とくらべて') || !html6.includes('日別スキの推移')) throw new Error('run6: new sections missing');
  console.log('run6 (コラボ機能追加版: フル表示) OK');

  // --- 実行7回目: __NOTE_BASE設定 → ブランド枠でヒーロー画像とクレジットが差し替わる ---
  if (captured.credit != null) throw new Error('run6: credit should be null without __NOTE_BASE');
  window.__NOTE_BASE = 'https://example.test/';
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  const expectedB64 = Buffer.from(HERO_BYTES).toString('base64');
  if (captured.heroImg !== 'data:image/jpeg;base64,' + expectedB64) throw new Error('run7: heroImg not replaced: ' + String(captured.heroImg).slice(0, 60));
  if (captured.credit !== '🤝 テストコラボ × あばけろ君') throw new Error('run7: credit not set');
  const html7 = realBuild(captured);
  if (!html7.includes('🤝 テストコラボ × あばけろ君')) throw new Error('run7: credit missing in footer');
  if (!html7.includes('data:image/jpeg;base64,')) throw new Error('run7: hero img missing in html');
  console.log('run7 (ブランド差し替え: 画像＋クレジット) OK');

  // --- 実行8回目: brand が404 → あばけろ君にフォールバック ---
  const origFetch = global.fetch;
  global.fetch = async (u) => {
    if (u.includes('brand-')) return { ok: false, status: 404 };
    return origFetch(u);
  };
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.heroImg !== window.__NOTE_HERO) throw new Error('run8: should fall back to default hero');
  if (captured.credit != null) throw new Error('run8: credit should be null on 404');
  global.fetch = origFetch;
  console.log('run8 (brandなし: 標準デザインにフォールバック) OK');

  // --- 実行9回目: 機能追加版で有料記事あり＋売上あり → 集計・返金除外・マガジン対応 ---
  const now9 = new Date();
  const span9 = '' + now9.getFullYear() + String(now9.getMonth() + 1).padStart(2, '0');
  const salesMock = async (u) => {
    if (u.includes('/contents')) {
      return { ok: true, status: 200, json: async () => ({ data: {
        isLastPage: true,
        contents: [
          { key: 'a1', name: '記事その1', publishAt: '2026-07-01T09:00:00+09:00', likeCount: 30, commentCount: 3, hashtags: [], price: 500 },
          { key: 'a2', name: '記事その2', publishAt: '2026-07-10T21:00:00+09:00', likeCount: 17, commentCount: 1, hashtags: [] },
        ],
      } }) };
    }
    if (u.startsWith('/api/v1/stats/purchasers')) {
      // month=true と filter= が無いと実APIは400を返す（2026-07-13確認）
      if (!u.includes('month=true') || !u.includes('filter=')) throw new Error('purchasers: missing required params: ' + u);
      const span = (u.match(/datespan=(\d{6})/) || [])[1];
      const page = (u.match(/page=(\d+)/) || [])[1];
      if (span === span9 && page === '1') {
        return { ok: true, status: 200, json: async () => ({ data: { last_page: true, purchasers: [
          { price: 500, content: { key: 'a1', name: '記事その1' } },
          { price: 500, content: { key: 'a1', name: '記事その1' } },
          { price: 300, is_refund: true, content: { key: 'a1', name: '記事その1' } }, // 返金 → 除外
          { price: 800, purchase_content_key: 'm1' }, // 記事一覧にない商品（マガジン等）
        ] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { last_page: true, purchasers: [] } }) };
    }
    return origFetch(u);
  };
  global.fetch = salesMock;
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  const s9 = captured.sales;
  if (!s9) throw new Error('run9: sales missing');
  if (s9.count !== 3 || s9.amount !== 1800) throw new Error('run9: bad totals ' + JSON.stringify({ count: s9.count, amount: s9.amount }));
  if (!s9.byArt.a1 || s9.byArt.a1.count !== 2 || s9.byArt.a1.amount !== 1000) throw new Error('run9: bad byArt.a1 ' + JSON.stringify(s9.byArt.a1));
  if (!s9.byArt.m1 || s9.byArt.m1.count !== 1 || s9.byArt.m1.amount !== 800) throw new Error('run9: bad byArt.m1 ' + JSON.stringify(s9.byArt.m1));
  if (s9.monthly.length !== 12) throw new Error('run9: expected 12 months, got ' + s9.monthly.length);
  if (s9.monthly[11].amount !== 1800 || s9.monthly[10].amount !== 0) throw new Error('run9: bad monthly ' + JSON.stringify(s9.monthly.slice(-2)));
  const html9 = realBuild(captured);
  for (const needle of ['有料noteの売上', '直近12か月の売上', '&yen;1,800', '（マガジン・その他の商品）']) {
    if (!html9.includes(needle)) throw new Error('run9 html missing: ' + needle);
  }
  // AI相談プロンプト（__noteAISection）にも売上1行が入る
  const ai9 = window.__noteAISection(captured);
  if (!ai9.includes('有料noteの売上(直近12か月・返金除く): 1800円（販売3件）')) throw new Error('run9: AI prompt sales line missing');
  console.log('run9 (機能追加版・売上セクション: 集計・返金除外・マガジン) OK');

  // --- 実行10回目: 通常版（チャンネル・PLUSなし）では有料記事＋売上があっても売上機能は出ない ---
  delete window.__NOTE_CHANNEL;
  delete window.__NOTE_PLUS;
  delete window.__NOTE_BASE;
  global.fetch = salesMock;
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.sales != null) throw new Error('run10: sales must be plus-only');
  const html10 = realBuild(captured);
  if (html10.includes('有料noteの売上')) throw new Error('run10: sales section should be hidden in normal version');
  global.fetch = origFetch;
  console.log('run10 (通常版: 売上は機能追加版限定) OK');
  console.log('ALL OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
