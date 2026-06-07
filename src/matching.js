// matching.js — 比照 Ta_4「植徑 v.2」選植標準：對台灣原生植物資料庫做純程式碼評分 → 分類★池
// 評分移植自 Ta_4 identify.js：同類別(灌木/草本/地被) → 葉形 Jaccard×30 + 高度重疊×10 + 展幅×5 + 花果季×5 + 基底50 → 分數 → ★星等
// 全程在前端跑（fetch /data/plants_enriched.json），確定性、零 API、Demo 不會當。

const COLOR_VOCAB = {
  '紅':'#c0392b','橙':'#e67e22','黃':'#e8c820','綠':'#5a8a3c','藍':'#3a6ea5','紫':'#7d5ba6',
  '白':'#ffffff','粉':'#e8a0bf','銀':'#c9c9c4','莖綠':'#6b8e3d','褐':'#8a6d3b','黑':'#2a2a2a'
};
const FOLIAGE_KW = ["披針","橢圓","卵","線形","圓","心形","掌狀","羽狀","腎","楔","球","針","革質","膜質","肉質","紙質","對生","互生","輪生","基生","叢生","複葉","全緣","鋸齒","深裂","三出","摺扇"];
const ORNAMENT_KW = ["春","夏","秋","冬","穗狀","頭狀","繖狀","單花","花穗","蒴果","漿果","核果","莢果","球果","5瓣","管狀","唇形","蝶形","輪繖","螺旋","風車","壺形","宿存萼","宿存","觀葉","觀果"];

function tokensIn(t, kws){ if(!t) return new Set(); const s=String(t); return new Set(kws.filter(k=>s.includes(k))); }
function jaccard(a,b){ if(a.size===0&&b.size===0) return 0; let i=0; for(const x of a) if(b.has(x)) i++; const u=a.size+b.size-i; return u===0?0:i/u; }
function parseRange(str){ if(!str) return null; const m=String(str).match(/([\d.]+)\s*[-–~]\s*([\d.]+)/); if(m) return [parseFloat(m[1]),parseFloat(m[2])]; const one=String(str).match(/([\d.]+)/); return one?[parseFloat(one[1]),parseFloat(one[1])]:null; }
function rangeOverlap(a,b){ if(!a||!b) return 0; const lo=Math.max(a[0],b[0]), hi=Math.min(a[1],b[1]); if(hi<lo) return 0; const ul=Math.min(a[0],b[0]), uh=Math.max(a[1],b[1]); if(uh-ul===0) return 1; return (hi-lo)/(uh-ul); }
function scorePair(input, db){
  if(input.category !== db.category) return null;
  const fSim = jaccard(tokensIn(input.foliage,FOLIAGE_KW), tokensIn(db['FOLIAGE (葉形)'],FOLIAGE_KW));
  const hOv = rangeOverlap(input.height_estimate_m, parseRange(db['HEIGHT (高度)']));
  const sOv = rangeOverlap(input.spread_estimate_m, parseRange(db['SPREAD (展幅)']));
  const oSim = jaccard(tokensIn(input.ornament,ORNAMENT_KW), tokensIn(`${db['FLW SEASON (花期)']||''} ${db['STRUCT INT (結構期)']||''}`,ORNAMENT_KW));
  const score = 50 + fSim*30 + hOv*10 + sOv*5 + oSim*5;
  return { score: Math.round(score*10)/10, breakdown:{ category:50, foliage:+(fSim*30).toFixed(1), height:+(hOv*10).toFixed(1), spread:+(sOv*5).toFixed(1), ornament:+(oSim*5).toFixed(1) } };
}
function starsOf(s){ if(s>=90) return 5; if(s>=75) return 4; if(s>=60) return 3; if(s>=40) return 2; return 1; }

let _dbCache = null;
async function loadDB(){
  if(_dbCache) return _dbCache;
  const r = await fetch('/data/plants_enriched.json');
  const d = await r.json();
  _dbCache = Array.isArray(d) ? d : (d.plants || d.db || []);
  return _dbCache;
}

// 比照 Ta_4：對 DB 評分 → { pool(≥4★), weak_pool(3★) } 依 灌木/草本/地被 分類
export async function scoreSubstitutes(analysis){
  const identified = (analysis && analysis.identified) || [];
  const db = await loadDB();
  const byCat = { '灌木': new Map(), '草本': new Map(), '地被': new Map() };
  for(const inp of identified){
    if(!byCat[inp.category]) continue;
    for(const d of db){
      const r = scorePair(inp, d);
      if(!r) continue;
      const name = (d['Name (中文名/學名)']||'').split(' / ')[0];
      const prev = byCat[inp.category].get(name);
      if(!prev || r.score > prev.score){
        byCat[inp.category].set(name, {
          db_name: name,
          db_latin: (d['Name (中文名/學名)']||'').split(' / ')[1] || '',
          db_photo: d['Photo (植物圖)'],
          db_role: d['Role (角色)'],
          db_foliage: d['FOLIAGE (葉形)'],
          db_height: d['HEIGHT (高度)'],
          db_spread: d['SPREAD (展幅)'],
          db_flw_season: d['FLW SEASON (花期)'],
          db_struct_int: d['STRUCT INT (結構期)'],
          density: d['N/m² (株數)'],
          flower_color: d.flower_color || [], leaf_color: d.leaf_color || [], fruit_color: d.fruit_color || [],
          score: r.score, stars: starsOf(r.score), matched_input: inp.id, breakdown: r.breakdown, category: inp.category
        });
      }
    }
  }
  const pool = { '灌木': [], '草本': [], '地被': [] };
  const weak_pool = { '灌木': [], '草本': [], '地被': [] };
  for(const c of ['灌木','草本','地被']){
    const arr = [...byCat[c].values()].sort((a,b)=>b.score-a.score);
    pool[c] = arr.filter(x=>x.stars>=4);
    weak_pool[c] = arr.filter(x=>x.stars===3);
  }
  return { pool, weak_pool };
}

// 從強配池派生「已選清單」餵下游 BOQ / 季相 / 匯出（category→Piet role）
const CAT_ROLE = { '草本':'matrix', '灌木':'primary', '地被':'filler' };
const EN_SEASON = { spring:[3,4,5], summer:[6,7,8], fall:[9,10,11], autumn:[9,10,11], winter:[12,1,2] };
// 從「花期/結構期」文字推月份（優先括號內 (3-4月)，否則英文季節詞）
function monthsFromText(txt){
  if(!txt) return [];
  const s = String(txt);
  const m = s.match(/(\d{1,2})\s*[-–~]\s*(\d{1,2})\s*月/);
  if(m){ let a=+m[1], b=+m[2], out=[]; if(a<=b){ for(let i=a;i<=b;i++) out.push(i); } else { for(let i=a;i<=12;i++) out.push(i); for(let i=1;i<=b;i++) out.push(i); } return out; }
  const one = s.match(/(\d{1,2})\s*月/); if(one) return [+one[1]];
  const out = new Set();
  if(/spring/i.test(s)) EN_SEASON.spring.forEach(x=>out.add(x));
  if(/summer/i.test(s)) EN_SEASON.summer.forEach(x=>out.add(x));
  if(/fall|autumn/i.test(s)) EN_SEASON.fall.forEach(x=>out.add(x));
  if(/winter/i.test(s)) EN_SEASON.winter.forEach(x=>out.add(x));
  return [...out];
}
function structMonths(txt){
  const s = String(txt||'');
  if(/year[- ]?round|evergreen|shrub|常綠/i.test(s)) return [1,2,3,4,5,6,7,8,9,10,11,12];
  return monthsFromText(s);
}
function plantToListItem(p){
  const c = p.category;
  const bloom = monthsFromText(p.db_flw_season);
  const struct = structMonths(p.db_struct_int);
  const fhex = (p.flower_color && p.flower_color.length) ? (COLOR_VOCAB[p.flower_color[0]] || '#e8c820') : '#e8c820';
  return { id:p.db_name, name_zh:p.db_name, name_latin:p.db_latin, role:CAT_ROLE[c]||'matrix',
           piet_analog:p.db_role||'-', category:c, density_per_m2:p.density, stars:p.stars,
           bloom_months: bloom, structural_months: struct,
           winter_structure: struct.includes(12) || struct.includes(1) || struct.includes(2),
           flower_color: fhex };
}

// 使用者逐株「納入方案」：強配預設納入、弱配展開後可加入；BOQ/季相依「已納入」即時重算。
let _registry = new Map();   // db_name -> pool/weak 植物物件
let _included = new Set();   // 已納入方案的 db_name
let _onPlanChange = null;    // 納入變動時回呼（重算 BOQ/季相）

export function getSelectedList(){
  const list = [];
  for(const name of _included){ const p = _registry.get(name); if(p) list.push(plantToListItem(p)); }
  const byRole = {};
  list.forEach(p => (byRole[p.role] = byRole[p.role]||[]).push(p));
  Object.values(byRole).forEach(arr => arr.forEach(p => p.ratio_pct = Math.round(100/arr.length)));
  return list;
}

// ---------- 渲染（比照 Ta_4 PlantCard / PoolByCategory）----------
function photoBase(dbPhoto){ return (dbPhoto||'').replace(/\.[^.]+$/, ''); }
const SLOTS = [{label:'葉',suf:'_leaf',fb:false},{label:'近景',suf:'_close',fb:true},{label:'全株',suf:'_habit',fb:false}];
function thumbHtml(base, slot){
  const v  = base ? `/public/photos/${encodeURIComponent(base+slot.suf)}.jpg` : '';
  const fb = (base && slot.fb) ? `/public/photos/${encodeURIComponent(base)}.jpg` : '';
  const onerr = fb
    ? `if(this.dataset.s!=='fb'){this.dataset.s='fb';this.src='${fb}';}else{this.style.display='none';this.closest('.photo-tile').classList.add('empty');}`
    : `this.style.display='none';this.closest('.photo-tile').classList.add('empty');`;
  const imgTag = v ? `<img src="${v}" loading="lazy" alt="${slot.label}" onerror="${onerr}">` : '';
  return `<figure class="photo-thumb"><div class="photo-tile${v?'':' empty'}">${imgTag}</div><figcaption>${slot.label}</figcaption></figure>`;
}
function starsHtml(n){ let s=''; for(let i=0;i<5;i++) s+=`<span class="${i<n?'on':''}">●</span>`; return `<span class="stars">${s}</span>`; }
function colorDots(keys, label){
  if(!keys || !keys.length) return '';
  return `<span class="cdots"><span class="cl">${label}</span>${keys.map(k=>`<span class="cd"><i style="background:${COLOR_VOCAB[k]||'#999'};${k==='白'?'border:.5px solid #ccc':''}"></i>${k}</span>`).join('')}</span>`;
}
function cardHtml(p, weak, included){
  const base = photoBase(p.db_photo);
  const nm = (p.db_name||'').replace(/"/g,'&quot;');
  return `<article class="pcard${weak?' weak':''}${included?' included':''}">
    <div class="photo-strip">${SLOTS.map(s=>thumbHtml(base,s)).join('')}</div>
    <div class="pc-head">
      <h3 class="pc-name">${p.db_name}</h3>
      <div class="pc-latin">${p.db_latin}</div>
      <div class="pc-meta">${starsHtml(p.stars)}<span class="pc-score">${p.score.toFixed(1)} 分</span>${weak?'<span class="pc-weak">弱匹配</span>':''}</div>
    </div>
    <dl class="pc-attr">
      <div><dt>葉形</dt><dd>${p.db_foliage||'-'}</dd></div>
      <div><dt>高度</dt><dd>${p.db_height||'-'}</dd><span class="dot">·</span><dt>花期</dt><dd>${p.db_flw_season||'-'}</dd></div>
    </dl>
    <div class="pc-colors">${colorDots(p.flower_color,'花')}${colorDots(p.fruit_color,'果')}${colorDots(p.leaf_color,'葉')}</div>
    <div class="pc-break">對應 ${p.matched_input} · 類別 ${p.breakdown.category} · 葉 ${p.breakdown.foliage} · 高 ${p.breakdown.height} · 幅 ${p.breakdown.spread} · 觀賞 ${p.breakdown.ornament}</div>
    <button class="incl-btn${included?' on':''}" data-name="${nm}">${included?'✓ 已納入方案':'＋ 納入方案'}</button>
  </article>`;
}
const CATS = ['灌木','草本','地被'];
function updatePlanSummary(){
  const el = document.getElementById('plan-summary'); if(!el) return;
  const byCat = {'灌木':0,'草本':0,'地被':0};
  for(const n of _included){ const p=_registry.get(n); if(p && byCat[p.category]!=null) byCat[p.category]++; }
  el.innerHTML = `<span class="ps-label">已納入方案</span><strong>${_included.size}</strong> 種　<span class="ps-cat">灌木 ${byCat['灌木']} · 草本 ${byCat['草本']} · 地被 ${byCat['地被']}</span><span class="ps-hint">（強配預設納入；弱配展開後可逐株「＋ 納入方案」，BOQ 與季相即時更新）</span>`;
}
export function renderPools(pool, weak_pool, onChange){
  _registry = new Map(); _included = new Set(); _onPlanChange = onChange || null;
  // 建 registry；強配預設納入方案
  for(const cat of CATS){
    for(const p of (pool[cat]||[])){ _registry.set(p.db_name, p); _included.add(p.db_name); }
    for(const p of ((weak_pool&&weak_pool[cat])||[])){ if(!_registry.has(p.db_name)) _registry.set(p.db_name, p); }
  }
  const tabs = document.getElementById('palette-tabs'); if(tabs) tabs.innerHTML='';
  const c = document.getElementById('palette-results'); if(!c) return;
  c.innerHTML = `<div class="plan-summary" id="plan-summary"></div>` + CATS.map(cat=>{
    const main = pool[cat]||[]; const weak = (weak_pool&&weak_pool[cat])||[];
    let body, weakBlock = '', tag;
    if(main.length){
      tag = `${main.length} 筆 ≥4★`;
      body = `<div class="pool-grid">${main.map(p=>cardHtml(p,false,_included.has(p.db_name))).join('')}</div>`;
      if(weak.length){
        weakBlock = `<div class="weak-wrap"><button class="weak-btn" data-cat="${cat}">也可以參考（弱匹配 ${weak.length}）▾</button><div class="weak-grid" id="weak-${cat}" style="display:none">${weak.map(p=>cardHtml(p,true,_included.has(p.db_name))).join('')}</div></div>`;
      }
    } else if(weak.length){
      // 無 ≥4★ 強配：直接攤開弱匹配參考，避免該類空白、也讓清單有內容
      tag = `0 筆 ≥4★ · 改列 ${weak.length} 筆相近參考`;
      body = `<div class="pool-note">此類暫無 ≥4★ 強配，以下為形態最相近的參考（可逐株納入方案）：</div><div class="pool-grid">${weak.map(p=>cardHtml(p,true,_included.has(p.db_name))).join('')}</div>`;
    } else {
      tag = `0 筆`;
      body = `<div class="pool-empty">本類別暫無符合的台灣原生植物。</div>`;
    }
    return `<section class="pool-cat"><h3 class="pool-h">${cat}<span class="pool-n">${tag}</span></h3>${body}${weakBlock}</section>`;
  }).join('');
  // 展開/收合弱配（純檢視，不影響納入）
  c.querySelectorAll('.weak-btn').forEach(b=>b.addEventListener('click',()=>{
    const g=document.getElementById('weak-'+b.dataset.cat);
    const open=g.style.display!=='none';
    g.style.display=open?'none':'';
    b.textContent=open?`也可以參考（弱匹配 ${g.children.length}）▾`:'收合 ▴';
  }));
  // 逐株「納入方案」開關：強配預設納入、弱配可加入；變動即時重算 BOQ/季相
  c.querySelectorAll('.incl-btn').forEach(b=>b.addEventListener('click',()=>{
    const n=b.dataset.name;
    if(_included.has(n)){ _included.delete(n); b.classList.remove('on'); b.textContent='＋ 納入方案'; b.closest('.pcard')?.classList.remove('included'); }
    else { _included.add(n); b.classList.add('on'); b.textContent='✓ 已納入方案'; b.closest('.pcard')?.classList.add('included'); }
    updatePlanSummary();
    if(_onPlanChange) _onPlanChange();
  }));
  updatePlanSummary();
}

// STEP 02：顯示風格摘要 + 辨識出的植物（灌木/草本/地被）
export function renderExtractionResult(analysis, imageBase64){
  const sec = document.getElementById('extraction-section'); if(!sec) return;
  const img = sec.querySelector('#extracted-image'); if(img && imageBase64) img.src=`data:image/jpeg;base64,${imageBase64}`;
  const dna = sec.querySelector('#dna-result'); if(!dna) return;
  const ids = (analysis && analysis.identified) || [];
  dna.innerHTML = `
    <div class="dna-summary"><p class="dna-text">${(analysis&&analysis.summary)||''}</p></div>
    ${analysis&&analysis.season_estimate?`<div class="dna-grid">
      <div class="dna-item"><span class="dna-label">季節估算</span><span class="dna-value">${analysis.season_estimate}</span></div>
      <div class="dna-item"><span class="dna-label">辨識植物</span><span class="dna-value">${ids.length} 株</span></div>
    </div>`:''}
    ${analysis&&analysis.texture_tags&&analysis.texture_tags.length?`<div class="aesthetic-tags">${analysis.texture_tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>`:''}
    <div class="identified-plants"><h4>辨識植物（灌木 / 草本 / 地被）</h4>
      ${ids.map(p=>`<div class="id-plant"><span class="id-plant-name">${p.common_name||''}</span><span class="id-plant-role">${p.category||''}</span><span class="id-confidence">${Math.round((p.confidence||0)*100)}%</span></div>`).join('')}
    </div>`;
  const colors = (analysis && analysis.dominant_colors) || [];
  const cp = sec.querySelector('#color-palette'); if(cp) cp.innerHTML = colors.map(c=>`<div class="color-swatch" style="background:${c}" title="${c}"></div>`).join('');
}
