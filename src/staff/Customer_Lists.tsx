// Customer_Lists.tsx
import React, { useEffect, useState } from "react";
import { supabase } from "../utils/supabaseClient";

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
}

const Customer_Lists: React.FC = () => {
  const [sessions, setSessions] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchCustomerSessions();
  }, []);

  const fetchCustomerSessions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_sessions')
        .select('*')
        .neq('reservation', 'yes') // Fetch sessions where reservation is not 'yes'
        .order('date', { ascending: false }); // Order by date descending

      if (error) throw error;
      setSessions(data || []);
    } catch (error) {
      console.error('Error fetching customer sessions:', error);
      alert('Error loading customer lists.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Customer Lists - Non-Reservation Sessions</h2>
      {loading ? (
        <p className="loading-text">Loading...</p>
      ) : sessions.length === 0 ? (
        <p className="no-data-text">No customer sessions found.</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th className="table-header">Date</th>
              <th className="table-header">Full Name</th>
              <th className="table-header">Customer Type</th>
              <th className="table-header">Customer Field</th>
              <th className="table-header">Has ID</th>
              <th className="table-header">ID Number</th>
              <th className="table-header">Hour Avail</th>
              <th className="table-header">Time Started</th>
              <th className="table-header">Time Ended</th>
              <th className="table-header">Total Hours</th>
              <th className="table-header">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="table-cell">{session.date}</td>
                <td className="table-cell">{session.full_name}</td>
                <td className="table-cell">{session.customer_type}</td>
                <td className="table-cell">{session.customer_field}</td>
                <td className="table-cell">{session.has_id ? 'Yes' : 'No'}</td>
                <td className="table-cell">{session.id_number || 'N/A'}</td>
                <td className="table-cell">{session.hour_avail}</td>
                <td className="table-cell">{new Date(session.time_started).toLocaleString()}</td>
                <td className="table-cell">{new Date(session.time_ended).toLocaleString()}</td>
                <td className="table-cell">{session.total_hours}</td>
                <td className="table-cell">₱{session.total_amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Customer_Lists;