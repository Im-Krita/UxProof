export interface FindingComparison { comparable:boolean; findings:Array<{findingId:string;status:'still-present'|'unverified'}> }
export function compareFindings(before:unknown, after:unknown):FindingComparison;
export function recheckedSteps(before:unknown, after:unknown, finding:unknown):{passed:number;total:number}|null;
export function presentableFindings(report:unknown):import('../src/lib/types').NormalizedFinding[] | null;
