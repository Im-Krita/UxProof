import type { AuditConfig, AuditReport } from './types';
import { isHistoryReport } from '../../runner/history.mjs';

const HISTORY_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 12 * 60 * 1000 + 30_000;

function tauriAvailable() { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window; }
async function invokeTauri<T>(name:string,args:Record<string,unknown>={}) { const {invoke}=await import('@tauri-apps/api/core'); return invoke<T>(name,args); }

function runnerUnavailable() {
  return new Error('Локальный runner недоступен. Запустите приложение через npm run dev.');
}

// Vite exposes this only when `npm run dev` generated a session token; a release
// build never has it, and the Tauri IPC path does not use the dev API at all.
function clientHeaders(extra:Record<string,string>={}):Record<string,string> {
  const token=(import.meta as ImportMeta & {env?:Record<string,string|undefined>}).env?.VITE_UXPROOF_DEV_TOKEN;
  return {'X-UXProof-Client':'1',...(token?{'X-UXProof-Token':token}:{}),...extra};
}

function requestSignal(user:AbortSignal|undefined, timeoutMs:number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = user && typeof AbortSignal.any === 'function' ? AbortSignal.any([user, timeout]) : (user ?? timeout);
  return { signal, timeout };
}

async function responseJson<T>(path:string,init?:RequestInit,timeoutMs=HISTORY_TIMEOUT_MS):Promise<T> {
  const { signal, timeout } = requestSignal(init?.signal ?? undefined, timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal });
  } catch (error) {
    const timedOut = timeout.aborted && !init?.signal?.aborted;
    if (timedOut) {
      const expired = new Error('Проверка превысила лимит времени и была остановлена');
      expired.name = 'AbortError';
      (expired as Error & { timedOut?: boolean }).timedOut = true;
      throw expired;
    }
    if (error instanceof TypeError) throw runnerUnavailable();
    throw error;
  }
  const text = await response.text();
  let json: { error?: string } | undefined;
  if (text.trim()) {
    try { json = JSON.parse(text); }
    catch { throw response.ok ? new Error('Некорректный ответ сервера') : runnerUnavailable(); }
  }
  if (!response.ok) throw new Error(json?.error || (response.status === 409 ? 'Уже выполняется другая проверка. Дождитесь её завершения.' : runnerUnavailable().message));
  if (json === undefined) throw runnerUnavailable();
  return json as T;
}

export function runAudit(config:AuditConfig, signal?:AbortSignal) {
  // Tauri IPC has no AbortSignal bridge: Stop must call cancelAudit(), which
  // terminates the Node/Chromium process tree. In the browser the signal also
  // closes the HTTP request, and the dev API cancels on 'close'.
  if (tauriAvailable()) return invokeTauri<AuditReport>('run_audit',{config});
  return responseJson<AuditReport>('/api/run',{method:'POST',headers:clientHeaders({'Content-Type':'application/json'}),body:JSON.stringify(config),signal}, RUN_TIMEOUT_MS);
}

export function cancelAudit() {
  if (tauriAvailable()) return invokeTauri<string>('cancel_audit');
  return responseJson<{ok:boolean}>('/api/cancel',{method:'POST',headers:clientHeaders()});
}

export interface HistoryPage { reports: AuditReport[]; skipped: number }

export async function listReports():Promise<HistoryPage> {
  const payload:unknown = await (tauriAvailable() ? invokeTauri<unknown>('list_reports') : responseJson<unknown>('/api/history',{headers:clientHeaders()}));
  const records = Array.isArray(payload) ? payload : (payload as {reports?:unknown})?.reports;
  if (!Array.isArray(records)) throw new Error('Некорректный ответ истории');
  const skipped = Array.isArray(payload) ? 0 : Number((payload as {skipped?:unknown}).skipped) || 0;
  return { reports: records.filter(isHistoryReport), skipped };
}

export async function screenshotUrl(runId:string,filename:string):Promise<string> {
  if(tauriAvailable()) return invokeTauri<string>('read_screenshot',{runId,filename});
  return `/api/image?runId=${encodeURIComponent(runId)}&file=${encodeURIComponent(filename)}`;
}

export async function exportHtml(runId:string):Promise<string> {
  if(tauriAvailable()) return invokeTauri<string>('export_html',{runId});
  const url=`/api/export?runId=${encodeURIComponent(runId)}`;
  const a=document.createElement('a');a.href=url;a.download='uxproof-report.html';document.body.append(a);a.click();a.remove();
  return 'HTML-отчёт скачивается браузером';
}

export async function exportXlsx(runId:string):Promise<string> {
  if(tauriAvailable()) return invokeTauri<string>('export_xlsx',{runId});
  const url=`/api/xlsx?runId=${encodeURIComponent(runId)}`;
  const a=document.createElement('a');a.href=url;a.download='uxproof-report.xlsx';document.body.append(a);a.click();a.remove();
  return 'Excel-отчёт скачивается браузером';
}

// Trace lives next to the report; opening it uses the same whitelist as screenshots.
export async function exportTrace(runId:string,relativePath:string):Promise<string> {
  const filename=relativePath.split('/').pop()||'';
  if(!/^trace-\d+-\d+\.zip$/.test(filename)) throw new Error('Недопустимое имя trace-файла');
  if(tauriAvailable()) return invokeTauri<string>('export_trace',{runId,filename});
  const url=`/api/trace?runId=${encodeURIComponent(runId)}&file=${encodeURIComponent(filename)}`;
  const a=document.createElement('a');a.href=url;a.download='uxproof-trace.zip';document.body.append(a);a.click();a.remove();
  return 'Trace скачивается браузером';
}

export interface PlannedStep { type:string; name:string; target:string; value:string }

// The plan is only a proposal: it is validated by the runner and approved in the UI.
export async function planSteps(goal:string,baseUrl:string,provider:'openai'|'ollama'):Promise<PlannedStep[]> {
  if(tauriAvailable()) return invokeTauri<PlannedStep[]>('plan_steps',{goal,baseUrl,provider});
  const payload=await responseJson<{steps?:unknown}>('/api/plan',{method:'POST',headers:clientHeaders({'Content-Type':'application/json'}),body:JSON.stringify({goal,baseUrl,provider})},60_000);
  return Array.isArray(payload.steps)?payload.steps as PlannedStep[]:[];
}

export function downloadJson(name:string,data:unknown) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
