// src/pages/Customer_Reservations.tsx
// ✅ Date filter (shows reservations by selected reservation_date)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both)
// ✅ Receipt summary shows ONLY: Total Balance OR Total Change (NO Total Due / Return)
// ✅ Promo type filtered out (DB + frontend)
// ✅ OPEN sessions auto-update display
// ✅ DISCOUNT:
//    - Discount modal per reservation
//    - Type: percent (%) or peso (₱) or none
//    - Auto recompute totals (table + receipt)

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

  // ✅ DISCOUNT columns in DB
  discount_kind?: DiscountKind;
  discount_value?: number;
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

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

const getDiscountText = (s: CustomerSession): string => {
  const kind = (s.discount_kind ?? "none") as DiscountKind;
  const value = Number(s.discount_value ?? 0);
  return getDiscountTextFrom(kind, value);
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
    const disc = Number(((cost * pct) / 100).toFixed(2));
    const final = Number(Math.max(0, cost - disc).toFixed(2));
    return { discountedCost: final, discountAmount: disc };
  }

  if (kind === "amount") {
    const disc = Number(Math.min(cost, v).toFixed(2));
    const final = Number(Math.max(0, cost - disc).toFixed(2));
    return { discountedCost: final, discountAmount: disc };
  }

  return { discountedCost: Number(cost.toFixed(2)), discountAmount: 0 };
};

const Customer_Reservations: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // ✅ date filter (by reservation_date)
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  // ✅ Discount modal state
  const [discountTarget, setDiscountTarget] = useState<CustomerSession | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  useEffect(() => {
    void fetchReservations();
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

  // ✅ filter sessions by reservation_date
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.reservation_date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

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
    return Number((chargeMinutes * perMinute).toFixed(2));
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
    return toNum(s.total_time);
  };

  // ✅ base cost before discount
  const getBaseSystemCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) {
      const endIso = new Date(nowTick).toISOString();
      return computeCostWithFreeMinutes(s.time_started, endIso);
    }
    return toNum(s.total_amount);
  };

  // ✅ final cost after discount
  const getSessionTotalCost = (s: CustomerSession): number => {
    const base = getBaseSystemCost(s);
    const kind = (s.discount_kind ?? "none") as DiscountKind;
    const value = Number(s.discount_value ?? 0);
    return applyDiscount(base, kind, value).discountedCost;
  };

  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
  };

  // ✅ one display amount only
  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalance(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChange(s) };
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
          total_amount: Number(totalCost.toFixed(2)),
          hour_avail: "CLOSED",
        })
        .eq("id", session.id)
        .select(`*`)
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

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

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);

  const getUsedMinutesForReceipt = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());
    return diffMinutes(s.time_started, s.time_ended);
  };

  const getChargeMinutesForReceipt = (s: CustomerSession): number => {
    const used = getUsedMinutesForReceipt(s);
    return Math.max(0, used - FREE_MINUTES);
  };

  // ✅ Discount modal handlers
  const openDiscountModal = (s: CustomerSession): void => {
    const k = (s.discount_kind ?? "none") as DiscountKind;
    const v = Number(s.discount_value ?? 0);
    setDiscountTarget(s);
    setDiscountKind(k);
    setDiscountInput(String(Number.isFinite(v) ? v : 0));
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const raw = Number(discountInput);
    const clean = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const finalValue = discountKind === "percent" ? clamp(clean, 0, 100) : clean;

    try {
      setSavingDiscount(true);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          discount_kind: discountKind,
          discount_value: finalValue,
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

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Customer Reservations
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
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredSessions.map((session) => {
              const open = isOpenTimeSession(session);
              const disp = getDisplayAmount(session);

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

                  {/* ✅ DISCOUNT */}
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 800 }}>{getDiscountText(session)}</span>
                      <button className="receipt-btn" onClick={() => openDiscountModal(session)}>
                        Discount
                      </button>
                    </div>
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

            {(() => {
              const base = getBaseSystemCost(discountTarget);
              const val = Number(discountInput);
              const safeVal = Number.isFinite(val) ? val : 0;
              const appliedVal =
                discountKind === "percent" ? clamp(Math.max(0, safeVal), 0, 100) : Math.max(0, safeVal);

              const { discountedCost, discountAmount } = applyDiscount(base, discountKind, appliedVal);

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

                  <div className="receipt-total">
                    <span>FINAL SYSTEM COST</span>
                    <span>₱{discountedCost.toFixed(2)}</span>
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

              const base = getBaseSystemCost(selectedSession);
              const kind = (selectedSession.discount_kind ?? "none") as DiscountKind;
              const value = Number(selectedSession.discount_value ?? 0);
              const calc = applyDiscount(base, kind, value);

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
                    <span>{getDiscountText(selectedSession)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Discount Amount</span>
                    <span>₱{calc.discountAmount.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{calc.discountedCost.toFixed(2)}</span>
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
