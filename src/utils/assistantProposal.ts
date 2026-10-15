export interface AssistantEditorContext {
  connectionId: string;
  database: string;
  version: number | null;
}

export const canEditAssistantProposal = (
  prepared: AssistantEditorContext,
  current: AssistantEditorContext,
): boolean => prepared.connectionId === current.connectionId
  && prepared.database === current.database
  && prepared.version !== null
  && prepared.version === current.version;
