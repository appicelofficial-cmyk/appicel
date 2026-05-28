"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;

export default function Home() {

  const [cells, setCells] = useState<any[]>([]);

  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [title, setTitle] = useState("");

  useEffect(() => {

    fetchCells();

    const channel = supabase
      .channel("cells")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cells",
        },
        () => {
          fetchCells();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, []);

  async function fetchCells() {

    const { data } = await supabase
      .from("cells")
      .select("*");

    setCells(data || []);

  }

  async function saveCell() {

    if (!selectedCell) return;

    await supabase
      .from("cells")
      .insert([
        {
          x: selectedCell.x,
          y: selectedCell.y,
          title,
        }
      ]);

    setSelectedCell(null);
    setTitle("");

  }

function getCell(x: number, y: number) {
  return cells.find(
    cell => cell.x === x && cell.y === y
  );
}

  function isFilled(x: number, y: number) {
    return cells.some(cell => cell.x === x && cell.y === y);
  }

  const grid = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {

      const filled = isFilled(x, y);

      grid.push(
        <div
          key={`${x}-${y}`}
onClick={() => {

  const existingCell = getCell(x, y);

  setSelectedCell({ x, y });

  if (existingCell) {
    setTitle(existingCell.title || "");
  } else {
    setTitle("");
  }

}}

  return (
    <main className="min-h-screen bg-black text-white">

      <h1 className="text-5xl font-bold text-center pt-10 pb-8">
        Appicel
      </h1>

      <div className="flex justify-center overflow-auto p-4">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, 64px)`
          }}
        >
          {grid}
        </div>
      </div>

      {selectedCell && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center">

          <div className="bg-white text-black p-6 rounded w-80">

            <h2 className="text-2xl mb-4">
              {selectedCell.x}.{selectedCell.y}
            </h2>

            <input
              type="text"
              placeholder="タイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border p-2 mb-4"
            />

            <button
              onClick={saveCell}
              className="w-full bg-black text-white p-2 rounded"
            >
              保存
            </button>

          </div>

        </div>
      )}

    </main>
  );
}