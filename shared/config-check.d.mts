export interface ConfigLimits {
  minScenarios:number; maxScenarios:number; minSteps:number; maxSteps:number;
  minViewports:number; maxViewports:number; minWidth:number; maxWidth:number;
  minHeight:number; maxHeight:number; maxProjectLen:number; maxScenarioTitle:number;
  maxStepName:number; maxTarget:number; maxValue:number; stepTypes:string[];
}
export function configError(config:unknown, limits:ConfigLimits, ruleIds:string[]):unknown;
export function configErrorText(config:unknown, limits:ConfigLimits, ruleIds:string[]):string;
