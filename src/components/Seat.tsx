// src/components/Seat.tsx
// ✅ CUSTOMER VIEW (READ-ONLY)
// ✅ Based on Staff_Dashboard seat map (same pins + bear + grass)
// ✅ NOT editable (no status setting, no dragging, no calibrate)
// ✅ Shows colors based on DB:
//    - seat_blocked_times (ignore note="temp" mirror rows; also ignore note="reservation" if you want same rule)
//    - promo_bookings (TEMP name => yellow; CURRENT => red; FUTURE => purple)
// ✅ Conference room supported (area="conference_room", seat_number NULL)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonSpinner } from "@ionic/react";
import seatsImage from "../assets/seats.png";
import { supabase } from "../utils/supabaseClient";

type SeatStatus = "temp_available" | "occupied_temp" | "occupied" | "reserved";
type PinKind = "seat" | "room";

type SeatPin = {
  id: string;
  label: string;
  x: number; // percent
  y: number; // percent
  kind: PinKind;

  readonly?: boolean;
  fixedStatus?: SeatStatus;
};

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "regular" | "reserved" | string;
  note: string | null;
};

type PromoBookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  area: string;
  seat_number: string | null;
  full_name: string;
};

type Props = {
  /** optional: allow parent to show/hide decorations */
  showDecorations?: boolean;
  /** optional: poll interval (ms) */
  pollMs?: number;
};

const CONFERENCE_ID = "CONFERENCE_ROOM";

// (Optional) swatches - you can keep or remove; read-only anyway
const SWATCH_GREEN_ID = "__SWATCH_GREEN__";
const SWATCH_YELLOW_ID = "__SWATCH_YELLOW__";
const SWATCH_RED_ID = "__SWATCH_RED__";
const SWATCH_PURPLE_ID = "__SWATCH_PURPLE__";

const STATUS_COLOR: Record<SeatStatus, string> = {
  temp_available: "seat-green",
  occupied_temp: "seat-yellow",
  occupied: "seat-orange", // occupied color in your CSS
  reserved: "seat-purple",
};

const farFutureIso = (): string => new Date("2999-12-31T23:59:59.000Z").toISOString();

const normalizeSeatId = (v: string): string => String(v).trim();

const isTempName = (name: string): boolean => {
  const n = name.trim().toLowerCase();
  return n.startsWith("temp");
};

const isTempMirrorRow = (note: string | null): boolean => {
  const n = (note ?? "").trim().toLowerCase();
  return n === "temp";
};

// If you also want customer view to ignore auto reservation blocks (recommended, same as staff)
const isAutoReservationRow = (note: string | null): boolean => {
  const n = (note ?? "").trim().toLowerCase();
  return n === "reservation";
};

const formatPHDate = (d: Date): string =>
  d.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

const Seat: React.FC<Props> = ({ pollMs = 15000 }) => {
  // ✅ SAME PINS AS STAFF (READ-ONLY)
  const pins: SeatPin[] = useMemo(
    () => [
      { id: CONFERENCE_ID, label: "CONFERENCE ROOM", x: 13, y: 21.6, kind: "room" },

      { id: "6", label: "6", x: 39.3, y: 29, kind: "seat" },
      { id: "5", label: "5", x: 45.8, y: 29, kind: "seat" },
      { id: "4", label: "4", x: 52.5, y: 29, kind: "seat" },
      { id: "3", label: "3", x: 58.9, y: 29, kind: "seat" },
      { id: "2", label: "2", x: 73.6, y: 29, kind: "seat" },
      { id: "1", label: "1", x: 80.2, y: 29, kind: "seat" },

      { id: "11", label: "11", x: 13, y: 40.7, kind: "seat" },
      { id: "10", label: "10", x: 25.5, y: 42.7, kind: "seat" },
      { id: "9", label: "9", x: 28, y: 39.5, kind: "seat" },

      { id: "8A", label: "8A", x: 42, y: 39.5, kind: "seat" },
      { id: "8B", label: "8B", x: 42.0, y: 43, kind: "seat" },

      { id: "7A", label: "7A", x: 58, y: 39.7, kind: "seat" },
      { id: "7B", label: "7B", x: 58.2, y: 43, kind: "seat" },

      { id: "13", label: "13", x: 42.5, y: 62.2, kind: "seat" },

      { id: "14", label: "14", x: 47.8, y: 52.3, kind: "seat" },
      { id: "15", label: "15", x: 54.5, y: 52.3, kind: "seat" },
      { id: "16", label: "16", x: 61, y: 52.2, kind: "seat" },
      { id: "17", label: "17", x: 67.6, y: 52.3, kind: "seat" },

      { id: "25", label: "25", x: 55.5, y: 60.8, kind: "seat" },

      { id: "18", label: "18", x: 47.8, y: 69.5, kind: "seat" },
      { id: "19", label: "19", x: 56.7, y: 69.5, kind: "seat" },
      { id: "20", label: "20", x: 65.8, y: 69.5, kind: "seat" },

      { id: "24", label: "24", x: 76, y: 56.7, kind: "seat" },
      { id: "23", label: "23", x: 81.5, y: 59.5, kind: "seat" },
      { id: "22", label: "22", x: 74.4, y: 65.3, kind: "seat" },
      { id: "21", label: "21", x: 82, y: 68.7, kind: "seat" },

      { id: "12A", label: "12A", x: 9.1, y: 67, kind: "seat" },
      { id: "12B", label: "12B", x: 16.5, y: 68.3, kind: "seat" },
      { id: "12C", label: "12C", x: 24, y: 68.2, kind: "seat" },

      // (Optional) right-side swatches (legend)
      { id: SWATCH_GREEN_ID, label: "", x: 90, y: 83.5, kind: "seat", readonly: true, fixedStatus: "temp_available" },
      { id: SWATCH_YELLOW_ID, label: "", x: 90, y: 88, kind: "seat", readonly: true, fixedStatus: "occupied_temp" },
      { id: SWATCH_RED_ID, label: "", x: 90, y: 92.5, kind: "seat", readonly: true, fixedStatus: "occupied" },
      { id: SWATCH_PURPLE_ID, label: "", x: 90, y: 96, kind: "seat", readonly: true, fixedStatus: "reserved" },
    ],
    []
  );

  const seatIdsOnly = useMemo<string[]>(
    () => pins.filter((p) => p.kind === "seat" && !p.readonly).map((p) => p.id),
    [pins]
  );

  const blockedIds = useMemo<string[]>(() => [...seatIdsOnly, CONFERENCE_ID], [seatIdsOnly]);

  const [statusBySeat, setStatusBySeat] = useState<Record<string, SeatStatus>>({});
  const [now, setNow] = useState<Date>(new Date());
  const [loading, setLoading] = useState<boolean>(true);

  const mountedRef = useRef<boolean>(false);

  useEffect(() => {
    mountedRef.current = true;
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(t);
    };
  }, []);

  const loadSeatStatuses = async (): Promise<void> => {
    const nowIso = new Date().toISOString();
    const endIso = farFutureIso();

    const blockedReq = supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source, note")
      .in("seat_number", blockedIds)
      .lt("start_at", endIso)
      .gt("end_at", nowIso);

    // include promos CURRENT + FUTURE (end_at > now)
    const promoSeatsReq = supabase
      .from("promo_bookings")
      .select("id, seat_number, start_at, end_at, status, area, full_name")
      .eq("area", "common_area")
      .eq("status", "active")
      .in("seat_number", seatIdsOnly)
      .lt("start_at", endIso)
      .gt("end_at", nowIso);

    const promoConfReq = supabase
      .from("promo_bookings")
      .select("id, seat_number, start_at, end_at, status, area, full_name")
      .eq("area", "conference_room")
      .eq("status", "active")
      .is("seat_number", null)
      .lt("start_at", endIso)
      .gt("end_at", nowIso);

    const [
      { data: blockedData, error: blockedErr },
      { data: promoSeatsData, error: promoSeatsErr },
      { data: promoConfData, error: promoConfErr },
    ] = await Promise.all([blockedReq, promoSeatsReq, promoConfReq]);

    const next: Record<string, SeatStatus> = {};
    for (const p of pins) next[p.id] = "temp_available";

    const nowMs = new Date(nowIso).getTime();

    // promo rules
    const applyPromoRow = (seatId: string, r: PromoBookingRow): void => {
      if (!seatId) return;

      if (isTempName(r.full_name)) {
        next[seatId] = "occupied_temp"; // YELLOW
        return;
      }

      const s = new Date(r.start_at).getTime();
      const e = new Date(r.end_at).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) return;

      if (nowMs >= s && nowMs < e) {
        next[seatId] = "occupied"; // RED
      } else if (nowMs < s) {
        next[seatId] = "reserved"; // PURPLE
      }
    };

    if (!promoSeatsErr) {
      const rows = (promoSeatsData ?? []) as PromoBookingRow[];
      for (const r of rows) {
        const seat = r.seat_number ? normalizeSeatId(r.seat_number) : "";
        applyPromoRow(seat, r);
      }
    }

    if (!promoConfErr) {
      const rows = (promoConfData ?? []) as PromoBookingRow[];
      if (rows.length > 0) applyPromoRow(CONFERENCE_ID, rows[0]);
    }

    // seat_blocked_times (highest priority)
    if (!blockedErr) {
      const rows = (blockedData ?? []) as SeatBlockedRow[];
      const bySeat: Record<string, SeatStatus> = {};

      for (const r of rows) {
        // ignore TEMP mirrors
        if (isTempMirrorRow(r.note)) continue;

        // ignore auto reservation blocks (same logic as staff)
        if (isAutoReservationRow(r.note)) continue;

        const id = normalizeSeatId(r.seat_number);

        if (r.source === "reserved") {
          bySeat[id] = "reserved";
          continue;
        }

        if (r.source === "regular") {
          if (bySeat[id] !== "reserved") bySeat[id] = "occupied";
          continue;
        }

        if (bySeat[id] !== "reserved") bySeat[id] = "occupied";
      }

      for (const id of blockedIds) {
        if (bySeat[id]) next[id] = bySeat[id];
      }
    }

    if (!mountedRef.current) return;
    setStatusBySeat(next);
    setLoading(false);
  };

  useEffect(() => {
    void loadSeatStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedIds.join("|"), pins.length]);

  useEffect(() => {
    const t = window.setInterval(() => void loadSeatStatuses(), Math.max(3000, pollMs));
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedIds.join("|"), pins.length, pollMs]);

  return (
    <div className="seatmap-wrap seatmap-wrap--customer">
      <div className="seatmap-container">
        <div className="seatmap-card">
          <div className="seatmap-topbar">
            <p className="seatmap-title">Seat Map</p>
            <span className="seatmap-date">{formatPHDate(now)}</span>
          </div>

          <div className="seatmap-stage seatmap-stage--readonly">
            <img src={seatsImage} alt="Seat Map" className="seatmap-img" />

            {pins.map((p) => {
              const st: SeatStatus = p.fixedStatus ?? (statusBySeat[p.id] ?? "temp_available");
              const baseCls = p.kind === "room" ? "seat-pin room" : "seat-pin";
              const readonlyCls = " seat-pin--readonly";
              const cls = `${baseCls} ${STATUS_COLOR[st]}${readonlyCls}`;

              const title =
                p.id === SWATCH_GREEN_ID
                  ? "Legend: Available"
                  : p.id === SWATCH_YELLOW_ID
                  ? "Legend: TEMP Occupied"
                  : p.id === SWATCH_RED_ID
                  ? "Legend: Occupied"
                  : p.id === SWATCH_PURPLE_ID
                  ? "Legend: Reserved"
                  : p.kind === "room"
                  ? "Conference Room"
                  : `Seat ${p.label}`;

              return (
                <div
                  key={p.id}
                  className={cls}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  title={title}
                  aria-label={title}
                >
                  {p.label}
                </div>
              );
            })}

            {loading ? (
              <div className="seatmap-loading">
                <IonSpinner />
              </div>
            ) : null}
          </div>

          <div className="seatmap-legend">
            <div className="legend-item">
              <span className="legend-dot seat-green" /> Available
            </div>
            <div className="legend-item">
              <span className="legend-dot seat-yellow" /> Occupied Temporarily (TEMP)
            </div>
            <div className="legend-item">
              <span className="legend-dot seat-orange" /> Occupied
            </div>
            <div className="legend-item">
              <span className="legend-dot seat-purple" /> Reserved
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Seat;
