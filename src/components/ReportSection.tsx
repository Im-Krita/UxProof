import{AlertCircle,ArrowLeft,Check,CheckCircle2,ChevronDown,ChevronRight,Clock3,FileDown,FileJson,RotateCcw,Sparkles,X,XCircle}from 'lucide-react';
import type {AuditReport,Issue,NormalizedFinding,NormalizedObservation} from '../lib/types';
import {compareFindings,displayViewportLabel,findingIssue,presentableFindings,recheckedSteps} from '../lib/report-view';
import {Confidence,Level,Score,comparisonLabel,formatDate} from '../lib/format';

export function ReportSection({report,previous,mapPaths=false,issues,issueFilter,setIssueFilter,onIssue,onExport,onJson,onXlsx,onTrace,onBack,compact=false}:{report:AuditReport;previous?:AuditReport;mapPaths?:boolean;issues:Issue[];issueFilter:'all'|'confirmed'|'recommendation';setIssueFilter:(v:'all'|'confirmed'|'recommendation')=>void;onIssue:(i:Issue)=>void;onExport:()=>void;onJson:()=>void;onXlsx:()=>void;onTrace:(trace:string)=>void;onBack:()=>void;compact?:boolean}){
 const groups=presentableFindings(report);
 const previousGroups=previous?presentableFindings(previous):null;
 const comparison=previous&&groups&&previousGroups?compareFindings(previous,report,{mapPaths}):null;
 const states=new Map(comparison?.findings.map(item=>[item.afterFindingId||item.findingId,item.status])||[]);
 const currentIds=new Set(groups?.map(finding=>finding.findingId)||[]);
 const previousIds=new Set(previousGroups?.map(finding=>finding.findingId)||[]);
 const previousOnly=comparison?.comparable?comparison.findings.filter(item=>previousIds.has(item.findingId)&&!item.afterFindingId&&!currentIds.has(item.findingId)):[];
 type Row={key:string;issue?:Issue;finding?:NormalizedFinding;observation?:NormalizedObservation;state?:string};
 const rows:Row[]=(()=>{
  if(!groups) return issues.map(issue=>({key:issue.id,issue}));
  const list:Row[]=[];
  const linked=new Set<string>();
  for(const finding of groups){
   for(const observation of finding.observations){
    const issue=findingIssue(report,finding,observation.observationId);
    if(issue) linked.add(issue.id);
    list.push({key:observation.observationId,issue,finding,observation,state:states.get(finding.findingId)});
   }
  }
  for(const issue of report.issues) if(!linked.has(issue.id)) list.push({key:issue.id,issue});
  return list;
 })();
 const visible=rows.filter(row=>issueFilter==='all'||row.issue?.status===issueFilter);
 const renderRow=(row:Row)=>{
  const issue=row.issue;
  const viewport=displayViewportLabel(row.observation?.viewportId||issue?.viewportId,issue?.viewport);
  const scenario=issue?.scenario||row.observation?.scenarioId||'';
  const badge=comparisonLabel(row.state);
  return <button type="button" className="issue-item" key={row.key} disabled={!issue} onClick={()=>{if(issue)onIssue(issue);} }><div className={`issue-marker ${issue?.status==='confirmed'?'hard':'soft'}`}>{issue?.status==='recommendation'?<Sparkles size={16}/>:<AlertCircle size={17}/>}</div><div className="issue-main"><b>{issue?.title||row.finding?.ruleId}</b><p>{issue?.description||''}</p><div>{issue&&<Confidence status={issue.status}/>}<span className="issue-context">{scenario} · {viewport}{badge?` · ${badge}`:''}</span></div></div>{issue&&<Level severity={issue.severity}/>}<ChevronRight size={17} className="issue-arrow"/></button>;
 };
 return <div className={compact?'report compact-report':'report'}><div className="page-head"><div><div className="eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ · {formatDate(report.startedAt)}</div>{compact?null:<h1>{report.status==='completed'?'Аудит завершён':'Аудит не завершён'}</h1>}<p>{report.project} · {report.baseUrl}</p></div><div className="report-actions"><button className="btn secondary" onClick={onJson}><FileJson size={16}/> JSON</button><button className="btn secondary" onClick={onXlsx}><FileDown size={16}/> Excel</button><button className="btn primary" onClick={onExport}><FileDown size={16}/> HTML-отчёт</button></div></div>
   <section className="panel-card report-card"><div className="panel-title"><div><h2>Найденные проблемы</h2></div><div className="issue-tabs">{[{'id':'all','name':'Все'},{'id':'confirmed','name':'Подтверждённые'},{'id':'recommendation','name':'Рекомендации'}].map(t=><button key={t.id} className={issueFilter===t.id?'active':''} onClick={()=>setIssueFilter(t.id as typeof issueFilter)}>{t.name}</button>)}</div></div>{visible.length?<div className="issue-list">{visible.map(renderRow)}</div>:<div className="no-issues"><CheckCircle2 size={21}/> В этой категории замечаний нет</div>}{previousOnly.length>0&&<div className="report-warnings"><AlertCircle size={17}/><div><b>Нет совпадения с предыдущим прогоном</b>{previousOnly.map(item=>{const finding=previousGroups?.find(group=>group.findingId===item.findingId);const check=previous&&finding?recheckedSteps(previous,report,finding,{mapPaths}):null;const prevIssue=previous&&finding?findingIssue(previous,finding):undefined;return <p key={item.findingId} title={item.findingId}>{prevIssue?.title||finding?.ruleId||'Неизвестное правило'} · {prevIssue?`${prevIssue.scenario} · ${displayViewportLabel(prevIssue.viewportId,prevIssue.viewport)}`:''} · {check?`Повторно пройдено шагов: ${check.passed}/${check.total}. `:''}{item.status==='resolved'?'Ошибка выполнения шага не повторилась на проверенных экранах; общий UX требует отдельной оценки.':'Требуется проверка; исправление не подтверждено.'}</p>})}</div></div>}</section>
   <div className="stats-grid"><div className="stat-card"><span>ПРОЙДЕНО СЦЕНАРИЕВ</span><div className="stat-number">{report.summary.passedRuns}<small> / {report.summary.totalRuns}</small></div><Score passed={report.summary.passedRuns} total={report.summary.totalRuns}/></div><div className="stat-card"><span>ПОДТВЕРЖДЁННЫЕ ДЕФЕКТЫ</span><div className="stat-number">{report.summary.confirmedIssues}</div><div className="stat-footer">По результатам проверок</div></div><div className="stat-card"><span>ЗАМЕЧАНИЯ ДОСТУПНОСТИ</span><div className="stat-number">{report.summary.accessibilityIssues}</div><div className="stat-footer">Автоматический анализ axe</div></div><div className="stat-card"><span>РЕКОМЕНДАЦИИ ИИ</span><div className="stat-number">{report.summary.aiSuggestions}</div><div className="stat-footer">Гипотез правил: {report.summary.ruleSuggestions ?? 0}</div></div></div>
   {previous&&comparison?.comparable&&<div className="regression-bar"><RotateCcw size={17}/><div><b>Повторная проверка · сравнение с предыдущим запуском</b><span>Успешных сценариев: {previous.summary.passedRuns} → {report.summary.passedRuns} · Подтверждённых замечаний: {previous.summary.confirmedIssues} → {report.summary.confirmedIssues}</span></div></div>}
   {previous&&comparison&&!comparison.comparable&&<div className="report-warnings"><AlertCircle size={17}/><div><b>Прогоны несопоставимы</b><p>Настройки, формат или состояние отчётов не позволяют сравнить находки.</p></div></div>}
   {comparison?.comparable&&<div className="regression-bar"><RotateCcw size={17}/><div><b>{comparison.mappedPaths?'Сопоставление выбранных путей':'Сопоставление наблюдений по ID'}</b><span>Совпали: {comparison.findings.filter(item=>item.status==='still-present').length} · Новые: {comparison.findings.filter(item=>String(item.status)==='new').length} · Ошибок шагов не повторилось: {comparison.findings.filter(item=>item.status==='resolved').length} · Требуют проверки: {comparison.findings.filter(item=>item.status==='unverified').length}.</span></div></div>}
   {!groups&&report.normalizedSchemaVersion&&<div className="report-warnings"><AlertCircle size={17}/><div><b>Нормализованные наблюдения недоступны</b><p>Формат не поддерживается или данные повреждены; показаны исходные записи.</p></div></div>}
   <section className="panel-card report-card"><div className="panel-title"><div><h2>Прогоны сценариев</h2><span>Каждый сценарий проверен в каждом выбранном разрешении</span></div><span className="subtle-chip"><Clock3 size={14}/>{Math.round(report.durationMs/1000)} сек</span></div><div className="run-list"><div className="run-list-head"><span>Сценарий</span><span>Экран</span><span>Шаги</span><span>Результат</span></div>{report.results.map(r=><details className="run-item" key={r.id}><summary><span className="run-name">{r.status==='passed'?<CheckCircle2 size={18}/>:<XCircle size={18}/>} {r.scenario}</span><span>{r.viewport}</span><span>{r.passedSteps}/{r.totalSteps}</span><span className={`status-pill ${r.status}`}>{r.status==='passed'?'Пройден':'Ошибка'}</span><ChevronDown size={16} className="row-chevron"/></summary><div className="run-steps">{r.steps.map((s,i)=><div className="run-step" key={i}><span className={s.status==='passed'?'step-pass':'step-fail'}>{s.status==='passed'?<Check size={14}/>:<X size={14}/>}</span><b>{s.name}</b><span>{s.durationMs} мс</span>{s.error&&<p>{s.error}</p>}</div>)}{r.trace&&<p className="trace-path">Trace: {r.trace} · <button type="button" className="text-button" onClick={()=>onTrace(r.trace as string)}>Открыть trace</button></p>}</div></details>)}</div></section>
   {report.warnings.length>0&&<div className="report-warnings"><AlertCircle size={17}/><div><b>Ограничения этого прогона</b>{report.warnings.map((w,i)=><p key={i}>{w}</p>)}</div></div>}
   <div className="report-bottom"><button className="text-button" onClick={onBack}><ArrowLeft size={16}/> Изменить сценарии</button><span>Данные хранятся локально · {report.runId.slice(0,8)}</span></div>
 </div>
}
