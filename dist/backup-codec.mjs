export const COMPACT_BACKUP_FORMAT = 'zhixing.backup.v2';
export const PROGRESS_BACKUP_FORMAT = 'zhixing.progress-backup.v1';
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

// Preserve the exact source record once, then only encode normalization differences.
export function compactBank(bank) {
  return { ...bank, questions: bank.questions.map(question => {
    const { original, ...current } = question;
    const source = original ?? current;
    const changes = {};
    for (const [key, value] of Object.entries(current))
      if (JSON.stringify(value) !== JSON.stringify(source[key])) changes[key] = value;
    return { source, changes };
  }) };
}

export function expandBank(bank) {
  if (!bank || !Array.isArray(bank.questions) || bank.questions.length > 100000)
    throw new Error('备份中的题库格式错误');
  return { ...bank, questions: bank.questions.map(record => {
    if (!record?.source || typeof record.source !== 'object' || Array.isArray(record.source) ||
        !record.changes || typeof record.changes !== 'object' || Array.isArray(record.changes) ||
        Object.hasOwn(record.changes, 'original')) throw new Error('备份中的原题记录格式错误');
    return { ...record.source, ...record.changes, original: record.source };
  }) };
}

export function createBackup(bank, state, progressOnly = false) {
  if (progressOnly) {
    if (bank.managedBundle === false || !bank.revision?.startsWith('pdf-'))
      throw new Error('自定义题库请导出完整备份');
    return { format: PROGRESS_BACKUP_FORMAT, bankRevision: bank.revision, state };
  }
  return { format: COMPACT_BACKUP_FORMAT, bank: compactBank(bank), state };
}
