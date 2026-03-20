// src/components/BookingModal.tsx
// ✅ Seat required ONLY for reservation
// ✅ NON-reservation can save WITHOUT seat (seat_number stored as "N/A" because DB is NOT NULL)
// ✅ Seat picker UI shown ONLY when reservation
// ✅ Conflict check runs ONLY when reservation
// ✅ Reservation auto-blocks seats in seat_blocked_times (source="reserved")
// ✅ Seat buttons DISABLED until date+time+duration ready (prevents stale summary seat)
// ✅ Auto refresh seats when date/time changes
// ✅ Auto-delete expired reserved blocks (end_at < now) so seats come back
// ✅ FIX: Reservation "Open Time" will NOT use 2999 anymore
// ✅ Reservation openTime => end_at = end of selected reservation date
// ✅ Non-reservation openTime can stay FAR_FUTURE
// ✅ FIX: Removed strict "past reservation time" blocking
// ✅ FIX: DB `date` ALWAYS saves CURRENT DATE (local) even for reservation
// ✅ NO any
// ✅ NEW UI: Reservation Date uses BEAUTIFUL CALENDAR PICKER
// ✅ NEW FIX: Can save even without login (auto anonymous auth)
// ✅ NEW: Phone Number required
// ✅ NEW: Phone validation MODAL
// ✅ REMOVED: Customer Field
// ✅ REMOVED: Specific ID input / id_number
// ✅ NEW: Generates 4-char booking code (letters + numbers)
// ✅ NEW: Saves booking_code to DB
// ✅ NEW: Success modal shows booking code with note for add-ons

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

interface CustomerForm {
  full_name: string;
  phone_number: string;
  customer_type: CustomerType;
  has_id: boolean;
  seat_number: string[];
  reservation: boolean;
  reservation_date?: string;
  time_started: string;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (isReservation: boolean) => void;
  seatGroups: SeatGroup[];
};

const isCustomerType = (v: unknown): v is CustomerType =>
  v === "" || v === "reviewer" || v === "student" || v === "regular";

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | "reserved" | string;
};

type SeatConflictRow = { seat_number: string };

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

const clampToReservationDay = (endIso: string, reservationDate?: string): string => {
  if (!reservationDate) return endIso;
  const eod = endOfLocalDayIso(reservationDate);
  const endMs = new Date(endIso).getTime();
  const eodMs = new Date(eod).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(eodMs)) return endIso;
  return endMs > eodMs ? eod : endIso;
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

const ensureAuthUserId = async (): Promise<string> => {
  const { data: sess } = await supabase.auth.getSession();
  if (sess?.session?.user?.id) return sess.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data?.user?.id) {
    throw new Error(error?.message ?? "Anonymous sign-in failed. Enable Anonymous provider in Supabase.");
  }
  return data.user.id;
};

const BOOKING_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

export default function BookingModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [form, setForm] = useState<CustomerForm>({
    full_name: "",
    phone_number: "",
    customer_type: "",
    has_id: false,
    seat_number: [],
    reservation: false,
    reservation_date: undefined,
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

  const getTimeEndedFrom = (startIso: string): string => {
    if (openTime) return startIso;
    return addDuration(startIso, timeAvail);
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

  const fetchOccupiedSeats = async (startIso: string, endIso: string): Promise<void> => {
    await cleanupExpiredReserved();

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    if (error) {
      console.error(error);
      setOccupiedSeats([]);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];
    const seats = rows.map((r) => String(r.seat_number).trim()).filter(Boolean);
    setOccupiedSeats(Array.from(new Set(seats)));
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

  const createSeatBlocksForReservation = async (
    seatNums: string[],
    startIso: string,
    endIso: string,
    userId: string
  ): Promise<SeatBlockInsertResult[]> => {
    const payload: SeatBlockInsert[] = seatNums.map((s) => ({
      seat_number: s,
      start_at: startIso,
      end_at: endIso,
      source: "reserved",
      created_by: userId,
      note: "reservation",
    }));

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

  const reservationStartIso = useMemo((): string | null => {
    if (!form.reservation) return null;
    if (!form.reservation_date) return null;

    const normalized = normalizeReservationTime(timeStartedNormalized);
    if (!normalized) return null;

    const parsed = parseReservationToISO(normalized, form.reservation_date);
    return parsed ?? null;
  }, [form.reservation, form.reservation_date, timeStartedNormalized]);

  const isSeatPickReady = useMemo((): boolean => {
    if (!form.reservation) return false;
    if (!reservationStartIso) return false;

    if (openTime) return true;

    const normalizedAvail = normalizeTimeAvail(timeAvailInput);
    if (!normalizedAvail) return false;
    if (normalizedAvail === "00:00") return false;

    return true;
  }, [form.reservation, reservationStartIso, openTime, timeAvailInput]);

  const seatPickHint = useMemo((): string => {
    if (!form.reservation) return "";
    if (!form.reservation_date) return "Select reservation date first.";
    if (!reservationStartIso) return "Set a valid Time Started first.";
    if (!openTime) {
      const normalizedAvail = normalizeTimeAvail(timeAvailInput);
      if (!normalizedAvail) return "Set a valid Time Avail first.";
      if (normalizedAvail === "00:00") return "Time Avail must be greater than 00:00.";
    }
    return "";
  }, [form.reservation, form.reservation_date, reservationStartIso, openTime, timeAvailInput]);

  const applyPickedDate = (raw: unknown) => {
    const pick = (s: string) => {
      const d = toYYYYMMDD(s);
      if (!d) return;

      setForm((p) => {
        if (p.reservation_date === d) return { ...p, seat_number: [] };
        return { ...p, reservation_date: d, seat_number: [], reservation: true };
      });

      setOccupiedSeats([]);
      setDateTouchTick((x) => x + 1);
      setRefreshSeatsTick((x) => x + 1);
    };

    if (typeof raw === "string") pick(raw);
    else if (Array.isArray(raw) && typeof raw[0] === "string") pick(raw[0]);
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

    setForm((p) => ({ ...p, seat_number: [] }));
    setOccupiedSeats([]);
    setDateTouchTick(0);
    setRefreshSeatsTick((x) => x + 1);
    setSavedBookingCode("");
    setCodeModalOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (!form.reservation) {
      setOccupiedSeats([]);
      return;
    }

    setForm((p) => ({ ...p, seat_number: [] }));

    if (!isSeatPickReady || !reservationStartIso) {
      setOccupiedSeats([]);
      return;
    }

    const startIso = reservationStartIso;

    let endIso: string;

    if (openTime) {
      endIso = form.reservation_date ? endOfLocalDayIso(form.reservation_date) : startIso;
    } else {
      const normalizedAvail = normalizeTimeAvail(timeAvailInput);
      if (!normalizedAvail || normalizedAvail === "00:00") {
        setOccupiedSeats([]);
        return;
      }

      if (timeAvail !== normalizedAvail) setTimeAvail(normalizedAvail);
      if (timeAvailInput !== normalizedAvail) setTimeAvailInput(normalizedAvail);

      const computedEnd = addDuration(startIso, normalizedAvail);
      endIso =
        computedEnd === startIso
          ? new Date(new Date(startIso).getTime() + 60_000).toISOString()
          : computedEnd;

      endIso = clampToReservationDay(endIso, form.reservation_date);
    }

    void fetchOccupiedSeats(startIso, endIso);
  }, [
    isOpen,
    form.reservation,
    form.reservation_date,
    timeStartedNormalized,
    openTime,
    timeAvailInput,
    isSeatPickReady,
    reservationStartIso,
    dateTouchTick,
    refreshSeatsTick,
    timeAvail,
  ]);

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

  const summaryStartIso = useMemo(() => {
    if (!form.reservation) return timeSnapshotIso;
    return reservationStartIso ?? timeSnapshotIso;
  }, [form.reservation, reservationStartIso, timeSnapshotIso]);

  const summaryEndIso = useMemo(() => {
    if (openTime) return summaryStartIso;
    return getTimeEndedFrom(summaryStartIso);
  }, [openTime, summaryStartIso, timeAvail]);

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
      if (!form.reservation_date) return alert("Please select a reservation date.");
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

    const startIsoToStore =
      form.reservation && reservationStartIso ? reservationStartIso : new Date().toISOString();

    const dateToStore = todayLocalYYYYMMDD();

    const timeEndedToStore = (() => {
      if (form.reservation && openTime) {
        return form.reservation_date ? endOfLocalDayIso(form.reservation_date) : startIsoToStore;
      }

      if (!form.reservation && openTime) {
        return FAR_FUTURE_ISO;
      }

      const computed = getTimeEndedFrom(startIsoToStore);
      const end =
        computed === startIsoToStore
          ? new Date(new Date(startIsoToStore).getTime() + 60_000).toISOString()
          : computed;

      return form.reservation ? clampToReservationDay(end, form.reservation_date) : end;
    })();

    if (form.reservation) {
      const { data: conflicts, error: conflictErr } = await supabase
        .from("seat_blocked_times")
        .select("seat_number")
        .in("seat_number", form.seat_number)
        .lt("start_at", timeEndedToStore)
        .gt("end_at", startIsoToStore);

      if (conflictErr) return alert(`Seat check error: ${conflictErr.message}`);

      const conflictSeats = (conflicts ?? [])
        .map((r: SeatConflictRow) => String(r.seat_number).trim())
        .filter(Boolean);

      if (conflictSeats.length > 0) {
        return alert(`Seat already taken: ${conflictSeats.join(", ")}`);
      }
    }

    const totalMin = getTotalMinutes();
    const totalHoursForDB = Number((totalMin / 60).toFixed(2));
    const timeAmount = openTime ? 0 : getAmountPeso();

    const seatToStore = form.reservation ? form.seat_number.join(", ") : SEAT_NA;

    let createdBlockIds: string[] = [];

    try {
      const bookingCode = await createUniqueBookingCode();

      if (form.reservation) {
        const created = await createSeatBlocksForReservation(
          form.seat_number,
          startIsoToStore,
          timeEndedToStore,
          userId
        );
        createdBlockIds = created.map((r) => r.id);
      }

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
        seat_number: seatToStore,
        reservation: form.reservation ? "yes" : "no",
        reservation_date: form.reservation_date ?? null,
        booking_code: bookingCode,
      });

      if (sessionErr) {
        await rollbackSeatBlocks(createdBlockIds);
        return alert(`Error saving session: ${sessionErr.message}`);
      }

      const wasReservation = form.reservation;
      setSavedBookingCode(bookingCode);
      setCodeModalOpen(true);
      resetBookingForm();
      onSaved(wasReservation);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return alert(`Error saving: ${msg}`);
    }
  };

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
                    <div style={{ fontWeight: 700, fontSize: 16 }}>Reservation Date</div>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                      {formatReservationDateOnly(form.reservation_date)}
                    </div>
                  </div>

                  <IonDatetime
                    presentation="date"
                    preferWheel={false}
                    showDefaultTitle={true}
                    locale="en-PH"
                    min={todayLocalYYYYMMDD()}
                    value={form.reservation_date}
                    onIonChange={(e) => applyPickedDate(e.detail.value)}
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
                <strong>Time Out:</strong>{" "}
                {form.reservation ? (reservationStartIso ? timeOutDisplay : "—") : timeOutDisplay}
              </p>

              {!openTime && (
                <>
                  <p className="summary-text">Total Hours: {totalHHMMPreview}</p>
                  <p className="summary-text">Total Amount: ₱{timeAmountPreview.toFixed(2)}</p>
                </>
              )}

              {form.reservation && (
                <p className="summary-text">
                  <strong>Seat:</strong>{" "}
                  {isSeatPickReady ? (form.seat_number.length ? form.seat_number.join(", ") : "None") : "—"}
                </p>
              )}
            </div>

            <IonButton expand="block" onClick={() => void handleSubmitBooking()}>
              Save Record
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
  isOpen={codeModalOpen}
  onDidDismiss={() => setCodeModalOpen(false)}
  className="booking-code-modal"
>
  <IonHeader className="booking-code-header">
    <IonToolbar className="booking-code-toolbar">
      <IonTitle className="booking-code-title">Booking Code</IonTitle>
      <IonButtons slot="end">
        <IonButton className="booking-code-close-btn" onClick={() => setCodeModalOpen(false)}>
          <IonIcon icon={closeOutline} />
        </IonButton>
      </IonButtons>
    </IonToolbar>
  </IonHeader>

  <IonContent className="ion-padding booking-code-content">
    <div className="booking-code-card">
      <div className="booking-code-subtext">
        Please picture this code for add-ons.
      </div>

      <div className="booking-code-value">
        {savedBookingCode}
      </div>

      <div className="booking-code-note">
        Use this code when ordering add-ons or other items.
      </div>

      <IonButton
        expand="block"
        className="booking-code-ok-btn"
        onClick={() => setCodeModalOpen(false)}
      >
        OK
      </IonButton>
    </div>
  </IonContent>
</IonModal>
    </>
  );
}