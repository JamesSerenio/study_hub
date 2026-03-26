// src/components/BookingModal.tsx
// ✅ ONE CALENDAR only for reservation range
// ✅ Tap 2 dates => auto range (ex. Mar 1 + Mar 3 => Mar 1 to Mar 3)
// ✅ Seat required ONLY for reservation
// ✅ NON-reservation can save WITHOUT seat (seat_number stored as "N/A")
// ✅ Seat picker UI shown ONLY when reservation
// ✅ Conflict check runs ONLY when reservation
// ✅ Reservation auto-blocks seats PER DAY in seat_blocked_times (source="reserved")
// ✅ Reservation code is valid only on exact reserved date/time window
// ✅ Attendance modal included BELOW using same promo-like style
// ✅ Attendance is for reservation only
// ✅ IN starts attendance log
// ✅ OUT stops attendance log and adds to customer_sessions.total_time / total_amount
// ✅ Multi-day reservation supported
// ✅ strict TS (NO any)

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonDatetime,
  IonAlert,
  IonTextarea,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import type {
  IonInputCustomEvent,
  InputInputEventDetail,
  InputChangeEventDetail,
} from "@ionic/core";

const HOURLY_RATE = 20;
const FREE_MINUTES = 0;
const SEAT_NA = "N/A";
const FAR_FUTURE_ISO = new Date("2999-12-31T23:59:59.000Z").toISOString();

type CustomerType = "reviewer" | "student" | "regular" | "";
type AttendanceAction = "IN" | "OUT";

interface CustomerForm {
  full_name: string;
  phone_number: string;
  customer_type: CustomerType;
  has_id: boolean;
  seat_number: string[];
  reservation: boolean;
  reservation_date?: string;
  reservation_end_date?: string;
  time_started: string;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (isReservation: boolean) => void;
  seatGroups: SeatGroup[];
};

type SeatBlockedRow = {
  id?: string;
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | "reserved" | string;
};

type SeatConflictRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
};

type SeatBlockInsert = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "reserved" | "regular";
  created_by: string | null;
  note: string | null;
};

type SeatBlockInsertResult = { id: string; seat_number: string };

type AttendanceSessionRow = {
  id: string;
  full_name: string;
  booking_code: string | null;
  reservation: string;
  reservation_date: string | null;
  reservation_end_date?: string | null;
  hour_avail: string;
  time_started: string;
  time_ended: string | null;
  expected_end_at: string | null;
  total_time: number | string | null;
  total_amount: number | string | null;
};

type AttendanceLogRow = {
  id: string;
  session_id: string;
  booking_code: string;
  attendance_date: string;
  in_at: string;
  out_at: string | null;
  note: string | null;
  auto_closed: boolean;
  created_at: string;
};

const BOOKING_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const isCustomerType = (v: unknown): v is CustomerType =>
  v === "" || v === "reviewer" || v === "student" || v === "regular";

const toNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toYYYYMMDD = (v: string): string | null => {
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const todayLocalYYYYMMDD = (): string => new Date().toLocaleDateString("en-CA");

const normalizePhonePH = (raw: string): string => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  let s = trimmed.replace(/[^\d+]/g, "");

  if (s.startsWith("+63")) s = "0" + s.slice(3);
  if (s.startsWith("63")) s = "0" + s.slice(2);

  s = s.replace(/[^\d]/g, "");
  return s;
};

type PhoneValidation =
  | { ok: true; normalized: string }
  | { ok: false; message: string };

const validatePhonePH = (raw: string): PhoneValidation => {
  const normalized = normalizePhonePH(raw);

  if (!normalized) return { ok: false, message: "Phone Number is required." };

  if (!normalized.startsWith("09")) {
    return { ok: false, message: 'Phone Number must start with "09". Example: 09XXXXXXXXX' };
  }

  if (normalized.length < 11) {
    return { ok: false, message: "Phone Number is too short. It must be 11 digits (09XXXXXXXXX)." };
  }

  if (normalized.length > 11) {
    return { ok: false, message: "Phone Number is too long. It must be 11 digits (09XXXXXXXXX)." };
  }

  if (!/^09\d{9}$/.test(normalized)) {
    return { ok: false, message: "Phone Number must contain digits only. Example: 09XXXXXXXXX" };
  }

  return { ok: true, normalized };
};

const normalizeTimeAvail = (value: string): string | null => {
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

const toHHMM = (totalMinutes: number): string => {
  const mins = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

const normalizeReservationTime = (raw: string): string | null => {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!v) return null;

  const pad2 = (n: number) => n.toString().padStart(2, "0");

  const to12 = (h24: number, m: number): string => {
    const isPM = h24 >= 12;
    let h12 = h24 % 12;
    if (h24 === 0) h12 = 0;
    return `${pad2(h12)}:${pad2(m)} ${isPM ? "pm" : "am"}`;
  };

  let m = v.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = m[2];
    if (h < 0 || h > 12) return null;
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return to12(h, 0);
  }

  m = v.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3];
    if (h < 0 || h > 12) return null;
    if (mm < 0 || mm > 59) return null;
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return to12(h, mm);
  }

  m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h24 = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h24 < 0 || h24 > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return to12(h24, mm);
  }

  m = v.match(/^(\d{3,4})$/);
  if (m) {
    const s = m[1].padStart(4, "0");
    const h24 = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2), 10);
    if (h24 < 0 || h24 > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return to12(h24, mm);
  }

  return null;
};

const parseReservationToISO = (time12: string, yyyyMmDd: string): string | null => {
  const tm = time12.trim().toLowerCase().match(/^(\d{2}):(\d{2})\s*(am|pm)$/);
  const dm = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!tm || !dm) return null;

  let hour = parseInt(tm[1], 10);
  const minute = parseInt(tm[2], 10);
  const ap = tm[3];

  if (hour < 0 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  if (ap === "pm" && hour !== 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;

  const y = parseInt(dm[1], 10);
  const mo = parseInt(dm[2], 10) - 1;
  const d = parseInt(dm[3], 10);

  const local = new Date(y, mo, d, hour, minute, 0, 0);
  if (!Number.isFinite(local.getTime())) return null;
  return local.toISOString();
};

const endOfLocalDayIso = (yyyyMmDd: string): string => {
  const m = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 23, 59, 59, 999).toISOString();
};

const addDuration = (startIso: string, durationHHMM: string): string => {
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return startIso;

  const [hRaw, mRaw] = durationHHMM.split(":");
  const dh = Number(hRaw);
  const dm = Number(mRaw);
  if (Number.isNaN(dh) || Number.isNaN(dm)) return startIso;

  const totalMinutes = dh * 60 + dm;
  return new Date(start.getTime() + totalMinutes * 60_000).toISOString();
};

const clampToReservationDay = (endIso: string, reservationDate?: string): string => {
  if (!reservationDate) return endIso;
  const eod = endOfLocalDayIso(reservationDate);
  const endMs = new Date(endIso).getTime();
  const eodMs = new Date(eod).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(eodMs)) return endIso;
  return endMs > eodMs ? eod : endIso;
};

const formatPH = (d: Date) =>
  d.toLocaleString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatReservationDateOnly = (yyyyMmDd?: string): string => {
  if (!yyyyMmDd) return "No date selected";
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const ensureAuthUserId = async (): Promise<string> => {
  const { data: sess } = await supabase.auth.getSession();
  if (sess?.session?.user?.id) return sess.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data?.user?.id) {
    throw new Error(error?.message ?? "Anonymous sign-in failed. Enable Anonymous provider in Supabase.");
  }
  return data.user.id;
};

const generateBookingCode = (): string => {
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    const idx = Math.floor(Math.random() * BOOKING_CODE_CHARS.length);
    out += BOOKING_CODE_CHARS[idx];
  }
  return out;
};

const createUniqueBookingCode = async (): Promise<string> => {
  for (let i = 0; i < 20; i += 1) {
    const code = generateBookingCode();
    const { data, error } = await supabase
      .from("customer_sessions")
      .select("id")
      .eq("booking_code", code)
      .limit(1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return code;
  }

  throw new Error("Failed to generate unique booking code. Please try again.");
};

const rangeDatesInclusive = (startYmd: string, endYmd: string): string[] => {
  const start = new Date(`${startYmd}T00:00:00`);
  const end = new Date(`${endYmd}T00:00:00`);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const cur = new Date(start);

  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toLocaleDateString("en-CA"));
    cur.setDate(cur.getDate() + 1);
  }

  return out;
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();

  if (![aS, aE, bS, bE].every(Number.isFinite)) return false;
  return aS < bE && aE > bS;
};

const getManilaNow = (): Date => {
  const now = new Date();
  const manilaString = now.toLocaleString("en-US", { timeZone: "Asia/Manila" });
  return new Date(manilaString);
};

const getManilaYMD = (): string => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const dateAtSessionClock = (ymd: string, sessionStartIso: string): Date => {
  const base = new Date(sessionStartIso);
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7)) - 1;
  const day = Number(ymd.slice(8, 10));

  return new Date(
    year,
    month,
    day,
    base.getHours(),
    base.getMinutes(),
    0,
    0
  );
};

const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60_000);
};

const endOfLocalDay = (ymd: string): Date => {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7)) - 1;
  const day = Number(ymd.slice(8, 10));
  return new Date(year, month, day, 23, 59, 59, 999);
};

const isDateWithinRange = (target: string, start: string | null, end: string | null | undefined): boolean => {
  if (!start) return false;
  const finalEnd = end ?? start;
  return target >= start && target <= finalEnd;
};

const getBillAmount = (minutes: number): number => {
  const billableMin = Math.max(0, Math.floor(minutes) - FREE_MINUTES);
  return (billableMin / 60) * HOURLY_RATE;
};

const formatDateTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function BookingModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [form, setForm] = useState<CustomerForm>({
    full_name: "",
    phone_number: "",
    customer_type: "",
    has_id: false,
    seat_number: [],
    reservation: false,
    reservation_date: undefined,
    reservation_end_date: undefined,
    time_started: new Date().toISOString(),
  });

  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState(false);

  const [timeAvail, setTimeAvail] = useState("00:00");
  const [timeAvailInput, setTimeAvailInput] = useState("00:00");

  const [timeStartedInput, setTimeStartedInput] = useState("00:00 am");
  const [timeStartedNormalized, setTimeStartedNormalized] = useState("00:00 am");
  const timeStartedRef = useRef<string>("00:00 am");

  const [timeSnapshotIso, setTimeSnapshotIso] = useState(new Date().toISOString());

  const [dateTouchTick, setDateTouchTick] = useState(0);
  const [refreshSeatsTick, setRefreshSeatsTick] = useState(0);

  const [phoneAlertOpen, setPhoneAlertOpen] = useState(false);
  const [phoneAlertMsg, setPhoneAlertMsg] = useState("");

  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [savedBookingCode, setSavedBookingCode] = useState("");
  const [savedCodeActiveNow, setSavedCodeActiveNow] = useState(false);
  const [savedCodeForReservation, setSavedCodeForReservation] = useState(false);

  // attendance modal state
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [attendanceAction, setAttendanceAction] = useState<AttendanceAction>("IN");
  const [attendanceNote, setAttendanceNote] = useState("");
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLogRow[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  const manilaDay = useMemo(() => getManilaYMD(), [attendanceModalOpen]);

  const commitReservationTime = (raw: string) => {
    const normalized = normalizeReservationTime(raw);
    const finalVal = normalized ?? "00:00 am";
    setTimeStartedInput(finalVal);
    setTimeStartedNormalized(finalVal);
    timeStartedRef.current = finalVal;
  };

  const commitTimeAvail = (rawValue: string) => {
    const normalized = normalizeTimeAvail(rawValue);
    if (normalized) {
      setTimeAvail(normalized);
      setTimeAvailInput(normalized);
    } else {
      setTimeAvailInput(rawValue);
    }
  };

  const getTotalMinutes = (): number => {
    const [hRaw, mRaw] = timeAvail.split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return h * 60 + m;
  };

  const getAmountPeso = (): number => {
    const totalMin = getTotalMinutes();
    const billableMin = Math.max(0, totalMin - FREE_MINUTES);
    return (billableMin / 60) * HOURLY_RATE;
  };

  const cleanupExpiredReserved = async (): Promise<void> => {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("seat_blocked_times")
      .delete()
      .eq("source", "reserved")
      .lt("end_at", nowIso);

    if (error) console.warn("cleanupExpiredReserved:", error.message);
  };

  useEffect(() => {
    if (!isOpen) return;

    const channel = supabase
      .channel("seat-blocked-times-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "seat_blocked_times" }, () => {
        setRefreshSeatsTick((x) => x + 1);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isOpen]);

  const reservationDates = useMemo((): string[] => {
    if (!form.reservation) return [];
    if (!form.reservation_date || !form.reservation_end_date) return [];
    return rangeDatesInclusive(form.reservation_date, form.reservation_end_date);
  }, [form.reservation, form.reservation_date, form.reservation_end_date]);

  const reservationStartIso = useMemo((): string | null => {
    if (!form.reservation) return null;
    if (!form.reservation_date) return null;

    const normalized = normalizeReservationTime(timeStartedNormalized);
    if (!normalized) return null;

    const parsed = parseReservationToISO(normalized, form.reservation_date);
    return parsed ?? null;
  }, [form.reservation, form.reservation_date, timeStartedNormalized]);

  const reservationLastDayEndIso = useMemo((): string | null => {
    if (!form.reservation || !form.reservation_end_date) return null;
    if (!form.reservation_date) return null;

    const normalized = normalizeReservationTime(timeStartedNormalized);
    if (!normalized) return null;

    const lastStartIso = parseReservationToISO(normalized, form.reservation_end_date);
    if (!lastStartIso) return null;

    if (openTime) return endOfLocalDayIso(form.reservation_end_date);

    const normalizedAvail = normalizeTimeAvail(timeAvailInput);
    if (!normalizedAvail || normalizedAvail === "00:00") return null;

    const end = addDuration(lastStartIso, normalizedAvail);
    return clampToReservationDay(end, form.reservation_end_date);
  }, [
    form.reservation,
    form.reservation_date,
    form.reservation_end_date,
    timeStartedNormalized,
    openTime,
    timeAvailInput,
  ]);

  const isSeatPickReady = useMemo((): boolean => {
    if (!form.reservation) return false;
    if (!reservationStartIso) return false;
    if (!form.reservation_date || !form.reservation_end_date) return false;
    if (reservationDates.length === 0) return false;

    if (openTime) return true;

    const normalizedAvail = normalizeTimeAvail(timeAvailInput);
    if (!normalizedAvail) return false;
    if (normalizedAvail === "00:00") return false;

    return true;
  }, [
    form.reservation,
    form.reservation_date,
    form.reservation_end_date,
    reservationStartIso,
    reservationDates,
    openTime,
    timeAvailInput,
  ]);

  const seatPickHint = useMemo((): string => {
    if (!form.reservation) return "";
    if (!form.reservation_date) return "Select reservation date range first.";
    if (!form.reservation_end_date) return "Select reservation date range first.";
    if (form.reservation_end_date < form.reservation_date) return "End date cannot be earlier than start date.";
    if (!reservationStartIso) return "Set a valid Time Started first.";
    if (!openTime) {
      const normalizedAvail = normalizeTimeAvail(timeAvailInput);
      if (!normalizedAvail) return "Set a valid Time Avail first.";
      if (normalizedAvail === "00:00") return "Time Avail must be greater than 00:00.";
    }
    return "";
  }, [
    form.reservation,
    form.reservation_date,
    form.reservation_end_date,
    reservationStartIso,
    openTime,
    timeAvailInput,
  ]);

  const buildReservationWindows = (): Array<{ date: string; startIso: string; endIso: string }> => {
    if (!form.reservation_date || !form.reservation_end_date) return [];

    const normalized = normalizeReservationTime(timeStartedNormalized);
    if (!normalized) return [];

    const days = rangeDatesInclusive(form.reservation_date, form.reservation_end_date);
    if (days.length === 0) return [];

    return days
      .map((day) => {
        const startIso = parseReservationToISO(normalized, day);
        if (!startIso) return null;

        if (openTime) {
          return {
            date: day,
            startIso,
            endIso: endOfLocalDayIso(day),
          };
        }

        const normalizedAvail = normalizeTimeAvail(timeAvailInput);
        if (!normalizedAvail || normalizedAvail === "00:00") return null;

        const endIso = clampToReservationDay(addDuration(startIso, normalizedAvail), day);

        return {
          date: day,
          startIso,
          endIso,
        };
      })
      .filter((v): v is { date: string; startIso: string; endIso: string } => v !== null);
  };

  const fetchOccupiedSeats = async (): Promise<void> => {
    await cleanupExpiredReserved();

    const windows = buildReservationWindows();
    if (windows.length === 0) {
      setOccupiedSeats([]);
      return;
    }

    const minStartIso = windows[0].startIso;
    const maxEndIso = windows[windows.length - 1].endIso;

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .lt("start_at", maxEndIso)
      .gt("end_at", minStartIso);

    if (error) {
      console.error(error);
      setOccupiedSeats([]);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];

    const occupied = new Set<string>();

    rows.forEach((row) => {
      windows.forEach((w) => {
        if (overlaps(row.start_at, row.end_at, w.startIso, w.endIso)) {
          occupied.add(String(row.seat_number).trim());
        }
      });
    });

    setOccupiedSeats(Array.from(occupied));
  };

  const createSeatBlocksForReservation = async (
    seatNums: string[],
    userId: string
  ): Promise<SeatBlockInsertResult[]> => {
    const windows = buildReservationWindows();
    const payload: SeatBlockInsert[] = [];

    windows.forEach((w) => {
      seatNums.forEach((seat) => {
        payload.push({
          seat_number: seat,
          start_at: w.startIso,
          end_at: w.endIso,
          source: "reserved",
          created_by: userId,
          note: `reservation ${w.date}`,
        });
      });
    });

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .insert(payload)
      .select("id, seat_number");

    if (error) throw new Error(error.message);
    return (data ?? []) as SeatBlockInsertResult[];
  };

  const rollbackSeatBlocks = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await supabase.from("seat_blocked_times").delete().in("id", ids);
  };

  const applyPickedDateRange = (raw: unknown) => {
    const values: string[] = [];

    if (typeof raw === "string") {
      const d = toYYYYMMDD(raw);
      if (d) values.push(d);
    } else if (Array.isArray(raw)) {
      raw.forEach((item) => {
        if (typeof item === "string") {
          const d = toYYYYMMDD(item);
          if (d) values.push(d);
        }
      });
    }

    const uniqueSorted = Array.from(new Set(values)).sort();

    if (uniqueSorted.length === 0) {
      setForm((p) => ({
        ...p,
        reservation_date: undefined,
        reservation_end_date: undefined,
        seat_number: [],
        reservation: true,
      }));
      setOccupiedSeats([]);
      setDateTouchTick((x) => x + 1);
      setRefreshSeatsTick((x) => x + 1);
      return;
    }

    const start = uniqueSorted[0];
    const end = uniqueSorted[uniqueSorted.length - 1];

    setForm((p) => ({
      ...p,
      reservation_date: start,
      reservation_end_date: end,
      seat_number: [],
      reservation: true,
    }));

    setOccupiedSeats([]);
    setDateTouchTick((x) => x + 1);
    setRefreshSeatsTick((x) => x + 1);
  };

  useEffect(() => {
    if (!isOpen) return;

    void cleanupExpiredReserved();

    const snap = new Date().toISOString();
    setTimeSnapshotIso(snap);
    setForm((p) => ({ ...p, time_started: snap }));

    setTimeAvail("00:00");
    setTimeAvailInput("00:00");
    setOpenTime(false);

    setTimeStartedInput("00:00 am");
    setTimeStartedNormalized("00:00 am");
    timeStartedRef.current = "00:00 am";

    setForm((p) => ({
      ...p,
      seat_number: [],
      reservation_date: undefined,
      reservation_end_date: undefined,
    }));

    setOccupiedSeats([]);
    setDateTouchTick(0);
    setRefreshSeatsTick((x) => x + 1);
    setSavedBookingCode("");
    setSavedCodeForReservation(false);
    setCodeModalOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (!form.reservation) {
      setOccupiedSeats([]);
      return;
    }

    setForm((p) => ({ ...p, seat_number: [] }));

    if (!isSeatPickReady) {
      setOccupiedSeats([]);
      return;
    }

    void fetchOccupiedSeats();
  }, [
    isOpen,
    form.reservation,
    form.reservation_date,
    form.reservation_end_date,
    timeStartedNormalized,
    openTime,
    timeAvailInput,
    isSeatPickReady,
    dateTouchTick,
    refreshSeatsTick,
  ]);

  const summaryStartIso = useMemo(() => {
    if (!form.reservation) return timeSnapshotIso;
    return reservationStartIso ?? timeSnapshotIso;
  }, [form.reservation, reservationStartIso, timeSnapshotIso]);

  const summaryEndIso = useMemo(() => {
    if (form.reservation) {
      return reservationLastDayEndIso ?? summaryStartIso;
    }
    if (openTime) return summaryStartIso;
    return addDuration(summaryStartIso, timeAvail);
  }, [form.reservation, reservationLastDayEndIso, summaryStartIso, openTime, timeAvail]);

  const totalMinutesPreview = getTotalMinutes();
  const totalHHMMPreview = toHHMM(totalMinutesPreview);
  const timeAmountPreview = openTime ? 0 : getAmountPeso();

  const timeInDisplay = formatPH(new Date(summaryStartIso));
  const timeOutDisplay = openTime ? "OPEN TIME" : formatPH(new Date(summaryEndIso));

  const resetBookingForm = (): void => {
    setForm({
      full_name: "",
      phone_number: "",
      customer_type: "",
      has_id: false,
      seat_number: [],
      reservation: false,
      reservation_date: undefined,
      reservation_end_date: undefined,
      time_started: new Date().toISOString(),
    });

    setTimeAvail("00:00");
    setTimeAvailInput("00:00");
    setOpenTime(false);

    setTimeStartedInput("00:00 am");
    setTimeStartedNormalized("00:00 am");
    timeStartedRef.current = "00:00 am";

    setOccupiedSeats([]);
    setRefreshSeatsTick((x) => x + 1);
  };

  const handleSubmitBooking = async (): Promise<void> => {
    const trimmedName = form.full_name.trim();
    if (!trimmedName) return alert("Full Name is required.");

    const phoneCheck = validatePhonePH(form.phone_number);
    if (!phoneCheck.ok) {
      setPhoneAlertMsg(phoneCheck.message);
      setPhoneAlertOpen(true);
      return;
    }
    const phoneToStore = phoneCheck.normalized;

    if (form.reservation) {
      if (!form.reservation_date) return alert("Please select reservation date range.");
      if (!form.reservation_end_date) return alert("Please select reservation date range.");
      if (form.reservation_end_date < form.reservation_date) {
        return alert("Reservation end date cannot be earlier than start date.");
      }
      if (!reservationStartIso) return alert("Please enter a valid Time Started.");

      if (!openTime) {
        const normalizedAvail = normalizeTimeAvail(timeAvailInput);
        if (!normalizedAvail) return alert("Invalid Time Avail.");
        if (normalizedAvail === "00:00") return alert("Time Avail must be greater than 00:00.");
        setTimeAvail(normalizedAvail);
        setTimeAvailInput(normalizedAvail);
      }

      if (form.seat_number.length === 0) return alert("Please select at least one seat.");
    } else {
      if (!openTime) {
        const normalizedAvail = normalizeTimeAvail(timeAvailInput);
        if (!normalizedAvail) return alert("Invalid Time Avail.");
        if (normalizedAvail === "00:00") return alert("Time Avail must be greater than 00:00.");
        setTimeAvail(normalizedAvail);
        setTimeAvailInput(normalizedAvail);
      }
    }

    let userId: string;
    try {
      userId = await ensureAuthUserId();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown auth error";
      return alert(msg);
    }

    const dateToStore = todayLocalYYYYMMDD();

    let createdBlockIds: string[] = [];

    try {
      const bookingCode = await createUniqueBookingCode();

      let startIsoToStore = new Date().toISOString();
      let timeEndedToStore = FAR_FUTURE_ISO;
      let expectedEndAt: string | null = null;

      if (form.reservation) {
        const windows = buildReservationWindows();
        if (windows.length === 0) return alert("Invalid reservation schedule.");

        startIsoToStore = windows[0].startIso;
        timeEndedToStore = windows[windows.length - 1].endIso;
        expectedEndAt = timeEndedToStore;

        const minStartIso = windows[0].startIso;
        const maxEndIso = windows[windows.length - 1].endIso;

        const { data: blocks, error: conflictErr } = await supabase
          .from("seat_blocked_times")
          .select("seat_number, start_at, end_at")
          .in("seat_number", form.seat_number)
          .lt("start_at", maxEndIso)
          .gt("end_at", minStartIso);

        if (conflictErr) return alert(`Seat check error: ${conflictErr.message}`);

        const existingRows = (blocks ?? []) as SeatConflictRow[];
        const conflictSeats = new Set<string>();

        existingRows.forEach((row) => {
          windows.forEach((w) => {
            if (overlaps(row.start_at, row.end_at, w.startIso, w.endIso)) {
              conflictSeats.add(String(row.seat_number).trim());
            }
          });
        });

        if (conflictSeats.size > 0) {
          return alert(`Seat already taken: ${Array.from(conflictSeats).join(", ")}`);
        }

        const created = await createSeatBlocksForReservation(form.seat_number, userId);
        createdBlockIds = created.map((r) => r.id);

        const { error: sessionErr } = await supabase.from("customer_sessions").insert({
          staff_id: null,
          date: dateToStore,
          full_name: trimmedName,
          phone_number: phoneToStore,
          customer_type: form.customer_type,
          has_id: form.has_id,
          hour_avail: openTime ? "OPEN" : timeAvail,
          time_started: startIsoToStore,
          time_ended: timeEndedToStore,
          total_time: 0,
          total_amount: 0,
          seat_number: form.seat_number.join(", "),
          reservation: "yes",
          reservation_date: form.reservation_date,
          reservation_end_date: form.reservation_end_date,
          expected_end_at: expectedEndAt,
          booking_code: bookingCode,
        });

        if (sessionErr) {
          await rollbackSeatBlocks(createdBlockIds);
          return alert(`Error saving session: ${sessionErr.message}`);
        }

        setSavedBookingCode(bookingCode);
        setSavedCodeActiveNow(false);
        setSavedCodeForReservation(true);
        setCodeModalOpen(true);

        resetBookingForm();
        onSaved(true);
        return;
      }

      startIsoToStore = new Date().toISOString();

      if (openTime) {
        timeEndedToStore = FAR_FUTURE_ISO;
      } else {
        const computed = addDuration(startIsoToStore, timeAvail);
        timeEndedToStore =
          computed === startIsoToStore
            ? new Date(new Date(startIsoToStore).getTime() + 60_000).toISOString()
            : computed;
      }

      const totalMin = getTotalMinutes();
      const totalHoursForDB = Number((totalMin / 60).toFixed(2));
      const timeAmount = openTime ? 0 : getAmountPeso();

      const { error: sessionErr } = await supabase.from("customer_sessions").insert({
        staff_id: null,
        date: dateToStore,
        full_name: trimmedName,
        phone_number: phoneToStore,
        customer_type: form.customer_type,
        has_id: form.has_id,
        hour_avail: openTime ? "OPEN" : timeAvail,
        time_started: startIsoToStore,
        time_ended: timeEndedToStore,
        total_time: openTime ? 0 : totalHoursForDB,
        total_amount: timeAmount,
        seat_number: SEAT_NA,
        reservation: "no",
        reservation_date: null,
        reservation_end_date: null,
        expected_end_at: timeEndedToStore,
        booking_code: bookingCode,
      });

      if (sessionErr) {
        return alert(`Error saving session: ${sessionErr.message}`);
      }

      setSavedBookingCode(bookingCode);
      setSavedCodeActiveNow(true);
      setSavedCodeForReservation(false);
      setCodeModalOpen(true);

      resetBookingForm();
      onSaved(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return alert(`Error saving: ${msg}`);
    }
  };

  // =========================
  // ATTENDANCE
  // =========================

  const getAllowedWindow = (session: AttendanceSessionRow, ymd: string): { start: Date; end: Date } | null => {
    if (!isDateWithinRange(ymd, session.reservation_date, session.reservation_end_date)) return null;

    const start = dateAtSessionClock(ymd, session.time_started);

    if (session.hour_avail === "OPEN") {
      return { start, end: endOfLocalDay(ymd) };
    }

    const normalized = normalizeTimeAvail(session.hour_avail);
    if (!normalized) return null;

    const [h, m] = normalized.split(":").map(Number);
    const totalMinutes = h * 60 + m;
    const end = addMinutes(start, totalMinutes);

    const endOfDay = endOfLocalDay(ymd);
    return {
      start,
      end: end.getTime() > endOfDay.getTime() ? endOfDay : end,
    };
  };

  const findReservationSessionByCode = async (codeRaw: string): Promise<AttendanceSessionRow | null> => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return null;

    const { data, error } = await supabase
      .from("customer_sessions")
      .select(`
        id,
        full_name,
        booking_code,
        reservation,
        reservation_date,
        reservation_end_date,
        hour_avail,
        time_started,
        time_ended,
        expected_end_at,
        total_time,
        total_amount
      `)
      .eq("booking_code", code)
      .eq("reservation", "yes")
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data ?? null) as AttendanceSessionRow | null;
  };

  const loadAttendanceHistory = async (): Promise<void> => {
    const code = attendanceCode.trim().toUpperCase();
    if (!code) {
      setAttendanceLogs([]);
      return;
    }

    try {
      const session = await findReservationSessionByCode(code);
      if (!session) {
        setAttendanceLogs([]);
        alert("Reservation booking code not found.");
        return;
      }

      const { data, error } = await supabase
        .from("customer_session_attendance")
        .select("*")
        .eq("session_id", session.id)
        .order("in_at", { ascending: false });

      if (error) throw new Error(error.message);

      setAttendanceLogs((data ?? []) as AttendanceLogRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load history.";
      alert(msg);
    }
  };

  const autoCloseExpiredLogIfNeeded = async (session: AttendanceSessionRow): Promise<void> => {
    const today = getManilaYMD();
    const window = getAllowedWindow(session, today);
    if (!window) return;

    const { data, error } = await supabase
      .from("customer_session_attendance")
      .select("*")
      .eq("session_id", session.id)
      .eq("attendance_date", today)
      .is("out_at", null)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const openLog = (data ?? null) as AttendanceLogRow | null;
    if (!openLog) return;

    const now = getManilaNow();
    if (now.getTime() <= window.end.getTime()) return;

    const outAtIso = window.end.toISOString();
    const inAt = new Date(openLog.in_at);
    const minutes = Math.max(0, Math.floor((window.end.getTime() - inAt.getTime()) / 60000));
    const addAmount = getBillAmount(minutes);

    const nextTotalTime = toNumber(session.total_time) + minutes / 60;
    const nextTotalAmount = toNumber(session.total_amount) + addAmount;

    const { error: updLogErr } = await supabase
      .from("customer_session_attendance")
      .update({
        out_at: outAtIso,
        auto_closed: true,
      })
      .eq("id", openLog.id);

    if (updLogErr) throw new Error(updLogErr.message);

    const { error: updSessionErr } = await supabase
      .from("customer_sessions")
      .update({
        total_time: nextTotalTime,
        total_amount: nextTotalAmount,
      })
      .eq("id", session.id);

    if (updSessionErr) throw new Error(updSessionErr.message);
  };

  const handleAttendanceSave = async (): Promise<void> => {
    const code = attendanceCode.trim().toUpperCase();
    if (!code) return alert("Enter booking code first.");

    setAttendanceLoading(true);

    try {
      const session = await findReservationSessionByCode(code);
      if (!session) {
        alert("Reservation booking code not found.");
        return;
      }

      await autoCloseExpiredLogIfNeeded(session);

      const today = getManilaYMD();
      const window = getAllowedWindow(session, today);

      if (!window) {
        alert("This reservation code is not valid for today.");
        return;
      }

      const now = getManilaNow();

      if (attendanceAction === "IN") {
        if (now.getTime() < window.start.getTime()) {
          alert("Code is not active yet for today's reserved schedule.");
          return;
        }

        if (now.getTime() > window.end.getTime()) {
          alert("Code already expired for today's reserved schedule.");
          return;
        }

        const { data: existingOpen, error: openErr } = await supabase
          .from("customer_session_attendance")
          .select("*")
          .eq("session_id", session.id)
          .eq("attendance_date", today)
          .is("out_at", null)
          .limit(1)
          .maybeSingle();

        if (openErr) throw new Error(openErr.message);

        if (existingOpen) {
          alert("This reservation is already IN for today.");
          return;
        }

        const { error: insErr } = await supabase
          .from("customer_session_attendance")
          .insert({
            session_id: session.id,
            booking_code: code,
            attendance_date: today,
            in_at: now.toISOString(),
            note: attendanceNote.trim() || null,
          });

        if (insErr) throw new Error(insErr.message);

        alert("Attendance IN saved.");
      } else {
        const { data: openLog, error: openErr } = await supabase
          .from("customer_session_attendance")
          .select("*")
          .eq("session_id", session.id)
          .eq("attendance_date", today)
          .is("out_at", null)
          .limit(1)
          .maybeSingle();

        if (openErr) throw new Error(openErr.message);

        const activeLog = (openLog ?? null) as AttendanceLogRow | null;
        if (!activeLog) {
          alert("No active IN log found for today.");
          return;
        }

        const actualOut = now.getTime() > window.end.getTime() ? window.end : now;
        const inAt = new Date(activeLog.in_at);
        const minutes = Math.max(0, Math.floor((actualOut.getTime() - inAt.getTime()) / 60000));
        const addAmount = getBillAmount(minutes);

        const nextTotalTime = toNumber(session.total_time) + minutes / 60;
        const nextTotalAmount = toNumber(session.total_amount) + addAmount;

        const { error: updLogErr } = await supabase
          .from("customer_session_attendance")
          .update({
            out_at: actualOut.toISOString(),
            note: attendanceNote.trim() || activeLog.note || null,
          })
          .eq("id", activeLog.id);

        if (updLogErr) throw new Error(updLogErr.message);

        const { error: updSessionErr } = await supabase
          .from("customer_sessions")
          .update({
            total_time: nextTotalTime,
            total_amount: nextTotalAmount,
          })
          .eq("id", session.id);

        if (updSessionErr) throw new Error(updSessionErr.message);

        alert("Attendance OUT saved.");
      }

      setAttendanceNote("");
      await loadAttendanceHistory();
      onSaved(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save attendance.";
      alert(msg);
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    if (!attendanceModalOpen) return;
    const code = attendanceCode.trim().toUpperCase();
    if (!code) return;

    void (async () => {
      try {
        const session = await findReservationSessionByCode(code);
        if (!session) return;
        await autoCloseExpiredLogIfNeeded(session);
        await loadAttendanceHistory();
      } catch {
        // silent
      }
    })();
  }, [attendanceModalOpen]);

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={onClose} className="booking-modal">
        <IonHeader>
          <IonToolbar>
            <IonTitle>Booking</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={onClose}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonAlert
          isOpen={phoneAlertOpen}
          header="Invalid Phone Number"
          message={phoneAlertMsg}
          buttons={["OK"]}
          onDidDismiss={() => setPhoneAlertOpen(false)}
        />

        <IonContent className="ion-padding">
          <div className="bookadd-card">
            <IonItem className="form-item">
              <IonLabel>Open Time</IonLabel>
              <IonToggle checked={openTime} onIonChange={(e) => setOpenTime(e.detail.checked)} />
              <IonLabel slot="end">{openTime ? "Yes" : "No"}</IonLabel>
            </IonItem>

            <IonItem className="form-item">
              <IonLabel position="stacked">Full Name *</IonLabel>
              <IonInput
                value={form.full_name}
                required
                onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })}
                placeholder="Enter full name"
              />
            </IonItem>

            <IonItem className="form-item">
              <IonLabel position="stacked">Phone Number *</IonLabel>
              <IonInput
                type="tel"
                inputMode="tel"
                value={form.phone_number}
                required
                onIonChange={(e) => setForm({ ...form, phone_number: e.detail.value ?? "" })}
                placeholder="e.g., 09XXXXXXXXX or +639XXXXXXXXX"
              />
            </IonItem>

            <IonItem className="form-item">
              <IonLabel position="stacked">Customer Type</IonLabel>
              <IonSelect
                value={form.customer_type}
                onIonChange={(e) => {
                  const v: unknown = e.detail.value;
                  setForm((prev) => ({ ...prev, customer_type: isCustomerType(v) ? v : "" }));
                }}
              >
                <IonSelectOption value="reviewer">Reviewer</IonSelectOption>
                <IonSelectOption value="student">Student</IonSelectOption>
                <IonSelectOption value="regular">Regular</IonSelectOption>
              </IonSelect>
            </IonItem>

            <IonItem className="form-item">
              <IonLabel>ID</IonLabel>
              <IonToggle checked={form.has_id} onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })} />
              <IonLabel slot="end">{form.has_id ? "With" : "Without"}</IonLabel>
            </IonItem>

            <IonItem className="form-item">
              <IonLabel>Reservation</IonLabel>
              <IonToggle
                checked={form.reservation}
                onIonChange={(e) => {
                  const checked = e.detail.checked;

                  setForm((p) => ({
                    ...p,
                    reservation: checked,
                    seat_number: [],
                    reservation_date: checked ? p.reservation_date : undefined,
                    reservation_end_date: checked ? p.reservation_end_date : undefined,
                  }));

                  setOccupiedSeats([]);
                  setDateTouchTick((x) => x + 1);
                  setRefreshSeatsTick((x) => x + 1);

                  if (checked) {
                    commitReservationTime(timeStartedRef.current.trim() ? timeStartedRef.current : "00:00 am");
                  }
                }}
              />
              <IonLabel slot="end">{form.reservation ? "Yes" : "No"}</IonLabel>
            </IonItem>

            {form.reservation && (
              <>
                <div
                  className="form-item"
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 16,
                    background: "var(--ion-color-light, #f8f9fb)",
                    border: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Reservation Date Range</div>

                  <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                    {form.reservation_date && form.reservation_end_date
                      ? `${formatReservationDateOnly(form.reservation_date)} → ${formatReservationDateOnly(form.reservation_end_date)}`
                      : "Tap two dates to create a range"}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display: "inline-block",
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "#2f8f3f",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {reservationDates.length > 0
                      ? `${reservationDates.length} day${reservationDates.length > 1 ? "s" : ""}`
                      : "No range yet"}
                  </div>
                </div>

                <IonDatetime
                  presentation="date"
                  preferWheel={false}
                  showDefaultTitle={false}
                  locale="en-PH"
                  min={todayLocalYYYYMMDD()}
                  multiple={true}
                  value={
                    form.reservation_date && form.reservation_end_date
                      ? [form.reservation_date, form.reservation_end_date]
                      : form.reservation_date
                      ? [form.reservation_date]
                      : []
                  }
                  onIonChange={(e) => applyPickedDateRange(e.detail.value)}
                />
                </div>

                <IonItem className="form-item">
                  <IonLabel position="stacked">Time Started (Reservation)</IonLabel>
                  <IonInput
                    value={timeStartedInput}
                    placeholder='e.g., "2pm" / "2:30pm" / "14:00" / "1400" / "00:00"'
                    onIonChange={(e) => {
                      const v = e.detail.value ?? "";
                      setTimeStartedInput(v);
                      timeStartedRef.current = v;
                      setDateTouchTick((x) => x + 1);
                      setRefreshSeatsTick((x) => x + 1);
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLIonInputElement>) => {
                      if (e.key === "Enter") {
                        commitReservationTime(timeStartedRef.current);
                        setDateTouchTick((x) => x + 1);
                        setRefreshSeatsTick((x) => x + 1);
                      }
                    }}
                    onIonBlur={() => {
                      commitReservationTime(timeStartedRef.current);
                      setDateTouchTick((x) => x + 1);
                      setRefreshSeatsTick((x) => x + 1);
                    }}
                  />
                </IonItem>

                {!!seatPickHint && (
                  <p className="summary-text" style={{ margin: "8px 0", color: "#b00020", fontWeight: 700 }}>
                    {seatPickHint}
                  </p>
                )}

                <div className="form-item seat-wrap" style={{ opacity: isSeatPickReady ? 1 : 0.55 }}>
                  {seatGroups.map((group) => (
                    <div key={group.title} style={{ width: "100%" }}>
                      <p className="summary-text" style={{ margin: "10px 0 6px", fontWeight: 700 }}>
                        {group.title}
                      </p>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {group.seats.map((seat) => {
                          const isOccupied = occupiedSeats.includes(seat);
                          const isSelected = form.seat_number.includes(seat);

                          if (isOccupied) return null;

                          return (
                            <IonButton
                              key={seat}
                              color={isSelected ? "success" : "medium"}
                              size="small"
                              disabled={!isSeatPickReady}
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  seat_number: prev.seat_number.includes(seat)
                                    ? prev.seat_number.filter((s) => s !== seat)
                                    : [...prev.seat_number, seat],
                                }))
                              }
                            >
                              {seat}
                            </IonButton>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <IonItem className="form-item">
              <IonLabel position="stacked">Time Avail (HH:MM or hours)</IonLabel>
              <IonInput
                type="text"
                inputMode="text"
                placeholder="Examples: 0:45 / 2 / 2:30 / 100:30 / 230"
                value={timeAvailInput}
                disabled={openTime}
                onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setTimeAvailInput(e.detail.value ?? "")}
                onIonBlur={() => {
                  commitTimeAvail(timeAvailInput);
                  setDateTouchTick((x) => x + 1);
                  setRefreshSeatsTick((x) => x + 1);
                }}
                onIonChange={(e: IonInputCustomEvent<InputChangeEventDetail>) => {
                  setTimeAvailInput(e.detail.value ?? "");
                  setDateTouchTick((x) => x + 1);
                  setRefreshSeatsTick((x) => x + 1);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLIonInputElement>) => {
                  if (e.key === "Enter") {
                    commitTimeAvail(timeAvailInput);
                    setDateTouchTick((x) => x + 1);
                    setRefreshSeatsTick((x) => x + 1);
                  }
                }}
              />
            </IonItem>

            <div className="summary-section">
              <p className="summary-text">
                <strong>Time Started:</strong>{" "}
                {form.reservation ? (reservationStartIso ? formatPH(new Date(reservationStartIso)) : "—") : timeInDisplay}
              </p>

              <p className="summary-text">
                <strong>Reservation Range:</strong>{" "}
                {form.reservation
                  ? `${formatReservationDateOnly(form.reservation_date)} → ${formatReservationDateOnly(form.reservation_end_date)}`
                  : "N/A"}
              </p>

              <p className="summary-text">
                <strong>Expiry:</strong>{" "}
                {form.reservation ? (reservationLastDayEndIso ? formatPH(new Date(reservationLastDayEndIso)) : "—") : timeOutDisplay}
              </p>

              {!openTime && (
                <>
                  <p className="summary-text">Per Day Hours: {totalHHMMPreview}</p>
                  <p className="summary-text">Per Day Amount: ₱{timeAmountPreview.toFixed(2)}</p>
                </>
              )}

              {form.reservation && (
                <p className="summary-text">
                  <strong>Seat:</strong>{" "}
                  {isSeatPickReady ? (form.seat_number.length ? form.seat_number.join(", ") : "None") : "—"}
                </p>
              )}

              {form.reservation && (
                <p className="summary-text">
                  <strong>Total Reserved Days:</strong> {reservationDates.length}
                </p>
              )}
            </div>

            <IonButton expand="block" onClick={() => void handleSubmitBooking()}>
              Save Record
            </IonButton>

            <div
              style={{
                marginTop: 16,
                borderRadius: 16,
                padding: 16,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "#fffaf0",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>
                ATTENDANCE (IN / OUT)
              </div>
              <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
                Reservation only. Tap the button then enter code + select IN/OUT inside the modal.
              </div>

              <IonButton
                size="small"
                onClick={() => {
                  setAttendanceCode("");
                  setAttendanceNote("");
                  setAttendanceAction("IN");
                  setAttendanceLogs([]);
                  setAttendanceModalOpen(true);
                }}
              >
                Enter Code
              </IonButton>
            </div>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={codeModalOpen}
        onDidDismiss={() => setCodeModalOpen(false)}
        className="booking-modal"
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Booking Code</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setCodeModalOpen(false)}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          <div
            style={{
              maxWidth: 420,
              margin: "0 auto",
              textAlign: "center",
              background: "#ffffff",
              borderRadius: 20,
              padding: 20,
              boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
              border: "1px solid rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 15, opacity: 0.8, marginBottom: 10 }}>
              {savedCodeForReservation
                ? "This code is for reservation attendance / order / add-ons"
                : "This code may be used for order / add-ons"}
            </div>

            <div
              style={{
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: 8,
                margin: "8px 0 16px",
                color: "#2f8f3f",
              }}
            >
              {savedBookingCode}
            </div>

            <div
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                borderRadius: 12,
                background: savedCodeActiveNow ? "rgba(47, 143, 63, 0.10)" : "rgba(255, 193, 7, 0.14)",
                color: savedCodeActiveNow ? "#2f8f3f" : "#8a6500",
                fontWeight: 700,
              }}
            >
              {savedCodeActiveNow
                ? "Code is active now and can already be used."
                : "Reservation code will work only on the reserved date/time."}
            </div>

            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 16 }}>
              Please save or picture this code.
            </div>

            <IonButton expand="block" onClick={() => setCodeModalOpen(false)}>
              OK
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      {/* ATTENDANCE MODAL */}
      <IonModal
        isOpen={attendanceModalOpen}
        onDidDismiss={() => setAttendanceModalOpen(false)}
        className="booking-modal"
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Reservation</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setAttendanceModalOpen(false)}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="ion-padding">
          <div
            style={{
              maxWidth: 560,
              margin: "0 auto",
              borderRadius: 24,
              background: "#e9d3a0",
              padding: 18,
              boxShadow: "0 16px 40px rgba(0,0,0,0.16)",
            }}
          >
            <div
              style={{
                maxWidth: 430,
                margin: "0 auto",
                borderRadius: 20,
                background: "#fff8ea",
                padding: 20,
                boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>
                  ATTENDANCE
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  Enter Reservation Code · Select IN/OUT · Manila Day: <strong>{manilaDay}</strong>
                </div>
              </div>

            <IonItem
              lines="none"
              style={
                {
                  "--background": "transparent",
                  marginTop: 10,
                  paddingTop: 6,
                } as React.CSSProperties
              }
            >
              <IonLabel
                position="stacked"
                style={{
                  marginBottom: 4,
                }}
              >
                Reservation Code
              </IonLabel>

              <IonInput
                value={attendanceCode}
                placeholder="e.g. AB23"
                onIonChange={(e) => setAttendanceCode((e.detail.value ?? "").toUpperCase())}
                style={
                  {
                    marginTop: 4,
                  } as React.CSSProperties
                }
              />
            </IonItem>

            <IonItem
              lines="none"
              style={
                {
                  "--background": "transparent",
                  marginTop: 10,
                  paddingTop: 6,
                } as React.CSSProperties
              }
            >
              <IonLabel
                position="stacked"
                style={{
                  marginBottom: 4,
                }}
              >
                Action
              </IonLabel>

              <IonSelect
                value={attendanceAction}
                interface="popover"
                onIonChange={(e) => {
                  const v = e.detail.value;
                  setAttendanceAction(v === "OUT" ? "OUT" : "IN");
                }}
                style={
                  {
                    marginTop: 4,
                  } as React.CSSProperties
                }
              >
                <IonSelectOption value="IN">IN</IonSelectOption>
                <IonSelectOption value="OUT">OUT</IonSelectOption>
              </IonSelect>
            </IonItem>

              <IonItem lines="none" style={{ "--background": "transparent" } as React.CSSProperties}>
                <IonLabel position="stacked">Note</IonLabel>
                <IonTextarea
                  value={attendanceNote}
                  autoGrow={true}
                  placeholder="Optional note..."
                  onIonChange={(e) => setAttendanceNote(e.detail.value ?? "")}
                />
              </IonItem>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 14,
                  flexWrap: "wrap",
                }}
              >
                <IonButton
                  size="small"
                  color="dark"
                  onClick={() => setAttendanceModalOpen(false)}
                >
                  Close
                </IonButton>

                <IonButton
                  size="small"
                  color="dark"
                  onClick={() => void loadAttendanceHistory()}
                >
                  Load History
                </IonButton>

                <IonButton
                  size="small"
                  disabled={attendanceLoading}
                  onClick={() => void handleAttendanceSave()}
                >
                  {attendanceLoading ? "Saving..." : "Save"}
                </IonButton>
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                  Recent Logs
                </div>

                {attendanceLogs.length === 0 ? (
                  <div style={{ opacity: 0.75 }}>No logs found.</div>
                ) : (
                  <div
                    style={{
                      maxHeight: 280,
                      overflowY: "auto",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {attendanceLogs.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          padding: 12,
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {log.attendance_date}
                        </div>
                        <div>IN: {formatDateTime(log.in_at)}</div>
                        <div>OUT: {formatDateTime(log.out_at)}</div>
                        <div>Note: {log.note?.trim() ? log.note : "—"}</div>
                        <div>Auto Closed: {log.auto_closed ? "Yes" : "No"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </IonContent>
      </IonModal>
    </>
  );
}