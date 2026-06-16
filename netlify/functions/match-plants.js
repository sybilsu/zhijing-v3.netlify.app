const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8')
        .split('\n').filter(l => l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch (e) { return process.env; }
}
const ENV = readEnv();

const MATCHING_SYSTEM_PROMPT = `你是台灣中部原生植物景觀設計專家，同時精通 Piet Oudolf 矩陣種植原則（《Planting: A New Perspective》）。

根據提供的設計DNA、基地條件、Piet 原則 RAG chunks 與候選原生植物庫，生成 2-3 組「台灣原生植物替代清單」。

每組必須以 JSON 格式包含：
- name（組合詩意名稱，例：「芒草晨霧」「秋穗搖曳」）
- similarity_score（0-100整數，與Piet參考圖的美學符合度）
- description（一段設計師語彙的組合描述，繁體中文，2-3句）
- plants（依角色分類，格式見下方）
- seasonal_notes（物件，spring/summer/autumn/winter 各一句台灣在地觀察）
- piet_principle_basis（引用的 Piet 原則，1-2句）

plants 格式（陣列）：
{
  "name_zh": "<中文名>",
  "name_latin": "<學名>",
  "role": "<Structure|Primary|Matrix|Filler|Scatter>",
  "ratio_pct": <整數，角色內的百分比>,
  "reason_zh": "<選用理由，1句話>",
  "foliage": "<葉形描述>",
  "height": "<高度範圍>"
}

矩陣配比原則：Matrix 50% / Primary 30% / Scatter 10% / Filler 10%
全程使用繁體中文（台灣）。只輸出 JSON 陣列，不含 markdown 標記。`;

function parseName(nameField) {
  const parts = (nameField || '').split(' / ');
  return {
    name_zh: (parts[0] || '').trim(),
    name_latin: (parts[1] || '').trim()
  };
}

function filterPlantsByCondition(plants, siteConditions) {
  if (!siteConditions || (!siteConditions.light && !siteConditions.moisture)) return plants;

  return plants.filter(plant => {
    const lightField = (plant['LIGHT (光照)'] || '').toLowerCase();

    if (siteConditions.light) {
      const lightMap = {
        '全日照': 'full sun',
        '半日照': 'part',
        '半遮蔭': 'part',
        '全遮蔭': 'shade'
      };
      const reqLight = lightMap[siteConditions.light];
      if (reqLight === 'full sun' && !lightField.includes('full sun')) return false;
      if (reqLight === 'shade' && !lightField.includes('shade')) return false;
      // 半日照/半遮蔭：接受 part shade 或 full sun 都可以
    }
    return true;
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { designDNA, siteConditions, ragChunks } = JSON.parse(event.body);

    const dataPath = path.join(__dirname, '../../data/plants_enriched.json');
    const allPlants = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const candidatePlants = filterPlantsByCondition(allPlants, siteConditions || {});

    const contextStr = `
設計DNA：
${JSON.stringify(designDNA, null, 2)}

基地條件：
- 日照：${siteConditions?.light || '全日照'}
- 水分：${siteConditions?.moisture || '中等'}
- 海拔：${siteConditions?.altitude || 200}m
- 面積：${siteConditions?.area || 100}㎡

Piet 設計原則與知識庫（RAG 語意檢索，共 ${(ragChunks || []).length} 筆）：
${(ragChunks || []).map(c => `- [${c.source_file || c.source_type || 'RAG'}] ${c.content}`).join('\n')}

台灣中部原生植物候選池（${candidatePlants.length} 種）：
${JSON.stringify(candidatePlants.map(p => {
  const { name_zh, name_latin } = parseName(p['Name (中文名/學名)']);
  return {
    name_zh,
    name_latin,
    category: p.category,
    role: p['Role (角色)'],
    foliage: p['FOLIAGE (葉形)'],
    height: p['HEIGHT (高度)'],
    spread: p['SPREAD (展幅)'],
    flw_season: p['FLW SEASON (花期)'],
    struct_int: p['STRUCT INT (結構期)'],
    light: p['LIGHT (光照)'],
    notes: p['NOTES (備註)']
  };
}), null, 2)}

請生成 2-3 組台灣原生植物替代方案，輸出純 JSON 陣列。`;

    const apiKey = ENV.OPENAI_API_KEY;
    console.log('[match-plants] key prefix:', apiKey ? apiKey.slice(0, 10) : 'MISSING');
    const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1' });

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      messages: [
        { role: 'system', content: MATCHING_SYSTEM_PROMPT },
        { role: 'user', content: contextStr }
      ]
    });

    let rawContent = response.choices[0].message.content;
    rawContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const palettes = JSON.parse(rawContent);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ palettes })
    };
  } catch (err) {
    console.error('match-plants error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || '植物匹配失敗' })
    };
  }
};
