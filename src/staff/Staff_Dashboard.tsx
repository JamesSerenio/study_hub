// src/pages/Staff_Dashboard.tsx
// ✅ Normal mode: view-only
// ✅ Calibrate mode: add ?calibrate=1 (click pin, then click image to place)
// ✅ Saved in localStorage so di nawawala kahit lumipat ng menu
// ✅ Strict TypeScript (no "any")

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IonPage, IonContent } from "@ionic/react";
import seatsImage from "../assets/seats.png";

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
  return typeof obj.x === "number" && Number.isFinite(obj.x) && typeof obj.y === "number" && Number.isFinite(obj.y);
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

const Staff_Dashboard: React.FC = () => {
  // ✅ default pins (baseline)
  const defaultPins: SeatPin[] = useMemo(
    () => [
      { id: "CONFERENCE_ROOM", label: "CONFERENCE ROOM", x: 27.0, y: 22.8, kind: "room" },

      { id: "6", label: "6", x: 51.2, y: 30.8, kind: "seat" },
      { id: "5", label: "5", x: 54.8, y: 30.8, kind: "seat" },
      { id: "4", label: "4", x: 58.4, y: 30.8, kind: "seat" },
      { id: "3", label: "3", x: 62.0, y: 30.8, kind: "seat" },
      { id: "2", label: "2", x: 72.8, y: 30.8, kind: "seat" },
      { id: "1", label: "1", x: 76.4, y: 30.8, kind: "seat" },

      { id: "11", label: "11", x: 33.0, y: 41.2, kind: "seat" },
      { id: "10", label: "10", x: 41.2, y: 44.0, kind: "seat" },
      { id: "9", label: "9", x: 46.0, y: 40.8, kind: "seat" },

      { id: "8A", label: "8A", x: 54.4, y: 42.7, kind: "seat" },
      { id: "8B", label: "8B", x: 54.4, y: 46.4, kind: "seat" },

      { id: "7A", label: "7A", x: 62.4, y: 42.7, kind: "seat" },
      { id: "7B", label: "7B", x: 62.4, y: 46.4, kind: "seat" },

      { id: "13", label: "13", x: 46.5, y: 63.6, kind: "seat" },

      { id: "14", label: "14", x: 56.0, y: 57.8, kind: "seat" },
      { id: "15", label: "15", x: 59.2, y: 57.8, kind: "seat" },
      { id: "16", label: "16", x: 62.4, y: 57.8, kind: "seat" },
      { id: "17", label: "17", x: 65.6, y: 57.8, kind: "seat" },

      { id: "25", label: "25", x: 58.8, y: 66.3, kind: "seat" },

      { id: "18", label: "18", x: 56.0, y: 73.6, kind: "seat" },
      { id: "19", label: "19", x: 59.2, y: 73.6, kind: "seat" },
      { id: "20", label: "20", x: 62.4, y: 73.6, kind: "seat" },

      { id: "24", label: "24", x: 73.2, y: 60.4, kind: "seat" },
      { id: "23", label: "23", x: 76.6, y: 65.0, kind: "seat" },
      { id: "22", label: "22", x: 72.8, y: 69.2, kind: "seat" },
      { id: "21", label: "21", x: 79.4, y: 71.0, kind: "seat" },

      { id: "12A", label: "12A", x: 35.0, y: 75.0, kind: "seat" },
      { id: "12B", label: "12B", x: 39.4, y: 75.0, kind: "seat" },
      { id: "12C", label: "12C", x: 43.8, y: 75.0, kind: "seat" },
    ],
    []
  );

  // ✅ apply saved coords (localStorage) to pins
  const [stored, setStored] = useState<StoredMap>(() => loadStored());

  const pins: SeatPin[] = useMemo(() => {
    return defaultPins.map((p) => {
      const s = stored[p.id];
      if (!s) return p;
      return { ...p, x: s.x, y: s.y };
    });
  }, [defaultPins, stored]);

  // demo statuses (replace later with DB)
  const [statusBySeat] = useState<Record<string, SeatStatus>>({
    "1": "temp_available",
    "2": "occupied_temp",
    "3": "occupied",
    "4": "temp_available",
    "5": "reserved",
    "6": "temp_available",
    CONFERENCE_ROOM: "reserved",
  });

  // current date
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(t);
  }, []);

  // calibrate mode flag
  const calibrate = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("calibrate") === "1";
    } catch {
      return false;
    }
  }, []);

  // selected pin in calibrate mode
  const [selectedPinId, setSelectedPinId] = useState<string>("");

  const stageRef = useRef<HTMLDivElement | null>(null);

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

    // clamp
    const x = Math.max(0, Math.min(100, Number(xPct.toFixed(2))));
    const y = Math.max(0, Math.min(100, Number(yPct.toFixed(2))));

    const next: StoredMap = { ...stored, [selectedPinId]: { x, y } };
    setStored(next);
    saveStored(next);
  };

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!calibrate) return;
    // click on stage to place selected pin
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
                      // stop stage click so di ma-move agad
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
