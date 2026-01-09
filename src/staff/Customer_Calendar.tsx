import React, { useEffect, useState } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { supabase } from '../utils/supabaseClient';
import customerIcon from '../assets/customer.png';
import customerReservationIcon from '../assets/customer_reservation.png';

interface CustomerSession {
  date: string;
  reservation: string;
  reservation_date: string | null;
}

const Customer_Calendar: React.FC = () => {
  const [counts, setCounts] = useState<{ [date: string]: { nonRes: number; res: number } }>({});

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    const { data, error } = await supabase
      .from('customer_sessions')
      .select('date, reservation, reservation_date');

    if (error) {
      console.error('Error fetching sessions:', error);
      return;
    }

    const dateCounts: { [date: string]: { nonRes: number; res: number } } = {};

    data.forEach((session: CustomerSession) => {
      if (session.reservation === 'yes' && session.reservation_date) {
        const date = session.reservation_date;
        if (!dateCounts[date]) dateCounts[date] = { nonRes: 0, res: 0 };
        dateCounts[date].res += 1;
      } else {
        const date = session.date;
        if (!dateCounts[date]) dateCounts[date] = { nonRes: 0, res: 0 };
        dateCounts[date].nonRes += 1;
      }
    });

    setCounts(dateCounts);
  };

  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view === 'month') {
      const dateStr = date.toISOString().split('T')[0];
      const data = counts[dateStr];
      if (data && (data.nonRes > 0 || data.res > 0)) {
        return (
          <div className="calendar-tile">
            {data.nonRes > 0 && (
              <div className="calendar-item">
                <img src={customerIcon} alt="Customer" className="calendar-icon" />
                <span className="calendar-count">{data.nonRes}</span>
              </div>
            )}
            {data.res > 0 && (
              <div className="calendar-item">
                <img src={customerReservationIcon} alt="Reservation" className="calendar-icon" />
                <span className="calendar-count">{data.res}</span>
              </div>
            )}
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div className="customer-calendar-container">
      <h2>Customer Calendar</h2>
      <Calendar tileContent={tileContent} />
    </div>
  );
};

export default Customer_Calendar;