// What a new password must contain. The web form shows the same list (web/app/lib/password.ts).

export const PASSWORD_RULES: { test: (pw: string) => boolean; text: string }[] = [
  { test: (pw) => pw.length >= 8, text: "Дор хаяж 8 тэмдэгт" },
  { test: (pw) => /\p{Lu}/u.test(pw), text: "Нэг том үсэг" },
  { test: (pw) => /\p{N}/u.test(pw), text: "Нэг тоо" },
  { test: (pw) => /[^\p{L}\p{N}\s]/u.test(pw), text: "Нэг тэмдэгт (!, @, #, ? гэх мэт)" },
];

/** The unmet rules as one Mongolian sentence, or null when the password is fine. */
export function passwordProblem(pw: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.text.toLowerCase());
  return missing.length ? `Нууц үгэнд ${missing.join(", ")} байх ёстой.` : null;
}
