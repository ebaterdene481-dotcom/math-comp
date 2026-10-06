"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import { ApiError, announceAuthChange, verifyEmail } from "../lib/api";

export default function VerifyPage() {
  return (
    <main className="wrap">
      <SiteHeader />
      <section className="link-page">
        <div className="sheet">
          <Suspense>
            <Verify />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

/** Opens the link from the verification email. */
function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ kind: "busy" } | { kind: "ok" } | { kind: "failed"; message: string }>({
    kind: "busy",
  });
  const tried = useRef(false);

  useEffect(() => {
    // A link works once, so React's double effect in development must not spend it twice.
    if (tried.current) return;
    tried.current = true;
    verifyEmail(token)
      .then(() => {
        setState({ kind: "ok" });
        announceAuthChange();
      })
      .catch((e) =>
        setState({ kind: "failed", message: e instanceof ApiError ? e.message : "Алдаа гарлаа. Дахин оролдоно уу." }),
      );
  }, [token]);

  if (state.kind === "busy") return <p className="meta">Шалгаж байна…</p>;
  if (state.kind === "failed")
    return (
      <>
        <h1>Холбоос ажилласангүй</h1>
        <p>{state.message}</p>
        <p className="meta">Нэвтэрч ороод дээд хэсгийн «Дахин илгээх» товчоор шинэ холбоос авна уу.</p>
        <Link href="/" className="btn">
          Нүүр хуудас
        </Link>
      </>
    );
  return (
    <>
      <h1>Имэйл баталгаажлаа</h1>
      <p>Одоо тэмцээнд оролцож, шагналын мөнгөө татах боломжтой.</p>
      <Link href="/" className="btn">
        Тэмцээн рүү очих
      </Link>
    </>
  );
}
