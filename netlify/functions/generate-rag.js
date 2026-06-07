const fs = require('fs');
const path = require('path');

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

// Simple keyword-based relevance scoring (MVP: no vector embeddings)
function keywordScore(chunk, queryTags) {
  const text = (chunk.text_zh + ' ' + chunk.text_en + ' ' + chunk.tags.join(' ')).toLowerCase();
  let score = 0;
  for (const tag of queryTags) {
    if (text.includes(tag.toLowerCase())) score += 1;
  }
  // Boost by principle relevance
  if (queryTags.includes('matrix') && chunk.principle === 'matrix planting') score += 3;
  if (queryTags.includes('winter') && chunk.principle === 'winter structure') score += 3;
  if (queryTags.includes('transparent') && chunk.principle === 'transparent plants') score += 3;
  if (queryTags.includes('grass') && chunk.principle === 'grass movement and light') score += 3;
  return score;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { query_tags, top_k = 3 } = JSON.parse(event.body);

    const dataPath = path.join(__dirname, '../../data/piet-principles.json');
    const principles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    const scored = principles.map(chunk => ({
      ...chunk,
      score: keywordScore(chunk, query_tags || [])
    }));

    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, top_k);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks: topChunks })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
