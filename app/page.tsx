"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;
const CELL_SIZE = 24;
const GAP_SIZE = 2;

export default function Home() {
  const [cells, setCells] = useState<any[]>([]);
  const [selectedCell, setSelectedCell] = useState<any | null>(null);

  const [createCell, setCreateCell] = useState<{ x: number; y: number } | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  const pinchRef = useRef({
    distance: 0,
    scale: 1,
  });

  useEffect(() => {
    fetchCells();

    const channel = supabase
      .channel("cells")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cells" },
        () => fetchCells()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchCells() {
    const { data } = await supabase.from("cells").select("*");
    setCells(data || []);
  }

  function getCell(x: number, y: number) {
    return cells.find((cell) => cell.x === x && cell.y === y);
  }

  async function handleCellClick(x: number, y: number) {
    if (dragRef.current.isDragging) return;

    const existing = getCell(x, y);

    if (existing) {
      setSelectedCell(existing);
      return;
    }

    setCreateCell({ x, y });
  }

  async function saveCell() {
    if (!createCell) return;

    let imageUrl = null;

    if (imageFile) {
      const fileName = `${Date.now()}-${imageFile.name}`;

      const { error } = await supabase.storage
        .from("cell-images")
        .upload(fileName, imageFile);

      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }

      const { data } = supabase.storage
        .from("cell-images")
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    await supabase.from("cells").insert([
      {
        x: createCell.x,
        y: createCell.y,
        title,
        description,
        image_url: imageUrl,
      },
    ]);

    setCreateCell(null);
    setTitle("");
    setDescription("");
    setImageFile(null);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();

    const nextScale = Math.min(
      Math.max(scale - e.deltaY * 0.001, 0.5),
      4
    );

    setScale(nextScale);
  }

  function handlePointerDown(e: React.PointerEvent) {
    dragRef.current = {
      isDragging: false,
      startX: e.clientX,
      startY: e.clientY,
      lastX: position.x,
      lastY: position.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.buttons !== 1) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragRef.current.isDragging = true;
    }

    setPosition({
      x: dragRef.current.lastX + dx,
      y: dragRef.current.lastY + dy,
    });
  }

  function getTouchDistance(touches: React.TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current.distance = getTouchDistance(e.touches);
      pinchRef.current.scale = scale;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();

      const distance = getTouchDistance(e.touches);
      const nextScale = Math.min(
        Math.max((distance / pinchRef.current.distance) * pinchRef.current.scale, 0.5),
        4
      );

      setScale(nextScale);
    }
  }

  const grid = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cellData = getCell(x, y);

      grid.push(
        <div
          key={`${x}-${y}`}
          onClick={() => handleCellClick(x, y)}
          className="
            border border-gray-700 cursor-pointer transition
            overflow-hidden bg-black hover:scale-105
          "
          style={{
            width: CELL_SIZE,
            height: CELL_SIZE,
          }}
        >
          {cellData?.image_url ? (
            <img
              src={cellData.image_url}
              alt={cellData.title}
              className="w-full h-full object-cover"
            />
          ) : cellData ? (
            <div className="w-full h-full bg-green-500" />
          ) : null}
        </div>
      );
    }
  }

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">

      <h1 className="text-4xl font-bold text-center pt-6 pb-4">
        Appicel
      </h1>

      <div
        className="w-screen h-[calc(100vh-100px)] flex items-center justify-center overflow-hidden touch-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <div
          className="grid"
          style={{
            gap: GAP_SIZE,
            gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center center",
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

            {selectedCell.image_url && (
              <img
                src={selectedCell.image_url}
                alt={selectedCell.title}
                className="w-full rounded-lg mb-6"
              />
            )}

            <p className="text-gray-300 whitespace-pre-wrap mb-6">
              {selectedCell.description}
            </p>

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
                setImageFile(null);
              }}
              className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
            >
              ×
            </button>

            <h2 className="text-xl mb-4">新規投稿</h2>

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
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (!e.target.files?.[0]) return;
                setImageFile(e.target.files[0]);
              }}
              className="w-full mb-4"
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