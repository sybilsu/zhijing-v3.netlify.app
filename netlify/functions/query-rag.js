const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
function readEnv() {
  try { return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch(e){return process.env;}
}
const ENV = readEnv();
const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' });
const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY);

// Source type relevance weights
const SOURCE_WEIGHTS = { plant_db: 1.2, pdf: 1.0, field_note: 1.0, image: 0.9 };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { query, top_k = 5, filter_source = null } = JSON.parse(event.body);

    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少查詢內容' }) };
    }

    // Embed query
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    });
    const queryEmbedding = embRes.data[0].embedding;

    // Similarity search via Supabase RPC
    const { data: chunks, error } = await supabase.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_count: top_k * 2,  // fetch extra for reranking
      filter_source: filter_source
    });

    if (error) throw new Error(error.message);

    // Rerank by weighted similarity
    const reranked = (chunks || [])
      .map(c => ({
        ...c,
        weighted_score: c.similarity * (SOURCE_WEIGHTS[c.source_type] || 1.0)
      }))
      .sort((a, b) => b.weighted_score - a.weighted_score)
      .slice(0, top_k);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks: reranked })
    };
  } catch (err) {
    console.error('[query-rag] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
