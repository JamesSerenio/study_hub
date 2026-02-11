// src/pages/Admin_Item_Lists.tsx
// ✅ Add Stocks button + Restock history via RPC
// ✅ No "any"
// ✅ SAME UI/CLASSNAMES as Product_Item_Lists (PIL theme)
// ✅ Search bar (name/category/size)
// ✅ Sort by Category OR Stock (asc/desc)
// ✅ Actions kept (Add Stocks / Edit / Delete)
// ✅ Export to Excel (.xlsx) with images using ExcelJS
// ✅ NEW: SIZE column
// ✅ NEW: Expired + Inventory Loss + Bilin columns (DB: expired, inventory_loss, bilin)
// ✅ NEW: Adjustment History + VOID (reverts counters via RPC void_addon_expense)
// ✅ FIX: VOID updates header stock/overall immediately (syncHistoryHeaderFromLatest)
// ✅ FIX: history refresh does NOT re-open/re-init modal (no flicker)
// ✅ FIX: silent fetch for header sync (no global loading flicker)
// ✅ FIX: DELETE really deletes DB row (+ optional storage image delete)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonContent,
  IonGrid,
  IonRow,
  IonTitle,
  IonCol,
  IonLabel,
  IonButton,
  IonIcon,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonAlert,
  IonModal,
  IonInput,
  IonItem,
  IonImg,
  IonText,
  IonButtons,
  IonSpinner,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import {
  trash,
  create,
  arrowUp,
  arrowDown,
  addCircle,
  addCircleOutline,
  swapVerticalOutline,
  closeOutline,
  downloadOutline,
  timeOutline,
  closeCircleOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import type { IonSelectCustomEvent, SelectChangeEventDetail } from "@ionic/core";

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

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // sort/search
  const [sortKey, setSortKey] = useState<SortKey>("category");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState<string>("");

  // delete
  const [showDeleteAlert, setShowDeleteAlert] = useState<boolean>(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // edit
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);
  const [newImageFile, setNewImageFile] = useState<File | null>(null);

  // restock
  const [showRestockModal, setShowRestockModal] = useState<boolean>(false);
  const [restockingAddOn, setRestockingAddOn] = useState<AddOn | null>(null);
  const [restockQty, setRestockQty] = useState<string>("");
  const [restockNote, setRestockNote] = useState<string>("");

  // history + void
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyAddOn, setHistoryAddOn] = useState<AddOn | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyRows, setHistoryRows] = useState<AddOnExpenseRow[]>([]);
  const [voidTarget, setVoidTarget] = useState<AddOnExpenseRow | null>(null);
  const [showVoidAlert, setShowVoidAlert] = useState<boolean>(false);

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

  const handleEdit = (id: string): void => {
    const addOnToEdit = addOns.find((a) => a.id === id);
    if (!addOnToEdit) return;
    setEditingAddOn({ ...addOnToEdit, size: normSize(addOnToEdit.size) });
    setNewImageFile(null);
    setShowEditModal(true);
  };

  const openRestock = (id: string): void => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;
    setRestockingAddOn(a);
    setRestockQty("");
    setRestockNote("");
    setShowRestockModal(true);
  };

  // ✅ dedicated history loader (no modal reset)
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

      // ✅ silent header sync (no global loading)
      void fetchAddOns({ silent: true });
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("history fetch error:", e);
      setToastMessage(`History load failed: ${e instanceof Error ? e.message : "Try again."}`);
      setShowToast(true);
      setShowHistoryModal(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = async (id: string): Promise<void> => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;

    setHistoryAddOn(a);
    setHistoryRows([]);
    setShowHistoryModal(true);

    await fetchHistoryRowsFor(a.id);
  };

  const refreshHistory = async (): Promise<void> => {
    if (!historyAddOn) return;
    await fetchHistoryRowsFor(historyAddOn.id);
  };

  // ✅ Extract storage path from public URL
  const getStoragePathFromPublicUrl = (publicUrl: string, bucket: string): string | null => {
    try {
      const marker = `/storage/v1/object/public/${bucket}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;

      const pathWithMaybeQuery = publicUrl.substring(idx + marker.length);
      const path = pathWithMaybeQuery.split("?")[0];
      return decodeURIComponent(path);
    } catch {
      return null;
    }
  };

  const uploadNewImage = async (): Promise<{ publicUrl: string; newPath: string }> => {
    if (!newImageFile) throw new Error("No image selected");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    if (!userRes?.user) throw new Error("Not logged in");

    const userId: string = userRes.user.id;

    const extRaw: string | undefined = newImageFile.name.split(".").pop();
    const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
    const fileName: string = `${Date.now()}.${fileExt}`;
    const newPath: string = `${userId}/${fileName}`;

    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(newPath, newImageFile, {
      contentType: newImageFile.type,
      upsert: false,
    });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
    return { publicUrl: urlData.publicUrl, newPath };
  };

  const deleteOldImageIfAny = async (oldImageUrl: string | null): Promise<void> => {
    if (!oldImageUrl) return;

    const oldPath = getStoragePathFromPublicUrl(oldImageUrl, BUCKET);
    if (!oldPath) return;

    const { error } = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (error) console.warn("Failed to delete old image:", error.message);
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
      let finalImageUrl: string | null = oldImageUrl;

      if (newImageFile) {
        const uploaded = await uploadNewImage();
        finalImageUrl = uploaded.publicUrl;
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

      if (newImageFile && finalImageUrl && finalImageUrl !== oldImageUrl) {
        await deleteOldImageIfAny(oldImageUrl);
      }

      const updated: AddOn = { ...editingAddOn, size: fixedSize, image_url: finalImageUrl };
      setAddOns((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));

      setToastMessage("Add-on updated successfully.");
      setShowToast(true);

      setShowEditModal(false);
      setEditingAddOn(null);
      setNewImageFile(null);

      void fetchAddOns();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error updating add-on:", error);
      setToastMessage(`Error updating add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  // ✅ RESTOCK SUBMIT (RPC)
  const submitRestock = async (): Promise<void> => {
    if (!restockingAddOn) return;

    const qty = parseInt(restockQty.trim(), 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setToastMessage("Restock quantity must be a positive number.");
      setShowToast(true);
      return;
    }

    try {
      const { error } = await supabase.rpc("restock_add_on", {
        p_add_on_id: restockingAddOn.id,
        p_qty: qty,
        p_note: restockNote.trim() || null,
      });

      if (error) throw error;

      setToastMessage("Stocks added successfully.");
      setShowToast(true);

      setShowRestockModal(false);
      setRestockingAddOn(null);
      setRestockQty("");
      setRestockNote("");

      void fetchAddOns();
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error restocking:", error);
      setToastMessage(`Error restocking: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  // ✅ VOID adjustment (RPC)
  const confirmVoid = (row: AddOnExpenseRow): void => {
    setVoidTarget(row);
    setShowVoidAlert(true);
  };

  const doVoid = async (): Promise<void> => {
    if (!voidTarget) return;

    try {
      const { error } = await supabase.rpc("void_addon_expense", {
        p_expense_id: voidTarget.id,
      });

      if (error) throw error;

      setToastMessage("Voided successfully. Counters restored.");
      setShowToast(true);

      setShowVoidAlert(false);
      setVoidTarget(null);

      // ✅ refresh list + history WITHOUT modal reset/flicker
      await fetchAddOns();
      await refreshHistory();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("void error:", e);
      setToastMessage(`Void failed: ${e instanceof Error ? e.message : "Try again."}`);
      setShowToast(true);
    }
  };

  // ✅ DELETE (DB + optional image delete)
  const handleDelete = (id: string): void => {
    setDeleteId(id);
    setShowDeleteAlert(true);
  };

  const confirmDeleteRow = async (): Promise<void> => {
    if (!deleteId) {
      setShowDeleteAlert(false);
      return;
    }

    const target = addOns.find((a) => a.id === deleteId) ?? null;
    const oldImageUrl = target?.image_url ?? null;

    try {
      const { error } = await supabase.from("add_ons").delete().eq("id", deleteId);
      if (error) throw error;

      if (oldImageUrl) {
        await deleteOldImageIfAny(oldImageUrl);
      }

      setAddOns((prev) => prev.filter((a) => a.id !== deleteId));

      if (historyAddOn?.id === deleteId) {
        setShowHistoryModal(false);
        setHistoryAddOn(null);
        setHistoryRows([]);
      }

      setToastMessage("Add-on deleted successfully.");
      setShowToast(true);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error deleting add-on:", error);
      setToastMessage(`Error deleting add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }

    setShowDeleteAlert(false);
    setDeleteId(null);
  };

  // =========================
  // ✅ EXPORT EXCEL (NO ID, IMAGES EMBEDDED)
  // =========================

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
    <IonPage className="pil-page">
      <IonHeader className="pil-header">
        <IonToolbar className="pil-toolbar">
          <IonTitle className="pil-title">Item Lists (Admin)</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pil-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="pil-actions">
          <IonButton className="pil-btn pil-btn--primary" fill="solid" onClick={() => void fetchAddOns()}>
            <IonIcon slot="start" icon={addCircleOutline} />
            Refresh
          </IonButton>

          <IonButton
            className="pil-btn pil-btn--ghost"
            fill="outline"
            disabled={loading || filteredAddOns.length === 0}
            onClick={() => void exportToExcel()}
          >
            <IonIcon slot="start" icon={downloadOutline} />
            Export Excel
          </IonButton>

          <IonItem lines="none" className="pil-sort-item">
            <IonLabel className="pil-sort-label">Sort</IonLabel>
            <IonSelect
              className="pil-sort-select"
              value={sortKey}
              onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) => setSortKey(String(e.detail.value) as SortKey)}
            >
              <IonSelectOption value="category">Category</IonSelectOption>
              <IonSelectOption value="stocks">Stocks</IonSelectOption>
            </IonSelect>
          </IonItem>

          <IonButton className="pil-btn pil-btn--ghost" fill="clear" onClick={toggleSortOrder}>
            <IonIcon slot="start" icon={swapVerticalOutline} />
            <span className="pil-sort-order">{sortOrder === "asc" ? "Asc" : "Desc"}</span>
            <IonIcon icon={sortOrder === "asc" ? arrowUp : arrowDown} />
          </IonButton>

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
        </div>

        <div className="pil-card">
          <div className="pil-card-head">
            <div>
              <div className="pil-card-title">Add-ons</div>
              <div className="pil-card-sub">
                Sorted by <b>{sortLabel}</b>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="pil-loading">
              <IonSpinner />
              <IonLabel>Loading add-ons...</IonLabel>
            </div>
          ) : filteredAddOns.length === 0 ? (
            <div className="pil-empty">
              <IonLabel>No add-ons found.</IonLabel>
            </div>
          ) : (
            <div className="pil-table-wrap">
              <IonGrid className="pil-grid">
                <IonRow className="pil-row pil-row--head">
                  <IonCol className="pil-col pil-col--img">Image</IonCol>
                  <IonCol className="pil-col pil-col--strong">Name</IonCol>
                  <IonCol className="pil-col">Category</IonCol>
                  <IonCol className="pil-col">Size</IonCol>
                  <IonCol className="pil-col">Price</IonCol>
                  <IonCol className="pil-col">Restocked</IonCol>
                  <IonCol className="pil-col">Sold</IonCol>
                  <IonCol className="pil-col">Expired</IonCol>
                  <IonCol className="pil-col">Inventory Loss</IonCol>
                  <IonCol className="pil-col">Bilin</IonCol>
                  <IonCol className="pil-col">Stocks</IonCol>
                  <IonCol className="pil-col">Expenses</IonCol>
                  <IonCol className="pil-col">Overall</IonCol>
                  <IonCol className="pil-col">Expected</IonCol>
                  <IonCol className="pil-col">Actions</IonCol>
                </IonRow>

                {filteredAddOns.map((addOn) => (
                  <IonRow className="pil-row" key={addOn.id}>
                    <IonCol className="pil-col pil-col--img">
                      {addOn.image_url ? <IonImg className="pil-img" src={addOn.image_url} alt={addOn.name} /> : <span className="pil-muted">No image</span>}
                    </IonCol>

                    <IonCol className="pil-col pil-col--strong">{addOn.name}</IonCol>
                    <IonCol className="pil-col">{addOn.category}</IonCol>
                    <IonCol className="pil-col">{normSize(addOn.size) ?? "—"}</IonCol>
                    <IonCol className="pil-col">{money2(toNum(addOn.price))}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.restocked)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.sold)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.expired)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.inventory_loss)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.bilin)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.stocks)}</IonCol>
                    <IonCol className="pil-col">{toNum(addOn.expenses)}</IonCol>
                    <IonCol className="pil-col">{money2(toNum(addOn.overall_sales))}</IonCol>
                    <IonCol className="pil-col">{money2(toNum(addOn.expected_sales))}</IonCol>

                    <IonCol className="pil-col">
                      <div className="pil-actions-cell">
                        <IonButton className="pil-act-btn pil-act-btn--add" fill="clear" onClick={() => openRestock(addOn.id)}>
                          <IonIcon icon={addCircle} />
                        </IonButton>

                        <IonButton className="pil-act-btn" fill="clear" onClick={() => void openHistory(addOn.id)}>
                          <IonIcon icon={timeOutline} />
                        </IonButton>

                        <IonButton className="pil-act-btn pil-act-btn--edit" fill="clear" onClick={() => handleEdit(addOn.id)}>
                          <IonIcon icon={create} />
                        </IonButton>

                        <IonButton className="pil-act-btn pil-act-btn--del" fill="clear" color="danger" onClick={() => handleDelete(addOn.id)}>
                          <IonIcon icon={trash} />
                        </IonButton>
                      </div>
                    </IonCol>
                  </IonRow>
                ))}
              </IonGrid>
            </div>
          )}
        </div>

        <IonToast isOpen={showToast} message={toastMessage} duration={3000} onDidDismiss={() => setShowToast(false)} />

        {/* DELETE ALERT */}
        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this add-on? This will remove it from the database."
          buttons={[
            { text: "Cancel", role: "cancel", handler: () => setShowDeleteAlert(false) },
            { text: "Delete", role: "destructive", handler: () => void confirmDeleteRow() },
          ]}
        />

        {/* VOID ALERT */}
        <IonAlert
          isOpen={showVoidAlert}
          onDidDismiss={() => setShowVoidAlert(false)}
          header="Void Adjustment"
          message="Are you sure you want to void this adjustment? This will restore counters and mark the record as VOIDED."
          buttons={[
            { text: "Cancel", role: "cancel", handler: () => setShowVoidAlert(false) },
            { text: "Void", role: "destructive", handler: () => void doVoid() },
          ]}
        />

        {/* RESTOCK MODAL */}
        <IonModal isOpen={showRestockModal} onDidDismiss={() => setShowRestockModal(false)} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Add Stocks</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={() => setShowRestockModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              {restockingAddOn && (
                <>
                  <IonText>
                    <h2 style={{ marginTop: 0, marginBottom: 8 }}>{restockingAddOn.name}</h2>
                  </IonText>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Quantity to add *
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      inputMode="numeric"
                      value={restockQty}
                      placeholder="e.g. 10"
                      onIonChange={(e) => setRestockQty((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Note (optional)
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={restockNote}
                      placeholder="e.g. supplier restock / new batch"
                      onIonChange={(e) => setRestockNote((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <div className="pil-modal-actions">
                    <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={() => void submitRestock()}>
                      Confirm Restock
                    </IonButton>

                    <IonButton
                      className="pil-btn"
                      expand="block"
                      fill="outline"
                      onClick={() => {
                        setShowRestockModal(false);
                        setRestockingAddOn(null);
                        setRestockQty("");
                        setRestockNote("");
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>

        {/* HISTORY MODAL */}
        <IonModal isOpen={showHistoryModal} onDidDismiss={() => setShowHistoryModal(false)} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Adjustment History</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={() => setShowHistoryModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              {historyAddOn && (
                <IonText>
                  <h2 style={{ marginTop: 0, marginBottom: 8 }}>{historyAddOn.name}</h2>
                  <div style={{ opacity: 0.8, marginBottom: 10 }}>
                    Current Stock: <b>{historyAddOn.stocks}</b> • Overall: <b>{money2(historyAddOn.overall_sales)}</b>
                  </div>
                </IonText>
              )}

              {historyLoading ? (
                <div className="pil-loading">
                  <IonSpinner />
                  <IonLabel>Loading history...</IonLabel>
                </div>
              ) : historyRows.length === 0 ? (
                <div className="pil-empty">
                  <IonLabel>No adjustment records.</IonLabel>
                </div>
              ) : (
                <div className="pil-table-wrap">
                  <IonGrid className="pil-grid">
                    <IonRow className="pil-row pil-row--head">
                      <IonCol className="pil-col">Date</IonCol>
                      <IonCol className="pil-col">Type</IonCol>
                      <IonCol className="pil-col">Qty</IonCol>
                      <IonCol className="pil-col">Amount</IonCol>
                      <IonCol className="pil-col">By</IonCol>
                      <IonCol className="pil-col">Reason</IonCol>
                      <IonCol className="pil-col">Status</IonCol>
                      <IonCol className="pil-col">Action</IonCol>
                    </IonRow>

                    {historyRows.map((r) => (
                      <IonRow className="pil-row" key={r.id}>
                        <IonCol className="pil-col">{formatPH(r.created_at)}</IonCol>
                        <IonCol className="pil-col">{typeLabel(r.expense_type)}</IonCol>
                        <IonCol className="pil-col">{toNum(r.quantity)}</IonCol>
                        <IonCol className="pil-col">{money2(toNum(r.expense_amount))}</IonCol>
                        <IonCol className="pil-col">{r.full_name}</IonCol>
                        <IonCol className="pil-col">{r.description}</IonCol>
                        <IonCol className="pil-col">{r.voided ? "VOIDED" : "ACTIVE"}</IonCol>
                        <IonCol className="pil-col">
                          {!r.voided ? (
                            <IonButton className="pil-act-btn pil-act-btn--del" fill="clear" color="danger" onClick={() => confirmVoid(r)}>
                              <IonIcon icon={closeCircleOutline} />
                            </IonButton>
                          ) : (
                            <span className="pil-muted">—</span>
                          )}
                        </IonCol>
                      </IonRow>
                    ))}
                  </IonGrid>
                </div>
              )}

              <div className="pil-modal-actions">
                <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={() => void refreshHistory()} disabled={historyLoading}>
                  Refresh History
                </IonButton>
                <IonButton className="pil-btn" expand="block" fill="outline" onClick={() => setShowHistoryModal(false)}>
                  Close
                </IonButton>
              </div>
            </div>
          </IonContent>
        </IonModal>

        {/* EDIT MODAL */}
        <IonModal isOpen={showEditModal} onDidDismiss={() => setShowEditModal(false)} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Edit Add-On</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={() => setShowEditModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              {editingAddOn && (
                <>
                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Name
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={editingAddOn.name}
                      onIonChange={(e) => setEditingAddOn({ ...editingAddOn, name: (e.detail.value ?? "").toString() })}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Category
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={editingAddOn.category}
                      onIonChange={(e) => setEditingAddOn({ ...editingAddOn, category: (e.detail.value ?? "").toString() })}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Size (optional)
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={editingAddOn.size ?? ""}
                      placeholder='e.g. "Small", "Medium", "Large", "16oz"'
                      onIonChange={(e) => setEditingAddOn({ ...editingAddOn, size: (e.detail.value ?? "").toString() })}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Replace Image (optional)
                    </IonLabel>
                    <input
                      className="pil-file"
                      type="file"
                      accept="image/*"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const files: FileList | null = e.target.files;
                        setNewImageFile(files && files.length > 0 ? files[0] : null);
                      }}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Current Image
                    </IonLabel>
                    {editingAddOn.image_url ? (
                      <IonImg className="pil-img pil-img--big" src={editingAddOn.image_url} alt="current" />
                    ) : (
                      <span className="pil-muted">No image</span>
                    )}
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Price
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.price}
                      onIonChange={(e) => {
                        const v = parseFloat((e.detail.value ?? "0").toString());
                        setEditingAddOn({ ...editingAddOn, price: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Sold
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.sold}
                      onIonChange={(e) => {
                        const v = parseInt((e.detail.value ?? "0").toString(), 10);
                        setEditingAddOn({ ...editingAddOn, sold: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Expenses
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.expenses}
                      onIonChange={(e) => {
                        const v = parseFloat((e.detail.value ?? "0").toString());
                        setEditingAddOn({ ...editingAddOn, expenses: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  <div className="pil-modal-actions">
                    <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={() => void handleSaveEdit()}>
                      Save Changes
                    </IonButton>

                    <IonButton
                      className="pil-btn"
                      expand="block"
                      fill="outline"
                      onClick={() => {
                        setShowEditModal(false);
                        setEditingAddOn(null);
                        setNewImageFile(null);
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;
