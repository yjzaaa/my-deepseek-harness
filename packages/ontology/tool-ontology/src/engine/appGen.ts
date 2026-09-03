/**
 * 应用生成器：从已建模型生成一个可运行的自包含 Node 应用
 * （node:sqlite 建库 + node:http CRUD API + 动态录入表单页）。
 * 生成物在模型工作区旁的 <项目>/app/ 目录，`app_run` 启动后可用浏览器/内嵌浏览器打开测试。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildTableSpecs } from './appRuntime.js'
import { loadWorkspace } from './yamlStore.js'

export interface GeneratedApp {
  appDir: string
  files: string[]
  tables: Array<{ table: string; columns: string[]; pk: string }>
}

/**
 * 生成可运行应用。
 * @param workspaceDir 绑定工作区根目录
 * @param project 项目名
 */
export function generateApp(workspaceDir: string, project: string): GeneratedApp {
  const { models } = loadWorkspace(join(workspaceDir, '.workbuddy', 'ontology', project, 'yaml'))
  const m1 = models.objectModel
  if (!m1) throw new Error('对象模型 M1 不存在，先调用 ontology_model 生成 m1-object-model.yaml')

  const specs = buildTableSpecs(m1)
  if (specs.length === 0) throw new Error('M1 中没有可建表的聚合')

  // 模型 JSON（供应用运行时使用：建表 + 表单元数据）
  const modelJson = JSON.stringify({ objectModel: m1, tables: specs.map(s => ({
    table: s.table, pk: s.pk, columns: s.columns.map(c => ({ name: c.name, type: c.sqlType, required: c.required, unique: c.unique })),
  })) }, null, 2)

  // app.js：内嵌模型数据，建库 + HTTP CRUD
  const appJs = APP_JS_TEMPLATE.replace('__MODEL_JSON__', () => modelJson.replace(/</g, '\\u003c'))

  // index.html：动态表单（从 /api/tables 拉结构，为每张表渲染插入表单 + 数据列表）
  const indexHtml = INDEX_HTML_TEMPLATE

  const appDir = join(workspaceDir, '.workbuddy', 'ontology', project, 'app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'models.json'), modelJson, 'utf-8')
  writeFileSync(join(appDir, 'app.cjs'), appJs, 'utf-8')
  writeFileSync(join(appDir, 'index.html'), indexHtml, 'utf-8')

  return {
    appDir,
    files: ['app.cjs', 'index.html', 'models.json'],
    tables: specs.map(s => ({ table: s.table, columns: s.columns.map(c => c.name), pk: s.pk })),
  }
}

/** app.js 模板：CJS，node:sqlite 建库 + node:http CRUD。 */
const APP_JS_TEMPLATE = `// 由 dsh-tool-ontology 生成 · 自包含本体驱动应用（node:sqlite + node:http）
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const { URL } = require('node:url');
const MODELS = __MODEL_JSON__;

const port = Number(process.argv[process.argv.indexOf('--port') + 1] ?? 0);
const db = new DatabaseSync(':memory:');

// 建表
for (const t of MODELS.tables) {
  const cols = t.columns.map(c => {
    let d = '"' + c.name + '" ' + c.type;
    if (c.required) d += ' NOT NULL';
    if (c.unique) d += ' UNIQUE';
    return d;
  }).join(', ');
  db.exec('CREATE TABLE IF NOT EXISTS "' + t.table + '" (' + cols + ')');
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj, null, 2));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.html')));
    return;
  }

  if (path === '/api/tables') {
    json(res, 200, { tables: MODELS.tables.map(t => {
      const row = db.prepare('SELECT COUNT(*) AS n FROM "' + t.table + '"').get();
      return { table: t.table, pk: t.pk, columns: t.columns.map(c => c.name), rows: row.n };
    }) });
    return;
  }

  // GET /api/<table>?<filter>
  const m = path.match(/^\\/api\\/([^/]+)$/);
  if (m) {
    const table = decodeURIComponent(m[1]);
    const spec = MODELS.tables.find(t => t.table === table);
    if (!spec) { json(res, 404, { error: 'table not found: ' + table }); return; }
    if (req.method === 'GET') {
      const where = [];
      const params = [];
      for (const [k, v] of u.searchParams) {
        if (spec.columns.some(c => c.name === k)) { where.push('"' + k + '" = ?'); params.push(v); }
      }
      const sql = 'SELECT * FROM "' + table + '"' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
      json(res, 200, { table, columns: spec.columns.map(c => c.name), rows: db.prepare(sql).all(...params), count: db.prepare(sql).all(...params).length });
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const cols = spec.columns.filter(c => data[c.name] !== undefined && data[c.name] !== '');
      if (cols.length) {
        db.prepare('INSERT INTO "' + table + '" (' + cols.map(c => '"' + c.name + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')')
          .run(...cols.map(c => String(data[c.name])));
      } else {
        db.prepare('INSERT INTO "' + table + '" DEFAULT VALUES').run();
      }
      const all = db.prepare('SELECT * FROM "' + table + '"').all();
      json(res, 200, { ok: true, table, count: all.length, lastRow: all[all.length - 1] ?? null });
      return;
    }
  }

  json(res, 404, { error: 'not found: ' + req.method + ' ' + path });
});

server.listen(port, () => {
  console.log('APP_READY http://127.0.0.1:' + server.address().port);
});
`

/** index.html：动态表单（表结构来自 /api/tables）。 */
const INDEX_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>本体驱动应用 · 数据录入</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Microsoft YaHei", sans-serif; background: #f5f6fa; color: #333; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 12px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #e3e6ef; border-radius: 10px; padding: 16px; }
  .card h2 { font-size: 15px; margin-bottom: 12px; color: #1f3b73; }
  .field { margin-bottom: 10px; }
  .field label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
  .field input { width: 100%; padding: 7px 10px; border: 1px solid #d0d4e0; border-radius: 6px; font-size: 13px; }
  button { background: linear-gradient(135deg, #2266e3, #1a56d4); color: #fff; border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  button.secondary { background: #fff; color: #1f3b73; border: 1px solid #d0d4e0; }
  .msg { font-size: 12px; margin-top: 8px; color: #2f9688; min-height: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { border: 1px solid #e3e6ef; padding: 5px 8px; text-align: left; }
  th { background: #f0f2f9; }
  .badge { display: inline-block; background: #eef3ff; color: #1f3b73; border-radius: 10px; padding: 1px 8px; font-size: 11px; margin-left: 6px; }
</style>
</head>
<body>
<h1>本体驱动应用</h1>
<div class="sub">由 dsh-tool-ontology 从本体模型生成 · 内存 SQLite · 表单即录即查</div>
<div class="grid" id="cards"></div>
<script>
async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}
async function load() {
  const { tables } = await api('/api/tables');
  const grid = document.getElementById('cards');
  grid.innerHTML = '';
  for (const t of tables) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2>' + t.table + ' <span class="badge">' + t.rows + ' 条</span></h2>';
    const form = document.createElement('div');
    const fields = t.columns.map(c =>
      '<div class="field"><label>' + c + '</label><input data-col="' + c + '"' + (c === t.pk ? ' placeholder="自动生成"' : '') + '></div>'
    ).join('');
    form.innerHTML = fields + '<button onclick="insertRow(\\'' + t.table + '\\')">新增</button> <button class="secondary" onclick="load()">刷新</button> <div class="msg" id="msg-' + t.table + '"></div>';
    card.appendChild(form);
    const tbl = document.createElement('table');
    tbl.id = 'tbl-' + t.table;
    card.appendChild(tbl);
    grid.appendChild(card);
    await refresh(t.table);
  }
}
async function insertRow(table) {
  const data = {};
  document.querySelectorAll('#msg-' + table).forEach(m => m.textContent = '');
  document.querySelectorAll('[data-col]').forEach(inp => {
    const v = inp.value.trim();
    if (v) data[inp.dataset.col] = v;
  });
  const r = await api('/api/' + table, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const m = document.getElementById('msg-' + table);
  m.textContent = r.ok ? '✓ 已新增（共 ' + r.count + ' 条）' : ('✗ ' + JSON.stringify(r));
  await refresh(table);
}
async function refresh(table) {
  const r = await api('/api/' + table);
  const tbl = document.getElementById('tbl-' + table);
  if (!tbl) return;
  tbl.innerHTML = '<tr><th>#</th>' + r.columns.map(c => '<th>' + c + '</th>').join('') + '</tr>' +
    r.rows.map((row, i) => '<tr><td>' + (i + 1) + '</td>' + r.columns.map(c => '<td>' + (row[c] ?? '') + '</td>').join('') + '</tr>').join('');
}
load();
</script>
</body>
</html>
`
