// Admin_customer_reservation.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5; // hidden
const DOWN_PAYMENT = 50;

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

  // minutes stored in DB (numeric may come as number|string)
  total_time: number | string;

  total_amount: number | string;

  reservation: string;
  reservation_date: string | null;
  seat_number: string;
}

const Admin_customer_reservation: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  useEffect(() => {
    void fetchReservations();
  }, []);

  // tick so OPEN sessions auto-update display
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const toNum = (v: number | string | null | undefined): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  // ✅ promo detector (case/space insensitive)
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
      // ✅ do NOT record/show promo reservations here
      .neq("customer_type", "promo")
      .order("reservation_date", { ascending: false });

    if (error) {
      console.error(error);
      alert(`Error loading reservations: ${error.message}`);
      setSessions([]);
      setLoading(false);
      return;
    }

    // ✅ extra safety in frontend for "Promo", " PROMO ", etc.
    const cleaned = ((data as CustomerSession[]) || []).filter((s) => !isPromoType(s.customer_type));

    setSessions(cleaned);
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

  const formatMinutesToTime = (minutes: number): string => {
    if (!minutes || minutes <= 0) return "0 min";

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

  // ✅ scheduled start = reservation_date (date) + time_started (time)
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

  // ✅ Stop Time only appears when NOW >= scheduled date+time
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

  const getLiveTotalCost = (s: CustomerSession): number => {
    const endIso = new Date(nowTick).toISOString();
    const timeCost = computeCostWithFreeMinutes(s.time_started, endIso);
    return Number(timeCost.toFixed(2));
  };

  // ✅ total cost (open uses live)
  const getSessionTotalCost = (s: CustomerSession): number => {
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : toNum(s.total_amount);
  };

  // ✅ balance after downpayment (this is what "Total Amount" should show)
  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
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
        .select(`*`)
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      // ✅ if it becomes promo, remove from list
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

  // ✅ Admin delete (requires RLS policy to allow admin role)
  const deleteSession = async (session: CustomerSession): Promise<void> => {
    const ok = window.confirm(
      `Delete this reservation record?\n\n${session.full_name}\nReservation Date: ${
        session.reservation_date ? new Date(session.reservation_date).toLocaleDateString("en-PH") : "N/A"
      }`
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
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : new Date(s.time_ended).toLocaleString("en-PH");

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Admin Customer Reservations</h2>

      {loading ? (
        <p>Loading...</p>
      ) : sessions.length === 0 ? (
        <p>No reservation records found</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th>Reservation Date</th>
              <th>Full Name</th>

              {/* ❌ removed promo/type display */}
              {/* <th>Type</th> */}

              <th>Field</th>
              <th>Has ID</th>
              <th>Specific ID</th>
              <th>Hours</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Total Time</th>
              <th>Total Amount</th>
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {sessions.map((session) => {
              const showStop = canShowStopButton(session);
              const mins = getDisplayedTotalMinutes(session);

              return (
                <tr key={session.id}>
                  <td>
                    {session.reservation_date
                      ? new Date(session.reservation_date).toLocaleDateString("en-PH")
                      : "N/A"}
                  </td>
                  <td>{session.full_name}</td>

                  {/* ❌ removed promo/type display */}
                  {/* <td>{session.customer_type}</td> */}

                  <td>{session.customer_field}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number || "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{new Date(session.time_started).toLocaleString("en-PH")}</td>
                  <td>{renderTimeOut(session)}</td>

                  <td>{formatMinutesToTime(mins)}</td>

                  <td>₱{getSessionBalance(session).toFixed(2)}</td>

                  <td>{session.seat_number}</td>
                  <td>{getStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8 }}>
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
                      className="receipt-btn"
                      disabled={deletingId === session.id}
                      onClick={() => void deleteSession(session)}
                    >
                      {deletingId === session.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              <span>
                {selectedSession.reservation_date
                  ? new Date(selectedSession.reservation_date).toLocaleDateString("en-PH")
                  : "N/A"}
              </span>
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
              <span>{new Date(selectedSession.time_started).toLocaleString("en-PH")}</span>
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
              const change = getSessionChange(selectedSession);
              const balance = getSessionBalance(selectedSession);

              const totalLabel = change > 0 ? "TOTAL CHANGE" : "TOTAL BALANCE";
              const totalValue = change > 0 ? change : balance;

              return (
                <>
                  <div className="receipt-row">
                    <span>Total Amount</span>
                    <span>₱{balance.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                  </div>

                  {change > 0 && (
                    <div className="receipt-row">
                      <span>Change</span>
                      <span>₱{change.toFixed(2)}</span>
                    </div>
                  )}

                  {balance > 0 && (
                    <div className="receipt-row">
                      <span>Balance</span>
                      <span>₱{balance.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="receipt-total">
                    <span>{totalLabel}</span>
                    <span>₱{Number(totalValue || 0).toFixed(2)}</span>
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

export default Admin_customer_reservation;
