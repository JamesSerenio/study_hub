// src/pages/Admin_customer_reservation.tsx
// ✅ Same classnames/layout as Admin_customer_list.tsx (one CSS)
// ✅ Date filter now supports RANGE: Day / Week / Month (uses reservation_date)
// ✅ Export EXCEL (.xlsx) supports Day / Week / Month
// ✅ Delete supports Day / Week / Month ✅ ALSO deletes related seat_blocked_times
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both) in table + receipt
// ✅ Discount + Discount Reason (saved, NOT shown on receipt UI)  (still stored in DB)
// ✅ Down Payment is EDITABLE (per reservation) like Admin_customer_list.tsx
// ✅ Payment modal = FREE INPUTS (NO LIMIT) like Admin_customer_list.tsx
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Delete single row ✅ ALSO deletes related seat_blocked_times
// ✅ Promo filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display
// ✅ Stop Time (OPEN) releases seat_blocked_times (end_at = now)
// ✅ No "any"
// ✅ Phone Number column (table + receipt + excel)
// ✅ Refresh button (same classname "receipt-btn")
// ✅ Search bar EXACT SAME UI as Admin_customer_list.tsx (customer-searchbar-inline + icon + clear)
// ✅ NEW FIX:
// - ALL MONEY VALUES are WHOLE NUMBERS ONLY
// - If value has decimal, ALWAYS ROUND UP
//   Example: 10.01 => 11, 10.99 => 11
// ✅ REMOVED:
// - customer_field
// - id_number
// - Field column
// - Specific ID column

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

type DiscountKind = "none" | "percent" | "amount";
type RangeMode = "day" | "week" | "month";

interface CustomerSession {
  id: string;
  date: string;
  full_name: string;

  phone_number?: string | null;

  customer_type: string;
  has_id: boolean;
  hour_avail: string;
  time_started: string;
  time_ended: string;

  total_time: number | string;
  total_amount: number | string;

  reservation: string;
  reservation_date: string | null;
  seat_number: string;

  down_payment?: number | string | null;

  discount_kind?: DiscountKind;
  discount_value?: number | string | null;
  discount_reason?: string | null;

  gcash_amount?: number | string | null;
  cash_amount?: number | string | null;

  is_paid?: boolean | number | string | null;
  paid_at?: string | null;
}

type SeatBlockedRow = {
  id: string;
  seat_number: string;
  start_at: string;
  end_at: string;
  source: string;
  note: string | null;
};

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseYmd = (ymd: string): Date => {
  const [yS, mS, dS] = String(ymd ?? "").split("-");
  const y = Number(yS);
  const m = Number(mS);
  const d = Number(dS);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date();
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const startOfWeekMonday = (ymd: string): string => {
  const dt = parseYmd(ymd);
  const day = dt.getDay();
  const diffToMonday = (day + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
  return yyyyMmDdLocal(dt);
};

const endOfWeekMonday = (ymd: string): string => {
  const start = parseYmd(startOfWeekMonday(ymd));
  start.setDate(start.getDate() + 6);
  return yyyyMmDdLocal(start);
};

const startOfMonth = (ymd: string): string => {
  const dt = parseYmd(ymd);
  const s = new Date(dt.getFullYear(), dt.getMonth(), 1);
  return yyyyMmDdLocal(s);
};

const endOfMonth = (ymd: string): string => {
  const dt = parseYmd(ymd);
  const e = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  return yyyyMmDdLocal(e);
};

const getRange = (mode: RangeMode, anchorYmd: string): { start: string; end: string; label: string } => {
  if (mode === "week") {
    const start = startOfWeekMonday(anchorYmd);
    const end = endOfWeekMonday(anchorYmd);
    return { start, end, label: `Week (${start} → ${end})` };
  }
  if (mode === "month") {
    const start = startOfMonth(anchorYmd);
    const end = endOfMonth(anchorYmd);
    const dt = parseYmd(anchorYmd);
    const monthName = dt.toLocaleString([], { month: "long", year: "numeric" });
    return { start, end, label: `Month (${monthName})` };
  }
  return { start: anchorYmd, end: anchorYmd, label: `Day (${anchorYmd})` };
};

const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ✅ whole peso, always round UP
const wholePeso = (n: number): number => Math.ceil(Math.max(0, Number.isFinite(n) ? n : 0));

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
  if (kind === "amount" && v > 0) return `₱${wholePeso(v)}`;
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
    const discRaw = (cost * pct) / 100;
    const finalRaw = Math.max(0, cost - discRaw);
    return { discountedCost: wholePeso(finalRaw), discountAmount: wholePeso(discRaw) };
  }

  if (kind === "amount") {
    const discRaw = Math.min(cost, v);
    const finalRaw = Math.max(0, cost - discRaw);
    return { discountedCost: wholePeso(finalRaw), discountAmount: wholePeso(discRaw) };
  }

  return { discountedCost: wholePeso(cost), discountAmount: 0 };
};

const splitSeats = (seatStr: string): string[] => {
  return String(seatStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toUpperCase() !== "N/A");
};

/* =========================
   Excel helpers (logo)
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

const colToLetter = (col: number): string => {
  let n = col;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const Admin_customer_reservation: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(Date.now());

  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  const [searchText, setSearchText] = useState<string>("");

  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [exporting, setExporting] = useState<boolean>(false);
  const [deletingRange, setDeletingRange] = useState<boolean>(false);

  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  useEffect(() => {
    void fetchReservations();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await fetchReservations();
    } catch (e) {
      console.error(e);
      alert("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const toNum = (v: number | string | null | undefined): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const isPromoType = (t: string | null | undefined): boolean => {
    const v = (t ?? "").trim().toLowerCase();
    return v === "promo";
  };

  const safePhone = (v: string | null | undefined): string => {
    const s = String(v ?? "").trim();
    return s || "N/A";
  };

  const getDownPayment = (s: CustomerSession): number => wholePeso(Math.max(0, toMoney(s.down_payment ?? 0)));

  const fetchReservations = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "yes")
      .neq("customer_type", "promo")
      .order("reservation_date", { ascending: false });

    if (error) {
      console.error(error);
      alert(`Error loading reservations: ${error.message}`);
      setSessions([]);
      setLoading(false);
      return;
    }

    const cleaned = ((data as CustomerSession[]) || []).filter((s) => !isPromoType(s.customer_type));
    setSessions(cleaned);
    setLoading(false);
  };

  const currentRange = useMemo(() => getRange(rangeMode, selectedDate), [rangeMode, selectedDate]);

  const filteredSessions = useMemo(() => {
    const { start, end } = currentRange;

    const byRange = sessions.filter((s) => {
      const d = String(s.reservation_date ?? "");
      if (!d) return false;
      return d >= start && d <= end;
    });

    const q = searchText.trim().toLowerCase();
    if (!q) return byRange;

    return byRange.filter((s) => {
      const name = String(s.full_name ?? "").toLowerCase();
      const phone = String(s.phone_number ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [sessions, currentRange, searchText]);

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999;
  };

  const diffMinutes = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.floor((end - start) / (1000 * 60));
  };

  const formatMinutesToTime = (minutes: number): string => {
    if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
    return `${hrs} hr ${mins} min`;
  };

  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return wholePeso(chargeMinutes * perMinute);
  };

  const getScheduledStartDateTime = (s: CustomerSession): Date => {
    const start = new Date(s.time_started);
    if (s.reservation_date) {
      const d = new Date(s.reservation_date);
      start.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return start;
  };

  const getStatus = (session: CustomerSession): string => {
    const now = new Date(nowTick);
    const start = getScheduledStartDateTime(session);
    const end = new Date(session.time_ended);

    if (now < start) return "Upcoming";
    if (now >= start && now <= end) return "Ongoing";
    return "Finished";
  };

  const canShowStopButton = (session: CustomerSession): boolean => {
    if (!isOpenTimeSession(session)) return false;
    const startMs = getScheduledStartDateTime(session).getTime();
    if (!Number.isFinite(startMs)) return false;
    return nowTick >= startMs;
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
    return toNum(s.total_time);
  };

  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return computeCostWithFreeMinutes(s.time_started, new Date(nowTick).toISOString());
    return wholePeso(toNum(s.total_amount));
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

  const getSessionSystemCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return wholePeso(applyDiscount(base, di.kind, di.value).discountedCost);
  };

  const getSessionBalanceAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, systemCost - dp));
  };

  const getSessionChangeAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return wholePeso(Math.max(0, dp - systemCost));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalanceAfterDP(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = wholePeso(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = wholePeso(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = wholePeso(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const renderTimeOut = (s: CustomerSession): string => (isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended));

  const releaseSeatBlocksNow = async (session: CustomerSession, nowIso: string): Promise<void> => {
    const seats = splitSeats(session.seat_number);
    if (seats.length === 0) return;

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("id, seat_number, start_at, end_at, source, note")
      .in("seat_number", seats)
      .eq("source", "reserved")
      .eq("start_at", session.time_started)
      .gt("end_at", nowIso);

    if (error) {
      console.warn("releaseSeatBlocksNow select:", error.message);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];

    if (rows.length === 0) {
      const { error: upErr } = await supabase
        .from("seat_blocked_times")
        .update({ end_at: nowIso, note: "stopped (fallback)" })
        .in("seat_number", seats)
        .eq("source", "reserved")
        .gt("end_at", nowIso);

      if (upErr) {
        console.warn("releaseSeatBlocksNow fallback update:", upErr.message);
      }
      return;
    }

    const ids = rows.map((r) => r.id);

    const { error: upErr } = await supabase.from("seat_blocked_times").update({ end_at: nowIso, note: "stopped" }).in("id", ids);

    if (upErr) {
      console.warn("releaseSeatBlocksNow update:", upErr.message);
    }
  };

  const deleteSeatBlocksForSession = async (session: CustomerSession): Promise<void> => {
    const seats = splitSeats(session.seat_number);
    if (seats.length === 0) return;

    const { error } = await supabase
      .from("seat_blocked_times")
      .delete()
      .in("seat_number", seats)
      .eq("source", "reserved")
      .eq("start_at", session.time_started);

    if (error) {
      console.warn("deleteSeatBlocksForSession error:", error.message);
    }
  };

  const deleteSeatBlocksForList = async (list: CustomerSession[]): Promise<void> => {
    for (const s of list) {
      await deleteSeatBlocksForSession(s);
    }
  };

  const stopReservationTime = async (session: CustomerSession): Promise<void> => {
    if (!canShowStopButton(session)) {
      alert("Stop Time is only allowed when the reservation date/time has started.");
      return;
    }

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

      await releaseSeatBlocksNow(session, nowIso);

      setSessions((prev) => {
        const next = prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s));
        return next.filter((s) => !isPromoType(s.customer_type));
      });

      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const deleteSession = async (session: CustomerSession): Promise<void> => {
    const ok = window.confirm(
      `Delete this reservation record?\n\n${session.full_name}\nPhone: ${safePhone(session.phone_number)}\nReservation Date: ${
        session.reservation_date ?? "N/A"
      }`
    );
    if (!ok) return;

    try {
      setDeletingId(session.id);

      await deleteSeatBlocksForSession(session);

      const { error } = await supabase.from("customer_sessions").delete().eq("id", session.id);

      if (error) {
        alert(`Delete error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setSelectedSession((prev) => (prev?.id === session.id ? null : prev));
    } catch (e) {
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteByRange = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const { start, end, label } = currentRange;

    const rangeRows = sessions.filter((s) => {
      const d = String(s.reservation_date ?? "");
      return d && d >= start && d <= end && String(s.reservation ?? "") === "yes" && !isPromoType(s.customer_type);
    });

    if (rangeRows.length === 0) {
      alert("No reservation records found for this range.");
      return;
    }

    const ok = window.confirm(
      `Delete ALL reservation records for:\n${label}\n\nThis will delete ${rangeRows.length} record(s) from the database.\n\n⚠️ This also deletes related seat_blocked_times.`
    );
    if (!ok) return;

    try {
      setDeletingRange(true);

      await deleteSeatBlocksForList(rangeRows);

      let q = supabase.from("customer_sessions").delete().eq("reservation", "yes").neq("customer_type", "promo");
      q = q.gte("reservation_date", start).lte("reservation_date", end);

      const { error } = await q;
      if (error) {
        alert(`Delete range error: ${error.message}`);
        return;
      }

      setSessions((prev) =>
        prev.filter((s) => {
          const d = String(s.reservation_date ?? "");
          if (!d) return true;
          if (String(s.reservation ?? "") !== "yes") return true;
          if (isPromoType(s.customer_type)) return true;
          return !(d >= start && d <= end);
        })
      );

      setSelectedSession((prev) => {
        const d = String(prev?.reservation_date ?? "");
        if (!prev) return null;
        if (!d) return prev;
        return d >= start && d <= end ? null : prev;
      });
    } catch (e) {
      console.error(e);
      alert("Delete range failed.");
    } finally {
      setDeletingRange(false);
    }
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

    const dp = getDownPayment(discountTarget);
    const dueForPayment = wholePeso(Math.max(0, discounted - dp));

    const prevPay = getPaidInfo(discountTarget);
    const totalPaid = wholePeso(prevPay.gcash + prevPay.cash);
    const autoPaid = dueForPayment <= 0 ? true : totalPaid >= dueForPayment;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),
          gcash_amount: prevPay.gcash,
          cash_amount: prevPay.cash,
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
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  // -----------------------
  // DOWN PAYMENT MODAL
  // -----------------------
  const openDpModal = (s: CustomerSession): void => {
    setDpTarget(s);
    setDpInput(String(getDownPayment(s)));
  };

  const saveDownPayment = async (): Promise<void> => {
    if (!dpTarget) return;

    const raw = Number(dpInput);
    const dp = wholePeso(Math.max(0, Number.isFinite(raw) ? raw : 0));

    const base = getBaseSystemCost(dpTarget);
    const di = getDiscountInfo(dpTarget);
    const systemCost = applyDiscount(base, di.kind, di.value).discountedCost;
    const due = wholePeso(Math.max(0, systemCost - dp));

    const prevPay = getPaidInfo(dpTarget);
    const totalPaid = wholePeso(prevPay.gcash + prevPay.cash);
    const autoPaid = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingDp(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          down_payment: dp,
          is_paid: autoPaid,
          paid_at: autoPaid ? new Date().toISOString() : null,
        })
        .eq("id", dpTarget.id)
        .select("*")
        .single();

      if (error || !updated) {
        alert(`Save down payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === dpTarget.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === dpTarget.id ? (updated as CustomerSession) : prev));
      setDpTarget(null);
    } catch (e) {
      console.error(e);
      alert("Save down payment failed.");
    } finally {
      setSavingDp(false);
    }
  };

  // -----------------------
  // PAYMENT MODAL
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const pi = getPaidInfo(s);
    setPaymentTarget(s);
    setGcashInput(String(pi.gcash));
    setCashInput(String(pi.cash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = wholePeso(Math.max(0, getSessionBalanceAfterDP(paymentTarget)));

    const g = wholePeso(Math.max(0, toMoney(gcashInput)));
    const c = wholePeso(Math.max(0, toMoney(cashInput)));
    const totalPaid = wholePeso(g + c);

    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          gcash_amount: g,
          cash_amount: c,
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
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  // -----------------------
  // PAID / UNPAID TOGGLE
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
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  /* =========================
     Export Excel
  ========================= */
  const exportToExcel = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredSessions.length === 0) {
      alert("No records for this range.");
      return;
    }

    try {
      setExporting(true);

      const { start, end, label } = currentRange;

      const wb = new ExcelJS.Workbook();
      wb.creator = "Me Tyme Lounge";
      wb.created = new Date();

      const ws = wb.addWorksheet("Reservations", {
        views: [{ state: "frozen", ySplit: 6 }],
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      ws.columns = [
        { header: "Reservation Date", key: "reservation_date", width: 16 },
        { header: "Full Name", key: "full_name", width: 26 },
        { header: "Phone Number", key: "phone_number", width: 16 },
        { header: "Has ID", key: "has_id", width: 10 },
        { header: "Hours", key: "hours", width: 10 },
        { header: "Time In", key: "time_in", width: 10 },
        { header: "Time Out", key: "time_out", width: 10 },
        { header: "Total Time", key: "total_time", width: 14 },

        { header: "Amount Label", key: "amount_label", width: 14 },
        { header: "Amount", key: "amount", width: 12 },

        { header: "Discount", key: "discount", width: 12 },
        { header: "Discount Amount", key: "discount_amount", width: 16 },

        { header: "Down Payment", key: "down_payment", width: 14 },
        { header: "System Cost", key: "system_cost", width: 14 },

        { header: "GCash", key: "gcash", width: 12 },
        { header: "Cash", key: "cash", width: 12 },
        { header: "Total Paid", key: "total_paid", width: 12 },

        { header: "Remaining (After DP)", key: "remaining", width: 18 },
        { header: "Paid?", key: "paid", width: 10 },
        { header: "Seat", key: "seat", width: 12 },
        { header: "Status", key: "status", width: 12 },
      ];

      const lastColLetter = colToLetter(ws.columns.length);

      ws.mergeCells(`A1:${lastColLetter}1`);
      ws.getCell("A1").value = "ME TYME LOUNGE — RESERVATIONS REPORT";
      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
      ws.getRow(1).height = 26;

      ws.mergeCells(`A2:${lastColLetter}2`);
      ws.getCell("A2").value = `Range: ${label}${rangeMode === "day" ? "" : `  •  (${start} → ${end})`}   •   Records: ${filteredSessions.length}`;
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
      ws.getRow(2).height = 18;

      const generatedAt = new Date();
      ws.mergeCells(`A3:${lastColLetter}3`);
      ws.getCell("A3").value = `Generated: ${generatedAt.toLocaleString()}`;
      ws.getCell("A3").font = { size: 11 };
      ws.getCell("A3").alignment = { vertical: "middle", horizontal: "left" };
      ws.getRow(3).height = 18;

      ws.getRow(5).height = 6;

      if (isLikelyUrl(logo)) {
        const ab = await fetchAsArrayBuffer(logo);
        if (ab) {
          const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
          const imgId = wb.addImage({ buffer: ab, extension: ext });
          ws.addImage(imgId, {
            tl: { col: Math.max(0, ws.columns.length - 5.8), row: 0.2 },
            ext: { width: 160, height: 60 },
          });
        }
      }

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

      const moneyCols = new Set(["amount", "discount_amount", "down_payment", "system_cost", "gcash", "cash", "total_paid", "remaining"]);

      filteredSessions.forEach((s, idx) => {
        const open = isOpenTimeSession(s);
        const mins = getDisplayedTotalMinutes(s);
        const disp = getDisplayAmount(s);

        const base = getBaseSystemCost(s);
        const di = getDiscountInfo(s);
        const calc = applyDiscount(base, di.kind, di.value);

        const dp = getDownPayment(s);

        const pi = getPaidInfo(s);
        const dueAfterDp = getSessionBalanceAfterDP(s);
        const remaining = wholePeso(Math.max(0, dueAfterDp - pi.totalPaid));
        const status = getStatus(s);

        const row = ws.addRow({
          reservation_date: String(s.reservation_date ?? ""),
          full_name: s.full_name,
          phone_number: safePhone(s.phone_number),
          has_id: s.has_id ? "Yes" : "No",
          hours: s.hour_avail,
          time_in: String(formatTimeText(s.time_started)),
          time_out: open ? "OPEN" : String(formatTimeText(s.time_ended)),
          total_time: formatMinutesToTime(mins),

          amount_label: disp.label,
          amount: disp.value,

          discount: getDiscountTextFrom(di.kind, di.value),
          discount_amount: calc.discountAmount,

          down_payment: dp,
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

        const textCols = [1, 3, 6, 7];
        textCols.forEach((c) => {
          const cell = ws.getCell(rowIndex, c);
          cell.numFmt = "@";
          if (cell.value != null) cell.value = String(cell.value);
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });

        ws.columns.forEach((c, i) => {
          const key = String(c.key ?? "");
          if (moneyCols.has(key)) {
            const cell = ws.getCell(rowIndex, i + 1);
            cell.numFmt = '"₱"#,##0';
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }
        });

        const paidColIndex = ws.columns.findIndex((c) => String(c.key) === "paid") + 1;
        if (paidColIndex > 0) {
          const paidCell = ws.getCell(rowIndex, paidColIndex);
          if (String(paidCell.value) === "PAID") {
            paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
            paidCell.font = { bold: true, color: { argb: "FF166534" } };
          } else {
            paidCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
            paidCell.font = { bold: true, color: { argb: "FF991B1B" } };
          }
        }
      });

      ws.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: ws.columns.length },
      };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      const fileTag = rangeMode === "day" ? selectedDate : `${currentRange.start}_to_${currentRange.end}`;
      saveAs(blob, `admin-reservations-${rangeMode}-${fileTag}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Customer Reservations</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{currentRange.label}</strong> ({filteredSessions.length})
              </div>
              {rangeMode !== "day" && (
                <div className="customer-subtext" style={{ opacity: 0.8, fontSize: 12 }}>
                  Range: <strong>{currentRange.start}</strong> → <strong>{currentRange.end}</strong>
                </div>
              )}
            </div>

            <div className="customer-topbar-right">
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>

                  <input
                    className="customer-search-input"
                    type="text"
                    placeholder="Search full name or phone..."
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

              <div className="admin-tools-row" style={{ alignItems: "center" }}>
                <label className="date-pill" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="date-pill-label">Range</span>
                  <select
                    className="date-pill-input"
                    value={rangeMode}
                    onChange={(e) => setRangeMode(e.currentTarget.value as RangeMode)}
                    style={{ padding: "6px 10px" }}
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </label>

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

                <button className="receipt-btn" onClick={() => void refreshAll()} disabled={refreshing || loading}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>

                <button
                  className="receipt-btn"
                  onClick={() => void exportToExcel()}
                  disabled={filteredSessions.length === 0 || exporting}
                  title={filteredSessions.length === 0 ? "No data to export" : "Export .xlsx for Day/Week/Month"}
                >
                  {exporting ? "Exporting..." : "Export to Excel"}
                </button>

                <button
                  className="receipt-btn admin-danger"
                  onClick={() => void deleteByRange()}
                  disabled={deletingRange || filteredSessions.length === 0}
                  title={filteredSessions.length === 0 ? "No data to delete" : "Delete ALL records for selected range"}
                >
                  {deletingRange ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No reservation records found for this range</p>
          ) : (
            <div
              className="customer-table-wrap"
              key={`${rangeMode}-${selectedDate}`}
              style={{
                maxHeight: "560px",
                overflowY: "auto",
                overflowX: "auto",
              }}
            >
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Reservation Date</th>
                    <th>Full Name</th>
                    <th>Phone #</th>
                    <th>Has ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Time</th>
                    <th>Total Balance / Change</th>
                    <th>Discount</th>
                    <th>Down Payment</th>
                    <th>Payment</th>
                    <th>Paid?</th>
                    <th>Seat</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSessions.map((session) => {
                    const showStop = canShowStopButton(session);
                    const mins = getDisplayedTotalMinutes(session);
                    const disp = getDisplayAmount(session);

                    const dp = getDownPayment(session);

                    const due = getSessionBalanceAfterDP(session);
                    const pi = getPaidInfo(session);

                    const systemCost = getSessionSystemCost(session);
                    const remainingPay = systemCost - pi.totalPaid;

                    return (
                      <tr key={session.id}>
                        <td>{session.reservation_date ?? "N/A"}</td>
                        <td>{session.full_name}</td>
                        <td>{safePhone(session.phone_number)}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{renderTimeOut(session)}</td>

                        <td>{formatMinutesToTime(mins)}</td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value}</span>
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
                            <span className="cell-strong">₱{dp}</span>
                            <button className="receipt-btn" onClick={() => openDpModal(session)}>
                              Edit DP
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash} / Cash ₱{pi.cash}
                            </span>

                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {due > 0 ? `Due ₱${due}` : "No Due"} •{" "}
                              {remainingPay >= 0 ? `Remaining ₱${wholePeso(remainingPay)}` : `Change ₱${wholePeso(Math.abs(remainingPay))}`}
                            </span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={due <= 0}
                              title={due <= 0 ? "No balance due" : "Set Cash & GCash freely (no limit)"}
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
                        <td>{getStatus(session)}</td>

                        <td>
                          <div className="action-stack">
                            {showStop && (
                              <button
                                className="receipt-btn"
                                disabled={stoppingId === session.id}
                                onClick={() => void stopReservationTime(session)}
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

          {dpTarget && (
            <div className="receipt-overlay" onClick={() => setDpTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DOWN PAYMENT</h3>
                <p className="receipt-subtitle">
                  {dpTarget.full_name} — {safePhone(dpTarget.phone_number)}
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Down Payment (₱)</span>
                  <input
                    className="money-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={dpInput}
                    onChange={(e) => setDpInput(e.currentTarget.value)}
                  />
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setDpTarget(null)} disabled={savingDp}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDownPayment()} disabled={savingDp}>
                    {savingDp ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {discountTarget && (
            <div className="receipt-overlay" onClick={() => setDiscountTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DISCOUNT</h3>
                <p className="receipt-subtitle">
                  {discountTarget.full_name} — {safePhone(discountTarget.phone_number)}
                </p>

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
                  const appliedVal = discountKind === "percent" ? clamp(Math.max(0, val), 0, 100) : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);
                  const dp = getDownPayment(discountTarget);
                  const due = wholePeso(Math.max(0, discountedCost - dp));

                  const prevPay = getPaidInfo(discountTarget);

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{wholePeso(base)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, appliedVal)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{wholePeso(discountAmount)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost</span>
                        <span>₱{wholePeso(discountedCost)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW PAYMENT DUE</span>
                        <span>₱{due}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current Payment</span>
                        <span>
                          GCash ₱{prevPay.gcash} / Cash ₱{prevPay.cash}
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

          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} — {safePhone(paymentTarget.phone_number)}
                </p>

                <hr />

                {(() => {
                  const due = getSessionBalanceAfterDP(paymentTarget);

                  const g = wholePeso(Math.max(0, toMoney(gcashInput)));
                  const c = wholePeso(Math.max(0, toMoney(cashInput)));
                  const totalPaid = wholePeso(g + c);

                  const diff = totalPaid - due;
                  const autoPaid = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (After DP)</span>
                        <span>₱{wholePeso(Math.max(0, due))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashInput(e.currentTarget.value)}
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
                          onChange={(e) => setCashInput(e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>₱{wholePeso(Math.abs(diff))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Status</span>
                        <span className="receipt-status">{autoPaid ? "PAID" : "UNPAID"}</span>
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

          {selectedSession && (
            <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">RESERVATION RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Reservation Date</span>
                  <span>{selectedSession.reservation_date ?? "N/A"}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selectedSession.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Phone #</span>
                  <span>{safePhone(selectedSession.phone_number)}</span>
                </div>

                <div className="receipt-row">
                  <span>Has ID</span>
                  <span>{selectedSession.has_id ? "Yes" : "No"}</span>
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

                {isOpenTimeSession(selectedSession) && canShowStopButton(selectedSession) && (
                  <div className="block-top">
                    <button
                      className="receipt-btn btn-full"
                      disabled={stoppingId === selectedSession.id}
                      onClick={() => void stopReservationTime(selectedSession)}
                    >
                      {stoppingId === selectedSession.id ? "Stopping..." : "Stop Time (Set Time Out Now)"}
                    </button>
                  </div>
                )}

                <hr />

                {(() => {
                  const dp = getDownPayment(selectedSession);

                  const baseCost = getBaseSystemCost(selectedSession);
                  const di = getDiscountInfo(selectedSession);
                  const calc = applyDiscount(baseCost, di.kind, di.value);

                  const systemCost = wholePeso(calc.discountedCost);
                  const dueAfterDp = wholePeso(Math.max(0, systemCost - dp));
                  const changeAfterDp = wholePeso(Math.max(0, dp - systemCost));

                  const disp =
                    dueAfterDp > 0
                      ? ({ label: "Total Balance", value: dueAfterDp } as const)
                      : ({ label: "Total Change", value: changeAfterDp } as const);

                  const pi = getPaidInfo(selectedSession);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>{disp.label}</span>
                        <span>₱{disp.value}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (After Discount)</span>
                        <span>₱{systemCost}</span>
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>GCash</span>
                        <span>₱{pi.gcash}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <span>₱{pi.cash}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{pi.totalPaid}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Remaining (After DP)</span>
                        <span>₱{wholePeso(Math.max(0, dueAfterDp - pi.totalPaid))}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="receipt-total">
                        <span>{disp.label.toUpperCase()}</span>
                        <span>₱{disp.value}</span>
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

export default Admin_customer_reservation;