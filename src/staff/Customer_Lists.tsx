// src/pages/Customer_Lists.tsx
// ✅ Shows ONLY NON-RESERVATION records (reservation = "no")
// ✅ Seat column REMOVED from Customer List table (but still shown on receipt; remove if you want)
// ✅ Discount UI reverted to previous "breakdown" layout (System Cost / Discount / Final / New Balance / Auto Payment)
// ✅ Auto PAID/UNPAID on SAVE PAYMENT (paid >= due)
// ✅ Manual PAID/UNPAID toggle still works
// ✅ Payment (GCash/Cash auto based on Total Balance AFTER discount)
// ✅ Discount reason is SAVED but ❌ NOT shown on receipt
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5;
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
  time_started: string;
  time_ended: string;
  total_time: number;
  total_amount: number;
  reservation: string;
  reservation_date: string | null;
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

// keep gcash (clamp to due), cash = remaining
const recalcPaymentsToDue = (due: number, gcash: number): { gcash: number; cash: number } => {
  const d = round2(Math.max(0, due));
  if (d <= 0) return { gcash: 0, cash: 0 };

  const g = round2(Math.min(d, Math.max(0, gcash)));
  const c = round2(Math.max(0, d - g));
  return { gcash: g, cash: c };
};

const Customer_Lists: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // Date filter
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
    void fetchCustomerSessions();
  }, []);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  const fetchCustomerSessions = async (): Promise<void> => {
    setLoading(true);

    // ✅ ONLY NON-RESERVATION
    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .eq("reservation", "no")
      .order("date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading customer lists");
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions((data as CustomerSession[]) || []);
    setLoading(false);
  };

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
    const balance = getSessionBalance(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
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

      setSessions((prev) => prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s)));
      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  // ✅ renderTimeOut always safe
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

          // ✅ auto adjust payment to new due (keeps gcash as main input)
          gcash_amount: adjPay.gcash,
          cash_amount: adjPay.cash,

          // ✅ auto set paid status based on payment vs due
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

  // ✅ AUTO PAID/UNPAID on SAVE PAYMENT (always)
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
  // ✅ PAID / UNPAID TOGGLE (manual)
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
          Customer Lists - Non Reservation
        </h2>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
          />
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filteredSessions.length === 0 ? (
        <p>No data found for this date</p>
      ) : (
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
              <th>Total Hours</th>
              <th>Total Balance / Change</th>
              <th>Discount</th>
              <th>Payment</th>
              <th>Paid?</th>
              {/* ✅ SEAT REMOVED */}
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
                  <td>{session.date}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_type}</td>
                  <td>{session.customer_field ?? ""}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number ?? "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{formatTimeText(session.time_started)}</td>
                  <td>{renderTimeOut(session)}</td>
                  <td>{session.total_time}</td>

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

                  {/* ✅ SEAT REMOVED */}

                  <td>{renderStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* DISCOUNT MODAL (reverted layout) */}
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
                <span style={{ fontWeight: 900 }}>
                  {discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}
                </span>
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
              <button
                className="receipt-btn"
                onClick={() => void saveDiscount()}
                disabled={savingDiscount}
                style={{ flex: 1 }}
              >
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
                    <button
                      className="receipt-btn"
                      onClick={() => void savePayment()}
                      disabled={savingPayment}
                      style={{ flex: 1 }}
                    >
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

            {/* NOTE: Seat is still shown on receipt. Remove this block if you also want it removed in receipt. */}
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
              <div style={{ marginTop: 12 }}>
                <button
                  className="receipt-btn"
                  disabled={stoppingId === selectedSession.id}
                  onClick={() => void stopOpenTime(selectedSession)}
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

                  {/* ❌ DISCOUNT REASON REMOVED FROM RECEIPT */}

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

export default Customer_Lists;
