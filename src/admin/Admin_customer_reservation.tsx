// src/pages/Admin_customer_reservation.tsx
// ✅ Same classnames/layout as Admin_customer_list.tsx (one CSS)
// ✅ Date filter (reservation_date)
// ✅ Export to Excel (CSV) selected date only (UTF-8 BOM, Date/Time as TEXT, Amount as NUMBER only)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both) in table + receipt
// ✅ Discount + Discount Reason (saved, NOT shown on receipt)
// ✅ Payment (GCash/Cash) + Auto PAID/UNPAID on SAVE PAYMENT
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Delete single row
// ✅ Delete by DATE (deletes ALL records with reservation_date = selectedDate from DB)
// ✅ Promo filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display
// ✅ Stop Time (OPEN) releases seat_blocked_times (end_at = now)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5; // hidden
const DOWN_PAYMENT = 50;

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;
  date: string;
  full_name: string;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string;
  time_ended: string;

  total_time: number | string;
  total_amount: number | string;

  reservation: string;
  reservation_date: string | null; // YYYY-MM-DD
  seat_number: string;

  discount_kind?: DiscountKind;
  discount_value?: number;
  discount_reason?: string | null;

  gcash_amount?: number;
  cash_amount?: number;

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

const csvEscape = (v: string): string => `"${v.replace(/"/g, '""')}"`;

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

// keep gcash (clamp to due), cash = remaining
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

const splitSeats = (seatStr: string): string[] => {
  return String(seatStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toUpperCase() !== "N/A");
};

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

  // filter by selectedDate (reservation_date)
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.reservation_date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

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

  // ONLY ONE display value
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
      `Delete this reservation record?\n\n${session.full_name}\nReservation Date: ${session.reservation_date ?? "N/A"}`
    );
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

  // delete ALL rows by selectedDate
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const count = filteredSessions.length;
    const ok = window.confirm(`Delete ALL reservation records on ${selectedDate}?\n\nThis will delete ${count} record(s) from the database.`);
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

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

  const renderTimeOut = (s: CustomerSession): string => (isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended));

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

  // -----------------------
  // Export CSV for selected date only
  // -----------------------
  const exportToExcel = (): void => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredSessions.length === 0) {
      alert("No records for selected date.");
      return;
    }

    const headers = [
      "Reservation Date",
      "Full Name",
      "Field",
      "Has ID",
      "Specific ID",
      "Hours",
      "Time In",
      "Time Out",
      "Total Time (min)",
      "Amount Label",
      "Amount",
      "Discount",
      "Discount Amount",
      "System Cost (After Discount)",
      "GCash",
      "Cash",
      "Total Paid",
      "Remaining Balance",
      "Paid?",
      "Seat",
      "Status",
    ];

    const rows = filteredSessions.map((s) => {
      const timeIn = formatTimeText(s.time_started);
      const timeOut = isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);
      const status = getStatus(s);

      const mins = getDisplayedTotalMinutes(s);
      const disp = getDisplayAmount(s);

      const base = getBaseSystemCost(s);
      const di = getDiscountInfo(s);
      const calc = applyDiscount(base, di.kind, di.value);

      const pi = getPaidInfo(s);
      const due = getSessionBalance(s);
      const remaining = round2(Math.max(0, due - pi.totalPaid));

      return [
        `\t${s.reservation_date ?? ""}`,
        s.full_name,
        s.customer_field ?? "",
        s.has_id ? "Yes" : "No",
        s.id_number ?? "N/A",
        s.hour_avail,
        `\t${timeIn}`,
        `\t${timeOut}`,
        String(mins ?? 0),
        disp.label,
        disp.value.toFixed(2),
        getDiscountTextFrom(di.kind, di.value),
        calc.discountAmount.toFixed(2),
        calc.discountedCost.toFixed(2),
        pi.gcash.toFixed(2),
        pi.cash.toFixed(2),
        pi.totalPaid.toFixed(2),
        remaining.toFixed(2),
        toBool(s.is_paid) ? "PAID" : "UNPAID",
        s.seat_number,
        status,
      ];
    });

    const csv = "\ufeff" + [headers, ...rows].map((r) => r.map((v) => csvEscape(String(v ?? ""))).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-reservations-${selectedDate}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <IonPage>
      <IonContent scrollY={false} className="staff-content">
        <div className="customer-lists-container">
          {/* TOP BAR (same layout/classes as Admin_customer_list) */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Customer Reservations</h2>
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

              <div className="admin-tools-row">
                <button className="receipt-btn" onClick={exportToExcel} disabled={filteredSessions.length === 0}>
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
                    const showStop = canShowStopButton(session);
                    const mins = getDisplayedTotalMinutes(session);
                    const disp = getDisplayAmount(session);

                    const due = getSessionBalance(session);
                    const pi = getPaidInfo(session);

                    return (
                      <tr key={session.id}>
                        <td>{session.reservation_date ?? "N/A"}</td>
                        <td>{session.full_name}</td>
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

                        {/* PAYMENT */}
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
                              <button className="receipt-btn" disabled={stoppingId === session.id} onClick={() => void stopReservationTime(session)}>
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

          {/* DISCOUNT MODAL (same classes as Admin_customer_list) */}
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
                    <span className="inline-input-prefix">{discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}</span>
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

          {/* PAYMENT MODAL (same classes as Admin_customer_list) */}
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

          {/* RECEIPT MODAL (same classes as Admin_customer_list) */}
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

                      {/* ❌ NO DISCOUNT REASON ON RECEIPT */}

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

export default Admin_customer_reservation;
