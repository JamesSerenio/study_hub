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
//    - reservation openTime => end_at = end of the selected reservation date (23:59:59.999)
//    - so when you pick NEXT DAY, seats are FREE automatically
// ✅ Non-reservation openTime can stay FAR_FUTURE (seat is "N/A" so no seat blocking)
// ✅ NEW: If Reservation Time Started is earlier than CURRENT TIME -> show modal + block saving
// ✅ FIX: DB `date` ALWAYS saves CURRENT DATE (local) even for reservation
// ✅ NO any
// ✅ NEW UI: Reservation Date uses scroll/wheel picker (IonDatetimeButton + modal)

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
  IonDatetimeButton,
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
  customer_type: CustomerType;
  customer_field: string;
  has_id: boolean;
  id_number: string;
  seat_number: string[];
  reservation: boolean;
  reservation_date?: string; // "YYYY-MM-DD"
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

// ✅ LOCAL current date in YYYY-MM-DD (no red, no UTC issue)
const todayLocalYYYYMMDD = (): string => new Date().toLocaleDateString("en-CA");

const normalizeTimeAvail = (value: string): string | null => {
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

// Input MUST be "HH:MM am/pm"
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

// ✅ reservation end of local day (so NEXT DAY seats are free)
const endOfLocalDayIso = (yyyyMmDd: string): string => {
  const m = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 23, 59, 59, 999).toISOString();
};

// ✅ clamp helper: don't let reservation spill into next day
const clampToReservationDay = (endIso: string, reservationDate?: string): string => {
  if (!reservationDate) return endIso;
  const eod = endOfLocalDayIso(reservationDate);
  const endMs = new Date(endIso).getTime();
  const eodMs = new Date(eod).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(eodMs)) return endIso;
  return endMs > eodMs ? eod : endIso;
};

// ✅ NEW: prevent reservation start time earlier than current time
const isReservationStartInPast = (startIso: string): boolean => {
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return true;
  return startMs < Date.now();
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

export default function BookingModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [form, setForm] = useState<CustomerForm>({
    full_name: "",
    customer_type: "",
    customer_field: "",
    has_id: false,
    id_number: "",
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

  const dateRef = useRef<HTMLIonDatetimeElement | null>(null);
  const [dateTouchTick, setDateTouchTick] = useState(0);

  const [refreshSeatsTick, setRefreshSeatsTick] = useState(0);

  const [timeAlertOpen, setTimeAlertOpen] = useState(false);
  const [timeAlertMsg, setTimeAlertMsg] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  ]);

  const formatPH = (d: Date) =>
    d.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

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

  const handleSubmitBooking = async (): Promise<void> => {
    if (form.reservation && reservationStartIso) {
      if (isReservationStartInPast(reservationStartIso)) {
        setTimeAlertMsg(
          "Time Started cannot be earlier than the current time. Please choose a valid future time."
        );
        setTimeAlertOpen(true);
        return;
      }
    }

    const trimmedName = form.full_name.trim();
    if (!trimmedName) return alert("Full Name is required.");

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

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return alert("You must be logged in to save records.");

    const startIsoToStore =
      form.reservation && reservationStartIso ? reservationStartIso : new Date().toISOString();

    // ✅ FIX: ALWAYS current date saved to DB
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
      if (form.reservation) {
        const created = await createSeatBlocksForReservation(
          form.seat_number,
          startIsoToStore,
          timeEndedToStore,
          auth.user.id
        );
        createdBlockIds = created.map((r) => r.id);
      }

      const { error: sessionErr } = await supabase.from("customer_sessions").insert({
        staff_id: auth.user.id,
        date: dateToStore, // ✅ current date always
        full_name: trimmedName,
        customer_type: form.customer_type,
        customer_field: form.customer_field,
        has_id: form.has_id,
        id_number: form.id_number,
        hour_avail: openTime ? "OPEN" : timeAvail,
        time_started: startIsoToStore,
        time_ended: timeEndedToStore,
        total_time: openTime ? 0 : totalHoursForDB,
        total_amount: timeAmount,
        seat_number: seatToStore,
        reservation: form.reservation ? "yes" : "no",
        reservation_date: form.reservation_date ?? null, // ✅ selected reservation date stays here
      });

      if (sessionErr) {
        await rollbackSeatBlocks(createdBlockIds);
        return alert(`Error saving session: ${sessionErr.message}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return alert(`Error blocking seat(s): ${msg}`);
    }

    const wasReservation = form.reservation;

    setForm({
      full_name: "",
      customer_type: "",
      customer_field: "",
      has_id: false,
      id_number: "",
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

    onSaved(wasReservation);
  };

  return (
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
        isOpen={timeAlertOpen}
        header="Invalid Time Started"
        message={timeAlertMsg}
        buttons={["OK"]}
        onDidDismiss={() => setTimeAlertOpen(false)}
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
              onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })}
              placeholder="Enter full name"
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
            <IonLabel position="stacked">Customer Field</IonLabel>
            <IonInput
              value={form.customer_field}
              onIonChange={(e) => setForm({ ...form, customer_field: e.detail.value ?? "" })}
            />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel>ID</IonLabel>
            <IonToggle
              checked={form.has_id}
              onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })}
            />
            <IonLabel slot="end">{form.has_id ? "With" : "Without"}</IonLabel>
          </IonItem>

          {form.has_id && (
            <IonItem className="form-item">
              <IonLabel position="stacked">Specific ID</IonLabel>
              <IonInput
                value={form.id_number}
                placeholder="e.g., National ID, Student ID"
                onIonChange={(e) => setForm({ ...form, id_number: e.detail.value ?? "" })}
              />
            </IonItem>
          )}

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
              {/* ✅ NEW: scroll/wheel date picker (not inline calendar) */}
              <IonItem className="form-item">
                <IonLabel position="stacked">Reservation Date</IonLabel>

                <div style={{ marginTop: 8, width: "100%" }}>
                  <IonDatetimeButton datetime="reservation-date" />
                </div>

                <IonModal keepContentsMounted>
                  <IonDatetime
                    id="reservation-date"
                    ref={dateRef}
                    presentation="date"
                    preferWheel={true}
                    showDefaultButtons={true}
                    min={todayLocalYYYYMMDD()}
                    value={form.reservation_date}
                    onIonChange={(e) => applyPickedDate(e.detail.value)}
                  />
                </IonModal>
              </IonItem>

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
                <p
                  className="summary-text"
                  style={{ margin: "8px 0", color: "#b00020", fontWeight: 700 }}
                >
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
              onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) =>
                setTimeAvailInput(e.detail.value ?? "")
              }
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
              {form.reservation
                ? reservationStartIso
                  ? formatPH(new Date(reservationStartIso))
                  : "—"
                : timeInDisplay}
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
                {isSeatPickReady
                  ? form.seat_number.length
                    ? form.seat_number.join(", ")
                    : "None"
                  : "—"}
              </p>
            )}
          </div>

          <IonButton expand="block" onClick={() => void handleSubmitBooking()}>
            Save Record
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
