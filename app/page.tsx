"use client";

import { useEffect, useRef, useState } from "react";
import {
  FaXTwitter,
  FaInstagram,
  FaFacebook,
  FaTiktok,
  FaTwitch,
  FaYoutube,
  FaLink
} from "react-icons/fa6";
import { SiLine } from "react-icons/si";
import Cropper from "react-easy-crop";
import { supabase } from "../lib/supabase";

const GRID_SIZE = 32;
const CELL_SIZE = 24;
const GAP_SIZE = 2;

const PLANS = {
  normal_free_1d: {
    label: "リリース記念：通常1日無料",
    priceText: "無料",
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_1d: {
    label: "通常1日",
    priceText: "100円",
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_7d: {
    label: "通常7日",
    priceText: "600円",
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  normal_30d: {
    label: "通常30日",
    priceText: "2,500円",
    descriptionMax: 200,
    linkMax: 2,
    imageMax: 2,
  },
  premium_1d: {
    label: "プレミアム1日",
    priceText: "250円",
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
  premium_7d: {
    label: "プレミアム7日",
    priceText: "1,500円",
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
  premium_30d: {
    label: "プレミアム30日",
    priceText: "6,000円",
    descriptionMax: 500,
    linkMax: 5,
    imageMax: 5,
  },
} as const;

const LINK_TYPES = [
  { value: "x", label: "X" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitch", label: "Twitch" },
  { value: "line", label: "LINE" },
  { value: "youtube", label: "YouTube" },
  { value: "other", label: "Other" },
];

export default function Home() {
  const [cells, setCells] = useState<any[]>([]);
  const [selectedCell, setSelectedCell] = useState<any | null>(null);
  const [createCell, setCreateCell] = useState<{ x: number; y: number } | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [linkType, setLinkType] = useState("other");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState([
    {
      link_type: "other",
      link_url: "",
    },
  ]);

  const [selectedCellLinks, setSelectedCellLinks] = useState<any[]>([]);
  const [description, setDescription] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("normal_free_1d");
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [selectedCellImages, setSelectedCellImages] = useState<any[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [slidePosition, setSlidePosition] = useState(1);
  const [imageDragOffset, setImageDragOffset] = useState(0);
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [isSlideAnimating, setIsSlideAnimating] = useState(false);
  const [isImageNavVisible, setIsImageNavVisible] = useState(false);
  const [detailImageZoom, setDetailImageZoom] = useState(1);
  const [detailImagePan, setDetailImagePan] = useState({ x: 0, y: 0 });

  const detailImageAreaRef = useRef<HTMLDivElement | null>(null);

  const detailImagePanRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    isPanning: false,
  });
  const detailImagePinchRef = useRef({
    distance: 0,
    zoom: 1,
  });

  const imageDragRef = useRef({
    startX: 0,
    isDragging: false,
    moved: false,
  });
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
        return <FaXTwitter size={28} color="#ffffff" />;

      case "instagram":
        return <FaInstagram size={28} color="#E4405F" />;

      case "facebook":
        return <FaFacebook size={28} color="#1877F2" />;

      case "tiktok":
        return <FaTiktok size={28} color="#25F4EE" />;

      case "twitch":
        return <FaTwitch size={28} color="#9146FF" />;

      case "line":
        return <SiLine size={28} color="#06C755" />;

      case "youtube":
        return <FaYoutube size={28} color="#FF0000" />;

      default:
        return <FaLink size={28} color="#d4d4d8" />;
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
    setActiveImageIndex(0);
    setSlidePosition(1);
    setImageDragOffset(0);
    setIsSlideAnimating(false);
    setDetailImageZoom(1);
    
    if (!selectedCell?.id) {
      setComments([]);
      setSelectedCellLinks([]);
      setSelectedCellImages([]);
      return;
    }

    fetchComments(selectedCell.id);
    fetchCellLinks(selectedCell.id);
    fetchCellImages(selectedCell.id);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");

    if (payment === "success") {
      alert("決済が完了しました。セルを反映中です。");

      fetchCells();
      fetchPvRanking();

      setTimeout(() => {
        fetchCells();
        fetchPvRanking();
      }, 1500);

      setTimeout(() => {
        fetchCells();
        fetchPvRanking();
      }, 4000);

      window.history.replaceState({}, "", window.location.pathname);
    }

    if (payment === "cancel") {
      alert("決済がキャンセルされました。投稿はまだ完了していません。");
      window.history.replaceState({}, "", window.location.pathname);
    }
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

    const totalSeconds = Math.floor(diff / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
  
    return `${days}d ${hours}h ${minutes}m ${String(seconds).padStart(2, "0")}s`;
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
  
  async function fetchCellLinks(cellId: string) {
    const { data } = await supabase
      .from("cell_links")
      .select("*")
      .eq("cell_id", cellId)
      .order("sort_order", { ascending: true });

    setSelectedCellLinks(data || []);
  }

  async function fetchCellImages(cellId: string) {
    const { data } = await supabase
      .from("cell_images")
      .select("*")
      .eq("cell_id", cellId)
      .order("sort_order", { ascending: true });

    setSelectedCellImages(data || []);
  }
  
  function getDetailImages() {
    if (!selectedCell) return [];

    if (selectedCellImages.length > 0) {
      return selectedCellImages;
    }

    if (selectedCell.image_url) {
      return [
       {
          image_url: selectedCell.image_url,
          original_image_url:
            selectedCell.original_image_url || selectedCell.image_url,
        },
      ];
    }

    return [];
  }

  function getLoopImages() {
    const images = getDetailImages();

    if (images.length <= 1) {
      return images;
    }

    return [
      images[images.length - 1],
      ...images,
      images[0],
    ];
  }
  
  function resetDetailImageZoom() {
    setDetailImageZoom(1);
    resetDetailImagePan();
  }

  function clampDetailZoom(nextZoom: number) {
    return Math.min(Math.max(nextZoom, 1), 4);
  }

  function clampDetailPan(nextX: number, nextY: number, zoom = detailImageZoom) {
    if (!detailImageAreaRef.current || zoom <= 1) {
      return { x: 0, y: 0 };
    }

    const rect = detailImageAreaRef.current.getBoundingClientRect();

    const maxX = (rect.width * (zoom - 1)) / 2;
    const maxY = (rect.height * (zoom - 1)) / 2;

    return {
      x: Math.min(Math.max(nextX, -maxX), maxX),
      y: Math.min(Math.max(nextY, -maxY), maxY),
    };
  }

  function resetDetailImagePan() {
    setDetailImagePan({ x: 0, y: 0 });
  }
  
  function getDetailTouchDistance(touches: React.TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleDetailImageWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (getDetailImages().length === 0) return;

    e.preventDefault();

    const nextZoom = clampDetailZoom(
      detailImageZoom - e.deltaY * 0.001
    );

    setDetailImageZoom(nextZoom);

    if (nextZoom <= 1) {
      resetDetailImagePan();
    } else {
      setDetailImagePan((prev) =>
       clampDetailPan(prev.x, prev.y, nextZoom)
      );
    }

    setIsImageNavVisible(true);
  }

  function handleDetailImageTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 2) return;

    imageDragRef.current.isDragging = false;
    setIsImageDragging(false);
    setImageDragOffset(0);

    detailImagePinchRef.current = {
      distance: getDetailTouchDistance(e.touches),
      zoom: detailImageZoom,
    };

    setIsImageNavVisible(true);
  }

  function handleDetailImageTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 2) return;

    e.preventDefault();

    const distance = getDetailTouchDistance(e.touches);

    const nextZoom = clampDetailZoom(
      (distance / detailImagePinchRef.current.distance) *
        detailImagePinchRef.current.zoom
    );

    setDetailImageZoom(nextZoom);

    if (nextZoom <= 1) {
      resetDetailImagePan();
    } else {
      setDetailImagePan((prev) =>
        clampDetailPan(prev.x, prev.y, nextZoom)
      );
    }
  }
  
  function showPrevImage() {
    const images = getDetailImages();

    if (images.length <= 1) return;

    resetDetailImageZoom();
    setIsSlideAnimating(true);
    setSlidePosition((prev) => prev - 1);
    setActiveImageIndex((prev) =>
      prev === 0 ? images.length - 1 : prev - 1
    );

    setImageDragOffset(0);
    setIsImageNavVisible(true);
  }

  function showNextImage() {
    const images = getDetailImages();

    if (images.length <= 1) return;

    resetDetailImageZoom();
    setIsSlideAnimating(true);
    setSlidePosition((prev) => prev + 1);
    setActiveImageIndex((prev) =>
      prev === images.length - 1 ? 0 : prev + 1
    );

    setImageDragOffset(0);
    setIsImageNavVisible(true);
  }

  function handleSlideTransitionEnd() {
    const images = getDetailImages();

    if (images.length <= 1) return;

    if (slidePosition === images.length + 1) {
      setIsSlideAnimating(false);
      setSlidePosition(1);
    }

    if (slidePosition === 0) {
      setIsSlideAnimating(false);
      setSlidePosition(images.length);
    }
  }

  function handleImagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    if (target.closest("button")) return;

    if (detailImageZoom > 1) {
      detailImagePanRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: detailImagePan.x,
        lastY: detailImagePan.y,
        isPanning: true,
      };

      setIsImageNavVisible(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    imageDragRef.current = {
      startX: e.clientX,
      isDragging: true,
      moved: false,
    };

    setIsImageDragging(true);
    setIsSlideAnimating(false);
    setImageDragOffset(0);

    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (detailImagePanRef.current.isPanning) {
      e.preventDefault();

      const dx = e.clientX - detailImagePanRef.current.startX;
      const dy = e.clientY - detailImagePanRef.current.startY;

      const nextPan = clampDetailPan(
        detailImagePanRef.current.lastX + dx,
        detailImagePanRef.current.lastY + dy
      );

      setDetailImagePan(nextPan);
      return;
    }

    if (!imageDragRef.current.isDragging) return;

    const dx = e.clientX - imageDragRef.current.startX;

    if (Math.abs(dx) > 5) {
      imageDragRef.current.moved = true;
    }

    setImageDragOffset(dx);
  }

  function handleImagePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (detailImagePanRef.current.isPanning) {
      detailImagePanRef.current.isPanning = false;

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}

      return;
    }
    
    if (!imageDragRef.current.isDragging) return;

    const dx = e.clientX - imageDragRef.current.startX;
    const moved = imageDragRef.current.moved;

    imageDragRef.current.isDragging = false;
    setIsImageDragging(false);
    setImageDragOffset(0);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (Math.abs(dx) > 70) {
      if (dx < 0) {
        showNextImage();
      } else {
        showPrevImage();
      }

      return;
    }

    setIsSlideAnimating(true);
    setSlidePosition(activeImageIndex + 1);

    if (!moved) {
      setIsImageNavVisible((prev) => !prev);
    }
  }
  
  function updateLink(index: number, key: "link_type" | "link_url", value: string) {
    setLinks((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [key]: value,
      };
      return next;
    });
  }

  function addLinkInput() {
    const currentPlan = PLANS[selectedPlanId as keyof typeof PLANS];

    if (selectedPlanId !== "normal_free_1d") {
    alert("有料プランはStripe決済実装後に利用できます");
    return;
  }

  if (imageFiles.length === 0 || !imagePreviews[0] || !croppedAreaPixels) {
    alert("画像を選択してください");
    return;
  }

  if (imageFiles.length > currentPlan.imageMax) {
    alert(`画像は最大${currentPlan.imageMax}枚までです`);
    return;
  }

    setLinks((prev) => [
      ...prev,
      {
        link_type: "other",
        link_url: "",
      },
    ]);
  }

  function removeLinkInput(index: number) {
    setLinks((prev) => {
      if (prev.length <= 1) {
        return [
          {
            link_type: "other",
            link_url: "",
          },
        ];
      }

      return prev.filter((_, i) => i !== index);
    });
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

    if (selectedCell?.comments_enabled === false) {
      alert("このセルはコメント欄がオフです");
      return;
    }
    
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

    const currentPlan = PLANS[selectedPlanId as keyof typeof PLANS];

    const finalTitle = title.trim();
    const finalAuthor = author.trim() || "名無し";
    const finalDescription = description
      .trim()
      .slice(0, currentPlan.descriptionMax);

    if (!finalTitle) {
      alert("タイトルを入力してください");
      return;
    }

    if (imageFiles.length === 0 || !imagePreviews[0] || !croppedAreaPixels) {
      alert("画像を選択してください");
      return;
    }

    if (imageFiles.length > currentPlan.imageMax) {
      alert(`画像は最大${currentPlan.imageMax}枚までです`);
      return;
    }

    const uploadedImages: any[] = [];

    const firstFile = imageFiles[0];
    const firstPreview = imagePreviews[0];

    const originalFileName = `${Date.now()}-original-0-${firstFile.name}`;

    const { error: originalError } = await supabase.storage
      .from("cell-images")
      .upload(originalFileName, firstFile);

    if (originalError) {
      console.error(originalError);
      alert(originalError.message);
      return;
    }

    const { data: originalData } = supabase.storage
      .from("cell-images")
      .getPublicUrl(originalFileName);

    const originalImageUrlState = originalData.publicUrl;

    const croppedBlob = await getCroppedImage(
      firstPreview,
      croppedAreaPixels
    );

    const croppedFileName = `${Date.now()}-cropped-0.jpg`;

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

    const imageUrl = croppedData.publicUrl;

    uploadedImages.push({
      image_url: imageUrl,
      original_image_url: originalImageUrlState,
      sort_order: 0,
    });

    for (let i = 1; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const fileName = `${Date.now()}-original-${i}-${file.name}`;

      const { error } = await supabase.storage
        .from("cell-images")
        .upload(fileName, file);

      if (error) {
       console.error(error);
        alert(error.message);
        return;
      }

      const { data } = supabase.storage
        .from("cell-images")
        .getPublicUrl(fileName);

      uploadedImages.push({
        image_url: data.publicUrl,
        original_image_url: data.publicUrl,
        sort_order: i,
      });
    }

    const requestBody = {
      x: createCell.x,
      y: createCell.y,
      title: finalTitle,
      author: finalAuthor,
      description: finalDescription,
      link_type: links[0]?.link_type || "other",
      link_url: links[0]?.link_url?.trim() || "",
      image_url: uploadedImages[0].image_url,
      original_image_url: uploadedImages[0].original_image_url,
      images: uploadedImages,
      deletePassword: deletePassword.trim(),
      planId: selectedPlanId,
      viewerId: getViewerId(),
      commentsDisabled,
      links: links
        .map((link, index) => ({
          link_type: link.link_type,
          link_url: link.link_url.trim(),
          sort_order: index,
        }))
        .filter((link) => link.link_url),
    };

    const isFreePlan = selectedPlanId === "normal_free_1d";

    const response = await fetch(
      isFreePlan
        ? "/api/create-cell"
        : "/api/create-checkout-session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "投稿に失敗しました");
      return;
    }

    if (!isFreePlan) {
      if (!result.url) {
        alert("決済ページを開けませんでした");
        return;
      }

      window.location.href = result.url;
      return;
    }

    setCreateCell(null);
    setTitle("");
    setAuthor("");
    setLinkType("other");
    setLinkUrl("");
    setDescription("");
    setDeletePassword("");
    setSelectedPlanId("normal_free_1d");
    setCommentsDisabled(false);
    setImageFiles([]);
    setImagePreviews([]);
    setLinks([
      {
        link_type: "other",
        link_url: "",
      },
    ]);
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
      const isPremium = Boolean(cellData?.is_premium);

      grid.push(
        <div
          key={`${x}-${y}`}
          onClick={() => handleCellClick(x, y)}
          className={`
            cursor-pointer
            bg-black
            hover:opacity-80
            ${isPremium ? "premium-cell" : "border border-gray-700 overflow-hidden"}
          `}
          style={{
            width: CELL_SIZE,
            height: CELL_SIZE,
          }}
        >
          <div className={isPremium ? "premium-cell-inner" : "w-full h-full"}>
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
                setSelectedCellLinks([]);
                setSelectedCellImages([]);
                setComments([]);
                setCommentAuthor("");
                setCommentBody("");
              }}
              className="absolute top-3 right-3 z-50 w-10 h-10 flex items-center justify-center text-3xl leading-none text-gray-400 hover:text-white rounded-full cursor-pointer"
            >
              ×
            </button>

            <div className="relative h-5 mb-2">
              <div className="absolute left-0 top-0 text-[11px] text-gray-400">
                残り {formatRemaining(selectedCell.expires_at)}
              </div>

              <p className="text-[11px] text-gray-500 text-center">
                {selectedCell.x}.{selectedCell.y}
              </p>
            </div>
            
            <h2 className="text-2xl font-bold mb-2">{selectedCell.title}</h2>

            {selectedCell.author && (
              <p className="text-sm text-gray-400 mb-4">
                投稿者：{selectedCell.author}
              </p>
            )}

            {getDetailImages().length > 0 && (
              <div className="relative mb-6 select-none group">
                <div
                  ref={detailImageAreaRef}
                  onPointerDown={handleImagePointerDown}
                  onPointerMove={handleImagePointerMove}
                  onPointerUp={handleImagePointerUp}
                  onWheel={handleDetailImageWheel}
                  onTouchStart={handleDetailImageTouchStart}
                  onTouchMove={handleDetailImageTouchMove}
                  onPointerCancel={() => {
                    imageDragRef.current.isDragging = false;
                    detailImagePanRef.current.isPanning = false;
                    setIsImageDragging(false);
                    setImageDragOffset(0);
                  }}
                  className="relative overflow-hidden cursor-grab active:cursor-grabbing rounded-lg"
                  style={{
                    touchAction: detailImageZoom > 1 ? "none" : "pan-y",
                  }}
                >
                  <div
                    className="flex"
                    onTransitionEnd={handleSlideTransitionEnd}
                    style={{
                      transform:
                        getDetailImages().length > 1
                          ? `translateX(calc(${-slidePosition * 100}% + ${imageDragOffset}px))`
                          : `translateX(${imageDragOffset}px)`,
                      transition:
                        isImageDragging || !isSlideAnimating
                          ? "none"
                          : "transform 220ms ease",
                    }}
                  >
                    {getLoopImages().map((image: any, index: number) => (
                      <div
                        key={index}
                        className="w-full shrink-0 flex items-center justify-center"
                      >
                        <img
                          src={image.original_image_url || image.image_url}
                          alt={`${selectedCell.title}-${index + 1}`}
                          draggable={false}
                          style={{
                            transform:
                              index === slidePosition
                                ? `translate(${detailImagePan.x}px, ${detailImagePan.y}px) scale(${detailImageZoom})`
                                : "scale(1)",
                            transition:
                              detailImagePanRef.current.isPanning
                                ? "none"
                                : "transform 160ms ease",
                            transformOrigin: "center center",
                          }}
                          className="w-full max-h-[60vh] object-contain rounded-lg"
                        />
                      </div>
                    ))}
                  </div>

                  {getDetailImages().length > 1 && (
                    <>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          showPrevImage();
                        }}
                        className={`
                          absolute
                          left-2
                          top-1/2
                          -translate-y-1/2
                          w-10
                          h-10
                          rounded-full
                          bg-black/50
                          hover:bg-black/70
                          text-white
                          text-3xl
                          flex
                          items-center
                          justify-center
                          transition-opacity
                          ${isImageNavVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
                          md:opacity-0
                          md:pointer-events-none
                          md:group-hover:opacity-100
                          md:group-hover:pointer-events-auto
                        `}
                      >
                        ‹
                      </button>

                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          showNextImage();
                        }}
                        className={`
                        absolute
                        right-2
                        top-1/2
                        -translate-y-1/2
                        w-10
                        h-10
                        rounded-full
                        bg-black/50
                        hover:bg-black/70
                        text-white
                        text-3xl
                        flex
                        items-center
                        justify-center
                        transition-opacity
                        ${isImageNavVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
                        md:opacity-0
                        md:pointer-events-none
                        md:group-hover:opacity-100
                        md:group-hover:pointer-events-auto
                      `}
                    >
                      ›
                    </button>
                  </>
                )}
              </div>

              {getDetailImages().length > 1 && (
                <div className="flex justify-center gap-2 mt-3">
                  {getDetailImages().map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => {
                        resetDetailImageZoom();
                        setActiveImageIndex(index);
                        setSlidePosition(index + 1);
                        setIsSlideAnimating(true);
                      }}
                      className={`w-2 h-2 rounded-full ${
                        index === activeImageIndex
                          ? "bg-white"
                          : "bg-gray-600"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

            {(
              selectedCellLinks.length > 0
                ? selectedCellLinks
                : selectedCell.link_url
                ? [
                    {
                      link_type: selectedCell.link_type,
                      link_url: selectedCell.link_url,
                    },
                  ]
                : []
          ).length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {(
                selectedCellLinks.length > 0
                  ? selectedCellLinks
                  : selectedCell.link_url
                    ? [
                        {
                          link_type: selectedCell.link_type,
                          link_url: selectedCell.link_url,
                        },
                      ]
                    : []
              ).map((link: any, index: number) => (
                <a
                  key={index}
                  href={link.link_url}
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
                  "
                >
                  {LinkIcon(link.link_type)}
                </a>
              ))}
            </div>
          )}

            <p className="text-gray-300 whitespace-pre-wrap mb-6">
              {selectedCell.description}
            </p>
            
            {selectedCell.comments_enabled === false ? (
              <div className="border-t border-gray-700 pt-4 mt-4">
              <p className="text-sm text-gray-500 text-center">
                コメント欄はオフです
              </p>
            </div>
          ) : (
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

              <button
                onClick={saveComment}
                className="bg-white text-black px-4 py-2 rounded"
              >
                コメント投稿
              </button>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
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
                setLinks([
                  {
                    link_type: "other",
                    link_url: "",
                  },
                ]);
                setDescription("");
                setDeletePassword("");
                setSelectedPlanId("normal_free_1d");
                setCommentsDisabled(false);
                setImageFiles([]);
                setImagePreviews([]);
                setCrop({ x: 0, y: 0 });
                setZoom(1);
                setCroppedAreaPixels(null);
              }}
              className="absolute top-3 right-3 z-50 w-10 h-10 flex items-center justify-center text-3xl leading-none text-gray-400 hover:text-white rounded-full cursor-pointer"
            >
              ×
            </button>

            <p className="text-[11px] text-gray-500 text-center mb-2">
              {createCell.x}.{createCell.y}
            </p>

            <h2 className="text-xl mb-4">新規投稿</h2>

            <select
              value={selectedPlanId}
              onChange={(e) => {
                const nextPlanId = e.target.value as keyof typeof PLANS;
                const nextPlan = PLANS[nextPlanId];

                setSelectedPlanId(nextPlanId);
                setDescription((prev) => prev.slice(0, nextPlan.descriptionMax));
                setLinks((prev) => prev.slice(0, nextPlan.linkMax));
                setImageFiles((prev) => prev.slice(0, nextPlan.imageMax));
                setImagePreviews((prev) => prev.slice(0, nextPlan.imageMax));
              
                if (!nextPlanId.startsWith("premium_")) {
                  setCommentsDisabled(false);
                }
              }}
              className="w-full p-2 mb-2 bg-zinc-800 text-white rounded"
            >
            
              {Object.entries(PLANS).map(([id, plan]) => (
                <option key={id} value={id}>
                  {plan.label} / {plan.priceText}
                </option>
              ))}
            </select>

            <p className="text-[11px] text-gray-500 mb-3">
              現在は「リリース記念：通常1日無料」のみ投稿できます。有料プランはStripe決済実装後に有効化します。
            </p>
            
            {selectedPlanId.startsWith("premium_") && (
              <label className="flex items-center gap-2 text-sm text-gray-300 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={commentsDisabled}
                  onChange={(e) => setCommentsDisabled(e.target.checked)}
                  className="w-4 h-4"
                />
                コメント欄オフ
              </label>
            )}
            
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

            <div className="mb-3">
              <p className="text-sm font-bold mb-2">
                リンク（最大{PLANS[selectedPlanId as keyof typeof PLANS].linkMax}個）
              </p>

              <div className="space-y-2">
                {links.map((link, index) => (
                  <div key={index} className="bg-zinc-800 p-2 rounded">
                    <div className="flex gap-2 mb-2">
                      <select
                        value={link.link_type}
                        onChange={(e) =>
                          updateLink(index, "link_type", e.target.value)
                        }
                        className="w-32 p-2 bg-zinc-700 text-white rounded"
                      >
                        {LINK_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => removeLinkInput(index)}
                        className="px-3 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                      >
                        削除
                      </button>
                    </div>

                    <input
                      value={link.link_url}
                      onChange={(e) =>
                        updateLink(index, "link_url", e.target.value)
                      }
                      placeholder="リンクURL"
                      className="w-full p-2 bg-zinc-700 text-white placeholder-gray-400 rounded"
                    />
                  </div>
                ))}
              </div>

              {links.length < PLANS[selectedPlanId as keyof typeof PLANS].linkMax && (
                <button
                  type="button"
                  onClick={addLinkInput}
                  className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                >
                  ＋リンクを追加
                </button>
              )}
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={
                PLANS[selectedPlanId as keyof typeof PLANS].descriptionMax
              }
              placeholder={`本文（${
                PLANS[selectedPlanId as keyof typeof PLANS].descriptionMax
              }文字まで）`}
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

            <div className="mb-4">
              <p className="text-sm font-bold mb-2">
                画像（最大{PLANS[selectedPlanId as keyof typeof PLANS].imageMax}枚）
              </p>

              <div className="space-y-2">
                {Array.from({
                  length: Math.min(
                    imageFiles.length + 1,
                    PLANS[selectedPlanId as keyof typeof PLANS].imageMax
                  ),
                }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-zinc-800 p-2 rounded"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm text-gray-300">
                        {index + 1}枚目
                        {index === 0 && "（セル表示用）"}
                      </p>

                      {imageFiles[index] && (
                        <button
                          type="button"
                          onClick={() => {
                            if (imagePreviews[index]) {
                              URL.revokeObjectURL(imagePreviews[index]);
                            }

                            setImageFiles((prev) =>
                              prev.filter((_, i) => i !== index)
                            );

                            setImagePreviews((prev) =>
                              prev.filter((_, i) => i !== index)
                            );

                            if (index === 0) {
                              setCrop({ x: 0, y: 0 });
                              setZoom(1);
                              setCroppedAreaPixels(null);
                            }
                          }}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                         削除
                        </button>
                      )}
                    </div>

                    <label className="block cursor-pointer">
                      <div className="bg-blue-600 hover:bg-blue-500 text-white text-center py-2 rounded font-bold text-sm">
                        {imageFiles[index] ? "画像を変更" : `${index + 1}枚目を選択`}
                      </div>

                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];

                          if (!file) return;

                          const currentPlan =
                            PLANS[selectedPlanId as keyof typeof PLANS];

                          if (index >= currentPlan.imageMax) {
                            alert(`画像は最大${currentPlan.imageMax}枚までです`);
                            return;
                          }

                          if (imagePreviews[index]) {
                            URL.revokeObjectURL(imagePreviews[index]);
                          }

                          const previewUrl = URL.createObjectURL(file);

                          setImageFiles((prev) => {
                            const next = [...prev];
                            next[index] = file;
                            return next;
                          });

                          setImagePreviews((prev) => {
                            const next = [...prev];
                            next[index] = previewUrl;
                            return next;
                          });

                          if (index === 0) {
                            setCrop({ x: 0, y: 0 });
                            setZoom(1);
                            setCroppedAreaPixels(null);
                          }
                        }}
                        className="hidden"
                      />
                    </label>

                    {imageFiles[index] && (
                      <p className="text-xs text-gray-400 mt-2 truncate">
                        選択中：{imageFiles[index].name}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            {imagePreviews[0] && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-2">
                  1枚目をセル表示用にトリミングしてください
                </p>

                <div className="h-[300px] relative mb-3 bg-black rounded overflow-hidden">
                  <Cropper
                    image={imagePreviews[0]}
                    crop={crop}
                    zoom={zoom}
                    minZoom={0.5}
                    maxZoom={4}
                    zoomSpeed={0.15}
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
              </div>
            )}

            <button
              onClick={saveCell}
              className="bg-white text-black px-4 py-2 rounded"
            >
              {selectedPlanId === "normal_free_1d" ? "保存" : "決済へ進む"}
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