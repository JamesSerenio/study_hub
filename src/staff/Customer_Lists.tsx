import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;

interface CustomerSessionAddOn {
  add_ons: { name: string };
  quantity: number;
  price: number;
  total: number;
}

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
  total_hours: number;
  total_amount: number;
  reservation: string;
  reservation_date: string | null;
  seat_number: string;
  customer_session_add_ons: CustomerSessionAddOn[];
}

const Customer_Lists: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchCustomerSessions();
  }, []);

  const fetchCustomerSessions = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("customer_sessions")
      .select(
        `
        *,
        customer_session_add_ons(
          add_ons(name),
          quantity,
          price,
          total
        )
      `
      )
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

  const getAddOnsTotal = (s: CustomerSession): number => {
    return (s.customer_session_add_ons || []).reduce((sum, a) => sum + (Number(a.total) || 0), 0);
  };

  const computeHours = (startIso: string, endIso: string): number => {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

    const diffHours = (end - start) / (1000 * 60 * 60);
    return Number(diffHours.toFixed(2));
  };

  // ✅ STOP OPEN TIME: set time_out now, compute totals, and make Stop button disappear
  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalHours = computeHours(session.time_started, nowIso);

      const addOnsTotal = getAddOnsTotal(session);
      const timeAmount = totalHours * HOURLY_RATE;
      const totalAmount = Number((timeAmount + addOnsTotal).toFixed(2));

      // IMPORTANT: hour_avail must NOT remain "OPEN" after stop
      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_hours: totalHours,
          total_amount: totalAmount,
          hour_avail: "CLOSED",
        })
        .eq("id", session.id)
        .select(
          `
          *,
          customer_session_add_ons(
            add_ons(name),
            quantity,
            price,
            total
          )
        `
        )
        .single();

      if (error || !updated) {
        alert(`Stop Time error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      // ✅ Update table instantly (Time Out shows time + Stop button disappears)
      setSessions((prev) => prev.map((s) => (s.id === session.id ? (updated as CustomerSession) : s)));

      // ✅ Update receipt instantly if open
      setSelectedSession((prev) => (prev?.id === session.id ? (updated as CustomerSession) : prev));
    } catch (e) {
      console.error(e);
      alert("Stop Time failed.");
    } finally {
      setStoppingId(null);
    }
  };

  const renderTimeOut = (s: CustomerSession) => {
    return isOpenTimeSession(s) ? "OPEN" : new Date(s.time_ended).toLocaleTimeString();
  };

  const renderStatus = (s: CustomerSession) => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Customer Lists - Non Reservation</h2>

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
              <th>Total Hours</th>
              <th>Total Amount</th>
              <th>Seat</th>
              <th>Add-Ons</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {sessions.map((session) => {
              const open = isOpenTimeSession(session);

              return (
                <tr key={session.id}>
                  <td>{session.date}</td>
                  <td>{session.full_name}</td>
                  <td>{session.customer_type}</td>
                  <td>{session.customer_field}</td>
                  <td>{session.has_id ? "Yes" : "No"}</td>
                  <td>{session.id_number || "N/A"}</td>
                  <td>{session.hour_avail}</td>
                  <td>{new Date(session.time_started).toLocaleTimeString()}</td>
                  <td>{renderTimeOut(session)}</td>
                  <td>{session.total_hours}</td>
                  <td>₱{Number(session.total_amount || 0).toFixed(2)}</td>
                  <td>{session.seat_number}</td>

                  <td>
                    {session.customer_session_add_ons && session.customer_session_add_ons.length > 0
                      ? session.customer_session_add_ons
                          .map((addOn) => `${addOn.add_ons.name} x${addOn.quantity}`)
                          .join(", ")
                      : "None"}
                  </td>

                  <td>{renderStatus(session)}</td>

                  <td style={{ display: "flex", gap: 8 }}>
                    {/* ✅ Only show Stop Time if OPEN */}
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
              <span>{selectedSession.customer_field}</span>
            </div>

            <div className="receipt-row">
              <span>Seat</span>
              <span>{selectedSession.seat_number}</span>
            </div>

            <hr />

            <div className="receipt-row">
              <span>Time In</span>
              <span>{new Date(selectedSession.time_started).toLocaleTimeString()}</span>
            </div>

            <div className="receipt-row">
              <span>Time Out</span>
              <span>{renderTimeOut(selectedSession)}</span>
            </div>

            <div className="receipt-row">
              <span>Total Hours</span>
              <span>{selectedSession.total_hours}</span>
            </div>

            {/* ✅ Stop button inside receipt only if OPEN */}
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

            {selectedSession.customer_session_add_ons && selectedSession.customer_session_add_ons.length > 0 && (
              <>
                <hr />
                <h4>Add-Ons</h4>
                {selectedSession.customer_session_add_ons.map((addOn, index) => (
                  <div key={index} className="receipt-row">
                    <span>
                      {addOn.add_ons.name} x{addOn.quantity}
                    </span>
                    <span>₱{Number(addOn.total || 0).toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}

            <hr />

            <div className="receipt-total">
              <span>TOTAL</span>
              <span>₱{Number(selectedSession.total_amount || 0).toFixed(2)}</span>
            </div>

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
