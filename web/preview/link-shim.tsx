// Stands in for next/link in the single-file preview: pages live behind #home / #practice.
import type { AnchorHTMLAttributes } from "react";

export default function Link({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href === "/" ? "#home" : `#${href.slice(1)}`} {...rest} />;
}
