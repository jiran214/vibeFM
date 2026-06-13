export type CliNoticeWriter = (message: string) => unknown;

export async function runWithBlockingNotice<T>(
  notice: string,
  operation: () => Promise<T>,
  writeNotice: CliNoticeWriter = (message) => process.stderr.write(message),
): Promise<T> {
  writeNotice(`${notice}\n`);
  return operation();
}
