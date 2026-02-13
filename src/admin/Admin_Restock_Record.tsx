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
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonInput,
  IonSpinner,
  IonModal,
  IonButtons,
  IonDatetime,
  IonAlert,
  IonToast,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import {
  refreshOutline,
  calendarOutline,
  closeCircleOutline,
  closeOutline,
  downloadOutline,
  trashOutline,
  createOutline,
  closeCircleOutline as voidIcon,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type FilterMode = "day" | "month";
type SourceKind = "add_ons" | "consignment";

/* =========================
   ADD-ONS TYPES (existing)
========================= */

type AddOnJoin = {
  name: string | null;
  category: string | null;
  image_url: string | null;
};

type AddOnJoinRaw = AddOnJoin | AddOnJoin[] | null;

interface RestockRecordRow {
  id: string;
  created_at: string;
  add_on_id: string;
  qty: number;
  add_ons: AddOnJoin | null;
}

type RestockRecordRaw = {
  id: unknown;
  created_at: unknown;
  add_on_id: unknown;
  qty: unknown;
  add_ons?: unknown;
};

/* =========================
   CONSIGNMENT RESTOCK TYPES
========================= */

type ConsRestockRow = {
  id: string;
  created_at: string;
  consignment_id: string;
  qty: number;

  full_name: string;
  category: string | null;
  item_name: string;
  size: string | null;
  image_url: string | null;
};

type ConsRestockRaw = {
  id: unknown;
  created_at: unknown;
  consignment_id: unknown;
  qty: unknown;
  full_name?: unknown;
  category?: unknown;
  item_name?: unknown;
  size?: unknown;
  image_url?: unknown;
};

/* =========================
   SAFE PARSERS
========================= */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const asStringOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const asNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const clampInt = (raw: string, fallback = 0): number => {
  const t = raw.trim();
  if (!t) return fallback;
  const n = Math.floor(Number(t));
  return Number.isFinite(n) ? n : fallback;
};

const normalizeAddOns = (v: unknown): AddOnJoin | null => {
  if (!v) return null;

  if (Array.isArray(v)) {
    const first = v[0];
    if (!isRecord(first)) return null;
    return {
      name: asStringOrNull(first.name),
      category: asStringOrNull(first.category),
      image_url: asStringOrNull(first.image_url),
    };
  }

  if (isRecord(v)) {
    return {
      name: asStringOrNull(v.name),
      category: asStringOrNull(v.category),
      image_url: asStringOrNull(v.image_url),
    };
  }

  return null;
};

const normalizeAddOnRow = (raw: unknown): RestockRecordRow | null => {
  if (!isRecord(raw)) return null;
  const r = raw as RestockRecordRaw;

  const id = asString(r.id);
  const created_at = asString(r.created_at);
  const add_on_id = asString(r.add_on_id);
  if (!id || !created_at || !add_on_id) return null;

  return {
    id,
    created_at,
    add_on_id,
    qty: asNumber(r.qty),
    add_ons: normalizeAddOns(r.add_ons as AddOnJoinRaw),
  };
};

const normalizeConsRow = (raw: unknown): ConsRestockRow | null => {
  if (!isRecord(raw)) return null;
  const r = raw as ConsRestockRaw;

  const id = asString(r.id);
  const created_at = asString(r.created_at);
  const consignment_id = asString(r.consignment_id);
  if (!id || !created_at || !consignment_id) return null;

  const full_name = asString(r.full_name);
  const item_name = asString(r.item_name);

  if (!full_name || !item_name) return null;

  return {
    id,
    created_at,
    consignment_id,
    qty: asNumber(r.qty),
    full_name,
    category: asStringOrNull(r.category),
    item_name,
    size: asStringOrNull(r.size),
    image_url: asStringOrNull(r.image_url),
  };
};

/* =========================
   DATE HELPERS
========================= */

const todayKey = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthKeyNow = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const dateKeyFromISO = (iso: string): string => iso.split("T")[0] || "";

const monthKeyFromISO = (iso: string): string => {
  const d = dateKeyFromISO(iso);
  return d.slice(0, 7);
};

const normalizeMonthValue = (v: string): string => {
  const base = v.split("T")[0];
  if (base.length >= 7) return base.slice(0, 7);
  return base;
};

const ymd = (d: Date): string => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

/* =========================
   EXCEL IMAGE HELPERS
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

const fetchImageBase64 = async (
  url: string
): Promise<{ base64: string; ext: "png" | "jpeg" }> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Image fetch failed");

  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  const blob = await r.blob();
  const base64 = await blobToBase64(blob);

  const isPng = ct.includes("png") || url.toLowerCase().includes(".png");
  const ext: "png" | "jpeg" = isPng ? "png" : "jpeg";
  return { base64, ext };
};

const Admin_Restock_Record: React.FC = () => {
  const [source, setSource] = useState<SourceKind>("add_ons");

  const [recordsAddOn, setRecordsAddOn] = useState<RestockRecordRow[]>([]);
  const [recordsCons, setRecordsCons] = useState<ConsRestockRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  const [search, setSearch] = useState<string>("");

  const [filterMode, setFilterMode] = useState<FilterMode>("day");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const [dateModalOpen, setDateModalOpen] = useState<boolean>(false);
  const [showDeleteFilterAlert, setShowDeleteFilterAlert] = useState(false);

  // ✅ EDIT EXACT VALUE (works for both)
  const [editOpen, setEditOpen] = useState(false);
  const [editQty, setEditQty] = useState<string>("0");

  const [editingAddOn, setEditingAddOn] = useState<RestockRecordRow | null>(null);
  const [editingCons, setEditingCons] = useState<ConsRestockRow | null>(null);

  const [voidAddOn, setVoidAddOn] = useState<RestockRecordRow | null>(null);
  const [voidCons, setVoidCons] = useState<ConsRestockRow | null>(null);

  const notify = (msg: string): void => {
    setToastMsg(msg);
    setToastOpen(true);
  };

  const fetchAddOnRecords = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("add_on_restocks")
      .select("id, created_at, add_on_id, qty, add_ons(name, category, image_url)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rawList: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const normalized = rawList
      .map((x) => normalizeAddOnRow(x))
      .filter((x): x is RestockRecordRow => x !== null);

    setRecordsAddOn(normalized);
  };

  const fetchConsRecords = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("consignment_restocks")
      .select("id, created_at, consignment_id, qty, full_name, category, item_name, size, image_url")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rawList: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const normalized = rawList
      .map((x) => normalizeConsRow(x))
      .filter((x): x is ConsRestockRow => x !== null);

    setRecordsCons(normalized);
  };

  const fetchRecords = async (): Promise<void> => {
    setLoading(true);
    try {
      if (source === "add_ons") await fetchAddOnRecords();
      else await fetchConsRecords();
    } catch (err) {
      console.error("Error fetching records:", err);
      notify("Failed to load restock records.");
      if (source === "add_ons") setRecordsAddOn([]);
      else setRecordsCons([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchRecords().then(() => event.detail.complete());
  };

  const activeDateLabel = useMemo(() => {
    if (filterMode === "day") return selectedDate || todayKey();
    return selectedMonth || monthKeyNow();
  }, [filterMode, selectedDate, selectedMonth]);

  const filteredAddOn = useMemo(() => {
    const q = search.trim().toLowerCase();

    return recordsAddOn.filter((r) => {
      if (filterMode === "day") {
        if (selectedDate && dateKeyFromISO(r.created_at) !== selectedDate) return false;
      } else {
        if (selectedMonth && monthKeyFromISO(r.created_at) !== selectedMonth) return false;
      }

      if (!q) return true;

      const name = (r.add_ons?.name ?? "").toLowerCase();
      const category = (r.add_ons?.category ?? "").toLowerCase();
      return name.includes(q) || category.includes(q);
    });
  }, [recordsAddOn, search, filterMode, selectedDate, selectedMonth]);

  const filteredCons = useMemo(() => {
    const q = search.trim().toLowerCase();

    return recordsCons.filter((r) => {
      if (filterMode === "day") {
        if (selectedDate && dateKeyFromISO(r.created_at) !== selectedDate) return false;
      } else {
        if (selectedMonth && monthKeyFromISO(r.created_at) !== selectedMonth) return false;
      }

      if (!q) return true;

      const item = (r.item_name ?? "").toLowerCase();
      const cat = (r.category ?? "").toLowerCase();
      const owner = (r.full_name ?? "").toLowerCase();
      return item.includes(q) || cat.includes(q) || owner.includes(q);
    });
  }, [recordsCons, search, filterMode, selectedDate, selectedMonth]);

  const activeRowsCount =
    source === "add_ons" ? filteredAddOn.length : filteredCons.length;

  const totalQty = useMemo(() => {
    if (source === "add_ons")
      return filteredAddOn.reduce(
        (sum, r) => sum + (Number.isFinite(r.qty) ? r.qty : 0),
        0
      );
    return filteredCons.reduce(
      (sum, r) => sum + (Number.isFinite(r.qty) ? r.qty : 0),
      0
    );
  }, [source, filteredAddOn, filteredCons]);

  /* ✅ FIX 1: openCalendar (typed-safe) */
  function openCalendar(): void {
    setDateModalOpen(true);
  }

  const clearFilterValue = (): void => {
    if (filterMode === "day") setSelectedDate("");
    else setSelectedMonth("");
  };

  /* ==========================
     DB HELPERS (ADD-ONS)
  =========================== */

  const adjustRestockedAddOns = async (
    addOnId: string,
    delta: number
  ): Promise<void> => {
    if (!Number.isFinite(delta) || delta === 0) return;

    const { data: currentRow, error: readErr } = await supabase
      .from("add_ons")
      .select("restocked")
      .eq("id", addOnId)
      .single();

    if (readErr) throw readErr;

    const currentRestocked = asNumber(
      (currentRow as Record<string, unknown>)["restocked"]
    );
    const next = currentRestocked + delta;
    const safeNext = next < 0 ? 0 : next;

    const { error: upErr } = await supabase
      .from("add_ons")
      .update({ restocked: safeNext })
      .eq("id", addOnId);

    if (upErr) throw upErr;
  };

  /* ==========================
     DB HELPERS (CONSIGNMENT)
  =========================== */

  const adjustRestockedConsignment = async (
    consignmentId: string,
    delta: number
  ): Promise<void> => {
    if (!Number.isFinite(delta) || delta === 0) return;

    const { data: currentRow, error: readErr } = await supabase
      .from("consignment")
      .select("restocked")
      .eq("id", consignmentId)
      .single();

    if (readErr) throw readErr;

    const currentRestocked = asNumber(
      (currentRow as Record<string, unknown>)["restocked"]
    );
    const next = currentRestocked + delta;
    const safeNext = next < 0 ? 0 : next;

    const { error: upErr } = await supabase
      .from("consignment")
      .update({ restocked: safeNext })
      .eq("id", consignmentId);

    if (upErr) throw upErr;
  };

  /* ==========================
     VOID / EDIT / DELETE-BY-FILTER
  =========================== */

  const doVoidAddOnRow = async (row: RestockRecordRow): Promise<void> => {
    try {
      await adjustRestockedAddOns(row.add_on_id, -row.qty);
      const { error: delErr } = await supabase
        .from("add_on_restocks")
        .delete()
        .eq("id", row.id);
      if (delErr) throw delErr;

      setRecordsAddOn((prev) => prev.filter((x) => x.id !== row.id));
      notify("Voided. Restock and stocks reverted.");
    } catch (e) {
      console.error(e);
      notify("Failed to void record.");
    }
  };

  const doVoidConsRow = async (row: ConsRestockRow): Promise<void> => {
    try {
      await adjustRestockedConsignment(row.consignment_id, -row.qty);
      const { error: delErr } = await supabase
        .from("consignment_restocks")
        .delete()
        .eq("id", row.id);
      if (delErr) throw delErr;

      setRecordsCons((prev) => prev.filter((x) => x.id !== row.id));
      notify("Voided. Consignment restock reverted.");
    } catch (e) {
      console.error(e);
      notify("Failed to void consignment record.");
    }
  };

  const openEditAddOn = (row: RestockRecordRow): void => {
    setEditingAddOn(row);
    setEditingCons(null);
    setEditQty(String(row.qty));
    setEditOpen(true);
  };

  const openEditCons = (row: ConsRestockRow): void => {
    setEditingCons(row);
    setEditingAddOn(null);
    setEditQty(String(row.qty));
    setEditOpen(true);
  };

  const saveEditQty = async (): Promise<void> => {
    const newQty = clampInt(editQty, 0);
    if (newQty <= 0) {
      notify("Restock must be at least 1.");
      return;
    }

    try {
      // ADD-ONS
      if (editingAddOn) {
        const oldQty = editingAddOn.qty;
        const delta = newQty - oldQty;

        await adjustRestockedAddOns(editingAddOn.add_on_id, delta);

        const { data: upData, error: upErr } = await supabase
          .from("add_on_restocks")
          .update({ qty: newQty })
          .eq("id", editingAddOn.id)
          .select("id")
          .maybeSingle();

        if (upErr) throw upErr;
        if (!upData) {
          notify("Update blocked (check RLS policy).");
          return;
        }

        setRecordsAddOn((prev) =>
          prev.map((x) =>
            x.id === editingAddOn.id ? { ...x, qty: newQty } : x
          )
        );
        notify("Restock edited.");
      }

      // CONSIGNMENT
      if (editingCons) {
        const oldQty = editingCons.qty;
        const delta = newQty - oldQty;

        await adjustRestockedConsignment(editingCons.consignment_id, delta);

        const { data: upData, error: upErr } = await supabase
          .from("consignment_restocks")
          .update({ qty: newQty })
          .eq("id", editingCons.id)
          .select("id")
          .maybeSingle();

        if (upErr) throw upErr;
        if (!upData) {
          notify("Update blocked (check RLS policy).");
          return;
        }

        setRecordsCons((prev) =>
          prev.map((x) =>
            x.id === editingCons.id ? { ...x, qty: newQty } : x
          )
        );
        notify("Consignment restock edited.");
      }

      setEditOpen(false);
      setEditingAddOn(null);
      setEditingCons(null);
      void fetchRecords();
    } catch (e) {
      console.error(e);
      notify("Failed to edit restock.");
    }
  };

  const deleteByFilter = async (): Promise<void> => {
    try {
      if (source === "add_ons") {
        const rowsToDelete = filteredAddOn;
        if (rowsToDelete.length === 0) {
          notify("No records to delete for the selected filter.");
          setShowDeleteFilterAlert(false);
          return;
        }

        for (const r of rowsToDelete)
          await adjustRestockedAddOns(r.add_on_id, -r.qty);

        const ids = rowsToDelete.map((r) => r.id);
        const { error: delErr } = await supabase
          .from("add_on_restocks")
          .delete()
          .in("id", ids);
        if (delErr) throw delErr;

        setRecordsAddOn((prev) => prev.filter((x) => !ids.includes(x.id)));
        notify("Deleted add-ons records and reverted restock/stocks.");
      } else {
        const rowsToDelete = filteredCons;
        if (rowsToDelete.length === 0) {
          notify("No records to delete for the selected filter.");
          setShowDeleteFilterAlert(false);
          return;
        }

        for (const r of rowsToDelete)
          await adjustRestockedConsignment(r.consignment_id, -r.qty);

        const ids = rowsToDelete.map((r) => r.id);
        const { error: delErr } = await supabase
          .from("consignment_restocks")
          .delete()
          .in("id", ids);
        if (delErr) throw delErr;

        setRecordsCons((prev) => prev.filter((x) => !ids.includes(x.id)));
        notify("Deleted consignment restock records and reverted restock.");
      }
    } catch (e) {
      console.error(e);
      notify("Failed to delete by filter.");
    } finally {
      setShowDeleteFilterAlert(false);
    }
  };

  /* ==========================
     EXCEL EXPORT (switch by source)
  =========================== */

  const exportExcel = async (): Promise<void> => {
    try {
      const now = new Date();
      const modeLabel = filterMode === "day" ? "DAY" : "MONTH";
      const filterLabel =
        filterMode === "day"
          ? selectedDate || todayKey()
          : selectedMonth || monthKeyNow();

      const title =
        source === "add_ons"
          ? "ADD-ONS RESTOCK RECORDS REPORT"
          : "CONSIGNMENT RESTOCK RECORDS REPORT";

      const generated = `Generated: ${now.toLocaleString()}`;
      const info = `Source: ${source.toUpperCase()}   Mode: ${modeLabel}   Filter: ${filterLabel}   Search: ${
        search.trim() ? search.trim() : "—"
      }`;
      const summary = `Total Rows: ${activeRowsCount}   Total Restock Qty: ${totalQty}`;

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Restocks", {
        views: [{ state: "frozen", ySplit: 6 }],
      });

      // columns
      ws.columns =
        source === "add_ons"
          ? [
              { header: "Image", key: "image", width: 14 },
              { header: "Item Name", key: "name", width: 34 },
              { header: "Category", key: "category", width: 18 },
              { header: "Restock Qty", key: "qty", width: 14 },
              { header: "Restock Date", key: "date", width: 18 },
              { header: "Restock Time", key: "time", width: 14 },
            ]
          : [
              { header: "Image", key: "image", width: 14 },
              { header: "Item Name", key: "name", width: 34 },
              { header: "Owner", key: "owner", width: 22 },
              { header: "Category", key: "category", width: 18 },
              { header: "Restock Qty", key: "qty", width: 14 },
              { header: "Restock Date", key: "date", width: 18 },
              { header: "Restock Time", key: "time", width: 14 },
            ];

      const colCount = ws.columns.length;

      ws.mergeCells(1, 1, 1, colCount);
      ws.mergeCells(2, 1, 2, colCount);
      ws.mergeCells(3, 1, 3, colCount);
      ws.mergeCells(4, 1, 4, colCount);

      ws.getCell("A1").value = title;
      ws.getCell("A2").value = generated;
      ws.getCell("A3").value = info;
      ws.getCell("A4").value = summary;

      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A3").font = { size: 11 };
      ws.getCell("A4").font = { size: 11, bold: true };

      ws.addRow([]);

      /* ✅ FIX 2: headerRow.values (ExcelJS row.values is 1-based) */
      const headerRow = ws.getRow(6);
      const headers = ws.columns.map((c) => String(c.header ?? ""));
      headerRow.values = ["", ...headers];

      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;

      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      });

      let rowIndex = 7;

      if (source === "add_ons") {
        for (const r of filteredAddOn) {
          const row = ws.getRow(rowIndex);

          const name = r.add_ons?.name ?? "Unknown";
          const cat = r.add_ons?.category ?? "—";

          const d = new Date(r.created_at);
          const datePart = isNaN(d.getTime()) ? dateKeyFromISO(r.created_at) : ymd(d);
          const timePart = isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

          row.getCell(2).value = name;
          row.getCell(3).value = cat;
          row.getCell(4).value = Number(r.qty ?? 0);
          row.getCell(5).value = datePart;
          row.getCell(6).value = timePart;

          row.height = 52;

          for (let c = 1; c <= 6; c++) {
            const cell = row.getCell(c);
            cell.alignment =
              c === 2
                ? { vertical: "middle", horizontal: "left", wrapText: true }
                : { vertical: "middle", horizontal: "center" };
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }

          const imgUrl = r.add_ons?.image_url ?? null;
          if (imgUrl) {
            try {
              const { base64, ext } = await fetchImageBase64(imgUrl);
              const imgId = workbook.addImage({ base64, extension: ext });
              ws.addImage(imgId, {
                tl: { col: 0.15, row: rowIndex - 1 + 0.15 },
                ext: { width: 48, height: 48 },
              });
            } catch {
              // ignore
            }
          }

          row.commit();
          rowIndex++;
        }
      } else {
        for (const r of filteredCons) {
          const row = ws.getRow(rowIndex);

          const name = r.item_name ?? "Unknown";
          const owner = r.full_name ?? "—";
          const cat = r.category ?? "—";

          const d = new Date(r.created_at);
          const datePart = isNaN(d.getTime()) ? dateKeyFromISO(r.created_at) : ymd(d);
          const timePart = isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

          // columns: image | item | owner | category | qty | date | time
          row.getCell(2).value = name;
          row.getCell(3).value = owner;
          row.getCell(4).value = cat;
          row.getCell(5).value = Number(r.qty ?? 0);
          row.getCell(6).value = datePart;
          row.getCell(7).value = timePart;

          row.height = 52;

          for (let c = 1; c <= 7; c++) {
            const cell = row.getCell(c);
            cell.alignment =
              c === 2 || c === 3
                ? { vertical: "middle", horizontal: "left", wrapText: true }
                : { vertical: "middle", horizontal: "center" };
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }

          const imgUrl = r.image_url ?? null;
          if (imgUrl) {
            try {
              const { base64, ext } = await fetchImageBase64(imgUrl);
              const imgId = workbook.addImage({ base64, extension: ext });
              ws.addImage(imgId, {
                tl: { col: 0.15, row: rowIndex - 1 + 0.15 },
                ext: { width: 48, height: 48 },
              });
            } catch {
              // ignore
            }
          }

          row.commit();
          rowIndex++;
        }
      }

      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(blob, `restock_records_${source}_${filterLabel}.xlsx`);
      notify("Exported Excel successfully.");
    } catch (e) {
      console.error(e);
      notify("Export failed.");
    }
  };

  return (
    <IonPage>
      <IonHeader></IonHeader>

      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container restock-wrap">
          <div className="customer-topbar restock-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Restock Record</h2>
              <div className="customer-subtext">
                Source: <strong>{source === "add_ons" ? "Add-ons Restock" : "Consignment Restock"}</strong> • Showing records for:{" "}
                <strong>{activeDateLabel}</strong>{" "}
                <span style={{ marginLeft: 8 }}>
                  (Total: <strong>{activeRowsCount}</strong> | Qty: <strong>{totalQty}</strong>)
                </span>
              </div>

              {/* ✅ DROPDOWN SOURCE */}
              <div style={{ marginTop: 10, maxWidth: 320 }}>
                <IonItem lines="none" className="restock-ionitem">
                  <IonLabel position="stacked">Restock Source</IonLabel>
                  <IonSelect
                    value={source}
                    interface="popover"
                    onIonChange={(e) => setSource(String(e.detail.value) as SourceKind)}
                  >
                    <IonSelectOption value="add_ons">Add-ons Restock</IonSelectOption>
                    <IonSelectOption value="consignment">Consignment Restock</IonSelectOption>
                  </IonSelect>
                </IonItem>
              </div>
            </div>

            <div className="customer-topbar-right restock-actions">
              <IonButton className="receipt-btn" fill="outline" onClick={() => void exportExcel()}>
                <IonIcon icon={downloadOutline} slot="start" />
                Export Excel
              </IonButton>

              <IonButton
                className="receipt-btn"
                color="danger"
                fill="outline"
                onClick={() => setShowDeleteFilterAlert(true)}
              >
                <IonIcon icon={trashOutline} slot="start" />
                Delete By {filterMode === "day" ? "Date" : "Month"}
              </IonButton>

              <IonButton className="receipt-btn" fill="outline" onClick={() => void fetchRecords()}>
                <IonIcon icon={refreshOutline} slot="start" />
                Refresh
              </IonButton>
            </div>
          </div>

          <div className="restock-filters">
            <div className="restock-left">
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
                    placeholder={source === "add_ons" ? "Search item or category..." : "Search item / owner / category..."}
                  />

                  {search.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearch("")} type="button">
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="restock-right">
              <div className="restock-mode">
                <div className="restock-label">Mode</div>
                <IonItem lines="none" className="restock-ionitem">
                  <IonSelect
                    value={filterMode}
                    interface="popover"
                    onIonChange={(e) => setFilterMode(String(e.detail.value) as FilterMode)}
                  >
                    <IonSelectOption value="day">Day</IonSelectOption>
                    <IonSelectOption value="month">Month</IonSelectOption>
                  </IonSelect>
                </IonItem>
              </div>

              <label className="date-pill restock-datepill">
                <span className="date-pill-label">{filterMode === "day" ? "Date" : "Month"}</span>

                {/* ✅ use openCalendar */}
                <button type="button" className="restock-datebtn" onClick={openCalendar} title="Open calendar">
                  {activeDateLabel}
                </button>

                <button type="button" className="restock-iconbtn" onClick={openCalendar} title="Calendar">
                  <IonIcon icon={calendarOutline} />
                </button>

                <button
                  type="button"
                  className="restock-iconbtn"
                  disabled={filterMode === "day" ? !selectedDate : !selectedMonth}
                  onClick={clearFilterValue}
                  title="Clear filter"
                >
                  <IonIcon icon={closeCircleOutline} />
                </button>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="customer-note restock-loading">
              <IonSpinner />
              <span>Loading records…</span>
            </div>
          ) : activeRowsCount === 0 ? (
            <p className="customer-note">No restock records found.</p>
          ) : (
            <div className="customer-table-wrap restock-tablewrap" key={`${source}-${activeDateLabel}`}>
              <table className="customer-table restock-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Item Name</th>
                    {source === "consignment" ? <th>Owner</th> : null}
                    <th>Category</th>
                    <th>Restock</th>
                    <th>Restock Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {source === "add_ons"
                    ? filteredAddOn.map((r) => (
                        <tr key={r.id} className="restock-row">
                          <td>
                            {r.add_ons?.image_url ? (
                              <img className="restock-img" src={r.add_ons.image_url} alt={r.add_ons?.name ?? "item"} />
                            ) : (
                              <div className="restock-imgFallback">No Image</div>
                            )}
                          </td>

                          <td>
                            <div className="cell-stack">
                              <span className="cell-strong">{r.add_ons?.name ?? "Unknown Item"}</span>
                            </div>
                          </td>

                          <td>{r.add_ons?.category ?? "—"}</td>

                          <td>
                            <span className="pill pill--dark">{r.qty}</span>
                          </td>

                          <td>{formatDateTime(r.created_at)}</td>

                          <td>
                            <div className="action-stack action-stack--row">
                              <button className="receipt-btn" onClick={() => openEditAddOn(r)} title="Edit">
                                <IonIcon icon={createOutline} />
                                <span style={{ marginLeft: 6 }}>Edit</span>
                              </button>

                              <button className="receipt-btn btn-danger" onClick={() => setVoidAddOn(r)} title="Void">
                                <IonIcon icon={voidIcon} />
                                <span style={{ marginLeft: 6 }}>Void</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    : filteredCons.map((r) => (
                        <tr key={r.id} className="restock-row">
                          <td>
                            {r.image_url ? (
                              <img className="restock-img" src={r.image_url} alt={r.item_name ?? "item"} />
                            ) : (
                              <div className="restock-imgFallback">No Image</div>
                            )}
                          </td>

                          <td>
                            <div className="cell-stack">
                              <span className="cell-strong">{r.item_name ?? "Unknown Item"}</span>
                            </div>
                          </td>

                          <td>{r.full_name}</td>
                          <td>{r.category ?? "—"}</td>

                          <td>
                            <span className="pill pill--dark">{r.qty}</span>
                          </td>

                          <td>{formatDateTime(r.created_at)}</td>

                          <td>
                            <div className="action-stack action-stack--row">
                              <button className="receipt-btn" onClick={() => openEditCons(r)} title="Edit">
                                <IonIcon icon={createOutline} />
                                <span style={{ marginLeft: 6 }}>Edit</span>
                              </button>

                              <button className="receipt-btn btn-danger" onClick={() => setVoidCons(r)} title="Void">
                                <IonIcon icon={voidIcon} />
                                <span style={{ marginLeft: 6 }}>Void</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CALENDAR MODAL */}
          <IonModal isOpen={dateModalOpen} onDidDismiss={() => setDateModalOpen(false)}>
            <IonHeader>
              <IonToolbar>
                <IonTitle>{filterMode === "day" ? "Select Date" : "Select Month"}</IonTitle>
                <IonButtons slot="end">
                  <IonButton onClick={() => setDateModalOpen(false)}>
                    <IonIcon icon={closeOutline} />
                  </IonButton>
                </IonButtons>
              </IonToolbar>
            </IonHeader>

            <IonContent className="ion-padding restock-calendar">
              {filterMode === "day" ? (
                <IonDatetime
                  presentation="date"
                  value={(selectedDate || todayKey()) + "T00:00:00"}
                  onIonChange={(e) => {
                    const val = (e.detail.value ?? "").toString();
                    if (!val) return;
                    setSelectedDate(val.split("T")[0]);
                  }}
                />
              ) : (
                <IonDatetime
                  presentation="month-year"
                  value={(selectedMonth || monthKeyNow()) + "-01T00:00:00"}
                  onIonChange={(e) => {
                    const val = (e.detail.value ?? "").toString();
                    if (!val) return;
                    setSelectedMonth(normalizeMonthValue(val));
                  }}
                />
              )}

              <IonButton expand="block" className="restock-done" onClick={() => setDateModalOpen(false)}>
                Done
              </IonButton>
            </IonContent>
          </IonModal>

          {/* DELETE BY FILTER */}
          <IonAlert
            isOpen={showDeleteFilterAlert}
            onDidDismiss={() => setShowDeleteFilterAlert(false)}
            header={`Delete by ${filterMode === "day" ? "Date" : "Month"}?`}
            message={
              filterMode === "day"
                ? `This will DELETE all ${source === "add_ons" ? "ADD-ONS" : "CONSIGNMENT"} restock records for ${
                    selectedDate || todayKey()
                  } and REVERT restock. Continue?`
                : `This will DELETE all ${source === "add_ons" ? "ADD-ONS" : "CONSIGNMENT"} restock records for ${
                    selectedMonth || monthKeyNow()
                  } and REVERT restock. Continue?`
            }
            buttons={[
              { text: "Cancel", role: "cancel" },
              { text: "Delete", role: "destructive", handler: () => void deleteByFilter() },
            ]}
          />

          {/* VOID CONFIRM (ADD-ONS) */}
          <IonAlert
            isOpen={!!voidAddOn}
            onDidDismiss={() => setVoidAddOn(null)}
            header="VOID this restock?"
            message="This will revert restock/stocks and delete the record."
            buttons={[
              { text: "Cancel", role: "cancel", handler: () => setVoidAddOn(null) },
              {
                text: "VOID",
                role: "destructive",
                handler: () => {
                  if (voidAddOn) void doVoidAddOnRow(voidAddOn);
                  setVoidAddOn(null);
                },
              },
            ]}
          />

          {/* VOID CONFIRM (CONSIGNMENT) */}
          <IonAlert
            isOpen={!!voidCons}
            onDidDismiss={() => setVoidCons(null)}
            header="VOID this consignment restock?"
            message="This will revert consignment restock and delete the record."
            buttons={[
              { text: "Cancel", role: "cancel", handler: () => setVoidCons(null) },
              {
                text: "VOID",
                role: "destructive",
                handler: () => {
                  if (voidCons) void doVoidConsRow(voidCons);
                  setVoidCons(null);
                },
              },
            ]}
          />

          {/* EDIT MODAL */}
          <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
            <IonHeader>
              <IonToolbar>
                <IonTitle>Edit Restock</IonTitle>
                <IonButtons slot="end">
                  <IonButton onClick={() => setEditOpen(false)}>
                    <IonIcon icon={closeOutline} />
                  </IonButton>
                </IonButtons>
              </IonToolbar>
            </IonHeader>

            <IonContent className="ion-padding restock-edit">
              {editingAddOn && (
                <>
                  <div className="restock-editInfo">
                    <div>
                      <b>Item:</b> {editingAddOn.add_ons?.name ?? "Unknown"}
                    </div>
                    <div>
                      <b>Category:</b> {editingAddOn.add_ons?.category ?? "—"}
                    </div>
                    <div>
                      <b>Current Restock:</b> {editingAddOn.qty}
                    </div>
                    <div>
                      <b>Date:</b> {formatDateTime(editingAddOn.created_at)}
                    </div>
                  </div>

                  <IonItem>
                    <IonLabel position="stacked">New Restock (Exact Value)</IonLabel>
                    <IonInput
                      type="number"
                      value={editQty}
                      onIonChange={(e) => setEditQty((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <div className="restock-help">Change will affect only this row difference (delta).</div>

                  <div className="restock-editBtns">
                    <IonButton expand="block" onClick={() => void saveEditQty()}>
                      Save
                    </IonButton>

                    <IonButton
                      expand="block"
                      fill="clear"
                      onClick={() => {
                        setEditOpen(false);
                        setEditingAddOn(null);
                        setEditingCons(null);
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}

              {editingCons && (
                <>
                  <div className="restock-editInfo">
                    <div>
                      <b>Item:</b> {editingCons.item_name ?? "Unknown"}
                    </div>
                    <div>
                      <b>Owner:</b> {editingCons.full_name ?? "—"}
                    </div>
                    <div>
                      <b>Category:</b> {editingCons.category ?? "—"}
                    </div>
                    <div>
                      <b>Current Restock:</b> {editingCons.qty}
                    </div>
                    <div>
                      <b>Date:</b> {formatDateTime(editingCons.created_at)}
                    </div>
                  </div>

                  <IonItem>
                    <IonLabel position="stacked">New Restock (Exact Value)</IonLabel>
                    <IonInput
                      type="number"
                      value={editQty}
                      onIonChange={(e) => setEditQty((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <div className="restock-help">Change will affect only this row difference (delta).</div>

                  <div className="restock-editBtns">
                    <IonButton expand="block" onClick={() => void saveEditQty()}>
                      Save
                    </IonButton>

                    <IonButton
                      expand="block"
                      fill="clear"
                      onClick={() => {
                        setEditOpen(false);
                        setEditingAddOn(null);
                        setEditingCons(null);
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}
            </IonContent>
          </IonModal>

          <IonToast
            isOpen={toastOpen}
            message={toastMsg}
            duration={2500}
            onDidDismiss={() => setToastOpen(false)}
          />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Restock_Record;
