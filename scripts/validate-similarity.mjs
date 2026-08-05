#!/usr/bin/env node
/**
 * validate-similarity.mjs — 植徑 v.3 S_attr / S_llm 驗證腳本
 * ---------------------------------------------------------------
 * 目的：檢驗規則式 S_attr 屬性加權評分的候選排序，是否與視覺語言模型
 *      （VLM-as-Judge, S_llm）的視覺相似度判斷一致。
 *
 * 用法：
 *   node scripts/validate-similarity.mjs --inputs 5 --topk 8 --repeat 1
 *   node scripts/validate-similarity.mjs --phase 3 --repeat 3 --topk 3
 *
 * 參數：
 *   --inputs N       抽取幾組「輸入植株」（預設 5）
 *   --topk K         每組送審的候選數（預設 8；ρ 以 K 筆計、Overlap@5 取前 5）
 *   --repeat R       同一配對重複評分次數（預設 1；一致性檢驗用 3）
 *   --max-calls N    API 呼叫上限保險絲（預設 200）
 *   --provider P     anthropic（預設）| openai
 *   --model M        預設 anthropic=claude-haiku-4-5 / openai=gpt-4o-mini
 *   --seed S         抽樣亂數種子（預設 20260804，確保可重現）
 *   --dry-run        只算 S_attr、不呼叫 API
 *
 * 環境變數（讀 .env）：ANTHROPIC_API_KEY 或 OPENAI_API_KEY
 * 輸出：validation/results.json、validation/pairs.csv
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_DIR = path.join(ROOT, 'public', 'photos');
const OUT_DIR = path.join(ROOT, 'validation');
const CACHE_DIR = path.join(OUT_DIR, '.imgcache');

// ---------- CLI ----------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const CFG = {
  inputs: +arg('inputs', 5),
  topk: +arg('topk', 8),
  repeat: +arg('repeat', 1),
  maxCalls: +arg('max-calls', 200),
  provider: String(arg('provider', 'anthropic')),
  model: arg('model', null),
  seed: +arg('seed', 20260804),
  temperature: +arg('temperature', 1),
  minPool: +arg('min-pool', 5),   // 類別候選池下限；池小於 topk 時自動送審全池
  dryRun: !!arg('dry-run', false),
};
CFG.model = CFG.model || (CFG.provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5');

// ---------- .env ----------
for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// =====================================================================
// 1. S_attr — 與 src/matching.js scorePair() 完全一致的評分邏輯
// =====================================================================
const FOLIAGE_KW = ["披針","橢圓","卵","線形","圓","心形","掌狀","羽狀","腎","楔","球","針","革質","膜質","肉質","紙質","對生","互生","輪生","基生","叢生","複葉","全緣","鋸齒","深裂","三出","摺扇"];
const ORNAMENT_KW = ["春","夏","秋","冬","穗狀","頭狀","繖狀","單花","花穗","蒴果","漿果","核果","莢果","球果","5瓣","管狀","唇形","蝶形","輪繖","螺旋","風車","壺形","宿存萼","宿存","觀葉","觀果"];
const WEIGHTS = { base: 50, foliage: 30, height: 10, spread: 5, ornament: 5 };

const tokensIn = (t, kws) => { if (!t) return new Set(); const s = String(t); return new Set(kws.filter(k => s.includes(k))); };
function jaccard(a, b) { if (a.size === 0 && b.size === 0) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; const u = a.size + b.size - i; return u === 0 ? 0 : i / u; }
function parseRange(str) { if (!str) return null; const m = String(str).match(/([\d.]+)\s*[-–~]\s*([\d.]+)/); if (m) return [parseFloat(m[1]), parseFloat(m[2])]; const one = String(str).match(/([\d.]+)/); return one ? [parseFloat(one[1]), parseFloat(one[1])] : null; }
function rangeOverlap(a, b) { if (!a || !b) return 0; const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (hi < lo) return 0; const ul = Math.min(a[0], b[0]), uh = Math.max(a[1], b[1]); if (uh - ul === 0) return 1; return (hi - lo) / (uh - ul); }

/**
 * 類別正規化（本腳本新增，並建議回寫 src/matching.js）
 * analyze-image.js 產出的 category 詞彙為 灌木 / 草本 / 地被，
 * 但 plants_enriched.json 的 category 欄位為 灌木 / 喬木 / 多年生草本 / 一年生草本。
 * 直接字串相等比對會使「草本」「地被」兩類永遠比不到任何一筆（見報告 §5.1）。
 */
function normCategory(db) {
  const c = db.category || '';
  const role = String(db['Role (角色)'] || '').toLowerCase();
  if (c === '灌木') return '灌木';
  if (c === '喬木') return '喬木';
  if (c.includes('草本')) return role.includes('ground') ? '地被' : '草本';
  return c;
}

function scorePair(input, db) {
  if (input.category !== normCategory(db)) return null;
  const fSim = jaccard(tokensIn(input.foliage, FOLIAGE_KW), tokensIn(db['FOLIAGE (葉形)'], FOLIAGE_KW));
  const hOv = rangeOverlap(input.height_estimate_m, parseRange(db['HEIGHT (高度)']));
  const sOv = rangeOverlap(input.spread_estimate_m, parseRange(db['SPREAD (展幅)']));
  const oSim = jaccard(tokensIn(input.ornament, ORNAMENT_KW), tokensIn(`${db['FLW SEASON (花期)'] || ''} ${db['STRUCT INT (結構期)'] || ''}`, ORNAMENT_KW));
  const score = WEIGHTS.base + fSim * WEIGHTS.foliage + hOv * WEIGHTS.height + sOv * WEIGHTS.spread + oSim * WEIGHTS.ornament;
  return {
    score: Math.round(score * 10) / 10,
    breakdown: {
      category: WEIGHTS.base,
      foliage: +(fSim * WEIGHTS.foliage).toFixed(1),
      height: +(hOv * WEIGHTS.height).toFixed(1),
      spread: +(sOv * WEIGHTS.spread).toFixed(1),
      ornament: +(oSim * WEIGHTS.ornament).toFixed(1),
    },
  };
}
const starsOf = s => (s >= 90 ? 5 : s >= 75 ? 4 : s >= 60 ? 3 : s >= 40 ? 2 : 1);

// =====================================================================
// 2. 資料與樣本
// =====================================================================
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'plants_enriched.json'), 'utf8'));
const zhName = d => String(d['Name (中文名/學名)'] || '').split(' / ')[0].trim();
const laName = d => (String(d['Name (中文名/學名)'] || '').split(' / ')[1] || '').trim();

// 只有本地備有照片的物種才能進入 S_llm 評審
const photoFiles = fs.existsSync(PHOTO_DIR) ? fs.readdirSync(PHOTO_DIR).filter(f => /\.jpe?g$/i.test(f)) : [];
function photoOf(name) {
  for (const suf of ['_habit', '_close', '', '_leaf']) {
    const f = `${name}${suf}.jpg`;
    if (photoFiles.includes(f)) return path.join(PHOTO_DIR, f);
  }
  return null;
}
/**
 * 影像稽核黑名單（2026-08-04 逐張目視稽核結果）
 * 這些物種的本地照片主體錯誤或不可用於形態比對，會直接污染 S_llm 效標。
 * 以 --exclude-bad 啟用排除；未來補上正確照片後即可自名單移除。
 */
const BAD_PHOTOS = {
  '青葙': '主體為鳥類（Lilac-breasted Roller），非目標植物',
  '綬草': '古典植物版畫，非攝影照片',
  '絡石': '蛾（Autographa gamma）占畫面顯著面積，原始檔名即為蛾的學名',
  '田代氏石斑木': '住宅街景中的修剪球形灌木，含房屋／柵欄／垃圾桶等人工物',
};
const EXCLUDE_BAD = !!arg('exclude-bad', false);
const WITH_PHOTO = DB.filter(d => photoOf(zhName(d)) && !(EXCLUDE_BAD && BAD_PHOTOS[zhName(d)]));

/** 把資料庫一筆轉成「模擬 GPT-4o 辨識輸出」的 input 物件（leave-one-out 設計） */
function asInput(d) {
  return {
    id: zhName(d),
    name_zh: zhName(d),
    name_latin: laName(d),
    category: normCategory(d),
    foliage: d['FOLIAGE (葉形)'],
    height_estimate_m: parseRange(d['HEIGHT (高度)']),
    spread_estimate_m: parseRange(d['SPREAD (展幅)']),
    ornament: `${d['FLW SEASON (花期)'] || ''} ${d['STRUCT INT (結構期)'] || ''}`,
  };
}

// 可重現的偽亂數
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** 依類別分層抽樣輸入植株，確保候選池 ≥ topk */
function pickInputs(n) {
  const rnd = mulberry32(CFG.seed);
  const byCat = {};
  for (const d of WITH_PHOTO) (byCat[normCategory(d)] ||= []).push(d);
  const cats = Object.entries(byCat)
    .filter(([, arr]) => arr.length >= CFG.minPool + 1)
    .sort((a, b) => b[1].length - a[1].length);
  const picked = [];
  let i = 0;
  while (picked.length < n && cats.length) {
    const [, arr] = cats[i % cats.length];
    const pool = arr.filter(d => !picked.includes(d));
    if (pool.length) picked.push(pool[Math.floor(rnd() * pool.length)]);
    i++;
    if (i > 500) break;
  }
  return picked;
}

/** 對單一輸入植株，在「有照片的同類別候選」中排出 S_attr 排名 */
function rankCandidates(inputPlant) {
  const inp = asInput(inputPlant);
  const rows = [];
  for (const d of WITH_PHOTO) {
    if (zhName(d) === inp.id) continue;              // leave-one-out：排除自身
    const r = scorePair(inp, d);
    if (!r) continue;
    rows.push({ name: zhName(d), latin: laName(d), photo: photoOf(zhName(d)), s_attr: r.score, stars: starsOf(r.score), breakdown: r.breakdown });
  }
  rows.sort((a, b) => b.s_attr - a.s_attr || a.name.localeCompare(b.name));
  return { input: inp, ranked: rows };
}

// =====================================================================
// 3. S_llm — VLM-as-Judge
// =====================================================================
fs.mkdirSync(CACHE_DIR, { recursive: true });
function b64Image(file) {
  const out = path.join(CACHE_DIR, path.basename(file).replace(/\.jpe?g$/i, '') + '.s.jpg');
  if (!fs.existsSync(out)) {
    try { execFileSync('convert', [file, '-resize', '768x768>', '-quality', '82', out], { stdio: 'ignore' }); }
    catch { fs.copyFileSync(file, out); }
  }
  return fs.readFileSync(out).toString('base64');
}

const JUDGE_PROMPT = `你是資深景觀植栽設計師，正在為自然主義種植設計（naturalistic planting）挑選視覺替代植物。

以下有兩張植物照片：
- 圖 A＝參考植株
- 圖 B＝候選替代植株

請只依「視覺形態相似度」評分，判斷把圖 A 換成圖 B 之後，整體種植畫面的視覺質感是否仍然成立。

評分時請考慮：葉形與葉序、整體質地（細緻／粗放、通透／緻密）、植株形態與輪廓、株高與展幅的視覺量體、花果序的形式。
請「不要」以花色或葉色的顏色差異作為主要依據（色彩在本系統中由獨立的篩選器處理）。

評分尺度（0–100）：
90–100 幾乎可直接互換，畫面幾乎無感差異
75–89  高度相似，替換後設計意圖完整保留
60–74  中度相似，替換可行但畫面質感略有位移
40–59  低度相似，僅類別相同，替換會明顯改變畫面
0–39   不相似，不建議作為替代

只輸出 JSON，不要有其他文字：
{"score": <0-100 整數>, "reason": "<40 字以內的中文理由>"}`;

let CALLS = 0;
async function judgeAnthropic(imgA, imgB) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CFG.model, max_tokens: 300, temperature: CFG.temperature,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '圖 A（參考植株）：' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgA } },
        { type: 'text', text: '圖 B（候選替代植株）：' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB } },
        { type: 'text', text: JUDGE_PROMPT },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { text: (j.content || []).map(c => c.text || '').join(''), usage: j.usage };
}

async function judgeOpenAI(imgA, imgB) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: CFG.model, max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '圖 A（參考植株）：' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imgA}` } },
        { type: 'text', text: '圖 B（候選替代植株）：' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imgB}` } },
        { type: 'text', text: JUDGE_PROMPT },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content || '', usage: j.usage };
}

function parseJudge(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return { score: Math.max(0, Math.min(100, Math.round(+o.score))), reason: String(o.reason || '').trim() }; }
  catch { return null; }
}

// 逐筆落地快取：中斷後可續跑，不重複計費
const JCACHE_FILE = path.join(OUT_DIR, '.judge-cache.json');
let JCACHE = fs.existsSync(JCACHE_FILE) ? JSON.parse(fs.readFileSync(JCACHE_FILE, 'utf8')) : {};

async function judge(fileA, fileB, tag = '') {
  const key = `${CFG.model}|${CFG.temperature}|${path.basename(fileA)}|${path.basename(fileB)}|${tag}`;
  if (JCACHE[key]) return { ...JCACHE[key], cached: true };
  if (CALLS >= CFG.maxCalls) throw new Error(`已達 --max-calls ${CFG.maxCalls} 上限`);
  CALLS++;
  const a = b64Image(fileA), b = b64Image(fileB);
  const fn = CFG.provider === 'openai' ? judgeOpenAI : judgeAnthropic;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fn(a, b);
      const p = parseJudge(r.text);
      if (p) {
        JCACHE[key] = p;
        fs.writeFileSync(JCACHE_FILE, JSON.stringify(JCACHE, null, 0));
        return { ...p, usage: r.usage };
      }
      throw new Error('無法解析評審輸出：' + r.text.slice(0, 120));
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }
}

// =====================================================================
// 4. 統計
// =====================================================================
function rankOf(values) {              // 平均秩（處理同分）
  const idx = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const r = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  const n = x.length; if (n < 3) return null;
  const rx = rankOf(x), ry = rankOf(y);
  const mx = rx.reduce((a, b) => a + b) / n, my = ry.reduce((a, b) => a + b) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? null : +(num / Math.sqrt(dx * dy)).toFixed(3);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => (a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1)));
function overlapAtK(a, b, k = 5) {
  const A = new Set(a.slice(0, k)), B = new Set(b.slice(0, k));
  return [...A].filter(x => B.has(x)).length;
}

// =====================================================================
// 5. 主流程
// =====================================================================
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const inputs = pickInputs(CFG.inputs);
  console.log(`資料庫 ${DB.length} 種／可用照片 ${WITH_PHOTO.length} 種`);
  if (EXCLUDE_BAD) console.log(`已排除稽核不合格影像 ${Object.keys(BAD_PHOTOS).length} 種：${Object.keys(BAD_PHOTOS).join('、')}`);
  console.log(`抽樣 ${inputs.length} 組輸入植株｜每組送審 ${CFG.topk} 筆｜重複 ${CFG.repeat} 次｜provider=${CFG.provider} model=${CFG.model}`);

  const runs = [];
  for (const ip of inputs) {
    const { input, ranked } = rankCandidates(ip);
    const cands = ranked.slice(0, CFG.topk);
    console.log(`\n▸ ${input.id}（${input.category}）候選池 ${ranked.length} → 送審 ${cands.length}`);
    for (const c of cands) {
      c.s_llm_runs = [];
      if (!CFG.dryRun) {
        for (let r = 0; r < CFG.repeat; r++) {
          const j = await judge(photoOf(input.id), c.photo, `r${r}`);
          c.s_llm_runs.push(j.score);
          c.reason = j.reason;
          process.stdout.write(`  ${c.name} S_attr=${c.s_attr} S_llm=${j.score}${CFG.repeat > 1 ? `(#${r + 1})` : ''}${j.cached ? ' [cache]' : ''}\n`);
        }
        c.s_llm = +mean(c.s_llm_runs).toFixed(1);
        c.s_llm_sd = +sd(c.s_llm_runs).toFixed(2);
      }
    }
    const run = { input, n_pool: ranked.length, candidates: cands };
    if (!CFG.dryRun) {
      run.rho = spearman(cands.map(c => c.s_attr), cands.map(c => c.s_llm));
      const byAttr = [...cands].sort((a, b) => b.s_attr - a.s_attr).map(c => c.name);
      const byLlm = [...cands].sort((a, b) => b.s_llm - a.s_llm).map(c => c.name);
      run.overlap5 = overlapAtK(byAttr, byLlm, 5);
      run.rank_attr = byAttr; run.rank_llm = byLlm;
      console.log(`  → ρ=${run.rho}　Overlap@5=${run.overlap5}/5`);
    }
    runs.push(run);
  }

  const summary = CFG.dryRun ? { dry_run: true } : {
    n_inputs: runs.length,
    n_pairs: runs.reduce((s, r) => s + r.candidates.length, 0),
    api_calls: CALLS,
    rho_per_input: runs.map(r => r.rho),
    rho_mean: +mean(runs.map(r => r.rho).filter(v => v != null)).toFixed(3),
    overlap5_mean: +mean(runs.map(r => r.overlap5)).toFixed(2),
    sd_mean: CFG.repeat > 1 ? +mean(runs.flatMap(r => r.candidates.map(c => c.s_llm_sd))).toFixed(2) : null,
    pass_rho_min: null, pass_rho_target: null,
  };
  if (!CFG.dryRun) {
    summary.pass_rho_min = summary.rho_mean >= 0.6;
    summary.pass_rho_target = summary.rho_mean >= 0.7;
  }

  const out = { generated_at: new Date().toISOString(), config: CFG, weights: WEIGHTS, summary, runs };
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));

  const csv = ['input,input_category,candidate,s_attr,stars,foliage,height,spread,ornament,s_llm,s_llm_sd,reason'];
  for (const r of runs) for (const c of r.candidates) {
    csv.push([r.input.id, r.input.category, c.name, c.s_attr, c.stars, c.breakdown.foliage, c.breakdown.height, c.breakdown.spread, c.breakdown.ornament, c.s_llm ?? '', c.s_llm_sd ?? '', `"${(c.reason || '').replace(/"/g, "'")}"`].join(','));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'pairs.csv'), '﻿' + csv.join('\n'));

  console.log('\n===== 摘要 =====');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n輸出：validation/results.json、validation/pairs.csv`);
})().catch(e => { console.error('\n[錯誤]', e.message); process.exit(1); });
