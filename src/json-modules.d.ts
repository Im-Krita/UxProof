declare module '@uxproof/audit-config-limits.json' {
  const limits: {
    minScenarios: number;
    maxScenarios: number;
    minSteps: number;
    maxSteps: number;
    minViewports: number;
    maxViewports: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    maxProjectLen: number;
    maxScenarioTitle: number;
    maxStepName: number;
    maxTarget: number;
    maxValue: number;
    stepTypes: string[];
  };
  export default limits;
}

declare module '@uxproof/rule-registry.json' {
  const registry: {
    schemaVersion: string;
    rules: Array<{
      ruleId: string;
      version: string;
      title: string;
      category: string;
      scope: string;
      requiredEvidence: string[];
      trigger: { type: string; toleranceCssPx?: number; minOccurrences?: number };
      exclusions: string[];
      classification: 'technical-fact' | 'semantic-hypothesis';
      remediation: string;
      fixtures: string[];
      status: 'enabled' | 'disabled';
    }>;
  };
  export default registry;
}
