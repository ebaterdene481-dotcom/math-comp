"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { STATUS_TEXT } from "../CompetitionBoard";
import { SiteHeader } from "../SiteHeader";
import {
  AUTH_EVENT,
  type AdminCompetition,
  type AdminDashboard,
  type AdminWithdrawal,
  ApiError,
  type CompetitionForm,
  awardPrize,
  createCompetition,
  deleteCompetition,
  fmtPoints,
  getAdminCompetitions,
  getAdminDashboard,
  getAdminWithdrawals,
  getMe,
  groupDigits,
  markWithdrawalPaid,
  rejectWithdrawal,
  updateCompetition,
  uploadImage,
} from "../lib/api";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const when = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fmtAt = (iso: string) => when.format(new Date(iso)).replace(/-/g, ".").replace(",", "");

/** ISO time → value for <input type="datetime-local"> in the browser's own time zone. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Tab = "dashboard" | "competitions" | "awards" | "withdrawals";

/**
 * Admin page: running competitions, adding new ones with a prize picture, handing out
 * prizes, and paying out players' withdrawal requests.
 */
export default function AdminPage() {
  const [access, setAccess] = useState<"loading" | "denied" | "ok">("loading");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dash, setDash] = useState<AdminDashboard | null>(null);
  const [list, setList] = useState<AdminCompetition[]>([]);
  const [payouts, setPayouts] = useState<AdminWithdrawal[]>([]);

  const reload = useCallback(async () => {
    try {
      const [d, c, w] = await Promise.all([getAdminDashboard(), getAdminCompetitions(), getAdminWithdrawals()]);
      setDash(d);
      setList(c.competitions);
      setPayouts(w.withdrawals);
      setAccess("ok");
    } catch {
      setAccess("denied");
    }
  }, []);

  useEffect(() => {
    const check = () =>
      getMe()
        .then((r) => (r.user?.isAdmin ? reload() : setAccess("denied")))
        .catch(() => setAccess("denied"));
    check();
    window.addEventListener(AUTH_EVENT, check);
    return () => window.removeEventListener(AUTH_EVENT, check);
  }, [reload]);

  const awaiting = list.filter((c) => c.status === "finished" && c.winner && !c.award).length;
  const waitingPayouts = payouts.filter((w) => w.status === "pending").length;

  return (
    <main className="wrap">
      <SiteHeader />
      <section className="admin">
        {access === "loading" && <p className="meta">Ачаалж байна…</p>}
        {access === "denied" && (
          <div className="sheet profile-empty">
            <h1>Админ</h1>
            <p>Энэ хуудсыг зөвхөн админ эрхтэй хүн үзнэ. Админ бүртгэлээрээ нэвтэрнэ үү.</p>
          </div>
        )}
        {access === "ok" && (
          <>
            <div className="admin-head">
              <h1>Админ</h1>
              <div className="admin-tabs" role="tablist">
                {(
                  [
                    ["dashboard", "Самбар"],
                    ["competitions", "Тэмцээнүүд"],
                    ["awards", "Шагнал"],
                    ["withdrawals", "Мөнгө татах"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    className={tab === k ? "active" : undefined}
                    onClick={() => setTab(k)}
                  >
                    {label}
                    {k === "awards" && awaiting > 0 && <span className="badge">{awaiting}</span>}
                    {k === "withdrawals" && waitingPayouts > 0 && <span className="badge">{waitingPayouts}</span>}
                  </button>
                ))}
              </div>
            </div>
            {tab === "dashboard" && dash && <Dashboard d={dash} onGo={setTab} />}
            {tab === "competitions" && <Competitions list={list} reload={reload} />}
            {tab === "awards" && <Awards list={list} reload={reload} />}
            {tab === "withdrawals" && <Withdrawals list={payouts} reload={reload} />}
          </>
        )}
      </section>
    </main>
  );
}

function Dashboard({ d, onGo }: { d: AdminDashboard; onGo: (t: Tab) => void }) {
  const c = d.current;
  return (
    <div className="admin-grid">
      <article className="comp-card admin-current">
        <span className="stat-label">Одоогийн тэмцээн</span>
        {c ? (
          <>
            <div className="admin-current-head">
              <h2>{c.name}</h2>
              <span className={`status status-${c.status}`}>{STATUS_TEXT[c.status]}</span>
            </div>
            <p className="meta">
              {fmtAt(c.opensAt)} – {fmtAt(c.closesAt)} · Шагнал: {c.prize}
            </p>
            <dl className="tiles admin-tiles">
              <div>
                <dt>Зарагдсан оролдлого</dt>
                <dd>
                  {c.attemptsUsed}
                  <small>/{c.maxAttempts}</small>
                </dd>
              </div>
              <div>
                <dt>Орсон хураамж</dt>
                <dd>{groupDigits(c.fees)}₮</dd>
              </div>
              <div>
                <dt>Оноо авсан тоглогч</dt>
                <dd>{c.players}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p>Одоогоор тэмцээн алга. «Тэмцээнүүд» хэсгээс шинээр үүсгэнэ үү.</p>
        )}
      </article>
      <dl className="tiles admin-tiles admin-today">
        <div>
          <dt>Өнөөдөр зарагдсан</dt>
          <dd>{d.today.attempts}</dd>
        </div>
        <div>
          <dt>Өнөөдрийн хураамж</dt>
          <dd>{groupDigits(d.today.fees)}₮</dd>
        </div>
        <div>
          <dt>Шинэ хэрэглэгч өнөөдөр</dt>
          <dd>
            {d.users.since}
            <small> / нийт {d.users.total}</small>
          </dd>
        </div>
        <div>
          <dt>Шагнал олгох хүлээгдэж буй</dt>
          <dd>{d.awaitingAward}</dd>
        </div>
        <div>
          <dt>Мөнгө татах хүсэлт</dt>
          <dd>{d.pendingWithdrawals}</dd>
        </div>
      </dl>
      <div className="admin-actions">
        <button type="button" className="btn" onClick={() => onGo("competitions")}>
          Тэмцээн үүсгэх
        </button>
        {d.awaitingAward > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => onGo("awards")}>
            Шагнал олгох ({d.awaitingAward})
          </button>
        )}
        {d.pendingWithdrawals > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => onGo("withdrawals")}>
            Мөнгө татах ({d.pendingWithdrawals})
          </button>
        )}
      </div>
    </div>
  );
}

function Competitions({ list, reload }: { list: AdminCompetition[]; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<AdminCompetition | "new" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function remove(c: AdminCompetition) {
    if (!window.confirm(`«${c.name}» тэмцээнийг устгах уу?`)) return;
    try {
      await deleteCompetition(c.id);
      setNote(`«${c.name}» устгагдлаа.`);
      await reload();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Алдаа гарлаа.");
    }
  }

  return (
    <div className="admin-grid">
      {editing ? (
        <CompetitionEditor
          c={editing === "new" ? null : editing}
          onDone={async (msg) => {
            setEditing(null);
            setNote(msg);
            await reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="admin-actions">
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            Шинэ тэмцээн үүсгэх
          </button>
        </div>
      )}
      {note && (
        <p className="admin-note" role="status">
          {note}
        </p>
      )}
      <ul className="admin-list">
        {list.map((c) => (
          <li key={c.id} className="comp-card admin-row">
            <span className="admin-thumb">{c.prizeImage && <img src={c.prizeImage} alt="" />}</span>
            <div className="admin-row-main">
              <div className="admin-row-head">
                <b>{c.name}</b>
                <span className={`status status-${c.status}`}>{STATUS_TEXT[c.status]}</span>
              </div>
              <span className="meta">
                {fmtAt(c.opensAt)} – {fmtAt(c.closesAt)}
              </span>
              <span className="meta">
                Шагнал: {c.prize} · Хураамж {groupDigits(c.entryFee)}₮ · {c.attemptsUsed}/{c.maxAttempts} оролдлого ·
                Орсон {groupDigits(c.fees)}₮
              </span>
            </div>
            <div className="admin-row-actions">
              <Link href={`/competition?id=${c.id}`} className="btn btn-quiet">
                Харах
              </Link>
              {c.status !== "finished" && (
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(c)}>
                  Засах
                </button>
              )}
              {c.attemptsUsed === 0 && (
                <button type="button" className="btn btn-quiet btn-danger" onClick={() => remove(c)}>
                  Устгах
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompetitionEditor({
  c,
  onDone,
  onCancel,
}: {
  c: AdminCompetition | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const hour = 3600_000;
  const [form, setForm] = useState<CompetitionForm>(() =>
    c
      ? {
          name: c.name,
          prize: c.prize,
          prizeImage: c.prizeImage ?? undefined,
          prizeShare: c.prizeShare ?? undefined,
          entryFee: c.entryFee,
          maxAttempts: c.maxAttempts,
          opensAt: toLocalInput(c.opensAt),
          closesAt: toLocalInput(c.closesAt),
        }
      : {
          name: "",
          prize: "",
          entryFee: 5000,
          maxAttempts: 100,
          opensAt: toLocalInput(new Date(Date.now() + hour).toISOString()),
          closesAt: toLocalInput(new Date(Date.now() + 25 * hour).toISOString()),
        },
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Players paid under these terms, so they stay as they are.
  const locked = Boolean(c && c.attemptsUsed > 0);

  const set = <K extends keyof CompetitionForm>(k: K, v: CompetitionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return setError("Зөвхөн PNG, JPG эсвэл WebP зураг оруулна уу.");
    if (file.size > MAX_IMAGE_BYTES) return setError("Зураг 2 МБ-аас бага байна.");
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { url } = await uploadImage(dataUrl);
      set("prizeImage", url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Зураг оруулж чадсангүй.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      prizeImage: form.prizeImage ?? "",
      prizeShare: form.prizeShare ?? "",
      opensAt: new Date(form.opensAt).toISOString(),
      closesAt: new Date(form.closesAt).toISOString(),
    };
    try {
      if (c) await updateCompetition(c.id, payload);
      else await createCompetition(payload);
      onDone(c ? `«${form.name}» хадгалагдлаа.` : `«${form.name}» үүслээ.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="comp-card admin-form" onSubmit={submit}>
      <h2>{c ? "Тэмцээн засах" : "Шинэ тэмцээн"}</h2>
      <div className="admin-form-grid">
        <div className="admin-image">
          <span className="field-label">Шагналын зураг</span>
          <div className="admin-image-box">
            {form.prizeImage ? <img src={form.prizeImage} alt="Шагналын зураг" /> : <span>Зураг алга</span>}
          </div>
          <label className="btn btn-quiet admin-upload">
            {uploading ? "Оруулж байна…" : form.prizeImage ? "Зураг солих" : "Зураг оруулах"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                pickImage(e.target.files?.[0]);
                e.target.value = "";
              }}
              disabled={uploading}
            />
          </label>
          {form.prizeImage && (
            <button type="button" className="link" onClick={() => set("prizeImage", undefined)}>
              Зургийг хасах
            </button>
          )}
          <span className="meta">PNG, JPG эсвэл WebP, 2 МБ хүртэл. 16:9 харьцаатай зураг хамгийн сайн харагдана.</span>
        </div>
        <div className="admin-fields">
          <label>
            <span className="field-label">Тэмцээний нэр</span>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={60} />
          </label>
          <label>
            <span className="field-label">Шагнал</span>
            <input value={form.prize} onChange={(e) => set("prize", e.target.value)} required maxLength={80} />
          </label>
          <label>
            <span className="field-label">Шагналын сан (хураамжийн %)</span>
            <input
              type="number"
              min={1}
              max={100}
              placeholder="Бараа бол хоосон үлдээнэ"
              value={form.prizeShare ?? ""}
              onChange={(e) => set("prizeShare", e.target.value === "" ? undefined : Number(e.target.value))}
              disabled={locked}
            />
            {form.prizeShare ? (
              <span className="meta">
                {form.maxAttempts} оролдлого бүгд зарагдвал ялагч{" "}
                {groupDigits(Math.floor((form.maxAttempts * form.entryFee * Number(form.prizeShare)) / 100))}₮ авна.
              </span>
            ) : null}
          </label>
          <div className="field-row">
            <label>
              <span className="field-label">Хураамж (₮)</span>
              <input
                type="number"
                min={0}
                step={500}
                value={form.entryFee}
                onChange={(e) => set("entryFee", Number(e.target.value))}
                disabled={locked}
              />
            </label>
            <label>
              <span className="field-label">Нийт оролдлого</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={form.maxAttempts}
                onChange={(e) => set("maxAttempts", Number(e.target.value))}
                disabled={locked}
              />
            </label>
          </div>
          <div className="field-row">
            <label>
              <span className="field-label">Эхлэх цаг</span>
              <input
                type="datetime-local"
                value={form.opensAt}
                onChange={(e) => set("opensAt", e.target.value)}
                disabled={locked}
                required
              />
            </label>
            <label>
              <span className="field-label">Хаагдах цаг</span>
              <input
                type="datetime-local"
                value={form.closesAt}
                onChange={(e) => set("closesAt", e.target.value)}
                required
              />
            </label>
          </div>
          {locked && (
            <p className="meta">
              Төлбөр төлсөн оролцогч байгаа тул хураамж, оролдлогын тоо, эхлэх цагийг өөрчлөхгүй.
            </p>
          )}
        </div>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        <button type="submit" className="btn" disabled={busy || uploading}>
          {busy ? "Хадгалж байна…" : c ? "Хадгалах" : "Тэмцээн үүсгэх"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Болих
        </button>
      </div>
    </form>
  );
}

function Awards({ list, reload }: { list: AdminCompetition[]; reload: () => Promise<void> }) {
  const finished = list.filter((c) => c.status === "finished");
  if (finished.length === 0)
    return (
      <div className="sheet">
        <p>Одоогоор дууссан тэмцээн алга. Тэмцээн дуусмагц ялагч энд гарна.</p>
      </div>
    );
  return (
    <ul className="admin-list">
      {finished.map((c) => (
        <AwardRow key={c.id} c={c} reload={reload} />
      ))}
    </ul>
  );
}

function AwardRow({ c, reload }: { c: AdminCompetition; reload: () => Promise<void> }) {
  const [cash, setCash] = useState(c.prizeFund ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function award() {
    const what = cash > 0 ? `${groupDigits(cash)}₮ хэтэвчинд нь шилжүүлж` : `«${c.prize}» шагналыг гардуулсан гэж`;
    if (!window.confirm(`${c.winner!.nickname}-д ${what} тэмдэглэх үү? Үүнийг буцаах боломжгүй.`)) return;
    setBusy(true);
    setError(null);
    try {
      await awardPrize(c.id, cash);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="comp-card admin-row award-row">
      <span className="admin-thumb">{c.prizeImage && <img src={c.prizeImage} alt="" />}</span>
      <div className="admin-row-main">
        <div className="admin-row-head">
          <b>{c.name}</b>
          {c.award ? <span className="pill-done">Олгосон</span> : c.winner && <span className="pill-wait">Хүлээгдэж буй</span>}
        </div>
        <span className="meta">
          {fmtAt(c.closesAt)}-нд дууссан · Шагнал: {c.prize}
        </span>
        {c.winner ? (
          <span className="award-winner">
            Ялагч: <b>{c.winner.nickname}</b> · {fmtPoints(c.winner.points)} оноо
          </span>
        ) : (
          <span className="meta">Оноо авсан оролцогч байгаагүй.</span>
        )}
        {c.award && (
          <span className="meta">
            {fmtAt(c.award.at)}-нд олгосон
            {c.award.cash > 0 ? ` · ${groupDigits(c.award.cash)}₮ хэтэвчинд шилжсэн` : " · бараагаар"}
          </span>
        )}
        {error && (
          <span className="auth-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {c.winner && !c.award && (
        <div className="award-form">
          <label>
            <span className="field-label">Мөнгөн шагнал (₮)</span>
            <input type="number" min={0} step={1000} value={cash} onChange={(e) => setCash(Number(e.target.value))} />
            <span className="meta">Бараа бол 0 үлдээнэ.</span>
          </label>
          <button type="button" className="btn" disabled={busy} onClick={award}>
            {busy ? "Түр хүлээнэ үү…" : "Шагнал олгосон"}
          </button>
        </div>
      )}
    </li>
  );
}

const W_STATUS = { pending: "Хүлээгдэж буй", paid: "Шилжүүлсэн", rejected: "Татгалзсан" } as const;

/** Players' requests to take money out: waiting ones first. */
function Withdrawals({ list, reload }: { list: AdminWithdrawal[]; reload: () => Promise<void> }) {
  if (list.length === 0) return <p className="meta">Одоогоор мөнгө татах хүсэлт алга.</p>;
  return (
    <>
      <p className="meta admin-hint">
        Мөнгө хүсэлт ирэх үед тоглогчийн хэтэвчнээс хасагдсан. Банкны аппаараа шилжүүлээд «Шилжүүлсэн» дарна. Татгалзвал мөнгө
        хэтэвчинд нь буцна.
      </p>
      <ul className="admin-list">
        {list.map((w) => (
          <WithdrawalRow key={w.id} w={w} reload={reload} />
        ))}
      </ul>
    </>
  );
}

function WithdrawalRow({ w, reload }: { w: AdminWithdrawal; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
    }
  }

  const paid = () => {
    if (window.confirm(`${w.nickname}-д ${groupDigits(w.amount)}₮ шилжүүлсэн гэж тэмдэглэх үү? Үүнийг буцаах боломжгүй.`))
      act(() => markWithdrawalPaid(w.id));
  };

  return (
    <li className="comp-card admin-row payout-row">
      <div className="admin-row-main">
        <div className="admin-row-head">
          <b className="payout-amount">{groupDigits(w.amount)}₮</b>
          <span className={`pill-${w.status}`}>{W_STATUS[w.status]}</span>
        </div>
        <span className="payout-bank">
          {w.bank} · <span className="num">{w.account}</span> · {w.holder}
        </span>
        <span className="meta">
          {w.nickname} · {fmtAt(w.requestedAt)}-нд хүссэн
          {w.decidedAt && ` · ${fmtAt(w.decidedAt)}-нд шийдсэн`}
          {w.status === "pending" && ` · хэтэвчинд үлдсэн ${groupDigits(w.balance)}₮`}
        </span>
        {w.reason && <span className="withdraw-reason">Шалтгаан: {w.reason}</span>}
        {error && (
          <span className="auth-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {w.status === "pending" && (
        <div className="payout-actions">
          {rejecting ? (
            <form
              className="reject-form"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => rejectWithdrawal(w.id, reason));
              }}
            >
              <input
                required
                autoFocus
                placeholder="Татгалзах шалтгаан"
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
              />
              <button type="submit" className="btn btn-quiet" disabled={busy}>
                Татгалзах
              </button>
              <button type="button" className="link" onClick={() => setRejecting(false)}>
                Болих
              </button>
            </form>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={paid}>
                Шилжүүлсэн
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(true)}>
                Татгалзах
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
