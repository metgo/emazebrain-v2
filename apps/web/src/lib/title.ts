import { useEffect } from "react";

/** Each page has a unique title (WCAG 2.4.2): "Patients · eMazeBrain". */
export function useTitle(page: string | undefined) {
  useEffect(() => {
    document.title = page ? `${page} · eMazeBrain` : "eMazeBrain";
  }, [page]);
}
