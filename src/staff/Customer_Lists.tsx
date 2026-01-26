// src/pages/Customer_Lists.tsx
// ✅ Date filter (shows records by selected date)
// ✅ Total Amount shows ONLY ONE: Total Balance OR Total Change (NOT both)
// ✅ Receipt summary shows ONLY: Total Balance OR Total Change (NO Total Due / Return)
// ✅ REMOVED: Export to Excel

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5; // system-only (HIDDEN on receipt)
const DOWN_PAYMENT = 50;

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
  total_amount: number; // DB numeric
  reservation: string;
  reservation_date: string | null;
  seat_number: string;
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

const Customer_Lists: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // ✅ Date filter
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  useEffect(() => {
    void fetchCustomerSessions();
  }, []);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  const fetchCustomerSessions = async (): Promise<void> => {
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

  const computeHours = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    const hours = (end - start) / (1000 * 60 * 60);
    return Number(hours.toFixed(2));
  };

  // ✅ Billing starts after first FREE_MINUTES
  const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
    const minutesUsed = diffMinutes(startIso, endIso);
    const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
    const perMinute = HOURLY_RATE / 60;
    return Number((chargeMinutes * perMinute).toFixed(2));
  };

  // ✅ Live cost for OPEN sessions (display only)
  const getLiveTotalCost = (s: CustomerSession): number => {
    const nowIso = new Date().toISOString();
    return computeCostWithFreeMinutes(s.time_started, nowIso);
  };

  // ✅ Total system cost (OPEN uses live; CLOSED uses DB)
  const getSessionTotalCost = (s: CustomerSession): number => {
    return isOpenTimeSession(s) ? getLiveTotalCost(s) : Number(s.total_amount || 0);
  };

  // ✅ TWO categories (but we will DISPLAY only one)
  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
  };

  // ✅ One display value for table/receipt
  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const balance = getSessionBalance(s);
    if (balance > 0) return { label: "Total Balance", value: balance };
    return { label: "Total Change", value: getSessionChange(s) };
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

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);

  const renderStatus = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  const getUsedMinutesForReceipt = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date().toISOString());
    return diffMinutes(s.time_started, s.time_ended);
  };

  const getChargeMinutesForReceipt = (s: CustomerSession): number => {
    const used = getUsedMinutesForReceipt(s);
    return Math.max(0, used - FREE_MINUTES);
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Customer Lists - Non Reservation
        </h2>

        {/* ✅ Date filter ONLY */}
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

                  {/* ✅ ONLY ONE OUTPUT */}
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{disp.label}</span>
                      <span>₱{disp.value.toFixed(2)}</span>
                    </div>
                  </td>

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
              const totalCost = getSessionTotalCost(selectedSession);

              return (
                <>
                  {/* ✅ ONLY ONE SUMMARY LINE */}
                  <div className="receipt-row">
                    <span>{disp.label}</span>
                    <span>₱{disp.value.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                  </div>

                  {/* Optional debug line (remove if you want hidden) */}
                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{totalCost.toFixed(2)}</span>
                  </div>

                  {/* ✅ NO TOTAL DUE / RETURN */}
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
