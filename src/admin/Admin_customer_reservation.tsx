// src/pages/Admin_customer_reservation.tsx
// ✅ Same classnames/layout as Admin_customer_list.tsx (one CSS)
// ✅ Date filter (reservation_date)
// ✅ Export EXCEL (.xlsx) selected date only (Date/Time as TEXT, Amount as NUMBER only)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both) in table + receipt
// ✅ Discount + Discount Reason (saved, NOT shown on receipt UI)  (still stored in DB)
// ✅ ✅ UPDATED: Down Payment is EDITABLE (per reservation) like Admin_customer_list.tsx
// ✅ ✅ UPDATED: Payment modal = FREE INPUTS (NO LIMIT) like Admin_customer_list.tsx
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Delete single row  ✅ ALSO deletes related seat_blocked_times
// ✅ Delete by DATE (deletes ALL records with reservation_date = selectedDate) ✅ ALSO deletes related seat_blocked_times
// ✅ Promo filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display
// ✅ Stop Time (OPEN) releases seat_blocked_times (end_at = now)
// ✅ No "any"
// ✅ Phone Number column (table + receipt + excel)
// ✅ NEW: Refresh button (same classname "receipt-btn")
// ✅ ✅ UPDATED UI: Search bar EXACT SAME UI as Admin_customer_list.tsx (customer-searchbar-inline + icon + clear)

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0; // hidden

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;
  date: string;
  full_name: string;

  phone_number?: string | null;

  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string; // timestamptz
  time_ended: string; // timestamptz

  total_time: number | string;
  total_amount: number | string;

  reservation: string; // "yes"
  reservation_date: string | null; // YYYY-MM-DD
  seat_number: string; // can be "A1" or "A1, A2"

  // ✅ DP (per-row in DB, same as list page)
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

const Admin_customer_reservation: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(Date.now());

  // date filter (reservation_date)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ Search (same UI as Admin_customer_list)
  const [searchText, setSearchText] = useState<string>("");

  // ✅ Refresh busy
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Discount modal
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // ✅ Down Payment modal (editable)
  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  // ✅ Payment modal (FREE INPUTS, NO LIMIT)
  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // Paid toggle busy id
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  useEffect(() => {
    void fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tick so OPEN sessions auto-update display
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await fetchReservations();
    } catch (e) {
      // eslint-disable-next-line no-console
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

  const getDownPayment = (s: CustomerSession): number => round2(Math.max(0, toMoney(s.down_payment ?? 0)));

  const fetchReservations = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "yes")
      .neq("customer_type", "promo")
      .order("reservation_date", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
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

  // ✅ filter by selectedDate + search (Full Name + Phone)
  const filteredSessions = useMemo(() => {
    const byDate = sessions.filter((s) => (s.reservation_date ?? "") === selectedDate);

    const q = searchText.trim().toLowerCase();
    if (!q) return byDate;

    return byDate.filter((s) => {
      const name = String(s.full_name ?? "").toLowerCase();
      const phone = String(s.phone_number ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [sessions, selectedDate, searchText]);

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999; // legacy fallback
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
    return round2(chargeMinutes * perMinute);
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

  // Base cost before discount (OPEN uses live; CLOSED uses DB)
  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return computeCostWithFreeMinutes(s.time_started, new Date(nowTick).toISOString());
    return round2(toNum(s.total_amount));
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

  // Final cost after discount
  const getSessionSystemCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return applyDiscount(base, di.kind, di.value).discountedCost;
  };

  // ✅ Payment DUE for reservation = System Cost after discount MINUS Down Payment (editable)
  const getSessionBalanceAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return round2(Math.max(0, systemCost - dp));
  };

  const getSessionChangeAfterDP = (s: CustomerSession): number => {
    const systemCost = getSessionSystemCost(s);
    const dp = getDownPayment(s);
    return round2(Math.max(0, dp - systemCost));
  };

  // ONLY ONE display value
  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalanceAfterDP(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = round2(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const renderTimeOut = (s: CustomerSession): string => (isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended));

  // ✅ release seat_blocked_times (end_at = now) when Stop Time
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
      // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.warn("releaseSeatBlocksNow fallback update:", upErr.message);
      }
      return;
    }

    const ids = rows.map((r) => r.id);

    const { error: upErr } = await supabase.from("seat_blocked_times").update({ end_at: nowIso, note: "stopped" }).in("id", ids);

    if (upErr) {
      // eslint-disable-next-line no-console
      console.warn("releaseSeatBlocksNow update:", upErr.message);
    }
  };

  // ✅ delete seat blocks for a reservation session (delete single + delete by date)
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
      // eslint-disable-next-line no-console
      console.warn("deleteSeatBlocksForSession error:", error.message);
    }
  };

  const deleteSeatBlocksForDate = async (dateStr: string, list: CustomerSession[]): Promise<void> => {
    if (!dateStr) return;
    const rows = list.filter((s) => (s.reservation_date ?? "") === dateStr);
    for (const s of rows) {
      // eslint-disable-next-line no-await-in-loop
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  // delete ALL rows by selectedDate
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const count = filteredSessions.length;
    const ok = window.confirm(
      `Delete ALL reservation records on ${selectedDate}?\n\nThis will delete ${count} record(s) from the database.`
    );
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      await deleteSeatBlocksForDate(selectedDate, filteredSessions);

      const { error } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("reservation", "yes")
        .eq("reservation_date", selectedDate)
        .neq("customer_type", "promo");

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      setSessions((prev) => prev.filter((s) => (s.reservation_date ?? "") !== selectedDate));
      setSelectedSession((prev) => ((prev?.reservation_date ?? "") === selectedDate ? null : prev));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
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
    const dueForPayment = round2(Math.max(0, discounted - dp));

    // ✅ KEEP existing cash/gcash as-is (NO LIMIT), just recompute PAID based on due
    const prevPay = getPaidInfo(discountTarget);
    const totalPaid = round2(prevPay.gcash + prevPay.cash);
    const autoPaid = dueForPayment <= 0 ? true : totalPaid >= dueForPayment;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
          discount_reason: discountReason.trim(),

          // keep existing payments
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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  // -----------------------
  // ✅ DOWN PAYMENT MODAL
  // -----------------------
  const openDpModal = (s: CustomerSession): void => {
    setDpTarget(s);
    setDpInput(String(getDownPayment(s)));
  };

  const saveDownPayment = async (): Promise<void> => {
    if (!dpTarget) return;

    const raw = Number(dpInput);
    const dp = round2(Math.max(0, Number.isFinite(raw) ? raw : 0));

    // after DP change, recompute PAID based on current payments + new due
    const base = getBaseSystemCost(dpTarget);
    const di = getDiscountInfo(dpTarget);
    const systemCost = applyDiscount(base, di.kind, di.value).discountedCost;
    const due = round2(Math.max(0, systemCost - dp));

    const prevPay = getPaidInfo(dpTarget);
    const totalPaid = round2(prevPay.gcash + prevPay.cash);
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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save down payment failed.");
    } finally {
      setSavingDp(false);
    }
  };

  // -----------------------
  // ✅ PAYMENT MODAL (NO LIMIT)
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const pi = getPaidInfo(s);
    setPaymentTarget(s);
    setGcashInput(String(pi.gcash));
    setCashInput(String(pi.cash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = round2(Math.max(0, getSessionBalanceAfterDP(paymentTarget)));

    const g = round2(Math.max(0, toMoney(gcashInput)));
    const c = round2(Math.max(0, toMoney(cashInput)));
    const totalPaid = round2(g + c);

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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  // -----------------------
  // PAID / UNPAID TOGGLE (manual)
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

  /* =========================
     Export Excel (.xlsx) - NICE LAYOUT (Phone # + DP)
     - Date/Time as TEXT
     - Amount columns as NUMBER
  ========================= */
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

    const ws = wb.addWorksheet("Reservations", {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    ws.columns = [
      { header: "Reservation Date", key: "reservation_date", width: 16 },
      { header: "Full Name", key: "full_name", width: 26 },
      { header: "Phone Number", key: "phone_number", width: 16 },
      { header: "Field", key: "field", width: 18 },
      { header: "Has ID", key: "has_id", width: 10 },
      { header: "Specific ID", key: "id_number", width: 16 },
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

    // Title rows
    ws.mergeCells("A1", "W1");
    ws.getCell("A1").value = "ME TYME LOUNGE — RESERVATIONS REPORT";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(1).height = 26;

    ws.mergeCells("A2", "W2");
    ws.getCell("A2").value = `Date: ${selectedDate}`;
    ws.getCell("A2").font = { size: 11 };
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(2).height = 18;

    const generatedAt = new Date();
    ws.mergeCells("A3", "W3");
    ws.getCell("A3").value = `Generated: ${generatedAt.toLocaleString()}`;
    ws.getCell("A3").font = { size: 11 };
    ws.getCell("A3").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(3).height = 18;

    ws.getRow(5).height = 6;

    // Optional logo embed (top-right)
    if (isLikelyUrl(logo)) {
      const ab = await fetchAsArrayBuffer(logo);
      if (ab) {
        const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
        const imgId = wb.addImage({ buffer: ab, extension: ext });
        ws.addImage(imgId, {
          tl: { col: 18.2, row: 0.2 },
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
      "down_payment",
      "system_cost",
      "gcash",
      "cash",
      "total_paid",
      "remaining",
    ]);

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
      const remaining = round2(Math.max(0, dueAfterDp - pi.totalPaid));
      const status = getStatus(s);

      const row = ws.addRow({
        reservation_date: String(s.reservation_date ?? ""),
        full_name: s.full_name,
        phone_number: safePhone(s.phone_number),
        field: s.customer_field ?? "",
        has_id: s.has_id ? "Yes" : "No",
        id_number: s.id_number ?? "N/A",
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

      // Force Date/Time as TEXT (Reservation Date, Phone, Time In, Time Out)
      const textCols = [1, 3, 8, 9];
      textCols.forEach((c) => {
        const cell = ws.getCell(rowIndex, c);
        cell.numFmt = "@";
        if (cell.value != null) cell.value = String(cell.value);
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      // Money formatting
      ws.columns.forEach((c, i) => {
        const key = String(c.key ?? "");
        if (moneyCols.has(key)) {
          const cell = ws.getCell(rowIndex, i + 1);
          cell.numFmt = '"₱"#,##0.00;[Red]"₱"#,##0.00';
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }
      });

      // Paid badge coloring (Paid? column)
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
    saveAs(blob, `admin-reservations-${selectedDate}.xlsx`);
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Customer Reservations</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong> ({filteredSessions.length})
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* ✅ SEARCH (SAME UI as Admin_customer_list) */}
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

              <div className="admin-tools-row">
                {/* ✅ REFRESH */}
                <button className="receipt-btn" onClick={() => void refreshAll()} disabled={refreshing || loading}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>

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
            <p className="customer-note">No reservation records found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Reservation Date</th>
                    <th>Full Name</th>
                    <th>Phone #</th>
                    <th>Field</th>
                    <th>Has ID</th>
                    <th>Specific ID</th>
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
                    const remainingPay = round2(systemCost - pi.totalPaid); // info only (like list page)

                    return (
                      <tr key={session.id}>
                        <td>{session.reservation_date ?? "N/A"}</td>
                        <td>{session.full_name}</td>
                        <td>{safePhone(session.phone_number)}</td>
                        <td>{session.customer_field ?? ""}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.id_number ?? "N/A"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{renderTimeOut(session)}</td>

                        <td>{formatMinutesToTime(mins)}</td>

                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{disp.label}</span>
                            <span>₱{disp.value.toFixed(2)}</span>
                          </div>
                        </td>

                        {/* DISCOUNT */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountText(session)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                              Discount
                            </button>
                          </div>
                        </td>

                        {/* ✅ DOWN PAYMENT */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">₱{dp.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openDpModal(session)}>
                              Edit DP
                            </button>
                          </div>
                        </td>

                        {/* ✅ PAYMENT (NO LIMIT) */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>

                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {due > 0 ? `Due ₱${due.toFixed(2)}` : "No Due"} •{" "}
                              {remainingPay >= 0
                                ? `Remaining ₱${remainingPay.toFixed(2)}`
                                : `Change ₱${Math.abs(remainingPay).toFixed(2)}`}
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

                        {/* PAID */}
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
                              {deletingId === session.id ? "Canceling..." : "Cancel"}
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

          {/* ✅ DOWN PAYMENT MODAL */}
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

          {/* DISCOUNT MODAL */}
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
                  const due = round2(Math.max(0, discountedCost - dp));

                  const prevPay = getPaidInfo(discountTarget);

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

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW PAYMENT DUE</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current Payment</span>
                        <span>
                          GCash ₱{prevPay.gcash.toFixed(2)} / Cash ₱{prevPay.cash.toFixed(2)}
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

          {/* ✅ PAYMENT MODAL (NO LIMIT) */}
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

                  const g = round2(Math.max(0, toMoney(gcashInput)));
                  const c = round2(Math.max(0, toMoney(cashInput)));
                  const totalPaid = round2(g + c);

                  const diff = round2(totalPaid - due);
                  const autoPaid = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (After DP)</span>
                        <span>₱{round2(Math.max(0, due)).toFixed(2)}</span>
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
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{diff >= 0 ? "Change" : "Remaining"}</span>
                        <span>₱{Math.abs(diff).toFixed(2)}</span>
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

          {/* RECEIPT MODAL */}
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

                  const systemCost = round2(calc.discountedCost);
                  const dueAfterDp = round2(Math.max(0, systemCost - dp));
                  const changeAfterDp = round2(Math.max(0, dp - systemCost));

                  const disp =
                    dueAfterDp > 0
                      ? ({ label: "Total Balance", value: dueAfterDp } as const)
                      : ({ label: "Total Change", value: changeAfterDp } as const);

                  const pi = getPaidInfo(selectedSession);

                  return (
                    <>
                      <div className="receipt-row">
                        <span>{disp.label}</span>
                        <span>₱{disp.value.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (After Discount)</span>
                        <span>₱{systemCost.toFixed(2)}</span>
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
                        <span>Remaining (After DP)</span>
                        <span>₱{round2(Math.max(0, dueAfterDp - pi.totalPaid)).toFixed(2)}</span>
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

export default Admin_customer_reservation;
