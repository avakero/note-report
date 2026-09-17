/* __noteBuildHtml の煙テスト: 前回スナップショットあり/なしの両方 */
const fs = require('fs');
let src = fs.readFileSync(require('path').join(__dirname, '..', 'note-tool.js'), 'utf8');
src = src.replace(/window\.noteAnalyze\(\);\s*$/, ''); // 自動実行を止める
global.window = {};
eval(src);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const peak = (obj, k) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, k || 3).map((e) => e[0] + '時(' + e[1] + ')').join('・');

const arts = [
  { key: 'a1', title: '記事その1', publishAt: '2026-07-01T09:00:00+09:00', like: 30, comment: 3, read: 500, tags: ['日記'] },
  { key: 'a2', title: '記事その2', publishAt: '2026-07-10T21:00:00+09:00', like: 12, comment: 1, read: 200, tags: [] },
  { key: 'a3', title: '新しい記事', publishAt: '2026-07-11T20:00:00+09:00', like: 5, comment: 0, read: 80, tags: ['朝活'] },
];
const dayC = { '2026-07-10': 4, '2026-07-11': 9, '2026-07-12': 3 };
const base = {
  user: 'testuser', meta: { pv: 780, like: 47, comment: 4, last: '2026-07-12 06:00' },
  hasPV: true, arts, totLike: 47, totCmt: 4, totPV: 780, nArt: 3,
  hourC: { 21: 10, 9: 5 }, wdC: { 0: 3, 6: 8 }, dayC,
  heat: { '0_21': 6 }, pHeat: { '0_21': 2 },
  uLike: { u1: 5 }, uMeta: { u1: { nick: 'ユーザー1', fc: 10 } }, uHours: { u1: { 21: 5 } },
  fans: [['u1', 5]], prospects: [['u1', 5]], tagMap: { '日記': [30] },
  followers: new Set(), followerCount: 42, nLikes: 47, heroImg: null,
  WD: ['月', '火', '水', '木', '金', '土', '日'], esc, peak,
};

// --- ケース1: 前回なし（初回実行） ---
let html1 = window.__noteBuildHtml({ ...base, prevSnap: null, snapSaved: true });
if (!html1.includes('前回とくらべて')) throw new Error('diff section missing (case1)');
if (!html1.includes('次に別の日')) throw new Error('first-run message missing');
if (!html1.includes('日別スキの推移')) throw new Error('daily section missing');
if (!html1.includes('7/11')) throw new Error('daily labels missing');
console.log('case1 (初回実行) OK');

// --- ケース1b: 保存不可（プライベートモード） ---
let html1b = window.__noteBuildHtml({ ...base, prevSnap: null, snapSaved: false });
if (!html1b.includes('プライベートモード')) throw new Error('snapSaved=false message missing');
console.log('case1b (保存不可) OK');

// --- ケース2: 前回あり ---
const prevSnap = {
  at: Date.now() - 86400000, // きのう
  totPV: 700, totLike: 40, totCmt: 4, fol: 40,
  arts: { a1: [480, 28, 3], a2: [180, 10, 1] }, // a3 は前回以降の新記事
};
const snapHist = [
  { at: Date.now() - 2 * 86400000, totPV: 650, totLike: 35, totCmt: 3, fol: 38, arts: {} },
  prevSnap,
  { at: Date.now(), totPV: 780, totLike: 47, totCmt: 4, fol: 42, arts: {} },
];
let html2 = window.__noteBuildHtml({ ...base, prevSnap, snapHist, snapSaved: true });
for (const needle of [
  '1日前',              // 前回日付ラベル
  'PVの伸び',           // 差分KPI
  '+80',                // dTotPV = 780-700
  '+7',                 // dTotLike = 47-40
  '±0',                 // dTotCmt = 0
  '+2',                 // dFol = 42-40
  '伸びた記事',          // 記事別テーブル
  '🆕 前回以降に公開',   // 新記事チップ
  '+20',                // a1 PV増 500-480
  '1日ごとのPVの伸び',   // 推移グラフ（PV）
  '1日ごとのスキの伸び', // 推移グラフ（スキ）
  'bar-val">50</span>', // hist: PV伸び 700-650=50
  'bar-val">80</span>', // hist: PV伸び 780-700=80
  '1日ごとのコメントの伸び',
  '1日ごとのフォロワーの伸び',
]) {
  if (!html2.includes(needle)) throw new Error('case2 missing: ' + needle);
}
console.log('case2 (前回あり・差分表示) OK');

// --- ケース3: PVなしアカウント ---
const artsNoPV = arts.map((a) => ({ ...a, read: null }));
let html3 = window.__noteBuildHtml({
  ...base, hasPV: false, totPV: null, arts: artsNoPV,
  prevSnap: { ...prevSnap, totPV: null, arts: { a1: [null, 28, 3], a2: [null, 10, 1] } },
  snapSaved: true,
});
if (html3.includes('PVの伸び')) throw new Error('PV delta should be hidden when hasPV=false');
if (!html3.includes('スキの伸び')) throw new Error('like delta missing (case3)');
console.log('case3 (PVなし) OK');

// --- ケース4: コラボ基本版（liteMode）: 新機能セクションが出ない ---
let html4 = window.__noteBuildHtml({ ...base, prevSnap, snapHist, snapSaved: true, liteMode: true });
if (html4.includes('前回とくらべて')) throw new Error('lite: diff section should be hidden');
if (html4.includes('日別スキの推移')) throw new Error('lite: daily section should be hidden');
if (!html4.includes('全体サマリー') || !html4.includes('スキが集まる時間帯')) throw new Error('lite: base sections missing');
// セクション番号が飛ばず連番になっていること（① ② ③…）
if (!html4.includes('<span class="sec-no">3</span>💛')) throw new Error('lite: section numbering should stay sequential');
console.log('case4 (コラボ基本版・非表示) OK');

// --- ケース5: 売上あり（有料記事＋マガジン・返金除外後の集計値） ---
const monthly5 = [];
for (let i = 11; i >= 0; i--) monthly5.push({ ym: '2026/' + (12 - i), count: 0, amount: 0 });
monthly5[11] = { ym: monthly5[11].ym, count: 3, amount: 1800 }; // 今月
monthly5[10] = { ym: monthly5[10].ym, count: 1, amount: 500 };  // 先月
const dkey5 = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today5 = new Date(); today5.setHours(0, 0, 0, 0);
const yest5 = new Date(today5.getTime() - 86400000);
const sales5 = {
  summary: null,
  monthly: monthly5,
  byArt: { a1: { count: 2, amount: 1000, name: '記事その1' }, m1: { count: 2, amount: 1300, name: 'テストマガジン' } },
  daily: { [dkey5(yest5)]: { count: 1, amount: 800 }, [dkey5(today5)]: { count: 3, amount: 1500 } },
  count: 4, amount: 2300, hasPaid: true,
};
const artsPaid = arts.map((a) => (a.key === 'a1' ? { ...a, price: 500 } : a));
let html5 = window.__noteBuildHtml({ ...base, arts: artsPaid, prevSnap: null, snapSaved: true, sales: sales5 });
for (const needle of [
  '有料noteの売上',      // セクション見出し
  '直近12か月の売上',
  '&yen;2,300',          // 12か月合計
  '今月の売上',
  '&yen;1,800',
  '先月の売上',
  '&yen;500',            // 先月KPI・a1の価格
  'テストマガジン',       // 記事一覧にない商品は購入明細のnameで表示
  '月別の売上',
  '日別の売上（最近30日）', // 日別グラフ
  'bar-val">1,500</span>',  // 今日の売上バー
  'bar-val">800</span>',    // きのうの売上バー
  'プラットフォーム利用料', // 手取り額との違いの注記
]) {
  if (!html5.includes(needle)) throw new Error('case5 missing: ' + needle);
}
// 日別グラフは30日ぶんのバーが出る（月別12 + 日別30）
const salesPart5 = html5.split('有料noteの売上')[1].split('有料note・商品')[0];
const salesBars5 = (salesPart5.match(/bar-row/g) || []).length;
if (salesBars5 !== 42) throw new Error('case5: expected 42 sales bars (12 monthly + 30 daily), got ' + salesBars5);
console.log('case5 (売上セクション) OK');

// --- ケース5b: 有料記事はあるが売上ゼロ → セクションは出て、空メッセージ ---
const salesZero = { summary: null, monthly: monthly5.map((m) => ({ ym: m.ym, count: 0, amount: 0 })), byArt: {}, count: 0, amount: 0, hasPaid: true };
let html5b = window.__noteBuildHtml({ ...base, arts: artsPaid, prevSnap: null, snapSaved: true, sales: salesZero });
if (!html5b.includes('有料noteの売上')) throw new Error('case5b: section missing');
if (!html5b.includes('&yen;0')) throw new Error('case5b: zero amount missing');
if (html5b.includes('日別の売上')) throw new Error('case5b: daily chart should be hidden without daily data');
console.log('case5b (有料記事あり・売上ゼロ) OK');

// --- ケース6: liteMode では売上も非表示／salesなしでも非表示 ---
let html6 = window.__noteBuildHtml({ ...base, prevSnap: null, snapSaved: true, sales: sales5, liteMode: true });
if (html6.includes('有料noteの売上')) throw new Error('case6: lite should hide sales section');
if (html1.includes('有料noteの売上')) throw new Error('case6: sales section should be hidden without sales data');
console.log('case6 (売上の出し分け) OK');

// --- ケース7: チップ・購入者リスト（初期表示は伏せ字・切り替えはCSSだけ） ---
if (html5.includes('チップをくれた人')) throw new Error('case7: people list must not appear without tips/buyers');
const sales7 = {
  ...sales5,
  tipCount: 2, tipAmount: 600,
  tips: [
    { name: 'あばけろ君', urlname: 'abakero', guest: false, price: 500, at: today5.getTime(), item: '記事その1', msg: 'いつも読んでます！', thanked: false },
    { name: '', urlname: '', guest: true, price: 100, at: yest5.getTime(), item: '', msg: '', thanked: true },
  ],
  tipTotal: 2,
  buyers: [
    { name: 'まきまき', urlname: 'makiy3111', guest: false, count: 2, amount: 1000, last: today5.getTime() },
    { name: '', urlname: '', guest: true, count: 1, amount: 800, last: yest5.getTime() },
  ],
  buyerTotal: 2,
};
let html7 = window.__noteBuildHtml({ ...base, arts: artsPaid, prevSnap: null, snapSaved: true, sales: sales7 });
for (const needle of [
  'チップをくれた人',
  '買ってくれた人',
  'あ***',                              // 伏せ字（初期表示）
  'ま***',
  '💬 メッセージあり',                   // メッセージ本文もボタンを押すまで出さない
  'class="rv-chk"',                     // CSSトグル本体
  'お名前とメッセージを表示する',
  'href="https://note.com/abakero"',    // 表示したときのプロフィールリンク
  'いつも読んでます！',                  // 本文はHTMLに入っているがCSSで隠れている
  '💝 チップ（応援）',                    // 商品テーブルのチップ行
  '🕊 まだ',                             // お礼がまだの印
  'ゲスト',                              // ゲスト購入
]) {
  if (!html7.includes(needle)) throw new Error('case7 missing: ' + needle);
}
// 初期状態は本名が隠れている＋チェックで表示に切り替わる（CSSだけで完結）
for (const css of ['.nm-r{display:none}', '.rv-chk:checked ~ .rv-body .nm-m{display:none}', '.rv-chk:checked ~ .rv-body .nm-r{display:inline}']) {
  if (!html7.includes(css)) throw new Error('case7 css missing: ' + css);
}
// 名前まわりにインラインJSを足していない（スマホのiframe表示ではnoteのCSPで動かないため）
const people7 = html7.split('チップをくれた人')[1].split('金額は販売価格ベース')[0];
if (/onclick|<script/i.test(people7)) throw new Error('case7: no inline JS allowed in the people list');
console.log('case7 (チップ・購入者リスト: 伏せ字トグル) OK');

// --- ケース8: インプレッション・ひらかれ率・流入元・PVの数え方が変わったときの比較 ---
const artsIns = artsPaid.map((a) => (a.key === 'a1' ? { ...a, imp: 8000 } : { ...a, imp: 900 }));
const insight8 = {
  pv: 5633, imp: 64167, like: 47, cmt: 4, sales: 10245, at: '2026-09-17T00:00:00.000Z', nArt: 3,
  byKey: {}, refDays: 28,
  ref: [{ name: 'note.com', count: 700 }, { name: 'Google', count: 250 }, { name: 'X', count: 50 }],
  membership: [{ name: 'ゆるサポートプラン', status: 'OPEN', amount: 3000, joined: 4, left: 1 }],
  magazine: [{ name: '月刊あばけろ', paid: true, amount: 1500, added: 2, folDiff: 5 }],
};
let html8 = window.__noteBuildHtml({ ...base, arts: artsIns, insight: insight8, totPVOld: 780, pvSrc: 'gql',
  prevSnap: { ...prevSnap, pvSrc: 'legacy' }, snapHist, snapSaved: true, sales: sales5 });
for (const needle of [
  '表示された回数',            // インプレッションKPI
  '64,167',
  'ひらかれ率',
  '読まれた回数（PV）',
  'noteの「ページビュー」と同じ数え方',
  '分割前の数え方だと 780',     // 旧ビューの説明
  'どこから読まれている',       // 流入元セクション
  'Google Search Console',     // 記事別の流入元は出せない旨の案内
  'メンバーシップ（過去365日）',
  'ゆるサポートプラン',
  '月刊あばけろ',
  'PVの比較をお休み',           // 数え方が変わった日の案内
]) {
  if (!html8.includes(needle)) throw new Error('case8 missing: ' + needle);
}
// 差分KPIの「PVの伸び」だけを見る（『1日ごとのPVの伸び』グラフの見出しと区別するため）
if (html8.includes('kpi-label\">PVの伸び<')) throw new Error('case8: 数え方が変わったときはPV差分を出してはいけない');
// 記事別テーブルに「表示」「ひらかれ率」列が増える
const head8 = html8.split('記事別エンゲージメント')[1].split('</tr>')[0];
if (!head8.includes('表示') || !head8.includes('ひらかれ率')) throw new Error('case8: 記事別テーブルの列が増えていない');
console.log('case8 (インプレッション・流入元・メンバーシップ) OK');

// --- ケース8b: insight が無いときは今までどおりの見た目 ---
let html8b = window.__noteBuildHtml({ ...base, prevSnap: { ...prevSnap, pvSrc: 'legacy' }, pvSrc: 'legacy', snapSaved: true });
if (html8b.includes('表示された回数') || html8b.includes('どこから読まれている')) throw new Error('case8b: insightなしで新セクションが出ている');
if (!html8b.includes('読まれた回数（総PV）')) throw new Error('case8b: 従来のPV表示が無い');
if (!html8b.includes('kpi-label\">PVの伸び<')) throw new Error('case8b: 同じ数え方どうしならPV差分は出す');
console.log('case8b (insightなし: 従来どおり) OK');

fs.writeFileSync(require('path').join(__dirname, 'report-case2.html'), html2);
console.log('ALL OK');
