// src/pages/Admin_customer_list.tsx
// ✅ Same logic as Customer_Lists + Admin tools
// ✅ Discount feature (same as Customer_Lists)
// ✅ Payment modal
// ✅ Date filter
// ✅ Export EXCEL (.xlsx) with ExcelJS + file-saver (logo embedded)
// ✅ Admin delete: single row + delete by date
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;
const DOWN_PAYMENT = 50;

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;
  date: string; // YYYY-MM-DD
  full_name: string;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string; // timestamptz
  time_ended: string; // timestamptz
  total_time: number | null; // minutes
  total_amount: number; // numeric
  reservation: string;
  reservation_date: string | null;
  seat_number: string;

  discount_kind?: DiscountKind;
  discount_value?: number;
  discount_reason?: string | null;

  gcash_amount?: number;
  cash_amount?: number;

  is_paid?: boolean | number | string | null;
  paid_at?: string | null;
}

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};


const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

const applyDiscount = (
  baseCost: number,
  kind: DiscountKind,
  value: number
): { discountedCost: number; discountAmount: number } => {
  const cost = Number.isFinite(baseCost) ? Math.max(0, baseCost) : 0;
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (kind === "percent") {
    const pct = clamp(v, 0, 100);
    const disc = round2((cost * pct) / 100);
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  if (kind === "amount") {
    const disc = round2(Math.min(cost, v));
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  return { discountedCost: round2(cost), discountAmount: 0 };
};

const diffMinutes = (startIso: string, endIso: string): number => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / (1000 * 60));
};

const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
  const minutesUsed = diffMinutes(startIso, endIso);
  const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
  const perMinute = HOURLY_RATE / 60;
  return round2(chargeMinutes * perMinute);
};

const formatMinutesToTime = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
  return `${hrs} hr ${mins} min`;
};

// keep gcash (clamp to due), cash = remaining
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

/* =========================
   Excel helpers
========================= */
const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
};

const isLikelyUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());

const Admin_customer_list: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(Date.now());

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // Discount modal
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // Payment modal
  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  useEffect(() => {
    void fetchCustomerSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const fetchCustomerSessions = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .neq("reservation", "yes")
      .order("date", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert("Error loading customer lists");
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions((data as CustomerSession[]) || []);
    setLoading(false);
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999;
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
    if (typeof s.total_time === "number" && Number.isFinite(s.total_time)) return Number(s.total_time || 0);
    return diffMinutes(s.time_started, s.time_ended);
  };

  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return computeCostWithFreeMinutes(s.time_started, new Date(nowTick).toISOString());
    return round2(Number(s.total_amount || 0));
  };

  const getDiscountInfo = (s: CustomerSession): { kind: DiscountKind; value: number; reason: string } => {
    const kind = (s.discount_kind ?? "none") as DiscountKind;
    const value = toMoney(s.discount_value ?? 0);
    const reason = String(s.discount_reason ?? "").trim();
    return { kind, value, reason };
  };

  const getDiscountText = (s: CustomerSession): string => {
    const di = getDiscountInfo(s);
    return getDiscountTextFrom(di.kind, di.value);
  };

  const getSessionTotalCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return applyDiscount(base, di.kind, di.value).discountedCost;
  };

  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return round2(Math.max(0, totalCost - DOWN_PAYMENT));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return round2(Math.max(0, DOWN_PAYMENT - totalCost));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalance(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChange(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = round2(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalMinutes = diffMinutes(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalMinutes,
          total_amount: totalCost,
          hour_avail: "CLOSED",
        })
        .eq("id", session.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const deleteSession = async (session: CustomerSession): Promise<void> => {
    const ok = window.confirm(`Delete this record?\n\n${session.full_name} (${session.date})`);
    if (!ok) return;

    try {
      setDeletingId(session.id);

      const { error } = await supabase.from("customer_sessions").delete().eq("id", session.id);

      if (error) {
        alert(`Delete error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setSelectedSession((prev) => (prev?.id === session.id ? null : prev));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) return;

    const ok = window.confirm(`Delete ALL records on date: ${selectedDate}?\n\nThis will remove them from the database.`);
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase.from("customer_sessions").delete().eq("date", selectedDate).neq("reservation", "yes");

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.date !== selectedDate));
      setSelectedSession(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string => (isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended));

  const renderStatus = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  // -----------------------
  // DISCOUNT MODAL
  // -----------------------
  const openDiscountModal = (s: CustomerSession): void => {
    const di = getDiscountInfo(s);
    setDiscountTarget(s);
    setDiscountKind(di.kind);
    setDiscountInput(String(Number.isFinite(di.value) ? di.value : 0));
    setDiscountReason(di.reason);
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const raw = Number(discountInput);
    const clean = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const finalValue = discountKind === "percent" ? clamp(clean, 0, 100) : clean;

    const base = getBaseSystemCost(discountTarget);
    const discounted = applyDiscount(base, discountKind, finalValue).discountedCost;
    const due = round2(Math.max(0, discounted - DOWN_PAYMENT));

    const prevPay = getPaidInfo(discountTarget);
    const adjPay = recalcPaymentsToDue(due, prevPay.gcash);

    const totalPaid = round2(adjPay.gcash + adjPay.cash);
    const autoPaid = due > 0 && totalPaid >= due;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),
          gcash_amount: adjPay.gcash,
          cash_amount: adjPay.cash,
          is_paid: autoPaid,
          paid_at: autoPaid ? new Date().toISOString() : null,
        })
        .eq("id", discountTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save discount error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === discountTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === discountTarget.id ? (updated as CustomerSession) : prev));
      setDiscountTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  // -----------------------
  // PAYMENT MODAL
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const due = getSessionBalance(s);
    const pi = getPaidInfo(s);

    const existingGcash = pi.totalPaid > 0 ? pi.gcash : 0;
    const adj = recalcPaymentsToDue(due, existingGcash);

    setPaymentTarget(s);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setGcashAndAutoCash = (s: CustomerSession, gcashStr: string): void => {
    const due = getSessionBalance(s);
    const gc = Math.max(0, toMoney(gcashStr));
    const adj = recalcPaymentsToDue(due, gc);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setCashAndAutoGcash = (s: CustomerSession, cashStr: string): void => {
    const due = round2(Math.max(0, getSessionBalance(s)));
    const ca = round2(Math.max(0, toMoney(cashStr)));

    const cash = round2(Math.min(due, ca));
    const gcash = round2(Math.max(0, due - cash));

    setCashInput(String(cash));
    setGcashInput(String(gcash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = getSessionBalance(paymentTarget);
    const gcIn = Math.max(0, toMoney(gcashInput));
    const adj = recalcPaymentsToDue(due, gcIn);

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due > 0 && totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          gcash_amount: adj.gcash,
          cash_amount: adj.cash,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === paymentTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === paymentTarget.id ? (updated as CustomerSession) : prev));
      setPaymentTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  // -----------------------
  // PAID toggle
  // -----------------------
  const togglePaid = async (s: CustomerSession): Promise<void> => {
    try {
      setTogglingPaidId(s.id);

      const currentPaid = toBool(s.is_paid);
      const nextPaid = !currentPaid;

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .eq("id", s.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Toggle paid error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((x) => (x.id === s.id ? (updated as CustomerSession) : x)));
      setSelectedSession((prev) => (prev?.id === s.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  // -----------------------
  // Export Excel (.xlsx) with embedded logo + nice layout
  // -----------------------
  const exportToExcel = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredSessions.length === 0) {
      alert("No records for selected date.");
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Me Tyme Lounge";
    wb.created = new Date();

    const ws = wb.addWorksheet("Non-Reservation", {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Columns (nice widths)
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Full Name", key: "full_name", width: 26 },
      { header: "Type", key: "customer_type", width: 14 },
      { header: "Field", key: "customer_field", width: 18 },
      { header: "Has ID", key: "has_id", width: 10 },
      { header: "Specific ID", key: "id_number", width: 16 },
      { header: "Hours", key: "hour_avail", width: 10 },
      { header: "Time In", key: "time_in", width: 10 },
      { header: "Time Out", key: "time_out", width: 10 },
      { header: "Total Time", key: "total_time", width: 14 },
      { header: "Amount Label", key: "amount_label", width: 16 },
      { header: "Amount", key: "amount", width: 12 },
      { header: "Discount", key: "discount_text", width: 12 },
      { header: "Discount Amount", key: "discount_amount", width: 16 },
      { header: "System Cost", key: "system_cost", width: 14 },
      { header: "GCash", key: "gcash", width: 12 },
      { header: "Cash", key: "cash", width: 12 },
      { header: "Total Paid", key: "total_paid", width: 12 },
      { header: "Remaining", key: "remaining", width: 12 },
      { header: "Paid?", key: "paid", width: 10 },
      { header: "Seat", key: "seat", width: 10 },
      { header: "Status", key: "status", width: 12 },
    ];

    // Top header
    ws.mergeCells("A1", "V1");
    ws.getCell("A1").value = "ME TYME LOUNGE — Admin Customer Lists (Non-Reservation)";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

    ws.mergeCells("A2", "V2");
    ws.getCell("A2").value = `Date: ${selectedDate}    •    Records: ${filteredSessions.length}`;
    ws.getCell("A2").font = { size: 11 };
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

    ws.getRow(1).height = 26;
    ws.getRow(2).height = 18;

    // Embed logo (if bundler resolves to URL)
    if (isLikelyUrl(logo)) {
      const ab = await fetchAsArrayBuffer(logo);
      if (ab) {
        const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
        const imgId = wb.addImage({ buffer: ab, extension: ext });
        ws.addImage(imgId, {
          tl: { col: 18.2, row: 0.2 }, // top-right
          ext: { width: 160, height: 60 },
        });
      }
    }

    // Header row index
    const headerRowIndex = 6;
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.values = ws.columns.map((c) => String(c.header ?? ""));
    headerRow.height = 20;

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.border = {
        top: { style: "thin", color: { argb: "FF9CA3AF" } },
        left: { style: "thin", color: { argb: "FF9CA3AF" } },
        bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
        right: { style: "thin", color: { argb: "FF9CA3AF" } },
      };
    });

    const moneyCols = new Set([
      "amount",
      "discount_amount",
      "system_cost",
      "gcash",
      "cash",
      "total_paid",
      "remaining",
    ]);

    filteredSessions.forEach((s, idx) => {
      const open = isOpenTimeSession(s);
      const totalMins = getDisplayedTotalMinutes(s);
      const disp = getDisplayAmount(s);

      const base = getBaseSystemCost(s);
      const di = getDiscountInfo(s);
      const calc = applyDiscount(base, di.kind, di.value);

      const pi = getPaidInfo(s);
      const due = getSessionBalance(s);
      const remaining = round2(Math.max(0, due - pi.totalPaid));
      const status = renderStatus(s);

      const row = ws.addRow({
        date: s.date,
        full_name: s.full_name,
        customer_type: s.customer_type,
        customer_field: s.customer_field ?? "",
        has_id: s.has_id ? "Yes" : "No",
        id_number: s.id_number ?? "N/A",
        hour_avail: s.hour_avail,
        time_in: formatTimeText(s.time_started),
        time_out: open ? "OPEN" : formatTimeText(s.time_ended),
        total_time: formatMinutesToTime(totalMins),
        amount_label: disp.label,
        amount: disp.value,
        discount_text: getDiscountTextFrom(di.kind, di.value),
        discount_amount: calc.discountAmount,
        system_cost: calc.discountedCost,
        gcash: pi.gcash,
        cash: pi.cash,
        total_paid: pi.totalPaid,
        remaining,
        paid: toBool(s.is_paid) ? "PAID" : "UNPAID",
        seat: s.seat_number,
        status,
      });

      const rowIndex = row.number;
      ws.getRow(rowIndex).height = 18;

      row.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: "middle", horizontal: colNumber === 2 ? "left" : "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };

        const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      });

      // money formatting
      ws.columns.forEach((c, i) => {
        if (!c.key) return;
        if (moneyCols.has(String(c.key))) {
          const cell = ws.getCell(rowIndex, i + 1);
          cell.numFmt = '"₱"#,##0.00;[Red]"₱"#,##0.00';
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }
      });

      // paid badge coloring (column 20 = Paid?)
      const paidCell = ws.getCell(rowIndex, 20);
      if (String(paidCell.value) === "PAID") {
        paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
        paidCell.font = { bold: true, color: { argb: "FF166534" } };
      } else {
        paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        paidCell.font = { bold: true, color: { argb: "FF991B1B" } };
      }
    });

    // Filter
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: ws.columns.length },
    };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    saveAs(blob, `admin-nonreservation-${selectedDate}.xlsx`);
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOP BAR (same as Customer_Lists) */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Customer Lists - Non Reservation</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong> ({filteredSessions.length})
              </div>
            </div>

            <div className="customer-topbar-right">
              <label className="date-pill">
                <span className="date-pill-label">Date</span>
                <input
                  className="date-pill-input"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
                />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>

              {/* admin tools beside date */}
              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={() => void exportToExcel()} disabled={filteredSessions.length === 0}>
                  Export to Excel
                </button>

                <button
                  className="receipt-btn admin-danger"
                  onClick={() => void deleteByDate()}
                  disabled={filteredSessions.length === 0 || deletingDate === selectedDate}
                >
                  {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
                </button>
              </div>
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No data found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Full Name</th>
                    <th>Type</th>
                    <th>Field</th>
                    <th>Has ID</th>
                    <th>Specific ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Time</th>
                    <th>Total Balance / Change</th>
                    <th>Discount</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Seat</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSessions.map((session) => {
                    const open = isOpenTimeSession(session);
                    const totalMins = getDisplayedTotalMinutes(session);
                    const disp = getDisplayAmount(session);

                    const due = getSessionBalance(session);
                    const pi = getPaidInfo(session);

                    return (
                      <tr key={session.id}>
                        <td>{session.date}</td>
                        <td>{session.full_name}</td>
                        <td>{session.customer_type}</td>
                        <td>{session.customer_field ?? ""}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.id_number ?? "N/A"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{renderTimeOut(session)}</td>

                        <td>{formatMinutesToTime(totalMins)}</td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value.toFixed(2)}</span>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountText(session)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>
                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={due <= 0}
                              title={due <= 0 ? "No balance due" : "Set GCash/Cash payment"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${toBool(session.is_paid) ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(session)}
                            disabled={togglingPaidId === session.id}
                            title={toBool(session.is_paid) ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidId === session.id ? "Updating..." : toBool(session.is_paid) ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>{session.seat_number}</td>
                        <td>{renderStatus(session)}</td>

                        <td>
                          <div className="action-stack">
                            {open && (
                              <button
                                className="receipt-btn"
                                disabled={stoppingId === session.id}
                                onClick={() => void stopOpenTime(session)}
                              >
                                {stoppingId === session.id ? "Stopping..." : "Stop Time"}
                              </button>
                            )}

                            <button className="receipt-btn" onClick={() => setSelectedSession(session)}>
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn admin-neutral"
                              disabled={deletingId === session.id}
                              onClick={() => void deleteSession(session)}
                            >
                              {deletingId === session.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* DISCOUNT MODAL */}
          {discountTarget && (
            <div className="receipt-overlay" onClick={() => setDiscountTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DISCOUNT</h3>
                <p className="receipt-subtitle">{discountTarget.full_name}</p>

                <hr />

                <div className="receipt-row">
                  <span>Discount Type</span>
                  <select value={discountKind} onChange={(e) => setDiscountKind(e.currentTarget.value as DiscountKind)}>
                    <option value="none">None</option>
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Peso (₱)</option>
                  </select>
                </div>

                <div className="receipt-row">
                  <span>Value</span>
                  <div className="inline-input">
                    <span className="inline-input-prefix">
                      {discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}
                    </span>
                    <input
                      className="small-input"
                      type="number"
                      min="0"
                      step={discountKind === "percent" ? "1" : "0.01"}
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.currentTarget.value)}
                      disabled={discountKind === "none"}
                    />
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Reason</span>
                  <input
                    className="reason-input"
                    type="text"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.currentTarget.value)}
                    placeholder="e.g. Student discount / Promo / Goodwill"
                  />
                </div>

                {(() => {
                  const base = getBaseSystemCost(discountTarget);
                  const val = toMoney(discountInput);
                  const appliedVal =
                    discountKind === "percent" ? clamp(Math.max(0, val), 0, 100) : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);
                  const due = round2(Math.max(0, discountedCost - DOWN_PAYMENT));

                  const prevPay = getPaidInfo(discountTarget);
                  const adjPay = recalcPaymentsToDue(due, prevPay.gcash);

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, appliedVal)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost</span>
                        <span>₱{discountedCost.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW TOTAL BALANCE</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Payment After Save</span>
                        <span>
                          GCash ₱{adjPay.gcash.toFixed(2)} / Cash ₱{adjPay.cash.toFixed(2)}
                        </span>
                      </div>
                    </>
                  );
                })()}

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDiscountTarget(null)} disabled={savingDiscount}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount}>
                    {savingDiscount ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT MODAL */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = getSessionBalance(paymentTarget);
                  const gcIn = Math.max(0, toMoney(gcashInput));
                  const adj = recalcPaymentsToDue(due, gcIn);

                  const totalPaid = round2(adj.gcash + adj.cash);
                  const remaining = round2(Math.max(0, due - totalPaid));

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total Balance (Due)</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashAndAutoCash(paymentTarget, e.currentTarget.value)}
                        />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashAndAutoGcash(paymentTarget, e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining</span>
                        <span>₱{remaining.toFixed(2)}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)} disabled={savingPayment}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment}>
                          {savingPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* RECEIPT MODAL */}
          {selectedSession && (
            <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Date</span>
                  <span>{selectedSession.date}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedSession.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Type</span>
                  <span>{selectedSession.customer_type}</span>
                </div>

                <div className="receipt-row">
                  <span>Field</span>
                  <span>{selectedSession.customer_field ?? ""}</span>
                </div>

                <div className="receipt-row">
                  <span>Seat</span>
                  <span>{selectedSession.seat_number}</span>
                </div>

                <hr />

                <div className="receipt-row">
                  <span>Time In</span>
                  <span>{formatTimeText(selectedSession.time_started)}</span>
                </div>

                <div className="receipt-row">
                  <span>Time Out</span>
                  <span>{renderTimeOut(selectedSession)}</span>
                </div>

                <div className="receipt-row">
                  <span>Total Time</span>
                  <span>{formatMinutesToTime(getDisplayedTotalMinutes(selectedSession))}</span>
                </div>

                {isOpenTimeSession(selectedSession) && (
                  <div className="block-top">
                    <button
                      className="receipt-btn btn-full"
                      disabled={stoppingId === selectedSession.id}
                      onClick={() => void stopOpenTime(selectedSession)}
                    >
                      {stoppingId === selectedSession.id ? "Stopping..." : "Stop Time (Set Time Out Now)"}
                    </button>
                  </div>
                )}

                <hr />

                {(() => {
                  const disp = getDisplayAmount(selectedSession);

                  const baseCost = getBaseSystemCost(selectedSession);
                  const di = getDiscountInfo(selectedSession);
                  const calc = applyDiscount(baseCost, di.kind, di.value);

                  const pi = getPaidInfo(selectedSession);
                  const due = getSessionBalance(selectedSession);
                  const remaining = round2(Math.max(0, due - pi.totalPaid));

                  return (
                    <>
                      <div className="receipt-row">
                        <span>{disp.label}</span>
                        <span>₱{disp.value.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(di.kind, di.value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{calc.discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost</span>
                        <span>₱{calc.discountedCost.toFixed(2)}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>₱{pi.gcash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>₱{pi.cash.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{pi.totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining Balance</span>
                        <span>₱{remaining.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="receipt-total">
                        <span>{disp.label.toUpperCase()}</span>
                        <span>₱{disp.value.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                <button className="close-btn" onClick={() => setSelectedSession(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_customer_list;
