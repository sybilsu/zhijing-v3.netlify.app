const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
function readEnv() {
  try { return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch(e){return process.env;}
}
const ENV = readEnv();
const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { data, error } = await supabase
      .from('rag_chunks')
      .select('source_file, source_type, created_at')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    // Group by source_file
    const map = {};
    for (const row of data || []) {
      const key = row.source_file;
      if (!map[key]) {
        map[key] = { source_file: row.source_file, source_type: row.source_type, chunks: 0, uploaded_at: row.created_at };
      }
      map[key].chunks++;
    }

    const files = Object.values(map).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    };
  } catch (err) {
    console.error('[list-rag] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
