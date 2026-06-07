"use client";

import { useEffect, useRef, useState } from "react";
import {
  FaXTwitter,
  FaInstagram,
  FaFacebook,
  FaTiktok,
  FaYoutube,
  FaLink
} from "react-icons/fa6";

import { SiLine } from "react-icons/si";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;
const CELL_SIZE = 24;
const GAP_SIZE = 2;

export default function Home() {
  const [cells, setCells] = useState<any[]>([]);
  const [selectedCell, setSelectedCell] = useState<any | null>(null);
  const [createCell, setCreateCell] = useState<{ x: number; y: number } | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [linkType, setLinkType] = useState("other");
  const [linkUrl, setLinkUrl] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const boardSize = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * GAP_SIZE;

  function LinkIcon(type: string) {

  switch (type) {

    case "x":
      return <FaXTwitter size={28} />;

    case "instagram":
      return <FaInstagram size={28} />;

    case "facebook":
      return <FaFacebook size={28} />;

    case "tiktok":
      return <FaTiktok size={28} />;

    case "line":
      return <SiLine size={28} />;

    case "youtube":
      return <FaYoutube size={28} />;

    default:
      return <FaLink size={28} />;

  }

}
  
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

  useEffect(() => {
    fitBoard();
    window.addEventListener("resize", fitBoard);

    return () => {
      window.removeEventListener("resize", fitBoard);
    };
  }, []);

  function fitBoard() {
    if (!containerRef.current) return;

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;

    const nextScale = Math.min(cw / boardSize, ch / boardSize) * 0.96;

    setScale(nextScale);
    setPosition({ x: 0, y: 0 });
  }

  function clampPosition(nextX: number, nextY: number, nextScale = scale) {
    if (!containerRef.current) {
      return { x: nextX, y: nextY };
    }

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;

    const visualSize = boardSize * nextScale;

    const maxX = Math.max((visualSize - cw) / 2, 0);
    const maxY = Math.max((visualSize - ch) / 2, 0);

    return {
      x: Math.min(Math.max(nextX, -maxX), maxX),
      y: Math.min(Math.max(nextY, -maxY), maxY),
    };
  }

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
        author,
        description,
        link_type: linkType,
        link_url: linkUrl,
        image_url: imageUrl,
      },
    ]);

    setCreateCell(null);
    setTitle("");
    setAuthor("");
    setLinkType("other");
    setLinkUrl("");
    setDescription("");
    setImageFile(null);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();

    const nextScale = Math.min(Math.max(scale - e.deltaY * 0.001, 0.25), 4);
    const fixed = clampPosition(position.x, position.y, nextScale);

    setScale(nextScale);
    setPosition(fixed);
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

    const fixed = clampPosition(
      dragRef.current.lastX + dx,
      dragRef.current.lastY + dy
    );

    setPosition(fixed);
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
        Math.max((distance / pinchRef.current.distance) * pinchRef.current.scale, 0.25),
        4
      );

      const fixed = clampPosition(position.x, position.y, nextScale);

      setScale(nextScale);
      setPosition(fixed);
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
          className="border border-gray-700 cursor-pointer overflow-hidden bg-black hover:opacity-80"
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
    <main className="h-screen bg-black text-white overflow-hidden">
      <h1 className="text-4xl font-bold text-center h-[70px] flex items-center justify-center">
        Appicel
      </h1>

      <div
        ref={containerRef}
        className="w-screen h-[calc(100vh-70px)] flex items-center justify-center overflow-hidden touch-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <div
          className="grid"
          style={{
            width: boardSize,
            height: boardSize,
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
          <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] max-w-[90vw] border border-gray-700">
            <button
              onClick={() => setSelectedCell(null)}
              className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
            >
              ×
            </button>

            <h2 className="text-2xl font-bold mb-2">{selectedCell.title}</h2>

            {selectedCell.author && (
              <p className="text-sm text-gray-400 mb-4">
                投稿者：{selectedCell.author}
              </p>
            )}

            {selectedCell.image_url && (
              <img
                src={selectedCell.image_url}
                alt={selectedCell.title}
                className="w-full rounded-lg mb-6"
              />
            )}

            {selectedCell.link_url && (

  <a
    href={selectedCell.link_url}
    target="_blank"
    rel="noreferrer"
    className="
      inline-flex
      items-center
      justify-center
      w-12
      h-12
      rounded-full
      bg-zinc-800
      hover:bg-zinc-700
      mb-4
    "
  >
    {LinkIcon(selectedCell.link_type)}
  </a>

)}
            
            <p className="text-gray-300 whitespace-pre-wrap mb-6">
              {selectedCell.description}
            </p>
          </div>
        </div>
      )}

      {createCell && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] max-w-[90vw] border border-gray-700">
            <button
              onClick={() => {
                setCreateCell(null);
                setTitle("");
                setAuthor("");
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

            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="投稿者名"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              className="w-full p-2 mb-3 bg-zinc-800 text-white rounded"
             >
              <option value="x">X</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="tiktok">TikTok</option>
              <option value="line">LINE</option>
              <option value="youtube">YouTube</option>
              <option value="other">Other</option>
            </select>

            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="リンクURL"
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