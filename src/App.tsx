// src/App.tsx
import { ArchivePage } from "./pages/ArchivePage";
import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Pop33Landing from "./pages/Pop33Landing";
import Pop33Demo from "./pages/Pop33Demo";

export default function App() {
  console.log("ENV FRONTEND:", import.meta.env);
  return (
    <div className="app-bg bg-gradient-animate scanlines crt-noise">
      <BrowserRouter>
        <Routes>
          {/* Strona główna - landing POP33 DEMO */}
          <Route path="/" element={<Pop33Landing />} />

          {/* Strona DEMO - Twój dotychczasowy widok Dev/Prod */}
          <Route path="/demo" element={<Pop33Demo />} />
          <Route path="/archive" element={<ArchivePage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
