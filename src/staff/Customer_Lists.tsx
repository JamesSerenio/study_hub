import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

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
  seat_number: string;  // Added seat_number
  customer_session_add_ons: {  // Changed from add_ons to customer_session_add_ons
    add_ons: { name: string };
    quantity: number;
    price: number;
    total: number;
  }[];
}

const Customer_Lists: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] =
    useState<CustomerSession | null>(null);

  useEffect(() => {
    fetchCustomerSessions();
  }, []);

  const fetchCustomerSessions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("customer_sessions")
      .select(`
        *,
        customer_session_add_ons(
          add_ons(name),
          quantity,
          price,
          total
        )
      `)
      .neq("reservation", "yes")
      .order("date", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading customer lists");
    } else {
      setSessions(data || []);
    }
    setLoading(false);
  };

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">
        Customer Lists - Non Reservation
      </h2>

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
              <th>Status</th>  {/* New column for status */}
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>{session.date}</td>
                <td>{session.full_name}</td>
                <td>{session.customer_type}</td>
                <td>{session.customer_field}</td>
                <td>{session.has_id ? "Yes" : "No"}</td>
                <td>{session.id_number || "N/A"}</td>
                <td>{session.hour_avail}</td>
                <td>{new Date(session.time_started).toLocaleTimeString()}</td>
                <td>{new Date(session.time_ended).toLocaleTimeString()}</td>
                <td>{session.total_hours}</td>
                <td>₱{session.total_amount.toFixed(2)}</td>
                <td>{session.seat_number}</td>
                <td>
                  {session.customer_session_add_ons && session.customer_session_add_ons.length > 0
                    ? session.customer_session_add_ons.map((addOn) => `${addOn.add_ons.name} x${addOn.quantity}`).join(', ')
                    : 'None'}
                </td>
                <td>{new Date() > new Date(session.time_ended) ? "Finished" : "Ongoing"}</td>  {/* New status cell */}
                <td>
                  <button
                    className="receipt-btn"
                    onClick={() => setSelectedSession(session)}
                  >
                    View Receipt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* RECEIPT MODAL */}
      {selectedSession && (
        <div
          className="receipt-overlay"
          onClick={() => setSelectedSession(null)}
        >
          <div
            className="receipt-container"
            onClick={(e) => e.stopPropagation()}
          >
            {/* LOGO */}
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
              <span>
                {new Date(
                  selectedSession.time_started
                ).toLocaleTimeString()}
              </span>
            </div>

            <div className="receipt-row">
              <span>Time Out</span>
              <span>
                {new Date(selectedSession.time_ended).toLocaleTimeString()}
              </span>
            </div>

            <div className="receipt-row">
              <span>Total Hours</span>
              <span>{selectedSession.total_hours}</span>
            </div>

            {selectedSession.customer_session_add_ons && selectedSession.customer_session_add_ons.length > 0 && (
              <>
                <hr />
                <h4>Add-Ons</h4>
                {selectedSession.customer_session_add_ons.map((addOn, index) => (
                  <div key={index} className="receipt-row">
                    <span>{addOn.add_ons.name} x{addOn.quantity}</span>
                    <span>₱{addOn.total.toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}

            <hr />

            <div className="receipt-total">
              <span>TOTAL</span>
              <span>₱{selectedSession.total_amount.toFixed(2)}</span>
            </div>

            <p className="receipt-footer">
              Thank you for choosing <br />
              <strong>Me Tyme Lounge</strong>
            </p>

            <button
              className="close-btn"
              onClick={() => setSelectedSession(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customer_Lists;