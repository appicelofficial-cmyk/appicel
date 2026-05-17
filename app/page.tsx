"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;

export default function Home() {

  const [cells, setCells] = useState<any[]>([]);

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

    await supabase
      .from("cells")
      .insert([{ x, y }]);

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

    </main>
  );
}