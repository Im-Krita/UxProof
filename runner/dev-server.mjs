import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CancelledError, ConflictError, IdleError, cancelRunningAudit, runAudit } from './audit.mjs';
import { acquireRunDirectoryLock, defaultRunsDir } from './audit-lock.mjs';
import { InputError, validateConfig } from './validators.mjs';
import { isResolvedInside } from './policy.mjs';
import { isHistoryReport } from './history.mjs';

const root = defaultRunsDir();
await fs.mkdir(root, { recursive:true });
const port = Number(process.env.UXPROOF_DEV_PORT ?? 4179);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Недопустимый порт dev API');
const json = (res, code, obj) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj)); };
const token = s => typeof s==='string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(s) && s!=='.' && s!=='..';
const server = http.createServer(async (req,res) => {
  try {
    const u = new URL(req.url,'http://localhost');
    if (!u.pathname.startsWith('/api/')) return json(res,404,{error:'Не найдено'});
    if (req.method === 'POST' && u.pathname === '/api/cancel') {
      if (req.headers['x-uxproof-client'] !== '1') return json(res,403,{error:'Нет локального заголовка клиента'});
      cancelRunningAudit();
      return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && u.pathname === '/api/run') {
      if (req.headers['x-uxproof-client'] !== '1') return json(res,403,{error:'Нет локального заголовка клиента'});
      let body='';
      for await (const chunk of req) { body += chunk; if (body.length>200000) return json(res,413,{error:'Слишком большой запрос'}); }
      const config = validateConfig(JSON.parse(body));
      const runId = crypto.randomUUID();
      const outputDir = path.join(root, runId);
      const release = acquireRunDirectoryLock(outputDir);
      const onClose = () => {
        if (res.headersSent || res.writableFinished) return;
        try { cancelRunningAudit(); } catch { /* idle after completion */ }
      };
      req.on('close', onClose);
      try {
        const report=await runAudit({...config,runId,outputDir});
        return json(res,200,report);
      } finally {
        req.off('close', onClose);
        release();
      }
    }
    if (req.method==='GET' && u.pathname==='/api/history') {
      const reports=[];
      let skipped=0;
      for (const name of await fs.readdir(root)) {
        if (!token(name)) continue;
        try {
          const report = JSON.parse(await fs.readFile(path.join(root,name,'report.json'),'utf8'));
          if (isHistoryReport(report)) reports.push(report); else skipped++;
        } catch { skipped++; /* malformed, incomplete or legacy record */ }
      }
      reports.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
      return json(res,200,{reports:reports.slice(0,30),skipped});
    }
    if (req.method==='GET' && (u.pathname==='/api/image' || u.pathname==='/api/export' || u.pathname==='/api/trace')) {
      const runId=u.searchParams.get('runId'), filename=u.searchParams.get('file');
      if (!token(runId)) return json(res,400,{error:'Недопустимый ID'});
      let target;
      if (u.pathname==='/api/image') {
        if (!token(filename) || !filename.endsWith('.png')) return json(res,400,{error:'Недопустимое имя файла'});
        target=path.join(root,runId,'screenshots',filename);
      } else if (u.pathname==='/api/trace') {
        if (!token(filename) || !filename.endsWith('.zip')) return json(res,400,{error:'Недопустимое имя файла'});
        target=path.join(root,runId,'traces',filename);
      } else target=path.join(root,runId,'report.html');
      if (!isResolvedInside(root, target)) return json(res,400,{error:'Недопустимый путь'});
      let realTarget;
      try { realTarget = await fs.realpath(target); }
      catch { return json(res,404,{error:'Файл не найден'}); }
      const realRoot = await fs.realpath(root);
      if (!isResolvedInside(realRoot, realTarget)) return json(res,400,{error:'Недопустимый путь'});
      const data=await fs.readFile(realTarget);
      const type = u.pathname==='/api/image' ? 'image/png' : u.pathname==='/api/trace' ? 'application/zip' : 'text/html; charset=utf-8';
      const disposition = u.pathname==='/api/image' ? 'inline' : `attachment; filename="${u.pathname==='/api/trace' ? 'uxproof-trace.zip' : 'uxproof-report.html'}"`;
      res.writeHead(200,{'Content-Type':type,'Content-Disposition':disposition,'X-Content-Type-Options':'nosniff'});
      return res.end(data);
    }
    return json(res,404,{error:'Не найдено'});
  } catch (e) {
    const message = String(e.message || e);
    const code = e instanceof InputError ? 400 : (e instanceof ConflictError || e instanceof IdleError || e instanceof CancelledError) ? 409 : 500;
    return json(res, code, {error: message.slice(0, 500)});
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`UXProof runner dev API: http://127.0.0.1:${server.address().port}`));
