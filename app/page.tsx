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
import Cropper from "react-easy-crop";
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
  const [deletePassword, setDeletePassword] = useState("");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const [comments, setComments] = useState<any[]>([]);
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentBody, setCommentBody] = useState("");

  const [pvRanking, setPvRanking] = useState<any[]>([]);

  const [nowTime, setNowTime] = useState(Date.now());

  const [cellNotice, setCellNotice] = useState("");
  const [cellNoticeCell, setCellNoticeCell] = useState<any | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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

  function showCellNotice(cell: any) {
    const name = cell.author?.trim() || "名無し";

    setCellNotice(
      `${name}さんが（${cell.x}.${cell.y}）のセルを埋めました！`
    );

    setCellNoticeCell(cell);

    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    noticeTimerRef.current = setTimeout(() => {
      setCellNotice("");
      setCellNoticeCell(null);
    }, 5000);
  }

  useEffect(() => {
    fetchCells();
    fetchPvRanking();

    const cellsChannel = supabase
      .channel("cells")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cells" },
        (payload: any) => {
          fetchCells();
          fetchPvRanking();

          if (payload.eventType === "INSERT") {
            showCellNotice(payload.new);
          }
        }
      )
      .subscribe();

    const viewsChannel = supabase
      .channel("cell_views")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cell_views" },
        () => {
          fetchPvRanking();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(cellsChannel);
      supabase.removeChannel(viewsChannel);
    };
  }, []);

  useEffect(() => {
    fitBoard();
    window.addEventListener("resize", fitBoard);

    return () => {
      window.removeEventListener("resize", fitBoard);
    };
  }, []);

  useEffect(() => {
    if (!selectedCell?.id) {
      setComments([]);
      return;
    }

    fetchComments(selectedCell.id);
  }, [selectedCell?.id]);
  
  useEffect(() => {
    deleteExpiredCells();

    const deleteTimer = setInterval(() => {
      deleteExpiredCells();
    }, 1000);

    const clockTimer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);

    return () => {
      clearInterval(deleteTimer);
      clearInterval(clockTimer);
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

  function isPcLayout() {
    return typeof window !== "undefined" && window.innerWidth >= 768;
  }
  
  function clampPosition(nextX: number, nextY: number, nextScale = scale) {
    if (!containerRef.current) {
      return { x: nextX, y: nextY };
    }

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;

    const visualSize = boardSize * nextScale;

    const baseMaxX = Math.max((visualSize - cw) / 2, 0);
    const baseMaxY = Math.max((visualSize - ch) / 2, 0);

    const rankingWidth = isPcLayout() && visualSize > cw ? 280 : 0;

    const minX = -baseMaxX - rankingWidth;
    const maxX = baseMaxX;

    return {
      x: Math.min(Math.max(nextX, minX), maxX),
      y: Math.min(Math.max(nextY, -baseMaxY), baseMaxY),
    };
  }

  async function fetchCells() {
    const { data } = await supabase.from("cells").select("*");
    setCells(data || []);
  }
  
  async function deleteExpiredCells() {
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("cells")
      .delete()
      .lt("expires_at", now);

    if (error) {
      console.error(error);
      return;
    }

    fetchCells();
    fetchPvRanking();
  }

  function parseExpiresAt(expiresAt: string) {
    if (expiresAt.endsWith("Z")) {
      return new Date(expiresAt).getTime();
    }

    return new Date(expiresAt + "Z").getTime();
  }
  
  function formatRemaining(expiresAt: string | null) {
    if (!expiresAt) return "期限なし";

    const diff = parseExpiresAt(expiresAt) - nowTime;

    if (diff <= 0) return "期限切れ";

    const minutes = Math.floor(diff / 1000 / 60);
    const seconds = Math.floor((diff / 1000) % 60);

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  async function fetchPvRanking() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("cell_views")
      .select("cell_id, cells(*)")
      .gte("created_at", since);

    if (error) {
      console.error(error);
      return;
    }

    const map: any = {};

    data?.forEach((view: any) => {
      const cell = view.cells;
      if (!cell) return;

      if (!map[view.cell_id]) {
        map[view.cell_id] = {
          cell,
          count: 0,
        };
      }

      map[view.cell_id].count += 1;
    });

    const ranking = Object.values(map)
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 20);

    setPvRanking(ranking);
  }

  async function fetchComments(cellId: string) {
    const { data } = await supabase
      .from("comments")
      .select("*")
      .eq("cell_id", cellId)
      .order("created_at", { ascending: true })
      .limit(100);

    setComments(data || []);
  }

  function getViewerId() {
  let viewerId = localStorage.getItem("appicel_viewer_id");

  if (!viewerId) {
    viewerId = crypto.randomUUID();
    localStorage.setItem("appicel_viewer_id", viewerId);
  }

    return viewerId;
  }
  
    async function recordView(cellId: string) {
    const viewerId = getViewerId();

    const oneHourAgo = new Date(
      Date.now() - 60 * 60 * 1000
    ).toISOString();

    const { data: existing } = await supabase
      .from("cell_views")
      .select("id")
      .eq("cell_id", cellId)
      .eq("viewer_id", viewerId)
      .gte("created_at", oneHourAgo)
      .limit(1);

    if (existing && existing.length > 0) {
      return;
    }

    await supabase
      .from("cell_views")
      .insert([
        {
          cell_id: cellId,
          viewer_id: viewerId,
        }
      ]);

    fetchPvRanking();
  }

  async function adminDeleteCell(cell: any) {
    const adminKey = window.prompt("管理者パスワードを入力してください");

    if (!adminKey) return;

    const ok = window.confirm(
      `本当に（${cell.x},${cell.y}）のセルを削除しますか？`
    );

    if (!ok) return;

    const response = await fetch("/api/admin-delete-cell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cellId: cell.id,
        adminKey,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "削除できませんでした");
      return;
    }

    setSelectedCell(null);
    setComments([]);
    fetchCells();
    fetchPvRanking();

    alert("セルを削除しました");
  }
  
  async function userDeleteCell(cell: any) {
    const inputPassword = window.prompt("削除用パスワードを入力してください");

    if (!inputPassword) return;

    const ok = window.confirm(
      `本当に（${cell.x},${cell.y}）のセルを削除しますか？`
    );

    if (!ok) return;

    const response = await fetch("/api/user-delete-cell", {
      method: "POST",
      headers: {
      "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cellId: cell.id,
        deletePassword: inputPassword,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "削除できませんでした");
      return;
    }

    setSelectedCell(null);
    setComments([]);
    fetchCells();
    fetchPvRanking();

   alert("セルを削除しました");
  }

  async function openCell(cell: any) {
    setSelectedCell(cell);
    recordView(cell.id);
  }

  async function saveComment() {
    if (!selectedCell) return;

    const body = commentBody.trim();

    if (!body) {
      alert("本文を入力してください");
      return;
    }

    if (comments.length >= 100) {
      alert("コメントは最大100件までです");
      return;
    }

    const finalAuthor = commentAuthor.trim() || "名無し";

    const { error } = await supabase
      .from("comments")
      .insert([
        {
          cell_id: selectedCell.id,
          author: finalAuthor.slice(0, 10),
          body: body.slice(0, 150),
        }
      ]);

    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    setCommentAuthor("");
    setCommentBody("");
    fetchComments(selectedCell.id);
  }

  function getCell(x: number, y: number) {
    return cells.find((cell) => cell.x === x && cell.y === y);
  }

  async function handleCellClick(x: number, y: number) {
    if (dragRef.current.isDragging) return;

    const existing = getCell(x, y);

    if (existing) {
      openCell(existing);
      return;
    }

    setCreateCell({ x, y });
  }

  async function saveCell() {
    if (!createCell) return;

    const finalTitle = title.trim();
    const finalAuthor = author.trim() || "名無し";
    const finalDescription = description.trim();

    if (!finalTitle) {
      alert("タイトルを入力してください");
      return;
    }

    if (!imageFile || !imagePreview || !croppedAreaPixels) {
      alert("画像を選択してください");
      return;
    }

    let imageUrl = null;
    let originalImageUrlState = null;

    const originalFileName = `${Date.now()}-original-${imageFile.name}`;

    const { error: originalError } = await supabase.storage
      .from("cell-images")
      .upload(originalFileName, imageFile);

    if (originalError) {
      console.error(originalError);
      alert(originalError.message);
      return;
    }

    const { data: originalData } = supabase.storage
      .from("cell-images")
      .getPublicUrl(originalFileName);

    originalImageUrlState = originalData.publicUrl;

    const croppedBlob = await getCroppedImage(
      imagePreview,
      croppedAreaPixels
    );

    const croppedFileName = `${Date.now()}-cropped.jpg`;

    const { error: croppedError } = await supabase.storage
      .from("cell-images")
      .upload(croppedFileName, croppedBlob);

    if (croppedError) {
      console.error(croppedError);
      alert(croppedError.message);
      return;
    }

    const { data: croppedData } = supabase.storage
      .from("cell-images")
      .getPublicUrl(croppedFileName);

    imageUrl = croppedData.publicUrl;

    const response = await fetch("/api/create-cell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        x: createCell.x,
        y: createCell.y,
        title: finalTitle,
        author: finalAuthor,
        description: finalDescription,
       link_type: linkType,
        link_url: linkUrl,
        image_url: imageUrl,
        original_image_url: originalImageUrlState,
        deletePassword: deletePassword.trim(),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "投稿に失敗しました");
      return;
    }

    setCreateCell(null);
    setTitle("");
    setAuthor("");
    setLinkType("other");
    setLinkUrl("");
    setDescription("");
    setDeletePassword("");
    setImageFile(null);
    setImagePreview("");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);

    fetchCells();
    fetchPvRanking();
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
    <main className="min-h-screen md:h-screen bg-black text-white overflow-y-auto md:overflow-hidden">
      <h1 className="text-4xl font-bold text-center h-[70px] flex items-center justify-center">
        Appicel
      </h1>
      
      <div className="h-10 flex items-center justify-center">
        {cellNotice && (
          <button
            onClick={() => {
              if (cellNoticeCell) {
                openCell(cellNoticeCell);
              }
            }}
            className="px-4 py-2 rounded-full bg-green-500/20 border border-green-400 text-green-300 text-sm font-bold animate-bounce hover:bg-green-500/30"
          >
            {cellNotice}
          </button>
        )}
      </div>

      <div className="md:relative md:h-[calc(100vh-110px)] flex flex-col md:block overflow-visible md:overflow-hidden">
        <div
          ref={containerRef}
          className="h-[68vh] md:h-full w-full flex items-center justify-center overflow-hidden touch-none"
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

        <aside className="h-auto md:h-full md:w-64 md:absolute md:right-0 md:top-0 border-t md:border-t-0 md:border-l border-gray-800 bg-zinc-950 p-3 pb-24 md:pb-3 overflow-visible md:overflow-y-auto">
          <h2 className="text-sm font-bold mb-3 text-center">
            24時間閲覧ランキング(TOP20)
          </h2>

          {pvRanking.length === 0 ? (
            <p className="text-xs text-gray-500 text-center">
              まだ閲覧がありません
            </p>
          ) : (
            <div className="space-y-2">
              {pvRanking.map((item: any, index: number) => (
                <button
                  key={item.cell.id}
                  onClick={() => openCell(item.cell)}
                  className="w-full text-left bg-zinc-900 hover:bg-zinc-800 p-2 rounded text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-bold text-sm">
                      #{index + 1}
                    </span>

                    <span className="text-gray-400 text-xs">
                      ({item.cell.x},{item.cell.y}) / {item.count}PV
                    </span>
                  </div>

                  <div className="truncate mt-1">
                    {item.cell.title}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {selectedCell && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] max-w-[90vw] max-h-[90vh] overflow-y-auto border border-gray-700">
            <button
              onClick={() => {
                setSelectedCell(null);
                setComments([]);
                setCommentAuthor("");
                setCommentBody("");
              }}
              className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
            >
              ×
            </button>

            <p className="text-[11px] text-gray-500 text-center mb-2">
              {selectedCell.x}.{selectedCell.y}
            </p>

            <div className="absolute top-3 left-4 text-[11px] text-gray-400">
              残り {formatRemaining(selectedCell.expires_at)}
            </div>
            
            <h2 className="text-2xl font-bold mb-2">{selectedCell.title}</h2>

            {selectedCell.author && (
              <p className="text-sm text-gray-400 mb-4">
                投稿者：{selectedCell.author}
              </p>
            )}

            {selectedCell.image_url && (
              <img
                src={selectedCell.original_image_url || selectedCell.image_url}
                alt={selectedCell.title}
                className="w-full max-h-[60vh] object-contain rounded-lg mb-6"
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
            
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-lg font-bold mb-3">
                コメント {comments.length}/100
              </h3>

              <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="bg-zinc-800 p-3 rounded"
                  >
                    <div className="text-sm text-gray-400 mb-1">
                      {comment.author || "名無し"}
                    </div>

                    <div className="text-sm whitespace-pre-wrap">
                      {comment.body}
                    </div>
                  </div>
                ))}
              </div>

              <input
                value={commentAuthor}
                onChange={(e) => setCommentAuthor(e.target.value)}
                maxLength={10}
                placeholder="名前（10文字まで・未入力なら名無し）"
                className="w-full p-2 mb-2 bg-zinc-800 text-white placeholder-gray-400 rounded"
              />

              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                maxLength={150}
                placeholder="コメント本文（150文字まで）"
                className="w-full p-2 mb-2 bg-zinc-800 text-white placeholder-gray-400 rounded"
              />

              <div className="flex items-center justify-between">
               <button
                 onClick={saveComment}
                 className="bg-white text-black px-4 py-2 rounded"
               >
                 コメント投稿
               </button>

               <div className="flex items-center gap-3">
                 {selectedCell.has_delete_password && (
                   <button
                     onClick={() => userDeleteCell(selectedCell)}
                     className="text-[11px] text-blue-300/80 hover:text-blue-300"
                   >
                     投稿者削除
                   </button>
                 )}

                <button
                  onClick={() => adminDeleteCell(selectedCell)}
                  className="text-[11px] text-blue-500/60 hover:text-blue-400"
                >
                  管理者削除
                </button>
              </div>
             </div>
           </div>
          </div>
        </div>
      )}

      {createCell && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="relative bg-zinc-900 p-6 rounded-xl w-[400px] max-w-[90vw] max-h-[90vh] overflow-y-auto border border-gray-700">
            <button
              onClick={() => {
                setCreateCell(null);
                setTitle("");
                setAuthor("");
                setLinkType("other");
                setLinkUrl("");
                setDescription("");
                setDeletePassword("");
                setImageFile(null);
                setImagePreview("");
                setCrop({ x: 0, y: 0 });
                setZoom(1);
                setCroppedAreaPixels(null);
              }}
              className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-white"
            >
              ×
            </button>

            <p className="text-[11px] text-gray-500 text-center mb-2">
              {createCell.x}.{createCell.y}
            </p>

            <h2 className="text-xl mb-4">新規投稿</h2>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={15}
              placeholder="タイトル（15文字まで・必須）"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={10}
              placeholder="投稿者名（10文字まで・空欄なら名無し）"
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
              maxLength={200}
              placeholder="本文（200文字まで）"
              className="w-full p-2 mb-3 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              maxLength={50}
              placeholder="削除用パスワード（任意・4文字以上）"
              className="w-full p-2 mb-2 bg-zinc-800 text-white placeholder-gray-400 rounded"
            />

            <p className="text-[11px] text-gray-500 mb-3">
              設定した場合のみ、期限前に自分で削除できます。
            </p>

            <label className="block w-full mb-4 cursor-pointer">
              <div className="bg-blue-600 hover:bg-blue-500 text-white text-center py-3 rounded font-bold">
                画像を選択
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];

                  if (!file) return;

                  setImageFile(file);
                  setImagePreview(URL.createObjectURL(file));
                  setCrop({ x: 0, y: 0 });
                  setZoom(1);
                  setCroppedAreaPixels(null);
                }}
                className="hidden"
              />
            </label>

            {imageFile && (
              <p className="text-sm text-gray-400 mb-4">
                選択中：{imageFile.name}
              </p>
            )}

            {imagePreview && (
              <div className="mb-4">
                <div className="h-[300px] relative mb-3 bg-black rounded overflow-hidden">
                  <Cropper
                    image={imagePreview}
                    crop={crop}
                    zoom={zoom}
                    minZoom={0.5}
                    maxZoom={4}
                    aspect={1}
                    restrictPosition={false}
                    objectFit="contain"
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_, pixels) =>
                      setCroppedAreaPixels(pixels)
                    }
                  />
                </div>

                <div className="mb-2">
                  <p className="text-xs text-gray-400 mb-1">
                    画像サイズ調整
                  </p>

                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.01}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            )}

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

async function getCroppedImage(
  imageSrc: string,
  crop: any
): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = imageSrc;

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Canvas error");

  const cropX = Math.round(crop.x);
  const cropY = Math.round(crop.y);
  const cropWidth = Math.round(crop.width);
  const cropHeight = Math.round(crop.height);

  canvas.width = cropWidth;
  canvas.height = cropHeight;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, cropWidth, cropHeight);

  const sourceX = Math.max(cropX, 0);
  const sourceY = Math.max(cropY, 0);
  const sourceRight = Math.min(
    cropX + cropWidth,
    image.naturalWidth
  );
  const sourceBottom = Math.min(
    cropY + cropHeight,
    image.naturalHeight
  );

  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;

  const destX = sourceX - cropX;
  const destY = sourceY - cropY;

  if (sourceWidth > 0 && sourceHeight > 0) {
    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      destX,
      destY,
      sourceWidth,
      sourceHeight
    );
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) throw new Error("Blob error");
      resolve(blob);
    }, "image/jpeg");
  });
}