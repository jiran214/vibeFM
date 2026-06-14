import type {
  WorkflowProgressEvent,
  WorkflowProgressStatus,
  WorkflowStage,
} from "../core/workflow.js";

export type CliNoticeWriter = (message: string) => unknown;

const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  plan: "节目策划",
  detail: "歌曲信息",
  script: "节目文稿",
  events: "事件流",
  audio: "歌曲音频",
  speech: "主播语音",
  render: "节目合成",
};

const WORKFLOW_STATUS_LABELS: Record<WorkflowProgressStatus, string> = {
  started: "进行中",
  completed: "已完成",
  skipped: "已跳过（产物存在）",
  failed: "失败",
};

const WORKFLOW_BAR_WIDTH = 24;

export async function runWithBlockingNotice<T>(
  notice: string,
  operation: () => Promise<T>,
  writeNotice: CliNoticeWriter = (message) => process.stderr.write(message),
): Promise<T> {
  writeNotice(`${notice}\n`);
  return operation();
}

export function createWorkflowProgressReporter(
  writeNotice: CliNoticeWriter = (message) => process.stderr.write(message),
): (event: WorkflowProgressEvent) => void {
  return (event) => {
    const completed =
      event.status === "completed" || event.status === "skipped"
        ? event.index + 1
        : event.index;
    const filled = Math.round((completed / event.total) * WORKFLOW_BAR_WIDTH);
    const bar = `${"=".repeat(filled)}${"-".repeat(WORKFLOW_BAR_WIDTH - filled)}`;
    writeNotice(
      `[${bar}] ${completed}/${event.total}  ${WORKFLOW_STAGE_LABELS[event.stage]}  ${WORKFLOW_STATUS_LABELS[event.status]}\n`,
    );
  };
}
