// src/pages/Customer_Reservations.tsx
// ✅ Date filter (shows reservations by selected reservation_date)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both)
// ✅ Receipt summary shows ONLY: Total Balance OR Total Change
// ✅ Promo type filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display
// ✅ DISCOUNT + PAYMENT + PAID:
//    - Discount modal per reservation (percent/peso/none) + reason saved
//    - Auto recompute totals (table + receipt)
//    - Payment modal (GCash/Cash) based on Total Balance AFTER discount
//    - Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
//    - Manual PAID/UNPAID toggle still works
// ✅ Open Time Stop -> ALSO releases seat_blocked_times (end_at = now)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
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
  customer_field: string;
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

  // DISCOUNT
  discount_kind?: DiscountKind;
  discount_value?: number;
  discount_reason?: string | null;

  // PAYMENT
  gcash_amount?: number;
  cash_amount?: number;

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

const Customer_Reservations: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // date filter (by reservation_date)
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
  }, []);

  // tick so OPEN sessions auto-update display
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const isPromoType = (t: string | null | undefined): boolean => (t ?? "").trim().toLowerCase() === "promo";

  const fetchReservations = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select(`*`)
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

  // filter sessions by reservation_date
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.reservation_date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  // ✅ Open Time detection: hour_avail === "OPEN" (primary)
  // (Optional legacy) if you still have old 2999 rows, keep fallback:
  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").trim().toUpperCase() === "OPEN") return true;

    const end = new Date(s.time_ended);
    if (!Number.isFinite(end.getTime())) return false;
    return end.getFullYear() >= 2999; // legacy fallback only
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

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
    return toMoney(s.total_time);
  };

  // base cost before discount
  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) {
      const endIso = new Date(nowTick).toISOString();
      return computeCostWithFreeMinutes(s.time_started, endIso);
    }
    return toMoney(s.total_amount);
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

  // final cost after discount
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

  // one display amount only
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
    const start = getScheduledStartDateTime(session).getTime();
    if (!Number.isFinite(start)) return false;
    return nowTick >= start;
  };

  // ✅ NEW: Release seat_blocked_times for this session (end_at = now)
  const releaseSeatBlocksNow = async (session: CustomerSession, nowIso: string): Promise<void> => {
    const seats = splitSeats(session.seat_number);
    if (seats.length === 0) return;

    // We target blocks:
    // - same seat_number
    // - source reserved
    // - start_at matches session.time_started (best match)
    // - still active (end_at > now)
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
      // fallback: maybe start_at not exact (timezone differences)
      // So update any active reserved block for those seats
      const { error: upErr } = await supabase
        .from("seat_blocked_times")
        .update({ end_at: nowIso, note: "stopped (fallback)" })
        .in("seat_number", seats)
        .eq("source", "reserved")
        .gt("end_at", nowIso);

      if (upErr) console.warn("releaseSeatBlocksNow fallback update:", upErr.message);
      return;
    }

    const ids = rows.map((r) => r.id);

    const { error: upErr } = await supabase
      .from("seat_blocked_times")
      .update({ end_at: nowIso, note: "stopped" })
      .in("id", ids);

    if (upErr) console.warn("releaseSeatBlocksNow update:", upErr.message);
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

      // 1) stop session
      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalMinutes,
          total_amount: totalCost,
          hour_avail: "CLOSED",
        })
        .eq("id", session.id)
        .select(`*`)
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      // 2) ✅ release seats immediately
      await releaseSeatBlocksNow(session, nowIso);

      // 3) update UI
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

  const renderTimeOut = (s: CustomerSession): string => (isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended));

  const getUsedMinutesForReceipt = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
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

    // recompute due AFTER discount, then auto-adjust payments
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

          // auto adjust payment to new due
          gcash_amount: adjPay.gcash,
          cash_amount: adjPay.cash,

          // auto set paid status
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
  // PAYMENT MODAL
  // -----------------------
  const openPaymentModal = (s: CustomerSession): void => {
    const due = getSessionBalance(s); // after discount
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

    const due = getSessionBalance(paymentTarget); // after discount
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
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Customer Reservations
        </h2>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))} />
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filteredSessions.length === 0 ? (
        <p>No reservation records found for this date</p>
      ) : (
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
              const open = isOpenTimeSession(session);
              const disp = getDisplayAmount(session);

              const due = getSessionBalance(session);
              const pi = getPaidInfo(session);

              return (
                <tr key={session.id}>
                  <td>{session.reservation_date ?? "N/A"}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_field}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number || "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{formatTimeText(session.time_started)}</td>
                  <td>{renderTimeOut(session)}</td>

                  <td>{formatMinutesToTime(getDisplayedTotalMinutes(session))}</td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{disp.label}</span>
                      <span>₱{disp.value.toFixed(2)}</span>
                    </div>
                  </td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>{getDiscountText(session)}</span>
                      <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                        Discount
                      </button>
                    </div>
                  </td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>
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
                      className="receipt-btn"
                      onClick={() => void togglePaid(session)}
                      disabled={togglingPaidId === session.id}
                      style={{ background: toBool(session.is_paid) ? "#1b5e20" : "#b00020" }}
                      title={toBool(session.is_paid) ? "Tap to set UNPAID" : "Tap to set PAID"}
                    >
                      {togglingPaidId === session.id ? "Updating..." : toBool(session.is_paid) ? "PAID" : "UNPAID"}
                    </button>
                  </td>

                  <td>{session.seat_number}</td>
                  <td>{getStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8 }}>
                    {open && canShowStopButton(session) && (
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* DISCOUNT MODAL (same style as Customer_Lists) */}
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 900 }}>{discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}</span>
                <input
                  type="number"
                  min="0"
                  step={discountKind === "percent" ? "1" : "0.01"}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.currentTarget.value)}
                  style={{ width: 140 }}
                  disabled={discountKind === "none"}
                />
              </div>
            </div>

            <div className="receipt-row">
              <span>Reason</span>
              <input
                type="text"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.currentTarget.value)}
                placeholder="e.g. Student discount / Promo / Goodwill"
                style={{ width: 220 }}
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

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="receipt-btn" onClick={() => setDiscountTarget(null)} style={{ flex: 1 }}>
                Cancel
              </button>
              <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount} style={{ flex: 1 }}>
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
                      type="number"
                      min="0"
                      step="0.01"
                      value={gcashInput}
                      onChange={(e) => setGcashAndAutoCash(paymentTarget, e.currentTarget.value)}
                      style={{ width: 160 }}
                    />
                  </div>

                  <div className="receipt-row">
                    <span>Cash</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashInput}
                      onChange={(e) => setCashAndAutoGcash(paymentTarget, e.currentTarget.value)}
                      style={{ width: 160 }}
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

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="receipt-btn" onClick={() => setPaymentTarget(null)} style={{ flex: 1 }}>
                      Cancel
                    </button>
                    <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment} style={{ flex: 1 }}>
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

            {isOpenTimeSession(selectedSession) && canShowStopButton(selectedSession) && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="receipt-btn"
                  disabled={stoppingId === selectedSession.id}
                  onClick={() => void stopReservationTime(selectedSession)}
                  style={{ width: "100%" }}
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
              const discountCalc = applyDiscount(baseCost, di.kind, di.value);

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
                    <span>₱{discountCalc.discountAmount.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{discountCalc.discountedCost.toFixed(2)}</span>
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
                    <span style={{ fontWeight: 900 }}>{toBool(selectedSession.is_paid) ? "PAID" : "UNPAID"}</span>
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
  );
};

export default Customer_Reservations;
