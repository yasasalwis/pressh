/**
 * In-process guard that pauses content/data mutations on the Studio while a
 * database migration copies records. Combined with the public Site's maintenance
 * mode, it ensures no write lands in the old store after the copy has begun and
 * would otherwise be lost. The lock lives in memory for the lifetime of the
 * migrating request — the process restarts onto the new backend immediately
 * after cutover, so it never needs to persist.
 */
export interface MigrationLock {
  isLocked(): boolean;
  lock(): void;
  unlock(): void;
}

export function createMigrationLock(): MigrationLock {
  let locked = false;
  return {
    isLocked: () => locked,
    lock: () => {
      locked = true;
    },
    unlock: () => {
      locked = false;
    },
  };
}
