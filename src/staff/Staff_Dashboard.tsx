// src/pages/Staff_Dashboard.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ SAME COLOR LOGIC AS ADMIN
// ✅ Staff can SET/CLEAR:
//    - Temp occupied (NOW: seat_blocked_times ONLY note="temp")  ✅ NOT connected to booking anymore
//    - Occupied / Reserved (seat_blocked_times)
// ✅ Seats promo: promo_bookings(area="common_area", seat_number=...)
// ✅ Conference promo: promo_bookings(area="conference_room", seat_number=NULL)
// ✅ PROMO COLOR RULE:
//    - promo CURRENT (now within start/end) => RED (occupied)
//    - promo FUTURE (start > now) => PURPLE (reserved)
// ✅ TEMP COLOR RULE:
//    - seat_blocked_times note="temp" => YELLOW
// ✅ CLEAR NOW deletes overlap NOW from BOTH TABLES (seat_blocked_times + promo_bookings)
// ✅ Open time supported (far future)
// ✅ SAME CLASS STRUCTURE + pins + decorations
// ✅ 4 right-side color swatches are NOT editable
// ✅ FIX: When setting Occupied/Reserved, auto-delete overlapping TEMP (seat_blocked_times note="temp") first (TEMP only)
// ✅ FIX: CLEAR NOW truly deletes both seat_blocked_times + promo_bookings overlap NOW
// ✅ IGNORE auto reservation blocks (note="reservation") so seats won't auto turn violet (staff-only colors)
// ✅ FINAL: YELLOW CLEAR NOW works even if promo_bookings SELECT is blocked by RLS (direct delete)

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

  readonly?: boolean;
  fixedStatus?: SeatStatus;
};

type StoredPos = { x: number; y: number };
type StoredMap = Record<string, StoredPos>;

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

type PackageRow = { id: string; area?: string };
type PackageOptionRow = { id: string };

const STORAGE_KEY = "seatmap_pin_positions_v1";
const CONFERENCE_ID = "CONFERENCE_ROOM";

// 4 swatches (NOT editable)
const SWATCH_GREEN_ID = "__SWATCH_GREEN__";
const SWATCH_YELLOW_ID = "__SWATCH_YELLOW__";
const SWATCH_RED_ID = "__SWATCH_RED__";
const SWATCH_PURPLE_ID = "__SWATCH_PURPLE__";

const STATUS_COLOR: Record<SeatStatus, string> = {
  temp_available: "seat-green",
  occupied_temp: "seat-yellow",
  occupied: "seat-orange", // (your CSS uses orange for occupied)
  reserved: "seat-purple",
};

const formatPHDate = (d: Date): string =>
  d.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

const normalizeSeatId = (v: string): string => String(v).trim();

const farFutureIso = (): string => new Date("2999-12-31T23:59:59.000Z").toISOString();

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

/** Accepts: 2 / 2:30 / 0:45 / 230 / 100:30  -> HH:MM */
const normalizeDurationHHMM = (value: string): string | null => {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9:]/g, "");
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

  const [hh, mm] = hhmm.split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (Number.isNaN(h) || Number.isNaN(m)) return startIso;

  const totalMin = h * 60 + m;
  return new Date(start.getTime() + totalMin * 60_000).toISOString();
};

const isTempMirrorRow = (note: string | null): boolean => {
  const n = (note ?? "").trim().toLowerCase();
  return n === "temp";
};

// ✅ reservation auto blocks from BookingModal are ignored in Staff_Dashboard color
const isAutoReservationRow = (note: string | null): boolean => {
  const n = (note ?? "").trim().toLowerCase();
  return n === "reservation";
};

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

      { id: SWATCH_GREEN_ID, label: "", x: 90, y: 83.5, kind: "seat", readonly: true, fixedStatus: "temp_available" },
      { id: SWATCH_YELLOW_ID, label: "", x: 90, y: 88, kind: "seat", readonly: true, fixedStatus: "occupied_temp" },
      { id: SWATCH_RED_ID, label: "", x: 90, y: 92.5, kind: "seat", readonly: true, fixedStatus: "occupied" },
      { id: SWATCH_PURPLE_ID, label: "", x: 90, y: 96, kind: "seat", readonly: true, fixedStatus: "reserved" },
    ],
    []
  );

  const [stored, setStored] = useState<StoredMap>(() => loadStored());

  const pins: SeatPin[] = useMemo(() => {
    return defaultPins.map((p) => {
      if (p.readonly) return p;
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
    () => pins.filter((p) => p.kind === "seat" && !p.readonly).map((p) => p.id),
    [pins]
  );

  const blockedIds = useMemo<string[]>(() => [...seatIdsOnly, CONFERENCE_ID], [seatIdsOnly]);

  // ===== modal =====
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [selectedKind, setSelectedKind] = useState<PinKind>("seat");

  const [openTime, setOpenTime] = useState<boolean>(false);
  const [durationInput, setDurationInput] = useState<string>("01:00");
  const [saving, setSaving] = useState<boolean>(false);

  // keep these (no harm) - but TEMP no longer needs them
  const [, setPackageIdCommon] = useState<string>("");
  const [, setPackageIdConference] = useState<string>("");
  const [, setPackageOptionId] = useState<string>("");

  const loadRequiredIds = async (): Promise<void> => {
    const pkgCommonReq = supabase.from("packages").select("id, area").eq("area", "common_area").limit(1);
    const pkgConfReq = supabase.from("packages").select("id, area").eq("area", "conference_room").limit(1);
    const optReq = supabase.from("package_options").select("id").limit(1);

    const [
      { data: pkgsCommon, error: pkgCommonErr },
      { data: pkgsConf, error: pkgConfErr },
      { data: opts, error: optErr },
    ] = await Promise.all([pkgCommonReq, pkgConfReq, optReq]);

    if (pkgCommonErr) console.error("packages(common_area) load error:", pkgCommonErr.message);
    if (pkgConfErr) console.error("packages(conference_room) load error:", pkgConfErr.message);
    if (optErr) console.error("package_options load error:", optErr.message);

    const common = (pkgsCommon ?? [])[0] as PackageRow | undefined;
    const conf = (pkgsConf ?? [])[0] as PackageRow | undefined;
    const opt = (opts ?? [])[0] as PackageOptionRow | undefined;

    if (common?.id) setPackageIdCommon(common.id);
    if (conf?.id) setPackageIdConference(conf.id);
    if (opt?.id) setPackageOptionId(opt.id);
  };

  useEffect(() => {
    void loadRequiredIds();
  }, []);

  const isConference = (id: string): boolean => id === CONFERENCE_ID;

  const getAreaForSelection = (kind: PinKind): "common_area" | "conference_room" =>
    kind === "room" ? "conference_room" : "common_area";

  const buildEndIso = (startIso: string): string => {
    if (openTime) return farFutureIso();
    const dur = normalizeDurationHHMM(durationInput);
    if (!dur) return new Date(new Date(startIso).getTime() + 60_000).toISOString();
    return addDurationToIso(startIso, dur);
  };

  const openManageModalForPin = (pinId: string, kind: PinKind): void => {
    setSelectedSeat(pinId);
    setSelectedKind(kind);
    setOpenTime(false);
    setDurationInput("01:00");
    setIsModalOpen(true);
  };

  // ✅ helper: delete seat_blocked_times overlap with optional note filter
  const deleteBlockedOverlap = async (
    seatKey: string,
    startIso: string,
    endIso: string,
    note?: string
  ): Promise<string | null> => {
    let q = supabase
      .from("seat_blocked_times")
      .delete()
      .eq("seat_number", seatKey)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    if (note) q = q.eq("note", note);

    const { error } = await q;
    if (error) return error.message;
    return null;
  };

  const checkConflicts = async (
    pinId: string,
    kind: PinKind,
    startIso: string,
    endIso: string
  ): Promise<string | null> => {
    const seatKey = kind === "room" ? CONFERENCE_ID : pinId;

    const { data: blk, error: blkErr } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, source, note")
      .eq("seat_number", seatKey)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    if (blkErr) return `Block check error: ${blkErr.message}`;

    // ignore auto reservation rows (note='reservation')
    const hardBlocks = ((blk ?? []) as SeatBlockedRow[]).filter((r) => !isAutoReservationRow(r.note));
    if (hardBlocks.length > 0) return "Already blocked (occupied/reserved/temp).";

    // keep promo conflict checks (for red/purple promos)
    if (kind === "room") {
      const { data: confRows, error: confErr } = await supabase
        .from("promo_bookings")
        .select("id")
        .eq("area", "conference_room")
        .eq("status", "active")
        .is("seat_number", null)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (confErr) return `Conference promo check error: ${confErr.message}`;
      if ((confRows ?? []).length > 0) return "Conference room already has a promo booking.";
    } else {
      const { data: seatRows, error: seatErr } = await supabase
        .from("promo_bookings")
        .select("id")
        .eq("area", "common_area")
        .eq("status", "active")
        .eq("seat_number", pinId)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (seatErr) return `Seat promo check error: ${seatErr.message}`;
      if ((seatRows ?? []).length > 0) return `Seat already has a promo booking: ${pinId}`;
    }

    return null;
  };

  const loadSeatStatuses = async (): Promise<void> => {
    const nowIso = new Date().toISOString();
    const endIso = farFutureIso();

    const blockedReq = supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source, note")
      .in("seat_number", blockedIds)
      .lt("start_at", endIso)
      .gt("end_at", nowIso);

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

    // promo colors (red/purple) - keep same logic
    const applyPromoRow = (seatId: string, r: PromoBookingRow): void => {
      if (!seatId) return;

      const s = new Date(r.start_at).getTime();
      const e = new Date(r.end_at).getTime();

      if (!Number.isFinite(s) || !Number.isFinite(e)) return;

      if (nowMs >= s && nowMs < e) next[seatId] = "occupied";
      else if (nowMs < s) next[seatId] = "reserved";
    };

    if (promoSeatsErr) console.error("promo seats status error:", promoSeatsErr.message);
    else {
      const rows = (promoSeatsData ?? []) as PromoBookingRow[];
      for (const r of rows) {
        const seat = r.seat_number ? normalizeSeatId(r.seat_number) : "";
        applyPromoRow(seat, r);
      }
    }

    if (promoConfErr) console.error("promo conference status error:", promoConfErr.message);
    else {
      const rows = (promoConfData ?? []) as PromoBookingRow[];
      if (rows.length > 0) applyPromoRow(CONFERENCE_ID, rows[0]);
    }

    // blocked colors (yellow overrides green; staff-set can override if no promo)
    if (blockedErr) console.error("seat_blocked_times status error:", blockedErr.message);
    else {
      const rows = (blockedData ?? []) as SeatBlockedRow[];
      const bySeat: Record<string, SeatStatus> = {};

      for (const r of rows) {
        if (isAutoReservationRow(r.note)) continue; // ignore auto reservation for colors

        const id = normalizeSeatId(r.seat_number);

        // ✅ YELLOW: temp mirror row
        if (isTempMirrorRow(r.note)) {
          bySeat[id] = "occupied_temp";
          continue;
        }

        // normal blocks
        if (r.source === "reserved") {
          if (bySeat[id] !== "occupied") bySeat[id] = "reserved";
          continue;
        }

        if (r.source === "regular") {
          bySeat[id] = "occupied";
          continue;
        }

        if (bySeat[id] !== "occupied") bySeat[id] = "occupied";
      }

      for (const id of blockedIds) {
        // promos already set in next[]; blocks can override only if promo didn't set?
        // IMPORTANT: keep promo as top priority (your original behavior)
        if (!next[id] || next[id] === "temp_available") {
          if (bySeat[id]) next[id] = bySeat[id];
        } else {
          // if promo says occupied/reserved but we have yellow, we allow yellow to show
          // (optional) If you want promo ALWAYS win, remove this block.
          if (bySeat[id] === "occupied_temp") next[id] = "occupied_temp";
        }
      }
    }

    setStatusBySeat(next);
  };

  useEffect(() => {
    void loadSeatStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedIds.join("|"), pins.length]);

  useEffect(() => {
    const t = window.setInterval(() => void loadSeatStatuses(), 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedIds.join("|"), pins.length]);

  const setPinPositionFromClick = (clientX: number, clientY: number): void => {
    if (!calibrate) return;
    if (!selectedPinId) return;

    const pinObj = pins.find((p) => p.id === selectedPinId);
    if (pinObj?.readonly) return;

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

  // ✅ keep TEMP promo delete for old data cleanup (but temp no longer creates promo now)
  const deleteTempPromoOverlap = async (
    seatKey: string,
    kind: PinKind,
    startIso: string,
    endIso: string
  ): Promise<string | null> => {
    const area = getAreaForSelection(kind);

    const base = supabase
      .from("promo_bookings")
      .delete()
      .eq("area", area)
      .eq("status", "active")
      .ilike("full_name", "temp%")
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    const { error } = kind === "room" ? await base.is("seat_number", null) : await base.eq("seat_number", seatKey);
    if (error) return error.message;
    return null;
  };

  // ✅ CLEAR NOW: delete BOTH tables overlap now
  const clearToAvailableNow = async (pinId: string, kind: PinKind): Promise<void> => {
    const nowMs = Date.now();
    const nowMinusIso = new Date(nowMs - 120_000).toISOString();
    const nowPlusIso = new Date(nowMs + 120_000).toISOString();

    const seatKey = kind === "room" ? CONFERENCE_ID : pinId;
    const area = getAreaForSelection(kind);

    setSaving(true);

    // 1) delete seat_blocked_times overlap now (includes temp/staff/reservation)
    {
      const { error: delBlkErr } = await supabase
        .from("seat_blocked_times")
        .delete()
        .eq("seat_number", seatKey)
        .lt("start_at", nowPlusIso)
        .gt("end_at", nowMinusIso);

      if (delBlkErr) {
        setSaving(false);
        return alert(`Delete blocked error: ${delBlkErr.message}`);
      }
    }

    // 2) delete promo_bookings overlap now (DIRECT delete, no select)
    {
      const base = supabase
        .from("promo_bookings")
        .delete()
        .eq("area", area)
        .eq("status", "active")
        .lt("start_at", nowPlusIso)
        .gt("end_at", nowMinusIso);

      const { error: delPromoErr } =
        kind === "room" ? await base.is("seat_number", null) : await base.eq("seat_number", seatKey);

      if (delPromoErr) {
        setSaving(false);
        return alert(`Delete promo error: ${delPromoErr.message}`);
      }
    }

    setSaving(false);
    setIsModalOpen(false);
    setSelectedSeat("");
    await loadSeatStatuses();
  };

  const setBlocked = async (choice: "occupied" | "reserved"): Promise<void> => {
    if (!selectedSeat) return;

    if (!openTime) {
      const dur = normalizeDurationHHMM(durationInput);
      if (!dur) return alert("Invalid duration. Examples: 1 / 0:45 / 2:30 / 230 / 100:30");
    }

    const startIso = new Date().toISOString();
    const endIso = buildEndIso(startIso);

    const confMsg = await checkConflicts(selectedSeat, selectedKind, startIso, endIso);
    if (confMsg) return alert(confMsg);

    const seatKey = selectedKind === "room" ? CONFERENCE_ID : selectedSeat;

    setSaving(true);

    // delete any old temp promo overlap (cleanup only)
    {
      const errMsg = await deleteTempPromoOverlap(seatKey, selectedKind, startIso, endIso);
      if (errMsg) {
        setSaving(false);
        return alert(`Failed removing TEMP promo first: ${errMsg}`);
      }
    }

    // remove TEMP mirror first (TEMP only) so occupied/reserved insert won't conflict
    {
      const errMsg = await deleteBlockedOverlap(seatKey, startIso, endIso, "temp");
      if (errMsg) {
        setSaving(false);
        return alert(`Failed removing TEMP mirror first: ${errMsg}`);
      }
    }

    // also remove reservation auto blocks (so staff can override)
    {
      const errMsg = await deleteBlockedOverlap(seatKey, startIso, endIso, "reservation");
      if (errMsg) {
        setSaving(false);
        return alert(`Failed removing reservation auto blocks: ${errMsg}`);
      }
    }

    const source = choice === "occupied" ? "regular" : "reserved";

    const payload: {
      seat_number: string;
      start_at: string;
      end_at: string;
      source: "regular" | "reserved";
      created_by?: string | null;
      note?: string | null;
    } = {
      seat_number: seatKey,
      start_at: startIso,
      end_at: endIso,
      source,
      note: "staff_set",
    };

    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user?.id) payload.created_by = auth.user.id;

    const { error } = await supabase.from("seat_blocked_times").insert(payload);

    setSaving(false);
    if (error) return alert(`Error saving: ${error.message}`);

    setIsModalOpen(false);
    setSelectedSeat("");
    await loadSeatStatuses();
  };

  // ✅ TEMP OCCUPIED (YELLOW) - NOW ONLY seat_blocked_times (NO promo_bookings insert)
  const saveTempOccupied = async (): Promise<void> => {
    if (!selectedSeat) return;

    if (!openTime) {
      const dur = normalizeDurationHHMM(durationInput);
      if (!dur) return alert("Invalid duration. Examples: 1 / 0:45 / 2:30 / 230 / 100:30");
    }

    const startIso = new Date().toISOString();
    const endIso = buildEndIso(startIso);

    const confMsg = await checkConflicts(selectedSeat, selectedKind, startIso, endIso);
    if (confMsg) return alert(confMsg);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return alert("You must be logged in.");

    setSaving(true);

    const seatKey = selectedKind === "room" ? CONFERENCE_ID : selectedSeat;

    // remove any existing blocks overlap (including reservation), so TEMP can be inserted
    {
      const { error: delBlkErr } = await supabase
        .from("seat_blocked_times")
        .delete()
        .eq("seat_number", seatKey)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (delBlkErr) {
        setSaving(false);
        return alert(`Failed removing blocked first: ${delBlkErr.message}`);
      }
    }

    // insert TEMP mirror row (yellow)
    {
      const mirrorPayload: {
        seat_number: string;
        start_at: string;
        end_at: string;
        source: "reserved";
        note: "temp";
        created_by?: string | null;
      } = {
        seat_number: seatKey,
        start_at: startIso,
        end_at: endIso,
        source: "reserved",
        note: "temp",
        created_by: auth.user.id,
      };

      const { error: mirrorErr } = await supabase.from("seat_blocked_times").insert(mirrorPayload);
      if (mirrorErr) {
        setSaving(false);
        return alert(`TEMP set failed: ${mirrorErr.message}`);
      }
    }

    setSaving(false);
    setIsModalOpen(false);
    setSelectedSeat("");
    await loadSeatStatuses();
  };

  const currentStatus: SeatStatus = selectedSeat ? statusBySeat[selectedSeat] ?? "temp_available" : "temp_available";

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

              <div className="seatmap-stage" ref={stageRef} onClick={onStageClick}>
                <img src={seatsImage} alt="Seat Map" className="seatmap-img" />

                {pins.map((p) => {
                  const st: SeatStatus = p.fixedStatus ?? (statusBySeat[p.id] ?? "temp_available");
                  const baseCls = p.kind === "room" ? "seat-pin room" : "seat-pin";
                  const selectedCls = calibrate && selectedPinId === p.id && !p.readonly ? " selected" : "";
                  const readonlyCls = p.readonly ? " seat-pin--readonly" : "";
                  const cls = `${baseCls} ${STATUS_COLOR[st]}${selectedCls}${readonlyCls}`;
                  const isRoom = p.kind === "room";

                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={cls}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      title={p.readonly ? "Legend" : calibrate ? `Click to select: ${p.label}` : `Manage: ${p.label}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (p.readonly) return;

                        if (calibrate) {
                          setSelectedPinId(p.id);
                          return;
                        }

                        openManageModalForPin(p.id, isRoom ? "room" : "seat");
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
                  <span className="legend-dot seat-yellow" /> Occupied Temporarily (TEMP)
                </div>
                <div className="legend-item">
                  <span className="legend-dot seat-orange" /> Occupied (CURRENT PROMO / BLOCKED)
                </div>
                <div className="legend-item">
                  <span className="legend-dot seat-purple" /> Reserved (FUTURE PROMO / RESERVED)
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

              <img src={bearImage} alt="Bear" className="seatmap-bear-outside" draggable={false} />
              <img src={grassImage} alt="Grass" className="seatmap-grass-outside" draggable={false} />
            </div>
          </div>
        </div>

        <IonModal
          isOpen={isModalOpen}
          className="seat-manage-modal"
          onDidDismiss={() => {
            setIsModalOpen(false);
            setSelectedSeat("");
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Seat Status</IonTitle>
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
                <IonInput value={isConference(selectedSeat) ? "CONFERENCE ROOM" : `SEAT ${selectedSeat}`} readonly />
              </IonItem>

              <IonItem className="form-item">
                <IonLabel position="stacked">Current Status</IonLabel>
                <IonInput value={currentStatus.replaceAll("_", " ").toUpperCase()} readonly />
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

              {/* OPTIONAL: you can remove this Full Name field now since yellow doesn't use promo_bookings anymore */}
              <IonItem className="form-item">
                <IonLabel position="stacked">Full Name (not used)</IonLabel>
                <IonInput value={"TEMP OCCUPIED"} readonly />
              </IonItem>

              <IonButton expand="block" color="medium" disabled={saving} onClick={() => void clearToAvailableNow(selectedSeat, selectedKind)}>
                {saving ? "Working..." : "Set as Temporarily Available (CLEAR NOW)"}
              </IonButton>

              <div style={{ height: 10 }} />

              <IonButton expand="block" className="seat-modal-btn seat-modal-btn--temp" disabled={saving} onClick={() => void saveTempOccupied()}>
                Set as Occupied Temporarily (Yellow)
              </IonButton>

              <IonButton expand="block" className="seat-modal-btn seat-modal-btn--occupied" disabled={saving} onClick={() => void setBlocked("occupied")}>
                Set as Occupied (Red)
              </IonButton>

              <IonButton expand="block" className="seat-modal-btn seat-modal-btn--reserved" disabled={saving} onClick={() => void setBlocked("reserved")}>
                Set as Reserved (Purple)
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Dashboard;
