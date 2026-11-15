import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ConflictError, runAudit } from './audit.mjs';
import { InputError, validateConfig } from './validators.mjs';
import { isResolvedInside } from './policy.mjs';

const root = path.resolve('.uxproof-data/runs');
await fs.mkdir(root, { recursive:true });
const json = (res, code, obj) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj)); };
const token = s => typeof s==='string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(s) && s!=='.' && s!=='..';
const server = http.createServer(async (req,res) => {
  try {
    const u = new URL(req.url,'http://localhost');
    if (!u.pathname.startsWith('/api/')) return json(res,404,{error:'Не найдено'});
    if (req.method === 'POST' && u.pathname === '/api/run') {
      if (req.headers['x-uxproof-client'] !== '1') return json(res,403,{error:'Нет локального заголовка клиента'});
      let body='';
      for await (const chunk of req) { body += chunk; if (body.length>200000) return json(res,413,{error:'Слишком большой запрос'}); }
      const config = validateConfig(JSON.parse(body));
      const runId = crypto.randomUUID();
      const report=await runAudit({...config,runId,outputDir:path.join(root,runId)});
      return json(res,200,report);
    }
    if (req.method==='GET' && u.pathname==='/api/history') {
      const reports=[];
      for (const name of await fs.readdir(root)) {
        if (!token(name)) continue;
        try { reports.push(JSON.parse(await fs.readFile(path.join(root,name,'report.json'),'utf8'))); } catch { /* skip */ }
      }
      reports.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
      return json(res,200,reports.slice(0,30));
    }
    if (req.method==='GET' && (u.pathname==='/api/image' || u.pathname==='/api/export')) {
      const runId=u.searchParams.get('runId'), filename=u.searchParams.get('file');
      if (!token(runId)) return json(res,400,{error:'Недопустимый ID'});
      let target;
      if (u.pathname==='/api/image') {
        if (!token(filename) || !filename.endsWith('.png')) return json(res,400,{error:'Недопустимое имя файла'});
        target=path.join(root,runId,'screenshots',filename);
      } else target=path.join(root,runId,'report.html');
      if (!isResolvedInside(root, target)) return json(res,400,{error:'Недопустимый путь'});
      let realTarget;
      try { realTarget = await fs.realpath(target); }
      catch { return json(res,404,{error:'Файл не найден'}); }
      const realRoot = await fs.realpath(root);
      if (!isResolvedInside(realRoot, realTarget)) return json(res,400,{error:'Недопустимый путь'});
      const data=await fs.readFile(realTarget);
      res.writeHead(200,{'Content-Type':u.pathname==='/api/image'?'image/png':'text/html; charset=utf-8',
        'Content-Disposition':u.pathname==='/api/export'?'attachment; filename="uxproof-report.html"':'inline',
        'X-Content-Type-Options':'nosniff'});
      return res.end(data);
    }
    return json(res,404,{error:'Не найдено'});
  } catch (e) {
    const message = String(e.message || e);
    const code = e instanceof InputError ? 400 : e instanceof ConflictError ? 409 : 500;
    return json(res, code, {error: message.slice(0, 500)});
  }
});
server.listen(4179,'127.0.0.1',()=>console.log('UXProof runner dev API: http://127.0.0.1:4179'));
