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
            Хурдан, зөв бодсон хүн ялна. Хариугаа бичээд Enter дар. Хэдий хурдан хариулна, төдий
            их оноо авна.
          </p>
          <ul className="rules">
            <li>
              <b>100</b>0.5 секундээс хурдан зөв хариулбал бүтэн 100 оноо
            </li>
            <li>
              <b>0</b>5 секунд дуусвал оноогүй, дараагийн бодлого гарна
            </li>
            <li>
              <b>↺</b>Буруу бол дахин бич, гэхдээ цаг зогсохгүй
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
