declare module '@uxproof/audit-config-limits.json' {
  const limits: {
    minScenarios: number;
    maxScenarios: number;
    minSteps: number;
    maxSteps: number;
    minViewports: number;
    maxViewports: number;
  };
  export default limits;
}
