// src/pages/Customer_Reservations.tsx
// ✅ SAME STYLE/CLASSNAMES as Customer_Lists.tsx
// ✅ Shows ONLY RESERVATION records (reservation = "yes")
// ✅ Seat column INCLUDED (reservations need seats)
// ✅ Discount UI same as Customer_Lists (breakdown)
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Payment is based on TIME CONSUMED (System Cost after discount) — ❌ DOES NOT deduct Down Payment
// ✅ Down Payment column between Discount and Payment
// ✅ Down Payment is EDITABLE (modal) and saved to DB: customer_sessions.down_payment
// ✅ Receipt: removed "Edit DP" button
// ✅ Receipt auto-updates balance/change after DP edit (row + selectedSession updated)
// ✅ Phone # column beside Full Name
// ✅ View to Customer toggle via localStorage
// ✅ Search bar (Full Name only)
// ✅ Date filter uses reservation_date
// ✅ Stop Time for OPEN sessions (also releases seat_blocked_times end_at = now)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

/* ✅ LOCAL STORAGE KEYS (shared with Book_Add) */
const LS_VIEW_ENABLED = "customer_view_enabled";
const LS_SESSION_ID = "customer_view_session_id";

type DiscountKind = "none" | "percent" | "amount";

interface CustomerSession {
  id: string;

  // Reservation uses reservation_date, but keep date as fallback
  date: string; // fallback
  reservation_date: string | null; // filter basis

  full_name: string;
  phone_number?: string | null;

  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;

  hour_avail: string;
  time_started: string;
  time_ended: string;

  total_time: number;
  total_amount: number;

  reservation: string; // "yes"
  seat_number: string;

  // ✅ DOWN PAYMENT (DB)
  down_payment?: number | string | null;

  // DISCOUNT
  discount_kind?: DiscountKind;
  discount_value?: number | string;
  discount_reason?: string | null;

  // PAYMENT
  gcash_amount?: number | string;
  cash_amount?: number | string;

  // PAID STATUS
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
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

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

// ✅ keep gcash (clamp to due), cash = remaining
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

/* ✅ VIEW-TO-CUSTOMER helpers */
const isCustomerViewOnFor = (sessionId: string): boolean => {
  const enabled = String(localStorage.getItem(LS_VIEW_ENABLED) ?? "").toLowerCase() === "true";
  const sid = String(localStorage.getItem(LS_SESSION_ID) ?? "").trim();
  return enabled && sid === sessionId;
};

const setCustomerView = (enabled: boolean, sessionId: string | null): void => {
  localStorage.setItem(LS_VIEW_ENABLED, String(enabled));
  if (enabled && sessionId) localStorage.setItem(LS_SESSION_ID, sessionId);
  else localStorage.removeItem(LS_SESSION_ID);
};

const stopCustomerView = (): void => {
  localStorage.setItem(LS_VIEW_ENABLED, "false");
  localStorage.removeItem(LS_SESSION_ID);
};

const splitSeats = (seatStr: string): string[] => {
  return String(seatStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toUpperCase() !== "N/A");
};

const Customer_Reservations: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const [, setViewTick] = useState<number>(0);

  // Date filter (reservation_date)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ Search (Full Name only)
  const [searchName, setSearchName] = useState<string>("");

  // Discount modal
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [discountReason, setDiscountReason] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // ✅ Down Payment modal
  const [dpTarget, setDpTarget] = useState<CustomerSession | null>(null);
  const [dpInput, setDpInput] = useState<string>("0");
  const [savingDp, setSavingDp] = useState<boolean>(false);

  // Payment modal
  const [paymentTarget, setPaymentTarget] = useState<CustomerSession | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // Paid toggle busy id
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  useEffect(() => {
    void fetchReservationSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredSessions = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return sessions.filter((s) => {
      const sameDate = (s.reservation_date ?? "") === selectedDate;
      if (!sameDate) return false;

      if (!q) return true;
      const name = String(s.full_name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [sessions, selectedDate, searchName]);

  const fetchReservationSessions = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "yes")
      .order("reservation_date", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert("Error loading reservations");
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions((data as CustomerSession[]) || []);
    setLoading(false);
  };

  const phoneText = (s: CustomerSession): string => {
    const p = String(s.phone_number ?? "").trim();
    return p || "N/A";
  };

  const getDownPayment = (s: CustomerSession): number => round2(Math.max(0, toMoney(s.down_payment ?? 0)));

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

  const computeHours = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    const hours = (end - start) / (1000 * 60 * 60);
    return Number(hours.toFixed(2));
  };

  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return round2(chargeMinutes * perMinute);
  };

  const getLiveTotalCost = (s: CustomerSession): number => {
    const nowIso = new Date().toISOString();
    return computeCostWithFreeMinutes(s.time_started, nowIso);
  };

  const getBaseSystemCost = (s: CustomerSession): number => {
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : toMoney(s.total_amount);
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

  // ✅ System cost AFTER discount (Payment basis)  ❌ NO DP deduction (same as Customer_Lists)
  const getSessionSystemCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const di = getDiscountInfo(s);
    return applyDiscount(base, di.kind, di.value).discountedCost;
  };

  // ✅ Balance/Change display uses DP (display only)
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

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const balance = getSessionBalanceAfterDP(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
    return { label: "Total Change", value: getSessionChangeAfterDP(s) };
  };

  const getPaidInfo = (s: CustomerSession): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toMoney(s.gcash_amount ?? 0)));
    const cash = round2(Math.max(0, toMoney(s.cash_amount ?? 0)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  // ✅ Release reserved seat blocks when stop time is pressed (same behavior)
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
      // fallback: try update by seat list
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
    const { error: upErr } = await supabase.from("seat_blocked_times").update({ end_at: nowIso, note: "stopped" }).in(
      "id",
      ids
    );

    if (upErr) {
      // eslint-disable-next-line no-console
      console.warn("releaseSeatBlocksNow update:", upErr.message);
    }
  };

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalHours = computeHours(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalHours,
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

  const renderTimeOut = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "OPEN";
    const t = formatTimeText(s.time_ended);
    return t || "—";
  };

  const renderStatus = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "Ongoing";
    const end = new Date(s.time_ended);
    if (!Number.isFinite(end.getTime())) return "Finished";
    return new Date() > end ? "Finished" : "Ongoing";
  };

  const getUsedMinutesForReceipt = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date().toISOString());
    return diffMinutes(s.time_started, s.time_ended);
  };

  const getChargeMinutesForReceipt = (s: CustomerSession): number => {
    const used = getUsedMinutesForReceipt(s);
    return Math.max(0, used - FREE_MINUTES);
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
    const dueForPayment = round2(Math.max(0, discounted)); // ✅ payment basis (NO DP)

    const prevPay = getPaidInfo(discountTarget);
    const adjPay = recalcPaymentsToDue(dueForPayment, prevPay.gcash);

    const totalPaid = round2(adjPay.gcash + adjPay.cash);
    const autoPaid = dueForPayment <= 0 ? true : totalPaid >= dueForPayment;

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
  // ✅ DOWN PAYMENT MODAL (EDITABLE) (same as Customer_Lists)
  // -----------------------
  const openDpModal = (s: CustomerSession): void => {
    setDpTarget(s);
    setDpInput(String(getDownPayment(s)));
  };

  const saveDownPayment = async (): Promise<void> => {
    if (!dpTarget) return;

    const raw = Number(dpInput);
    const dp = round2(Math.max(0, Number.isFinite(raw) ? raw : 0));

    try {
      setSavingDp(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({ down_payment: dp })
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
  // PAYMENT MODAL (same behavior as Customer_Lists)  ✅ DO NOT DEDUCT DP
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const due = getSessionSystemCost(s); // ✅ payment basis = system cost after discount (NO DP)
    const pi = getPaidInfo(s);

    const existingGcash = pi.totalPaid > 0 ? pi.gcash : 0;
    const adj = recalcPaymentsToDue(due, existingGcash);

    setPaymentTarget(s);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setGcashAndAutoCash = (s: CustomerSession, gcashStr: string): void => {
    const due = getSessionSystemCost(s);
    const gc = Math.max(0, toMoney(gcashStr));
    const adj = recalcPaymentsToDue(due, gc);
    setGcashInput(String(adj.gcash));
    setCashInput(String(adj.cash));
  };

  const setCashAndAutoGcash = (s: CustomerSession, cashStr: string): void => {
    const due = round2(Math.max(0, getSessionSystemCost(s)));
    const ca = round2(Math.max(0, toMoney(cashStr)));

    const cash = round2(Math.min(due, ca));
    const gcash = round2(Math.max(0, due - cash));

    setCashInput(String(cash));
    setGcashInput(String(gcash));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const due = getSessionSystemCost(paymentTarget);
    const gcIn = Math.max(0, toMoney(gcashInput));
    const adj = recalcPaymentsToDue(due, gcIn);

    const totalPaid = round2(adj.gcash + adj.cash);
    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

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

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          {/* TOP BAR */}
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Customer Reservations</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              {/* ✅ SEARCH BAR */}
              <div className="customer-searchbar-inline">
                <div className="customer-searchbar-inner">
                  <span className="customer-search-icon" aria-hidden="true">
                    🔎
                  </span>
                  <input
                    className="customer-search-input"
                    type="text"
                    value={searchName}
                    onChange={(e) => setSearchName(e.currentTarget.value)}
                    placeholder="Search by Full Name..."
                  />
                  {searchName.trim() && (
                    <button className="customer-search-clear" onClick={() => setSearchName("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* DATE (reservation_date) */}
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
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredSessions.length === 0 ? (
            <p className="customer-note">No reservation data found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Reservation Date</th>
                    <th>Full Name</th>
                    <th>Phone #</th>
                    <th>Type</th>
                    <th>Field</th>
                    <th>Has ID</th>
                    <th>Specific ID</th>
                    <th>Hours</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Total Hours</th>
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
                    const open = isOpenTimeSession(session);

                    const disp = getDisplayAmount(session);

                    const systemCost = getSessionSystemCost(session); // payment basis (NO DP)
                    const pi = getPaidInfo(session);
                    const remainingPay = round2(Math.max(0, systemCost - pi.totalPaid));

                    const dp = getDownPayment(session);

                    return (
                      <tr key={session.id}>
                        <td>{session.reservation_date}</td>
                        <td>{session.full_name}</td>
                        <td>{phoneText(session)}</td>
                        <td>{session.customer_type}</td>
                        <td>{session.customer_field ?? ""}</td>
                        <td>{session.has_id ? "Yes" : "No"}</td>
                        <td>{session.id_number ?? "N/A"}</td>
                        <td>{session.hour_avail}</td>
                        <td>{formatTimeText(session.time_started)}</td>
                        <td>{renderTimeOut(session)}</td>
                        <td>{session.total_time}</td>

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
                            <span className="cell-strong">₱{dp.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openDpModal(session)}>
                              Edit DP
                            </button>
                          </div>
                        </td>

                        {/* ✅ PAYMENT (same as Customer_Lists) */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>Remaining ₱{remainingPay.toFixed(2)}</span>

                            <button
                              className="receipt-btn"
                              onClick={() => openPaymentModal(session)}
                              disabled={systemCost <= 0}
                              title={systemCost <= 0 ? "No due" : "Set GCash/Cash payment (based on time consumed)"}
                            >
                              Payment
                            </button>
                          </div>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${
                              toBool(session.is_paid) ? "pay-badge--paid" : "pay-badge--unpaid"
                            }`}
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
                <p className="receipt-subtitle">{dpTarget.full_name}</p>

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
                  <button className="receipt-btn" onClick={() => setDpTarget(null)}>
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
                  const appliedVal = discountKind === "percent" ? clamp(Math.max(0, val), 0, 100) : Math.max(0, val);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);
                  const dueForPayment = round2(Math.max(0, discountedCost)); // ✅ payment basis (NO DP)

                  const prevPay = getPaidInfo(discountTarget);
                  const adjPay = recalcPaymentsToDue(dueForPayment, prevPay.gcash);

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
                        <span>Final System Cost (Payment Basis)</span>
                        <span>₱{discountedCost.toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW PAYMENT DUE</span>
                        <span>₱{dueForPayment.toFixed(2)}</span>
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
                  <button className="receipt-btn" onClick={() => setDiscountTarget(null)}>
                    Cancel
                  </button>
                  <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount}>
                    {savingDiscount ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT MODAL (same as Customer_Lists) */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">{paymentTarget.full_name}</p>

                <hr />

                {(() => {
                  const due = getSessionSystemCost(paymentTarget);

                  const gcIn = Math.max(0, toMoney(gcashInput));
                  const adj = recalcPaymentsToDue(due, gcIn);

                  const totalPaid = round2(adj.gcash + adj.cash);
                  const remaining = round2(Math.max(0, due - totalPaid));

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Payment Due (System Cost)</span>
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
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)}>
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

          {/* RECEIPT MODAL (same breakdown + DP effect) */}
          {selectedSession && (
            <div className="receipt-overlay" onClick={() => setSelectedSession(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">OFFICIAL RECEIPT</p>

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
                  <span>Phone</span>
                  <span>{phoneText(selectedSession)}</span>
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
                  <span>Minutes Used</span>
                  <span>{getUsedMinutesForReceipt(selectedSession)} min</span>
                </div>

                <div className="receipt-row">
                  <span>Charge Minutes</span>
                  <span>{getChargeMinutesForReceipt(selectedSession)} min</span>
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
                  const dp = getDownPayment(selectedSession);

                  const baseCost = getBaseSystemCost(selectedSession);
                  const di = getDiscountInfo(selectedSession);
                  const discountCalc = applyDiscount(baseCost, di.kind, di.value);

                  const dueForPayment = round2(Math.max(0, discountCalc.discountedCost)); // ✅ payment basis (NO DP)

                  const pi = getPaidInfo(selectedSession);

                  // ✅ AFTER DP (display only)
                  const dpBalance = round2(Math.max(0, dueForPayment - dp));
                  const dpChange = round2(Math.max(0, dp - dueForPayment));

                  const dpDisp =
                    dpBalance > 0
                      ? ({ label: "Total Balance", value: dpBalance } as const)
                      : ({ label: "Total Change", value: dpChange } as const);

                  // ✅ Bottom summary switches label:
                  // - If may balance: PAYMENT DUE = balance
                  // - If sobra DP: TOTAL CHANGE = change
                  const bottomLabel = dpBalance > 0 ? "PAYMENT DUE" : "TOTAL CHANGE";
                  const bottomValue = dpBalance > 0 ? dpBalance : dpChange;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>{dpDisp.label}</span>
                        <span>₱{dpDisp.value.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Down Payment</span>
                        <span>₱{dp.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(di.kind, di.value)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountCalc.discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>System Cost (Payment Basis)</span>
                        <span>₱{dueForPayment.toFixed(2)}</span>
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
                        <span>Remaining Balance (After DP)</span>
                        <span>₱{dpBalance.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Status</span>
                        <span className="receipt-status">{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
                      </div>

                      {/* ✅ FIX: If sobra DP, label becomes TOTAL CHANGE */}
                      <div className="receipt-total">
                        <span>{bottomLabel}</span>
                        <span>₱{bottomValue.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}

                <p className="receipt-footer">
                  Thank you for choosing <br />
                  <strong>Me Tyme Lounge</strong>
                </p>

                <div className="modal-actions" style={{ display: "flex", gap: 8 }}>
                  <button
                    className="receipt-btn"
                    onClick={() => {
                      if (!selectedSession) return;

                      const on = isCustomerViewOnFor(selectedSession.id);
                      setCustomerView(!on, !on ? selectedSession.id : null);

                      setViewTick((x) => x + 1);
                    }}
                  >
                    {selectedSession && isCustomerViewOnFor(selectedSession.id)
                      ? "Stop View to Customer"
                      : "View to Customer"}
                  </button>

                  <button
                    className="close-btn"
                    onClick={() => {
                      stopCustomerView();
                      setViewTick((x) => x + 1);
                      setSelectedSession(null);
                    }}
                  >
                    Close
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

export default Customer_Reservations;
