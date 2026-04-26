/**
 * The tailored PDF's file name, as the user downloads it (Spec step 7):
 * "First_Last_Resume_Company.pdf". It's stored as {user_id}/{posting_id}.pdf;
 * this is only the name it's saved under.
 */

/** ASCII letters and digits only, underscores between words. */
export function pdfFileName(name: string, company: string): string {
  const part = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const person = part(name) || "My";
  const employer = part(company);
  return `${person}_Resume${employer ? `_${employer}` : ""}.pdf`;
}
