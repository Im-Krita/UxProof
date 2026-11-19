import{AlertCircle,ArrowRight,Check,ClipboardList,Sparkles}from 'lucide-react';
import type {AuditReport} from './types';
import type {ReactNode} from 'react';

export const formatDate=(date:string)=>{try{return new Date(date).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return date;}};
export function sameOriginDifferentPath(a:AuditReport,b:AuditReport){
 if(a.status!=='completed'||b.status!=='completed')return false;
 if(!a.comparisonProfileKey||a.comparisonProfileKey!==b.comparisonProfileKey)return false;
 if(!a.comparisonKey||!b.comparisonKey||a.comparisonKey===b.comparisonKey)return false;
 try{
  const left=new URL(a.baseUrl), right=new URL(b.baseUrl);
  return left.origin===right.origin&&left.pathname!==right.pathname&&left.search===right.search&&left.hash===right.hash&&!left.username&&!left.password&&!right.username&&!right.password;
 }catch{return false;}
}
export function shortUrl(value:string){try{const url=new URL(value);return `${url.host}${url.pathname}`;}catch{return value;}}
export function confirmedLabel(count:number){
 const abs=Math.abs(count), mod10=abs%10, mod100=abs%100;
 if(mod10===1&&mod100!==11) return `${count} подтверждённое замечание`;
 if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14)) return `${count} подтверждённых замечания`;
 return `${count} подтверждённых замечаний`;
}
export function comparisonLabel(state?:string){
 if(state==='still-present') return 'Есть в предыдущем прогоне';
 if(String(state)==='new') return 'Новое наблюдение';
 if(state==='unverified') return 'Нет совпадения — требуется проверка';
 if(state==='resolved') return 'Ошибка шага не повторилась';
 return '';
}
export function Score({passed,total}:{passed:number,total:number}) { const percent=total?Math.round(passed/total*100):0;return <div className="score"><div className="score-track"><div style={{width:`${percent}%`}}/></div><b>{passed}/{total}</b></div>; }
export function Level({severity}:{severity:string}) {return <span className={`level level-${severity}`}>{severity==='high'?'Высокий':severity==='medium'?'Средний':'Низкий'}</span>}
export function Confidence({status}:{status:string}) {return <span className={`confidence ${status==='confirmed'?'confirmed':'suggestion'}`}>{status==='confirmed'?<Check size={12}/>:<Sparkles size={12}/>} {status==='confirmed'?'Подтверждённые':'Рекомендации'}</span>}

export function EmptyState({title,description,action,onAction}:{title:string;description:string;action:string;onAction:()=>void}) {
 return <div className="empty-state panel-card"><div className="empty-icon"><ClipboardList size={30}/></div><h2>{title}</h2><p>{description}</p><button className="btn primary" onClick={onAction}>{action}<ArrowRight size={16}/></button></div>
}

export function WarningBox({children}:{children:ReactNode}) {
 return <div className="report-warnings"><AlertCircle size={17}/><div>{children}</div></div>
}
