// Single-file preview of the site for people without Node: the real pages,
// with the game server running in the browser (see mock.ts).

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import Practice from "../app/practice/page";
import Profile from "../app/profile/page";
import Wallet from "../app/wallet/page";
import Play from "../app/play/page";
import Competition from "../app/competition/page";
import Competitions from "../app/competitions/page";
import { installMockServer } from "./mock";

installMockServer();

function App() {
  const read = () => location.hash.slice(1).split("?")[0];
  const [route, setRoute] = useState(read());
  const [query, setQuery] = useState(location.hash.split("?")[1] ?? "");
  useEffect(() => {
    const on = () => {
      setRoute(read());
      setQuery(location.hash.split("?")[1] ?? "");
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  if (route === "practice") return <Practice />;
  if (route === "profile") return <Profile />;
  if (route === "wallet") return <Wallet />;
  if (route === "play") return <Play />;
  // key: a different competition id mounts a fresh page.
  if (route === "competition" || route === "leaderboard") return <Competition key={query} />;
  if (route === "competitions") return <Competitions />;
  return <Home />;
}

createRoot(document.getElementById("root")!).render(<App />);
