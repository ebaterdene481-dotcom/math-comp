// Builds dist/preview.html: one self-contained page (JS and CSS inlined).
// It is a page body fragment: the host that serves it adds doctype, head and body.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = await build({
  entryPoints: [join(here, "main.tsx")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  target: "es2020",
  loader: { ".svg": "dataurl" },
  alias: { "next/link": join(here, "link-shim.tsx") },
  define: {
    "process.env.NEXT_PUBLIC_API_URL": '"http://preview.local"',
    "process.env.NEXT_PUBLIC_GAME_WS_URL": '"ws://preview.local/ws/practice"',
    "process.env.NODE_ENV": '"production"',
  },
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync(join(here, "../app/globals.css"), "utf8");
const html = `<title>5 секунд</title>
<meta name="description" content="100 бодлого, бодлого бүрт 5 секунд.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700;800;900&family=PT+Serif:wght@400;700&family=Manrope:wght@600;700;800&family=Unbounded:wght@700&display=swap" rel="stylesheet">
<style>:root{--font-body:"Golos Text",system-ui,sans-serif;color-scheme:light}
${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/preview.html"), html);
console.log(`dist/preview.html ${(html.length / 1024).toFixed(0)} KB`);
