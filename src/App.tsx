import { ArchivePage } from "./pages/ArchivePage";
import React from "react";
import "./App.css";
import { HashRouter, Routes, Route } from "react-router-dom";
import Pop33Landing from "./pages/Pop33Landing";
import Pop33Demo from "./pages/Pop33Demo";
import DemoV1Page from "./pages/DemoV1Page";
import DemoV1ArchivePage from "./pages/DemoV1ArchivePage";

export default function App() {
  return (
    <div className="app-bg bg-gradient-animate crt-noise">
      <HashRouter>
        <Routes>
          {/* Landing jako pierwszy kontakt */}
          <Route path="/" element={<Pop33Landing />} />

          {/* DEMO i Archiwum jako hash-routes (bez 404 od Vercel) */}
          <Route path="/demo" element={<Pop33Demo />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/demo-v1" element={<DemoV1Page />} />
          <Route path="/archive-v1" element={<DemoV1ArchivePage />} />

          {/* Catch-all: wracamy na landing */}
          <Route path="*" element={<Pop33Landing />} />
        </Routes>
      </HashRouter>
    </div>
  );
}
