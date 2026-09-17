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
        // オフセットなし＝ローカル時刻として解釈されるので、テスト実行環境のTZに関係なく「今日」に入る
        const iso9 = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T12:00:00';
        return { ok: true, status: 200, json: async () => ({ data: { last_page: true, purchasers: [
          { price: 500, created_at: iso9(now9), user: { id: 11, nickname: 'ふぁん1', urlname: 'fan1' }, content: { type: 'note', key: 'a1', name: '記事その1' } },
          { price: 500, created_at: iso9(now9), user: { id: 11, nickname: 'ふぁん1', urlname: 'fan1' }, content: { type: 'note', key: 'a1', name: '記事その1' } },
          { price: 300, is_refund: true, created_at: iso9(now9), user: { id: 33, nickname: 'ふぁん2', urlname: 'fan2' }, content: { type: 'note', key: 'a1', name: '記事その1' } }, // 返金 → 除外
          { price: 800, user: { is_guest: true }, purchase_content_key: 'm1' }, // 記事一覧にない商品（マガジン等）・日付なし・ゲスト購入でも壊れない
          // チップ（応援）は content.type === 'user'。メッセージ付き・お礼はまだ
          { price: 200, created_at: iso9(now9), user: { id: 22, nickname: 'おうえん', urlname: 'ouen' },
            content: { type: 'user', key: 'testuser', support_via_content: { key: 'a1', name: '記事その1' } },
            messages: [{ via: 'support', body: 'いつもありがとう' }], already_sent_thankyou: false },
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
  if (s9.count !== 4 || s9.amount !== 2000) throw new Error('run9: bad totals ' + JSON.stringify({ count: s9.count, amount: s9.amount }));
  if (!s9.byArt.a1 || s9.byArt.a1.count !== 2 || s9.byArt.a1.amount !== 1000) throw new Error('run9: bad byArt.a1 ' + JSON.stringify(s9.byArt.a1));
  if (!s9.byArt.m1 || s9.byArt.m1.count !== 1 || s9.byArt.m1.amount !== 800) throw new Error('run9: bad byArt.m1 ' + JSON.stringify(s9.byArt.m1));
  // チップは商品テーブルに混ぜず、別集計にする
  if (s9.byArt.testuser) throw new Error('run9: tip must not go into byArt');
  if (s9.tipCount !== 1 || s9.tipAmount !== 200) throw new Error('run9: bad tip totals ' + JSON.stringify({ c: s9.tipCount, a: s9.tipAmount }));
  if (!s9.tips || s9.tips.length !== 1) throw new Error('run9: tips missing');
  const tip9 = s9.tips[0];
  if (tip9.name !== 'おうえん' || tip9.urlname !== 'ouen' || tip9.price !== 200) throw new Error('run9: bad tip ' + JSON.stringify(tip9));
  if (tip9.item !== '記事その1' || tip9.msg !== 'いつもありがとう' || tip9.thanked !== false) throw new Error('run9: bad tip detail ' + JSON.stringify(tip9));
  // 買ってくれた人は人ごとにまとめる（返金は除外・ゲストは1行に合算・チップは入れない）
  if (!s9.buyers || s9.buyers.length !== 2) throw new Error('run9: bad buyers ' + JSON.stringify(s9.buyers));
  const fan9 = s9.buyers.find((b) => b.urlname === 'fan1');
  if (!fan9 || fan9.count !== 2 || fan9.amount !== 1000 || fan9.name !== 'ふぁん1') throw new Error('run9: bad buyer fan1 ' + JSON.stringify(fan9));
  if (s9.buyers.some((b) => b.urlname === 'fan2')) throw new Error('run9: refunded buyer must be excluded');
  if (s9.buyers.some((b) => b.urlname === 'ouen')) throw new Error('run9: tip must not be counted as a buyer');
  const guest9 = s9.buyers.find((b) => b.guest);
  if (!guest9 || guest9.count !== 1 || guest9.amount !== 800 || guest9.name !== '') throw new Error('run9: bad guest buyer ' + JSON.stringify(guest9));
  if (s9.monthly.length !== 12) throw new Error('run9: expected 12 months, got ' + s9.monthly.length);
  if (s9.monthly[11].amount !== 2000 || s9.monthly[10].amount !== 0) throw new Error('run9: bad monthly ' + JSON.stringify(s9.monthly.slice(-2)));
  // 日別集計: 返金と日付なしの明細は入らない（日付なしは月別のみ）
  const dk9 = now9.getFullYear() + '-' + String(now9.getMonth() + 1).padStart(2, '0') + '-' + String(now9.getDate()).padStart(2, '0');
  if (!s9.daily || !s9.daily[dk9]) throw new Error('run9: daily missing: ' + JSON.stringify(s9.daily));
  if (s9.daily[dk9].count !== 3 || s9.daily[dk9].amount !== 1200) throw new Error('run9: bad daily ' + JSON.stringify(s9.daily[dk9]));
  if (Object.keys(s9.daily).length !== 1) throw new Error('run9: unexpected daily keys ' + JSON.stringify(Object.keys(s9.daily)));
  const html9 = realBuild(captured);
  for (const needle of ['有料noteの売上', '直近12か月の売上', '&yen;2,000', '（マガジン・その他の商品）',
    'チップをくれた人', '買ってくれた人', 'お***', 'ふ***', '💬 メッセージあり', '日別の売上（最近30日）', 'bar-val">1,200</span>']) {
    if (!html9.includes(needle)) throw new Error('run9 html missing: ' + needle);
  }
  // AI相談プロンプト（__noteAISection）にも売上1行が入る
  const ai9 = window.__noteAISection(captured);
  if (!ai9.includes('有料noteの売上(直近12か月・返金除く): 2000円（販売4件）')) throw new Error('run9: AI prompt sales line missing');
  // AIに渡すプロンプトに買い手の名前は入れない（他人の個人情報なので）
  for (const leak of ['おうえん', 'ouen', 'ふぁん1', 'fan1']) {
    if (ai9.includes(leak)) throw new Error('run9: AI prompt must not contain buyer info: ' + leak);
  }
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

  // --- 実行11回目: 売上APIが user_verification_needed（パスワード再確認）→ 案内を出す ---
  window.__NOTE_PLUS = true;
  global.fetch = async (u) => {
    if (u.startsWith('/api/v1/stats/purchasers')) {
      return {
        ok: false, status: 400,
        text: async () => '{"error":{"code":"user_verification_needed"}}',
        json: async () => ({ error: { code: 'user_verification_needed' } }),
      };
    }
    return origFetch(u);
  };
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  if (!captured.sales || captured.sales.needVerify !== true) throw new Error('run11: needVerify not detected');
  const html11 = realBuild(captured);
  if (!html11.includes('パスワードの再確認')) throw new Error('run11: verification guidance missing');
  if (html11.includes('直近12か月の売上')) throw new Error('run11: should not render KPI when unverified');
  const ai11 = window.__noteAISection(captured);
  if (ai11.includes('有料noteの売上')) throw new Error('run11: AI prompt should not include sales line');
  delete window.__NOTE_PLUS;
  global.fetch = origFetch;
  console.log('run11 (パスワード再確認が必要: 案内表示) OK');

  // --- 実行12回目: お知らせ枠の出し分け（基本版には出す／機能追加版には出さない） ---
  // 帯の文言は noteAnalyze の内部でHTMLに差し込まれるため、
  // ①どのnoticeファイルを取りに行ったか（優先順位）と ②帯のぶんHTMLが伸びたか の2点で確認する。
  let noticeLog = [];
  const noticeMock = (opts) => async (u) => {
    if (u.indexOf('notice') >= 0) {
      noticeLog.push(u.replace(/^.*\//, '').replace(/\?.*$/, ''));
      if (u.includes('notice-collab-plus.json')) {
        return opts.plusFile
          ? { ok: true, json: async () => ({ enabled: false, message: '（＋の人には出さない）' }) }
          : { ok: false, status: 404 };
      }
      if (u.includes('notice-collab.json')) {
        return { ok: true, json: async () => ({ enabled: true, message: '乗り換え案内', link: 'https://lin.ee/example', linkText: 'LINEへ' }) };
      }
      return { ok: true, json: async () => ({ enabled: true, message: '共通のお知らせ' }) };
    }
    return origFetch(u);
  };
  window.__NOTE_BASE = 'https://example.test/';
  window.__NOTE_CHANNEL = 'collab';

  // 帯なしのときのHTML長 = レポート本体 + AI相談枠（noteAnalyze はこの2つを必ず足す）。
  // 帯が出るとこれより長くなる。
  const noBannerLen = () => realBuild(captured).length + window.__noteAISection(captured).length;

  // 12a: 基本版 → notice-collab.json を読み、帯が出る（＝HTMLが伸びる）
  delete window.__NOTE_PLUS;
  noticeLog = [];
  global.fetch = noticeMock({ plusFile: true });
  localStorage.setItem('noteAnalyzeLastRun', '0');
  const r12a = await window.noteAnalyze({ download: false, delay: 0 });
  if (noticeLog.join(',') !== 'notice-collab.json') throw new Error('run12a: unexpected notice fetches: ' + noticeLog.join(','));
  if (r12a.htmlLen <= noBannerLen()) throw new Error('run12a: banner should be injected for basic users');
  console.log('run12a (基本版: 乗り換え案内の帯が出る) OK');

  // 12b: 機能追加版 → notice-collab-plus.json（enabled:false）が優先され、帯は出ない
  window.__NOTE_PLUS = true;
  noticeLog = [];
  global.fetch = noticeMock({ plusFile: true });
  localStorage.setItem('noteAnalyzeLastRun', '0');
  const r12b = await window.noteAnalyze({ download: false, delay: 0 });
  if (noticeLog.join(',') !== 'notice-collab-plus.json') throw new Error('run12b: plus file must win and stop the lookup: ' + noticeLog.join(','));
  if (r12b.htmlLen !== noBannerLen()) throw new Error('run12b: banner must NOT be shown to plus users');
  console.log('run12b (機能追加版: 乗り換え案内は出ない) OK');

  // 12c: plus用ファイルが無い（404）ときは今までどおり notice-collab.json に落ちる
  noticeLog = [];
  global.fetch = noticeMock({ plusFile: false });
  localStorage.setItem('noteAnalyzeLastRun', '0');
  const r12c = await window.noteAnalyze({ download: false, delay: 0 });
  if (noticeLog.join(',') !== 'notice-collab-plus.json,notice-collab.json') throw new Error('run12c: should fall back to channel notice: ' + noticeLog.join(','));
  if (r12c.htmlLen <= noBannerLen()) throw new Error('run12c: fallback banner missing');
  console.log('run12c (plus用ファイルなし: 従来どおりチャンネル用に落ちる) OK');

  // --- 実行13回目: noteの新ダッシュボード（GraphQL）からインプレッション・流入元を取る ---
  // ブラウザでしか無い document.cookie を用意する（本体は Cookie からトークンを読む）
  global.document = { cookie: 'XSRF-TOKEN=xsrf-dummy; note_gql_auth_token=tok-dummy' };
  window.__NOTE_PLUS = true;
  let gqlCalls = [];
  const gqlMock = async (u, init) => {
    if (typeof u === 'string' && u.indexOf('graphql.note.com') >= 0) {
      const body = JSON.parse((init && init.body) || '{}');
      const q = body.query || '';
      gqlCalls.push(q.slice(0, 40));
      const auth = (init && init.headers && init.headers.authorization) || '';
      if (auth !== 'Bearer tok-dummy') throw new Error('run13: Bearer トークンが付いていない: ' + auth);
      if (init.credentials) throw new Error('run13: GraphQLにCookieを送ってはいけない（CORSで弾かれる）');
      const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
      if (q.indexOf('dashboardSummary') >= 0) {
        return ok({ dashboardSummary: { lastUpdatedAt: '2026-09-17T00:00:00.000Z',
          metrics: { pageViewCount: 5633, impressionCount: 64167, likeCount: 47, commentCount: 4, salesAmount: 10245 } } });
      }
      if (q.indexOf('dashboardNoteListConnection') >= 0) {
        return ok({ dashboardNoteListConnection: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [
          { node: { note: { title: '記事その1', link: { absoluteUrl: 'https://note.com/testuser/n/a1' } },
            metrics: { pageViewCount: 400, impressionCount: 8000, likeCount: 30, commentCount: 3, salesAmount: 0 } } },
          { node: { note: { title: '記事その2', link: { absoluteUrl: 'https://note.com/testuser/n/a2' } },
            metrics: { pageViewCount: 150, impressionCount: 900, likeCount: 17, commentCount: 1, salesAmount: 0 } } },
        ] } });
      }
      if (q.indexOf('dashboardNoteReferrersChart') >= 0) {
        return ok({ dashboardNoteReferrersChart: { legend: [
          { name: 'note.com', count: 700, color: '#1' }, { name: 'Google', count: 250, color: '#2' }, { name: 'X', count: 50, color: '#3' },
        ] } });
      }
      if (q.indexOf('dashboardMembershipPlanListConnection') >= 0) {
        return ok({ dashboardMembershipPlanListConnection: { edges: [
          { node: { plan: { name: 'ゆるサポートプラン', status: 'OPEN' }, metrics: { salesAmount: 3000, joinedMemberCount: 4, leftMemberCount: 1 } } },
        ] } });
      }
      if (q.indexOf('dashboardMagazineListConnection') >= 0) {
        return ok({ dashboardMagazineListConnection: { edges: [
          { node: { magazine: { name: '月刊あばけろ', status: 'OPEN', isPaid: true }, metrics: { salesAmount: 1500, addedNoteCount: 2, followCountDiff: 5 } } },
        ] } });
      }
      return ok({});
    }
    if (typeof u === 'string' && u.indexOf('/api/v3/graphql/auth') >= 0) return { ok: true, status: 201, json: async () => ({}) };
    return origFetch(u);
  };
  global.fetch = gqlMock;
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  const ig = captured.insight;
  if (!ig) throw new Error('run13: insight が取れていない');
  if (ig.pv !== 5633 || ig.imp !== 64167) throw new Error('run13: サマリーの数字が違う ' + JSON.stringify(ig));
  if (ig.nArt !== 2) throw new Error('run13: 記事別が取れていない ' + ig.nArt);
  if (!ig.ref || ig.ref[0].name !== 'note.com' || ig.ref[0].count !== 700) throw new Error('run13: 流入元が違う ' + JSON.stringify(ig.ref));
  if (!ig.membership || ig.membership[0].amount !== 3000) throw new Error('run13: メンバーシップが違う ' + JSON.stringify(ig.membership));
  if (!ig.magazine || ig.magazine[0].amount !== 1500) throw new Error('run13: マガジンが違う ' + JSON.stringify(ig.magazine));
  if (captured.pvSrc !== 'gql') throw new Error('run13: pvSrc が gql になっていない');
  // 記事のPVが新しい数字に入れ替わり、旧ビューは readOld に残る
  const a1 = captured.arts.find((a) => a.key === 'a1');
  if (!a1 || a1.read !== 400 || a1.imp !== 8000 || a1.readOld !== 500) throw new Error('run13: 記事の入れ替えが違う ' + JSON.stringify(a1));
  if (captured.totPVOld !== 780) throw new Error('run13: 旧ビュー合計が違う ' + captured.totPVOld);
  const html13 = realBuild(captured);
  for (const needle of ['表示された回数', 'ひらかれ率', 'どこから読まれている', 'note.com', 'Google',
    'メンバーシップ（過去365日）', 'ゆるサポートプラン', 'マガジン（過去365日）', '分割前の数え方だと 780']) {
    if (!html13.includes(needle)) throw new Error('run13 html missing: ' + needle);
  }
  const ai13 = window.__noteAISection(captured);
  if (!ai13.includes('表示回数(インプレッション): 64167')) throw new Error('run13: AIプロンプトにインプレッションが無い');
  if (!ai13.includes('流入元(最近28日): note.com 70%')) throw new Error('run13: AIプロンプトに流入元が無い');
  console.log('run13 (GraphQL: インプレッション・流入元・メンバーシップ) OK');

  // --- 実行14回目: GraphQLが落ちても、従来の数字でレポートは作れる ---
  global.fetch = async (u, init) => {
    if (typeof u === 'string' && (u.indexOf('graphql') >= 0)) return { ok: false, status: 500, json: async () => ({}) };
    return origFetch(u);
  };
  global.document = { cookie: '' };
  localStorage.setItem('noteAnalyzeLastRun', '0');
  await window.noteAnalyze({ download: false, delay: 0 });
  if (captured.insight != null) throw new Error('run14: GraphQL失敗時は insight を null にする');
  if (captured.pvSrc !== 'legacy') throw new Error('run14: pvSrc は legacy に戻るべき');
  const html14 = realBuild(captured);
  if (html14.includes('表示された回数')) throw new Error('run14: インプレッションを出してはいけない');
  if (html14.includes('どこから読まれている')) throw new Error('run14: 流入元を出してはいけない');
  if (!html14.includes('読まれた回数（総PV）')) throw new Error('run14: 従来のPV表示に戻っていない');
  console.log('run14 (GraphQLが落ちたら従来どおり) OK');

  delete global.document;
  delete window.__NOTE_PLUS;
  delete window.__NOTE_CHANNEL;
  delete window.__NOTE_BASE;
  global.fetch = origFetch;
  console.log('ALL OK');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
