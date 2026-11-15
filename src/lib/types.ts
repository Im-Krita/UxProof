export type StepType = 'click' | 'fill' | 'select' | 'check' | 'navigate' | 'expectVisible' | 'expectHidden' | 'expectText' | 'expectValue' | 'wait';
export interface AuditStep { type:StepType; name:string; target:string; value:string }
export interface Scenario { id:string; title:string; description:string; steps:AuditStep[] }
export interface Viewport { id:string; label:string; width:number; height:number }
export interface AuditConfig { project:string; baseUrl:string; scenarios:Scenario[]; viewports:Viewport[]; options:{enableAI:boolean;aiProvider:'openai'|'ollama'} }
export interface StepResult { index:number; name:string; type:StepType; status:'passed'|'failed'; durationMs:number; error?:string }
export interface FlowResult { id:string; scenario:string; viewport:string; width:number; height:number; status:'passed'|'failed'; passedSteps:number; totalSteps:number; steps:StepResult[]; screenshot:string|null; durationMs:number }
export interface Issue { id:string; kind:string; status:'confirmed'|'recommendation'|'observation'; severity:'high'|'medium'|'low'; title:string; description:string; scenario:string; viewport:string; screenshot:string|null; reproduction?:string; step?:number|null; ruleId?:string; helpUrl?:string }
export interface AuditReport { runId:string; project:string; baseUrl:string; startedAt:string; durationMs:number; status:string; summary:{totalRuns:number;passedRuns:number;failedRuns:number;confirmedIssues:number;aiSuggestions:number;accessibilityIssues:number}; results:FlowResult[]; issues:Issue[]; warnings:string[] }
export type Panel = 'scenarios'|'results'|'history';
