import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Code2, Download, ExternalLink, FileClock, FileJson, Globe2, Image as ImageIcon, Info, LayoutDashboard, ListChecks, Monitor, MousePointerClick, Play, Plus, RotateCcw, ShieldCheck, Smartphone, Sparkles, Trash2, X } from 'lucide-react';
import { DEFAULT_CONFIG, DEFAULT_VIEWPORTS, STEP_LABELS } from './lib/presets';
import { Confidence, EmptyState, Level, Score, comparisonLabel, confirmedLabel, formatDate, sameOriginDifferentPath, shortUrl } from './lib/format';
import { ReportSection } from './components/ReportSection';
import type { AuditConfig, AuditReport, AuditStep, Issue, NormalizedFinding, NormalizedObservation, Panel, Scenario, StepType } from './lib/types';
import { cancelAudit, downloadJson, exportHtml, exportTrace, exportXlsx, listReports, planSteps, runAudit, screenshotUrl } from './lib/bridge';
import type { PlannedStep } from './lib/bridge';
import { displayViewportLabel, evidenceCaption, evidenceGeometry } from './lib/report-view';
import { clientUrlError, projectConfigError } from './lib/config-check';
import LIMITS from '@uxproof/audit-config-limits.json';

const STEP_TYPES=Object.keys(STEP_LABELS) as StepType[];
const IconForType=({type}:{type:string}) => type==='click'?<MousePointerClick size={16}/>:type.startsWith('expect')?<CheckCheck size={16}/>:<Code2 size={16}/>;
export default function App() {
 const [config,setConfig]=useState<AuditConfig>(()=>structuredClone(DEFAULT_CONFIG));
 const [panel,setPanel]=useState<Panel>('scenarios');
 const [activeScenarioId,setActiveScenarioId]=useState('server');
 const [busy,setBusy]=useState(false);
 const [report,setReport]=useState<AuditReport|null>(null);
 const [history,setHistory]=useState<AuditReport[]>([]);
 const [historyStatus,setHistoryStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [historySkipped,setHistorySkipped]=useState(0);
 const [runnerOk,setRunnerOk]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [activeIssue,setActiveIssue]=useState<Issue|null>(null);
 const [issueFilter,setIssueFilter]=useState<'all'|'confirmed'|'recommendation'>('all');
 const [selectedRun,setSelectedRun]=useState<string>('');
 const [compareRun,setCompareRun]=useState('');
 const [mapPaths,setMapPaths]=useState(false);
 const [screenshot,setScreenshot]=useState('');
 const [shotStatus,setShotStatus]=useState<'idle'|'loading'|'ready'|'missing'|'failed'>('idle');
 const [shotSize,setShotSize]=useState<{width:number;height:number}|null>(null);
 const [planGoal,setPlanGoal]=useState('');
 const [planProvider,setPlanProvider]=useState<'openai'|'ollama'>('openai');
 const [planBusy,setPlanBusy]=useState(false);
 const [planPreview,setPlanPreview]=useState<PlannedStep[]|null>(null); const importRef=useRef<HTMLInputElement|null>(null);
 const busyRef=useRef(false);
 const generationRef=useRef(0);
 const abortRef=useRef<AbortController|null>(null);
 const closeRef=useRef<HTMLButtonElement|null>(null);
 const activeScenario=config.scenarios.find(s=>s.id===activeScenarioId) || config.scenarios[0];
 const currentReport=panel==='history'?history.find(r=>r.runId===selectedRun)||null:report;
 const filteredIssues=useMemo(()=>currentReport?.issues.filter(i=>issueFilter==='all'||i.status===issueFilter)||[],[currentReport,issueFilter]);
 const loadHistory=async(opts?:{openLatest?:boolean})=>{
   try{
     const records=await listReports();
     setHistory(records.reports);
     setHistorySkipped(records.skipped);
     setHistoryStatus('ready');
     setRunnerOk(true);
     if(opts?.openLatest && !busyRef.current){
       const latest=records.reports.find(item=>item.status==='completed');
       if(latest) setReport(prev=>prev??latest);
     }
   }catch(e){
     setHistoryStatus('error');
     setRunnerOk(false);
     setError(String(e instanceof Error?e.message:e));
   }
 };
 useEffect(()=>{void loadHistory({openLatest:true});},[]);
 useEffect(()=>{
   setScreenshot('');
   setShotSize(null);
   if(!activeIssue || !currentReport){setShotStatus('idle');return;}
   if(!activeIssue.screenshot){setShotStatus('missing');return;}
   setShotStatus('loading');
   let live=true;
   screenshotUrl(currentReport.runId,activeIssue.screenshot).then(u=>{if(live)setScreenshot(u);}).catch(()=>{if(live)setShotStatus('failed');});
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
   const generation=++generationRef.current;
   abortRef.current?.abort();
   const abort=new AbortController();
   abortRef.current=abort;
   setError('');setNotice('');setBusy(true);
   try{
     const r=await runAudit(config, abort.signal);
     if(generation!==generationRef.current) return;
     setReport(r);setCompareRun('');setMapPaths(false);setPanel('results');setIssueFilter('all');setActiveIssue(null);
     setHistory(prev=>[r,...prev.filter(h=>h.runId!==r.runId)].slice(0,30));
     setHistoryStatus('ready');setRunnerOk(true);
   }catch(e){
     if(generation!==generationRef.current) return;
     if((e as {name?:string}).name==='AbortError'){
       if((e as {timedOut?:boolean}).timedOut){
         try{await cancelAudit();}catch{/* runner may already be idle */}
         setError(String(e instanceof Error?e.message:e));
       }
       return;
     }
     setError(String(e instanceof Error?e.message:e));
     setRunnerOk(false);
   }
   finally{if(generation===generationRef.current){busyRef.current=false;setBusy(false);}}
 };
 const stop=async()=>{
   generationRef.current++;
   abortRef.current?.abort();
   try{await cancelAudit();}catch(e){setError(String(e instanceof Error?e.message:e));}
   busyRef.current=false;setBusy(false);
 };
 const exportReport=async(r:AuditReport)=>{
   try{const info=await exportHtml(r.runId);setNotice(`HTML-отчёт: ${info}`);}catch(e){setError(String(e));}
 };
 const openTrace=async(runId:string,trace:string)=>{
   try{const info=await exportTrace(runId,trace);setNotice(`Trace: ${info}`);}catch(e){setError(String(e));}
 };
 const exportSpreadsheet=async(r:AuditReport)=>{
   try{const info=await exportXlsx(r.runId);setNotice(`Excel-отчёт: ${info}`);}catch(e){setError(String(e));}
 };
 const importProject=async(event:ChangeEvent<HTMLInputElement>)=>{
   const file=event.target.files?.[0];if(!file)return;
   try {
     if(file.size>2_000_000) throw Error('Файл проекта слишком большой');
     const value=JSON.parse(await file.text()) as AuditConfig;
     const checkError=projectConfigError(value);
     if(checkError) throw Error(checkError);
     const aiProvider: 'openai' | 'ollama' = value.options?.aiProvider==='ollama' ? 'ollama' : 'openai';
     const disabledRules=value.options?.disabledRules;
     const trace=value.options?.trace;
     const normalized: AuditConfig={...value,options:{enableAI:Boolean(value.options?.enableAI),aiProvider,...(disabledRules?{disabledRules}: {}),...(trace?{trace}: {})}};
     setConfig(normalized);setActiveScenarioId(value.scenarios[0].id);setPanel('scenarios');setNotice(`Проект «${value.project}» импортирован`);
   }catch(e){setError(`Ошибка импорта: ${String(e instanceof Error?e.message:e)}`);}
   event.target.value='';
 };
 // The plan is only a proposal: nothing runs until the user approves it.
 const generatePlan=async()=>{
   if(!activeScenario) return;
   setPlanBusy(true);
   try{
     const steps=await planSteps(planGoal,config.baseUrl,planProvider);
     if(!steps.length) throw Error('Модель не вернула допустимых шагов');
     setPlanPreview(steps);
   }catch(e){setError(`Планировщик: ${String(e instanceof Error?e.message:e)}`);}
   finally{setPlanBusy(false);}
 };
 const approvePlan=()=>{
   if(!planPreview||!activeScenario) return;
   updateScenario(s=>({...s,steps:planPreview.slice(0,30).map(step=>({...step,type:step.type as StepType}))}));
   setPlanPreview(null);setPlanGoal('');setNotice('Шаги добавлены в сценарий. Проверьте их перед запуском.');
 };
 const menu=[{id:'scenarios' as Panel,label:'Сценарии',icon:ListChecks},{id:'results' as Panel,label:'Результаты',icon:LayoutDashboard},{id:'history' as Panel,label:'История проверок',icon:FileClock}];
 const compareSource=panel==='history'?currentReport:report;
 const baselines=compareSource?history.filter(h=>h.runId!==compareSource.runId):[];
 const manual=compareRun?baselines.find(h=>h.runId===compareRun):undefined;
 const exactPrevious=!manual?baselines.find(h=>!!compareSource?.comparisonKey&&h.comparisonKey===compareSource.comparisonKey&&h.status==='completed'&&compareSource.status==='completed'):undefined;
 const pathOffer=compareSource&&manual&&sameOriginDifferentPath(manual,compareSource)?manual:(!manual&&!exactPrevious&&compareSource?baselines.find(h=>sameOriginDifferentPath(h,compareSource)):undefined);
 const settingsMismatch=!!(compareSource&&manual&&manual.comparisonKey!==compareSource.comparisonKey&&!(pathOffer&&pathOffer.runId===manual.runId));
 const previous=manual&&compareSource&&manual.comparisonKey===compareSource.comparisonKey?manual:exactPrevious||(mapPaths?pathOffer:undefined)||(settingsMismatch?manual:undefined);
 const comparisonControls=compareSource&&baselines.length>0&&<div className="comparison-controls"><label htmlFor="comparison-run">Сравнить с проверкой</label><select id="comparison-run" value={compareRun} onChange={e=>{setCompareRun(e.target.value);setMapPaths(false)}}><option value="">Автоматически: такой же адрес и настройки</option>{baselines.map(h=><option key={h.runId} value={h.runId}>{formatDate(h.startedAt)} · {h.project} · {h.baseUrl}</option>)}</select>{pathOffer&&<label><input type="checkbox" checked={mapPaths} onChange={e=>setMapPaths(e.target.checked)}/> Путь другой. Сравнить как один сайт?</label>}</div>;
 const evidence=currentReport&&activeIssue?.screenshot&&shotSize?evidenceGeometry(currentReport,activeIssue.screenshot,shotSize.width,shotSize.height):null;
 const outline=evidence?.outline||null;
 const geometryCaption=evidenceCaption(evidence?.geometry);
 const geometryNotice=evidence?.status==='mismatch'?'Геометрия отсутствует: размер снимка не совпал с viewport×DPR.':
   evidence?.status==='absent'&&activeIssue?.screenshot?'Геометрия отсутствует: точные границы элемента не сохранены.':null;
 return <div className="app-shell">
   <aside className="sidebar">
     <div className="logo"><div className="logo-symbol"><ShieldCheck size={23} strokeWidth={2.4}/></div><div><div className="logo-name">UXProof</div></div><span className="version">BETA</span></div>
     <div className="nav-title">РАБОЧЕЕ ПРОСТРАНСТВО</div>
     <nav className="side-nav">{menu.map(m=><button key={m.id} type="button" aria-current={panel===m.id?'page':undefined} className={`nav-item ${panel===m.id?'active':''}`} onClick={()=>{setPanel(m.id);setActiveIssue(null);setError('');}}><m.icon size={17}/><span className="nav-label">{m.label}</span>{m.id==='history'&&history.length>0?<span className="nav-count" aria-hidden="true">{history.length}</span>:null}</button>)}</nav>
   </aside>
   <div className="main-column">
     <header className="topbar"><div className="top-actions"><span>{busy?`Проверка: ${activeScenario?.title}`:runnerOk?'Локальный проект':'Runner не запущен'}</span>{busy&&<button className="btn secondary" type="button" onClick={stop}>Остановить</button>}<span className="top-separator"/><span className="version-top">v0.1.0</span></div></header>
     <main className="workspace">
       {error&&<div className="alert error"><AlertCircle size={18}/><span>{error}</span><button aria-label="Закрыть ошибку" onClick={()=>setError('')}><X size={17}/></button></div>}
       {notice&&<div className="alert notice"><Info size={17}/><span>{notice}</span><button aria-label="Закрыть сообщение" onClick={()=>setNotice('')}><X size={17}/></button></div>}
       {panel==='scenarios'&&<>
         <div className="page-head"><div><h1>Сценарии проверки</h1>{busy&&<p>Проверка: {activeScenario?.title}</p>}</div>{busy?<button className="btn secondary run-button" type="button" onClick={stop}>Остановить</button>:<button className="btn primary run-button" type="button" aria-busy={busy} disabled={busy} onClick={start}><Play size={17} fill="currentColor"/>Запустить аудит<ArrowRight size={17}/></button>}</div>
         <div className="config-card">
           <div className="project-row"><div className="project-monogram"><Globe2 size={21}/></div><div className="project-fields"><label className="field-label" htmlFor="project-name">Название проекта</label><input id="project-name" className="input project-name" value={config.project} onChange={e=>setConfig({...config,project:e.target.value})} placeholder="Название проекта"/></div><div className="project-fields url-field"><label className="field-label" htmlFor="project-url">Адрес приложения</label><input id="project-url" className="input" value={config.baseUrl} onChange={e=>setConfig({...config,baseUrl:e.target.value})} placeholder="http://localhost:3000"/></div></div>
           <div className="project-foot"><div><CheckCircle2 size={15}/><span>Web-приложения по HTTP/HTTPS</span></div><div className="muted-actions"><button onClick={()=>importRef.current?.click()}><FileJson size={14}/> Импорт JSON</button><button onClick={()=>downloadJson('uxproof-project.json',config)}><Download size={14}/> Экспорт проекта</button><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importProject}/></div></div>
         </div>
         <div className="editor-grid"><section className="scenarios-list panel-card"><div className="panel-title"><div><h2>Пользовательские сценарии</h2><span>{config.scenarios.length} из 10</span></div><button className="icon-btn" disabled={config.scenarios.length>=10} title="Добавить сценарий" onClick={addScenario}><Plus size={19}/></button></div>
           <div className="scenario-list">{config.scenarios.map((s,i)=><button key={s.id} onClick={()=>setActiveScenarioId(s.id)} className={`scenario-item ${activeScenario?.id===s.id?'selected':''}`}><span className="scenario-num">{String(i+1).padStart(2,'0')}</span><span className="scenario-label"><b>{s.title}</b><small>{s.steps.length} шагов</small></span><ChevronRight size={16}/></button>)}</div>
           </section>
           <section className="step-editor panel-card">{activeScenario?<><div className="panel-title"><div><h2>Редактор сценария</h2><span>Действия выполняются по порядку</span></div><button className="icon-btn delete-btn" disabled={config.scenarios.length<=1} title="Удалить сценарий" onClick={deleteScenario}><Trash2 size={17}/></button></div>
             <div className="scenario-edit-head"><label className="field-label" htmlFor="scenario-title">Название</label><input id="scenario-title" className="input" value={activeScenario.title} onChange={e=>updateScenario(s=>({...s,title:e.target.value}))}/><label className="field-label extra-label" htmlFor="scenario-desc">Заметка, на проверку не влияет</label><input id="scenario-desc" className="input" value={activeScenario.description} onChange={e=>updateScenario(s=>({...s,description:e.target.value}))} placeholder="Необязательно"/></div>
             <div className="steps-label"><span>ШАГИ АВТОМАТИЗАЦИИ</span><span>{activeScenario.steps.length} / 30</span></div>
             <div className="steps-list">{activeScenario.steps.map((step,i)=><div className="step-row" key={i}><div className="step-index">{String(i+1).padStart(2,'0')}</div><div className="step-content"><div className="step-top"><div className="step-icon"><IconForType type={step.type}/></div><input aria-label={`Название шага ${i+1}`} className="step-name" value={step.name} onChange={e=>updateStep(i,{name:e.target.value})}/><div className="step-actions"><button type="button" aria-label={`Переместить шаг ${i+1} вверх`} title="Выше" disabled={i===0} onClick={()=>moveStep(i,-1)}><ChevronUp size={14}/></button><button type="button" aria-label={`Переместить шаг ${i+1} вниз`} title="Ниже" disabled={i===activeScenario.steps.length-1} onClick={()=>moveStep(i,1)}><ChevronDown size={14}/></button></div><button className="mini-remove" type="button" aria-label={`Удалить шаг ${i+1}`} title="Удалить шаг" disabled={activeScenario.steps.length<=1} onClick={()=>updateScenario(s=>({...s,steps:s.steps.filter((_,index)=>index!==i)}))}><X size={15}/></button></div><div className="step-fields"><select aria-label={`Тип шага ${i+1}`} value={step.type} onChange={e=>updateStep(i,{type:e.target.value as StepType})}>{STEP_TYPES.map(type=><option value={type} key={type}>{STEP_LABELS[type]}</option>)}</select><input aria-label={`Селектор шага ${i+1}`} placeholder={step.type==='navigate'||step.type==='wait'?'Селектор не нужен':'role:button|Имя'} value={step.target} onChange={e=>updateStep(i,{target:e.target.value})} disabled={step.type==='wait'||step.type==='navigate'}/>{['fill','select','navigate','expectText','expectValue','wait'].includes(step.type)&&<input aria-label={`Значение шага ${i+1}`} className="value-input" placeholder={step.type==='navigate'?'URL или путь':step.type==='wait'?'Пауза, мс':'Значение'} value={step.value} onChange={e=>updateStep(i,{value:e.target.value})}/>}</div><p className="step-hint">{step.type==='navigate'||step.type==='wait'?'Селектор не нужен. Для перехода укажите URL, для паузы — миллисекунды.':'role:button|Имя · css:#id · label:Подпись'}</p></div></div>)}</div>
             <button className="add-step" disabled={activeScenario.steps.length>=30} onClick={()=>updateScenario(s=>({...s,steps:[...s.steps,{name:'Новый шаг',type:'expectVisible',target:'css:main',value:''}]}))}><Plus size={17}/> Добавить шаг</button>
             <div className="planner-box"><div className="section-cap">ГЕНЕРАЦИЯ ШАГОВ</div><div className="planner-controls"><input aria-label="Цель проверки для планировщика" className="input" placeholder="Например: открыть настройки и сохранить профиль" value={planGoal} onChange={e=>setPlanGoal(e.target.value)}/><select aria-label="Провайдер планировщика" value={planProvider} onChange={e=>setPlanProvider(e.target.value as 'openai'|'ollama')}><option value="openai">[OI]</option><option value="ollama">Ollama</option></select><button className="btn secondary" type="button" disabled={planBusy||!planGoal.trim()} onClick={()=>void generatePlan()}>{planBusy?'Генерация…':'Сгенерировать шаги'}</button></div><p className="ai-warning"><Info size={15}/> План — предложение модели. Он не становится находкой и выполняется только после подтверждения.</p>{planPreview&&<div className="plan-preview" role="group" aria-label="Предложенные шаги"><ol>{planPreview.map((step,i)=><li key={i}><b>{STEP_LABELS[step.type as StepType]||step.type}</b> · {step.name}{step.target?` · ${step.target}`:''}{step.value?` · ${step.value}`:''}</li>)}</ol><div className="plan-actions"><button className="btn primary" type="button" onClick={approvePlan}><Check size={16}/> Применить план</button><button className="btn secondary" type="button" onClick={()=>setPlanPreview(null)}>Отменить</button></div></div>}</div>
           </>:null}</section></div>
         <section className="bottom-config panel-card"><div className="panel-title"><div><h2>Среда проверки</h2><span>Выбери размеры экрана и дополнительные проверки</span></div></div><div className="environment-grid"><div className="env-area"><div className="section-cap">РАЗРЕШЕНИЯ ЭКРАНА</div><div className="viewports">{DEFAULT_VIEWPORTS.map(v=>{const chosen=config.viewports.some(item=>item.id===v.id);return <button type="button" key={v.id} aria-pressed={chosen} className={`viewport-tile ${chosen?'checked':''}`} onClick={()=>setConfig(prev=>({...prev,viewports:chosen?(prev.viewports.length>1?prev.viewports.filter(p=>p.id!==v.id):prev.viewports):[...prev.viewports,v].sort((a,b)=>DEFAULT_VIEWPORTS.findIndex(p=>p.id===a.id)-DEFAULT_VIEWPORTS.findIndex(p=>p.id===b.id))}))}>{v.id==='mobile'?<Smartphone size={22}/>:<Monitor size={22}/>}<span><b>{v.label}</b><small>{v.width} × {v.height}</small></span><span className="check-box">{chosen&&<Check size={13}/>}</span></button>})}</div></div><div className="env-ai"><div className="section-cap">ДОПОЛНИТЕЛЬНЫЙ АНАЛИЗ</div><label className="ai-toggle"><div className="ai-icon"><Sparkles size={20}/></div><div><b>Рекомендации ИИ</b><span>Оценка скриншотов мультимодальной моделью</span></div><input type="checkbox" checked={config.options.enableAI} onChange={e=>setConfig({...config,options:{...config.options,enableAI:e.target.checked}})}/><span className="switch" aria-hidden="true"/></label>{config.options.enableAI&&<div className="provider-field"><label htmlFor="ai-provider">ИИ-провайдер</label><select id="ai-provider" value={config.options.aiProvider} onChange={e=>setConfig({...config,options:{...config.options,aiProvider:e.target.value as 'openai'|'ollama'}})}><option value="openai">OpenAI API (облачный)</option><option value="ollama">Ollama (локальный)</option></select></div>}<p className="ai-warning"><Info size={15}/> Для OpenAI скриншоты передаются облачному API, нужен OPENAI_API_KEY. Ollama обрабатывает локально, если установлена мультимодальная модель. По умолчанию отключено.</p><label className="trace-toggle"><input type="checkbox" checked={config.options.trace==='on-failure'} onChange={e=>setConfig({...config,options:{...config.options,trace:e.target.checked?'on-failure':'off'}})}/> Сохранять trace при ошибке</label><p className="ai-warning">Trace может содержать текст страницы, значения полей и сетевые данные. Включайте только для отладки; файл сохраняется локально.</p><p className="ai-warning">Лимит 10 000 считает рукопожатия прокси (HTTP и CONNECT), а не запросы внутри HTTPS.</p></div></div></section>
       </>}
       {panel==='results'&&<>{report?<>{comparisonControls}<ReportSection report={report} previous={previous} mapPaths={mapPaths} issues={filteredIssues} issueFilter={issueFilter} setIssueFilter={setIssueFilter} onIssue={setActiveIssue} onExport={()=>exportReport(report)} onJson={()=>downloadJson(`uxproof-${report.runId}.json`,report)} onXlsx={()=>exportSpreadsheet(report)} onTrace={trace=>openTrace(report.runId,trace)} onBack={()=>setPanel('scenarios')}/></>:<EmptyState title="Пока нет результатов" description="Запусти первый аудит — здесь появятся пройденные сценарии, воспроизводимые ошибки и скриншоты." action="Настроить проверку" onAction={()=>setPanel('scenarios')}/>}</>}
       {panel==='history'&&<><div className="page-head"><div><h1>История проверок</h1></div><button className="btn secondary" onClick={()=>loadHistory().catch(()=>{})}><RotateCcw size={16}/> Обновить</button></div>{historySkipped>0&&<p className="evidence-note" role="status">Пропущено записей с несовместимым форматом: {historySkipped}. Они не удалены с диска.</p>}{historyStatus==='loading'?<p>Загрузка истории…</p>:historyStatus==='error'?<EmptyState title="История не загрузилась" description="Локальный runner недоступен или ответ повреждён." action="Обновить" onAction={()=>void loadHistory()}/>:history.length?<div className="history-layout"><div className="panel-card history-list">{history.map(r=><button key={r.runId} className={`history-entry ${selectedRun===r.runId?'selected':''}`} onClick={()=>{setSelectedRun(r.runId);setCompareRun('');setMapPaths(false);setIssueFilter('all');setActiveIssue(null);}}><div className="history-top"><span>{formatDate(r.startedAt)}</span><span>{r.summary.passedRuns}/{r.summary.totalRuns}</span></div><b>{r.project}</b><small>{shortUrl(r.baseUrl)}</small><small>{confirmedLabel(r.summary.confirmedIssues)}</small></button>)}</div><div>{currentReport?<>{comparisonControls}<ReportSection report={currentReport} previous={previous} mapPaths={mapPaths} issues={filteredIssues} issueFilter={issueFilter} setIssueFilter={setIssueFilter} onIssue={setActiveIssue} onExport={()=>exportReport(currentReport)} onJson={()=>downloadJson(`uxproof-${currentReport.runId}.json`,currentReport)} onXlsx={()=>exportSpreadsheet(currentReport)} onTrace={trace=>openTrace(currentReport.runId,trace)} onBack={()=>setPanel('scenarios')} compact/></>:<div className="panel-card history-placeholder"><FileClock size={35}/><b>Выбери проверку слева</b><span>Отчет откроется здесь.</span></div>}</div></div>:<EmptyState title="История пуста" description="После первого реального запуска отчёт появится в этом разделе." action="Новый аудит" onAction={()=>setPanel('scenarios')}/>}</>}
     </main>
   </div>
   {activeIssue&&currentReport&&<div className="modal-overlay" onClick={()=>setActiveIssue(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="issue-title" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><Confidence status={activeIssue.status}/><h2 id="issue-title">{activeIssue.title}</h2><div className="modal-sub"><Level severity={activeIssue.severity}/><span>{activeIssue.scenario} · {displayViewportLabel(activeIssue.viewportId,activeIssue.viewport)}</span></div></div><button ref={closeRef} className="icon-btn" type="button" aria-label="Закрыть" onClick={()=>setActiveIssue(null)}><X size={20}/></button></div><div className="modal-body"><h3>Что обнаружено</h3><p>{activeIssue.description}</p>{activeIssue.reproduction&&<><h3>Как воспроизвести</h3><p className="reproduction">{activeIssue.reproduction}</p></>}{activeIssue.helpUrl?.startsWith('https://')&&<p><a href={activeIssue.helpUrl} target="_blank" rel="noreferrer">Описание правила axe-core <ExternalLink size={13}/></a></p>}<h3>Доказательство</h3>{screenshot&&shotStatus!=='failed'&&shotStatus!=='missing'?<div className="evidence-frame"><img className="evidence-image" src={screenshot} alt={`Скриншот проверки: ${activeIssue.scenario}`} onLoad={e=>{setShotSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight});setShotStatus('ready');}} onError={()=>setShotStatus('failed')}/>{outline&&<span className="evidence-outline" aria-label="Приблизительные границы проверенного элемента" style={{left:`${outline.left}%`,top:`${outline.top}%`,width:`${outline.width}%`,height:`${outline.height}%`}}/>}</div>:<div className="no-image"><ImageIcon size={20}/> {shotStatus==='loading'?'Загрузка…':shotStatus==='failed'?'Не удалось загрузить снимок':'Снимок не найден'}</div>}{outline&&<p className="evidence-note">Рамка показывает положение элемента; страница могла измениться во время снимка.</p>}{geometryCaption&&<p className="evidence-note">{geometryCaption}</p>}{geometryNotice&&<p className="evidence-note" role="status">{geometryNotice}</p>}<p className="evidence-note">Видимый текст страницы может остаться на PNG.</p><p className="evidence-note">{activeIssue.status==='recommendation'?(activeIssue.kind==='ai-ux'?'Это предположение ИИ — подтвердите его вручную.':'Это гипотеза правила — проверьте её контекст вручную.'):'Запись сформирована автоматическим тестом; при необходимости проверьте контекст вручную.'}</p></div></div></div>}
 </div>;
}
