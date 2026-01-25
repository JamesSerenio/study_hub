import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonPage, IonContent } from "@ionic/react";
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
};

type StoredPos = { x: number; y: number };
type StoredMap = Record<string, StoredPos>;

const STORAGE_KEY = "seatmap_pin_positions_v1";

const STATUS_COLOR: Record<SeatStatus, string> = {
  temp_available: "seat-blue",
  occupied_temp: "seat-yellow",
  occupied: "seat-orange",
  reserved: "seat-purple",
};

const formatPHDate = (d: Date): string =>
  d.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

const isStoredPos = (v: unknown): v is StoredPos => {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.x === "number" &&
    Number.isFinite(obj.x) &&
    typeof obj.y === "number" &&
    Number.isFinite(obj.y)
  );
};

const loadStored = (): StoredMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = parsed as Record<string, unknown>;
    const out: StoredMap = {};
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (isStoredPos(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

const saveStored = (m: StoredMap): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
};

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | string;
};

type PromoConferenceRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  area: string;
};

const normalizeSeatId = (v: string): string => String(v).trim();

const CONFERENCE_ID = "CONFERENCE_ROOM";

const Staff_Dashboard: React.FC = () => {
  const defaultPins: SeatPin[] = useMemo(
    () => [
      { id: CONFERENCE_ID, label: "CONFERENCE ROOM", x: 26.0, y: 23.8, kind: "room" },

      { id: "6", label: "6", x: 40.8, y: 30.5, kind: "seat" },
      { id: "5", label: "5", x: 47.5, y: 30.5, kind: "seat" },
      { id: "4", label: "4", x: 54, y: 30.5, kind: "seat" },
      { id: "3", label: "3", x: 60.3, y: 30.5, kind: "seat" },
      { id: "2", label: "2", x: 75.3, y: 30.5, kind: "seat" },
      { id: "1", label: "1", x: 82, y: 30.5, kind: "seat" },

      { id: "11", label: "11", x: 14.5, y: 42.1, kind: "seat" },
      { id: "10", label: "10", x: 26, y: 44.0, kind: "seat" },
      { id: "9", label: "9", x: 29.4, y: 40.8, kind: "seat" },

      { id: "8A", label: "8A", x: 43.5, y: 41, kind: "seat" },
      { id: "8B", label: "8B", x: 43.5, y: 44.6, kind: "seat" },

      { id: "7A", label: "7A", x: 59.6, y: 40.7, kind: "seat" },
      { id: "7B", label: "7B", x: 59.6, y: 44.4, kind: "seat" },

      { id: "13", label: "13", x: 42.5, y: 62.2, kind: "seat" },

      { id: "14", label: "14", x: 49.5, y: 53.6, kind: "seat" },
      { id: "15", label: "15", x: 56, y: 53.6, kind: "seat" },
      { id: "16", label: "16", x: 62.5, y: 53.6, kind: "seat" },
      { id: "17", label: "17", x: 69.1, y: 53.6, kind: "seat" },

      { id: "25", label: "25", x: 57.1, y: 62.1, kind: "seat" },

      { id: "18", label: "18", x: 49.5, y: 70.8, kind: "seat" },
      { id: "19", label: "19", x: 58.4, y: 70.8, kind: "seat" },
      { id: "20", label: "20", x: 67.6, y: 70.8, kind: "seat" },

      { id: "24", label: "24", x: 77.5, y: 58, kind: "seat" },
      { id: "23", label: "23", x: 83.4, y: 60.7, kind: "seat" },
      { id: "22", label: "22", x: 75.8, y: 66.3, kind: "seat" },
      { id: "21", label: "21", x: 83, y: 70, kind: "seat" },

      { id: "12A", label: "12A", x: 10.7, y: 68.1, kind: "seat" },
      { id: "12B", label: "12B", x: 17.8, y: 69.6, kind: "seat" },
      { id: "12C", label: "12C", x: 25.7, y: 69.6, kind: "seat" },
    ],
    []
  );

  const [stored, setStored] = useState<StoredMap>(() => loadStored());

  const pins: SeatPin[] = useMemo(() => {
    return defaultPins.map((p) => {
      const s = stored[p.id];
      if (!s) return p;
      return { ...p, x: s.x, y: s.y };
    });
  }, [defaultPins, stored]);

  const [statusBySeat, setStatusBySeat] = useState<Record<string, SeatStatus>>({});

  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(t);
  }, []);

  const calibrate = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("calibrate") === "1";
    } catch {
      return false;
    }
  }, []);

  const [selectedPinId, setSelectedPinId] = useState<string>("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  // ✅ seats only (exclude room)
  const seatIdsOnly = useMemo<string[]>(
    () => pins.filter((p) => p.kind === "seat").map((p) => p.id),
    [pins]
  );

  const loadSeatStatuses = async (): Promise<void> => {
    const startIso = new Date().toISOString();
    const endIso = new Date("2999-12-31T23:59:59.000Z").toISOString();

    // 1) Seats via seat_blocked_times
    const seatsReq = supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .in("seat_number", seatIdsOnly)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    // 2) Conference room via promo_bookings (because seat_number is NULL for conference_room)
    const confReq = supabase
      .from("promo_bookings")
      .select("id, start_at, end_at, status, area")
      .eq("area", "conference_room")
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    const [{ data: seatData, error: seatErr }, { data: confData, error: confErr }] = await Promise.all([
      seatsReq,
      confReq,
    ]);

    const next: Record<string, SeatStatus> = {};

    // default everything to available
    for (const p of pins) next[p.id] = "temp_available";

    // seat statuses
    if (seatErr) {
      console.error("Seat status error:", seatErr.message);
    } else {
      const rows = (seatData ?? []) as SeatBlockedRow[];
      const blocked = new Set(rows.map((r) => normalizeSeatId(r.seat_number)));
      for (const id of seatIdsOnly) {
        if (blocked.has(id)) next[id] = "occupied"; // orange
      }
    }

    // conference status
    if (confErr) {
      console.error("Conference status error:", confErr.message);
    } else {
      const rows = (confData ?? []) as PromoConferenceRow[];

      // If ANY active booking overlaps now -> mark as occupied (orange)
      // (You can change this to reserved/purple based on status if you want)
      if (rows.length > 0) {
        next[CONFERENCE_ID] = "occupied";
      }
    }

    setStatusBySeat(next);
  };

  useEffect(() => {
    void loadSeatStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatIdsOnly.join("|"), pins.length]);

  useEffect(() => {
    const t = window.setInterval(() => void loadSeatStatuses(), 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatIdsOnly.join("|"), pins.length]);

  const setPinPositionFromClick = (clientX: number, clientY: number): void => {
    if (!calibrate) return;
    if (!selectedPinId) return;
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const xPx = clientX - rect.left;
    const yPx = clientY - rect.top;

    const xPct = (xPx / rect.width) * 100;
    const yPct = (yPx / rect.height) * 100;

    const x = Math.max(0, Math.min(100, Number(xPct.toFixed(2))));
    const y = Math.max(0, Math.min(100, Number(yPct.toFixed(2))));

    const next: StoredMap = { ...stored, [selectedPinId]: { x, y } };
    setStored(next);
    saveStored(next);
  };

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!calibrate) return;
    setPinPositionFromClick(e.clientX, e.clientY);
  };

  const clearSaved = (): void => {
    if (!calibrate) return;
    localStorage.removeItem(STORAGE_KEY);
    setStored({});
    setSelectedPinId("");
  };

  return (
    <IonPage>
      <IonContent fullscreen className="staff-content">
        <div className="seatmap-wrap">
          <div className="seatmap-card">
            <div className="seatmap-topbar">
              <p className="seatmap-title">Seat Map</p>
              <span className="seatmap-date">{formatPHDate(now)}</span>
            </div>

            <div className="seatmap-stage" ref={stageRef} onClick={onStageClick}>
              <img src={seatsImage} alt="Seat Map" className="seatmap-img" />

              {pins.map((p) => {
                const st: SeatStatus = statusBySeat[p.id] ?? "temp_available";
                const baseCls = p.kind === "room" ? "seat-pin room" : "seat-pin";
                const selectedCls = calibrate && selectedPinId === p.id ? " selected" : "";
                const cls = `${baseCls} ${STATUS_COLOR[st]}${selectedCls}`;

                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cls}
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    title={calibrate ? `Click to select: ${p.label}` : `${p.label} • ${st}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (calibrate) setSelectedPinId(p.id);
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="seatmap-legend">
              <div className="legend-item">
                <span className="legend-dot seat-blue" /> Temporarily Available
              </div>
              <div className="legend-item">
                <span className="legend-dot seat-yellow" /> Occupied Temporarily
              </div>
              <div className="legend-item">
                <span className="legend-dot seat-orange" /> Occupied
              </div>
              <div className="legend-item">
                <span className="legend-dot seat-purple" /> Reserved
              </div>
            </div>

            {calibrate ? (
              <div className="seatmap-hint">
                Calibrate mode ON: click a pin to select, then click exact number on the image to place it.
                <br />
                Selected: <strong>{selectedPinId || "NONE"}</strong>{" "}
                <button type="button" onClick={clearSaved} style={{ marginLeft: 8 }}>
                  Reset Saved Pins
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Dashboard;
