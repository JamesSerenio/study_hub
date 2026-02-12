// src/pages/Admin_Item_Lists.tsx
// ✅ UI UPDATED: match Staff_Consignment_Record (receipt-btn / receipt-overlay modals)
// ✅ Add Stocks button + Restock history via RPC
// ✅ No "any"
// ✅ Search bar (name/category/size) using customer-* classes
// ✅ Sort by Category OR Stock (asc/desc)
// ✅ Actions now: receipt-btn buttons (Add Stocks / History / Edit / Delete)
// ✅ Modals now: staff-style overlays (Edit / Restock / History / Delete confirm / Void confirm)
// ✅ Export to Excel (.xlsx) with images using ExcelJS
// ✅ SIZE column + Expired + Inventory Loss + Bilin
// ✅ Adjustment History + VOID (RPC void_addon_expense)
// ✅ FIX: VOID updates header stock/overall immediately (syncHistoryHeaderFromLatest)
// ✅ FIX: history refresh does NOT re-open/re-init modal (no flicker)
// ✅ FIX: silent fetch for header sync (no global loading flicker)
// ✅ FIX: DELETE really deletes DB row (+ optional storage image delete)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonToast,
  IonSpinner,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type SortKey = "category" | "stocks";
type ExpenseType = "expired" | "inventory_loss" | "bilin";

interface AddOn {
  id: string;
  category: string;
  name: string;
  size: string | null;

  price: number;
  restocked: number;
  sold: number;
  expenses: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;

  expired: number;
  inventory_loss: number;
  bilin: number;
}

interface AddOnExpenseRow {
  id: string;
  created_at: string;
  add_on_id: string;

  full_name: string;
  category: string;
  product_name: string;

  quantity: number;
  expense_type: ExpenseType;
  expense_amount: number | string;
  description: string;

  voided: boolean;
  voided_at: string | null;
}

const BUCKET = "add-ons";

const money2 = (n: number): string => `₱${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;

const ymd = (d: Date): string => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const normSize = (s: string | null | undefined): string | null => {
  const v = String(s ?? "").trim();
  return v.length ? v : null;
};

const toNum = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

// PH date display (force numeric date, no words)
const formatPH = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
};

const typeLabel = (t: ExpenseType): string => {
  if (t === "expired") return "Expired / Damaged";
  if (t === "inventory_loss") return "Inventory Loss";
  return "Bilin";
};

// storage helpers (same approach as staff)
const safeExtFromName = (name: string): string => {
  const parts = name.split(".");
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const ext = last.trim().toLowerCase();
  if (!ext) return "jpg";
  if (ext.length > 8) return "jpg";
  return ext.replace(/[^a-z0-9]/g, "") || "jpg";
};

// Extract storage object path from public URL:
// .../storage/v1/object/public/<bucket>/<path>
const extractPathFromPublicUrl = (url: string, bucket: string): string | null => {
  try {
    const u = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
};

const deleteStorageByUrl = async (url: string | null, bucket: string): Promise<void> => {
  if (!url) return;
  const path = extractPathFromPublicUrl(url, bucket);
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("Storage delete failed:", error.message);
  }
};

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // sort/search
  const [sortKey, setSortKey] = useState<SortKey>("category");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState<string>("");

  // edit overlay
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // image upload state (staff-style)
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string>("");
  const [removeImage, setRemoveImage] = useState<boolean>(false);

  // restock overlay
  const [restockingAddOn, setRestockingAddOn] = useState<AddOn | null>(null);
  const [restockQty, setRestockQty] = useState<string>("");
  const [restockNote, setRestockNote] = useState<string>("");
  const [savingRestock, setSavingRestock] = useState<boolean>(false);

  // history overlay
  const [historyAddOn, setHistoryAddOn] = useState<AddOn | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyRows, setHistoryRows] = useState<AddOnExpenseRow[]>([]);

  // delete confirm overlay
  const [deleteTarget, setDeleteTarget] = useState<AddOn | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // void confirm overlay
  const [voidTarget, setVoidTarget] = useState<AddOnExpenseRow | null>(null);
  const [voiding, setVoiding] = useState<boolean>(false);

  // ✅ keep history header in sync
  const syncHistoryHeaderFromLatest = (latest: AddOn[]): void => {
    if (!historyAddOn) return;
    const fresh = latest.find((x) => x.id === historyAddOn.id);
    if (fresh) setHistoryAddOn(fresh);
  };

  const fetchAddOns = async (opts?: { silent?: boolean }): Promise<void> => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);

    try {
      const { data, error } = await supabase.from("add_ons").select("*").order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as unknown as AddOn[];

      const normalized: AddOn[] = rows.map((r) => ({
        ...r,
        price: toNum((r as unknown as { price?: unknown }).price),
        restocked: toNum((r as unknown as { restocked?: unknown }).restocked),
        sold: toNum((r as unknown as { sold?: unknown }).sold),
        expenses: toNum((r as unknown as { expenses?: unknown }).expenses),
        stocks: toNum((r as unknown as { stocks?: unknown }).stocks),
        overall_sales: toNum((r as unknown as { overall_sales?: unknown }).overall_sales),
        expected_sales: toNum((r as unknown as { expected_sales?: unknown }).expected_sales),

        expired: toNum((r as unknown as { expired?: unknown }).expired),
        inventory_loss: toNum((r as unknown as { inventory_loss?: unknown }).inventory_loss),
        bilin: toNum((r as unknown as { bilin?: unknown }).bilin),

        size: normSize((r as unknown as { size?: string | null }).size),
        image_url: (r as unknown as { image_url?: string | null }).image_url ?? null,
        category: String((r as unknown as { category?: unknown }).category ?? ""),
        name: String((r as unknown as { name?: unknown }).name ?? ""),
        id: String((r as unknown as { id?: unknown }).id ?? ""),
      }));

      setAddOns(normalized);
      syncHistoryHeaderFromLatest(normalized);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error fetching add-ons:", error);
      setToastMessage("Error loading add-ons. Please try again.");
      setShowToast(true);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAddOns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup preview object URL
  useEffect(() => {
    return () => {
      if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    };
  }, [newImagePreview]);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchAddOns().finally(() => event.detail.complete());
  };

  const sortedAddOns = useMemo(() => {
    const list = [...addOns];
    list.sort((a, b) => {
      if (sortKey === "category") {
        const aCat = (a.category ?? "").toString();
        const bCat = (b.category ?? "").toString();
        return sortOrder === "asc" ? aCat.localeCompare(bCat) : bCat.localeCompare(aCat);
      }
      const aStock = toNum(a.stocks);
      const bStock = toNum(b.stocks);
      return sortOrder === "asc" ? aStock - bStock : bStock - aStock;
    });
    return list;
  }, [addOns, sortKey, sortOrder]);

  const filteredAddOns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedAddOns;

    return sortedAddOns.filter((a) => {
      const name = (a.name ?? "").toString().toLowerCase();
      const cat = (a.category ?? "").toString().toLowerCase();
      const size = (a.size ?? "").toString().toLowerCase();
      return name.includes(q) || cat.includes(q) || size.includes(q);
    });
  }, [sortedAddOns, search]);

  const toggleSortOrder = (): void => setSortOrder((p) => (p === "asc" ? "desc" : "asc"));

  /* =========================
     ACTIONS (STAFF-STYLE)
  ========================= */

  const openEdit = (id: string): void => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;

    setEditingAddOn({ ...a, size: normSize(a.size) });
    setNewImageFile(null);
    setRemoveImage(false);

    if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    setNewImagePreview("");
  };

  const onPickImage = (file: File | null): void => {
    setNewImageFile(file);
    setRemoveImage(false);

    if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    setNewImagePreview(file ? URL.createObjectURL(file) : "");
  };

  const uploadNewImage = async (): Promise<string> => {
    if (!newImageFile) throw new Error("No image selected");

    const ext = safeExtFromName(newImageFile.name);
    const safeName = `add_ons/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(safeName, newImageFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: newImageFile.type || undefined,
    });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(safeName);
    const publicUrl = data?.publicUrl ?? "";
    if (!publicUrl) throw new Error("Failed to get public URL.");
    return publicUrl;
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingAddOn) return;

    if (!editingAddOn.name.trim()) return void (setToastMessage("Name is required."), setShowToast(true));
    if (!editingAddOn.category.trim()) return void (setToastMessage("Category is required."), setShowToast(true));

    const fixedSize = normSize(editingAddOn.size);

    if (!Number.isFinite(editingAddOn.price) || editingAddOn.price < 0)
      return void (setToastMessage("Price must be a valid positive number."), setShowToast(true));
    if (!Number.isFinite(editingAddOn.sold) || editingAddOn.sold < 0)
      return void (setToastMessage("Sold must be a valid non-negative number."), setShowToast(true));
    if (!Number.isFinite(editingAddOn.expenses) || editingAddOn.expenses < 0)
      return void (setToastMessage("Expenses must be a valid non-negative number."), setShowToast(true));

    const oldImageUrl: string | null = editingAddOn.image_url ?? null;

    try {
      setSavingEdit(true);

      let finalImageUrl: string | null = oldImageUrl;

      // new upload
      if (newImageFile) {
        finalImageUrl = await uploadNewImage();
      } else if (removeImage) {
        finalImageUrl = null;
      }

      const { error } = await supabase
        .from("add_ons")
        .update({
          category: editingAddOn.category,
          name: editingAddOn.name,
          size: fixedSize,
          price: editingAddOn.price,
          sold: editingAddOn.sold,
          expenses: editingAddOn.expenses,
          image_url: finalImageUrl,
        })
        .eq("id", editingAddOn.id);

      if (error) throw error;

      // delete old if changed
      const changedImage = (oldImageUrl ?? null) !== (finalImageUrl ?? null);
      if (changedImage && oldImageUrl) {
        await deleteStorageByUrl(oldImageUrl, BUCKET);
      }

      setToastMessage("Add-on updated successfully.");
      setShowToast(true);

      setEditingAddOn(null);
      setNewImageFile(null);
      setRemoveImage(false);

      if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
      setNewImagePreview("");

      void fetchAddOns();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error updating add-on:", error);
      setToastMessage(`Error updating add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    } finally {
      setSavingEdit(false);
    }
  };

  const openRestock = (id: string): void => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;
    setRestockingAddOn(a);
    setRestockQty("");
    setRestockNote("");
  };

  const submitRestock = async (): Promise<void> => {
    if (!restockingAddOn) return;

    const qty = parseInt(restockQty.trim(), 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setToastMessage("Restock quantity must be a positive number.");
      setShowToast(true);
      return;
    }

    try {
      setSavingRestock(true);

      const { error } = await supabase.rpc("restock_add_on", {
        p_add_on_id: restockingAddOn.id,
        p_qty: qty,
        p_note: restockNote.trim() || null,
      });

      if (error) throw error;

      setToastMessage("Stocks added successfully.");
      setShowToast(true);

      setRestockingAddOn(null);
      setRestockQty("");
      setRestockNote("");

      void fetchAddOns();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error restocking:", error);
      setToastMessage(`Error restocking: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    } finally {
      setSavingRestock(false);
    }
  };

  const fetchHistoryRowsFor = async (addOnId: string): Promise<void> => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_on_expenses")
        .select("id, created_at, add_on_id, full_name, category, product_name, quantity, expense_type, expense_amount, description, voided, voided_at")
        .eq("add_on_id", addOnId)
        .order("created_at", { ascending: false })
        .limit(150);

      if (error) throw error;

      const rows = (data ?? []) as unknown as AddOnExpenseRow[];
      setHistoryRows(
        rows.map((r) => ({
          ...r,
          quantity: toNum(r.quantity),
          expense_amount: toNum(r.expense_amount),
          expense_type: String(r.expense_type) as ExpenseType,
          voided: Boolean(r.voided),
          voided_at: r.voided_at ?? null,
        }))
      );

      // ✅ silent header sync
      void fetchAddOns({ silent: true });
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("history fetch error:", e);
      setToastMessage(`History load failed: ${e instanceof Error ? e.message : "Try again."}`);
      setShowToast(true);
      setHistoryAddOn(null);
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = async (id: string): Promise<void> => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;

    setHistoryAddOn(a);
    setHistoryRows([]);

    await fetchHistoryRowsFor(a.id);
  };

  const refreshHistory = async (): Promise<void> => {
    if (!historyAddOn) return;
    await fetchHistoryRowsFor(historyAddOn.id);
  };

  const confirmVoid = (row: AddOnExpenseRow): void => setVoidTarget(row);

  const doVoid = async (): Promise<void> => {
    if (!voidTarget) return;

    try {
      setVoiding(true);

      const { error } = await supabase.rpc("void_addon_expense", {
        p_expense_id: voidTarget.id,
      });

      if (error) throw error;

      setToastMessage("Voided successfully. Counters restored.");
      setShowToast(true);

      setVoidTarget(null);

      // ✅ refresh list + history WITHOUT modal reset/flicker
      await fetchAddOns();
      await refreshHistory();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("void error:", e);
      setToastMessage(`Void failed: ${e instanceof Error ? e.message : "Try again."}`);
      setShowToast(true);
    } finally {
      setVoiding(false);
    }
  };

  const confirmDelete = (id: string): void => {
    const a = addOns.find((x) => x.id === id) ?? null;
    setDeleteTarget(a);
  };

  const doDelete = async (): Promise<void> => {
    if (!deleteTarget) return;

    try {
      setDeleting(true);

      const oldImageUrl = deleteTarget.image_url ?? null;

      const { error } = await supabase.from("add_ons").delete().eq("id", deleteTarget.id);
      if (error) throw error;

      if (oldImageUrl) await deleteStorageByUrl(oldImageUrl, BUCKET);

      setAddOns((prev) => prev.filter((a) => a.id !== deleteTarget.id));

      if (historyAddOn?.id === deleteTarget.id) {
        setHistoryAddOn(null);
        setHistoryRows([]);
      }

      setToastMessage("Add-on deleted successfully.");
      setShowToast(true);

      setDeleteTarget(null);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error deleting add-on:", error);
      setToastMessage(`Error deleting add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    } finally {
      setDeleting(false);
    }
  };

  /* =========================
     EXPORT (unchanged logic)
  ========================= */

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res !== "string") return reject(new Error("Failed to convert image"));
        const base64 = res.split(",")[1] ?? "";
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });

  const fetchImageBase64 = async (url: string): Promise<{ base64: string; ext: "png" | "jpeg" }> => {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Image fetch failed");

    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    const blob = await r.blob();
    const base64 = await blobToBase64(blob);

    const isPng = ct.includes("png") || url.toLowerCase().includes(".png");
    const ext: "png" | "jpeg" = isPng ? "png" : "jpeg";
    return { base64, ext };
  };

  const exportToExcel = async (): Promise<void> => {
    try {
      const now = new Date();
      const title = "Item Lists INVENTORY REPORT";
      const generated = `Generated: ${now.toLocaleString()}`;
      const sortInfo = `Sort: ${sortKey} (${sortOrder})   Search: ${search.trim() ? search.trim() : "—"}`;

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Add-ons", { views: [{ state: "frozen", ySplit: 5 }] });

      ws.columns = [
        { header: "Image", key: "image", width: 14 },
        { header: "Name", key: "name", width: 28 },
        { header: "Category", key: "category", width: 18 },
        { header: "Size", key: "size", width: 10 },
        { header: "Price", key: "price", width: 12 },
        { header: "Restocked", key: "restocked", width: 12 },
        { header: "Sold", key: "sold", width: 10 },
        { header: "Expired", key: "expired", width: 10 },
        { header: "Inventory Loss", key: "inv_loss", width: 14 },
        { header: "Bilin", key: "bilin", width: 10 },
        { header: "Stocks", key: "stocks", width: 10 },
        { header: "Expenses", key: "expenses", width: 12 },
        { header: "Overall Sales", key: "overall", width: 14 },
        { header: "Expected Sales", key: "expected", width: 14 },
      ];

      ws.mergeCells(1, 1, 1, 14);
      ws.mergeCells(2, 1, 2, 14);
      ws.mergeCells(3, 1, 3, 14);

      ws.getCell("A1").value = title;
      ws.getCell("A2").value = generated;
      ws.getCell("A3").value = sortInfo;

      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A3").font = { size: 11 };

      ws.addRow([]);

      const headerRow = ws.getRow(5);
      headerRow.values = [
        "Image",
        "Name",
        "Category",
        "Size",
        "Price",
        "Restocked",
        "Sold",
        "Expired",
        "Inventory Loss",
        "Bilin",
        "Stocks",
        "Expenses",
        "Overall Sales",
        "Expected Sales",
      ];
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;

      headerRow.eachCell((cell) => {
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      });

      let rowIndex = 6;

      for (const a of filteredAddOns) {
        const r = ws.getRow(rowIndex);

        r.getCell(2).value = a.name ?? "";
        r.getCell(3).value = a.category ?? "";
        r.getCell(4).value = normSize(a.size) ?? "—";
        r.getCell(5).value = toNum(a.price);
        r.getCell(6).value = toNum(a.restocked);
        r.getCell(7).value = toNum(a.sold);
        r.getCell(8).value = toNum(a.expired);
        r.getCell(9).value = toNum(a.inventory_loss);
        r.getCell(10).value = toNum(a.bilin);
        r.getCell(11).value = toNum(a.stocks);
        r.getCell(12).value = toNum(a.expenses);
        r.getCell(13).value = toNum(a.overall_sales);
        r.getCell(14).value = toNum(a.expected_sales);

        r.height = 52;

        for (let c = 1; c <= 14; c++) {
          const cell = r.getCell(c);
          cell.alignment =
            c === 2
              ? { vertical: "middle", horizontal: "left", wrapText: true }
              : { vertical: "middle", horizontal: c === 1 ? "center" : "center", wrapText: true };
          cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        }

        r.getCell(5).numFmt = "₱#,##0.00";
        r.getCell(13).numFmt = "₱#,##0.00";
        r.getCell(14).numFmt = "₱#,##0.00";

        if (a.image_url) {
          try {
            const { base64, ext } = await fetchImageBase64(a.image_url);
            const imgId = workbook.addImage({ base64, extension: ext });

            ws.addImage(imgId, {
              tl: { col: 0.15, row: rowIndex - 1 + 0.15 },
              ext: { width: 48, height: 48 },
            });
          } catch {
            // eslint-disable-next-line no-console
            console.warn("Image embed failed for:", a.image_url);
          }
        }

        r.commit();
        rowIndex++;
      }

      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, `Item_List_${ymd(now)}.xlsx`);

      setToastMessage("Exported to Excel successfully.");
      setShowToast(true);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("Export Excel error:", e);
      setToastMessage(`Export failed: ${e instanceof Error ? e.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  const sortLabel = `${sortKey === "category" ? "category" : "stocks"} (${sortOrder})`;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Item Lists (Admin)</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container">
          {/* TOPBAR (staff style) */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Item Lists (Admin)</h2>
              <div className="customer-subtext">
                Sorted by <b>{sortLabel}</b> • Rows: <b>{filteredAddOns.length}</b>
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="receipt-btn" onClick={() => setSortKey("category")} style={{ opacity: sortKey === "category" ? 1 : 0.6 }}>
                  Sort: Category
                </button>
                <button className="receipt-btn" onClick={() => setSortKey("stocks")} style={{ opacity: sortKey === "stocks" ? 1 : 0.6 }}>
                  Sort: Stocks
                </button>
                <button className="receipt-btn" onClick={toggleSortOrder}>
                  Order: {sortOrder === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* SEARCH */}
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>

                  <input
                    className="customer-search-input"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(String(e.currentTarget.value ?? ""))}
                    placeholder="Search name, category, or size..."
                  />

                  {search.trim() && (
                    <button className="customer-search-clear" type="button" onClick={() => setSearch("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={() => void fetchAddOns()} disabled={loading}>
                  Refresh
                </button>
                <button className="receipt-btn" onClick={() => void exportToExcel()} disabled={loading || filteredAddOns.length === 0}>
                  Export Excel
                </button>
              </div>
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <div className="customer-note" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IonSpinner /> Loading add-ons...
            </div>
          ) : filteredAddOns.length === 0 ? (
            <p className="customer-note">No add-ons found.</p>
          ) : (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Size</th>
                    <th>Price</th>
                    <th>Restocked</th>
                    <th>Sold</th>
                    <th>Expired</th>
                    <th>Inventory Loss</th>
                    <th>Bilin</th>
                    <th>Stocks</th>
                    <th>Expenses</th>
                    <th>Overall</th>
                    <th>Expected</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredAddOns.map((a) => (
                    <tr key={a.id}>
                      <td style={{ width: 86 }}>
                        {a.image_url ? (
                          <img
                            src={a.image_url}
                            alt={a.name}
                            style={{
                              width: 64,
                              height: 64,
                              objectFit: "cover",
                              borderRadius: 12,
                              border: "1px solid rgba(0,0,0,0.12)",
                            }}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            style={{
                              width: 64,
                              height: 64,
                              borderRadius: 12,
                              border: "1px dashed rgba(0,0,0,0.25)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 12,
                              opacity: 0.75,
                            }}
                          >
                            No Image
                          </div>
                        )}
                      </td>

                      <td style={{ fontWeight: 900 }}>{a.name}</td>
                      <td style={{ fontWeight: 900 }}>{a.category}</td>
                      <td>{normSize(a.size) ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{money2(toNum(a.price))}</td>

                      <td style={{ fontWeight: 900 }}>{toNum(a.restocked)}</td>
                      <td style={{ fontWeight: 900 }}>{toNum(a.sold)}</td>

                      <td style={{ fontWeight: 900 }}>{toNum(a.expired)}</td>
                      <td style={{ fontWeight: 900 }}>{toNum(a.inventory_loss)}</td>
                      <td style={{ fontWeight: 900 }}>{toNum(a.bilin)}</td>

                      <td style={{ fontWeight: 900 }}>{toNum(a.stocks)}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{money2(toNum(a.expenses))}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{money2(toNum(a.overall_sales))}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{money2(toNum(a.expected_sales))}</td>

                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button className="receipt-btn" onClick={() => openRestock(a.id)}>
                            Add Stocks
                          </button>
                          <button className="receipt-btn" onClick={() => void openHistory(a.id)}>
                            History
                          </button>
                          <button className="receipt-btn" onClick={() => openEdit(a.id)}>
                            Edit
                          </button>
                          <button className="receipt-btn" onClick={() => confirmDelete(a.id)} style={{ opacity: 0.9 }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <IonToast isOpen={showToast} message={toastMessage} duration={2600} onDidDismiss={() => setShowToast(false)} />

          {/* =========================
              EDIT OVERLAY (STAFF STYLE)
          ========================= */}
          {editingAddOn && (
            <div className="receipt-overlay" onClick={() => (savingEdit ? null : setEditingAddOn(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">EDIT ADD-ON</h3>
                <p className="receipt-subtitle">{editingAddOn.name}</p>

                <hr />

                {/* IMAGE PREVIEW + UPLOAD */}
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <div
                    style={{
                      width: 84,
                      height: 84,
                      borderRadius: 14,
                      overflow: "hidden",
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: "rgba(0,0,0,0.03)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {newImagePreview ? (
                      <img src={newImagePreview} alt="New" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : editingAddOn.image_url && !removeImage ? (
                      <img src={editingAddOn.image_url} alt="Current" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.75 }}>No Image</div>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <label className="receipt-btn" style={{ cursor: savingEdit ? "not-allowed" : "pointer", opacity: savingEdit ? 0.6 : 1 }}>
                      Upload Image
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        disabled={savingEdit}
                        onChange={(e) => {
                          const f = e.currentTarget.files?.[0] ?? null;
                          onPickImage(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>

                    <button
                      className="receipt-btn"
                      onClick={() => {
                        onPickImage(null);
                        setRemoveImage(true);
                      }}
                      disabled={savingEdit}
                      style={{ opacity: 0.9 }}
                      title="Remove image (will delete old after saving)"
                    >
                      Remove Image
                    </button>

                    {newImageFile ? <div style={{ fontSize: 12, opacity: 0.8 }}>Selected: {newImageFile.name}</div> : null}
                    {removeImage && !newImageFile ? <div style={{ fontSize: 12, opacity: 0.8 }}>Image will be removed.</div> : null}
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Name *</span>
                  <input
                    className="money-input"
                    value={editingAddOn.name}
                    onChange={(e) => setEditingAddOn({ ...editingAddOn, name: e.currentTarget.value })}
                    disabled={savingEdit}
                  />
                </div>

                <div className="receipt-row">
                  <span>Category *</span>
                  <input
                    className="money-input"
                    value={editingAddOn.category}
                    onChange={(e) => setEditingAddOn({ ...editingAddOn, category: e.currentTarget.value })}
                    disabled={savingEdit}
                  />
                </div>

                <div className="receipt-row">
                  <span>Size</span>
                  <input
                    className="money-input"
                    value={editingAddOn.size ?? ""}
                    placeholder='e.g. "Small", "16oz"'
                    onChange={(e) => setEditingAddOn({ ...editingAddOn, size: e.currentTarget.value })}
                    disabled={savingEdit}
                  />
                </div>

                <div className="receipt-row">
                  <span>Price</span>
                  <input
                    className="money-input"
                    type="number"
                    value={editingAddOn.price}
                    onChange={(e) => {
                      const v = parseFloat(e.currentTarget.value);
                      setEditingAddOn({ ...editingAddOn, price: Number.isNaN(v) ? 0 : v });
                    }}
                    disabled={savingEdit}
                  />
                </div>

                <div className="receipt-row">
                  <span>Sold</span>
                  <input
                    className="money-input"
                    type="number"
                    value={editingAddOn.sold}
                    onChange={(e) => {
                      const v = parseInt(e.currentTarget.value, 10);
                      setEditingAddOn({ ...editingAddOn, sold: Number.isNaN(v) ? 0 : v });
                    }}
                    disabled={savingEdit}
                  />
                </div>

                <div className="receipt-row">
                  <span>Expenses</span>
                  <input
                    className="money-input"
                    type="number"
                    value={editingAddOn.expenses}
                    onChange={(e) => {
                      const v = parseFloat(e.currentTarget.value);
                      setEditingAddOn({ ...editingAddOn, expenses: Number.isNaN(v) ? 0 : v });
                    }}
                    disabled={savingEdit}
                  />
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setEditingAddOn(null)} disabled={savingEdit}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void handleSaveEdit()} disabled={savingEdit}>
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =========================
              RESTOCK OVERLAY (STAFF STYLE)
          ========================= */}
          {restockingAddOn && (
            <div className="receipt-overlay" onClick={() => (savingRestock ? null : setRestockingAddOn(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ADD STOCKS</h3>
                <p className="receipt-subtitle">
                  {restockingAddOn.name} • Current Restock: <b>{toNum(restockingAddOn.restocked)}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Quantity to add *</span>
                  <input
                    className="money-input"
                    type="number"
                    min="1"
                    step="1"
                    value={restockQty}
                    onChange={(e) => setRestockQty(e.currentTarget.value)}
                    disabled={savingRestock}
                    placeholder="e.g. 10"
                  />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Note (optional)</div>
                  <textarea
                    value={restockNote}
                    onChange={(e) => setRestockNote(e.currentTarget.value)}
                    placeholder="e.g. supplier restock / new batch"
                    style={{
                      width: "100%",
                      minHeight: 90,
                      resize: "vertical",
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.15)",
                      outline: "none",
                      fontSize: 14,
                    }}
                    disabled={savingRestock}
                  />
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setRestockingAddOn(null)} disabled={savingRestock}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void submitRestock()} disabled={savingRestock}>
                    {savingRestock ? "Saving..." : "Confirm Restock"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =========================
              HISTORY OVERLAY (STAFF STYLE)
          ========================= */}
          {historyAddOn && (
            <div className="receipt-overlay" onClick={() => (historyLoading ? null : setHistoryAddOn(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
                <h3 className="receipt-title">ADJUSTMENT HISTORY</h3>
                <p className="receipt-subtitle">{historyAddOn.name}</p>

                <div style={{ opacity: 0.85, marginBottom: 10 }}>
                  Current Stock: <b>{historyAddOn.stocks}</b> • Overall: <b>{money2(historyAddOn.overall_sales)}</b>
                </div>

                <hr />

                {historyLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <IonSpinner /> Loading history...
                  </div>
                ) : historyRows.length === 0 ? (
                  <div style={{ opacity: 0.85 }}>No adjustment records.</div>
                ) : (
                  <div className="customer-table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
                    <table className="customer-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Qty</th>
                          <th>Amount</th>
                          <th>By</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((r) => (
                          <tr key={r.id}>
                            <td>{formatPH(r.created_at)}</td>
                            <td style={{ fontWeight: 900 }}>{typeLabel(r.expense_type)}</td>
                            <td style={{ fontWeight: 900 }}>{toNum(r.quantity)}</td>
                            <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{money2(toNum(r.expense_amount))}</td>
                            <td style={{ fontWeight: 900 }}>{r.full_name}</td>
                            <td>{r.description}</td>
                            <td style={{ fontWeight: 900 }}>{r.voided ? "VOIDED" : "ACTIVE"}</td>
                            <td>
                              {!r.voided ? (
                                <button className="receipt-btn" onClick={() => confirmVoid(r)} disabled={voiding}>
                                  Void
                                </button>
                              ) : (
                                <span style={{ opacity: 0.7 }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setHistoryAddOn(null)} disabled={historyLoading}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void refreshHistory()} disabled={historyLoading}>
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =========================
              DELETE CONFIRM (STAFF STYLE)
          ========================= */}
          {deleteTarget && (
            <div className="receipt-overlay" onClick={() => (deleting ? null : setDeleteTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DELETE ITEM</h3>
                <p className="receipt-subtitle">
                  Are you sure you want to delete <b>{deleteTarget.name}</b>?
                </p>

                <hr />

                <div style={{ display: "grid", gap: 8, fontSize: 13, opacity: 0.9 }}>
                  <div>
                    Category: <b>{deleteTarget.category}</b>
                  </div>
                  <div>
                    Stocks: <b>{toNum(deleteTarget.stocks)}</b> • Sold: <b>{toNum(deleteTarget.sold)}</b>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    Image: <b>{deleteTarget.image_url ? "will be deleted" : "none"}</b>
                  </div>
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void doDelete()} disabled={deleting}>
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =========================
              VOID CONFIRM (STAFF STYLE)
          ========================= */}
          {voidTarget && (
            <div className="receipt-overlay" onClick={() => (voiding ? null : setVoidTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">VOID ADJUSTMENT</h3>
                <p className="receipt-subtitle">
                  Are you sure you want to void this adjustment? This will restore counters and mark it as <b>VOIDED</b>.
                </p>

                <hr />

                <div style={{ display: "grid", gap: 8, fontSize: 13, opacity: 0.9 }}>
                  <div>
                    Date: <b>{formatPH(voidTarget.created_at)}</b>
                  </div>
                  <div>
                    Type: <b>{typeLabel(voidTarget.expense_type)}</b>
                  </div>
                  <div>
                    Qty: <b>{toNum(voidTarget.quantity)}</b>
                  </div>
                  <div>
                    Amount: <b>{money2(toNum(voidTarget.expense_amount))}</b>
                  </div>
                  <div>
                    By: <b>{voidTarget.full_name}</b>
                  </div>
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setVoidTarget(null)} disabled={voiding}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void doVoid()} disabled={voiding}>
                    {voiding ? "Voiding..." : "Void"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;
