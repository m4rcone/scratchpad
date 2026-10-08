/**
 * Which updates the footer mentions. Chrome installs an update without a word,
 * so a new minor or major gets one link in the footer for a session; a patch
 * changes nothing anyone would look for, and gets none.
 */

const parts = (version: string) => version.split('.').map((part) => Number(part) || 0);

export function isFeatureRelease(previous: string | undefined, current: string): boolean {
  if (!previous) return false;
  const [major = 0, minor = 0] = parts(current);
  const [wasMajor = 0, wasMinor = 0] = parts(previous);
  return major > wasMajor || (major === wasMajor && minor > wasMinor);
}

/** `1.1.0` reads as `1.1`: the patch is noise in a sentence. */
export function shortVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}
