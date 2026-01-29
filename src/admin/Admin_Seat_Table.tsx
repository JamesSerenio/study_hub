// src/pages/Admin_Seat_Table.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ Uses EXISTING class names from your global CSS
// ✅ Yellow = occupied_temp (source="promo")
// ✅ Orange = occupied (source="regular")
// ✅ Admin can SET/CLEAR temp occupied (yellow) for SEATS + CONFERENCE ROOM
// ✅ Seats: promo_bookings(area="common_area", seat_number=...)
// ✅ Conference: promo_bookings(area="conference_room", seat_number=NULL)
// ✅ CLEAR = DELETE promo_bookings rows that overlap NOW (instead of update cancelled)

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IonPage,
  IonContent,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonIcon,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import seatsImage from "../assets/seats.png";
import bearImage from "../assets/bear.png";
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

type PackageRow = { id: string };
type PackageOptionRow = { id: string };

type PromoBookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  area: string;
  seat_number: string | null;
};

const STORAGE_KEY = "seatmap_pin_positions_v1";
const CONFERENCE_ID = "CONFERENCE_ROOM";

const STATUS_COLOR: Record<SeatStatus, string> = {
  temp_available: "seat-green",
  occupied_temp: "seat-yellow",
  occupied: "seat-orange",
  reserved: "seat-purple",
};

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

const formatPHDate = (d: Date): string =>
  d.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

/** Accepts: 2 / 2:30 / 0:45 / 230 / 100:30  -> HH:MM */
const normalizeDurationHHMM = (value: string): string | null => {
  const raw = value.trim().toLowerCase().replace(/\s+/g, "").replace(/[^0-9:]/g, "");
  if (!raw) return null;

  let m = raw.match(/^(\d{1,8}):(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    if (h < 0) return null;
    if (mm < 0 || mm > 59) return null;
    if (h === 0 && mm === 0) return null;
    return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
  }

  m = raw.match(/^(\d{1,8})$/);
  if (m) {
    const digits = m[1];

    if (digits.length === 3 || digits.length === 4) {
      const s = digits.padStart(4, "0");
      const hh = parseInt(s.slice(0, 2), 10);
      const mm = parseInt(s.slice(2), 10);
      if (mm <= 59) {
        if (hh === 0 && mm === 0) return null;
        return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
      }
    }

    const h = parseInt(digits, 10);
    if (!Number.isFinite(h) || h <= 0) return null;
    return `${h.toString().padStart(2, "0")}:00`;
  }

  return null;
};

const addDurationToIso = (startIso: string, hhmm: string): string => {
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return startIso;

  const parts = hhmm.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return startIso;

  const totalMin = h * 60 + m;
  return new Date(start.getTime() + totalMin * 60_000).toISOString();
};

const farFutureIso = (): string => new Date("2999-12-31T23:59:59.000Z").toISOString();

const Admin_Seat_Table: React.FC = () => {
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

  const seatIdsOnly = useMemo<string[]>(
    () => pins.filter((p) => p.kind === "seat").map((p) => p.id),
    [pins]
  );

  // ===== modal =====
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [selectedKind, setSelectedKind] = useState<PinKind>("seat");

  const [fullName, setFullName] = useState<string>("TEMP OCCUPIED");
  const [openTime, setOpenTime] = useState<boolean>(false);
  const [durationInput, setDurationInput] = useState<string>("01:00");
  const [saving, setSaving] = useState<boolean>(false);

  // required IDs (NO UI)
  const [packageId, setPackageId] = useState<string>("");
  const [packageOptionId, setPackageOptionId] = useState<string>("");

  const loadRequiredIds = async (): Promise<void> => {
    const pkgReq = supabase.from("packages").select("id, area").eq("area", "common_area").limit(1);
    const optReq = supabase.from("package_options").select("id").limit(1);

    const [{ data: pkgs, error: pkgErr }, { data: opts, error: optErr }] = await Promise.all([
      pkgReq,
      optReq,
    ]);

    if (pkgErr) console.error("packages load error:", pkgErr.message);
    if (optErr) console.error("package_options load error:", optErr.message);

    const pkg = (pkgs ?? [])[0] as PackageRow | undefined;
    const opt = (opts ?? [])[0] as PackageOptionRow | undefined;

    if (pkg?.id) setPackageId(pkg.id);
    if (opt?.id) setPackageOptionId(opt.id);
  };

  useEffect(() => {
    void loadRequiredIds();
  }, []);

  // ===== statuses (promo=YELLOW, regular=ORANGE) =====
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

    const [{ data: seatData, error: seatErr }, { data: confData, error: confErr }] = await Promise.all([
      seatsReq,
      confReq,
    ]);

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
        const st = bySeat[id];
        if (st) next[id] = st;
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

  // ===== helpers =====
  const isConference = (id: string): boolean => id === CONFERENCE_ID;

  const getAreaForSelection = (kind: PinKind): "common_area" | "conference_room" =>
    kind === "room" ? "conference_room" : "common_area";

  const buildEndIso = (startIso: string): string => {
    if (openTime) return farFutureIso();
    const dur = normalizeDurationHHMM(durationInput);
    if (!dur) return new Date(new Date(startIso).getTime() + 60_000).toISOString();
    return addDurationToIso(startIso, dur);
  };

  const openTempModalForPin = (pinId: string, kind: PinKind): void => {
    setSelectedSeat(pinId);
    setSelectedKind(kind);
    setOpenTime(false);
    setDurationInput("01:00");
    setFullName("TEMP OCCUPIED");
    setIsModalOpen(true);
  };

  // ✅ CLEAR = DELETE the overlapping promo_bookings rows (NOW)
  const clearTempNow = async (pinId: string, kind: PinKind): Promise<void> => {
    const nowIso = new Date().toISOString();
    const area = getAreaForSelection(kind);

    const base = supabase
      .from("promo_bookings")
      .select("id, start_at, end_at, status, area, seat_number")
      .eq("area", area)
      .eq("status", "active")
      .lt("start_at", nowIso)
      .gt("end_at", nowIso);

    const { data: rows, error } =
      kind === "room" ? await base.is("seat_number", null) : await base.eq("seat_number", pinId);

    if (error) return alert(`Load temp occupied error: ${error.message}`);

    const list = (rows ?? []) as PromoBookingRow[];
    if (list.length === 0) {
      void loadSeatStatuses();
      setIsModalOpen(false);
      setSelectedSeat("");
      return;
    }

    const ids = list.map((r) => r.id);

    const { error: delErr } = await supabase.from("promo_bookings").delete().in("id", ids);
    if (delErr) return alert(`Delete error: ${delErr.message}`);

    setIsModalOpen(false);
    setSelectedSeat("");
    void loadSeatStatuses();
  };

  const saveTempOccupied = async (): Promise<void> => {
    if (!selectedSeat) return;

    const trimmed = fullName.trim();
    if (!trimmed) return alert("Full Name is required.");

    if (!packageId) return alert('Missing package (area="common_area"). Create at least 1 common_area package.');
    if (!packageOptionId) return alert("Missing package option. Create at least 1 package option.");

    if (!openTime) {
      const dur = normalizeDurationHHMM(durationInput);
      if (!dur) return alert("Invalid duration. Examples: 1 / 0:45 / 2:30 / 230 / 100:30");
    }

    const startIso = new Date().toISOString();
    const endIso = buildEndIso(startIso);

    // conflict check
    if (selectedKind === "seat") {
      const { data: conflicts, error: confErr } = await supabase
        .from("seat_blocked_times")
        .select("seat_number, source")
        .eq("seat_number", selectedSeat)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (confErr) return alert(`Seat check error: ${confErr.message}`);
      if ((conflicts ?? []).length > 0) return alert(`Seat already taken: ${selectedSeat}`);
    } else {
      const { data: confRows, error: confErr } = await supabase
        .from("promo_bookings")
        .select("id")
        .eq("area", "conference_room")
        .eq("status", "active")
        .is("seat_number", null)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (confErr) return alert(`Conference check error: ${confErr.message}`);
      if ((confRows ?? []).length > 0) return alert("Conference room already occupied/reserved.");
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return alert("You must be logged in.");

    setSaving(true);

    const area = getAreaForSelection(selectedKind);

    const insertPayload: {
      user_id: string;
      full_name: string;
      area: "common_area" | "conference_room";
      package_id: string;
      package_option_id: string;
      seat_number: string | null;
      start_at: string;
      end_at: string;
      price: number;
      status: string;
    } = {
      user_id: auth.user.id,
      full_name: trimmed,
      area,
      package_id: packageId,
      package_option_id: packageOptionId,
      seat_number: selectedKind === "seat" ? selectedSeat : null,
      start_at: startIso,
      end_at: endIso,
      price: 0,
      status: "active",
    };

    const { error } = await supabase.from("promo_bookings").insert(insertPayload);

    setSaving(false);

    if (error) return alert(`Error saving: ${error.message}`);

    setIsModalOpen(false);
    setSelectedSeat("");
    void loadSeatStatuses();
  };

  const currentStatus: SeatStatus =
    selectedSeat ? statusBySeat[selectedSeat] ?? "temp_available" : "temp_available";

  return (
    <IonPage>
      <IonContent fullscreen className="staff-content">
        <div className="seatmap-wrap">
          {/* ✅ NEW: container para si bear nasa labas ng card (same as Staff_Dashboard) */}
          <div className="seatmap-container">
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

                  const isRoom = p.kind === "room";

                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={cls}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      title={
                        calibrate
                          ? `Click to select: ${p.label}`
                          : st === "occupied_temp"
                          ? `Click to CLEAR temp occupied: ${p.label}`
                          : st === "temp_available"
                          ? `Click to SET temp occupied: ${p.label}`
                          : `Occupied (regular): ${p.label}`
                      }
                      onClick={(ev) => {
                        ev.stopPropagation();

                        if (calibrate) {
                          setSelectedPinId(p.id);
                          return;
                        }

                        const stNow: SeatStatus = statusBySeat[p.id] ?? "temp_available";

                        if (stNow === "occupied_temp") {
                          setSelectedSeat(p.id);
                          setSelectedKind(isRoom ? "room" : "seat");
                          setIsModalOpen(true);
                          return;
                        }

                        if (stNow === "temp_available") {
                          openTempModalForPin(p.id, isRoom ? "room" : "seat");
                          return;
                        }

                        alert("This is occupied/reserved (not temporary).");
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
                  Calibrate mode ON: click a pin to select, then click exact number on the image to place it.
                  <br />
                  Selected: <strong>{selectedPinId || "NONE"}</strong>{" "}
                  <button type="button" onClick={clearSaved} style={{ marginLeft: 8 }}>
                    Reset Saved Pins
                  </button>
                </div>
              ) : null}
            </div>

            {/* ✅ SAME AS STAFF_DASHBOARD: bear OUTSIDE card */}
            <img
              src={bearImage}
              alt="Bear"
              className="seatmap-bear-outside"
              draggable={false}
            />
          </div>
        </div>

        {/* MODAL */}
        <IonModal
          isOpen={isModalOpen}
          onDidDismiss={() => {
            setIsModalOpen(false);
            setSelectedSeat("");
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Temporary Occupied</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setIsModalOpen(false);
                    setSelectedSeat("");
                  }}
                >
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <IonItem className="form-item">
                <IonLabel position="stacked">Target</IonLabel>
                <IonInput
                  value={isConference(selectedSeat) ? "CONFERENCE ROOM" : `SEAT ${selectedSeat}`}
                  readonly
                />
              </IonItem>

              {currentStatus === "occupied_temp" ? (
                <>
                  <IonButton
                    expand="block"
                    color="medium"
                    onClick={() => void clearTempNow(selectedSeat, selectedKind)}
                  >
                    Set as Available (Delete Yellow Record)
                  </IonButton>

                  <p style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                    This will <strong>DELETE</strong> the overlapping <strong>promo_bookings</strong> row(s) now.
                  </p>
                </>
              ) : (
                <>
                  <IonItem className="form-item">
                    <IonLabel position="stacked">Full Name</IonLabel>
                    <IonInput value={fullName} onIonChange={(e) => setFullName(e.detail.value ?? "")} />
                  </IonItem>

                  <IonItem className="form-item">
                    <IonLabel>Open Time</IonLabel>
                    <IonToggle checked={openTime} onIonChange={(e) => setOpenTime(e.detail.checked)} />
                    <IonLabel slot="end">{openTime ? "Yes" : "No"}</IonLabel>
                  </IonItem>

                  {!openTime && (
                    <IonItem className="form-item">
                      <IonLabel position="stacked">Duration (HH:MM or hours)</IonLabel>
                      <IonInput
                        value={durationInput}
                        placeholder="Examples: 1 / 0:45 / 2:30 / 230 / 100:30"
                        onIonChange={(e) => setDurationInput(e.detail.value ?? "")}
                        onIonBlur={() => {
                          const n = normalizeDurationHHMM(durationInput);
                          if (n) setDurationInput(n);
                        }}
                      />
                    </IonItem>
                  )}

                  <IonButton expand="block" disabled={saving} onClick={() => void saveTempOccupied()} color="warning">
                    {saving ? "Saving..." : "Set as Occupied Temporarily (Yellow)"}
                  </IonButton>

                  <p style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                    Conference room will also be yellow when it has an active <strong>promo_bookings</strong> overlap.
                  </p>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Seat_Table;
