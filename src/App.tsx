import "./App.css";
import ProdView from "./components/ProdView";
import DevPanel from "./components/DevPanel";

function getViewFromUrl(): "prod" | "dev" {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  return viewParam === "dev" ? "dev" : "prod";
}

export default function App() {
  const view = getViewFromUrl();

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="p-4 border-b border-neutral-800">
        <h1 className="text-xl font-bold">pop33 miniapp</h1>
      </header>

      {view === "dev" ? <DevPanel /> : <ProdView />}
    </div>
  );
}
