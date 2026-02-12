// src/pages/Staff_Consignment_Record.tsx
// ✅ NO DATE FILTER (shows ALL records)
// ✅ Date/Time shown in PH
// ✅ Overall Sales shown is NET (gross - 15%)
// ✅ MeTyme Commission shown (15% of gross)
// ✅ Remaining = NET Overall Sales - Cashouts (CASH+GCASH)
// ✅ Cash Out modal supports CASH + GCASH + history breakdown + payment_method
// ✅ SAME classnames as Customer_Add_ons.tsx (customer-* / receipt-btn)
// ✅ Category column (from consignment.category)
// ✅ Grouping: FULL NAME / CATEGORY (toggle)
// ✅ Action column in DETAILS: Edit / Restock / Delete
// ✅ Edit supports IMAGE UPLOAD (Supabase Storage) + replacing auto deletes old image
// ✅ Deleting row deletes image in Storage + DB row
// ✅ ✅ Export to Excel (nice layout) + embeds actual images
// ✅ STRICT TS: NO any

import React, { useEffect, useMemo, useState } from "react";
import { IonPage, IonContent, IonText } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type NumericLike = number | string;
type GroupBy = "full_name" | "category";
type PayMethod = "cash" | "gcash";

interface ConsignmentRow {
  id: string;
  created_at: string;

  full_name: string;
  category: string | null;

  item_name: string;
  size: string | null;
  image_url: string | null;

  price: NumericLike;
  restocked: number | null;
  sold: number | null;

  expected_sales: NumericLike | null; // net(85%) in DB (restocked*price*0.85)
  overall_sales: NumericLike | null; // gross in DB (sold*price)
  stocks: number | null;
}

interface CashOutRow {
  id: string;
  created_at: string;
  full_name: string;
  category: string | null;
  cashout_amount: NumericLike;
  payment_method: PayMethod;
  note: string | null;
}

interface CashOutRowNoCategory {
  id: string;
  created_at: string;
  full_name: string;
  cashout_amount: NumericLike;
  payment_method: PayMethod;
  note: string | null;
}

interface CashOutRowNoMethod {
  id: string;
  created_at: string;
  full_name: string;
  category: string | null;
  cashout_amount: NumericLike;
  note: string | null;
}

/* ---------------- helpers ---------------- */

const CONSIGNMENT_BUCKET = "consignment";

const toNumber = (v: NumericLike | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));
const moneyText = (n: number): string => `₱${round2(n).toFixed(2)}`;

const formatPHDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const show = (s: string | null | undefined, fallback = "-"): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : fallback;
};

const sizeText = (s: string | null | undefined): string => {
  const v = String(s ?? "").trim();
  return v.length ? v : "—";
};

const grossToNet = (gross: number): number => round2(gross * 0.85);
const grossToCommission = (gross: number): number => round2(gross * 0.15);

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
    return u.pathname.slice(idx + marker.length);
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
    console.error("Storage delete error:", error);
  }
};

const uploadConsignmentImage = async (file: File, bucket: string): Promise<string> => {
  const ext = safeExtFromName(file.name);
  const safeName = `consignment/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(safeName, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(safeName);
  const publicUrl = data?.publicUrl ?? "";
  if (!publicUrl) throw new Error("Failed to get public URL.");
  return publicUrl;
};

const labelPay = (m: PayMethod): string => (m === "gcash" ? "GCASH" : "CASH");

/* ---------------- excel helpers ---------------- */

type ImgData = { base64: string; extension: "png" | "jpeg" };

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") return reject(new Error("Invalid base64 result."));
      resolve(res);
    };
    reader.readAsDataURL(blob);
  });
};

const fetchImageAsBase64 = async (url: string): Promise<ImgData | null> => {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;

    const blob = await resp.blob();
    if (!blob.type.startsWith("image/")) return null;

    // exceljs only supports png/jpeg in practice
    const isPng = blob.type.includes("png");
    const ext: "png" | "jpeg" = isPng ? "png" : "jpeg";

    const dataUrl = await blobToBase64(blob);
    const commaIdx = dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

    if (!base64) return null;
    return { base64, extension: ext };
  } catch {
    return null;
  }
};

/* ---------------- money rules ---------------- */

type PersonAgg = {
  key: string;
  label: string;

  total_restock: number;
  total_sold: number;

  expected_total: number;
  gross_total: number;

  net_total: number; // 85%
  commission_total: number; // 15%

  cashout_cash: number;
  cashout_gcash: number;
  cashout_total: number;

  remaining: number; // net_total - cashouts
};

type EditForm = {
  full_name: string;
  category: string;
  item_name: string;
  size: string;
  price: string;
};

const Staff_Consignment_Record: React.FC = () => {
  const [salesRows, setSalesRows] = useState<ConsignmentRow[]>([]);
  const [cashouts, setCashouts] = useState<CashOutRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [searchText, setSearchText] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("full_name");

  // cashout modal
  const [cashoutTargetKey, setCashoutTargetKey] = useState<string | null>(null);
  const [cashoutTargetLabel, setCashoutTargetLabel] = useState<string>("");

  // ✅ two inputs
  const [cashAmount, setCashAmount] = useState<string>("");
  const [gcashAmount, setGcashAmount] = useState<string>("");

  const [cashoutNote, setCashoutNote] = useState<string>("");
  const [savingCashout, setSavingCashout] = useState<boolean>(false);

  // actions: edit/restock/delete
  const [editTarget, setEditTarget] = useState<ConsignmentRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    full_name: "",
    category: "",
    item_name: "",
    size: "",
    price: "",
  });
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // image upload state
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string>("");
  const [removeImage, setRemoveImage] = useState<boolean>(false);

  const [restockTarget, setRestockTarget] = useState<ConsignmentRow | null>(null);
  const [restockQty, setRestockQty] = useState<string>("");
  const [savingRestock, setSavingRestock] = useState<boolean>(false);

  const [deleteTarget, setDeleteTarget] = useState<ConsignmentRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // excel
  const [exporting, setExporting] = useState<boolean>(false);

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup preview object URL
  useEffect(() => {
    return () => {
      if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    };
  }, [newImagePreview]);

  const fetchAll = async (): Promise<void> => {
    setLoading(true);

    const { data: sales, error: sErr } = await supabase
      .from("consignment")
      .select(
        `
        id,
        created_at,
        full_name,
        category,
        item_name,
        size,
        image_url,
        price,
        restocked,
        sold,
        expected_sales,
        overall_sales,
        stocks
      `
      )
      .order("created_at", { ascending: false })
      .returns<ConsignmentRow[]>();

    if (sErr) {
      // eslint-disable-next-line no-console
      console.error("FETCH CONSIGNMENT ERROR:", sErr);
      setSalesRows([]);
      setCashouts([]);
      setLoading(false);
      return;
    }

    // 1) try: has category + payment_method
    const withCatMethod = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, category, cashout_amount, payment_method, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRow[]>();

    if (!withCatMethod.error) {
      const mapped = (withCatMethod.data ?? []).map((r) => ({
        ...r,
        payment_method: (String((r as unknown as { payment_method?: unknown }).payment_method ?? "cash").toLowerCase() === "gcash" ? "gcash" : "cash") as PayMethod,
      }));
      setSalesRows(sales ?? []);
      setCashouts(mapped);
      setLoading(false);
      return;
    }

    // 2) fallback: no category but has payment_method
    const noCatMethod = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, cashout_amount, payment_method, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRowNoCategory[]>();

    if (!noCatMethod.error) {
      const mapped: CashOutRow[] = (noCatMethod.data ?? []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        full_name: r.full_name,
        category: null,
        cashout_amount: r.cashout_amount,
        payment_method: (String((r as unknown as { payment_method?: unknown }).payment_method ?? "cash").toLowerCase() === "gcash" ? "gcash" : "cash") as PayMethod,
        note: r.note,
      }));
      setSalesRows(sales ?? []);
      setCashouts(mapped);
      setLoading(false);
      return;
    }

    // 3) last fallback: old table (no payment_method) -> treat as CASH
    const old = await supabase
      .from("consignment_cash_outs")
      .select("id, created_at, full_name, category, cashout_amount, note")
      .order("created_at", { ascending: false })
      .returns<CashOutRowNoMethod[]>();

    if (old.error) {
      // eslint-disable-next-line no-console
      console.error("FETCH CASH OUTS ERROR:", old.error);
      setSalesRows(sales ?? []);
      setCashouts([]);
      setLoading(false);
      return;
    }

    const mapped: CashOutRow[] = (old.data ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      full_name: r.full_name,
      category: r.category ?? null,
      cashout_amount: r.cashout_amount,
      payment_method: "cash",
      note: r.note,
    }));

    setSalesRows(sales ?? []);
    setCashouts(mapped);
    setLoading(false);
  };

  /* ---------------- build grouped summary ---------------- */

  const perKeyAggAll = useMemo<PersonAgg[]>(() => {
    const map = new Map<string, PersonAgg>();

    const getKeyAndLabel = (r: { full_name: string; category: string | null }): { key: string; label: string } => {
      if (groupBy === "category") {
        const label = show(r.category, "-");
        return { key: norm(label), label };
      }
      const label = show(r.full_name, "-");
      return { key: norm(label), label };
    };

    const getOrCreate = (key: string, label: string): PersonAgg => {
      const found = map.get(key);
      if (found) return found;

      const fresh: PersonAgg = {
        key,
        label,
        total_restock: 0,
        total_sold: 0,
        expected_total: 0,
        gross_total: 0,
        net_total: 0,
        commission_total: 0,
        cashout_cash: 0,
        cashout_gcash: 0,
        cashout_total: 0,
        remaining: 0,
      };

      map.set(key, fresh);
      return fresh;
    };

    for (const r of salesRows) {
      const { key, label } = getKeyAndLabel(r);
      const a = getOrCreate(key, label);

      const rest = Number(r.restocked ?? 0) || 0;
      const sold = Number(r.sold ?? 0) || 0;

      a.total_restock += rest;
      a.total_sold += sold;

      const expected = round2(toNumber(r.expected_sales));
      const gross = round2(toNumber(r.overall_sales));

      a.expected_total = round2(a.expected_total + expected);
      a.gross_total = round2(a.gross_total + gross);
    }

    for (const a of map.values()) {
      a.net_total = grossToNet(a.gross_total);
      a.commission_total = grossToCommission(a.gross_total);
    }

    for (const c of cashouts) {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      const key = norm(label);
      const a = getOrCreate(key, label);

      const amt = round2(toNumber(c.cashout_amount));
      if (c.payment_method === "gcash") a.cashout_gcash = round2(a.cashout_gcash + amt);
      else a.cashout_cash = round2(a.cashout_cash + amt);

      a.cashout_total = round2(a.cashout_cash + a.cashout_gcash);
    }

    for (const a of map.values()) {
      a.remaining = round2(Math.max(0, a.net_total - a.cashout_total));
    }

    return Array.from(map.values()).sort((x, y) => norm(x.label).localeCompare(norm(y.label)));
  }, [salesRows, cashouts, groupBy]);

  const perKeyAgg = useMemo<PersonAgg[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return perKeyAggAll;
    return perKeyAggAll.filter((p) => norm(p.label).includes(q));
  }, [perKeyAggAll, searchText]);

  const filteredRows = useMemo<ConsignmentRow[]>(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return salesRows;

    return salesRows.filter((r) => {
      const f = norm(r.full_name);
      const cat = norm(r.category);
      const it = norm(r.item_name);
      const sz = norm(r.size);
      return f.includes(q) || cat.includes(q) || it.includes(q) || sz.includes(q);
    });
  }, [salesRows, searchText]);

  const rowsCount = filteredRows.length;

  /* ---------------- export excel ---------------- */

  const exportToExcel = async (): Promise<void> => {
    try {
      setExporting(true);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Consignment System";
      wb.created = new Date();

      const ws = wb.addWorksheet("Consignment", {
        views: [{ state: "frozen", ySplit: 2 }], // freeze top title + header
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      // Title row
      const title = `Consignment Records (ALL) • Exported: ${formatPHDateTime(new Date().toISOString())}`;
      ws.addRow([title]);
      ws.mergeCells("A1:M1");
      const titleCell = ws.getCell("A1");
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { vertical: "middle", horizontal: "center" };
      ws.getRow(1).height = 26;

      // Header row
      const headers = [
        "Image",
        "Item Name",
        "Date/Time (PH)",
        "Full Name",
        "Category",
        "Size",
        "Price",
        "Restock",
        "Stock",
        "Sold",
        "Expected Sales",
        "Overall Sales (NET)",
        "MeTyme Commission",
      ];
      ws.addRow(headers);

      const headerRow = ws.getRow(2);
      headerRow.height = 20;
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

      // Column widths (nice layout)
      ws.columns = [
        { key: "img", width: 14 },
        { key: "item", width: 26 },
        { key: "dt", width: 22 },
        { key: "name", width: 24 },
        { key: "cat", width: 18 },
        { key: "size", width: 10 },
        { key: "price", width: 14 },
        { key: "rest", width: 10 },
        { key: "stock", width: 10 },
        { key: "sold", width: 10 },
        { key: "exp", width: 16 },
        { key: "net", width: 18 },
        { key: "comm", width: 18 },
      ];

      // Simple border helper
      const borderAll = {
        top: { style: "thin" as const },
        left: { style: "thin" as const },
        bottom: { style: "thin" as const },
        right: { style: "thin" as const },
      };

      // Body rows
      const startRow = 3; // after title+header
      for (let i = 0; i < filteredRows.length; i++) {
        const r = filteredRows[i];

        const price = round2(toNumber(r.price));
        const rest = Number(r.restocked ?? 0) || 0;
        const sold = Number(r.sold ?? 0) || 0;
        const stocks = Number(r.stocks ?? 0) || 0;

        const expected = round2(toNumber(r.expected_sales));
        const gross = round2(toNumber(r.overall_sales));
        const netOverall = grossToNet(gross);
        const commission = grossToCommission(gross);

        // add row (Image cell is empty string; image will be embedded)
        ws.addRow([
          "",
          show(r.item_name),
          formatPHDateTime(r.created_at),
          show(r.full_name),
          show(r.category),
          sizeText(r.size),
          price,
          rest,
          stocks,
          sold,
          expected,
          netOverall,
          commission,
        ]);

        const excelRowNum = startRow + i;
        const row = ws.getRow(excelRowNum);
        row.height = 56;

        // Style row
        for (let c = 1; c <= headers.length; c++) {
          const cell = row.getCell(c);
          cell.border = borderAll;
          cell.alignment = {
            vertical: "middle",
            horizontal: c === 2 || c === 4 || c === 5 ? "left" : "center",
            wrapText: true,
          };

          // number formats
          if (c === 7 || c === 11 || c === 12 || c === 13) cell.numFmt = '"₱"#,##0.00';
          if (c === 8 || c === 9 || c === 10) cell.numFmt = "0";
        }

        // Embed image if available
        if (r.image_url) {
          const img = await fetchImageAsBase64(r.image_url);
          if (img) {
            const imgId = wb.addImage({
              base64: img.base64,
              extension: img.extension,
            });

            // Put image inside A{row}
            // Using "tl/br" anchors. Row/col are 0-based in exceljs positioning.
          ws.addImage(imgId, {
            tl: { col: 0, row: excelRowNum - 1 },
            ext: { width: 64, height: 64 },
            editAs: "oneCell",
          });

          }
        }
      }

      // Borders for header row too
      for (let c = 1; c <= headers.length; c++) {
        const cell = ws.getRow(2).getCell(c);
        cell.border = borderAll;
      }

      // AutoFilter across header
      ws.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2, column: headers.length },
      };

      // Footer: totals (optional but nice)
      const totalsRowNum = startRow + filteredRows.length + 1;
      ws.addRow([]);
      ws.addRow([
        "TOTALS",
        "",
        "",
        "",
        "",
        "",
        "", // price
        "", // restock
        "", // stock
        "", // sold
        { formula: `SUM(K${startRow}:K${startRow + filteredRows.length - 1})` },
        { formula: `SUM(L${startRow}:L${startRow + filteredRows.length - 1})` },
        { formula: `SUM(M${startRow}:M${startRow + filteredRows.length - 1})` },
      ]);

      const totalsRow = ws.getRow(totalsRowNum);
      totalsRow.height = 20;
      totalsRow.font = { bold: true };
      for (let c = 1; c <= headers.length; c++) {
        const cell = totalsRow.getCell(c);
        cell.border = borderAll;
        cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
        if (c === 11 || c === 12 || c === 13) cell.numFmt = '"₱"#,##0.00';
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const fileName = `consignment_records_${new Date().toISOString().slice(0, 10)}.xlsx`;
      saveAs(blob, fileName);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  /* ---------------- cashout ---------------- */

  const openCashout = (agg: PersonAgg): void => {
    setCashoutTargetKey(agg.key);
    setCashoutTargetLabel(agg.label);

    setCashAmount("");
    setGcashAmount("");
    setCashoutNote("");
  };

  const cashoutHistoryForTarget = useMemo(() => {
    if (!cashoutTargetKey) return [];
    return cashouts.filter((c) => {
      const label = groupBy === "category" ? show(c.category, "-") : show(c.full_name, "-");
      return norm(label) === cashoutTargetKey;
    });
  }, [cashoutTargetKey, cashouts, groupBy]);

  const submitCashout = async (): Promise<void> => {
    if (!cashoutTargetKey) return;

    const cash = round2(Math.max(0, Number(cashAmount) || 0));
    const gcash = round2(Math.max(0, Number(gcashAmount) || 0));
    const total = round2(cash + gcash);

    if (total <= 0) {
      alert("Please enter CASH or GCASH amount (must be > 0).");
      return;
    }

    const target = perKeyAggAll.find((p) => p.key === cashoutTargetKey);
    const remaining = round2(target?.remaining ?? 0);

    if (total > remaining) {
      alert(`Insufficient remaining. Remaining: ${moneyText(remaining)}`);
      return;
    }

    try {
      setSavingCashout(true);

      // optional: if your RPC supports category, you can pass it
      const p_category = groupBy === "category" ? cashoutTargetLabel : null;

      const { error } = await supabase.rpc("cashout_consignment_oversale", {
        p_full_name: groupBy === "category" ? "CATEGORY" : cashoutTargetLabel,
        p_cash_amount: cash,
        p_gcash_amount: gcash,
        p_note: cashoutNote.trim() || null,
        p_category,
      });

      if (error) {
        alert(`Cash out error: ${error.message}`);
        return;
      }

      setCashoutTargetKey(null);
      setCashoutTargetLabel("");
      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Cash out failed.");
    } finally {
      setSavingCashout(false);
    }
  };

  /* ---------------- actions: edit/restock/delete ---------------- */

  const openEdit = (r: ConsignmentRow): void => {
    setEditTarget(r);
    setEditForm({
      full_name: show(r.full_name, ""),
      category: show(r.category, ""),
      item_name: show(r.item_name, ""),
      size: show(r.size, ""),
      price: String(toNumber(r.price) || ""),
    });

    setNewImageFile(null);
    if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    setNewImagePreview("");
    setRemoveImage(false);
  };

  const onPickImage = (file: File | null): void => {
    setNewImageFile(file);
    setRemoveImage(false);

    if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
    setNewImagePreview(file ? URL.createObjectURL(file) : "");
  };

  const saveEdit = async (): Promise<void> => {
    if (!editTarget) return;

    const full_name = editForm.full_name.trim();
    const category = editForm.category.trim();
    const item_name = editForm.item_name.trim();
    const size = editForm.size.trim();
    const priceNum = round2(Math.max(0, Number(editForm.price) || 0));

    if (!full_name) return alert("Full Name is required.");
    if (!item_name) return alert("Item Name is required.");
    if (priceNum <= 0) return alert("Price must be > 0.");

    try {
      setSavingEdit(true);

      const oldUrl = editTarget.image_url ?? null;
      let nextImageUrl: string | null = oldUrl;

      if (newImageFile) {
        const uploadedUrl = await uploadConsignmentImage(newImageFile, CONSIGNMENT_BUCKET);
        nextImageUrl = uploadedUrl;
      } else if (removeImage) {
        nextImageUrl = null;
      }

      const payload: {
        full_name: string;
        category: string | null;
        item_name: string;
        size: string | null;
        price: number;
        image_url: string | null;
      } = {
        full_name,
        category: category.length ? category : null,
        item_name,
        size: size.length ? size : null,
        price: priceNum,
        image_url: nextImageUrl,
      };

      const { error } = await supabase.from("consignment").update(payload).eq("id", editTarget.id);

      if (error) {
        alert(`Edit failed: ${error.message}`);
        return;
      }

      const changedImage = (oldUrl ?? null) !== (nextImageUrl ?? null);
      if (changedImage && oldUrl) await deleteStorageByUrl(oldUrl, CONSIGNMENT_BUCKET);

      setEditTarget(null);

      if (newImagePreview.startsWith("blob:")) URL.revokeObjectURL(newImagePreview);
      setNewImagePreview("");
      setNewImageFile(null);
      setRemoveImage(false);

      await fetchAll();
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSavingEdit(false);
    }
  };

  const openRestock = (r: ConsignmentRow): void => {
    setRestockTarget(r);
    setRestockQty("");
  };

  const saveRestock = async (): Promise<void> => {
    if (!restockTarget) return;

    const addQty = Math.max(0, Math.floor(Number(restockQty) || 0));
    if (addQty <= 0) {
      alert("Restock quantity must be > 0");
      return;
    }

    const current = Math.max(0, Math.floor(Number(restockTarget.restocked ?? 0) || 0));
    const next = current + addQty;

    try {
      setSavingRestock(true);

      const { error } = await supabase.from("consignment").update({ restocked: next }).eq("id", restockTarget.id);

      if (error) {
        alert(`Restock failed: ${error.message}`);
        return;
      }

      setRestockTarget(null);
      await fetchAll();
    } finally {
      setSavingRestock(false);
    }
  };

  const confirmDelete = (r: ConsignmentRow): void => setDeleteTarget(r);

  const doDelete = async (): Promise<void> => {
    if (!deleteTarget) return;

    try {
      setDeleting(true);

      await deleteStorageByUrl(deleteTarget.image_url ?? null, CONSIGNMENT_BUCKET);

      const { error } = await supabase.from("consignment").delete().eq("id", deleteTarget.id);

      if (error) {
        alert(`Delete failed: ${error.message}`);
        return;
      }

      setDeleteTarget(null);
      await fetchAll();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOPBAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Consignment Records</h2>
              <div className="customer-subtext">
                Showing: <strong>ALL</strong> • Rows: <strong>{rowsCount}</strong> • Groups: <strong>{perKeyAgg.length}</strong>
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="receipt-btn" onClick={() => setGroupBy("full_name")} style={{ opacity: groupBy === "full_name" ? 1 : 0.6 }}>
                  Group by Full Name
                </button>
                <button className="receipt-btn" onClick={() => setGroupBy("category")} style={{ opacity: groupBy === "category" ? 1 : 0.6 }}>
                  Group by Category
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
                    placeholder="Search fullname / category / item / size..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                  />

                  {searchText.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearchText("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={() => void fetchAll()} disabled={loading || exporting}>
                  Refresh
                </button>
                <button className="receipt-btn" onClick={() => void exportToExcel()} disabled={loading || exporting || filteredRows.length === 0} title="Exports the current filtered list">
                  {exporting ? "Exporting..." : "Export Excel"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : perKeyAgg.length === 0 ? (
            <p className="customer-note">No consignment data found.</p>
          ) : (
            <>
              {/* TOP SUMMARY TABLE */}
              <div className="customer-table-wrap" style={{ marginBottom: 14 }}>
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>{groupBy === "category" ? "Category" : "Full Name"}</th>
                      <th>Total Restock</th>
                      <th>Total Sold</th>
                      <th>Expected Sales</th>
                      <th>Overall Sales</th>
                      <th>MeTyme Commission</th>
                      <th>Cash Outs</th>
                      <th>Remaining</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {perKeyAgg.map((p) => (
                      <tr key={p.key}>
                        <td style={{ fontWeight: 1000 }}>{p.label}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_restock}</td>
                        <td style={{ fontWeight: 900 }}>{p.total_sold}</td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.expected_total)}</td>

                        {/* NET */}
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.net_total)}</td>

                        {/* 15% */}
                        <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(p.commission_total)}</td>

                        <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>
                          {moneyText(p.cashout_total)}
                          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                            Cash: {moneyText(p.cashout_cash)} • GCash: {moneyText(p.cashout_gcash)}
                          </div>
                        </td>

                        <td style={{ whiteSpace: "nowrap", fontWeight: 1100 }}>{moneyText(p.remaining)}</td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => openCashout(p)} disabled={p.remaining <= 0} title={p.remaining <= 0 ? "No remaining" : "Cash out"}>
                              Cash Out
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {groupBy === "category" ? (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    Note: For perfect cashouts when grouping by <b>Category</b>, your cashout table should store the category value too (column: <b>category</b>).
                  </div>
                ) : null}
              </div>

              {/* DETAILS TABLE */}
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Item Name</th>
                      <th>Date/Time (PH)</th>
                      <th>Full Name</th>
                      <th>Category</th>
                      <th>Size</th>
                      <th>Price</th>
                      <th>Restock</th>
                      <th>Stock</th>
                      <th>Sold</th>
                      <th>Expected Sales</th>
                      <th>Overall Sales</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((r) => {
                      const price = round2(toNumber(r.price));
                      const rest = Number(r.restocked ?? 0) || 0;
                      const sold = Number(r.sold ?? 0) || 0;
                      const stocks = Number(r.stocks ?? 0) || 0;

                      const expected = round2(toNumber(r.expected_sales));
                      const gross = round2(toNumber(r.overall_sales));
                      const netOverall = grossToNet(gross);

                      return (
                        <tr key={r.id}>
                          <td style={{ width: 86 }}>
                            {r.image_url ? (
                              <img
                                src={r.image_url}
                                alt={r.item_name}
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

                          <td style={{ fontWeight: 900 }}>{r.item_name || "-"}</td>
                          <td>{formatPHDateTime(r.created_at)}</td>
                          <td style={{ fontWeight: 900 }}>{show(r.full_name)}</td>
                          <td style={{ fontWeight: 900 }}>{show(r.category)}</td>
                          <td>{sizeText(r.size)}</td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 900 }}>{moneyText(price)}</td>
                          <td style={{ fontWeight: 900 }}>{rest}</td>
                          <td style={{ fontWeight: 900 }}>{stocks}</td>
                          <td style={{ fontWeight: 900 }}>{sold}</td>

                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(expected)}</td>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 1000 }}>{moneyText(netOverall)}</td>

                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button className="receipt-btn" onClick={() => openEdit(r)}>
                                Edit
                              </button>
                              <button className="receipt-btn" onClick={() => openRestock(r)}>
                                Restock
                              </button>
                              <button className="receipt-btn" onClick={() => confirmDelete(r)} style={{ opacity: 0.9 }}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* CASH OUT MODAL */}
          {cashoutTargetKey && (
            <div className="receipt-overlay" onClick={() => (savingCashout ? null : setCashoutTargetKey(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CASH OUT</h3>
                <p className="receipt-subtitle">
                  {groupBy === "category" ? "Category: " : "Full Name: "}
                  {cashoutTargetLabel}
                </p>

                <hr />

                {(() => {
                  const p = perKeyAggAll.find((x) => x.key === cashoutTargetKey);

                  const gross = round2(p?.gross_total ?? 0);
                  const net = grossToNet(gross);
                  const comm = grossToCommission(gross);

                  const remaining = round2(p?.remaining ?? 0);
                  const cash = round2(p?.cashout_cash ?? 0);
                  const gcash = round2(p?.cashout_gcash ?? 0);
                  const totalCashouts = round2(p?.cashout_total ?? 0);
                  const expected = round2(p?.expected_total ?? 0);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Expected Total</span>
                        <span>{moneyText(expected)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Overall Sales (NET)</span>
                        <span>{moneyText(net)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>MeTyme Commission (15%)</span>
                        <span>{moneyText(comm)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash Outs (Total)</span>
                        <span>{moneyText(totalCashouts)}</span>
                      </div>

                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ Cash</span>
                        <span>{moneyText(cash)}</span>
                      </div>
                      <div className="receipt-row" style={{ opacity: 0.9 }}>
                        <span> └ GCash</span>
                        <span>{moneyText(gcash)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span style={{ fontWeight: 1000 }}>{moneyText(remaining)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Cash Amount</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashAmount}
                          onChange={(e) => setCashAmount(e.currentTarget.value)}
                          placeholder="0.00"
                          disabled={savingCashout}
                        />
                      </div>

                      <div className="receipt-row" style={{ marginTop: 8 }}>
                        <span>GCash Amount</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashAmount}
                          onChange={(e) => setGcashAmount(e.currentTarget.value)}
                          placeholder="0.00"
                          disabled={savingCashout}
                        />
                      </div>

                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                        Total Cashout: <b>{moneyText(round2((Number(cashAmount) || 0) + (Number(gcashAmount) || 0)))}</b>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Note (optional)</div>
                        <textarea
                          value={cashoutNote}
                          onChange={(e) => setCashoutNote(e.currentTarget.value)}
                          placeholder="Example: payout / release / partial cashout..."
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
                          disabled={savingCashout}
                        />
                      </div>

                      <div style={{ marginTop: 14, fontWeight: 900 }}>Cash Out History (all time)</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {cashoutHistoryForTarget.length === 0 ? (
                          <div style={{ opacity: 0.8, fontSize: 13 }}>No cash outs yet.</div>
                        ) : (
                          cashoutHistoryForTarget.map((h) => (
                            <div
                              key={h.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: 10,
                                border: "1px solid rgba(0,0,0,0.10)",
                                borderRadius: 12,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 900 }}>
                                  {formatPHDateTime(h.created_at)} • {labelPay(h.payment_method)}
                                </div>
                                {h.note ? <div style={{ fontSize: 12, opacity: 0.8 }}>{h.note}</div> : null}
                              </div>
                              <div style={{ fontWeight: 1100, whiteSpace: "nowrap" }}>{moneyText(round2(toNumber(h.cashout_amount)))}</div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="modal-actions" style={{ marginTop: 16 }}>
                        <button className="receipt-btn" onClick={() => setCashoutTargetKey(null)} disabled={savingCashout}>
                          Close
                        </button>
                        <button className="receipt-btn" onClick={() => void submitCashout()} disabled={savingCashout}>
                          {savingCashout ? "Saving..." : "Cash Out"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* EDIT MODAL */}
          {editTarget && (
            <div className="receipt-overlay" onClick={() => (savingEdit ? null : setEditTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">EDIT CONSIGNMENT</h3>
                <p className="receipt-subtitle">{editTarget.item_name}</p>

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
                    ) : editTarget.image_url && !removeImage ? (
                      <img src={editTarget.image_url} alt="Current" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                      title="Remove image (will delete old image after saving)"
                    >
                      Remove Image
                    </button>

                    {newImageFile ? <div style={{ fontSize: 12, opacity: 0.8 }}>Selected: {newImageFile.name}</div> : null}
                    {removeImage && !newImageFile ? <div style={{ fontSize: 12, opacity: 0.8 }}>Image will be removed.</div> : null}
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Full Name *</span>
                  <input className="money-input" value={editForm.full_name} onChange={(e) => setEditForm((p) => ({ ...p, full_name: e.currentTarget.value }))} disabled={savingEdit} placeholder="Owner full name" />
                </div>

                <div className="receipt-row">
                  <span>Category</span>
                  <input className="money-input" value={editForm.category} onChange={(e) => setEditForm((p) => ({ ...p, category: e.currentTarget.value }))} disabled={savingEdit} placeholder="Optional category" />
                </div>

                <div className="receipt-row">
                  <span>Item Name *</span>
                  <input className="money-input" value={editForm.item_name} onChange={(e) => setEditForm((p) => ({ ...p, item_name: e.currentTarget.value }))} disabled={savingEdit} placeholder="Item name" />
                </div>

                <div className="receipt-row">
                  <span>Size</span>
                  <input className="money-input" value={editForm.size} onChange={(e) => setEditForm((p) => ({ ...p, size: e.currentTarget.value }))} disabled={savingEdit} placeholder="Optional size" />
                </div>

                <div className="receipt-row">
                  <span>Price *</span>
                  <input className="money-input" type="number" min="0" step="0.01" value={editForm.price} onChange={(e) => setEditForm((p) => ({ ...p, price: e.currentTarget.value }))} disabled={savingEdit} placeholder="0.00" />
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setEditTarget(null)} disabled={savingEdit}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void saveEdit()} disabled={savingEdit}>
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* RESTOCK MODAL */}
          {restockTarget && (
            <div className="receipt-overlay" onClick={() => (savingRestock ? null : setRestockTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">RESTOCK</h3>
                <p className="receipt-subtitle">
                  {restockTarget.item_name} • Current Restock: <b>{Math.max(0, Math.floor(Number(restockTarget.restocked ?? 0) || 0))}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Add Qty</span>
                  <input className="money-input" type="number" min="1" step="1" value={restockQty} onChange={(e) => setRestockQty(e.currentTarget.value)} placeholder="0" disabled={savingRestock} />
                </div>

                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>Example: current 10 + input 5 = 15</div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setRestockTarget(null)} disabled={savingRestock}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void saveRestock()} disabled={savingRestock}>
                    {savingRestock ? "Saving..." : "Restock"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DELETE CONFIRM MODAL */}
          {deleteTarget && (
            <div className="receipt-overlay" onClick={() => (deleting ? null : setDeleteTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DELETE ITEM</h3>
                <p className="receipt-subtitle">
                  Are you sure you want to delete <b>{deleteTarget.item_name}</b>?
                </p>

                <hr />

                <div style={{ display: "grid", gap: 8, fontSize: 13, opacity: 0.9 }}>
                  <div>
                    Full Name: <b>{show(deleteTarget.full_name)}</b>
                  </div>
                  <div>
                    Category: <b>{show(deleteTarget.category)}</b>
                  </div>
                  <div>
                    Stocks: <b>{Math.max(0, Math.floor(Number(deleteTarget.stocks ?? 0) || 0))}</b> • Sold: <b>{Math.max(0, Math.floor(Number(deleteTarget.sold ?? 0) || 0))}</b>
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

          {!loading && perKeyAgg.length === 0 && <IonText />}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Consignment_Record;
