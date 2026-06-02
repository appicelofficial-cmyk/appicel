"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;

export default function Home() {

  const [cells, setCells] = useState<any[]>([]);
  const [selectedCell, setSelectedCell] = useState<any | null>(null);

  const [createCell, setCreateCell] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

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

    if (existing) {

      setSelectedCell(existing);
      return;

    }

    setCreateCell({ x, y });

  }

  async function saveCell() {

    if (!createCell) return;

    await supabase
      .from("cells")
      .insert([
        {
          x: createCell.x,
          y: createCell.y,
          title,
          description,
          image_url: imageUrl || null,
        }
      ]);

    setCreateCell(null);
    setTitle("");
    setDescription("");
    setImageUrl("");

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

         <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] border border-gray-700">

            <button
             onClick={() => setSelectedCell(null)}
             className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
            >
             ×
            </button>
            
            <h2 className="text-2xl font-bold mb-4">
              {selectedCell.title}
            </h2>

            <p className="text-gray-300 whitespace-pre-wrap mb-6">
              {selectedCell.description}
            </p>

            {selectedCell.image_url && (
              <img
                src={selectedCell.image_url}
                alt={selectedCell.title}
                className="w-full rounded-lg mb-6"
              />
            )}

            <button
              onClick={() => setSelectedCell(null)}
              className="bg-white text-black px-4 py-2 rounded"
            >
              閉じる
            </button>

          </div>

        </div>
      )}

      {createCell && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">

          <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] border border-gray-700">

           <button
            onClick={() => {
            setCreateCell(null);
            setTitle("");
            setDescription("");
            setImageUrl("");
          }}
         className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
       >
         ×
       </button>
           
            <h2 className="text-xl mb-4">
              新規投稿
            </h2>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タイトル"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="本文"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="画像URL"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <button
              onClick={saveCell}
              className="bg-white text-black px-4 py-2 rounded"
            >
              保存
            </button>

          </div>

        </div>
      )}

    </main>
  );
}