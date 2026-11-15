export interface FindingComparison { comparable:boolean; mappedPaths?:boolean; findings:Array<{findingId:string;afterFindingId?:string;status:'still-present'|'resolved'|'unverified'}> }
export function compareFindings(before:unknown, after:unknown, options?:{mapPaths?:boolean}):FindingComparison;
export function recheckedSteps(before:unknown, after:unknown, finding:unknown, options?:{mapPaths?:boolean}):{passed:number;total:number}|null;
export function presentableFindings(report:unknown):import('../src/lib/types').NormalizedFinding[] | null;
