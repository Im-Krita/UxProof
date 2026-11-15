import type { AuditConfig, AuditReport } from './types';
function tauriAvailable() { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window; }
async function invokeTauri<T>(name:string,args:Record<string,unknown>={}) { const {invoke}=await import('@tauri-apps/api/core'); return invoke<T>(name,args); }
async function responseJson<T>(path:string,init?:RequestInit):Promise<T> {
 const response=await fetch(path,init);
 const json=await response.json();
 if(!response.ok) throw new Error(json.error||`HTTP ${response.status}`);
 return json as T;
}
export function runAudit(config:AuditConfig) {
 if (tauriAvailable()) return invokeTauri<AuditReport>('run_audit',{config});
 return responseJson<AuditReport>('/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-UXProof-Client':'1'},body:JSON.stringify(config)}).catch(error=>{
  if (error instanceof TypeError) throw new Error('Локальный runner недоступен. Запустите приложение через npm run dev.');
  throw error;
 });
}
export function listReports() { return tauriAvailable() ? invokeTauri<AuditReport[]>('list_reports') : responseJson<AuditReport[]>('/api/history'); }
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
export function downloadJson(name:string,data:unknown) {
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
