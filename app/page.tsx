"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;

export default function Home() {

  const [cells, setCells] = useState<any[]>([]);
  const [selectedCell, setSelectedCell] = useState<any | null>(null);

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

  async function handleCellClick(x: number, y: number) {

    const existing = cells.find(
      cell => cell.x === x && cell.y === y
    );

    // 既存セル
    if (existing) {

      setSelectedCell(existing);
      return;

    }

    // 新規作成
    const title = prompt("タイトルを入力");
    if (!title) return;

    const description = prompt("本文を入力");
    if (!description) return;

    await supabase
      .from("cells")
      .insert([
        {
          x,
          y,
          title,
          description,
        }
      ]);

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
          onClick={() => handleCellClick(x, y)}
          className={`
            w-16 h-16 border border-gray-700 cursor-pointer transition
            ${filled ? "bg-green-500" : "bg-black hover:bg-gray-800"}
          `}
        />
      );

    }
  }

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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">

          <div className="bg-zinc-900 p-6 rounded-xl w-[400px] border border-gray-700">

            <h2 className="text-2xl font-bold mb-4">
              {selectedCell.title}
            </h2>

            <p className="text-gray-300 whitespace-pre-wrap mb-6">
              {selectedCell.description}
            </p>

            <button
              onClick={() => setSelectedCell(null)}
              className="bg-white text-black px-4 py-2 rounded"
            >
              閉じる
            </button>

          </div>

        </div>
      )}

    </main>
  );
}