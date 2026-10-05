import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <header className="site-header">
        <Link href="/" className="logo">
          <span>5</span> секунд
        </Link>
        {/* Бүртгэл, нэвтрэх нь дараагийн үе шатанд нэмэгдэнэ */}
      </header>

      <section className="hero">
        <div>
          <h1>
            100 бодлого.
            <span className="clock">Бодлого бүрт 5 секунд.</span>
          </h1>
          <p>
            Хурдан, зөв бодсон хүн ялна. Хэдий хурдан зөв хариулна, төдий их оноо авна.
          </p>
          <ul className="rules">
            <li>
              <b>Оролцох:</b> тэмцээн нээлттэй үед хураамжаа төлөөд хүссэн цагтаа эхэлнэ.
            </li>
            <li>
              <b>Бодлого:</b> 5 шаттай, шат бүр 20 бодлоготой. Шат ахих тусам хэцүүрнэ. Бодлого бүрт 5 секунд.
            </li>
            <li>
              <b>Ялагч:</b> нийт 100 оролдлого дуусахад тэмцээн хаагдаж, хамгийн өндөр оноотой хүн
              ялна. Шагналыг урьдчилж зарлана.
            </li>
          </ul>
          <div className="actions">
            <Link href="/practice" className="btn">
              20 бодлогоор туршиж үзэх
            </Link>
          </div>
        </div>

        <aside className="board" aria-labelledby="board-title">
          <h2 id="board-title">Тэргүүлэгчид</h2>
          <p className="meta">Одоо явагдаж буй тэмцээн</p>
          <div className="empty">
            <p>Одоогоор нээлттэй тэмцээн алга.</p>
            <p className="meta">
              Тэмцээн нээгдэхэд оролцогчдын хамгийн сайн оноо энд харагдана. Тэр болтол үнэгүй
              туршилтаар дасгал хий.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
