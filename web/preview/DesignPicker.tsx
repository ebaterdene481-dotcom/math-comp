// Preview only: lets Khasar flip between design directions and pick one.
import { useEffect, useState } from "react";

const OPTIONS = [
  { id: "minimal", name: "6. Минимал (шинэ)", swatch: ["#161618", "#ffffff", "#ededee"] },
  { id: "", name: "1. Тайван хөх", swatch: ["#1f3c88", "#e3e9f8", "#f5f6f8"] },
  { id: "heritage", name: "2. Монгол хээ", swatch: ["#12355b", "#c8962e", "#fbfaf7"] },
  { id: "app", name: "3. Орчин үеийн апп", swatch: ["#ea580c", "#ffffff", "#f2f4f7"] },
  { id: "night", name: "4. Шөнө", swatch: ["#4f74f0", "#f4c64e", "#0f1626"] },
  { id: "pen", name: "5. Анхны загвар", swatch: ["#2443c4", "#ffe14d", "#f4f7fb"] },
];

export function DesignPicker() {
  const [current, setCurrent] = useState(() => {
    try {
      return localStorage.getItem("preview.design") ?? "minimal";
    } catch {
      return "";
    }
  });
  // Starts folded on phones so it does not cover the page.
  const [open, setOpen] = useState(() => window.innerWidth > 700);

  useEffect(() => {
    if (current) document.documentElement.dataset.design = current;
    else delete document.documentElement.dataset.design;
    try {
      localStorage.setItem("preview.design", current);
    } catch {}
  }, [current]);

  return (
    <div className="design-picker">
      <button type="button" className="dp-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Загвар сонгох
      </button>
      {open && (
        <div className="dp-list" role="radiogroup" aria-label="Загварын сонголт">
          {OPTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={current === o.id} onClick={() => setCurrent(o.id)}>
              <span className="dp-swatch">
                {o.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const PICKER_CSS = `
.design-picker{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;
  width:230px;background:#fff;color:#18264a;border:1px solid #c9d0dc;border-radius:8px;
  box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.3 "Golos Text",system-ui,sans-serif;overflow:hidden}
.dp-toggle{display:block;width:100%;padding:10px 12px;border:0;background:#18264a;color:#fff;font:600 14px "Golos Text",system-ui,sans-serif;cursor:pointer;text-align:left}
.dp-list{display:grid;padding:6px}
.dp-list button{display:flex;align-items:center;gap:10px;padding:8px;border:0;border-radius:6px;background:none;color:#18264a;font:inherit;text-align:left;cursor:pointer}
.dp-list button[aria-checked="true"]{background:#e8edf8;font-weight:700}
.dp-swatch{display:flex;flex:none}
.dp-swatch i{width:14px;height:22px;border:1px solid rgba(0,0,0,.12)}
.dp-swatch i:first-child{border-radius:4px 0 0 4px}.dp-swatch i:last-child{border-radius:0 4px 4px 0}
@media (max-width:520px){.design-picker{left:16px;right:16px;width:auto}.dp-list{grid-template-columns:1fr 1fr}}
`;
