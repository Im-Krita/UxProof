import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Activity, AlertCircle, ArrowLeft, ArrowRight, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleHelp, ClipboardList, Clock3, Code2, Download, ExternalLink, FileClock, FileDown, FileJson, Globe2, Image as ImageIcon, Info, LayoutDashboard, ListChecks, Loader2, Monitor, MousePointerClick, Play, Plus, RotateCcw, ShieldCheck, Smartphone, Sparkles, Trash2, X, XCircle } from 'lucide-react';
import { DEFAULT_CONFIG, DEFAULT_VIEWPORTS, STEP_LABELS } from './lib/presets';
import type { AuditConfig, AuditReport, AuditStep, Issue, Panel, Scenario, StepType } from './lib/types';
import { downloadJson, exportHtml, listReports, runAudit, screenshotUrl } from './lib/bridge';

const STEP_TYPES=Object.keys(STEP_LABELS) as StepType[];
function clientUrlError(value:string) {
  try {
    const url=new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return 'Укажите http(s) адрес без логина и пароля';
    const host=url.hostname.toLowerCase();
    if (host==='169.254.169.254' || host.startsWith('169.254.') || host==='0.0.0.0' || host==='metadata.google.internal') return 'Служебный адрес запрещён';
    return '';
  } catch { return 'Укажите корректный URL'; }
}
const IconForType=({type}:{type:string}) => type==='click'?<MousePointerClick size={16}/>:type.startsWith('expect')?<CheckCheck size={16}/>:<Code2 size={16}/>;
const formatDate=(date:string)=>{try{return new Date(date).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return date;}};
function Score({passed,total}:{passed:number,total:number}) { const percent=total?Math.round(passed/total*100):0;return <div className="score"><div className="score-track"><div style={{width:`${percent}%`}}/></div><b>{passed}/{total}</b></div>; }
function Level({severity}:{severity:string}) {return <span className={`level level-${severity}`}>{severity==='high'?'Высокий':severity==='medium'?'Средний':'Низкий'}</span>}
function Confidence({status}:{status:string}) {return <span className={`confidence ${status==='confirmed'?'confirmed':'suggestion'}`}>{status==='confirmed'?<Check size={12}/>:<Sparkles size={12}/>} {status==='confirmed'?'Проверено':'Рекомендация'}</span>}

export default function App() {
 const [config,setConfig]=useState<AuditConfig>(()=>structuredClone(DEFAULT_CONFIG));
 const [panel,setPanel]=useState<Panel>('scenarios');
 const [activeScenarioId,setActiveScenarioId]=useState('server');
 const [busy,setBusy]=useState(false);
 const [report,setReport]=useState<AuditReport|null>(null);
 const [history,setHistory]=useState<AuditReport[]>([]);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [activeIssue,setActiveIssue]=useState<Issue|null>(null);
 const [issueFilter,setIssueFilter]=useState<'all'|'confirmed'|'recommendation'>('all');
 const [selectedRun,setSelectedRun]=useState<string>('');
 const [screenshot,setScreenshot]=useState('');
 const [shotFailed,setShotFailed]=useState(false);
 const importRef=useRef<HTMLInputElement|null>(null);
 const busyRef=useRef(false);
 const closeRef=useRef<HTMLButtonElement|null>(null);
 const activeScenario=config.scenarios.find(s=>s.id===activeScenarioId) || config.scenarios[0];
 const currentReport=panel==='history'?history.find(r=>r.runId===selectedRun)||null:report;
 const filteredIssues=useMemo(()=>currentReport?.issues.filter(i=>issueFilter==='all'||i.status===issueFilter)||[],[currentReport,issueFilter]);
 useEffect(()=>{listReports().then(setHistory).catch(()=>{});},[]);
 useEffect(()=>{
   setScreenshot('');
   setShotFailed(false);
   if(!activeIssue?.screenshot || !currentReport) return;
   let live=true;
   screenshotUrl(currentReport.runId,activeIssue.screenshot).then(u=>{if(live)setScreenshot(u);}).catch(()=>{});
   return ()=>{live=false;};
 },[activeIssue,currentReport]);
 useEffect(()=>{
   if(!activeIssue) return;
   closeRef.current?.focus();
   const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape') setActiveIssue(null); };
   window.addEventListener('keydown', onKey);
   return ()=>window.removeEventListener('keydown', onKey);
 },[activeIssue]);
 const updateScenario=(fn:(s:Scenario)=>Scenario)=>setConfig(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===activeScenarioId?fn(s):s)}));
 const updateStep=(index:number,patch:Partial<AuditStep>)=>updateScenario(s=>({...s,steps:s.steps.map((st,i)=>i===index?{...st,...patch}:st)}));
 const moveStep=(index:number,direction:-1|1)=>updateScenario(s=>{
   const next=index+direction;
   if(next<0 || next>=s.steps.length) return s;
   const steps=[...s.steps];
   [steps[index],steps[next]]=[steps[next],steps[index]];
   return {...s,steps};
 });
 const addScenario=()=>{
   const id=`scenario-${Date.now()}`;
   setConfig(prev=>({...prev,scenarios:[...prev.scenarios,{id,title:'Новый сценарий',description:'',steps:[{name:'Проверить наличие элемента',type:'expectVisible',target:'css:main',value:''}]}]}));
   setActiveScenarioId(id);
 };
 const deleteScenario=()=>{
   if(config.scenarios.length<2)return;
   setConfig(prev=>({...prev,scenarios:prev.scenarios.filter(s=>s.id!==activeScenarioId)}));
   setActiveScenarioId(config.scenarios.find(s=>s.id!==activeScenarioId)?.id||'');
 };
 const start=async()=>{
   if(busyRef.current) return;
   const urlError=clientUrlError(config.baseUrl);
   if(urlError){setError(urlError);return;}
   if(!config.scenarios.length || config.scenarios.some(s=>!s.steps.length)){setError('Добавьте хотя бы один шаг');return;}
   busyRef.current=true;
   setError('');setNotice('');setBusy(true);
   try{
     const r=await runAudit(config);
     setReport(r);setPanel('results');setIssueFilter('all');setActiveIssue(null);
     setHistory(prev=>[r,...prev.filter(h=>h.runId!==r.runId)].slice(0,30));
   }catch(e){setError(String(e instanceof Error?e.message:e));}
   finally{busyRef.current=false;setBusy(false);}
 };
 const exportReport=async(r:AuditReport)=>{
   try{const info=await exportHtml(r.runId);setNotice(`HTML-отчёт: ${info}`);}catch(e){setError(String(e));}
 };
 const importProject=async(event:ChangeEvent<HTMLInputElement>)=>{
   const file=event.target.files?.[0];if(!file)return;
   try {
     if(file.size>2_000_000) throw Error('Файл проекта слишком большой');
     const value=JSON.parse(await file.text()) as AuditConfig;
     if(typeof value.baseUrl!=='string'||!Array.isArray(value.scenarios)||!Array.isArray(value.viewports)||!value.scenarios.length||!value.viewports.length||value.scenarios.length>10||value.viewports.length>4) throw Error('Некорректный формат проекта');
     const urlError=clientUrlError(value.baseUrl);
     if(urlError) throw Error(urlError);
     for(const scenario of value.scenarios){
       if(!scenario || typeof scenario.title!=='string' || !Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length>30) throw Error('Некорректный сценарий');
       for(const step of scenario.steps){ if(!step || !STEP_TYPES.includes(step.type)) throw Error(`Неизвестный шаг: ${step?.type ?? ''}`); }
     }
     const aiProvider: 'openai' | 'ollama' = value.options?.aiProvider==='ollama' ? 'ollama' : 'openai';
     const normalized: AuditConfig={...value,options:{enableAI:Boolean(value.options?.enableAI),aiProvider}};
     setConfig(normalized);setActiveScenarioId(value.scenarios[0].id);setPanel('scenarios');setNotice(`Проект «${value.project}» импортирован`);
   }catch(e){setError(`Ошибка импорта: ${String(e instanceof Error?e.message:e)}`);}
   event.target.value='';
 };
 const menu=[{id:'scenarios' as Panel,label:'Сценарии',icon:ListChecks},{id:'results' as Panel,label:'Результаты',icon:LayoutDashboard},{id:'history' as Panel,label:'История проверок',icon:FileClock}];
 return <div className="app-shell">
   <aside className="sidebar">
     <div className="logo"><div className="logo-symbol"><ShieldCheck size={23} strokeWidth={2.4}/></div><div><div className="logo-name">UXProof</div><div className="logo-sub">Quality workspace</div></div><span className="version">BETA</span></div>
     <div className="nav-title">РАБОЧЕЕ ПРОСТРАНСТВО</div>
     <nav className="side-nav">{menu.map(m=><button key={m.id} type="button" aria-current={panel===m.id?'page':undefined} className={`nav-item ${panel===m.id?'active':''}`} onClick={()=>{setPanel(m.id);setActiveIssue(null);setError('');}}><m.icon size={17}/><span className="nav-label">{m.label}</span>{m.id==='history'&&history.length>0?<span className="nav-count" aria-hidden="true">{history.length}</span>:null}</button>)}</nav>
     <div className="sidebar-bottom"><div className="sidebar-divider"/><div className="mode-info"><div className="mode-icon"><Activity size={16}/></div><div><b>Локальный анализ</b><span>Браузерные проверки на устройстве</span></div></div><div className="side-hint"><CircleHelp size={15}/><span>UXProof проверяет сценарии, а не только скриншоты.</span></div></div>
   </aside>
   <div className="main-column">
     <header className="topbar"><div className="crumb">Workspace <ChevronRight size={14}/> <b>{panel==='scenarios'?'Сценарии':panel==='results'?'Результаты':'История'}</b></div><div className="top-actions"><div className="online-dot"/> <span>Локальный проект</span><span className="top-separator"/><span className="version-top">v0.1.0</span></div></header>
     <main className="workspace">
       {error&&<div className="alert error"><AlertCircle size={18}/><span>{error}</span><button aria-label="Закрыть ошибку" onClick={()=>setError('')}><X size={17}/></button></div>}
       {notice&&<div className="alert notice"><Info size={17}/><span>{notice}</span><button aria-label="Закрыть сообщение" onClick={()=>setNotice('')}><X size={17}/></button></div>}
       {panel==='scenarios'&&<>
         <div className="page-head"><div><div className="eyebrow">ПРОЕКТ / НАСТРОЙКА ПРОВЕРКИ</div><h1>Сценарии проверки</h1><p>Собери путь пользователя. UXProof повторит его в настоящем браузере и сохранит результат каждого шага.</p></div><button className="btn primary run-button" type="button" aria-busy={busy} disabled={busy} onClick={start}>{busy?<Loader2 className="spin" size={18}/>:<Play size={17} fill="currentColor"/>}{busy?'Проверка выполняется…':'Запустить аудит'}<ArrowRight size={17}/></button></div>
         <div className="config-card">
           <div className="project-row"><div className="project-monogram"><Globe2 size={21}/></div><div className="project-fields"><label className="field-label" htmlFor="project-name">Название проекта</label><input id="project-name" className="input project-name" value={config.project} onChange={e=>setConfig({...config,project:e.target.value})} placeholder="Название проекта"/></div><div className="project-fields url-field"><label className="field-label" htmlFor="project-url">Адрес приложения</label><input id="project-url" className="input" value={config.baseUrl} onChange={e=>setConfig({...config,baseUrl:e.target.value})} placeholder="http://localhost:3000"/></div></div>
           <div className="project-foot"><div><CheckCircle2 size={15}/><span>Web-приложения по HTTP/HTTPS</span></div><div className="muted-actions"><button onClick={()=>importRef.current?.click()}><FileJson size={14}/> Импорт JSON</button><button onClick={()=>downloadJson('uxproof-project.json',config)}><Download size={14}/> Экспорт проекта</button><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importProject}/></div></div>
         </div>
         <div className="editor-grid"><section className="scenarios-list panel-card"><div className="panel-title"><div><h2>Пользовательские сценарии</h2><span>{config.scenarios.length} из 10</span></div><button className="icon-btn" disabled={config.scenarios.length>=10} title="Добавить сценарий" onClick={addScenario}><Plus size={19}/></button></div>
           <div className="scenario-list">{config.scenarios.map((s,i)=><button key={s.id} onClick={()=>setActiveScenarioId(s.id)} className={`scenario-item ${activeScenario?.id===s.id?'selected':''}`}><span className="scenario-num">{String(i+1).padStart(2,'0')}</span><span className="scenario-label"><b>{s.title}</b><small>{s.steps.length} шагов</small></span><ChevronRight size={16}/></button>)}</div>
           <div className="tip"><Info size={16}/><span>Начни с 3 готовых сценариев на тестовом Relay. Менять шаги можно справа.</span></div></section>
           <section className="step-editor panel-card">{activeScenario?<><div className="panel-title"><div><h2>Редактор сценария</h2><span>Действия выполняются по порядку</span></div><button className="icon-btn delete-btn" disabled={config.scenarios.length<=1} title="Удалить сценарий" onClick={deleteScenario}><Trash2 size={17}/></button></div>
             <div className="scenario-edit-head"><label className="field-label" htmlFor="scenario-title">Название</label><input id="scenario-title" className="input" value={activeScenario.title} onChange={e=>updateScenario(s=>({...s,title:e.target.value}))}/><label className="field-label extra-label" htmlFor="scenario-desc">Описание</label><input id="scenario-desc" className="input" value={activeScenario.description} onChange={e=>updateScenario(s=>({...s,description:e.target.value}))} placeholder="Что должен сделать пользователь?"/></div>
             <div className="steps-label"><span>ШАГИ АВТОМАТИЗАЦИИ</span><span>{activeScenario.steps.length} / 30</span></div>
             <div className="steps-list">{activeScenario.steps.map((step,i)=><div className="step-row" key={i}><div className="step-index">{String(i+1).padStart(2,'0')}</div><div className="step-content"><div className="step-top"><div className="step-icon"><IconForType type={step.type}/></div><input aria-label={`Название шага ${i+1}`} className="step-name" value={step.name} onChange={e=>updateStep(i,{name:e.target.value})}/><div className="step-actions"><button type="button" aria-label={`Переместить шаг ${i+1} вверх`} title="Выше" disabled={i===0} onClick={()=>moveStep(i,-1)}><ChevronUp size={14}/></button><button type="button" aria-label={`Переместить шаг ${i+1} вниз`} title="Ниже" disabled={i===activeScenario.steps.length-1} onClick={()=>moveStep(i,1)}><ChevronDown size={14}/></button></div><button className="mini-remove" type="button" aria-label={`Удалить шаг ${i+1}`} title="Удалить шаг" disabled={activeScenario.steps.length<=1} onClick={()=>updateScenario(s=>({...s,steps:s.steps.filter((_,index)=>index!==i)}))}><X size={15}/></button></div><div className="step-fields"><select aria-label={`Тип шага ${i+1}`} value={step.type} onChange={e=>updateStep(i,{type:e.target.value as StepType})}>{STEP_TYPES.map(type=><option value={type} key={type}>{STEP_LABELS[type]}</option>)}</select><input aria-label={`Селектор шага ${i+1}`} placeholder={step.type==='navigate'||step.type==='wait'?'Селектор не нужен':'css:#button / role:button|ОК'} value={step.target} onChange={e=>updateStep(i,{target:e.target.value})} disabled={step.type==='wait'||step.type==='navigate'}/>{['fill','select','navigate','expectText','expectValue','wait'].includes(step.type)&&<input aria-label={`Значение шага ${i+1}`} className="value-input" placeholder="Значение" value={step.value} onChange={e=>updateStep(i,{value:e.target.value})}/>}</div></div></div>)}</div>
             <button className="add-step" disabled={activeScenario.steps.length>=30} onClick={()=>updateScenario(s=>({...s,steps:[...s.steps,{name:'Новый шаг',type:'expectVisible',target:'css:main',value:''}]}))}><Plus size={17}/> Добавить шаг</button>
           </>:null}</section></div>
         <section className="bottom-config panel-card"><div className="panel-title"><div><h2>Среда проверки</h2><span>Выбери размеры экрана и дополнительные проверки</span></div></div><div className="environment-grid"><div className="env-area"><div className="section-cap">РАЗРЕШЕНИЯ ЭКРАНА</div><div className="viewports">{DEFAULT_VIEWPORTS.map(v=>{const chosen=config.viewports.some(item=>item.id===v.id);return <button type="button" key={v.id} aria-pressed={chosen} className={`viewport-tile ${chosen?'checked':''}`} onClick={()=>setConfig(prev=>({...prev,viewports:chosen?(prev.viewports.length>1?prev.viewports.filter(p=>p.id!==v.id):prev.viewports):[...prev.viewports,v].sort((a,b)=>DEFAULT_VIEWPORTS.findIndex(p=>p.id===a.id)-DEFAULT_VIEWPORTS.findIndex(p=>p.id===b.id))}))}>{v.id==='mobile'?<Smartphone size={22}/>:<Monitor size={22}/>}<span><b>{v.label}</b><small>{v.width} × {v.height}</small></span><span className="check-box">{chosen&&<Check size={13}/>}</span></button>})}</div></div><div className="env-ai"><div className="section-cap">ДОПОЛНИТЕЛЬНЫЙ АНАЛИЗ</div><label className="ai-toggle"><div className="ai-icon"><Sparkles size={20}/></div><div><b>Рекомендации ИИ</b><span>Оценка скриншотов мультимодальной моделью</span></div><input type="checkbox" checked={config.options.enableAI} onChange={e=>setConfig({...config,options:{...config.options,enableAI:e.target.checked}})}/><span className="switch"/></label>{config.options.enableAI&&<div className="provider-field"><label htmlFor="ai-provider">ИИ-провайдер</label><select id="ai-provider" value={config.options.aiProvider} onChange={e=>setConfig({...config,options:{...config.options,aiProvider:e.target.value as 'openai'|'ollama'}})}><option value="openai">OpenAI API (облачный)</option><option value="ollama">Ollama (локальный)</option></select></div>}<p className="ai-warning"><Info size={15}/> Для OpenAI скриншоты передаются облачному API, нужен OPENAI_API_KEY. Ollama обрабатывает локально, если установлена мультимодальная модель. По умолчанию отключено.</p></div></div></section>
       </>}
       {panel==='results'&&<>{report?<ReportSection report={report} previous={history.find(h=>h.runId!==report.runId&&!!report.comparisonKey&&h.comparisonKey===report.comparisonKey&&h.status==='completed'&&report.status==='completed')} issues={filteredIssues} issueFilter={issueFilter} setIssueFilter={setIssueFilter} onIssue={setActiveIssue} onExport={()=>exportReport(report)} onJson={()=>downloadJson(`uxproof-${report.runId}.json`,report)} onBack={()=>setPanel('scenarios')}/>:<EmptyState title="Пока нет результатов" description="Запусти первый аудит — здесь появятся пройденные сценарии, воспроизводимые ошибки и скриншоты." action="Настроить проверку" onAction={()=>setPanel('scenarios')}/>}</>}
       {panel==='history'&&<><div className="page-head"><div><div className="eyebrow">ЛОКАЛЬНО СОХРАНЁННЫЕ ОТЧЁТЫ</div><h1>История проверок</h1><p>Прошлые запуски сохраняются локально. Выбери отчет, чтобы увидеть результаты.</p></div><button className="btn secondary" onClick={()=>listReports().then(setHistory).catch(e=>setError(String(e)))}><RotateCcw size={16}/> Обновить</button></div>{history.length?<div className="history-layout"><div className="panel-card history-list">{history.map(r=><button key={r.runId} className={`history-entry ${selectedRun===r.runId?'selected':''}`} onClick={()=>{setSelectedRun(r.runId);setIssueFilter('all');setActiveIssue(null);}}><div className="history-top"><span>{formatDate(r.startedAt)}</span><span>{r.summary.passedRuns}/{r.summary.totalRuns}</span></div><b>{r.project}</b><small>{r.summary.confirmedIssues} подтверждённых замечаний</small></button>)}</div><div>{currentReport?<ReportSection report={currentReport} issues={filteredIssues} issueFilter={issueFilter} setIssueFilter={setIssueFilter} onIssue={setActiveIssue} onExport={()=>exportReport(currentReport)} onJson={()=>downloadJson(`uxproof-${currentReport.runId}.json`,currentReport)} onBack={()=>setPanel('scenarios')} compact/>:<div className="panel-card history-placeholder"><FileClock size={35}/><b>Выбери проверку слева</b><span>Отчет откроется здесь.</span></div>}</div></div>:<EmptyState title="История пуста" description="После первого реального запуска отчёт появится в этом разделе." action="Новый аудит" onAction={()=>setPanel('scenarios')}/>}</>}
     </main>
   </div>
   {activeIssue&&currentReport&&<div className="modal-overlay" onClick={()=>setActiveIssue(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="issue-title" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><Confidence status={activeIssue.status}/><h2 id="issue-title">{activeIssue.title}</h2><div className="modal-sub"><Level severity={activeIssue.severity}/><span>{activeIssue.scenario} · {activeIssue.viewport}</span></div></div><button ref={closeRef} className="icon-btn" type="button" aria-label="Закрыть" onClick={()=>setActiveIssue(null)}><X size={20}/></button></div><div className="modal-body"><h3>Что обнаружено</h3><p>{activeIssue.description}</p>{activeIssue.reproduction&&<><h3>Как воспроизвести</h3><p className="reproduction">{activeIssue.reproduction}</p></>}{activeIssue.helpUrl?.startsWith('https://')&&<p><a href={activeIssue.helpUrl} target="_blank" rel="noreferrer">Описание правила axe-core <ExternalLink size={13}/></a></p>}<h3>Доказательство</h3>{screenshot&&!shotFailed?<img className="evidence-image" src={screenshot} alt={`Скриншот проверки: ${activeIssue.scenario}`} onError={()=>setShotFailed(true)}/>:<div className="no-image"><ImageIcon size={20}/> Скриншот отсутствует или загружается</div>}<p className="evidence-note">{activeIssue.status==='recommendation'?'Это предположение ИИ — подтвердите его вручную.':'Запись сформирована автоматическим тестом; при необходимости проверьте контекст вручную.'}</p></div></div></div>}
 </div>;
}

function EmptyState({title,description,action,onAction}:{title:string;description:string;action:string;onAction:()=>void}) {
 return <div className="empty-state panel-card"><div className="empty-icon"><ClipboardList size={30}/></div><h2>{title}</h2><p>{description}</p><button className="btn primary" onClick={onAction}>{action}<ArrowRight size={16}/></button></div>
}

function ReportSection({report,previous,issues,issueFilter,setIssueFilter,onIssue,onExport,onJson,onBack,compact=false}:{report:AuditReport;previous?:AuditReport;issues:Issue[];issueFilter:'all'|'confirmed'|'recommendation';setIssueFilter:(v:'all'|'confirmed'|'recommendation')=>void;onIssue:(i:Issue)=>void;onExport:()=>void;onJson:()=>void;onBack:()=>void;compact?:boolean}){
 return <div className={compact?'report compact-report':'report'}><div className="page-head"><div><div className="eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ · {formatDate(report.startedAt)}</div><h1>{compact?'Отчёт':'Аудит завершён'}</h1><p>{report.project} · {report.baseUrl}</p></div><div className="report-actions"><button className="btn secondary" onClick={onJson}><FileJson size={16}/> JSON</button><button className="btn primary" onClick={onExport}><FileDown size={16}/> HTML-отчёт</button></div></div>
   <div className="stats-grid"><div className="stat-card"><span>ПРОЙДЕНО СЦЕНАРИЕВ</span><div className="stat-number">{report.summary.passedRuns}<small> / {report.summary.totalRuns}</small></div><Score passed={report.summary.passedRuns} total={report.summary.totalRuns}/></div><div className="stat-card"><span>ПОДТВЕРЖДЁННЫЕ ДЕФЕКТЫ</span><div className="stat-number">{report.summary.confirmedIssues}</div><div className="stat-footer">По результатам проверок</div></div><div className="stat-card"><span>ЗАМЕЧАНИЯ ДОСТУПНОСТИ</span><div className="stat-number">{report.summary.accessibilityIssues}</div><div className="stat-footer">Автоматический анализ axe</div></div><div className="stat-card"><span>РЕКОМЕНДАЦИИ ИИ</span><div className="stat-number">{report.summary.aiSuggestions}</div><div className="stat-footer">Отдельно от дефектов</div></div></div>
   {previous&&previous.results.length===report.results.length&&previous.results.every(r=>report.results.some(n=>n.scenario===r.scenario&&n.viewport===r.viewport))&&<div className="regression-bar"><RotateCcw size={17}/><div><b>Повторная проверка · сравнение с предыдущим запуском</b><span>Успешных сценариев: {previous.summary.passedRuns} → {report.summary.passedRuns} · Подтверждённых замечаний: {previous.summary.confirmedIssues} → {report.summary.confirmedIssues}</span></div></div>}
   <section className="panel-card report-card"><div className="panel-title"><div><h2>Прогоны сценариев</h2><span>Каждый сценарий проверен в каждом выбранном разрешении</span></div><span className="subtle-chip"><Clock3 size={14}/>{Math.round(report.durationMs/1000)} сек</span></div><div className="run-list"><div className="run-list-head"><span>Сценарий</span><span>Экран</span><span>Шаги</span><span>Результат</span></div>{report.results.map(r=><details className="run-item" key={r.id}><summary><span className="run-name">{r.status==='passed'?<CheckCircle2 size={18}/>:<XCircle size={18}/>} {r.scenario}</span><span>{r.viewport}</span><span>{r.passedSteps}/{r.totalSteps}</span><span className={`status-pill ${r.status}`}>{r.status==='passed'?'Пройден':'Ошибка'}</span><ChevronDown size={16} className="row-chevron"/></summary><div className="run-steps">{r.steps.map((s,i)=><div className="run-step" key={i}><span className={s.status==='passed'?'step-pass':'step-fail'}>{s.status==='passed'?<Check size={14}/>:<X size={14}/>}</span><b>{s.name}</b><span>{s.durationMs} мс</span>{s.error&&<p>{s.error}</p>}</div>)}</div></details>)}</div></section>
   <section className="panel-card report-card"><div className="panel-title"><div><h2>Найденные проблемы</h2><span>Нажми на запись, чтобы увидеть доказательство</span></div><div className="issue-tabs">{[{'id':'all','name':'Все'},{'id':'confirmed','name':'Дефекты'},{'id':'recommendation','name':'ИИ'}].map(t=><button key={t.id} className={issueFilter===t.id?'active':''} onClick={()=>setIssueFilter(t.id as typeof issueFilter)}>{t.name}</button>)}</div></div>{issues.length?<div className="issue-list">{issues.map(issue=><button className="issue-item" key={issue.id} onClick={()=>onIssue(issue)}><div className={`issue-marker ${issue.status==='confirmed'?'hard':'soft'}`}>{issue.status==='confirmed'?<AlertCircle size={17}/>:<Sparkles size={16}/>}</div><div className="issue-main"><b>{issue.title}</b><p>{issue.description}</p><div><Confidence status={issue.status}/><span className="issue-context">{issue.scenario} · {issue.viewport}</span></div></div><Level severity={issue.severity}/><ChevronRight size={17} className="issue-arrow"/></button>)}</div>:<div className="no-issues"><CheckCircle2 size={21}/> В этой категории замечаний нет</div>}</section>
   {report.warnings.length>0&&<div className="report-warnings"><AlertCircle size={17}/><div><b>Ограничения этого прогона</b>{report.warnings.map((w,i)=><p key={i}>{w}</p>)}</div></div>}
   <div className="report-bottom"><button className="text-button" onClick={onBack}><ArrowLeft size={16}/> Изменить сценарии</button><span>Данные хранятся локально · {report.runId.slice(0,8)}</span></div>
 </div>
}
