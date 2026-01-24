// src/pages/Customer_Discount_List.tsx
// ✅ STAFF VIEW ONLY (NO EDIT / NO DELETE)
// ✅ View promo/discount records from promo_bookings + receipt modal only

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type PackageArea = "common_area" | "conference_room";
type PromoStatus = "pending" | "approved" | "cancelled" | string;
type DurationUnit = "hour" | "day" | "month" | "year";

interface PromoBookingRow {
  id: string;
  created_at: string;
  full_name: string;
  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number | string;
  status: PromoStatus;

  // joins
  packages?: { title: string | null } | null;
  package_options?: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
    price: number | string | null;
  } | null;
}

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const prettyArea = (a: PackageArea): string => (a === "conference_room" ? "Conference Room" : "Common Area");

const statusLabel = (s: PromoStatus): string => {
  const x = String(s).toLowerCase();
  if (x === "pending") return "Reserved";
  if (x === "approved") return "Approved";
  if (x === "cancelled") return "Cancelled";
  return String(s);
};

const formatDuration = (v: number, u: DurationUnit): string => {
  const unit =
    u === "hour"
      ? v === 1
        ? "hour"
        : "hours"
      : u === "day"
      ? v === 1
        ? "day"
        : "days"
      : u === "month"
      ? v === 1
        ? "month"
        : "months"
      : v === 1
      ? "year"
      : "years";
  return `${v} ${unit}`;
};

const Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);

  const fetchPromoBookings = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("promo_bookings")
      .select(
        `
        id, created_at, full_name, area, seat_number, start_at, end_at, price, status,
        packages:package_id ( title ),
        package_options:package_option_id ( option_name, duration_value, duration_unit, price )
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      alert(`Error loading discount list: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as PromoBookingRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    void fetchPromoBookings();
  }, []);

  const totals = useMemo(() => {
    const total = rows.reduce((sum, r) => sum + toNum(r.price), 0);
    const reserved = rows.filter((r) => String(r.status).toLowerCase() === "pending").length;
    const approved = rows.filter((r) => String(r.status).toLowerCase() === "approved").length;
    return { total, reserved, approved };
  }, [rows]);

  const seatLabel = (r: PromoBookingRow): string => {
    if (r.area === "conference_room") return "CONFERENCE ROOM";
    return r.seat_number || "N/A";
  };

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Customer Discount / Promo Records</h2>

      <div style={{ marginBottom: 10, opacity: 0.85 }}>
        <span style={{ marginRight: 14 }}>
          Reserved: <strong>{totals.reserved}</strong>
        </span>
        <span style={{ marginRight: 14 }}>
          Approved: <strong>{totals.approved}</strong>
        </span>
        <span>
          Total Promo Sales: <strong>₱{totals.total.toFixed(2)}</strong>
        </span>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : rows.length === 0 ? (
        <p>No promo records found</p>
      ) : (
        <table className="customer-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Full Name</th>
              <th>Area</th>
              <th>Seat</th>
              <th>Package</th>
              <th>Option</th>
              <th>Start</th>
              <th>End</th>
              <th>Price</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const opt = r.package_options;
              const optText =
                opt?.option_name && opt?.duration_value && opt?.duration_unit
                  ? `${opt.option_name} • ${formatDuration(Number(opt.duration_value), opt.duration_unit)}`
                  : opt?.option_name || "—";

              return (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString("en-PH")}</td>
                  <td>{r.full_name}</td>
                  <td>{prettyArea(r.area)}</td>
                  <td>{seatLabel(r)}</td>
                  <td>{r.packages?.title || "—"}</td>
                  <td>{optText}</td>
                  <td>{new Date(r.start_at).toLocaleString("en-PH")}</td>
                  <td>{new Date(r.end_at).toLocaleString("en-PH")}</td>
                  <td>₱{toNum(r.price).toFixed(2)}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td>
                    <button className="receipt-btn" onClick={() => setSelected(r)}>
                      View Receipt
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* RECEIPT MODAL (VIEW ONLY) */}
      {selected && (
        <div className="receipt-overlay" onClick={() => setSelected(null)}>
          <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
            <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />

            <h3 className="receipt-title">ME TYME LOUNGE</h3>
            <p className="receipt-subtitle">PROMO / DISCOUNT RECEIPT</p>

            <hr />

            <div className="receipt-row">
              <span>Status</span>
              <span>{statusLabel(selected.status)}</span>
            </div>

            <div className="receipt-row">
              <span>Customer</span>
              <span>{selected.full_name}</span>
            </div>

            <div className="receipt-row">
              <span>Area</span>
              <span>{prettyArea(selected.area)}</span>
            </div>

            <div className="receipt-row">
              <span>Seat</span>
              <span>{seatLabel(selected)}</span>
            </div>

            <hr />

            <div className="receipt-row">
              <span>Package</span>
              <span>{selected.packages?.title || "—"}</span>
            </div>

            <div className="receipt-row">
              <span>Option</span>
              <span>{selected.package_options?.option_name || "—"}</span>
            </div>

            {selected.package_options?.duration_value && selected.package_options?.duration_unit ? (
              <div className="receipt-row">
                <span>Duration</span>
                <span>
                  {formatDuration(
                    Number(selected.package_options.duration_value),
                    selected.package_options.duration_unit
                  )}
                </span>
              </div>
            ) : null}

            <hr />

            <div className="receipt-row">
              <span>Start</span>
              <span>{new Date(selected.start_at).toLocaleString("en-PH")}</span>
            </div>

            <div className="receipt-row">
              <span>End</span>
              <span>{new Date(selected.end_at).toLocaleString("en-PH")}</span>
            </div>

            <div className="receipt-total">
              <span>TOTAL</span>
              <span>₱{toNum(selected.price).toFixed(2)}</span>
            </div>

            <p className="receipt-footer">
              Thank you for choosing <br />
              <strong>Me Tyme Lounge</strong>
            </p>

            <button className="close-btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customer_Discount_List;
