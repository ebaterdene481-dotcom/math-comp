// Single-file preview of the site for people without Node: the real pages,
// with the game server running in the browser (see mock.ts).

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import Practice from "../app/practice/page";
import { installMockServer } from "./mock";

installMockServer();

function App() {
  const [route, setRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => {
      setRoute(location.hash.slice(1));
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route === "practice" ? <Practice /> : <Home />;
}

createRoot(document.getElementById("root")!).render(<App />);
