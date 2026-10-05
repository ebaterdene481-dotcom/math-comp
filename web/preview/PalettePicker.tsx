// Preview only: lets Khasar flip between the colour options and pick one.
import { useEffect, useState } from "react";

const OPTIONS = [
  { id: "", name: "1. Үзэг ба тодруулагч", swatch: ["#2443c4", "#ffe14d", "#f4f7fb"] },
  { id: "navy", name: "2. Тайван хөх", swatch: ["#1f3c88", "#e3e9f8", "#f5f6f8"] },
  { id: "green", name: "3. Ногоон", swatch: ["#1e6b52", "#f1dfa0", "#f4f5f0"] },
  { id: "mono", name: "4. Хар цагаан", swatch: ["#121417", "#f2c94c", "#fafafa"] },
  { id: "night", name: "5. Шөнө", swatch: ["#4f74f0", "#f4c64e", "#0f1626"] },
];

export function PalettePicker() {
  const [current, setCurrent] = useState(() => {
    try {
      return localStorage.getItem("preview.palette") ?? "";
    } catch {
      return "";
    }
  });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (current) document.documentElement.dataset.palette = current;
    else delete document.documentElement.dataset.palette;
    try {
      localStorage.setItem("preview.palette", current);
    } catch {}
  }, [current]);

  return (
    <div className={`palette-picker${open ? "" : " closed"}`}>
      <button type="button" className="pp-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Өнгө сонгох
      </button>
      {open && (
        <div className="pp-list" role="radiogroup" aria-label="Өнгөний сонголт">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={current === o.id}
              onClick={() => setCurrent(o.id)}
            >
              <span className="pp-swatch">
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
.palette-picker{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;
  width:220px;background:#fff;color:#18264a;border:1px solid #c9d0dc;border-radius:8px;
  box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.3 "Golos Text",system-ui,sans-serif;overflow:hidden}
.palette-picker.closed{width:auto}
.pp-toggle{display:block;width:100%;padding:10px 12px;border:0;background:#18264a;color:#fff;font:600 14px "Golos Text",system-ui,sans-serif;cursor:pointer;text-align:left}
.pp-list{display:grid;padding:6px}
.pp-list button{display:flex;align-items:center;gap:10px;padding:8px;border:0;border-radius:6px;background:none;color:#18264a;font:inherit;text-align:left;cursor:pointer}
.pp-list button[aria-checked="true"]{background:#e8edf8;font-weight:700}
.pp-swatch{display:flex;flex:none}
.pp-swatch i{width:14px;height:22px;border:1px solid rgba(0,0,0,.12)}
.pp-swatch i:first-child{border-radius:4px 0 0 4px}.pp-swatch i:last-child{border-radius:0 4px 4px 0}
@media (max-width:520px){.palette-picker{left:16px;right:16px;width:auto}.pp-list{grid-template-columns:1fr 1fr}}
`;
