// src/App.tsx

import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Pop33Landing from "./pages/Pop33Landing";
import Pop33Demo from "./pages/Pop33Demo";

export default function App() {
  return (
    <div className="app-bg bg-gradient-animate scanlines crt-noise">
      <BrowserRouter>
        <Routes>
          {/* Strona główna - landing POP33 DEMO */}
          <Route path="/" element={<Pop33Landing />} />

          {/* Strona DEMO - Twój dotychczasowy widok Dev/Prod */}
          <Route path="/demo" element={<Pop33Demo />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
