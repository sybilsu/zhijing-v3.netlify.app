const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
function readEnv() {
  try { return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch(e){return process.env;}
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
  "id": "<植物id>",
  "name_zh": "<中文名>",
  "name_latin": "<學名>",
  "role": "<matrix|primary|scatter|filler>",
  "ratio_pct": <整數，角色內的百分比>,
  "reason_zh": "<選用理由，1句話>",
  "piet_analog": "<對應的Piet常用植物>"
}

矩陣配比原則：matrix 50% / primary 30% / scatter 10% / filler 10%
全程使用繁體中文（台灣）。只輸出 JSON 陣列，不含 markdown 標記。`;

function filterPlantsByCondition(plants, siteConditions) {
  return plants.filter(plant => {
    if (siteConditions.light) {
      const lightMap = { '全日照': 'full', '半日照': 'partial', '半遮蔭': 'partial', '全遮蔭': 'shade' };
      const reqLight = lightMap[siteConditions.light] || 'full';
      if (!plant.site.light.includes(reqLight)) return false;
    }
    if (siteConditions.moisture) {
      const moistureMap = { '乾燥': 'dry', '中等': 'mesic', '濕潤': 'wet' };
      const reqMoisture = moistureMap[siteConditions.moisture] || 'mesic';
      if (!plant.site.moisture.includes(reqMoisture)) return false;
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

    const dataPath = path.join(__dirname, '../../data/plants-mock.json');
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

台灣中部原生植物候選池（${candidatePlants.length}種）：
${JSON.stringify(candidatePlants.map(p => ({
  id: p.id, name_zh: p.name_zh, name_latin: p.name_latin,
  role: p.role, piet_analog: p.piet_analog, match_tags: p.match_tags,
  height_cm: p.height_cm, winter_structure: p.winter_structure,
  piet_similarity: p.piet_similarity
})), null, 2)}

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
