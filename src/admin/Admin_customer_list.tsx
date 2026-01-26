// src/pages/Admin_customer_list.tsx
// ✅ Same logic as Customer_Lists:
//    - Date filter (shows records by selected date)
//    - Export to Excel (CSV) for selected date only (UTF-8 BOM + force Date/Time text + amount number only)
//    - Total Amount shows ONLY ONE: Total Balance OR Total Change
// ✅ Admin delete:
//    - Delete single row
//    - Delete ALL rows by selected date (one click)
// ✅ No "any"

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5;
const DOWN_PAYMENT = 50;

interface CustomerSession {
  id: string;
  date: string; // YYYY-MM-DD (Supabase date -> string)
  full_name: string;
  customer_type: string;
  customer_field: string | null;
  has_id: boolean;
  id_number: string | null;
  hour_avail: string;
  time_started: string; // timestamptz
  time_ended: string; // timestamptz
  total_time: number | null; // minutes (or numeric)
  total_amount: number; // system cost (DB numeric)
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

const csvEscape = (v: string): string => `"${v.replace(/"/g, '""')}"`;

const formatTimeText = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

const formatMinutesToTime = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hour${hrs > 1 ? "s" : ""}`;
  return `${hrs} hr ${mins} min`;
};

const Admin_customer_list: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSession, setSelectedSession] = useState<CustomerSession | null>(null);

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  // auto refresh OPEN time display
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // ✅ Date filter
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));

  useEffect(() => {
    void fetchCustomerSessions();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

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

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => (s.date ?? "") === selectedDate);
  }, [sessions, selectedDate]);

  const isOpenTimeSession = (s: CustomerSession): boolean => {
    if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
    const end = new Date(s.time_ended);
    return end.getFullYear() >= 2999;
  };

  const getDisplayedTotalMinutes = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return diffMinutes(s.time_started, new Date(nowTick).toISOString());

    if (typeof s.total_time === "number" && Number.isFinite(s.total_time)) return Number(s.total_time || 0);

    return diffMinutes(s.time_started, s.time_ended);
  };

  // ✅ total cost (OPEN uses live)
  const getSessionTotalCost = (s: CustomerSession): number => {
    if (isOpenTimeSession(s)) return computeCostWithFreeMinutes(s.time_started, new Date(nowTick).toISOString());
    return Number(s.total_amount || 0);
  };

  // ✅ TWO categories (display only one)
  const getSessionBalance = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, totalCost - DOWN_PAYMENT).toFixed(2));
  };

  const getSessionChange = (s: CustomerSession): number => {
    const totalCost = getSessionTotalCost(s);
    return Number(Math.max(0, DOWN_PAYMENT - totalCost).toFixed(2));
  };

  const getDisplayAmount = (s: CustomerSession): { label: "Total Balance" | "Total Change"; value: number } => {
    const bal = getSessionBalance(s);
    if (bal > 0) return { label: "Total Balance", value: bal };
    return { label: "Total Change", value: getSessionChange(s) };
  };

  const stopOpenTime = async (session: CustomerSession): Promise<void> => {
    try {
      setStoppingId(session.id);

      const nowIso = new Date().toISOString();
      const totalMinutes = diffMinutes(session.time_started, nowIso);
      const totalCost = computeCostWithFreeMinutes(session.time_started, nowIso);

      const { data: updated, error } = await supabase
        .from("customer_sessions")
        .update({
          time_ended: nowIso,
          total_time: totalMinutes, // minutes
          total_amount: totalCost, // system cost
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

  // ✅ Delete ALL by selected date
  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) return;

    const ok = window.confirm(`Delete ALL records on date: ${selectedDate}?\n\nThis will remove them from the database.`);
    if (!ok) return;

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase
        .from("customer_sessions")
        .delete()
        .eq("date", selectedDate)
        .neq("reservation", "yes");

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      // remove from UI
      setSessions((prev) => prev.filter((s) => s.date !== selectedDate));
      setSelectedSession(null);
    } catch (e) {
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  const renderTimeOut = (s: CustomerSession): string =>
    isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);

  const renderStatus = (s: CustomerSession): string => {
    if (isOpenTimeSession(s)) return "Ongoing";
    return new Date() > new Date(s.time_ended) ? "Finished" : "Ongoing";
  };

  // ✅ Export to Excel (CSV) for selected date only
  // - UTF-8 BOM
  // - Date/Time forced as TEXT
  // - Amount as NUMBER only
  // - Export ONLY ONE (Balance OR Change) as label+amount
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
      "Date",
      "Full Name",
      "Type",
      "Field",
      "Has ID",
      "Specific ID",
      "Hours",
      "Time In",
      "Time Out",
      "Total Time",
      "Amount Label",
      "Amount",
      "Seat",
      "Status",
    ];

    const rows = filteredSessions.map((s) => {
      const timeIn = formatTimeText(s.time_started);
      const timeOut = isOpenTimeSession(s) ? "OPEN" : formatTimeText(s.time_ended);
      const status = renderStatus(s);

      const totalMins = getDisplayedTotalMinutes(s);
      const disp = getDisplayAmount(s);

      return [
        `\t${s.date}`,
        s.full_name,
        s.customer_type,
        s.customer_field ?? "",
        s.has_id ? "Yes" : "No",
        s.id_number ?? "N/A",
        s.hour_avail,
        `\t${timeIn}`,
        `\t${timeOut}`,
        formatMinutesToTime(totalMins),
        disp.label,
        disp.value.toFixed(2),
        s.seat_number,
        status,
      ];
    });

    const csv =
      "\ufeff" +
      [headers, ...rows]
        .map((r) => r.map((v) => csvEscape(String(v ?? ""))).join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-nonreservation-${selectedDate}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="customer-lists-container">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 className="customer-lists-title" style={{ margin: 0 }}>
          Admin Customer Lists - Non Reservation
        </h2>

        {/* ✅ Date filter + Export + Delete by date */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
          />

          <button className="receipt-btn" onClick={exportToExcel} disabled={filteredSessions.length === 0}>
            Export to Excel
          </button>

          <button
            className="receipt-btn"
            onClick={() => void deleteByDate()}
            disabled={filteredSessions.length === 0 || deletingDate === selectedDate}
            style={{ background: "#b00020" }}
          >
            {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Showing records for: <strong>{selectedDate}</strong> ({filteredSessions.length})
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
              <th>Total Time</th>
              <th>Total Balance / Change</th>
              <th>Seat</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredSessions.map((session) => {
              const open = isOpenTimeSession(session);
              const totalMins = getDisplayedTotalMinutes(session);
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

                  <td>{formatMinutesToTime(totalMins)}</td>

                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{disp.label}</span>
                      <span>₱{disp.value.toFixed(2)}</span>
                    </div>
                  </td>

                  <td>{session.seat_number}</td>
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

                    <button
                      className="receipt-btn"
                      disabled={deletingId === session.id}
                      onClick={() => void deleteSession(session)}
                      style={{ background: "#444" }}
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
              <span>Total Time</span>
              <span>{formatMinutesToTime(getDisplayedTotalMinutes(selectedSession))}</span>
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
                  <div className="receipt-row">
                    <span>{disp.label}</span>
                    <span>₱{disp.value.toFixed(2)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Down Payment</span>
                    <span>₱{DOWN_PAYMENT.toFixed(2)}</span>
                  </div>

                  {/* optional debug */}
                  <div className="receipt-row">
                    <span>System Cost</span>
                    <span>₱{totalCost.toFixed(2)}</span>
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

export default Admin_customer_list;
