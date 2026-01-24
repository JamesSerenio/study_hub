import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";

interface PromoBookingRow {
  id: string;
  created_at: string;
  full_name: string;
  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

/**
 * ✅ Exact DB shape returned by Supabase select (with joins/aliases).
 * Avoids TS issues in strict mode.
 */
interface PromoBookingDBRow {
  id: string;
  created_at: string;
  full_name: string;
  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number | string | null;

  packages: { title: string | null } | null;

  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

/* ================= HELPERS ================= */

const toNumber = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const prettyArea = (a: PackageArea): string =>
  a === "conference_room" ? "Conference Room" : "Common Area";

const seatLabel = (r: PromoBookingRow): string =>
  r.area === "conference_room" ? "CONFERENCE ROOM" : r.seat_number || "N/A";

const getStatus = (startIso: string, endIso: string): "UPCOMING" | "ONGOING" | "FINISHED" => {
  const now = Date.now();
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();

  if (!Number.isFinite(s) || !Number.isFinite(e)) return "FINISHED";
  if (now < s) return "UPCOMING";
  if (now >= s && now <= e) return "ONGOING";
  return "FINISHED";
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

/* ================= COMPONENT ================= */

const Admin_Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // optional: auto refresh status/time every 10s
  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const fetchPromoBookings = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("promo_bookings")
      .select(
        `
        id,
        created_at,
        full_name,
        area,
        seat_number,
        start_at,
        end_at,
        price,
        packages:package_id ( title ),
        package_options:package_option_id (
          option_name,
          duration_value,
          duration_unit
        )
      `
      )
      .order("created_at", { ascending: false });

    if (error || !data) {
      console.error(error);
      setRows([]);
      setLoading(false);
      return;
    }

    const dbRows: PromoBookingDBRow[] = data as unknown as PromoBookingDBRow[];

    const normalized: PromoBookingRow[] = dbRows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      full_name: row.full_name,
      area: row.area,
      seat_number: row.seat_number,
      start_at: row.start_at,
      end_at: row.end_at,
      price: toNumber(row.price),
      packages: row.packages ?? null,
      package_options: row.package_options ?? null,
    }));

    setRows(normalized);
    setLoading(false);
  };

  useEffect(() => {
    void fetchPromoBookings();
  }, []);

  const deletePromoBooking = async (row: PromoBookingRow): Promise<void> => {
    const ok = window.confirm(
      `Delete this promo record?\n\n${row.full_name}\n${prettyArea(row.area)} - ${seatLabel(row)}\nStart: ${new Date(
        row.start_at
      ).toLocaleString("en-PH")}`
    );
    if (!ok) return;

    try {
      setDeletingId(row.id);

      const { error } = await supabase.from("promo_bookings").delete().eq("id", row.id);
      if (error) {
        alert(`Delete error: ${error.message}`);
        return;
      }

      setRows((prev) => prev.filter((x) => x.id !== row.id));
      setSelected((prev) => (prev?.id === row.id ? null : prev));
    } finally {
      setDeletingId(null);
    }
  };

  const totals = useMemo(() => {
    void tick;

    const total = rows.reduce((sum, r) => sum + toNumber(r.price), 0);
    const upcoming = rows.filter((r) => getStatus(r.start_at, r.end_at) === "UPCOMING").length;
    const ongoing = rows.filter((r) => getStatus(r.start_at, r.end_at) === "ONGOING").length;
    const finished = rows.filter((r) => getStatus(r.start_at, r.end_at) === "FINISHED").length;

    return { total, upcoming, ongoing, finished };
  }, [rows, tick]);

  return (
    <div className="customer-lists-container">
      <h2 className="customer-lists-title">Admin Discount / Promo Records</h2>

      <div style={{ marginBottom: 10, opacity: 0.85 }}>
        <span style={{ marginRight: 14 }}>
          Upcoming: <strong>{totals.upcoming}</strong>
        </span>
        <span style={{ marginRight: 14 }}>
          Ongoing: <strong>{totals.ongoing}</strong>
        </span>
        <span style={{ marginRight: 14 }}>
          Finished: <strong>{totals.finished}</strong>
        </span>
        <span>
          Total Sales: <strong>₱{totals.total.toFixed(2)}</strong>
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
              <th>Date</th>
              <th>Customer</th>
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

              const optionText =
                opt?.option_name && opt?.duration_value && opt?.duration_unit
                  ? `${opt.option_name} • ${formatDuration(
                      Number(opt.duration_value),
                      opt.duration_unit
                    )}`
                  : opt?.option_name || "—";

              return (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString("en-PH")}</td>
                  <td>{r.full_name}</td>
                  <td>{prettyArea(r.area)}</td>
                  <td>{seatLabel(r)}</td>
                  <td>{r.packages?.title || "—"}</td>
                  <td>{optionText}</td>
                  <td>{new Date(r.start_at).toLocaleString("en-PH")}</td>
                  <td>{new Date(r.end_at).toLocaleString("en-PH")}</td>
                  <td>₱{toNumber(r.price).toFixed(2)}</td>
                  <td>
                    <strong>{getStatus(r.start_at, r.end_at)}</strong>
                  </td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <button className="receipt-btn" onClick={() => setSelected(r)}>
                      View Receipt
                    </button>

                    <button
                      className="receipt-btn"
                      disabled={deletingId === r.id}
                      onClick={() => void deletePromoBooking(r)}
                    >
                      {deletingId === r.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ================= RECEIPT (VIEW ONLY) ================= */}
      {selected && (
        <div className="receipt-overlay" onClick={() => setSelected(null)}>
          <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
            <img src={logo} className="receipt-logo" alt="logo" />

            <h3 className="receipt-title">ME TYME LOUNGE</h3>
            <p className="receipt-subtitle">PROMO RECEIPT</p>

            <hr />

            <div className="receipt-row">
              <span>Status</span>
              <span>{getStatus(selected.start_at, selected.end_at)}</span>
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
              <span>₱{toNumber(selected.price).toFixed(2)}</span>
            </div>

            <button className="close-btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin_Customer_Discount_List;
