import { PASSWORD_RULES } from "./lib/password";

/** The password rules under a new-password field, each ticked off as it is met. */
export function PasswordRules({ value, id }: { value: string; id?: string }) {
  return (
    <ul className="pw-rules" id={id} aria-live="polite">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.text} className={ok ? "ok" : undefined}>
            <span aria-hidden="true">{ok ? "✓" : "○"}</span>
            {r.text}
            <span className="visually-hidden">{ok ? " — биелсэн" : " — дутуу"}</span>
          </li>
        );
      })}
    </ul>
  );
}
