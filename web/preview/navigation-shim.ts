// Stands in for next/navigation in the single-file preview: the query lives after "?" in the hash.
export function useSearchParams() {
  const i = location.hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : "");
}
