/**
 * fetch-and-generate.js
 * Runs inside GitHub Actions:
 *   1. Fetch 9 RSS sources concurrently
 *   2. Score articles by hotness
 *   3. Call Claude API to generate five-part structured content for top articles
 *   4. Write JSON files to ../data/
 */

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const DRY_RUN = process.argv.includes('--dry-run');

// ── RSS Sources ───────────────────────────────────────────────
const SOURCES = [
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', weight: 8, category: 'research', aiFilter: true },
  { name: 'The Verge AI',          url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', weight: 7, category: 'industry', aiFilter: false },
  { name: 'TechCrunch AI',         url: 'https://techcrunch.com/category/artificial-intelligence/feed/', weight: 7, category: 'startup', aiFilter: false },
  { name: 'VentureBeat AI',        url: 'https://venturebeat.com/category/ai/feed/', weight: 7, category: 'industry', aiFilter: false },
  { name: 'Google AI Blog',        url: 'https://blog.google/technology/ai/rss/', weight: 9, category: 'research', aiFilter: false },
  { name: 'Anthropic',             url: 'https://www.anthropic.com/rss.xml', weight: 9, category: 'research', aiFilter: false },
  { name: 'IEEE Spectrum',         url: 'https://spectrum.ieee.org/feeds/feed.rss', weight: 8, category: 'research', aiFilter: true },
  { name: 'Ars Technica',          url: 'https://feeds.arstechnica.com/arstechnica/index', weight: 7, category: 'tech', aiFilter: true },
  { name: 'Wired',                 url: 'https://www.wired.com/feed/rss', weight: 6, category: 'tech', aiFilter: true },
];

const AI_KEYWORDS = [
  'artificial intelligence','machine learning','deep learning','neural network',
  'large language model','LLM','GPT','Claude','Gemini','Llama','generative AI',
  'AI model','transformer','ChatGPT','OpenAI','Anthropic','DeepMind',
  'AI safety','foundation model','multimodal','reinforcement learning',
];

const KEYWORD_WEIGHTS = {
  'GPT':5,'Gemini':5,'Claude':5,'Llama':5,'AGI':5,'LLM':5,
  'multimodal':4,'reasoning':4,'open source':4,'generative':4,
  'OpenAI':4,'Anthropic':4,'DeepMind':4,
  'artificial intelligence':3,'machine learning':3,'GPU':3,'training':3,
  'AI':2,
};

// ── Utilities ─────────────────────────────────────────────────
function cleanHtml(html = '') {
  return html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim().slice(0,600);
}

function isAIRelated(title, summary) {
  const text = (title + ' ' + summary).toLowerCase();
  return AI_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function inferCategory(title, baseCat, content) {
  const t = (title+' '+content).toLowerCase();
  if (/research|paper|arxiv|benchmark|dataset/.test(t)) return 'research';
  if (/startup|funding|raise|series|valuation/.test(t)) return 'startup';
  if (/regulation|law|policy|safety|ban|eu|congress/.test(t)) return 'policy';
  if (/chip|gpu|hardware|nvidia|amd|intel|datacenter/.test(t)) return 'hardware';
  if (/product|launch|release|update|feature|app/.test(t)) return 'product';
  return baseCat || 'general';
}

function inferTags(title, content) {
  const t = (title+' '+content).toLowerCase();
  const tags = [];
  const map = {
    'GPT':/gpt/,'Claude':/claude/,'Gemini':/gemini/,'Llama':/llama/,
    'Multimodal':/multimodal|vision|image/,'Safety':/safety|alignment/,
    'OpenSource':/open.?source/,'Reasoning':/reasoning|inference/,
    'Agent':/agent|agentic/,'Robotics':/robot|embodied/,
  };
  for (const [tag, re] of Object.entries(map)) {
    if (re.test(t)) tags.push(tag);
  }
  return tags;
}

function hotScore(item) {
  let score = 0;
  // Time decay (max 40)
  const hrs = (Date.now() - new Date(item.date).getTime()) / 3600000;
  if (hrs<=6) score+=40; else if (hrs<=12) score+=35; else if (hrs<=24) score+=28;
  else if (hrs<=48) score+=20; else if (hrs<=72) score+=12; else if (hrs<=168) score+=6;
  // Source weight (max 25)
  score += (item.sourceWeight/10)*25;
  // Keyword weight (max 25)
  const text = item.title + ' ' + item.rawText;
  let kw = 0;
  for (const [k,w] of Object.entries(KEYWORD_WEIGHTS)) { if (text.includes(k)) kw+=w; }
  score += Math.min(kw/20,1)*25;
  // Title length bonus (max 10)
  const l = item.title.length;
  score += (l>=15&&l<=60)?10:(l>8?5:0);
  return Math.min(Math.round(score*10)/10, 100);
}

// ── RSS Fetching ──────────────────────────────────────────────
async function fetchSource(src) {
  const parser = new Parser({ timeout: 12000, headers: { 'User-Agent': 'NeuralPulse/1.0 (+https://github.com)' } });
  try {
    const feed = await parser.parseURL(src.url);
    return (feed.items||[]).slice(0,20).filter(item => {
      if (!src.aiFilter) return true;
      return isAIRelated(item.title||'', item.contentSnippet||item.content||'');
    }).map(item => {
      const rawText = cleanHtml(item.contentSnippet||item.content||item.summary||'');
      const title = (item.title||'').replace(/<[^>]+>/g,'').trim();
      const date = (item.pubDate||item.isoDate)
        ? new Date(item.pubDate||item.isoDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      return {
        id: Buffer.from(item.link||title).toString('base64').slice(0,20).replace(/[+/=]/g,''),
        title, date,
        source: src.name,
        sourceUrl: item.link||null,
        sourceWeight: src.weight,
        rawText,
        category: inferCategory(title, src.category, rawText),
        tags: inferTags(title, rawText),
      };
    });
  } catch(e) {
    console.warn(`  ⚠ ${src.name}: ${e.message}`);
    return [];
  }
}

// ── Claude API ────────────────────────────────────────────────
const PROMPT = `你是专业AI行业分析师。根据以下新闻，生成五段式结构化分析，严格输出合法JSON，不要输出任何其他内容：
{
  "basic": "150字以内基本介绍",
  "highlights": ["关键词：具体内容","关键词：具体内容","关键词：具体内容","关键词：具体内容"],
  "scenarios": ["场景名称：具体描述","场景名称：具体描述","场景名称：具体描述","场景名称：具体描述"],
  "industry": ["行业主体：影响描述","行业主体：影响描述","行业主体：影响描述","行业主体：影响描述"],
  "future": ["趋势关键词：展望描述","趋势关键词：展望描述","趋势关键词：展望描述","趋势关键词：展望描述"]
}
规则：每个数组4条，每条15-40字，必须以关键词+冒号开头，输出纯JSON。`;

async function generateContent(title, rawText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('  ℹ No API key, using raw text as basic');
    return { basic: rawText||title, highlights:[], scenarios:[], industry:[], future:[] };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'x-api-key': apiKey,
        'anthropic-version':'2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: PROMPT,
        messages: [{ role:'user', content: `标题：${title}\n\n内容：${rawText}` }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content[0].text.replace(/```json|```/g,'').trim();
    return JSON.parse(text);
  } catch(e) {
    console.warn(`  ⚠ Claude API error: ${e.message}`);
    return { basic: rawText||title, highlights:[], scenarios:[], industry:[], future:[] };
  }
}

// ── Week helpers ──────────────────────────────────────────────
function getWeekKey(d = new Date()) {
  const day = d.getDay();
  const diff = (day+4)%7;
  const wed = new Date(d); wed.setDate(d.getDate()-diff);
  const year = wed.getFullYear();
  const start = new Date(year,0,1);
  const wk = Math.ceil(((wed-start)/86400000+start.getDay()+1)/7);
  return `${year}-W${String(wk).padStart(2,'0')}`;
}

function getWeekRange() {
  const now = new Date();
  const diff = (now.getDay()+4)%7;
  const wed = new Date(now); wed.setDate(now.getDate()-diff);
  const tue = new Date(wed); tue.setDate(wed.getDate()+6);
  return { from: wed.toISOString().split('T')[0], to: tue.toISOString().split('T')[0], key: getWeekKey() };
}

// ── Existing data loader ──────────────────────────────────────
function loadExisting(file, fallback) {
  const fp = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const today = new Date().toISOString().split('T')[0];
  const isWednesday = new Date().getDay() === 3;
  const weekRange = getWeekRange();

  console.log(`\n🤖 Neural Pulse Auto-Update`);
  console.log(`   Date: ${today} | Wednesday: ${isWednesday} | Week: ${weekRange.key}\n`);

  // ── 1. Fetch RSS ──────────────────────────────────────────
  console.log('📡 Fetching RSS feeds...');
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const allRaw = [];
  results.forEach((r,i) => {
    if (r.status==='fulfilled') {
      console.log(`  ✓ ${SOURCES[i].name}: ${r.value.length} items`);
      allRaw.push(...r.value);
    }
  });
  console.log(`  Total: ${allRaw.length} items\n`);

  // ── 2. Deduplicate & score ────────────────────────────────
  const seen = new Set();
  const unique = allRaw.filter(item => {
    const k = item.title.slice(0,40).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const scored = unique.map(item => ({ ...item, hotScore: hotScore(item) }))
    .sort((a,b) => b.hotScore - a.hotScore);

  // ── 3. Generate content for top 5 (daily top 2 + 3 more for weekly pool) ─
  console.log('🧠 Generating AI content for top articles...');
  const top5 = scored.slice(0, DRY_RUN ? 1 : 5);
  const enriched = [];

  for (let i = 0; i < top5.length; i++) {
    const item = top5[i];
    console.log(`  [${i+1}/${top5.length}] ${item.title.slice(0,50)}...`);
    const content = await generateContent(item.title, item.rawText);
    enriched.push({ ...item, content });
    if (i < top5.length-1) await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  // Fill remaining scored items without AI content
  const rest = scored.slice(5).map(item => ({
    ...item,
    content: { basic: item.rawText||item.title, highlights:[], scenarios:[], industry:[], future:[] }
  }));
  const allEnriched = [...enriched, ...rest];

  // ── 4. Build daily data ───────────────────────────────────
  const dailyItems = allEnriched.slice(0,2).map((item,i) => ({
    id: item.id,
    title: item.title,
    date: item.date,
    source: item.source,
    sourceUrl: item.sourceUrl,
    hotScore: item.hotScore,
    category: item.category,
    tags: item.tags,
    content: item.content,
  }));

  // ── 5. Build weekly data ──────────────────────────────────
  // Load last week's data to merge with current
  const existingWeekly = loadExisting('weekly.json', { data: [] });
  const existingIds = new Set((existingWeekly.data||[]).map(x=>x.id));

  // Collect all this week's articles
  const weekPool = allEnriched.filter(item => item.date >= weekRange.from && item.date <= weekRange.to);
  
  // Merge with existing weekly data (to accumulate across days)
  const existingWeekItems = (existingWeekly.data||[]).filter(x => x.week_key === weekRange.key);
  const mergedIds = new Set(weekPool.map(x=>x.id));
  for (const existing of existingWeekItems) {
    if (!mergedIds.has(existing.id)) weekPool.push(existing);
  }

  const weeklyItems = weekPool
    .sort((a,b) => (b.hotScore||0) - (a.hotScore||0))
    .slice(0,5)
    .map((item,i) => ({
      id: item.id,
      rank: i+1,
      title: item.title,
      date: item.date,
      source: item.source,
      sourceUrl: item.sourceUrl,
      hotScore: item.hotScore,
      category: item.category,
      tags: item.tags,
      week_key: weekRange.key,
      content: item.content,
    }));

  // ── 6. Write JSON files ───────────────────────────────────
  const dailyPayload = {
    lastUpdate: today,
    generatedAt: new Date().toISOString(),
    count: dailyItems.length,
    data: dailyItems,
  };

  const weeklyPayload = {
    weekRange: { from: weekRange.from, to: weekRange.to },
    weekKey: weekRange.key,
    lastUpdate: today,
    generatedAt: new Date().toISOString(),
    count: weeklyItems.length,
    data: weeklyItems,
  };

  // Build search index (all articles, last 30 days)
  const thirtyDaysAgo = new Date(Date.now()-30*864e5).toISOString().split('T')[0];
  const searchIndex = allEnriched
    .filter(x => x.date >= thirtyDaysAgo)
    .slice(0,50)
    .map(item => ({
      id: item.id, title: item.title, date: item.date,
      source: item.source, hotScore: item.hotScore,
      category: item.category, tags: item.tags,
      snippet: (item.content?.basic||item.rawText||'').slice(0,200),
    }));

  // Stats
  const allCats = {};
  const allSrcs = {};
  allEnriched.slice(0,50).forEach(item => {
    allCats[item.category] = (allCats[item.category]||0)+1;
    allSrcs[item.source] = (allSrcs[item.source]||0)+1;
  });

  const statsPayload = {
    totalArticles: allEnriched.length,
    lastUpdate: today,
    categories: Object.entries(allCats).map(([category,count])=>({category,count})).sort((a,b)=>b.count-a.count),
    sources: Object.entries(allSrcs).map(([source,count])=>({source,count})).sort((a,b)=>b.count-a.count),
  };

  const metaPayload = {
    lastUpdate: today,
    lastUpdateISO: new Date().toISOString(),
    weekKey: weekRange.key,
    weekRange,
    totalFetched: allRaw.length,
    afterDedup: unique.length,
  };

  if (!DRY_RUN) {
    fs.writeFileSync(path.join(DATA_DIR,'daily.json'), JSON.stringify(dailyPayload, null, 2));
    fs.writeFileSync(path.join(DATA_DIR,'weekly.json'), JSON.stringify(weeklyPayload, null, 2));
    fs.writeFileSync(path.join(DATA_DIR,'search.json'), JSON.stringify(searchIndex, null, 2));
    fs.writeFileSync(path.join(DATA_DIR,'stats.json'), JSON.stringify(statsPayload, null, 2));
    fs.writeFileSync(path.join(DATA_DIR,'meta.json'), JSON.stringify(metaPayload, null, 2));
    console.log('\n✅ Written:');
    console.log(`   data/daily.json  — ${dailyItems.length} articles`);
    console.log(`   data/weekly.json — ${weeklyItems.length} articles (week ${weekRange.key})`);
    console.log(`   data/search.json — ${searchIndex.length} indexed`);
    console.log(`   data/stats.json  — ${Object.keys(allCats).length} cats, ${Object.keys(allSrcs).length} sources`);
    console.log(`   data/meta.json`);
  } else {
    console.log('\n[DRY RUN] Would write:');
    console.log('  daily:', dailyItems.length, 'items');
    console.log('  weekly:', weeklyItems.length, 'items');
    console.log('  First title:', dailyItems[0]?.title);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
