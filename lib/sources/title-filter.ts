/**
 * Company boards list every open role, so each adapter keeps only the ones
 * that look like an internship (Spec "Watcher": intern, co-op, summer, student,
 * target year). Word boundaries matter: "Internal Audit Manager" is not an
 * internship.
 */
const INTERNSHIP_TITLE =
  /\b(intern(ship)?s?|co-?op|cooperative education|students?|summer\s+20\d\d)\b/i;

export function isInternshipTitle(title: string): boolean {
  return INTERNSHIP_TITLE.test(title);
}
