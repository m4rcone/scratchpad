/**
 * Which updates are announced. Chrome installs an update without a word, so a
 * new minor or major flags settings until it is opened; a patch changes
 * nothing anyone would look for, and gets nothing.
 */

const parts = (version: string) => version.split('.').map((part) => Number(part) || 0);

export function isFeatureRelease(previous: string | undefined, current: string): boolean {
  if (!previous) return false;
  const [major = 0, minor = 0] = parts(current);
  const [wasMajor = 0, wasMinor = 0] = parts(previous);
  return major > wasMajor || (major === wasMajor && minor > wasMinor);
}
