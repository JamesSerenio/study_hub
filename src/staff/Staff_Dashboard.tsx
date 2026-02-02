// src/pages/Staff_Dashboard.tsx
// ✅ STRICT TYPESCRIPT
// ✅ NO any
// ✅ SAME COLOR LOGIC AS ADMIN
// ✅ Staff can SET/CLEAR: temp occupied (promo_bookings), occupied (seat_blocked_times), reserved (seat_blocked_times)
// ✅ Seats: promo_bookings(area="common_area", seat_number=...)
// ✅ Conference: promo_bookings(area="conference_room", seat_number=NULL)
// ✅ CLEAR = DELETE rows that overlap NOW
// ✅ Open time supported (far future)
// ✅ SAME CLASS STRUCTURE (staff-content / seatmap-wrap / seatmap-container / seatmap-card / etc.)
// ✅ SAME pins positions + decorations
// ✅ 4 right-side color swatches are NOT editable

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

  // ✅ extra controls (no any)
  readonly?: boolean; // cannot click / cannot calibrate
  fixedStatus?: SeatStatus; // for swatches
};

type StoredPos = { x: number; y: number };
type StoredMap = Record<string, StoredPos>;

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | "reserved" | string;
};

type PromoConferenceRow = { id: string };

type PromoBookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  area: string;
  seat_number: string | null;
};

type PackageRow = { id: string };
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

const normalizeSeatId = (v: string): string => String(v).trim();

const farFutureIso = (): string =>
  new Date("2999-12-31T23:59:59.000Z").toISOString();

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
    return `${h.toString().padStart(2, "0")}:${mm
      .toString()
      .padStart(2, "0")}`;
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
        return `${hh.toString().padStart(2, "0")}:${mm
          .toString()
          .padStart(2, "0")}`;
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

const Staff_Dashboard: React.FC = () => {
  // ✅ SAME X/Y AS ADMIN + add 4 swatches (NOT editable)
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

      // ✅ RIGHT-SIDE COLOR SWATCHES (NOT editable / not clickable)
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
      // ✅ do not store/restore swatches
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

  // include conference in blocked check
  const blockedIds = useMemo<string[]>(
    () => [...seatIdsOnly, CONFERENCE_ID],
    [seatIdsOnly]
  );

  // ===== modal =====
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [selectedKind, setSelectedKind] = useState<PinKind>("seat");

  const [fullName, setFullName] = useState<string>("TEMP OCCUPIED");
  const [openTime, setOpenTime] = useState<boolean>(false);
  const [durationInput, setDurationInput] = useState<string>("01:00");
  const [saving, setSaving] = useState<boolean>(false);

  // required IDs (NO UI) - used for promo_bookings only
  const [packageId, setPackageId] = useState<string>("");
  const [packageOptionId, setPackageOptionId] = useState<string>("");

  const loadRequiredIds = async (): Promise<void> => {
    const pkgReq = supabase
      .from("packages")
      .select("id, area")
      .eq("area", "common_area")
      .limit(1);
    const optReq = supabase.from("package_options").select("id").limit(1);

    const [{ data: pkgs, error: pkgErr }, { data: opts, error: optErr }] =
      await Promise.all([pkgReq, optReq]);

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

  const loadSeatStatuses = async (): Promise<void> => {
    const startIso = new Date().toISOString();
    const endIso = farFutureIso();

    // seat_blocked_times covers occupied + reserved (and can also contain promo, but we prioritize regular/reserved)
    const seatsReq = supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .in("seat_number", blockedIds)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    // promo_bookings only for conference temp yellow
    const confTempReq = supabase
      .from("promo_bookings")
      .select("id")
      .eq("area", "conference_room")
      .eq("status", "active")
      .is("seat_number", null)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    const [{ data: seatData, error: seatErr }, { data: confTempData, error: confTempErr }] =
      await Promise.all([seatsReq, confTempReq]);

    const next: Record<string, SeatStatus> = {};
    for (const p of pins) next[p.id] = "temp_available";

    // apply blocked (occupied/reserved first)
    if (seatErr) {
      console.error("Seat status error:", seatErr.message);
    } else {
      const rows = (seatData ?? []) as SeatBlockedRow[];
      const bySeat: Record<string, SeatStatus> = {};

      for (const r of rows) {
        const id = normalizeSeatId(r.seat_number);

        // priority: reserved > occupied > temp
        if (r.source === "reserved") {
          bySeat[id] = "reserved";
          continue;
        }
        if (r.source === "regular") {
          // don't override reserved
          if (bySeat[id] !== "reserved") bySeat[id] = "occupied";
          continue;
        }
        if (r.source === "promo") {
          // don't override occupied/reserved
          if (bySeat[id] !== "reserved" && bySeat[id] !== "occupied") bySeat[id] = "occupied_temp";
          continue;
        }

        // unknown source -> treat as occupied (but don't override reserved)
        if (bySeat[id] !== "reserved") bySeat[id] = "occupied";
      }

      for (const id of blockedIds) {
        if (bySeat[id]) next[id] = bySeat[id];
      }
    }

    // apply conference temp ONLY if not already occupied/reserved
    if (confTempErr) {
      console.error("Conference temp error:", confTempErr.message);
    } else {
      const rows = (confTempData ?? []) as PromoConferenceRow[];
      if (rows.length > 0) {
        if (next[CONFERENCE_ID] === "temp_available") next[CONFERENCE_ID] = "occupied_temp";
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

  // ===== calibrate =====
  const setPinPositionFromClick = (clientX: number, clientY: number): void => {
    if (!calibrate) return;
    if (!selectedPinId) return;

    const pinObj = pins.find((p) => p.id === selectedPinId);
    if (pinObj?.readonly) return; // ✅ never calibrate swatches

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

  const openManageModalForPin = (pinId: string, kind: PinKind): void => {
    setSelectedSeat(pinId);
    setSelectedKind(kind);
    setOpenTime(false);
    setDurationInput("01:00");
    setFullName("TEMP OCCUPIED");
    setIsModalOpen(true);
  };

  // ✅ clear everything overlapping NOW for selected (promo_bookings for temp + seat_blocked_times for occupied/reserved)
  const clearToAvailableNow = async (pinId: string, kind: PinKind): Promise<void> => {
    const nowIso = new Date().toISOString();
    const area = getAreaForSelection(kind);

    setSaving(true);

    // 1) delete seat_blocked_times (occupied/reserved) overlap now
    const seatKey = kind === "room" ? CONFERENCE_ID : pinId;
    const { data: blockedRows, error: blkErr } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .eq("seat_number", seatKey)
      .lt("start_at", nowIso)
      .gt("end_at", nowIso);

    if (blkErr) {
      setSaving(false);
      return alert(`Load blocked error: ${blkErr.message}`);
    }

    if ((blockedRows ?? []).length > 0) {
      const { error: delBlkErr } = await supabase
        .from("seat_blocked_times")
        .delete()
        .eq("seat_number", seatKey)
        .lt("start_at", nowIso)
        .gt("end_at", nowIso);

      if (delBlkErr) {
        setSaving(false);
        return alert(`Delete blocked error: ${delBlkErr.message}`);
      }
    }

    // 2) delete promo_bookings overlap now (only temp logic: seats + conference)
    const promoBase = supabase
      .from("promo_bookings")
      .select("id, start_at, end_at, status, area, seat_number")
      .eq("area", area)
      .eq("status", "active")
      .lt("start_at", nowIso)
      .gt("end_at", nowIso);

    const { data: promoRows, error: promoErr } =
      kind === "room"
        ? await promoBase.is("seat_number", null)
        : await promoBase.eq("seat_number", pinId);

    if (promoErr) {
      setSaving(false);
      return alert(`Load temp occupied error: ${promoErr.message}`);
    }

    const list = (promoRows ?? []) as PromoBookingRow[];
    if (list.length > 0) {
      const ids = list.map((r) => r.id);
      const { error: delErr } = await supabase.from("promo_bookings").delete().in("id", ids);
      if (delErr) {
        setSaving(false);
        return alert(`Delete promo error: ${delErr.message}`);
      }
    }

    setSaving(false);
    setIsModalOpen(false);
    setSelectedSeat("");
    void loadSeatStatuses();
  };

  const checkConflicts = async (
    pinId: string,
    kind: PinKind,
    startIso: string,
    endIso: string
  ): Promise<string | null> => {
    const seatKey = kind === "room" ? CONFERENCE_ID : pinId;

    // block conflicts (occupied/reserved/temp blocks)
    const { data: blk, error: blkErr } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, source")
      .eq("seat_number", seatKey)
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    if (blkErr) return `Block check error: ${blkErr.message}`;
    if ((blk ?? []).length > 0) return "Already blocked (occupied/reserved).";

    // conference temp conflicts via promo_bookings (only for room)
    if (kind === "room") {
      const { data: confRows, error: confErr } = await supabase
        .from("promo_bookings")
        .select("id")
        .eq("area", "conference_room")
        .eq("status", "active")
        .is("seat_number", null)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (confErr) return `Conference check error: ${confErr.message}`;
      if ((confRows ?? []).length > 0) return "Conference room already occupied/reserved/temp.";
    }

    return null;
  };

  // ✅ set occupied/reserved via seat_blocked_times
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

    setSaving(true);

    const seatKey = selectedKind === "room" ? CONFERENCE_ID : selectedSeat;
    const source = choice === "occupied" ? "regular" : "reserved";

    const payload: {
      seat_number: string;
      start_at: string;
      end_at: string;
      source: string;
    } = {
      seat_number: seatKey,
      start_at: startIso,
      end_at: endIso,
      source,
    };

    const { error } = await supabase.from("seat_blocked_times").insert(payload);

    setSaving(false);
    if (error) return alert(`Error saving: ${error.message}`);

    setIsModalOpen(false);
    setSelectedSeat("");
    void loadSeatStatuses();
  };

  // ✅ set temp occupied via promo_bookings (existing logic)
  const saveTempOccupied = async (): Promise<void> => {
    if (!selectedSeat) return;

    const trimmed = fullName.trim();
    if (!trimmed) return alert("Full Name is required.");

    if (!packageId)
      return alert('Missing package (area="common_area"). Create at least 1 common_area package.');
    if (!packageOptionId) return alert("Missing package option. Create at least 1 package option.");

    if (!openTime) {
      const dur = normalizeDurationHHMM(durationInput);
      if (!dur) return alert("Invalid duration. Examples: 1 / 0:45 / 2:30 / 230 / 100:30");
    }

    const startIso = new Date().toISOString();
    const endIso = buildEndIso(startIso);

    const confMsg = await checkConflicts(selectedSeat, selectedKind, startIso, endIso);
    if (confMsg) return alert(confMsg);

    // seat conflict check vs seat_blocked_times for seats (existing behavior)
    if (selectedKind === "seat") {
      const { data: conflicts, error: confErr } = await supabase
        .from("seat_blocked_times")
        .select("seat_number, source")
        .eq("seat_number", selectedSeat)
        .lt("start_at", endIso)
        .gt("end_at", startIso);

      if (confErr) return alert(`Seat check error: ${confErr.message}`);
      if ((conflicts ?? []).length > 0) return alert(`Seat already taken: ${selectedSeat}`);
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
                  const selectedCls =
                    calibrate && selectedPinId === p.id && !p.readonly ? " selected" : "";
                  const readonlyCls = p.readonly ? " seat-pin--readonly" : "";
                  const cls = `${baseCls} ${STATUS_COLOR[st]}${selectedCls}${readonlyCls}`;
                  const isRoom = p.kind === "room";

                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={cls}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      title={
                        p.readonly
                          ? "Legend"
                          : calibrate
                          ? `Click to select: ${p.label}`
                          : `Manage: ${p.label}`
                      }
                      onClick={(ev) => {
                        ev.stopPropagation();

                        if (p.readonly) return; // ✅ swatches not clickable

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

              <img
                src={bearImage}
                alt="Bear"
                className="seatmap-bear-outside"
                draggable={false}
              />
              <img
                src={grassImage}
                alt="Grass"
                className="seatmap-grass-outside"
                draggable={false}
              />
            </div>
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
                <IonInput
                  value={isConference(selectedSeat) ? "CONFERENCE ROOM" : `SEAT ${selectedSeat}`}
                  readonly
                />
              </IonItem>

              <IonItem className="form-item">
                <IonLabel position="stacked">Current Status</IonLabel>
                <IonInput value={currentStatus.replaceAll("_", " ").toUpperCase()} readonly />
              </IonItem>

              {/* Shared time settings for all SET actions */}
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

              {/* TEMP requires name */}
              <IonItem className="form-item">
                <IonLabel position="stacked">Full Name (for Temp only)</IonLabel>
                <IonInput
                  value={fullName}
                  onIonChange={(e) => setFullName(e.detail.value ?? "")}
                />
              </IonItem>

              {/* CLEAR */}
              <IonButton
                expand="block"
                color="medium"
                disabled={saving}
                onClick={() => void clearToAvailableNow(selectedSeat, selectedKind)}
              >
                {saving ? "Working..." : "Set as Temporarily Available (CLEAR NOW)"}
              </IonButton>

              <div style={{ height: 10 }} />

              {/* SET choices */}
              <IonButton
                expand="block"
                color="warning"
                disabled={saving}
                onClick={() => void saveTempOccupied()}
              >
                Set as Occupied Temporarily (Yellow)
              </IonButton>

              <IonButton
                expand="block"
                color="danger"
                disabled={saving}
                onClick={() => void setBlocked("occupied")}
              >
                Set as Occupied (Red)
              </IonButton>

              <IonButton
                expand="block"
                color="tertiary"
                disabled={saving}
                onClick={() => void setBlocked("reserved")}
              >
                Set as Reserved (Purple)
              </IonButton>

              <p style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                <strong>CLEAR NOW</strong> will DELETE overlapping rows (promo_bookings and/or
                seat_blocked_times) for the selected target at the current time.
              </p>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Staff_Dashboard;
