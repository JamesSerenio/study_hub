// Admin_customer_list.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5; // system-only (NOT shown on receipt)
const DOWN_PAYMENT = 50;

interface CustomerSession {
  id: string;
  date: string;
  full_name: string;
  customer_type: string;
  customer_field: string;
  has_id: boolean;
  id_number: string;
  hour_avail: string;
  time_started: string;
  time_ended: string;

  // ✅ store minutes in DB (recommended). If your DB still uses total_hours, keep it.
  // We'll use total_time for display if present; fallback to total_hours.
  total_time?: number;


  total_amount: number;
  reservation: string;
  reservation_date: string | null;
  seat_number: string;
}

const Admin_customer_list: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ✅ for auto refresh of OPEN time display
  const [nowTick, setNowTick] = useState<number>(Date.now());

  useEffect(() => {
    void fetchCustomerSessions();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const fetchCustomerSessions = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select("*")
      .neq("reservation", "yes")
      .order("date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading customer lists");
    } else {
      setSessions((data as CustomerSession[]) || []);
    }

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

  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return Number((chargeMinutes * perMinute).toFixed(2));
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    // if open, show running minutes
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());

    // if DB has total_time (minutes) use it
    if (typeof s.total_time === "number") return Number(s.total_time || 0);

    // fallback if old DB uses total_hours (hours) -> convert to minutes for display
    if (typeof s.total_time === "number") return Math.round((Number(s.total_time || 0) || 0) * 60);

    // final fallback
    return diffMinutes(s.time_started, s.time_ended);
  };

  const formatMinutesToTime = (minutes: number): string => {
    if (!minutes || minutes <= 0) return "0 min";
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
    return `${hrs} hr ${mins} min`;
  };

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalMinutes = diffMinutes(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      // ✅ save minutes in total_time (recommended)
      // if your table doesn't have total_time yet, add it or change this to total_hours.
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
      console.error(e);
      alert("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const renderTimeOut = (s: CustomerSession) =>
    isOpenTimeSession(s) ? "OPEN" : new Date(s.time_ended).toLocaleTimeString("en-PH");

  const renderStatus = (s: CustomerSession) => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  const getPaymentSummary = (s: CustomerSession) => {
    const totalCost = Number(s.total_amount || 0);
    const down = DOWN_PAYMENT;

    const change = totalCost <= down ? Number((down - totalCost).toFixed(2)) : 0;
    const balance = totalCost > down ? Number((totalCost - down).toFixed(2)) : 0;

    return { totalCost, down, change, balance };
  };

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Admin Customer Lists - Non Reservation</h2>

      {loading ? (
        <p>Loading...</p>
      ) : sessions.length === 0 ? (
        <p>No data found</p>
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
              <th>Total Time</th>
              <th>Total Amount</th>
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {sessions.map((session) => {
              const open = isOpenTimeSession(session);
              const totalMins = getDisplayedTotalMinutes(session);

              return (
                <tr key={session.id}>
                  <td>{session.date}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_type}</td>
                  <td>{session.customer_field}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number || "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{new Date(session.time_started).toLocaleTimeString("en-PH")}</td>
                  <td>{renderTimeOut(session)}</td>

                  {/* ✅ auto convert mins->hours */}
                  <td>{formatMinutesToTime(totalMins)}</td>

                  <td>₱{Number(session.total_amount || 0).toFixed(2)}</td>
                  <td>{session.seat_number}</td>
                  <td>{renderStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8 }}>
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
              <span>{selectedSession.customer_field}</span>
            </div>

            <div className="receipt-row">
              <span>Seat</span>
              <span>{selectedSession.seat_number}</span>
            </div>

            <hr />

            <div className="receipt-row">
              <span>Time In</span>
              <span>{new Date(selectedSession.time_started).toLocaleTimeString("en-PH")}</span>
            </div>

            <div className="receipt-row">
              <span>Time Out</span>
              <span>{renderTimeOut(selectedSession)}</span>
            </div>

            <div className="receipt-row">
              <span>Total Time</span>
              <span>{formatMinutesToTime(getDisplayedTotalMinutes(selectedSession))}</span>
            </div>

            {/* ✅ no "Free Minutes" on receipt */}

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
              const { totalCost, down, change, balance } = getPaymentSummary(selectedSession);
              const isChange = change > 0;
              const totalLabel = isChange ? "TOTAL CHANGE" : "TOTAL BALANCE";
              const totalValue = isChange ? change : balance;

              return (
                <>
                  <div className="receipt-row">
                    <span>Total Cost</span>
                    <span>₱{totalCost.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{down.toFixed(2)}</span>
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

export default Admin_customer_list;
