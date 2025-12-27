import { ArchivePage } from "./pages/ArchivePage";
import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Pop33Landing from "./pages/Pop33Landing";
import Pop33Demo from "./pages/Pop33Demo";

export default function App() {
  console.log("ENV FRONTEND:", import.meta.env);

  return (
    <div className="app-bg bg-gradient-animate crt-noise">
      <BrowserRouter>
        <Routes>
          {/* DEMO jako strona główna */}
          <Route path="/" element={<Pop33Demo />} />

          {/* Landing przeniesiony na /landing */}
          <Route path="/landing" element={<Pop33Landing />} />

          {/* Reszta */}
          <Route path="/archive" element={<ArchivePage />} />

          {/* Catch-all */}
          <Route path="*" element={<Pop33Demo />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
