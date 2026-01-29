// src/pages/Staff_Dashboard.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ SAME COLOR LOGIC AS ADMIN
// ✅ Conference room highlight
// ✅ NO SCROLL (scrollY={false})
// ✅ CONSISTENT design via fixed aspect-ratio stage

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonPage, IonContent } from "@ionic/react";
import seatsImage from "../assets/seats.png";
import bearImage from "../assets/bear.png";
import grassImage from "../assets/grass.png";
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

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | string;
};

type PromoConferenceRow = { id: string };

const STORAGE_KEY = "seatmap_pin_positions_v1";
const CONFERENCE_ID = "CONFERENCE_ROOM";

const STATUS_COLOR: Record<SeatStatus, string> = {
  temp_available: "seat-green",
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

const normalizeSeatId = (v: string): string => String(v).trim();

const farFutureIso = (): string =>
  new Date("2999-12-31T23:59:59.000Z").toISOString();

const Staff_Dashboard: React.FC = () => {
  const defaultPins: SeatPin[] = useMemo(
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
      { id: "8B", label: "8B", x: 42., y: 43, kind: "seat" },

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

      { id: "24", label: "24", x: 76,y: 56.7, kind: "seat" },
      { id: "23", label: "23", x: 81.5, y: 59.5, kind: "seat" },
      { id: "22", label: "22", x: 74.4, y: 65.3, kind: "seat" },
      { id: "21", label: "21", x: 82, y: 68.7, kind: "seat" },

      { id: "12A", label: "12A", x: 9.1, y: 67, kind: "seat" },
      { id: "12B", label: "12B", x: 16.5, y: 68.3, kind: "seat" },
      { id: "12C", label: "12C", x: 24, y: 68.2 , kind: "seat" },
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

  const seatIdsOnly = useMemo<string[]>(
    () => pins.filter((p) => p.kind === "seat").map((p) => p.id),
    [pins]
  );

  const loadSeatStatuses = async (): Promise<void> => {
    const startIso = new Date().toISOString();
    const endIso = farFutureIso();

    const seatsReq = supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .in("seat_number", seatIdsOnly)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    const confReq = supabase
      .from("promo_bookings")
      .select("id")
      .eq("area", "conference_room")
      .eq("status", "active")
      .is("seat_number", null)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    const [{ data: seatData, error: seatErr }, { data: confData, error: confErr }] =
      await Promise.all([seatsReq, confReq]);

    const next: Record<string, SeatStatus> = {};
    for (const p of pins) next[p.id] = "temp_available";

    if (seatErr) {
      console.error("Seat status error:", seatErr.message);
    } else {
      const rows = (seatData ?? []) as SeatBlockedRow[];
      const bySeat: Record<string, SeatStatus> = {};

      for (const r of rows) {
        const id = normalizeSeatId(r.seat_number);
        if (r.source === "regular") bySeat[id] = "occupied";
        else if (r.source === "promo") {
          if (bySeat[id] !== "occupied") bySeat[id] = "occupied_temp";
        } else {
          if (!bySeat[id]) bySeat[id] = "occupied";
        }
      }

      for (const id of seatIdsOnly) {
        if (bySeat[id]) next[id] = bySeat[id];
      }
    }

    if (confErr) {
      console.error("Conference status error:", confErr.message);
    } else {
      const rows = (confData ?? []) as PromoConferenceRow[];
      if (rows.length > 0) next[CONFERENCE_ID] = "occupied_temp";
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

  // ===== calibrate =====
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
      <IonContent fullscreen className="staff-content" scrollY={false}>
        <div className="seatmap-wrap">
          <div className="seatmap-container">
            <div className="seatmap-card">
              <div className="seatmap-topbar">
                <p className="seatmap-title">Seat Map</p>
                <span className="seatmap-date">{formatPHDate(now)}</span>
              </div>

              {/* ✅ FIXED PROPORTIONS: stable design across devices */}
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
                  <span className="legend-dot seat-green" /> Temporarily Available
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
                  Calibrate mode ON: click a pin to select, then click exact number on the image to
                  place it.
                  <br />
                  Selected: <strong>{selectedPinId || "NONE"}</strong>{" "}
                  <button type="button" onClick={clearSaved} style={{ marginLeft: 8 }}>
                    Reset Saved Pins
                  </button>
                </div>
              ) : null}

              {/* ✅ Decorations anchored to card */}
              <img src={bearImage} alt="Bear" className="seatmap-bear-outside" draggable={false} />
              <img src={grassImage} alt="Grass" className="seatmap-grass-outside" draggable={false} />
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Dashboard;
