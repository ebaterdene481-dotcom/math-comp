"use client";

import { SiteHeader } from "../SiteHeader";
import { GameScreen } from "../game/GameScreen";
import { Results } from "../game/Results";
import { PRACTICE_WS_URL } from "../game/useGame";

export default function Practice() {
  return (
    <main className="wrap">
      <SiteHeader />
      <GameScreen
        url={PRACTICE_WS_URL}
        startCard={(start) => (
          <div className="sheet">
            <h1 className="total" style={{ fontSize: "clamp(32px, 6vw, 48px)" }}>
              20 бодлого
            </h1>
            <p className="total-label">5 шат, шат бүрт 4 бодлого. Хялбараас хэцүү рүү. Оноо хадгалагдахгүй.</p>
            <button className="btn" onClick={start}>
              Эхлэх
            </button>
            <p className="hint">
              Эхлэх товч дарсны дараа 10 секунд тоолоод эхний бодлого гарна. Хариугаа бичээд Enter
              дар, утсан дээр «Илгээх» товч дар.
            </p>
          </div>
        )}
        results={(r, again) => <Results result={r} onAgain={again} />}
      />
    </main>
  );
}
